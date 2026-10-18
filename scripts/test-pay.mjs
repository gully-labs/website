// End-to-end test of Gully Pay: multi-chain, multi-asset quotes and verification for plans, and
// general invoices paid on the public /pay page.
//
//   node scripts/test-pay.mjs            (no build needed; it tests the API, not the pages)
//
// The real server runs IN THIS PROCESS on port 8792 (TEST_PORT overrides) with a fresh temporary DATA_DIR that starts with a
// billing.json in the old USDC-on-Base shape (to test the migration). Each chain (Base, Ethereum, BNB
// Chain, Arbitrum) is its own local JSON-RPC stub (GULLY_RPC_<chainId>) with its own Chainlink feed
// answer, so nothing upstream is read. Random wallets sign in; no real wallet is used.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { makeChecker, makeClient, guardTestRun } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8792
await guardTestRun(PORT)
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-pay-'))
const ADMIN = crypto.randomBytes(24).toString('hex')
const TREASURY = privateKeyToAccount(generatePrivateKey()).address.toLowerCase()
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const TOKENS = { baseUsdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', ethUsdt: '0xdac17f958d2ee523a2206206994597c13d831ec7', bnbUsdt: '0x55d398326f99059ff775485246999027b3197955', arbUsdc: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', opUsdc: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', polygonUsdc: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', avaxUsdt: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7' }
const FEEDS = { 8453: '0x71041dddad3595f9ced3dccfbe3d1f4b0a16bb70', 1: '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419', 56: '0x0567f2323251f0aab15c8dfb1967e4e8a7d42aee', 42161: '0x639fe6ab55c921f74e7fac1ee960c0b6293ba612', 10: '0x13e3ee699d1909e989722e753853ae30b17e08c5', 137: '0xab594600376ec9fd91f8e885dadf0ce036862de0', 43114: '0x0a77230d17318075983913bc2145db16c7366156' }
/** Runtime code the stubs answer for the treasury per chain ('0x' = none, so an EOA treasury to start with). */
const treasuryCode = {}
/** Chains whose eth_getCode answers an RPC error (node down), for the treasury gate. */
const codeDown = new Set()

const t = makeChecker()
const { check } = t
const day = 86_400_000

/* ---------------------------------------------------------- chain stubs --- */

const pad = (a) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0')
const hex = (n) => '0x' + BigInt(n).toString(16)
const word = (n) => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0')
const randHash = () => '0x' + crypto.randomBytes(32).toString('hex')
const nowSec = () => Math.floor(Date.now() / 1000)

function makeChain(chainId, answer) {
  // balances: `${holder}` (coin) and `${token}:${holder}` (ERC-20), for the fee-proxy monitor; default 0.
  const c = { chainId, head: 5_000_000, receipts: new Map(), txs: new Map(), blocks: new Map(), balances: new Map(), feed: { roundId: 777n, answer, updatedAt: nowSec() - 60 } }
  c.add = ({ hash = randHash(), from, to = TREASURY, value, token = null, status = '0x1', block = c.head - 30, minedAt = nowSec(), txFrom = from }) => {
    c.blocks.set(block, minedAt)
    const logs = token ? [{ address: token, topics: [TRANSFER, pad(from), pad(to)], data: pad(hex(value)) }] : []
    c.receipts.set(hash, { transactionHash: hash, status, blockNumber: hex(block), from: txFrom, logs })
    c.txs.set(hash, { hash, from: txFrom, to: token ?? to, value: token ? '0x0' : hex(value), blockNumber: hex(block), chainId: hex(chainId) })
    return hash
  }
  c.server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      const q = JSON.parse(body)
      let result = null
      if (q.method === 'eth_chainId') result = hex(chainId)
      else if (q.method === 'eth_blockNumber') result = hex(c.head)
      else if (q.method === 'eth_getCode') {
        if (codeDown.has(chainId)) {
          res.writeHead(200, { 'content-type': 'application/json' })
          return res.end(JSON.stringify({ jsonrpc: '2.0', id: q.id, error: { code: -32000, message: 'stub: node down' } }))
        }
        result = String(q.params[0]).toLowerCase() === TREASURY ? (treasuryCode[chainId] ?? '0x') : '0x'
      } else if (q.method === 'eth_getTransactionReceipt') result = c.receipts.get(q.params[0]) ?? null
      else if (q.method === 'eth_getTransactionByHash') result = c.txs.get(q.params[0]) ?? null
      else if (q.method === 'eth_getBlockByNumber') {
        const n = Number(BigInt(q.params[0]))
        result = c.blocks.has(n) ? { number: q.params[0], timestamp: hex(c.blocks.get(n)) } : null
      } else if (q.method === 'eth_call' && q.params[0].to.toLowerCase() === FEEDS[chainId] && q.params[0].data === '0xfeaf968c') {
        const f = c.feed
        result = '0x' + word(f.roundId) + word(f.answer) + word(f.updatedAt) + word(f.updatedAt) + word(f.roundId)
      } else if (q.method === 'eth_getBalance') result = pad(hex(c.balances.get(String(q.params[0]).toLowerCase()) ?? 0n))
      else if (q.method === 'eth_call' && String(q.params[0].data).startsWith('0x70a08231')) result = pad(hex(c.balances.get(`${String(q.params[0].to).toLowerCase()}:0x${q.params[0].data.slice(34).toLowerCase()}`) ?? 0n))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }))
    })
  })
  return c
}

