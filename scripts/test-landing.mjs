// The server-rendered landing (server/landing.mjs): the first response is the page, nothing waits on a script.
// No build, no network. npm run test:landing
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import zlib from 'node:zlib'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'landing-'))
const { headTags, pageMeta, sitemapFor, robotsFor } = await import('../server/seo.mjs')
const L = await import('../server/landing.mjs')
const G = await import('../server/landing-graphs.mjs')

const svc = (key, state, ms) => ({ key, name: key, state, ms, history: [{ ms: 100 }, { ms: ms ?? null }] })
const data = {
  hub: { chain: { head: 4501 }, gateway: { ok: 5, total: 6, networks: [{ alias: 'gully-testnet', state: 'OK' }, { alias: 'base', state: 'DOWN' }] }, services: [svc('gully-id', 'up', 120), svc('safe', 'up', 180), svc('ai-api', 'coming', null), svc('pay', 'down', null)] },
  products: { chain: { hourly: [{ txs: 3 }, { txs: 0 }] }, activity: { hourly: [{ launches: 2, trades: 1, swaps: 0 }] }, holders: { daily: [{ maps: 5 }] }, security: { daily: [{ scans: 0 }], total: 0 } },
  live: { id: { totals: { users: 35 }, dailySignins: [{ n: 4 }] }, pay: { services: { api: 'operational', webhooks: 'degraded' } } },
  stats: { totals: { tvlUsd: 64884 }, venues: [{ key: 'peddles', state: 'ok', tvlUsd: 64884, daily: [{ v: 1 }, { v: 2 }] }] },
}
const meta = pageMeta('gullylabs.xyz', '/preview/landing')
const html = await L.renderLanding(headTags(meta), data)

test('the first response is the page: one h1, products, footer and figures, no loader', () => {
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1)
  assert.ok(!/id="root"|class="[^"]*(spinner|loader)[^"]*"|Loading…/.test(html), 'no app shell and no loader')
  for (const t of ['Gully Multisig', 'Gully Core', 'PeddleSwap', '4,501', '$64.9K', 'Powered by Gully Labs']) assert.ok(html.includes(t), t)
  assert.ok(!/gully safe|safe\.gullychain|deepcore/i.test(html))
})

test('a source that cannot be read shows a dash, never a zero or an invented figure', async () => {
  const none = await L.renderLanding(headTags(meta), { hub: null, products: null, live: null, stats: null })
  assert.ok(none.includes('data-b="up">–<') && none.includes('data-b="tvl">–<'))
  const c = G.cards({})
  for (const [k, v] of Object.entries(c)) if (v.how == null) assert.equal(v.value, '–', k)
})

test('every menu item has an icon; external links open in a new tab', () => {
  for (const m of html.matchAll(/<li><a href="([^"]*)"([^>]*)>(.*?)<\/a><\/li>/gs)) if (!m[0].includes('news')) assert.ok(m[3].includes('class="ic"') || !/<span>/.test(m[3]), m[1])
  for (const m of html.matchAll(/<a href="(https?:[^"]*)"([^>]*)>/g)) assert.ok(/target="_blank"/.test(m[2]) && /noopener noreferrer/.test(m[2]), m[1])
})

test('budget: the page and its scripts stay under 100 KB compressed', () => {
  const gz = (s) => zlib.gzipSync(s).length
  const scripts = gz(L.landingAsset('/landing/live.js')) + gz(L.landingAsset('/landing/graphs.mjs'))
  assert.ok(scripts < 12_000, `scripts ${scripts}`)
  assert.ok(gz(html) + scripts < 100_000, `total ${gz(html) + scripts}`)
})

test('motion is opt-in: without the script nothing is left part-drawn; reduced motion is respected', () => {
  assert.ok(html.includes('prefers-reduced-motion:reduce'))
  assert.ok(!/\n\.g-bar\{[^}]*animation/.test(html) && /\.in \.g-bar\{/.test(html))
})

test('the preview is noindex, not in the sitemap, and robots does not list it', () => {
  assert.equal(meta.noindex, true)
  assert.ok(/<meta name="robots" content="noindex">/.test(html))
  assert.ok(!sitemapFor('gullylabs.xyz').includes('/preview/'))
  assert.ok(robotsFor('gullylabs.xyz').includes('Sitemap:'))
})
