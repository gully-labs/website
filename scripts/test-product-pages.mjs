// One page per product and per Gully Core build, drawn by the server on one template (server/product-pages.mjs).
// No build, no network. npm run test:product-pages
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import test from 'node:test'
import zlib from 'node:zlib'

process.env.DATA_DIR = fs.mkdtempSync(`${os.tmpdir()}/product-pages-`)
const P = await import('../server/product-pages.mjs')
const G = await import('../server/landing-graphs.mjs')
const L = await import('../server/landing.mjs')
const CONTENT = JSON.parse(fs.readFileSync(new URL('../server/data/page-content.json', import.meta.url), 'utf8'))

const svc = (key, state, ms) => ({ key, name: key, state, ms, history: [{ ms: 100 }, { ms: ms ?? null }] })
const data = {
  hub: { chain: { head: 4501 }, gateway: { ok: 5, total: 6, networks: [] }, services: [svc('gully-id', 'up', 120), svc('street', 'up', 90), svc('indexer', 'down', null), svc('safe', 'up', 300)] },
  products: { chain: { recent: [{ txs: 3 }] }, activity: { hourly: [{ launches: 2, trades: 1, swaps: 0 }] }, holders: { daily: [{ maps: 5 }] }, security: { total: 4 } },
  live: { id: { totals: { users: 35 } }, pay: { services: { api: 'operational' } } },
  stats: { venues: [] },
}
const none = { hub: null, products: null, live: null, stats: null }
const split = (p) => {
  const [, , k, id] = p.split('/')
  return [k === 'build' ? 'build' : 'product', id]
}

test('every product and every Core build has a page; one h1, the shared chrome, no loader', async () => {
  assert.equal(P.PREVIEW_PATHS.length, Object.keys(CONTENT.product).length + 6)
  for (const p of P.PREVIEW_PATHS) {
    const html = await P.renderProduct('<title>t</title>', ...split(p), data)
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, p)
    assert.ok(html.includes('logotype-reversed.svg') && html.includes('powered-by-clear-white.svg'), p)
    assert.ok(!/id="root"|Loading…/.test(html), p)
    assert.ok(!/deepcore|gully safe|safe\.gullychain|bonding curve/i.test(html), `${p}: stale words`)
    assert.ok(!html.includes('href="/products/'), `${p}: stays on the preview`)
  }
})

test('an unknown slug is no page, and a prototype key is not a slug', async () => {
  for (const [k, id] of [['product', 'nope'], ['build', 'nope'], ['product', 'constructor'], ['build', 'constructor'], ['build', 'chain']]) {
    assert.equal(await P.renderProduct('', k, id, data), null, id)
    assert.equal(P.productMeta(k, id), null, id)
  }
})

test('a source that cannot be read shows a dash, never a zero', async () => {
  const html = await P.renderProduct('', 'product', 'gully-core', none)
  assert.ok(html.includes('data-v="ms">–<') && html.includes('data-v="up">–<') && html.includes('data-v="answered">–<'))
  const v = G.productView(none, { card: 'pay', hub: ['pay'], metric: null })
  assert.equal(v.value, '')
})

test('the figures are the probes: a down surface counts, a null reading is left out', () => {
  const v = G.productView(data, { card: 'core', hub: ['street', 'indexer'], metric: 'launches' })
  assert.equal(v.up, '1/2')
  assert.equal(v.ms, '90 ms')
  assert.equal(v.answered, '75.0%')
  assert.equal(v.state, 'down')
})

test('Token launch has the preset picker with the kit numbers, and says what each does not stop', async () => {
  const html = await P.renderProduct('', 'build', 'token', data)
  for (const t of ['10% to 1% over 5 minutes', '50% to 1% over 30 minutes', '50% to 1% over 2 minutes', 'Flat 1%', 'Does not protect against']) assert.ok(html.includes(t), t)
  assert.equal((html.match(/data-preset=/g) ?? []).length, 5)
  assert.equal((await P.renderProduct('', 'build', 'dex', data)).includes('data-preset='), false)
})

test('Core pages state the one fee', async () => {
  for (const k of ['token', 'pad', 'dex', 'stock', 'vault', 'locks']) assert.ok((await P.renderProduct('', 'build', k, data)).includes('0.30% of every trade'), k)
})

test('kit colours only, times in PT, script budget', async () => {
  const html = await P.renderProduct('', 'product', 'chain', data)
  assert.ok(!/#00[bBfF][0-9a-fA-F]{4}|cyan/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')))
  assert.ok(/M PT</.test(html))
  const js = ['server/product-live.mjs', 'server/landing-graphs.mjs'].map((f) => fs.readFileSync(new URL(`../${f}`, import.meta.url)))
  const kb = js.reduce((a, b) => a + zlib.gzipSync(b).length, 0) / 1024
  assert.ok(kb < 100, `${kb} KB`)
  assert.ok(L.landingAsset('/landing/product.js').includes('productView'))
})

test('the landing keeps the home page links unless it is the preview', async () => {
  const home = await L.renderLanding('', data)
  const pre = await L.renderLanding('', data, { preview: true })
  assert.ok(home.includes('href="/products/') && !pre.includes('href="/products/') && pre.includes('href="/preview/products/'))
  assert.equal(pre.replaceAll('/preview/products/', '/products/').length, home.length)
})
