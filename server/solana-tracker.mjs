// Solana as the tracker's third chain: xStocks (Backed Finance's tokenised stocks, SPL Token-2022),
// read with plain JSON-RPC and fetch, in the same row shape as the EVM chains so history, movers, the
// heatmap, /gap, /top and alerts work unchanged (tracker.mjs calls buildSolanaChain from build()).
//
// Two numbers per token, both read live:
//   - FAIR: the underlying share's price from a Chainlink equity feed read on an EVM chain (BNB Chain,
//     Robinhood Chain, or a verified Ethereum feed), else the issuer's own quote (Backed's xStocks API),
//     times the token's on-chain multiplier. xStocks carry Token-2022's ScaledUiAmount extension: one
//     token is `multiplier` shares (dividends raise it, splits multiply it), so fair = share price x
//     multiplier. The multiplier is read from the mint every refresh; a scheduled new multiplier applies
//     from its effective time. Each row names its source (fairSource: chainlink:<chainId> or backed).
//   - ONCHAIN: what the token trades at in its deepest pool. DexScreener finds the pool (and reports
//     liquidity and volume) once an hour; between discoveries the pool's price is read straight from
//     the pool account when it is an Orca Whirlpool, a Raydium CLMM or a Meteora DLMM pool (each layout
//     is checked against the pool's own mints before it is believed). Any other pool keeps DexScreener's
//     price, labelled 'api' with its time.
// Trust rules: assessRow from tracker.mjs, unchanged (thresholds, units guard, "unverified").
// Session: each row follows its feed's own session (BNB Chain NYSE hours, Robinhood/Ethereum 24/5).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { b58encode as bs58, isSolanaAddress, readAccounts, solanaRpc, WSOL_MINT } from './solana.mjs'
import { SOLANA_CHAIN_ID } from './solana-pay.mjs'
import { readFeed } from './payments.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const TABLE = JSON.parse(fs.readFileSync(path.join(here, 'data', 'solana-stocks.json'), 'utf8'))

export const SOLANA_TRACKER_CHAIN = { id: SOLANA_CHAIN_ID, key: 'solana', name: 'Solana', session: 'nyse', table: TABLE }

/** The xStocks the tracker follows on Solana: { ticker, symbol, name, token (mint), decimals, … }. */
export const solanaStocks = () => TABLE.stocks

const DEX = 'https://api.dexscreener.com/tokens/v1/solana'
const DEX_PAIRS = 'https://api.dexscreener.com/token-pairs/v1/solana'
const UA = 'gullylabs-tracker/1 (+https://gullylabs.xyz/tracker)'
const DISCOVERY_MS = 60 * 60_000
const STALE_LIMIT_MS = 6 * 3_600_000
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
const STABLE_MINTS = new Set([USDC, USDT])
const SOUND = new Set(['SOL', 'WSOL', 'USDC', 'USDT'])
const DLMM_MAX_DRIFT = 0.05

const num = (v) => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/* ------------------------------------------------------------ pools --- */

/** Whether a pool's price can be re-read from its account: Orca Whirlpool, Raydium CLMM, Meteora DLMM. */
export function poolKind(p) {
  const dex = String(p?.dex ?? '').toLowerCase()
  const labels = (p?.labels ?? []).map((l) => String(l).toUpperCase())
  if (dex === 'orca' || dex.includes('whirlpool')) return 'whirlpool'
  if (dex.startsWith('raydium') && (labels.includes('CLMM') || dex.includes('clmm'))) return 'raydium-clmm'
  if (dex.startsWith('meteora') && (labels.includes('DLMM') || dex.includes('dlmm'))) return 'meteora-dlmm'
  return null
}

