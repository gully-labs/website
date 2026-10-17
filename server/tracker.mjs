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
import { DATA_DIR } from './http.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const load = (f) => JSON.parse(fs.readFileSync(path.join(here, 'data', f), 'utf8'))

const CHAINS = [
  { id: 4663, key: 'robinhood', name: 'Robinhood Chain', dex: 'robinhood', gecko: 'robinhood', rpcs: ['https://rpc.mainnet.chain.robinhood.com', 'https://rpc.ordofi.network'], session: '24/5', stateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b', nativeUsdFeed: '0x78f3556b67e17df817d51ef5a990cdaf09e8d3a9', nativeQuotes: ['WETH', 'ETH'], table: load('robinhood-stocks.json'), multiplier: false },
  { id: 56, key: 'bsc', name: 'BNB Chain', dex: 'bsc', gecko: 'bsc', rpcs: ['https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed1.defibit.io', 'https://bsc-rpc.publicnode.com'], session: 'nyse', stateView: null, nativeUsdFeed: '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE', nativeQuotes: ['WBNB', 'BNB'], table: load('bsc-stocks.json'), multiplier: true },
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
      return { price, liquidityUsd: num(p.liquidity?.usd) ?? 0, volume24hUsd: num(p.volume?.h24) ?? 0, dex: p.dexId, labels: p.labels ?? [], other: other?.symbol ?? '?', quoteAddr: other?.address ?? null, url: p.url, pair: p.pairAddress, sound: SOUND_QUOTES.has(String(other?.symbol ?? '').toUpperCase()) }
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

// Prices come from the chain on every refresh; the APIs are asked only to (re)discover which pool to
// read, and for liquidity and volume, once per DISCOVERY_MS. That keeps us well inside their limits.
const DISCOVERY_MS = 60 * 60_000

async function readPoolsResilient(chain, fairByToken = new Map()) {
  const b = backoff[chain.key]
  const cached = lastPools[chain.key]
  const usable = cached && Date.now() - cached.at < STALE_LIMIT_MS
  const chainReady = cached && cached.pools.some((p) => p?.quoteAddr)
  if (chainReady && Date.now() - cached.at < DISCOVERY_MS) {
    try {
      return { pools: await readPoolsOnchain(chain, fairByToken), asOf: cached.at, stale: false, source: 'on chain' }
    } catch {
      /* fall through to the APIs */
    }
  }
  if (b && Date.now() < b.until && usable) {
    if (chainReady) {
      try {
        return { pools: await readPoolsOnchain(chain, fairByToken), asOf: cached.at, stale: false, source: 'on chain' }
      } catch {
        /* serve the stale read below */
      }
    }
    return { pools: cached.pools, asOf: cached.at, stale: true, source: cached.source ?? 'DexScreener' }
  }
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
        try {
          pools = await readPoolsOnchain(chain, fairByToken)
          source = 'on chain'
        } catch {
          throw first
        }
      }
    }
    delete backoff[chain.key]
    if (source !== 'on chain') lastPools[chain.key] = { at: Date.now(), pools, source }
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
  if (process.env.TRACKER_SKIP_APIS === '1') throw new Error('APIs skipped (test switch)')
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
    // "SPY / PLTR 0.05%": the pair's other side is whichever half is not this token (base or quote).
    const [baseSym, quoteSym] = name.split('/').map((x) => x.trim().split(/\s+/)[0] ?? '?')
    const baseId = String(top?.relationships?.base_token?.data?.id ?? '').split('_')[1] ?? ''
    const against = (baseId.toLowerCase() === addr.toLowerCase() ? quoteSym : baseSym) ?? '?'
    const dexId = String(top?.relationships?.dex?.data?.id ?? 'unknown')
    const sides = [top?.relationships?.base_token?.data?.id, top?.relationships?.quote_token?.data?.id].map((id) => String(id ?? '').split('_')[1] ?? '')
    const quoteAddr = sides.find((a) => a && a.toLowerCase() !== addr.toLowerCase()) ?? null
    return {
      price,
      liquidityUsd: num(top?.attributes?.reserve_in_usd) ?? 0,
      volume24hUsd: num(top?.attributes?.volume_usd?.h24) ?? 0,
      dex: dexId.replace(/-(robinhood|bsc)$/, ''),
      labels: [],
      other: against,
      quoteAddr,
      url: top ? `https://www.geckoterminal.com/${chain.gecko}/pools/${top.attributes.address}` : null,
      pair: top?.attributes?.address ?? null,
      sound: SOUND_QUOTES.has(against.toUpperCase()),
      pools: ids.length,
      totalLiquidityUsd: num(t.attributes?.total_reserve_in_usd) ?? 0,
      totalVolume24hUsd: num(t.attributes?.volume_usd?.h24) ?? 0,
    }
  })
}

