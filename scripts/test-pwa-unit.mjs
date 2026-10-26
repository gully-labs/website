// Unit tests for the PWA's pure parts (server/pwa.mjs, server/pwa-build.mjs): manifests, the service worker's routing
// rules (what is cached, what never is), the precache list builder, the generated worker and the install card logic.
//
//   npm run test:pwa-unit        (no build, no server)
import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { APP_MANIFEST, dismissedRecently, HOLDERMAPS_MANIFEST, installCardMode, isIosSafari, manifestFor, routeFor, SECURITY_MANIFEST, SITE_MANIFEST, SW_RULES, swEligible } from '../server/pwa.mjs'
import { buildPrecacheList, generateSw, versionStamp } from '../server/pwa-build.mjs'

const ORIGIN = 'https://gullylabs.xyz'
const route = (path, o = {}) => routeFor(SW_RULES, { url: ORIGIN + path, method: 'GET', mode: 'cors', origin: ORIGIN, hasAuth: false, ...o })
const nav = (path, o = {}) => route(path, { mode: 'navigate', ...o })

test('manifests: site and app, kit colours, three icons including a maskable one', () => {
  assert.equal(manifestFor('gullylabs.xyz'), SITE_MANIFEST)
  assert.equal(manifestFor('app.gullylabs.xyz'), APP_MANIFEST)
  assert.equal(manifestFor('app.gullylabs.xyz:443'), APP_MANIFEST)
  assert.equal(manifestFor('localhost:9361'), SITE_MANIFEST)
  // holdermaps.xyz installs as HolderMaps (its own name; same icons and scope).
  assert.equal(manifestFor('holdermaps.xyz'), HOLDERMAPS_MANIFEST)
  assert.equal(manifestFor('www.holdermaps.xyz'), HOLDERMAPS_MANIFEST)
  assert.equal(HOLDERMAPS_MANIFEST.name, 'HolderMaps')
  // gullysecurity.xyz installs as Gully Security (its own name; same icons and scope).
  assert.equal(manifestFor('gullysecurity.xyz'), SECURITY_MANIFEST)
  assert.equal(manifestFor('www.gullysecurity.xyz'), SECURITY_MANIFEST)
  assert.equal(SECURITY_MANIFEST.name, 'Gully Security')
  assert.equal(manifestFor('gullysecurity.xyz.evil.test'), SITE_MANIFEST)
  for (const h of ['admin.gullylabs.xyz', 'docs.gullylabs.xyz', 'blog.gullylabs.xyz', 'analytics.gullylabs.xyz']) assert.equal(manifestFor(h), null, h)
  assert.equal(SITE_MANIFEST.name, 'Gully Labs')
  assert.equal(APP_MANIFEST.name, 'Gully Labs App')
  for (const m of [SITE_MANIFEST, APP_MANIFEST]) {
    assert.equal(m.display, 'standalone')
    assert.equal(m.start_url, '/')
    assert.equal(m.scope, '/')
    assert.equal(m.background_color, '#06050D')
    assert.equal(m.theme_color, '#06050D')
    assert.deepEqual(m.icons.map((i) => `${i.sizes}:${i.purpose}`), ['192x192:any', '512x512:any', '512x512:maskable'])
  }
})

test('routing: hashed build files are cache-first, page navigations network-first', () => {
  assert.equal(route('/assets/index-abcdef12.js'), 'asset')
  assert.equal(route('/assets/index-Ab_cD-1x.css'), 'asset')
  assert.equal(route('/assets/barlow-condensed-latin-700-normal-DeAdBeEf.woff2'), 'asset')
  assert.equal(nav('/'), 'navigate')
  assert.equal(nav('/pricing'), 'navigate')
  assert.equal(nav('/tracker/robinhood/NVDA'), 'navigate')
  // Not hashed, not a navigation: the network decides.
  assert.equal(route('/assets/plain.js'), null)
  assert.equal(route('/brand/icon/app-icon-1024.png'), null)
  assert.equal(route('/icon-192.png'), null)
})

