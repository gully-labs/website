// Holder Map intelligence on top of holders.mjs's map: the Launch Health score, the deployer's history,
// clusters seen in other launches, one wallet's trading on a launch, live updates, the "new launches,
// checked" feed, "most scanned today", the search resolver and the facts Gully AI is given.
//
// Every figure comes from DeepCore's API (account activity, launches, pools), the chain's Transfer logs or
// the map itself, with the time it was read. Where a part cannot be read it is left out and said so: the
// score is computed over the parts that are known (`counted` says how many points of weight that is).
//
// Launch Health (0-100, launches only; never gated):
//   liquidity  20  launch liquidity in DeepCore's launch lock (DeepCore's lock record for each pool)
//   bundle     20  share held now by wallets that bought together in the first block of trading
//   deployer   20  share held by the deployer and the wallets it funded
//   top10      15  share held by the 10 biggest wallets (pools, locks, burn and exchanges not counted)
//   snipers    10  wallets whose first buy came in the first blocks of trading
//   record     15  the deployer's earlier DeepCore launches: liquidity pulled or tokens sold by the deployer

import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './http.mjs'
import { readLaunches, shapePool } from './deepcore.mjs'
import { dcGet, decodeTransfer, evmRpc, findStock, HOLDER_CHAINS, readHolderMap, readLaunch, short, TRANSFER_TOPIC } from './holders.mjs'
import { isSolanaAddress } from './solana.mjs'

const lower = (a) => String(a ?? '').toLowerCase()
const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)
const round1 = (n) => Math.round(n * 10) / 10
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const pagePath = (chainKey, token) => `/holders/${chainKey}/${token}`
// holders.mjs and this module import each other: chain tables are read lazily, never at load.
const keyById = (id) => Object.entries(HOLDER_CHAINS).find(([, c]) => c.id === Number(id))?.[0] ?? String(id)
const fmt = (n) => (n === null || n === undefined ? '?' : n >= 10 ? `${Math.round(n)}%` : n >= 1 ? `${n.toFixed(1)}%` : n > 0 ? `${n < 0.1 ? '<0.1' : n.toFixed(1)}%` : '0%')

/* ---------------------------------------------------------- Launch Health --- */

export const HEALTH_WEIGHTS = { liquidity: 20, bundle: 20, deployer: 20, top10: 15, snipers: 10, record: 15 }
const clamp01 = (x) => Math.max(0, Math.min(1, x))

