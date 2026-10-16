// Fair-price tracker for tokenised stocks, on every chain with a verified feed table in ./data.
//
// Two numbers per token, both read live:
//   - FAIR: the Chainlink feed for that stock, read on chain with latestRoundData().
//       Robinhood Chain: the feed prices the TOKEN itself (`tokenized-instrument`), so fair = feed.
//       BNB Chain (Binance bStocks): the feed prices the underlying SHARE, and one raw bStock is
//       `uiMultiplier()` shares (ERC-8056, 1e18 = 1.0), so fair = feed x multiplier. The multiplier is
//       read on chain every refresh because the issuer changes it at a split.
//   - ONCHAIN: what the token trades at in its deepest pool, from DexScreener's public API.
// The gap between them is the product. Rules that keep it honest:
//   - a pool under MIN_LIQUIDITY_USD is shown but never flagged: a small pool cannot make a headline;
//   - a gap under IN_LINE_PCT is "in line" (Robinhood feeds only move on a 0.5% deviation);
//   - outside a chain's feed session the feed holds its last value, so the gap is labelled against
//     the last session, never presented as a live mispricing;
//   - a token whose pool or feed could not be read is reported as such, never as zero.
// Scale: every visitor shares one upstream read per CACHE_MS, and the responses are edge-cacheable.
// History: one snapshot per token every SNAPSHOT_MS, kept for 7 days in TRACKER_DATA (a volume).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const load = (f) => JSON.parse(fs.readFileSync(path.join(here, 'data', f), 'utf8'))

const CHAINS = [
  { id: 4663, key: 'robinhood', name: 'Robinhood Chain', dex: 'robinhood', gecko: 'robinhood', rpcs: ['https://rpc.mainnet.chain.robinhood.com', 'https://rpc.ordofi.network'], session: '24/5', table: load('robinhood-stocks.json'), multiplier: false },
  { id: 56, key: 'bsc', name: 'BNB Chain', dex: 'bsc', gecko: 'bsc', rpcs: ['https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed1.defibit.io', 'https://bsc-rpc.publicnode.com'], session: 'nyse', table: load('bsc-stocks.json'), multiplier: true },
]

const DEX = 'https://api.dexscreener.com/tokens/v1'
const GECKO = 'https://api.geckoterminal.com/api/v2/networks'
const UA = 'gullylabs-tracker/1 (+https://gullylabs.xyz/tracker)'
const CACHE_MS = 120_000
const SNAPSHOT_MS = 300_000
const KEEP_MS = 7 * 86_400_000
export const MIN_LIQUIDITY_USD = 10_000
export const IN_LINE_PCT = 1
export const FLAG_PCT = 2
const SOUND_QUOTES = new Set(['WETH', 'ETH', 'WBNB', 'BNB', 'USDC', 'USDG', 'USDT', 'USD1', 'FDUSD'])
const DATA_FILE = process.env.TRACKER_DATA ?? path.join(here, '..', '.tracker-history.json')

const num = (v) => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

async function rpcBatch(chain, calls) {
  let last
  for (const url of chain.rpcs) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(calls), signal: AbortSignal.timeout(15_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const out = await res.json()
      if (!Array.isArray(out)) throw new Error('not a batch answer')
      return new Map(out.map((r) => [r.id, r]))
    } catch (e) {
      last = e
    }
  }
  throw last
}

const word = (hex, k) => BigInt('0x' + hex.slice(2 + 64 * k, 2 + 64 * (k + 1)))

/** latestRoundData() for every feed, plus uiMultiplier() where the chain needs it, in one batch. */
async function readFeeds(chain) {
  const stocks = chain.table.stocks
  const calls = stocks.flatMap((s, i) => [
    { jsonrpc: '2.0', id: 2 * i, method: 'eth_call', params: [{ to: s.feed, data: '0xfeaf968c' }, 'latest'] },
    ...(chain.multiplier ? [{ jsonrpc: '2.0', id: 2 * i + 1, method: 'eth_call', params: [{ to: s.token, data: '0xa60bf13d' }, 'latest'] }] : []),
  ])
  const byId = await rpcBatch(chain, calls)
  return stocks.map((s, i) => {
    const r = byId.get(2 * i)
    if (!r || r.error || !r.result || r.result.length < 2 + 64 * 5) return { error: r?.error?.message ?? 'no answer' }
    const answer = BigInt.asIntN(256, word(r.result, 1))
    const updatedAt = Number(word(r.result, 3))
    if (answer <= 0n || updatedAt === 0) return { error: 'empty round' }
    let multiplier = 1
    if (chain.multiplier) {
      const m = byId.get(2 * i + 1)
      if (!m || m.error || !m.result || m.result.length < 66) return { error: 'multiplier unreadable' }
      multiplier = Number(word(m.result, 0)) / 1e18
      if (!(multiplier > 0)) return { error: 'multiplier is zero' }
    }
    const share = Number(answer) / 10 ** s.feedDecimals
    return { price: share * multiplier, share, multiplier, updatedAt }
  })
}

