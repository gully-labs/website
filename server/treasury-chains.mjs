// Treasury deployment gate. Gully Labs' treasury (GULLY_TREASURY_ADDRESS) is a Safe: the same address on every
// chain, but a Safe only exists on a chain where its proxy has been deployed. A payment sent to the address on a
// chain where nothing is deployed can be lost for good (nobody can sign for it there). So every EVM chain in
// payments.mjs is checked with eth_getCode(treasury) at startup and hourly (sooner while a read fails), and a
// chain where the treasury has no code is NOT offered: not in /api/plans, not in quotes, pay links, checkouts or
// QR codes, and the fee split (payments.withFeeSplit) is not applied there either. The admin panel lists every
// chain's state (GET /api/admin/billing -> treasury) and says what to do: deploy the Safe at the same address via
// app.safe.global, after which the chain switches on by itself at the next check (or POST /api/admin/treasury/check).
//
// What the treasury is:
//   - code on at least one chain (not an EIP-7702 delegation)  -> a contract (Safe); chains without code are closed
//   - readable on at least one chain and code nowhere          -> an EOA, usable on every chain
//   - nothing readable yet                                     -> unknown: nothing is closed on no evidence, but a
//                                                                 chain is only CLOSED on evidence, never opened on it
//   GULLY_TREASURY_KIND=contract|eoa pins the kind (a counterfactual Safe not deployed anywhere yet reads as an EOA,
//   so pin it to `contract` before any Safe is deployed).
// Per chain, a Safe treasury is offered only where code is present. A read that failed (`unknown`) keeps the chain
// closed for a contract treasury. Merchant stores are gated by the merchant's own wallet (merchants.inspectWallet,
// the same rule); only the fee split to our treasury depends on this module there.
//
// This module has no imports: payments.mjs reads the state, server.mjs starts the watch with payments' rpc.
//
// Env:
//   GULLY_TREASURY_CHECK_MS   interval between checks (default 3600000); 0 = no watch (every chain `unknown`)
//   GULLY_TREASURY_KIND       contract | eoa, pins what the treasury is (see above)

export const DEFAULT_INTERVAL_MS = 3_600_000
/** A chain whose read failed is tried again this soon. */
export const RETRY_MS = 5 * 60_000
export const SAFE_APP_URL = 'https://app.safe.global'

/** chainId -> { code: 'contract' | 'eoa-7702' | 'none' | 'unknown', checkedAt, error } */
let state = new Map()
let treasuryChecked = null // the address the state is about (lowercase)
let lastRun = null

const envKind = () => {
  const k = String(process.env.GULLY_TREASURY_KIND ?? '').trim().toLowerCase()
  return k === 'contract' || k === 'eoa' ? k : null
}

/** Records one eth_getCode answer (`null` when the read failed). */
export function recordTreasuryCode(chainId, code, error = null) {
  const id = Number(chainId)
  if (typeof code !== 'string' || !/^0x[0-9a-fA-F]*$/.test(code)) {
    const prev = state.get(id)
    // A failed read keeps what was known (code does not vanish); a chain never read stays unknown.
    state.set(id, { code: prev?.code ?? 'unknown', checkedAt: prev?.checkedAt ?? null, lastTriedAt: new Date().toISOString(), error: error ? String(error) : 'unreadable answer' })
    return
  }
  const has = code.length > 2
  const kind = !has ? 'none' : /^0xef0100[0-9a-fA-F]{40}$/i.test(code) ? 'eoa-7702' : 'contract'
  state.set(id, { code: kind, checkedAt: new Date().toISOString(), lastTriedAt: new Date().toISOString(), error: null })
}

/** 'contract' | 'eoa' | 'unknown': what the treasury is, from the env pin or the chains read so far. */
export function treasuryKind() {
  const pinned = envKind()
  if (pinned) return pinned
  const seen = [...state.values()].filter((s) => s.code !== 'unknown')
  if (seen.some((s) => s.code === 'contract')) return 'contract'
  return seen.length ? 'eoa' : 'unknown'
}

/**
 * Whether a payment to the treasury may be asked for on this chain. True for a deployed contract or an EOA
 * treasury; false where a contract treasury has no code or could not be read. Unknown everywhere = open.
 */
export function treasuryDeployedOn(chainId) {
  const s = state.get(Number(chainId))
  const kind = treasuryKind()
  if (s?.code === 'contract' || s?.code === 'eoa-7702') return true
  if (kind === 'contract') return false // no code here, or not readable: closed
  if (kind === 'eoa') return true // an EOA receives on every chain
  return true // nothing known yet: closed only on evidence
}

