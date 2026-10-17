// Solana over plain JSON-RPC and fetch, with no SDK: RPC failover, base58, associated token account
// derivation (program-derived addresses need an ed25519 "off the curve" check, done here with BigInt),
// and decoding of the one account layout the tracker and Gully Pay read (Pyth's PriceUpdateV2).
//
// RPC URLs: GULLY_RPC_SOLANA (comma-separated; the owner's private dRPC URL goes first on the server),
// then the public defaults below (each answered getSlot / getAccountInfo when checked; see
// solana-research.md). Automatic failover, the same pattern as rpcBatch in tracker.mjs and rpc in
// payments.mjs: a URL that times out, answers an HTTP error, rate-limits or returns something that is not
// JSON-RPC steps aside for a cool-off of 30 s doubling to 10 min, and is tried again only when no healthy
// URL is left. A plain JSON-RPC error from a working node (bad params) does not cool the node.

import crypto from 'node:crypto'

// Checked 2026-10-17: these answer keyless (solana.drpc.org refuses its free plan; Ankr and OnFinality need keys).
export const SOLANA_PUBLIC_RPCS = ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com']

/** Program and mint addresses used across the Solana modules (every one checked on mainnet). */
export const SYSTEM_PROGRAM = '11111111111111111111111111111111'
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
export const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'
export const WSOL_MINT = 'So11111111111111111111111111111111111111112'

/* ---------------------------------------------------------------- rpc --- */

const cooling = new Map() // url -> { until, strikes }

