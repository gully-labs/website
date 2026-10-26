// Gully Chain Testnet reads (server/gully-chain.mjs) against a stubbed indexer and a stubbed chain: launch status
// (indexer first, the launchpads' own info() when it is down), the LP lock read on chain, .gully names (indexer, then
// the reverse registrar with a forward check), the creator's record, the transfer probe (eth_call with a state
// override: fee on transfer, a revert, a false return), the behaviour points, the ledger figures and the chain health.
//   npm run test:gully-chain      (no build, no network)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-chain-'))
process.env.GULLY_RPC_485590 = 'http://127.0.0.1:9'

const G = await import('../server/gully-chain.mjs')

const word = (v) => BigInt(v).toString(16).padStart(64, '0')
const padAddr = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0')
const addr = (n) => '0x' + n.toString(16).padStart(40, '0')
const TOKEN = addr(0xe6ab)
const OTHER = addr(0xbeef)
const CREATOR = addr(0x12fa)
const HOLDER = addr(0x4444)
const LP21 = G.LAUNCHPADS[0]
const LP20 = G.LAUNCHPADS[1]
const NOW = 1_792_973_000_000
G.setGullyNowForTest(() => NOW)

/** ABI-encodes GullyLaunchpad.info()'s Info struct the way the chain returns it. */
function encodeInfo({ token, creator, name, symbol, uri = 'data:,', createdAt, realEth = 0n, tokensSold = 0n, ethReserve = 0n, tokenReserve = 0n, priceE18 = 0n, progressBps = 0, complete = false, graduated = false, pool = null }) {
  const strs = [name, symbol, uri]
  const head = []
  const tail = []
  let off = 15 * 32
  for (const s of strs) {
    const b = Buffer.from(s, 'utf8')
    head.push(word(off))
    const padded = b.toString('hex').padEnd(Math.ceil(b.length / 32) * 64, '0')
    tail.push(word(b.length) + padded)
    off += 32 + padded.length / 2
  }
  const words = [padAddr(token), padAddr(creator), head[0], head[1], head[2], word(createdAt), word(realEth), word(tokensSold), word(ethReserve), word(tokenReserve), word(priceE18), word(progressBps), word(complete ? 1 : 0), word(graduated ? 1 : 0), padAddr(pool ?? addr(0))]
  return '0x' + word(32) + words.join('') + tail.join('')
}

/* ---- the stubbed indexer ---- */
let indexerUp = true
const idxCalls = []
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const tokenRow = { address: TOKEN, symbol: 'LABRAT', name: 'Lab Rat', decimals: 18, source: 'launchpad', launchpad: LP20.address, launchpadVersion: '2.0.0', creator: CREATOR, createdAt: 1792944088, createdBlock: '74', win: { h24: { vol: 0.0025, buys: 2, sells: 1, makers: 1 } }, liquidityEth: 0.0014, mcapEth: 0.018, totalSupply: '1000000000000000000000000000', holders: 2, txns: 3, progressPct: 2.88, complete: false, graduated: false, pool: null, pools: [] }
const gradRow = { ...tokenRow, address: OTHER, symbol: 'MOSS', createdAt: 1792944000, createdBlock: '70', graduated: true, complete: true, progressPct: 100, pool: addr(0x9001), pools: [addr(0x9001)], launchpad: LP21.address, launchpadVersion: '2.1.0', win: { h24: { vol: 1.5, buys: 4, sells: 2, makers: 3 } } }
G.setGullyFetchForTest(async (url) => {
  const u = new URL(String(url))
  idxCalls.push(u.pathname + u.search)
  if (!indexerUp) throw new TypeError('fetch failed')
  if (u.pathname === '/head') return json({ chainId: 485590, block: 207, timestamp: 1792967264 })
  if (u.pathname === '/tokens') return json({ head: { block: 207 }, tokens: [tokenRow, gradRow] })
  if (u.pathname === `/tokens/${TOKEN}`) return json({ token: tokenRow, curve: {}, graduation: null, pools: [] })
  if (u.pathname === `/tokens/${OTHER}`) return json({ token: gradRow, curve: {}, graduation: { pool: addr(0x9001), tokenId: '7', locker: LP21.locker }, pools: [] })
  if (u.pathname === `/tokens/${TOKEN}/holders`) return json({ holders: [{ address: LP20.address, balance: '915', pct: 91.5, tag: 'launchpad' }, { address: HOLDER, balance: '85', pct: 8.5, tag: null }], holderCount: 2, totalSupply: '1000' })
  if (u.pathname.endsWith('/candles')) return json({ candles: [{ t: 1792886400, v: u.pathname.includes(TOKEN) ? 0.0025 : 1.5 }, { t: 1792972800, v: 0 }] })
  if (u.pathname === '/names') {
    const names = {}
    for (const a of (u.searchParams.get('addresses') ?? '').split(',')) if (a === CREATOR) names[a] = 'gullytester.gully'
    return json({ names })
  }
  return json({ error: 'not found' }, 404)
})

