// Solana end to end, with no upstream call: RPC failover, Pyth account decoding (a real mainnet fixture),
// PDA/ATA derivation, pool-account decoders, the tracker's Solana rows and trust rules, history and movers,
// the Jupiter quote/swap proxy (fee on and off, geo 451), Solana Pay URLs, and payment verification for
// invoices and plans (right recipient, wrong recipient, wrong mint, under-payment, reuse, not finalized).
//
//   npm run test:solana                (TEST_PORT overrides the port, default 8797)
//
// The real server runs IN THIS PROCESS with a temporary DATA_DIR. Local stubs stand in for Solana JSON-RPC
// (two URLs: the first always fails, to prove failover), DexScreener, Pyth Hermes and Jupiter. (The EVM chains'
// part of /api/tracker is not under test and may try their public nodes; nothing Solana leaves this machine.)

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { makeChecker, makeClient } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8797
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-solana-'))
const ADMIN = crypto.randomBytes(24).toString('hex')
const t = makeChecker()
const { check } = t
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const fixture = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'pyth-sol-usd.json'), 'utf8'))
const TABLE = JSON.parse(fs.readFileSync(path.join(here, '..', 'server', 'data', 'solana-stocks.json'), 'utf8'))

const S = await import('../server/solana.mjs')
const { b58encode, b58decode, associatedTokenAddress, findProgramAddress, decodePriceUpdateV2, pythNumber } = S
const rand32 = () => b58encode(crypto.randomBytes(32))
const randSig = () => b58encode(crypto.randomBytes(64))

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
const WSOL = 'So11111111111111111111111111111111111111112'
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const SOL_FEED = '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE'
const TREASURY = rand32()
const TREASURY_USDC = associatedTokenAddress(TREASURY, USDC)
const FEE_WALLET = rand32()
const EVM_TREASURY = privateKeyToAccount(generatePrivateKey()).address.toLowerCase()

/* ------------------------------------------------------------- fixtures --- */

// The real SOL/USD account, with its publish time moved to now so it is fresh for the quote.
function pythAccount(base64, { feedId, price, expo = -8, publishTime = Math.floor(Date.now() / 1000) - 5 } = {}) {
  const b = Buffer.from(base64, 'base64')
  const o = b[40] === 0 ? 42 : 41
  if (feedId) Buffer.from(feedId.replace(/^0x/, ''), 'hex').copy(b, o)
  if (price !== undefined) b.writeBigInt64LE(BigInt(price), o + 32)
  b.writeInt32LE(expo, o + 48)
  b.writeBigInt64LE(BigInt(publishTime), o + 52)
  return b
}
const SOL_PRICE = 150_00000000n // $150, exponent -8

// Pool accounts: a Whirlpool (stock 0, against USDC), a Raydium CLMM (stock 1, against SOL), a DLMM (stock 2).
const stocks = TABLE.stocks
const [s0, s1, s2, s3] = stocks
function u128(b, o, v) {
  b.writeBigUInt64LE(v & ((1n << 64n) - 1n), o)
  b.writeBigUInt64LE(v >> 64n, o + 8)
}
const sqrtX64 = (p) => BigInt(Math.round(Math.sqrt(p) * 2 ** 32)) << 32n
function whirlpool(mintA, mintB, priceAinB_base) {
  const b = Buffer.alloc(653)
  u128(b, 65, sqrtX64(priceAinB_base))
  b58decode(mintA).forEach((x, i) => (b[101 + i] = x))
  b58decode(mintB).forEach((x, i) => (b[181 + i] = x))
  return b
}
function raydium(mint0, mint1, price01_base) {
  const b = Buffer.alloc(1544)
  b58decode(mint0).forEach((x, i) => (b[73 + i] = x))
  b58decode(mint1).forEach((x, i) => (b[105 + i] = x))
  u128(b, 253, sqrtX64(price01_base))
  return b
}
function dlmm(mintX, mintY, binStep, activeId) {
  const b = Buffer.alloc(904)
  b.writeInt32LE(activeId, 76)
  b.writeUInt16LE(binStep, 80)
  b58decode(mintX).forEach((x, i) => (b[88 + i] = x))
  b58decode(mintY).forEach((x, i) => (b[120 + i] = x))
  return b
}
const POOL0 = rand32()
const POOL1 = rand32()
const POOL2 = rand32()

/* -------------------------------------------------------- Solana stub --- */

