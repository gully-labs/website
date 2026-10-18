// Jupiter swaps for the Solana stock pages (xStocks), proxied so the browser talks only to this site.
//
//   GET  /api/solana/jupiter/quote?ticker=AAPL&side=buy|sell&with=SOL|USDC&amount=<decimal>
//        buy:  pay `amount` SOL/USDC for the xStock;  sell: pay `amount` of the xStock for SOL/USDC.
//        -> { quote: { id, side, inSymbol, outSymbol, inAmount, outAmount, minOut, priceImpactPct,
//             route: [{ label, percent }], platformFee: { bps, amount, symbol } | null, feeNote,
//             slippageBps, expiresAt } }
//   POST /api/solana/jupiter/swap { quoteId, userPublicKey }
//        -> { swapTransaction (base64, unsigned), lastValidBlockHeight }. The wallet signs and sends it;
//        nothing is signed or held here.
//
// Upstream: Jupiter's Metis Swap API (GET /swap/v1/quote, POST /swap/v1/swap) at JUPITER_API (default
// https://api.jup.ag: keyless at 30 requests a minute; JUPITER_API_KEY, sent as x-api-key, raises it).
// /swap/v1 still answers but is no longer maintained (Swap V2 /order + /execute or /build replace it);
// it is used because it returns a ready, unsigned transaction and charges no Jupiter fee of its own.
//
// Platform fee (owner-set; none until set):
//   JUPITER_FEE_BPS (or VITE_JUPITER_FEE_BPS)          basis points, 1 to 255 (our cap; Jupiter allows
//                                                      up to 10000); 0/unset = no fee. Jupiter keeps none.
//   JUPITER_FEE_ACCOUNT (or VITE_JUPITER_FEE_ACCOUNT)   where the fee is paid:
//     - a wallet address: the fee is taken in the swap's SOL/USDC side and paid to that wallet's
//       associated token account for that mint (wSOL or USDC), which must already exist;
//     - a token account: the fee is taken only on swaps whose input or output is that account's mint.
//   With no usable fee account for a swap, that swap carries NO fee (platformFeeBps is not sent), and
//   the quote says so. platformFeeBps on the quote and feeAccount on the swap always come from the same
//   server-side record, so a page cannot ask for a different fee or a different recipient.
//
// Limits: each IP may ask QUOTES_PER_IP_MIN quotes and SWAPS_PER_IP_MIN swaps a minute; the whole site
// sends at most upstreamPerMin() calls a minute to Jupiter (keyless allows 30; a key allows more). Quotes are
// cached QUOTE_CACHE_MS per (pair, amount). Geo: the same gate as the stock-page swap (geo.mjs): 451.

import crypto from 'node:crypto'
import { clientIp, json, readJson } from './http.mjs'
import { associatedTokenAddress, isSolanaAddress, solanaRpc, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, WSOL_MINT } from './solana.mjs'
import { solanaStocks } from './solana-tracker.mjs'

export const QUOTES_PER_IP_MIN = 20
export const SWAPS_PER_IP_MIN = 6
export const upstreamPerMin = () => (process.env.JUPITER_API_KEY ? 50 : 25)
export const QUOTE_CACHE_MS = 10_000
/** A quote can be turned into a swap transaction for this long. */
export const QUOTE_LIFE_MS = 60_000
export const SLIPPAGE_BPS = 50