/* ---- the stubbed chain ---- */
let rpcUp = true
const rpcCalls = []
let simResult = null // the five words the probe returns, or an Error
const NODE = '0x' + 'ab'.repeat(32)
const FWD = G.namehash('gullytester.gully')
G.setGullyRpcForTest(async (chainId, method, params) => {
  rpcCalls.push({ chainId, method, params })
  if (!rpcUp) throw new Error('connect ECONNREFUSED')
  assert.equal(chainId, 485590)
  if (method === 'eth_blockNumber') return '0xcf'
  if (method === 'eth_getCode') return Number(BigInt(params[1] === 'latest' ? '0x100' : params[1])) >= 74 ? '0x6080' : '0x'
  if (method === 'eth_getBlockByNumber') return { timestamp: '0x' + (1792944088).toString(16) }
  if (method !== 'eth_call') return null
  const { to, data } = params[0]
  const sel = data.slice(0, 10)
  const override = params[2]
  if (override) {
    // The probe sits at the holder's address; the calldata is token, to, amount.
    assert.equal(to, HOLDER)
    assert.equal(override[HOLDER]?.code, G.PROBE_CODE)
    assert.equal('0x' + data.slice(2, 66), '0x' + padAddr(TOKEN))
    if (simResult instanceof Error) throw simResult
    return simResult
  }
  if (sel === G.SEL.balanceOf && to === TOKEN) return '0x' + word(1_000n * 10n ** 18n)
  if (sel === G.SEL.info) {
    const t = '0x' + data.slice(34, 74)
    if (to === LP20.address && t === TOKEN) return encodeInfo({ token: TOKEN, creator: CREATOR, name: 'Lab Rat', symbol: 'LABRAT', createdAt: 1792944088, progressBps: 288 })
    if (to === LP21.address && t === OTHER) return encodeInfo({ token: OTHER, creator: CREATOR, name: 'Moss', symbol: 'MOSS', createdAt: 1792944000, progressBps: 10000, complete: true, graduated: true, pool: addr(0x9001) })
    throw new Error('execution reverted')
  }
  if (sel === G.SEL.lpTokenId && to === LP21.address) return '0x' + word(7)
  if (sel === G.SEL.lpLocker && to === LP21.address) return '0x' + padAddr(LP21.locker)
  if (sel === G.SEL.ownerOf && to === G.GULLY_CHAIN.positionManager) return '0x' + padAddr(lpOwner)
  if (sel === G.SEL.node && to === G.GULLY_CHAIN.names.reverseRegistrar) return ('0x' + data.slice(34, 74)) === CREATOR ? NODE : '0x' + word(0)
  if (sel === G.SEL.resolver && to === G.GULLY_CHAIN.names.registry) return [NODE.slice(2), FWD.slice(2)].includes(data.slice(10, 74)) ? '0x' + padAddr(G.GULLY_CHAIN.names.publicResolver) : '0x' + word(0)
  if (sel === G.SEL.name && to === G.GULLY_CHAIN.names.publicResolver) return '0x' + word(32) + word(17) + Buffer.from('gullytester.gully').toString('hex').padEnd(64, '0')
  if (sel === G.SEL.addr && to === G.GULLY_CHAIN.names.publicResolver) return '0x' + padAddr(CREATOR)
  throw new Error('execution reverted')
})
let lpOwner = LP21.locker

