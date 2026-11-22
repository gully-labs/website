// The server-rendered landing (server/landing.mjs): the first response is the page, nothing waits on a script.
// No build, no network. npm run test:landing
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import zlib from 'node:zlib'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'landing-'))
process.env.GULLY_CORE_STATIC = '1'
const { headTags, pageMeta, sitemapFor, robotsFor } = await import('../server/seo.mjs')
const L = await import('../server/landing.mjs')
const G = await import('../server/landing-graphs.mjs')
const C = await import('../server/gully-core.mjs')

const svc = (key, state, ms) => ({ key, name: key, state, ms, history: [{ ms: 100 }, { ms: ms ?? null }] })
const data = {
  hub: { chain: { head: 4501 }, gateway: { ok: 5, total: 6, networks: [{ alias: 'gully-testnet', state: 'OK' }, { alias: 'base', state: 'DOWN' }] }, services: [svc('gully-id', 'up', 120), svc('safe', 'up', 180), svc('ai-api', 'coming', null), svc('pay', 'down', null)] },
  products: { chain: { hourly: [{ txs: 3 }, { txs: 0 }] }, activity: { hourly: [{ launches: 2, trades: 1, swaps: 0 }] }, holders: { daily: [{ maps: 5 }] }, security: { daily: [{ scans: 0 }], total: 0 } },
  live: { id: { totals: { users: 35 }, dailySignins: [{ n: 4 }] }, pay: { services: { api: 'operational', webhooks: 'degraded' } } },
  stats: { totals: { tvlUsd: 64884 }, venues: [{ key: 'peddles', state: 'ok', tvlUsd: 64884, daily: [{ v: 1 }, { v: 2 }] }] },
}
const meta = pageMeta('gullylabs.xyz', '/preview/landing')
const html = await L.renderLanding(headTags(meta), data)
const phtml = await L.renderProjects(headTags(pageMeta('gullylabs.xyz', '/projects')), data)
const APPS = (await import('../src/content/appServices.ts')).APP_SERVICES

test('the first response is the page: one h1, products, footer and figures, no loader', () => {
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1)
  assert.ok(!/id="root"|class="[^"]*(spinner|loader)[^"]*"|Loading…/.test(html), 'no app shell and no loader')
  for (const t of ['Chains, storage, analytics and builds, in one app.', 'You Think It, We Ship It', 'Everything in the app', 'Powered by Gully Labs', ...APPS.map((x) => x.title)]) assert.ok(html.includes(t), t)
  // The home page promotes only what the app offers (owner, 2026-11-20): no other Gully project is named or sold on it.
  const main = html.slice(html.indexOf('<main>'), html.indexOf('</main>'))
  for (const t of ['Gully Core', 'Gully Multisig', 'PeddleSwap', 'Peddles', 'HolderMaps', 'Gully Security', 'Gully Pay', 'Gully RPC', 'kre8', 'Gully Studio']) assert.ok(!main.includes(t), `${t} is a project: it belongs on /projects`)
  assert.ok(!/admin\.|internal|e2e/i.test(main), 'no admin or internal text on a public page')
  assert.ok(!/gully safe|safe\.gullychain|deepcore/i.test(html))
})