/** The score from a launch map (and its deployer history when read). Pure. */
export function launchHealth(map) {
  const f = map.forensics
  if (!f) return null
  const W = HEALTH_WEIGHTS
  const flagged = (fl) => map.nodes.filter((n) => n.flags.includes(fl)).map((n) => n.id)
  const parts = []
  const lock = f.liquidity?.locked
  parts.push({ id: 'liquidity', label: 'Liquidity locked', weight: W.liquidity, points: lock === true ? W.liquidity : lock === false ? 0 : null, value: lock === true ? 'Locked' : lock === false ? 'Not locked' : 'Not stated', reason: lock === true ? 'The launch liquidity sits in DeepCore’s launch lock, so it cannot simply be pulled.' : lock === false ? 'DeepCore shows no lock on the launch liquidity: it could be withdrawn.' : 'DeepCore does not say whether the liquidity is locked, so this part is left out.', wallets: f.liquidity?.locker ? [lower(f.liquidity.locker)] : [] })
  const b = f.bundled?.pct ?? 0
  parts.push({ id: 'bundle', label: 'First-block bundle', weight: W.bundle, points: Math.round(W.bundle * clamp01(1 - b / 30)), value: f.bundled.wallets ? `${plural(f.bundled.wallets, 'wallet')}, ${fmt(b)}` : 'None', reason: f.bundled.wallets ? `${plural(f.bundled.wallets, 'wallet')} bought together in the first block of trading and hold ${fmt(b)} now. 30% or more scores zero.` : 'No group of wallets bought together in the first block of trading.', wallets: flagged('bundled') })
  const d = (f.deployerPct ?? 0) + (f.funded?.pct ?? 0)
  parts.push({ id: 'deployer', label: 'Deployer and funded wallets', weight: W.deployer, points: Math.round(W.deployer * clamp01(1 - d / 20)), value: fmt(d), reason: `${f.funded?.wallets ? `The deployer and the ${plural(f.funded.wallets, 'wallet')} it sent tokens${f.funded.coinChecked ? ' or coins' : ''} to hold ${fmt(d)}` : `The deployer holds ${fmt(d)} and sent tokens to no other wallet we can see`}. 20% or more scores zero.${f.funded?.coinChecked ? '' : ' Coin funding was not checked on this chain.'}`, wallets: [...(f.deployer ? [f.deployer] : []), ...flagged('funded-by-deployer')] })
  const t = map.summary?.top10Pct ?? null
  parts.push({ id: 'top10', label: 'Top-10 concentration', weight: W.top10, points: t === null ? null : Math.round(W.top10 * clamp01(1 - Math.max(0, t - 20) / 60)), value: fmt(t), reason: t === null ? 'Unknown.' : `The 10 biggest wallets hold ${fmt(t)}. Up to 20% scores full points; 80% or more scores zero.`, wallets: map.nodes.filter((n) => !n.label || n.label.kind === 'deployer').slice(0, 10).map((n) => n.id) })
  const sn = f.snipers?.wallets ?? 0
  parts.push({ id: 'snipers', label: 'Snipers', weight: W.snipers, points: Math.round(W.snipers * clamp01(1 - sn / 10)), value: String(sn), reason: sn ? `${plural(sn, 'wallet')} bought in the first ${f.snipers.blocks} blocks of trading and hold ${fmt(f.snipers.pct)}. Ten or more scores zero.` : `Nobody bought in the first ${f.snipers?.blocks ?? 5} blocks of trading.`, wallets: flagged('sniper') })
  const h = map.deployerHistory
  let rec = { points: null, value: 'Not checked', reason: h?.reason ?? 'The deployer’s earlier launches could not be read.' }
  if (h?.checked) {
    const bad = h.launches.filter((l) => l.outcome === 'liquidity-pulled' || l.outcome === 'deployer-sold').length
    if (!h.total) rec = { points: null, value: 'First launch', reason: 'This is the first DeepCore launch we have seen from this deployer: no record either way, so this part is left out.' }
    else rec = { points: Math.round(W.record * clamp01(1 - bad / Math.max(1, Math.min(h.total, 3))) * (h.serial ? 0.6 : 1)), value: `${h.total} earlier${bad ? `, ${bad} bad` : ''}`, reason: `${h.total} earlier DeepCore ${h.total === 1 ? 'launch' : 'launches'} from this deployer${bad ? `; in ${bad} the liquidity was pulled or the deployer sold` : ', none with liquidity pulled or a deployer sell-off'}.${h.serial ? ' Serial launcher: three or more launches.' : ''}` }
  }
  parts.push({ id: 'record', label: 'Deployer track record', weight: W.record, ...rec, wallets: f.deployer ? [f.deployer] : [] })
  const known = parts.filter((p) => p.points !== null)
  const counted = known.reduce((s, p) => s + p.weight, 0)
  const score = counted >= 50 ? Math.round((100 * known.reduce((s, p) => s + p.points, 0)) / counted) : null
  const level = score === null ? null : score >= 75 ? 'good' : score >= 50 ? 'mixed' : 'poor'
  const verdict = score === null ? 'Not enough is known to score this launch yet.' : level === 'good' ? 'Few warning signs on the checks we can run.' : level === 'mixed' ? 'Some warning signs: read the parts below.' : 'Strong warning signs: read the parts below.'
  return { score, level, verdict, counted, parts }
}

/* -------------------------------------------------------- deployer history --- */

