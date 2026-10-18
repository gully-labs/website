// Holder Map (server/holders.mjs, holders-card.mjs and the holder alerts in alerts.mjs), offline: every
// upstream (DeepCore's API, the RPCs, Blockscout, Moralis, Solana) is a stub, so no call leaves the machine.
// Covers balance reconstruction from Transfer logs, clustering, labels, the summary maths, the launch
// forensics, the replay, tiers, the cache, degrading without a key, CSV/card routes and holder alerts.
// Run: npm run test:holders
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-holders-'))
Object.assign(process.env, { DATA_DIR: tmp, TRACKER_DATA: path.join(tmp, 'tracker.json'), TRACKER_LOOP: 'off', DEEPCORE_LOOP: 'off', HOLDER_ALERTS_LOOP: 'off', DEEPCORE_API: 'https://dc.test', BLOCKSCOUT_API: 'https://bs.test', BLOCKSCOUT_METADATA_API: 'https://meta.test', MORALIS_API: 'https://moralis.test', GULLY_RPC_4663: 'https://rpc4663.test', GULLY_RPC_56: 'https://rpc56.test', GULLY_RPC_SOLANA: 'https://sol.test', SOLANA_RPC_ONLY_ENV: '1' })
for (const k of ['BLOCKSCOUT_API_KEY', 'MORALIS_API_KEY', 'HOLDER_MAP_GATED', 'JUPITER_FEE_ACCOUNT']) delete process.env[k]

const H = await import('../server/holders.mjs')
const A = await import('../server/alerts.mjs')
const { renderHolderCardSvg, renderHolderStatusCardSvg } = await import('../server/holders-card.mjs')

const TOPIC = H.TRANSFER_TOPIC
const ZERO = '0x' + '0'.repeat(40)
const addr = (n) => '0x' + n.toString(16).padStart(40, '0')
const topic = (a) => '0x' + a.slice(2).padStart(64, '0')
const E18 = 10n ** 18n
const log = (from, to, value, block, tx, i = 0, ts = null) => ({ topics: [TOPIC, topic(from), topic(to)], data: '0x' + value.toString(16), blockNumber: '0x' + block.toString(16), transactionHash: tx, logIndex: '0x' + i.toString(16), ...(ts ? { blockTimestamp: '0x' + ts.toString(16) } : {}) })
const tr = (from, to, value, block, tx = `0x${block}`, i = 0) => ({ from, to, value, block, tx, index: i, ts: null })

/* -------------------------------------------------------------- pure parts --- */

test('decodeTransfer reads DeepCore and RPC log shapes and rejects other events', () => {
  const t = H.decodeTransfer(log(addr(1), addr(2), 5n * E18, 10, '0xab', 3, 1_700_000_000))
  assert.deepEqual(t, { from: addr(1), to: addr(2), value: 5n * E18, block: 10, tx: '0xab', index: 3, ts: 1_700_000_000 })
  assert.equal(H.decodeTransfer({ ...log(addr(1), addr(2), 1n, 1, '0x1'), topics: ['0x' + '1'.repeat(64), topic(addr(1)), topic(addr(2))] }), null)
  assert.equal(H.decodeTransfer({ topics: [TOPIC, topic(addr(1))], data: '0x1' }), null)
  assert.equal(H.decodeTransfer(log(addr(1), addr(2), 1n, 1, '0x1', 0, 0)).ts, null, 'a zero blockTimestamp is no time')
})

test('reconstructBalances: mints do not debit zero, burns credit it, transfers move balances exactly', () => {
  const b = H.reconstructBalances([tr(ZERO, addr(1), 1000n), tr(addr(1), addr(2), 300n), tr(addr(2), addr(3), 100n), tr(addr(1), ZERO, 50n)])
  assert.equal(b.get(addr(1)), 650n)
  assert.equal(b.get(addr(2)), 200n)
  assert.equal(b.get(addr(3)), 100n)
  assert.equal(b.get(ZERO), 50n, 'burned')
})

test('clusterize: union-find groups connected wallets, drops singletons, ignores unknown ids', () => {
  const g = H.clusterize(['a', 'b', 'c', 'd', 'e'], [['a', 'b'], ['b', 'c'], ['d', 'x']])
  assert.deepEqual(g.map((x) => x.sort()), [['a', 'b', 'c']])
})

test('pctOf and units keep precision with BigInt', () => {
  assert.equal(H.pctOf(1n, 3n), 33.3333)
  assert.equal(H.pctOf(5n, 0n), null)
  assert.equal(H.units(1234567n * 10n ** 15n, 18), 1234.567)
})

/* A launch: the kit mints 1,000,000 to itself and seeds the vault; three wallets buy in the first block of
   trading (bundled), the deployer funds wallet 7 with tokens, wallets 5 and 6 trade with each other. */
const VAULT = addr(0xa0)
const KIT = addr(0xa1)
const DEPLOYER = addr(0xd0)
const TOKEN = addr(0xee)
function launchHistory() {
  const t = []
  t.push(tr(ZERO, KIT, 1_000_000n * E18, 100, '0xseed', 0))
  t.push(tr(KIT, VAULT, 1_000_000n * E18, 100, '0xseed', 1))
  t.push(tr(VAULT, addr(1), 100_000n * E18, 110, '0xb1'))
  t.push(tr(VAULT, addr(2), 80_000n * E18, 110, '0xb2'))
  t.push(tr(VAULT, addr(3), 60_000n * E18, 110, '0xb3'))
  t.push(tr(VAULT, DEPLOYER, 50_000n * E18, 112, '0xb4'))
  t.push(tr(DEPLOYER, addr(7), 20_000n * E18, 113, '0xf1'))
  t.push(tr(VAULT, addr(5), 30_000n * E18, 115, '0xb5'))
  t.push(tr(addr(5), addr(6), 10_000n * E18, 116, '0xt1'))
  t.push(tr(addr(6), addr(5), 1_000n * E18, 117, '0xt2'))
  t.push(tr(addr(3), ZERO, 10_000n * E18, 118, '0xburn'))
  return t
}
const LAUNCH = { creator: DEPLOYER, createdAt: { blockNumber: '100', blockTimestamp: '2026-10-11T08:20:21.000Z' }, legs: [{ lock: { status: 'indexed', locker: addr(0xa2), lockedAt: { blockTimestamp: '2026-10-11T08:20:21.000Z' } } }], launchToken: { symbol: 'TST', decimals: 18 }, totalSupply: { raw: String(1_000_000n * E18) } }
const LABELS = () => H.staticLabels({ chainKey: 'robinhood', token: TOKEN, venue: { vault: VAULT, launchpadKitV2: KIT, poolManagers: {}, routers: {} }, launch: LAUNCH })

