// DeepCore: RETIRED 2026-11-08 (owner: "retire deepcore"). Nothing here reads deepcore.fun or api.deepcore.fun any more:
// the launch poller, its store (DATA_DIR/deepcore.json), the "DeepCore new launch" alert kind, the router-quote proxy, the
// Gully AI tools and the Holder Map's DeepCore launch source are gone. The exports stay so every former caller degrades
// honestly (state 'retired', empty lists, 410 on the two public endpoints) instead of failing: alerts.mjs, status.mjs,
// admin.mjs, ask.mjs, gully-score.mjs, holders*.mjs and the Telegram modules import from here. The pure shaping helpers
// (units, toRaw, sig, shapePool, venueName, normaliseLaunch, deepcoreLinks) are kept because holders-intel.mjs and the
// tests still shape data with them. DeepCore's contracts remain credited (MIT) where the site documents Gully Core's lineage.
// Gully Core, Gully Labs' own launchpad and DEX core, is at https://gullycore.xyz (app.gullycore.xyz, docs.gullycore.xyz).

import fs from 'node:fs'
import path from 'node:path'
import { clientIp, DATA_DIR, json } from './http.mjs'
import { readTokenDecimals, stockByToken } from './tracker.mjs'

const API = () => String(process.env.DEEPCORE_API ?? 'https://api.deepcore.fun').replace(/\/+$/, '')
export const DEEPCORE_SITE = 'https://deepcore.fun'
export const RETIRED = "DeepCore integrations were retired on 2026-11-08. Gully Core is Gully Labs' own launchpad and DEX core: https://gullycore.xyz"
const gone = (res) => (json(res, 410, { error: 'gone', code: 'RETIRED', message: RETIRED, gullyCore: 'https://gullycore.xyz' }, { 'Cache-Control': 'public, max-age=3600' }), true)
const FILE = path.join(DATA_DIR, 'deepcore.json')
const UA = 'gullylabs/1 (+https://gullylabs.xyz)'
const TIMEOUT_MS = 12_000
const DATA_PER_MIN = 30
const QUOTE_PER_MIN = 15
const PER_IP_PER_MIN = 10
const ASK_PER_MIN = 12
const POOL_CACHE_MS = 60_000
const USD_CACHE_MS = 300_000
const MARKET_CACHE_MAX = 300
const QUOTE_CACHE_MS = 20_000
const KEEP_SEEN = 5_000
const KEEP_LAUNCHES = 50
export const NATIVE = '0x0000000000000000000000000000000000000000'

/** DeepCore's chains (GET /v1/chains): id, deepcore.fun's ?net= key, name, native coin. */
export const DEEPCORE_CHAINS = {} // retired 2026-11-08: no DeepCore chain is read any more
/** The tracker's chain keys to chain ids (the quote panel serves only these). */
const TRACKER_CHAIN_ID = { robinhood: 4663, bsc: 56 }

export const pollMs = () => {
  const n = Number(process.env.DEEPCORE_POLL_MS)
  return Number.isFinite(n) && n > 0 ? Math.min(120_000, Math.max(60_000, n)) : 90_000
}

/* ----------------------------------------------------------------- store --- */

let db = {} // retired: never read from or written to disk
db.seen ??= [] // launch keys "<chainId>:<token>", newest last
db.launches ??= [] // the last good read, normalised
db.baselineAt ??= null // when the first good read was recorded (no alerts for what existed then)
db.lastOkAt ??= null
db.lastError ??= null
db.chains ??= [] // per-chain status from the last good read
let seen = new Set(db.seen)

function save() {
  db.seen = [...seen].slice(-KEEP_SEEN)
  seen = new Set(db.seen)
  // retired: nothing is written
}

/* ---------------------------------------------------------------- budget --- */

