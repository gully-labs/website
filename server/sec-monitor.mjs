// Gully Security monitoring: a workspace adds a contract (chain + address) and is told, in plain words, when
// something privileged happens to it. Part 3 of the security platform (scan engine: server/security/*; UI and
// public pages: server/security-routes.mjs + src/pages/security/*).
//
// What is watched, per contract:
//   - OwnershipTransferred / OwnershipTransferStarted (Ownable, Ownable2Step)
//   - AdminChanged (ERC-1967 proxies), Upgraded and BeaconUpgraded (ERC-1967 and beacon proxies)
//   - RoleGranted / RoleRevoked (AccessControl), with the common role names spelled out
//   - Paused / Unpaused (Pausable)
//   - large outflows of the contract's own ERC-20 balance (Transfer logs FROM the contract, as a share of what it
//     held) and of its native coin balance (read every NATIVE_EVERY passes; a drop over the threshold or the %)
//   - the proxy's code address, admin and beacon read straight from the ERC-1967 slots (and the older ZeppelinOS
//     ones), every STATE_EVERY passes, so a change that emitted no event is still caught
//   - for a contract controlled by a Safe (its owner(), or the owner of its proxy admin, is a Safe):
//     AddedOwner / RemovedOwner / ChangedThreshold on that Safe
//
// How it reads: every LOOP_MS (60 s) one pass per chain, through payments.rpc (the same RPC failover as everything
// else). Per chain and pass: one eth_blockNumber, then eth_getLogs over bounded block ranges (RANGE blocks, halved
// when a node refuses the range, at most MAX_RANGES_PER_PASS ranges) for (a) every watched contract and Safe at
// once (address list, chunked by ADDR_CHUNK) and (b) Transfer logs whose sender is a watched contract. A chain that
// fails backs off (1, 2, 4 … 15 minutes). Token symbols and decimals are cached for good; balances for one pass.
// Logs are read up to LAG blocks behind the head, so a short reorg does not produce a false alert.
//
// Delivery: through the existing alert channels (alerts.mjs postWebhook: https, SSRF guard, HMAC-signed with the
// monitor's own secret, X-Gully-Timestamp / X-Gully-Signature; telegram.mjs sendAccountTelegram to the chat linked
// to the workspace). Never twice: every event has a key (chain:tx:logIndex for logs, chain:address:kind:value for
// state reads) and the key is written to disk BEFORE the send, so a crash mid-send cannot repeat it (at most once).
//
// Persisted in DATA_DIR/sec-monitor.json: monitors (with their last known state and recent events), the per-chain
// block cursor and the sent keys (pruned after SENT_KEEP_MS). A restart resumes from the cursor; a chain that was
// never read starts at its head (no backlog storm). Runs only from server.mjs startLoops() (never in standby);
// SEC_MONITOR_LOOP=off (or TRACKER_LOOP=off, as in the tests) leaves it to tickMonitorsNow().
//
// Limits: PLANS[*].monitors in plans.mjs (the one place limits live). A workspace over its limit (after a
// downgrade) keeps its oldest monitors running; the rest are shown as "not in your plan" and not read.
//
// RPC load (see monitorLoad()): per active chain about 3 calls a minute shared by every contract on it
// (eth_blockNumber + 2 x eth_getLogs while caught up), plus per contract about 1 call a minute
// (native balance every 5 minutes; owner, code, admin, beacon and Safe re-read every 10 minutes, about 8 calls;
// symbol/decimals once per token and balanceOf only when a Transfer out of the contract is seen).

import fs from 'node:fs'
import path from 'node:path'
import { checkWebhookForm, postWebhook, resolvePublic } from './alerts.mjs'
import { DATA_DIR, json, readJson } from './http.mjs'
import { planOf } from './plans.mjs'
import { CHAINS, CHAIN_LIST, fmtUnits, READ_CHAINS, rpc as payRpc } from './payments.mjs'
import { getAccount, randomToken } from './store.mjs'
import { linkedChat, sendAccountTelegram, telegramEnabled } from './telegram.mjs'
import { monitorAlertKeyboard } from './telegram-ui.mjs'
import { keccak_256 } from './vendor/noble.mjs'