test('buildMap on a launch: exact shares, labels kept out of clusters, forensics and the plain summary', () => {
  const m = H.buildMap({ chainKey: 'robinhood', token: TOKEN, symbol: 'TST', decimals: 18, kind: 'deepcore-launch', holders: null, history: { transfers: launchHistory(), complete: true }, labels: LABELS(), supply: 1_000_000n * E18, launch: LAUNCH, funding: { checked: false, recipients: [], reason: 'not checked' }, sources: {}, tier: 'pro' })
  assert.equal(m.state, 'ok')
  const by = Object.fromEntries(m.nodes.map((n) => [n.id, n]))
  assert.equal(by[VAULT].label.kind, 'pool')
  assert.equal(by[VAULT].pct, 68, 'vault keeps 680,000 of 1,000,000')
  assert.equal(by[addr(1)].pct, 10)
  assert.equal(by[addr(3)].pct, 5, '60,000 bought, 10,000 burned')
  assert.equal(by[ZERO].label.kind, 'burn')
  assert.equal(by[DEPLOYER].label.kind, 'deployer')
  // Top 10 wallets (not pools/burn): 100k + 80k + 50k + 30k(=5: 30-10+1=21k) ... computed exactly:
  const wallets = [100_000, 80_000, 50_000, 30_000, 21_000, 20_000, 9_000] // addr1, addr2, addr3, deployer, addr5, addr7, addr6
  assert.equal(m.summary.top10Pct, wallets.reduce((s, v) => s + v, 0) / 10_000)
  // Clusters: {5,6} by trading; {deployer,7} by funding. Infra (vault) never joins.
  const cl = m.clusters.map((c) => c.wallets.slice().sort())
  assert.ok(cl.some((c) => c.length === 2 && c.includes(addr(5)) && c.includes(addr(6))))
  assert.ok(cl.some((c) => c.includes(DEPLOYER) && c.includes(addr(7))))
  assert.ok(!m.clusters.some((c) => c.wallets.includes(VAULT)))
  assert.equal(m.clusters[0].pct, 5, 'deployer 30k + wallet 7 20k = 5%')
  assert.match(m.summary.line, /^Top 10 wallets hold 31%; the largest connected cluster holds 5\.0% across 2 wallets\.$/)
  // Forensics: three wallets bought in block 110, the first block of trading.
  assert.equal(m.forensics.firstTradeBlock, 110)
  assert.equal(m.forensics.bundled.wallets, 3)
  assert.equal(m.forensics.bundled.pct, 23, '100k + 80k + 50k (after the burn)')
  assert.equal(m.forensics.riskLine, '3 wallets bought in the first block of trading and hold 23% now.')
  assert.ok(by[addr(1)].flags.includes('bundled'))
  assert.equal(m.forensics.deployerPct, 3)
  assert.equal(m.forensics.funded.wallets, 1)
  assert.ok(by[addr(7)].flags.includes('funded-by-deployer'))
  assert.equal(m.forensics.liquidity.locked, true)
  assert.ok(m.summary.plain.some((p) => /launch lock/.test(p)))
  assert.ok(m.summary.plain.some((p) => /burned/.test(p)))
  assert.ok(m.links.some((l) => l.kind === 'funding'))
  // Replay from every transfer: the last frame equals today's shares.
  assert.equal(m.timeline.basis, 'every transfer since launch')
  assert.equal(m.timeline.frames.length, launchHistory().length)
  assert.deepEqual(m.timeline.frames.at(-1).pcts, m.nodes.slice(0, m.holders.graph).map((n) => n.pct))
})

test('a lone first buyer is not "bundled"', () => {
  const t = [tr(ZERO, KIT, 1000n, 100, '0xs', 0), tr(KIT, VAULT, 1000n, 100, '0xs', 1), tr(VAULT, addr(1), 10n, 200, '0xa'), tr(VAULT, addr(2), 10n, 205, '0xb')]
  const m = H.buildMap({ chainKey: 'robinhood', token: TOKEN, symbol: 'TST', decimals: 0, kind: 'deepcore-launch', history: { transfers: t, complete: true }, labels: LABELS(), supply: 1000n, launch: LAUNCH, sources: {} })
  assert.equal(m.forensics.bundled.wallets, 0)
  assert.equal(m.forensics.bundled.firstBlockBuyers, 1)
  assert.match(m.forensics.riskLine, /^No bundled buying/)
})

test('free tier: 50 wallets listed, no replay, locked features named; the safety lines stay', () => {
  const holders = Array.from({ length: 80 }, (_, i) => ({ address: addr(i + 1), raw: BigInt(1000 - i) }))
  const free = H.buildMap({ chainKey: 'robinhood', token: TOKEN, symbol: 'X', decimals: 0, kind: 'stock', holders, history: { transfers: [tr(addr(1), addr(2), 1n, 5), tr(addr(2), addr(3), 1n, 6)], complete: false }, labels: new Map(), supply: null, sources: {}, tier: 'free' })
  assert.equal(free.nodes.length, 50)
  assert.equal(free.timeline, null)
  assert.ok(free.locked.includes('replay'))
  assert.equal(free.holders.sharesOf, 'listed holders', 'no supply: shares of the listed holders, and it says so')
  const pro = H.buildMap({ chainKey: 'robinhood', token: TOKEN, symbol: 'X', decimals: 0, kind: 'stock', holders, history: { transfers: [tr(addr(1), addr(2), 1n, 5), tr(addr(2), addr(3), 1n, 6)], complete: false }, labels: new Map(), supply: null, sources: {}, tier: 'pro' })
  assert.equal(pro.nodes.length, 80)
  assert.ok(pro.timeline, 'rolled back over the window')
  assert.equal(pro.timeline.basis, 'rolled back from today over the latest transfers')
  assert.deepEqual(pro.locked, [])
})

test('a rolled-back replay that would go negative is withheld, not drawn wrong', () => {
  // Wallet 1 holds 5 today but the window shows it receiving 10: a transfer before the window is missing.
  const tl = H.buildTimeline({ history: { transfers: [tr(addr(9), addr(1), 10n, 1), tr(addr(9), addr(2), 1n, 2)], complete: false }, balances: new Map([[addr(1), 5n], [addr(2), 1n]]), ids: [addr(1), addr(2)], wallets: [addr(1), addr(2)], total: 100n })
  assert.equal(tl, null)
})

test('stock overlay: value at the real share price, the premium, and what buyers paid against fair', () => {
  const POOL = addr(0xb0)
  const holders = [{ address: addr(1), raw: 10n * E18 }, { address: addr(2), raw: 5n * E18 }]
  const transfers = [{ ...tr(POOL, addr(1), 2n * E18, 50), ts: 1_000 }]
  const m = H.buildMap({ chainKey: 'robinhood', token: TOKEN, symbol: 'NVDA', decimals: 18, kind: 'stock', holders, history: { transfers, complete: false }, labels: new Map([[POOL, { kind: 'pool', name: 'Trading pool' }]]), supply: 100n * E18, fair: { fair: 100, onchain: 102, gapPct: 2, status: 'premium' }, fairHistory: [[990, 1.5, 101.5, 100], [5000, 0, 100, 100]], sources: {} })
  const n1 = m.nodes.find((n) => n.id === addr(1))
  assert.equal(n1.valueAtFairUsd, 1000)
  assert.equal(n1.premiumUsd, 20)
  assert.equal(n1.boughtGapPct, 1.5)
  assert.equal(m.fair.top10PremiumUsd, 30)
  assert.ok(m.summary.plain.some((p) => /premium of about \$30/.test(p)))
  // An untrusted gap never produces a premium figure.
  const u = H.buildMap({ chainKey: 'robinhood', token: TOKEN, symbol: 'NVDA', decimals: 18, kind: 'stock', holders, history: null, labels: new Map(), supply: 100n * E18, fair: { fair: 100, onchain: 140, gapPct: 40, status: 'unverified' }, sources: {} })
  assert.equal(u.nodes[0].premiumUsd, null)
  assert.equal(u.fair.gapPct, null)
})