const windows = { data: [], quote: [], ask: [] }
let blockedUntil = 0
/** Takes one call from a per-minute budget; false when it is spent or DeepCore asked us to wait. */
function take(kind, max) {
  const now = Date.now()
  if (now < blockedUntil) return false
  const w = (windows[kind] = windows[kind].filter((t) => now - t < 60_000))
  if (w.length >= max) return false
  w.push(now)
  return true
}

/** One GET to DeepCore. Returns { ok, status, body, error }; never throws. */
async function get() {
  return { ok: false, status: 410, body: null, error: RETIRED }
}

/* -------------------------------------------------------------- launches --- */

const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)
const isIso = (s) => typeof s === 'string' && Number.isFinite(Date.parse(s))

/** deepcore.fun pages for a token on a chain. */
export function deepcoreLinks(chainId, token) {
  const net = DEEPCORE_CHAINS[chainId]?.key
  const q = net ? `?net=${net}` : ''
  return {
    token: `${DEEPCORE_SITE}/tokens/${token}${q}`,
    launch: `${DEEPCORE_SITE}/app/launch/v2/${token}${q}`,
    swap: `${DEEPCORE_SITE}/app/swap${q ? q + '&' : '?'}in=${NATIVE}&out=${token}`,
  }
}

/**
 * One launch from GET /v1/launches (data.items[i]) in the shape the alerts and the bot use, or null
 * when the item does not carry what a launch must (chain, token, creation time).
 */
export function normaliseLaunch(it) {
  const chainId = Number(it?.chainId)
  const token = it?.token
  const createdAt = it?.createdAt?.blockTimestamp
  if (!Number.isInteger(chainId) || !isAddr(token) || !isIso(createdAt)) return null
  const chain = DEEPCORE_CHAINS[chainId]
  const legs = (Array.isArray(it.legs) ? it.legs : []).slice(0, 4).map((g) => ({
    poolId: typeof g?.poolId === 'string' ? g.poolId : null,
    kind: g?.kind === 'CL' || g?.kind === 'Bin' || g?.kind === 'BIN' ? (g.kind === 'CL' ? 'CL' : 'Bin') : null,
    quote: g?.quote?.symbol ? String(g.quote.symbol).slice(0, 16) : null,
    // Lock: only what the indexer says. "indexed" = a lock record exists for this leg; anything else is unknown.
    locked: g?.lock?.status === 'indexed' ? true : g?.lock === null ? false : null,
    lockId: g?.lock?.lockId != null ? String(g.lock.lockId).slice(0, 20) : null,
    feePct: Number.isFinite(Number(g?.launchFee?.feePips)) ? Number(g.launchFee.feePips) / 10_000 : null,
    quoteAddress: isAddr(g?.quote?.address) ? g.quote.address.toLowerCase() : null,
  }))
  return {
    key: `${chainId}:${token.toLowerCase()}`,
    chainId,
    chainKey: chain?.key ?? String(chainId),
    chainName: chain?.name ?? `Chain ${chainId}`,
    token,
    symbol: it?.launchToken?.symbol ? String(it.launchToken.symbol).slice(0, 24) : null,
    createdAt: new Date(createdAt).toISOString(),
    txHash: typeof it?.createdAt?.txHash === 'string' ? it.createdAt.txHash : null,
    creator: isAddr(it?.creator) ? it.creator : null,
    startsAt: isIso(it?.schedule?.startTimeIso) ? new Date(it.schedule.startTimeIso).toISOString() : null,
    // Whole tokens as DeepCore states them (decimal string), for market cap; null when not stated.
    totalSupply: /^\d+(\.\d+)?$/.test(String(it?.totalSupply?.units ?? '')) ? String(it.totalSupply.units) : null,
    legs,
    links: deepcoreLinks(chainId, token),
  }
}