const FILE = () => path.join(DATA_DIR, 'sec-monitor.json')
export const LOOP_MS = 60_000
export const RANGE = 500
const MIN_RANGE = 8
export const MAX_RANGES_PER_PASS = 4
const ADDR_CHUNK = 50
export const NATIVE_EVERY = 5
export const STATE_EVERY = 10
const MAX_BACKOFF_MS = 15 * 60_000
const SENT_KEEP_MS = 45 * 86_400_000
const KEEP_EVENTS = 100
const KEEP_DELIVERIES = 50
export const DEFAULT_PCT = 10
/** Blocks behind the head that are read: a short reorg never produces an alert. */
const LAG = { 1: 2, 8453: 5, 10: 5, 42161: 20, 56: 5, 137: 32, 43114: 2 }
const NAME_RE = /^[\p{L}\p{N} ._'’()\-]{0,40}$/u
const ADDR_RE = /^0x[0-9a-f]{40}$/
const ZERO = '0x0000000000000000000000000000000000000000'

/* --------------------------------------------------------------- abi bits --- */

const enc = new TextEncoder()
const hexOf = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const keccak = (s) => '0x' + hexOf(keccak_256(enc.encode(s)))

export const TOPICS = {
  ownershipTransferred: keccak('OwnershipTransferred(address,address)'),
  ownershipTransferStarted: keccak('OwnershipTransferStarted(address,address)'),
  adminChanged: keccak('AdminChanged(address,address)'),
  roleGranted: keccak('RoleGranted(bytes32,address,address)'),
  roleRevoked: keccak('RoleRevoked(bytes32,address,address)'),
  upgraded: keccak('Upgraded(address)'),
  beaconUpgraded: keccak('BeaconUpgraded(address)'),
  paused: keccak('Paused(address)'),
  unpaused: keccak('Unpaused(address)'),
  transfer: keccak('Transfer(address,address,uint256)'),
  addedOwner: keccak('AddedOwner(address)'),
  removedOwner: keccak('RemovedOwner(address)'),
  changedThreshold: keccak('ChangedThreshold(uint256)'),
}
const CONTRACT_TOPICS = ['ownershipTransferred', 'ownershipTransferStarted', 'adminChanged', 'roleGranted', 'roleRevoked', 'upgraded', 'beaconUpgraded', 'paused', 'unpaused'].map((k) => TOPICS[k])
const SAFE_TOPICS = [TOPICS.addedOwner, TOPICS.removedOwner, TOPICS.changedThreshold]

/** ERC-1967 slots, plus the older ZeppelinOS ones some long-lived proxies (USDC's among them) still use. */
export const SLOTS = {
  implementation: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
  admin: '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',
  beacon: '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50',
  ozImplementation: '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3',
  ozAdmin: '0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b',
}
export const SEL = {
  owner: '0x8da5cb5b',
  getOwners: '0xa0e67e2b',
  getThreshold: '0xe75235b8',
  implementation: '0x5c60da1b',
  balanceOf: '0x70a08231',
  decimals: '0x313ce567',
  symbol: '0x95d89b41',
  name: '0x06fdde03',
}

/** Role names AccessControl contracts commonly use, by their hash, so an alert can say "minter" not 0x9f2d…. */
const ROLE_NAMES = Object.fromEntries(
  ['MINTER_ROLE', 'PAUSER_ROLE', 'UPGRADER_ROLE', 'ADMIN_ROLE', 'BURNER_ROLE', 'OPERATOR_ROLE', 'MANAGER_ROLE', 'GOVERNOR_ROLE', 'GUARDIAN_ROLE', 'EXECUTOR_ROLE', 'PROPOSER_ROLE', 'CANCELLER_ROLE', 'TIMELOCK_ADMIN_ROLE', 'KEEPER_ROLE', 'ORACLE_ROLE', 'BLACKLISTER_ROLE', 'RESCUER_ROLE', 'FEE_MANAGER_ROLE'].map((r) => [keccak(r), r.replace(/_ROLE$/, '').toLowerCase().replace(/_/g, ' ')]),
)
ROLE_NAMES['0x' + '0'.repeat(64)] = 'main admin'
export const roleName = (h) => ROLE_NAMES[String(h).toLowerCase()] ?? `custom (${String(h).slice(0, 10)}…)`

const word = (hex, i) => String(hex ?? '').replace(/^0x/, '').slice(i * 64, i * 64 + 64)
const asAddr = (w) => (w && w.length === 64 ? '0x' + w.slice(24).toLowerCase() : null)
const topicAddr = (t) => asAddr(String(t ?? '').replace(/^0x/, ''))
const asBig = (w) => (w && /^[0-9a-fA-F]+$/.test(w) ? BigInt('0x' + w) : null)
const pad = (a) => '0x' + String(a).toLowerCase().replace(/^0x/, '').padStart(64, '0')
const num = (h) => (typeof h === 'string' && /^0x[0-9a-fA-F]+$/.test(h) ? Number(BigInt(h)) : null)
export const short = (a) => (typeof a === 'string' && a.length >= 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : String(a))

/** A word of returndata to an address, or null for empty/zero-length answers (a revert reads as '0x'). */
function retAddr(out) {
  if (typeof out !== 'string' || out.length < 66) return null
  return asAddr(out.slice(2, 66))
}

/** ABI string or bytes32 returndata to text (symbol(), name()); null when unreadable. */
export function decodeString(out) {
  if (typeof out !== 'string' || !/^0x[0-9a-fA-F]*$/.test(out) || out.length < 66) return null
  const h = out.slice(2)
  try {
    if (h.length >= 128 && BigInt('0x' + h.slice(0, 64)) === 32n) {
      const len = Number(BigInt('0x' + h.slice(64, 128)))
      if (len > 0 && len <= 64) return Buffer.from(h.slice(128, 128 + len * 2), 'hex').toString('utf8').replace(/[^\p{L}\p{N} ._$+\-]/gu, '').slice(0, 24) || null
    }
    const s = Buffer.from(h.slice(0, 64), 'hex').toString('utf8').replace(/\0+$/, '')
    return s.replace(/[^\p{L}\p{N} ._$+\-]/gu, '').slice(0, 24) || null
  } catch {
    return null
  }
}

/* -------------------------------------------------------------- the store --- */

let db = load()
function load() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE(), 'utf8'))
    return { monitors: Array.isArray(d?.monitors) ? d.monitors : [], chains: d?.chains && typeof d.chains === 'object' ? d.chains : {}, sent: d?.sent && typeof d.sent === 'object' ? d.sent : {} }
  } catch {
    return { monitors: [], chains: {}, sent: {} }
  }
}
function save() {
  try {
    fs.mkdirSync(path.dirname(FILE()), { recursive: true })
    fs.writeFileSync(FILE() + '.tmp', JSON.stringify(db))
    fs.renameSync(FILE() + '.tmp', FILE())
  } catch (e) {
    console.error('sec-monitor save:', e?.message ?? e)
  }
}

/* -------------------------------------------------------- injectable bits --- */

let rpc = payRpc
let sendTelegram = (owner, text, opts) => sendAccountTelegram(owner, text, opts)
let sendWebhook = (url, secret, body) => postWebhook(url, secret, body, { userAgent: 'GullyLabs-Monitor/1 (+https://docs.gullylabs.xyz/gully-score)' })
const listeners = new Set()