/** The deepest pool for one mint among DexScreener pairs: sound quotes first, then re-readable, then liquidity. */
export function bestSolanaPool(mint, pairs, minLiquidity = 10_000) {
  const rows = pairs
    .filter((p) => p.baseToken?.address === mint || p.quoteToken?.address === mint)
    .map((p) => {
      const isBase = p.baseToken.address === mint
      const other = isBase ? p.quoteToken : p.baseToken
      const usd = num(p.priceUsd)
      const native = num(p.priceNative)
      const price = isBase ? usd : usd !== null && native ? usd / native : null
      const row = { price, liquidityUsd: num(p.liquidity?.usd) ?? 0, volume24hUsd: num(p.volume?.h24) ?? 0, dex: p.dexId, labels: p.labels ?? [], other: other?.symbol ?? '?', quoteAddr: other?.address ?? null, url: p.url, pair: p.pairAddress, sound: SOUND.has(String(other?.symbol ?? '').toUpperCase()) || STABLE_MINTS.has(other?.address) || other?.address === WSOL_MINT }
      return { ...row, readable: !!poolKind(row) }
    })
    .filter((r) => r.price !== null && r.price > 0)
  if (!rows.length) return null
  const seen = new Set()
  const unique = rows.filter((r) => (seen.has(r.pair) ? false : (seen.add(r.pair), true)))
  const usable = (r) => r.readable && r.liquidityUsd >= minLiquidity
  unique.sort((a, b) => Number(b.sound) - Number(a.sound) || Number(usable(b)) - Number(usable(a)) || b.liquidityUsd - a.liquidityUsd)
  const best = unique[0]
  return { ...best, priced: 'api', pools: unique.length, totalLiquidityUsd: unique.reduce((a, r) => a + r.liquidityUsd, 0), totalVolume24hUsd: unique.reduce((a, r) => a + r.volume24hUsd, 0) }
}

const pubkeyAt = (b, o) => (b.length >= o + 32 ? bs58(b.subarray(o, o + 32)) : null)
const u128At = (b, o) => b.readBigUInt64LE(o) + (b.readBigUInt64LE(o + 8) << 64n)

/**
 * A pool account's price of `mint` in its other token (UI units), or null when the layout does not hold
 * (the mints at the expected offsets must be exactly this mint and the quote mint).
 *   Whirlpool:    sqrt_price u128 at 65 (Q64.64), token_mint_a at 101, token_mint_b at 181
 *   Raydium CLMM: token_mint_0 at 73, token_mint_1 at 105, decimals at 233/234, sqrt_price_x64 u128 at 253
 *   Meteora DLMM: active_id i32 at 76, bin_step u16 at 80, token_x_mint at 88, token_y_mint at 120;
 *                 price of X per Y in base units = (1 + bin_step / 10000) ^ active_id
 */
export function poolPrice(kind, data, mint, quoteMint, decimals) {
  const b = Buffer.from(data)
  try {
    let m0, m1, p01 // price of token 0 in token 1, in base units
    if (kind === 'whirlpool') {
      if (b.length < 213) return null
      m0 = pubkeyAt(b, 101)
      m1 = pubkeyAt(b, 181)
      const s = Number(u128At(b, 65)) / 2 ** 64
      p01 = s * s
    } else if (kind === 'raydium-clmm') {
      if (b.length < 273) return null
      m0 = pubkeyAt(b, 73)
      m1 = pubkeyAt(b, 105)
      const s = Number(u128At(b, 253)) / 2 ** 64
      p01 = s * s
    } else if (kind === 'meteora-dlmm') {
      if (b.length < 152) return null
      const active = b.readInt32LE(76)
      const step = b.readUInt16LE(80)
      if (!step || step > 1000) return null
      m0 = pubkeyAt(b, 88)
      m1 = pubkeyAt(b, 120)
      p01 = Math.pow(1 + step / 10_000, active)
    } else return null
    const d0 = decimals(m0)
    const d1 = decimals(m1)
    if (d0 === undefined || d1 === undefined || !(p01 > 0) || !Number.isFinite(p01)) return null
    const ui01 = p01 * 10 ** (d0 - d1)
    if (m0 === mint && m1 === quoteMint) return ui01
    if (m1 === mint && m0 === quoteMint) return 1 / ui01
    return null
  } catch {
    return null
  }
}

/* -------------------------------------------------------------- reads --- */

let lastPools = null // { at, pools, source }
let backoffUntil = 0
let backoffWait = 60_000
const decimalsCache = new Map([
  [USDC, 6],
  [USDT, 6],
  [WSOL_MINT, 9],
])