const listeners = new Set()
/** Called after every poll with (newLaunches, at); newLaunches may be empty (pending alerts flush). */
export function onLaunches(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

let inflight = null
/** One poll of /v1/launches. Exported for tests (pollLaunchesNow). Returns { ok, fresh, error }. */
export function pollLaunchesNow() {
  return Promise.resolve({ ok: false, fresh: [], error: RETIRED })
}

async function pollOnce() {
  const at = Date.now()
  const r = await get(`/v1/launches?limit=${KEEP_LAUNCHES}`)
  const items = r.body?.data?.items
  const chains = r.body?.data?.chains
  if (!r.ok || !Array.isArray(items) || !Array.isArray(chains)) {
    db.lastError = { at: new Date(at).toISOString(), error: r.ok ? 'unexpected answer shape' : r.error }
    save()
    emit([], at)
    return { ok: false, fresh: [], error: db.lastError.error }
  }
  const launches = items.map(normaliseLaunch).filter(Boolean)
  db.chains = chains.map((c) => ({ chainId: Number(c?.chainId), name: DEEPCORE_CHAINS[Number(c?.chainId)]?.name ?? `Chain ${c?.chainId}`, status: c?.status === 'ok' ? 'ok' : 'unreadable', total: Number.isFinite(Number(c?.total)) && c?.status === 'ok' ? Number(c.total) : null }))
  const baseline = db.baselineAt === null
  const fresh = []
  // Oldest first, so alerts go out in launch order.
  for (const l of [...launches].reverse()) {
    if (seen.has(l.key)) continue
    seen.add(l.key)
    if (!baseline) fresh.push(l)
  }
  if (baseline) db.baselineAt = new Date(at).toISOString()
  db.launches = launches
  db.lastOkAt = new Date(at).toISOString()
  db.lastError = null
  save()
  emit(fresh, at)
  return { ok: true, fresh, error: null }
}

function emit(fresh, at) {
  for (const fn of listeners) {
    try {
      Promise.resolve(fn(fresh, at)).catch((e) => console.error('deepcore listener:', e?.message ?? e))
    } catch (e) {
      console.error('deepcore listener:', e?.message ?? e)
    }
  }
}

/**
 * The latest launches for the bot: { state: 'ok' | 'stale' | 'unreadable', launches, asOf, chains, error }.
 * Reads the cache; when it is older than one poll, polls once first (within the budget).
 */
export async function readLaunches() {
  return { state: 'retired', launches: [], asOf: null, chains: [], error: RETIRED }
}

/**
 * GET /api/deepcore/launches?chain=<chainId>&limit=<1..50>: the poller's cached launch list for the app
 * dashboard's DeepCore view and the site's launch list (with Holder Maps), { state: 'ok' | 'stale' | 'unreadable', launches, asOf, chains, error }.
 * Reads the same cache as the bot (readLaunches): no extra upstream call while the cache is fresh.
 */
export async function handleDeepcoreLaunches(req, res) {
  return gone(res)
}

/** For alerts: the chains a launch alert may be limited to. */
export const deepcoreAlertChains = () => Object.entries(DEEPCORE_CHAINS).map(([id, c]) => ({ chainId: Number(id), name: c.name }))

/** Admin/health: the poller's state. */
export const deepcoreHealth = () => ({ retired: true, lastOkAt: null, lastError: null, baselineAt: null, seen: 0, cached: 0 })

let timer = null
/** Starts the background poll (off with DEEPCORE_LOOP=off). */
export function startDeepcore() {
  // retired: no background poll
}

/** Test hook: forget everything (seen keys, cache, baseline) as on a first start. */
export function resetDeepcoreForTest() {
  seen = new Set()
  db = { seen: [], launches: [], baselineAt: null, lastOkAt: null, lastError: null, chains: [] }
  windows.data = []
  windows.quote = []
  windows.ask = []
  blockedUntil = 0
  quoteCache.clear()
  marketCache.clear()
  ipHits.clear()
}

/* ----------------------------------------------------------------- quote --- */

const VENUE = { UNISWAP_V2: 'Uniswap v2', UNISWAP_V3: 'Uniswap v3', UNISWAP_V4: 'Uniswap v4', PANCAKESWAP_V2: 'PancakeSwap v2', PANCAKESWAP_V3: 'PancakeSwap v3', PANCAKESWAP_INFINITY_CL: 'PancakeSwap Infinity', RAMSES_CL: 'Ramses CL', DEEPCORE_INFINITY_CL: 'DeepCore CL', DEEPCORE_INFINITY_BIN: 'DeepCore Bin', SUSHISWAP_V3: 'SushiSwap v3' }
export const venueName = (s) => VENUE[s] ?? String(s ?? '?').toLowerCase().split('_').map((w) => (/^v\d$|^cl$/.test(w) ? w.toUpperCase().replace(/^V/, 'v') : w[0]?.toUpperCase() + w.slice(1))).join(' ')
const isDeepcoreVenue = (s) => /^DEEPCORE/i.test(String(s ?? ''))

/** Symbols of the route's intermediate tokens we know; anything else is shown by address. */
const KNOWN = {
  4663: { '0x0bd7d308f8e1639fab988df18a8011f41eacad73': 'WETH', '0x5fc5360d0400a0fd4f2af552add042d716f1d168': 'USDG' },
  56: { '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': 'WBNB', '0x55d398326f99059ff775485246999027b3197955': 'USDT', '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 'USDC' },
}
function symbolOf(chainKey, chainId, a) {
  const k = String(a ?? '').toLowerCase()
  if (k === NATIVE) return DEEPCORE_CHAINS[chainId]?.native ?? 'native'
  return KNOWN[chainId]?.[k] ?? stockByToken(chainKey, k)?.ticker ?? (isAddr(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : '?')
}

/** A raw integer string as a decimal string with `d` decimals, trimmed (no float rounding). */
export function units(raw, d) {
  const s = String(raw ?? '')
  if (!/^\d+$/.test(s)) return null
  const p = s.padStart(d + 1, '0')
  const whole = p.slice(0, p.length - d)
  const frac = d ? p.slice(p.length - d).replace(/0+$/, '') : ''
  return frac ? `${whole}.${frac}` : whole
}

/** A decimal amount string to a raw integer string with `d` decimals, or null. Rounded to 4 significant digits. */
export function toRaw(amount, d) {
  const s = String(amount ?? '').trim()
  if (!/^\d{1,9}(\.\d{1,18})?$/.test(s)) return null
  const n = Number(s)
  if (!(n > 0)) return null
  const text = n.toLocaleString('en-US', { useGrouping: false, maximumSignificantDigits: 4 })
  const [w, f = ''] = text.split('.')
  const raw = (w + f.padEnd(d, '0').slice(0, d)).replace(/^0+(?=\d)/, '')
  return /^0*$/.test(raw) ? null : { raw, amount: text }
}

let readDecimals = readTokenDecimals
/** Test hook: replace the on-chain decimals() read. */
export function setDecimalsReaderForTest(fn) {
  readDecimals = fn
}

const quoteCache = new Map() // key -> { at, body, status } or { at, promise }
const ipHits = new Map()
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of quoteCache) if (now - v.at > QUOTE_CACHE_MS * 3) quoteCache.delete(k)
  for (const [k, v] of ipHits) if (!v.some((t) => now - t < 60_000)) ipHits.delete(k)
}, 60_000).unref?.()