const chains = { 8453: makeChain(8453, 2_400_00000000n), 1: makeChain(1, 2_500_00000000n), 56: makeChain(56, 700_00000000n), 42161: makeChain(42161, 2_450_00000000n), 10: makeChain(10, 2_400_00000000n), 137: makeChain(137, 9_000000n), 43114: makeChain(43114, 10_00000000n) }
for (const c of Object.values(chains)) await new Promise((r) => c.server.listen(0, '127.0.0.1', r))
const [base, eth, bnb, arb, op, polygon, avax] = [chains[8453], chains[1], chains[56], chains[42161], chains[10], chains[137], chains[43114]]

/* ------------------------------------------- legacy data (migration test) --- */

const wallet = privateKeyToAccount(generatePrivateKey())
const me = wallet.address.toLowerCase()
const other = privateKeyToAccount(generatePrivateKey())
const stranger = privateKeyToAccount(generatePrivateKey()).address.toLowerCase()
const LEGACY_HASH = randHash()
fs.writeFileSync(
  path.join(tmp, 'billing.json'),
  JSON.stringify({
    payments: [{ txHash: LEGACY_HASH, address: me, plan: 'pro', amountRaw: '49000123', from: me, blockNumber: 123, at: new Date(Date.now() - 40 * day).toISOString(), periodStart: new Date(Date.now() - 40 * day).toISOString(), expiresAt: new Date(Date.now() - 10 * day).toISOString() }],
    intents: [{ id: 'legacyIntent1', address: me, plan: 'business', tag: 42, amountRaw: '199000042', treasury: TREASURY, createdAt: new Date(Date.now() - day).toISOString(), expiresAt: new Date(Date.now() + 6 * day).toISOString(), paidAt: null }],
  }),
)
base.add({ hash: LEGACY_HASH, from: me, value: 49_000_123n, token: TOKENS.baseUsdc })

/* ------------------------------------------------------------ start server --- */

Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: path.join(tmp, 'no-dist'),
  ADMIN_TOKEN: ADMIN,
  TRACKER_LOOP: 'off',
  GULLY_TREASURY_ADDRESS: TREASURY,
  ...Object.fromEntries(Object.values(chains).map((c) => [`GULLY_RPC_${c.chainId}`, `http://127.0.0.1:${c.server.address().port}`])),
})
delete process.env.GULLY_BASE_RPC
delete process.env.GULLY_MIN_CONFIRMATIONS
await import('../server/server.mjs')
const { clearFeedCacheForTest } = await import('../server/payments.mjs')
const { expireInvoiceForTest } = await import('../server/invoices.mjs')
await new Promise((r) => setTimeout(r, 300))

const dev = makeClient(BASE)
const dev2 = makeClient(BASE)
const anon = makeClient(BASE)
const admin = (p, method = 'GET', body, token = ADMIN) => fetch(BASE + p, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }))
const payPost = (p, body) => anon.post(p, body)