/** Tests: replace the RPC (chainId, method, params) -> result. */
export const setMonitorRpcForTest = (fn) => (rpc = fn ?? payRpc)
/** Tests: replace the senders. */
export function setMonitorSendersForTest({ telegram, webhook } = {}) {
  if (telegram) sendTelegram = telegram
  if (webhook) sendWebhook = webhook
}
/** Tests: forget everything (memory and disk). */
export function resetMonitorsForTest() {
  db = { monitors: [], chains: {}, sent: {} }
  tokenCache.clear()
  save()
}
/** Tests: forget chain back-off and range halving. */
export function resetBackoffForTest() {
  backoff.clear()
  ranges.clear()
}
/** Tests: drop memory and read the file again, as a restart does. */
export function reloadMonitorsForTest() {
  db = load()
  tokenCache.clear()
}
/** Called with (monitor, events) after each pass that found events (gully-score.mjs refreshes the score). */
export function onMonitorEvents(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/* ------------------------------------------------------------ chains --- */

/** The chains a contract can be watched on: the EVM chains with an RPC failover (payments.mjs). */
export const monitorChains = () => CHAIN_LIST.filter((c) => !c.testnet).map((c) => ({ id: c.id, key: c.key, name: c.name, explorer: c.explorer }))
export function chainOf(x) {
  const s = String(x ?? '').toLowerCase()
  const c = CHAIN_LIST.find((k) => k.key === s || String(k.id) === s)
  return c ?? null
}
/** The chains a Gully Score can be read on: the monitored chains plus the read-only ones (payments.mjs READ_CHAINS,
    Gully Chain Testnet). Monitoring itself stays on monitorChains(). */
export const scoreChainList = () => [...monitorChains(), ...Object.values(READ_CHAINS).map((c) => ({ id: c.id, key: c.key, name: c.name, explorer: c.explorer }))]
export function scoreChainOf(x) {
  const s = String(x ?? '').toLowerCase()
  return chainOf(s) ?? Object.values(READ_CHAINS).find((k) => k.key === s || String(k.id) === s) ?? null
}
const txLink = (chainId, h) => `${CHAINS[chainId].explorer}/tx/${h}`
const addrLink = (chainId, a) => `${CHAINS[chainId].explorer}/address/${a}`
const coinOf = (chainId) => ({ 56: 'BNB', 137: 'POL', 43114: 'AVAX' })[chainId] ?? 'ETH'

/* ---------------------------------------------------------------- reads --- */

const ethCall = (chainId, to, data, block = 'latest') => rpc(chainId, 'eth_call', [{ to, data }, block])
const okHex = (x) => typeof x === 'string' && /^0x[0-9a-fA-F]*$/.test(x)

/** Reads that may revert: a revert (or empty answer) is null, a node fault throws. */
async function tryCall(chainId, to, data) {
  try {
    const out = await ethCall(chainId, to, data)
    return okHex(out) && out.length > 2 ? out : null
  } catch {
    // payments.rpc tries every node and reports the LAST error, so a revert can surface as a node fault when one
    // node is down. Calls that may revert are therefore never trusted to throw; storage and code reads (which
    // cannot revert) are what notice an unreachable chain.
    return null
  }
}

async function readSlot(chainId, address, slot) {
  const out = await rpc(chainId, 'eth_getStorageAt', [address, slot, 'latest'])
  if (!okHex(out)) throw Object.assign(new Error('unreadable storage'), { nodeFault: true })
  const a = asAddr(out.replace(/^0x/, '').padStart(64, '0'))
  return a && a !== ZERO ? a : null
}

async function hasCode(chainId, address) {
  const code = await rpc(chainId, 'eth_getCode', [address, 'latest'])
  if (!okHex(code)) throw Object.assign(new Error('unreadable code'), { nodeFault: true })
  return code.length > 2
}

/** A Safe's owners and threshold, or null when `address` is not a Safe. */
export async function readSafe(chainId, address) {
  const t = await tryCall(chainId, address, SEL.getThreshold)
  if (!t) return null
  const threshold = Number(asBig(word(t, 0)) ?? 0n)
  const o = await tryCall(chainId, address, SEL.getOwners)
  if (!o || !threshold) return null
  const h = o.slice(2)
  const n = Number(asBig(h.slice(64, 128)) ?? 0n)
  if (!n || n > 100) return null
  const owners = []
  for (let i = 0; i < n; i++) owners.push(asAddr(h.slice(128 + i * 64, 192 + i * 64)))
  if (owners.some((x) => !x)) return null
  return { address, owners, threshold }
}

/**
 * Who controls a contract, as far as the chain says: owner() and the proxy's code address, admin and beacon.
 * The controller is owner(), else the proxy admin; when the controller is a contract that is not a Safe but has
 * an owner() of its own (a ProxyAdmin), that owner is followed once. A Safe found on the way is returned.
 */
export async function readControl(chainId, address) {
  const owner = retAddr(await tryCall(chainId, address, SEL.owner))
  const implementation = (await readSlot(chainId, address, SLOTS.implementation)) ?? (await readSlot(chainId, address, SLOTS.ozImplementation))
  const admin = (await readSlot(chainId, address, SLOTS.admin)) ?? (await readSlot(chainId, address, SLOTS.ozAdmin))
  const beacon = await readSlot(chainId, address, SLOTS.beacon)
  let safe = null
  const controller = owner && owner !== ZERO ? owner : admin
  if (controller && (await hasCode(chainId, controller))) {
    safe = await readSafe(chainId, controller)
    if (!safe) {
      const next = retAddr(await tryCall(chainId, controller, SEL.owner))
      if (next && next !== ZERO && next !== controller && (await hasCode(chainId, next))) safe = await readSafe(chainId, next)
    }
  }
  return { owner, implementation, admin, beacon, safe }
}

const tokenCache = new Map() // `${chainId}:${token}` -> { symbol, decimals }
async function tokenInfo(chainId, token) {
  const k = `${chainId}:${token}`
  if (tokenCache.has(k)) return tokenCache.get(k)
  const d = await tryCall(chainId, token, SEL.decimals)
  const s = await tryCall(chainId, token, SEL.symbol)
  const dec = d ? Number(asBig(word(d, 0)) ?? 18n) : 18
  const info = { symbol: decodeString(s) ?? 'tokens', decimals: Number.isInteger(dec) && dec <= 36 ? dec : 18, known: !!d }
  tokenCache.set(k, info)
  return info
}

async function balanceOf(chainId, token, holder) {
  const out = await ethCall(chainId, token, SEL.balanceOf + holder.slice(2).padStart(64, '0'))
  if (!okHex(out) || out.length < 66) return null
  return BigInt(out.slice(0, 66))
}

/* ------------------------------------------------------------- decoding --- */

/**
 * One log to a monitor event, or null when it is not one we report. `ctx`: { monitor } for a contract's own log,
 * { safeOf } for a Safe's log, { outflowOf } for a Transfer whose sender is watched.
 */
export function decodeLog(log, chainId) {
  const t0 = String(log?.topics?.[0] ?? '').toLowerCase()
  const t = log.topics ?? []
  const data = String(log.data ?? '0x')
  const base = { chainId, emitter: String(log.address ?? '').toLowerCase(), txHash: log.transactionHash ?? null, blockNumber: num(log.blockNumber), logIndex: num(log.logIndex), key: `${chainId}:${log.transactionHash}:${num(log.logIndex)}` }
  // Topic or data placement differs between versions (indexed or not); read whichever holds it.
  const arg = (i, wi) => (t[i] ? topicAddr(t[i]) : asAddr(word(data, wi)))
  switch (t0) {
    case TOPICS.ownershipTransferred:
      return { ...base, kind: 'owner-changed', from: arg(1, 0), to: arg(2, t[1] ? 0 : 1) }
    case TOPICS.ownershipTransferStarted:
      return { ...base, kind: 'owner-transfer-started', from: arg(1, 0), to: arg(2, t[1] ? 0 : 1) }
    case TOPICS.adminChanged:
      return { ...base, kind: 'admin-changed', from: arg(1, 0), to: arg(2, t[1] ? 0 : 1) }
    case TOPICS.roleGranted:
    case TOPICS.roleRevoked:
      if (t.length < 4) return null
      return { ...base, kind: t0 === TOPICS.roleGranted ? 'role-granted' : 'role-revoked', role: String(t[1]).toLowerCase(), roleName: roleName(t[1]), account: topicAddr(t[2]), sender: topicAddr(t[3]) }
    case TOPICS.upgraded:
      return { ...base, kind: 'upgraded', to: arg(1, 0) }
    case TOPICS.beaconUpgraded:
      return { ...base, kind: 'beacon-upgraded', to: arg(1, 0) }
    case TOPICS.paused:
      return { ...base, kind: 'paused', by: arg(1, 0) }
    case TOPICS.unpaused:
      return { ...base, kind: 'unpaused', by: arg(1, 0) }
    case TOPICS.addedOwner:
      return { ...base, kind: 'safe-owner-added', safe: base.emitter, account: arg(1, 0) }
    case TOPICS.removedOwner:
      return { ...base, kind: 'safe-owner-removed', safe: base.emitter, account: arg(1, 0) }
    case TOPICS.changedThreshold: {
      const v = t[1] ? asBig(String(t[1]).slice(2)) : asBig(word(data, 0))
      return { ...base, kind: 'safe-threshold-changed', safe: base.emitter, threshold: v === null ? null : Number(v) }
    }
    case TOPICS.transfer: {
      if (t.length !== 3) return null // ERC-721 has the id indexed (4 topics): not an outflow of a balance
      const value = asBig(word(data, 0))
      if (value === null) return null
      return { ...base, kind: 'outflow', token: base.emitter, from: topicAddr(t[1]), to: topicAddr(t[2]), raw: value.toString() }
    }
    default:
      return null
  }
}

/** Privileged changes (they feed the Gully Score's "recent privileged changes"); outflows are not. */
export const PRIVILEGED = new Set(['owner-changed', 'owner-transfer-started', 'admin-changed', 'role-granted', 'role-revoked', 'upgraded', 'beacon-upgraded', 'paused', 'unpaused', 'safe-owner-added', 'safe-owner-removed', 'safe-threshold-changed', 'code-changed'])

/* ------------------------------------------------------------- plain text --- */

const fmtPct = (p) => (p >= 10 ? Math.round(p) : Math.round(p * 10) / 10).toString()
const fmtAmount = (raw, decimals) => {
  const s = fmtUnits(BigInt(raw), decimals)
  const [i, f = ''] = s.split('.')
  const int = BigInt(i).toLocaleString('en-US')
  const frac = f.slice(0, BigInt(i) >= 1000n ? 0 : 4).replace(/0+$/, '')
  return frac ? `${int}.${frac}` : int
}

/** The alert line for one event, in plain words. Ends with the chain and a link to the transaction or address. */
export function eventText(e, m) {
  const name = m.name || short(m.address)
  const chain = CHAINS[m.chainId]?.name ?? `chain ${m.chainId}`
  const link = e.txHash ? txLink(m.chainId, e.txHash) : addrLink(m.chainId, m.address)
  let line
  switch (e.kind) {
    case 'owner-changed':
      line = e.to === ZERO ? `⚠️ The owner of ${name} gave up ownership (it was ${short(e.from)}): nobody owns it now` : `⚠️ Owner of ${name} changed from ${short(e.from)} to ${short(e.to)}`
      break
    case 'owner-transfer-started':
      line = `⚠️ The owner of ${name} started handing it over to ${short(e.to)}; it takes effect once ${short(e.to)} accepts`
      break
    case 'admin-changed':
      line = `⚠️ The upgrade admin of ${name} changed from ${short(e.from)} to ${short(e.to)}`
      break
    case 'role-granted':
      line = `⚠️ ${short(e.account)} was given the ${e.roleName} role on ${name} by ${short(e.sender)}`
      break
    case 'role-revoked':
      line = `ℹ️ ${short(e.account)} lost the ${e.roleName} role on ${name} (removed by ${short(e.sender)})`
      break
    case 'upgraded':
      line = `⚠️ ${name} was upgraded: it now runs the code at ${short(e.to)}${e.prev ? ` (was ${short(e.prev)})` : ''}`
      break
    case 'beacon-upgraded':
      line = `⚠️ ${name} now takes its code from ${short(e.to)}, which can change what it runs`
      break
    case 'code-changed':
      line = `⚠️ The code behind ${name} changed from ${short(e.from)} to ${short(e.to)} without an upgrade notice`
      break
    case 'paused':
      line = `⚠️ ${name} was paused${e.by ? ` by ${short(e.by)}` : ''}: most actions on it are stopped until it is unpaused`
      break
    case 'unpaused':
      line = `✅ ${name} was unpaused${e.by ? ` by ${short(e.by)}` : ''}`
      break
    case 'safe-owner-added':
      line = `⚠️ A new signer ${short(e.account)} was added to the Safe ${short(e.safe)} that controls ${name}`
      break
    case 'safe-owner-removed':
      line = `⚠️ Signer ${short(e.account)} was removed from the Safe ${short(e.safe)} that controls ${name}`
      break
    case 'safe-threshold-changed':
      line = `⚠️ The Safe ${short(e.safe)} that controls ${name} now needs ${e.threshold ?? 'an unknown number of'}${e.owners ? ` of ${e.owners}` : ''} signatures to act${e.prev ? ` (it needed ${e.prev})` : ''}`
      break
    case 'outflow':
      line = `⚠️ Large outflow from ${name}: ${fmtAmount(e.raw, e.decimals ?? 18)} ${e.symbol ?? 'tokens'} sent to ${short(e.to)}${e.pct !== null && e.pct !== undefined ? ` (${fmtPct(e.pct)}% of what it held)` : ''}`
      break
    case 'native-outflow':
      line = `⚠️ ${name}'s ${coinOf(m.chainId)} balance fell by ${fmtAmount(e.raw, 18)} ${coinOf(m.chainId)} (${fmtPct(e.pct)}%) since ${new Date(e.since).toISOString().slice(11, 16)} UTC`
      break
    default:
      line = `⚠️ Something changed on ${name}`
  }
  return `${line} · ${chain} · ${link}`
}

/* ------------------------------------------------------------- plan --- */

/** The monitors a workspace's plan covers: its oldest `plan.monitors`. */
function coveredIds(workspace) {
  const n = planOf(workspace).monitors ?? 0
  return new Set(db.monitors.filter((m) => m.workspace === workspace).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, n).map((m) => m.id))
}
function liveMonitors() {
  const covered = new Set()
  for (const ws of new Set(db.monitors.map((m) => m.workspace))) {
    if (getAccount(ws)?.blocked) continue
    for (const id of coveredIds(ws)) covered.add(id)
  }
  return db.monitors.filter((m) => m.enabled && covered.has(m.id))
}