/* The third source, used when both price APIs refuse: re-price each token's last known pool straight
   from the chain. v3 pools (Uniswap, PancakeSwap, Ramses) are read with slot0(); Uniswap v4 pools by id
   through StateView.getSlot0. The quote is valued at $1 for a dollar stable, by Chainlink for the
   native coin, and by this cycle's fair price when the quote is itself a stock token (SPY, GLD…).
   Liquidity and volume are not on chain in usable form, so they stay those of the last good read. */
const STABLES = new Set(['USDC', 'USDG', 'USDT', 'USD1', 'FDUSD', 'USDC.E', 'DAI'])
const ZERO = '0x0000000000000000000000000000000000000000'
const decimalsCache = new Map()

async function readPoolsOnchain(chain, fairByToken) {
  const cached = lastPools[chain.key]
  if (!cached) throw new Error('no pool list to re-price yet')
  const pools = cached.pools
  const nat = await rpcBatch(chain, [{ jsonrpc: '2.0', id: 0, method: 'eth_call', params: [{ to: chain.nativeUsdFeed, data: '0xfeaf968c' }, 'latest'] }])
  const natHex = nat.get(0)?.result
  const nativeUsd = natHex && natHex.length >= 2 + 64 * 5 ? Number(BigInt.asIntN(256, word(natHex, 1))) / 1e8 : null

  const calls = []
  const plan = chain.table.stocks.map((s, i) => {
    const p = pools[i]
    if (!p || p.error || !p.pair || !p.quoteAddr) return null
    const v4 = p.pair.length === 66
    if (v4 && !chain.stateView) return null
    const id = calls.length
    calls.push({ jsonrpc: '2.0', id, method: 'eth_call', params: [v4 ? { to: chain.stateView, data: '0xc815641c' + p.pair.slice(2) } : { to: p.pair, data: '0x3850c7bd' }, 'latest'] })
    return { id, token: s.token.toLowerCase(), quote: p.quoteAddr.toLowerCase() }
  })
  const need = new Set()
  for (const x of plan) if (x) for (const a of [x.token, x.quote]) if (a !== ZERO && !decimalsCache.has(`${chain.key}:${a}`)) need.add(a)
  const decIds = new Map()
  for (const a of need) {
    decIds.set(a, calls.length)
    calls.push({ jsonrpc: '2.0', id: calls.length, method: 'eth_call', params: [{ to: a, data: '0x313ce567' }, 'latest'] })
  }
  if (!calls.length) throw new Error('nothing to re-price')
  const out = await rpcBatch(chain, calls)
  for (const [a, id] of decIds) {
    const r = out.get(id)?.result
    if (r && r.length >= 66) decimalsCache.set(`${chain.key}:${a}`, Number(BigInt(r)))
  }
  const dec = (a) => (a === ZERO ? 18 : decimalsCache.get(`${chain.key}:${a}`))

  let repriced = 0
  const result = pools.map((p, i) => {
    const x = plan[i]
    if (!x) return p
    const r = out.get(x.id)?.result
    if (!r || r.length < 66) return p
    const sqrt = Number(word(r, 0)) / 2 ** 96
    const tokenIs0 = x.token < x.quote
    const d0 = dec(tokenIs0 ? x.token : x.quote)
    const d1 = dec(tokenIs0 ? x.quote : x.token)
    if (!sqrt || d0 === undefined || d1 === undefined) return p
    const zeroInOne = sqrt * sqrt * 10 ** (d0 - d1) // price of currency0 in units of currency1
    const inQuote = tokenIs0 ? zeroInOne : 1 / zeroInOne
    const sym = String(p.other ?? '').toUpperCase()
    const quoteUsd = STABLES.has(sym) ? 1 : chain.nativeQuotes.includes(sym) ? nativeUsd : (fairByToken.get(x.quote) ?? null)
    if (!quoteUsd || !Number.isFinite(inQuote) || inQuote <= 0) return p
    repriced++
    return { ...p, price: inQuote * quoteUsd }
  })
  if (!repriced) throw new Error('no pool could be re-priced on chain')
  return result
}