test('labels: burn, token contract, DeepCore vault/kit/lock, Gully fee proxies on chains that have them', () => {
  const l = H.staticLabels({ chainKey: 'bsc', token: TOKEN, venue: { vault: VAULT, poolManagers: { cl: addr(0xc1) }, routers: { u: addr(0xc2) } }, launch: LAUNCH })
  assert.equal(l.get(ZERO).kind, 'burn')
  assert.equal(l.get('0x000000000000000000000000000000000000dead').kind, 'burn')
  assert.equal(l.get(TOKEN).kind, 'token')
  assert.equal(l.get(VAULT).kind, 'pool')
  assert.equal(l.get(addr(0xc2)).kind, 'router')
  assert.equal(l.get(addr(0xa2)).kind, 'lock')
  assert.equal(l.get('0x0dfbee143b42b41efc5a6f87bfd1ffc78c2f0ac9').kind, 'gully')
})

/* ------------------------------------------------------- IO with stubs --- */

const calls = []
let blockscoutHolders = null
function stubFetch(url, init = {}) {
  const u = new URL(String(url))
  calls.push(u.host + u.pathname)
  const ok = (body) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
  if (u.host === 'dc.test') {
    if (u.pathname === '/v1/venue/4663') return ok({ data: { vault: VAULT, launchpadKitV2: KIT, poolManagers: {}, routers: {} } })
    if (u.pathname === `/v1/chains/4663/kit-v2/launches/token/${TOKEN}`) return ok({ data: LAUNCH })
    if (u.pathname.startsWith('/v1/chains/4663/kit-v2/launches/token/')) return Promise.resolve(new Response('{"error":{}}', { status: 404 }))
    if (u.pathname === '/v1/chains/4663/logs') {
      const all = launchHistory().map((t, i) => log(t.from, t.to, t.value, t.block, t.tx, i))
      const page = u.searchParams.get('cursor') ? 1 : 0
      const half = Math.ceil(all.length / 2)
      return ok({ data: { logs: page ? all.slice(half) : all.slice(0, half), toBlock: '200' }, page: { hasMore: !page, nextCursor: page ? null : 'c1' } })
    }
  }
  if (u.host === 'rpc4663.test' || u.host === 'rpc56.test') {
    const body = JSON.parse(String(init.body))
    const one = (q) => ({ jsonrpc: '2.0', id: q.id, result: q.method === 'eth_getCode' ? (q.params[0] === VAULT ? '0x6080' : '0x') : q.method === 'eth_blockNumber' ? '0x3e8' : q.method === 'eth_call' ? '0x' + (1000n * E18).toString(16) : q.method === 'eth_getLogs' ? [log(addr(1), addr(2), E18, 990, '0xl1')] : q.method === 'eth_getBlockByNumber' ? { timestamp: '0x6a000000' } : null })
    return ok(Array.isArray(body) ? body.map(one) : one(body))
  }
  if (u.host === 'meta.test') return ok({ addresses: { [addr(4)]: { tags: [{ tagType: 'name', name: 'Binance 8', slug: 'binance-8' }, { tagType: 'generic', slug: 'exchange', name: 'Exchange' }] } } })
  if (u.host === 'bs.test') {
    if (u.pathname.endsWith('/holders')) return ok({ items: blockscoutHolders, next_page_params: null })
    return ok({ holders_count: '1234', total_supply: String(1000n * E18) })
  }
  return Promise.reject(new TypeError(`unexpected fetch ${u.host}`))
}
H.setHoldersFetchForTest(stubFetch)
H.setTrackerForTest(async (chain, ticker) => (ticker === 'NVDA' ? { fair: 100, onchain: 101, gapPct: 1, status: 'in-line', pool: null } : null), () => [])

test('a DeepCore launch is rebuilt from DeepCore’s log index, paged, with venue labels and freshness', async () => {
  H.resetHoldersForTest()
  const m = await H.computeHolderMap('robinhood', TOKEN, 'pro')
  assert.equal(m.state, 'ok')
  assert.equal(m.kind, 'deepcore-launch')
  assert.match(m.sources.holders, /all 11 transfers since launch/)
  assert.equal(m.forensics.bundled.wallets, 3)
  assert.ok(Date.parse(m.asOf) > 0)
  assert.equal(m.nodes.find((n) => n.id === VAULT).contract, true)
  assert.ok(calls.some((c) => c === 'dc.test/v1/chains/4663/logs'))
})

test('a token that is neither a launch nor a tracked stock is refused (no upstream hammering)', async () => {
  H.resetHoldersForTest()
  const m = await H.computeHolderMap('robinhood', addr(0x99), 'pro')
  assert.equal(m.state, 'not-found')
})

test('without a key a chain degrades to a plain "coming soon", never an env-var name', async () => {
  H.resetHoldersForTest()
  const noEnv = (m) => assert.ok(!/_KEY|GULLY_RPC|API key|RPC/.test(JSON.stringify(m)), `no env names or jargon: ${m.reason}`)
  const rh = await H.computeHolderMap('robinhood', 'NVDA', 'pro')
  assert.equal(rh.state, 'unavailable')
  assert.equal(rh.comingSoon, true)
  assert.equal(rh.reason, 'Holder history is not available yet on Robinhood Chain. DeepCore launches already have live maps.', 'no archive RPC answers and no fallback key: honest, not partial')
  noEnv(rh)
  const bsc = await H.computeHolderMap('bsc', 'AAPL', 'pro')
  assert.equal(bsc.comingSoon, true)
  noEnv(bsc)
  const real = globalThis.fetch
  const rpc = process.env.GULLY_RPC_SOLANA
  globalThis.fetch = async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 429, message: 'Too many requests' } }), { status: 429 })
  try {
    // A private RPC is set but fails: "could not be read just now", not "coming soon".
    const sol = await H.computeHolderMap('solana', 'CRCL', 'pro')
    assert.equal(sol.state, 'unavailable')
    assert.equal(sol.comingSoon, false)
    noEnv(sol)
    delete process.env.GULLY_RPC_SOLANA
    const sol2 = await H.computeHolderMap('solana', 'CRCL', 'pro')
    assert.equal(sol2.comingSoon, true)
    assert.match(sol2.reason, /Holder history is not available yet on Solana/)
    noEnv(sol2)
  } finally {
    globalThis.fetch = real
    process.env.GULLY_RPC_SOLANA = rpc
  }
})

