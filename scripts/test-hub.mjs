// GET /api/hub (server/hub.mjs): parsers on the live shapes (read 2026-10-26) and the endpoint with a stub fetch,
// no upstream calls. Run: npm run test:hub
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { _resetHub, handleHub, readGateway, readQuests, readStatusPage, readX402, SURFACES } from '../server/hub.mjs'

const X402 = { facilitator: 'gullypay', x402Version: 1, supportedSchemes: ['exact'], supportedNetworks: ['base', 'base-sepolia', 'ethereum', 'bsc', 'solana', 'gully-chain-testnet'], supportedAssets: ['USDC', 'USDT', 'GLUSD', 'ETH', 'WETH'], networks: { 'gully-chain-testnet': { chainId: 485590, name: 'Gully Chain Testnet' } } }
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