/** The deepest pool for one token, preferring pools priced against a native coin or a dollar stable. */
function bestPool(token, pairs) {
  const lower = token.toLowerCase()
  const rows = pairs
    .filter((p) => p.baseToken?.address?.toLowerCase() === lower || p.quoteToken?.address?.toLowerCase() === lower)
    .map((p) => {
      const isBase = p.baseToken.address.toLowerCase() === lower
      const other = isBase ? p.quoteToken : p.baseToken
      const usd = num(p.priceUsd)
      const native = num(p.priceNative)
      // DexScreener prices the BASE token; a stock on the quote side is priceUsd / priceNative.
      const price = isBase ? usd : usd !== null && native ? usd / native : null
      return { price, liquidityUsd: num(p.liquidity?.usd) ?? 0, volume24hUsd: num(p.volume?.h24) ?? 0, dex: p.dexId, labels: p.labels ?? [], other: other?.symbol ?? '?', url: p.url, pair: p.pairAddress, sound: SOUND_QUOTES.has(String(other?.symbol ?? '').toUpperCase()) }
    })
    .filter((r) => r.price !== null && r.price > 0)
  if (!rows.length) return null
  rows.sort((a, b) => Number(b.sound) - Number(a.sound) || b.liquidityUsd - a.liquidityUsd)
  const best = rows[0]
  return { ...best, pools: rows.length, totalLiquidityUsd: rows.reduce((a, r) => a + r.liquidityUsd, 0), totalVolume24hUsd: rows.reduce((a, r) => a + r.volume24hUsd, 0) }
}

/* Resilience: an upstream refusal never blanks the page. After a 429 the chain backs off (doubling,
   capped at 30 min) and serves its last good read, labelled with that read's time. The last good read
   is saved beside the history so a restart begins with data. A read older than STALE_LIMIT_MS is
   dropped rather than shown. */
const STALE_LIMIT_MS = 6 * 3_600_000
const POOLS_FILE = DATA_FILE.replace(/\.json$/, '') + '-pools.json'
let lastPools = {}
try {
  lastPools = JSON.parse(fs.readFileSync(POOLS_FILE, 'utf8'))
} catch {
  lastPools = {}
}
const backoff = {}

async function readPoolsResilient(chain) {
  const b = backoff[chain.key]
  const cached = lastPools[chain.key]
  const usable = cached && Date.now() - cached.at < STALE_LIMIT_MS
  if (b && Date.now() < b.until && usable) return { pools: cached.pools, asOf: cached.at, stale: true, source: cached.source ?? 'DexScreener' }
  try {
    let pools
    let source = 'DexScreener'
    try {
      pools = await readPools(chain)
    } catch (first) {
      // Second, independent source before falling back to a stale read.
      try {
        pools = await readPoolsGecko(chain)
        source = 'GeckoTerminal'
      } catch {
        throw first
      }
    }
    delete backoff[chain.key]
    lastPools[chain.key] = { at: Date.now(), pools, source }
    try {
      fs.mkdirSync(path.dirname(POOLS_FILE), { recursive: true })
      fs.writeFileSync(POOLS_FILE + '.tmp', JSON.stringify(lastPools))
      fs.renameSync(POOLS_FILE + '.tmp', POOLS_FILE)
    } catch {
      /* memory only */
    }
    return { pools, asOf: Date.now(), stale: false, source }
  } catch (e) {
    const wait = Math.min(30 * 60_000, (b?.wait ?? 60_000) * 2)
    backoff[chain.key] = { wait, until: Date.now() + wait }
    if (usable) return { pools: cached.pools, asOf: cached.at, stale: true, source: cached.source ?? 'DexScreener', error: String(e?.message ?? e) }
    throw e
  }
}

/** The same figures from GeckoTerminal, the second source, used when DexScreener refuses: each
    token's price (GeckoTerminal's, from its most liquid pool), its total liquidity and volume, and
    its top pool for the venue, pair and link. 30 tokens per request. */