/** One chain's state for the admin panel. `chain` = { id, name }. */
export function treasuryChainState(chain) {
  const s = state.get(Number(chain.id)) ?? { code: 'unknown', checkedAt: null, lastTriedAt: null, error: null }
  const kind = treasuryKind()
  const offered = treasuryDeployedOn(chain.id)
  let status, message
  if (s.code === 'contract') (status = 'deployed'), (message = `Treasury contract deployed on ${chain.name}.`)
  else if (s.code === 'eoa-7702') (status = 'deployed'), (message = `Treasury is an EIP-7702 delegated wallet on ${chain.name}; it receives like a normal wallet.`)
  else if (s.code === 'none' && kind === 'contract') (status = 'missing'), (message = `Treasury not deployed on ${chain.name} — deploy the Safe at the same address via ${SAFE_APP_URL}, then it switches on by itself.`)
  else if (s.code === 'none') (status = 'eoa'), (message = `Treasury is a normal wallet (no contract) on ${chain.name}; it receives there.`)
  else if (kind === 'contract') (status = 'unknown'), (message = `${chain.name} could not be read${s.error ? ` (${s.error})` : ''}; the chain stays closed until the treasury contract is seen there.`)
  else (status = 'unknown'), (message = `${chain.name} has not been read yet${s.error ? ` (${s.error})` : ''}.`)
  return { chainId: chain.id, chain: chain.name, key: chain.key ?? null, status, offered, checkedAt: s.checkedAt, lastTriedAt: s.lastTriedAt ?? null, error: s.error ?? null, message }
}

/** The whole picture for the admin panel: kind, every chain, when it ran. `chains` = payments.CHAIN_LIST. */
export function treasuryStatus(chains, treasury) {
  return {
    treasury: treasury ?? treasuryChecked,
    kind: treasuryKind(),
    pinned: envKind(),
    checkedAt: lastRun,
    intervalMs: intervalMs(),
    safeApp: SAFE_APP_URL,
    chains: chains.map((c) => treasuryChainState(c)),
  }
}

export const intervalMs = () => {
  const v = process.env.GULLY_TREASURY_CHECK_MS
  if (v === undefined || v === '') return DEFAULT_INTERVAL_MS
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_INTERVAL_MS
}

/* --------------------------------------------------------------- watch --- */

let timer = null
let running = null

/**
 * Reads eth_getCode(treasury) on every chain (in parallel; a chain's failure does not stop the others).
 * `rpc(chainId, method, params)` is payments.rpc; `chains` = [{ id, name }] (EVM only); `treasury()` gives the
 * current address (lowercase) or null. A changed treasury address forgets the old state first.
 */
export async function checkTreasuryChains({ rpc, chains, treasury }) {
  if (running) return running
  running = (async () => {
    const t = typeof treasury === 'function' ? treasury() : treasury
    if (!t) {
      state = new Map()
      treasuryChecked = null
      lastRun = new Date().toISOString()
      return treasuryStatus(chains, null)
    }
    if (treasuryChecked && treasuryChecked !== t) state = new Map()
    treasuryChecked = t
    await Promise.all(
      chains.map(async (c) => {
        try {
          recordTreasuryCode(c.id, await rpc(c.id, 'eth_getCode', [t, 'latest']))
        } catch (e) {
          recordTreasuryCode(c.id, null, e?.message ?? e)
        }
      }),
    )
    lastRun = new Date().toISOString()
    return treasuryStatus(chains, t)
  })().finally(() => (running = null))
  return running
}

/** Chains whose last read failed or that were never read. */
const unresolved = (chains) => chains.filter((c) => (state.get(c.id)?.code ?? 'unknown') === 'unknown')

/**
 * Starts the watch: one check now, then every GULLY_TREASURY_CHECK_MS (default an hour), and RETRY_MS after a
 * pass that left a chain unread. The timers never keep the process alive. Returns a stop function.
 */
export function startTreasuryWatch({ rpc, chains, treasury, onPass = null }) {
  stopTreasuryWatch()
  const every = intervalMs()
  if (every === 0) return () => {}
  const pass = async () => {
    try {
      const view = await checkTreasuryChains({ rpc, chains, treasury })
      onPass?.(view)
      const closed = view.chains.filter((c) => !c.offered)
      if (closed.length) console.log(`treasury: not offered on ${closed.map((c) => `${c.chain} (${c.status})`).join(', ')}`)
    } catch (e) {
      console.error('treasury check:', e?.message ?? e)
    }
    const wait = unresolved(chains).length ? Math.min(RETRY_MS, every) : every
    timer = setTimeout(pass, wait)
    timer.unref?.()
  }
  pass()
  return stopTreasuryWatch
}

export function stopTreasuryWatch() {
  if (timer) clearTimeout(timer)
  timer = null
}

/** Tests: forget everything (and stop the watch). */
export function resetTreasuryStateForTest() {
  stopTreasuryWatch()
  state = new Map()
  treasuryChecked = null
  lastRun = null
}
