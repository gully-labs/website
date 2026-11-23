// Tests for server/ai/explain-tx.mjs with a fake provider and synthetic receipts (shape of real eth_getTransactionReceipt
// answers; recorded live fixtures are a follow-up, see design/gully-chain-ai-2026-11-23/PLAN.md).   node scripts/test-explain-tx.mjs
import assert from 'node:assert/strict'
import { makeGateway, fakeProvider } from '../server/ai/gateway.mjs'
import { buildFacts, explain, explainTx, checkGrounded, numbersIn, templateExplanation, handleExplainTx, setExplainCreditsHook, decodeRevert, fmtUnits, methodFromAbi, CHAIN_ID } from '../server/ai/explain-tx.mjs'
import { keccak_256 } from '../server/vendor/noble.mjs'

let n = 0
const ok = (name) => console.log(`ok ${++n} ${name}`)
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('')
const sel = (sig) => '0x' + hex(keccak_256(new TextEncoder().encode(sig))).slice(0, 8)
const tp = (sig) => '0x' + hex(keccak_256(new TextEncoder().encode(sig)))
const pad = (a) => '0x' + a.replace(/^0x/, '').padStart(64, '0')
const w = (v) => BigInt(v).toString(16).padStart(64, '0')
const A = (c) => '0x' + c.repeat(40)
const USER = A('a'), BUNDLER = A('b'), POOL = A('c'), TOKEN_IN = A('d'), TOKEN_OUT = A('e'), PM = A('f'), ENTRY = '0x0000000071727de22e5e9d8baf0edac6f37da032', ZERO = '0x' + '0'.repeat(40), WETH = '0x26acccb2e98ca9e067e58668aa3b101bef432754'
const H = (c) => '0x' + c.repeat(64)
const TR = tp('Transfer(address,address,uint256)')
const strRet = (s) => '0x' + w(32) + w(s.length) + Buffer.from(s).toString('hex').padEnd(64, '0')
const logT = (token, from, to, v, i) => ({ address: token, topics: [TR, pad(from), pad(to)], data: '0x' + w(v), logIndex: '0x' + i.toString(16) })
const rcpt = (o) => ({ status: '0x1', blockNumber: '0x64', gasUsed: '0x' + (100000).toString(16), effectiveGasPrice: '0x' + (2n * 10n ** 9n).toString(16), logs: [], ...o })

function deps({ txs = {}, abis = {}, prices = {}, revert = null, symbols = {} } = {}) {
  const calls = []
  return {
    calls,
    async rpc(m, p) {
      calls.push(m)
      if (m === 'eth_getTransactionByHash') return txs[p[0]]?.tx ?? null
      if (m === 'eth_getTransactionReceipt') return txs[p[0]]?.rcpt ?? null
      if (m === 'eth_call') {
        if (p[0].data === '0x95d89b41') return strRet(symbols[p[0].to] ?? 'TKN')
        if (p[0].data === '0x313ce567') return '0x' + w(p[0].to === TOKEN_OUT ? 6 : 18)
        if (revert) {
          const e = new Error('execution reverted')
          e.data = revert
          throw e
        }
        return '0x'
      }
      throw new Error('unexpected ' + m)
    },
    abi: async (a) => abis[a] ?? null,
    price: async (a) => prices[a] ?? null,
  }
}
const PRICES = { [WETH]: { usd: 2000, liquidityUsd: 1e6 }, [TOKEN_IN]: { usd: 2, liquidityUsd: 90000 }, [TOKEN_OUT]: { usd: 1, liquidityUsd: 100 } }
const SWAP_ABI = [{ type: 'function', name: 'swapExactIn', inputs: [{ name: 'p', type: 'tuple', components: [{ name: 'a', type: 'address' }, { name: 'b', type: 'uint256' }] }] }]
const swapSig = 'swapExactIn((address,uint256))'
const D = (extra = {}) => ({ chainId: CHAIN_ID, txHash: H('1'), ...extra })
const model = (text) => makeGateway({ providers: [fakeProvider(() => text, 'anthropic')] })

