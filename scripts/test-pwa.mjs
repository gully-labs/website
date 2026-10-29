// PWA end to end: the manifest per host, the service worker (registration, caching, offline), the install card
// and the update card, in a real Chromium against the built site (dist/) served by the real server in this process.
//
//   npm run build && npm run test:pwa        (TEST_PORT overrides the port, default 9361)
//
// The two hosts are reached the way the server tells them apart: manifests by Host header (gullylabs.xyz, app.gullylabs.xyz,
// admin.gullylabs.xyz); the browser runs on localhost, where the site is at / and the app at /app (a service worker needs
// a secure origin, and the production hosts' CSP upgrades http to https).
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { blockedOutbound, bootServer, DIST } from './e2e-harness.mjs'
import { guardTestRun, hostRequest, makeChecker, makeClient } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 9361
await guardTestRun(PORT, { watchdogMs: 5 * 60_000 })
const started = Date.now()
const t = makeChecker()
const { check } = t
const { base: BASE } = await bootServer({ port: PORT })
const browser = await chromium.launch({ headless: !process.env.E2E_HEADED })

// "A new build is deployed": dist/sw.js is rewritten with another version stamp (the real server serves it from disk on
// every request) and restored when the test ends, whatever happens. A route on the browser cannot do this: Playwright
// does not intercept the browser's own service worker update check.
const SW_FILE = path.join(DIST, 'sw.js')
const SW_ORIGINAL = fs.readFileSync(SW_FILE, 'utf8')
const restoreSw = () => fs.writeFileSync(SW_FILE, SW_ORIGINAL)
process.on('exit', restoreSw)
const deployNewBuild = (version) => fs.writeFileSync(SW_FILE, SW_ORIGINAL.replace(/const VERSION = "[^"]+"/, `const VERSION = "${version}"`))

const owner = makeClient(BASE)
check('a throwaway wallet signs in', (await owner.signIn(privateKeyToAccount(generatePrivateKey()))).status === 200)
const COOKIE = owner.cookie.split('=').slice(1).join('=')

/** A fresh browser context (own storage and service workers) that blocks everything off localhost. */
async function ctxFor({ width = 1440, height = 900, mobile = false, signedIn = false, userAgent } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}), ...(userAgent ? { userAgent } : {}), serviceWorkers: 'allow' })
  if (signedIn) await ctx.addCookies([{ name: 'gl_dev', value: COOKIE, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }])
  await ctx.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => route.abort('blockedbyclient'))
  return ctx
}
const errorsOf = (page) => {
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e?.message ?? e).slice(0, 200)))
  return errs
}
const swReady = (page) => page.evaluate(() => navigator.serviceWorker.ready.then((r) => !!r.active))
/** Waits until a worker controls the page: once it is active, one reload puts the page under it. */
async function controlled(page) {
  await swReady(page)
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload()
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10_000 })
}
const cacheUrls = (page) =>
  page.evaluate(async () => {
    const out = []
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname)
    return out
  })
const pngSize = (buf) => (buf.length > 24 && buf.toString('latin1', 1, 4) === 'PNG' ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : null)

const step = async (name, fn) => {
  // PWA_ONLY=<text> runs only the steps whose name contains it.
  if (process.env.PWA_ONLY && !name.includes(process.env.PWA_ONLY)) return
  try {
    await fn()
  } catch (e) {
    check(`${name} (${String(e?.message ?? e).split('\n')[0].slice(0, 200)})`, false, String(e?.stack ?? '').split('\n').slice(1, 4).join(' | '))
  }
}

/* ------------------------------------------------------------- manifests --- */