/** Every token's pools in batches of 30 (DexScreener's limit). */
async function readPools(chain) {
  if (process.env.TRACKER_SKIP_APIS === '1') throw new Error('APIs skipped (test switch)')
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

/* Long history, for paid plans: the same points also go to append-only files, one directory per UTC
   day and one NDJSON file per token in it (ARCHIVE_DIR/YYYY-MM-DD/<chain>-<TICKER>.ndjson, one
   [unixSeconds, gapPct, onchain, fair] per line). Reading one token's year is then ~365 small files,
   not the whole archive. Day directories older than ARCHIVE_KEEP_DAYS are deleted. */
const ARCHIVE_DIR = path.join(DATA_DIR, 'history')
export const ARCHIVE_KEEP_DAYS = 365
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10)
let lastPrune = 0

function archive(points, at) {
  try {
    const dir = path.join(ARCHIVE_DIR, dayOf(at))
    fs.mkdirSync(dir, { recursive: true })
    for (const [key, p] of points) fs.appendFileSync(path.join(dir, `${key.replace(':', '-')}.ndjson`), JSON.stringify(p) + '\n')
    if (at - lastPrune > 6 * 3_600_000) {
      lastPrune = at
      const oldest = dayOf(at - ARCHIVE_KEEP_DAYS * 86_400_000)
      for (const d of fs.readdirSync(ARCHIVE_DIR)) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < oldest) fs.rmSync(path.join(ARCHIVE_DIR, d), { recursive: true, force: true })
    }
  } catch (e) {
    console.error('history archive:', e?.message ?? e)
  }
}

function record(rows, at) {
  const cutoff = at - KEEP_MS
  const added = []
  for (const r of rows) {
    if (r.gapPct === null || r.poolStale) continue
    const key = histKey(r.chain, r.ticker)
    const h = (history[key] ??= [])
    const p = [Math.round(at / 1000), Math.round(r.gapPct * 100) / 100, r.onchain, r.fair]
    h.push(p)
    added.push([key, p])
    while (h.length && h[0][0] * 1000 < cutoff) h.shift()
  }
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
    fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(history))
    fs.renameSync(DATA_FILE + '.tmp', DATA_FILE)
  } catch {
    /* history stays in memory */
  }
  archive(added, at)
}

/** Every token the tracker follows, for validating alert targets. */
export const trackedStocks = () => CHAINS.flatMap((c) => c.table.stocks.map((s) => ({ chain: c.key, ticker: s.ticker, name: s.name })))

/* Snapshot listeners (gap alerts): called with the rows and time of every recorded snapshot. */
const snapshotListeners = new Set()
export function onSnapshot(fn) {
  snapshotListeners.add(fn)
  return () => snapshotListeners.delete(fn)
}
function emitSnapshot(rows, at) {
  for (const fn of snapshotListeners) {
    try {
      Promise.resolve(fn(rows, at)).catch((e) => console.error('snapshot listener:', e?.message ?? e))
    } catch (e) {
      console.error('snapshot listener:', e?.message ?? e)
    }
  }
}

