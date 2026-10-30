// GET /api/hub (server/hub.mjs): parsers on the live shapes (read 2026-10-26) and the endpoint with a stub fetch,
// no upstream calls. Run: npm run test:hub
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { _resetHub, handleHub, readGateway, readQuests, readStatusPage, readX402, SURFACES } from '../server/hub.mjs'

const X402 = { facilitator: 'gullypay', x402Version: 1, supportedSchemes: ['exact'], supportedNetworks: ['base', 'base-sepolia', 'ethereum', 'bsc', 'solana', 'gully-chain-testnet'], supportedAssets: ['USDC', 'USDT', 'ETH', 'WETH'], networks: { 'gully-chain-testnet': { chainId: 485590, name: 'Gully Chain Testnet' } } }
const GATEWAY = { public: [{ id: 'evm:8453', alias: 'base', blockTimeMs: 2000, state: 'OK' }, { id: 'evm:485590', alias: 'gully-testnet', blockTimeMs: 105299, state: 'OK' }, { id: 'evm:56', alias: 'bsc', state: 'DEGRADED' }] }
const STATS = {
  quests: 3,
  active: 3,
  upcoming: 0,
  ended: 0,
  completions: 1,
  completions24h: 1,
  pools: [{ asset: '0x0000000000000000000000000000000000000000', available: '1325000000000000', poolNet: '1425000000000000', paid: '100000000000000', quests: 3 }],
  hourly: [{ t: 1, completions: 0 }, { t: 2, completions: 1 }],
  recent: [{ questId: '1', account: '0x12fa4f1f2b90422da4d425fbcf4be50e80fd7a93', timestamp: '1792981502', reward: '100000000000000', name: 'gullytester.gully', title: 'Claim your .gully name' }],
}
const LIST = { total: 1, quests: [{ id: '1', title: 'Claim your .gully name', state: 'active', verifierKind: 'name', completions: 1, maxCompletions: 4, spotsLeft: 3, rewardAsset: '0x0000000000000000000000000000000000000000', rewardAmount: '100000000000000', end: '1795573442' }] }
const STATUS_HTML = '<div class="banner ok">All systems operational</div><section class="svc"><div class="top"><span class="nm">Website</span>\n<span class="pill up">Operational</span></div></section><section class="svc"><span class="nm">Pay</span><span class="pill down">Down</span></section>'

test('x402: networks, assets and Gully Chain', () => {
  const x = readX402(X402)
  assert.equal(x.networks.length, 6)
  assert.equal(x.gullyChain, true)
  assert.deepEqual(x.networks.find((n) => n.id === 'gully-chain-testnet'), { id: 'gully-chain-testnet', name: 'Gully Chain Testnet', chainId: 485590, testnet: true })
  assert.equal(x.networks.find((n) => n.id === 'bsc').name, 'BNB Chain')
  assert.equal(readX402({}), null)
})

test('gateway: states and Gully Chain', () => {
  const g = readGateway(GATEWAY)
  assert.equal(g.total, 3)
  assert.equal(g.ok, 2)
  assert.equal(g.gullyChain, true)
  assert.equal(g.networks[1].chainId, 485590)
  assert.equal(readGateway(null), null)
})

test('quests: stats and list in ETH, unread is null', () => {
  const q = readQuests(STATS, LIST)
  assert.equal(q.total, 3)
  assert.equal(q.completions, 1)
  assert.equal(q.poolEth, 0.001325)
  assert.deepEqual(q.hourly, [0, 1])
  assert.equal(q.quests[0].rewardEth, 0.0001)
  assert.equal(q.quests[0].max, 4)
  assert.equal(q.recent[0].who, 'gullytester.gully')
  assert.equal(readQuests(null, LIST), null)
  // No ETH pool: the pool figure is unknown, not zero.
  assert.equal(readQuests({ ...STATS, pools: [] }, null).poolEth, null)
})

test('status page: banner and pills', () => {
  const s = readStatusPage(STATUS_HTML)
  assert.equal(s.overall, 'ok')
  assert.equal(s.total, 2)
  assert.equal(s.up, 1)
  assert.equal(readStatusPage('<html></html>'), null)
})