await step('manifests', async () => {
  const get = (host, p = '/manifest.json') => hostRequest(BASE, host, p)
  const site = await get('gullylabs.xyz')
  const app = await get('app.gullylabs.xyz')
  check('site manifest: 200, application/manifest+json, "Gully Labs", standalone, start_url /, scope /', site.status === 200 && /application\/manifest\+json/.test(site.headers['content-type']) && site.data?.name === 'Gully Labs' && site.data.display === 'standalone' && site.data.start_url === '/' && site.data.scope === '/')
  check('app manifest: 200, "Gully Labs App", standalone, start_url /, scope /', app.status === 200 && app.data?.name === 'Gully Labs App' && app.data.display === 'standalone' && app.data.start_url === '/' && app.data.scope === '/')
  check('the two manifests differ only by identity (name, short name, description), colours are the kit lab-night', site.data.theme_color === '#0D141C' && app.data.background_color === '#0D141C' && site.data.name !== app.data.name && site.data.short_name !== app.data.short_name)
  check('the .webmanifest path answers the same per host', (await get('app.gullylabs.xyz', '/manifest.webmanifest')).data?.name === 'Gully Labs App' && (await get('gullylabs.xyz', '/manifest.webmanifest')).data?.name === 'Gully Labs')
  check('localhost serves the site manifest', (await get('localhost')).data?.name === 'Gully Labs')
  check('admin and docs hosts serve no manifest (404)', (await get('admin.gullylabs.xyz')).status === 404 && (await get('docs.gullylabs.xyz')).status === 404)
  const purposes = (m) => m.icons.map((i) => `${i.sizes}:${i.purpose}`).join(',')
  check('both list 192 any, 512 any and 512 maskable icons', purposes(site.data) === '192x192:any,512x512:any,512x512:maskable' && purposes(app.data) === purposes(site.data), purposes(site.data))
  for (const [label, m] of [['site', site.data], ['app', app.data]]) {
    for (const icon of m.icons) {
      const r = await fetch(BASE + icon.src)
      const buf = Buffer.from(await r.arrayBuffer())
      const [w, h] = pngSize(buf) ?? []
      check(`${label} icon ${icon.src} (${icon.purpose}): 200 image/png, really ${icon.sizes}`, r.status === 200 && r.headers.get('content-type') === 'image/png' && `${w}x${h}` === icon.sizes, `${r.status} ${r.headers.get('content-type')} ${w}x${h}`)
    }
  }
  // The page links the manifest, and the browser can parse it.
  const ctx = await ctxFor()
  const page = await ctx.newPage()
  await page.goto(BASE + '/')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  const viaPage = await page.evaluate((h) => fetch(h).then((r) => r.json()), href)
  check('the home page links /manifest.json and it parses in the browser', href === '/manifest.json' && viaPage.name === 'Gully Labs')
  await ctx.close()
})

/* ------------------------------------------------------------- the worker file --- */

let swList = []
await step('worker file', async () => {
  const r = await fetch(BASE + '/sw.js')
  const src = await r.text()
  check('/sw.js: 200, JavaScript, revalidated (no-cache), version stamped', r.status === 200 && /javascript/.test(r.headers.get('content-type')) && /no-cache/.test(r.headers.get('cache-control')) && /const VERSION = "[0-9a-f]{10}"/.test(src), `${r.status} ${r.headers.get('content-type')} ${r.headers.get('cache-control')}`)
  swList = JSON.parse(src.match(/const PRECACHE = (.*)/)[1])
  check('the precache list holds the shell, the offline page and hashed assets', swList.includes('/index.html') && swList.includes('/errors/offline.html') && swList.some((u) => /^\/assets\/index-[\w-]{8}\.js$/.test(u)) && swList.some((u) => u.endsWith('.css')), `${swList.length} files`)
  check('the precache list names no API, pay or admin path', !swList.some((u) => /^\/(api|pay|admin|tg|embed)(\/|$)/.test(u)))
  let bad = []
  let bytes = 0
  for (const u of swList) {
    const f = await fetch(BASE + u)
    const b = await f.arrayBuffer()
    bytes += b.byteLength
    if (f.status !== 200) bad.push(`${f.status} ${u}`)
  }
  check(`every precached file is served 200 (${swList.length} files, ${Math.round(bytes / 1024)} KB)`, bad.length === 0, bad.slice(0, 3).join(' | '))
})

/* ------------------------------------------------------------- registration and caching --- */