test('selectors are computed from the signatures', () => {
  assert.equal(G.SEL.transfer, '0xa9059cbb')
  assert.equal(G.SEL.balanceOf, '0x70a08231')
  assert.equal(G.SEL.node, '0xbffbe61c')
  assert.equal(G.selector('ownerOf(uint256)'), '0x6352211e')
  assert.equal(G.namehash('eth'), '0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae')
  assert.equal(G.namehash(''), '0x' + '0'.repeat(64))
})

test('the transfer probe is sound: balanceOf, transfer, balanceOf, return five words', () => {
  const code = G.PROBE_CODE.slice(2)
  assert.ok(code.startsWith('6370a08231'), 'starts with PUSH4 balanceOf')
  assert.ok(code.includes('63a9059cbb'), 'contains PUSH4 transfer')
  assert.equal((code.match(/fa50/g) ?? []).length, 2, 'two STATICCALL + POP')
  assert.equal((code.match(/5af1/g) ?? []).length, 1, 'one GAS + CALL')
  assert.ok(code.endsWith('60a06080f3'), 'returns mem[0x80..0x120)')
  assert.match(G.PROBE_RECIPIENT, /^0x[0-9a-f]{40}$/)
})

test('decodeInfo reads the launchpad struct, strings included', () => {
  const i = G.decodeInfo(encodeInfo({ token: TOKEN, creator: CREATOR, name: 'Lab Rat', symbol: 'LABRAT', createdAt: 1792944088, progressBps: 288, ethReserve: 5n }))
  assert.equal(i.token, TOKEN)
  assert.equal(i.creator, CREATOR)
  assert.equal(i.name, 'Lab Rat')
  assert.equal(i.symbol, 'LABRAT')
  assert.equal(i.progressBps, 288)
  assert.equal(i.ethReserve, 5n)
  assert.equal(i.pool, null)
  assert.equal(G.decodeInfo('0x'), null)
})

test('launchStatus: from the indexer, with the creator and the curve', async () => {
  G.resetGullyChainForTest()
  const l = await G.launchStatus(TOKEN)
  assert.equal(l.venue, 'gully-launchpad')
  assert.equal(l.version, '2.0.0')
  assert.equal(l.creator, CREATOR)
  assert.equal(l.createdBlock, 74)
  assert.equal(l.createdAt, '2026-10-25T16:01:28.000Z')
  assert.deepEqual(l.curve, { progressPct: 2.88, complete: false, graduated: false })
  assert.equal(l.lp, null, 'no LP position before graduation')
  assert.equal(l.source, 'indexer')
  assert.equal(await G.launchStatus(addr(0x1)), null, 'a 404 from the indexer is "not a launch"')
})

test('launchStatus: a graduated launch has its LP NFT checked on chain (locker, then not)', async () => {
  G.resetGullyChainForTest()
  lpOwner = LP21.locker
  let l = await G.launchStatus(OTHER)
  assert.equal(l.version, '2.1.0')
  assert.equal(l.curve.graduated, true)
  assert.deepEqual(l.lp, { locked: true, tokenId: '7', locker: LP21.locker, owner: LP21.locker, reason: null })
  assert.equal(l.pool, addr(0x9001))
  lpOwner = addr(0x7777)
  G.resetGullyChainForTest()
  l = await G.launchStatus(OTHER)
  assert.equal(l.lp.locked, false)
  assert.equal(l.lp.owner, addr(0x7777))
})

test('launchStatus: indexer down → the launchpads answer themselves; a revert means not a launch; no node means unknown', async () => {
  G.resetGullyChainForTest()
  indexerUp = false
  const l = await G.launchStatus(TOKEN)
  assert.equal(l.source, 'rpc')
  assert.equal(l.launchpad, LP20.address)
  assert.equal(l.creator, CREATOR)
  assert.equal(l.symbol, 'LABRAT')
  assert.equal(l.curve.progressPct, 2.88)
  assert.equal(await G.launchStatus(addr(0x1)), null)
  rpcUp = false
  G.resetGullyChainForTest()
  assert.equal(await G.launchStatus(addr(0x1)), undefined)
  rpcUp = true
  indexerUp = true
})