async function discover() {
  if (process.env.TRACKER_SKIP_APIS === '1' && !process.env.SOLANA_DEXSCREENER) throw new Error('APIs skipped (test switch)')
  const mints = TABLE.stocks.map((s) => s.token)
  const pairs = []
  for (let i = 0; i < mints.length; i += 30) {
    const r = await fetch(`${process.env.SOLANA_DEXSCREENER ?? DEX}/${mints.slice(i, i + 30).join(',')}`, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(20_000) })
    if (!r.ok) throw new Error(`DexScreener HTTP ${r.status}`)
    pairs.push(...((await r.json()) ?? []))
  }
  const at = Date.now()
  const out = mints.map((m) => bestSolanaPool(m, pairs))
  // The batch answers one pair per token; tokens whose pick cannot be re-read get every pair (capped).
  const recheck = mints.map((m, i) => [m, i]).filter(([, i]) => !out[i] || !out[i].readable).slice(0, 15)
  for (const [m, i] of recheck) {
    try {
      const r = await fetch(`${process.env.SOLANA_DEXSCREENER_PAIRS ?? DEX_PAIRS}/${m}`, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(15_000) })
      if (!r.ok) break
      const all = await r.json()
      if (Array.isArray(all) && all.length) out[i] = bestSolanaPool(m, [...pairs, ...all]) ?? out[i]
    } catch {
      break
    }
  }
  return out.map((p) => (p ? { ...p, pricedAt: at, source: 'DexScreener', discoveryPrice: p.price } : p))
}

/** Re-prices every re-readable pool from its account. Quote coins: USDC/USDT at $1, SOL at Chainlink's SOL / USD. */
async function repriceOnchain(pools, solUsd) {
  const plan = pools.map((p) => (p && !p.error && p.readable && p.pair && isSolanaAddress(p.pair) && p.quoteAddr ? p : null))
  const addrs = plan.filter(Boolean).map((p) => p.pair)
  if (!addrs.length) return { pools, repriced: 0 }
  const accs = await readAccounts(addrs)
  const byPair = new Map(addrs.map((a, i) => [a, accs[i]]))
  const now = Date.now()
  let repriced = 0
  const out = pools.map((p, i) => {
    const x = plan[i]
    if (!x) return p
    const acc = byPair.get(x.pair)
    const stock = TABLE.stocks[i]
    const inQuote = acc ? poolPrice(poolKind(x), acc.data, stock.token, x.quoteAddr, (m) => (m === stock.token ? stock.decimals : decimalsCache.get(m))) : null
    const quoteUsd = STABLE_MINTS.has(x.quoteAddr) ? 1 : x.quoteAddr === WSOL_MINT ? solUsd : null
    if (!inQuote || !quoteUsd || !(inQuote > 0)) return { ...p, priced: 'api' }
    // A Meteora DLMM pool's active bin can sit on an emptied, one-sided bin far from where the token
    // trades (seen on AMDx: active bin 11% over the last trade and Jupiter's routed price). A DLMM read
    // more than DLMM_MAX_DRIFT away from the discovery price is not believed; the API price stays, as 'api'.
    const kind = poolKind(x)
    if (kind === 'meteora-dlmm' && p.discoveryPrice > 0 && Math.abs((inQuote * quoteUsd) / p.discoveryPrice - 1) > DLMM_MAX_DRIFT) return { ...p, priced: 'api' }
    repriced++
    return { ...p, price: inQuote * quoteUsd, priced: 'chain', pricedAt: now }
  })
  return { pools: out, repriced }
}

async function readPools(solUsd) {
  const now = Date.now()
  const fresh = lastPools && now - lastPools.at < DISCOVERY_MS
  if (!fresh && now >= backoffUntil) {
    try {
      const pools = await discover()
      lastPools = { at: now, pools, source: 'DexScreener' }
      backoffWait = 60_000
    } catch (e) {
      backoffUntil = now + backoffWait
      backoffWait = Math.min(30 * 60_000, backoffWait * 2)
      if (!lastPools || now - lastPools.at > STALE_LIMIT_MS) throw e
    }
  }
  if (!lastPools) throw new Error('no pool read yet')
  const stale = now - lastPools.at > DISCOVERY_MS + 5 * 60_000
  let pools = lastPools.pools
  let source = lastPools.source
  if (solUsd !== null) {
    try {
      const r = await repriceOnchain(pools, solUsd)
      pools = r.pools
      if (r.repriced) source = 'on chain'
    } catch {
      /* keep the API prices, labelled as such */
    }
  }
  return { pools, asOf: lastPools.at, stale: stale && source !== 'on chain', source }
}

