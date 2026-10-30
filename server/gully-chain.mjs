// Gully Chain Testnet (485590): what the site reads from our own L3 beyond a plain RPC.
//
//   The indexer (indexer.gullychain.xyz, gully-ops/l3/indexer; GULLY_INDEXER overrides): launchpad tokens with
//   their curve state, graduation, pools, holders and trades; `.gully` names; the chain head. Everything here falls
//   back to the chain itself (eth_call on the launchpad, the LP locker, the name registry) when the indexer is down,
//   and says which source answered. The chain is read through payments.rpc (READ_CHAINS; GULLY_RPC_485590 overrides).
//
//   launchStatus(token)       Gully Launchpad launch: version, creator, curve progress, graduation, LP NFT in the locker
//   creatorHistory(creator)   how many tokens a creator launched here and how many graduated
//   gullyNames(addresses)     primary .gully names (indexer; reverse registrar + forward check over RPC as fallback)
//   tokenBehaviour(...)       what a token's code lets its owner do (mint, blacklist, fees, limits, trading switch) and a
//                             SIMULATED transfer from a real holder (eth_call with a state override) that measures a fee on
//                             transfer or a transfer that fails. Any EVM chain with a known holder; Gully finds its own.
//   ledgerFigures()           the home ledger's venue figures (test ETH, never dollars) and the daily volume series
//   chainHealth()             RPC head vs indexer head for the status page
//
// Addresses are gully-ops/l3/generated/*.json (launchpad.json, names.json, oracle.json, uniswap-v3.json), copied here
// by hand: this module never reads another repo at run time.

import { keccak_256 } from './vendor/noble.mjs'
import { rpc as payRpc } from './payments.mjs'
import { bytecodeNotes, tokenControls } from './security/bytecode.mjs'

const enc = new TextEncoder()
const hexOf = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('')
const keccak = (bytes) => hexOf(keccak_256(bytes))
export const selector = (sig) => '0x' + keccak(enc.encode(sig)).slice(0, 8)
const lower = (a) => String(a ?? '').toLowerCase()
const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)
const okHex = (x) => typeof x === 'string' && /^0x[0-9a-fA-F]*$/.test(x)
const word = (hex, i) => (okHex(hex) && hex.length >= 2 + 64 * (i + 1) ? BigInt('0x' + hex.slice(2 + 64 * i, 2 + 64 * (i + 1))) : null)
const addrWord = (hex, i) => {
  const w = word(hex, i)
  return w === null ? null : '0x' + w.toString(16).padStart(40, '0').slice(-40)
}
const padAddr = (a) => lower(a).replace(/^0x/, '').padStart(64, '0')
const padNum = (n) => BigInt(n).toString(16).padStart(64, '0')
const ZERO = '0x0000000000000000000000000000000000000000'

export const GULLY_CHAIN = {
  id: 485590,
  key: 'gully',
  name: 'Gully Chain Testnet',
  testnet: true,
  rpc: 'https://testnet-rpc.gullychain.xyz',
  explorer: 'https://testnet-explorer.gullychain.xyz',
  indexer: 'https://indexer.gullychain.xyz',
  site: 'https://gullychain.xyz',
  weth: '0x26acccb2e98ca9e067e58668aa3b101bef432754',
  positionManager: '0x90adce86fce80e9facd436efbb4c8a25d3d38f75',
  v3Factory: '0x1787a3ba8c8d7a2439cfa2efafc683ecac623950',
  swapRouter: '0x1283a251e34296675cc5130a2b02871384c0436a',
  v3Router: '0xf49b65b9912fd017fdb91d21ee9bc9992f8cf05c',
  /** Retired glUSD PSM (redeem only): it holds USDC.e reserves, so holder maps label it until its reserve is 0 */
  glusdPsm: '0xe1ae51036ede1b244c532a81fac196f19fa5e28e',
  /** USDC.e (Bridged USDC Standard, 6 decimals): the dollar on Gully Chain */
  usdc: '0x65ba03c6fa90ed549f465d4c8f2e784d6eeb7e76',
  names: { tld: 'gully', registry: '0xe0be69254ce3916a38b2d266f6a7325e62e96576', reverseRegistrar: '0xf9d030660e04bdbbc3f0818f7a1f4523bd5ba12f', publicResolver: '0x9e8328918d40e45fbd40d422c854c554d6b45d37' },
  /** RedStone adapters with Chainlink's AggregatorV3 shape (latestRoundData, 8 decimals). */
  oracle: { ethUsd: '0x732b8a31e19827b6c81db7a433fd120e302862c8', decimals: 8 },
}