await step('site and app register a worker; it caches the shell and never the API', async () => {
  for (const [label, url, signed] of [['site', '/', false], ['app', '/app', true]]) {
    const ctx = await ctxFor({ signedIn: signed })
    const page = await ctx.newPage()
    const errs = errorsOf(page)
    await page.goto(BASE + url)
    check(`${label}: a service worker registers at scope /`, (await swReady(page)) === true && (await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => new URL(r.scope).pathname))) === '/')
    await controlled(page)
    await page.waitForLoadState('networkidle').catch(() => undefined)
    const urls = await cacheUrls(page)
    check(`${label}: the shell and the entry chunk are in the cache`, urls.includes('/index.html') && urls.some((u) => /^\/assets\/index-[\w-]{8}\.js$/.test(u)))
    check(`${label}: nothing under /api, /pay, /admin, /tg or /embed was cached`, !urls.some((u) => /^\/(api|pay|admin|tg|embed)(\/|$)/.test(u)), urls.filter((u) => /^\/(api|pay|admin)/.test(u)).join(' '))
    // The page itself calls the API; the worker must not have answered it.
    const viaSw = await page.evaluate(() => fetch('/api/plans').then((r) => r.status))
    check(`${label}: an /api call still reaches the server`, viaSw === 200)
    check(`${label}: no uncaught page errors`, errs.length === 0, errs.join(' | '))
    await ctx.close()
  }
})

await step('admin and pay pages are not controlled and register nothing', async () => {
  // Fresh contexts: no worker from a visit elsewhere.
  for (const url of ['/admin', '/pay/does-not-exist', '/pay/l/does-not-exist', '/tg']) {
    const ctx = await ctxFor()
    const page = await ctx.newPage()
    await page.goto(BASE + url)
    await page.waitForLoadState('load')
    await page.waitForTimeout(1500)
    const regs = await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))
    check(`${url}: no service worker registered`, regs === 0, `${regs} registrations`)
    await ctx.close()
  }
  // A worker registered by the home page still leaves these alone: the network answers them, never the worker.
  const ctx = await ctxFor()
  const page = await ctx.newPage()
  await page.goto(BASE + '/')
  await controlled(page)
  const fromSw = async (url) => {
    const p = await ctx.newPage()
    let r
    try {
      r = await p.goto(BASE + url)
    } catch {
      /* offline errors are not used here */
    }
    const v = r ? r.fromServiceWorker() : null
    await p.close()
    return v
  }
  check('with the worker active: /pricing is answered by it (network-first)', (await fromSw('/pricing')) === true)
  for (const u of ['/pay/does-not-exist', '/admin', '/api/plans']) check(`with the worker active: ${u} is not touched by it`, (await fromSw(u)) === false)
  await ctx.close()
})

/* ------------------------------------------------------------- offline --- */

await step('offline', async () => {
  const ctx = await ctxFor()
  const page = await ctx.newPage()
  await page.goto(BASE + '/')
  await controlled(page)
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await ctx.setOffline(true)
  // A page the visitor never opened: the cached shell renders it.
  await page.goto(BASE + '/pricing')
  await page.locator('#root > *').first().waitFor({ timeout: 15_000 })
  const shown = await page.evaluate(() => ({ title: document.title, kids: document.querySelector('#root').children.length, h1: document.querySelector('h1')?.textContent ?? '' }))
  check('offline: navigating to /pricing shows the app shell from the cache', shown.kids > 0 && /Gully Labs/.test(shown.title), JSON.stringify(shown))
  const hs = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  check('offline: the shell has no horizontal scroll', hs)
  // Never served from the cache: a pay page and an API call fail offline.
  const failsOffline = async (url) => {
    const p = await ctx.newPage()
    const failed = await p.goto(BASE + url).then(() => false, () => true)
    await p.close()
    return failed
  }
  check('offline: a /pay page is not served from any cache', await failsOffline('/pay/does-not-exist'))
  check('offline: /admin is not served from any cache', await failsOffline('/admin'))
  check('offline: an /api call is not served from any cache', await page.evaluate(() => fetch('/api/plans').then(() => false, () => true)))
  // The offline page, when the shell is gone from the cache (storage cleared by the browser).
  await ctx.setOffline(false)
  await page.evaluate(async () => {
    for (const k of await caches.keys()) await (await caches.open(k)).delete('/index.html')
  })
  await ctx.setOffline(true)
  await page.goto(BASE + '/services')
  await page.getByRole('heading', { name: 'You are offline' }).waitFor({ timeout: 10_000 })
  check('offline without a cached shell: the kit-style offline page shows, with a Try again link', (await page.getByRole('link', { name: 'Try again' }).count()) === 1 && (await page.locator('svg[data-brand="kit"]').count()) === 1)
  await ctx.close()
})