/* ---------------------------------------------------------------- health --- */

// The loop's own health for the admin Health view: the last pass, how long it took, how late it is, and failures.
const health = { lastTickAt: null, lastTickMs: null, ticks: 0, errors: 0, lastError: null, lastErrorAt: null }
function noteTick(at, ms, failed) {
  health.lastTickAt = new Date(at).toISOString()
  health.lastTickMs = ms
  health.ticks++
  if (failed.length) {
    health.errors += failed.length
    health.lastError = String(failed[0].error ?? 'a chain could not be read').slice(0, 160)
    health.lastErrorAt = new Date(at).toISOString()
  }
}
/** { lastTickAt, lastTickMs, lagMs, ticks, errors, lastError, lastErrorAt }: lagMs is how far past its minute the next pass is (0 when on time), null before the first pass. */
export function monitorHealth(now = Date.now()) {
  const last = health.lastTickAt ? Date.parse(health.lastTickAt) : null
  return { ...health, lagMs: last === null ? null : Math.max(0, now - last - LOOP_MS) }
}

/* -------------------------------------------------------------- the pass --- */

let pass = 0
let running = null
const backoff = new Map() // chainId -> { until, failures }
const ranges = new Map() // chainId -> current range

/** One pass over every chain with a live monitor. Resolves to { chains: { [id]: { ok, from, to, events, error } } }. */
export function tickMonitorsNow({ now = Date.now() } = {}) {
  if (running) return running
  const t0 = Date.now()
  running = (async () => {
    pass++
    const live = liveMonitors()
    const byChain = new Map()
    for (const m of live) {
      if (!byChain.has(m.chainId)) byChain.set(m.chainId, [])
      byChain.get(m.chainId).push(m)
    }
    const out = {}
    await Promise.all(
      [...byChain].map(async ([chainId, list]) => {
        const b = backoff.get(chainId)
        if (b && b.until > now) return (out[chainId] = { ok: false, skipped: true, error: 'backing off after a failed read' })
        try {
          out[chainId] = await passChain(chainId, list, now)
          backoff.delete(chainId)
        } catch (e) {
          const failures = (b?.failures ?? 0) + 1
          backoff.set(chainId, { failures, until: now + Math.min(LOOP_MS * 2 ** (failures - 1), MAX_BACKOFF_MS) })
          const msg = String(e?.message ?? e).slice(0, 160)
          for (const m of list) m.lastError = { at: new Date(now).toISOString(), error: `Could not read ${CHAINS[chainId]?.name ?? chainId} just now; retrying.` }
          db.chains[chainId] = { ...(db.chains[chainId] ?? {}), lastError: msg, lastErrorAt: new Date(now).toISOString() }
          out[chainId] = { ok: false, error: msg }
        }
      }),
    )
    // Prune the sent keys.
    const cut = now - SENT_KEEP_MS
    for (const [k, at] of Object.entries(db.sent)) if (at < cut) delete db.sent[k]
    save()
    noteTick(now, Date.now() - t0, Object.values(out).filter((c) => c && c.ok === false && !c.skipped))
    return { pass, chains: out }
  })()
    .catch((e) => {
      noteTick(now, Date.now() - t0, [{ error: String(e?.message ?? e).slice(0, 160) }])
      throw e
    })
    .finally(() => (running = null))
  return running
}