export function solanaRpcUrls() {
  const env = String(process.env.GULLY_RPC_SOLANA ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
  // In tests (an env list is set and SOLANA_RPC_ONLY_ENV=1) the public defaults are never reached.
  return [...new Set([...env, ...(env.length && process.env.SOLANA_RPC_ONLY_ENV === '1' ? [] : SOLANA_PUBLIC_RPCS)])]
}

/** URLs in the order to try: healthy first in configured order, then cooling ones, soonest back first. */
export function solanaRpcOrder() {
  const now = Date.now()
  const all = solanaRpcUrls()
  const healthy = all.filter((u) => (cooling.get(u)?.until ?? 0) <= now)
  const cold = all.filter((u) => (cooling.get(u)?.until ?? 0) > now).sort((a, b) => cooling.get(a).until - cooling.get(b).until)
  return [...healthy, ...cold]
}

function strike(url) {
  const c = cooling.get(url) ?? { until: 0, strikes: 0 }
  c.strikes = Math.min(c.strikes + 1, 6)
  c.until = Date.now() + Math.min(30_000 * 2 ** (c.strikes - 1), 600_000)
  cooling.set(url, c)
}

/** Test hook: forget which URLs are cooling. */
export const resetSolanaRpcForTest = () => cooling.clear()
/** For the admin view and the tests: which URLs are cooling now. */
export const solanaRpcCooling = () => [...cooling.entries()].filter(([, c]) => c.until > Date.now()).map(([u, c]) => ({ host: safeHost(u), until: new Date(c.until).toISOString(), strikes: c.strikes }))
const safeHost = (u) => {
  try {
    return new URL(u).host
  } catch {
    return 'invalid url'
  }
}

const NODE_FAULT = /rate|limit|too many|quota|api ?key|unauthori[sz]ed|forbidden|capacity|upgrade|not available|disabled|long-term storage|unsupported/i

async function post(url, body, timeoutMs) {
  let res
  try {
    res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    throw Object.assign(new Error(`${safeHost(url)}: ${e?.name === 'TimeoutError' ? 'timed out' : 'unreachable'}`), { nodeFault: true })
  }
  const j = await res.json().catch(() => null)
  // Some nodes answer a JSON-RPC error with an HTTP 4xx; the error itself is then the answer. A 429, a
  // 5xx or a page that is not JSON-RPC is the node's fault.
  const rpcShaped = j && typeof j === 'object' && (Array.isArray(j) || 'result' in j || 'error' in j)
  if (!rpcShaped || res.status === 429 || res.status >= 500) throw Object.assign(new Error(`${safeHost(url)}: HTTP ${res.status}${j?.error?.message ? ` ${String(j.error.message).slice(0, 120)}` : ''}`), { nodeFault: true })
  return j
}

/**
 * One JSON-RPC call on Solana mainnet, with failover. Resolves to `result`; throws the last error.
 * A JSON-RPC error that names a limit or a disabled method moves on to the next node; any other
 * JSON-RPC error (bad params, a transaction the node refuses) is the answer and is thrown at once.
 */
export async function solanaRpc(method, params = [], { timeoutMs = 8_000 } = {}) {
  let last
  for (const url of solanaRpcOrder()) {
    try {
      const j = await post(url, { jsonrpc: '2.0', id: 1, method, params }, timeoutMs)
      if (j.error) {
        const msg = String(j.error.message ?? 'RPC error')
        const err = Object.assign(new Error(msg), { code: j.error.code, data: j.error.data, nodeFault: NODE_FAULT.test(msg) || j.error.code === -32005 || j.error.code === 429 })
        if (!err.nodeFault) {
          cooling.delete(url)
          throw Object.assign(err, { final: true })
        }
        throw err
      }
      if (!('result' in j)) throw Object.assign(new Error(`${safeHost(url)}: no result`), { nodeFault: true })
      cooling.delete(url)
      return j.result
    } catch (e) {
      if (e?.final) throw e
      last = e
      strike(url)
    }
  }
  throw last ?? new Error('no Solana RPC configured')
}

/** Several reads in one JSON-RPC batch, with the same failover. Resolves to the results in order (an entry is { error } when that call failed). */
export async function solanaRpcBatch(calls, { timeoutMs = 10_000 } = {}) {
  if (!calls.length) return []
  let last
  for (const url of solanaRpcOrder()) {
    try {
      const j = await post(url, calls.map(([method, params], id) => ({ jsonrpc: '2.0', id, method, params })), timeoutMs)
      if (!Array.isArray(j)) {
        const msg = String(j?.error?.message ?? 'not a batch answer')
        throw Object.assign(new Error(`${safeHost(url)}: ${msg}`), { nodeFault: true })
      }
      const byId = new Map(j.map((r) => [r.id, r]))
      const out = calls.map((_, i) => {
        const r = byId.get(i)
        if (!r) return { error: 'no answer' }
        return r.error ? { error: String(r.error.message ?? 'RPC error') } : { result: r.result }
      })
      // A node that refuses every call of the batch for a limit is not healthy.
      if (out.every((r) => r.error && NODE_FAULT.test(r.error))) throw Object.assign(new Error(`${safeHost(url)}: ${out[0].error}`), { nodeFault: true })
      cooling.delete(url)
      return out
    } catch (e) {
      last = e
      strike(url)
    }
  }
  throw last ?? new Error('no Solana RPC configured')
}

/* ------------------------------------------------------------- base58 --- */

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const MAP = new Map([...ALPHABET].map((c, i) => [c, BigInt(i)]))

export function b58encode(bytes) {
  const b = Uint8Array.from(bytes)
  let zeros = 0
  while (zeros < b.length && b[zeros] === 0) zeros++
  let n = 0n
  for (const x of b) n = (n << 8n) | BigInt(x)
  let s = ''
  while (n > 0n) {
    s = ALPHABET[Number(n % 58n)] + s
    n /= 58n
  }
  return '1'.repeat(zeros) + s
}

/** Decodes base58; throws on a character outside the alphabet. */
export function b58decode(str) {
  const s = String(str)
  let zeros = 0
  while (zeros < s.length && s[zeros] === '1') zeros++
  let n = 0n
  for (const c of s) {
    const v = MAP.get(c)
    if (v === undefined) throw new Error('not base58')
    n = n * 58n + v
  }
  const out = []
  while (n > 0n) {
    out.unshift(Number(n & 255n))
    n >>= 8n
  }
  return Uint8Array.from([...new Array(zeros).fill(0), ...out])
}

/** A 32-byte public key in base58 (any account address). */
export function isSolanaAddress(v) {
  if (typeof v !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return false
  try {
    return b58decode(v).length === 32
  } catch {
    return false
  }
}

/** A transaction signature: 64 bytes in base58 (87 or 88 characters, occasionally fewer). */
export function isSolanaSignature(v) {
  if (typeof v !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(v)) return false
  try {
    return b58decode(v).length === 64
  } catch {
    return false
  }
}

/** A fresh Solana Pay reference: 32 random bytes as a public key (read-only, never signs). */
export const newReference = () => b58encode(crypto.randomBytes(32))

/* -------------------------------------------- program-derived addresses --- */

const P = 2n ** 255n - 19n
const D = (-121665n * modInv(121666n)) % P
const SQRT_M1 = modPow(2n, (P - 1n) / 4n, P)
function mod(a) {
  const r = a % P
  return r >= 0n ? r : r + P
}
function modPow(b, e, m) {
  let r = 1n
  b %= m
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m
    b = (b * b) % m
    e >>= 1n
  }
  return r
}
function modInv(a) {
  return modPow(((a % P) + P) % P, P - 2n, P)
}

/** Whether 32 bytes decode to a point on ed25519 (RFC 8032 decoding). A PDA must NOT be on the curve. */
export function isOnCurve(bytes) {
  const b = Uint8Array.from(bytes)
  if (b.length !== 32) return false
  const sign = b[31] >> 7
  const yb = Uint8Array.from(b)
  yb[31] &= 0x7f
  let y = 0n
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(yb[i])
  if (y >= P) return false
  const y2 = mod(y * y)
  const u = mod(y2 - 1n)
  const v = mod(D * y2 + 1n)
  const v3 = mod(v * v * v)
  const v7 = mod(v3 * v3 * v)
  let x = mod(u * v3 * modPow(mod(u * v7), (P - 5n) / 8n, P))
  const vx2 = mod(v * x * x)
  if (vx2 === u) {
    /* root found */
  } else if (vx2 === mod(-u)) x = mod(x * SQRT_M1)
  else return false
  if (x === 0n && sign === 1) return false
  return true
}

const PDA_MARKER = Buffer.from('ProgramDerivedAddress')

/** findProgramAddress: the first bump from 255 down whose hash is off the curve. Returns [address, bump]. */
export function findProgramAddress(seeds, programId) {
  const prog = b58decode(programId)
  for (let bump = 255; bump >= 0; bump--) {
    const h = crypto.createHash('sha256')
    for (const s of seeds) h.update(s)
    h.update(Uint8Array.of(bump))
    h.update(prog)
    h.update(PDA_MARKER)
    const out = h.digest()
    if (!isOnCurve(out)) return [b58encode(out), bump]
  }
  throw new Error('no viable bump')
}

/** The associated token account of `owner` for `mint` under `tokenProgram` (classic SPL Token by default). */
export function associatedTokenAddress(owner, mint, tokenProgram = TOKEN_PROGRAM) {
  return findProgramAddress([b58decode(owner), b58decode(tokenProgram), b58decode(mint)], ASSOCIATED_TOKEN_PROGRAM)[0]
}

/* ----------------------------------------------------- Pyth price update --- */

// Pyth's pull-oracle price account (PriceUpdateV2, owned by the Pyth Solana Receiver program
// rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ). Borsh layout:
//   0   8  anchor discriminator
//   8  32  write_authority
//  40   1  verification_level: 0 = Partial { num_signatures: u8 } (one more byte), 1 = Full
//   then price_message: feed_id [32], price i64, conf u64, exponent i32, publish_time i64,
//        prev_publish_time i64, ema_price i64, ema_conf u64; then posted_slot u64.
export const PYTH_RECEIVER_PROGRAM = 'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ'
export const PRICE_UPDATE_V2_DISCRIMINATOR = '22f123639d7ef4cd'

/** Decodes a PriceUpdateV2 account (bytes). Returns null when the bytes are not one. */
export function decodePriceUpdateV2(bytes) {
  const b = Buffer.from(bytes)
  if (b.length < 8 + 32 + 1 + 32 + 8 * 2 + 4 + 8 * 5) return null
  if (b.subarray(0, 8).toString('hex') !== PRICE_UPDATE_V2_DISCRIMINATOR) return null
  const level = b[40]
  if (level !== 0 && level !== 1) return null
  let o = level === 0 ? 42 : 41
  const feedId = '0x' + b.subarray(o, o + 32).toString('hex')
  o += 32
  const price = b.readBigInt64LE(o)
  const conf = b.readBigUInt64LE(o + 8)
  const exponent = b.readInt32LE(o + 16)
  const publishTime = Number(b.readBigInt64LE(o + 20))
  const prevPublishTime = Number(b.readBigInt64LE(o + 28))
  const emaPrice = b.readBigInt64LE(o + 36)
  const emaConf = b.readBigUInt64LE(o + 44)
  const postedSlot = Number(b.readBigUInt64LE(o + 52))
  return { verification: level === 1 ? 'full' : 'partial', feedId, price, conf, exponent, publishTime, prevPublishTime, emaPrice, emaConf, postedSlot }
}

/** A Pyth integer price with its exponent as a JS number (prices here are far inside double precision). */
export const pythNumber = (price, exponent) => Number(price) * 10 ** exponent

/** getAccountInfo for several accounts as raw bytes (null for a missing account), in one batch. */
export async function readAccounts(addresses, { commitment = 'confirmed' } = {}) {
  const out = []
  for (let i = 0; i < addresses.length; i += 100) {
    const slice = addresses.slice(i, i + 100)
    const r = await solanaRpc('getMultipleAccounts', [slice, { encoding: 'base64', commitment }], { timeoutMs: 10_000 })
    const list = r?.value
    if (!Array.isArray(list) || list.length !== slice.length) throw new Error('getMultipleAccounts: unexpected answer')
    for (const a of list) out.push(a ? { owner: a.owner, lamports: a.lamports, data: Buffer.from(a.data?.[0] ?? '', 'base64') } : null)
  }
  return out
}