const accounts = new Map() // address -> { owner, data: Buffer, parsed? }
const txs = new Map() // sig -> { tx, finalized }
const refSigs = new Map() // reference -> [sig]
let rpcCalls = 0
function setAccount(addr, owner, data, parsed = null) {
  accounts.set(addr, { owner, data, parsed })
}
// Fair share prices: Pyth through Hermes (with a key) for tokens with a Pyth id, the issuer's quote for the rest.
const SHARE = { [s0.ticker]: 200, [s1.ticker]: 100, [s2.ticker]: 50, ...(s3 ? { [s3.ticker]: 10 } : {}) }
const NO_PYTH = stocks.find((s) => !s.pythFeedId)
setAccount(SOL_FEED, 'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ', pythAccount(fixture.base64, { price: SOL_PRICE }))
// Mints: a multiplier of 1.02 on stock 0 (a dividend), 1 elsewhere.
for (const s of stocks) setAccount(s.token, 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', Buffer.alloc(82), { type: 'mint', info: { decimals: s.decimals, extensions: [{ extension: 'scaledUiAmountConfig', state: { multiplier: s === s0 ? '1.02' : '1', newMultiplier: '1', newMultiplierEffectiveTimestamp: 0 } }] } })
// Stock 0 on chain at 204.0 * 1.001 (in line); stock 1 at 0.6 SOL = $90 vs $100 fair (-10%: a discount);
// stock 2 at 30% under fair in a thin pool (still "thin"); stock 3 has no pool.
const p0 = 204 * 1.001
setAccount(POOL0, 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', whirlpool(s0.token, USDC, p0 * 10 ** (6 - s0.decimals)))
setAccount(POOL1, 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', raydium(WSOL < s1.token ? WSOL : s1.token, WSOL < s1.token ? s1.token : WSOL, WSOL < s1.token ? (1 / 0.6) * 10 ** (s1.decimals - 9) : 0.6 * 10 ** (9 - s1.decimals)))
const bin = Math.round(Math.log(35 * 10 ** (6 - s2.decimals)) / Math.log(1 + 25 / 10_000))
setAccount(POOL2, 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', dlmm(s2.token, USDC, 25, bin))
// The fee wallet has a USDC account (fee on USDC swaps) but none for wSOL.
setAccount(associatedTokenAddress(FEE_WALLET, USDC), TOKEN, Buffer.alloc(165))
setAccount(FEE_WALLET, '11111111111111111111111111111111', Buffer.alloc(0))

const enc = (a, encoding) => (encoding === 'jsonParsed' && a.parsed ? { owner: a.owner, lamports: 1, executable: false, data: { parsed: a.parsed, program: 'spl-token-2022' } } : { owner: a.owner, lamports: 1, executable: false, data: [a.data.toString('base64'), 'base64'] })

function solanaAnswer(q) {
  const p = q.params ?? []
  switch (q.method) {
    case 'getMultipleAccounts':
      return { context: { slot: 1 }, value: p[0].map((k) => (accounts.has(k) ? enc(accounts.get(k), p[1]?.encoding) : null)) }
    case 'getAccountInfo':
      return { context: { slot: 1 }, value: accounts.has(p[0]) ? enc(accounts.get(p[0]), p[1]?.encoding) : null }
    case 'getTransaction': {
      const x = txs.get(p[0])
      if (!x) return null
      return p[1]?.commitment === 'finalized' && !x.finalized ? null : x.tx
    }
    case 'getSignatureStatuses':
      return { context: { slot: 1 }, value: p[0].map((s) => (txs.has(s) ? { confirmationStatus: txs.get(s).finalized ? 'finalized' : 'confirmed', err: null, slot: 5 } : null)) }
    case 'getSignaturesForAddress':
      return (refSigs.get(p[0]) ?? []).map((signature) => ({ signature, slot: 5, err: null, confirmationStatus: 'confirmed', blockTime: Math.floor(Date.now() / 1000) }))
    case 'getLatestBlockhash':
      return { context: { slot: 1 }, value: { blockhash: rand32(), lastValidBlockHeight: 100 } }
    case 'getBalance':
      return { context: { slot: 1 }, value: 5 }
    case 'getSlot':
      return 1
    default:
      return undefined
  }
}

const listen = (handler) => new Promise((r) => { const srv = http.createServer(handler); srv.listen(0, '127.0.0.1', () => r(srv)) })
const readBody = (req) => new Promise((r) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => r(b)) })
const sendJson = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }

let badHits = 0
const badRpc = await listen((req, res) => { badHits++; res.writeHead(503); res.end('busy') })
const goodRpc = await listen(async (req, res) => {
  rpcCalls++
  const q = JSON.parse(await readBody(req))
  const one = (x) => { const result = solanaAnswer(x); return result === undefined ? { jsonrpc: '2.0', id: x.id, error: { code: -32601, message: 'Method not found' } } : { jsonrpc: '2.0', id: x.id, result } }
  sendJson(res, 200, Array.isArray(q) ? q.map(one) : one(q))
})

/* ---------------------------------------------- DexScreener / Hermes stub --- */

const pair = (s, addr, dexId, labels, other, priceUsd, liq) => ({ chainId: 'solana', dexId, labels, url: `https://dexscreener.com/solana/${addr}`, pairAddress: addr, baseToken: { address: s.token, symbol: s.symbol }, quoteToken: other, priceNative: '1', priceUsd: String(priceUsd), liquidity: { usd: liq }, volume: { h24: 1000 } })
const dexPairs = [
  pair(s0, POOL0, 'orca', [], { address: USDC, symbol: 'USDC' }, 210, 2_000_000),
  pair(s1, POOL1, 'raydium', ['CLMM'], { address: WSOL, symbol: 'SOL' }, 95, 500_000),
  pair(s2, POOL2, 'meteora', ['DLMM'], { address: USDC, symbol: 'USDC' }, 36, 4_000),
]
let dexHits = 0
const dexStub = await listen((req, res) => { dexHits++; sendJson(res, 200, req.url.includes('token-pairs') ? [] : dexPairs) })
let hermesHits = 0
const hermesStub = await listen((req, res) => {
  hermesHits++
  if (req.headers.authorization !== 'Bearer test-pyth-key') return sendJson(res, 401, { error: 'unauthorized' })
  const ids = [...new URL(req.url, 'http://x').searchParams.getAll('ids[]')]
  const parsed = ids.map((id) => {
    const s = stocks.find((x) => x.pythFeedId?.replace(/^0x/, '') === id)
    return { id, price: { price: String(Math.round((SHARE[s?.ticker] ?? 42) * 1e5)), conf: '100', expo: -5, publish_time: Math.floor(Date.now() / 1000) - 3 } }
  })
  sendJson(res, 200, { parsed })
})

const backedStub = await listen((req, res) => {
  const sym = new URL(req.url, 'http://x').searchParams.get('symbol')
  sendJson(res, 200, { quote: SHARE[sym] ?? 42, currency: 'USD', timestamp: new Date(Date.now() - 60_000).toISOString() })
})

/* ------------------------------------------------------------ Jupiter stub --- */

const jupSeen = { quotes: [], swaps: [] }
const jupStub = await listen(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/swap/v1/quote') {
    const q = Object.fromEntries(u.searchParams)
    jupSeen.quotes.push(q)
    const out = String(BigInt(q.amount) * 3n)
    const fee = q.platformFeeBps ? String((BigInt(q.amount) * BigInt(q.platformFeeBps)) / 10_000n) : null
    return sendJson(res, 200, { inputMint: q.inputMint, inAmount: q.amount, outputMint: q.outputMint, outAmount: out, otherAmountThreshold: String((BigInt(out) * 995n) / 1000n), swapMode: 'ExactIn', slippageBps: Number(q.slippageBps), platformFee: fee ? { amount: fee, feeBps: Number(q.platformFeeBps) } : null, priceImpactPct: '0.0012', routePlan: [{ swapInfo: { label: 'Orca', ammKey: POOL0 }, percent: 100 }], contextSlot: 1 })
  }
  if (u.pathname === '/swap/v1/swap' && req.method === 'POST') {
    const body = JSON.parse(await readBody(req))
    jupSeen.swaps.push(body)
    return sendJson(res, 200, { swapTransaction: Buffer.from('unsigned-tx-bytes').toString('base64'), lastValidBlockHeight: 123 })
  }
  sendJson(res, 404, { error: 'not found' })
})