async function passChain(chainId, list, now) {
  const head = num(await rpc(chainId, 'eth_blockNumber', []))
  if (head === null) throw new Error('unreadable block number')
  const safeHead = Math.max(0, head - (LAG[chainId] ?? 5))
  const cs = (db.chains[chainId] ??= { cursor: null })
  // A chain never read before starts at its head: nothing older is announced.
  if (cs.cursor === null || cs.cursor === undefined) cs.cursor = safeHead
  for (const m of list) if (m.startBlock === null || m.startBlock === undefined) m.startBlock = safeHead

  const found = new Map() // monitor id -> events
  const add = (m, e) => {
    if (!found.has(m.id)) found.set(m.id, [])
    found.get(m.id).push(e)
  }
  // Several workspaces may watch the same contract (or the same Safe): each gets its own events.
  const group = (keyOf) => {
    const map = new Map()
    for (const m of list) {
      const k = keyOf(m)
      if (!k) continue
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(m)
    }
    return map
  }
  const byAddr = group((m) => m.address)
  const bySafe = group((m) => m.state?.safe?.address ?? null)

  let from = cs.cursor + 1
  let calls = 0
  let range = ranges.get(chainId) ?? RANGE
  while (from <= safeHead && calls < MAX_RANGES_PER_PASS) {
    const to = Math.min(safeHead, from + range - 1)
    let logs
    try {
      logs = await rangeLogs(chainId, [...byAddr.keys()], [...bySafe.keys()], from, to)
    } catch (e) {
      if (!e?.nodeFault && /range|limit|too many|exceed|10000|block/i.test(String(e?.message)) && range > MIN_RANGE) {
        range = Math.max(MIN_RANGE, Math.floor(range / 2))
        ranges.set(chainId, range)
        continue
      }
      throw e
    }
    calls++
    for (const log of logs) {
      const e = decodeLog(log, chainId)
      if (!e) continue
      if (e.kind === 'outflow') {
        for (const m of byAddr.get(e.from) ?? []) if (e.blockNumber > m.startBlock) await judgeOutflow(m, e).then((x) => x && add(m, x))
        continue
      }
      if (e.kind.startsWith('safe-')) {
        for (const m of bySafe.get(e.emitter) ?? []) if (e.blockNumber > m.startBlock) add(m, safeEvent(m, { ...e }))
        continue
      }
      for (const m of byAddr.get(e.emitter) ?? []) if (e.blockNumber > m.startBlock) add(m, applyEvent(m, { ...e }))
    }
    cs.cursor = to
    from = to + 1
  }
  if (range < RANGE) ranges.set(chainId, Math.min(RANGE, range * 2)) // grow back slowly after a good pass

  // State reads: the coin balance and, less often, who controls it and which code it runs.
  for (const m of list) {
    m.passes = (m.passes ?? 0) + 1
    if (m.passes % NATIVE_EVERY === 1 || NATIVE_EVERY === 1) {
      const e = await nativeCheck(m, now)
      if (e) add(m, e)
    }
    if (m.passes % STATE_EVERY === 0) for (const e of await stateCheck(m)) add(m, e)
    m.lastCheckedAt = new Date(now).toISOString()
    m.lastError = null
  }
  cs.head = head
  cs.lastOkAt = new Date(now).toISOString()
  cs.lastError = null

  let total = 0
  for (const [id, events] of found) {
    const m = db.monitors.find((x) => x.id === id)
    if (!m) continue
    total += await announce(m, events, now)
  }
  return { ok: true, head, cursor: cs.cursor, events: total }
}

async function rangeLogs(chainId, contracts, safes, from, to) {
  const fromBlock = '0x' + from.toString(16)
  const toBlock = '0x' + to.toString(16)
  const out = []
  const watched = [...contracts, ...safes]
  for (let i = 0; i < watched.length; i += ADDR_CHUNK) {
    const chunk = watched.slice(i, i + ADDR_CHUNK)
    const logs = await rpc(chainId, 'eth_getLogs', [{ fromBlock, toBlock, address: chunk, topics: [[...CONTRACT_TOPICS, ...SAFE_TOPICS]] }])
    if (!Array.isArray(logs)) throw Object.assign(new Error('unreadable logs'), { nodeFault: true })
    out.push(...logs)
  }
  for (let i = 0; i < contracts.length; i += ADDR_CHUNK) {
    const chunk = contracts.slice(i, i + ADDR_CHUNK)
    const logs = await rpc(chainId, 'eth_getLogs', [{ fromBlock, toBlock, topics: [TOPICS.transfer, chunk.map(pad)] }])
    if (!Array.isArray(logs)) throw Object.assign(new Error('unreadable logs'), { nodeFault: true })
    out.push(...logs)
  }
  // Oldest first, so the stored state follows the chain's order.
  return out.sort((a, b) => num(a.blockNumber) - num(b.blockNumber) || num(a.logIndex) - num(b.logIndex))
}

/** Updates the monitor's known state from a log event and adds what the text needs. */
function applyEvent(m, e) {
  const s = (m.state ??= {})
  if (e.kind === 'owner-changed') s.owner = e.to
  if (e.kind === 'admin-changed') s.admin = e.to
  if (e.kind === 'upgraded') {
    e.prev = s.implementation && s.implementation !== e.to ? s.implementation : null
    s.implementation = e.to
  }
  if (e.kind === 'beacon-upgraded') s.beacon = e.to
  if (e.kind === 'paused') s.paused = true
  if (e.kind === 'unpaused') s.paused = false
  return e
}