/* ------------------------------------------------------------- install card --- */

const fireInstallPrompt = (page) =>
  page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true })
    e.prompt = async () => {
      window.__prompted = (window.__prompted ?? 0) + 1
    }
    e.userChoice = Promise.resolve({ outcome: 'accepted' })
    window.dispatchEvent(e)
  })
const installCard = (page) => page.getByTestId('pwa-install-card')

await step('install card on the site', async () => {
  const ctx = await ctxFor()
  const page = await ctx.newPage()
  const errs = errorsOf(page)
  await page.goto(BASE + '/')
  await page.waitForTimeout(3600)
  check('no install card without a browser prompt (and not on a desktop browser that never offered one)', (await installCard(page).count()) === 0)
  await fireInstallPrompt(page)
  await installCard(page).waitFor({ timeout: 8000 })
  check('the install card reads "Install Gully Labs" with an Install button and a dismiss', (await installCard(page).textContent()).includes('Install Gully Labs') && (await page.getByTestId('pwa-install').isVisible()) && (await page.getByTestId('pwa-dismiss').isVisible()))
  await page.getByTestId('pwa-install').click()
  check('Install shows the browser prompt, then the card goes', (await page.evaluate(() => window.__prompted)) === 1 && (await installCard(page).count()) === 0)
  // Dismiss: remembered for 30 days.
  await fireInstallPrompt(page)
  await installCard(page).waitFor({ timeout: 8000 })
  await page.getByTestId('pwa-dismiss').click()
  check('the X closes the card and stores a timestamp', (await installCard(page).count()) === 0 && /^\d{13}$/.test((await page.evaluate(() => localStorage.getItem('gl-pwa-install-dismissed'))) ?? ''))
  await page.reload()
  await fireInstallPrompt(page)
  await page.waitForTimeout(3600)
  check('dismissed: the card stays away after a reload (30 days)', (await installCard(page).count()) === 0)
  await page.evaluate(() => localStorage.setItem('gl-pwa-install-dismissed', String(Date.now() - 31 * 86_400_000)))
  await page.reload()
  await fireInstallPrompt(page)
  await installCard(page).waitFor({ timeout: 8000 })
  check('a dismissal older than 30 days no longer counts', await installCard(page).isVisible())
  await ctx.close()
  // Already installed: standalone display mode.
  const sctx = await ctxFor()
  await sctx.addInitScript(() => {
    const real = window.matchMedia.bind(window)
    window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } : real(q))
  })
  const sp = await sctx.newPage()
  await sp.goto(BASE + '/')
  await fireInstallPrompt(sp)
  await sp.waitForTimeout(3600)
  check('installed (display-mode: standalone): no install card', (await installCard(sp).count()) === 0)
  await sctx.close()
  check('the install card step threw no page errors', errs.length === 0, errs.join(' | '))
})

await step('install card in the app', async () => {
  const ctx = await ctxFor({ signedIn: true })
  const page = await ctx.newPage()
  await page.goto(BASE + '/app')
  await page.getByRole('navigation', { name: 'App pages' }).waitFor()
  await fireInstallPrompt(page)
  await installCard(page).waitFor({ timeout: 8000 })
  check('the app\'s install card reads "Install the app"', (await installCard(page).textContent()).includes('Install the app') && !(await installCard(page).textContent()).includes('Install Gully Labs'))
  await ctx.close()
})