/* ------------------------------------------------------------ start server --- */

const url = (srv) => `http://127.0.0.1:${srv.address().port}`
Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: path.join(tmp, 'no-dist'),
  ADMIN_TOKEN: ADMIN,
  TRACKER_LOOP: 'off',
  DEEPCORE_LOOP: 'off',
  GULLY_TREASURY_ADDRESS: EVM_TREASURY,
  GULLY_SOLANA_TREASURY: TREASURY,
  GULLY_RPC_SOLANA: `${url(badRpc)},${url(goodRpc)}`,
  SOLANA_RPC_ONLY_ENV: '1',
  SOLANA_DEXSCREENER: `${url(dexStub)}/tokens/v1/solana`,
  SOLANA_DEXSCREENER_PAIRS: `${url(dexStub)}/token-pairs/v1/solana`,
  PYTH_HERMES: url(hermesStub),
  PYTH_API_KEY: 'test-pyth-key',
  XSTOCKS_API: url(backedStub),
  JUPITER_API: url(jupStub),
  // The EVM chains are not under test here: no price API for them (their Chainlink reads may still try public nodes).
  TRACKER_SKIP_APIS: '1',
})
for (const id of [4663, 56]) process.env[`GULLY_RPC_${id}`] = 'http://127.0.0.1:9'
delete process.env.JUPITER_FEE_BPS
delete process.env.JUPITER_FEE_ACCOUNT
delete process.env.VITE_JUPITER_FEE_BPS
delete process.env.VITE_JUPITER_FEE_ACCOUNT

await import('../server/server.mjs')
const { resetSolanaRpcForTest, solanaRpc, solanaRpcCooling } = S
const { recordSnapshotForTest } = await import('../server/tracker.mjs')
const { poolPrice, multiplierOf, bestSolanaPool } = await import('../server/solana-tracker.mjs')
const { solanaPayUrl, unitsToDecimal, SOLANA_CHAIN_ID } = await import('../server/solana-pay.mjs')
const { resetJupiterForTest } = await import('../server/jupiter.mjs')
await new Promise((r) => setTimeout(r, 300))

