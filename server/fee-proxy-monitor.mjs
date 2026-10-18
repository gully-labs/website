// Fee-proxy balance monitor. Request Network's fee proxies never hold funds: Gully Pay only ever calls
// transferFromWithReferenceAndFee, which moves tokens from the payer straight to the merchant and the treasury.
// A non-zero balance therefore means someone outside Gully sent tokens or coin straight to a proxy's address.
// The contracts have no owner and no sweep, so that money is lost for good; we cannot recover it. This loop makes
// it visible: every hour it reads, through payments.rpc (the same RPC failover as everything else), the USDC/USDT
// and native balance of every known proxy (fee-proxy-guard.mjs FEE_PROXY_REGISTRY, plus any testnet proxy in
// payments.FEE_PROXIES) on every Gully Pay EVM chain. A non-zero (or grown) balance raises an admin alert: the
// banner and "Fee proxy balances" card in the admin panel (GET /api/admin/overview -> feeProxy), and a Telegram
// message to TELEGRAM_ADMIN_CHAT_ID when one is set.
//
// Reads are cached for CACHE_MS, so a manual check or a restart inside the hour reuses them (no RPC spam): about
// 25 eth_call/eth_getBalance per hour in all. Started from server.mjs startLoops(), so it never runs in standby.
//
// Stored in DATA_DIR/fee-proxy-monitor.json: { checkedAt, chains, alerts } (alerts survive a restart, so the same
// balance is not announced twice).
//
// Env: GULLY_FEEPROXY_MONITOR_MS  interval (default 3600000; 0 = off)

import fs from 'node:fs'
import path from 'node:path'
import { FEE_PROXY_REGISTRY, isFeeProxy } from './fee-proxy-guard.mjs'
import { DATA_DIR } from './http.mjs'
import { ASSETS, CHAIN_LIST, FEE_PROXIES, fmtUnits, rpc } from './payments.mjs'

const FILE = path.join(DATA_DIR, 'fee-proxy-monitor.json')
export const DEFAULT_INTERVAL_MS = 3_600_000
/** A balance read younger than this is reused instead of asking the chain again. */
export const CACHE_MS = 50 * 60_000
const FIRST_CHECK_DELAY_MS = 60_000

export const MIS_SEND_TEXT =
  'This is a third-party mis-send: someone transferred funds straight to the fee proxy address. Gully Pay never sends funds there (its payments only pass through the proxy in one call). The contract has no owner, so these funds cannot be recovered by Gully Labs or anyone else. No action is possible; keep an eye out for a confused payer.'

let state = { checkedAt: null, chains: {}, alerts: [] }
try {
  const s = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  if (s && typeof s === 'object') state = { checkedAt: s.checkedAt ?? null, chains: s.chains ?? {}, alerts: Array.isArray(s.alerts) ? s.alerts : [] }
} catch {
  /* first run */
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(state))
    fs.renameSync(FILE + '.tmp', FILE)
  } catch (e) {
    console.error('fee-proxy monitor: save failed:', e?.message ?? e)
  }
}

/* ------------------------------------------------------------- targets --- */

/** What is watched: per EVM Gully Pay chain, each known proxy and the chain's coin and stablecoins. */
export function targets() {
  return CHAIN_LIST.map((c) => {
    const reg = FEE_PROXY_REGISTRY[c.id] ?? { erc20: [], native: [] }
    const proxies = new Map()
    for (const a of reg.erc20) proxies.set(a, 'ERC20FeeProxy')
    for (const a of reg.native) if (!proxies.has(a)) proxies.set(a, 'EthereumFeeProxy')
    if (FEE_PROXIES[c.id] && !proxies.has(FEE_PROXIES[c.id])) proxies.set(FEE_PROXIES[c.id], 'ERC20FeeProxy')
    const assets = ASSETS.filter((a) => a.chainId === c.id && (a.kind === 'native' || a.kind === 'token'))
    return { chainId: c.id, chain: c.name, explorer: c.explorer, proxies: [...proxies].map(([address, kind]) => ({ address, kind })), assets }
  })
}

