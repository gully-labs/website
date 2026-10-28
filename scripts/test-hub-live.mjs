// GET /api/hub/live (server/hub-live.mjs): the landing's cross-origin sources, read server-side with a stub fetch.
//   npm run test:hub-live      (no network)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { _resetHubLive, handleHubLive, hubLive, shape } from '../server/hub-live.mjs'

const fx = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/hub-landing-${n}.json`, import.meta.url), 'utf8'))
const ANSWERS = {
  'gullyid.xyz/v1/stats/public': fx('id'),
  'gullypay.xyz/api/status': { status: 'operational', services: { api: 'operational', checkout: 'operational' }, incidents: [] },
  'gullyrpc.xyz/status.json': fx('rpc'),
  'indexer.gullychain.xyz/head': { chainId: 485590, block: 1829, timestamp: 1793153063 },
  'indexer.gullychain.xyz/feed': fx('feed'),
  // Gully Sentry, recorded 2026-10-28 (the network series lists only slots that heard a heartbeat)
  'sentry.gullychain.xyz/api/v1/network/stats': { activeKeys: 0, operators: 0, verdicts: {}, series: [{ t: 1793159400, keys: 1 }, { t: 1793160000, keys: 1 }], epoch: 20754, at: 1793174739 },
  'sentry.gullychain.xyz/api/v1/sale/stats': { deployed: true, saleMode: 'testnet', phase: 'public', totalMinted: 1, totalBurned: 0, maxSupply: 10000, available: 9999, series: [{ t: 1793153820, sold: 0 }] },
  'sentry.gullychain.xyz/api/v1/chain/health': { verdict: 'ok', summary: '3 assertion(s) match our node', l3Head: '2011', newestAssertionAgeSec: 3159, checkedAt: 1793174741 },
}
function stub(down = []) {
  const calls = []
  const fn = async (url) => {
    calls.push(url)
    const k = Object.keys(ANSWERS).find((x) => url.includes(x))
    if (!k || down.some((d) => url.includes(d))) return new Response('nope', { status: 503 })
    return new Response(JSON.stringify(ANSWERS[k]), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  fn.calls = calls
  return fn
}

test('reads every source and keeps only what the landing shows', async () => {
  _resetHubLive(stub())
  const b = await hubLive()
  assert.deepEqual(b.unread, [])
  assert.equal(b.id.signins24h, 31)
  assert.equal(b.id.totals.users, 19)
  assert.ok(!('dailyNewUsers' in b.id), 'only the fields the landing uses')
  assert.deepEqual(b.pay.services, { api: 'operational', checkout: 'operational' })
  assert.ok(b.rpc.features.some((f) => f.status === 'live'))
  assert.equal(b.head.block, 1829)
  assert.ok(b.feed.items.length > 0 && b.feed.items.length <= 12)
  // Gully Sentry: the 24 h window is filled to 144 ten-minute slots; the heard slots keep their counts
  assert.equal(b.sentryNet.series.length, 144)
  assert.equal(b.sentryNet.heartbeats24h, 2)
  assert.equal(b.sentryNet.activeKeys, 0)
  assert.equal(b.sentryNet.series.at(-1).t, 1793174400)
  assert.equal(b.sentryNet.series.find((x) => x.t === 1793160000).keys, 1)
  assert.deepEqual([b.sentrySale.totalMinted, b.sentrySale.maxSupply, b.sentrySale.available], [1, 10000, 9999])
  assert.equal(b.sentryChain.verdict, 'ok')
  assert.equal(b.sentryChain.l3Head, 2011)
})

test('a source that is down is null and named, never a zero; the last good reading is kept', async () => {
  _resetHubLive(stub(['gullyid.xyz']))
  const b = await hubLive()
  assert.equal(b.id, null)
  assert.deepEqual(b.unread, ['id'])
  assert.equal(b.pay.status, 'operational')
})

test('cached: one upstream round per 45 s', async () => {
  const f = stub()
  _resetHubLive(f)
  await Promise.all([hubLive(), hubLive(), hubLive()])
  await hubLive()
  assert.equal(f.calls.length, 8)
})

test('shape drops malformed answers', () => {
  assert.equal(shape('id', { nope: 1 }), null)
  assert.equal(shape('pay', { status: 'ok' }), null)
  assert.equal(shape('head', { block: 'x' }), null)
  assert.equal(shape('feed', { items: 'x' }), null)
  assert.equal(shape('sentryNet', { series: [] }), null, 'no timestamp, no window')
  assert.equal(shape('sentrySale', { deployed: false, totalMinted: 0 }), null, 'no contract, no figures')
  assert.equal(shape('sentryChain', { summary: 'x' }), null)
  assert.equal(shape('feed', { items: [{ id: 1, kind: 'trade', block: 2, timestamp: 3, txHash: 'not-a-hash' }] }).items[0].txHash, null)
})

test('handler: GET only, public cache headers, JSON', async () => {
  _resetHubLive(stub())
  const sent = []
  const send = (res, status, body, headers) => sent.push({ status, body, headers })
  await handleHubLive({ method: 'GET' }, {}, new URL('http://x/api/hub/live'), send)
  assert.equal(sent[0].status, 200)
  assert.equal(sent[0].headers['Content-Type'], 'application/json')
  assert.match(sent[0].headers['Cache-Control'], /max-age=30/)
  assert.equal(JSON.parse(sent[0].body).head.block, 1829)
  await handleHubLive({ method: 'POST' }, {}, new URL('http://x/api/hub/live'), send)
  assert.equal(sent[1].status, 405)
})