const anon = makeClient(BASE)
const admin = (p, method = 'GET', body) => fetch(BASE + p, { method, headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }))
const get = (p, headers = {}) => fetch(BASE + p, { headers }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }))
const post = (p, body, headers = {}) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'gully', ...headers }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }))

/** A finalized (or only confirmed) jsonParsed transaction paying `to` in `mint` (null: SOL). */
function addTx({ payer = rand32(), to = TREASURY, mint = USDC, amount, finalized = true, reference = null, err = null, blockTime = Math.floor(Date.now() / 1000) }) {
  const sig = randSig()
  let keys, meta
  if (!mint) {
    keys = [payer, to, '11111111111111111111111111111111', ...(reference ? [reference] : [])]
    meta = { err, fee: 5000, preBalances: [10_000_000_000, 1_000, 1, ...(reference ? [0] : [])], postBalances: [10_000_000_000 - Number(amount) - 5000, 1_000 + Number(amount), 1, ...(reference ? [0] : [])], preTokenBalances: [], postTokenBalances: [] }
  } else {
    const src = associatedTokenAddress(payer, mint)
    const dst = associatedTokenAddress(to, mint)
    keys = [payer, src, dst, mint, TOKEN, ...(reference ? [reference] : [])]
    const bal = (i, owner, amt) => ({ accountIndex: i, mint, owner, programId: TOKEN, uiTokenAmount: { amount: String(amt), decimals: 6 } })
    meta = { err, fee: 5000, preBalances: keys.map(() => 1), postBalances: keys.map(() => 1), preTokenBalances: [bal(1, payer, 10n ** 12n), bal(2, to, 5)], postTokenBalances: [bal(1, payer, 10n ** 12n - BigInt(amount)), bal(2, to, 5n + BigInt(amount))] }
  }
  txs.set(sig, { finalized, tx: { slot: 300_000_000, blockTime, meta, transaction: { signatures: [sig], message: { accountKeys: keys.map((k, i) => ({ pubkey: k, signer: i === 0, writable: i < 3 })) } } } })
  if (reference) refSigs.set(reference, [...(refSigs.get(reference) ?? []), sig])
  return sig
}