test('GET /api/hub with a stub fetch: down surfaces are down, never zero', async () => {
  const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
  _resetHub(async (url, init = {}) => {
    const u = String(url)
    if (u.includes('faucet')) throw new TypeError('fetch failed')
    if (init.method === 'POST') return json({ jsonrpc: '2.0', id: 1, result: '0x1c0' })
    if (u.endsWith('/quests/stats')) return json(STATS)
    if (u.includes('/quests?')) return json(LIST)
    if (u.endsWith('/head')) return json({ chainId: 485590, block: 448, timestamp: 1793024378 })
    if (u.includes('x402/status')) return json(X402)
    if (u.startsWith('https://rpc.gullyrpc.xyz')) return json(GATEWAY)
    if (u.startsWith('https://status.gullylabs.xyz')) return new Response(STATUS_HTML, { status: 200 })
    return new Response('ok', { status: 200 })
  })
  let out = null
  const send = (_res, code, body, headers) => (out = { code, body, headers })
  const handled = await handleHub({ method: 'GET' }, {}, new URL('http://x/api/hub'), send)
  assert.equal(handled, true)
  assert.equal(out.code, 200)
  const b = JSON.parse(out.body)
  assert.equal(b.services.length, SURFACES.length)
  const faucet = b.services.find((s) => s.key === 'faucet')
  assert.equal(faucet.up, false)
  assert.equal(faucet.ms, null)
  assert.equal(b.services.find((s) => s.key === 'rpc-public').up, true)
  assert.equal(b.chain.head, 448)
  assert.equal(b.quests.total, 3)
  assert.equal(b.x402.gullyChain, true)
  assert.equal(b.gateway.gullyChain, true)
  assert.equal(b.statusPage.total, 2)
  assert.equal(await handleHub({ method: 'GET' }, {}, new URL('http://x/api/other'), send), false)
  _resetHub()
})