/** Every Gully Launchpad deployment, newest first (launchpad.json `address` + `previous`). A token belongs to exactly one. */
export const LAUNCHPADS = [
  { version: '2.1.0', address: '0xce2c3ac523eff3bec8d3894f7e5c5f519638326b', locker: '0x272a78b26b289c50632dcb29270aa2a07daa5709', lockerVersion: '2.0.0', deployBlock: 100, launches: 'open' },
  { version: '2.0.0', address: '0x3378b659f6dda7f13d87599b383b3995f82d0974', locker: '0xbab80bf7ca383461e573dc503c70083c0415d58b', lockerVersion: '1.0.0', deployBlock: 61, launches: 'paused' },
  { version: '1.0.0', address: '0x89350b316cf592813fccb8719aa275e776501aca', locker: null, lockerVersion: null, deployBlock: 56, launches: 'retired' },
]
export const launchpadOf = (addr) => LAUNCHPADS.find((l) => l.address === lower(addr)) ?? null
export const isGullyChain = (chainId) => Number(chainId) === GULLY_CHAIN.id

export const SEL = {
  info: selector('info(address)'),
  lpTokenId: selector('lpTokenId(address)'),
  lpLocker: selector('lpLocker()'),
  ownerOf: selector('ownerOf(uint256)'),
  node: selector('node(address)'),
  resolver: selector('resolver(bytes32)'),
  name: selector('name(bytes32)'),
  addr: selector('addr(bytes32)'),
  balanceOf: selector('balanceOf(address)'),
  transfer: selector('transfer(address,uint256)'),
  decimals: selector('decimals()'),
  latestRoundData: selector('latestRoundData()'),
}

/* --------------------------------------------------------------- injectables --- */

let rpcFn = (chainId, method, params) => payRpc(chainId, method, params)
let fetchFn = (...a) => globalThis.fetch(...a)
let nowFn = () => Date.now()
export const setGullyRpcForTest = (fn) => (rpcFn = fn ?? ((chainId, method, params) => payRpc(chainId, method, params)))
export const setGullyFetchForTest = (fn) => (fetchFn = fn ?? ((...a) => globalThis.fetch(...a)))
export const setGullyNowForTest = (fn) => (nowFn = fn ?? (() => Date.now()))

const indexerBase = () => String(process.env.GULLY_INDEXER ?? GULLY_CHAIN.indexer).replace(/\/+$/, '')
const UA = 'gullylabs-site/1 (+https://gullylabs.xyz)'
const TTL = { token: 20_000, tokens: 60_000, names: 600_000, head: 10_000, fail: 15_000 }

const cache = new Map() // key -> { at, ttl, v } | { at, ttl, error }
const inflight = new Map()
export function resetGullyChainForTest() {
  cache.clear()
  inflight.clear()
}

/** GET <indexer><path> as JSON, cached for `ttl`. Resolves { status, body } (404 included); throws when unreachable. */
export async function indexerGet(path, ttl = TTL.token) {
  const key = `idx:${path}`
  const hit = cache.get(key)
  const now = nowFn()
  if (hit && now - hit.at < hit.ttl) {
    if (hit.error) throw new Error(hit.error)
    return hit.v
  }
  let p = inflight.get(key)
  if (!p) {
    p = (async () => {
      try {
        const r = await fetchFn(`${indexerBase()}${path}`, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(10_000) })
        const body = await r.json().catch(() => null)
        if (!r.ok && r.status !== 404) throw new Error(`indexer answered ${r.status}`)
        const v = { status: r.status, body }
        cache.set(key, { at: nowFn(), ttl, v })
        return v
      } catch (e) {
        const msg = `Gully Chain indexer: ${String(e?.name === 'TimeoutError' ? 'timed out' : (e?.message ?? e)).slice(0, 100)}`
        cache.set(key, { at: nowFn(), ttl: TTL.fail, error: msg })
        throw new Error(msg)
      } finally {
        inflight.delete(key)
      }
    })()
    inflight.set(key, p)
  }
  return p
}

const call = (to, data) => rpcFn(GULLY_CHAIN.id, 'eth_call', [{ to, data }, 'latest'])
/** eth_call that may revert: null on a revert or an empty answer. */
async function tryCall(to, data) {
  try {
    const out = await call(to, data)
    return okHex(out) && out.length > 2 ? out : null
  } catch {
    return null
  }
}

/* ----------------------------------------------------------------- launches --- */