/** Test hook: records a snapshot of synthetic rows exactly as the loop would (history, archive, listeners). */
export function recordSnapshotForTest(rows, at = Date.now()) {
  record(rows, at)
  emitSnapshot(rows, at)
}

/* ------------------------------------------------------------------- read --- */

// Logos for API consumers and the widget: the token's own (BSC bStocks) or the company's site icon,
// as absolute URLs on this site. Read once from the SOURCES files the logo scripts keep in public/.
const SITE_ORIGIN = 'https://gullylabs.xyz'
const CHAIN_LOGO = { robinhood: '/chains/robinhood.png', bsc: '/chains/bnb.png' }
let logoMaps = null
function logosFor(chainKey, stock) {
  if (!logoMaps) {
    const dist = path.resolve(process.env.DIST_DIR ?? 'dist')
    const read = (f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dist, f), 'utf8'))
      } catch {
        return {}
      }
    }
    logoMaps = { token: read('tokens/SOURCES.json'), company: read('tokens/logos/SOURCES.json') }
  }
  const file = logoMaps.token[`${chainKey}/${stock.token.toLowerCase()}`]?.file ?? logoMaps.company[stock.ticker]?.file ?? null
  return { logo: file ? SITE_ORIGIN + file : null, chainLogo: CHAIN_LOGO[chainKey] ? SITE_ORIGIN + CHAIN_LOGO[chainKey] : null }
}

async function buildChain(chain, at) {
  const open = sessionOpen(chain.session, new Date(at))
  const fail = (e) => chain.table.stocks.map(() => ({ error: String(e?.message ?? e) }))
  const feeds = await readFeeds(chain).catch(fail)
  const fairByToken = new Map(chain.table.stocks.map((s, i) => [s.token.toLowerCase(), feeds[i] && !feeds[i].error ? feeds[i].price : null]).filter(([, v]) => v))
  const poolRead = await readPoolsResilient(chain, fairByToken).catch((e) => ({ pools: fail(e), asOf: null, stale: false }))
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
      ...logosFor(chain.key, s),
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
      onchain: 'each token’s deepest pool (pools against a native coin or dollar stable first), priced directly on chain every refresh (v3 slot0, v4 StateView); DexScreener, or GeckoTerminal when it refuses, finds the pool and reports liquidity and volume once an hour',
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
        emitSnapshot(body.rows.map((r) => ({ ...r, sessionOpen: body.chains.find((c) => c.key === r.chain)?.sessionOpen ?? null })), lastSnapshot)
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

/**
 * The last `days` days of one token's gap history, same point shape. Up to seven days come from
 * memory; beyond that the archive supplies what is older than the in-memory series. Nothing is
 * filled in: a token or a day with no recorded snapshot simply has no points.
 */
export function readHistoryDays(chainKey, ticker, days) {
  const key = histKey(String(chainKey).toLowerCase(), String(ticker).toUpperCase())
  const since = Math.floor((Date.now() - days * 86_400_000) / 1000)
  const recent = (history[key] ?? []).filter((p) => p[0] >= since)
  if (days <= 7) return recent
  const before = (history[key] ?? [])[0]?.[0] ?? Infinity
  const older = []
  let dirs = []
  try {
    const first = dayOf(since * 1000)
    dirs = fs.readdirSync(ARCHIVE_DIR).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= first).sort()
  } catch {
    return recent
  }
  const file = `${key.replace(':', '-')}.ndjson`
  for (const d of dirs) {
    let text
    try {
      text = fs.readFileSync(path.join(ARCHIVE_DIR, d, file), 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      if (!line) continue
      try {
        const p = JSON.parse(line)
        if (Array.isArray(p) && p[0] >= since && p[0] < before) older.push(p)
      } catch {
        /* a torn last line after a crash */
      }
    }
  }
  return older.concat(recent)
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