test('every surface links to https and Gully Chain pieces are all listed', () => {
  for (const s of SURFACES) assert.match(s.url, /^https:\/\//)
  for (const k of ['street', 'explorer', 'faucet', 'bridge', 'docs', 'devportal', 'rpc-public']) assert.ok(SURFACES.some((s) => s.key === k && s.group === 'chain'), k)
})

test('surfaces still being set up read "coming" until they answer 200, never "down"', async () => {
  _resetHub(async (url, init = {}) => {
    const u = String(url)
    if (u.includes('safe.gullychain')) throw new TypeError('fetch failed')
    if (u.includes('ai.gullylabs.xyz')) return new Response('', { status: 404 })
    if (u.includes('dev.gullystudio')) return new Response('ok', { status: 200 })
    if (u.includes('copy.gullychain')) return new Response('', { status: 502 })
    if (init.method === 'POST') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1' }), { status: 200 })
    return new Response('ok', { status: 200 })
  })
  let out = null
  await handleHub({ method: 'GET' }, {}, new URL('http://x/api/hub'), (_r, code, body) => (out = { code, body }))
  const b = JSON.parse(out.body)
  const by = (k) => b.services.find((s) => s.key === k)
  assert.equal(by('safe').state, 'coming')
  assert.equal(by('safe').up, false)
  assert.equal(by('ai-api').state, 'coming')
  assert.equal(by('ai-api').ms, null)
  assert.equal(by('studio-dev').state, 'up')
  assert.equal(by('copy').state, 'down')
  assert.equal(by('gullyai').state, 'up')
  for (const k of ['social', 'copy', 'safe', 'bridge', 'gullyai']) assert.ok(SURFACES.some((s) => s.key === k), k)
  _resetHub()
})

/* ---------- GET /api/hub/products (server/hub-products.mjs): pure readers, no upstream calls ---------- */
import { fastLane, hourAxis, readActivity, readBlock, readHolders, readSecurity, summariseBlocks } from '../server/hub-products.mjs'

const NOW = 1793060000
test('hub-products: 24 hourly buckets ending with the current hour', () => {
  const a = hourAxis(NOW, ['x'])
  assert.equal(a.length, 24)
  assert.equal(a[23].t, Math.floor(NOW / 3600) * 3600)
  assert.equal(a[0].x, 0)
})

test('hub-products: a block keeps user transactions, canonical deposits and withdrawals', () => {
  const b = readBlock({ number: '0x2e7', timestamp: '0x' + (NOW - 10).toString(16), gasUsed: '0x5208', transactions: [{ type: '0x6a' }, { type: '0x64' }, { type: '0x2', to: '0x0000000000000000000000000000000000000064', input: '0x25e16063' + '0'.repeat(64) }, { type: '0x2', to: '0xabc', input: '0x' }] })
  assert.deepEqual(b, { number: 743, time: NOW - 10, gas: 21000, txs: 3, deposits: 1, withdrawals: 1 })
  assert.equal(readBlock(null), null)
  const s = summariseBlocks([b, { ...b, number: 1, time: NOW - 100 * 3600 }], NOW)
  assert.equal(s.hourly[23].blocks, 1)
  assert.equal(s.hourly[23].txs, 3)
  assert.equal(s.canonical[23].in, 1)
  assert.equal(s.canonical[23].out, 1)
  assert.equal(s.hourly.reduce((a, h) => a + h.blocks, 0), 1, 'a block older than 24 h is left out')
})

test('hub-products: gETH mints count as in, burns as out', () => {
  const Z = '0x' + '0'.repeat(64)
  const W = '0x' + '0'.repeat(24) + '12fa4f1f2b90422da4d425fbcf4be50e80fd7a93'
  const f = fastLane([{ topics: ['t', Z, W], blockNumber: '0x10' }, { topics: ['t', W, Z], blockNumber: '0x11' }, { topics: ['t', W, W], blockNumber: '0x12' }], NOW, (n) => (n === 16 || n === 17 ? NOW - 5 : null))
  assert.equal(f.allIn, 1)
  assert.equal(f.allOut, 1)
  assert.equal(f.hourly[23].in, 1)
  assert.equal(f.hourly[23].out, 1)
})

test('hub-products: indexer feed into launches, trades and swaps per hour', () => {
  const a = readActivity({ head: { block: 743 }, items: [{ kind: 'launch', timestamp: String(NOW - 60) }, { kind: 'trade', timestamp: String(NOW - 60) }, { kind: 'trade', timestamp: String(NOW - 3700) }, { kind: 'wrap', timestamp: String(NOW) }] }, NOW)
  assert.equal(a.events, 4)
  assert.equal(a.hourly[23].launches, 1)
  assert.equal(a.hourly[23].trades, 1)
  assert.equal(a.hourly[22].trades, 1)
  assert.equal(readActivity({ error: 'x' }, NOW), null, 'an unreadable feed is null, never zero')
})

test('hub-products: HolderMaps daily series keeps the day high and the chains', () => {
  const h = readHolders({ day: '2026-10-27', items: [{ chain: 'gully', token: '0x1', symbol: 'GULLY', scans: 3, path: '/holders/gully/0x1' }, { chain: 'base', token: '0x2', scans: 1 }] }, { holdersDaily: { '2026-10-26': 9, '2026-10-27': 7 } })
  assert.equal(h.today, 4)
  assert.deepEqual(h.daily, [{ day: '2026-10-26', maps: 9 }, { day: '2026-10-27', maps: 7 }])
  assert.equal(h.byChain[0].chain, 'gully')
  assert.equal(readHolders(null, {}), null)
})

test('hub-products: security scans per day and states', () => {
  const now = Date.parse('2026-10-27T12:00:00Z')
  const s = readSecurity([{ createdAt: '2026-10-27T01:00:00Z', status: 'done', published: true }, { createdAt: '2026-10-20T01:00:00Z', state: 'started' }, { createdAt: '2025-01-01T00:00:00Z', state: 'cancelled' }], now)
  assert.equal(s.daily.length, 14)
  assert.equal(s.daily[13].scans, 1)
  assert.equal(s.total, 3)
  assert.deepEqual(s.states, { done: 1, running: 1, failed: 1, other: 0 })
  assert.equal(s.published, 1)
})
