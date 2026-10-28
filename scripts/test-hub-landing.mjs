// The landing's data adapters (src/pages/hub/hubData.ts, "Constellation", 2026-10-27) against recorded answers of the
// real sources (scripts/fixtures/hub-landing-*.json: /api/hub, /api/hub/products, gullyid.xyz stats, gullyrpc.xyz
// status.json, the indexer feed, all read 2026-10-27/28).
//   npm run test:hub-landing      (no build, no network; node strips the TypeScript types)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const H = await import('../src/pages/hub/hubData.ts')
const fx = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/hub-landing-${n}.json`, import.meta.url), 'utf8'))
const hub = fx('hub')
const products = fx('products')
const { shape } = await import('../server/hub-live.mjs')
const live = { generatedAt: '2026-10-28T02:05:00Z', unread: [], id: shape('id', fx('id')), pay: shape('pay', { status: 'operational', services: { api: 'operational', checkout: 'operational', x402: 'operational', webhooks: 'operational', mobile: 'degraded' }, incidents: [] }), rpc: shape('rpc', fx('rpc')), head: shape('head', { chainId: 485590, block: 1829, timestamp: 1793153063 }), feed: shape('feed', fx('feed')) }
const full = { hub, products, live, liveState: 'ok', stats: { totals: { tvlUsd: 71401.4, volumeAllUsd: 6373.01, feesAllUsd: 431.24 } } }
const none = { hub: null, products: null, live: null, liveState: 'error', stats: null }
const NOW = Date.parse('2026-10-28T02:10:00Z')

test('catalog: eight products in story order, every link and news item points at a real product', () => {
  assert.deepEqual(H.HUB_PRODUCTS.map((p) => p.key), ['id', 'pay', 'chain', 'rpc', 'holdermaps', 'security', 'studio', 'ai'])
  const keys = new Set(H.HUB_PRODUCTS.map((p) => p.key))
  for (const [a, b] of H.EDGES) assert.ok(keys.has(a) && keys.has(b), `${a}-${b}`)
  for (const n of H.NEWS) {
    assert.ok(keys.has(n.p), n.t)
    assert.match(n.d, /^\d{4}-\d{2}-\d{2}$/)
    assert.match(n.href, /^https:\/\//)
  }
  // every product page the landing links to exists in the product catalog (src/terminal/catalog.ts)
  const catalog = fs.readFileSync(new URL('../src/terminal/catalog.ts', import.meta.url), 'utf8')
  for (const p of H.HUB_PRODUCTS) assert.ok(catalog.includes(`slug: '${p.page}'`), `/products/${p.page}`)
  for (const p of H.HUB_PRODUCTS) for (const L of [H.MAP.wide, H.MAP.tall]) assert.ok(L.at[p.key], `${p.key} placed`)
  // honest labels checked live on 2026-10-27
  assert.ok(H.NEWS.some((n) => /tip pages/.test(n.t) && n.s === 'rolling out'))
  assert.ok(H.NEWS.some((n) => /Sentry/.test(n.t) && n.s === 'coming soon'))
  assert.ok(H.NEWS.some((n) => /Merchant review/.test(n.t) && n.s === 'live'))
})

test('readings from live sources: each product gets its own figure', () => {
  const R = H.readings(full, NOW)
  assert.equal(R.id.kpi.v, 31)
  assert.equal(R.id.series.rows.length, 25)
  assert.deepEqual([R.pay.kpi.v, R.pay.kpi.of], [4, 5])
  assert.equal(R.chain.kpi.v, 1829, 'indexer head wins over the hub head')
  assert.equal(R.chain.series.rows.length, 24)
  assert.deepEqual([R.rpc.kpi.v, R.rpc.kpi.of], [6, 6])
  assert.equal(R.holdermaps.kpi.v, 6)
  assert.equal(R.security.kpi.v, 0, 'a real zero from the counter stays a zero')
  assert.equal(R.ai.state, 'coming')
  assert.equal(R.ai.kpi, null)
  assert.match(R.ai.why, /GPU box/)
  // Frog Hop is not in the listed quests: the newest real win, not an invented count
  assert.equal(R.studio.kpi, null)
  assert.match(R.studio.why, /^Frog Hop win \d+ min ago$/)
})

test('no sources: no figures, every product says why', () => {
  const R = H.readings(none, NOW)
  for (const p of H.HUB_PRODUCTS) {
    assert.equal(R[p.key].kpi, null, p.key)
    assert.ok(R[p.key].why, p.key)
  }
  assert.match(R.id.why, /unreadable/)
  const s = H.suite(none)
  assert.equal(s.up, null)
  assert.equal(s.tvl, null)
  assert.deepEqual(H.liveEvents(none), [])
})

test('loading: says Loading, not offline', () => {
  const R = H.readings({ ...none, liveState: 'loading' }, NOW)
  assert.equal(R.id.why, 'Loading…')
  assert.equal(R.pay.why, 'Loading…')
})

test('suite and uptime states', () => {
  const s = H.suite(full)
  assert.equal(s.total, hub.services.filter((x) => x.state !== 'coming').length)
  assert.equal(s.up, hub.services.filter((x) => x.state === 'up').length)
  assert.equal(s.tvl, 71401.4)
  const down = { ...hub, services: hub.services.map((x) => (x.key === 'holders' ? { ...x, up: false, state: 'down' } : x)) }
  assert.equal(H.upState(down, 'holdermaps'), 'down')
  assert.equal(H.upState(hub, 'holdermaps'), 'up')
  assert.equal(H.upState(null, 'pay'), 'reading')
})

test('live events: real, dated, newest first, explorer links only for real hashes', () => {
  const ev = H.liveEvents(full, 8)
  assert.ok(ev.length > 0 && ev.length <= 8)
  for (let i = 1; i < ev.length; i++) assert.ok(Date.parse(ev[i - 1].at) >= Date.parse(ev[i].at))
  for (const e of ev) if (e.href) assert.match(e.href, /^https:\/\/testnet-explorer\.gullychain\.xyz\/tx\/0x[0-9a-fA-F]{64}$/)
})

test('toasts: nothing on the first reading, one per real change after', () => {
  const a = H.seenOf(full)
  assert.deepEqual(H.changes(null, a, full), [])
  assert.deepEqual(H.changes(a, a, full), [])
  const more = { ...full, hub: { ...hub, quests: { ...hub.quests, completions: hub.quests.completions + 2 } }, products: { ...products, holders: { ...products.holders, today: products.holders.today + 1 } } }
  const c = H.changes(a, H.seenOf(more), more)
  assert.deepEqual(c.map((x) => x.title).sort(), ['Holder map opened', 'Quest completed'])
})

test('formatting and map geometry', () => {
  assert.equal(H.kpiText(null), '–')
  assert.equal(H.kpiText({ v: 5, of: 6, label: '', short: '' }), '5/6')
  assert.equal(H.kpiText({ v: 1829, label: '', short: '' }), '1,829')
  assert.match(H.curve([0, 0], [100, 0], [50, 50]), /^M0 0 Q50\.0 -18\.0 100 0$/)
  assert.equal(H.ago('2026-10-28T02:09:30Z', NOW), 'just now')
  assert.equal(H.ago('2026-10-27T22:10:00Z', NOW), '4 h ago')
})