try {
  /* ----------------------------------------------------------- primitives --- */
  check('base58 round trip of the USDC mint', b58encode(b58decode(USDC)) === USDC)
  check('ATA derivation matches a real mainnet USDC account', associatedTokenAddress('5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9', USDC) === 'FzbcyEZ9m8xjtergWgWDq7mfPoHEbboBF791B6cTpzbq')
  check('PDA derivation gives Pyth’s sponsored SOL/USD account', findProgramAddress([Uint8Array.of(0, 0), Buffer.from(fixture.feedId.slice(2), 'hex')], 'pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT')[0] === SOL_FEED)
  const d = decodePriceUpdateV2(Buffer.from(fixture.base64, 'base64'))
  check('the recorded Pyth SOL/USD account decodes (feed id, full verification, exponent -8)', d && d.feedId === fixture.feedId && d.verification === 'full' && d.exponent === -8 && d.postedSlot > 0, JSON.stringify(d, (k, v) => (typeof v === 'bigint' ? String(v) : v)))
  check('the recorded price is a plausible SOL price', pythNumber(d.price, d.exponent) > 5 && pythNumber(d.price, d.exponent) < 5_000, String(pythNumber(d.price, d.exponent)))
  const partial = Buffer.concat([Buffer.from(fixture.base64, 'base64').subarray(0, 40), Buffer.from([0, 3]), Buffer.from(fixture.base64, 'base64').subarray(41, 133)])
  const dp = decodePriceUpdateV2(partial)
  check('a Partial-verification account (one extra byte) decodes to the same price', dp?.verification === 'partial' && dp.price === d.price && dp.publishTime === d.publishTime)
  const wrong = Buffer.from(fixture.base64, 'base64')
  wrong[0] ^= 1
  check('another account type (wrong discriminator) is refused', decodePriceUpdateV2(wrong) === null)

  check('Whirlpool decoder: price and mint check', Math.abs(poolPrice('whirlpool', accounts.get(POOL0).data, s0.token, USDC, (m) => (m === s0.token ? s0.decimals : 6)) - p0) < 0.01)
  check('Whirlpool decoder refuses a pool of other mints', poolPrice('whirlpool', accounts.get(POOL0).data, s0.token, USDT, (m) => (m === s0.token ? s0.decimals : 6)) === null)
  check('Raydium CLMM decoder: 0.6 SOL', Math.abs(poolPrice('raydium-clmm', accounts.get(POOL1).data, s1.token, WSOL, (m) => (m === s1.token ? s1.decimals : 9)) - 0.6) < 1e-6)
  check('Meteora DLMM decoder: about 35 USDC', Math.abs(poolPrice('meteora-dlmm', accounts.get(POOL2).data, s2.token, USDC, (m) => (m === s2.token ? s2.decimals : 6)) - 35) < 0.1)
  check('ScaledUiAmount: a scheduled multiplier applies once due', multiplierOf({ extensions: [{ extension: 'scaledUiAmountConfig', state: { multiplier: '1.0', newMultiplier: '1.05', newMultiplierEffectiveTimestamp: 100 } }] }, 200) === 1.05 && multiplierOf({ extensions: [{ extension: 'scaledUiAmountConfig', state: { multiplier: '1.0', newMultiplier: '1.05', newMultiplierEffectiveTimestamp: 300 } }] }, 200) === 1)
  check('bestSolanaPool prefers a sound, re-readable pool', bestSolanaPool(s0.token, dexPairs)?.pair === POOL0 && bestSolanaPool(s0.token, dexPairs).readable === true)

  /* ---------------------------------------------------------- RPC failover --- */
  resetSolanaRpcForTest()
  const before = badHits
  const slot = await solanaRpc('getSlot', [])
  check('RPC failover: the failing first URL is skipped and the second answers', slot === 1 && badHits === before + 1)
  check('the failing URL is cooling off', solanaRpcCooling().some((c) => c.host === new URL(url(badRpc)).host))
  const b2 = badHits
  await solanaRpc('getSlot', [])
  check('while it cools, the failing URL is not asked again', badHits === b2)
  let threw = false
  try {
    await solanaRpc('noSuchMethod', [])
  } catch (e) {
    threw = /Method not found/.test(e.message)
  }
  check('a JSON-RPC error from a healthy node is the answer (not a failover)', threw && !solanaRpcCooling().some((c) => c.host === new URL(url(goodRpc)).host))

  /* -------------------------------------------------------------- tracker --- */
  const tr = await get('/api/tracker')
  const chain = tr.data?.chains?.find((c) => c.key === 'solana')
  check('the tracker lists Solana as a chain', tr.status === 200 && chain?.name === 'Solana' && chain.sessionName === 'NYSE hours', JSON.stringify(tr.data?.chains))
  const rows = (tr.data?.rows ?? []).filter((r) => r.chain === 'solana')
  check(`every xStock in the table has a row (${stocks.length})`, rows.length === stocks.length)
  const r0 = rows.find((r) => r.ticker === s0.ticker)
  check('fair = Pyth share price × on-chain multiplier', Math.abs(r0.fair - 204) < 1e-6 && r0.multiplier === 1.02 && r0.fairSource === 'Pyth' && hermesHits > 0, `${r0.fair} ${r0.multiplier} ${r0.fairSource}`)
  if (NO_PYTH) {
    const rn = rows.find((r) => r.ticker === NO_PYTH.ticker)
    check('a token with no Pyth feed is priced by the issuer’s quote, and says so', rn.fair === 42 && rn.fairSource === 'xStocks (issuer)', `${rn.fair} ${rn.fairSource}`)
  }
  check('the Whirlpool is read on chain (onchainSource chain) and in line', r0.onchainSource === 'chain' && Math.abs(r0.onchain - p0) < 0.05 && r0.status === 'in-line' && r0.trusted === true, `${r0.onchain} ${r0.status}`)
  const r1 = rows.find((r) => r.ticker === s1.ticker)
  check('a Raydium CLMM pool against SOL is priced with Pyth SOL/USD: a 10% discount', r1.onchainSource === 'chain' && Math.abs(r1.onchain - 90) < 0.01 && r1.status === 'discount' && Math.abs(r1.gapPct + 10) < 0.01, `${r1.onchain} ${r1.status} ${r1.gapPct}`)
  const r2 = rows.find((r) => r.ticker === s2.ticker)
  check('a thin pool is shown but never flagged', r2.status === 'thin' && r2.trusted === false && /under the \$10,000/.test(r2.untrustedReason ?? ''), `${r2.status} ${r2.untrustedReason}`)
  if (s3) {
    const r3 = rows.find((r) => r.ticker === s3.ticker)
    check('a token with no pool is "no-pool", never zero', r3.status === 'no-pool' && r3.onchain === null && r3.gapPct === null)
  }
  // Implausible gap from an API-priced pool: unverified, gap withheld.
  const { assessRow } = await import('../server/tracker.mjs')
  const v = assessRow({ fair: 100, pool: { price: 130, liquidityUsd: 5_000_000, priced: 'api', source: 'DexScreener', pricedAt: Date.now() } })
  check('trust rules: a 30% gap read from an API is "unverified" with its gap withheld', v.status === 'unverified' && v.gapPct === null && Math.round(v.rawGapPct) === 30)
  const v2 = assessRow({ fair: 100, pool: { price: 600, liquidityUsd: 5_000_000, priced: 'chain' } })
  check('trust rules: 6x fair is a units error even on chain', v2.status === 'unverified' && /units/.test(v2.untrustedReason))

  // History, movers: a snapshot an hour ago and one now.
  const now = Date.now()
  recordSnapshotForTest([{ ...r1, gapPct: -6 }], now - 3_600_000 - 60_000)
  recordSnapshotForTest([r1], now)
  const h = await get(`/api/tracker/history?chain=solana&ticker=${s1.ticker}`)
  check('history records Solana snapshots', h.status === 200 && h.data.points.some((x) => x[1] === -6) && h.data.points.at(-1)[1] === -10, JSON.stringify(h.data))
  const mv = await get('/api/tracker/movers?window=1h&chain=solana')
  check('movers include the Solana token', mv.status === 200 && JSON.stringify(mv.data).includes(s1.ticker), JSON.stringify(mv.data).slice(0, 300))
  const { pageMeta } = await import('../server/seo.mjs')
  const meta = pageMeta('gullylabs.xyz', `/tracker/solana/${s0.ticker}`)
  check('the stock page /tracker/solana/<TICKER> is a known page (served 200, not 404)', meta.found === true && /Solana/.test(meta.title ?? JSON.stringify(meta)), JSON.stringify(meta).slice(0, 200))

  /* ------------------------------------------------------------ Jupiter --- */
  resetJupiterForTest()
  let q = await get(`/api/solana/jupiter/quote?ticker=${s0.ticker}&side=buy&with=USDC&amount=25`, { 'cf-ipcountry': 'US' })
  check('geo: a US visitor gets 451 for a quote', q.status === 451 && q.data?.code === 'REGION')
  let sw = await post('/api/solana/jupiter/swap', { quoteId: 'x', userPublicKey: rand32() }, { 'cf-ipcountry': 'US' })
  check('geo: a US visitor gets 451 for a swap', sw.status === 451)
  q = await get(`/api/solana/jupiter/quote?ticker=${s0.ticker}&side=buy&with=USDC&amount=25`, { 'cf-ipcountry': 'DE' })
  check('a quote with no fee set carries no platformFeeBps', q.status === 200 && !('platformFeeBps' in jupSeen.quotes.at(-1)) && q.data.quote.platformFee === null && q.data.quote.inAmount === '25', JSON.stringify(q.data))
  check('the quote shows the route and price impact', q.data.quote.route[0]?.label === 'Orca' && Math.abs(q.data.quote.priceImpactPct - 0.12) < 1e-9)
  const user = rand32()
  sw = await post('/api/solana/jupiter/swap', { quoteId: q.data.quote.id, userPublicKey: user }, { 'cf-ipcountry': 'DE' })
  check('the swap transaction comes back unsigned, with no fee account', sw.status === 200 && sw.data.swapTransaction && !('feeAccount' in jupSeen.swaps.at(-1)) && jupSeen.swaps.at(-1).userPublicKey === user)

  process.env.JUPITER_FEE_BPS = '50'
  process.env.JUPITER_FEE_ACCOUNT = FEE_WALLET
  q = await get(`/api/solana/jupiter/quote?ticker=${s0.ticker}&side=buy&with=USDC&amount=30`, { 'cf-ipcountry': 'DE' })
  check('fee on: platformFeeBps=50 (instructionVersion V2) is sent and the fee is shown in USDC', q.status === 200 && jupSeen.quotes.at(-1).platformFeeBps === '50' && jupSeen.quotes.at(-1).instructionVersion === 'V2' && q.data.quote.platformFee?.bps === 50 && q.data.quote.platformFee.amount === '0.15' && q.data.quote.platformFee.symbol === 'USDC', JSON.stringify(q.data?.quote?.platformFee))
  sw = await post('/api/solana/jupiter/swap', { quoteId: q.data.quote.id, userPublicKey: user }, { 'cf-ipcountry': 'DE' })
  check('fee on: the swap pays the fee wallet’s USDC account', sw.status === 200 && jupSeen.swaps.at(-1).feeAccount === associatedTokenAddress(FEE_WALLET, USDC))
  q = await get(`/api/solana/jupiter/quote?ticker=${s0.ticker}&side=buy&with=SOL&amount=0.5`, { 'cf-ipcountry': 'DE' })
  check('fee on, but no wSOL account for the fee wallet: that swap carries no fee, and says why', q.status === 200 && !('platformFeeBps' in jupSeen.quotes.at(-1)) && q.data.quote.platformFee === null && /no token account/.test(q.data.quote.feeNote ?? ''), JSON.stringify(q.data?.quote))
  delete process.env.JUPITER_FEE_BPS
  delete process.env.JUPITER_FEE_ACCOUNT
  check('an unknown ticker is refused (400)', (await get('/api/solana/jupiter/quote?ticker=ZZZZ&side=buy&with=USDC&amount=1', { 'cf-ipcountry': 'DE' })).status === 400)
  check('too many decimals is refused (400)', (await get(`/api/solana/jupiter/quote?ticker=${s0.ticker}&side=buy&with=USDC&amount=1.0000001`, { 'cf-ipcountry': 'DE' })).status === 400)
  check('an unknown quote id cannot be swapped (410)', (await post('/api/solana/jupiter/swap', { quoteId: 'jq_nope', userPublicKey: user }, { 'cf-ipcountry': 'DE' })).status === 410)

  /* ---------------------------------------------------------- RPC proxy --- */
  let rp = await post('/api/solana/rpc', { jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash', params: [] })
  check('the RPC proxy answers an allowed read', rp.status === 200 && typeof rp.data?.result?.value?.blockhash === 'string')
  rp = await post('/api/solana/rpc', { jsonrpc: '2.0', id: 1, method: 'getProgramAccounts', params: [TOKEN] })
  check('the RPC proxy refuses other methods (400)', rp.status === 400)

  /* --------------------------------------------------------- Solana Pay --- */
  check('amount decimals are exact (no exponent, no trailing zeros)', unitsToDecimal(1_500_000_123n, 6) === '1500.000123' && unitsToDecimal(1n, 9) === '0.000000001' && unitsToDecimal(2_000_000_000n, 9) === '2')
  const ref = rand32()
  const u1 = solanaPayUrl({ asset: { kind: 'token', address: USDC, decimals: 6 }, recipient: TREASURY, amountRaw: 49_000_123n, reference: ref, label: 'Gully Labs', message: 'Invoice #1' })
  check('Solana Pay URL for USDC', u1 === `solana:${TREASURY}?amount=49.000123&spl-token=${USDC}&reference=${ref}&label=Gully%20Labs&message=Invoice%20%231`, u1)
  const u2 = solanaPayUrl({ asset: { kind: 'native', address: null, decimals: 9 }, recipient: TREASURY, amountRaw: 326_670_042n, reference: ref, label: '' })
  check('Solana Pay URL for SOL has no spl-token', u2 === `solana:${TREASURY}?amount=0.326670042&reference=${ref}`, u2)

  const plans = (await get('/api/plans')).data
  check('/api/plans lists Solana and its three assets when the Solana treasury is set', plans.chains.some((c) => c.key === 'solana' && c.id === SOLANA_CHAIN_ID) && plans.assets.filter((a) => a.chainKey === 'solana').map((a) => a.id).join() === 'solana-usdc,solana-usdt,solana-sol' && plans.checkout.solanaTreasury === TREASURY)

  const created = await admin('/api/admin/invoices', 'POST', { title: 'Solana test invoice', usd: '120', assets: ['solana-usdc', 'solana-sol', 'base-usdc'] })
  const inv = created.data?.invoice
  check('an invoice payable in USDC and SOL on Solana', created.status === 201 && inv.assets.some((a) => a.id === 'solana-usdc'), JSON.stringify(created.data).slice(0, 200))
  const iq = (await post(`/api/pay/${inv.id}/quote`, { asset: 'solana-usdc' })).data?.quote
  check('the quote has a unique reference and a solana: QR link for the exact amount', iq && S.isSolanaAddress(iq.reference) && iq.uri === `solana:${TREASURY}?amount=${iq.amount}&spl-token=${USDC}&reference=${iq.reference}&label=Gully%20Labs&message=Gully%20Pay` && iq.treasury === TREASURY, JSON.stringify(iq))
  check('the amount is the USD price plus a tag of millionths', BigInt(iq.amountRaw) > 120_000_000n && BigInt(iq.amountRaw) < 120_010_000n)
  const exact = BigInt(iq.amountRaw)
  const verify = (sig, quote = iq) => post(`/api/pay/${inv.id}/verify`, { quoteId: quote.id, txHash: sig })

  let r = await verify(addTx({ amount: exact, to: rand32() }))
  check('refused: USDC sent to another wallet', r.status === 422 && /not to the Gully Labs treasury/.test(r.data?.error), r.data?.error)
  r = await verify(addTx({ amount: exact, mint: USDT }))
  check('refused: the wrong mint (USDT on a USDC quote)', r.status === 422 && /other than USDC/.test(r.data?.error), r.data?.error)
  r = await verify(addTx({ amount: exact - 1n }))
  check('refused: an under-payment', r.status === 422 && /paid/.test(r.data?.error), r.data?.error)
  r = await verify(addTx({ amount: exact, finalized: false }))
  check('pending: confirmed but not finalized (202)', r.status === 202 && /not finalized/.test(r.data?.error ?? ''), JSON.stringify(r.data))
  r = await verify(addTx({ amount: exact, mint: null }))
  check('refused: SOL sent on a USDC quote', r.status === 422 && /sent SOL, not USDC/.test(r.data?.error), r.data?.error)
  r = await verify('0x' + 'ab'.repeat(32))
  check('refused: an EVM hash on a Solana quote (400)', r.status === 400)
  r = await verify(randSig())
  check('pending: a signature Solana does not know yet (202)', r.status === 202)

  // The right payment, found by its reference (as a wallet paying from the QR would add it).
  const good = addTx({ amount: exact, reference: iq.reference })
  const found = await get(`/api/solana/pay/find?quote=${iq.id}`)
  check('the payment is found by its reference key', found.status === 200 && found.data.signatures.some((s) => s.signature === good), JSON.stringify(found.data))
  r = await verify(good)
  check('the exact USDC payment to the treasury’s associated account pays the invoice', r.status === 200 && r.data?.invoice?.status === 'paid' && r.data.invoice.payment?.txUrl === `https://solscan.io/tx/${good}`, JSON.stringify(r.data).slice(0, 300))
  check('the signature is kept case-sensitive in the ledger', r.data?.invoice?.payment?.txHash === good)

  // Reuse: the same signature for a plan.
  const dev = makeClient(BASE)
  const wallet = privateKeyToAccount(generatePrivateKey())
  check('a developer signs in', (await dev.signIn(wallet)).status === 200)
  const pq = (await dev.post('/api/developer/checkout', { plan: 'pro', asset: 'solana-usdc' })).data?.intent
  check('a Pro checkout in USDC on Solana', !!pq && pq.asset.id === 'solana-usdc' && !!pq.reference && pq.uri.startsWith(`solana:${TREASURY}?amount=`), JSON.stringify(pq))
  r = await dev.post('/api/developer/checkout/verify', { quoteId: pq.id, txHash: good })
  check('refused: a reused signature (409)', r.status === 409 && /already been used/.test(r.data?.error), r.data?.error)
  r = await dev.post('/api/developer/checkout/verify', { quoteId: pq.id, txHash: addTx({ amount: BigInt(pq.amountRaw), blockTime: Math.floor(Date.now() / 1000) - 3 * 3600 }) })
  check('refused: a payment made before the checkout was opened', r.status === 422 && /before your checkout/.test(r.data?.error), r.data?.error)
  r = await dev.post('/api/developer/checkout/verify', { quoteId: pq.id, txHash: addTx({ amount: BigInt(pq.amountRaw), reference: pq.reference }) })
  check('an exact USDC payment on Solana buys Pro', r.status === 200 && r.data?.plan?.id === 'pro' && r.data.payment.chain === 'Solana', JSON.stringify(r.data).slice(0, 300))

  // SOL, priced by Pyth's SOL/USD account.
  const sq = (await post(`/api/pay/${inv.id}/quote`, { asset: 'solana-sol' }))
  check('the invoice is paid, so no new quote (409 or 4xx)', sq.status >= 400)
  const inv2 = (await admin('/api/admin/invoices', 'POST', { title: 'SOL invoice', usd: '30', assets: ['solana-sol'] })).data.invoice
  const q2 = (await post(`/api/pay/${inv2.id}/quote`, { asset: 'solana-sol' })).data?.quote
  const lamports = (3000n * 10n ** 17n + SOL_PRICE * 100n - 1n) / (SOL_PRICE * 100n)
  check('a SOL quote is priced by Pyth SOL/USD, rounded up, with a lamport tag', q2 && BigInt(q2.amountRaw) >= lamports && BigInt(q2.amountRaw) - lamports < 20_000n && q2.price?.description === 'SOL / USD' && q2.price.answer === '150', JSON.stringify(q2))
  r = await post(`/api/pay/${inv2.id}/verify`, { quoteId: q2.id, txHash: addTx({ mint: null, amount: BigInt(q2.amountRaw), to: rand32() }) })
  check('refused: SOL to another address', r.status === 422 && /another address/.test(r.data?.error), r.data?.error)
  r = await post(`/api/pay/${inv2.id}/verify`, { quoteId: q2.id, txHash: addTx({ mint: null, amount: BigInt(q2.amountRaw) }) })
  check('an exact SOL payment pays the invoice', r.status === 200 && r.data?.invoice?.status === 'paid', JSON.stringify(r.data).slice(0, 200))

  delete process.env.GULLY_SOLANA_TREASURY
  const off = (await get('/api/plans')).data
  check('with no Solana treasury, Solana is not offered', !off.chains.some((c) => c.key === 'solana') && !off.assets.some((a) => a.chainKey === 'solana'))
  const inv3 = (await admin('/api/admin/invoices', 'POST', { title: 'Off', usd: '5', assets: ['solana-usdc', 'base-usdc'] })).data.invoice
  r = await post(`/api/pay/${inv3.id}/quote`, { asset: 'solana-usdc' })
  check('a Solana quote is refused while the Solana treasury is unset (503)', r.status === 503 && /Solana/.test(r.data?.error), r.data?.error)
  check('no upstream was reached: every Solana read went to the local stubs', rpcCalls > 0 && dexHits > 0)
} catch (e) {
  t.failed++
  console.error('FAIL  crashed:', e)
} finally {
  console.log(`\n${t.passed} passed, ${t.failed} failed`)
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(t.failed ? 1 : 0)
}
