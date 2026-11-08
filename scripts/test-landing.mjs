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
  for (const t of ['Launch a token. Run a launchpad. Own a DEX.', 'You Think It, We Ship It', 'Build on Gully Core', '0.30%', 'Gully Multisig', 'Gully Core', 'PeddleSwap', '$64.9K', 'Powered by Gully Labs']) assert.ok(html.includes(t), t)
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

test('the Follow on X bar: a plain link in a new tab, a 44 px dismiss, a blocking script from this origin', () => {
  assert.ok(html.includes('<a href="https://x.com/Gully_Labs" target="_blank" rel="noopener noreferrer"><svg') && html.includes('<span>Follow @Gully_Labs on X</span>'))
  assert.ok(/\.fx button\{[^}]*width:44px;height:44px/.test(html))
  assert.ok(html.indexOf('/landing/fx.js') < html.indexOf('<style>'), 'read before the first paint')
  assert.match(L.landingAsset('/landing/fx.js'), /gl-follow-x-dismissed/)
})

test('as the home page it carries the head of the home page: title, canonical, JSON-LD, no noindex', () => {
  const m = pageMeta('gullylabs.xyz', '/')
  const h = headTags(m)
  assert.ok(h.includes('<link rel="canonical" href="https://gullylabs.xyz/">'))
  assert.ok(!/noindex/.test(h))
  assert.ok(/"@type":"Organization"/.test(h) && /"@type":"WebSite"/.test(h))
})

test('every image on the page is a file we hold, served at its own path', async () => {
  const { movedPageUrl } = await import('../server/hosts.mjs')
  const paths = new Set([...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:png|svg|webp|jpg))"/g)].map((m) => m[1]))
  assert.ok(paths.size > 15)
  for (const f of paths) {
    assert.ok(fs.existsSync(new URL(`../public${f}`, import.meta.url)), `${f} is not in public/`)
    assert.equal(movedPageUrl(f), null, `${f} would redirect`)
  }
})

test('the footer and the orbit grid come from one catalog (server/data/footer.json): same products, no column over seven rows', () => {
  const F = JSON.parse(fs.readFileSync(new URL('../server/data/footer.json', import.meta.url), 'utf8'))
  assert.equal(F.columns.length, 4)
  for (const c of F.columns) assert.ok(c.links.length <= 7, `${c.title}: ${c.links.length} rows`)
  const all = [...F.columns.flatMap((c) => c.links), ...F.peddle.links]
  for (const l of all) assert.ok(['product', 'tool', 'company', 'peddle'].includes(l.rank), `${l.label}: rank ${l.rank} is not a footer item`)
  const tiles = new Set(all.map((l) => l.tile).filter(Boolean))
  assert.deepEqual([...tiles].sort(), L.TILES.map((t) => t.key).sort(), 'every tile is in the footer and every footer tile is in the grid')
  assert.equal(all.find((l) => l.label === 'Gully Core').href, 'https://gullycore.xyz')
  for (const l of all) assert.ok(html.includes(`<span>${l.label}</span>`), `${l.label} is in the footer`)
  assert.ok(!/Offerwall|Copy Trading|Gully Social/.test(html.slice(html.indexOf('<footer'))), 'features are not footer items')
})

test('chain states come from the config and only an open chain links to the builder', () => {
  const chains = JSON.parse(fs.readFileSync(new URL('../server/data/core-chains.json', import.meta.url), 'utf8'))
  for (const c of chains) {
    assert.ok(html.includes(`data-chain="${c.key}"`), c.key)
    if (!c.open) assert.ok(!c.cta || !c.cta.href.includes('/core/app'), c.key)
  }
  assert.equal(chains.filter((c) => c.open).map((c) => c.key).join(), 'gully,anubis', 'Gully Core is on the Gully Chain testnet and on Anubis today')
  for (const c of chains) assert.ok(c.logo, `${c.key}: a real logo, no letters`)
})

test('Build links go to the real Gully Core routes; no simulated motion in the scripts', () => {
  for (const r of ['launch/v2/new', 'pads/new', 'dexes/new?kind=dex', 'pads/new?kind=stocks', 'vaults/new', 'locks/new']) assert.ok(html.includes(`https://gullychain.xyz/core/app/${r}`), r)
  const js = L.landingAsset('/landing/live.js') + L.landingAsset('/landing/graphs.mjs')
  assert.ok(!/Math\.random/.test(js) && !/Math\.sin/.test(L.landingAsset('/landing/live.js')))
})