/** Decodes GullyLaunchpad.info(token)'s Info struct (dynamic strings, so the tuple sits behind an offset). */
export function decodeInfo(hex) {
  if (!okHex(hex) || hex.length < 2 + 64 * 16) return null
  const off = Number(word(hex, 0))
  if (!Number.isSafeInteger(off) || off % 32 !== 0) return null
  const base = off / 32
  const w = (i) => word(hex, base + i)
  const a = (i) => addrWord(hex, base + i)
  const str = (i) => {
    const so = Number(w(i))
    if (!Number.isSafeInteger(so) || so % 32 !== 0) return null
    const at = base + so / 32
    const len = Number(word(hex, at))
    if (!Number.isSafeInteger(len) || len > 512) return null
    const start = 2 + 64 * (at + 1)
    if (hex.length < start + len * 2) return null
    return Buffer.from(hex.slice(start, start + len * 2), 'hex').toString('utf8').replace(/[^\p{L}\p{N}\p{P}\p{S} ]/gu, '').slice(0, 64)
  }
  const token = a(0)
  if (!token || token === ZERO) return null
  return {
    token,
    creator: a(1),
    name: str(2),
    symbol: str(3),
    metadataURI: str(4),
    createdAt: Number(w(5)),
    realEth: w(6),
    tokensSold: w(7),
    ethReserve: w(8),
    tokenReserve: w(9),
    priceE18: w(10),
    progressBps: Number(w(11)),
    complete: w(12) === 1n,
    graduated: w(13) === 1n,
    pool: a(14) === ZERO ? null : a(14),
  }
}

/** The LP position of a graduated launch: is the Uniswap v3 NFT held by the launchpad's GullyLPLocker? Read on chain. */
async function lpLockOf(lp, token) {
  const idOut = await tryCall(lp.address, SEL.lpTokenId + padAddr(token))
  const tokenId = idOut ? word(idOut, 0) : null
  if (!tokenId) return { locked: null, tokenId: null, locker: lp.locker, owner: null, reason: 'The launchpad has no LP position for this token yet.' }
  const lockerOut = await tryCall(lp.address, SEL.lpLocker)
  const locker = lockerOut ? addrWord(lockerOut, 0) : lp.locker
  const ownerOut = await tryCall(GULLY_CHAIN.positionManager, SEL.ownerOf + padNum(tokenId))
  const owner = ownerOut ? addrWord(ownerOut, 0) : null
  if (!owner) return { locked: null, tokenId: tokenId.toString(), locker, owner: null, reason: 'The LP position’s owner could not be read just now.' }
  return { locked: !!locker && owner === locker, tokenId: tokenId.toString(), locker, owner, reason: null }
}

/**
 * A Gully Launchpad launch, or null when the token was not launched there. Resolves undefined when neither the
 * indexer nor the chain could say. Shape: { venue: 'gully-launchpad', launchpad, version, creator, name, symbol,
 * createdAt (ISO|null), createdBlock, curve: { progressPct, complete, graduated }, pool, lp: { locked, tokenId, locker,
 * owner, reason } | null, source: 'indexer' | 'rpc' }.
 */