/** Shapes DeepCore's quote answer (data) for the page. Exported for the tests. */
export function shapeQuote(d, { chainKey, chainId, stock, amount, decimalsOut }) {
  const route = d.route ?? {}
  const legs = Array.isArray(route.legs) ? route.legs : []
  const venues = [...new Set(legs.map((l) => venueName(l?.source)).concat(route.source && !legs.length ? [venueName(route.source)] : []))]
  const hops = legs.flatMap((l) => (Array.isArray(l?.hops) ? l.hops : []).map((h) => ({ venue: venueName(l.source), kind: h?.kind ?? null, from: symbolOf(chainKey, chainId, h?.tokenIn), to: symbolOf(chainKey, chainId, h?.tokenOut), pool: h?.pool ?? h?.pair ?? null, shareBps: Number(l?.shareBps) || null })))
  const fee = d.protocolFee ?? null
  const native = DEEPCORE_CHAINS[chainId].native
  const onDeepcore = legs.length > 0 && legs.every((l) => isDeepcoreVenue(l?.source))
  return {
    comparisonOnly: true,
    source: 'api.deepcore.fun',
    chain: chainKey,
    chainId,
    ticker: stock.ticker,
    token: stock.token,
    pay: { symbol: native, address: NATIVE, decimals: 18, amount, raw: String(d.amountIn ?? '') },
    out: { symbol: stock.ticker, decimals: decimalsOut, amount: units(d.amountOut, decimalsOut), minimum: units(d.minAmountOut, decimalsOut), raw: String(d.amountOut ?? '') },
    priceImpactPct: Number.isFinite(Number(d.priceImpactBps)) ? Number(d.priceImpactBps) / 100 : null,
    slippagePct: Number.isFinite(Number(d.slippageBps)) ? Number(d.slippageBps) / 100 : null,
    fee: fee ? { pct: Number(fee.bps) / 100, amount: units(fee.amount, 18), symbol: native, exempt: !!fee.exempt, readFrom: fee.readFrom ?? null } : null,
    onDeepcorePool: onDeepcore,
    route: { execution: route.execution ?? null, venues, hops },
    alternatives: (Array.isArray(d.alternatives) ? d.alternatives : []).slice(0, 3).map((a) => ({ venue: venueName(a?.source), out: units(a?.amountOut, decimalsOut) })),
    quotedAt: Number.isFinite(Number(d.quotedAt)) ? new Date(Number(d.quotedAt) * 1000).toISOString() : null,
    expiresAt: Number.isFinite(Number(d.expiresAt)) ? new Date(Number(d.expiresAt) * 1000).toISOString() : null,
    blockNumber: d.blockNumber ?? null,
    links: deepcoreLinks(chainId, stock.token),
  }
}