function safeEvent(m, e) {
  const safe = m.state?.safe
  if (!safe) return e
  if (e.kind === 'safe-owner-added' && e.account && !safe.owners.includes(e.account)) safe.owners.push(e.account)
  if (e.kind === 'safe-owner-removed') safe.owners = safe.owners.filter((o) => o !== e.account)
  if (e.kind === 'safe-threshold-changed') {
    e.prev = safe.threshold !== e.threshold ? safe.threshold : null
    safe.threshold = e.threshold
  }
  e.owners = safe.owners.length
  if (e.kind !== 'safe-threshold-changed') e.threshold = safe.threshold
  return e
}

/** An outflow is reported when it is at least the monitor's % of what the contract held just before it. */
async function judgeOutflow(m, e) {
  const info = await tokenInfo(m.chainId, e.token)
  const after = await balanceOf(m.chainId, e.token, m.address).catch(() => null)
  const raw = BigInt(e.raw)
  if (raw === 0n) return null
  const pct = after === null ? null : Number((raw * 10_000n) / (raw + after)) / 100
  const threshold = m.thresholds?.pct ?? DEFAULT_PCT
  if (pct === null || pct < threshold) return null
  return { ...e, symbol: info.symbol, decimals: info.decimals, pct }
}

/** Native coin: a drop since the last reading of at least the % or the set amount. */
async function nativeCheck(m, now) {
  const out = await rpc(m.chainId, 'eth_getBalance', [m.address, 'latest'])
  if (!okHex(out)) return null
  const bal = BigInt(out === '0x' ? 0 : out)
  const prev = m.state?.native ? BigInt(m.state.native.raw) : null
  const since = m.state?.native?.at ?? null
  ;(m.state ??= {}).native = { raw: bal.toString(), at: new Date(now).toISOString() }
  if (prev === null || prev === 0n || bal >= prev) return null
  const drop = prev - bal
  const pct = Number((drop * 10_000n) / prev) / 100
  const abs = m.thresholds?.nativeRaw ? BigInt(m.thresholds.nativeRaw) : null
  if (pct < (m.thresholds?.pct ?? DEFAULT_PCT) && !(abs !== null && drop >= abs)) return null
  return { chainId: m.chainId, kind: 'native-outflow', raw: drop.toString(), pct, since, txHash: null, key: `${m.chainId}:${m.address}:native:${bal}:${since}` }
}

/** Re-reads who controls the contract and its code; a difference that no event announced becomes an event. */
async function stateCheck(m) {
  const now = await readControl(m.chainId, m.address)
  const s = (m.state ??= {})
  const out = []
  const k = (kind, v) => `${m.chainId}:${m.address}:${kind}:${v}`
  if (s.owner !== undefined && now.owner !== s.owner && (now.owner || s.owner)) out.push({ chainId: m.chainId, kind: 'owner-changed', from: s.owner ?? ZERO, to: now.owner ?? ZERO, txHash: null, key: k('owner', now.owner) })
  if (s.implementation !== undefined && now.implementation !== s.implementation && now.implementation) out.push({ chainId: m.chainId, kind: 'code-changed', from: s.implementation ?? ZERO, to: now.implementation, txHash: null, key: k('code', now.implementation) })
  if (s.admin !== undefined && now.admin !== s.admin && now.admin) out.push({ chainId: m.chainId, kind: 'admin-changed', from: s.admin ?? ZERO, to: now.admin, txHash: null, key: k('admin', now.admin) })
  const was = s.safe
  if (was && now.safe && was.address === now.safe.address && was.threshold !== now.safe.threshold) out.push({ chainId: m.chainId, kind: 'safe-threshold-changed', safe: now.safe.address, threshold: now.safe.threshold, prev: was.threshold, owners: now.safe.owners.length, txHash: null, key: k(`threshold:${now.safe.address}`, now.safe.threshold) })
  Object.assign(s, { owner: now.owner, implementation: now.implementation, admin: now.admin, beacon: now.beacon, safe: now.safe, readAt: new Date().toISOString() })
  return out
}

/** Records and delivers a monitor's new events. Each key is written to disk before it is sent: never twice. */
async function announce(m, events, now) {
  const fresh = []
  for (const e of events) {
    // Per monitor: two workspaces watching one contract are each told once.
    const sentKey = `${m.id}|${e.key}`
    if (db.sent[sentKey]) continue
    db.sent[sentKey] = now
    const text = eventText(e, m)
    const rec = { kind: e.kind, key: e.key, text, at: new Date(now).toISOString(), txHash: e.txHash ?? null, link: e.txHash ? txLink(m.chainId, e.txHash) : addrLink(m.chainId, m.address), blockNumber: e.blockNumber ?? null, privileged: PRIVILEGED.has(e.kind) }
    fresh.push({ e, rec })
  }
  if (!fresh.length) return 0
  m.events = [...(m.events ?? []), ...fresh.map((f) => f.rec)].slice(-KEEP_EVENTS)
  save()
  await deliver(m, fresh.map((f) => f.rec), false, now)
  for (const fn of listeners) {
    try {
      fn(m, fresh.map((f) => f.rec))
    } catch (err) {
      console.error('sec-monitor listener:', err?.message ?? err)
    }
  }
  return fresh.length
}

function payloadOf(m, recs, test, at) {
  return {
    id: `dlv_${randomToken(12)}`,
    type: test ? 'monitor.test' : 'monitor.alert',
    createdAt: new Date(at).toISOString(),
    monitor: { id: m.id, name: m.name || null, chainId: m.chainId, chain: CHAINS[m.chainId]?.name ?? null, address: m.address, score: `https://gullylabs.xyz/score/${CHAINS[m.chainId]?.key}/${m.address}` },
    events: recs.map((r) => ({ kind: r.kind, text: r.text, txHash: r.txHash, link: r.link, blockNumber: r.blockNumber, privileged: r.privileged, at: r.at })),
  }
}

async function deliver(m, recs, test, at = Date.now()) {
  const payload = payloadOf(m, recs, test, at)
  const results = []
  if (m.webhook) {
    const t0 = Date.now()
    const r = await sendWebhook(m.webhook.url, m.webhook.secret, JSON.stringify(payload))
    results.push({ channel: 'webhook', ok: !!r?.ok, status: r?.status ?? null, error: r?.error ?? null, ms: Date.now() - t0 })
  }
  const muted = !test && m.mutedUntil && Date.parse(m.mutedUntil) > at
  if (m.telegram && !muted) {
    const t0 = Date.now()
    const text = test ? `Test from Gully Security monitoring: alerts for ${m.name || short(m.address)} will arrive here.` : recs.map((r) => r.text).join('\n')
    // Open (the transaction, or the contract), Mute 24h and My monitors under every alert (telegram-ui.mjs).
    const keyboard = test ? null : monitorAlertKeyboard(m.id, recs.find((r) => r.link)?.link ?? addrLink(m.chainId, m.address))
    const r = await sendTelegram(m.workspace, text, { keyboard }).catch((e) => ({ ok: false, error: String(e?.message ?? e) }))
    results.push({ channel: 'telegram', ok: !!r?.ok, status: r?.status ?? null, error: r?.error ?? null, ms: Date.now() - t0 })
  }
  m.deliveries = [...(m.deliveries ?? []), ...results.map((r) => ({ id: payload.id, at: payload.createdAt, test, ...r, events: recs.length }))].slice(-KEEP_DELIVERIES)
  save()
  return { payload, results }
}