export async function launchStatus(tokenIn) {
  if (!isAddr(tokenIn)) return null
  const token = lower(tokenIn)
  let fromIndexer = null
  let indexerDown = false
  try {
    const r = await indexerGet(`/tokens/${token}`)
    if (r.status === 404 || !r.body?.token) fromIndexer = null
    else fromIndexer = r.body
  } catch {
    indexerDown = true
  }
  let out = null
  if (fromIndexer?.token?.source === 'launchpad' && isAddr(fromIndexer.token.launchpad)) {
    const t = fromIndexer.token
    const lp = launchpadOf(t.launchpad) ?? { address: lower(t.launchpad), version: String(t.launchpadVersion ?? '?'), locker: null }
    const g = fromIndexer.graduation ?? null
    out = {
      venue: 'gully-launchpad',
      launchpad: lp.address,
      version: lp.version,
      creator: isAddr(t.creator) ? lower(t.creator) : null,
      name: t.name ?? null,
      symbol: t.symbol ?? null,
      createdAt: Number(t.createdAt) > 0 ? new Date(Number(t.createdAt) * 1000).toISOString() : null,
      createdBlock: Number.isSafeInteger(Number(t.createdBlock)) ? Number(t.createdBlock) : null,
      totalSupply: /^\d+$/.test(String(t.totalSupply ?? '')) ? String(t.totalSupply) : null,
      curve: { progressPct: Number(t.progressPct) || 0, complete: !!t.complete, graduated: !!t.graduated },
      pool: isAddr(t.pool) ? lower(t.pool) : isAddr(g?.pool) ? lower(g.pool) : null,
      lp: null,
      source: 'indexer',
    }
  } else if (fromIndexer && fromIndexer.token?.source !== 'launchpad') return null
  if (!out) {
    // The indexer is down or does not know the token: ask each launchpad itself.
    let anyAnswer = false
    for (const lp of LAUNCHPADS) {
      let res
      try {
        res = await call(lp.address, SEL.info + padAddr(token))
      } catch (e) {
        // A revert is the launchpad saying "not mine"; anything else is a node that could not be reached.
        if (/revert/i.test(String(e?.message ?? e))) anyAnswer = true
        continue
      }
      anyAnswer = true
      if (!okHex(res) || res.length <= 2) continue
      const i = decodeInfo(res)
      if (!i || i.token !== token) continue
      out = {
        venue: 'gully-launchpad',
        launchpad: lp.address,
        version: lp.version,
        creator: i.creator && i.creator !== ZERO ? i.creator : null,
        name: i.name,
        symbol: i.symbol,
        createdAt: i.createdAt > 0 ? new Date(i.createdAt * 1000).toISOString() : null,
        createdBlock: null,
        totalSupply: null,
        curve: { progressPct: Math.round(i.progressBps) / 100, complete: i.complete, graduated: i.graduated },
        pool: i.pool,
        lp: null,
        source: 'rpc',
      }
      break
    }
    if (!out) return indexerDown && !anyAnswer ? undefined : null
  }
  if (out.curve.graduated) {
    const lp = launchpadOf(out.launchpad)
    out.lp = lp ? await lpLockOf(lp, token) : { locked: null, tokenId: null, locker: null, owner: null, reason: 'Unknown launchpad version.' }
  }
  return out
}

/** All launchpad tokens the indexer lists (cached a minute), or null when it cannot be read. */
export async function allLaunches() {
  try {
    const r = await indexerGet('/tokens', TTL.tokens)
    return Array.isArray(r.body?.tokens) ? r.body.tokens : null
  } catch {
    return null
  }
}

/**
 * A creator's record on the Gully Launchpad: { launches, graduated, onCurve, first (ISO|null), tokens: [{ address,
 * symbol, graduated, progressPct }] (newest 10) } or null when the indexer cannot be read.
 */
export async function creatorHistory(creatorIn) {
  if (!isAddr(creatorIn)) return null
  const creator = lower(creatorIn)
  const all = await allLaunches()
  if (!all) return null
  const mine = all.filter((t) => lower(t.creator) === creator && t.source === 'launchpad')
  const first = mine.map((t) => Number(t.createdAt)).filter((n) => n > 0).sort((a, b) => a - b)[0]
  return {
    launches: mine.length,
    graduated: mine.filter((t) => t.graduated).length,
    onCurve: mine.filter((t) => !t.graduated).length,
    first: first ? new Date(first * 1000).toISOString() : null,
    tokens: mine
      .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
      .slice(0, 10)
      .map((t) => ({ address: lower(t.address), symbol: t.symbol ?? null, graduated: !!t.graduated, progressPct: Number(t.progressPct) || 0 })),
  }
}

/** The largest plain-wallet holder of a Gully Chain token (indexer; not the launchpad, a pool or the locker), or null. */
export async function findHolder(tokenIn) {
  if (!isAddr(tokenIn)) return null
  try {
    const r = await indexerGet(`/tokens/${lower(tokenIn)}/holders?limit=12`)
    const rows = Array.isArray(r.body?.holders) ? r.body.holders : []
    const infra = new Set([...LAUNCHPADS.map((l) => l.address), ...LAUNCHPADS.map((l) => l.locker).filter(Boolean), GULLY_CHAIN.positionManager, GULLY_CHAIN.swapRouter, GULLY_CHAIN.v3Router, ZERO, '0x000000000000000000000000000000000000dead'])
    const h = rows.find((x) => !x.tag && isAddr(x.address) && !infra.has(lower(x.address)) && /^[1-9]\d*$/.test(String(x.balance ?? '')))
    return h ? lower(h.address) : null
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------- names --- */

/** ENS namehash of "alice.gully" (labels hashed right to left from the zero node). */
export function namehash(name) {
  let node = new Uint8Array(32)
  const labels = String(name ?? '').toLowerCase().split('.').filter(Boolean)
  for (let i = labels.length - 1; i >= 0; i--) {
    const lh = keccak_256(enc.encode(labels[i]))
    const buf = new Uint8Array(64)
    buf.set(node, 0)
    buf.set(lh, 32)
    node = keccak_256(buf)
  }
  return '0x' + hexOf(node)
}

const NAME_RE = /^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})*\.gully$/