/** Token-2022 ScaledUiAmount multipliers for every mint (jsonParsed), applying a scheduled one once due. */
export function multiplierOf(parsedMint, nowSec = Date.now() / 1000) {
  const ext = (parsedMint?.extensions ?? []).find((e) => e?.extension === 'scaledUiAmountConfig')
  if (!ext) return 1
  const st = ext.state ?? {}
  const due = Number(st.newMultiplierEffectiveTimestamp ?? 0)
  const m = Number(due && due <= nowSec ? st.newMultiplier : st.multiplier)
  return Number.isFinite(m) && m > 0 ? m : null
}

async function readMultipliers() {
  const mints = TABLE.stocks.map((s) => s.token)
  const out = []
  for (let i = 0; i < mints.length; i += 100) {
    const r = await solanaRpc('getMultipleAccounts', [mints.slice(i, i + 100), { encoding: 'jsonParsed', commitment: 'confirmed' }], { timeoutMs: 10_000 })
    for (const a of r?.value ?? []) out.push(a ? multiplierOf(a.data?.parsed?.info) : null)
  }
  return out
}

/* ------------------------------------------------------------- fair --- */

/* Fair share prices come from Chainlink equity feeds already read on EVM chains, never from a Solana
   oracle (none covers xStocks; see solana-research.md). For each ticker, the first of:
     1. BNB Chain (56): data/bsc-stocks.json, feeds that price the underlying SHARE, NYSE hours;
     2. Robinhood Chain (4663): data/robinhood-stocks.json, Chainlink's us_equities_24/5 feeds;
     3. TABLE.chainlinkExtra: official Chainlink feeds on Ethereum (1) for tickers neither covers, each
        checked on chain (description, decimals, latestRoundData) and in Chainlink's feed directory.
   Then, for a ticker with no feed (or a feed that cannot be read), the issuer's own quote of the
   underlying: Backed's GET /api/v1/collateral/quote?symbol=<T> (keyless, cached a minute per symbol).
   Fair per raw token = that share price x the xStock's effective multiplier. Session rules are each
   feed's own, exactly as the tracker applies them on its chain: outside the session the feed holds its
   last value, and the row says so (sessionOpen false, with the feed time). */
const FEED_TABLES = [
  { chainId: 56, file: 'bsc-stocks.json', session: 'nyse' },
  { chainId: 4663, file: 'robinhood-stocks.json', session: '24/5' },
]
const sessionOf = (marketHours) => (/nyse/i.test(String(marketHours)) ? 'nyse' : '24/5')
const FEEDS = new Map() // ticker -> { chainId, feed, decimals, session }
for (const t of FEED_TABLES) {
  for (const s of JSON.parse(fs.readFileSync(path.join(here, 'data', t.file), 'utf8')).stocks) if (!FEEDS.has(s.ticker)) FEEDS.set(s.ticker, { chainId: t.chainId, feed: s.feed, decimals: s.feedDecimals, session: t.session })
}
for (const x of TABLE.chainlinkExtra ?? []) if (!FEEDS.has(x.ticker)) FEEDS.set(x.ticker, { chainId: x.chainId, feed: x.feed, decimals: x.decimals, session: sessionOf(x.marketHours) })

/** The Chainlink feed the Solana tracker uses for a ticker, or null (then the issuer's quote). */
export const fairFeedFor = (ticker) => FEEDS.get(ticker) ?? null

const BACKED = () => (process.env.XSTOCKS_API ?? 'https://api.xstocks.fi').replace(/\/+$/, '')
const backedCache = new Map() // symbol -> { at, value }

async function backedQuote(symbol) {
  const hit = backedCache.get(symbol)
  if (hit && Date.now() - hit.at < 60_000) return hit.value
  const r = await fetch(`${BACKED()}/api/v1/collateral/quote?symbol=${encodeURIComponent(symbol)}`, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(10_000) })
  if (!r.ok) throw new Error(`xStocks API HTTP ${r.status}`)
  const j = await r.json()
  const price = num(j?.quote)
  const at = Date.parse(j?.timestamp ?? '')
  const value = price > 0 && Number.isFinite(at) ? { price, updatedAt: Math.floor(at / 1000), source: 'backed', session: 'nyse' } : { error: 'no quote for this symbol' }
  backedCache.set(symbol, { at: Date.now(), value })
  return value
}