/** A launch's outcome from DeepCore's pool view and the deployer's own sells. */
async function launchOutcome(chainId, tokenAddr, sellsOfDeployer, supplyRaw) {
  const l = await readLaunch(chainId, tokenAddr)
  if (!l) return { outcome: 'unknown', note: 'Launch record unreadable.' }
  const poolId = l.legs?.[0]?.poolId ?? l.poolIds?.[0]
  let liquidity = null
  if (poolId) {
    const r = await dcGet(`/v1/chains/${chainId}/pools/${poolId}`)
    const raw = r.body?.data?.state?.activeLiquidityRaw
    if (r.ok && /^\d+$/.test(String(raw ?? ''))) liquidity = BigInt(raw)
  }
  const sold = supplyRaw > 0n ? Number((sellsOfDeployer * 10_000n) / supplyRaw) / 100 : null
  if (liquidity === 0n) return { outcome: 'liquidity-pulled', note: 'The pool has no active liquidity left.' }
  if (sold !== null && sold >= 2) return { outcome: 'deployer-sold', note: `The deployer sold ${fmt(sold)} of the supply.` }
  if (liquidity === null) return { outcome: 'unknown', note: 'The pool could not be read.' }
  return { outcome: 'trading', note: 'Liquidity is still in the pool.' }
}

/** One account's DeepCore activity (launches and swaps), newest first; null when unreadable. */
async function activity(address, limit = 100) {
  const r = await dcGet(`/v1/accounts/${address}/activity?limit=${limit}`)
  return r.ok && Array.isArray(r.body?.data?.items) ? r.body.data.items : null
}

/** The deployer's other DeepCore launches and how each ended. `max` bounds the outcome reads. */
export async function readDeployerHistory(chainId, deployer, token, { max = 3 } = {}) {
  const items = await activity(deployer)
  if (!items) return { checked: false, reason: 'DeepCore could not be read for the deployer’s other launches.', total: 0, serial: false, launches: [] }
  const launches = items.filter((i) => i.kind === 'launch' && isAddr(i.token?.address) && lower(i.token.address) !== lower(token))
  const sells = new Map()
  for (const i of items) if (i.kind === 'swap' && i.side === 'sell' && isAddr(i.launchToken?.address) && /^\d+$/.test(String(i.amountIn ?? ''))) sells.set(lower(i.launchToken.address), (sells.get(lower(i.launchToken.address)) ?? 0n) + BigInt(i.amountIn))
  const out = []
  for (const l of launches.slice(0, max)) {
    const ck = keyById(l.chainId)
    const supply = /^\d+$/.test(String(l.totalSupply ?? '')) ? BigInt(l.totalSupply) : 0n
    const o = await launchOutcome(l.chainId, lower(l.token.address), sells.get(lower(l.token.address)) ?? 0n, supply)
    out.push({ chainKey: ck, token: lower(l.token.address), symbol: l.token.symbol ?? null, createdAt: l.blockTimestamp ?? null, ...o, path: pagePath(ck, lower(l.token.address)) })
  }
  return { checked: true, reason: null, total: launches.length, serial: launches.length + 1 >= 3, launches: out, more: Math.max(0, launches.length - out.length) }
}

/* ------------------------------------------------------ cross-token clusters --- */

/** Other DeepCore launches the biggest cluster (or the bundled buyers) bought. */
export async function readCrossToken(map, { maxWallets = 6 } = {}) {
  const c = map.clusters?.[0]
  const wallets = c ? c.wallets.slice(0, maxWallets) : map.nodes.filter((n) => n.flags.includes('bundled')).slice(0, maxWallets).map((n) => n.id)
  if (!wallets.length) return null
  const tokens = new Map()
  let checked = 0
  for (const w of wallets) {
    const items = await activity(w, 100)
    if (!items) continue
    checked++
    const mine = new Set()
    for (const i of items) {
      const t = lower(i.launchToken?.address)
      if (i.kind !== 'swap' || i.side !== 'buy' || !isAddr(t) || t === lower(map.token.address) || mine.has(t)) continue
      mine.add(t)
      const ck = keyById(i.chainId)
      const e = tokens.get(t) ?? { chainKey: ck, token: t, symbol: i.launchToken.symbol ?? null, wallets: 0, path: pagePath(ck, t) }
      e.wallets++
      tokens.set(t, e)
    }
  }
  if (!checked) return null
  const list = [...tokens.values()].sort((a, b) => b.wallets - a.wallets).slice(0, 12)
  const who = c ? 'This cluster' : 'The bundled buyers'
  return { cluster: c?.id ?? null, checkedWallets: checked, tokens: list, line: list.length ? `${who} also bought ${list.length} other DeepCore ${list.length === 1 ? 'launch' : 'launches'}.` : `${who} bought no other DeepCore launch that we can see.` }
}