test('creatorHistory and findHolder come from the indexer', async () => {
  G.resetGullyChainForTest()
  const h = await G.creatorHistory(CREATOR)
  assert.equal(h.launches, 2)
  assert.equal(h.graduated, 1)
  assert.equal(h.onCurve, 1)
  assert.equal(h.first, '2026-10-25T16:00:00.000Z')
  assert.equal(h.tokens[0].symbol, 'LABRAT', 'newest first')
  assert.equal(await G.findHolder(TOKEN), HOLDER, 'the launchpad is skipped')
  indexerUp = false
  G.resetGullyChainForTest()
  assert.equal(await G.creatorHistory(CREATOR), null)
  assert.equal(await G.findHolder(TOKEN), null)
  indexerUp = true
})

test('gullyNames: the indexer in one call, cached; the reverse registrar with a forward check when it is down', async () => {
  G.resetGullyChainForTest()
  idxCalls.length = 0
  const n = await G.gullyNames([CREATOR, HOLDER, 'nope'])
  assert.deepEqual([...n], [[CREATOR, 'gullytester.gully']])
  assert.equal(idxCalls.filter((p) => p.startsWith('/names')).length, 1)
  await G.gullyNames([CREATOR, HOLDER])
  assert.equal(idxCalls.filter((p) => p.startsWith('/names')).length, 1, 'cached')
  G.resetGullyChainForTest()
  indexerUp = false
  rpcCalls.length = 0
  const r = await G.gullyNames([CREATOR, HOLDER])
  assert.deepEqual([...r], [[CREATOR, 'gullytester.gully']])
  assert.ok(rpcCalls.some((c) => c.params[0]?.to === G.GULLY_CHAIN.names.reverseRegistrar), 'reverse registrar asked')
  assert.ok(rpcCalls.some((c) => c.params[0]?.data?.startsWith(G.SEL.addr)), 'forward record checked')
  indexerUp = true
})

test('simulateTransfer: a tenth of the balance, one eth_call with the probe at the holder; fee, revert, false', async () => {
  const amount = 100n * 10n ** 18n
  simResult = '0x' + word(0) + word(1) + word(1) + word(32) + word((amount * 95n) / 100n)
  let s = await G.simulateTransfer(485590, TOKEN, HOLDER)
  assert.deepEqual(s, { ok: true, sent: amount.toString(), received: ((amount * 95n) / 100n).toString(), feePct: 5, returnedFalse: false })
  simResult = '0x' + word(0) + word(1) + word(1) + word(32) + word(amount)
  s = await G.simulateTransfer(485590, TOKEN, HOLDER)
  assert.equal(s.feePct, 0)
  simResult = '0x' + word(0) + word(0) + word(0) + word(0) + word(0)
  s = await G.simulateTransfer(485590, TOKEN, HOLDER)
  assert.deepEqual(s, { ok: false, reverted: true, returnedFalse: false, sent: amount.toString() })
  simResult = '0x' + word(0) + word(0) + word(1) + word(32) + word(0)
  s = await G.simulateTransfer(485590, TOKEN, HOLDER)
  assert.equal(s.returnedFalse, true)
  simResult = new Error('state override not supported')
  s = await G.simulateTransfer(485590, TOKEN, HOLDER)
  assert.match(s.error, /could not run/)
  assert.match((await G.simulateTransfer(485590, TOKEN, null)).error, /No holder/)
})

