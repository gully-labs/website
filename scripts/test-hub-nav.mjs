// The Gully Labs App's slim navigation (owner, 2026-11-03: "all services don't need to be in the gullylabs dashboard"):
//
//   npm run test:hub-nav        (no build, no browser: Vite SSR loads the TypeScript)
//
// 1. The sidebar lists exactly seven pages, in order, each with a Lucide icon that renders as an <svg>, and none of
//    them is a product or a tool. 2. Every product hash leaves for the product's own app (redirectFor), the old Gully
//    Chain hashes too, while the app's own pages stay. 3. The DeepCore ban: no file under src/ carries the capitalised
//    brand word (the partnership ended 2026-10-29; Gully Core is ours). 4. server/hosts.mjs APP_TABS still knows every id.
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

const PRODUCT_IDS = ['chain', 'pay', 'rpc', 'ipfs', 'holders', 'security', 'studio', 'ai', 'street', 'bridge', 'safe', 'quests', 'gully-core']
const TOOL_IDS = ['tracker', 'score', 'widgets', 'telegram', 'alerts', 'analytics']

test('sidebar: exactly seven pages, in order, each with an svg icon, no product or tool among them', () => {
  const ids = nav.SIDEBAR.map((s) => s.id)
  assert.deepEqual(ids, ['overview', 'activity', 'products', 'keys', 'billing', 'team', 'settings'])
  assert.equal(nav.HUB_NAV_IDS, ids.join(','))
  for (const s of nav.SIDEBAR) {
    assert.equal(typeof s.label, 'string')
    assert.ok(s.label.length > 1, `${s.id}: label`)
    const svg = renderToStaticMarkup(createElement(s.icon, { size: 16 }))
    assert.match(svg, /^<svg\b/, `${s.id}: its icon renders as an <svg>`)
    assert.match(svg, /class="lucide/, `${s.id}: a Lucide icon`)
  }
  for (const id of [...PRODUCT_IDS, ...TOOL_IDS]) assert.ok(!ids.includes(id), `${id} is not a sidebar page`)
  assert.equal(new Set(nav.SIDEBAR.map((s) => s.label)).size, 7, 'seven distinct labels')
})

test('tools: the six HolderMaps / Gully Security features stay, grouped under Products, each with an icon', () => {
  assert.deepEqual(nav.TOOL_TABS.map((t) => t.id).sort(), [...TOOL_IDS].sort())
  for (const t of nav.TOOL_TABS) {
    assert.match(renderToStaticMarkup(createElement(t.icon, { size: 16 })), /^<svg\b/, `${t.id}: icon`)
    assert.ok(['HolderMaps', 'Gully Security', 'Gully Labs'].includes(t.of), `${t.id}: belongs to a product`)
    assert.ok(t.line.length > 20, `${t.id}: one line of copy`)
  }
  // Gully AI is not a page any more: the floating assistant opens instead.
  assert.equal(nav.AI_TAB.id, 'ai')
  assert.ok(!nav.SERVICE_TABS.some((s) => s.id === 'ai'))
})

test('redirects: every product hash leaves for the product\'s own app; the app\'s pages stay', () => {
  const want = {
    chain: 'https://kre8.fun',
    pay: 'https://gullypay.xyz',
    rpc: 'https://app.gullyrpc.xyz',
    ipfs: 'https://docs.gullylabs.xyz/ipfs',
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
  }
  // The old Gully Chain hashes go to Gully Chain's app.
  for (const h of ['chains', 'chains/launch', 'chain-kit', 'deepcore']) assert.equal(nav.redirectFor(h), 'https://kre8.fun', h)
  // The app's own pages, tools and the Gully AI drawer never leave.
  for (const id of ['overview', 'activity', 'products', 'keys', 'billing', 'team', 'settings', ...TOOL_IDS, 'ai', 'merchant', 'scans', '', 'receipt=1:0xabc']) assert.equal(nav.redirectFor(id), null, id)
})

test('server: hosts.mjs APP_TABS lists every page id (sidebar, tools, Gully AI, the products)', () => {
  const ids = [...nav.SIDEBAR.map((s) => s.id), ...nav.TOOL_TABS.map((t) => t.id), nav.AI_TAB.id, ...nav.HANDOFF_TABS.map((h) => h.id), 'merchant', 'scans']
  for (const id of ids) assert.ok(APP_TABS.includes(id), `${id} is in APP_TABS`)
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