/**
 * GET /api/deepcore/quote?chain=robinhood&token=0x…&amount=0.1
 * Same-chain quote, native coin in, the stock token out. Answers { quote } or { error, code }.
 */
export async function handleDeepcoreQuote(req, res) {
  return gone(res)
}

/* ---------------------------------------------------------------- market --- */

const DOLLAR_STABLES = new Set(['USDC', 'USDT', 'USDG', 'USD1', 'FDUSD', 'DAI', 'USDC.E', 'USDE'])
const marketCache = new Map() // key -> { at, value } or { at, promise }
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of marketCache) if (now - v.at > USD_CACHE_MS * 2) marketCache.delete(k)
}, 60_000).unref?.()

/** One cached GET on the Ask budget. A failed read is kept briefly too, so DeepCore is never hammered. */
async function cachedAsk(key, ttl, pathAndQuery) {
  const now = Date.now()
  const hit = marketCache.get(key)
  if (hit && now - hit.at < (hit.value && !hit.value.ok ? Math.min(ttl, 20_000) : ttl)) return hit.promise ?? hit.value
  while (marketCache.size >= MARKET_CACHE_MAX) marketCache.delete(marketCache.keys().next().value)
  const promise = get(pathAndQuery, 'ask').then((r) => ({ ...r, at: Date.now() }))
  marketCache.set(key, { at: now, promise })
  const value = await promise
  // A spent local budget is not cached: the next question may fall inside the next minute's budget.
  if (!value.ok && value.status === 429) marketCache.delete(key)
  else marketCache.set(key, { at: value.at, value })
  return value
}

const finite = (v) => {
  const n = Number(v)
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null
}
/** A number to `d` significant digits (as a number); null for anything else. */
export const sig = (n, d = 4) => (typeof n === 'number' && Number.isFinite(n) ? Number(n.toPrecision(d)) : null)