function decodeAbiString(out) {
  if (!okHex(out) || out.length < 2 + 128) return null
  const off = Number(word(out, 0))
  if (!Number.isSafeInteger(off) || off % 32 !== 0) return null
  const at = off / 32
  const len = Number(word(out, at))
  if (!Number.isSafeInteger(len) || len <= 0 || len > 256) return null
  const start = 2 + 64 * (at + 1)
  return out.length >= start + len * 2 ? Buffer.from(out.slice(start, start + len * 2), 'hex').toString('utf8') : null
}

/** One address's primary .gully name over RPC: reverse record, then the forward record must point back. */
async function reverseNameRpc(addr) {
  const n = GULLY_CHAIN.names
  const nodeOut = await tryCall(n.reverseRegistrar, SEL.node + padAddr(addr))
  if (!nodeOut) return null
  const node = '0x' + nodeOut.slice(2, 66)
  const resOut = await tryCall(n.registry, SEL.resolver + node.slice(2))
  const resolver = resOut ? addrWord(resOut, 0) : null
  if (!resolver || resolver === ZERO) return null
  const name = decodeAbiString(await tryCall(resolver, SEL.name + node.slice(2)))?.toLowerCase() ?? null
  if (!name || !NAME_RE.test(name)) return null
  const fwdNode = namehash(name)
  const fwdResOut = await tryCall(n.registry, SEL.resolver + fwdNode.slice(2))
  const fwdResolver = fwdResOut ? addrWord(fwdResOut, 0) : null
  if (!fwdResolver || fwdResolver === ZERO) return null
  const addrOut = await tryCall(fwdResolver, SEL.addr + fwdNode.slice(2))
  return addrOut && addrWord(addrOut, 0) === lower(addr) ? name : null
}

/**
 * Primary .gully names for addresses: Map(lowercase address -> name). The indexer answers in one call (it verifies
 * the forward record like the app); when it is down, up to `rpcMax` addresses are resolved on chain instead.
 */
export async function gullyNames(addresses, { rpcMax = 12 } = {}) {
  const out = new Map()
  const want = [...new Set((addresses ?? []).filter(isAddr).map(lower))]
  if (!want.length) return out
  const missing = []
  for (const a of want) {
    const hit = cache.get(`name:${a}`)
    if (hit && nowFn() - hit.at < hit.ttl) {
      if (hit.v) out.set(a, hit.v)
    } else missing.push(a)
  }
  if (!missing.length) return out
  let indexerDown = false
  for (let i = 0; i < missing.length; i += 50) {
    const chunk = missing.slice(i, i + 50)
    try {
      const r = await indexerGet(`/names?addresses=${chunk.join(',')}`, TTL.names)
      const names = r.body?.names && typeof r.body.names === 'object' ? r.body.names : {}
      for (const a of chunk) {
        const v = typeof names[a] === 'string' && NAME_RE.test(names[a].toLowerCase()) ? names[a].toLowerCase() : null
        cache.set(`name:${a}`, { at: nowFn(), ttl: TTL.names, v })
        if (v) out.set(a, v)
      }
    } catch {
      indexerDown = true
      break
    }
  }
  if (indexerDown) {
    for (const a of missing.slice(0, rpcMax)) {
      const v = await reverseNameRpc(a).catch(() => null)
      cache.set(`name:${a}`, { at: nowFn(), ttl: v ? TTL.names : TTL.fail, v })
      if (v) out.set(a, v)
    }
  }
  return out
}

/* --------------------------------------------------------- token behaviour --- */

/* The transfer probe: runtime code placed AT THE HOLDER'S ADDRESS by an eth_call state override, so the token sees
   msg.sender == holder. Calldata: token, to, amount (three words). It reads balanceOf(to), calls transfer(to, amount),
   reads balanceOf(to) again and returns five words: before, the transfer's return word, call success, returndatasize,
   after. Nothing is sent or signed; the override lives only inside that one eth_call. */
