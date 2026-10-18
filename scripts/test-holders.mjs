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
const { renderHolderCardSvg } = await import('../server/holders-card.mjs')

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

test('without a key a chain degrades with the reason and the env var to set', async () => {
  H.resetHoldersForTest()
  const rh = await H.computeHolderMap('robinhood', 'NVDA', 'pro')
  assert.equal(rh.state, 'unavailable')
  assert.equal(rh.needs, 'BLOCKSCOUT_API_KEY')
  assert.match(rh.reason, /not available on Robinhood Chain yet/)
  const bsc = await H.computeHolderMap('bsc', 'AAPL', 'pro')
  assert.equal(bsc.needs, 'MORALIS_API_KEY')
  const real = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 429, message: 'Too many requests' } }), { status: 429 })
  try {
    const sol = await H.computeHolderMap('solana', 'CRCL', 'pro')
    assert.equal(sol.state, 'unavailable')
    assert.equal(sol.needs, 'GULLY_RPC_SOLANA')
  } finally {
    globalThis.fetch = real
  }
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