/** The coins a stock can be bought with or sold for: mint and decimals (both checked on mainnet). */
export const PAY_WITH = {
  SOL: { symbol: 'SOL', mint: WSOL_MINT, decimals: 9 },
  USDC: { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
}
const MAX_IN = { SOL: 1_000, USDC: 250_000 }

const API = () => (process.env.JUPITER_API ?? 'https://api.jup.ag').replace(/\/+$/, '')
const headers = () => ({ accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'gullylabs-swap/1 (+https://gullylabs.xyz/tracker)', ...(process.env.JUPITER_API_KEY ? { 'x-api-key': process.env.JUPITER_API_KEY } : {}) })

/** The platform fee in basis points from the environment: an integer from 1 to 255, else 0 (none). */
export function feeBps() {
  const raw = String(process.env.JUPITER_FEE_BPS ?? process.env.VITE_JUPITER_FEE_BPS ?? '').trim()
  const n = Number(raw)
  return Number.isInteger(n) && n >= 1 && n <= 255 ? n : 0
}
export const feeAccountEnv = () => {
  const a = String(process.env.JUPITER_FEE_ACCOUNT ?? process.env.VITE_JUPITER_FEE_ACCOUNT ?? '').trim()
  return isSolanaAddress(a) ? a : null
}

/* ----------------------------------------------------------- budgets --- */

const ipHits = new Map()
const upstream = []
function allowIp(kind, ip, max) {
  const now = Date.now()
  const k = `${kind}:${ip}`
  const list = (ipHits.get(k) ?? []).filter((t) => now - t < 60_000)
  if (list.length >= max) return false
  list.push(now)
  ipHits.set(k, list)
  return true
}
function takeUpstream() {
  const now = Date.now()
  while (upstream.length && now - upstream[0] >= 60_000) upstream.shift()
  if (upstream.length >= upstreamPerMin()) return false
  upstream.push(now)
  return true
}
export function resetJupiterForTest() {
  ipHits.clear()
  upstream.length = 0
  quoteCache.clear()
  issued.clear()
  feeCache.clear()
}

/* ------------------------------------------------------- fee account --- */

const feeCache = new Map() // `${account}:${mint}` -> { at, value }

/**
 * Where a fee in `mint` can be paid, or { account: null, reason }. A token account must hold `mint`;
 * a wallet's associated account for `mint` must exist. Cached ten minutes per (account, mint).
 */
export async function feeAccountFor(mint) {
  const base = feeAccountEnv()
  if (!feeBps()) return { account: null, reason: 'No Gully Labs fee is set.' }
  if (!base) return { account: null, reason: 'No fee account is set, so no Gully Labs fee is taken.' }
  const key = `${base}:${mint}`
  const hit = feeCache.get(key)
  if (hit && Date.now() - hit.at < 600_000) return hit.value
  let value
  try {
    const info = await solanaRpc('getAccountInfo', [base, { encoding: 'jsonParsed', commitment: 'confirmed' }])
    const acc = info?.value
    const parsed = acc?.data?.parsed
    if (acc && [TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(acc.owner) && parsed?.type === 'account') {
      value = parsed.info?.mint === mint ? { account: base, reason: null } : { account: null, reason: 'The fee account holds another token, so this swap carries no Gully Labs fee.' }
    } else {
      // A wallet: its associated token account for the fee mint (classic SPL Token for wSOL and USDC).
      const ata = associatedTokenAddress(base, mint, TOKEN_PROGRAM)
      const a = await solanaRpc('getAccountInfo', [ata, { encoding: 'base64', commitment: 'confirmed' }])
      value = a?.value && a.value.owner === TOKEN_PROGRAM ? { account: ata, reason: null } : { account: null, reason: 'The fee wallet has no token account for this coin yet, so this swap carries no Gully Labs fee.' }
    }
  } catch {
    // Unreadable now: no fee rather than a swap that fails on a missing account.
    return { account: null, reason: 'The fee account could not be checked just now, so this swap carries no Gully Labs fee.' }
  }
  feeCache.set(key, { at: Date.now(), value })
  return value
}

/* ------------------------------------------------------------ helpers --- */

/** A positive decimal string to raw units, or null (too many decimals, not a number, zero). */
export function toRaw(v, decimals) {
  const s = String(v ?? '').trim()
  const m = s.match(/^(\d{1,12})(?:\.(\d+))?$/)
  if (!m || (m[2] ?? '').length > decimals) return null
  const raw = BigInt(m[1]) * 10n ** BigInt(decimals) + BigInt((m[2] ?? '').padEnd(decimals, '0') || '0')
  return raw > 0n ? raw : null
}
const fmt = (raw, decimals) => {
  const r = BigInt(raw)
  const base = 10n ** BigInt(decimals)
  const frac = (r % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${r / base}${frac ? '.' + frac : ''}`
}

async function jup(pathAndQuery, init = {}) {
  if (!takeUpstream()) return { status: 429, body: null, error: 'local Jupiter budget spent' }
  try {
    const r = await fetch(API() + pathAndQuery, { ...init, headers: headers(), redirect: 'error', signal: AbortSignal.timeout(12_000) })
    const body = await r.json().catch(() => null)
    return { status: r.status, body, error: r.ok ? null : String(body?.error ?? body?.message ?? `HTTP ${r.status}`).slice(0, 200) }
  } catch (e) {
    return { status: null, body: null, error: String(e?.name === 'TimeoutError' ? 'timed out' : (e?.message ?? e)).slice(0, 200) }
  }
}

const quoteCache = new Map() // key -> { at, promise | result }
const issued = new Map() // quote id -> { at, quoteResponse, feeAccount, side }

const region = (geo) => ({ error: geo?.reason === 'blocked' ? 'Swapping this token isn’t available in your region.' : 'Your region could not be determined.', code: 'REGION' })

/* -------------------------------------------------------------- quote --- */

export async function handleJupiterQuote(req, res, url, geo) {
  if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
  if (!geo?.allowed) return json(res, 451, region(geo)), true
  const ticker = String(url.searchParams.get('ticker') ?? '').toUpperCase()
  const stock = solanaStocks().find((s) => s.ticker === ticker)
  if (!stock) return json(res, 400, { error: 'ticker must be an xStock the tracker follows on Solana', code: 'BAD_TOKEN' }), true
  const side = url.searchParams.get('side') === 'sell' ? 'sell' : url.searchParams.get('side') === 'buy' ? 'buy' : null
  const coin = PAY_WITH[String(url.searchParams.get('with') ?? '').toUpperCase()]
  if (!side || !coin) return json(res, 400, { error: 'side must be buy or sell, and with must be SOL or USDC', code: 'BAD_PAIR' }), true
  const inDec = side === 'buy' ? coin.decimals : stock.decimals
  const raw = toRaw(url.searchParams.get('amount'), inDec)
  const maxIn = side === 'buy' ? MAX_IN[coin.symbol] : 100_000
  if (!raw || raw > BigInt(maxIn) * 10n ** BigInt(inDec)) return json(res, 400, { error: `amount must be a positive number with at most ${inDec} decimals, at most ${maxIn.toLocaleString('en-US')}`, code: 'BAD_AMOUNT' }), true

  const inputMint = side === 'buy' ? coin.mint : stock.token
  const outputMint = side === 'buy' ? stock.token : coin.mint
  const bps = feeBps()
  const fee = bps ? await feeAccountFor(coin.mint) : { account: null, reason: 'No Gully Labs fee is set.' }
  const useFee = !!(bps && fee.account)
  const key = `${inputMint}:${outputMint}:${raw}:${useFee ? bps : 0}:${fee.account ?? ''}`
  const now = Date.now()
  const hit = quoteCache.get(key)
  if (!(hit && now - hit.at < QUOTE_CACHE_MS) && !allowIp('quote', clientIp(req), QUOTES_PER_IP_MIN)) return json(res, 429, { error: 'Too many quotes from this address. Wait a minute.', code: 'RATE_LIMITED' }, { 'Retry-After': '30' }), true

  let entry = hit && now - hit.at < QUOTE_CACHE_MS ? hit : null
  if (!entry) {
    const q = new URLSearchParams({ inputMint, outputMint, amount: raw.toString(), slippageBps: String(SLIPPAGE_BPS), swapMode: 'ExactIn', restrictIntermediateTokens: 'true', ...(useFee ? { platformFeeBps: String(bps), instructionVersion: 'V2' } : {}) })
    const promise = jup(`/swap/v1/quote?${q}`)
    entry = { at: now, promise }
    quoteCache.set(key, entry)
    entry.result = await promise
    delete entry.promise
    if (entry.result.status === 429 || entry.result.status === null) quoteCache.delete(key)
  } else if (entry.promise) entry.result = await entry.promise

  const r = entry.result
  if (r.status === 429) return json(res, 429, { error: 'Jupiter’s quote limit is reached for the moment. Try again in a minute.', code: 'BUSY' }, { 'Retry-After': '30' }), true
  const b = r.body
  if (r.status === 400 && /route|liquidity|no.*found|could not find/i.test(String(r.error))) return json(res, 404, { error: 'Jupiter has no route for this pair and amount right now.', code: 'NO_ROUTE' }), true
  if (r.status !== 200 || !b || !/^\d+$/.test(String(b.outAmount ?? '')) || b.inputMint !== inputMint || b.outputMint !== outputMint) return json(res, 502, { error: 'Jupiter’s quote could not be read just now.', code: 'UNREADABLE', detail: r.error ?? 'unexpected answer shape' }), true

  const outDec = side === 'buy' ? stock.decimals : coin.decimals
  const outSym = side === 'buy' ? stock.symbol : coin.symbol
  const id = 'jq_' + crypto.randomBytes(9).toString('base64url')
  issued.set(id, { at: now, quoteResponse: b, feeAccount: useFee ? fee.account : null, ticker })
  for (const [k, v] of issued) if (now - v.at > QUOTE_LIFE_MS * 2) issued.delete(k)
  const pf = b.platformFee && /^\d+$/.test(String(b.platformFee.amount ?? '')) ? b.platformFee : null
  // The fee is always paid in the SOL/USDC side (the fee account's mint): on a sale that is the output,
  // as Jupiter's quote states it; on a purchase it is the input, bps of the amount paid.
  const feeRaw = side === 'sell' ? (pf ? BigInt(pf.amount) : null) : (BigInt(b.inAmount) * BigInt(bps)) / 10_000n
  return (
    json(
      res,
      200,
      {
        quote: {
          id,
          side,
          ticker,
          inSymbol: side === 'buy' ? coin.symbol : stock.symbol,
          outSymbol: outSym,
          inAmount: fmt(b.inAmount, inDec),
          outAmount: fmt(b.outAmount, outDec),
          minOut: fmt(b.otherAmountThreshold ?? b.outAmount, outDec),
          priceImpactPct: Number(b.priceImpactPct ?? 0) * 100,
          route: (b.routePlan ?? []).map((p) => ({ label: String(p?.swapInfo?.label ?? 'unknown'), percent: Number(p?.percent ?? 0) })),
          platformFee: useFee && feeRaw !== null ? { bps, amount: fmt(feeRaw, coin.decimals), symbol: coin.symbol } : null,
          feeNote: useFee ? null : fee.reason,
          slippageBps: Number(b.slippageBps ?? SLIPPAGE_BPS),
          contextSlot: b.contextSlot ?? null,
          expiresAt: new Date(now + QUOTE_LIFE_MS).toISOString(),
          source: 'Jupiter',
        },
      },
      { 'Cache-Control': 'no-store' },
    ),
    true
  )
}

/* --------------------------------------------------------------- swap --- */

export async function handleJupiterSwap(req, res, geo) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
  if (!geo?.allowed) return json(res, 451, region(geo)), true
  const body = await readJson(req, 4_000)
  const rec = issued.get(String(body?.quoteId ?? ''))
  if (!rec || Date.now() - rec.at > QUOTE_LIFE_MS) return json(res, 410, { error: 'This quote has run out. Get a new one.', code: 'EXPIRED' }), true
  const user = String(body?.userPublicKey ?? '')
  if (!isSolanaAddress(user)) return json(res, 400, { error: 'userPublicKey must be a Solana address', code: 'BAD_USER' }), true
  if (!allowIp('swap', clientIp(req), SWAPS_PER_IP_MIN)) return json(res, 429, { error: 'Too many swaps from this address. Wait a minute.', code: 'RATE_LIMITED' }, { 'Retry-After': '30' }), true
  const payload = {
    quoteResponse: rec.quoteResponse,
    userPublicKey: user,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 1_000_000, priorityLevel: 'high' } },
    ...(rec.feeAccount ? { feeAccount: rec.feeAccount } : {}),
  }
  const r = await jup('/swap/v1/swap', { method: 'POST', body: JSON.stringify(payload) })
  if (r.status === 429) return json(res, 429, { error: 'Jupiter is busy for the moment. Try again in a minute.', code: 'BUSY' }), true
  const tx = r.body?.swapTransaction
  if (r.status !== 200 || typeof tx !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(tx)) return json(res, 502, { error: 'Jupiter could not build the swap just now.', code: 'UNREADABLE', detail: r.error ?? 'unexpected answer shape' }), true
  return json(res, 200, { swapTransaction: tx, lastValidBlockHeight: r.body.lastValidBlockHeight ?? null, feeAccount: rec.feeAccount }), true
}