const OPS = { STOP: 0x00, SHL: 0x1b, CALLDATALOAD: 0x35, POP: 0x50, MSTORE: 0x52, RETURNDATASIZE: 0x3d, GAS: 0x5a, PUSH1: 0x60, PUSH2: 0x61, PUSH4: 0x63, CALL: 0xf1, RETURN: 0xf3, STATICCALL: 0xfa }
function assemble(lines) {
  const bytes = []
  for (const line of lines) {
    const [op, arg] = line.trim().split(/\s+/)
    if (OPS[op] === undefined) throw new Error(`unknown opcode ${op}`)
    bytes.push(OPS[op])
    if (op.startsWith('PUSH')) {
      const n = Number(op.slice(4))
      const h = String(arg).replace(/^0x/, '').padStart(n * 2, '0')
      if (h.length !== n * 2) throw new Error(`${line}: needs ${n} bytes`)
      for (let i = 0; i < h.length; i += 2) bytes.push(parseInt(h.slice(i, i + 2), 16))
    }
  }
  return '0x' + hexOf(Uint8Array.from(bytes))
}
const balanceOfTo = (outAt) => [`PUSH4 ${SEL.balanceOf.slice(2)}`, 'PUSH1 e0', 'SHL', 'PUSH1 00', 'MSTORE', 'PUSH1 20', 'CALLDATALOAD', 'PUSH1 04', 'MSTORE', 'PUSH1 20', `PUSH2 ${outAt}`, 'PUSH1 24', 'PUSH1 00', 'PUSH1 00', 'CALLDATALOAD', 'GAS', 'STATICCALL', 'POP']
export const PROBE_CODE = assemble([
  ...balanceOfTo('0080'),
  `PUSH4 ${SEL.transfer.slice(2)}`, 'PUSH1 e0', 'SHL', 'PUSH1 00', 'MSTORE',
  'PUSH1 20', 'CALLDATALOAD', 'PUSH1 04', 'MSTORE',
  'PUSH1 40', 'CALLDATALOAD', 'PUSH1 24', 'MSTORE',
  'PUSH1 20', 'PUSH1 a0', 'PUSH1 44', 'PUSH1 00', 'PUSH1 00', 'PUSH1 00', 'CALLDATALOAD', 'GAS', 'CALL',
  'PUSH1 c0', 'MSTORE',
  'RETURNDATASIZE', 'PUSH1 e0', 'MSTORE',
  ...balanceOfTo('0100'),
  'PUSH1 a0', 'PUSH1 80', 'RETURN',
])
/** A fresh recipient with no code and no history (keccak("gully-transfer-probe")[12:]). */
export const PROBE_RECIPIENT = '0x' + keccak(enc.encode('gully-transfer-probe')).slice(24)

/**
 * Simulates `holder` sending a tenth of its balance of `token` to a fresh wallet on `chainId`, in one eth_call with a
 * state override (the probe code sits at the holder's address). Resolves
 *   { ok: true, sent, received, feePct, returnedFalse: false }       the transfer went through (fee measured)
 *   { ok: false, reverted: true | returnedFalse: true, sent }        the holder could not transfer
 *   { error }                                                        no balance, no override support or no node
 * Amounts are BigInt strings. Never sends anything.
 */
export async function simulateTransfer(chainId, tokenIn, holderIn) {
  if (!isAddr(tokenIn) || !isAddr(holderIn)) return { error: 'No holder to simulate from.' }
  const token = lower(tokenIn)
  const holder = lower(holderIn)
  let bal
  try {
    bal = word(await rpcFn(chainId, 'eth_call', [{ to: token, data: SEL.balanceOf + padAddr(holder) }, 'latest']), 0)
  } catch {
    return { error: 'The holder’s balance could not be read just now.' }
  }
  if (!bal || bal <= 0n) return { error: 'The holder has no balance to simulate with.' }
  const amount = bal >= 10n ? bal / 10n : bal
  let out
  try {
    out = await rpcFn(chainId, 'eth_call', [{ from: PROBE_RECIPIENT, to: holder, data: '0x' + padAddr(token) + padAddr(PROBE_RECIPIENT) + padNum(amount), gas: '0x4c4b40' }, 'latest', { [holder]: { code: PROBE_CODE } }])
  } catch (e) {
    return { error: `The simulation could not run on this node (${String(e?.message ?? e).slice(0, 80)}).` }
  }
  if (!okHex(out) || out.length < 2 + 64 * 5) return { error: 'The node does not support state overrides for eth_call, so the transfer was not simulated.' }
  const before = word(out, 0)
  const retWord = word(out, 1)
  const success = word(out, 2) === 1n
  const rds = word(out, 3)
  const after = word(out, 4)
  const returnedFalse = success && rds >= 32n && retWord === 0n
  if (!success) return { ok: false, reverted: true, returnedFalse: false, sent: amount.toString() }
  if (returnedFalse) return { ok: false, reverted: false, returnedFalse: true, sent: amount.toString() }
  const received = after - before
  const feePct = received >= amount ? 0 : Number(((amount - received) * 10000n) / amount) / 100
  return { ok: true, sent: amount.toString(), received: received.toString(), feePct: Math.max(0, feePct), returnedFalse: false }
}