process.env.AI_PROVIDERS = 'anthropic'
delete process.env.AI_GATEWAY

// 1 ERC-20 transfer, priced
{
  const t = { [H('1')]: { tx: { from: USER, to: TOKEN_IN, input: sel('transfer(address,uint256)') + '00', value: '0x0' }, rcpt: rcpt({ logs: [logT(TOKEN_IN, USER, POOL, 5n * 10n ** 18n, 0)] }) } }
  const r = await buildFacts(D(), deps({ txs: t, prices: PRICES }))
  assert.ok(r.ok)
  const f = r.facts
  assert.equal(f.method.name, 'transfer'); assert.equal(f.method.source, 'known')
  assert.equal(f.transfers[0].amount, '5'); assert.equal(f.transfers[0].usd, '$10.00'); assert.equal(f.transfers[0].symbol, 'TKN')
  assert.equal(f.fee.eth, '0.0002'); assert.equal(f.fee.usd, '$0.40')
  assert.equal(f.tx.status, 'success'); assert.equal(f.chain.label, 'Testnet: no real value')
  assert.equal(f.graph.edges[0].kind, 'call'); assert.equal(f.graph.edges.find((e) => e.kind === 'transfer').logIndex, 0)
  ok('ERC-20 transfer: method, amount, USD, fee in USD, testnet label, graph edge cites its logIndex')
}
// 2 failed tx with revert reason
{
  const t = { [H('1')]: { tx: { from: USER, to: POOL, input: sel('foo()'), value: '0x0' }, rcpt: rcpt({ status: '0x0' }) } }
  const err = '0x08c379a0' + w(32) + w(9) + Buffer.from('too early').toString('hex').padEnd(64, '0')
  const r = await buildFacts(D(), deps({ txs: t, prices: PRICES, revert: err }))
  assert.equal(r.facts.tx.status, 'reverted'); assert.equal(r.facts.tx.revertReason, 'too early')
  assert.equal(r.facts.graph.revertPoint, POOL); assert.ok(r.facts.graph.edges[0].failed)
  assert.match(templateExplanation(r.facts), /failed: too early.*fee was still charged/)
  assert.equal(decodeRevert('0x4e487b71' + w(0x11)), 'panic code 0x11')
  ok('failed tx: revert reason decoded by replay, red revert point in the graph, template says fee still charged')
}
// 3 Gully-Core-style swap: verified ABI, tuple selector, two transfers, Thin chip on the low-liquidity token
{
  const input = sel(swapSig) + '00'
  const t = { [H('1')]: { tx: { from: USER, to: POOL, input, value: '0x0' }, rcpt: rcpt({ logs: [logT(TOKEN_IN, USER, POOL, 10n * 10n ** 18n, 0), logT(TOKEN_OUT, POOL, USER, 19_500_000n, 1)] }) } }
  const r = await buildFacts(D(), deps({ txs: t, abis: { [POOL]: SWAP_ABI }, prices: PRICES }))
  const f = r.facts
  assert.equal(methodFromAbi(SWAP_ABI, sel(swapSig)).signature, swapSig)
  assert.equal(f.method.name, 'swapExactIn'); assert.equal(f.method.source, 'sourcify')
  assert.deepEqual(f.transfers.map((x) => [x.amount, x.usd]), [['10', '$20.00'], ['19.5', '$19.50']])
  assert.equal(f.transfers[1].thin, true); assert.equal(f.transfers[0].thin, undefined)
  assert.equal(f.graph.steps.length, 4)
  assert.ok(f.contracts.find((c) => c.address === POOL).sourcePublished)
  ok('swap: tuple ABI selector decoded from Sourcify, USD per leg, Thin flag from liquidity, one graph step per event')
}
// 4 sponsored AA op: bundler signed, account credited
{
  const T_UO = tp('UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)')
  const uo = { address: ENTRY, topics: [T_UO, H('9'), pad(USER), pad(PM)], data: '0x' + w(0) + w(1) + w(5) + w(6), logIndex: '0x3' }
  const t = { [H('1')]: { tx: { from: BUNDLER, to: ENTRY, input: sel('handleOps((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[],address)') + '00', value: '0x0' }, rcpt: rcpt({ logs: [logT(TOKEN_IN, USER, POOL, 10n ** 18n, 2), uo] }) } }
  const r = await buildFacts(D(), deps({ txs: t, prices: PRICES }))
  const f = r.facts
  assert.equal(f.actor.address, USER); assert.equal(f.aa.bundler, BUNDLER); assert.equal(f.aa.sponsored, true); assert.equal(f.aa.userOpSuccess, true)
  assert.equal(f.fee.paidBy, 'sponsor (paymaster)')
  const kinds = f.graph.nodes.map((x) => x.kind)
  assert.ok(kinds.includes('bundler') && kinds.includes('paymaster'))
  assert.deepEqual(f.graph.edges.slice(0, 2).map((e) => [e.from, e.to]), [[BUNDLER, ENTRY], [ENTRY, USER]])
  assert.equal(f.graph.edges.find((e) => e.kind === 'transfer').from, USER)
  assert.equal(f.graph.edges.find((e) => e.kind === 'fee').from, PM)
  assert.match(templateExplanation(f), /smart account.*sponsor paid/)
  ok('sponsored AA op: account (not the bundler) is the actor; graph bundler -> EntryPoint -> account; sponsor pays the fee')
}
// 5 empty facts never reach the model; wrong chain; bad hash
{
  const d = deps({ txs: {} })
  const p = fakeProvider(() => 'x', 'anthropic')
  const r = await explainTx(D(), { deps: d, gw: makeGateway({ providers: [p] }) })
  assert.equal(r.ok, false); assert.equal(r.status, 404); assert.equal(p.calls.length, 0)
  assert.equal((await explainTx({ chainId: 8453, txHash: H('1') }, { deps: d })).code, 'wrong_chain')
  assert.equal((await explainTx({ chainId: CHAIN_ID, txHash: '0x12' }, { deps: d })).code, 'bad_input')
  const pend = deps({ txs: { [H('1')]: { tx: { from: USER, to: POOL, input: '0x', value: '0x0' }, rcpt: null } } })
  assert.equal((await explainTx(D(), { deps: pend, gw: makeGateway({ providers: [p] }) })).code, 'pending'); assert.equal(p.calls.length, 0)
  ok('unknown, pending, wrong-chain and malformed input are refused before any model call')
}
// 6 grounding: invented figure, forbidden word, missing label all fall back to the template; good text passes
{
  const t = { [H('1')]: { tx: { from: USER, to: TOKEN_IN, input: sel('transfer(address,uint256)') + '00', value: '0x0' }, rcpt: rcpt({ logs: [logT(TOKEN_IN, USER, POOL, 5n * 10n ** 18n, 0)] }) } }
  const { facts } = await buildFacts(D(), deps({ txs: t, prices: PRICES }))
  const good = 'The sender moved 5 TKN ($10.00) and paid a network fee of 0.0002 ETH ($0.40). Testnet: no real value.'
  assert.ok(checkGrounded(good, facts).ok)
  const bad = [
    good.replace('5 TKN', '6 TKN'),
    good.replace('moved', 'safely moved'),
    'Moved 5 TKN. Fee 0.0002 ETH.',
    good.replace('$10.00', '$1,000.00'),
  ]
  for (const b of bad) {
    const e = await explain(facts, { gw: model(b) })
    assert.equal(e.source, 'template', b); assert.ok(e.problems.length)
    assert.ok(checkGrounded(e.text, facts).ok, 'the template itself must pass the same check: ' + e.text)
  }
  assert.equal((await explain(facts, { gw: model(good) })).source, 'model')
  const down = makeGateway({ providers: [fakeProvider(() => { throw new Error('down') }, 'anthropic')] })
  assert.equal((await explain(facts, { gw: down })).source, 'template')
  process.env.AI_GATEWAY = 'off'
  assert.equal((await explain(facts, { gw: model(good) })).source, 'template')
  delete process.env.AI_GATEWAY
  assert.ok(numbersIn('0x3267…dd03 sent 1,234.50').has('1234.50') && !numbersIn('0x3267…dd03').size)
  assert.equal(fmtUnits(1n, 18), '<0.000001')
  ok('grounding: invented or altered figures, forbidden wording and a missing testnet label fall back to a template that passes the same check; kill switch and outage fall back too')
}
// 7 the model never sees the graph or allowedNumbers, and the facts it sees carry the figures
{
  const t = { [H('1')]: { tx: { from: USER, to: TOKEN_IN, input: sel('transfer(address,uint256)') + '00', value: '0x0' }, rcpt: rcpt({ logs: [logT(TOKEN_IN, USER, POOL, 10n ** 18n, 0)] }) } }
  const p = fakeProvider(() => 'x', 'anthropic')
  await explainTx(D(), { deps: deps({ txs: t, prices: PRICES }), gw: makeGateway({ providers: [p] }) })
  const sent = JSON.parse(p.calls[0].req.messages[0].content)
  assert.equal(sent.graph, undefined); assert.equal(sent.allowedNumbers, undefined); assert.equal(sent.transfers[0].usd, '$2.00')
  assert.match(p.calls[0].req.system, /ONLY facts/)
  ok('prompt carries facts only (no graph, no allow-list) and the rules')
}
// 8 route: flag off = 404, flag on = allowance + credits hook + result
{
  const mkRes = () => ({ code: 0, body: null })
  const http = { json: (res, code, body) => ((res.code = code), (res.body = body)), readJson: async () => ({ txHash: H('1') }), clientIp: () => '1.2.3.4' }
  const req = { method: 'POST', headers: { 'x-requested-with': 'gully' } }
  const url = new URL('http://x/api/ai/explain-tx')
  const t = { [H('1')]: { tx: { from: USER, to: TOKEN_IN, input: sel('transfer(address,uint256)') + '00', value: '0x0' }, rcpt: rcpt({ logs: [logT(TOKEN_IN, USER, POOL, 10n ** 18n, 0)] }) } }
  const inj = { http, takeAllowance: () => ({ ok: true }), deps: deps({ txs: t, prices: PRICES }), gw: model('The sender sent 1 TKN ($2.00); the fee was 0.0002 ETH ($0.40). Testnet: no real value.') }
  delete process.env.AI_EXPLAIN_TX
  let res = mkRes()
  assert.equal(await handleExplainTx(req, res, url, inj), true); assert.equal(res.code, 404)
  assert.equal(await handleExplainTx(req, mkRes(), new URL('http://x/api/other'), inj), false)
  process.env.AI_EXPLAIN_TX = '1'
  res = mkRes(); await handleExplainTx(req, res, url, inj)
  assert.equal(res.code, 200); assert.equal(res.body.source, 'model'); assert.equal(res.body.facts.allowedNumbers, undefined); assert.ok(res.body.facts.graph.edges.length)
  res = mkRes(); await handleExplainTx({ ...req, headers: {} }, res, url, inj); assert.equal(res.code, 403)
  res = mkRes(); await handleExplainTx(req, res, url, { ...inj, takeAllowance: () => ({ ok: false, status: 429, error: 'cap' }) }); assert.equal(res.code, 429)
  setExplainCreditsHook(async () => ({ ok: false, status: 402, error: 'no credits', code: 'credits' }))
  const p = fakeProvider(() => 'x', 'anthropic')
  res = mkRes(); await handleExplainTx(req, res, url, { ...inj, gw: makeGateway({ providers: [p] }) }); assert.equal(res.code, 402); assert.equal(p.calls.length, 0)
  setExplainCreditsHook(null)
  delete process.env.AI_EXPLAIN_TX
  ok('route: off by default (404), header check, shared allowance, credits hook can stop the call before the model')
}
console.log(`\n${n} passed`)
