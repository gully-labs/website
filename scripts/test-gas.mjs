// Tests of GET /api/pay/gas (server/gas.mjs): the shape per chain, USD costs from the chain's own feed with the
// L1 data fee on rollups, a chain whose node is down answering ok:false (never a made-up number), a stale feed
// giving gas but no USD, and the cache (one round of RPC reads per CACHE_MS, shared by concurrent callers).
//
//   node scripts/test-gas.mjs        (no build, no network: every chain is a local JSON-RPC stub; TEST_PORT
//                                     sets the port of the in-process HTTP server, default 8796)

import http from 'node:http'
import { makeChecker } from './test-helpers.mjs'

const t = makeChecker()
const { check } = t
const PORT = Number(process.env.TEST_PORT) || 8796
const IDS = [8453, 1, 56, 42161, 10, 137, 43114]
const hex = (n) => '0x' + BigInt(n).toString(16)
const w = (n) => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0')

const calls = { n: 0, gasPrice: 0 }
const down = new Set() // chain ids whose node errors
const staleFeed = new Set() // chain ids whose feed answers an old round
const GAS_GWEI = { 8453: 0.01, 1: 2, 56: 1, 42161: 0.02, 10: 0.001, 137: 30, 43114: 1.5 }
const PRICE = { 8453: 3000, 1: 3000, 56: 600, 42161: 3000, 10: 3000, 137: 0.25, 43114: 25 }
let feedAddr = {}

function makeStub(chainId) {
  return http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      const q = JSON.parse(body)
      calls.n++
      let result = null
      let error = null
      if (q.method === 'eth_chainId') result = hex(chainId)
      else if (down.has(chainId)) error = { code: -32000, message: 'stub: node down' }
      else if (q.method === 'eth_gasPrice') {
        calls.gasPrice++
        result = hex(Math.round(GAS_GWEI[chainId] * 1e9))
      } else if (q.method === 'eth_call') {
        const to = String(q.params[0].to).toLowerCase()
        const now = Math.floor(Date.now() / 1000)
        if (to === feedAddr[chainId]) result = '0x' + w(1) + w(Math.round(PRICE[chainId] * 1e8)) + w(now) + w(staleFeed.has(chainId) ? now - 10 * 86_400 : now - 60) + w(1)
        else if (to === '0x420000000000000000000000000000000000000f') result = '0x' + w(50_000_000_000n) // 5e10 wei L1 fee
        else if (to === '0x00000000000000000000000000000000000000c8') result = '0x' + w(2_000) + w(0) + w(0) // 2,000 L2 gas of L1 data
        else error = { code: -32000, message: `stub: unknown call to ${to}` }
      } else error = { code: -32601, message: 'stub: method not found' }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(error ? { jsonrpc: '2.0', id: q.id, error } : { jsonrpc: '2.0', id: q.id, result }))
    })
  })
}

const stubs = Object.fromEntries(IDS.map((id) => [id, makeStub(id)]))
for (const s of Object.values(stubs)) await new Promise((r) => s.listen(0, '127.0.0.1', r))
for (const [id, s] of Object.entries(stubs)) process.env[`GULLY_RPC_${id}`] = `http://127.0.0.1:${s.address().port}`
delete process.env.GULLY_BASE_RPC
delete process.env.GULLY_TESTNET_CHAINS

const P = await import('../server/payments.mjs')
const G = await import('../server/gas.mjs')
feedAddr = Object.fromEntries(IDS.map((id) => [id, P.CHAINS[id].feed.address.toLowerCase()]))