async function readPoolsGecko(chain) {
  const tokens = chain.table.stocks.map((s) => s.token)
  const byToken = new Map()
  const pools = new Map()
  for (let i = 0; i < tokens.length; i += 30) {
    const url = `${GECKO}/${chain.gecko}/tokens/multi/${tokens.slice(i, i + 30).join(',')}?include=top_pools`
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(20_000) })
    if (!res.ok) throw new Error(`GeckoTerminal HTTP ${res.status}`)
    const j = await res.json()
    if (!Array.isArray(j.data)) throw new Error('GeckoTerminal: no data')
    for (const t of j.data) byToken.set(String(t.attributes?.address ?? '').toLowerCase(), t)
    for (const p of j.included ?? []) if (p.type === 'pool') pools.set(p.id, p)
  }
  return tokens.map((addr) => {
    const t = byToken.get(addr.toLowerCase())
    const price = num(t?.attributes?.price_usd)
    if (!t || !price) return null
    const ids = (t.relationships?.top_pools?.data ?? []).map((d) => d.id)
    const top = pools.get(ids[0])
    const name = String(top?.attributes?.name ?? '')
    const against = name.split('/')[1]?.trim().split(/\s+/)[0] ?? '?'
    const dexId = String(top?.relationships?.dex?.data?.id ?? 'unknown')
    return {
      price,
      liquidityUsd: num(top?.attributes?.reserve_in_usd) ?? 0,
      volume24hUsd: num(top?.attributes?.volume_usd?.h24) ?? 0,
      dex: dexId.replace(/-(robinhood|bsc)$/, ''),
      labels: [],
      other: against,
      url: top ? `https://www.geckoterminal.com/${chain.gecko}/pools/${top.attributes.address}` : null,
      pair: top?.attributes?.address ?? null,
      sound: SOUND_QUOTES.has(against.toUpperCase()),
      pools: ids.length,
      totalLiquidityUsd: num(t.attributes?.total_reserve_in_usd) ?? 0,
      totalVolume24hUsd: num(t.attributes?.volume_usd?.h24) ?? 0,
    }
  })
}