test('routing: /api is never handled, in any form', () => {
  for (const p of ['/api/stats', '/api/tracker', '/api/developer/me', '/api/pay/gas', '/api/admin/overview', '/api', '/api/ask']) {
    assert.equal(route(p), null, p)
    assert.equal(nav(p), null, `${p} (navigation)`)
  }
  // A hashed-looking file under /api is still the API.
  assert.equal(route('/api/assets/index-abcdef12.js'), null)
})

test('routing: Gully Pay checkouts, admin, the Mini App, the embed and analytics are never handled', () => {
  for (const p of ['/pay/abc123', '/pay/abc123/receipt', '/pay/l/xyz', '/pay/m/store1', '/pay', '/admin', '/admin/', '/admin/enquiries', '/tg', '/tg/home', '/embed/holders/base/0xabc', '/analytics', '/analytics/plans', '/r/broadcast1', '/og/blog/post.png', '/.well-known/contracts.json']) {
    assert.equal(nav(p), null, `${p} (navigation)`)
    assert.equal(route(p), null, p)
  }
  // The look-alikes that are ordinary pages stay handled.
  assert.equal(nav('/payments-guide'), 'navigate')
  assert.equal(nav('/administration'), 'navigate')
})

test('routing: the worker, manifest and crawler files are never handled', () => {
  for (const p of ['/sw.js', '/manifest.json', '/manifest.webmanifest', '/robots.txt', '/sitemap.xml', '/healthz']) assert.equal(route(p), null, p)
})

test('routing: only same-origin GETs without credentials headers', () => {
  assert.equal(route('/assets/index-abcdef12.js', { method: 'POST' }), null)
  assert.equal(nav('/', { method: 'POST' }), null)
  assert.equal(nav('/', { method: 'HEAD' }), null)
  assert.equal(route('/assets/index-abcdef12.js', { hasAuth: true }), null)
  assert.equal(nav('/pricing', { hasAuth: true }), null)
  assert.equal(routeFor(SW_RULES, { url: 'https://analytics.gullylabs.xyz/script.js', method: 'GET', mode: 'no-cors', origin: ORIGIN }), null)
  assert.equal(routeFor(SW_RULES, { url: 'https://other.example/assets/index-abcdef12.js', method: 'GET', mode: 'cors', origin: ORIGIN }), null)
  assert.equal(routeFor(SW_RULES, { url: 'not a url', method: 'GET', origin: ORIGIN }), null)
})

test('registration: not on admin, docs, blog, analytics hosts, nor on Gully Pay, admin, Mini App or embed pages', () => {
  assert.equal(swEligible('gullylabs.xyz', '/'), true)
  assert.equal(swEligible('gullylabs.xyz', '/pricing'), true)
  assert.equal(swEligible('app.gullylabs.xyz', '/'), true)
  assert.equal(swEligible('localhost', '/app'), true)
  assert.equal(swEligible('admin.gullylabs.xyz', '/'), false)
  assert.equal(swEligible('docs.gullylabs.xyz', '/'), false)
  assert.equal(swEligible('blog.gullylabs.xyz', '/'), false)
  assert.equal(swEligible('localhost', '/admin'), false)
  for (const p of ['/pay/abc', '/pay/l/x', '/pay/m/y/receipt', '/tg', '/embed/holders/base/0x1']) assert.equal(swEligible('gullylabs.xyz', p), false, p)
})

// A Rollup-shaped output bundle: one entry with a static import and a lazy chunk, css and fonts.
const chunk = (fileName, o = {}) => ({ type: 'chunk', fileName, isEntry: false, imports: [], dynamicImports: [], viteMetadata: { importedCss: new Set(), importedAssets: new Set() }, ...o })
const bundle = () => ({
  'index.html': { type: 'asset', fileName: 'index.html', source: '<html></html>' },
  'assets/index-AAAAAAAA.js': chunk('assets/index-AAAAAAAA.js', {
    isEntry: true,
    imports: ['assets/vendor-BBBBBBBB.js'],
    dynamicImports: ['assets/Tracker-CCCCCCCC.js'],
    viteMetadata: { importedCss: new Set(['assets/index-DDDDDDDD.css']), importedAssets: new Set(['assets/barlow-condensed-latin-700-normal-EEEEEEEE.woff2', 'assets/barlow-condensed-cyrillic-700-normal-FFFFFFFF.woff2', 'assets/barlow-condensed-latin-ext-700-normal-GGGGGGGG.woff2']) },
  }),
  'assets/vendor-BBBBBBBB.js': chunk('assets/vendor-BBBBBBBB.js', { imports: ['assets/index-AAAAAAAA.js'] }),
  'assets/Tracker-CCCCCCCC.js': chunk('assets/Tracker-CCCCCCCC.js', { imports: ['assets/vendor-BBBBBBBB.js'] }),
  'assets/index-DDDDDDDD.css': { type: 'asset', fileName: 'assets/index-DDDDDDDD.css', source: '' },
})