test('a source that cannot be read shows a dash, never a zero or an invented figure', async () => {
  const none = await L.renderLanding(headTags(meta), { hub: null, products: null, live: null, stats: null })
  assert.ok(none.includes('data-b="up">–<') && none.includes('data-b="ms">–<') && none.includes('data-b="block">–<'))
  const noneP = await L.renderProjects(headTags(pageMeta('gullylabs.xyz', '/projects')), { hub: null, products: null, live: null, stats: null })
  assert.ok(noneP.includes('data-b="up">–<') && noneP.includes('data-b="tvl">–<'))
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
  assert.ok(scripts < 13_500, `scripts ${scripts}`)
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
  const paths = new Set([...(html + phtml).matchAll(/(?:src|href)="(\/[^"]+\.(?:png|svg|webp|jpg))"/g)].map((m) => m[1]))
  assert.ok(paths.size > 10)
  for (const f of paths) {
    assert.ok(fs.existsSync(new URL(`../public${f}`, import.meta.url)), `${f} is not in public/`)
    assert.equal(movedPageUrl(f), null, `${f} would redirect`)
  }
})

test('the owl, logotype, badge and the Gully Core mark are the official files, byte for byte', async () => {
  const { createHash } = await import('node:crypto')
  const sha = (f) => createHash('sha256').update(fs.readFileSync(new URL(`../public${f}`, import.meta.url))).digest('hex')
  const want = {
    '/brand/kit/owl/owl-presenting.png': '602a46f137f4e76586f1994423981d0c52ce45ff93b6f889cc053164829f70ef', // Gully Labs kit mascot/owl-presenting.png
    '/brand/kit/logotype-reversed.svg': 'db34f10cdf149859f31121b3b03c61f9064301a254d54fd0238d30c630ee13a6', // kit logo/logotype-reversed.svg
    '/brand/kit/powered-by-clear-white.svg': '21ba7df99a68c2bd1849af36c5debd9a8956bcdd207ab2a52e5f37e3a03295c1', // kit badges/powered-by-clear-white.svg
    '/brand/web/logos/gc-icon.svg': '4f86d2a0c2bb1afda317f21ae7c2198564ca61241f2c48cc75df1cb87033739b', // Gully Chain kit v4 logo/gc-icon.svg
  }
  for (const [f, h] of Object.entries(want)) assert.equal(sha(f), h, f)
  assert.ok(html.includes('/brand/kit/owl/owl-presenting.png') && !html.includes('owl-presenting-400.webp'), 'the page serves the kit owl')
  assert.ok(!html.includes('gully-core-emblem-192.png'), 'no old Gully Core emblem')
  // Gully Core's own kit (2026-11-08): the hex-C (scripts/test-product-brands.mjs checks every product mark).
  assert.ok(phtml.includes('/brand/products/gully-core-icon-ink.svg'), 'Gully Core shows its own hex-C on /projects')
})

test('an all-zero chart keeps its resting line and says so; a chart with activity does not', () => {
  const zero = G.coreBars({ activity: { hourly: [{ launches: 0 }, { launches: 0 }, { launches: 0 }] } }, 'launches')
  assert.ok(zero.includes('No launches in the last 24 hours') && zero.includes('g-rest'), 'zero series: the line and the words')
  const some = G.coreBars({ activity: { hourly: [{ launches: 0 }, { launches: 2 }] } }, 'launches')
  assert.ok(!some.includes('g-none') && some.includes('g-bar'), 'a series with activity draws bars')
  assert.ok(!G.coreBars({ activity: { hourly: [] } }, 'swaps').includes('g-none'), 'an unreadable source stays an empty frame, not a claim of zero')
})

test('the footer is the app column + company; every project is one link away on /projects; every project tile is on /projects', () => {
  const F = JSON.parse(fs.readFileSync(new URL('../server/data/footer-app.json', import.meta.url), 'utf8'))
  for (const c of F.columns) assert.ok(c.links.length <= 7, `${c.title}: ${c.links.length} rows`)
  const app = F.columns.find((c) => c.id === 'app').links
  assert.deepEqual(app.map((l) => l.service), APPS.map((x) => x.key), 'the footer lists the services of the app, in order')
  for (const l of app) assert.equal(l.href, APPS.find((x) => x.key === l.service).href.replace(/#.*/, '') + (l.href.includes('#') ? l.href.slice(l.href.indexOf('#')) : ''), l.label)
  for (const l of F.columns.flatMap((c) => c.links)) assert.ok(html.includes(`<span>${l.label}</span>`) && phtml.includes(`<span>${l.label}</span>`), `${l.label} is in the footer of both pages`)
  assert.ok(html.slice(html.indexOf('<footer')).includes('href="/projects"'), 'the footer links /projects')
  const grouped = new Set(L.GROUPS.flatMap((g) => g.keys))
  assert.deepEqual([...grouped].sort(), L.TILES.map((t) => t.key).sort(), 'every tile is in a group of /projects and every group member has a tile')
  for (const t of L.TILES) assert.ok(phtml.includes(`data-p="${t.key}"`), `${t.name} is on /projects`)
  assert.ok(!/Offerwall|Copy Trading|Gully Social/.test(phtml.slice(phtml.indexOf('<footer'))), 'features are not footer items')
})

test('the app cards match the app: the sidebar pages are covered, each card opens the app or its docs in a new tab, each has a live picture', async () => {
  const { SIDEBAR } = await import('../src/pages/developers/services/nav.ts').catch(() => ({ SIDEBAR: null }))
  const sidebar = SIDEBAR ? SIDEBAR.map((x) => x.id) : ['overview', 'activity', 'chains', 'ipfs', 'analytics', 'services', 'keys', 'billing', 'team', 'settings']
  const covered = new Set([...APPS.flatMap((x) => x.pages), 'overview', 'activity', 'settings'])
  assert.deepEqual([...covered].sort(), sidebar.sort(), 'every page of the app is a card or part of the account')
  for (const t of APPS) {
    assert.ok(html.includes(`id="p-${t.key}"`) && html.includes(`data-sv-chart="${t.key}"`), `${t.key}: panel and picture`)
    assert.ok(html.includes(`href="${t.href}"`), `${t.key}: button`)
    assert.ok(/^https:\/\/app\.gullylabs\.xyz\//.test(t.href), `${t.key} opens the app`)
  }
  assert.ok(html.includes('Free ') || html.includes('Free</'), 'the plan prices chart names the free plan')
  assert.ok(/\$49/.test(html) && /\$199/.test(html), 'USD prices from server/plans.mjs')
  assert.ok(html.includes('href="/projects"') && html.includes('>Projects<'), 'the header links /projects')
})

test('the chain picker is the Gully Core manifest reading: every chain, its state, live mainnets first, a real mark each', () => {
  const { chains, liveMainnets } = C.gullyCore()
  assert.ok(chains.length >= 6 && liveMainnets.length >= 1)
  for (const c of chains) {
    assert.ok(phtml.includes(`data-chain="${c.key}"`), c.key)
    assert.ok(phtml.includes(`data-detail="${c.key}"`), `${c.key} detail`)
    assert.ok(phtml.includes(`<span>${c.state}</span>`), `${c.key}: ${c.state}`)
    if (!c.open) assert.equal(c.cta, null, `${c.key} is not open: no button`)
    else assert.ok(c.cta && phtml.includes(c.cta.href), `${c.key}: a button to ${c.cta?.href}`)
    assert.ok(c.logo && fs.existsSync(new URL(`../public${c.logo}`, import.meta.url)), `${c.key}: a real mark served by this site (${c.logo})`)
  }
  const first = phtml.indexOf('data-chain=')
  assert.ok(phtml.slice(first, first + 60).includes(`data-chain="${chains[0].key}"`) && chains[0].status === 'live', 'a live mainnet comes first')
  for (const c of chains) assert.ok(!c.live.includes('Gully Multisig') || c.multisig, c.key)
  assert.ok(!phtml.includes('core-chains'), 'no hard-coded chain list is left')
})

test('Build links go to the real Gully Core routes; no simulated motion in the scripts', () => {
  for (const r of ['launch/v2/new', 'pads/new', 'dexes/new?kind=dex', 'pads/new?kind=stocks', 'vaults/new', 'locks/new']) assert.ok(phtml.includes(`https://app.gullycore.xyz/${r}`), r)
  const js = L.landingAsset('/landing/live.js') + L.landingAsset('/landing/graphs.mjs')
  assert.ok(!/Math\.random/.test(js) && !/Math\.sin/.test(L.landingAsset('/landing/live.js')))
})

test('the stock tracker is marketed on the home page: live figures, a chart, a link, never a zero for a read that failed', async () => {
  const tracker = { rows: [
    { chain: 'robinhood', ticker: 'NVDA', gapPct: 2.4, status: 'premium', pool: { totalLiquidityUsd: 120000 } },
    { chain: 'bsc', ticker: 'AAPL', gapPct: -0.5, status: 'in-line', pool: { totalLiquidityUsd: 80000 } },
    { chain: 'bsc', ticker: 'TSLA', gapPct: 9, status: 'thin', pool: { totalLiquidityUsd: 10 } },
  ] }
  const page = await L.renderLanding(headTags(meta), { ...data, tracker })
  const main = page.slice(page.indexOf('<main>'), page.indexOf('</main>'))
  assert.ok(main.includes('id="tools"') && main.includes('href="/tracker"') && main.includes('href="/widget"'), 'a section, the tracker link and the widget link')
  const v = G.trackerView(tracker)
  assert.deepEqual([v.stocks, v.flagged, v.typical, v.liquidity], ['3', '1', '1.45%', '$200.0K'], 'a thin pool is never counted in the typical gap')
  assert.ok(main.includes(`data-tk="stocks">3<`) && main.includes('data-tk-chart') && main.includes('class="g-bar"'), 'figures and a drawn chart are in the first HTML')
  const none = G.trackerView(null)
  assert.deepEqual([none.stocks, none.flagged, none.typical, none.liquidity, none.state], ['–', '–', '–', '–', 'reading'], 'no read: dashes, not zeros')
  assert.ok(/data-tk-chart>\s*<svg/.test(html), 'even with no read the chart frame holds a resting line, not an empty box')
  const js = L.landingAsset('/landing/live.js')
  assert.ok(js.includes("tracker: ['/api/tracker'"), 'the page script keeps the tracker figures current')
  assert.ok(/Tracker<\/span>/.test(page) || page.includes('href="/tracker"'), 'the header links the tracker')
})