/** Adds the deployer history, cross-token clusters and the health score to a launch map (in place). */
export async function enrichLaunch(map, { chainId, launch, tier }) {
  if (!map.forensics || !launch?.creator) return map
  map.deployerHistory = await readDeployerHistory(chainId, lower(launch.creator), map.token.address, { max: tier === 'pro' ? 10 : 3 }).catch(() => null)
  map.crossToken = await readCrossToken(map).catch(() => null)
  map.health = launchHealth(map)
  if (map.health?.score !== null && map.health) map.summary.plain.unshift(`Launch Health ${map.health.score} out of 100: ${map.health.verdict}`)
  if (map.deployerHistory?.serial) map.summary.plain.push('The deployer is a serial launcher: three or more DeepCore launches.')
  if (map.crossToken?.tokens?.length) map.summary.plain.push(map.crossToken.line)
  return map
}

/* ------------------------------------------------------------- one wallet --- */

const walletCache = new Map()
/** One wallet's trading on a launch, from DeepCore's account activity: first buy, entry price and P&L. */
export async function readWalletDetail(chainKey, token, address) {
  const c = HOLDER_CHAINS[chainKey]
  if (chainKey === 'solana' || !isAddr(address)) return { state: 'unsupported', reason: 'Wallet details are read for DeepCore launches on EVM chains.' }
  const key = `${chainKey}:${lower(token)}:${lower(address)}`
  const hit = walletCache.get(key)
  if (hit && Date.now() - hit.at < 300_000) return hit.body
  const items = await activity(lower(address), 100)
  if (!items) return { state: 'error', reason: 'DeepCore could not be read just now.' }
  const mine = items.filter((i) => i.kind === 'swap' && lower(i.launchToken?.address) === lower(token) && i.chainId === c.id).reverse()
  const buys = mine.filter((i) => i.side === 'buy')
  const sells = mine.filter((i) => i.side === 'sell')
  const units = (raw, d) => (/^\d+$/.test(String(raw ?? '')) ? Number(BigInt(raw)) / 10 ** (d ?? 18) : null)
  const first = buys[0] ?? null
  let paid = 0
  let got = 0
  for (const b of buys) {
    paid += units(b.amountIn, b.tokenIn?.decimals) ?? 0
    got += units(b.amountOut, b.tokenOut?.decimals) ?? 0
  }
  const entryPrice = got > 0 ? paid / got : null
  let priceNow = null
  let quote = first?.tokenIn?.symbol ?? null
  const l = await readLaunch(c.id, lower(token))
  const poolId = l?.legs?.[0]?.poolId ?? l?.poolIds?.[0]
  if (poolId) {
    const r = await dcGet(`/v1/chains/${c.id}/pools/${poolId}`)
    // The launch token priced in the pool's quote coin (deepcore.mjs shapePool: the same reading Gully AI uses).
    const sp = r.ok && r.body?.data ? shapePool(r.body.data, lower(token)) : null
    if (sp?.priceInQuote > 0) priceNow = sp.priceInQuote
    quote ??= sp?.quote?.symbol ?? null
  }
  const others = [...new Set(items.filter((i) => i.kind === 'swap' && i.side === 'buy' && isAddr(i.launchToken?.address) && lower(i.launchToken.address) !== lower(token)).map((i) => `${i.chainId}|${lower(i.launchToken.address)}|${i.launchToken.symbol ?? ''}`))].slice(0, 8).map((k) => {
    const [cid, t, sym] = k.split('|')
    const ck = keyById(cid)
    return { chainKey: ck, token: t, symbol: sym || null, path: pagePath(ck, t) }
  })
  const body = {
    state: 'ok',
    firstBuy: first ? { at: first.blockTimestamp ?? null, block: Number(first.blockNumber) || null, tokens: units(first.amountOut, first.tokenOut?.decimals), paid: { amount: units(first.amountIn, first.tokenIn?.decimals), symbol: first.tokenIn?.symbol ?? null } } : null,
    buys: buys.length,
    sells: sells.length,
    entryPrice,
    priceNow,
    quote,
    pnlPct: entryPrice && priceNow ? round1((priceNow / entryPrice - 1) * 100) : null,
    otherLaunches: others,
    asOf: new Date().toISOString(),
    note: 'Swaps through DeepCore’s pools that this wallet signed, as DeepCore indexes them. Transfers in from other wallets are not buys.',
  }
  walletCache.set(key, { at: Date.now(), body })
  if (walletCache.size > 500) walletCache.delete(walletCache.keys().next().value)
  return body
}