/** Every token's pools in batches of 30 (DexScreener's limit). */
async function readPools(chain) {
  const tokens = chain.table.stocks.map((s) => s.token)
  const pairs = []
  for (let i = 0; i < tokens.length; i += 30) {
    const url = `${DEX}/${chain.dex}/${tokens.slice(i, i + 30).join(',')}`
    // Node's default user agent is throttled far harder than a named client; one retry after a pause.
    const get = () => fetch(url, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(20_000) })
    let res = await get()
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 3_000))
      res = await get()
    }
    if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`)
    pairs.push(...((await res.json()) ?? []))
  }
  return tokens.map((t) => bestPool(t, pairs))
}

/** Whether a chain's feeds are live now. Robinhood: Chainlink's us_equities_24/5, Sunday 20:00 to
    Friday 20:00 New York. BSC: NYSE regular hours, 09:30 to 16:00 New York, weekdays (holidays are
    not modelled; a holiday shows as an old feed time, which the page also displays). */
export function sessionOpen(session, at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(at).map((p) => [p.type, p.value]),
  )
  const day = parts.weekday
  const minutes = Number(parts.hour) * 60 + Number(parts.minute)
  if (session === 'nyse') return day !== 'Sat' && day !== 'Sun' && minutes >= 570 && minutes < 960
  if (day === 'Sat') return false
  if (day === 'Sun') return minutes >= 1200
  if (day === 'Fri') return minutes < 1200
  return true
}

/* ---------------------------------------------------------------- history --- */

let history = {}
try {
  history = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
} catch {
  history = {}
}

const histKey = (chainKey, ticker) => `${chainKey}:${ticker}`

function record(rows, at) {
  const cutoff = at - KEEP_MS
  for (const r of rows) {
    if (r.gapPct === null || r.poolStale) continue
    const h = (history[histKey(r.chain, r.ticker)] ??= [])
    h.push([Math.round(at / 1000), Math.round(r.gapPct * 100) / 100, r.onchain, r.fair])
    while (h.length && h[0][0] * 1000 < cutoff) h.shift()
  }
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
    fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(history))
    fs.renameSync(DATA_FILE + '.tmp', DATA_FILE)
  } catch {
    /* history stays in memory */
  }
}

/* ------------------------------------------------------------------- read --- */

async function buildChain(chain, at) {
  const open = sessionOpen(chain.session, new Date(at))
  const fail = (e) => chain.table.stocks.map(() => ({ error: String(e?.message ?? e) }))
  const [feeds, poolRead] = await Promise.all([readFeeds(chain).catch(fail), readPoolsResilient(chain).catch((e) => ({ pools: fail(e), asOf: null, stale: false }))])
  const pools = poolRead.pools
  const rows = chain.table.stocks.map((s, i) => {
    const f = feeds[i]
    const p = pools[i]
    const fair = f && !f.error ? f.price : null
    const onchain = p && !p.error ? p.price : null
    const gapPct = fair && onchain ? ((onchain - fair) / fair) * 100 : null
    const liquid = !!p && !p.error && p.liquidityUsd >= MIN_LIQUIDITY_USD
    const status =
      fair === null ? 'feed-unreadable' : p?.error ? 'pool-unreadable' : onchain === null ? 'no-pool' : !liquid ? 'thin' : Math.abs(gapPct) < IN_LINE_PCT ? 'in-line' : Math.abs(gapPct) >= FLAG_PCT ? (gapPct > 0 ? 'premium' : 'discount') : 'drifting'
    return {
      chain: chain.key,
      ticker: s.ticker,
      name: s.name,
      token: s.token,
      feed: s.feed,
      fair,
      feedPrices: s.prices,
      multiplier: f && !f.error ? f.multiplier : null,
      feedUpdatedAt: f && !f.error ? new Date(f.updatedAt * 1000).toISOString() : null,
      feedError: f?.error ?? null,
      onchain,
      gapPct,
      status,
      pool: p && !p.error ? { dex: p.dex, labels: p.labels, against: p.other, url: p.url, pair: p.pair, liquidityUsd: p.liquidityUsd, volume24hUsd: p.volume24hUsd, pools: p.pools, totalLiquidityUsd: p.totalLiquidityUsd, totalVolume24hUsd: p.totalVolume24hUsd } : null,
      poolError: p?.error ?? null,
    }
  })
  for (const r of rows) r.poolStale = poolRead.stale
  return {
    chain: {
      key: chain.key,
      id: chain.id,
      name: chain.name,
      sessionOpen: open,
      sessionName: chain.session === 'nyse' ? 'NYSE hours' : '24/5',
      poolsAsOf: poolRead.asOf ? new Date(poolRead.asOf).toISOString() : null,
      poolsStale: poolRead.stale,
      poolSource: poolRead.source ?? null,
      fairMethod: chain.multiplier ? 'Share price from Chainlink × the token’s on-chain uiMultiplier' : 'Chainlink feed for the token itself',
    },
    rows,
  }
}

async function build() {
  const at = Date.now()
  const parts = []
  for (const c of CHAINS) parts.push(await buildChain(c, at))
  return {
    generatedAt: new Date(at).toISOString(),
    chains: parts.map((p) => p.chain),
    rules: { minLiquidityUsd: MIN_LIQUIDITY_USD, inLinePct: IN_LINE_PCT, flagPct: FLAG_PCT },
    sources: {
      fair: 'Chainlink feeds, read on chain with latestRoundData(); on BNB Chain multiplied by each bStock’s uiMultiplier()',
      onchain: 'DexScreener public API (the deepest pool per token, pools against a native coin or dollar stable first), with GeckoTerminal as the second source when DexScreener refuses',
      tables: CHAINS.map((c) => `${c.name}: ${c.table.source}`),
    },
    rows: parts.flatMap((p) => p.rows),
  }
}

let cache = null
let lastSnapshot = 0
let inflight = null

export async function readTracker() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.body
  // One build at a time: concurrent requests during a refresh share it instead of each reading upstream.
  inflight ??= build()
    .then((body) => {
      if (Date.now() - lastSnapshot >= SNAPSHOT_MS) {
        lastSnapshot = Date.now()
        record(body.rows, lastSnapshot)
      }
      cache = { at: Date.now(), body }
      return body
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** One token's gap history: [unixSeconds, gapPct, onchain, fair][]. */
export function readHistory(chainKey, ticker) {
  return history[histKey(String(chainKey).toLowerCase(), String(ticker).toUpperCase())] ?? []
}

/** Keep snapshots coming when nobody is looking, so the history has no holes. */
export function startTrackerLoop() {
  const tick = () => readTracker().catch(() => undefined)
  tick()
  return setInterval(tick, SNAPSHOT_MS).unref?.()
}

/** For the admin dashboard: the tracker's own health, read from memory. */
export function trackerHealth() {
  const now = Date.now()
  return {
    cacheAgeSeconds: cache ? Math.round((now - cache.at) / 1000) : null,
    lastSnapshot: lastSnapshot ? new Date(lastSnapshot).toISOString() : null,
    chains: CHAINS.map((c) => ({
      key: c.key,
      name: c.name,
      stocks: c.table.stocks.length,
      lastPoolRead: lastPools[c.key]?.at ? new Date(lastPools[c.key].at).toISOString() : null,
      backoffUntil: backoff[c.key] && backoff[c.key].until > now ? new Date(backoff[c.key].until).toISOString() : null,
      sessionOpen: sessionOpen(c.session),
    })),
    history: { series: Object.keys(history).length, points: Object.values(history).reduce((a, h) => a + h.length, 0), file: DATA_FILE },
    statuses: cache ? cache.body.rows.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {}) : null,
  }
}