/** latestRoundData() answer as { price, updatedAt } or null. Exported for the tests. */
export function decodeLatestRound(hex, decimals) {
  if (typeof hex !== 'string' || hex.length < 2 + 64 * 5) return null
  const w = (k) => BigInt('0x' + hex.slice(2 + 64 * k, 2 + 64 * (k + 1)))
  const answer = BigInt.asIntN(256, w(1))
  const updatedAt = Number(w(3))
  if (answer <= 0n || !updatedAt) return null
  return { price: Number(answer) / 10 ** decimals, updatedAt }
}

/**
 * Each stock's fair share price: { price, updatedAt (unix s), source: 'chainlink:<chainId>' | 'backed', session } or { error }.
 * `evmBatch(chainId, calls)` reads Robinhood Chain and BNB Chain through the tracker's own RPC failover;
 * `evmCall(chainId, to, data)` reads any other chain through Gully Pay's (payments.rpc).
 */
async function readFair({ evmBatch, evmCall }) {
  const stocks = TABLE.stocks
  const out = stocks.map(() => ({ error: 'not read' }))
  const byChain = new Map()
  stocks.forEach((s, i) => {
    const f = fairFeedFor(s.ticker)
    if (f) byChain.set(f.chainId, [...(byChain.get(f.chainId) ?? []), [i, f]])
  })
  await Promise.all(
    [...byChain].map(async ([chainId, list]) => {
      try {
        let answers
        if (chainId === 56 || chainId === 4663) {
          const m = await evmBatch(chainId, list.map(([, f], k) => ({ jsonrpc: '2.0', id: k, method: 'eth_call', params: [{ to: f.feed, data: '0xfeaf968c' }, 'latest'] })))
          answers = list.map((_, k) => m.get(k)?.result)
        } else answers = await Promise.all(list.map(([, f]) => evmCall(chainId, f.feed, '0xfeaf968c').catch(() => null)))
        list.forEach(([i, f], k) => {
          const d = decodeLatestRound(answers[k], f.decimals)
          out[i] = d ? { ...d, source: `chainlink:${chainId}`, session: f.session, feed: f.feed } : { error: `Chainlink feed on chain ${chainId} unreadable` }
        })
      } catch (e) {
        for (const [i] of list) out[i] = { error: String(e?.message ?? e).slice(0, 120) }
      }
    }),
  )
  const rest = stocks.map((s, i) => [s, i]).filter(([, i]) => out[i].error)
  for (let k = 0; k < rest.length; k += 8) {
    await Promise.all(
      rest.slice(k, k + 8).map(async ([s, i]) => {
        try {
          const q = await backedQuote(s.backedSymbol ?? s.ticker)
          // A Chainlink feed that failed is named alongside the fallback's own failure.
          out[i] = q.error ? { error: out[i].error === 'not read' ? q.error : `${out[i].error}; issuer quote: ${q.error}` } : q
        } catch (e) {
          out[i] = { error: String(e?.message ?? e).slice(0, 120) }
        }
      }),
    )
  }
  return out
}