/* --------------------------------------------------------------- reads --- */

const cache = new Map() // `${chainId}:${proxy}:${assetId}` -> { at, raw }
const BALANCE_OF = '0x70a08231'

/** Balance of `holder` in `asset` on its chain (BigInt), from the cache when fresh. */
async function balanceOf(asset, holder, now) {
  const key = `${asset.chainId}:${holder}:${asset.id}`
  const hit = cache.get(key)
  if (hit && now - hit.at < CACHE_MS) return hit.raw
  let out
  if (asset.kind === 'native') out = await rpc(asset.chainId, 'eth_getBalance', [holder, 'latest'])
  else out = await rpc(asset.chainId, 'eth_call', [{ to: asset.address, data: BALANCE_OF + holder.slice(2).padStart(64, '0') }, 'latest'])
  if (typeof out !== 'string' || !/^0x[0-9a-fA-F]*$/.test(out)) throw new Error('unreadable balance')
  const raw = out === '0x' ? 0n : BigInt(out.length > 66 ? '0x' + out.slice(2, 66) : out)
  cache.set(key, { at: now, raw })
  return raw
}

/* ------------------------------------------------------------- notify --- */

let notifier = async (text) => {
  const { sendAdminTelegram } = await import('./telegram.mjs')
  return sendAdminTelegram(text)
}
/** Tests: replace the Telegram send. fn(text) -> { ok, error }. */
export const setFeeProxyNotifierForTest = (fn) => (notifier = fn)
/** Tests: forget cached reads, or reset everything. */
export const clearFeeProxyCacheForTest = () => cache.clear()
export function resetFeeProxyMonitorForTest() {
  cache.clear()
  state = { checkedAt: null, chains: {}, alerts: [] }
}

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`

export function alertText(a) {
  return `Fee proxy balance: ${a.amount} ${a.symbol} sits in Request's ${a.kind} ${a.proxy} on ${a.chain} (${a.explorer}/address/${a.proxy}). ${MIS_SEND_TEXT}`
}

/* -------------------------------------------------------------- check --- */

let running = null

/** One pass over every chain, proxy and asset. Resolves to the view. */
export function checkFeeProxies({ now = Date.now() } = {}) {
  if (running) return running
  running = (async () => {
    const at = new Date(now).toISOString()
    const seen = new Set()
    await Promise.all(
      targets().map(async (t) => {
        const proxies = []
        let failed = 0
        for (const p of t.proxies) {
          const balances = []
          for (const a of t.assets) {
            try {
              const raw = await balanceOf(a, p.address, now)
              balances.push({ assetId: a.id, symbol: a.symbol, raw: raw.toString(), amount: fmtUnits(raw, a.decimals), error: null })
              const key = `${t.chainId}:${p.address}:${a.id}`
              if (raw > 0n) {
                seen.add(key)
                raise({ key, chainId: t.chainId, chain: t.chain, explorer: t.explorer, proxy: p.address, kind: p.kind, assetId: a.id, symbol: a.symbol, raw, amount: fmtUnits(raw, a.decimals), at })
              } else seen.add(`zero:${key}`)
            } catch (e) {
              failed++
              balances.push({ assetId: a.id, symbol: a.symbol, raw: null, amount: null, error: String(e?.message ?? e).slice(0, 160) })
            }
          }
          proxies.push({ address: p.address, kind: p.kind, balances })
        }
        state.chains[t.chainId] = { chainId: t.chainId, chain: t.chain, checkedAt: at, error: failed ? `${failed} balance read${failed === 1 ? '' : 's'} failed; retried next hour` : null, proxies }
      }),
    )
    // A balance read as zero again clears its alert (it cannot really happen: nobody can move it out).
    state.alerts = state.alerts.filter((x) => !seen.has(`zero:${x.key}`))
    state.checkedAt = at
    save()
    await notifyPending()
    return feeProxyView()
  })().finally(() => (running = null))
  return running
}