try {
  /* ------------------------------------------------------------ offer --- */
  const plans = (await anon.call('/api/plans')).data
  check('GET /api/plans lists 18 assets on seven chains (an EOA treasury: every chain offered)', plans.assets.length === 18 && plans.chains.map((c) => c.id).join() === '8453,1,56,42161,10,137,43114', plans.assets.map((a) => a.id).join())
  check('confirmations per chain: Ethereum 6, Base 10, BNB Chain 15, Arbitrum 10, OP Mainnet 10, Polygon 64, Avalanche 2', plans.chains.map((c) => c.confirmations).join() === '10,6,15,10,10,64,2')
  const noProxy = [137, 43114] // Polygon's and Avalanche's proxies are not Base's build (contracts/CHOICE.md): plain transfers
  check('every chain but Polygon and Avalanche reports a verified fee proxy, usable now (feeSplit) with an EOA treasury', plans.chains.every((c) => c.feeProxy === !noProxy.includes(c.id) && c.feeSplit === !noProxy.includes(c.id)) && plans.assets.every((a) => a.feeSplit === (a.kind === 'token' && !noProxy.includes(a.chainId))), JSON.stringify(plans.chains.map((c) => [c.id, c.feeProxy, c.feeSplit])))
  check('the new chains carry the on-chain-checked assets: OP USDC/USDT/ETH, Polygon USDC/POL, Avalanche USDC/USDT/AVAX', ['op-usdc', 'op-usdt', 'op-eth', 'polygon-usdc', 'polygon-pol', 'avax-usdc', 'avax-usdt', 'avax-avax'].every((id) => plans.assets.some((a) => a.id === id)) && plans.assets.find((a) => a.id === 'polygon-pol').feed.description === 'MATIC / USD' && plans.assets.find((a) => a.id === 'avax-avax').feed.description === 'AVAX / USD' && plans.assets.find((a) => a.id === 'op-usdc').address === TOKENS.opUsdc)
  check('the BNB Chain stablecoins have 18 decimals', plans.assets.filter((a) => a.chainId === 56 && a.kind === 'token').every((a) => a.decimals === 18))
  check('no RPC URL is published', !JSON.stringify(plans).includes('127.0.0.1') && !JSON.stringify(plans).includes('publicnode'))

  /* -------------------------------------------------------- migration --- */
  check('signs in', (await dev.signIn(wallet)).status === 200)
  check('the second wallet signs in', (await dev2.signIn(other)).status === 200)
  const bill0 = (await dev.call('/api/developer/billing')).data
  check('a legacy USDC payment is migrated to chain + asset', bill0.payments.length === 1 && bill0.payments[0].chainId === 8453 && bill0.payments[0].symbol === 'USDC' && bill0.payments[0].amount === '49.000123' && /basescan\.org\/tx\//.test(bill0.payments[0].txUrl), JSON.stringify(bill0.payments[0]))
  check('a legacy open checkout stays valid as a quote', bill0.intents.some((i) => i.id === 'legacyIntent1' && i.amountRaw === '199000042' && i.asset.id === 'base-usdc'))
  let r = await dev.post('/api/developer/checkout/verify', { plan: 'pro', txHash: LEGACY_HASH })
  check('a legacy payment hash cannot be used again', r.status === 409, r.data?.error)

  /* ------------------------------------------------- native: quotes --- */
  const checkout = (plan, asset, c = dev) => c.post('/api/developer/checkout', { plan, asset })
  const verify = (quoteId, txHash, c = dev) => c.post('/api/developer/checkout/verify', { quoteId, txHash })
  const q1r = await checkout('pro', 'eth-eth')
  const q1 = q1r.data?.intent
  const need = (4900n * 10n ** 26n + 2_500_00000000n * 100n - 1n) / (2_500_00000000n * 100n) // 49 USD at 2500 USD/ETH, rounded up
  check('an ETH quote on Ethereum is priced by the feed, rounded up, with a unique tail', q1r.status === 200 && BigInt(q1.amountRaw) > need && BigInt(q1.amountRaw) - need < 10n ** 13n + 10n ** 9n && BigInt(q1.amountRaw) % 10n ** 9n === 0n, `${q1?.amount} ETH; ${q1r.data?.error ?? ''}`)
  check('the quote records its price source', q1.price?.feed === FEEDS[1] && q1.price.roundId === '777' && q1.price.answer === '2500' && !!q1.price.updatedAt && q1.price.description === 'ETH / USD')
  check('the quote is valid for 20 minutes', Math.abs(Date.parse(q1.expiresAt) - Date.parse(q1.createdAt) - 20 * 60_000) < 1000)
  check('the quote names the treasury and the chain', q1.treasury === TREASURY && q1.chainId === 1 && q1.confirmations === 6 && q1.asset.kind === 'native')
  check('an unknown asset is refused (400)', (await checkout('pro', 'doge-doge')).status === 400)

  bnb.feed.updatedAt = nowSec() - 3 * 3600
  clearFeedCacheForTest()
  r = await checkout('pro', 'bnb-bnb')
  check('refused: a quote in BNB while its feed is three hours old (stale)', r.status === 503 && /stale/.test(r.data?.error), r.data?.error)
  bnb.feed.updatedAt = nowSec() - 60
  bnb.feed.answer = 0n
  clearFeedCacheForTest()
  r = await checkout('pro', 'bnb-bnb')
  check('refused: a quote when the feed answers zero', r.status === 503, r.data?.error)
  bnb.feed.answer = 700_00000000n
  clearFeedCacheForTest()
  const qb = (await checkout('pro', 'bnb-bnb')).data?.intent
  check('a BNB quote once the feed is fresh again', !!qb && qb.asset.symbol === 'BNB' && qb.chainId === 56 && qb.confirmations === 15)

  /* ----------------------------------------------- native: verification --- */
  const amt1 = BigInt(q1.amountRaw)
  r = await verify(q1.id, eth.add({ from: me, value: amt1 - 1n }))
  check('refused: an ETH underpayment, with the amounts', r.status === 422 && /paid .* ETH; Pro costs/.test(r.data?.error), r.data?.error)
  r = await verify(q1.id, eth.add({ from: me, to: stranger, value: amt1 }))
  check('refused: ETH sent to another address', r.status === 422 && /another address/.test(r.data?.error), r.data?.error)
  r = await verify(q1.id, eth.add({ from: me, value: amt1, status: '0x0' }))
  check('refused: a failed transaction', r.status === 422 && /failed/.test(r.data?.error))
  r = await verify(q1.id, bnb.add({ from: me, value: amt1 }))
  check('refused: a transaction on another chain than the quote', r.status === 422 && /is on BNB Chain/.test(r.data?.error), r.data?.error)
  r = await verify(q1.id, eth.add({ from: me, value: amt1, token: TOKENS.ethUsdt }))
  check('refused: a token transfer on an ETH quote', r.status === 422, r.data?.error)
  r = await verify(q1.id, eth.add({ from: me, value: amt1, minedAt: Math.floor(Date.parse(q1.expiresAt) / 1000) + 30 * 60 }))
  check('refused: mined after the quote ran out (expired quote)', r.status === 422 && /ran out/.test(r.data?.error), r.data?.error)
  const disagree = eth.add({ from: me, value: amt1 })
  eth.txs.get(disagree).blockNumber = hex(eth.head - 29)
  r = await verify(q1.id, disagree)
  check('refused: receipt and transaction disagree (502)', r.status === 502 && /do not agree/.test(r.data?.error), r.data?.error)
  r = await verify(q1.id, eth.add({ from: me, value: amt1, block: eth.head - 3 }))
  check('pending: 4 of 6 confirmations on Ethereum (202)', r.status === 202 && r.data?.confirmations === 4 && r.data?.needed === 6, r.data?.error)
  r = await verify(q1.id, randHash())
  check('pending: a hash no chain knows yet (202)', r.status === 202 && r.data?.pending === true)
  r = await verify(q1.id, eth.add({ from: me, value: amt1 }), dev2)
  check('refused: another wallet cannot use my quote (bound to the account)', r.status === 404, r.data?.error)

  const goodEth = eth.add({ from: me, value: amt1 })
  r = await verify(q1.id, goodEth)
  check('an exact ETH payment from the signed-in wallet buys Pro', r.status === 200 && r.data.plan.id === 'pro' && r.data.payment.symbol === 'ETH' && r.data.payment.chainId === 1 && r.data.payment.price?.answer === '2500', r.data?.error)
  check('the payment links to Etherscan', /^https:\/\/etherscan\.io\/tx\/0x/.test(r.data?.payment?.txUrl ?? ''))
  r = await verify(q1.id, goodEth)
  check('refused: the same quote again (paid)', r.status === 404 || r.status === 409, r.data?.error)
  const q1b = (await checkout('pro', 'eth-eth')).data.intent
  r = await verify(q1b.id, goodEth)
  check('refused: a reused hash (chainId:hash)', r.status === 409 && /already been used/.test(r.data?.error), r.data?.error)

  const qa = (await checkout('business', 'arb-eth')).data.intent
  r = await verify(qa.id, arb.add({ from: me, value: BigInt(qa.amountRaw) + 10n ** 15n }))
  check('an ETH overpayment on Arbitrum from the signed-in wallet is accepted', r.status === 200 && r.data.plan.id === 'business', r.data?.error)
  const qa2 = (await checkout('business', 'arb-eth')).data.intent
  r = await verify(qa2.id, arb.add({ from: stranger, value: BigInt(qa2.amountRaw) + 1n }))
  check('refused: ETH from another wallet that is not the exact quoted amount', r.status === 422 && /exact checkout amount/.test(r.data?.error), r.data?.error)
  r = await verify(qa2.id, arb.add({ from: stranger, value: BigInt(qa2.amountRaw) }))
  check('ETH from another wallet with the exact quoted amount is matched', r.status === 200, r.data?.error)

  /* ------------------------------------------------ token verification --- */
  const qt = (await checkout('pro', 'bnb-usdt')).data.intent
  check('a USDT quote on BNB Chain uses 18 decimals and a sub-cent tag', /^49\.00\d{1,4}$/.test(qt.amount) && BigInt(qt.amountRaw) > 49n * 10n ** 18n && BigInt(qt.amountRaw) < 49n * 10n ** 18n + 10n ** 16n, qt.amount)
  r = await verify(qt.id, bnb.add({ from: stranger, value: BigInt(qt.amountRaw), token: TOKENS.bnbUsdt }))
  check('USDT on BNB Chain from another wallet, exact amount, is matched', r.status === 200 && r.data.payment.amount === qt.amount && r.data.payment.symbol === 'USDT', r.data?.error)
  const qu = (await checkout('pro', 'eth-usdt')).data.intent
  r = await verify(qu.id, eth.add({ from: me, value: 48_990_000n, token: TOKENS.ethUsdt }))
  check('refused: USDT underpayment on Ethereum', r.status === 422 && /costs 49 USDT/.test(r.data?.error), r.data?.error)
  r = await verify(qu.id, eth.add({ from: me, value: 49_000_000n, token: TOKENS.arbUsdc }))
  check('refused: the wrong token to the treasury', r.status === 422 && /other than USDT/.test(r.data?.error), r.data?.error)
  r = await verify(qu.id, eth.add({ from: me, value: 50_000_000n, token: TOKENS.ethUsdt }))
  check('USDT from the signed-in wallet, at least the price, is accepted', r.status === 200, r.data?.error)
  const qc = (await checkout('pro', 'base-usdc')).data.intent
  r = await verify(qc.id, base.add({ from: me, value: 49_000_000n, token: TOKENS.baseUsdc, block: base.head - 5 }))
  check('pending: 6 of 10 confirmations on Base', r.status === 202 && r.data?.needed === 10 && r.data?.confirmations === 6, r.data?.error)

  const bill = (await dev.call('/api/developer/billing')).data
  check('billing lists every chain paid on', new Set(bill.payments.map((p) => p.chainId)).size === 4, JSON.stringify(bill.payments.map((p) => p.chainId)))

  /* -------------------------------------------- new chains: quotes and payments --- */
  const qpol = (await checkout('pro', 'polygon-pol')).data?.intent
  const needPol = (4900n * 10n ** 26n + 9_000000n * 100n - 1n) / (9_000000n * 100n)
  check('a POL quote on Polygon is priced by the MATIC / USD feed (POL = MATIC 1:1), rounded up', !!qpol && qpol.price?.description === 'MATIC / USD' && BigInt(qpol.amountRaw) > needPol && qpol.confirmations === 64 && qpol.asset.symbol === 'POL', JSON.stringify(qpol?.price))
  r = await verify(qpol.id, polygon.add({ from: me, value: BigInt(qpol.amountRaw), block: polygon.head - 40 }))
  check('pending: 41 of 64 confirmations on Polygon (202)', r.status === 202 && r.data?.needed === 64 && r.data?.confirmations === 41, r.data?.error)
  r = await verify(qpol.id, polygon.add({ from: me, value: BigInt(qpol.amountRaw), block: polygon.head - 70 }))
  check('an exact POL payment buys Pro; the receipt links to Polygonscan', r.status === 200 && r.data.payment.symbol === 'POL' && /^https:\/\/polygonscan\.com\/tx\/0x/.test(r.data.payment.txUrl), r.data?.error)
  const qav = (await checkout('business', 'avax-usdt')).data?.intent
  r = await verify(qav.id, avax.add({ from: stranger, value: BigInt(qav.amountRaw), token: TOKENS.avaxUsdt, block: avax.head }))
  check('USDT on Avalanche from another wallet, exact amount, 1 of 2 confirmations is pending', r.status === 202 && r.data?.needed === 2, r.data?.error)
  r = await verify(qav.id, avax.add({ from: stranger, value: BigInt(qav.amountRaw), token: TOKENS.avaxUsdt }))
  check('USDT on Avalanche (6 decimals, on-chain symbol USDt) is matched and links to Snowtrace', r.status === 200 && r.data.payment.symbol === 'USDT' && /snowtrace\.io\/tx\//.test(r.data.payment.txUrl), r.data?.error)
  const qop = (await checkout('pro', 'op-eth')).data?.intent
  r = await verify(qop.id, op.add({ from: me, value: BigInt(qop.amountRaw), token: TOKENS.opUsdc }))
  check('refused: a USDC transfer on an OP Mainnet ETH quote', r.status === 422, r.data?.error)
  r = await verify(qop.id, op.add({ from: me, value: BigInt(qop.amountRaw) }))
  check('an ETH payment on OP Mainnet buys Pro; the receipt links to optimistic.etherscan.io', r.status === 200 && r.data.payment.chainId === 10 && /optimistic\.etherscan\.io\/tx\//.test(r.data.payment.txUrl), r.data?.error)

  /* ------------------------------------------ the treasury deployment gate --- */
  // The treasury becomes a Safe deployed on the four original chains only: the three new chains close (not in
  // /api/plans, no quotes), the admin panel says what to do, and deploying the Safe on one of them reopens it.
  const recheck = () => admin('/api/admin/treasury/check', 'POST')
  for (const id of [8453, 1, 56, 42161]) treasuryCode[id] = '0x6080604052' + '00'.repeat(20)
  let tr = (await recheck()).data?.treasury
  check('gate: the treasury is seen as a contract (Safe) once any chain has code at its address', tr?.kind === 'contract' && tr.chains.find((c) => c.chainId === 8453).status === 'deployed', JSON.stringify(tr?.chains?.map((c) => [c.chainId, c.status])))
  const missing = tr.chains.filter((c) => c.status === 'missing').map((c) => c.chainId)
  check('gate: OP Mainnet, Polygon and Avalanche are "missing" and not offered', missing.join() === '10,137,43114' && tr.chains.filter((c) => !c.offered).map((c) => c.chainId).join() === '10,137,43114')
  const msg = tr.chains.find((c) => c.chainId === 137).message
  check('gate: the admin message tells the owner what to do', /^Treasury not deployed on Polygon \u2014 deploy the Safe at the same address via https:\/\/app\.safe\.global, then it switches on by itself\./.test(msg), msg)
  const plans2 = (await anon.call('/api/plans')).data
  check('gate: /api/plans now lists four chains and 10 assets; nothing on the closed chains', plans2.chains.map((c) => c.id).join() === '8453,1,56,42161' && plans2.assets.length === 10 && !plans2.assets.some((a) => [10, 137, 43114].includes(a.chainId)))
  r = await checkout('pro', 'op-usdc')
  check('gate: a quote on a closed chain is refused (409) and names the chain', r.status === 409 && /OP Mainnet.*not deployed/.test(r.data?.error), r.data?.error)
  const invG = (await admin('/api/admin/invoices', 'POST', { title: 'Gate', usd: '10' })).data.invoice
  check('gate: an invoice taking every asset lists only the open chains', invG.assets.length === 10 && !invG.assets.some((a) => a.chainId === 43114))
  r = await payPost(`/api/pay/${invG.id}/quote`, { asset: 'avax-usdc' })
  check('gate: an invoice quote on a closed chain is refused (409)', r.status === 409, r.data?.error)
  const abG = (await admin('/api/admin/billing')).data
  check('gate: admin billing carries the per-chain treasury state', abG.treasury?.kind === 'contract' && abG.treasury.chains.length === 7 && abG.treasury.safeApp === 'https://app.safe.global')
  codeDown.add(42161)
  tr = (await recheck()).data.treasury
  check('gate: a chain that cannot be read keeps what it knew (Arbitrum stays deployed on a node error)', tr.chains.find((c) => c.chainId === 42161).status === 'deployed' && tr.chains.find((c) => c.chainId === 42161).offered)
  codeDown.delete(42161)
  codeDown.add(10)
  treasuryCode[10] = '0x6080604052'
  tr = (await recheck()).data.treasury
  check('gate: a closed chain whose node is down stays closed (what was known is kept, the error shown, not offered)', tr.chains.find((c) => c.chainId === 10).status === 'missing' && /node down/.test(tr.chains.find((c) => c.chainId === 10).error ?? '') && !tr.chains.find((c) => c.chainId === 10).offered, JSON.stringify(tr.chains.find((c) => c.chainId === 10)))
  codeDown.delete(10)
  tr = (await recheck()).data.treasury
  check('gate: the Safe deployed on OP Mainnet reopens it by itself at the next check', tr.chains.find((c) => c.chainId === 10).status === 'deployed' && tr.chains.find((c) => c.chainId === 10).offered && (await anon.call('/api/plans')).data.chains.map((c) => c.id).join() === '8453,1,56,42161,10')
  const qg = (await checkout('pro', 'op-usdc')).data?.intent
  r = await verify(qg.id, op.add({ from: me, value: 49_000_000n, token: TOKENS.opUsdc }))
  check('gate: USDC on OP Mainnet pays a plan once the chain is open', !!qg && r.status === 200 && r.data.payment.chainId === 10, r.data?.error)
  check('gate: paying Gully Labs itself is a plain transfer (no split) even where the proxy exists', qg.split === null)
  for (const id of Object.keys(treasuryCode)) delete treasuryCode[id]
  tr = (await recheck()).data.treasury
  check('gate: back to an EOA treasury (code nowhere): every chain open again', tr.kind === 'eoa' && tr.chains.every((c) => c.offered) && (await anon.call('/api/plans')).data.chains.length === 7)

  /* --------------------------------------------------------- invoices --- */
  check('admin invoices need the admin token (401)', (await admin('/api/admin/invoices', 'GET', undefined, 'x'.repeat(48))).status === 401)
  check('refused: an invoice without a title', (await admin('/api/admin/invoices', 'POST', { usd: '100' })).status === 400)
  check('refused: an invoice with a bad amount', (await admin('/api/admin/invoices', 'POST', { title: 'X', usd: '12.345' })).status === 400)
  check('refused: an invoice with an unknown asset', (await admin('/api/admin/invoices', 'POST', { title: 'X', usd: '10', assets: ['base-usdc', 'sol-sol'] })).status === 400)
  const created = await admin('/api/admin/invoices', 'POST', { title: 'Chain Kit: first month', usd: '1500', note: 'Explorer set-up and hosting', assets: ['base-usdc', 'bnb-bnb', 'eth-usdt'], expiresInDays: 14 })
  const inv = created.data?.invoice
  check('admin creates an invoice with an unguessable id', created.status === 201 && /^inv_[\w-]{22}$/.test(inv?.id) && inv.status === 'open' && inv.usd === '1,500' && inv.path === `/pay/${inv.id}`, created.data?.error)
  check('admin lists it', (await admin('/api/admin/invoices')).data?.invoices?.[0]?.id === inv.id)
  const pub = await anon.call(`/api/pay/${inv.id}`)
  check('the public pay API shows the invoice to anyone with the link', pub.status === 200 && pub.data.invoice.title === 'Chain Kit: first month' && pub.data.invoice.assets.map((a) => a.id).join() === 'base-usdc,eth-usdt,bnb-bnb' && pub.data.invoice.status === 'open')
  check('an unknown invoice is 404', (await anon.call('/api/pay/inv_' + 'a'.repeat(22))).status === 404)
  check('a POST without X-Requested-With is refused', (await anon.call(`/api/pay/${inv.id}/quote`, { method: 'POST', body: { asset: 'base-usdc' } })).status === 403)
  r = await payPost(`/api/pay/${inv.id}/quote`, { asset: 'arb-usdc' })
  check('refused: a quote in an asset the invoice does not take', r.status === 400)
  const iq = (await payPost(`/api/pay/${inv.id}/quote`, { asset: 'base-usdc' })).data?.quote
  check('an invoice quote in USDC on Base', /^1500\.00\d{1,4}$/.test(iq?.amount ?? '') && iq.invoiceId === inv.id, JSON.stringify(iq))
  r = await payPost(`/api/pay/${inv.id}/verify`, { quoteId: iq.id, txHash: base.add({ from: stranger, value: 1_499_000_000n, token: TOKENS.baseUsdc }) })
  check('refused: an invoice underpayment', r.status === 422 && /this invoice costs/.test(r.data?.error), r.data?.error)
  r = await payPost(`/api/pay/${inv.id}/verify`, { quoteId: iq.id, txHash: base.add({ from: stranger, value: BigInt(iq.amountRaw) + 5n, token: TOKENS.baseUsdc }) })
  check('refused: not the exact quoted amount (nobody is signed in to match by wallet)', r.status === 422 && /not the exact amount/.test(r.data?.error), r.data?.error)
  r = await payPost(`/api/pay/${inv.id}/verify`, { quoteId: iq.id, txHash: goodEth })
  check('refused: a hash already used for a plan (on its own chain the quote differs: not found or reused)', r.status !== 200, r.data?.error)
  r = await payPost(`/api/pay/${inv.id}/verify`, { quoteId: iq.id, txHash: base.add({ from: stranger, value: BigInt(iq.amountRaw), token: TOKENS.baseUsdc, minedAt: nowSec() - 3 * 86_400 }) })
  check('refused: an exact payment made before the quote', r.status === 422 && /before/.test(r.data?.error), r.data?.error)
  const invHash = base.add({ from: stranger, value: BigInt(iq.amountRaw), token: TOKENS.baseUsdc })
  r = await payPost(`/api/pay/${inv.id}/verify`, { quoteId: iq.id, txHash: invHash })
  check('a stranger pays the invoice with the exact amount', r.status === 200 && r.data.invoice.status === 'paid' && r.data.invoice.payment.txHash === invHash && /basescan\.org\/tx\//.test(r.data.invoice.payment.txUrl), r.data?.error)
  check('the paid invoice shows its payment publicly (for the receipt)', (await anon.call(`/api/pay/${inv.id}`)).data.invoice.payment?.amount === iq.amount)
  r = await payPost(`/api/pay/${inv.id}/quote`, { asset: 'bnb-bnb' })
  check('refused: a quote on a paid invoice', r.status === 409)
  r = await payPost(`/api/pay/${inv.id}/verify`, { quoteId: iq.id, txHash: invHash })
  check('refused: paying a paid invoice again', r.status === 409 || r.status === 404, r.data?.error)
  const qp = (await checkout('pro', 'base-usdc')).data.intent
  r = await verify(qp.id, invHash)
  check('refused: an invoice payment hash reused for a plan', r.status === 409, r.data?.error)
  check('admin cannot cancel a paid invoice', (await admin(`/api/admin/invoices/${inv.id}/cancel`, 'POST')).status === 409)

  const inv2 = (await admin('/api/admin/invoices', 'POST', { title: 'Gully Analytics: annual', usd: '600.50' })).data.invoice
  check('an invoice with no asset list takes every asset', inv2.assets.length === 18 && inv2.usd === '600.50')
  const iq2 = (await payPost(`/api/pay/${inv2.id}/quote`, { asset: 'bnb-bnb' })).data?.quote
  check('an invoice quote in BNB, priced by the feed', !!iq2 && iq2.price?.description === 'BNB / USD' && BigInt(iq2.amountRaw) > (60050n * 10n ** 26n) / (700_00000000n * 100n))
  r = await payPost(`/api/pay/${inv2.id}/verify`, { quoteId: iq2.id, txHash: bnb.add({ from: stranger, value: BigInt(iq2.amountRaw), block: bnb.head - 10 }) })
  check('pending: 11 of 15 confirmations on BNB Chain', r.status === 202 && r.data?.needed === 15 && r.data?.confirmations === 11, r.data?.error)
  const cancelled = await admin(`/api/admin/invoices/${inv2.id}/cancel`, 'POST')
  check('admin cancels an open invoice', cancelled.status === 200 && cancelled.data.invoice.status === 'cancelled')
  check('a cancelled invoice gives no quote', (await payPost(`/api/pay/${inv2.id}/quote`, { asset: 'base-usdc' })).status === 409)
  r = await payPost(`/api/pay/${inv2.id}/verify`, { quoteId: iq2.id, txHash: bnb.add({ from: stranger, value: BigInt(iq2.amountRaw) }) })
  check('a cancelled invoice cannot be paid', r.status === 409, r.data?.error)
  check('cancelling twice is refused', (await admin(`/api/admin/invoices/${inv2.id}/cancel`, 'POST')).status === 409)

  const inv3 = (await admin('/api/admin/invoices', 'POST', { title: 'Services: audit', usd: '250', assets: ['eth-usdt'] })).data.invoice
  const iq3 = (await payPost(`/api/pay/${inv3.id}/quote`, { asset: 'eth-usdt' })).data.quote
  expireInvoiceForTest(inv3.id)
  check('an invoice past its expiry is shown as expired', (await anon.call(`/api/pay/${inv3.id}`)).data.invoice.status === 'expired')
  check('an expired invoice gives no new quote', (await payPost(`/api/pay/${inv3.id}/quote`, { asset: 'eth-usdt' })).status === 409)
  r = await payPost(`/api/pay/${inv3.id}/verify`, { quoteId: iq3.id, txHash: eth.add({ from: stranger, value: BigInt(iq3.amountRaw), token: TOKENS.ethUsdt }) })
  check('a payment for a quote made while it was open still settles it', r.status === 200 && r.data.invoice.status === 'paid', r.data?.error)

  const all = (await admin('/api/admin/billing')).data
  check('admin sees plan and invoice payments together', all.payments.some((p) => p.kind === 'invoice') && all.payments.some((p) => p.kind === 'plan'))

  /* ------------------------------ fee-proxy guard: every emission path --- */
  // With the treasury set to a fee proxy (a mis-configuration), no path may emit payment details: each answers
  // 500 with the guard's public message and no address; the admin panel still loads and says why.
  const { allFeeProxies } = await import('../server/fee-proxy-guard.mjs')
  const { GUARD_PUBLIC_ERROR } = await import('../server/pay-guard.mjs')
  const gInv = (await admin('/api/admin/invoices', 'POST', { title: 'Guard test', usd: '25', assets: ['base-usdc', 'base-eth'] })).data.invoice
  const gLink = (await admin('/api/admin/paylinks', 'POST', { title: 'Guard link', amount: { type: 'fixed', usd: '30' }, assets: ['base-usdc', 'base-eth'] })).data?.link
  check('guard setup: an invoice and a pay link while the treasury is fine', !!gInv?.id && !!gLink?.id)
  const PROXY = '0x1892196E80C4c17ea5100Da765Ab48c1fE2Fb814'
  process.env.GULLY_TREASURY_ADDRESS = PROXY
  const refused = (res) => res.status === 500 && res.data?.error === GUARD_PUBLIC_ERROR && !JSON.stringify(res.data).toLowerCase().includes(PROXY.slice(2, 12).toLowerCase())
  const paths = [
    ['GET /api/plans (checkout treasury)', () => anon.call('/api/plans')],
    ['POST /api/developer/checkout (USDC plan quote, QR)', () => checkout('pro', 'base-usdc')],
    ['POST /api/developer/checkout (native coin quote, EIP-681)', () => checkout('pro', 'eth-eth')],
    ['GET /api/developer/billing (offer and open quotes)', () => dev.call('/api/developer/billing')],
    ['GET /api/pay/:invoice (checkout treasury)', () => anon.call(`/api/pay/${gInv.id}`)],
    ['POST /api/pay/:invoice/quote (invoice quote)', () => payPost(`/api/pay/${gInv.id}/quote`, { asset: 'base-usdc' })],
    ['GET /api/pay/l/:link (pay link checkout)', () => anon.call(`/api/pay/l/${gLink.id}`)],
    ['POST /api/pay/l/:link/invoice (pay link invoice)', () => payPost(`/api/pay/l/${gLink.id}/invoice`, { asset: 'base-eth' })],
  ]
  for (const [name, call] of paths) {
    const res = await call()
    check(`guard: ${name} refuses a fee-proxy treasury with a 500 and no address`, refused(res), `${res.status} ${JSON.stringify(res.data)?.slice(0, 160)}`)
  }
  let everyProxy = true
  for (const a of allFeeProxies()) {
    process.env.GULLY_TREASURY_ADDRESS = a
    const res = await anon.call('/api/plans')
    const q = await checkout('pro', 'base-usdc')
    if (!refused(res) || !refused(q)) everyProxy = false
  }
  check(`guard: every known proxy address (${allFeeProxies().size}) is refused as the treasury`, everyProxy)
  process.env.GULLY_TREASURY_ADDRESS = PROXY
  const ov = await admin('/api/admin/overview')
  check('guard: the admin overview still loads and raises the misconfiguration', ov.status === 200 && ov.data.feeProxy?.config?.length === 1 && ov.data.feeProxy.refusals.length > 0, JSON.stringify(ov.data?.feeProxy?.config))
  const ab = await admin('/api/admin/billing')
  check('guard: admin billing still loads, checkout shown as refused', ab.status === 200 && ab.data.offer.checkout.enabled === false && ab.data.offer.checkout.treasury === null && /fee-proxy guard/.test(ab.data.offer.checkout.reason))
  const ai = await admin('/api/admin/invoices')
  check('guard: admin invoices still load, with no checkout address', ai.status === 200 && ai.data.invoices.every((i) => i.checkout.treasury === null))
  process.env.GULLY_TREASURY_ADDRESS = TREASURY
  check('guard: with the real treasury back, the same paths answer again', (await anon.call('/api/plans')).status === 200 && (await anon.call(`/api/pay/${gInv.id}`)).status === 200 && (await anon.call(`/api/pay/l/${gLink.id}`)).status === 200)
  const okQuote = (await payPost(`/api/pay/${gInv.id}/quote`, { asset: 'base-usdc' })).data?.quote
  check('guard: a normal quote passes (plain transfer, no split, QR names the treasury)', okQuote?.treasury === TREASURY && okQuote.split === null && okQuote.uri.toLowerCase().includes(`address=${TREASURY}`))
  check('guard: a plan or analytics account that is a fee proxy is refused by the admin (400)', (await admin(`/api/admin/accounts/${PROXY.toLowerCase()}/plan`, 'POST', { plan: 'pro' })).status === 400 && (await admin(`/api/admin/analytics/${PROXY.toLowerCase()}/plan`, 'POST', { plan: 'starter' })).status === 400)

  /* ------------------------------------- fee-proxy monitor through the admin API --- */
  const Mon = await import('../server/fee-proxy-monitor.mjs')
  const tg = []
  Mon.setFeeProxyNotifierForTest(async (text) => (tg.push(text), { ok: true, status: 200, error: null }))
  let fp = await admin('/api/admin/fee-proxy/check', 'POST')
  check('monitor: POST /api/admin/fee-proxy/check reads every proxy on every chain: all zero, no alert', fp.status === 200 && fp.data.feeProxy.alerts.length === 0 && fp.data.feeProxy.chains.length === 7 && fp.data.feeProxy.chains.every((c) => c.checkedAt && !c.error && c.proxies.length >= 2 && c.proxies.every((p) => p.balances.length >= 2 && p.balances.every((b) => b.raw === '0'))), JSON.stringify(fp.data?.feeProxy?.chains?.map((c) => [c.chain, c.error])))
  check('monitor: GET is not allowed on the check endpoint', (await admin('/api/admin/fee-proxy/check')).status === 405)
  base.balances.set(`${TOKENS.baseUsdc}:${PROXY.toLowerCase()}`, 7_250_000n)
  Mon.clearFeeProxyCacheForTest()
  fp = await admin('/api/admin/fee-proxy/check', 'POST')
  const al = fp.data?.feeProxy?.alerts?.[0]
  check('monitor: 7.25 USDC found in the Base proxy raises the alert and one Telegram message', fp.status === 200 && fp.data.feeProxy.alerts.length === 1 && al.chain === 'Base' && al.amount === '7.25' && al.symbol === 'USDC' && al.telegram === true && tg.length === 1 && /third-party mis-send/.test(tg[0]) && /cannot be recovered/.test(tg[0]), JSON.stringify(al))
  const ov2 = await admin('/api/admin/overview')
  check('monitor: the admin overview carries the alert for the banner and the card', ov2.status === 200 && ov2.data.feeProxy.alerts.length === 1 && ov2.data.feeProxy.alerts[0].message === al.message && ov2.data.feeProxy.chains.find((c) => c.chainId === 8453).proxies.some((p) => p.balances.some((b) => b.raw === '7250000')))
  check('monitor: a check inside the cache window announces nothing new', (await admin('/api/admin/fee-proxy/check', 'POST')).data.feeProxy.alerts.length === 1 && tg.length === 1)

  let limited = false
  for (let i = 0; i < 35 && !limited; i++) limited = (await payPost(`/api/pay/${inv3.id}/quote`, { asset: 'eth-usdt' })).status === 429
  check('quote requests on the pay page are rate-limited per address', limited)

  const { pageMeta } = await import('../server/seo.mjs')
  const meta = pageMeta('gullylabs.xyz', `/pay/${inv.id}`)
  const receiptMeta = pageMeta('gullylabs.xyz', `/pay/${inv.id}/receipt`)
  check('/pay/<id> and its receipt are pages (not 404s) that are never indexed', meta.found && meta.noindex && !meta.canonical && receiptMeta.found && receiptMeta.noindex && receiptMeta.title.startsWith('Receipt'))
} catch (e) {
  check(`no exception (${e?.stack ?? e})`, false)
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
for (const c of Object.values(chains)) c.server.close()
try {
  fs.rmSync(tmp, { recursive: true, force: true })
} catch {
  /* temp dir */
}
process.exit(t.failed ? 1 : 0)