test('holdersAvailable / holdersButtonVisible follow the data keys; launches never need one', () => {
  const rpc = process.env.GULLY_RPC_SOLANA
  try {
    assert.equal(H.holdersAvailable('robinhood'), false)
    assert.equal(H.holdersAvailable('bsc'), false)
    assert.equal(H.holdersAvailable('robinhood', 'deepcore-launch'), true)
    assert.equal(H.holdersAvailable('bsc', 'deepcore-launch'), true)
    assert.equal(H.holdersAvailable('solana', 'deepcore-launch'), false)
    assert.equal(H.holdersAvailable('mars'), false)
    assert.equal(H.holdersAvailable('4663'), false, 'chain ids work too')
    assert.equal(H.holdersButtonVisible('robinhood', 'NVDA'), false, 'stock card: hidden without the key')
    assert.equal(H.holdersButtonVisible('robinhood', TOKEN), true, 'launch: always shown')
    process.env.BLOCKSCOUT_API_KEY = 'k'
    process.env.MORALIS_API_KEY = 'k'
    assert.equal(H.holdersAvailable('robinhood'), true)
    assert.equal(H.holdersAvailable('bsc'), true)
    assert.equal(H.holdersButtonVisible('robinhood', 'NVDA'), true)
    delete process.env.GULLY_RPC_SOLANA
    assert.equal(H.holdersAvailable('solana'), false)
    process.env.GULLY_RPC_SOLANA = 'https://sol.test'
    assert.equal(H.holdersAvailable('solana'), true)
    const health = H.holdersSourceHealth()
    const rh = health.find((h) => h.chain === 'robinhood')
    assert.equal(rh.fallbackEnv, 'BLOCKSCOUT_API_KEY')
    assert.equal(rh.env, 'GULLY_RPC_4663')
    assert.equal(rh.active, 'blockscout', 'no archive RPC answering: the fallback is the active source')
    assert.equal(rh.label, 'Blockscout (fallback)')
  } finally {
    delete process.env.BLOCKSCOUT_API_KEY
    delete process.env.MORALIS_API_KEY
    process.env.GULLY_RPC_SOLANA = rpc
  }
})

