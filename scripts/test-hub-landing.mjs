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

test('catalog: eight Gully-named products in story order, every link and news item points at a real product', () => {
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

/* ---- the Peddle family (owner, 2026-11-05): PeddleSwap, Peddles and PeddleQuest are Gully Labs projects ---- */
const crypto = await import('node:crypto')
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(new URL(`../${p}`, import.meta.url))).digest('hex')

test('Peddle family: PeddleSwap (DEX), Peddles (launchpad) and PeddleQuest, official logos byte for byte, links to their own sites', () => {
  assert.deepEqual(H.PEDDLE_FAMILY.map((p) => [p.key, p.kind, p.url]), [
    ['peddleswap', 'DEX', 'https://peddleswap.xyz/'],
    ['peddles', 'Launchpad', 'https://peddles.xyz/'],
    ['peddlequest', 'Quests', 'https://peddlequest.xyz/'],
  ])
  // the logo files are the projects' own (public/venues/SOURCES.json): unchanged bytes
  const want = { peddleswap: '432d71f7c422274db54e4a7ab7e790e8914394105f05d77d28c2c6a16ad1d72a', peddles: '1aa72a4f33334c7f82b42b1a777c67d5473b6220328f0c5381ff0a5a818c1b95', peddlequest: 'acced9dd25adf3a7122a16a3092cbd0f76b257bc00760ad1c728695c9c143945' }
  const sources = JSON.parse(read('public/venues/SOURCES.json'))
  for (const p of H.PEDDLE_FAMILY) {
    assert.equal(p.logo, sources[p.key].file, `${p.key} uses its file in public/venues`)
    assert.equal(sha(`public${p.logo}`), want[p.key], `${p.key} logo bytes`)
    assert.equal(p.status, 'live')
    assert.ok(p.line.length > 20 && p.line.length <= 90, `${p.key} one-line description`)
  }
  // each has a page on this site and is a project of the same family in the projects list
  const projects = read('src/content/projects.ts').replace(/\r\n/g, '\n')
  for (const p of H.PEDDLE_FAMILY) assert.match(projects, new RegExp(`slug: '${p.page}',\\s+key: '${p.key}',\\s+family: 'Peddle'`), p.key)
})

test('product count: eight Gully-named products + the Peddle family, the same in the title, the H1, crawlers and JSON-LD', async () => {
  assert.equal(H.PRODUCT_COUNT, 11)
  assert.equal(H.PRODUCT_COUNT_WORD, 'eleven')
  assert.match(H.LANDING_TITLE, /^Eleven products: .*trading/)
  for (const n of ['PeddleSwap', 'Peddles']) assert.ok(H.LANDING_DESCRIPTION.includes(n), n)
  const page = read('src/pages/hub/Constellation.tsx')
  assert.ok(!/Eight (connected )?products/.test(page), 'no stale count on the landing')
  assert.ok(page.includes('<PeddleFamily stats={stats}'), 'the family is in the product line-up')
  // The server's head tags come from the same table as the page's (src/content/seoPages.ts, through
  // server/data/page-content.json), and its product list from hubData: the two are read here as the server serves them.
  const { pageMeta } = await import('../server/seo.mjs')
  const served = pageMeta('gullylabs.xyz', '/')
  assert.equal(served.title, `Gully Labs · ${H.LANDING_TITLE}`, 'server title equals the page')
  assert.equal(served.description, H.LANDING_DESCRIPTION, 'server description equals the page')
  assert.ok(H.LANDING_HEADLINE.join(' ').toLowerCase().includes(`${H.PRODUCT_COUNT_WORD} products`), 'the headline counts the products')
  assert.equal(served.body.h1, H.LANDING_HEADLINE.join(' '), 'the served h1 is the page headline')
  assert.ok(!/Eight connected/.test(read('server/seo.mjs')))
  const list = served.ld.find((x) => x['@type'] === 'ItemList')
  for (const p of H.PEDDLE_FAMILY) assert.ok(list.itemListElement.some((i) => i.name === p.name && i.url === p.url), `${p.name} in the ItemList JSON-LD`)
  assert.equal(list.itemListElement.length, H.PRODUCT_COUNT, 'the ItemList counts every product')
  // llms.txt / llms-full.txt name the family and link the two sites
  for (const f of ['server/data/llms.txt', 'server/data/llms-full.txt']) {
    const t = read(f)
    assert.match(t.split('\n').slice(0, 4).join('\n'), /Peddle family for trading and DeFi \(PeddleSwap, a DEX at https:\/\/peddleswap\.xyz; Peddles, a launchpad at https:\/\/peddles\.xyz/, f)
    assert.ok(t.includes('- [PeddleSwap](https://peddleswap.xyz/): A Gully Labs project (Peddle family, DEX).'), f)
    assert.ok(t.includes('- [Peddles](https://peddles.xyz/): A Gully Labs project (Peddle family, Launchpad).'), f)
  }
  // /products, /ecosystem and the footer present them; the header menus are unchanged (slim nav)
  assert.ok(read('src/pages/products/ProductsIndex.tsx').includes('<PeddleFamily stats={live.stats}'))
  assert.ok(read('src/pages/Ecosystem.tsx').includes('FAMILY'))
  // the site footer lists the family under "Peddle" (external hosts open in a new tab through NavLink's href branch);
  // the header and the Menu sheet do not change
  const chrome = read('src/console/Chrome.tsx')
  const foot = chrome.slice(chrome.indexOf('export function ConsoleFooter'))
  assert.ok(foot.includes('data-testid="footer-peddle"') && foot.includes('PEDDLE_LINKS.map'), 'Peddle group in the footer')
  assert.ok(chrome.includes("PEDDLE_FAMILY.map((p) => ({ label: p.name, icon: PEDDLE_ICON[p.key], href: p.url }))"))
  assert.equal(chrome.slice(0, chrome.indexOf('export function ConsoleFooter')).split('PEDDLE_LINKS').length - 1, 1, 'defined once above, used only in the footer')
  // the sitemap carries their pages
  const { sitemapFor } = await import('../server/seo.mjs')
  const xml = sitemapFor('gullylabs.xyz')
  for (const p of H.PEDDLE_FAMILY) assert.ok(xml.includes(`https://gullylabs.xyz/projects/${p.page}<`), `/projects/${p.page} in the sitemap`)
})

test('Peddle family readings: live figures from /api/stats, nothing invented', () => {
  const day = (i, v) => ({ t: 1793000000 + i * 86400, v })
  const stats = {
    venues: [
      { key: 'peddleswap', state: 'ok', tvlUsd: 52310.5, volumeAllUsd: null, volume30dUsd: 4100.25, volume24hUsd: 90, feesAllUsd: null, fees24hUsd: 0.27, series: { volume: [day(0, 100), day(1, 140), day(2, 90)], fees: [], tvl: [day(0, 50000), day(1, 52000)] } },
      { key: 'peddles', state: 'ok', tvlUsd: 19090.9, volumeAllUsd: 6373.01, volume24hUsd: 12, feesAllUsd: 431.24, fees24hUsd: 1, daily: [day(0, 10), day(1, 30)] },
      { key: 'peddlequest', state: 'error' },
      { key: 'gullychain', state: 'ok', tvlUsd: 1 },
    ],
  }
  const R = H.peddleReadings(stats)
  assert.deepEqual(R.peddleswap.tvl, { label: 'value locked', v: 52310.5 })
  assert.deepEqual(R.peddleswap.volume, { label: 'volume, 30 d', v: 4100.25 }, 'no all-time figure: the 30-day one, labelled as such')
  assert.deepEqual(R.peddleswap.fees, { label: 'fees, 24 h', v: 0.27 })
  assert.deepEqual([R.peddleswap.spark, R.peddleswap.sparkOf], [[100, 140, 90], 'volume'])
  assert.deepEqual(R.peddles.volume, { label: 'volume, all time', v: 6373.01 })
  assert.deepEqual(R.peddles.fees, { label: 'fees, all time', v: 431.24 })
  assert.deepEqual(R.peddles.spark, [10, 30], 'older documents: the daily volume')
  assert.equal(R.peddlequest.state, 'error')
  assert.equal(R.peddlequest.tvl, null)
  assert.match(R.peddlequest.why, /unreadable/)
  // a venue with value locked but no volume history draws its value locked
  const tvlOnly = H.peddleReadings({ venues: [{ key: 'peddlequest', state: 'ok', tvlUsd: 400, volumeAllUsd: null, volume24hUsd: null, series: { volume: [], tvl: [day(0, 380), day(1, 400)] } }] })
  assert.deepEqual([tvlOnly.peddlequest.spark, tvlOnly.peddlequest.sparkOf, tvlOnly.peddlequest.volume], [[380, 400], 'tvl', null])
  // a real zero stays a zero; a missing figure stays missing
  const zero = H.peddleReadings({ venues: [{ key: 'peddles', state: 'ok', tvlUsd: 0, volumeAllUsd: null, volume24hUsd: null }] })
  assert.deepEqual([zero.peddles.tvl, zero.peddles.volume, zero.peddles.fees], [{ label: 'value locked', v: 0 }, null, null])
  // before the first answer: loading, no figures
  for (const k of ['peddleswap', 'peddles', 'peddlequest']) assert.deepEqual([H.peddleReadings(null)[k].state, H.peddleReadings(null)[k].tvl], ['loading', null])
})