function raise(a) {
  const prev = state.alerts.find((x) => x.key === a.key)
  if (prev && prev.raw === a.raw.toString()) {
    prev.lastSeenAt = a.at
    return
  }
  const fresh = { key: a.key, chainId: a.chainId, chain: a.chain, explorer: a.explorer, proxy: a.proxy, kind: a.kind, assetId: a.assetId, symbol: a.symbol, raw: a.raw.toString(), amount: a.amount, firstSeenAt: prev?.firstSeenAt ?? a.at, lastSeenAt: a.at, changedAt: a.at, notified: null }
  if (prev) Object.assign(prev, fresh)
  else state.alerts.push(fresh)
  console.error(`fee-proxy monitor: ${alertText(fresh)}`)
}

/** Sends Telegram for every alert not yet announced at its current amount. */
async function notifyPending() {
  let changed = false
  for (const a of state.alerts) {
    if (a.notified && a.notified.raw === a.raw) continue
    let r
    try {
      r = await notifier(alertText(a))
    } catch (e) {
      r = { ok: false, error: String(e?.message ?? e) }
    }
    // Not configured is final for this amount (the banner is the alert); a failed send is retried next pass.
    const final = r?.ok || /not (set|configured)/i.test(String(r?.error ?? ''))
    if (final) a.notified = { raw: a.raw, at: new Date().toISOString(), telegram: !!r?.ok, error: r?.ok ? null : String(r?.error ?? '') }
    changed = true
  }
  if (changed) save()
}

/* --------------------------------------------------------------- view --- */

let timer = null
let intervalMs = DEFAULT_INTERVAL_MS
let nextCheckAt = null

/** What the admin panel shows. */
export function feeProxyView() {
  const t = String(process.env.GULLY_TREASURY_ADDRESS ?? '').trim()
  const config = isFeeProxy(t) ? ['GULLY_TREASURY_ADDRESS is a fee proxy contract: every checkout is refused until it is changed.'] : []
  return {
    running: !!timer,
    intervalMs,
    checkedAt: state.checkedAt,
    nextCheckAt,
    chains: targets().map((x) => state.chains[x.chainId] ?? { chainId: x.chainId, chain: x.chain, checkedAt: null, error: null, proxies: x.proxies.map((p) => ({ address: p.address, kind: p.kind, balances: [] })) }),
    alerts: state.alerts.map((a) => ({ ...a, short: short(a.proxy), message: alertText(a), telegram: a.notified?.telegram ?? false })),
    config,
    misSend: MIS_SEND_TEXT,
  }
}

/** Starts the hourly loop (server.mjs startLoops). */
export function startFeeProxyMonitor() {
  const env = process.env.GULLY_FEEPROXY_MONITOR_MS
  intervalMs = env === undefined || env === '' ? DEFAULT_INTERVAL_MS : Number(env)
  if (!Number.isFinite(intervalMs) || intervalMs <= 0 || timer) return
  intervalMs = Math.max(intervalMs, 60_000)
  const tick = () => {
    nextCheckAt = new Date(Date.now() + intervalMs).toISOString()
    checkFeeProxies().catch((e) => console.error('fee-proxy monitor:', e?.message ?? e))
  }
  const first = setTimeout(tick, FIRST_CHECK_DELAY_MS)
  first.unref?.()
  nextCheckAt = new Date(Date.now() + FIRST_CHECK_DELAY_MS).toISOString()
  timer = setInterval(tick, intervalMs)
  timer.unref?.()
  const t = String(process.env.GULLY_TREASURY_ADDRESS ?? '').trim()
  if (isFeeProxy(t)) console.error('fee-proxy monitor: GULLY_TREASURY_ADDRESS is a fee proxy contract; every checkout is refused until it is changed')
}