/* ------------------------------------------------------------------ live --- */

const liveCache = new Map()
/**
 * Transfers since `since` (a block) for an open map: DeepCore's log index for launches, our RPCs for EVM
 * tokens. Shared per token for 10 s. Returns { state, cursor, transfers: [{ from, to, pct, block, at }], pcts }.
 */
export async function readLive(chainKey, tokenIn, sinceIn) {
  const map = await readHolderMap(chainKey, tokenIn, { tier: 'free' })
  if (map.state !== 'ok' || !map.live?.supported) return { state: 'unsupported', reason: 'Live updates are not available for this token.' }
  const since = Number.isInteger(sinceIn) && sinceIn > 0 ? sinceIn : map.live.cursor
  const key = `${chainKey}:${map.token.address}:${since}`
  const hit = liveCache.get(key)
  if (hit && Date.now() - hit.at < 10_000) return hit.body
  const c = HOLDER_CHAINS[chainKey]
  let logs = null
  let cursor = since
  if (map.kind === 'deepcore-launch') {
    const r = await dcGet(`/v1/chains/${c.id}/logs?address=${map.token.address}&topic0=${TRANSFER_TOPIC}&fromBlock=${since + 1}&toBlock=latest&limit=200`)
    if (r.ok && Array.isArray(r.body?.data?.logs)) {
      logs = r.body.data.logs
      cursor = Number(r.body.data.toBlock) || cursor
    }
  } else {
    try {
      const head = Number(BigInt(await evmRpc(chainKey, 'eth_blockNumber', [])))
      const from = Math.max(since + 1, head - 5_000)
      logs = await evmRpc(chainKey, 'eth_getLogs', [{ address: map.token.address, topics: [TRANSFER_TOPIC], fromBlock: '0x' + from.toString(16), toBlock: '0x' + head.toString(16) }])
      cursor = head
    } catch {
      logs = null
    }
  }
  if (!Array.isArray(logs)) return { state: 'error', reason: 'New transfers could not be read just now.', cursor: since }
  const supply = map.token.supply
  const dec = map.token.decimals
  const byId = new Map(map.nodes.map((n) => [n.id, n]))
  const delta = new Map()
  const transfers = []
  for (const l of logs.slice(-200)) {
    const t = decodeTransfer(l)
    if (!t) continue
    const u = Number(t.value) / 10 ** dec
    const pct = supply ? Math.round((u / supply) * 1_000_000) / 10_000 : null
    transfers.push({ from: t.from, to: t.to, pct, block: t.block, at: t.ts ? new Date(t.ts * 1000).toISOString() : null })
    if (pct !== null) {
      if (byId.has(t.from)) delta.set(t.from, (delta.get(t.from) ?? 0) - pct)
      if (byId.has(t.to)) delta.set(t.to, (delta.get(t.to) ?? 0) + pct)
    }
  }
  const pcts = Object.fromEntries([...delta].map(([a, d]) => [a, Math.max(0, Math.round(((byId.get(a).pct ?? 0) + d) * 100) / 100)]))
  const body = { state: 'ok', since, cursor, transfers, pcts, asOf: new Date().toISOString(), note: 'Shares move from the map’s last full read; the full map is rebuilt every five minutes.' }
  liveCache.set(key, { at: Date.now(), body })
  if (liveCache.size > 300) liveCache.delete(liveCache.keys().next().value)
  return body
}