await step('install card on iOS Safari', async () => {
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  const ctx = await ctxFor({ width: 390, height: 844, mobile: true, userAgent: UA })
  const page = await ctx.newPage()
  await page.goto(BASE + '/')
  await installCard(page).waitFor({ timeout: 8000 })
  const steps = page.getByTestId('pwa-ios-steps')
  check('iOS Safari: "Share → Add to Home Screen" instructions with the Share and Add icons, no Install button', (await installCard(page).getAttribute('data-mode')) === 'ios' && /Share/.test(await steps.textContent()) && /Add to Home Screen/.test(await steps.textContent()) && /→/.test(await steps.textContent()) && (await steps.locator('svg').count()) === 2 && (await page.getByTestId('pwa-install').count()) === 0)
  await page.getByTestId('pwa-dismiss').click()
  check('iOS: the X closes it', (await installCard(page).count()) === 0)
  await ctx.close()
  // Chrome on iOS cannot add to the Home Screen the Safari way: no card.
  const cctx = await ctxFor({ width: 390, height: 844, mobile: true, userAgent: UA.replace('Version/17.5 Mobile/15E148 Safari/604.1', 'CriOS/126.0 Mobile/15E148 Safari/604.1') })
  const cp = await cctx.newPage()
  await cp.goto(BASE + '/')
  await cp.waitForTimeout(3600)
  check('iOS Chrome: no card', (await installCard(cp).count()) === 0)
  await cctx.close()
})

/* ------------------------------------------------------------- update card --- */

await step('update card', async () => {
  const ctx = await ctxFor()
  const page = await ctx.newPage()
  const errs = errorsOf(page)
  await page.goto(BASE + '/')
  await controlled(page)
  await page.waitForTimeout(1200)
  check('the very first install shows no update card', (await page.getByTestId('pwa-update-card').count()) === 0)
  const before = await page.evaluate(() => caches.keys())
  // A new build: the same worker with another version stamp, served from now on.
  deployNewBuild('e2e-next')
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()))
  const card = page.getByTestId('pwa-update-card')
  await card.waitFor({ timeout: 15_000 })
  check('a waiting worker shows "New version available · Reload"', /New version available\s*·\s*Reload/.test((await card.textContent()).replace(/\s+/g, ' ')))
  check('the old build\'s cache is still there while the new worker waits (it did not skip waiting by itself)', (await page.evaluate(() => caches.keys())).length === before.length + 1)
  let navigations = 0
  page.on('framenavigated', (f) => f === page.mainFrame() && navigations++)
  await page.getByTestId('pwa-reload').click()
  await page.waitForFunction(() => navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL.includes('/sw.js'), null, { timeout: 15_000 })
  await page.waitForLoadState('load')
  await page.waitForTimeout(1500)
  check('Reload reloads the page exactly once', navigations === 1, `${navigations} navigations`)
  const keys = await page.evaluate(() => caches.keys())
  check('the new worker is active and the old cache was cleaned on activate', keys.length === 1 && keys[0] === 'gully-shell-e2e-next', keys.join(','))
  check('the update card is gone after the reload', (await page.getByTestId('pwa-update-card').count()) === 0)
  check('the update step threw no page errors', errs.length === 0, errs.join(' | '))
  await ctx.close()
})

/* ------------------------------------------------------------- layout --- */

const box = (loc) => loc.boundingBox()
const overlap = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const hscroll = (page) => page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])

