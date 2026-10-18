// The /api/solana/* routes, mounted by server.mjs (and the Vite dev middleware):
//
//   POST /api/solana/rpc                       a narrow JSON-RPC proxy for the browser (wallet pay and
//                                              swap status), so the page talks only to this site.
//                                              Allowed: getLatestBlockhash, getSignatureStatuses,
//                                              getBalance, getTokenAccountsByOwner, getAccountInfo,
//                                              sendTransaction. Rate limited per IP.
//   GET  /api/solana/pay/find?quote=<id>       Solana Pay: signatures that touched the quote's reference
//                                              key (newest first); the page then posts one to the usual
//                                              verify endpoint. Rate limited per IP.
//   GET  /api/solana/jupiter/quote?…           Jupiter quote proxy (jupiter.mjs), geo-gated.
//   POST /api/solana/jupiter/swap {quoteId, userPublicKey}   Jupiter swap transaction, geo-gated.

import { clientIp, json, readJson } from './http.mjs'
import { findQuote } from './billing.mjs'
import { findByReference } from './solana-pay.mjs'
import { isSolanaAddress, solanaRpc } from './solana.mjs'
import { handleJupiterQuote, handleJupiterSwap } from './jupiter.mjs'

const READ_METHODS = new Set(['getLatestBlockhash', 'getSignatureStatuses', 'getBalance', 'getTokenAccountsByOwner', 'getAccountInfo'])
const SEND_METHODS = new Set(['sendTransaction'])
export const RPC_READS_PER_MIN = 120
export const RPC_SENDS_PER_MIN = 10
export const FINDS_PER_MIN = 40

const hits = new Map() // `${bucket}:${ip}` -> timestamps
function allow(bucket, ip, max) {
  const now = Date.now()
  const k = `${bucket}:${ip}`
  const list = (hits.get(k) ?? []).filter((t) => now - t < 60_000)
  if (list.length >= max) return false
  list.push(now)
  hits.set(k, list)
  if (hits.size > 50_000) for (const [key, l] of hits) if (!l.some((t) => now - t < 60_000)) hits.delete(key)
  return true
}
export const resetSolanaLimitsForTest = () => hits.clear()

/** Params the proxy lets through for each method: shapes only, no arbitrary options. */
function cleanParams(method, params) {
  if (!Array.isArray(params)) return null
  const commitment = (o) => (o && ['processed', 'confirmed', 'finalized'].includes(o.commitment) ? o.commitment : 'confirmed')
  switch (method) {
    case 'getLatestBlockhash':
      return [{ commitment: commitment(params[0]) }]
    case 'getSignatureStatuses': {
      const sigs = params[0]
      if (!Array.isArray(sigs) || !sigs.length || sigs.length > 10 || !sigs.every((s) => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(s))) return null
      return [sigs, { searchTransactionHistory: params[1]?.searchTransactionHistory === true }]
    }
    case 'getBalance':
    case 'getAccountInfo':
      if (!isSolanaAddress(params[0])) return null
      return method === 'getBalance' ? [params[0], { commitment: commitment(params[1]) }] : [params[0], { commitment: commitment(params[1]), encoding: params[1]?.encoding === 'jsonParsed' ? 'jsonParsed' : 'base64' }]
    case 'getTokenAccountsByOwner': {
      const f = params[1]
      if (!isSolanaAddress(params[0]) || !f || typeof f !== 'object') return null
      const filter = f.mint && isSolanaAddress(f.mint) ? { mint: f.mint } : f.programId && isSolanaAddress(f.programId) ? { programId: f.programId } : null
      return filter ? [params[0], filter, { commitment: commitment(params[2]), encoding: 'jsonParsed' }] : null
    }
    case 'sendTransaction': {
      const tx = params[0]
      // A serialized transaction is at most 1232 bytes: about 1644 base64 characters.
      if (typeof tx !== 'string' || tx.length > 1700 || !/^[A-Za-z0-9+/]+={0,2}$/.test(tx)) return null
      return [tx, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 }]
    }
    default:
      return null
  }
}

async function handleRpc(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
  const body = await readJson(req, 4_000)
  const method = String(body?.method ?? '')
  const id = typeof body?.id === 'number' || typeof body?.id === 'string' ? body.id : 1
  if (!READ_METHODS.has(method) && !SEND_METHODS.has(method)) return json(res, 400, { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not allowed through this proxy' } }), true
  const params = cleanParams(method, body?.params)
  if (!params) return json(res, 400, { jsonrpc: '2.0', id, error: { code: -32602, message: 'invalid params' } }), true
  const ip = clientIp(req)
  const send = SEND_METHODS.has(method)
  if (!allow(send ? 'send' : 'read', ip, send ? RPC_SENDS_PER_MIN : RPC_READS_PER_MIN)) return json(res, 429, { jsonrpc: '2.0', id, error: { code: 429, message: 'Too many requests from this address. Wait a minute.' } }, { 'Retry-After': '30' }), true
  try {
    const result = await solanaRpc(method, params, { timeoutMs: send ? 15_000 : 8_000 })
    return json(res, 200, { jsonrpc: '2.0', id, result }), true
  } catch (e) {
    // A node's own refusal (e.g. a failed preflight) goes back as JSON-RPC; an outage is a 502.
    if (e?.final) return json(res, 200, { jsonrpc: '2.0', id, error: { code: e.code ?? -32000, message: String(e.message).slice(0, 300), data: e.data?.logs ? { logs: e.data.logs.slice(-12) } : undefined } }), true
    return json(res, 502, { jsonrpc: '2.0', id, error: { code: -32000, message: 'Solana could not be reached just now.' } }), true
  }
}

async function handleFind(req, res, url) {
  if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
  const quote = findQuote(String(url.searchParams.get('quote') ?? ''))
  if (!quote || !quote.reference) return json(res, 404, { error: 'No such Solana quote.' }), true
  if (!allow('find', clientIp(req), FINDS_PER_MIN)) return json(res, 429, { error: 'Too many checks from this address. Wait a minute.' }, { 'Retry-After': '20' }), true
  try {
    const found = await findByReference(quote.reference, { limit: 10 })
    return json(res, 200, { reference: quote.reference, paid: !!quote.paidAt, signatures: found }), true
  } catch (e) {
    return json(res, 502, { error: `Solana could not be read just now (${String(e?.message ?? e).slice(0, 120)}). Try again in a minute.` }), true
  }
}

/** Answers /api/solana/* ; false when the path is not one of these routes. */
export async function handleSolana(req, res, url, geo) {
  const p = url.pathname
  if (p === '/api/solana/rpc') return handleRpc(req, res)
  if (p === '/api/solana/pay/find') return handleFind(req, res, url)
  if (p === '/api/solana/jupiter/quote') return handleJupiterQuote(req, res, url, geo)
  if (p === '/api/solana/jupiter/swap') return handleJupiterSwap(req, res, geo)
  return false
}