test('precache list: the shell files, the entry, its static imports, css and the latin fonts; never lazy chunks', () => {
  const list = buildPrecacheList(bundle())
  assert.deepEqual(list.slice(0, 3), ['/index.html', '/errors/offline.html', '/brand/icon/app-icon-192.png'])
  assert.ok(list.includes('/assets/index-AAAAAAAA.js'))
  assert.ok(list.includes('/assets/vendor-BBBBBBBB.js'))
  assert.ok(list.includes('/assets/index-DDDDDDDD.css'))
  assert.ok(list.includes('/assets/barlow-condensed-latin-700-normal-EEEEEEEE.woff2'))
  assert.ok(!list.some((u) => /Tracker|cyrillic|latin-ext/.test(u)), 'lazy chunks and other font subsets stay out')
  assert.equal(new Set(list).size, list.length, 'no duplicates')
  // Nothing in the list is a path the worker refuses to handle (the assets would never be served from it).
  for (const u of list.filter((x) => x.startsWith('/assets/'))) assert.equal(route(u), 'asset', u)
  // Deterministic: the same bundle builds the same list.
  assert.deepEqual(buildPrecacheList(bundle()), list)
})

test('precache list: an unhashed file never enters it, and an empty bundle still has the shell', () => {
  const b = bundle()
  b['assets/index-AAAAAAAA.js'].imports.push('assets/plain.js')
  b['assets/plain.js'] = chunk('assets/plain.js')
  assert.ok(!buildPrecacheList(b).includes('/assets/plain.js'))
  assert.deepEqual(buildPrecacheList({}), ['/index.html', '/errors/offline.html', '/brand/icon/app-icon-192.png'])
})

test('version stamp: changes when the list or the shell html changes, stable otherwise', () => {
  const list = buildPrecacheList(bundle())
  const v = versionStamp(list, '<html>a</html>')
  assert.match(v, /^[0-9a-f]{10}$/)
  assert.equal(versionStamp(list, '<html>a</html>'), v)
  assert.notEqual(versionStamp(list, '<html>b</html>'), v)
  assert.notEqual(versionStamp([...list, '/assets/new-ZZZZZZZZ.js'], '<html>a</html>'), v)
})

test('generated worker: valid script with the list, version and rules stamped in, same routing as the rules', async () => {
  const list = buildPrecacheList(bundle())
  const src = generateSw({ precache: list, version: 'v123' })
  assert.ok(!/^\s*export /m.test(src), 'a classic script has no export')
  const listeners = {}
  const self = { addEventListener: (t, f) => (listeners[t] = f), location: { origin: ORIGIN }, skipWaiting: () => (self.skipped = true), clients: { claim: async () => {} } }
  const ctx = vm.createContext({ self, URL, caches: {}, Request, Response, fetch: () => {} })
  vm.runInContext(src + '\n;globalThis.__out = { CACHE, PRECACHE, RULES, routeFor }', ctx)
  assert.equal(ctx.__out.CACHE, 'gully-shell-v123')
  assert.deepEqual([...ctx.__out.PRECACHE], list)
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.__out.RULES)), SW_RULES)
  assert.deepEqual(Object.keys(listeners).sort(), ['activate', 'fetch', 'install', 'message'])
  // The worker's copy of the router agrees with the tested one.
  const r = ctx.__out.routeFor
  for (const [p, mode] of [['/assets/index-abcdef12.js', 'cors'], ['/', 'navigate'], ['/api/stats', 'cors'], ['/pay/x', 'navigate'], ['/admin', 'navigate'], ['/analytics', 'navigate']]) {
    assert.equal(r(SW_RULES, { url: ORIGIN + p, method: 'GET', mode, origin: ORIGIN }), route(p, { mode }), p)
  }
  // skipWaiting only on the page's message.
  listeners.message({ data: { type: 'nope' } })
  assert.equal(self.skipped, undefined)
  listeners.message({ data: { type: 'SKIP_WAITING' } })
  assert.equal(self.skipped, true)
})