test('card.png for a chain with no data yet is a branded PNG, never JSON', async () => {
  H.resetHoldersForTest()
  const r = fakeRes()
  await H.handleHolders({ method: 'GET', url: '/api/holders/robinhood/NVDA/card.png', headers: { 'x-forwarded-for': '198.51.100.9' }, socket: { remoteAddress: '198.51.100.9' } }, r, new URL('http://x/api/holders/robinhood/NVDA/card.png'), null)
  assert.equal(r.out.status, 200)
  assert.equal(r.out.headers['Content-Type'], 'image/png')
  assert.deepEqual([...r.out.body.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
  const svg = renderHolderStatusCardSvg({ state: 'unavailable', comingSoon: true, chain: { name: 'Robinhood Chain' }, token: { symbol: 'NVDA' } })
  assert.match(svg, /MAP COMING SOON/)
  assert.match(svg, /NVDA/)
})

test('with a Blockscout key: top holders, exchange tags, recent-transfer links and the fair overlay', async () => {
  H.resetHoldersForTest()
  process.env.BLOCKSCOUT_API_KEY = 'proapi_test'
  blockscoutHolders = [{ address: { hash: addr(1), is_contract: false }, value: String(600n * E18) }, { address: { hash: addr(4), is_contract: false }, value: String(300n * E18) }, { address: { hash: addr(2), is_contract: false }, value: String(100n * E18) }]
  try {
    const m = await H.computeHolderMap('robinhood', 'NVDA', 'pro')
    assert.equal(m.state, 'ok')
    assert.equal(m.holders.count, 1234, JSON.stringify({ n: m.nodes.length, s: m.sources }))
    assert.equal(m.nodes[1]?.label?.kind, 'exchange', JSON.stringify(m.nodes.map((n) => [n.short, n.pct, n.label])))
    assert.match(m.sources.links, /latest 1 transfers/)
    assert.equal(m.links.length, 1, 'wallets 1 and 2 traded in the window')
    assert.equal(m.clusters[0].count, 2)
    assert.equal(m.nodes[0].valueAtFairUsd, 60000)
    assert.ok(!calls.some((c) => c.includes('apikey')), 'the key never appears in a logged path')
  } finally {
    delete process.env.BLOCKSCOUT_API_KEY
  }
})

test('cache: a second read within the window makes no upstream call; tiers are cached apart', async () => {
  H.resetHoldersForTest()
  const a = await H.readHolderMap('robinhood', TOKEN, { tier: 'pro' })
  const n = calls.length
  const b = await H.readHolderMap('robinhood', TOKEN.toUpperCase().replace('0X', '0x'), { tier: 'pro' })
  assert.equal(calls.length, n)
  assert.equal(b.cached, true)
  assert.equal(a.asOf, b.asOf)
  assert.ok(H.cacheMs() >= 300_000)
  const f = await H.readHolderMap('robinhood', TOKEN, { tier: 'free' })
  assert.ok(calls.length > n)
  assert.equal(f.tier, 'free')
})

test('per-IP budget: builds beyond the limit answer busy, cached answers stay free', async () => {
  H.resetHoldersForTest()
  let busy = 0
  for (let i = 0; i < 14; i++) {
    const r = await H.readHolderMap('robinhood', addr(0x500 + i), { ip: '203.0.113.9', tier: 'free' })
    if (r.state === 'busy') busy++
  }
  assert.equal(busy, 2)
})

/* --------------------------------------------------------------- routes --- */

function fakeRes() {
  const out = { status: 0, headers: {}, body: null }
  return {
    out,
    writeHead(s, h = {}) {
      out.status = s
      Object.assign(out.headers, h)
    },
    setHeader(k, v) {
      out.headers[k] = v
    },
    end(b) {
      out.body = b
    },
  }
}
const req = (p) => ({ method: 'GET', url: p, headers: { 'x-forwarded-for': '198.51.100.1' }, socket: { remoteAddress: '198.51.100.1' } })

test('routes: JSON with features, CSV gated by the switch, a PNG share card, bad input refused', async () => {
  H.resetHoldersForTest()
  let r = fakeRes()
  await H.handleHolders(req(`/api/holders/robinhood/${TOKEN}`), r, new URL(`http://x/api/holders/robinhood/${TOKEN}`), { plan: 'anonymous' })
  assert.equal(r.out.status, 200)
  const body = JSON.parse(r.out.body)
  assert.equal(body.features.replay, true, 'switch off: everyone gets the Pro view')
  assert.equal(body.features.gated, false)
  r = fakeRes()
  await H.handleHolders(req(`/api/holders/robinhood/${TOKEN}.csv`), r, new URL(`http://x/api/holders/robinhood/${TOKEN}.csv`), { plan: 'anonymous' })
  assert.equal(r.out.status, 200)
  assert.match(String(r.out.body), /^rank,address,label,balance,percent_of_supply,cluster,flags\n1,0x/)
  process.env.HOLDER_MAP_GATED = '1'
  try {
    r = fakeRes()
    await H.handleHolders(req(`/api/holders/robinhood/${TOKEN}.csv`), r, new URL(`http://x/api/holders/robinhood/${TOKEN}.csv`), { plan: 'anonymous' })
    assert.equal(r.out.status, 403)
    r = fakeRes()
    await H.handleHolders(req(`/api/holders/robinhood/${TOKEN}`), r, new URL(`http://x/api/holders/robinhood/${TOKEN}`), { plan: 'anonymous' })
    const g = JSON.parse(r.out.body)
    assert.equal(g.tier, 'free')
    assert.equal(g.timeline, null)
    assert.ok(g.forensics.riskLine, 'the safety warning is never gated')
    r = fakeRes()
    await H.handleHolders(req(`/api/holders/robinhood/${TOKEN}`), r, new URL(`http://x/api/holders/robinhood/${TOKEN}`), { plan: 'pro' })
    assert.equal(JSON.parse(r.out.body).tier, 'pro')
  } finally {
    delete process.env.HOLDER_MAP_GATED
  }
  r = fakeRes()
  await H.handleHolders(req(`/api/holders/robinhood/${TOKEN}/card.png`), r, new URL(`http://x/api/holders/robinhood/${TOKEN}/card.png`), null)
  assert.equal(r.out.status, 200)
  assert.equal(r.out.headers['Content-Type'], 'image/png')
  assert.deepEqual([...r.out.body.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
  r = fakeRes()
  await H.handleHolders(req('/api/holders/robinhood/nothex'), r, new URL('http://x/api/holders/robinhood/nothex'), null)
  assert.equal(r.out.status, 400)
  r = fakeRes()
  await H.handleHolders(req(`/api/holders/mars/${TOKEN}`), r, new URL(`http://x/api/holders/mars/${TOKEN}`), null)
  assert.equal(r.out.status, 404)
})

test('the share card states the map’s own figures', async () => {
  H.resetHoldersForTest()
  const m = await H.readHolderMap('robinhood', TOKEN, { tier: 'free' })
  const svg = renderHolderCardSvg(m)
  assert.match(svg, /HOLDER MAP/)
  assert.match(svg, /TST/)
  assert.ok(svg.includes('>68%<'), 'the vault bubble carries its share')
  assert.ok(svg.includes('wallets bought'), 'the risk line is set in words')
})

/* --------------------------------------------------------- holder alerts --- */

test('holder alerts: fire on reaching the line, re-arm below it, fire on a fall from the high, respect the cooldown', () => {
  const alert = { id: 'h1', condition: { type: 'holders', chain: 'robinhood', token: TOKEN, symbol: 'TST', metric: 'cluster', above: 20, dropPts: 5 }, disarmed: {}, lastFiredAt: null }
  const map = (pct) => ({ state: 'ok', token: { address: TOKEN, symbol: 'TST' }, asOf: new Date().toISOString(), summary: { top10Pct: 50, largestCluster: pct === null ? null : { pct, wallets: 4 } } })
  let t = 0
  assert.equal(A.stepHolderAlert(alert, map(10), (t += 3_600_000)), null)
  const e1 = A.stepHolderAlert(alert, map(22), (t += 3_600_000))
  assert.equal(e1.reason, 'above')
  assert.equal(e1.pct, 22)
  assert.equal(e1.previousPct, 10)
  alert.lastFiredAt = new Date(t).toISOString()
  assert.equal(A.stepHolderAlert(alert, map(23), (t += 3_600_000)), null, 'stays disarmed while above')
  // A sale: from a high of 23 to 17 is a fall of 6 points (and below the line re-arms "above").
  const e2 = A.stepHolderAlert(alert, map(17), (t += 3_600_000))
  assert.equal(e2.reason, 'drop')
  assert.equal(e2.previousPct, 23)
  alert.lastFiredAt = new Date(t).toISOString()
  assert.equal(A.stepHolderAlert(alert, map(25), t + 60_000), null, 'inside the cooldown nothing fires')
  assert.equal(A.stepHolderAlert(alert, map(25), (t += 3_600_000)).reason, 'above', 're-armed after dipping below')
  // No cluster at all reads as 0%; an unreadable map says nothing.
  assert.equal(A.holderMetric({ metric: 'cluster' }, map(null)), 0)
  assert.equal(A.holderMetric({ metric: 'cluster' }, { state: 'unavailable' }), null)
})

test('holder alerts end to end: created through the alerts API, evaluated from the map, delivered with the event', async () => {
  const { Readable } = await import('node:stream')
  const http = await import('node:http')
  process.env.GULLY_ALLOW_LOOPBACK_WEBHOOKS = '1'
  const got = []
  const srv = http.createServer((q, s) => {
    let b = ''
    q.on('data', (c) => (b += c))
    q.on('end', () => {
      got.push(JSON.parse(b))
      s.end('ok')
    })
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const hook = `http://127.0.0.1:${srv.address().port}/hook`
  const owner = '0x' + 'ab'.repeat(20)
  const post = async (body) => {
    const rq = Readable.from([JSON.stringify(body)])
    Object.assign(rq, { method: 'POST', headers: {} })
    const r = fakeRes()
    await A.handleAlerts(rq, r, new URL('http://x/api/developer/alerts'), owner)
    return { status: r.out.status, body: JSON.parse(r.out.body) }
  }
  try {
    assert.equal((await post({ condition: { type: 'holders', chain: 'robinhood', token: TOKEN }, webhookUrl: hook })).status, 400, 'a line or a fall is required')
    assert.equal((await post({ condition: { type: 'holders', chain: 'mars', token: TOKEN, above: 20 }, webhookUrl: hook })).status, 400)
    const ok = await post({ condition: { type: 'holders', chain: 'robinhood', token: TOKEN, symbol: 'TST', metric: 'cluster', above: 20 }, webhookUrl: hook })
    assert.equal(ok.status, 201, JSON.stringify(ok.body))
    assert.equal(ok.body.alert.kind, 'holders')
    A.setHolderMapReaderForTest(async () => ({ state: 'ok', token: { address: TOKEN, symbol: 'TST' }, asOf: new Date().toISOString(), summary: { top10Pct: 60, largestCluster: { pct: 25, wallets: 6 } } }))
    const out = await A.evaluateHolderAlerts()
    assert.equal(out.length, 1)
    assert.equal(got.length, 1)
    assert.equal(got[0].alert.kind, 'holders')
    assert.equal(got[0].events[0].kind, 'holders.alert')
    assert.equal(got[0].events[0].pct, 25)
    assert.equal(got[0].events[0].pageUrl, `https://gullylabs.xyz/holders/robinhood/${TOKEN}`)
    assert.equal((await A.evaluateHolderAlerts()).length, 0, 'fired once; waits to re-arm')
  } finally {
    A.setHolderMapReaderForTest(null)
    srv.close()
  }
})

/* -------------------------------------------------------------- intel --- */

const I = await import('../server/holders-intel.mjs')

test('Launch Health: each part from the map, weights shown, unknown parts left out of the score', () => {
  const m = H.buildMap({ chainKey: 'robinhood', token: TOKEN, symbol: 'TST', decimals: 18, kind: 'deepcore-launch', history: { transfers: launchHistory(), complete: true }, labels: LABELS(), supply: 1_000_000n * E18, launch: LAUNCH, sources: {} })
  m.deployerHistory = { checked: true, total: 0, serial: false, launches: [] }
  const h = I.launchHealth(m)
  const part = Object.fromEntries(h.parts.map((p) => [p.id, p]))
  assert.equal(part.liquidity.points, 20)
  assert.equal(part.bundle.points, Math.round(20 * (1 - 23 / 30)), 'bundled hold 23%')
  assert.equal(part.deployer.points, Math.round(20 * (1 - 5 / 20)), 'deployer 3% + funded wallet 2%')
  assert.equal(part.top10.points, Math.round(15 * (1 - 11 / 60)), 'top 10 hold 31%')
  assert.equal(part.snipers.value, '4', 'wallets 1-3 and the deployer bought in blocks 110 to 114')
  assert.equal(part.snipers.points, Math.round(10 * (1 - 4 / 10)))
  assert.equal(part.record.points, null, 'a first launch is no record either way')
  assert.equal(h.counted, 85)
  const sum = h.parts.filter((p) => p.points !== null).reduce((s, p) => s + p.points, 0)
  assert.equal(h.score, Math.round((100 * sum) / 85))
  assert.deepEqual(part.bundle.wallets.sort(), [addr(1), addr(2), addr(3)].sort(), 'tapping a part highlights its wallets')
  assert.ok(part.deployer.wallets.includes(DEPLOYER) && part.deployer.wallets.includes(addr(7)))
  // A deployer who pulled liquidity before loses the record points.
  m.deployerHistory = { checked: true, total: 1, serial: false, launches: [{ outcome: 'liquidity-pulled' }] }
  assert.equal(I.launchHealth(m).parts.find((p) => p.id === 'record').points, 0)
})

test('hidden links: a plain wallet joining two groups is drawn as "via"; contracts and hubs are not', () => {
  const X = addr(0x77)
  const C = addr(0x78)
  const holders = [1, 2, 3, 4].map((i) => ({ address: addr(i), raw: BigInt(100 - i) }))
  const t = [tr(addr(1), X, 5n, 1), tr(X, addr(3), 5n, 2), tr(addr(2), C, 1n, 3), tr(C, addr(4), 1n, 4)]
  const m = H.buildMap({ chainKey: 'robinhood', token: TOKEN, symbol: 'X', decimals: 0, kind: 'stock', holders, history: { transfers: t, complete: false }, labels: new Map(), supply: 1000n, sources: {}, codeOf: new Map([[X, false], [C, true]]) })
  assert.equal(m.hidden.length, 1)
  assert.equal(m.hidden[0].via, X)
  assert.deepEqual(m.hidden[0].connects.sort(), [addr(1), addr(3)].sort())
  assert.equal(m.links.filter((l) => l.kind === 'via').length, 2)
  assert.equal(m.clusters.length, 0, 'a hidden link does not merge clusters')
  // A wallet whose code was not checked is never drawn.
  const u = H.buildMap({ chainKey: 'robinhood', token: TOKEN, symbol: 'X', decimals: 0, kind: 'stock', holders, history: { transfers: t, complete: false }, labels: new Map(), supply: 1000n, sources: {} })
  assert.equal(u.hidden.length, 0)
})

test('search resolves $tickers across chains and addresses to stocks', async () => {
  const r = await I.resolveHolders('$nvda')
  assert.ok(r.matches.some((x) => x.chain === 'robinhood' && x.path === '/holders/robinhood/NVDA'))
  const a = await I.resolveHolders('0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC')
  assert.deepEqual(a.matches.map((x) => x.token), ['NVDA'])
  assert.deepEqual((await I.resolveHolders('not a token!')).matches, [])
})

test('most scanned today: one count per visitor per token per day', () => {
  I.resetScansForTest()
  I.recordScan('robinhood', TOKEN, 'TST', 'deepcore-launch', '198.51.100.1')
  I.recordScan('robinhood', TOKEN, 'TST', 'deepcore-launch', '198.51.100.1')
  I.recordScan('robinhood', TOKEN, 'TST', 'deepcore-launch', '198.51.100.2')
  I.recordScan('bsc', 'AAPL', 'AAPL', 'stock', '198.51.100.1')
  const t = I.topScans(5)
  assert.deepEqual(t.items.map((x) => [x.symbol, x.scans]), [['TST', 2], ['AAPL', 1]])
})

test('live: new transfers since the cursor move the mapped shares', async () => {
  H.resetHoldersForTest()
  const m = await H.readHolderMap('robinhood', TOKEN, { tier: 'free' })
  assert.equal(m.live.supported, true)
  const live = await I.readLive('robinhood', TOKEN, 150)
  assert.equal(live.state, 'ok')
  // The stub answers every transfer again; shares move by the net of those transfers for mapped wallets.
  assert.ok(live.transfers.length > 0)
  assert.equal(typeof live.cursor, 'number')
})

test('Cluster Watch: "sells X% of its holding" fires on a relative fall; deployer metric reads the deployer share', () => {
  const alert = { id: 'h2', condition: { type: 'holders', chain: 'robinhood', token: TOKEN, metric: 'deployer', above: null, dropPts: null, sellPct: 30 }, disarmed: {}, lastFiredAt: null }
  const map = (pct) => ({ state: 'ok', token: { address: TOKEN, symbol: 'TST' }, summary: { top10Pct: 50, largestCluster: null }, forensics: { deployerPct: pct } })
  assert.equal(A.stepHolderAlert(alert, map(10), 3_600_000), null)
  assert.equal(A.stepHolderAlert(alert, map(8), 7_200_000), null, 'sold 20%: below the line')
  const e = A.stepHolderAlert(alert, map(6.5), 10_800_000)
  assert.equal(e.reason, 'drop')
  assert.equal(e.soldPct, 35)
  assert.equal(A.holderMetric({ metric: 'deployer' }, { state: 'ok', summary: {}, forensics: null }), null, 'no deployer on a stock')
})

/* ------------------------------------------------- recent flows (motion) --- */

test('recentFlows: the latest transfers as buys, sells, transfers, mints and burns, oldest first, never invented', () => {
  const t = [...launchHistory(), tr(addr(2), VAULT, 5_000n * E18, 120, '0xs1')]
  const m = H.buildMap({ chainKey: 'robinhood', token: TOKEN, symbol: 'TST', decimals: 18, kind: 'deepcore-launch', history: { transfers: t, complete: true }, labels: LABELS(), supply: 1_000_000n * E18, launch: LAUNCH, sources: {}, tier: 'free' })
  assert.ok(Array.isArray(m.recentFlows), 'free maps carry them too: they are the public transfers the map was built from')
  assert.equal(m.recentFlows.length, t.length, 'fewer transfers than the cap: all of them')
  const f = m.recentFlows
  assert.deepEqual(
    f.map((x) => x.side),
    ['mint', 'transfer', 'buy', 'buy', 'buy', 'buy', 'transfer', 'buy', 'transfer', 'transfer', 'burn', 'sell'],
  )
  const sell = f.at(-1)
  assert.equal(sell.from, addr(2))
  assert.equal(sell.to, VAULT)
  assert.equal(sell.units, 5000)
  assert.equal(sell.pct, 0.5)
  assert.equal(sell.block, 120)
  assert.equal(sell.tx, '0xs1')
  assert.equal(sell.at, null, 'no time in the log and none read: null, not a guess')
  // Capped to the latest RECENT_FLOWS, still oldest first.
  const many = Array.from({ length: H.RECENT_FLOWS + 10 }, (_, i) => tr(VAULT, addr(1 + (i % 5)), E18, 200 + i, `0xm${i}`))
  const m2 = H.buildMap({ chainKey: 'robinhood', token: TOKEN, symbol: 'TST', decimals: 18, kind: 'deepcore-launch', history: { transfers: [...launchHistory(), ...many], complete: true }, labels: LABELS(), supply: 1_000_000n * E18, launch: LAUNCH, sources: {} })
  assert.equal(m2.recentFlows.length, H.RECENT_FLOWS)
  assert.equal(m2.recentFlows.at(-1).block, 200 + H.RECENT_FLOWS + 9)
  assert.ok(m2.recentFlows.every((x, i, a) => i === 0 || a[i - 1].block <= x.block))
  // Block times read for the replay are used when the log has none.
  const m3 = H.buildMap({ chainKey: 'robinhood', token: TOKEN, symbol: 'TST', decimals: 18, kind: 'deepcore-launch', history: { transfers: t, complete: true }, labels: LABELS(), supply: 1_000_000n * E18, launch: LAUNCH, sources: {}, times: new Map([[120, 1_760_000_000]]) })
  assert.equal(m3.recentFlows.at(-1).at, new Date(1_760_000_000_000).toISOString())
  // No history read: no flows (an empty list, not a made-up one).
  const m4 = H.buildMap({ chainKey: 'robinhood', token: TOKEN, symbol: 'X', decimals: 0, kind: 'stock', holders: [{ address: addr(1), raw: 10n }], history: null, labels: new Map(), supply: 10n, sources: {} })
  assert.deepEqual(m4.recentFlows, [])
})

test('flowSide: pool out is a buy, pool in is a sell, zero is a mint, burn addresses burn', () => {
  const L = new Map([[VAULT, { kind: 'pool' }], [ZERO, { kind: 'burn' }]])
  const of = (a) => L.get(a)
  assert.equal(H.flowSide(VAULT, addr(1), of), 'buy')
  assert.equal(H.flowSide(addr(1), VAULT, of), 'sell')
  assert.equal(H.flowSide(ZERO, addr(1), of), 'mint')
  assert.equal(H.flowSide(addr(1), ZERO, of), 'burn')
  assert.equal(H.flowSide(addr(1), '0x000000000000000000000000000000000000dead', of), 'burn')
  assert.equal(H.flowSide(addr(1), addr(2), of), 'transfer')
})

test('live: each new transfer says buy or sell, with whole units, and the moved top 10', async () => {
  H.resetHoldersForTest()
  await H.readHolderMap('robinhood', TOKEN, { tier: 'free' })
  const live = await I.readLive('robinhood', TOKEN, 150)
  assert.equal(live.state, 'ok')
  for (const t of live.transfers) {
    assert.ok(['buy', 'sell', 'transfer', 'mint', 'burn'].includes(t.side), t.side)
    assert.equal(typeof t.units, 'number')
  }
  assert.ok(live.transfers.some((t) => t.side === 'buy' && t.from === VAULT), 'the vault paying out is a buy')
  assert.equal(typeof live.top10Pct, 'number')
})

test('launch feed preview: the biggest bubbles and the latest flows of a cached map, nothing built for it', () => {
  const m = H.buildMap({ chainKey: 'robinhood', token: TOKEN, symbol: 'TST', decimals: 18, kind: 'deepcore-launch', history: { transfers: launchHistory(), complete: true }, labels: LABELS(), supply: 1_000_000n * E18, launch: LAUNCH, sources: {} })
  const p = I.mapPreview(m)
  assert.ok(p.nodes.length > 0 && p.nodes.length <= I.PREVIEW_NODES)
  assert.equal(p.nodes[0].k, 'pool')
  assert.equal(p.nodes[0].p, 68)
  assert.ok(p.nodes.some((n) => n.k === 'deployer'))
  assert.ok(p.nodes.some((n) => n.k === 'burn'))
  assert.ok(p.flows.length > 0 && p.flows.length <= 8)
  assert.ok(p.flows.every((f) => Number.isInteger(f.f) && Number.isInteger(f.t) && typeof f.s === 'string'))
  assert.ok(p.flows.some((f) => f.s === 'buy' && f.f === 0), 'buys flow out of the pool (node 0)')
})

/* ------------------------------------------- our own Transfer-log index (stocks) --- */

const L = await import('../server/holders-logs.mjs')
const SIM_HEAD = 100_000
const SIM_DEPLOY = 40_000
/** A chain with one token: minted at its deploy block, then a transfer every 50 blocks among seven wallets. */
function simLogs(token) {
  const out = [{ ...log(ZERO, addr(1), 1_000_000n * E18, SIM_DEPLOY, '0xmint'), address: token }]
  for (let b = SIM_DEPLOY + 50, i = 0; b < SIM_HEAD; b += 50, i++) out.push({ ...log(addr(1 + (i % 7)), addr(1 + ((i + 3) % 7)), E18, b, `0xs${i}`), address: token })
  return out
}
/**
 * Two RPCs: arch.test serves history but refuses ranges over 20,000 blocks or answers over 300 logs;
 * pub.test refuses anything older than 10,000 blocks ("Archive requests require a personal token").
 */
function simRpc(token, ranges) {
  const logs = simLogs(token)
  const err = (q, message) => ({ jsonrpc: '2.0', id: q.id, error: { code: -32000, message } })
  const num = (h) => (h === 'latest' ? SIM_HEAD : Number(BigInt(h)))
  return (host, q) => {
    const archiveOk = host === 'arch.test'
    if (q.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: q.id, result: '0x' + SIM_HEAD.toString(16) }
    if (q.method === 'eth_getBalance') return !archiveOk && num(q.params[1]) < SIM_HEAD - 10_000 ? err(q, 'Archive requests require a personal token') : { jsonrpc: '2.0', id: q.id, result: '0x0' }
    if (q.method === 'eth_getCode') return { jsonrpc: '2.0', id: q.id, result: String(q.params[0]).toLowerCase() === token && num(q.params[1] ?? 'latest') >= SIM_DEPLOY ? '0x6080' : '0x' }
    if (q.method === 'eth_call') return { jsonrpc: '2.0', id: q.id, result: '0x' + (1_000_000n * E18).toString(16) }
    if (q.method === 'eth_getLogs') {
      const f = q.params[0]
      const from = num(f.fromBlock)
      const to = num(f.toBlock)
      if (!archiveOk && from < SIM_HEAD - 10_000) return err(q, 'Archive requests require a personal token')
      if (to - from + 1 > 20_000) return err(q, 'block range is too large')
      const hit = String(f.address ?? '').toLowerCase() === token ? logs.filter((l) => Number(BigInt(l.blockNumber)) >= from && Number(BigInt(l.blockNumber)) <= to) : []
      if (hit.length > 300) return err(q, 'query returned more than 300 results')
      if (String(f.address ?? '').toLowerCase() === token) ranges.push([host, from, to])
      return { jsonrpc: '2.0', id: q.id, result: hit }
    }
    if (q.method === 'eth_getBlockByNumber') return { jsonrpc: '2.0', id: q.id, result: { timestamp: '0x6a000000' } }
    return { jsonrpc: '2.0', id: q.id, result: null }
  }
}
async function withSim(urls, fn, over = {}) {
  const token = H.findStock('robinhood', 'NVDA').token.toLowerCase()
  const ranges = []
  const sim = simRpc(token, ranges)
  const prevEnv = process.env.GULLY_RPC_4663
  process.env.GULLY_RPC_4663 = urls.map((h) => `https://${h}`).join(',')
  H.setHoldersFetchForTest((url, init = {}) => {
    const u = new URL(String(url))
    if (u.host === 'arch.test' || u.host === 'pub.test') {
      const body = JSON.parse(String(init.body))
      const out = Array.isArray(body) ? body.map((q) => sim(u.host, q)) : sim(u.host, body)
      return Promise.resolve(new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } }))
    }
    // The chain's public default RPCs: down in this test.
    if (!['dc.test', 'bs.test', 'meta.test', 'moralis.test', 'sol.test'].includes(u.host)) return Promise.resolve(new Response('down', { status: 503 }))
    return stubFetch(url, init)
  })
  H.resetHoldersForTest()
  L.resetLogsForTest({ dir: fs.mkdtempSync(path.join(tmp, 'logs-')), noBackground: true, cap: 200_000, sessionCalls: 40, sessionMs: 15_000, startWindow: 5_000, ...over })
  try {
    return await fn({ token, ranges })
  } finally {
    process.env.GULLY_RPC_4663 = prevEnv
    H.setHoldersFetchForTest(stubFetch)
    L.resetLogsForTest({ dir: null, noBackground: false, cap: 200_000, sessionCalls: 40 })
    H.resetHoldersForTest()
  }
}

test('own log index: only RPCs that serve old ranges count as archive', async () => {
  await withSim(['pub.test', 'arch.test'], async () => {
    assert.deepEqual(await L.archiveUrls('robinhood'), ['https://arch.test'])
    assert.equal(L.archiveKnown('robinhood'), true)
  })
  await withSim(['pub.test'], async () => {
    assert.deepEqual(await L.archiveUrls('robinhood'), [])
  })
})

test('own log index: deploy block by binary search, windows shrink on refusals and grow on small answers, cursor resumes', async () => {
  await withSim(['pub.test', 'arch.test'], async ({ token, ranges }) => {
    // A short session first: not done, the cursor is saved.
    assert.equal(await L.backfillStep('robinhood', token, { calls: 4 }), 'backfilling')
    const s1 = L.storeForTest('robinhood', token)
    assert.equal(s1.startBlock, SIM_DEPLOY, 'the deploy block, found on the archive node')
    const cur = s1.cursor
    assert.ok(cur >= SIM_DEPLOY && cur < SIM_HEAD)
    assert.ok(ranges.every(([h]) => h === 'arch.test'), 'the backfill reads history from the archive node only')
    // Forget the working copy: the next session resumes from the file, not from the deploy block.
    L.dropMemoryForTest()
    const before = ranges.length
    assert.equal(await L.backfillStep('robinhood', token, { calls: 200 }), 'ok')
    assert.equal(ranges[before][1], cur + 1, 'resumed at the saved cursor')
    // Grew from 5,000 while answers were small; refused ranges (over 20,000 blocks or 300 logs) shrank it.
    const spans = ranges.map(([, a, b]) => b - a + 1)
    assert.equal(spans[0], 5_000)
    assert.ok(spans.some((w) => w > 5_000), 'grew')
    assert.ok(spans.some((w, i) => i > 0 && w < spans[i - 1]), 'shrank after a refusal')
    const h = await L.readOwnHistory('robinhood', token)
    assert.equal(h.state, 'ok')
    assert.equal(h.count, simLogs(token).length, 'every transfer, exactly once')
    assert.equal(h.fromBlock, SIM_DEPLOY)
    assert.equal(h.toBlock, SIM_HEAD)
  })
})

test('own log index: the stock map is built from it, exact balances, before any key-based source', async () => {
  await withSim(['arch.test'], async () => {
    process.env.BLOCKSCOUT_API_KEY = 'proapi_test'
    const n = calls.length
    try {
      const m = await H.computeHolderMap('robinhood', 'NVDA', 'pro')
      assert.equal(m.state, 'ok', m.reason)
      assert.match(m.sources.holders, /Our own index of the chain’s Transfer logs: all 1,200 transfers/)
      const people = m.nodes.filter((x) => !x.label || x.label.kind !== 'burn')
      assert.equal(Math.round(people.reduce((s, x) => s + x.pct, 0)), 100)
      assert.ok(m.links.length > 0, 'links from the full history')
      assert.ok(!calls.slice(n).some((c) => c.startsWith('bs.test/4663/api/v2/tokens')), 'Blockscout not asked while our index answers')
    } finally {
      delete process.env.BLOCKSCOUT_API_KEY
    }
  })
})

test('own log index: still reading says how far, never draws partial balances', async () => {
  await withSim(
    ['arch.test'],
    async () => {
      const m = await H.computeHolderMap('robinhood', 'NVDA', 'pro')
      assert.equal(m.state, 'unavailable')
      assert.equal(m.comingSoon, false)
      assert.match(m.reason, /being read from Robinhood Chain: \d+% so far\. The map appears once every transfer is in, never with partial balances\./)
      assert.equal(typeof m.progress, 'number')
    },
    { sessionCalls: 2 },
  )
})

test('own log index: over the cap it stops with a clear note', async () => {
  await withSim(
    ['arch.test'],
    async ({ token }) => {
      assert.equal(await L.backfillStep('robinhood', token, { calls: 500 }), 'capped')
      H.resetHoldersForTest()
      const m = await H.computeHolderMap('robinhood', 'NVDA', 'pro')
      assert.equal(m.state, 'unavailable')
      assert.match(m.reason, /more than 500 transfers, too many to rebuild its holders here yet/)
    },
    { cap: 500 },
  )
})

test('own log index: no archive RPC and no key is an honest "not available yet"', async () => {
  await withSim(['pub.test'], async ({ token }) => {
    assert.equal(await L.backfillStep('robinhood', token), 'no-archive')
    const m = await H.computeHolderMap('robinhood', 'NVDA', 'pro')
    assert.equal(m.state, 'unavailable')
    assert.equal(m.comingSoon, true)
    assert.equal(m.reason, 'Holder history is not available yet on Robinhood Chain. DeepCore launches already have live maps.')
    assert.equal(H.holdersAvailable('robinhood'), false)
    assert.equal(H.holdersSourceHealth().find((x) => x.chain === 'robinhood').label, 'no archive RPC answering')
  })
  await withSim(['arch.test'], async () => {
    await L.archiveUrls('robinhood')
    assert.equal(H.holdersAvailable('robinhood'), true, 'an archive RPC answering makes stock maps available')
    assert.equal(H.holdersSourceHealth().find((x) => x.chain === 'robinhood').label, 'own RPC (archive)')
  })
})

test('Solana: the full holder list from getProgramAccounts where the RPC allows it, else the top 20', async () => {
  const MINT = 'So11111111111111111111111111111111111111112'
  const OWNER_A = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'
  const OWNER_B = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH'
  const acct = (owner, amount) => ({ account: { data: { parsed: { info: { owner, tokenAmount: { amount } } } } } })
  const real = globalThis.fetch
  let allow = true
  globalThis.fetch = async (url, init) => {
    const q = JSON.parse(String(init.body))
    const res = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }), { status: 200 })
    if (q.method === 'getAccountInfo') return res({ value: { owner: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' } })
    if (q.method === 'getProgramAccounts') return allow ? res([acct(OWNER_A, '700'), acct(OWNER_B, '200'), acct(OWNER_A, '50'), acct(OWNER_B, '0')]) : new Response(JSON.stringify({ jsonrpc: '2.0', id: q.id, error: { code: -32010, message: 'getProgramAccounts is not available' } }), { status: 200 })
    return res(null)
  }
  try {
    const all = await H.readSolanaAllHolders(MINT)
    assert.deepEqual(
      all.map((h) => [h.address, h.raw]),
      [
        [OWNER_A, 750n],
        [OWNER_B, 200n],
      ],
    )
    allow = false
    assert.equal(await H.readSolanaAllHolders(MINT), null, 'refused: the caller keeps the top 20')
  } finally {
    globalThis.fetch = real
  }
})