test('behaviourPoints: controls and the simulation take points; a launchpad token keeps its fixed-supply mint', () => {
  const none = { mint: [], blacklist: [], fee: [], limits: [], trading: [] }
  assert.equal(G.behaviourPoints({ controls: none, sim: { ok: true, feePct: 0 } }), 100)
  assert.equal(G.behaviourPoints({ controls: { ...none, mint: ['mint(address,uint256)'] }, sim: { ok: true, feePct: 0 } }), 60)
  assert.equal(G.behaviourPoints({ controls: { ...none, mint: ['mint(address,uint256)'] }, sim: { ok: true, feePct: 0 }, fixedSupply: true }), 100)
  assert.equal(G.behaviourPoints({ controls: { ...none, blacklist: ['x'], fee: ['y'] }, sim: { ok: true, feePct: 5 } }), 100 - 30 - 15 - 15)
  assert.equal(G.behaviourPoints({ controls: none, sim: { ok: true, feePct: 40 } }), 50)
  assert.equal(G.behaviourPoints({ controls: none, sim: { ok: false, reverted: true } }), 40)
  assert.equal(G.behaviourPoints({ controls: { mint: ['m'], blacklist: ['b'], fee: ['f'], limits: ['l'], trading: ['t'] }, sim: { ok: false }, delegatecall: true }), 0)
})

test('tokenBehaviour: not a token without transfer/balanceOf; a token is simulated from the indexer holder', async () => {
  G.resetGullyChainForTest()
  assert.deepEqual(await G.tokenBehaviour({ chainId: 485590, address: TOKEN, code: '0x6080604052' }), { token: false })
  // PUSH4 sel EQ for transfer, balanceOf, blacklist(address) and setFee(uint256).
  const code = '0x' + ['a9059cbb', '70a08231', 'f9f92be4', '69fe0e2d'].map((s) => `63${s}14`).join('')
  const amount = 100n * 10n ** 18n
  simResult = '0x' + word(0) + word(1) + word(1) + word(32) + word((amount * 90n) / 100n)
  const b = await G.tokenBehaviour({ chainId: 485590, address: TOKEN, code })
  assert.equal(b.token, true)
  assert.equal(b.holder, HOLDER)
  assert.deepEqual(b.controls.blacklist, ['blacklist(address)'])
  assert.deepEqual(b.controls.fee, ['setFee(uint256)'])
  assert.equal(b.simulation.feePct, 10)
  assert.equal(b.score, 100 - 30 - 15 - 30)
  assert.equal(b.value, '10% fee on transfer')
  assert.match(b.reason, /blacklist functions/)
  assert.match(b.reason, /10% short/)
})

test('deployBlock: the first block with code, by binary search on our archive node', async () => {
  assert.equal(await G.deployBlock(TOKEN), 74)
  assert.equal(await G.blockTimeOf(74), '2026-10-25T16:01:28.000Z')
})

test('ledgerFigures: test ETH only, counts and a daily series from the candles', async () => {
  G.resetGullyChainForTest()
  const f = await G.ledgerFigures()
  assert.equal(f.head.block, 207)
  assert.equal(f.native.symbol, 'ETH')
  assert.equal(f.native.testnet, true)
  assert.equal(f.native.volume24h, 1.5025)
  assert.equal(f.native.volumeAll, 1.5025)
  assert.equal(f.native.chartedTokens, 2)
  assert.deepEqual(f.native.daily, [{ t: 1792886400, v: 1.5025 }, { t: 1792972800, v: 0 }])
  assert.deepEqual(f.counts, { launches: 2, launches24h: 2, graduated: 1, onCurve: 1, pools: 1, holders: 4, swaps: 6, swaps24h: 9, makers24h: 4, tokens: 2 })
  assert.equal(f.lastActivity, '2026-10-25T23:59:59.000Z', 'the end of the last day with volume')
  indexerUp = false
  G.resetGullyChainForTest()
  await assert.rejects(G.ledgerFigures(), /indexer/)
  indexerUp = true
})

test('chainHealth: both heads, and each failure on its own', async () => {
  G.resetGullyChainForTest()
  let h = await G.chainHealth()
  assert.equal(h.rpc.block, 207)
  assert.equal(h.indexer.block, 207)
  indexerUp = false
  G.resetGullyChainForTest()
  h = await G.chainHealth()
  assert.equal(h.rpc.block, 207)
  assert.match(h.indexer.error, /indexer/)
  indexerUp = true
  rpcUp = false
  G.resetGullyChainForTest()
  h = await G.chainHealth()
  assert.match(h.rpc.error, /ECONNREFUSED/)
  assert.equal(h.indexer.block, 207)
  rpcUp = true
})