/** SOL/USD from Chainlink (the same feed Gully Pay prices SOL with), or null when unreadable or stale. */
async function readSolUsdNumber() {
  try {
    const r = await readFeed(SOLANA_CHAIN_ID)
    return r.ok ? Number(r.price.answer) / 10 ** r.price.decimals : null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------- build --- */

/**
 * The Solana part of the tracker document, in buildChain's shape: { chain, rows }. `deps` are
 * tracker.mjs's own assessRow, sessionOpen and logosFor, passed in so this module never imports the
 * tracker (no import cycle) and the trust rules stay one function.
 */
export async function buildSolanaChain(at, { assessRow, sessionOpen, logosFor, evmBatch, evmCall }) {
  const stocks = TABLE.stocks
  const fail = (e) => stocks.map(() => ({ error: String(e?.message ?? e).slice(0, 160) }))
  const [fair, mults, solUsd] = await Promise.all([readFair({ evmBatch, evmCall }).catch(fail), readMultipliers().catch((e) => fail(e)), readSolUsdNumber()])
  const poolRead = await readPools(solUsd).catch((e) => ({ pools: fail(e), asOf: null, stale: false, source: null }))
  const rows = stocks.map((s, i) => {
    const f = fair[i]
    const m = typeof mults[i] === 'number' ? mults[i] : null
    const p = poolRead.pools[i]
    const share = f && !f.error ? f.price : null
    const fairPrice = share !== null && m !== null ? share * m : null
    const feedError = f?.error ?? (m === null ? 'multiplier unreadable' : null)
    const onchain = p && !p.error ? p.price : null
    const verdict = assessRow({ fair: fairPrice, pool: p ? { ...p, source: p.source ?? 'DexScreener' } : p, now: at })
    const stale = !!poolRead.stale
    return {
      chain: 'solana',
      ticker: s.ticker,
      name: s.name,
      token: s.token,
      symbol: s.symbol,
      feed: f?.feed ?? fairFeedFor(s.ticker)?.feed ?? `xStocks collateral quote · ${s.backedSymbol ?? s.ticker}`,
      fairSource: f?.source ?? (fairFeedFor(s.ticker) ? `chainlink:${fairFeedFor(s.ticker).chainId}` : 'backed'),
      /** The fair price's own session (its feed's market hours); closed = the last session's price. */
      sessionOpen: sessionOpen(f?.session ?? fairFeedFor(s.ticker)?.session ?? 'nyse', new Date(at)),
      sessionName: (f?.session ?? fairFeedFor(s.ticker)?.session ?? 'nyse') === 'nyse' ? 'NYSE hours' : '24/5',
      fair: fairPrice,
      feedPrices: 'underlying-share',
      multiplier: m,
      feedUpdatedAt: f && !f.error ? new Date(f.updatedAt * 1000).toISOString() : null,
      feedError,
      onchain,
      gapPct: verdict.gapPct,
      status: verdict.status,
      rawGapPct: verdict.rawGapPct,
      trusted: verdict.trusted && !stale,
      untrustedReason: verdict.untrustedReason ?? (stale ? 'The pool read is the last good one, served while the price source backs off.' : null),
      onchainSource: onchain === null ? null : p.priced === 'chain' ? 'chain' : 'api',
      onchainAt: onchain === null ? null : new Date(p.pricedAt ?? poolRead.asOf ?? at).toISOString(),
      pool: p && !p.error ? { dex: p.dex, labels: p.labels, against: p.other, url: p.url, pair: p.pair, liquidityUsd: p.liquidityUsd, volume24hUsd: p.volume24hUsd, pools: p.pools, totalLiquidityUsd: p.totalLiquidityUsd, totalVolume24hUsd: p.totalVolume24hUsd, readableOnChain: !!p.readable } : null,
      poolError: p?.error ?? null,
      poolStale: !!poolRead.stale,
      ...logosFor('solana', s),
    }
  })
  return {
    chain: {
      key: 'solana',
      id: SOLANA_CHAIN_ID,
      name: 'Solana',
      // Rows carry their own feed's session; the chain is "open" while any of them is.
      sessionOpen: rows.some((r) => r.sessionOpen),
      sessionName: 'per feed: NYSE hours or 24/5',
      poolsAsOf: poolRead.asOf ? new Date(poolRead.asOf).toISOString() : null,
      poolsStale: !!poolRead.stale,
      poolSource: poolRead.source ?? null,
      fairMethod: 'Share price from Chainlink (BNB Chain, Robinhood Chain or Ethereum feeds), else the issuer’s quote (xStocks API), × the token’s on-chain multiplier (Token-2022 scaled UI amount)',
    },
    rows,
  }
}

/** For trackerHealth: the Solana chain's own state. */
export function solanaTrackerHealth() {
  return { key: 'solana', name: 'Solana', stocks: TABLE.stocks.length, lastPoolRead: lastPools?.at ? new Date(lastPools.at).toISOString() : null, backoffUntil: backoffUntil > Date.now() ? new Date(backoffUntil).toISOString() : null }
}

/** Test hook: forget the pool cache. */
export function resetSolanaTrackerForTest() {
  lastPools = null
  backoffUntil = 0
  backoffWait = 60_000
}
