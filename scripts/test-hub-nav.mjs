// The Gully Labs App's navigation (owner, 2026-11-08: "clean up the dashboard and have only the services gullylabs
// offers on the app / the other projects are on the web"):
//
//   npm run test:hub-nav        (no build, no browser: Vite SSR loads the TypeScript)
//
// 1. The sidebar lists exactly ten pages, in order, each with a Lucide icon that renders as an <svg>, and none of them
//    is another product or a HolderMaps / Gully Security tool. 2. Every hash that left the app goes somewhere sensible
//    on the web (redirectFor): the removed pages to the feature's page or the product's home, the products to their own
//    apps, the old Gully Chain hashes too, while the app's own pages stay. 3. The phone tab bar is four sidebar pages.
//    4. The DeepCore ban: no file under src/ carries the capitalised brand word (the partnership ended 2026-10-29).
//    5. server/hosts.mjs APP_TABS still knows every id.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vite = await createServer({ root: ROOT, configFile: false, plugins: [react()], logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } })
after(() => vite.close())

const nav = await vite.ssrLoadModule('/src/pages/developers/services/nav.ts')
const { APP_TABS } = await import('../server/hosts.mjs')

const SIDEBAR_IDS = ['overview', 'activity', 'chains', 'ipfs', 'analytics', 'services', 'keys', 'billing', 'team', 'settings']
const PRODUCT_IDS = ['chain', 'pay', 'rpc', 'holders', 'security', 'studio', 'ai', 'street', 'bridge', 'safe', 'quests', 'gully-core', 'products']
const TOOL_IDS = ['tracker', 'score', 'widgets', 'telegram', 'alerts']
const svgOf = (icon) => renderToStaticMarkup(createElement(icon, { size: 16 }))