const srv = http.createServer((req, res) => G.handleGas(req, res))
await new Promise((r) => srv.listen(PORT, '127.0.0.1', r))
const get = async (method = 'GET') => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/pay/gas`, { method })
  return { status: r.status, headers: r.headers, data: method === 'GET' && r.status === 200 ? await r.json() : null }
}

/* ------------------------------------------------------------- shape --- */

down.add(56)
staleFeed.add(137)
const r1 = await get()
check('GET /api/pay/gas answers 200 JSON, cacheable for a minute', r1.status === 200 && /application\/json/.test(r1.headers.get('content-type')) && /max-age=60/.test(r1.headers.get('cache-control') ?? ''))
const d = r1.data
check('top level: at, cacheSeconds and the measured gas per transaction', typeof d.at === 'string' && d.cacheSeconds === G.CACHE_MS / 1000 && d.gas.pay === 106_000 && d.gas.transfer === 65_000 && d.gas.approve === 46_000)
check('every mainnet chain is listed once, no testnets', JSON.stringify(d.chains.map((c) => c.chainId).sort()) === JSON.stringify([...IDS].sort()), JSON.stringify(d.chains.map((c) => c.chainId)))
const by = Object.fromEntries(d.chains.map((c) => [c.chainId, c]))
const eth = by[1]
check('Ethereum: gas in gwei and the coin price from its own feed', eth.ok && eth.gasPriceGwei === 2 && eth.coinUsd === 3000 && /Chainlink ETH \/ USD/.test(eth.priceSource))
check('Ethereum: a fee-proxy payment costs 106k gas at that price (no L1 fee)', Math.abs(eth.payUsd - 106_000 * 2e-9 * 3000) < 1e-6 && eth.l1FeeUsd === null && eth.l1 === null, String(eth.payUsd))
check('Ethereum: a plain transfer costs 65k gas', Math.abs(eth.transferUsd - 65_000 * 2e-9 * 3000) < 1e-6)
const base = by[8453]
const baseL1 = 5e10 / 1e18 * 3000
check('Base: the OP Stack L1 data fee is read and added', base.ok && Math.abs(base.l1FeeUsd - baseL1) < 1e-9 && Math.abs(base.payUsd - (106_000 * 0.01e-9 * 3000 + baseL1)) < 1e-9 && /OP Stack/.test(base.l1), JSON.stringify(base))
const arb = by[42161]
check('Arbitrum: the L1 part comes from NodeInterface as extra L2 gas', arb.ok && Math.abs(arb.l1FeeUsd - 2_000 * 0.02e-9 * 3000) < 1e-9 && /Arbitrum/.test(arb.l1))
check('a chain whose node is down answers ok:false with the reason, and no numbers', by[56].ok === false && by[56].error === 'unavailable' && by[56].payUsd === undefined, JSON.stringify(by[56]))
check('the JSON carries no raw RPC error text', !/stub:|node down|-32000/.test(JSON.stringify(by)), JSON.stringify(by[56]))
check('a stale feed: gas price shown, USD costs null with a note (never a guess)', by[137].ok === true && by[137].gasPriceGwei === 30 && by[137].payUsd === null && by[137].coinUsd === null && /coin price unreadable/.test(by[137].note ?? ''), JSON.stringify(by[137]))
check('every row names its chain, key and coin symbol', d.chains.every((c) => c.name && c.key && (c.ok === false || c.symbol)))

/* ------------------------------------------------------------- cache --- */

const before = calls.gasPrice
const [a, b] = await Promise.all([get(), get()])
check('cached: repeated and concurrent reads make no new RPC calls', calls.gasPrice === before && a.data.at === d.at && b.data.at === d.at)
down.delete(56)
const still = await get()
check('cached: a recovered node shows only after the cache expires', still.data.chains.find((c) => c.chainId === 56).ok === false)
G.clearGasCacheForTest()
P.clearFeedCacheForTest()
const [x, y] = await Promise.all([G.readGas(), G.readGas()])
check('after expiry one round of reads is shared by concurrent callers', x === y && calls.gasPrice === before + IDS.length, `${calls.gasPrice - before} gas price reads`)
check('the recovered chain answers again', x.chains.find((c) => c.chainId === 56).ok === true)
const head = await get('HEAD')
check('HEAD is allowed', head.status === 200)
const post = await fetch(`http://127.0.0.1:${PORT}/api/pay/gas`, { method: 'POST' })
check('POST answers 405', post.status === 405)

/* -------------------------------------------------- server routes it --- */

const fs = await import('node:fs')
const serverSrc = fs.readFileSync(new URL('../server/server.mjs', import.meta.url), 'utf8')
check('server.mjs routes /api/pay/gas before the invoice handler', serverSrc.indexOf("'/api/pay/gas'") > 0 && serverSrc.indexOf("'/api/pay/gas'") < serverSrc.indexOf("url.pathname.startsWith('/api/pay/')"))

srv.close()
for (const s of Object.values(stubs)) s.close()
console.log(`\n${t.passed} passed, ${t.failed} failed`)
process.exit(t.failed ? 1 : 0)