/* ------------------------------------------------------- most scanned today --- */

const SCANS_FILE = () => path.join(process.env.DATA_DIR ?? DATA_DIR, 'holder-scans.json')
let scans = null
let scansDirty = false
function loadScans() {
  if (scans) return scans
  try {
    scans = JSON.parse(fs.readFileSync(SCANS_FILE(), 'utf8'))
  } catch {
    scans = {}
  }
  scans.day ??= new Date().toISOString().slice(0, 10)
  scans.items ??= {}
  return scans
}
/** Counts one view of a map (at most once per IP per token per day). */
export function recordScan(chainKey, token, symbol, kind, ip) {
  const s = loadScans()
  const day = new Date().toISOString().slice(0, 10)
  if (s.day !== day) {
    s.day = day
    s.items = {}
  }
  const k = `${chainKey}|${token}`
  const e = (s.items[k] ??= { chain: chainKey, token, symbol, kind, scans: 0, ips: [] })
  const tag = String(ip ?? '').slice(-12)
  if (e.ips.includes(tag)) return
  e.ips.push(tag)
  if (e.ips.length > 2000) e.ips.splice(0, e.ips.length - 2000)
  e.scans++
  e.symbol = symbol ?? e.symbol
  if (Object.keys(s.items).length > 2000) delete s.items[Object.keys(s.items)[0]]
  scansDirty = true
}
export function topScans(limit = 10) {
  const s = loadScans()
  return { day: s.day, items: Object.values(s.items).sort((a, b) => b.scans - a.scans).slice(0, limit).map((e) => ({ chain: e.chain, token: e.token, symbol: e.symbol, kind: e.kind, scans: e.scans, path: pagePath(e.chain, e.token) })) }
}
export function flushScans() {
  if (!scansDirty || !scans) return
  scansDirty = false
  try {
    fs.mkdirSync(path.dirname(SCANS_FILE()), { recursive: true })
    fs.writeFileSync(SCANS_FILE() + '.tmp', JSON.stringify({ day: scans.day, items: scans.items }))
    fs.renameSync(SCANS_FILE() + '.tmp', SCANS_FILE())
  } catch (e) {
    console.error('holder scans save:', e?.message ?? e)
  }
}
setInterval(flushScans, 60_000).unref?.()
export const resetScansForTest = () => {
  scans = { day: new Date().toISOString().slice(0, 10), items: {} }
}

/* ------------------------------------------------- new launches, checked --- */

/** The newest DeepCore launches with their health score; maps not built yet are started (a few per call). */
export async function readLaunchFeed({ limit = 12 } = {}) {
  const r = await readLaunches({ limit })
  let started = 0
  const launches = []
  for (const l of r.launches) {
    const ck = l.chainKey
    if (!HOLDER_CHAINS[ck]) continue
    const token = lower(l.token)
    const base = { chainKey: ck, chainName: l.chainName, token, symbol: l.symbol, createdAt: l.createdAt, path: pagePath(ck, token) }
    const peek = peekMap(ck, token)
    if (peek) {
      launches.push({ ...base, state: peek.state === 'ok' ? 'checked' : 'unavailable', health: peek.health ? { score: peek.health.score, level: peek.health.level, verdict: peek.health.verdict } : null, riskLine: peek.forensics?.riskLine ?? null })
      continue
    }
    if (started < 2) {
      started++
      readHolderMap(ck, token, { tier: 'free' }).catch(() => null)
    }
    launches.push({ ...base, state: 'checking', health: null, riskLine: null })
  }
  return { state: r.state, asOf: r.asOf, launches }
}
let peekMap = () => null
/** holders.mjs hands over its cache reader (no build, no upstream call). */
export const setMapPeek = (fn) => (peekMap = fn)

/* ---------------------------------------------------------------- search --- */