/** The quote token's US dollar price: 1 for a dollar stable, else DeepCore's Chainlink-sourced USD, else null. */
async function quoteUsd(chainId, address, symbol) {
  if (DOLLAR_STABLES.has(String(symbol ?? '').toUpperCase())) return { usd: 1, source: 'dollar stable' }
  if (!isAddr(address)) return { usd: null, source: null }
  const a = address.toLowerCase()
  const r = await cachedAsk(`usd:${chainId}:${a}`, USD_CACHE_MS, `/v1/chains/${chainId}/tokens/${a}`)
  const u = r.body?.data?.usd
  const usd = finite(u?.usdPerToken)
  return usd && usd > 0 ? { usd, source: String(u.sourceText ?? u.source ?? 'Chainlink').slice(0, 80) } : { usd: null, source: null }
}

/**
 * One DeepCore pool view (GET /v1/chains/:id/pools/:poolId, `data`, or an item of the pool list) in
 * the shape Gully AI reads, seen from the launch token's side: the price of one launch token in the
 * quote token, active liquidity as DeepCore states it (pool units, not dollars), fees, creator tax,
 * activity and when DeepCore read the state. Exported for the tests.
 */
export function shapePool(d, launchToken) {
  const lt = String(launchToken ?? '').toLowerCase()
  const t0 = d?.token0 ?? {}
  const t1 = d?.token1 ?? {}
  const launchIs0 = String(t0.address ?? '').toLowerCase() === lt
  const launchIs1 = String(t1.address ?? '').toLowerCase() === lt
  const quote = launchIs0 ? t1 : t0
  const raw = launchIs0 ? d?.price?.token1PerToken0 : launchIs1 ? d?.price?.token0PerToken1 : null
  const s = d?.state ?? null
  const fee = finite(d?.launchFee?.feePips) ?? finite(s?.lpFeePips)
  const tax = d?.launchTax ?? null
  const bps = (v) => (finite(v) !== null ? finite(v) / 100 : null)
  return {
    poolId: typeof d?.poolId === 'string' ? d.poolId.slice(0, 66) : null,
    kind: /bin/i.test(String(d?.poolType ?? '')) ? 'Bin' : /cl/i.test(String(d?.poolType ?? '')) ? 'CL' : null,
    quote: { symbol: quote.symbol ? String(quote.symbol).slice(0, 16) : null, address: isAddr(quote.address) ? quote.address.toLowerCase() : null },
    priceInQuote: finite(raw),
    activeLiquidityRaw: /^\d+$/.test(String(s?.activeLiquidityRaw ?? '')) ? String(s.activeLiquidityRaw).slice(0, 40) : null,
    feePct: fee !== null ? fee / 10_000 : null,
    creatorTaxPct: tax ? { buy: bps(tax.buyBps), sell: bps(tax.sellBps) } : null,
    swaps: finite(d?.activity?.swapCount),
    lastSwapAt: isIso(d?.activity?.lastSwap?.blockTimestamp) ? new Date(d.activity.lastSwap.blockTimestamp).toISOString() : null,
    stateReadAt: isIso(s?.readAt) ? new Date(s.readAt).toISOString() : null,
    stateReadAtBlock: s?.readAtBlock != null ? String(s.readAtBlock).slice(0, 20) : null,
    stateError: s?.readError ? String(s.readError).slice(0, 120) : s ? null : 'DeepCore has not read this pool’s state yet',
  }
}

/** Adds the dollar price of a shaped pool where the quote token's dollar price is known. */
async function withUsd(chainId, p, at) {
  const q = await quoteUsd(chainId, p.quote.address, p.quote.symbol)
  return { ...p, priceUsd: p.priceInQuote !== null && q.usd ? sig(p.priceInQuote * q.usd, 6) : null, quoteUsdSource: q.source, fetchedAt: new Date(at).toISOString() }
}