test('sidebar: exactly ten pages, in order, each with an svg icon, no product or tool among them', () => {
  const ids = nav.SIDEBAR.map((s) => s.id)
  assert.deepEqual(ids, SIDEBAR_IDS)
  assert.equal(nav.HUB_NAV_IDS, ids.join(','))
  for (const s of nav.SIDEBAR) {
    assert.equal(typeof s.label, 'string')
    assert.ok(s.label.length > 1, `${s.id}: label`)
    assert.match(svgOf(s.icon), /^<svg\b/, `${s.id}: its icon renders as an <svg>`)
    assert.match(svgOf(s.icon), /class="lucide/, `${s.id}: a Lucide icon`)
  }
  for (const id of [...PRODUCT_IDS, ...TOOL_IDS]) assert.ok(!ids.includes(id), `${id} is not a sidebar page`)
  assert.equal(new Set(nav.SIDEBAR.map((s) => s.label)).size, 10, 'ten distinct labels')
  // The one link to the other products: the web, not a page here.
  assert.equal(nav.PRODUCTS_URL, 'https://gullylabs.xyz/products')
})

test('tab bar: four sidebar pages (Overview, Activity, Analytics, Billing)', () => {
  assert.deepEqual(nav.TAB_BAR_IDS, ['overview', 'activity', 'analytics', 'billing'])
  for (const id of nav.TAB_BAR_IDS) assert.ok(SIDEBAR_IDS.includes(id), `${id} is a sidebar page`)
})

test('removed pages: Products and the five HolderMaps / Gully Security tools leave for the web, each with a destination that says what it is', () => {
  assert.deepEqual(nav.REMOVED_TABS.map((t) => t.id).sort(), ['alerts', 'products', 'score', 'telegram', 'tracker', 'widgets'])
  const want = {
    products: ['https://gullylabs.xyz/products', 'page'],
    tracker: ['https://gullylabs.xyz/tracker', 'page'],
    alerts: ['https://holdermaps.xyz/', 'home'],
    score: ['https://gullylabs.xyz/score', 'page'],
    widgets: ['https://gullylabs.xyz/widget', 'page'],
    telegram: ['https://holdermaps.xyz/', 'home'],
  }
  for (const t of nav.REMOVED_TABS) {
    assert.match(svgOf(t.icon), /^<svg\b/, `${t.id}: icon`)
    assert.ok(['HolderMaps', 'Gully Security', 'Gully Labs'].includes(t.of), `${t.id}: belongs to a product`)
    assert.deepEqual([t.href, t.where], want[t.id], t.id)
    assert.equal(nav.redirectFor(t.id), t.href, t.id)
    assert.equal(nav.redirectFor(`#${t.id}`), t.href, `#${t.id}`)
    assert.equal(nav.redirectFor(`${t.id}/anything`), t.href, `${t.id}/sub`)
    assert.ok(nav.isRemovedTab(t.id))
    assert.equal(nav.leavingFor(t.id)?.href, t.href)
  }
  // Gully AI is not a page any more: the floating assistant opens instead.
  assert.equal(nav.AI_TAB.id, 'ai')
  assert.equal(nav.redirectFor('ai'), null)
})

test('products: every product hash leaves for the product\'s own app; the app\'s pages stay', () => {
  const want = {
    chain: 'https://kre8.fun',
    pay: 'https://gullypay.xyz',
    rpc: 'https://app.gullyrpc.xyz',
    holders: 'https://holdermaps.xyz',
    security: 'https://gullysecurity.xyz',
    studio: 'https://gullystudio.xyz',
  }
  assert.deepEqual(nav.HANDOFF_TABS.map((h) => h.id).sort(), Object.keys(want).sort())
  for (const [id, url] of Object.entries(want)) {
    assert.equal(nav.redirectFor(id), url, id)
    assert.equal(nav.redirectFor(`#${id}`), url, `#${id}`)
    assert.equal(nav.redirectFor(`${id}/anything`), url, `${id}/sub`)
    assert.match(url, /^https:\/\/[a-z0-9.-]+(\/|$)/, 'an https address on the product\'s own domain')
    assert.equal(nav.leavingFor(id)?.href, url)
  }
  // The old Gully Chain hashes go to Gully Chain's app; #chains alone is this app's Chains page.
  for (const h of ['chains/launch', 'chain-kit', 'deepcore']) assert.equal(nav.redirectFor(h), 'https://kre8.fun', h)
  // The app's own pages and the Gully AI drawer never leave. (#ipfs is a page of this app now.)
  for (const id of [...SIDEBAR_IDS, 'ai', 'merchant', 'scans', '', 'receipt=1:0xabc', 'chains', 'ipfs/anything']) assert.equal(nav.redirectFor(id), null, id)
  assert.equal(nav.leavingFor('overview'), null)
})

test('server: hosts.mjs APP_TABS is exactly the app\'s page ids (sidebar, the two leftover pages, the removed pages, Gully AI, the products)', () => {
  const ids = [...nav.SIDEBAR.map((s) => s.id), 'merchant', 'scans', ...nav.REMOVED_TABS.map((t) => t.id), nav.AI_TAB.id, ...nav.HANDOFF_TABS.map((h) => h.id)]
  assert.deepEqual([...APP_TABS].sort(), [...new Set(ids)].sort())
})

test('DeepCore ban: no file under src/ names the old partner', () => {
  const hits = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name)
      if (e.isDirectory()) walk(f)
      else if (/\.(ts|tsx|css|md|json|mjs|js|html)$/.test(e.name)) {
        const lines = fs.readFileSync(f, 'utf8').split('\n')
        lines.forEach((l, i) => {
          // The brand word at a word start (`onDeepcorePool`, `wantsDeepcore` are API fields the server still sends).
          if (/(?<![a-z])(DeepCore|Deepcore)/.test(l)) hits.push(`${path.relative(ROOT, f)}:${i + 1}: ${l.trim().slice(0, 100)}`)
        })
      }
    }
  }
  walk(path.join(ROOT, 'src'))
  assert.deepEqual(hits, [], `DeepCore is still named in src:\n${hits.join('\n')}`)
})