/* ------------------------------------------------------------ public reads --- */

/**
 * For the public Gully Score: what PUBLIC monitoring knows about a contract, or null when no workspace that lets
 * its monitor feed public scores (publicScore !== false) watches it. A private monitor's events, start date and
 * name never reach a public score page, the score index or the sitemap.
 */
export function monitorFacts(chainId, address) {
  const a = String(address).toLowerCase()
  const ms = db.monitors.filter((m) => m.chainId === chainId && m.address === a && m.publicScore !== false)
  if (!ms.length) return null
  const since = ms.map((m) => m.createdAt).sort()[0]
  const seen = new Map()
  for (const m of ms) for (const e of m.events ?? []) if (!seen.has(e.key)) seen.set(e.key, e)
  const events = [...seen.values()].sort((x, y) => x.at.localeCompare(y.at))
  const lastCheckedAt = ms.map((m) => m.lastCheckedAt).filter(Boolean).sort().pop() ?? null
  return { since, lastCheckedAt, events, listed: ms.some((m) => m.publicScore !== false), name: ms.find((m) => m.name)?.name ?? null }
}

/** Every contract some workspace watches and lets be listed on /score (no workspace is named). */
export const listedContracts = () => [...new Map(db.monitors.filter((m) => m.publicScore !== false).map((m) => [`${m.chainId}:${m.address}`, { chainId: m.chainId, address: m.address }])).values()]

/** The RPC cost of monitoring, worked out from the constants above (calls a minute). */
export function monitorLoad() {
  const contracts = liveMonitors()
  const chains = new Set(contracts.map((m) => m.chainId)).size
  const perChain = 1 + 2 // eth_blockNumber + 2 eth_getLogs (contract and Safe events; Transfer outflows)
  // native balance every NATIVE_EVERY passes; owner() + 5 slot reads + up to 2 Safe reads every STATE_EVERY passes.
  const perContract = 1 / NATIVE_EVERY + (1 + 5 + 2) / STATE_EVERY
  return { loopSeconds: LOOP_MS / 1000, perChainPerMin: perChain, perContractPerMin: Math.round(perContract * 100) / 100, chains, contracts: contracts.length, totalPerMin: Math.round((chains * perChain + contracts.length * perContract) * 10) / 10 }
}

/* ---------------------------------------------------------------- views --- */

function view(m, covered) {
  return {
    id: m.id,
    name: m.name || null,
    chainId: m.chainId,
    chain: CHAINS[m.chainId]?.name ?? String(m.chainId),
    chainKey: CHAINS[m.chainId]?.key ?? null,
    address: m.address,
    explorer: addrLink(m.chainId, m.address),
    score: `/score/${CHAINS[m.chainId]?.key}/${m.address}`,
    thresholds: { pct: m.thresholds?.pct ?? DEFAULT_PCT, native: m.thresholds?.native ?? null },
    webhook: m.webhook ? { url: m.webhook.url } : null,
    telegram: !!m.telegram,
    publicScore: m.publicScore !== false,
    enabled: m.enabled,
    mutedUntil: m.mutedUntil && Date.parse(m.mutedUntil) > Date.now() ? m.mutedUntil : null,
    coveredByPlan: covered.has(m.id),
    createdAt: m.createdAt,
    lastCheckedAt: m.lastCheckedAt ?? null,
    lastError: m.lastError?.error ?? null,
    control: m.state ? { owner: m.state.owner ?? null, implementation: m.state.implementation ?? null, admin: m.state.admin ?? null, safe: m.state.safe ? { address: m.state.safe.address, threshold: m.state.safe.threshold, owners: m.state.safe.owners.length } : null, paused: m.state.paused ?? null } : null,
    events: [...(m.events ?? [])].reverse().slice(0, 50),
    deliveries: [...(m.deliveries ?? [])].reverse().slice(0, 20),
  }
}

export function monitorsOf(workspace) {
  const plan = planOf(workspace)
  const covered = coveredIds(workspace)
  const mine = db.monitors.filter((m) => m.workspace === workspace)
  return {
    monitors: mine.map((m) => view(m, covered)).reverse(),
    limits: { plan: plan.id, planName: plan.name, max: plan.monitors ?? 0, used: mine.length },
    chains: monitorChains(),
    telegram: { enabled: telegramEnabled(), linked: !!linkedChat(workspace) },
    load: monitorLoad(),
    loopSeconds: LOOP_MS / 1000,
  }
}

/* -------------------------------------------------------------- handler --- */

const hits = new Map()
function allow(k, max, ms) {
  const now = Date.now()
  const list = (hits.get(k) ?? []).filter((t) => now - t < ms)
  if (list.length >= max) return false
  list.push(now)
  hits.set(k, list)
  return true
}

/** "5", "0.25", "1,000" -> wei as a string, or null. */
function coinToRaw(v) {
  const s = String(v ?? '').replace(/,/g, '').trim()
  if (!/^\d{1,12}(\.\d{1,18})?$/.test(s)) return null
  const [i, f = ''] = s.split('.')
  const raw = BigInt(i) * 10n ** 18n + BigInt((f + '0'.repeat(18)).slice(0, 18))
  return raw > 0n ? raw.toString() : null
}

/**
 * /api/developer/monitors* (developer.mjs has checked the session, CSRF and the role; ctx.workspace owns them).
 *   GET  /api/developer/monitors
 *   POST /api/developer/monitors        { chain, address, name?, pct?, native?, telegram?: true, webhookUrl?, publicScore? }
 *   POST /api/developer/monitors/:id/pause|resume|delete|test|rotate
 */