/** "$NVDA", "nvda", an address or a Solana mint: the maps that match. */
export async function resolveHolders(qIn) {
  const q = String(qIn ?? '').trim().replace(/^\$/, '')
  const out = []
  if (/^[A-Za-z.]{1,10}$/.test(q)) {
    for (const ck of ['robinhood', 'bsc', 'solana']) {
      const s = findStock(ck, q)
      if (s) out.push({ chain: ck, chainName: HOLDER_CHAINS[ck].name, token: s.ticker, symbol: s.ticker, name: s.name ?? null, kind: 'stock', path: pagePath(ck, s.ticker) })
    }
    const r = await readLaunches({ limit: 50 })
    for (const l of r.launches) if (String(l.symbol ?? '').toUpperCase() === q.toUpperCase() && HOLDER_CHAINS[l.chainKey]) out.push({ chain: l.chainKey, chainName: l.chainName, token: lower(l.token), symbol: l.symbol, kind: 'deepcore-launch', path: pagePath(l.chainKey, lower(l.token)) })
    return { matches: out }
  }
  if (isAddr(q)) {
    for (const ck of ['robinhood', 'bsc']) {
      const s = findStock(ck, q)
      if (s) out.push({ chain: ck, chainName: HOLDER_CHAINS[ck].name, token: s.ticker, symbol: s.ticker, kind: 'stock', path: pagePath(ck, s.ticker) })
    }
    if (!out.length) {
      const found = await Promise.all(['robinhood', 'bsc', 'base', 'hyperevm'].map(async (ck) => [ck, await readLaunch(HOLDER_CHAINS[ck].id, lower(q)).catch(() => undefined)]))
      for (const [ck, l] of found) if (l) out.push({ chain: ck, chainName: HOLDER_CHAINS[ck].name, token: lower(q), symbol: l.launchToken?.symbol ?? null, kind: 'deepcore-launch', path: pagePath(ck, lower(q)) })
    }
    return { matches: out }
  }
  if (isSolanaAddress(q)) {
    const s = findStock('solana', q)
    if (s) out.push({ chain: 'solana', chainName: 'Solana', token: s.ticker, symbol: s.symbol ?? s.ticker, kind: 'stock', path: pagePath('solana', s.ticker) })
    return { matches: out }
  }
  return { matches: [] }
}

/* ------------------------------------------------------------- Gully AI --- */

/** The computed facts of a map for Gully AI (no raw holder lists). */
export function holdersFacts(map) {
  if (map.state !== 'ok') return { state: map.state, reason: map.reason ?? null }
  return {
    token: `${map.token.symbol ?? short(map.token.address)} on ${map.chain.name}`,
    kind: map.kind === 'deepcore-launch' ? 'DeepCore launch' : 'tokenised stock',
    asOf: map.asOf,
    summary: map.summary.line,
    plain: map.summary.plain,
    holdersCount: map.holders.count,
    sharesOf: map.holders.sharesOf,
    clusters: map.clusters.slice(0, 5).map((c) => ({ wallets: c.count, pct: c.pct, includesDeployer: c.hasDeployer })),
    hiddenLinks: map.hidden?.length ?? 0,
    health: map.health ? { score: map.health.score, verdict: map.health.verdict, parts: map.health.parts.map((p) => ({ part: p.label, weight: p.weight, points: p.points, value: p.value, reason: p.reason })) } : null,
    forensics: map.forensics ? { riskLine: map.forensics.riskLine, bundled: map.forensics.bundled, snipers: map.forensics.snipers, deployerPct: map.forensics.deployerPct, funded: { wallets: map.forensics.funded.wallets, pct: map.forensics.funded.pct }, liquidityLocked: map.forensics.liquidity.locked } : null,
    deployerHistory: map.deployerHistory ? { total: map.deployerHistory.total, serial: map.deployerHistory.serial, outcomes: map.deployerHistory.launches.map((l) => `${l.symbol ?? short(l.token)}: ${l.outcome}`) } : null,
    otherLaunchesOfCluster: map.crossToken?.line ?? null,
    fairPrice: map.fair,
    sources: map.sources,
    page: `https://gullylabs.xyz/holders/${map.chain.key}/${map.token.address}`,
  }
}