/** Points for a token's behaviour: 100 less what its code lets an owner do and what the simulated transfer showed. */
export function behaviourPoints({ controls, sim, fixedSupply = false, delegatecall = false }) {
  let p = 100
  if (controls.mint.length && !fixedSupply) p -= 40
  if (controls.blacklist.length) p -= 30
  if (controls.fee.length) p -= 15
  if (controls.limits.length) p -= 10
  if (controls.trading.length) p -= 10
  if (delegatecall) p -= 10
  if (sim?.ok === false) p -= 60
  else if (sim?.ok && sim.feePct > 0) p -= Math.min(50, Math.round(sim.feePct * 3))
  return Math.max(0, Math.min(100, p))
}

/**
 * Token behaviour on any EVM chain, from the runtime code and a simulated transfer. `code` is the token's bytecode
 * (already read by the caller); `holder` an address with a balance (Gully Chain finds its own when absent).
 * Resolves { token: false } for a contract without transfer()/balanceOf(), else { token: true, score, value, reason,
 * controls, simulation, holder }.
 */
export async function tokenBehaviour({ chainId, address, code, holder = null, fixedSupply = false, name = null }) {
  const notes = bytecodeNotes(code ?? '')
  const sels = new Set(notes.selectors.map((s) => s.selector))
  if (!sels.has(SEL.transfer) || !sels.has(SEL.balanceOf)) return { token: false }
  const controls = tokenControls(notes)
  const delegatecall = (notes.opcodes.DELEGATECALL ?? 0) > 0 && !notes.minimalProxy
  let h = holder
  if (!h && isGullyChain(chainId)) h = await findHolder(address)
  const sim = h ? await simulateTransfer(chainId, address, h) : { error: 'No holder with a balance is known, so no transfer was simulated.' }
  const score = behaviourPoints({ controls, sim, fixedSupply, delegatecall })
  const what = []
  if (controls.mint.length) what.push(fixedSupply ? 'a mint function (fixed supply: the launchpad minted everything at launch)' : 'a mint function (the supply can grow)')
  if (controls.blacklist.length) what.push('blacklist functions (wallets can be stopped from trading)')
  if (controls.fee.length) what.push('fee or tax setters')
  if (controls.limits.length) what.push('adjustable transfer or wallet limits')
  if (controls.trading.length) what.push('a trading switch')
  if (delegatecall) what.push('DELEGATECALL (it runs other code)')
  const codePart = what.length ? `The code has ${what.join(', ')}.` : 'The code has no mint, blacklist, fee, limit or trading-switch functions.'
  let simPart
  let value
  if (sim.error) {
    simPart = sim.error
    value = what.length ? `${what.length} control${what.length === 1 ? '' : 's'} in the code` : 'Plain ERC-20'
  } else if (sim.ok === false) {
    simPart = `A simulated transfer from a real holder ${sim.reverted ? 'reverted' : 'returned false'}: holders may not be able to move it (a blacklist, a pause or a trading lock).`
    value = 'Transfer failed in simulation'
  } else if (sim.feePct > 0) {
    simPart = `A simulated transfer from a real holder arrived ${sim.feePct}% short: the token takes a fee on transfer.`
    value = `${sim.feePct}% fee on transfer`
  } else {
    simPart = 'A simulated transfer from a real holder arrived in full: no fee on transfer.'
    value = what.length ? `${what.length} control${what.length === 1 ? '' : 's'}, transfers in full` : 'Plain ERC-20, transfers in full'
  }
  return { token: true, score, value, reason: `${codePart} ${simPart}`, controls, simulation: sim, holder: h, name }
}

/* ------------------------------------------------------------ deploy block --- */

/** The first block with code at `address` (binary search on eth_getCode; the chain is our own archive node), or null. */
export async function deployBlock(address) {
  try {
    const head = Number(BigInt(await rpcFn(GULLY_CHAIN.id, 'eth_blockNumber', [])))
    const hasCode = async (n) => {
      const c = await rpcFn(GULLY_CHAIN.id, 'eth_getCode', [address, '0x' + n.toString(16)])
      return okHex(c) && c.length > 2
    }
    if (!(await hasCode(head))) return null
    let lo = 0
    let hi = head
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2)
      if (await hasCode(mid)) hi = mid
      else lo = mid + 1
    }
    return lo
  } catch {
    return null
  }
}