await step('layout at 390 px', async () => {
  // Site: the install card, then the update card, beside the dock (Back to top and Gully AI).
  const ctx = await ctxFor({ width: 390, height: 844, mobile: true })
  const page = await ctx.newPage()
  await page.goto(BASE + '/')
  const fab = page.getByTestId('ask-fab')
  await fab.waitFor({ timeout: 10_000 })
  await fireInstallPrompt(page)
  await installCard(page).waitFor({ timeout: 8000 })
  await page.waitForTimeout(400)
  let c = await box(installCard(page))
  let f = await box(fab)
  check('site 390: the install card is inside the viewport and does not overlap the Gully AI button', c.x >= 0 && c.x + c.width <= 390 && c.y >= 0 && c.y + c.height <= 844 && !overlap(c, f), `card ${JSON.stringify(c)} fab ${JSON.stringify(f)}`)
  check('site 390: the install card is compact (one row)', c.height <= 72, `${Math.round(c.height)} px`)
  let [sw, vw] = await hscroll(page)
  check('site 390: no horizontal scroll with the install card', sw <= vw, `${sw} / ${vw}`)
  // Scroll to the bottom: the dock's Back to top appears; still no overlap.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(600)
  const btt = page.getByTestId('corner-dock').locator('button, a')
  const dockBoxes = []
  for (const el of await btt.all()) if (await el.isVisible()) dockBoxes.push(await box(el))
  c = await box(installCard(page))
  check('site 390: the card clears every control in the dock after scrolling down', dockBoxes.length >= 1 && dockBoxes.every((d) => !overlap(c, d)), JSON.stringify({ c, dockBoxes }))
  await page.getByTestId('pwa-dismiss').click()
  // The update card takes the same slot.
  deployNewBuild('e2e-layout')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await controlled(page)
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()))
  await page.getByTestId('pwa-update-card').waitFor({ timeout: 15_000 })
  c = await box(page.getByTestId('pwa-update-card'))
  f = await box(fab)
  ;[sw, vw] = await hscroll(page)
  check('site 390: the update card is inside the viewport, clear of the Gully AI button, no horizontal scroll', c.x >= 0 && c.x + c.width <= 390 && !overlap(c, f) && sw <= vw, `card ${JSON.stringify(c)} fab ${JSON.stringify(f)} scroll ${sw}/${vw}`)
  await ctx.close()

  // App: the tab bar and the Gully AI button sit at the bottom; the card sits above both.
  const actx = await ctxFor({ width: 390, height: 844, mobile: true, signedIn: true })
  const ap = await actx.newPage()
  await ap.goto(BASE + '/app')
  const afab = ap.getByTestId('ask-fab')
  await afab.waitFor({ timeout: 15_000 })
  await ap.getByTestId('tab-bar').waitFor()
  await fireInstallPrompt(ap)
  await installCard(ap).waitFor({ timeout: 8000 })
  await ap.waitForTimeout(400)
  c = await box(installCard(ap))
  f = await box(afab)
  const tabs = await box(ap.getByTestId('tab-bar'))
  ;[sw, vw] = await hscroll(ap)
  check('app 390: the install card clears the Gully AI button and the tab bar, inside the viewport, no horizontal scroll', c.x >= 0 && c.x + c.width <= 390 && !overlap(c, f) && !overlap(c, tabs) && sw <= vw, `card ${JSON.stringify(c)} fab ${JSON.stringify(f)} tabs ${JSON.stringify(tabs)}`)
  await actx.close()

  // Desktop widths too.
  for (const [w, h] of [[1440, 900], [768, 1024]]) {
    const dctx = await ctxFor({ width: w, height: h })
    const dp = await dctx.newPage()
    await dp.goto(BASE + '/')
    await dp.getByTestId('ask-fab').waitFor({ timeout: 10_000 })
    await fireInstallPrompt(dp)
    await installCard(dp).waitFor({ timeout: 8000 })
    await dp.waitForTimeout(400)
    const dc = await box(installCard(dp))
    const df = await box(dp.getByTestId('ask-fab'))
    const [dsw, dvw] = await hscroll(dp)
    check(`site ${w}: the install card clears the Gully AI button, no horizontal scroll`, !overlap(dc, df) && dsw <= dvw, `card ${JSON.stringify(dc)} fab ${JSON.stringify(df)}`)
    await dctx.close()
  }
})

check('the server made no unexpected outbound calls', blockedOutbound.filter((u) => !/localhost|127\.0\.0\.1/.test(u)).every((u) => /dexscreener|geckoterminal|rpc\.|arbitrum|base|drpc|publicnode|ordofi|blastapi|robinhood|binance|bsc|llama|peddle|solana|xstocks|jup\.ag|e2e\.invalid/i.test(u)), blockedOutbound.slice(0, 3).join(' | '))
await browser.close()
const secs = Math.round((Date.now() - started) / 1000)
console.log(`\n${t.passed} passed, ${t.failed} failed (${secs} s)`)
process.exit(t.failed ? 1 : 0)