test('generated worker: leaves /api, /pay and /admin requests alone (no respondWith) and answers hashed files and navigations', () => {
  const src = generateSw({ precache: ['/index.html'], version: 'v1' })
  const listeners = {}
  const self = { addEventListener: (t, f) => (listeners[t] = f), location: { origin: ORIGIN } }
  const ctx = vm.createContext({ self, URL, caches: { open: async () => ({ match: async () => undefined, put: () => {} }) }, fetch: async () => ({ ok: true, status: 200, clone() { return this } }), Request, Response })
  vm.runInContext(src, ctx)
  const handled = (path, mode = 'cors', headers = {}) => {
    let answered = false
    listeners.fetch({ request: { url: ORIGIN + path, method: 'GET', mode, headers: { has: (k) => k in headers } }, respondWith: () => (answered = true) })
    return answered
  }
  for (const p of ['/api/stats', '/api/developer/me', '/pay/abc', '/admin', '/api/pay/gas']) assert.equal(handled(p, 'navigate'), false, p)
  assert.equal(handled('/assets/index-abcdef12.js'), true)
  assert.equal(handled('/pricing', 'navigate'), true)
  assert.equal(handled('/assets/index-abcdef12.js', 'cors', { authorization: 'x' }), false)
})

test('install card: shown only with a prompt or on iOS Safari, never installed, never within 30 days of a dismissal', () => {
  const now = Date.UTC(2026, 9, 19)
  const base = { standalone: false, dismissedRaw: null, now, hasPrompt: true, ios: false }
  assert.equal(installCardMode(base), 'prompt')
  assert.equal(installCardMode({ ...base, hasPrompt: false }), null)
  assert.equal(installCardMode({ ...base, hasPrompt: false, ios: true }), 'ios')
  assert.equal(installCardMode({ ...base, standalone: true }), null)
  assert.equal(installCardMode({ ...base, hasPrompt: false, ios: true, standalone: true }), null)
  assert.equal(installCardMode({ ...base, dismissedRaw: String(now - 29 * 86_400_000) }), null)
  assert.equal(installCardMode({ ...base, dismissedRaw: String(now - 31 * 86_400_000) }), 'prompt')
  assert.equal(installCardMode({ ...base, hasPrompt: false, ios: true, dismissedRaw: String(now - 86_400_000) }), null)
})

test('dismissal: 30 days exactly, junk values count as not dismissed', () => {
  const now = 1_800_000_000_000
  assert.equal(dismissedRecently(String(now - 30 * 86_400_000 + 1), now), true)
  assert.equal(dismissedRecently(String(now - 30 * 86_400_000), now), false)
  for (const junk of [null, undefined, '', 'abc', '0', '-5']) assert.equal(dismissedRecently(junk, now), false, String(junk))
})

test('iOS Safari detection: Safari on iPhone and iPad, not Chrome or Firefox on iOS, not Android', () => {
  const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  assert.equal(isIosSafari(safari, 'iPhone', 5), true)
  assert.equal(isIosSafari(safari.replace('iPhone; CPU iPhone', 'iPad; CPU'), 'iPad', 5), true)
  // iPadOS 13+ reports a desktop Mac user agent with touch points.
  assert.equal(isIosSafari('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'MacIntel', 5), true)
  assert.equal(isIosSafari('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15', 'MacIntel', 0), false)
  assert.equal(isIosSafari(safari.replace('Version/17.5 Mobile/15E148 Safari/604.1', 'CriOS/126.0 Mobile/15E148 Safari/604.1'), 'iPhone', 5), false)
  assert.equal(isIosSafari(safari.replace('Version/17.5 Mobile/15E148 Safari/604.1', 'FxiOS/127.0 Mobile/15E148 Safari/605.1.15'), 'iPhone', 5), false)
  assert.equal(isIosSafari('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36', 'Linux armv8l', 5), false)
})