export async function handleMonitors(req, res, url, ctx) {
  const p = url.pathname
  const post = req.method === 'POST'
  const ws = ctx.workspace
  if (p === '/api/developer/monitors' && !post) return json(res, 200, monitorsOf(ws)), true
  if (!post) return json(res, 405, { error: 'POST only' }), true

  if (p === '/api/developer/monitors') {
    if (!allow(`mon:${ws}`, 20, 3_600_000)) return json(res, 429, { error: 'Too many contracts added in the last hour. Try again later.' }), true
    const body = await readJson(req, 4_000)
    const chain = chainOf(body?.chain)
    if (!chain) return json(res, 400, { error: `Pick a chain: ${monitorChains().map((c) => c.name).join(', ')}.` }), true
    const address = String(body?.address ?? '').trim().toLowerCase()
    if (!ADDR_RE.test(address) || address === ZERO) return json(res, 400, { error: 'Paste the contract address (0x followed by 40 letters and digits).' }), true
    const mine = db.monitors.filter((m) => m.workspace === ws)
    if (mine.some((m) => m.chainId === chain.id && m.address === address)) return json(res, 409, { error: 'This workspace already watches that contract.' }), true
    const plan = planOf(ws)
    if (mine.length >= (plan.monitors ?? 0)) return json(res, 403, { error: `The ${plan.name} plan watches ${plan.monitors} contract${plan.monitors === 1 ? '' : 's'}; you have ${mine.length}. Remove one or upgrade.`, code: 'plan-limit' }), true
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!NAME_RE.test(name)) return json(res, 400, { error: 'The name may hold up to 40 letters, digits, spaces and . _ - ( ).' }), true
    const pct = body?.pct === undefined || body?.pct === null || body?.pct === '' ? DEFAULT_PCT : Number(body.pct)
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) return json(res, 400, { error: 'The outflow share must be a percentage from 1 to 100.' }), true
    let nativeRaw = null
    if (body?.native !== undefined && body?.native !== null && body?.native !== '') {
      nativeRaw = coinToRaw(body.native)
      if (!nativeRaw) return json(res, 400, { error: `The ${coinOf(chain.id)} amount must be a positive number, like 5 or 0.25.` }), true
    }
    let webhook = null
    let secret = null
    if (body?.webhookUrl) {
      const form = checkWebhookForm(body.webhookUrl)
      if (!form.ok) return json(res, 400, { error: form.error }), true
      const target = await resolvePublic(form.url)
      if (!target.ok) return json(res, 400, { error: target.error }), true
      secret = `whsec_${randomToken(24)}`
      webhook = { url: form.url.toString(), secret }
    }
    let telegram = false
    if (body?.telegram === true) {
      if (!telegramEnabled()) return json(res, 400, { error: 'Telegram delivery is not available on this server.' }), true
      if (!linkedChat(ws)) return json(res, 400, { error: 'Connect Telegram first (Alerts tab), then tick Telegram.' }), true
      telegram = true
    }
    if (!webhook && !telegram) return json(res, 400, { error: 'Give a webhook URL, or tick Telegram, to deliver alerts to.' }), true
    // It must be a contract, and its starting state is read now (so the first change is a change, not news).
    let state
    try {
      if (!(await hasCode(chain.id, address))) return json(res, 400, { error: `There is no contract at that address on ${chain.name}. Check the chain.` }), true
      state = await readControl(chain.id, address)
      const bal = await rpc(chain.id, 'eth_getBalance', [address, 'latest'])
      if (okHex(bal)) state.native = { raw: BigInt(bal === '0x' ? 0 : bal).toString(), at: new Date().toISOString() }
    } catch {
      return json(res, 502, { error: `${chain.name} could not be read just now. Try again in a minute.` }), true
    }
    const m = {
      id: `mon_${randomToken(9)}`,
      workspace: ws,
      createdBy: ctx.user,
      chainId: chain.id,
      address,
      name,
      thresholds: { pct: Math.round(pct * 10) / 10, native: nativeRaw ? String(body.native).replace(/,/g, '').trim() : null, nativeRaw },
      webhook,
      telegram,
      publicScore: body?.publicScore !== false,
      enabled: true,
      createdAt: new Date().toISOString(),
      startBlock: db.chains[chain.id]?.cursor ?? null,
      state: { ...state, readAt: new Date().toISOString() },
      passes: 0,
      events: [],
      deliveries: [],
    }
    db.monitors.push(m)
    save()
    return json(res, 201, { monitor: view(m, coveredIds(ws)), secret }), true
  }

  const mm = p.match(/^\/api\/developer\/monitors\/(mon_[\w-]{12})\/(pause|resume|delete|test|rotate)$/)
  if (!mm) return json(res, 404, { error: 'not found' }), true
  const m = db.monitors.find((x) => x.id === mm[1] && x.workspace === ws)
  if (!m) return json(res, 404, { error: 'No such monitor in this workspace.' }), true
  if (mm[2] === 'delete') {
    db.monitors = db.monitors.filter((x) => x !== m)
    save()
    return json(res, 200, { ok: true }), true
  }
  if (mm[2] === 'pause' || mm[2] === 'resume') {
    m.enabled = mm[2] === 'resume'
    save()
    return json(res, 200, { monitor: view(m, coveredIds(ws)) }), true
  }
  if (mm[2] === 'rotate') {
    if (!m.webhook) return json(res, 409, { error: 'This monitor has no webhook.' }), true
    m.webhook.secret = `whsec_${randomToken(24)}`
    save()
    return json(res, 200, { monitor: view(m, coveredIds(ws)), secret: m.webhook.secret }), true
  }
  if (!allow(`montest:${m.id}`, 10, 3_600_000)) return json(res, 429, { error: 'Ten test deliveries an hour per monitor. Try again later.' }), true
  const { results } = await deliver(m, [], true)
  return json(res, 200, { results, monitor: view(m, coveredIds(ws)) }), true
}

/* ------------------------------------------------------------------ loop --- */

let timer = null
/** Starts the minute loop (server.mjs startLoops; never in standby). */
export function startSecMonitor() {
  if (timer || process.env.SEC_MONITOR_LOOP === 'off' || (process.env.TRACKER_LOOP === 'off' && process.env.SEC_MONITOR_LOOP !== 'on')) return
  const tick = () => tickMonitorsNow().catch((e) => console.error('sec-monitor:', e?.message ?? e))
  const first = setTimeout(tick, 20_000)
  first.unref?.()
  timer = setInterval(tick, LOOP_MS)
  timer.unref?.()
}

/** Mute a monitor's Telegram alerts for `ms` (the bot's Mute 24h). Its webhook still fires; events are still recorded. */
export function muteMonitor(id, workspace, ms) {
  const m = db.monitors.find((x) => x.id === id)
  if (!m || m.workspace !== workspace) return { ok: false, error: 'This monitor does not belong to the account linked to this chat.' }
  m.mutedUntil = new Date(Date.now() + ms).toISOString()
  save()
  return { ok: true, mutedUntil: m.mutedUntil }
}
/** Pause (false) or resume (true) a monitor, for the bot. */
export function setMonitorEnabled(id, workspace, enabled) {
  const m = db.monitors.find((x) => x.id === id)
  if (!m || m.workspace !== workspace) return { ok: false, error: 'This monitor does not belong to the account linked to this chat.' }
  m.enabled = !!enabled
  if (m.enabled) delete m.mutedUntil
  save()
  return { ok: true, enabled: m.enabled }
}

/** Admin overview counts. */
export const monitorStats = () => ({ monitors: db.monitors.length, live: liveMonitors().length, workspaces: new Set(db.monitors.map((m) => m.workspace)).size, chains: db.chains, load: monitorLoad() })