/** Reads one pool for one launch token. */
async function poolMarket(chainId, poolId, token) {
  const id = String(poolId).toLowerCase()
  const r = await cachedAsk(`pool:${chainId}:${id}`, POOL_CACHE_MS, `/v1/chains/${chainId}/pools/${id}`)
  if (!r.ok || !r.body?.data) return { poolId: id, error: r.status === 404 ? 'DeepCore does not index this pool yet' : `could not be read (${r.error ?? 'unexpected answer'})`, fetchedAt: new Date(r.at).toISOString() }
  return withUsd(chainId, shapePool(r.body.data, token), r.at)
}

/** A launch with its pools' market figures. Market cap = the first priced leg's price × total supply. */
async function launchMarket(l) {
  const legs = await Promise.all(l.legs.filter((g) => g.poolId).slice(0, 4).map((g) => poolMarket(l.chainId, g.poolId, l.token).then((m) => ({ ...m, locked: g.locked }))))
  const priced = legs.find((g) => typeof g.priceInQuote === 'number')
  const supply = finite(l.totalSupply)
  const capQuote = priced && supply ? priced.priceInQuote * supply : null
  const capUsd = priced?.priceUsd && supply ? priced.priceUsd * supply : null
  return {
    chain: l.chainName,
    chainId: l.chainId,
    symbol: l.symbol,
    token: l.token,
    launchedAt: l.createdAt,
    tradingStartsAt: l.startsAt,
    totalSupply: supply,
    priceUsd: priced?.priceUsd ?? null,
    price: priced ? { amount: sig(priced.priceInQuote, 6), in: priced.quote.symbol } : null,
    marketCapUsd: capUsd !== null ? Math.round(capUsd) : null,
    marketCap: capQuote !== null ? { amount: sig(capQuote, 6), in: priced.quote.symbol } : null,
    swaps: legs.reduce((a, g) => (typeof g.swaps === 'number' ? (a ?? 0) + g.swaps : a), null),
    lastSwapAt: legs.map((g) => g.lastSwapAt).filter(Boolean).sort().at(-1) ?? null,
    pools: legs,
    page: l.links.token,
  }
}

const LIQUIDITY_NOTE = 'Liquidity: DeepCore states each pool’s active liquidity in pool units (activeLiquidityRaw), not dollars, and publishes no dollar liquidity per pool; locked says whether the launch liquidity is locked.'
const PRICE_NOTE = 'Prices are the pools’ own (before any creator tax), from CLPoolManager.getSlot0 as DeepCore read it. Dollars appear only where the quote is a dollar stable or DeepCore states a Chainlink price for it.'
const NEWEST_TRENDING = 8
const chainList = () => Object.values(DEEPCORE_CHAINS).map((c) => c.name).join(', ')

/** A chain name, key or id to a DeepCore chain id; null for "every chain", undefined when not a DeepCore chain. */
export function deepcoreChainId(x) {
  if (x === undefined || x === null || x === '' || x === 'all') return null
  const s = String(x).toLowerCase().trim()
  for (const [id, c] of Object.entries(DEEPCORE_CHAINS)) if (s === id || s === c.key || s === c.name.toLowerCase() || (s === 'bnb' && c.key === 'bsc') || (s === 'hyperliquid' && c.key === 'hyperevm')) return Number(id)
  return undefined
}

/**
 * Gully AI: the newest, or the most traded recent, DeepCore launches with price, market cap, liquidity
 * and activity. `sort` is 'newest' or 'trending'; at most 5 launches. Never throws.
 */
export async function readDeepcoreMarkets() {
  return { state: 'retired', launches: [], chains: [], asOf: null, error: RETIRED }
}

/**
 * Gully AI: one token's DeepCore pools. `token` is a launch token's address or symbol; a symbol is
 * looked up in the latest launches. An address that is not a recent launch needs a chain and is read
 * through DeepCore's pool list for that token. Never throws.
 */
export async function readDeepcorePool() {
  return { state: 'retired', matches: [], pools: [], asOf: null, error: RETIRED }
}