export async function blockTimeOf(n) {
  try {
    const b = await rpcFn(GULLY_CHAIN.id, 'eth_getBlockByNumber', ['0x' + Number(n).toString(16), false])
    const t = b?.timestamp ? Number(BigInt(b.timestamp)) : null
    return t ? new Date(t * 1000).toISOString() : null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ ledger --- */

const DAY = 86_400
const dayKey = (t) => Math.floor(t / DAY) * DAY

/**
 * The home ledger's figures for Gully Chain Testnet, read from the indexer: launches, graduations, holders, trades and
 * volume in TEST ETH (never valued in dollars: testnet ether has none). Throws when the indexer cannot be read.
 */
export async function ledgerFigures({ maxTokens = 40, days = 120 } = {}) {
  const [tok, head] = await Promise.all([indexerGet('/tokens', TTL.tokens), indexerGet('/head', TTL.head)])
  const tokens = Array.isArray(tok.body?.tokens) ? tok.body.tokens : []
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : 0)
  const sum = (f) => tokens.reduce((a, t) => a + num(f(t)), 0)
  const nowSec = Math.floor(nowFn() / 1000)
  const byDay = new Map()
  let allTime = 0
  const sample = tokens.slice(0, maxTokens)
  const candles = await Promise.allSettled(sample.map((t) => indexerGet(`/tokens/${lower(t.address)}/candles?tf=1d&limit=${days}`, TTL.tokens)))
  let charted = 0
  for (const c of candles) {
    if (c.status !== 'fulfilled' || !Array.isArray(c.value.body?.candles)) continue
    charted++
    for (const k of c.value.body.candles) {
      const t = dayKey(num(k.t))
      const v = num(k.v)
      byDay.set(t, (byDay.get(t) ?? 0) + v)
      allTime += v
    }
  }
  const daily = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }))
  const lastTrade = daily.filter((p) => p.v > 0).at(-1)
  const launched = tokens.map((t) => num(t.createdAt)).filter((n) => n > 0)
  return {
    head: { block: num(head.body?.block), at: num(head.body?.timestamp) ? new Date(num(head.body.timestamp) * 1000).toISOString() : null },
    native: {
      symbol: 'ETH',
      testnet: true,
      volume24h: sum((t) => t.win?.h24?.vol),
      volumeAll: allTime,
      volumeAllSince: launched.length ? new Date(Math.min(...launched) * 1000).toISOString() : null,
      liquidity: sum((t) => t.liquidityEth),
      mcap: sum((t) => t.mcapEth),
      daily,
      chartedTokens: charted,
    },
    counts: {
      launches: tokens.filter((t) => t.source === 'launchpad').length,
      launches24h: tokens.filter((t) => t.source === 'launchpad' && nowSec - num(t.createdAt) < DAY).length,
      graduated: tokens.filter((t) => t.graduated).length,
      onCurve: tokens.filter((t) => t.source === 'launchpad' && !t.graduated).length,
      pools: tokens.reduce((a, t) => a + (Array.isArray(t.pools) ? t.pools.length : 0), 0),
      holders: sum((t) => t.holders),
      swaps: sum((t) => t.txns),
      swaps24h: sum((t) => num(t.win?.h24?.buys) + num(t.win?.h24?.sells)),
      makers24h: sum((t) => t.win?.h24?.makers),
      tokens: tokens.length,
    },
    lastActivity: lastTrade ? new Date((lastTrade.t + DAY - 1) * 1000).toISOString() : null,
    readAt: new Date(nowFn()).toISOString(),
  }
}

/* ------------------------------------------------------------------ health --- */

/** RPC head and indexer head, for the status page: { rpc: { block, ms } | { error }, indexer: { block, at } | { error } }. */
export async function chainHealth() {
  const t0 = nowFn()
  const [r, i] = await Promise.allSettled([rpcFn(GULLY_CHAIN.id, 'eth_blockNumber', []), indexerGet('/head', TTL.head)])
  const rpcOut = r.status === 'fulfilled' && okHex(r.value) ? { block: Number(BigInt(r.value)), ms: nowFn() - t0 } : { error: String(r.reason?.message ?? r.reason ?? 'no answer').slice(0, 100) }
  const idx = i.status === 'fulfilled' && Number.isFinite(Number(i.value.body?.block)) ? { block: Number(i.value.body.block), at: Number(i.value.body.timestamp) ? new Date(Number(i.value.body.timestamp) * 1000).toISOString() : null } : { error: String(i.reason?.message ?? i.reason ?? 'no answer').slice(0, 100) }
  return { rpc: rpcOut, indexer: idx }
}
