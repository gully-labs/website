// End-to-end suite: the built site (dist/) served by the real server IN THIS PROCESS, driven with Playwright.
//
//   npm run build && npm run test:e2e        (TEST_PORT overrides the port, default 8792; E2E_HEADED=1 shows it)
//
// Deterministic: a temporary DATA_DIR, every outbound call the server makes stubbed (scripts/e2e-harness.mjs),
// and every request the browser makes off localhost routed (fixtures) or aborted. Wallets are throwaway
// viem keys signed in with SIWE as scripts/test-siwe.mjs does; the session cookie is handed to the browser.
//
// Every page visit asserts: no console errors, no uncaught exceptions, no CSP violations, no 4xx/5xx except
// the ones a step expects; at 390 px wide, no horizontal scroll.

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import zlib from 'node:zlib'
import { chromium } from 'playwright'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { blockedOutbound, bootServer, E2E_ANY_TOKEN, E2E_LAUNCH_TOKEN, E2E_NOT_A_TOKEN, historyFixture, holdersExtraFixtures, holdersFixture, ROOT, SAFE_FIXTURE, seedTrackerHistory, signedInitData, statsFixture, telegramSdkStub, trackerFixture, TREASURY_DEPLOYED_CHAINS, TREASURY_UNDEPLOYED_CHAINS } from './e2e-harness.mjs'
import { makeChecker, makeClient, guardTestRun } from './test-helpers.mjs'
import { auditPage, tokenColors } from './e2e-audit.mjs'
import { clippedIn } from './holders-clip.mjs'
import { busyFixture, solanaFixture, SOLANA_TOKEN } from './holders-shots-fixtures.mjs'

const PORT = Number(process.env.TEST_PORT) || 8792
// E2E_WATCHDOG_MS (or E2E_WATCHDOG_MIN) raises the limit when the machine is busy (other builds running); the default stays 8 minutes.
await guardTestRun(PORT, { watchdogMs: Number(process.env.E2E_WATCHDOG_MS) || (Number(process.env.E2E_WATCHDOG_MIN) || 8) * 60_000 })
const started = Date.now()
const t = makeChecker()
const { check } = t
process.env.GULLY_ALLOW_LOOPBACK_WEBHOOKS = '1'
const { admin, base: BASE } = await bootServer({ port: PORT })
const TRACKER = trackerFixture()
await seedTrackerHistory(TRACKER)
const STATS = statsFixture()
const WIDGET_JS = fs.readFileSync(path.join(ROOT, 'dist', 'widget.js'))
// What Gully Pay offers here, read from the server itself (the harness's chain matrix: the treasury Safe is deployed on
// some payment chains and not yet on others, and the deployment gate closes the latter).
const PLANS = await (await fetch(`${BASE}/api/plans`)).json()
const OFFERED = PLANS.chains.map((c) => c.name)
const CLOSED = { 10: 'OP Mainnet', 137: 'Polygon', 43114: 'Avalanche' }
const listOr = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}` : (xs[0] ?? ''))

/* ------------------------------------------------------------- browser plumbing --- */

const browser = await chromium.launch({ headless: !process.env.E2E_HEADED })
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
const QUOTE = { chain: 'robinhood', ticker: 'NVDA', pay: { symbol: 'ETH', amount: '0.1' }, out: { symbol: 'NVDA', amount: '1.84', minimum: '1.82' }, priceImpactPct: 0.21, slippagePct: 0.5, fee: { pct: 0.3, amount: '0.0003', symbol: 'ETH', exempt: false }, onDeepcorePool: true, route: { venues: ['DeepCore'], hops: [{ venue: 'DeepCore', from: 'ETH', to: 'NVDA' }] }, alternatives: [], quotedAt: new Date().toISOString(), links: { swap: 'https://deepcore.fun/swap', token: 'https://deepcore.fun/token' } }

// The DeepCore launch list as GET /api/deepcore/launches answers it (the poller is off in e2e).
const LAUNCHES = (() => {
  // One list for the app's DeepCore page and band and the site's launch list with Holder Maps: the newest
  // launch is the harness's DTC on Robinhood Chain (its Holder Map fixture), then eleven more.
  const chains = [[4663, 'Robinhood Chain', 'robinhood'], [56, 'BNB Chain', 'bsc'], [8453, 'Base', 'base']]
  const launches = Array.from({ length: 12 }, (_, i) => {
    const [chainId, chainName, chainKey] = chains[i % 3]
    const token = i === 0 ? E2E_LAUNCH_TOKEN : '0x' + (i + 1).toString(16).padStart(40, 'a')
    return { key: `${chainId}:${token}`, chainId, chainKey, chainName, token, symbol: i === 0 ? 'DTC' : `E2E${i}`, locked: i % 2 === 0, createdAt: new Date(Date.now() - i * 5 * 3600_000).toISOString(), txHash: null, creator: null, startsAt: null, totalSupply: null, legs: [{ poolId: null, kind: 'CL', quote: 'WETH', locked: i % 2 === 0, lockId: null, feePct: 1, quoteAddress: null }], links: { token: `https://deepcore.fun/tokens/${token}`, launch: `https://deepcore.fun/app/launch/v2/${token}`, swap: 'https://deepcore.fun/app/swap' } }
  })
  return { state: 'ok', launches, asOf: new Date().toISOString(), chains: chains.map(([chainId, name]) => ({ chainId, name, status: 'ok', total: 4 })), error: null, pollSeconds: 90 }
})()
// E2E_SHOTS=<dir> saves screenshots of the app pages and the Gully AI launcher there.
const SHOTS = process.env.E2E_SHOTS || null
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const shot = async (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false })

/** Gully AI's launcher: the floating button opens the panel, Escape closes it, Ctrl+K toggles it. */
async function launcherWorks(page, label) {
  const fab = page.getByTestId('ask-fab')
  await fab.waitFor({ timeout: 10_000 })
  await fab.click()
  const dlg = page.getByRole('dialog', { name: 'Gully AI' })
  await dlg.waitFor()
  check(`${label}: the Gully AI button opens the panel`, await dlg.isVisible())
  await dlg.getByPlaceholder('How do gap alerts work?').waitFor({ timeout: 10_000 })
  await page.keyboard.press('Escape')
  await dlg.waitFor({ state: 'hidden' })
  await page.keyboard.press('Control+k')
  await dlg.waitFor({ timeout: 5_000 })
  check(`${label}: Ctrl+K opens Gully AI`, await dlg.isVisible())
  await page.keyboard.press('Control+k')
  await dlg.waitFor({ state: 'hidden', timeout: 5_000 })
  check(`${label}: Ctrl+K again closes it`, true)
  await page.keyboard.press('Meta+k')
  await dlg.waitFor({ timeout: 5_000 })
  check(`${label}: ⌘K opens Gully AI`, await dlg.isVisible())
  await page.keyboard.press('Escape')
  await dlg.waitFor({ state: 'hidden', timeout: 5_000 })
}


/** The bubble map's look and motion (v3): lit fills, a legend, a labelled biggest bubble, the supply strip, drift and a quiet main thread. */
async function bubbleLook(page, map, label, { kindRe = /^(pool|wallet|contract|lock|burn|exchange|deployer|token|DeepCore|Gully|router|known)/, quiet = false } = {}) {
  const chart = map.locator('[data-bubble-canvas]')
  await chart.scrollIntoViewIfNeeded()
  await page.waitForFunction(() => document.querySelector('[data-bubble-canvas]')?.getAttribute('data-big'), null, { timeout: 15_000 })
  await page.waitForTimeout(1800)
  const big = JSON.parse((await chart.getAttribute('data-big')) ?? '{}')
  check(`${label}: the biggest bubble says what it is (${big.label})`, kindRe.test(big.label ?? '') && /\d/.test(big.label ?? '') && big.shown === true, JSON.stringify(big))
  // Fills, not outlines: the middle of the biggest bubble is opaque and lit from the top left (its highlight side is lighter than its far edge).
  const px = await page.evaluate(({ x, y, r }) => {
    const c = document.querySelector('[data-bubble-canvas] canvas')
    const k = c.width / c.clientWidth
    const g = c.getContext('2d')
    const at = (dx, dy) => Array.from(g.getImageData(Math.round((x + dx) * k), Math.round((y + dy) * k), 1, 1).data)
    return { hi: at(-r * 0.45, -r * 0.5), lo: at(r * 0.6, r * 0.6) }
  }, big)
  const lum = (p) => p[0] * 0.3 + p[1] * 0.59 + p[2] * 0.11
  check(`${label}: bubbles are filled spheres, not outlines (opaque, lit)`, px.hi[3] > 200 && px.lo[3] > 200 && lum(px.hi) > lum(px.lo) + 8, JSON.stringify(px))
  check(`${label}: the legend is present with colour swatches`, (await map.locator('[data-legend] li').count()) >= 4 && (await map.locator('[data-legend] li span[aria-hidden]').count()) >= 4)
  const strip = map.locator('[data-supply-strip]')
  await strip.scrollIntoViewIfNeeded()
  await page.waitForTimeout(1300)
  const widths = await strip.locator('[data-supply-seg]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
  check(`${label}: the supply strip renders as an animated stacked bar (${widths.length} segments)`, widths.length >= 2 && widths.filter((w) => w > 2).length >= 2, JSON.stringify(widths))
  check(`${label}: the biggest-holders list shows logos and kinds`, (await strip.locator('[data-holder-leaders] li').count()) >= 5 && (await strip.locator('[data-holder-leaders] li').first().textContent()).length > 5)
  await chart.scrollIntoViewIfNeeded()
  await page.evaluate(() => {
    window.__long = []
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] })
  })
  const a = await page.evaluate(() => document.querySelector('[data-bubble-canvas] canvas').toDataURL().length + ':' + document.querySelector('[data-bubble-canvas] canvas').toDataURL().slice(-400))
  await page.waitForTimeout(2000)
  const b = await page.evaluate(() => document.querySelector('[data-bubble-canvas] canvas').toDataURL().length + ':' + document.querySelector('[data-bubble-canvas] canvas').toDataURL().slice(-400))
  check(`${label}: the map animates (pixels change over 2 s)`, a !== b)
  if (quiet) {
    await page.waitForTimeout(1500)
    const long = await page.evaluate(() => window.__long)
    check(`${label}: no long task over 50 ms while idle (${long.length} seen, frame ${await chart.getAttribute('data-frame-ms')} ms)`, long.every((d) => d <= 50) && Number(await chart.getAttribute('data-frame-ms')) < 16, JSON.stringify(long))
  }
}

/** A context with every off-localhost request routed: Gully's own hosts to fixtures, the rest aborted. */
async function newContext({ width = 1440, height = 900, mobile = false, geo = { country: 'GB', allowed: true, reason: 'ok' }, cookie = null, announce = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}), permissions: ['clipboard-read', 'clipboard-write'], serviceWorkers: 'block' })
  if (cookie) await ctx.addCookies([{ name: 'gl_dev', value: cookie, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }])
  // The Holder Map announcement bar is dismissed in every context except the ones that test it (announce: true).
  if (!announce) await ctx.addInitScript(() => { try { localStorage.setItem('gl-announce-holder-map', '1') } catch { /* no storage */ } })
  await ctx.addInitScript(() => {
    window.__csp = []
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`))
  })
  await ctx.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => {
    const u = new URL(route.request().url())
    if (u.hostname === 'gullylabs.xyz' && u.pathname === '/widget.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: WIDGET_JS })
    // The widget's credit shows the brand kit's mark from our origin (public/brand): served from the build here.
    if (u.hostname === 'gullylabs.xyz' && /^\/brand\/[\w.-]+\.png$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(path.join(ROOT, 'dist', u.pathname.slice(1))) })
    if (u.hostname === 'gullylabs.xyz' && u.pathname === '/api/tracker') return json(route, TRACKER)
    if (u.hostname === 'gullylabs.xyz' && u.pathname === '/api/tracker/history') return json(route, historyFixture(u.searchParams.get('chain'), u.searchParams.get('ticker')))
    if (u.hostname === 'analytics.gullylabs.xyz') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* analytics stubbed in e2e */' })
    return route.abort('blockedbyclient')
  })
  // Same-origin API answers that would otherwise read live upstreams.
  await ctx.route(`${BASE}/api/tracker`, (route) => json(route, TRACKER))
  await ctx.route(`${BASE}/api/stats`, (route) => json(route, STATS))
  await ctx.route(`${BASE}/api/geo`, (route) => json(route, geo))
  await ctx.route(new RegExp(`^${BASE}/api/deepcore/quote`), (route) => json(route, { quote: QUOTE, cached: false }))
  await ctx.route(new RegExp(`^${BASE}/api/deepcore/launches`), (route) => json(route, LAUNCHES))
  await ctx.route(new RegExp(`^${BASE}/api/pay/price`), (route) => json(route, { asset: 'base-eth', price: (2500 + Math.random()).toFixed(2), updatedAt: new Date().toISOString() }))
  // Holder Maps (server/holders.mjs reads DeepCore, Blockscout and RPCs): a launch for addresses, a stock for tickers.
  await ctx.route(new RegExp(`^${BASE}/api/holders/[^/]+/[^/.]+$`), (route) => json(route, holdersFixture(/\/0x[0-9a-f]{40}$/i.test(new URL(route.request().url()).pathname) ? 'deepcore-launch' : 'stock')))
  await ctx.route(`${BASE}/api/holders/base/${E2E_ANY_TOKEN}`, (route) => json(route, holdersFixture('token')))
  const HX = holdersExtraFixtures()
  await ctx.route(new RegExp(`^${BASE}/api/holders/resolve`), (route) => json(route, HX.resolve(new URL(route.request().url()).searchParams.get('q') ?? '')))
  await ctx.route(`${BASE}/api/holders/launches`, (route) => json(route, HX.launches))
  await ctx.route(new RegExp(`^${BASE}/api/holders/top`), (route) => json(route, HX.top))
  await ctx.route(new RegExp(`^${BASE}/api/holders/[^/]+/[^/]+/live`), (route) => json(route, HX.live))
  await ctx.route(new RegExp(`^${BASE}/api/holders/[^/]+/[^/]+/wallet/`), (route) => json(route, HX.wallet))
  return ctx
}

/** Watches one page: console errors, page errors, failed responses (minus `expect`ed ones), CSP reports. */
function watch(page, label) {
  const issues = []
  const expected = []
  page.on('console', (m) => m.type() === 'error' && issues.push(`console: ${m.text().slice(0, 220)}`))
  page.on('pageerror', (e) => issues.push(`pageerror: ${String(e?.message ?? e).slice(0, 220)}`))
  page.on('response', (r) => {
    const u = r.url()
    if (r.status() >= 400 && u.startsWith(BASE) && !expected.some((re) => re.test(u))) issues.push(`HTTP ${r.status()} ${u.replace(BASE, '')}`)
  })
  return {
    expect: (re) => expected.push(re),
    /** Runs the end-of-step assertions for this page. `allow` filters known, explained console noise. */
    async verify(allow = []) {
      const csp = await page.evaluate(() => window.__csp ?? []).catch(() => [])
      const bad = [...issues.filter((i) => !allow.some((re) => re.test(i))), ...csp.map((c) => `CSP: ${c}`)]
      // A console line for an expected 4xx is the browser reporting it, not a fault of the page.
      const left = bad.filter((i) => !(i.startsWith('console: Failed to load resource') && expected.length))
      check(`${label}: no console errors, CSP violations or unexpected 4xx/5xx`, left.length === 0, left.slice(0, 4).join(' | '))
      issues.length = 0
    },
  }
}

/** True once an ECharts chart inside `sel` has drawn (the kit fades the chart in over its skeleton). */
const drawnIn = (page, sel) => page.locator(`${sel} [data-chart].opacity-100 svg`).first().waitFor({ timeout: 15_000 }).then(() => true, () => false)
const TOKENS = tokenColors()
/** The pixel-pass design audit (scripts/e2e-audit.mjs): text size, token colours, external links. */
async function designAudit(page, label, root = null) {
  const a = await page.evaluate(auditPage, { allowed: TOKENS, root })
  check(`${label}: no text under 11 px`, a.small.length === 0, a.small.slice(0, 3).map((s) => `${s.size}px ${s.sel} "${s.text}"`).join(' | '))
  check(`${label}: no off-token colours`, a.offToken.length === 0, a.offToken.slice(0, 4).map((o) => `${o.color} ${o.kind} x${o.count} ${o.sample}`).join(' | '))
  check(`${label}: links to other hosts open in a new tab with noopener`, a.ext.length === 0, a.ext.slice(0, 3).map((e) => `${e.href} ${e.sel}`).join(' | '))
}

async function noHorizontalScroll(page, label) {
  // On a failure, name the element that sticks out furthest, so the fix is obvious from the log.
  const w = await page.evaluate(() => {
    const vw = window.innerWidth
    let worst = null
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.right > vw + 0.5 && (!worst || r.right > worst.right)) worst = { right: Math.round(r.right), tag: el.tagName.toLowerCase(), cls: String(el.className?.baseVal ?? el.className ?? '').slice(0, 80), text: (el.textContent ?? '').trim().slice(0, 40) }
    }
    return [document.documentElement.scrollWidth, vw, worst]
  })
  check(`${label}: no horizontal scroll at ${w[1]} px`, w[0] <= w[1], `scrollWidth ${w[0]}${w[2] ? ` · widest: <${w[2].tag} class="${w[2].cls}"> "${w[2].text}" right ${w[2].right}` : ''}`)
}

const step = async (name, fn) => {
  // E2E_ONLY=<text> runs only the steps whose name contains it (a quick run of one area).
  if (process.env.E2E_ONLY && !name.includes(process.env.E2E_ONLY)) return
  try {
    await fn()
  } catch (e) {
    // The failing line of this file, so a timeout names the step it stopped at.
    const at = String(e?.stack ?? '').match(/e2e\.mjs:(\d+)/)?.[1]
    const msg = String(e?.message ?? e)
    check(`${name} (${msg.split('\n')[0].slice(0, 200)}${at ? ` at e2e.mjs:${at}` : ''})`, false, msg.split('\n').slice(1, 6).join(' | ').slice(0, 400))
  }
}

/* ------------------------------------------------------------- wallets --- */

const owner = privateKeyToAccount(generatePrivateKey())
const mate = privateKeyToAccount(generatePrivateKey())
const api = makeClient(BASE)
const api2 = makeClient(BASE)
check('a throwaway wallet signs in with SIWE', (await api.signIn(owner)).status === 200)
check('a second wallet signs in', (await api2.signIn(mate)).status === 200)
const cookieOf = (c) => c.cookie.split('=').slice(1).join('=')

/* ------------------------------------------------------------- landing --- */

await step('landing', async () => {
  const ctx = await newContext()
  const page = await ctx.newPage()
  const w = watch(page, 'landing 1440')
  await page.goto(BASE + '/')
  await page.locator('#ledger').scrollIntoViewIfNeeded()
  const venues = page.getByRole('group', { name: 'Venues in the chart' })
  const dc = venues.getByRole('button', { name: 'DeepCore', exact: true })
  await dc.waitFor()
  const before = await dc.getAttribute('aria-pressed')
  await dc.click()
  check('ledger: a venue toggle flips', (await dc.getAttribute('aria-pressed')) !== before)
  const seven = page.locator('#ledger').getByRole('group', { name: 'Range' }).getByRole('button', { name: '7D' })
  if (await seven.count()) {
    await seven.click()
    check('ledger: the 7D range applies', (await seven.getAttribute('aria-pressed')) === 'true')
  }
  check('ledger: an unreadable venue says so, not zero', (await page.locator('#ledger').getByText(/unreadable|could not be read|PeddleQuest/i).count()) > 0)
  // Product console: every tab selects and moves the hash.
  const tabs = page.getByRole('tablist', { name: 'Products' }).getByRole('tab')
  await page.locator('#products').scrollIntoViewIfNeeded()
  const n = await tabs.count()
  let ok = 0
  for (let i = 0; i < n; i++) {
    await tabs.nth(i).click()
    if ((await tabs.nth(i).getAttribute('aria-selected')) === 'true') ok++
  }
  check(`console: all ${n} product tabs select`, n >= 8 && ok === n, `${ok}/${n}`)
  check('console: the hash follows the tab', /#\w+/.test(page.url()))
  // Projects sort.
  await page.locator('#projects').scrollIntoViewIfNeeded()
  await page.getByRole('group', { name: 'Sort the projects by' }).getByRole('button', { name: /^TVL/ }).click()
  check('projects: sort by TVL', (await page.getByText('Sorted by value locked, largest first').count()) > 0)
  // Pricing switch.
  await page.locator('#pricing').scrollIntoViewIfNeeded()
  await page.locator('#price-tab-analytics').click()
  check('pricing: Gully Analytics plans show', await page.locator('#price-panel').getByText(/Starter/).first().waitFor({ timeout: 8_000 }).then(() => true, () => false))
  await page.locator('#price-tab-services').click()
  check('pricing: services are quoted', await page.locator('#price-panel').getByText('Quoted').first().waitFor({ timeout: 8_000 }).then(() => true, () => false))
  await page.locator('#price-tab-api').click().catch(() => {})
  check('pricing: /api/plans offers exactly the chains where the treasury Safe is deployed (Base, Ethereum, BNB Chain, Arbitrum)', PLANS.chains.map((c) => c.id).join() === TREASURY_DEPLOYED_CHAINS.join() && !PLANS.assets.some((a) => TREASURY_UNDEPLOYED_CHAINS.includes(a.chainId)), JSON.stringify(PLANS.chains.map((c) => c.id)))
  const payLine = page.locator('#pricing').getByText(`on ${listOr(OFFERED)}, straight from your wallet`).first()
  check(`pricing: the payment line names the offered chains from /api/plans (${listOr(OFFERED)})`, await payLine.waitFor({ timeout: 8_000 }).then(() => true, () => false))
  check('pricing: the payment line names no chain where the treasury is not deployed', (await payLine.count()) === 1 && !new RegExp(Object.values(CLOSED).join('|')).test((await payLine.textContent()) ?? ''))
  // Gully AI everywhere: header nav link, floating button, Ctrl+K; the dock keeps Back to top beside it.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.getByRole('button', { name: 'Back to top' }).waitFor({ state: 'visible' })
  await page.waitForTimeout(300)
  const boxes = await page.evaluate(() => [document.querySelector('[data-testid="ask-fab"]'), document.querySelector('button[aria-label="Back to top"]')].map((el) => el && [el.getBoundingClientRect().left, el.getBoundingClientRect().right, el.getBoundingClientRect().top, el.getBoundingClientRect().bottom]))
  check('landing: the Gully AI button and Back to top do not overlap', !!boxes[0] && !!boxes[1] && (boxes[1][1] <= boxes[0][0] || boxes[1][3] <= boxes[0][2]), JSON.stringify(boxes))
  await launcherWorks(page, 'site')
  await page.getByTestId('ask-fab').click()
  await page.getByRole('dialog', { name: 'Gully AI' }).waitFor()
  await shot(page, 'site-1440-launcher')
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.scrollTo(0, 0))
  check('header: Gully AI is in the main nav, with an icon', await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Gully AI' }).evaluate((a) => a.getAttribute('href') === '/ask' && !!a.querySelector('svg')))
  // Header menus.
  await page.evaluate(() => window.scrollTo(0, 0))
  for (const [menu, item] of [['Products', /^Stock tracker/], ['App & API', /^API docs/], ['Company', /^Services/]]) {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: menu }).click()
    const link = page.getByRole('link', { name: item }).first()
    await link.waitFor({ state: 'visible', timeout: 5_000 })
    check(`nav: the ${menu} menu opens`, await link.isVisible())
    await page.keyboard.press('Escape')
  }
  await w.verify()
  await ctx.close()
})

await step('landing mobile', async () => {
  const ctx = await newContext({ width: 390, height: 844, mobile: true })
  const page = await ctx.newPage()
  const w = watch(page, 'landing 390')
  await page.goto(BASE + '/')
  await page.getByRole('button', { name: 'Menu' }).click()
  const sheet = page.getByRole('dialog', { name: 'Site menu' })
  await sheet.waitFor()
  await sheet.getByRole('button', { name: 'Products' }).click()
  check('mobile sheet: opens and expands a group', (await sheet.getByRole('link', { name: /Stock tracker/ }).first().isVisible()))
  await page.keyboard.press('Escape')
  await sheet.waitFor({ state: 'hidden' })
  check('mobile sheet: Escape closes it', true)
  await noHorizontalScroll(page, 'landing')
  await page.getByTestId('ask-fab').tap()
  await page.getByRole('dialog', { name: 'Gully AI' }).waitFor()
  check('site at 390: the Gully AI button opens the sheet', true)
  await shot(page, 'site-390-launcher')
  await page.getByRole('button', { name: 'Close Gully AI' }).tap()
  await w.verify()
  await ctx.close()
})

/* ------------------------------------------------------------- tracker --- */

await step('tracker', async () => {
  const ctx = await newContext()
  const page = await ctx.newPage()
  const w = watch(page, 'tracker')
  await page.goto(BASE + '/tracker')
  {
    const cc = page.locator('section', { has: page.getByText('Chain against chain') }).first()
    await cc.locator('[data-chart]').first().waitFor({ timeout: 15_000 }).catch(() => {})
    check('tracker: Chain against chain is a live chart (data-live) or the kit ghost, never a text box', (await cc.locator('[data-live]').count()) > 0 || (await cc.getByTestId('chain-compare-ghost').count()) > 0)
  }
  const search = page.getByRole('searchbox', { name: 'Search stocks' })
  await search.fill('nvda')
  const link = page.getByRole('link', { name: 'NVDA page', exact: true }).first()
  await link.waitFor()
  check('tracker: search finds NVDA', await link.isVisible())
  await search.fill('zzzzqq')
  check('tracker: a search with no match says so', (await page.getByText('Nothing matches.').count()) > 0)
  await search.fill('nvda')
  await link.click()
  await page.waitForURL(/\/tracker\/robinhood\/NVDA$/)
  await page.locator('h1', { hasText: 'NVDA' }).first().waitFor()
  check('tracker: the stock page opens', true)
  const range = page.getByRole('group', { name: 'Range' }).getByRole('button', { name: '7d' })
  await range.click()
  check('stock page: the 7d range applies', (await range.getAttribute('aria-pressed')) === 'true')
  // The swap card in an allowed region, with DeepCore's quote stubbed and LI.FI's API stubbed.
  await page.getByRole('heading', { name: 'Swap NVDA' }).scrollIntoViewIfNeeded()
  await page.getByRole('checkbox', { name: 'I understand' }).check()
  await page.getByText(/≈ 1\.84 NVDA/).first().waitFor({ timeout: 15_000 })
  check('swap: the DeepCore comparison quote shows', (await page.getByRole('link', { name: 'Swap on DeepCore' }).count()) > 0)
  // LI.FI's widget logs its own errors when its (stubbed) API has no routes; those are not our page's.
  await w.verify([/li\.quest|lifi|LI\.FI|wagmi|walletconnect|coinbase|SwapWidget-|Failed to load resource: net::ERR_BLOCKED_BY_CLIENT/i])
  await ctx.close()
  // The blocked region.
  const ctx2 = await newContext({ geo: { country: 'US', allowed: false, reason: 'blocked' } })
  const p2 = await ctx2.newPage()
  const w2 = watch(p2, 'stock page, blocked region')
  await p2.goto(BASE + '/tracker/robinhood/NVDA')
  await p2.getByText(/Swapping NVDA isn't offered in your region/).waitFor()
  check('swap: a blocked region gets the notice and no swap', (await p2.getByRole('checkbox', { name: 'I understand' }).count()) === 0)
  await w2.verify()
  await ctx2.close()
})

/* ------------------------------------------------------------- widget builder and Gully AI --- */

await step('widget builder', async () => {
  const ctx = await newContext()
  const page = await ctx.newPage()
  const w = watch(page, 'widget builder')
  await page.goto(BASE + '/widget')
  await page.getByRole('radiogroup', { name: 'Widget type' }).getByRole('radio', { name: 'Table' }).click()
  await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Light' }).click()
  await page.getByRole('radiogroup', { name: 'Rows' }).getByRole('radio', { name: '10', exact: true }).click()
  await page.getByRole('button', { name: 'Copy code' }).click()
  await page.getByText('Snippet copied').first().waitFor()
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  check('widget: the copied snippet is a table of 10', clip.includes('data-gully-widget="table"') && clip.includes('data-limit="10"'), clip.slice(0, 120))
  await page.waitForFunction(() => [...document.querySelectorAll('[data-gully-widget]')].some((el) => /%/.test(el.shadowRoot?.textContent ?? '')), null, { timeout: 10_000 })
  check('widget: the live preview renders rows', true)
  await w.verify()
  await ctx.close()
})

await step('Gully AI', async () => {
  const ctx = await newContext()
  const page = await ctx.newPage()
  const w = watch(page, 'Gully AI')
  await page.goto(BASE + '/ask')
  await page.getByPlaceholder('How do gap alerts work?').fill('How do gap alerts work?')
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  const log = page.getByRole('log', { name: 'Answers' })
  await log.getByText(/Gap alerts fire when/).waitFor({ timeout: 20_000 })
  check('Gully AI: the (stubbed) answer renders', true)
  // Thumbs: the rating reaches the server and lands on the admin's "Unanswered / low-rated questions" card.
  const down = page.getByTestId('ask-rate-down')
  await down.click()
  await page.waitForFunction(() => document.querySelector('[data-testid="ask-rate-down"]')?.getAttribute('aria-pressed') === 'true')
  await page.getByText('Thanks: this helps us decide which docs to write.').waitFor()
  const gaps = await (await fetch(BASE + '/api/admin/ask/gaps?days=30', { headers: { authorization: `Bearer ${admin}` } })).json()
  check('Gully AI: thumbs down is stored and shows on the admin gaps card', gaps.items?.some((x) => x.question === 'How do gap alerts work?' && x.down === 1), JSON.stringify(gaps).slice(0, 200))
  check('Gully AI: the thumbs are real toggle buttons with 44px targets', (await down.boundingBox())?.height >= 44 && (await page.getByTestId('ask-rate-up').getAttribute('aria-pressed')) === 'false')
  // The server's head (crawlers, link previews) says Gully AI; the client-side <Seo> title is in quality-1's AskPage.tsx.
  check('Gully AI: the server-rendered title says Gully AI', (await (await fetch(BASE + '/ask')).text()).includes('<title>Gully AI · Gully Labs</title>'))
  await w.verify()
  await ctx.close()
})

await step('Gully AI and Gully Score layout (DA3 D26, D27, D32)', async () => {
  for (const width of [1440, 320]) {
    const ctx = await newContext(width === 320 ? { width: 320, height: 800, mobile: true } : {})
    const page = await ctx.newPage()
    const w = watch(page, `ask layout at ${width}`)
    await page.goto(BASE + '/ask')
    await page.getByRole('heading', { level: 1 }).waitFor()
    const x = await page.evaluate(() => ({ h1: document.querySelector('main h1').getBoundingClientRect().left, foot: Math.max(24, Math.min(64, window.innerWidth * 0.045)) }))
    check(`/ask at ${width}: content starts on the site gutter`, Math.abs(x.h1 - x.foot) <= 2, JSON.stringify(x))
    const hint = await page.evaluate(() => { const link = [...document.querySelectorAll('main a')].find((a) => a.textContent === 'privacy'); const p = link?.parentElement; const r = link?.getBoundingClientRect(); return { inSentence: !!p && /Questions are kept 90 days/.test(p.textContent), h: r ? r.height : 0 } })
    check(`/ask at ${width}: the privacy link stays inside its sentence`, hint.inSentence, JSON.stringify(hint))
    await page.waitForTimeout(800)
    check(`/ask at ${width}: the live gap bars breathe (not static)`, (await page.locator('[data-live-breathe] .gl-live-breathe').count()) > 0)
    if (width === 320) await noHorizontalScroll(page, '/ask')
    await w.verify()
    await ctx.close()
  }
})

await step('privacy page', async () => {
  const ctx = await newContext()
  const page = await ctx.newPage()
  const w = watch(page, 'privacy page')
  await page.goto(BASE + '/legal/privacy')
  await page.getByRole('heading', { level: 1, name: 'Privacy policy' }).waitFor()
  const ids = await page.evaluate(() => [...document.querySelectorAll('article section[id^="s"]')].map((x) => x.id))
  check('privacy: fourteen numbered sections, s1 to s14, each linked from the section nav', ids.join() === Array.from({ length: 14 }, (_, i) => `s${i + 1}`).join() && (await page.getByRole('navigation', { name: 'Sections' }).getByRole('link').count()) === 14, ids.join())
  check('privacy: "Draft: review by counsel" is an HTML comment only, never on screen', (await page.content()).includes('<!-- Draft: review by counsel') && !(await page.getByText('review by counsel').count()))
  check('privacy: the retention table and the CC BY attribution are there', (await page.getByRole('table').getByRole('rowheader', { name: 'Gully AI questions and ratings' }).isVisible()) && (await page.getByRole('link', { name: 'Basecamp open-source policies' }).isVisible()))
  const head = await (await fetch(BASE + '/legal/privacy')).text()
  check('privacy: the server-rendered title and canonical', head.includes('<title>Privacy policy · Gully Labs</title>') && head.includes('https://gullylabs.xyz/legal/privacy'))
  check('privacy: listed in the sitemap', (await (await fetch(BASE + '/sitemap.xml')).text()).includes('<loc>https://gullylabs.xyz/legal/privacy</loc>'))
  await page.goto(BASE + '/')
  const foot = page.getByRole('contentinfo').getByRole('link', { name: 'Privacy', exact: true })
  check('privacy: linked from the site footer', (await foot.getAttribute('href')) === '/legal/privacy')
  await foot.click()
  await page.getByRole('heading', { level: 1, name: 'Privacy policy' }).waitFor()
  check('privacy: the footer link opens the page in place', page.url().endsWith('/legal/privacy'))
  await w.verify()
  await ctx.close()
})

/* ------------------------------------------------------------- portal --- */

await step('portal', async () => {
  const ctx = await newContext({ cookie: cookieOf(api) })
  const page = await ctx.newPage()
  const w = watch(page, 'portal')
  await page.goto(BASE + '/app#keys')
  // The app's pages are sidebar links (AppShell); at 1440 px the sidebar is open.
  const appNav = page.getByRole('navigation', { name: 'App pages' })
  await appNav.waitFor()
  // Keys: create, rename, revoke.
  await appNav.getByRole('link', { name: /^Keys/ }).click()
  await page.getByRole('button', { name: 'Create key' }).first().click()
  const dlg = page.getByRole('dialog', { name: 'Create a key' })
  await dlg.getByPlaceholder('e.g. Production backend').fill('e2e key')
  await dlg.getByRole('button', { name: 'Create key' }).click()
  const secret = await page.locator('[data-testid="new-secret"]').textContent({ timeout: 10_000 })
  check('keys: a key is created and its secret shown once', /^gl_/.test(secret?.trim() ?? ''), secret?.slice(0, 12))
  await page.getByRole('button', { name: 'I have saved it' }).click()
  // Every workspace tab has one compact live chart; with nothing counted yet it is the ghosted placeholder, never a flat zero.
  await page.locator('[data-testid="keys-traffic"] [data-testid="ghost-chart"]').waitFor({ timeout: 10_000 })
  check('keys: with no calls yet the traffic chart is the ghosted "Your traffic will draw here"', (await page.locator('[data-testid="keys-traffic"]').getByText('Your traffic will draw here').count()) === 1)
  check('keys: the new key\u2019s row has a ghosted spark, not a flat line', (await page.locator('[data-testid="key-spark"] span[data-ghost]').count()) === 1)
  await page.getByRole('button', { name: 'Actions for e2e key' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const rn = page.getByRole('dialog', { name: 'Rename key' })
  await rn.getByRole('textbox').fill('e2e key renamed')
  await rn.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Key renamed').first().waitFor()
  check('keys: rename', (await page.getByRole('button', { name: 'Actions for e2e key renamed' }).count()) === 1)
  // The row sits low on the page: let the "Key renamed" toast go so it does not cover the menu.
  await page.getByText('Key renamed').first().waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
  await page.getByRole('button', { name: 'Actions for e2e key renamed' }).click()
  await page.getByRole('menuitem', { name: 'Revoke' }).click()
  await page.getByRole('dialog', { name: 'Revoke key' }).getByRole('button', { name: 'Revoke key' }).click()
  await page.getByText('Key revoked').first().waitFor()
  check('keys: revoke', true)
  // Alerts: create, test, pause.
  await appNav.getByRole('link', { name: /^Alerts/ }).click()
  await page.getByRole('button', { name: 'New alert' }).first().click()
  const na = page.getByRole('dialog', { name: 'New gap alert' })
  await na.getByLabel('Stock').selectOption('robinhood:NVDA')
  await na.getByLabel('Percent').fill('2')
  await na.getByPlaceholder('https://example.com/hooks/gully').fill(`http://127.0.0.1:${PORT}/healthz`)
  await na.getByRole('button', { name: 'Create alert' }).click()
  await page.getByText('Alert created').first().waitFor()
  await page.getByRole('button', { name: 'I have saved it' }).click()
  check('alerts: an alert is created', true)
  await page.getByRole('button', { name: 'Test', exact: true }).first().click()
  await page.getByText(/Test sent for/).first().waitFor({ timeout: 15_000 })
  check('alerts: a test delivery succeeds', true)
  await page.getByRole('button', { name: 'Pause', exact: true }).first().click()
  await page.getByText(/paused/).first().waitFor()
  check('alerts: pause', true)
  check('alerts: the setup stepper shows Create and Test done', (await page.locator('[data-testid="alerts-stepper"] [data-state="done"]').count()) >= 2 || (await page.locator('[data-testid="alerts-stepper"][data-folded]').count()) === 1)
  await page.getByRole('tab', { name: /^Deliveries/ }).click()
  check('alerts: the Deliveries sub-tab deep-links as #alerts/deliveries', new URL(page.url()).hash === '#alerts/deliveries', page.url())
  check('alerts: the deliveries-per-day chart draws from the test delivery', await drawnIn(page, '[data-testid="alert-fires"]'))
  await page.getByRole('tab', { name: /^Alerts/ }).click()
  // A failed refresh keeps the alerts on screen with a "couldn't refresh · retry" chip (never a blank tab).
  w.expect(/\/api\/developer\/alerts$/)
  await page.route('**/api/developer/alerts', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"e2e: upstream down"}' }))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.getByTestId('refresh-chip').first().waitFor({ timeout: 10_000 })
  check('alerts: a failed refresh keeps the list and shows the retry chip', (await page.locator('[data-alert]').count()) >= 1 && (await page.getByText(/Alerts could not be read/).count()) === 0)
  await page.unroute('**/api/developer/alerts')
  await page.getByTestId('refresh-chip').first().click()
  await page.getByTestId('refresh-chip').first().waitFor({ state: 'detached', timeout: 10_000 })
  check('alerts: retry clears the chip once the read answers', true)
  // Gully Analytics tab (sign-up is off on this server: it must say so, not break).
  await appNav.getByRole('link', { name: /^Analytics/ }).click()
  await page.getByText(/sign-up is not open/).first().waitFor()
  check('analytics tab: says self-serve is off here', true)
  check('analytics tab: the traffic placeholder curve draws while there is no account', (await page.getByTestId('ghost-chart').getByText('Your page views and visitors will draw here').count()) === 1)
  await w.verify()

  // Team: invite by link, the second wallet accepts in its own browser, role change, removal.
  await appNav.getByRole('link', { name: /^Team/ }).click()
  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  const id = page.getByRole('dialog', { name: 'Invite to the workspace' })
  await id.getByRole('radio', { name: 'Create a link' }).click()
  await id.locator('input[name="invite-role"][value="developer"]').check()
  await id.getByRole('button', { name: 'Create link' }).click()
  const link = (await page.locator('[data-invite-link]').textContent({ timeout: 10_000 }))?.trim() ?? ''
  const token = link.split('#invite=')[1]
  check('team: a one-time invite link is created', !!token, link.slice(0, 60))
  await page.getByRole('button', { name: 'I copied it' }).click()
  const mctx = await newContext({ cookie: cookieOf(api2) })
  const mp = await mctx.newPage()
  const mw = watch(mp, 'portal, invited wallet')
  await mp.goto(`${BASE}/developers#invite=${token}`)
  await mp.getByRole('button', { name: 'Accept and switch' }).click()
  await mp.getByText(/^Joined /).first().waitFor({ timeout: 10_000 })
  check('team: the second wallet accepts it and switches to the workspace', true)
  await mw.verify()
  await mctx.close()
  const mateAddr = mate.address.toLowerCase()
  await page.reload()
  await appNav.getByRole('link', { name: /^Team/ }).click()
  const sel = page.locator(`[data-role-select="${mateAddr}"]`)
  await sel.waitFor({ timeout: 10_000 })
  await sel.selectOption('viewer')
  await page.waitForFunction((a) => document.querySelector(`[data-role-select="${a}"]`)?.value === 'viewer' && !document.querySelector(`[data-role-select="${a}"]`)?.disabled, mateAddr)
  check('team: the owner changes the member’s role', (await (await api.call('/api/developer/team')).data?.members?.find?.((m) => m.address === mateAddr)?.role) === 'viewer')
  await page.getByRole('button', { name: new RegExp(`^Remove ${mateAddr.slice(0, 6)}`, 'i') }).click()
  await page.getByRole('dialog', { name: 'Remove member' }).getByRole('button', { name: 'Remove', exact: true }).click()
  await sel.waitFor({ state: 'detached', timeout: 10_000 })
  check('team: the owner removes the member', true)
  check('team: actions per member draw as bars', await drawnIn(page, '[data-testid="team-activity-chart"]'))
  // Activity lists what happened, in the UI.
  await appNav.getByRole('link', { name: /^Activity/ }).click()
  await page.getByRole('heading', { name: 'Activity' }).waitFor()
  // The heading renders before GET /api/developer/activity answers (skeleton rows meanwhile): wait for the list.
  await page.locator('[data-testid="activity-list"] > li').first().waitFor({ timeout: 10_000 })
  const actText = await page.locator('[data-testid="activity-list"]').textContent()
  check('activity: the log shows the key, alert and team changes', /key/i.test(actText) && /alert/i.test(actText) && /invite|member|role/i.test(actText), actText?.slice(0, 160))
  check('activity: events per day draw as stacked bars', await drawnIn(page, '[data-testid="activity-chart"]'))
  await page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: /^Billing/ }).click()
  check('activity: a filter with nothing in 14 days shows the ghosted curve, not zero bars', (await page.locator('[data-testid="activity-chart"] [data-testid="ghost-chart"]').count()) === 1)
  await page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: /^All/ }).click()
  // CSV downloads from Billing.
  await appNav.getByRole('link', { name: /^Billing/ }).click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /Payments CSV/ }).click()])
  check('CSV: payments downloads', /payments.*\.csv$/.test(dl.suggestedFilename()), dl.suggestedFilename())
  const usageLink = page.getByRole('link', { name: /Download usage CSV/ }).first()
  const [dl2] = await Promise.all([page.waitForEvent('download'), usageLink.click()])
  const csv = fs.readFileSync(await dl2.path(), 'utf8')
  check('CSV: usage downloads with its header row', csv.startsWith('time,key,'), csv.slice(0, 40))
  check('billing: plan usage rings draw (keys and alerts against the plan)', await drawnIn(page, '[data-testid="plan-usage"]') && (await page.locator('[data-testid="plan-usage"] [data-chart]').count()) === 2)
  check('billing: with no payments the chart is the ghosted "Your payments will draw here"', (await page.getByTestId('ghost-chart').getByText('Your payments will draw here').count()) === 1)
  await appNav.getByRole('link', { name: 'Products', exact: true }).click()
  await page.locator('[data-testid="products"]').waitFor()
  check('products hub: the Chain Kit card chart is the ghost (or a live chart), and every card has a chart or ghost', (await page.locator('[data-product="Chain Kit"] [data-ghost], [data-product="Chain Kit"] [data-chart]').count()) >= 1 && (await page.locator('[data-testid="products"] [data-product]').evaluateAll((cs) => cs.filter((c) => !c.querySelector('[data-ghost], [data-chart], [data-live], svg[role="img"], [role="img"]')).map((c) => c.dataset.product))).length === 0)
  // Overview with a key but no traffic: the requests chart is the ghosted placeholder, not a flat zero.
  await appNav.getByRole('link', { name: 'Overview', exact: true }).click()
  await page.getByTestId('ghost-chart').waitFor({ timeout: 15_000 })
  check('overview: a key with no calls yet gets "Your traffic will draw here"', (await page.getByTestId('ghost-chart').getByText('Your traffic will draw here').count()) === 1)
  await w.verify()
  await ctx.close()
})

/* ------------------------------------------------------------- app services --- */

/** The Overview's market band draws live, non-zero network series: widest gaps, the 24h gap index, DeepCore launches per chain, the API round trip. */
async function overviewIsLive(page, label) {
  const band = page.getByTestId('market-band')
  await band.waitFor({ timeout: 15_000 })
  // Charts draw once scrolled into view, so each tile is brought on screen first (at 390 px the band is taller than the viewport).
  const drawn = (id) => band.getByTestId(id).scrollIntoViewIfNeeded().then(() => band.getByTestId(id).locator('[data-chart].opacity-100 svg').first().waitFor({ timeout: 20_000 })).then(() => true, () => false)
  const figure = async (id) => (await band.getByTestId(id).locator('[role="img"][aria-label]').first().getAttribute('aria-label').catch(() => null)) ?? ''
  check(`${label}: the widest-gaps bars draw`, await drawn('mk-gaps'))
  const gap = await figure('mk-gaps')
  check(`${label}: the widest gap is a live, non-zero percent`, /^[+-]\d+\.\d{2}%$/.test(gap) && parseFloat(gap) !== 0, gap)
  check(`${label}: the 24h gap index draws from the seeded history`, await drawn('mk-index'))
  const idx = await figure('mk-index')
  check(`${label}: the gap index figure is non-zero`, /^\d+\.\d{2}%$/.test(idx) && parseFloat(idx) > 0, idx)
  check(`${label}: DeepCore launches per chain draw`, await drawn('mk-deepcore'))
  const dc = await figure('mk-deepcore')
  check(`${label}: five launches in the last 24 h, the newest named`, dc === '5' && /DTC on Robinhood Chain/.test(await band.getByTestId('mk-newest').textContent()), dc)
  check(`${label}: the API round-trip sparkline draws from /healthz`, await drawn('mk-status'))
  const ms = await figure('mk-status')
  check(`${label}: the round trip is a live millisecond figure`, /^\d+ ms$/.test(ms), ms)
}

await step('chains launch wizard', async () => {
  const wApi = makeClient(BASE)
  check('chains: a wallet signs in', (await wApi.signIn(privateKeyToAccount(generatePrivateKey()))).status === 200)
  // Chain id 7100001 is already used by a chain launched in this workspace (recorded through the API).
  const hex = (n) => '0x' + Array.from({ length: n * 2 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  const used = await wApi.post('/api/developer/chains-launch', { name: 'Taken Chain', chainId: 7100001, type: 'rollup', parentChainId: 421614, owner: hex(20), validators: [hex(20)], batchPosters: [hex(20)], gasToken: 'ETH', txHash: hex(32) })
  check('chains: a chain is recorded through the API (201)', used.status === 201)
  const OWNER = '0x1234567890abcdef1234567890abcdef12345678'
  for (const [width, height, mobile] of [[1440, 900, false], [390, 844, true]]) {
    const tag = mobile ? '390' : '1440'
    const c = await newContext({ width, height, mobile, cookie: cookieOf(wApi) })
    // The SDK's prepare step is stubbed: no wallet, no RPC, no real chain.
    await c.addInitScript(() => {
      window.__GULLY_CHAINS_STUB__ = {
        prepare: async (input, account) => ({ from: account, to: '0xF5962AD061A1aD6F38F340F5b267b3593cC1Cd7B', data: '0x' + 'ab'.repeat(300), value: 128449767360000000n, gas: 9000000n, chainId: 421614, chainConfig: { chainId: input.chainId, arbitrum: { InitialChainOwner: input.owner, DataAvailabilityCommittee: input.type === 'anytrust' } }, stakeToken: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73' }),
      }
    })
    const p = await c.newPage()
    const w = watch(p, `chains ${tag}`)
    await p.goto(`${BASE}/app#chains`)
    await p.locator('[data-service="chains"]').getByTestId('service-header').waitFor({ timeout: 15_000 })
    await p.getByTestId('launched-chain').first().waitFor()
    check(`chains ${tag}: the recorded chain is listed`, (await p.getByTestId('launched-chain').count()) === 1)
    await noHorizontalScroll(p, 'chains #chains')
    await shot(p, `launch-flow-${tag}-list`)
    // The wizard, deep-linked.
    await p.goto(`${BASE}/app#chains/launch`)
    await p.reload()
    const stepper = p.getByTestId('launch-stepper')
    await stepper.waitFor({ timeout: 15_000 })
    check(`chains ${tag}: the wizard has six steps`, (await stepper.locator('li[data-step]').count()) === 6)
    check(`chains ${tag}: Continue is off until a type is chosen`, await p.getByTestId('wizard-next').isDisabled())
    await noHorizontalScroll(p, 'wizard: chain type')
    await shot(p, `launch-flow-${tag}-1-type`)
    await p.locator('[data-type="anytrust"]').click()
    await p.locator('[data-type="rollup"]').click()
    check(`chains ${tag}: one type is selected`, (await p.locator('[role="radio"][aria-checked="true"]').count()) === 1)
    await p.getByTestId('wizard-next').click()
    // Configure: validation.
    await p.locator('#chain-name').waitFor()
    await p.locator('#chain-name').fill('ab')
    await p.locator('#chain-id').fill('abc')
    await p.locator('#chain-owner').fill('0x123')
    await p.getByTestId('wizard-next').click()
    check(`chains ${tag}: bad name, chain id and owner are each named`, (await p.getByTestId('chain-name-error').count()) === 1 && (await p.getByTestId('chain-id-error').count()) === 1 && (await p.getByTestId('chain-owner-error').count()) === 1)
    await p.locator('#chain-owner').fill('0x' + 'a'.repeat(64))
    check(`chains ${tag}: a pasted private key is refused as an owner`, /private key/i.test(await p.getByTestId('chain-owner-error').textContent()))
    await p.locator('#chain-name').fill('E2E Testnet')
    await p.locator('#chain-id').fill('7100001')
    await p.locator('[data-testid="chain-id-status"][data-state="taken"]').waitFor({ timeout: 10_000 })
    check(`chains ${tag}: a chain id already used here is flagged taken`, /already uses/.test(await p.getByTestId('chain-id-status').textContent()))
    await p.locator('#chain-owner').fill(OWNER)
    await p.getByTestId('wizard-next').click()
    check(`chains ${tag}: Continue does not pass a taken id`, (await p.locator('#chain-name').count()) === 1)
    await p.locator('#chain-id').fill('7100002')
    await p.locator('[data-testid="chain-id-status"][data-state="free"]').waitFor({ timeout: 10_000 })
    const cfg = await p.locator('[data-testid="step-configure"]').textContent()
    check(`chains ${tag}: gas token ETH and parent Arbitrum Sepolia are fixed`, /ETH/.test(cfg) && /Arbitrum Sepolia/.test(cfg) && /testnet only/.test(cfg))
    await noHorizontalScroll(p, 'wizard: configure')
    await shot(p, `launch-flow-${tag}-2-configure`)
    await p.getByTestId('wizard-next').click()
    // Validators and batch poster.
    await p.locator('#validators').waitFor()
    check(`chains ${tag}: the page says it never holds keys`, /never generates, receives or holds a private key/i.test(await p.getByTestId('no-keys-note').textContent()))
    await p.locator('#validators').fill('not an address')
    await p.locator('#posters').fill('0x' + 'b'.repeat(64))
    await p.getByTestId('wizard-next').click()
    check(`chains ${tag}: a bad address and a private key are both refused`, (await p.getByTestId('validators-error').count()) === 1 && /private key/i.test(await p.getByTestId('posters-error').textContent()))
    await shot(p, `launch-flow-${tag}-3-operators`)
    await p.getByRole('button', { name: 'Use the owner address for both' }).click()
    await p.getByTestId('wizard-next').click()
    // Review: the stubbed SDK transaction.
    await p.getByTestId('tx-preview').getByText('createRollup').first().waitFor({ timeout: 15_000 })
    const prev = await p.getByTestId('tx-preview').textContent()
    check(`chains ${tag}: the review shows the SDK transaction (target, value, call data)`, /0xF5962AD0/.test(prev) && /0\.12844976736 ETH/.test(prev) && /300 bytes/.test(prev) && /1 transaction/.test(prev), prev.slice(0, 200))
    const rev = await p.getByTestId('review').textContent()
    check(`chains ${tag}: the review shows the chain, owner and operators`, /E2E Testnet/.test(rev) && rev.includes(OWNER))
    await noHorizontalScroll(p, 'wizard: review')
    await shot(p, `launch-flow-${tag}-4-review`)
    await p.getByTestId('wizard-next').click()
    // Deploy: needs a wallet; none is connected in the test, and nothing is sent.
    await p.getByTestId('deploy').waitFor()
    check(`chains ${tag}: Deploy asks for a wallet (nothing is sent in the test)`, (await p.getByTestId('connect-wallet').count()) === 1 && (await p.getByTestId('deploy-send').count()) === 0)
    await noHorizontalScroll(p, 'wizard: deploy')
    await shot(p, `launch-flow-${tag}-5-deploy`)
    check(`chains ${tag}: no chain was recorded by walking the wizard`, (await wApi.call('/api/developer/chains-launch')).data.chains.length === 1)
    await w.verify([/li\.quest|lifi|wagmi|walletconnect|ERR_BLOCKED_BY_CLIENT|arbitrum/i])
    await c.close()
  }
})

const SERVICES = [
  ['tracker', 'Tracker'],
  ['pay', 'Gully Pay'],
  ['chain-kit', 'Chain Kit'],
  ['chains', 'Chains'],
  ['ai', 'Gully AI'],
  ['score', 'Gully Score'],
  ['deepcore', 'DeepCore launches'],
  ['holders', 'Holder Map'],
  ['widgets', 'Widgets'],
  ['telegram', 'Telegram'],
]
await step('app services', async () => {
  // A fresh wallet: the portal step above filled the Free plan's one alert, and "Alert" needs room.
  const api3 = makeClient(BASE)
  check('a third wallet signs in', (await api3.signIn(privateKeyToAccount(generatePrivateKey()))).status === 200)
  const ctx = await newContext({ cookie: cookieOf(api3) })
  const page = await ctx.newPage()
  const w = watch(page, 'app services 1440')
  await page.goto(BASE + '/app')
  const appNav = page.getByRole('navigation', { name: 'App pages' })
  await appNav.waitFor()
  const groups = await appNav.locator('[data-nav-group]').evaluateAll((els) => els.map((e) => e.getAttribute('data-nav-group')))
  check('sidebar: grouped Workspace, Services, Tools, Account', JSON.stringify(groups) === JSON.stringify(['Workspace', 'Services', 'Tools', 'Account']), JSON.stringify(groups))
  const iconless = await appNav.locator('a').evaluateAll((as) => as.filter((a) => !a.querySelector('svg')).map((a) => a.textContent))
  check('sidebar: every item has an icon', iconless.length === 0, iconless.join(', '))
  check('sidebar: Merchant sits under Services', (await appNav.locator('[data-nav-group="Services"]').getByRole('link', { name: /^Merchant/ }).count()) === 1)
  // The Overview of a brand-new workspace: live NETWORK charts first (the stubbed tracker, its seeded
  // history, the launch list and this browser's /healthz round trips), then the workspace's own figures
  // in words ("none yet") with ghosted placeholder curves, never flat zeros.
  await overviewIsLive(page, 'overview, new workspace')
  const kpis = await page.locator('[data-kpi] [data-none]').evaluateAll((els) => els.map((e) => e.textContent.trim()))
  check('overview: a new workspace reads "none yet", not 0', kpis.length === 4 && kpis.every((k) => /^none/.test(k)), JSON.stringify(kpis))
  check('overview: the workspace band is labelled YOU, the market band NETWORK', (await page.getByTestId('you-title').getByText('YOU', { exact: true }).count()) === 1 && (await page.getByTestId('market-band').getByText('NETWORK · LIVE').count()) === 1)
  const ghost = page.getByTestId('ghost-chart')
  check('overview: with no keys the requests chart is a ghosted "Your traffic will draw here"', (await ghost.count()) === 1 && (await ghost.getByText('Your traffic will draw here').count()) === 1 && (await ghost.locator('svg path').count()) >= 2)
  await shot(page, 'app-1440-overview-new')
  for (const [id, label] of SERVICES) {
    // Gully Score has no sidebar entry of its own (it sits under Security), so it opens by its hash.
    const navLink = appNav.getByRole('link', { name: label, exact: true })
    if (await navLink.count()) await navLink.click()
    else await page.evaluate((h) => (location.hash = h), id)
    const view = page.locator(`[data-service="${id}"]`)
    await view.getByTestId('service-header').waitFor({ timeout: 15_000 })
    check(`app ${label}: the page renders with its header`, (await view.getByRole('heading', { level: 1 }).textContent())?.trim() === label)
    check(`app ${label}: the hash deep-links it`, new URL(page.url()).hash === `#${id}`, page.url())
    const ext = await view.getByTestId('service-header').locator('a').evaluateAll((as) => as.map((a) => [a.textContent, a.target, a.rel]))
    check(`app ${label}: Docs and Public page open in a new tab`, ext.length >= 2 && ext.every(([, t, r]) => t === '_blank' && /noopener/.test(r)), JSON.stringify(ext))
    await view.locator('[data-tile], [data-testid$="zero-line"]').first().waitFor()
    if (id === 'tracker') await view.locator('tr[data-row]').first().waitFor({ timeout: 15_000 })
    if (id === 'deepcore') await view.getByTestId('deepcore-launches').waitFor({ timeout: 15_000 })
    if (id === 'widgets') await page.waitForFunction(() => [...document.querySelectorAll('[data-gully-widget]')].some((el) => /%/.test(el.shadowRoot?.textContent ?? '')), null, { timeout: 10_000 })
    if (id === 'ai') check('app Gully AI: the full chat is on the page', (await view.getByPlaceholder('How do gap alerts work?').count()) === 1)
    // DA2 group 5: no developer noise, ghosts for empty charts, logos on launch rows, no cut-off symbols.
    const noise = await view.evaluate((el) => /\[object Object\]|\bundefined\b|\bnull\b/.test(el.innerText))
    check(`app ${label}: no developer noise in the page text`, !noise)
    if (id === 'deepcore') {
      await view.getByTestId('deepcore-launches').locator('[data-logo="token"], img').first().waitFor({ timeout: 10_000 })
      check('app DeepCore: launch rows carry a token logo and chain logo', (await view.getByTestId('deepcore-launches').locator('li').first().locator('img').count()) >= 2)
      check('app DeepCore: LAUNCHES 24H is a number, not "not tracked yet"', !/not tracked yet/.test((await view.locator('[data-tile="LAUNCHES 24H"]').textContent()) ?? ''))
    }
    if (id === 'holders') {
      const hrow = view.locator('[data-launch-holders] a').first()
      await hrow.waitFor({ timeout: 10_000 })
      check('app Holder Map: launch rows have a token logo and the whole symbol', (await hrow.locator('img').count()) >= 2 && !/…$/.test(((await hrow.locator('b').first().textContent()) ?? '').trim()))
    }
    if (id === 'tracker') check('app Tracker: no 24H cell says "not tracked yet"', (await view.locator('tr[data-row]').filter({ hasText: 'not tracked yet' }).count()) === 0)
    if (id === 'pay' || id === 'telegram') check(`app ${label}: an empty chart is a ghost, not a dashed text box`, (await view.getByTestId('empty-chart').count()) === 0)
    await page.waitForTimeout(600)
    await shot(page, `app-1440-${id}`)
  }
  // Tracker: chain filter and "Alert" from a row.
  await appNav.getByRole('link', { name: 'Tracker', exact: true }).click()
  const rows = page.locator('[data-service="tracker"] tr[data-row]')
  await rows.first().waitFor()
  const all = await rows.count()
  await page.locator('[data-testid="tracker-chains"] button').nth(2).click()
  await page.waitForFunction((n) => document.querySelectorAll('[data-service="tracker"] tr[data-row]').length !== n, all)
  const keys = await rows.evaluateAll((trs) => [...new Set(trs.map((tr) => tr.getAttribute('data-row').split(':')[0]))])
  check('app Tracker: a chain filter narrows the rows to one chain', keys.length === 1 && (await rows.count()) < all, JSON.stringify(keys))
  const first = await rows.first().getAttribute('data-row')
  await rows.first().getByRole('button', { name: /^Add a gap alert/ }).click()
  const na = page.getByRole('dialog', { name: 'New gap alert' })
  await na.waitFor()
  const picked = await na.getByLabel('Stock').inputValue()
  check('app Tracker: "Alert" opens New gap alert preset to that stock', picked === first, `${picked} vs ${first}`)
  await page.keyboard.press('Escape')
  await na.waitFor({ state: 'hidden' })
  // Gully AI in the app: floating button and Ctrl+K.
  await appNav.getByRole('link', { name: 'Overview', exact: true }).click()
  await launcherWorks(page, 'app')
  // A deep link opens its service page directly.
  await page.goto(BASE + '/app#deepcore')
  await page.locator('[data-service="deepcore"]').getByTestId('service-header').waitFor()
  check('app: #deepcore deep-links to its page', (await page.locator('main[data-page]').getAttribute('data-page')) === 'deepcore')
  await w.verify()
  await ctx.close()

  // The sidebar at 1440x840 and 1440x800: one full-height list with no inner scrollbar, folding groups that
  // are remembered, and an icon rail with tooltips. The Overview's rows have no orphan card at 1440, 1280
  // and 1024 (KPIs, market band), and "Get started" is a ring with the next step.
  const sc = await newContext({ width: 1440, height: 840, cookie: cookieOf(api3) })
  const sp = await sc.newPage()
  const sw = watch(sp, 'app sidebar 1440x840')
  await sp.goto(BASE + '/app')
  const sNav = sp.getByTestId('app-nav')
  await sNav.waitFor()
  await overviewIsLive(sp, 'overview at 1440x840')
  await sp.waitForTimeout(900)
  await shot(sp, 'app-1440x840-overview-new')
  const fits = async () => sNav.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)
  check('sidebar at 1440x840: every page fits with no inner scrollbar', await fits(), await sNav.evaluate((el) => `${el.scrollHeight}/${el.clientHeight}`))
  await sp.setViewportSize({ width: 1440, height: 800 })
  await sp.waitForTimeout(200)
  check('sidebar at 1440x800: still no inner scrollbar', await fits(), await sNav.evaluate((el) => `${el.scrollHeight}/${el.clientHeight}`))
  const rowH = await sNav.getByRole('link', { name: 'Keys' }).evaluate((a) => a.getBoundingClientRect().height)
  check('sidebar: rows are compact (30-36 px: 30 under 820 px tall so every page fits)', rowH >= 30 && rowH <= 36, String(rowH))
  check('sidebar: Docs, Status and home sit in the header, not in a block under the list', (await sp.getByTestId('header-links').locator('a, button').count()) === 3 && (await sp.getByTestId('app-sidebar').getByTestId('status-link').count()) === 0)
  await sp.getByTestId('header-links').getByTestId('status-link').click()
  const st = sp.getByRole('dialog', { name: 'Status' })
  await st.getByTestId('status-view').waitFor()
  await st.locator('[data-chart].opacity-100 svg').first().waitFor({ timeout: 20_000 }).catch(() => {})
  check('status: the Status button opens a Status view (API uptime and latency, tracker and DeepCore health), not another tab', (await st.getByText('Tracker data').count()) === 1 && (await st.getByText('DeepCore launch poller').count()) === 1 && /checks this session/.test((await st.textContent()) ?? '') && new URL(sp.url()).hash === '')
  await shot(sp, 'app-1440x840-status')
  await sp.keyboard.press('Escape')
  await st.waitFor({ state: 'hidden' })
  // Below 840 px of height the group labels fold into dividers (so the list fits); the toggles need the labels.
  await sp.setViewportSize({ width: 1440, height: 900 })
  await sp.getByTestId('navgroup-toggle-tools').click()
  check('sidebar: a group folds', (await sNav.locator('[data-nav-group="Tools"]').getByRole('link').count()) === 0)
  // Reload on a page without the market band (its history reads count against the anonymous limit).
  await sp.goto(BASE + '/app#keys')
  await sNav.waitFor()
  check('sidebar: the folded group is remembered', (await sNav.locator('[data-nav-group="Tools"][data-folded]').count()) === 1 && (await sp.getByTestId('navgroup-toggle-tools').getAttribute('aria-expanded')) === 'false')
  await sp.getByTestId('navgroup-toggle-tools').click()
  check('sidebar: and unfolds', (await sNav.locator('[data-nav-group="Tools"]').getByRole('link').count()) === 3)
  await sNav.getByRole('link', { name: 'Overview', exact: true }).click()
  const gs = sp.getByTestId('get-started')
  await gs.waitFor()
  check('overview: "Get started" opens folded as a thin progress bar with the next step', (await gs.getAttribute('data-folded')) !== null && /^Next: /.test(((await sp.getByTestId('get-started-next').textContent()) ?? '').trim()) && (await gs.boundingBox()).height <= 64)
  await sp.getByTestId('get-started-continue').click()
  check('overview: "Get started" is a stepper whose current step shows one action button', (await gs.locator('[data-step]').count()) >= 3 && (await gs.locator('[data-state="current"]').count()) === 1 && (await sp.getByTestId('next-step').locator('button, a').count()) === 1 && !/not tracked or not available/.test((await gs.textContent()) ?? ''))
  await sp.setViewportSize({ width: 1440, height: 840 })
  await shot(sp, 'app-1440x840-sidebar')
  await sp.getByTestId('sidebar-toggle').click()
  await sp.waitForTimeout(300)
  const keysRow = sNav.getByRole('link', { name: 'Keys' })
  await keysRow.hover()
  await sp.waitForTimeout(300)
  const tip = keysRow.locator('[data-tooltip]')
  check('icon rail: hovering a row shows its name as a tooltip', (await tip.textContent())?.trim() === 'Keys' && Number(await tip.evaluate((el) => getComputedStyle(el).opacity)) > 0.9)
  await shot(sp, 'app-1440x840-rail')
  await sp.getByTestId('sidebar-toggle').click()
  const perRow = async (sel) =>
    sp.locator(sel).evaluateAll((els) => {
      const tops = els.map((e) => Math.round(e.getBoundingClientRect().top))
      const counts = {}
      for (const t of tops) counts[t] = (counts[t] ?? 0) + 1
      return Object.values(counts)
    })
  // The pixel-pass design audit on every app page (signed in): 11 px minimum, token colours only, other hosts in a new tab.
  for (const id of ['overview', 'products', 'tracker', 'pay', 'merchant', 'security', 'chain-kit', 'chains', 'ai', 'deepcore', 'holders', 'widgets', 'telegram', 'keys', 'alerts', 'analytics', 'billing', 'team', 'activity', 'settings']) {
    await sp.goto(`${BASE}/app#${id}`)
    await sp.locator(`main[data-page="${id}"]`).waitFor({ timeout: 15_000 })
    await sp.waitForLoadState('networkidle').catch(() => {})
    await sp.waitForTimeout(1200)
    await designAudit(sp, `app #${id}`)
  }
  await sp.goto(BASE + '/app')
  await sNav.waitFor()
  for (const width of [1440, 1280, 1024]) {
    await sp.setViewportSize({ width, height: 840 })
    await sp.waitForTimeout(400)
    const k = await perRow('[data-kpi]')
    const b = await perRow('[data-testid="mk-grid"] > section')
    check(`overview at ${width}: KPI cards with no orphan`, k.length > 0 && k.every((n) => n === k[0]), JSON.stringify(k))
    check(`overview at ${width}: market tiles with no orphan`, b.length > 0 && b.every((n) => n === b[0]), JSON.stringify(b))
  }
  await sw.verify()
  await sc.close()

  // 390 px: the mobile menu sheet with the same groups, every service without horizontal scroll.
  const m = await newContext({ width: 390, height: 844, mobile: true, cookie: cookieOf(api3) })
  const mp = await m.newPage()
  const mw = watch(mp, 'app services 390')
  await mp.goto(BASE + '/app')
  await overviewIsLive(mp, 'overview at 390')
  await noHorizontalScroll(mp, 'app overview')
  await shot(mp, 'app-390-overview-new')
  const bar = mp.getByTestId('tab-bar')
  check('app at 390: a bottom tab bar with Overview, Tracker, Keys, Alerts and More', JSON.stringify(await bar.locator('a, button').evaluateAll((els) => els.map((e) => e.textContent.trim()))) === JSON.stringify(['Overview', 'Tracker', 'Keys', 'Alerts', 'More']))
  await bar.getByRole('link', { name: 'Tracker' }).tap()
  await mp.locator('[data-service="tracker"]').getByTestId('service-header').waitFor({ timeout: 15_000 })
  check('app at 390: a tab opens its page', new URL(mp.url()).hash === '#tracker')
  await bar.getByRole('link', { name: 'Overview' }).tap()
  await mp.getByTestId('tab-more').tap()
  await mp.getByTestId('app-sheet').waitFor()
  check('app at 390: More opens the full menu sheet', (await mp.getByTestId('app-sheet').locator('[data-nav-group]').count()) === 4)
  await shot(mp, 'app-390-more')
  await mp.keyboard.press('Escape')
  await mp.getByTestId('app-sheet').waitFor({ state: 'hidden' })
  await mp.getByTestId('menu-button').tap()
  const sheet = mp.getByTestId('app-sheet')
  await sheet.waitFor()
  check('app at 390: the menu sheet shows the groups', (await sheet.locator('[data-nav-group]').count()) === 4)
  await shot(mp, 'app-390-menu')
  await sheet.getByRole('link', { name: 'Overview', exact: true }).tap()
  for (const [id] of SERVICES) {
    await mp.goto(`${BASE}/app#${id}`)
    await mp.locator(`[data-service="${id}"]`).getByTestId('service-header').waitFor({ timeout: 15_000 })
    await mp.waitForTimeout(700)
    await noHorizontalScroll(mp, `app #${id}`)
    await shot(mp, `app-390-${id}`)
  }
  // Design audit 3 (D1, D4, D9, D10, D28): narrow screens read in full, nothing clipped, no empty-count badges.
  for (const w of [390, 320]) {
    await mp.setViewportSize({ width: w, height: 760 })
    for (const id of ['deepcore', 'overview', 'keys', 'tracker', 'pay', 'chain-kit']) {
      await mp.goto(`${BASE}/app#${id}`)
      await mp.locator(id === 'overview' ? 'main[data-page="overview"]' : id === 'keys' ? 'main[data-page="keys"]' : `[data-service="${id}"] [data-testid="service-header"]`).first().waitFor({ timeout: 15_000 })
      await mp.waitForTimeout(700)
      await noHorizontalScroll(mp, `app #${id} at ${w}`)
      const crumb = await mp.locator('[data-testid="breadcrumb"] [aria-current="page"]').evaluate((e) => [e.scrollWidth, e.clientWidth, e.textContent])
      check(`app #${id} at ${w}: the breadcrumb shows the page name in full`, crumb[0] <= crumb[1] + 1, JSON.stringify(crumb))
      const clipped = await mp.evaluate(() => [...document.querySelectorAll('[data-kpi] > span, [data-tile] > span')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent))
      check(`app #${id} at ${w}: no stat label or note is clipped`, clipped.length === 0, JSON.stringify(clipped))
      const tip = await mp.locator('[data-testid="info-tip"] > span:first-child').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow === 'ellipsis').length)
      check(`app #${id} at ${w}: the hint line wraps instead of ending in an ellipsis`, tip === 0)
      if (id === 'tracker') {
        const small = await mp.locator('[data-service="tracker"] tbody tr').first().locator('button, a').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width < 43.5 || e.getBoundingClientRect().height < 43.5).map((e) => e.getAttribute('aria-label') || e.textContent))
        check(`app #tracker at ${w}: row Alert and Page buttons are 44 px targets`, small.length === 0, JSON.stringify(small))
      }
      const zero = await mp.locator('[data-testid="sub-tabs"] [role="tab"] > span.font-mono').evaluateAll((els) => els.filter((e) => e.textContent.trim() === '0').length)
      check(`app #${id} at ${w}: no tab badge reads 0`, zero === 0)
    }
  }
  await mw.verify([/li\.quest|lifi|wagmi|ERR_BLOCKED_BY_CLIENT/i])
  await m.close()

  // Page heights (owner rule, gap N-22): no app page is taller than 900 px at 1440x900. Every app page is measured
  // on every run, the main pages and every service (Holder Map and Monitors included), at 1440 (asserted against the
  // budget; E2E_MAX_PAGE_PX overrides 900) and at 390 (measured only: phones have no budget). With E2E_SHOTS the
  // full-page screenshots and page-heights.json are saved as well.
  {
    const heights = {}
    const MAX_PX = Number(process.env.E2E_MAX_PAGE_PX) || 900
    const pages = [...['overview', 'merchant', 'analytics', 'alerts', 'security', 'monitors'].map((id) => [id, `main[data-page="${id}"]`]), ...SERVICES.map(([id]) => [id, `[data-service="${id}"] [data-testid="service-header"]`])]
    for (const [width, height, mobile] of [[1440, 900, false], [390, 844, true]]) {
      const hc = await newContext({ width, height, mobile, cookie: cookieOf(api3) })
      const hp = await hc.newPage()
      for (const [id, ready] of pages) {
        await hp.goto(`${BASE}/app#${id}`)
        const ok = await hp.locator(ready).first().waitFor({ timeout: 15_000 }).then(() => true, () => false)
        // An id the app does not route (it falls back to Overview) is not measured as that page.
        if (!ok) continue
        await hp.waitForLoadState('networkidle').catch(() => {})
        if (SHOTS) {
          // Charts draw when scrolled into view: walk down the page first so the full-page shot shows them drawn.
          for (let y = 0; y < (await hp.evaluate(() => document.documentElement.scrollHeight)); y += 500) {
            await hp.evaluate((top) => window.scrollTo(0, top), y)
            await hp.waitForTimeout(250)
          }
          await hp.evaluate(() => window.scrollTo(0, 0))
          await hp.waitForTimeout(1200)
        } else await hp.waitForTimeout(400)
        // The page's full content height: the document, or the app shell's own scroll pane when it scrolls inside
        // a fixed-height layout (then the document is always exactly the viewport and would hide a long page).
        heights[`${id}-${width}`] = await hp.evaluate(() => Math.max(document.documentElement.scrollHeight, ...[...document.querySelectorAll('main, main *, [data-page], body > div *')].filter((e) => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.clientHeight > 300 && e.scrollHeight > e.clientHeight).map((e) => e.scrollHeight - e.clientHeight + window.innerHeight)))
        if (SHOTS) await hp.screenshot({ path: path.join(SHOTS, `page-${id}-${width}.png`), fullPage: true })
      }
      await hc.close()
    }
    const measured = Object.keys(heights)
    check(`page heights: every app page is measured at 1440 and 390 (${measured.length} of ${pages.length * 2})`, ['overview', 'merchant', 'alerts', 'holders', ...SERVICES.map(([id]) => id)].every((id) => heights[`${id}-1440`] > 0 && heights[`${id}-390`] > 0), JSON.stringify(heights))
    const over = Object.entries(heights).filter(([k, h]) => k.endsWith('-1440') && h > MAX_PX)
    check(`page heights: every app page fits ${MAX_PX} px at 1440x900`, over.length === 0, over.map(([k, h]) => `${k} ${h}px`).join(' | '))
    console.log(`  page heights (px): ${Object.entries(heights).map(([k, h]) => `${k} ${h}`).join(', ')}`)
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'page-heights.json'), JSON.stringify(heights, null, 2))
  }
})

/* ------------------------------------------------------------- pay --- */

const adminCall = async (p, body) => {
  const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => null) }
}

// E2E_SHOTS=<dir>: full-page screenshots of every checkout state at 1440 and 390 land there too (shotFull names them <name>-<width>.png).
const shotFull = async (page, name) => {
  if (!SHOTS) return
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(SHOTS, `${name}-${page.viewportSize().width}.png`), fullPage: true })
}

/** The standalone checkout frame: no site header, nav or footer; the kit's "Powered by Gully Pay" mark; noindex. */
async function checkStandalone(page, label) {
  check(`${label}: no site nav, Launch app or site footer`, (await page.getByRole('link', { name: /Launch app/ }).count()) === 0 && (await page.getByText('© 2026 GULLY LABS').count()) === 0 && (await page.getByRole('navigation', { name: 'Main' }).count()) === 0)
  check(`${label}: Powered by Gully Pay with the kit mark`, (await page.locator('footer img[src="/brand/gully-mark-96.png"]').count()) === 1 && (await page.getByRole('link', { name: /Powered by Gully Pay/ }).count()) === 1)
  check(`${label}: non-custodial badge and legal links in a new tab`, (await page.getByText('Non-custodial').count()) >= 1 && (await page.locator('nav[aria-label="Legal"] a[target="_blank"]').count()) >= 2)
  check(`${label}: noindex`, (await page.locator('meta[name="robots"][content="noindex"]').count()) === 1)
}

const paidPayment = (asset, to, amount, usd) => ({ id: 'pm_e2e', kind: 'invoice', txHash: '0x' + 'ab'.repeat(32), chainId: asset.chainId, chain: asset.chain, asset: asset.id, symbol: asset.symbol, amount, usd, from: '0x' + '12'.repeat(20), to, blockNumber: 4_999_990, at: new Date().toISOString(), txUrl: `${asset.explorer}/tx/0x${'ab'.repeat(32)}`, price: null, plan: null, periodStart: null, expiresAt: null, invoiceId: null })

await step('pay', async () => {
  const inv = await adminCall('/api/admin/invoices', { title: 'E2E: first month', usd: '25', assets: ['base-usdc', 'base-eth'] })
  check('pay: the admin API creates an invoice', inv.status === 201 && /^inv_/.test(inv.data?.invoice?.id ?? ''))
  const invId = inv.data.invoice.id
  const ctx = await newContext()
  const page = await ctx.newPage()
  await page.clock.install()
  const w = watch(page, 'pay page')
  await page.goto(`${BASE}/pay/${invId}`)
  await page.getByTestId('order-total').waitFor()
  await checkStandalone(page, 'pay')
  check('pay: the kit lockup heads our own invoice', (await page.locator('header [data-brand="kit"]').count()) === 1)
  check('pay: the title is "Pay Gully Labs"', (await page.title()) === 'Pay Gully Labs', await page.title())
  check('pay: the order summary lists the line and total in normal type', /\b25(\.00)?\b/.test(await page.getByTestId('order-total').textContent()) && (await page.getByTestId('order-items').getByRole('row').count()) >= 2, `${await page.getByTestId('order-total').textContent()} / ${await page.getByTestId('order-items').getByRole('row').count()} rows`)
  await page.getByRole('radiogroup', { name: 'Pay with' }).getByRole('radio', { name: 'USDC on Base' }).click()
  await page.getByRole('img', { name: /^Wallet payment request:/ }).waitFor({ timeout: 10_000 })
  check('pay: a quote shows its wallet QR code', true)
  check('pay: the quote counts down', (await page.getByRole('timer').count()) > 0)
  check('pay: Pay with wallet is the primary action', (await page.getByTestId('pay-with-wallet').count()) === 1)
  check('pay: the status track waits for the payment', (await page.getByTestId('status-track').getAttribute('data-step')) === '0')
  await shotFull(page, 'gully-invoice-quote')
  await page.clock.fastForward('21:00')
  await page.getByText('quote ran out').first().waitFor({ timeout: 10_000 })
  check('pay: the quote expires after 20 minutes and offers a new one', (await page.getByRole('button', { name: 'New quote' }).count()) > 0)
  await shotFull(page, 'gully-invoice-quote-expired')
  await w.verify()
  await ctx.close()

  // The chain picker on a checkout taking every asset: every chain where the treasury Safe is deployed, each with its
  // own mark, and none of the chains where it is not (OP Mainnet, Polygon, Avalanche in the harness's matrix).
  const invAll = await adminCall('/api/admin/invoices', { title: 'E2E: every chain', usd: '12' })
  const allIds = (invAll.data?.invoice?.assets ?? []).map((a) => a.id)
  check(`pay: an invoice with no asset list takes every offered asset (${PLANS.assets.length}, as /api/plans lists)`, invAll.status === 201 && PLANS.assets.length > 0 && allIds.length === PLANS.assets.length && PLANS.assets.every((a) => allIds.includes(a.id)), `${allIds.length} vs ${PLANS.assets.length}`)
  check('pay: that invoice offers no asset on a chain where the treasury is not deployed', invAll.status === 201 && !invAll.data.invoice.assets.some((a) => TREASURY_UNDEPLOYED_CHAINS.includes(a.chainId)), allIds.join())
  const ctx3 = await newContext()
  const p3 = await ctx3.newPage()
  const w3 = watch(p3, 'pay page (every chain)')
  await p3.goto(`${BASE}/pay/${invAll.data.invoice.id}`)
  const picker = p3.getByRole('radiogroup', { name: 'Pay with' })
  await picker.getByRole('radio', { name: 'USDT on BNB Chain' }).waitFor({ timeout: 10_000 })
  check('pay: the picker lists every offered asset (USDC on Base, USDT on Ethereum, BNB on BNB Chain, ETH on Arbitrum…)', (await picker.getByRole('radio').count()) === PLANS.assets.length && (await picker.getByRole('radio', { name: 'USDC on Base' }).count()) === 1 && (await picker.getByRole('radio', { name: 'USDT on Ethereum' }).count()) === 1 && (await picker.getByRole('radio', { name: 'BNB on BNB Chain' }).count()) === 1 && (await picker.getByRole('radio', { name: 'ETH on Arbitrum' }).count()) === 1)
  check('pay: the picker offers nothing on OP Mainnet, Polygon or Avalanche (treasury not deployed there)', (await picker.getByRole('radio', { name: / on (OP Mainnet|Polygon|Avalanche)$/ }).count()) === 0)
  check(`pay: the picker shows ${OFFERED.length} chain groups with their marks (real logo files, no letter tiles)`, (await picker.locator('img[src^="/chains/"]').count()) >= OFFERED.length && (await picker.locator('img[src="/chains/arbitrum.svg"]').count()) >= 1 && (await picker.locator('img[src="/chains/ethereum.svg"]').count()) >= 1 && (await picker.locator('img[src^="/chains/optimism"], img[src^="/chains/polygon"], img[src^="/chains/avalanche"]').count()) === 0)
  await picker.getByRole('radio', { name: 'USDT on BNB Chain' }).click()
  await p3.getByRole('img', { name: /^Wallet payment request: .* USDT on BNB Chain/ }).waitFor({ timeout: 10_000 })
  check('pay: a USDT on BNB Chain quote shows its QR and says 15 confirmations', (await p3.getByText(/counts after 15 confirmations/).count()) > 0)
  await w3.verify()
  await ctx3.close()
  // The paid state, from the server's own shape with a payment on it (no chain in the suite can confirm one).
  const real = await (await fetch(`${BASE}/api/pay/${invId}`)).json()
  const usdc = real.invoice.assets.find((a) => a.id === 'base-usdc')
  const paid = { ...real.invoice, status: 'paid', paidAt: new Date().toISOString(), payment: paidPayment(usdc, real.invoice.checkout.treasury, '25.000042', '25.00') }
  for (const width of [1440, 390]) {
    const c = await newContext(width === 390 ? { width: 390, height: 844, mobile: true } : {})
    await c.route(`${BASE}/api/pay/${invId}`, (route) => json(route, { invoice: paid }))
    const p = await c.newPage()
    const ww = watch(p, `paid invoice at ${width}`)
    await p.goto(`${BASE}/pay/${invId}`)
    await p.getByTestId('state-paid').waitFor()
    check(`pay paid at ${width}: receipt, download and explorer`, (await p.getByTestId('receipt').count()) === 1 && /\/receipt\?print=1$/.test(await p.getByTestId('download-receipt').getAttribute('href')))
    if (width === 390) await noHorizontalScroll(p, 'paid invoice')
    await shotFull(p, 'gully-invoice-paid')
    await ww.verify()
    await c.close()
  }

  const link = await adminCall('/api/admin/paylinks', { title: 'E2E pay link', amount: { type: 'fixed', usd: '49' }, assets: ['base-usdc'] })
  check('pay: the admin API creates a pay link', link.status === 201 && /^pl_/.test(link.data?.link?.id ?? ''))
  const ctx2 = await newContext()
  const p2 = await ctx2.newPage()
  const w2 = watch(p2, 'pay link page')
  await p2.goto(`${BASE}/pay/l/${link.data.link.id}`)
  await p2.getByTestId('link-continue').waitFor()
  await shotFull(p2, 'gully-link')
  await p2.getByRole('button', { name: 'Continue to payment' }).click()
  await p2.waitForURL(/\/pay\/inv_/)
  check('pay link: continue makes an invoice and opens its checkout', true)
  await w2.verify()
  await ctx2.close()
})

/* ------------------------------------------------------- merchant: Safe deployment --- */

// The store's wallet is the fixture's second Safe (the one deployed live on Base Sepolia through the server's
// calldata; here a Safe on Base with no code on Arbitrum or BNB Chain). The rows for the undeployed chains carry
// "Deploy Safe on <chain>"; the panel plans through the server (stubbed chains with real Safe 1.4.1 bytes) and
// stops at "Connect a wallet to deploy": no wallet in Playwright, so nothing is sent.
await step('merchant safe', async () => {
  const SAFE = SAFE_FIXTURE.safe2.address
  const owner2 = privateKeyToAccount(generatePrivateKey())
  const api3 = makeClient(BASE)
  check('safe: a store owner signs in', (await api3.signIn(owner2)).status === 200)
  const w1 = await api3.post('/api/developer/merchant/wallets', { address: SAFE, type: 'contract', chains: [8453, 42161, 56], acceptTerms: true })
  const res = (id) => w1.data?.results?.find((r) => r.chainId === id)
  check('safe: the Safe is accepted on Base and refused (not deployed) on Arbitrum and BNB Chain', w1.status === 200 && res(8453)?.ok && res(42161)?.ok === false && res(56)?.ok === false, JSON.stringify(w1.data?.results))
  const ctx = await newContext({ cookie: cookieOf(api3) })
  const page = await ctx.newPage()
  const w = watch(page, 'merchant safe')
  w.expect(/\/api\/developer\/merchant\/safe\/plan/) // the BNB Chain plan below is a 422 on purpose (no Safe factory there)
  await page.goto(BASE + '/developers#merchant/wallets')
  const wallets = page.locator('#m-wallets')
  await wallets.waitFor({ timeout: 15_000 })
  check('safe: the Arbitrum row says not deployed and offers the Deploy button', (await wallets.getByRole('button', { name: 'Deploy Safe on Arbitrum' }).count()) === 1 && (await wallets.getByText('not deployed').count()) >= 2)
  await wallets.getByRole('button', { name: 'Deploy Safe on Arbitrum' }).click()
  const panel = wallets.locator('[data-testid="safe-deploy"]')
  await panel.waitFor({ timeout: 20_000 })
  await panel.getByText('address verified').waitFor({ timeout: 20_000 })
  check('safe: the plan shows the Safe address verified, copied from Base, 1 owner, threshold 1', /Copied from/.test(await panel.textContent()) && /1 owner, threshold 1/.test(await panel.textContent()))
  check('safe: the gas estimate is shown before anything is sent', /0\.00023688 ETH/.test((await panel.locator('[data-testid="safe-gas"]').textContent()) ?? ''))
  check('safe: every check passed and is listed (factory, singleton, prediction)', (await panel.getByRole('list', { name: 'Checks' }).locator('li').count()) >= 5 && /code hash matches/.test(await panel.textContent()))
  check('safe: with no wallet the button says Connect a wallet to deploy', (await panel.getByRole('button', { name: 'Connect a wallet to deploy' }).count()) === 1)
  await panel.getByRole('button', { name: 'Close' }).click()
  await wallets.getByRole('button', { name: 'Deploy Safe on BNB Chain' }).click()
  const refused = wallets.locator('[data-testid="safe-deploy"]')
  await refused.getByText('Not offered.').waitFor({ timeout: 20_000 })
  check('safe: BNB Chain (no Safe factory there) is refused with the failing check named', /not deployed on BNB Chain/.test(await refused.textContent()) && (await refused.getByRole('list', { name: 'Checks' }).locator('li').count()) >= 2)
  await refused.getByRole('button', { name: 'Close' }).click()
  // Create a new Safe: the form, then the plan with the predicted address.
  await wallets.getByTestId('new-safe-open').click()
  const ns = wallets.getByTestId('new-safe')
  await ns.locator('textarea').fill(owner2.address)
  await ns.getByRole('radio', { name: 'Arbitrum' }).click()
  await ns.getByTestId('new-safe-plan').click()
  const np = ns.locator('[data-testid="safe-deploy"]')
  await np.getByText('address verified').waitFor({ timeout: 20_000 })
  check('safe: a new 1-of-1 Safe is planned with its address known before sending', /New Safe/.test(await np.textContent()) && /SafeL2 1\.4\.1, 1 owner, threshold 1/.test(await np.textContent()) && (await np.getByRole('button', { name: 'Connect a wallet to deploy' }).count()) === 1)
  const rec = await api3.call('/api/developer/merchant/safe')
  check('safe: the new Safe is recorded for the store with its salt nonce', rec.status === 200 && rec.data.safes.length === 1 && /^0x[0-9a-f]+$/.test(rec.data.safes[0].saltNonce), JSON.stringify(rec.data.safes))
  await w.verify()
  await ctx.close()
})

/* ------------------------------------------------------------- merchant checkout --- */

// A store's logo for the suite: a 96 px PNG drawn here (a disc in the store's accent), served from loopback.
function storeLogoPng(size = 96) {
  const row = size * 4 + 1
  const raw = Buffer.alloc(row * size)
  const cx = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    raw[y * row] = 0
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cx)
      const i = y * row + 1 + x * 4
      const inside = d <= size / 2 - 1
      const ring = inside && d >= size / 2 - 12 && d <= size / 2 - 6
      raw[i] = ring ? 0xf4 : 0x3f
      raw[i + 1] = ring ? 0xf2 : 0xa7
      raw[i + 2] = ring ? 0xec : 0xd6
      raw[i + 3] = inside ? 255 : 0
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

await step('merchant checkout', async () => {
  const LOGO = storeLogoPng()
  const logoHost = http.createServer((req, res) => (req.url === '/logo.png' ? (res.writeHead(200, { 'content-type': 'image/png' }), res.end(LOGO)) : (res.writeHead(404), res.end())))
  await new Promise((r) => logoHost.listen(0, '127.0.0.1', r))
  try {
    // The store: the owner's wallet receives on Base; links and an itemised invoice.
    const wallets = await api.post('/api/developer/merchant/wallets', { acceptTerms: true, address: owner.address, type: 'eoa', chains: [8453] })
    check('merchant: a receiving wallet on Base is accepted', wallets.status === 200, JSON.stringify(wallets.data).slice(0, 160))
    const link = await api.post('/api/developer/merchant/links', { title: 'Bag of beans', description: '1 kg, whole bean. Roasted this week.', amount: { type: 'fixed', usd: '10' }, assets: ['base-usdc', 'base-eth'] })
    check('merchant: a pay link is made', link.status === 201 && /^ml_/.test(link.data?.link?.id ?? ''), JSON.stringify(link.data).slice(0, 160))
    const linkPath = `/pay/m/l/${link.data.link.id}`
    const closedLink = await api.post('/api/developer/merchant/links', { title: 'Arbitrum only', amount: { type: 'fixed', usd: '5' }, assets: ['arb-usdc'] })
    check('merchant: a link on a chain without a wallet is made', closedLink.status === 201)
    const shortLived = await api.post('/api/developer/merchant/links', { title: 'Flash sale', amount: { type: 'fixed', usd: '5' }, assets: ['base-usdc'], expiresAt: new Date(Date.now() + 1500).toISOString() })
    check('merchant: a link with a short expiry is made', shortLived.status === 201)
    const invoice = await api.post('/api/developer/merchant/invoices', { items: [{ description: 'Espresso machine service', quantity: 1, unitUsd: '180' }, { description: 'Descaler, 500 ml', quantity: 2, unitUsd: '12.50' }], dueDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), customer: { name: 'Jane Doe' }, notes: 'Thanks for your order. Collection from the shop once paid.' })
    check('merchant: an itemised invoice is made', invoice.status === 201 && /^mi_/.test(invoice.data?.invoice?.id ?? ''), JSON.stringify(invoice.data).slice(0, 160))
    const invPath = `/pay/m/${invoice.data.invoice.id}`

    // 1. The store has no profile yet: "Store" with the owner's address and the neutral glyph, never a letter tile.
    const anon = await newContext()
    const page = await anon.newPage()
    const w = watch(page, 'unnamed store link')
    await page.goto(BASE + linkPath)
    await page.getByTestId('link-continue').waitFor()
    await checkStandalone(page, 'unnamed store')
    check('unnamed store: says "Store" with the owner address chip and a store glyph', (await page.getByTestId('store-name').textContent()) === 'Store' && (await page.getByTestId('store-owner').count()) === 1 && (await page.getByTestId('store-glyph').count()) === 1)
    check('unnamed store: no "workspace" anywhere', (await page.getByText(/workspace/i).count()) === 0)
    check('unnamed store: title "Pay Store"', (await page.title()) === 'Pay Store', await page.title())
    await shotFull(page, 'merchant-link-unnamed')
    await w.verify()
    await anon.close()

    // The owner's portal prompts for the profile; then the profile is set (name, logo, accent, email, website).
    const own = await newContext({ cookie: cookieOf(api) })
    const op = await own.newPage()
    const ow = watch(op, 'merchant tab prompt')
    ow.expect(/\/api\/developer\//)
    await op.goto(BASE + '/developers#merchant')
    await op.getByTestId('finish-profile').waitFor({ timeout: 15_000 })
    check('portal: the Merchant tab asks the owner to finish the store profile', true)
    // Real sub-tabs (one section at a time, icons, deep links, remembered), the setup stepper, the live network strip.
    const mt = op.getByRole('tablist', { name: /Merchant/i })
    await mt.waitFor()
    const mtabs = await mt.getByRole('tab').evaluateAll((els) => els.map((e) => [e.textContent.trim(), !!e.querySelector('svg')]))
    check('merchant: seven sub-tabs, each with an icon', mtabs.length === 7 && mtabs.every(([, i]) => i), JSON.stringify(mtabs))
    check('merchant: the 4-step setup stepper', (await op.locator('[data-testid="merchant-stepper"] [data-step]').count()) === 4 || (await op.locator('[data-testid="merchant-stepper"][data-folded]').count()) === 1)
    await op.getByTestId('merchant-network').waitFor({ timeout: 15_000 })
    check('merchant: the NETWORK · LIVE strip names the accepted chains', /\d+ chains/.test((await op.getByTestId('accepting-chains').textContent()) ?? ''))
    await mt.getByRole('tab', { name: /^Links/ }).click()
    check('merchant: a sub-tab deep-links as #merchant/links', new URL(op.url()).hash === '#merchant/links', op.url())
    check('merchant: only one section shows at a time', (await op.locator('[data-sub-panel]').count()) === 1)
    await op.goto(BASE + '/developers#merchant')
    await mt.waitFor()
    check('merchant: the last sub-tab is remembered', (await mt.getByRole('tab', { selected: true }).textContent())?.trim().startsWith('Links'))
    await mt.getByRole('tab', { name: /^Wallets/ }).click()
    await op.getByTestId('wallet-remove').first().click()
    const confirm = op.getByTestId('merchant-confirm')
    await confirm.waitFor()
    check('merchant: removing a wallet asks first', await confirm.isVisible())
    await op.keyboard.press('Escape')
    await confirm.waitFor({ state: 'detached' })
    await mt.getByRole('tab', { name: /^Invoices/ }).click()
    await op.getByTestId('invoice-cancel').first().click()
    await confirm.waitFor()
    check('merchant: cancelling an invoice asks first', await confirm.isVisible())
    await op.keyboard.press('Escape')
    await confirm.waitFor({ state: 'detached' })
    check('merchant: the wallet and the invoice are still there after backing out', (await op.getByTestId('invoice-cancel').count()) >= 1)
    await ow.verify([/li\.quest|lifi|wagmi|ERR_BLOCKED_BY_CLIENT/i])
    const prof = await api.post('/api/developer/merchant/profile', { name: 'Acme Coffee', logoUrl: `http://127.0.0.1:${logoHost.address().port}/logo.png`, accent: '#3fa7d6', supportEmail: 'help@acme.example', website: 'https://acme.example' })
    check('merchant: the profile is saved with a logo', prof.status === 200 && !!prof.data?.profile?.logoUrl, JSON.stringify(prof.data?.profile ?? prof.data).slice(0, 160))

    // 2. The open link at 1440 and 390: order summary, store branding, accent, sticky Pay bar on the phone.
    for (const width of [1440, 390]) {
      const c = await newContext(width === 390 ? { width: 390, height: 844, mobile: true } : {})
      const p = await c.newPage()
      const ww = watch(p, `store link at ${width}`)
      await p.goto(BASE + linkPath)
      await p.getByTestId('link-continue').waitFor()
      check(`store link at ${width}: the store's name, logo, contact and accent`, (await p.getByTestId('store-name').textContent()) === 'Acme Coffee' && (await p.locator('header img[alt="Acme Coffee logo"]').count()) === 1 && (await p.getByTestId('store-contact').textContent()).includes('help@acme.example') && /3fa7d6|63, 167, 214/.test(await p.evaluate(() => document.querySelector('main').parentElement.style.borderTop)))
      check(`store link at ${width}: title "Pay Acme Coffee"`, (await p.title()) === 'Pay Acme Coffee')
      check(`store link at ${width}: the order summary shows the item and total`, /\b10(\.00)?\b/.test(await p.getByTestId('order-total').textContent()) && (await p.getByTestId('order-items').getByText('Bag of beans').count()) === 1, `${await p.getByTestId('order-total').textContent()} / ${await p.getByTestId('order-items').getByText('Bag of beans').count()}`)
      if (width === 390) {
        await noHorizontalScroll(p, 'store link')
        check('store link at 390: a sticky Pay bar', await p.getByRole('region', { name: 'Pay', exact: true }).isVisible())
      }
      await shotFull(p, 'merchant-link-open')
      await ww.verify()
      await c.close()
    }

    // 3. Continue → the invoice checkout: network and token, exact amount, Pay with wallet / Scan QR, timer, status.
    for (const width of [1440, 390]) {
      const c = await newContext(width === 390 ? { width: 390, height: 844, mobile: true } : {})
      const p = await c.newPage()
      await p.clock.install()
      const ww = watch(p, `store invoice at ${width}`)
      await p.goto(BASE + linkPath)
      await p.getByRole('radiogroup', { name: 'Pay with' }).getByRole('radio', { name: 'USDC on Base' }).click()
      await p.getByTestId('link-continue').click()
      await p.waitForURL(/\/pay\/m\/mi_/)
      await p.getByTestId('quote-amount').waitFor({ timeout: 10_000 })
      check(`store invoice at ${width}: the quote names the amount, the timer runs, Pay with wallet is primary`, (await p.getByRole('timer').count()) > 0 && (await p.getByTestId('pay-with-wallet').count()) === 1)
      if (width === 390) {
        check('store invoice at 390: the QR waits behind "Scan QR"', (await p.getByRole('img', { name: /^Wallet payment request:/ }).count()) === 0)
        await p.getByTestId('scan-qr').click()
        await noHorizontalScroll(p, 'store invoice')
      }
      await p.getByRole('img', { name: /^Wallet payment request:/ }).waitFor({ timeout: 10_000 })
      check(`store invoice at ${width}: the QR names the store`, /to Acme Coffee$/.test(await p.getByRole('img', { name: /^Wallet payment request:/ }).getAttribute('aria-label')))
      check(`store invoice at ${width}: status waiting`, (await p.getByTestId('status-track').getAttribute('data-step')) === '0')
      if (width === 390) {
        // DA3 D14: at 320 every step label of the status track wraps whole (none clipped, none overlapping its neighbour).
        await p.setViewportSize({ width: 320, height: 844 })
        await p.waitForTimeout(200)
        const track = await p.getByTestId('status-track').locator('li').evaluateAll((lis) => lis.map((li) => { const t = li.querySelector('span:last-child > span:last-child'); const r = li.getBoundingClientRect(); return { clipped: t.scrollWidth > t.clientWidth + 1, l: r.left, r: r.right } }))
        check('status track at 320: no label is clipped and the four steps do not overlap', track.length === 4 && track.every((x, i) => !x.clipped && (i === 0 || x.l >= track[i - 1].r - 0.5)), JSON.stringify(track))
        await noHorizontalScroll(p, 'status track at 320')
        await p.setViewportSize({ width: 390, height: 844 })
      }
      check(`store invoice at ${width}: the header has a copy-link button, not a raw URL`, (await p.getByTestId('copy-link').count()) === 1 && !/\/pay\/m\/mi_/.test((await p.getByRole('region', { name: 'Payment' }).locator('header').first().textContent()) ?? ''))
      if (width === 1440) {
        await p.getByTestId('pay-aside-content').locator('[data-live]').first().waitFor({ timeout: 10_000 }).catch(() => {})
        check('store invoice at 1440: the left column holds a live chart and the QR', (await p.getByTestId('pay-aside-content').locator('[data-live]').count()) > 0 && (await p.getByTestId('pay-aside-content').getByRole('img', { name: /^Wallet payment request:/ }).count()) === 1)
      }
      await shotFull(p, 'merchant-invoice-quote')
      if (width === 1440) {
        await p.clock.fastForward('21:00')
        await p.getByText('quote ran out').first().waitFor({ timeout: 10_000 })
        check('store invoice: an expired quote offers a new one', (await p.getByRole('button', { name: 'New quote' }).count()) > 0)
        await shotFull(p, 'merchant-invoice-quote-expired')
      }
      await ww.verify()
      await c.close()
    }

    // 4. The itemised invoice: line items, quantities, prices, subtotal and total; billed to; due date.
    {
      const c = await newContext()
      const p = await c.newPage()
      const ww = watch(p, 'itemised invoice')
      await p.goto(BASE + invPath)
      await p.getByTestId('order-total').waitFor()
      check('itemised invoice: two lines, quantities and the total', (await p.getByTestId('order-items').locator('tbody tr').count()) === 2 && /\b205(\.00)?\b/.test(await p.getByTestId('order-total').textContent()) && (await p.getByText('Jane Doe').count()) === 1, `${await p.getByTestId('order-items').locator('tbody tr').count()} rows / ${await p.getByTestId('order-total').textContent()} / Jane ${await p.getByText('Jane Doe').count()}`)
      await shotFull(p, 'merchant-invoice-items')
      await ww.verify()
      await c.close()
    }

    // 5. Closed: a link whose chain has no receiving wallet. Payers see who to contact; the owner sees what to fix.
    for (const [label, opts] of [
      ['payer at 1440', {}],
      ['payer at 390', { width: 390, height: 844, mobile: true }],
      ['owner at 1440', { cookie: cookieOf(api) }],
    ]) {
      const c = await newContext(opts)
      const p = await c.newPage()
      const ww = watch(p, `closed link, ${label}`)
      await p.goto(`${BASE}/pay/m/l/${closedLink.data.link.id}`)
      await p.getByTestId('state-unavailable').waitFor()
      const text = await p.getByTestId('state-unavailable').textContent()
      check(`closed link, ${label}: "isn't available right now" with the store's email`, /isn't available right now/.test(text) && /help@acme\.example/.test(text))
      check(`closed link, ${label}: no payment can start`, (await p.getByTestId('link-continue').count()) === 0)
      if (opts.cookie) check('closed link, owner: sees the fix with a link to the Merchant tab', (await p.getByTestId('owner-fixes').count()) === 1 && /#merchant\/wallets$/.test(await p.getByTestId('owner-fixes').getByRole('link').first().getAttribute('href')))
      else check(`closed link, ${label}: a payer sees no owner hints`, (await p.getByTestId('owner-fixes').count()) === 0)
      if (opts.width === 390) await noHorizontalScroll(p, 'closed link')
      await shotFull(p, opts.cookie ? 'merchant-link-closed-owner' : 'merchant-link-closed')
      await ww.verify([/li\.quest|lifi|wagmi|ERR_BLOCKED_BY_CLIENT/i])
      await c.close()
    }

    // 6. Expired link.
    await new Promise((r) => setTimeout(r, Math.max(0, 1600 - (Date.now() - Date.parse(shortLived.data.link.createdAt)))))
    for (const width of [1440, 390]) {
      const c = await newContext(width === 390 ? { width: 390, height: 844, mobile: true } : {})
      const p = await c.newPage()
      const ww = watch(p, `expired link at ${width}`)
      await p.goto(`${BASE}/pay/m/l/${shortLived.data.link.id}`)
      await p.getByTestId('state-link-expired').waitFor()
      check(`expired link at ${width}: says so and offers no payment`, /has expired/.test(await p.getByTestId('state-link-expired').textContent()) && (await p.getByTestId('link-continue').count()) === 0)
      if (width === 390) await noHorizontalScroll(p, 'expired link')
      await shotFull(p, 'merchant-link-expired')
      await ww.verify()
      await c.close()
    }

    // 7. Paused (an unpaid statement) and max uses: the server's own shapes with the state set, as no week passes in the suite.
    const realLink = await (await fetch(`${BASE}/api/pay/m/l/${link.data.link.id}`)).json()
    for (const [name, patch, testId] of [
      ['merchant-link-paused', { checkout: { enabled: false, treasury: null, paused: true, reason: "This store's checkout is paused. Contact the store to pay another way." } }, 'state-paused'],
      ['merchant-link-used-up', { state: 'used-up', stateText: 'This payment link has been used the maximum number of times.' }, 'state-link-used-up'],
    ]) {
      const c = await newContext()
      await c.route(`${BASE}/api/pay/m/l/${realLink.link.id}`, (route) => json(route, { link: { ...realLink.link, ...patch }, viewer: null }))
      const p = await c.newPage()
      const ww = watch(p, name)
      await p.goto(BASE + linkPath)
      await p.getByTestId(testId).waitFor()
      check(`${name}: shown, with the store's contact, and no payment can start`, /help@acme\.example/.test(await p.getByTestId(testId).textContent()) && (await p.getByTestId('link-continue').count()) === 0)
      await shotFull(p, name)
      await ww.verify()
      await c.close()
    }

    // 8. Paid: animated check, receipt, Download receipt, Return to store; the printable receipt names the store.
    const realInv = await (await fetch(`${BASE}/api/pay/m/i/${invoice.data.invoice.id}`)).json()
    const usdc = realInv.invoice.assets.find((a) => a.id === 'base-usdc')
    const paidInv = { ...realInv.invoice, status: 'paid', paidAt: new Date().toISOString(), payment: paidPayment(usdc, realInv.invoice.recipients['8453'], '205.000077', '205.00') }
    for (const width of [1440, 390]) {
      const c = await newContext(width === 390 ? { width: 390, height: 844, mobile: true } : {})
      await c.route(`${BASE}/api/pay/m/i/${invoice.data.invoice.id}`, (route) => json(route, { invoice: paidInv, viewer: null }))
      const p = await c.newPage()
      const ww = watch(p, `paid store invoice at ${width}`)
      await p.goto(BASE + invPath)
      await p.getByTestId('state-paid').waitFor()
      check(`paid store invoice at ${width}: receipt, download and Return to store`, (await p.getByTestId('receipt').count()) === 1 && /\/pay\/m\/mi_[\w-]+\/receipt\?print=1$/.test(await p.getByTestId('download-receipt').getAttribute('href')) && (await p.getByTestId('return-to-store').getAttribute('href')) === 'https://acme.example/')
      check(`paid store invoice at ${width}: status Paid`, (await p.getByTestId('status-pill').textContent()) === 'Paid' && (await p.getByRole('region', { name: 'Pay', exact: true }).count()) === 0)
      if (width === 390) await noHorizontalScroll(p, 'paid store invoice')
      await shotFull(p, 'merchant-invoice-paid')
      if (width === 1440) {
        await p.getByRole('link', { name: 'View receipt' }).click()
        await p.waitForURL(/\/receipt$/)
        await p.getByTestId('receipt-page').waitFor()
        check('store receipt: names the store, the lines and PAID IN FULL', (await p.getByText('PAID IN FULL').count()) === 1 && (await p.getByTestId('receipt-page').getByText('Acme Coffee').count()) >= 1 && (await p.getByTestId('receipt-page').getByText('Descaler, 500 ml').count()) === 1)
        // P1-7: a live chart on the receipt (screen only): the confirmations ring draws from the invoice API.
        const live = p.getByTestId('receipt-live')
        await live.scrollIntoViewIfNeeded()
        check('store receipt: a live chart draws on screen', await live.locator('[data-chart]').first().waitFor({ timeout: 15_000 }).then(() => p.waitForFunction(() => !!document.querySelector('[data-testid="receipt-live"] [data-chart] svg'), null, { timeout: 15_000 })).then(() => true, () => false))
        await shotFull(p, 'merchant-receipt')
      }
      await ww.verify()
      await c.close()
    }
  } finally {
    logoHost.close()
  }
})

/* ------------------------------------------------------------- admin --- */

await step('admin', async () => {
  const ctx = await newContext()
  await ctx.addInitScript((tok) => sessionStorage.setItem('gully-admin-token', tok), admin)
  const page = await ctx.newPage()
  const w = watch(page, 'admin')
  // The admin shows one section at a time (N10): the URL hash picks it, the nav chips and [ ] keys switch it.
  await page.goto(BASE + '/admin#pay')
  await page.getByRole('heading', { name: 'Invoices' }).waitFor({ timeout: 15_000 })
  check('admin: a deep link (#pay) opens only that section', (await page.locator('[data-admin-section]').count()) === 1 && (await page.locator('[data-admin-section="pay"]').count()) === 1 && (await page.locator('a[aria-current="true"]').first().getAttribute('id')) === 'adm-nav-pay')
  check('admin: the Pay links section renders', (await page.getByRole('heading', { name: 'Pay links' }).count()) > 0)
  check('admin: the section is short (not one 14,000 px page)', (await page.evaluate(() => document.documentElement.scrollHeight)) < 6000)
  await page.locator('a#adm-nav-developers').click()
  await page.getByRole('heading', { name: 'Developer wallets' }).waitFor({ timeout: 10_000 })
  check('admin: a nav chip switches the section and the hash', page.url().endsWith('#developers') && (await page.getByRole('heading', { name: 'Invoices' }).count()) === 0)
  await page.keyboard.press(']')
  await page.waitForFunction(() => location.hash === '#alerts')
  await page.locator('a#adm-nav-alerts').focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(() => location.hash === '#workspaces')
  await page.waitForSelector('a#adm-nav-workspaces[aria-current="true"]', { timeout: 5_000 }).catch(() => {})
  check('admin: "]" and the arrow keys step through the sections', (await page.locator('a#adm-nav-workspaces').getAttribute('aria-current')) === 'true')
  await page.goto(BASE + '/admin#analytics')
  await page.getByRole('heading', { name: 'Gully Analytics' }).first().waitFor({ timeout: 15_000 })
  check('admin: the Gully Analytics section renders', (await page.getByRole('heading', { name: 'Gully Analytics' }).count()) > 0)
  await page.goto(BASE + '/admin#billing')
  await page.getByRole('heading', { name: 'Treasury Safe' }).waitFor({ timeout: 15_000 })
  check('admin: the Treasury Safe section renders', (await page.getByRole('heading', { name: 'Treasury Safe' }).count()) > 0)
  // The invoice made above is listed in the Pay section.
  await page.goto(BASE + '/admin#pay')
  await page.getByRole('heading', { name: 'Invoices' }).waitFor({ timeout: 15_000 })
  check('admin: the invoice made above is listed', (await page.getByText('E2E: first month').count()) > 0)
  await page.goto(BASE + '/admin#billing')
  // Treasury Safe (the harness's chain matrix): the Safe on Base, Ethereum, BNB Chain and Arbitrum; OP Mainnet,
  // Polygon and Avalanche are payment chains where it is not deployed yet, so they say "not deployed" and offer
  // Deploy. The demo deploys on Avalanche and reaches "connect a wallet".
  const base = page.getByTestId('treasury-chain-8453')
  await base.getByText(/Safe 1\.4\.1/).waitFor({ timeout: 15_000 })
  check('admin treasury: Base shows the Safe (1.4.1, 1/1) and Avalanche offers Deploy', (await base.getByText(/Safe 1\.4\.1 · 1\/1/).count()) === 1 && (await page.getByRole('button', { name: 'Deploy Safe on Avalanche' }).count()) === 1)
  const deployedRowsOk = await Promise.all(TREASURY_DEPLOYED_CHAINS.map(async (id) => (await page.getByTestId(`treasury-chain-${id}`).getByText(/Safe 1\.4\.1 · 1\/1/).count()) === 1))
  check('admin treasury: every chain where the Safe is deployed (Base, Ethereum, BNB Chain, Arbitrum) shows it, with no Deploy button', deployedRowsOk.every(Boolean) && (await page.getByRole('button', { name: /^Deploy Safe on (Base|Ethereum|BNB Chain|Arbitrum)$/ }).count()) === 0, JSON.stringify(deployedRowsOk))
  const closedRowsOk = await Promise.all(TREASURY_UNDEPLOYED_CHAINS.map(async (id) => { const r = page.getByTestId(`treasury-chain-${id}`); return (await r.getByText('not deployed', { exact: true }).count()) === 1 && (await r.getByRole('button', { name: `Deploy Safe on ${CLOSED[id]}` }).count()) === 1 }))
  check('admin treasury: OP Mainnet, Polygon and Avalanche (payment chains, Safe not deployed) say "not deployed" and offer Deploy', closedRowsOk.every(Boolean), JSON.stringify(closedRowsOk))
  check('admin treasury: every row is a payment chain now (no "ahead of payments" label)', (await page.getByText('ahead of payments').count()) === 0)
  await page.getByRole('button', { name: 'Deploy Safe on Avalanche' }).click()
  const tp = page.getByTestId('treasury-chain-43114').locator('[data-testid="safe-deploy"]')
  await tp.getByText('address verified').waitFor({ timeout: 20_000 })
  check('admin treasury: the plan predicts the treasury address, prices the gas in AVAX and waits for a wallet', /0\.00023688 AVAX/.test(await tp.textContent()) && (await tp.getByRole('button', { name: 'Connect a wallet to deploy' }).count()) === 1)
  // Live charts (N1/N3/N32): every card is a live chart or a collapsed ghost, never a blank axis box.
  await page.goto(BASE + '/admin#overview')
  await page.getByRole('heading', { name: 'Live charts' }).waitFor({ timeout: 15_000 })
  await page.getByRole('heading', { name: 'Webhook delivery' }).waitFor({ timeout: 15_000 })
  await page.waitForTimeout(1500)
  const cards = await page.locator('section[aria-label="Live charts"] section').evaluateAll((els) => els.map((e) => ({ title: e.querySelector('h3')?.textContent ?? '', ghost: e.querySelector('[data-ghost]')?.getBoundingClientRect().height ?? 0, chart: e.querySelectorAll('[data-chart]').length, live: [...e.querySelectorAll('[data-live]')].length })))
  check('admin charts: all seven cards have a chart or a ghost', cards.length === 7 && cards.every((c) => c.chart > 0 || c.ghost > 0), JSON.stringify(cards))
  check('admin charts: an empty chart is a ghost collapsed to about 90 px', cards.filter((c) => c.ghost > 0).every((c) => c.ghost >= 80 && c.ghost <= 110), JSON.stringify(cards))
  check('admin charts: real charts are in live mode (data-live)', cards.filter((c) => c.chart > 0).every((c) => c.live > 0), JSON.stringify(cards))
  const noise = await page.evaluate(() => /\[object Object\]|\bundefined\b|\bNaN\b|\bnull\b/.test(document.body.innerText))
  check('admin: no developer noise on the overview', !noise)
  // Chain and asset names carry their logos.
  await page.goto(BASE + '/admin#pay')
  await page.getByRole('heading', { name: 'Pay links' }).first().waitFor({ timeout: 15_000 })
  await page.waitForTimeout(1200)
  const logos = await page.locator('main img').evaluateAll((els) => els.map((i) => i.complete && i.naturalWidth > 0))
  check('admin: chain and asset logos load', logos.length > 0 && logos.every(Boolean), `${logos.filter(Boolean).length}/${logos.length}`)
  // Tap targets (N36): every visible control is 44 px high.
  for (const sec of ['health', 'overview', 'traffic', 'developers', 'alerts', 'workspaces', 'security', 'telegram', 'billing', 'pay', 'analytics', 'chainkit', 'inbox', 'ai']) {
    await page.goto(BASE + '/admin#' + sec)
    await page.waitForTimeout(1500)
    const small = await page.locator('main').locator('button, select, input:not([type=checkbox]):not([type=radio]), textarea, a[href], summary').evaluateAll((els) => els.filter((e) => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && !e.closest('.sr-only') && r.height < 43.5 }).map((e) => `${e.tagName} ${(e.textContent ?? '').trim().slice(0, 24)} ${Math.round(e.getBoundingClientRect().height)}`))
    check(`admin #${sec}: every control is at least 44 px high`, small.length === 0, small.slice(0, 6).join(' | '))
  }
  if (process.env.ADMIN_SHOTS) {
    for (const [width, mobile] of [[1440, false], [390, true]]) {
      const sctx = await newContext({ width, height: mobile ? 844 : 900, mobile })
      await sctx.addInitScript((tok) => sessionStorage.setItem('gully-admin-token', tok), admin)
      const sp = await sctx.newPage()
      for (const sec of ['health', 'overview', 'traffic', 'pay', 'billing', 'ai']) {
        await sp.goto(BASE + '/admin#' + sec)
        await sp.waitForTimeout(2500)
        await sp.screenshot({ path: path.join(process.env.ADMIN_SHOTS, `admin-${sec}-${width}.png`), fullPage: true })
      }
      await sctx.close()
    }
  }
  // Tracker health and venues read live upstreams this server cannot reach here.
  await w.verify([/Failed to load resource/])
  await ctx.close()
})

/* ------------------------------------------------------------- Gully Security --- */

// The REAL scan engine (server/security) runs; its outbound calls (explorers, GitHub, RPC, Claude) are answered
// by scripts/fixtures/security-engine-stubs.mjs, and the static-tools worker is absent as on the server today, so
// reports are "AI review only". Fresh wallets, so the free quota (1 on Free) is known.
await step('security', async () => {
  const { installEngineStubs } = await import('./fixtures/security-engine-stubs.mjs')
  const stubs = await installEngineStubs()
  stubs.setDelay(700)
  const secOwner = privateKeyToAccount(generatePrivateKey())
  const secApi = makeClient(BASE)
  check('security: a fresh wallet signs in', (await secApi.signIn(secOwner)).status === 200)
  let reportId = null
  let findingCount = 0

  // The stepper at 1440: input -> scope & cost -> running -> report; then publish.
  {
    const ctx = await newContext({ cookie: cookieOf(secApi) })
    const page = await ctx.newPage()
    const w = watch(page, 'security stepper 1440')
    await page.goto(BASE + '/developers#security-new')
    await page.getByTestId('stepper').waitFor({ timeout: 15_000 })
    check('security: the sidebar has Security with its icon', (await page.getByRole('navigation', { name: 'App pages' }).getByRole('link', { name: /^Security/ }).locator('svg').count()) > 0)
    check('security: sub-tabs are a real tablist with icons', (await page.getByRole('tablist', { name: 'Security sections' }).getByRole('tab').count()) === 5 && (await page.getByRole('tab', { name: 'New scan' }).getAttribute('aria-selected')) === 'true')
    check('security: chain choices carry the chain marks', (await page.getByRole('radiogroup', { name: 'Chain' }).locator('img').count()) >= 5)
    await shot(page, 'security-step1-input')
    await designAudit(page, `app security-step1-input at ${page.viewportSize().width}`, '[data-testid="security-tab"]')
    await page.getByRole('button', { name: /Next: scope and cost/ }).click()
    check('security: step 1 refuses a missing address', await page.getByText(/Enter the contract address/).isVisible())
    await page.getByRole('radio', { name: /Base/ }).click()
    await page.getByPlaceholder('0x…').fill('0x' + '1b'.repeat(20))
    await page.getByRole('button', { name: /Next: scope and cost/ }).click()
    await page.getByTestId('cost').waitFor()
    check('security: step 2 shows the scope, the free quota and "Free"', (await page.getByTestId('price').textContent()) === 'Free' && /on Base/.test((await page.getByTestId('scope-target').textContent()) ?? ''))
    check('security: step 2 says what the engine can run now (AI review only)', /AI review only — static tools unavailable/.test((await page.getByTestId('engine-now').textContent()) ?? ''))
    const fold = await page.getByTestId('confirm-scan').boundingBox()
    check('security: step 2 fits above the fold at 1440x900', !!fold && fold.y + fold.height <= 900, JSON.stringify(fold))
    await shot(page, 'security-step2-scope')
    await designAudit(page, `app security-step2-scope at ${page.viewportSize().width}`, '[data-testid="security-tab"]')
    await page.getByTestId('confirm-scan').click()
    await page.getByTestId('scan-progress').waitFor()
    await page.waitForFunction(() => ['fetching', 'analysing', 'triaging', 'reporting'].includes(document.querySelector('[data-testid="scan-progress"]')?.getAttribute('data-status') ?? ''), null, { timeout: 10_000 })
    check('security: step 4 shows live progress per step', (await page.locator('[data-testid="scan-progress"] [aria-current="step"]').count()) === 1)
    await shot(page, 'security-step4-running')
    await designAudit(page, `app security-step4-running at ${page.viewportSize().width}`, '[data-testid="security-tab"]')
    await page.getByTestId('report-body').waitFor({ timeout: 20_000 })
    await page.getByTestId('severity-charts').waitFor()
    check('security: the report has the mode label, charts, tools (ran and not run) and findings', /AI review only/.test((await page.getByTestId('mode-label').first().textContent()) ?? '') && (await page.locator('[data-testid="severity-charts"] [data-chart]').count()) === 2 && (await page.locator('[data-tool-status="not-run"]').count()) >= 1 && (await page.locator('[data-finding]').count()) >= 2)
    findingCount = await page.locator('[data-finding]').count()
    await page.getByRole('group', { name: 'Filter findings by severity' }).getByRole('button', { name: /^High/ }).click()
    check('security: the severity filter narrows the list', (await page.locator('[data-finding]').count()) === 1)
    await page.locator('[data-finding="GS-001"] > button').click()
    check('security: a finding expands to its location, "Draft, not executed" PoC, not verified by a human', (await page.getByTestId('poc').isVisible()) && (await page.getByTestId('poc-status').textContent()) === 'Draft, not executed' && /src\/VulnBank\.sol:21/.test((await page.locator('[data-finding="GS-001"]').textContent()) ?? '') && (await page.getByText('Not verified by a human reviewer.').count()) >= 1)
    await page.getByRole('button', { name: 'Copy', exact: true }).click()
    check('security: the PoC copies', /test_reenter/.test(await page.evaluate(() => navigator.clipboard.readText())))
    check('security: Export PDF opens the engine report in a new tab', ((await page.getByTestId('export-pdf').getAttribute('href')) ?? '').endsWith(`/report.html`) && (await page.getByTestId('export-pdf').getAttribute('target')) === '_blank')
    const head = await page.getByTestId('severity-charts').boundingBox()
    check('security: the report charts are above the fold at 1440x900', !!head && head.y < 900, JSON.stringify(head))
    await shot(page, 'security-step5-report')
    await designAudit(page, `app security-step5-report at ${page.viewportSize().width}`, '[data-testid="security-tab"]')
    reportId = await page.getByTestId('scan-detail').getAttribute('data-scan')
    await page.getByRole('switch').click()
    await page.getByTestId('public-link').waitFor()
    check('security: publishing gives the stable public link', ((await page.getByTestId('public-link').getAttribute('href')) ?? '').endsWith(`/security/reports/${reportId}`))
    // A second scan is beyond the free quota: step 2 prices it and step 3 is Gully Pay.
    await page.getByRole('tab', { name: 'New scan' }).click()
    await page.getByRole('radio', { name: /Smart contract repo/ }).click()
    await page.getByPlaceholder(/owner\/name or https/).fill(stubs.REPO)
    await page.getByRole('button', { name: /Next: scope and cost/ }).click()
    await page.getByTestId('price').filter({ hasText: /^\$/ }).waitFor({ timeout: 10_000 }).catch(() => {})
    check('security: beyond the quota step 2 shows the price', /^\$\d+/.test((await page.getByTestId('price').textContent()) ?? ''))
    await page.getByTestId('confirm-scan').click()
    await page.getByTestId('pay-step').waitFor({ timeout: 10_000 })
    check('security: step 3 is Gully Pay for the scan invoice', (await page.getByRole('link', { name: /Open the invoice page/ }).getAttribute('target')) === '_blank')
    await shot(page, 'security-step3-pay')
    await designAudit(page, `app security-step3-pay at ${page.viewportSize().width}`, '[data-testid="security-tab"]')
    await page.getByRole('tab', { name: 'Scans' }).click()
    await page.getByTestId('scan-list').waitFor()
    check('security: the scans list shows both, one awaiting payment', (await page.locator('[data-scan-row]').count()) === 2 && (await page.locator('[data-scan-row] [data-status="awaiting_payment"]').count()) === 1)
    await shot(page, 'security-scans')
    await designAudit(page, `app security-scans at ${page.viewportSize().width}`, '[data-testid="security-tab"]')
    await page.getByRole('tab', { name: 'Monitors' }).click()
    await page.getByTestId('monitor-limits').getByText(/on Business/).waitFor({ timeout: 10_000 })
    check('security: the Monitors sub-tab (part 3) with the plan limits', /1 on Free/.test((await page.getByTestId('monitor-limits').textContent()) ?? '') && /10 on Pro/.test((await page.getByTestId('monitor-limits').textContent()) ?? ''))
    await shot(page, 'security-monitors')
    await designAudit(page, `app security-monitors at ${page.viewportSize().width}`, '[data-testid="security-tab"]')
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i, /Failed to load resource/])
    await ctx.close()
  }

  // The stepper and the report viewer at 390.
  {
    const mate2 = privateKeyToAccount(generatePrivateKey())
    const m = makeClient(BASE)
    await m.signIn(mate2)
    const ctx = await newContext({ width: 390, height: 844, mobile: true, cookie: cookieOf(m) })
    const page = await ctx.newPage()
    const w = watch(page, 'security stepper 390')
    await page.goto(BASE + '/developers#security-new')
    await page.getByTestId('stepper').waitFor({ timeout: 15_000 })
    await noHorizontalScroll(page, 'security step 1')
    await shot(page, 'security-step1-input')
    await designAudit(page, `app security-step1-input at ${page.viewportSize().width}`, '[data-testid="security-tab"]')
    await page.getByRole('radio', { name: /Smart contract repo/ }).click()
    await page.getByPlaceholder(/owner\/name or https/).fill(stubs.REPO)
    await page.getByRole('button', { name: /Next: scope and cost/ }).click()
    await page.getByTestId('cost').waitFor()
    await noHorizontalScroll(page, 'security step 2')
    await shot(page, 'security-step2-scope')
    await designAudit(page, `app security-step2-scope at ${page.viewportSize().width}`, '[data-testid="security-tab"]')
    await page.getByTestId('confirm-scan').click()
    await page.getByTestId('report-body').waitFor({ timeout: 25_000 })
    await noHorizontalScroll(page, 'security report')
    await shot(page, 'security-step5-report')
    await designAudit(page, `app security-step5-report at ${page.viewportSize().width}`, '[data-testid="security-tab"]')
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }

  // Public pages: /security, the index and the published report, at 1440 and 390.
  for (const [width, mobile] of [[1440, false], [390, true]]) {
    const ctx = await newContext({ width, height: mobile ? 844 : 900, mobile })
    const page = await ctx.newPage()
    const w = watch(page, `security public pages at ${width}`)
    await page.goto(BASE + '/security')
    await page.getByRole('heading', { level: 1 }).waitFor()
    await page.locator('[data-testid="live-scans"] [data-chart]').waitFor({ timeout: 10_000 }).catch(() => {})
    check(`/security at ${width}: tiers tablist, prices from the config, a live counter of real scans`, (await page.getByRole('tablist', { name: 'Tiers' }).getByRole('tab').count()) === 3 && /^\$\d+ a scan$/.test((await page.locator('[data-tier-price="scan"]').textContent()) ?? '') && (await page.locator('[data-testid="live-scans"] [data-chart]').count()) === 1)
    check(`/security at ${width}: the scans chart is live (kit chart or ghost, never a bare dot)`, (await page.locator('[data-testid="live-scans"] [data-live], [data-testid="live-scans"] [data-ghost]').count()) >= 1)
    check(`/security at ${width}: says a scan is not an audit and offers no Audit for sale`, (await page.getByText(/is not an audit/).count()) > 0 && (await page.locator('[data-tier-price="audit"]').textContent()) === 'Not offered yet')
    check(`/security at ${width}: the review form is on the page`, (await page.getByTestId('review-form').count()) === 1)
    check(`/security at ${width}: monitoring limits per plan from the config`, /1\s*contract on Free/.test((await page.getByTestId('monitoring-pricing').textContent()) ?? ''))
    if (mobile) await noHorizontalScroll(page, '/security')
    else {
      // Open the header's Products menu: the footer lists these links as plain text, so it must not count.
      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Products' }).click()
      await page.locator('header a[href="/score"]').first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {})
      check('/security: Security and Gully Score are in the Products menu with icons', (await page.locator('header a[href="/security"] svg').count()) > 0 && (await page.locator('header a[href="/score"] svg').count()) > 0)
      await page.keyboard.press('Escape')
    }
    await shot(page, 'security-page')
    await designAudit(page, `security-page at ${page.viewportSize().width}`)
    await page.goto(BASE + '/security/reports')
    await page.getByTestId('report-index').waitFor()
    check(`/security/reports at ${width}: lists the published report`, (await page.locator(`a[href="/security/reports/${reportId}"]`).count()) === 1)
    if (mobile) await noHorizontalScroll(page, '/security/reports')
    await shot(page, 'security-reports')
    await designAudit(page, `security-reports at ${page.viewportSize().width}`)
    await page.goto(`${BASE}/security/reports/${reportId}`)
    await page.getByTestId('public-report').waitFor()
    check(`public report at ${width}: kit-branded page, not-an-audit notice, findings, no PoC, noindex`, (await page.getByTestId('not-audit').isVisible()) && (await page.locator('[data-finding]').count()) === findingCount && (await page.getByTestId('poc').count()) === 0 && (await page.locator('meta[name="robots"][content="noindex"]').count()) >= 1 && (await page.locator('[data-brand]').count()) > 0)
    if (mobile) await noHorizontalScroll(page, 'public report')
    await shot(page, 'security-public-report')
    await designAudit(page, `security-public-report at ${page.viewportSize().width}`)
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }
  {
    const ctx = await newContext()
    const page = await ctx.newPage()
    const w = watch(page, '/score at 1440')
    await page.goto(BASE + '/score')
    await page.waitForLoadState('networkidle').catch(() => {})
    await designAudit(page, '/score at 1440')
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }
  const html = await (await fetch(`${BASE}/security/reports/${reportId}`)).text()
  check('public report: the server sends its own title and noindex', /Security scan report: 0x1b1b…1b1b/.test(html) && /noindex/.test(html))
  check('an unpublished or unknown report is a 404 page', (await fetch(`${BASE}/security/reports/sec_AAAAAAAAAAAAAAAA`)).status === 404)

  // Admin: the Security card.
  {
    const ctx = await newContext()
    await ctx.addInitScript((tok) => sessionStorage.setItem('gully-admin-token', tok), admin)
    const page = await ctx.newPage()
    const w = watch(page, 'admin security')
    await page.goto(BASE + '/admin#security')
    await page.getByTestId('admin-security').waitFor({ timeout: 15_000 })
    await page.getByTestId('admin-security').scrollIntoViewIfNeeded()
    await page.locator('[data-testid="admin-security"] [data-chart]').waitFor({ timeout: 10_000 }).catch(() => {})
    check('admin: the Security card has its chart, the queue and the AI-only note', (await page.locator('[data-testid="admin-security"] [data-chart]').count()) === 1 && (await page.getByTestId('admin-security').getByRole('heading', { name: 'Queue' }).count()) === 1 && (await page.getByTestId('worker-note').count()) === 1)
    if (SHOTS) await page.getByTestId('admin-security').screenshot({ path: path.join(SHOTS, 'security-admin-1440.png') })
    await w.verify([/Failed to load resource/])
    await ctx.close()
  }
  stubs.setDelay(0)
})

/* ------------------------------------------------------- admin: bot broadcasts --- */

await step('admin: bot broadcasts at 1440 and 390', async () => {
  // Bot users as telegram-users.mjs stores them (no names), spread over two weeks so the growth line draws.
  const users = await import('../server/telegram-users.mjs')
  const bcast = await import('../server/telegram-broadcast.mjs')
  const seed = {}
  for (let i = 0; i < 24; i++) seed[String(880000 + i)] = { firstSeen: new Date(Date.now() - (14 - (i % 14)) * 86_400_000).toISOString(), lang: i % 3 ? 'en' : 'de', follows: i % 2 === 0, optedOut: i === 5 ? new Date().toISOString() : null }
  users.seedBotUsersForTest(seed)
  const aud = await adminCall('/api/admin/broadcasts/audience', { segment: { kind: 'all' } })
  check('broadcasts: the audience leaves out opted-out users', aud.status === 200 && aud.data.count === 23, JSON.stringify(aud.data))
  const sent = await adminCall('/api/admin/broadcasts', { text: '<b>E2E broadcast</b> hello', buttons: [{ text: 'Tracker', url: 'https://gullylabs.xyz/tracker' }], segment: { kind: 'all' }, action: 'send', confirm: aud.data.count })
  check('broadcasts: the admin API sends with the confirmed count', sent.status === 201, JSON.stringify(sent.data).slice(0, 160))
  await bcast.tickBroadcasts()
  for (const [width, mobile] of [[1440, false], [390, true]]) {
    const ctx = await newContext({ width, height: mobile ? 844 : 900, mobile })
    await ctx.addInitScript((tok) => sessionStorage.setItem('gully-admin-token', tok), admin)
    const page = await ctx.newPage()
    const w = watch(page, `admin broadcasts at ${width}`)
    await page.goto(BASE + '/admin#telegram')
    const section = page.locator('section', { has: page.getByRole('heading', { name: 'Bot broadcasts' }) })
    await section.waitFor({ timeout: 15_000 })
    await section.getByText('E2E broadcast').first().waitFor({ timeout: 10_000 })
    check(`broadcasts at ${width}: analytics (bot users, opted out, blocked, last broadcast)`, (await section.getByText('BOT USERS · LIVE').count()) === 1 && (await section.getByText('LAST BROADCAST').count()) === 1 && (await section.getByText('OPENED LINK').count()) === 1)
    check(`broadcasts at ${width}: the growth chart renders`, (await section.locator('[aria-label^="Bot users over time"]').count()) === 1)
    check(`broadcasts at ${width}: the owner step names BotFather and the Mini App URL`, (await section.getByText(/Owner step: make the Mini App the bot’s main app/).count()) === 1 && (await section.locator('a[href="https://t.me/BotFather"][target="_blank"]').count()) === 1)
    await section.locator('#tgb-text').fill('<b>Hello from e2e</b> news')
    await section.getByText('Hello from e2e').first().waitFor()
    check(`broadcasts at ${width}: the live preview renders the text and the 🔕 Stop announcements button`, (await section.getByLabel('Telegram preview').getByText('🔕 Stop announcements').count()) === 1)
    check(`broadcasts at ${width}: one a day: Send now waits until Urgent is ticked`, await section.getByRole('button', { name: /Send now/ }).isDisabled())
    await section.getByLabel(/Urgent/).check()
    await section.getByRole('button', { name: /Send now/ }).click()
    const dlg = section.getByRole('alertdialog')
    await dlg.waitFor()
    check(`broadcasts at ${width}: the confirm step shows the exact count`, (await dlg.getByText('23 people').count()) === 1 && (await dlg.getByRole('button', { name: 'Yes, send to 23' }).count()) === 1)
    if (mobile) await noHorizontalScroll(page, '/admin broadcasts')
    if (SHOTS) {
      await page.waitForTimeout(800)
      await section.screenshot({ path: path.join(SHOTS, `admin-broadcasts-${width}.png`) })
    }
    await dlg.getByRole('button', { name: 'Cancel' }).click()
    await section.getByRole('button', { name: 'Recipients' }).first().click()
    await section.getByText('••••').first().waitFor()
    check(`broadcasts at ${width}: per-recipient status with masked chat ids`, (await section.locator('td', { hasText: /^••••\d{4}$/ }).count()) >= 20)
    if (SHOTS && !mobile) {
      const chan = page.locator('section', { has: page.getByRole('heading', { name: 'Telegram channel' }) })
      await chan.getByText('Send to channel and DM users').click()
      await page.waitForTimeout(300)
      await chan.screenshot({ path: path.join(SHOTS, `admin-channel-dm-${width}.png`) })
    }
    await w.verify([/Failed to load resource/])
    await ctx.close()
  }
})

/* ------------------------------------------------------------- docs --- */

const DOCS = ['', 'methodology', 'api', 'widget', 'api-keys', 'plans-alerts', 'sdk', 'teams', 'analytics', 'gully-pay', 'gully-security', 'gully-score', 'roadmap', 'roadmap-l3', 'changelog']
await step('docs', async () => {
  for (const [width, mobile] of [[1440, false], [390, true]]) {
    const ctx = await newContext({ width, height: mobile ? 844 : 900, mobile })
    const page = await ctx.newPage()
    for (const slug of DOCS) {
      const w = watch(page, `docs /${slug} at ${width}`)
      await page.goto(`${BASE}/docs${slug ? '/' + slug : ''}`)
      await page.getByRole('heading', { level: 1 }).first().waitFor()
      if (slug === 'widget' && !mobile) {
        await page.waitForFunction(() => [...document.querySelectorAll('[data-gully-widget]')].some((el) => /%/.test(el.shadowRoot?.textContent ?? '')), null, { timeout: 10_000 })
        check('docs /widget: the live examples render (widget.js allowed by the CSP)', true)
      }
      if (mobile) await noHorizontalScroll(page, `docs /${slug}`)
      else await designAudit(page, `docs /${slug}`)
      // The L3 roadmap reads public parent-chain RPCs in the browser; this harness aborts every off-localhost request.
      await w.verify(slug === 'roadmap-l3' ? [/ERR_BLOCKED_BY_CLIENT/] : [])
    }
    if (mobile) {
      // The header's Gully AI button must not sit on the DOCS pill.
      const boxes = await page.evaluate(() => {
        const r = (el) => el?.getBoundingClientRect()
        const ask = [...document.querySelectorAll('header button')].find((b) => /Ask|Gully AI/i.test(b.textContent + (b.getAttribute('aria-label') ?? '')))
        const pill = [...document.querySelectorAll('header *')].find((e) => e.children.length === 0 && /^docs$/i.test(e.textContent.trim()))
        const a = r(ask)
        const p = pill && getComputedStyle(pill).display !== 'none' ? r(pill) : null
        return { a: a && [a.left, a.right, a.top, a.bottom], p: p && [p.left, p.right, p.top, p.bottom] }
      })
      const overlap = boxes.a && boxes.p && !(boxes.a[0] >= boxes.p[1] || boxes.a[1] <= boxes.p[0] || boxes.a[2] >= boxes.p[3] || boxes.a[3] <= boxes.p[2])
      check('docs at 390: the Ask button does not overlap the DOCS pill', !overlap, JSON.stringify(boxes))
    }
    await ctx.close()
  }
})

// Design audit 3, group 1 (D2, D18, D23, D24): docs header, code captions, badge table, footer taps and the Telegram link.
await step('docs design audit 3 g1', async () => {
  for (const width of [390, 320]) {
    const ctx = await newContext({ width, height: 844, mobile: true })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/docs/badges`)
    await page.locator('#docs-main h1').waitFor()
    const hdr = await page.evaluate(() => {
      const hd = document.querySelector('header')
      const ask = [...hd.querySelectorAll('button')].find((b) => /gully ai/i.test(b.textContent + (b.getAttribute('aria-label') ?? '')))
      const logo = [...hd.querySelectorAll('a img, a svg')].filter((e) => e.getBoundingClientRect().width > 0)
      const a = ask?.getBoundingClientRect()
      const hit = logo.some((e) => { const r = e.getBoundingClientRect(); return a && r.right > a.left && r.left < a.right })
      return { hit, noScroll: document.documentElement.scrollWidth <= innerWidth, marks: logo.length }
    })
    check(`docs header at ${width}: the logo does not sit under the Gully AI button`, !hdr.hit && hdr.noScroll && hdr.marks > 0, JSON.stringify(hdr))
    const tbl = await page.evaluate(() => [...document.querySelectorAll('[data-testid="badge-table"] span')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.slice(0, 30)))
    check(`docs badges at ${width}: no clipped Says or Address cell`, tbl.length === 0, tbl.join(' | '))
    await page.goto(`${BASE}/docs/api`)
    await page.locator('#docs-main h1').waitFor()
    const caps = await page.evaluate(() => [...document.querySelectorAll('#docs-main figure > div > span')].filter((e) => e.scrollWidth > e.clientWidth + 1 || getComputedStyle(e).textOverflow === 'ellipsis').map((e) => e.textContent.slice(0, 40)))
    check(`docs api at ${width}: no truncated code caption`, caps.length === 0, caps.join(' | '))
    await page.goto(`${BASE}/`)
    const foot = await page.evaluate(() => [...document.querySelectorAll('footer nav a, footer nav button')].map((e) => { const r = e.getBoundingClientRect(); return [e.textContent.trim().slice(0, 20), Math.round(r.width), Math.round(r.height)] }).filter(([, w, h]) => w < 44 || h < 44))
    check(`footer at ${width}: every link is a 44 px tap`, foot.length === 0, JSON.stringify(foot))
    const tg = page.locator('footer a[href="https://t.me/GullyLabsBot?start=contact"]')
    check(`footer at ${width}: Chat on Telegram link`, (await tg.count()) === 1 && /Chat on Telegram/.test(await tg.innerText()))
    await ctx.close()
  }
})

// Design audit 2, group 6 (docs): no developer noise in prose, live charts, logos loaded, 44 px badge buttons.
await step('docs design audit 2', async () => {
  const ctx = await newContext({ width: 1440, height: 900 })
  const page = await ctx.newPage()
  const pages = ['', 'gully-security', 'solana', 'solana-pay', 'telegram-mini-app', 'news-gate', 'badges', 'holder-map', 'holder-map-integrate', 'roadmap-l3', 'gully-pay', 'api', 'sdk', 'status']
  for (const slug of pages) {
    const w = watch(page, `docs da2 /${slug}`)
    await page.goto(`${BASE}/docs${slug ? '/' + slug : ''}`)
    await page.locator('#docs-main h1').waitFor()
    await page.waitForTimeout(1200)
    // Prose only: code blocks and their folded copies legitimately show null.
    const prose = await page.evaluate(() => {
      const root = document.querySelector('#docs-main').cloneNode(true)
      root.querySelectorAll('pre, figure, code').forEach((e) => e.remove())
      return root.textContent
    })
    check(`docs /${slug}: no undefined, [object Object] or null in the prose`, !/undefined|\[object|\bnull\b/.test(prose), (prose.match(/.{30}(undefined|\[object|\bnull\b).{20}/) ?? [''])[0])
    check(`docs /${slug}: no text-only "collecting a series"`, !/collecting a series/i.test(prose))
    if (['gully-security', 'solana-pay', 'telegram-mini-app', 'news-gate', 'holder-map-integrate', 'badges', 'roadmap-l3'].includes(slug)) {
      const live = await page.locator('#docs-main [data-chart], #docs-main [data-live], #docs-main [data-ghost]').count()
      check(`docs /${slug}: carries a live chart, live render or ghost`, live > 0, String(live))
    }
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i, /Failed to load resource/i])
  }
  await page.goto(`${BASE}/docs/gully-pay`)
  await page.locator('#docs-main h1').waitFor()
  await page.waitForLoadState('networkidle').catch(() => {})
  const logos = await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll('#docs-main table img, #docs-main [data-logo] img, #docs-main img')].filter((i) => /\/(chains|tokens)\//.test(i.getAttribute('src') ?? ''))
    await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r }))))
    return { n: imgs.length, bad: imgs.filter((i) => i.naturalWidth === 0).length }
  })
  check('docs /gully-pay: chain and token names carry logos, all loaded', logos.n >= 15 && logos.bad === 0, JSON.stringify(logos))
  await page.goto(`${BASE}/docs/badges`)
  await page.locator('#docs-main h1').waitFor()
  const small = await page.evaluate(() => [...document.querySelectorAll('#docs-main button')].filter((b) => b.getBoundingClientRect().height < 43.5).length)
  check('docs /badges: every button is 44 px tall', small === 0, String(small))
  await page.goto(`${BASE}/docs/api`)
  await page.locator('#docs-main h1').waitFor()
  const rows = await page.evaluate(() => [...document.querySelectorAll('#docs-main details > summary')].filter((s) => s.parentElement.querySelector('div')).slice(0, 40).map((s) => s.getBoundingClientRect().height))
  check('docs /api: endpoint rows are collapsed to one line', rows.length > 20 && Math.max(...rows) < 70, `${rows.length} rows, max ${Math.max(...rows)}`)
  await ctx.close()
})

/* ------------------------------------------------------------- Gully Score --- */

// One listed score is stored through the module's test hook (the server runs in this process, so it is the same
// module instance): the pages read it like any other, and nothing is computed, so no upstream is asked.
// SCORE_SHOTS=<dir>: full-page screenshots of /score and the score page at 1440 and 390 land there.
await step('gully score', async () => {
  const gs = await import('../server/gully-score.mjs')
  const SC = '0x' + 'ab'.repeat(20)
  const now = Date.now()
  const at = (d) => new Date(now - d * 86_400_000).toISOString()
  const comp = (id, o) => ({ ...gs.COMPONENTS.find((c) => c.id === id), evidence: [], ...o })
  gs.putScoreForTest({
    chainId: 8453,
    chainKey: 'base',
    chainName: 'Base',
    address: SC,
    name: 'E2E Vault',
    symbol: null,
    score: 74,
    grade: 'Fair',
    coverage: { weight: 75, components: 6, of: 9 },
    computedAt: new Date(now).toISOString(),
    methodVersion: 1,
    components: [
      comp('verified', { available: true, score: 100, value: 'Full match (Sourcify)', reason: 'The source code is verified on Sourcify: a full match, so the compiled code and its metadata match the deployed code exactly.', provider: 'sourcify', match: 'full', evidence: [{ label: 'Sourcify: full match', url: `https://repo.sourcify.dev/8453/${SC}` }] }),
      comp('control', { available: true, score: 100, value: 'Safe, 2 of 3', reason: 'Changes need 2 of the 3 signers of the Safe.' }),
      comp('timelock', { available: true, score: 0, value: 'No delay', reason: 'Changes take effect as soon as they are made.' }),
      comp('upgradeability', { available: true, score: 30, value: 'Upgradeable', reason: 'Its code can be swapped.' }),
      comp('changes', { available: true, score: 75, value: '1 in 30 days', reason: '1 privileged change was seen in the last 30 days.' }),
      comp('liquidity', { available: false, score: null, value: 'Not available', reason: 'Liquidity locks are read for DeepCore launches only.' }),
      comp('holders', { available: false, score: null, value: 'Not available', reason: 'The Holder Map is not running on this server yet.' }),
      comp('review', { available: true, score: 70, value: 'Published 2026-10-01', reason: 'Gully Security published a report: 0 critical, 1 high, 2 medium, 0 low, 3 info.', evidence: [{ label: 'Read the report', url: 'https://gullylabs.xyz/security' }] }),
      comp('age', { available: false, score: null, value: 'Not available', reason: 'The deployment date is not known here.' }),
    ],
    history: [{ at: at(9), score: 81 }, { at: at(5), score: 79 }, { at: at(2), score: 74 }, { at: new Date(now).toISOString(), score: 74 }],
    changes: [{ at: at(9), id: null, label: 'First scored', from: null, to: 81, note: 'Scored 81 from 6 of 9 components.' }, { at: at(2), id: 'changes', label: 'Recent privileged changes', from: 100, to: 75, note: '1 in 30 days: 1 privileged change was seen.' }],
  })
  const shots = process.env.SCORE_SHOTS ? path.resolve(process.env.SCORE_SHOTS) : null
  if (shots) fs.mkdirSync(shots, { recursive: true })
  const shot = async (page, name) => shots && page.screenshot({ path: path.join(shots, `${name}-${page.viewportSize().width}.png`), fullPage: true })
  for (const [width, mobile] of [[1440, false], [390, true]]) {
    const ctx = await newContext({ width, height: mobile ? 844 : 900, mobile })
    const page = await ctx.newPage()
    let w = watch(page, `/score at ${width}`)
    await page.goto(BASE + '/score')
    const row = page.getByRole('link', { name: /E2E Vault/ })
    await row.waitFor()
    check(`/score at ${width}: the listed score shows with its number`, (await row.textContent()).includes('74'))
    await page.locator('[data-chart] svg').first().waitFor({ timeout: 10_000 })
    check(`/score at ${width}: the band chart draws`, (await page.locator('[data-chart] svg path').count()) > 0)
    check(`/score at ${width}: the methodology lists every part with its weight`, (await page.getByText('Gully Security review').count()) > 0 && (await page.getByText(/Nothing paid goes in/).count()) > 0)
    if (!mobile) {
      await page.getByLabel('Contract address').fill('0x123')
      await page.getByRole('button', { name: 'Score it' }).click()
      check('/score: a bad address is explained, not sent', await page.getByText('Paste a contract address').isVisible())
    }
    if (mobile) await noHorizontalScroll(page, '/score')
    await page.waitForTimeout(1200)
    await shot(page, 'score-index')
    await w.verify()
    w = watch(page, `score page at ${width}`)
    await page.goto(`${BASE}/score/base/${SC}`)
    await page.getByRole('heading', { level: 1, name: 'E2E Vault' }).waitFor()
    await page.getByRole('img', { name: /Gully Score 74 out of 100/ }).waitFor({ timeout: 10_000 })
    check(`score page at ${width}: the ring and the number`, true)
    check(`score page at ${width}: the missing parts collapse into ONE "not counted" line, no repeated rows`, (await page.getByText('Not counted, no data to read:').count()) === 1 && (await page.getByText(/NOT AVAILABLE/).count()) === 0)
    check(`score page at ${width}: no code or api host in the visible text`, !/owner\(\)|getThreshold|api\.deepcore\.fun/.test(await page.locator('main').innerText()))
    check(`score page at ${width}: methodology and badge links are 44 px tall`, await page.evaluate(() => [...document.querySelectorAll('main a[href*="gully-score"], main a[aria-label*="badge"]')].every((a) => a.getBoundingClientRect().height >= 43.5)))
    check(`score page at ${width}: evidence links open in a new tab`, (await page.locator('a[href^="https://repo.sourcify.dev"]').getAttribute('target')) === '_blank')
    check(`score page at ${width}: the change log`, (await page.getByText('Recent privileged changes').count()) > 0)
    const badge = page.locator(`img[src="/score/base/${SC}/badge.svg"]`)
    await badge.scrollIntoViewIfNeeded()
    // The badge's width follows its text (badges.mjs measures the outlined glyphs), so it must equal the SVG's own width.
    const badgeW = Number(((await (await fetch(BASE + `/score/base/${SC}/badge.svg`)).text()).match(/<svg[^>]*\swidth="(\d+)"/) || [])[1])
    check(`score page at ${width}: the badge loads`, await badge.evaluate((img) => (img.complete ? img.naturalWidth : new Promise((r) => (img.onload = () => r(img.naturalWidth))))).then((n) => n > 0 && n === badgeW), `badge ${badgeW}`)
    check(`score page at ${width}: methodology says informational, nobody can pay`, (await page.getByText(/not an endorsement and not investment advice/).count()) > 0)
    if (mobile) await noHorizontalScroll(page, 'score page')
    if (mobile) {
      // DA3 D27: at 320 the address is one middle-truncated line, never wrapped mid-string.
      await page.setViewportSize({ width: 320, height: 844 })
      const code = await page.evaluate(() => [...document.querySelectorAll('main code')].filter((c) => c.getClientRects().length).map((c) => ({ t: c.textContent, h: c.getBoundingClientRect().height })))
      check('score page at 320: the address is one line (middle-truncated), not wrapped mid-string', code.length === 1 && code[0].h < 24, JSON.stringify(code))
      await noHorizontalScroll(page, 'score page at 320')
      await page.setViewportSize({ width: 390, height: 844 })
    }
    await page.waitForTimeout(1200)
    await shot(page, 'score-page')
    await w.verify()
    await ctx.close()
  }
  const html = await (await fetch(`${BASE}/score/base/${SC}`)).text()
  check('score page HTML: its own title for crawlers', /E2E Vault Gully Score on Base · Gully Labs/.test(html))
})

/* ------------------------------------------------------------- 404s and mobile pages --- */

await step('404s', async () => {
  for (const [p, want] of [['/this-page-does-not-exist', 404], ['/tracker/robinhood/ZZZZ', 404], ['/docs/nope', 404], ['/developers', 200], ['/admin', 200], ['/docs/teams', 200], ['/pricing', 200], ['/legal/merchant-terms', 200], ['/legal/privacy', 200], ['/links', 200], ['/status', 200], ['/docs/status', 200], ['/docs/gully-ai', 200], ['/docs/telegram', 200], ['/docs/chain-kit', 200], ['/docs/swaps', 200], ['/docs/solana', 200]]) {
    const r = await fetch(BASE + p)
    const html = await r.text()
    check(`HTTP ${want} for ${p}`, r.status === want && (want === 404 ? /noindex/.test(html) : !/Not found ·/.test(html)), `${r.status}`)
  }
  // One JSON 404 for the whole API (P2-19): never the HTML app shell.
  for (const p of ['/api/nope', '/api/movers', '/api/deepcore']) {
    const r = await fetch(BASE + p)
    const body = await r.json().catch(() => null)
    check(`${p}: 404 as JSON`, r.status === 404 && /application\/json/.test(r.headers.get('content-type') ?? '') && body?.error === 'not found', `${r.status} ${r.headers.get('content-type')}`)
  }
  const old = await fetch(BASE + '/gully-pay/merchant-terms', { redirect: 'manual' })
  check('/gully-pay/merchant-terms: a permanent redirect to /legal/merchant-terms (P2-17)', old.status === 301 && old.headers.get('location') === '/legal/merchant-terms', `${old.status} ${old.headers.get('location')}`)
  // Server-side head tags: the status page, and /pricing names only the chains /api/plans offers (N-7).
  const st = await (await fetch(BASE + '/status')).text()
  check('/status HTML: its own title and share card for crawlers', /<title>Status · Gully Labs<\/title>/.test(st) && /og-status\.png/.test(st))
  const pr = await (await fetch(BASE + '/pricing')).text()
  const prDesc = pr.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ''
  check(`/pricing meta lists the offered chains (${OFFERED.join(', ')}) and no closed one (N-7)`, OFFERED.length > 0 && OFFERED.every((n) => prDesc.includes(n)) && Object.values(CLOSED).every((n) => !prDesc.includes(n)), prDesc)
})

await step('holder map', async () => {
  const shotTo = async (page, file, el = null) => {
    if (!SHOTS) return
    await page.waitForTimeout(1600)
    if (el) await el.screenshot({ path: path.join(SHOTS, file) })
    else await page.screenshot({ path: path.join(SHOTS, file), fullPage: true })
  }
  for (const width of [1440, 390]) {
    const ctx = await newContext({ width, mobile: width < 600 })
    await ctx.route(`${BASE}/api/ask`, (route) => json(route, holdersExtraFixtures().ask))
    const page = await ctx.newPage()
    const w = watch(page, `holder map ${width}`)
    await page.goto(BASE + '/holders/robinhood/' + E2E_LAUNCH_TOKEN)
    const map = page.locator('[data-holder-map="ok"]')
    await map.waitFor()
    check(`holder map ${width}: the plain summary shows`, await map.locator('[data-holder-summary]').getByText(/^Top 10 wallets hold \d+%; the largest connected cluster holds/).isVisible())
    check(`holder map ${width}: the launch check (always free) shows`, await map.locator('[data-risk-line]').getByText(/3 wallets bought in the first block of trading/).isVisible())
    await map.locator('[data-chart]').scrollIntoViewIfNeeded()
    await map.locator('[data-chart] canvas').first().waitFor()
    check(`holder map ${width}: the bubble graph draws (canvas)`, (await map.locator('[data-chart] canvas').count()) > 0)
    check(`holder map ${width}: the graph has a text summary for screen readers`, /^Holder Map of DTC on Robinhood Chain/.test((await map.locator('[data-chart]').getAttribute('aria-label')) ?? ''))
    check(`holder map ${width}: a ranked list exists for screen readers`, (await map.locator('.sr-only table tbody tr').count()) === 30)
    await shotTo(page, `launch-${width}.png`)
    await bubbleLook(page, map, `holder map ${width}`)
    // Click the biggest bubble (the layout puts it near the middle) to open its panel.
    const box = await map.locator('[data-chart]').boundingBox()
    const panel = map.locator('[data-holder-panel]')
    let openedByClick = false
    for (const [dx, dy] of [[0, 0], [-0.12, 0], [0.12, 0], [0, -0.15], [0, 0.15], [-0.2, -0.2], [0.2, 0.2]]) {
      await page.mouse.click(box.x + box.width * (0.5 + dx), box.y + box.height * (0.5 + dy))
      openedByClick = await panel.waitFor({ timeout: 800 }).then(
        () => true,
        () => false,
      )
      if (openedByClick) break
    }
    if (width === 1440) check('holder map: clicking a bubble opens its panel', openedByClick)
    // Search flies to a wallet and opens it.
    await map.getByLabel('Find a wallet by address').fill('0x00000000')
    await map.getByRole('button', { name: 'Find', exact: true }).click()
    await panel.waitFor()
    check(`holder map ${width}: search finds a wallet and opens its panel`, (await panel.getByText(/WALLET #\d+/).count()) === 1)
    // The ranked list: a bundled buyer shows its badge and its links.
    await map.getByRole('button', { name: 'List', exact: true }).click()
    await map.locator('[data-holder-list] button').nth(2).click()
    check(`holder map ${width}: a bundled buyer is badged in its panel`, await panel.getByText('Bundled at launch').isVisible())
    check(`holder map ${width}: the panel lists its links and an explorer link in a new tab`, (await panel.getByText(/^LINKS \(\d+\)$/).count()) === 1 && (await panel.locator('a[target="_blank"]', { hasText: 'Explorer' }).count()) === 1)
    await map.getByRole('button', { name: 'Map', exact: true }).click()
    const toggle = map.getByRole('button', { name: /Showing contracts and pools|People only/ })
    await toggle.click()
    check(`holder map ${width}: the people-only toggle switches`, (await toggle.getAttribute('aria-pressed')) === 'true')
    // The replay: a slider, play, 1x and 4x.
    check(`holder map ${width}: the replay slider exists`, (await map.locator('[data-replay="on"] input[type="range"]').count()) === 1)
    await map.getByRole('button', { name: '4×' }).click()
    await map.getByRole('button', { name: 'Play the replay' }).click()
    await page.waitForTimeout(700)
    check(`holder map ${width}: play replays history (the frame label leaves "Now")`, !/^Now/.test((await map.locator('[data-replay="on"] [aria-live]').textContent()) ?? ''))
    check(`holder map ${width}: buy/sell sits under the risk summary`, (await map.locator('[data-holder-trade]').getByText(/Before you trade:.*3 wallets bought/).count()) === 1)
    // The explainable health score: tapping a part lights its wallets on the map (free, never gated).
    const health = map.locator('[data-health]')
    check(`holder map ${width}: the health score card shows the score and its parts`, (await health.getByRole('img', { name: 'Score 58 out of 100' }).count()) === 1 && (await health.locator('[data-health-part]').count()) === 6)
    await health.locator('[data-health-part="bundle"]').click()
    check(`holder map ${width}: tapping a score part highlights its wallets`, (await health.locator('[data-health-part="bundle"]').getAttribute('aria-pressed')) === 'true' && (await map.getByText(/Showing the 3 wallets behind “Bundled buys”/).count()) === 1)
    await map.getByRole('button', { name: 'Show all' }).click()
    check(`holder map ${width}: the deployer's record shows outcomes and the serial launcher flag`, (await map.locator('[data-deployer-history]').getByText('Liquidity pulled').count()) === 1 && (await map.locator('[data-deployer-history]').getByText('Serial launcher').count()) === 1)
    check(`holder map ${width}: same wallets elsewhere links to other maps`, (await map.locator('[data-cross-token] a', { hasText: 'OLD1' }).count()) === 1)
    check(`holder map ${width}: snipers are named under the launch check`, (await map.locator('[data-risk-line]').getByText(/2 wallets bought in the first 3 blocks/).count()) === 1)
    // Live mode: the stubbed /live answers, the pill shows.
    await map.locator('[data-live="on"]').waitFor({ timeout: 10_000 })
    check(`holder map ${width}: live mode shows the LIVE pill`, (await map.locator('[data-live="on"]').getByText(/LIVE/).count()) === 1)
    // A wallet's panel reads its first buy and P&L (stubbed /wallet).
    await map.getByLabel('Find a wallet by address').fill(holdersFixture().nodes[1].id)
    await map.getByRole('button', { name: 'Find', exact: true }).click()
    await map.locator('[data-wallet-facts]').waitFor()
    check(`holder map ${width}: the wallet panel shows first buy and P&L vs entry`, (await map.locator('[data-wallet-facts]').getByText('+42.0% in WETH terms').count()) === 1)
    // Explain this map (Gully AI, stubbed).
    await map.getByRole('button', { name: 'Explain this map' }).click()
    await map.locator('[data-ask]').getByText(/Three of them bought together/).waitFor()
    check(`holder map ${width}: Gully AI explains the map`, true)
    check(`holder map ${width}: Alert me opens the app's alert dialog for this token`, ((await map.locator('[data-alert-me]').getAttribute('href')) ?? '').includes(`alert=holders%3Arobinhood%3A${E2E_LAUNCH_TOKEN}`))
    const bimg = page.locator('[data-badge-block] [data-badge-img]')
    await bimg.scrollIntoViewIfNeeded()
    check(`holder map ${width}: the badge image loads and the HTML and Markdown copy buttons are there`, (await bimg.evaluate((img) => (img.complete && img.naturalWidth > 0 ? img.naturalWidth : new Promise((r) => { img.onload = () => r(img.naturalWidth); img.onerror = () => r(0) })))) > 0 && (await page.locator('[data-copy-html]').count()) === 1 && (await page.locator('[data-copy-md]').count()) === 1)
    await shotTo(page, `token-${width}.png`)
    await noHorizontalScroll(page, `/holders ${width}`)
    await designAudit(page, `holder map ${width}`)
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }
  // The bubble map on a Solana token (top holders, no links) and on a busy 320-wallet map (frame budget).
  for (const width of [1440, 390]) {
    const ctx = await newContext({ width, mobile: width < 600 })
    await ctx.route(`${BASE}/api/holders/solana/${SOLANA_TOKEN}`, (route) => json(route, solanaFixture()))
    await ctx.route(`${BASE}/api/holders/base/0x000000000000000000000000000000000b0b0b05`, (route) => json(route, busyFixture()))
    const page = await ctx.newPage()
    const w = watch(page, `bubble map ${width}`)
    await page.goto(BASE + '/holders/solana/' + SOLANA_TOKEN)
    const map = page.locator('[data-holder-map="ok"]')
    await map.waitFor()
    await bubbleLook(page, map, `solana map ${width}`, { kindRe: /^wallet/ })
    check(`solana map ${width}: it says plainly that links are not drawn on this chain yet`, (await map.locator('[data-no-links]').getByText(/Links between wallets are not drawn on Solana yet/).count()) === 1)
    await noHorizontalScroll(page, `/holders solana ${width}`)
    await page.goto(BASE + '/holders/base/0x000000000000000000000000000000000b0b0b05')
    await map.waitFor()
    await bubbleLook(page, map, `busy map ${width}`, { quiet: width === 1440 })
    check(`busy map ${width}: 300+ bubbles draw (${await map.locator('[data-bubble-canvas]').getAttribute('data-bodies')})`, Number(await map.locator('[data-bubble-canvas]').getAttribute('data-bodies')) >= 300)
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }
  // Nothing in the holder map is clipped or truncated on a phone: title, stats, controls, chips, legend, supply strip, lists (390 and 320).
  for (const width of [390, 320]) {
    const ctx = await newContext({ width, mobile: true })
    await ctx.route(`${BASE}/api/ask`, (route) => json(route, holdersExtraFixtures().ask))
    const page = await ctx.newPage()
    await page.goto(BASE + '/holders/robinhood/' + E2E_LAUNCH_TOKEN)
    const map = page.locator('[data-holder-map="ok"]')
    await map.waitFor()
    await map.locator('[data-live-stats] dt').first().waitFor()
    await page.waitForTimeout(2500)
    const clipped = await clippedIn(page, '[data-holder-map="ok"]')
    check(`holder map ${width}: no title, stat, control, chip, legend or list label is clipped or truncated`, clipped.length === 0, clipped.slice(0, 5).join(' | '))
    const labels = await map.locator('[data-live-stats] dt').allTextContents()
    check(`holder map ${width}: every stat label is fully readable (${labels.join(' / ')})`, labels.length === 3 && (await map.locator('[data-live-stats] dt').evaluateAll((els) => els.every((e) => e.scrollWidth <= e.clientWidth + 1))))
    const seg = await map.locator('[data-segmented]').first().boundingBox()
    check(`holder map ${width}: the Map/List control sits fully inside the screen`, !!seg && seg.x >= 0 && seg.x + seg.width <= width, JSON.stringify(seg))
    await noHorizontalScroll(page, `/holders ${width} (phone clip pass)`)
    await ctx.close()
  }
  // The timeline readout owns a full-width row under the buttons, and the Gully AI button never covers the Map/List toggle (390 and 320).
  for (const width of [390, 320]) {
    const ctx = await newContext({ width, mobile: true })
    await ctx.route(`${BASE}/api/ask`, (route) => json(route, holdersExtraFixtures().ask))
    const page = await ctx.newPage()
    await page.goto(BASE + '/holders/robinhood/' + E2E_LAUNCH_TOKEN)
    const map = page.locator('[data-holder-map="ok"]')
    await map.waitFor()
    const readout = map.locator('[data-replay-readout]')
    await readout.waitFor()
    const rb = await readout.boundingBox()
    const play = await map.locator('[data-replay="on"] button').first().boundingBox()
    const box = await map.locator('[data-replay="on"]').boundingBox()
    check(`holder map ${width}: the timeline readout has its own full-width row under the buttons`, !!rb && !!play && !!box && rb.y >= play.y + play.height - 1 && rb.width >= box.width - 28, JSON.stringify({ rb, play, box }))
    check(`holder map ${width}: the timeline readout is not clipped`, await readout.evaluate((e) => e.scrollWidth <= e.clientWidth + 1))
    const toggle = map.locator('[data-segmented]').first()
    await toggle.evaluate((e) => e.scrollIntoView({ block: 'end' }))
    await page.waitForTimeout(400)
    const fab = page.getByTestId('ask-fab')
    await fab.waitFor()
    const tb = await toggle.boundingBox()
    const fb = await fab.boundingBox()
    const hit = !!tb && !!fb && tb.x < fb.x + fb.width && tb.x + tb.width > fb.x && tb.y < fb.y + fb.height && tb.y + tb.height > fb.y
    check(`holder map ${width}: the Gully AI button does not cover the Map/List toggle`, !!tb && !!fb && !hit, JSON.stringify({ tb, fb }))
    await ctx.close()
  }
  // The /holders landing on a phone: two-line launch summaries, whole tickers, a short search placeholder, a one-line coming-soon chip, token logos in the feed.
  for (const width of [390, 320]) {
    const ctx = await newContext({ width, mobile: true })
    const page = await ctx.newPage()
    await page.goto(BASE + '/holders')
    await page.locator('[data-launch-feed] li').first().waitFor()
    await page.waitForTimeout(800)
    const sums = await page.locator('[data-feed-summary]').evaluateAll((els) => els.map((e) => getComputedStyle(e).webkitLineClamp === '2' && e.clientHeight <= 2 * parseFloat(getComputedStyle(e).fontSize) * 1.75))
    check(`holders landing ${width}: launch summaries are clamped to two lines`, sums.length > 0 && sums.every(Boolean), JSON.stringify(sums))
    const ticks = await page.locator('[data-feed-ticker]').evaluateAll((els) => els.map((e) => e.scrollWidth <= e.clientWidth + 1 && !/…$/.test(e.textContent ?? '')))
    check(`holders landing ${width}: tickers are whole`, ticks.length > 0 && ticks.every(Boolean), JSON.stringify(ticks))
    check(`holders landing ${width}: the search placeholder reads "Address or ticker" and fits`, (await page.getByLabel('Token address or ticker').getAttribute('placeholder')) === 'Address or ticker' && (await page.getByLabel('Token address or ticker').evaluate((e) => e.scrollWidth <= e.clientWidth + 1)))
    const soon = page.locator('[data-sources-soon]')
    if (await soon.count()) {
      const sb = await soon.boundingBox()
      check(`holders landing ${width}: the coming-soon chip is one line with chain logos`, !!sb && sb.height <= 44 && (await soon.locator('img, svg').count()) >= 2, JSON.stringify(sb))
    }
    check(`holders landing ${width}: feed rows without a map show the token logo, not an empty tile`, (await page.locator('[data-feed-logo]').count()) >= 1 && (await page.locator('[data-feed-logo] [data-logo="token"]').count()) >= 1)
    await noHorizontalScroll(page, `/holders ${width} landing`)
    await ctx.close()
  }
  // Deep check: the offer card on a map, a free-quota check started from a quote, the report page and the JPEG card.
  {
    const DEEP_CHECK = 'dc_e2e0000000000001'
    const cov = (k) => ({ chain: k, funding: { state: 'available', reason: null }, clusters: { state: 'available', reason: null }, deployer: { state: 'limited', reason: 'Only DeepCore launches are read' }, trading: { state: 'unavailable', reason: 'No archive RPC answers for this chain' } })
    const quota = { plan: { id: 'pro', name: 'Pro' }, freePerMonth: 3, used: 0, left: 3, resetsAt: new Date(Date.now() + 864e5 * 10).toISOString(), active: 0, maxActive: 2, credits: 0 }
    const chainInfo = { key: 'robinhood', id: 46630, name: 'Robinhood Chain' }
    const report = {
      version: 1, chain: chainInfo, token: { address: E2E_LAUNCH_TOKEN, symbol: 'DTC', name: 'DeepCore Test', url: 'https://explorer.example/token/x' }, generatedAt: new Date().toISOString(), status: 'partial',
      partial: { reasons: [{ code: 'archive', text: 'No archive RPC answers for this chain, so sniper history was skipped.' }] },
      sections: {
        trading: { state: 'unavailable', reason: 'No archive RPC answers for this chain' },
        funding: { state: 'ok', source: 'Explorer transfers', confidence: 'medium', wallets: 2, hopsMax: 2, traces: [{ address: '0x' + 'a'.repeat(40), role: 'holder', rank: 1, pctOfSupply: 12.5, hops: [], origin: { type: 'exchange', label: 'Example exchange' } }, { address: '0x' + 'b'.repeat(40), role: 'holder', rank: 2, pctOfSupply: 7.5, hops: [], origin: { type: 'unknown', reason: 'No earlier funding found' } }], sharedFunders: [] },
        clusters: { state: 'ok', combined: [{ id: 'c1', wallets: ['0x' + 'a'.repeat(40), '0x' + 'b'.repeat(40)], count: 2, pctOfSupply: 20, basis: 'shared funder', confidence: 'medium' }] },
        deployer: { state: 'partial', address: '0x' + 'd'.repeat(40), source: 'Explorer', tokens: [], chains: [] },
      },
      findings: [{ id: 'f1', section: 'clusters', text: 'Two top wallets share one funder and hold 20% together.', confidence: 'medium', source: 'Funding trace' }],
      unavailable: [{ section: 'trading', what: 'Snipers and bundled buys', reason: 'No archive RPC answers for this chain' }], notes: [],
    }
    const checkDoc = (status) => ({ id: DEEP_CHECK, status, chain: chainInfo, token: E2E_LAUNCH_TOKEN, free: true, priceUsd: 0, listPriceUsd: 9, bundled: false, payment: null, progress: null, createdAt: new Date().toISOString(), startedAt: null, completedAt: new Date().toISOString(), cancelReason: null, error: null, credit: null, url: `/holders/deep/${DEEP_CHECK}`, report: status === 'partial' ? report : null })
    for (const width of [1440, 390]) {
      const ctx = await newContext({ width, mobile: width < 600 })
      await ctx.route(`${BASE}/api/ask`, (route) => json(route, holdersExtraFixtures().ask))
      await ctx.route(`${BASE}/api/holders/deep`, (route) => {
        if (route.request().method() === 'GET') return json(route, { offer: { id: 'holder-deep', name: 'Deep check', priceUsd: 9, freePerMonth: { pro: 3, business: 10 }, bundleScanDiscountPct: 20, maxActive: 2, maxRunning: 2, budgets: { rpcCalls: 1, logSpans: 1, explorerCalls: 1, ms: 1, holders: 1, hops: 1 } }, checkout: { enabled: true }, coverage: { robinhood: cov('robinhood') }, signedIn: true, quota, credits: 0, contact: 'team@gullylabs.xyz' })
        const body = route.request().postDataJSON()
        if (!body.expect) return json(route, { quote: { chain: chainInfo, token: body.token, priceUsd: 0, listPriceUsd: 9, free: true, bundle: { applied: false, discountPct: 20, scanId: null }, bundleNote: null, credit: { available: 0, used: false }, quota, coverage: cov('robinhood'), checkout: { enabled: true }, signedIn: true } })
        return json(route, { check: checkDoc('queued') }, 202)
      })
      await ctx.route(`${BASE}/api/holders/deep/${DEEP_CHECK}`, (route) => json(route, { check: checkDoc('partial') }))
      const page = await ctx.newPage()
      const w = watch(page, `deep check ${width}`)
      await page.goto(BASE + '/holders/robinhood/' + E2E_LAUNCH_TOKEN)
      const offer = page.locator('[data-deep-offer]')
      await offer.waitFor()
      check(`deep check ${width}: the offer shows the $9 price and the plan's free checks`, (await offer.getByText('Deep check · $9').count()) === 1 && (await offer.getByText(/3 of 3 free this month/).count()) === 1)
      check(`deep check ${width}: only the parts available on this chain are offered`, (await offer.locator('[data-deep-part]').count()) === 3 && (await offer.locator('[data-deep-part="trading"]').count()) === 0 && (await offer.locator('[data-deep-missing]').count()) === 1)
      check(`deep check ${width}: the free price and the refund policy are stated`, (await offer.getByText(/credit for a free re-run/).count()) === 1 && (await offer.locator('[data-deep-price]').innerText()) === 'Free')
      await offer.locator('[data-deep-start]').click()
      await offer.locator('[data-deep-quote]').waitFor()
      check(`deep check ${width}: the quote shows nothing charged yet`, (await offer.locator('[data-deep-quote]').getByText(/NOTHING CHARGED YET/).count()) === 1)
      await shotTo(page, `deep-offer-${width}.png`)
      await offer.locator('[data-deep-confirm]').click()
      await page.waitForURL(`**/holders/deep/${DEEP_CHECK}`)
      await page.getByText('Two top wallets share one funder').first().waitFor()
      check(`deep check ${width}: confirming a free check opens its page`, /holders\/deep\//.test(page.url()))
      check(`deep check ${width}: the report page is noindex`, ((await page.locator('meta[name="robots"]').getAttribute('content')) ?? '').includes('noindex'))
      check(`deep check ${width}: the report shows its findings and the unavailable reason`, (await page.getByText(/No archive RPC answers for this chain/).count()) >= 1)
      check(`deep check ${width}: the report draws charts`, (await page.locator('[data-chart]').count()) >= 2)
      await shotTo(page, `deep-report-${width}.png`)
      await noHorizontalScroll(page, `/holders/deep ${width}`)
      await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
      await ctx.close()
    }
    const cctx = await newContext({ width: 1440 })
    const jpg = await cctx.request.get(`${BASE}/api/holders/robinhood/${E2E_LAUNCH_TOKEN}/card.jpg`)
    const jb = await jpg.body()
    check('holder card: card.jpg answers image/jpeg with JPEG bytes', jpg.status() === 200 && (jpg.headers()['content-type'] ?? '').startsWith('image/jpeg') && jb[0] === 0xff && jb[1] === 0xd8, `${jpg.status()} ${jpg.headers()['content-type']}`)
    const png = await cctx.request.get(`${BASE}/api/holders/robinhood/${E2E_LAUNCH_TOKEN}/card.png`)
    check('holder card: card.png still answers image/png', png.status() === 200 && (png.headers()['content-type'] ?? '').startsWith('image/png'), `${png.status()}`)
    await cctx.close()
  }

  // The /holders landing: search (one match navigates, several offer a pick, none says so), the checked-launch feed and the top list.
  for (const width of [1440, 390]) {
    const ctx = await newContext({ width, mobile: width < 600 })
    const page = await ctx.newPage()
    const w = watch(page, `holders landing ${width}`)
    await page.goto(BASE + '/holders')
    await page.locator('[data-launch-feed] li').first().waitFor()
    check(`holders landing ${width}: the checked-launch feed lists launches with scores`, (await page.locator('[data-launch-feed] li').count()) === 5 && (await page.locator('[data-launch-feed]').getByRole('img', { name: 'Score 82 out of 100' }).count()) === 1)
    check(`holders landing ${width}: a launch still being checked says so`, (await page.locator('[data-launch-feed]').getByText('Checking the holders now…').count()) === 1)
    await page.locator('[data-chart] canvas, [data-chart] svg').first().waitFor()
    check(`holders landing ${width}: the health score chart draws`, (await page.locator('[data-chart]').count()) >= 1)
    check(`holders landing ${width}: most scanned today lists maps`, (await page.locator('[data-top-scanned] a').count()) === 2)
    await shotTo(page, `holders-landing-${width}.png`)
    const q = page.getByLabel('Token address or ticker')
    await q.fill('zzz-nothing')
    await page.getByRole('button', { name: 'Map it' }).click()
    await page.locator('[data-no-match]').getByText(/not a token address or a ticker we follow/).waitFor()
    check(`holders landing ${width}: text that is no address or ticker says what to paste`, true)
    await q.fill(E2E_NOT_A_TOKEN)
    await page.getByRole('button', { name: 'Map it' }).click()
    await page.locator('[data-no-match] li').first().waitFor()
    check(`holders landing ${width}: a valid address that is no token names every chain checked and why`, (await page.locator('[data-no-match] li').count()) === 4 && (await page.locator('[data-no-match]').getByText(/There is no contract at this address on Base/).count()) === 1)
    const srcChains = (await (await page.request.get(BASE + '/api/holders/sources')).json()).chains
    const srcText = (await page.locator('[data-holder-sources]').innerText()).replace(/\s+/g, ' ')
    check(`holders landing ${width}: the coverage chips name every chain, the not-yet ones collapsed into one line with logos`, srcChains.every((c) => srcText.includes(c.name)) && (await page.locator('[data-holder-sources] li').count()) <= srcChains.filter((c) => c.any !== 'none').length + 2 && (await page.locator('[data-holder-sources] img, [data-holder-sources] svg').count()) >= srcChains.length)
    check(`holders landing ${width}: the scans bar chart sits above Most scanned today and is live`, (await page.locator('#hl-top').locator('xpath=..').locator('[data-chart]').count()) === 1)
    await q.fill('$NVDA')
    await page.getByRole('button', { name: 'Map it' }).click()
    await page.locator('[data-resolve-matches] a').first().waitFor()
    check(`holders landing ${width}: several matches offer a pick`, (await page.locator('[data-resolve-matches] a').count()) === 2)
    await q.fill(E2E_ANY_TOKEN)
    await page.getByRole('button', { name: 'Map it' }).click()
    await page.waitForURL(new RegExp(`/holders/base/${E2E_ANY_TOKEN}$`))
    const anyMap = page.locator('[data-holder-map="ok"]')
    await anyMap.waitFor()
    check(`holders landing ${width}: an unlisted token opens a map labelled "top holders only", with no launch score`, (await anyMap.locator('[data-coverage="top"]').getByText(/Top holders only/).count()) === 1 && (await anyMap.locator('[data-risk-line]').count()) === 0 && (await anyMap.locator('[data-health-part]').count()) === 0)
    await page.goto(BASE + '/holders')
    await page.getByLabel('Token address or ticker').fill('DTC')
    await page.getByRole('button', { name: 'Map it' }).click()
    await page.waitForURL(new RegExp(`/holders/robinhood/${E2E_LAUNCH_TOKEN}$`))
    check(`holders landing ${width}: one match opens its map`, true)
    await page.locator('[data-holder-map="ok"]').waitFor()
    await noHorizontalScroll(page, `/holders landing ${width}`)
    await designAudit(page, `holders landing ${width}`)
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }
  // The stock page embeds the map with the fair-price overlay; Buy/Sell goes to the page's own swap.
  for (const width of [1440, 390]) {
    const ctx = await newContext({ width, mobile: width < 600 })
    const page = await ctx.newPage()
    const w = watch(page, `stock holder map ${width}`)
    await page.goto(BASE + '/tracker/robinhood/NVDA')
    const sec = page.locator('#holders')
    await sec.scrollIntoViewIfNeeded()
    const map = sec.locator('[data-holder-map="ok"]')
    await map.waitFor()
    await map.locator('[data-chart] canvas').first().waitFor()
    check(`stock holder map ${width}: graph, summary and fair-price overlay`, (await map.locator('[data-holder-fair]').getByText('TOP 10 AT REAL PRICE').count()) === 1 && (await map.locator('[data-holder-summary]').getByText(/^Top 10 wallets hold/).count()) === 1)
    check(`stock holder map ${width}: Buy/Sell points at the page's swap`, (await map.locator('[data-holder-trade] a').getAttribute('href')) === '#swap')
    await shotTo(page, `stock-${width}.png`, sec)
    await noHorizontalScroll(page, `stock holder map ${width}`)
    await designAudit(page, `stock holder map ${width}`)
    await w.verify([/li\.quest|lifi|LI\.FI|wagmi|walletconnect|coinbase|SwapWidget-|ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }
  // The embed: framed by another site, credit shown.
  const ctx = await newContext()
  const page = await ctx.newPage()
  const w = watch(page, 'holder map embed')
  const res = await page.goto(BASE + '/embed/holders/robinhood/' + E2E_LAUNCH_TOKEN)
  check('holder map embed: any site may frame it (frame-ancestors *, no X-Frame-Options)', /frame-ancestors \*/.test(res.headers()['content-security-policy'] ?? '') && !res.headers()['x-frame-options'])
  await page.locator('[data-holder-map="ok"] [data-chart] canvas').first().waitFor()
  check('holder map embed: the Powered by Gully Labs credit shows', await page.locator('[data-credit]').getByText('Powered by Gully Labs').isVisible())
  check('holder map embed: noindex', (await page.locator('meta[name="robots"][content="noindex"]').count()) === 1)
  await shotTo(page, 'embed-1440.png')
  await designAudit(page, 'holder map embed')
  await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
  await ctx.close()
  // The DeepCore page lists the latest launches with their maps.
  const ctx2 = await newContext()
  const p2 = await ctx2.newPage()
  const w2 = watch(p2, 'deepcore launches')
  await p2.goto(BASE + '/projects/deepcore')
  const row = p2.locator('[data-launch-holders] a', { hasText: 'DTC' })
  await row.waitFor()
  check('DeepCore page: launches link to their Holder Maps', (await row.getAttribute('href')) === `/holders/robinhood/${E2E_LAUNCH_TOKEN}`)
  check('DeepCore page: each launch row has a token logo and a chain logo', (await row.locator('img').count()) >= 2)
  await w2.verify([/ERR_BLOCKED_BY_CLIENT/i])
  await ctx2.close()
})

// Chain Kit (/chain-kit) is on a waitlist while the explorer licence is finalised: the page says so, offers the
// waitlist, and has no buy, order, request-to-pay or "available" path. It also must not name Blockscout's licence.
await step('chain kit waitlist', async () => {
  const ctx = await newContext({ width: 1440, height: 900 })
  const page = await ctx.newPage()
  const w = watch(page, '/chain-kit')
  await page.goto(BASE + '/chain-kit')
  await page.getByRole('heading', { level: 1 }).waitFor()
  const main = await page.locator('main').innerText()
  check('/chain-kit: shows the waitlist status and wording', /WAITLIST/.test(main) && /join the waitlist/i.test(main) && /finalising the explorer licence before taking orders/i.test(main))
  check('/chain-kit: no buy, order, request or "available on request" path', !/available on request|talk to us about your chain|request (your|an|a) explorer|buy|order now|checkout|pay now|\bprice[ds]?\b/i.test(main))
  check('/chain-kit: the call to action is a link to the chains waitlist, not a contact or payment form', (await page.locator('main a[href="/chains#waitlist"]').count()) >= 1 && (await page.locator('main').getByRole('button', { name: /start a project|talk to us|request|buy|order/i }).count()) === 0)
  check('/chain-kit: does not mention the Blockscout licence', !/blockscout[’']?s? licen[cs]e|licen[cs]e (from|with|of) blockscout|proprietary|LicenseRef|commercial licen/i.test(main))
  await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
  await page.goto(BASE + '/pricing')
  await page.locator('#on-request').waitFor()
  const pr = await page.locator('#on-request').innerText()
  check('/pricing: the FAQ is an accordion (one open, the rest closed) and the plan cards have icons', (await page.locator('[data-testid="pricing-faq"] details').count()) >= 9 && (await page.locator('[data-testid="pricing-faq"] details[open]').count()) === 1 && (await page.locator('#api .rounded-card svg').count()) >= 3)
  check('/pricing: Chain Kit is badged WAITLIST and offers the waitlist, not "start a project"', /WAITLIST/.test(pr) && /Join the waitlist/.test(pr))
  await ctx.close()
})

// Gully Chains (/chains): the offer reads from GET /api/chains/plans, nothing claims a chain is live, the waitlist
// form submits to the real server, and the page holds at 1440 and 390 (no sideways scroll, kit colours, 11 px text).
// CHAINS_SHOTS=<dir> saves a screenshot per width.
await step('chains page', async () => {
  const shotDir = process.env.CHAINS_SHOTS || null
  if (shotDir) fs.mkdirSync(shotDir, { recursive: true })
  for (const [width, height, mobile] of [[1440, 900, false], [390, 844, true]]) {
    const ctx = await newContext({ width, height, mobile })
    await ctx.addInitScript(() => {
      window.__ev = []
      window.umami = { track: (name, data) => window.__ev.push([name, data ?? null]) }
    })
    const page = await ctx.newPage()
    const w = watch(page, `/chains at ${width}`)
    await page.goto(BASE + '/chains')
    await page.getByRole('heading', { level: 1 }).waitFor()
    await page.getByTestId('chains-waitlist-form').waitFor({ timeout: 15_000 })
    await page.waitForTimeout(800)
    const main = await page.locator('main').innerText()
    check(`/chains at ${width}: from-price and profit share come from the config, testnet price is TBA`, /from \$3,500/i.test(main) && /5%/.test(main) && /TBA/.test(await page.getByTestId('price-testnet').innerText()))
    check(`/chains at ${width}: says a testnet is coming and that prices may change, claims nothing is live`, /testnet is coming/i.test(main) && /Prices before launch may change/.test(main) && /No chain is running yet/.test(main) && !/\bis live\b|now live|chains are live/i.test(main))
    check(`/chains at ${width}: the services are icon chips marked included or add-on, with their status`, (await page.locator('[data-testid="chains-services"] button').count()) === 8 && (await page.locator('#stack').getByText('INCLUDED', { exact: true }).count()) >= 3 && (await page.locator('#stack').getByText('ADD-ON', { exact: true }).count()) >= 3 && (await page.locator('main').getByText('PLANNED', { exact: true }).count()) >= 2)
    check(`/chains at ${width}: no competitor is named`, !/conduit|caldera|alchemy|altlayer|gelato|zksync|op stack/i.test(main))
    const stackBtn = page.locator('#stack ol button').nth(3)
    await stackBtn.click()
    check(`/chains at ${width}: picking a stack layer selects it`, (await stackBtn.getAttribute('aria-pressed')) === 'true')
    await page.locator('#pricing input[type=range]').fill('100000')
    check(`/chains at ${width}: the fee estimate follows the slider (base + share of profit)`, (await page.locator('#pricing').getByRole('img', { name: '$8,500' }).count()) >= 1)
    await noHorizontalScroll(page, `/chains at ${width}`)
    // Compact, with logos and live charts, and a direct message.
    const vh = (await page.evaluate(() => innerHeight))
    const docH0 = await page.evaluate(() => document.documentElement.scrollHeight)
    for (let y = 0; y < docH0; y += vh / 2) { await page.evaluate((v) => scrollTo(0, v), y); await page.waitForTimeout(120) }
    await page.waitForTimeout(600)
    const docH = await page.evaluate(() => document.documentElement.scrollHeight)
    if (width === 1440) check(`/chains at ${width}: the page is compact (${(docH / vh).toFixed(2)} viewports, at most 3.6)`, docH <= vh * 3.6, String(docH))
    const logos = await page.locator('main img').evaluateAll((els) => els.map((e) => [e.getAttribute('src'), e.naturalWidth]))
    const srcs = logos.map((l) => l[0]).join(' ')
    check(`/chains at ${width}: every logo loaded (${logos.length} images, all naturalWidth > 0)`, logos.length >= 8 && logos.every((l) => l[1] > 0), JSON.stringify(logos.filter((l) => !l[1])))
    check(`/chains at ${width}: Arbitrum, Hyperlane, Blockscout, Safe, WalletConnect and DeepCore marks are on the page`, ['/chains/arbitrum.svg', '/integrations/hyperlane.png', '/integrations/blockscout.jpg', '/integrations/safe.jpg', '/integrations/walletconnect.svg', '/venues/deepcore.png', '/integrations/offchain-labs.jpg'].every((s) => srcs.includes(s)), srcs)
    check(`/chains at ${width}: the estimator, the diagram and the fee chart are live (data-live)`, (await page.locator('[data-testid="chains-estimator"] [data-live]').count()) >= 1 && (await page.locator('[data-testid="chains-diagram"][data-live]').count()) === 1 && (await page.locator('[data-testid="chains-fee"]').count()) === 1)
    check(`/chains at ${width}: waitlist momentum is a ghost under 3 days of data`, (await page.locator('[data-testid="chains-momentum"] [data-ghost]').count()) === 1)
    const lit = async () => page.locator('[data-testid="chains-flow"] button[aria-pressed="true"]').innerText()
    await page.getByTestId('chains-diagram').scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    const lit0 = await lit()
    await page.waitForTimeout(3200)
    check(`/chains at ${width}: the diagram lights its layers in sequence`, (await lit()) !== lit0)
    check(`/chains at ${width}: the Telegram button links to the bot`, (await page.getByTestId('telegram-chat-hero').getAttribute('href')) === 'https://t.me/GullyLabsBot?start=chains' && (await page.getByTestId('telegram-chat-form').getAttribute('href')) === 'https://t.me/GullyLabsBot?start=chains')
    await page.getByTestId('message-us-hero').scrollIntoViewIfNeeded()
    await page.getByTestId('message-us-hero').click()
    const mf = page.getByTestId('message-form-hero')
    await mf.getByRole('button', { name: 'Send message' }).click()
    check(`/chains at ${width}: an empty message is refused`, (await mf.getByRole('alert').count()) === 1)
    await mf.locator('input[name=name]').fill('E2E Talker')
    await mf.locator('input[name=contact]').fill(width === 1440 ? `chains-msg-${width}@example.com` : '@e2e_talker')
    await mf.locator('textarea[name=message]').fill('Hello from the chains e2e')
    const posted = page.waitForRequest((r) => r.url().endsWith('/api/contact') && r.method() === 'POST')
    await mf.getByRole('button', { name: 'Send message' }).click()
    const req = await posted
    check(`/chains at ${width}: "Message us" posts to /api/contact with the topic Gully Chains`, /Gully Chains/.test(req.postData() ?? '') && JSON.parse(req.postData()).types.includes('Gully Chains'), req.postData())
    await page.getByTestId('message-done-hero').waitFor({ timeout: 10_000 })
    check(`/chains at ${width}: "Message us" shows success inline`, /Message sent/.test(await page.getByTestId('message-done-hero').innerText()))
    // The form: an incomplete one is refused client-side, a complete one reaches the server.
    await page.getByRole('button', { name: 'Join the waitlist' }).last().click()
    check(`/chains at ${width}: an empty form shows an error and sends nothing`, (await page.getByRole('alert').count()) === 1)
    const wf = page.getByTestId('chains-waitlist-form')
    await wf.getByPlaceholder('Your project').fill(`E2E Chain ${width}`)
    await wf.getByPlaceholder('you@project.xyz or @yourname').fill(`chains-e2e-${width}@example.com`)
    await page.locator('select[name=useCase]').selectOption('gaming')
    await page.locator('select[name=scale]').selectOption('medium')
    await page.getByTestId('chains-more-details').locator('summary').click()
    for (const label of ['Undecided', 'Rollup']) await page.getByRole('radiogroup', { name: label === 'Rollup' ? 'DATA AVAILABILITY' : 'GAS TOKEN' }).getByText(label, { exact: true }).click()
    await page.getByRole('radiogroup', { name: 'ACCOUNT ABSTRACTION AND PAYMASTER?' }).getByText('Yes', { exact: true }).click()
    await page.getByRole('radiogroup', { name: 'DEEPCORE LAUNCHPAD?' }).getByText('No', { exact: true }).click()
    await designAudit(page, `/chains at ${width}`, 'main')
    if (shotDir) await page.screenshot({ path: path.join(shotDir, `chains-${width}-form.png`), fullPage: false })
    await page.getByRole('button', { name: 'Join the waitlist' }).last().click()
    await page.getByTestId('chains-waitlist-done').waitFor({ timeout: 10_000 })
    check(`/chains at ${width}: the form submits and confirms`, /on the waitlist/i.test(await page.getByTestId('chains-waitlist-done').innerText()))
    const ev = await page.evaluate(() => window.__ev)
    const sent = ev.find((e) => e[0] === 'chains-waitlist')
    check(`/chains at ${width}: the chains-waitlist event carries choices only, no name, contact or notes`, !!sent && !/E2E Chain|example\.com|@/.test(JSON.stringify(sent)), JSON.stringify(sent))
    if (shotDir) {
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: path.join(shotDir, `chains-${width}-full.png`), fullPage: true })
    }
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }
  const rows = await (await fetch(`${BASE}/api/admin/chains/waitlist`, { headers: { authorization: `Bearer ${admin}` } })).json()
  check('/chains: both sign-ups reached the admin list', rows.rows?.some((r) => r.contact === 'chains-e2e-1440@example.com') && rows.rows?.some((r) => r.contact === 'chains-e2e-390@example.com'))
  // The admin card lists them.
  const actx = await newContext({ width: 1440, height: 900 })
  await actx.addInitScript((tok) => sessionStorage.setItem('gully-admin-token', tok), admin)
  const apage = await actx.newPage()
  const aw = watch(apage, 'admin chains waitlist')
  await apage.goto(BASE + '/admin#chainkit')
  const card = apage.locator('section', { has: apage.getByRole('heading', { name: 'Gully Chains waitlist' }) })
  await card.waitFor({ timeout: 15_000 })
  await card.getByText('E2E Chain 1440').waitFor({ timeout: 10_000 })
  check('admin: the Gully Chains waitlist card lists the sign-ups with their answers', (await card.getByText('E2E Chain 390').count()) === 1 && (await card.getByText(/gaming · medium/).count()) >= 1)
  await aw.verify([/Failed to load resource/])
  await actx.close()
  const html = await (await fetch(BASE + '/chains')).text()
  check('/chains: the server renders its own title and canonical', /<title>Gully Chains/.test(html) && html.includes('https://gullylabs.xyz/chains'))
  check('/chains: listed in the sitemap', (await (await fetch(BASE + '/sitemap.xml')).text()).includes('<loc>https://gullylabs.xyz/chains</loc>'))
})

await step('pages at 390', async () => {
  const ctx = await newContext({ width: 390, height: 844, mobile: true })
  const page = await ctx.newPage()
  for (const p of ['/', '/tracker', '/tracker/robinhood/NVDA', '/pricing', '/widget', '/ask', '/analytics', '/chain-kit', '/chains', '/security', '/security/reports', '/score', '/services', '/about', '/projects/deepcore', '/app', '/legal/privacy', '/links', '/status']) {
    const w = watch(page, `${p} at 390`)
    if (p === '/app') w.expect(/\/api\/developer\//)
    await page.goto(BASE + p)
    await page.waitForLoadState('networkidle').catch(() => {})
    await noHorizontalScroll(page, p)
    await designAudit(page, `${p} at 390`)
    await w.verify([/li\.quest|lifi|wagmi|ERR_BLOCKED_BY_CLIENT/i])
  }
  await ctx.close()
})

// The link hub (/links): the kit lockup, every link a new tab with noopener, web links tagged for the KOL
// campaign, the Gully Pay fee read from the server, and the live movers row.
await step('links hub', async () => {
  const ctx = await newContext({ width: 390, height: 844, mobile: true })
  const page = await ctx.newPage()
  const w = watch(page, '/links')
  await page.goto(BASE + '/links')
  await page.waitForLoadState('networkidle').catch(() => {})
  const r = await page.evaluate(() => {
    const links = [...document.querySelectorAll('main a[href^="http"]')]
    return {
      kit: document.querySelectorAll('main [data-brand="kit"]').length,
      n: links.length,
      bad: links.filter((a) => a.getAttribute('target') !== '_blank' || !/noopener/.test(a.getAttribute('rel') ?? '')).map((a) => a.getAttribute('href')),
      noIcon: links.filter((a) => !a.querySelector('svg')).map((a) => a.getAttribute('href')),
      untagged: links.filter((a) => !/^https:\/\/(t\.me|x\.com|github\.com)\//.test(a.href) && !/utm_source=kol&utm_medium=links&utm_campaign=launch/.test(a.href)).map((a) => a.getAttribute('href')),
      pay: /0\.5% after the first \$5,000/.test(document.body.textContent ?? ''),
      // The live products, each a link to its own page (branch A's copy: no longer "coming soon").
      names: ['Holder Map', 'Gully Security', 'Gully Score'].filter((n) => (document.querySelector('main')?.textContent ?? '').includes(n)),
      live: ['/holders', '/security', '/score'].filter((p) => links.some((a) => { try { return new URL(a.href).pathname === p } catch { return false } })),
      soon: [...document.querySelectorAll('main a, main li, main div')].some((e) => e.children.length < 6 && /Holder Map/.test(e.textContent ?? '') && /coming soon/i.test(e.textContent ?? '')),
    }
  })
  check('/links: the kit lockup is there', r.kit > 0, JSON.stringify(r))
  check('/links: at least 15 links, each a new tab with noopener and an icon', r.n >= 15 && !r.bad.length && !r.noIcon.length, JSON.stringify(r))
  check('/links: every web link carries the KOL UTM tags', !r.untagged.length, JSON.stringify(r.untagged))
  check('/links: the Gully Pay fee is read from the server', r.pay)
  check('/links: Holder Map, Gully Security and Gully Score are listed', r.names.length === 3 && r.live.length === 3 && !r.soon, JSON.stringify({ names: r.names, live: r.live, soon: r.soon }))
  check('/links: the title', (await page.title()) === 'Links · Gully Labs', await page.title())
  await noHorizontalScroll(page, '/links')
  await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
  await ctx.close()
})

// Design audit 3, group 6: movers empty state, stock KPI ghosts, tracker card fill, docs logo chips and plain
// prose, hero art and token logos at 2x, and the docs charts staying live at phone widths.
await step('da3-g6 empty states, fills, logos and prose', async () => {
  const EMPTY_MOVERS = { window: '24h', windowSeconds: 86400, toleranceSeconds: 1800, asOf: null, from: null, to: null, eligible: 0, historyHours: 6, note: 'Needs 24h of snapshots: the longest series so far covers 6 h.', limit: 10, chain: null, byGap: [], byPrice: [] }
  const lum = (c) => {
    const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
  // D17: the movers' "needs 24h" note sits on a ghost chart in muted ink, not faint text on a shimmer.
  for (const [url, width, mobile] of [['/tracker', 1440, false], ['/tracker', 390, true], ['/links', 390, true], ['/links', 320, true], ['/this-page-does-not-exist', 390, true]]) {
    const ctx = await newContext({ width, height: mobile ? 844 : 900, mobile })
    await ctx.route('**/api/tracker/movers*', (route) => json(route, EMPTY_MOVERS))
    const page = await ctx.newPage()
    const w = watch(page, `da3-g6 ${url} ${width}`)
    await page.goto(BASE + url)
    const ghost = page.getByTestId('movers-empty').first()
    await ghost.waitFor({ timeout: 15_000 })
    await ghost.scrollIntoViewIfNeeded()
    const r = await page.evaluate(() => {
      const g = document.querySelector('[data-testid="movers-empty"]')
      const n = document.querySelector('[data-testid="movers-empty-note"]')
      const rgb = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
      const cs = getComputedStyle(n)
      return { color: rgb(cs.color), size: parseFloat(cs.fontSize), text: n.textContent, hasSvg: !!g.querySelector('svg'), shimmer: !!n.closest('.gl-skeleton'), clipped: n.scrollWidth > n.clientWidth + 1 }
    })
    check(`da3-g6 ${url} ${width}: the movers note is on a ghost chart at 4.5:1 or better, not on a shimmer`, r.hasSvg && !r.shimmer && r.size >= 11 && ratio(r.color, [21, 29, 40]) >= 4.5 && /Needs 24h of snapshots/.test(r.text), JSON.stringify(r))
    await noHorizontalScroll(page, `da3-g6 ${url} ${width}`)
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i, ...(url === '/this-page-does-not-exist' ? [/404/] : [])])
    await ctx.close()
  }
  // D17, the same pattern on /ask: with no trusted gap, the widest-gaps chart is a ghost with a 4.5:1 note.
  for (const width of [390, 320]) {
    const ctx = await newContext({ width, height: 844, mobile: true })
    await ctx.route('**/api/tracker', (route) => json(route, { rows: [], rules: { inLinePct: 1 } }))
    const page = await ctx.newPage()
    const w = watch(page, `da3-g6 /ask ${width}`)
    await page.goto(BASE + '/ask')
    const ghost = page.getByTestId('top-gaps-empty').first()
    await ghost.waitFor({ timeout: 15_000 })
    await ghost.scrollIntoViewIfNeeded()
    const r = await ghost.evaluate((g) => {
      const n = g.querySelector('span.font-mono')
      const cs = getComputedStyle(n)
      return { color: (cs.color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number), size: parseFloat(cs.fontSize), svg: !!g.querySelector('svg'), shimmer: !!n.closest('.gl-skeleton') }
    })
    check(`da3-g6 /ask ${width}: no trusted gap draws a ghost chart with a 4.5:1 note`, r.svg && !r.shimmer && r.size >= 11 && ratio(r.color, [21, 29, 40]) >= 4.5, JSON.stringify(r))
    await noHorizontalScroll(page, `da3-g6 /ask ${width}`)
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }
  // D29: a stock page's "-" stat cells hold a ghost sparkline and keep their caption.
  {
    const ctx = await newContext({ width: 390, height: 844, mobile: true })
    await ctx.route('**/api/tracker/movers*', (route) => json(route, { ...EMPTY_MOVERS, stock: null }))
    const page = await ctx.newPage()
    const w = watch(page, 'da3-g6 stock page')
    await page.goto(BASE + '/tracker/robinhood/NVDA')
    await page.getByTestId('kpi-ghost').first().waitFor({ timeout: 15_000 })
    const k = await page.evaluate(() => [...document.querySelectorAll('[data-testid="kpi-ghost"]')].map((g) => ({ svg: !!g.querySelector('svg'), caption: g.closest('dd')?.parentElement?.lastElementChild?.textContent ?? '', dash: /—/.test(g.textContent ?? '') })))
    check('da3-g6 stock page 390: the empty GAP stat cells draw a ghost sparkline with their caption', k.length >= 2 && k.every((c) => c.svg && /snapshots|trusted/.test(c.caption) && !c.dash), JSON.stringify(k))
    await noHorizontalScroll(page, 'da3-g6 stock page')
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }
  // D30: the "Gap to fair price" card fills the height of the detail card beside it on a wide screen.
  {
    const ctx = await newContext({ width: 1440, height: 900 })
    const page = await ctx.newPage()
    const w = watch(page, 'da3-g6 tracker fill')
    await page.goto(BASE + '/tracker')
    await page.locator('#tracker-detail').waitFor({ timeout: 15_000 })
    await page.waitForTimeout(800)
    const h = await page.evaluate(() => {
      const detail = document.querySelector('#tracker-detail').getBoundingClientRect()
      const card = [...document.querySelectorAll('section')].find((s) => s.querySelector(':scope > div > h2')?.textContent === 'Gap to fair price')
      const rows = card ? [...card.querySelectorAll('ul[aria-label="Gap to fair price, by token"] li')] : []
      const last = rows.at(-1)?.getBoundingClientRect()
      const cr = card?.getBoundingClientRect()
      return { detail: Math.round(detail.height), card: Math.round(cr?.height ?? 0), rows: rows.length, blank: last && cr ? Math.round(cr.bottom - last.bottom) : null }
    })
    check('da3-g6 /tracker 1440: the Gap to fair price card is as tall as the chart card and its rows use the room', h.card >= h.detail - 4 && h.blank !== null && h.blank < 140, JSON.stringify(h))
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }
  // D21, D25: docs Contracts, Solana Pay and Swaps wear logo chips; no developer residue in the prose.
  for (const [width, mobile] of [[1440, false], [390, true], [320, true]]) {
    const ctx = await newContext({ width, height: mobile ? 844 : 900, mobile })
    const page = await ctx.newPage()
    const w = watch(page, `da3-g6 docs ${width}`)
    await page.goto(`${BASE}/docs/contracts`)
    await page.locator('[data-contract]').first().waitFor()
    await page.locator('[data-contract] img').first().scrollIntoViewIfNeeded()
    await page.waitForTimeout(600)
    const c = await page.evaluate(() => {
      const row = document.querySelector('[data-contract]:has(a[href*="sourcify"])') ?? document.querySelector('[data-contract]')
      const imgs = [...document.querySelectorAll('main img')]
      const verified = [...document.querySelectorAll('[data-contract] a[href*="sourcify"]')]
      return { rows: document.querySelectorAll('[data-contract]').length, chain: !!row.querySelector('img[src*="/chains/"]'), venue: !!row.querySelector('img[src*="/venues/"], img[src*="/brand/"]'), sourcify: verified.length > 0 && verified.every((a) => a.querySelector('img[src*="sourcify"]')), broken: imgs.filter((i) => i.complete && !i.naturalWidth).length, path: /src\/deployments|packages\/sdk/.test(document.querySelector('main')?.textContent ?? '') }
    })
    check(`da3-g6 docs /contracts ${width}: chain, project and Sourcify names carry logos, none broken, no file paths`, c.chain && c.venue && c.sourcify && !c.broken && !c.path, JSON.stringify(c))
    await noHorizontalScroll(page, `da3-g6 docs /contracts ${width}`)
    for (const slug of ['solana-pay', 'swaps']) {
      await page.goto(`${BASE}/docs/${slug}`)
      await page.getByRole('heading', { level: 1 }).first().waitFor()
      await page.waitForTimeout(500)
      const n = await page.evaluate(() => ({ chips: document.querySelectorAll('main span.inline-flex img').length, broken: [...document.querySelectorAll('main img')].filter((i) => i.complete && !i.naturalWidth).length }))
      check(`da3-g6 docs /${slug} ${width}: names are logo chips and every logo loads`, n.chips >= 4 && !n.broken, JSON.stringify(n))
      await noHorizontalScroll(page, `da3-g6 docs /${slug} ${width}`)
    }
    if (width === 1440) {
      // "null" belongs in code only; no raw error JSON in prose.
      for (const slug of ['api', 'gully-ai', 'gully-score', 'status', 'teams', 'plans-alerts', 'sdk', 'gully-pay', 'gully-pay-merchants']) {
        await page.goto(`${BASE}/docs/${slug}`)
        await page.getByRole('heading', { level: 1 }).first().waitFor()
        const prose = await page.evaluate(() => {
          const main = document.querySelector('main').cloneNode(true)
          main.querySelectorAll('pre, code, [data-code]').forEach((e) => e.remove())
          return main.textContent ?? ''
        })
        check(`da3-g6 docs /${slug}: no "null" or raw error JSON in the prose`, !/\bnull\b/.test(prose) && !/\{\s*"?error"?\s*[:}]/.test(prose), (prose.match(/.{20}(\bnull\b|\{\s*"?error).{20}/) ?? [''])[0])
      }
    }
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }
  // D20: hero art is exported larger than the slot's 1x and the two ETF logos are real PNGs.
  {
    const ctx = await newContext({ width: 1440, height: 900 })
    const page = await ctx.newPage()
    await page.goto(BASE + '/about')
    const dims = await page.evaluate(async () => {
      const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res([0, 0]); i.src = src })
      const out = {}
      for (const f of ['/assets/mascot-scientist.webp', '/assets/peddles.webp', '/assets/peddlequest.webp', '/tokens/logos/SLV.png', '/tokens/logos/EWY.png']) out[f] = await load(f)
      return out
    })
    check('da3-g6 hero art: mascot 1000+ px, Peddles 1200+ px, PeddleQuest 1100+ px wide', dims['/assets/mascot-scientist.webp'][0] >= 1000 && dims['/assets/peddles.webp'][0] >= 1200 && dims['/assets/peddlequest.webp'][0] >= 1100, JSON.stringify(dims))
    check('da3-g6 token logos: SLV and EWY are 128+ px PNGs', dims['/tokens/logos/SLV.png'][0] >= 128 && dims['/tokens/logos/EWY.png'][0] >= 128, JSON.stringify(dims))
    await ctx.close()
  }
  // D32: the live charts on these docs pages are alive at phone widths: a live strip with a pulsing dot sits on the
  // chart (the desktop header's dot is hidden on phones), is on while on screen, fits the width and animates.
  for (const width of [1440, 390, 320]) {
    const ctx = await newContext({ width, height: 844, mobile: width < 600 })
    const page = await ctx.newPage()
    for (const slug of ['widget', 'api-keys', 'plans-alerts', 'gully-score', 'swaps', 'roadmap']) {
      const w = watch(page, `da3-g6 docs /${slug} ${width}`)
      await page.goto(`${BASE}/docs/${slug}`)
      await page.getByRole('heading', { level: 1 }).first().waitFor()
      const box = page.getByTestId('live-pulse').first()
      await box.waitFor({ state: 'attached', timeout: 15_000 })
      await box.scrollIntoViewIfNeeded()
      await page.waitForTimeout(1200)
      const s = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="live-pulse"]')
        const r = el.getBoundingClientRect()
        const running = el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length
        const strip = el.firstElementChild
        return { live: el.getAttribute('data-live'), w: Math.round(r.width), vw: window.innerWidth, running, clipped: strip.scrollWidth > strip.clientWidth + 1, text: strip.textContent, chart: !!el.querySelector('[data-chart], svg, canvas, [role="img"]') }
      })
      check(`da3-g6 docs /${slug} ${width}: the live chart shows its pulse, on screen, unclipped and animating`, s.live === 'on' && s.w <= s.vw && s.running > 0 && !s.clipped && /^LIVE/.test(s.text) && s.chart, JSON.stringify(s))
      await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    }
    await ctx.close()
  }
})

/* ------------------------------------------------------------- status, docs, analytics --- */

// The public status (P1-1): GET /api/status from the server's own checks, and the /status page drawn from it.
await step('status page and API', async () => {
  const r = await fetch(BASE + '/api/status')
  const text = await r.text()
  const s = JSON.parse(text)
  const ids = (s.components ?? []).map((c) => c.id)
  check('/api/status: 200 JSON, public cache and CORS', r.status === 200 && /application\/json/.test(r.headers.get('content-type') ?? '') && /max-age=30/.test(r.headers.get('cache-control') ?? '') && r.headers.get('access-control-allow-origin') === '*')
  check('/api/status: overall, interval and incidents', ['operational', 'degraded', 'major'].includes(s.overall) && s.intervalSeconds === 60 && Array.isArray(s.incidents), JSON.stringify({ overall: s.overall, i: s.intervalSeconds }))
  check('/api/status: every part of the stack is checked', ['api', 'tracker-robinhood', 'tracker-bsc', 'tracker-solana', 'deepcore', 'telegram', 'telegram-gate', 'pay-feeproxy', 'ai', 'security', 'monitors', 'holders-deepcore'].every((id) => ids.includes(id)) && ids.some((id) => id.startsWith('pay-')), ids.join())
  const byId = Object.fromEntries(s.components.map((c) => [c.id, c]))
  check('/api/status: the API is up and the Telegram webhook reads as registered', byId.api?.state === 'up' && byId.telegram?.state === 'up' && /waiting/.test(byId.telegram?.detail ?? ''), JSON.stringify([byId.api, byId.telegram].map((c) => c && { s: c.state, d: c.detail })))
  check('/api/status: Gully Pay RPCs answer per offered chain (stub RPCs)', OFFERED.filter((n) => n !== 'Solana').every((n) => s.components.some((c) => c.group === 'payments' && c.name.endsWith(n) && c.state === 'up')), JSON.stringify(s.components.filter((c) => c.group === 'payments').map((c) => `${c.name}:${c.state}`)))
  check('/api/status: each component has 48 half-hour buckets and an uptime once checked', s.components.every((c) => c.history.length === 48 && c.history.every((b) => b.up === null || (b.up >= 0 && b.up <= 1)) && (['off', 'unknown'].includes(c.state) || c.uptime24h !== null)), JSON.stringify(s.components.map((c) => [c.id, c.history.length, c.uptime24h])))
  check('/api/status: no secret, RPC URL or env var name in the answer', !text.includes(process.env.TELEGRAM_BOT_TOKEN) && !/e2e\.invalid|GULLY_|_API_KEY|api\.telegram\.org|\/bot\d/.test(text))
  check('/api/status: a non-GET is refused', (await fetch(BASE + '/api/status', { method: 'POST' })).status === 405)
  for (const width of [1440, 390]) {
    const ctx = await newContext({ width, height: width < 600 ? 844 : 900, mobile: width < 600 })
    await ctx.addInitScript(() => {
      window.__ev = []
      window.umami = { track: (name, data) => window.__ev.push([name, data ?? null]) }
    })
    const page = await ctx.newPage()
    const w = watch(page, `/status at ${width}`)
    await page.goto(BASE + '/status')
    await page.getByRole('heading', { name: /System status/i }).waitFor()
    await page.getByText(/All systems operational|Some systems degraded|Major outage/).first().waitFor({ timeout: 15_000 })
    check(`/status at ${width}: the overall state and every group`, (await page.getByRole('region', { name: 'Tracker freshness' }).count()) === 1 && (await page.getByRole('region', { name: 'Gully Pay RPC' }).count()) === 1 && (await page.getByRole('region', { name: 'Telegram bot' }).count()) === 1)
    check(`/status at ${width}: the ring and uptime bars draw (live charts)`, await drawnIn(page, 'main'))
    check(`/status at ${width}: chain rows carry their logo, cards are not stretched, strips are live`, await page.evaluate(() => {
      const logos = document.querySelectorAll('section[aria-label="Tracker freshness"] img').length
      const sec = document.querySelector('section[aria-label="Platform"]')
      const items = sec ? sec.querySelectorAll('li').length : 0
      return logos > 0 && items > 0 && sec.getBoundingClientRect().height < items * 130 + 110 && document.querySelectorAll('[data-uptime-strip]').length > 5 && document.querySelectorAll('[data-live]').length > 0
    }))
    check(`/status at ${width}: the incident history is shown`, (await page.getByRole('heading', { name: 'Incident history' }).count()) === 1)
    check(`/status at ${width}: a status-view event is sent to Gully Analytics`, (await page.evaluate(() => window.__ev.filter((e) => e[0] === 'status-view').length)) === 1, JSON.stringify(await page.evaluate(() => window.__ev)))
    await noHorizontalScroll(page, '/status')
    await designAudit(page, `/status at ${width}`)
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }
  // The footer links the status page.
  const ctx = await newContext()
  const page = await ctx.newPage()
  await page.goto(BASE + '/')
  check('footer: links /status and the Telegram bot', (await page.locator('footer a[href="/status"]').count()) === 1 && (await page.locator('footer a[href="https://t.me/GullyLabsBot"]').count()) === 1)
  await ctx.close()
})

// The new docs pages (P1-5): each loads under /docs with its title, sidebar icon and a live chart; the sitemap lists them.
await step('docs pages', async () => {
  const { sitemapFor } = await import(new URL('../server/seo.mjs', import.meta.url).href)
  // A few hours of real check history for the components the docs pages chart (Gully AI, the Telegram webhook and
  // the API): one status round per half hour, recorded through status.mjs as the loop would, so the 24-hour charts
  // draw real buckets instead of the honest "not enough data" ghost.
  {
    const st = await import(new URL('../server/status.mjs', import.meta.url).href)
    const parts = [['ai', 'ai', 'Gully AI'], ['telegram', 'telegram', 'Telegram bot webhook'], ['api', 'platform', 'Public API']]
    for (let k = 6; k >= 1; k--) st.recordResults(parts.map(([id, group, name]) => ({ id, group, name, state: 'up', detail: 'seeded by the e2e', latencyMs: 40 + k })), Date.now() - k * 30 * 60_000)
  }
  const docsMap = sitemapFor('docs.gullylabs.xyz')
  const mainMap = sitemapFor('gullylabs.xyz')
  for (const slug of ['gully-ai', 'telegram', 'chain-kit', 'swaps', 'solana', 'status']) check(`docs sitemap lists /${slug}`, docsMap.includes(`https://docs.gullylabs.xyz/${slug}<`))
  check('sitemap: /status listed; no stock Holder Map page while no chain reports holder data', mainMap.includes('https://gullylabs.xyz/status<') && !/\/holders\/(robinhood|bsc|solana)\//.test(mainMap))
  check('sitemap: the admin host has none (P2-18)', sitemapFor('admin.gullylabs.xyz') === null)
  // The public product pages are in the main sitemap, and scripts/indexnow-submit.mjs (same <loc> regex) reads them all.
  const mainLocs = [...mainMap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1])
  const docLocs = [...docsMap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1])
  check('sitemap: /status, /security, /security/reports, /score, /holders and /links on the main host, as IndexNow reads it', ['/status', '/security', '/security/reports', '/score', '/holders', '/links'].every((p) => mainLocs.includes(`https://gullylabs.xyz${p}`)) && mainLocs.every((u) => new URL(u).host === 'gullylabs.xyz'), mainLocs.filter((u) => !u.includes('/tracker/')).join(' '))
  check('sitemap: every docs page on the docs host only', ['gully-ai', 'telegram', 'chain-kit', 'swaps', 'solana', 'status', 'holder-map', 'gully-security', 'gully-score', 'roadmap'].every((slug) => docLocs.includes(`https://docs.gullylabs.xyz/${slug}`)) && docLocs.every((u) => new URL(u).host === 'docs.gullylabs.xyz') && !mainLocs.some((u) => /\/docs\//.test(u)))
  const ctx = await newContext({ width: 1440, height: 900 })
  const page = await ctx.newPage()
  // The shared tracker fixture has no Solana rows; the Solana page charts three xStocks (one priced by the issuer).
  const solRows = ['TSLAx', 'NVDAx', 'AAPLx'].map((ticker, i) => ({ ...TRACKER.rows[i], chain: 'solana', ticker, token: `So1ana${i}`.padEnd(44, '1'), gapPct: [0.6, -1.4, 2.2][i], rawGapPct: [0.6, -1.4, 2.2][i], status: ['in-line', 'drifting', 'premium'][i], fairSource: i === 2 ? 'backed' : 'chainlink:56' }))
  await page.route(`${BASE}/api/tracker`, (route) => json(route, { ...TRACKER, chains: [...TRACKER.chains, { key: 'solana', id: 'solana', name: 'Solana', sessionOpen: true, sessionName: 'NYSE hours', poolsAsOf: TRACKER.generatedAt, poolsStale: false, poolSource: 'on chain', fairMethod: 'Chainlink feed or issuer quote' }], rows: [...TRACKER.rows, ...solRows] }))
  for (const slug of ['gully-ai', 'telegram', 'chain-kit', 'swaps', 'solana', 'status', 'holder-map', 'methodology', 'api']) {
    const w = watch(page, `/docs/${slug}`)
    await page.goto(`${BASE}/docs/${slug}`)
    await page.locator('#docs-main h1').waitFor({ timeout: 15_000 })
    check(`/docs/${slug}: the sidebar link has an icon and is current`, (await page.locator(`nav[aria-label="Docs"] a[aria-current="page"] svg`).count()) >= 1)
    // Charts draw when scrolled into view: bring each one in, then at least one must have drawn from live data.
    await page.waitForLoadState('networkidle').catch(() => {})
    let drew = false
    for (const el of await page.locator('#docs-main [data-chart]').all()) {
      await el.scrollIntoViewIfNeeded().catch(() => {})
      // Drawn: the kit fades the chart in over its skeleton once ECharts (lazy) has rendered the live data.
      const h = await el.elementHandle()
      drew = await page.waitForFunction((e) => e.classList.contains('opacity-100') && !!e.querySelector('svg'), h, { timeout: 15_000 }).then(() => true, () => false)
      if (drew) break
    }
    check(`/docs/${slug}: a live chart draws`, drew, `${await page.locator('#docs-main [data-chart]').count()} charts on the page`)
    await designAudit(page, `/docs/${slug}`, '#docs-main')
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
  }
  await page.goto(`${BASE}/docs/api`)
  await page.locator('#docs-main h1').waitFor()
  const api = await page.locator('#docs-main').textContent()
  check('API reference documents /api/status, /api/pay/gas, /api/tracker/gap-index, /api/holders and /api/score', ['/api/status', '/api/pay/gas', '/api/tracker/gap-index', '/api/holders', '/api/score'].every((p) => (api ?? '').includes(p)))
  await ctx.close()
})

// The analytics wrapper (P1-14, src/lib/track.ts): events reach umami.track with no address in them, nothing is
// sent under Do Not Track, and with the script blocked (the e2e default) every tracked click still works.
await step('analytics events', async () => {
  const fake = () => {
    window.__ev = []
    window.umami = { track: (name, data) => window.__ev.push([name, data ?? null]) }
  }
  const ctx = await newContext({ width: 1440, height: 900 })
  await ctx.addInitScript(fake)
  const page = await ctx.newPage()
  const w = watch(page, 'analytics events')
  // window.__ev starts empty on every full page load: collect it before each one.
  const ev = []
  const collect = async () => ev.push(...(await page.evaluate(() => window.__ev)))
  await page.goto(BASE + '/')
  await page.getByRole('link', { name: 'Launch app' }).first().click()
  await page.waitForURL(/\/tracker$/)
  await collect()
  await page.goto(BASE + '/pricing')
  const plan = page.locator('#api a[target="_blank"]').first()
  await plan.waitFor()
  await plan.evaluate((a) => a.addEventListener('click', (e) => e.preventDefault()))
  await plan.click()
  await collect()
  await page.goto(BASE + '/links')
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(() => {
    document.addEventListener('click', (e) => e.preventDefault())
    document.querySelector('main a[href^="http"]')?.click()
  })
  await collect()
  const names = ev.map((e) => e[0])
  check('analytics: Launch app, a pricing plan click and a /links click are sent', names.includes('launch-app') && names.includes('plan-click') && names.includes('link-click'), JSON.stringify(ev))
  check('analytics: no wallet address, email or full URL in any event', !/0x[0-9a-fA-F]{20,}|@[a-z0-9-]+\.[a-z]|https?:\/\//i.test(JSON.stringify(ev)), JSON.stringify(ev))
  await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
  await ctx.close()

  // The product events (follow-up branch): Gully AI, the /security review form, a Gully Score page, a Holder Map
  // and a Jupiter swap quote, each on stubbed answers. Only labels go out: no question, wallet, address or hash.
  {
    const ctx = await newContext({ width: 1440, height: 900 })
    await ctx.addInitScript(fake)
    const solRow = { ...TRACKER.rows[0], chain: 'solana', ticker: 'TSLA', symbol: 'TSLAx', token: 'So1ana0'.padEnd(44, '1'), fairSource: 'chainlink:56' }
    await ctx.route(`${BASE}/api/tracker`, (route) => json(route, { ...TRACKER, chains: [...TRACKER.chains, { key: 'solana', id: 'solana', name: 'Solana', sessionOpen: true, sessionName: 'NYSE hours', poolsAsOf: TRACKER.generatedAt, poolsStale: false, poolSource: 'on chain', fairMethod: 'Chainlink feed or issuer quote' }], rows: [...TRACKER.rows, solRow] }))
    await ctx.route(new RegExp(`^${BASE}/api/solana/jupiter/quote`), (route) => json(route, { quote: { id: 'q_e2e', side: 'buy', inSymbol: 'USDC', outSymbol: 'TSLAx', inAmount: '10', outAmount: '0.0231', minOut: '0.0229', priceImpactPct: 0.02, route: [{ label: 'Raydium', percent: 100 }], platformFee: null, feeNote: null, slippageBps: 50, expiresAt: new Date(Date.now() + 60_000).toISOString() } }))
    await ctx.route(`${BASE}/api/security/review-requests`, (route) => json(route, { request: { id: 'rr_e2e' } }))
    const page = await ctx.newPage()
    const w = watch(page, 'product events')
    const pev = []
    const grab = async () => pev.push(...(await page.evaluate(() => window.__ev)))
    await page.goto(BASE + '/ask')
    await page.getByPlaceholder('How do gap alerts work?').fill('How do gap alerts work?')
    await page.getByRole('button', { name: 'Ask', exact: true }).click()
    await page.getByTestId('ask-rate-up').waitFor({ timeout: 20_000 })
    await page.getByTestId('ask-rate-up').click()
    await page.waitForFunction(() => document.querySelector('[data-testid="ask-rate-up"]')?.getAttribute('aria-pressed') === 'true')
    await grab()
    await page.goto(BASE + '/security')
    const form = page.getByTestId('review-form')
    await form.waitFor()
    for (const input of await form.locator('input[required], textarea[required]').all()) {
      const type = (await input.getAttribute('type')) ?? 'text'
      const tag = await input.evaluate((e) => e.tagName)
      await input.fill(type === 'email' ? 'dev@example.com' : tag === 'TEXTAREA' ? 'Two vault contracts, about 600 lines, before mainnet.' : 'E2E project')
    }
    await form.locator('button[type="submit"]').click()
    await page.getByTestId('review-sent').waitFor({ timeout: 10_000 })
    await grab()
    await page.goto(`${BASE}/score/base/0x${'ab'.repeat(20)}`)
    await page.getByRole('heading', { level: 1 }).waitFor()
    await grab()
    await page.goto(`${BASE}/holders/robinhood/${E2E_LAUNCH_TOKEN}`)
    await page.locator('[data-holder-map="ok"]').waitFor()
    await grab()
    await page.goto(BASE + '/tracker/solana/TSLA')
    await page.getByRole('checkbox', { name: 'I understand' }).check()
    await page.getByText(/~0\.0231/).waitFor({ timeout: 15_000 })
    await grab()
    const by = (n) => pev.filter((e) => e[0] === n).map((e) => e[1])
    check('analytics: ask-asked carries the surface and the tools, not the question', by('ask-asked').length === 1 && by('ask-asked')[0].surface === 'ask-page' && typeof by('ask-asked')[0].tools === 'string' && !('q' in by('ask-asked')[0]), JSON.stringify(by('ask-asked')))
    check('analytics: ask-rated carries the rating', JSON.stringify(by('ask-rated')) === '[{"rating":"up"}]', JSON.stringify(by('ask-rated')))
    check('analytics: review-requested on the public /security form, with the tier', JSON.stringify(by('review-requested')) === '[{"tier":"review"}]', JSON.stringify(by('review-requested')))
    check('analytics: score-viewed with the chain only', JSON.stringify(by('score-viewed')) === '[{"chain":"base"}]', JSON.stringify(by('score-viewed')))
    check('analytics: holder-map-opened with chain, kind and surface', JSON.stringify(by('holder-map-opened')) === '[{"chain":"robinhood","kind":"deepcore-launch","from":"holders-page"}]', JSON.stringify(by('holder-map-opened')))
    check('analytics: swap-quoted once for the Jupiter quote', JSON.stringify(by('swap-quoted')) === '[{"venue":"jupiter","chain":"solana","ticker":"TSLA"}]', JSON.stringify(by('swap-quoted')))
    check('analytics: no wallet, token address, email or URL in the product events', !/0x[0-9a-fA-F]{20,}|So1ana|@|https?:\/\//i.test(JSON.stringify(pev)), JSON.stringify(pev))
    await w.verify([/ERR_BLOCKED_BY_CLIENT|Failed to load resource/i])
    await ctx.close()
  }

  // Do Not Track: nothing is sent.
  const dnt = await newContext({ width: 1440, height: 900 })
  await dnt.addInitScript(() => Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1' }))
  await dnt.addInitScript(fake)
  const dp = await dnt.newPage()
  await dp.goto(BASE + '/status')
  await dp.getByRole('heading', { name: /System status/i }).waitFor()
  await dp.getByRole('link', { name: 'Launch app' }).first().click()
  await dp.waitForURL(/\/tracker$/)
  check('analytics: Do Not Track sends nothing', (await dp.evaluate(() => window.__ev.length)) === 0, JSON.stringify(await dp.evaluate(() => window.__ev)))
  await dnt.close()
  // Blocked script (no window.umami): tracked actions still work and nothing throws.
  const blocked = await newContext({ width: 1440, height: 900 })
  const bp = await blocked.newPage()
  const bw = watch(bp, 'analytics blocked')
  await bp.goto(BASE + '/status')
  await bp.getByRole('heading', { name: /System status/i }).waitFor()
  await bp.getByRole('link', { name: 'Launch app' }).first().click()
  await bp.waitForURL(/\/tracker$/)
  check('analytics: with the script blocked, Launch app still navigates', new URL(bp.url()).pathname === '/tracker')
  await bw.verify([/ERR_BLOCKED_BY_CLIENT/i])
  await blocked.close()
})

/* ------------------------------------------------------------- brand kit --- */

// Every logo is one of src/components/brand (data-brand="kit", from the kit's own files): no CSS-typed
// "GULLY LABS" wordmark, letter tile or hand-drawn SVG wordmark on any surface, the self-contained error
// pages and the widget included (owner rule, CLAUDE.md "Brand kit everywhere").
await step('design audit 2 group 8: landing console, live charts', async () => {
  for (const [width, mobile] of [[1440, false], [390, true]]) {
    const ctx = await newContext({ width, height: mobile ? 844 : 900, mobile })
    const page = await ctx.newPage()
    const w = watch(page, `home at ${width}`)
    await page.goto(BASE + '/')
    await page.locator('#console-panel').waitFor({ timeout: 15_000 })
    await page.locator('#products').scrollIntoViewIfNeeded()
    await page.waitForTimeout(1500)
    // N13: the console pane holds no fixed minimum height, so there is no empty band under a short demo.
    const gap = await page.evaluate(() => {
      const inner = document.getElementById('console-panel')
      const outer = inner?.parentElement
      return outer && inner ? outer.getBoundingClientRect().height - inner.getBoundingClientRect().height : 999
    })
    check(`home at ${width}: no empty band under the product console (pane is ${Math.round(gap)} px taller than its content)`, gap < 24, String(gap))
    if (SHOTS) {
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) {
          window.scrollTo(0, y)
          await new Promise((r) => setTimeout(r, 120))
        }
        window.scrollTo(0, 0)
      })
      await page.waitForTimeout(800)
      await page.screenshot({ path: path.join(SHOTS, `home-${width}.png`), fullPage: true })
      for (const route of ['/security', '/security/reports', '/pricing']) {
        await page.goto(BASE + route)
        await page.waitForTimeout(1800)
        await page.screenshot({ path: path.join(SHOTS, `${route.slice(1).replace(/\//g, '-')}-${width}.png`), fullPage: true })
      }
    }
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }
})

await step('brand kit everywhere', async () => {
  const ctx = await newContext({ cookie: cookieOf(api) })
  await ctx.addInitScript((tok) => sessionStorage.setItem('gully-admin-token', tok), admin)
  const page = await ctx.newPage()
  for (const p of ['/', '/tracker', '/pricing', '/docs', '/developers', '/admin', '/this-page-does-not-exist', '/tg']) {
    await page.goto(BASE + p)
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForSelector('[data-brand]', { timeout: 15_000 }).catch(() => {})
    const r = await page.evaluate(() => {
      const marks = [...document.querySelectorAll('[data-brand]')]
      const typed = [...document.querySelectorAll('span, b, div, a, text')].filter((e) => e.children.length === 0 && /^(GULLY|LABS)$/.test((e.textContent ?? '').trim()))
      // A single letter in a square or disc standing in for a logo (store or actor tiles).
      const tiles = [...document.querySelectorAll('span[aria-hidden]')].filter((e) => e.children.length === 0 && /^[A-Z0-9]$/.test((e.textContent ?? '').trim()) && /font-display|font-extrabold|font-bold/.test(e.className))
      return { marks: marks.length, notKit: marks.filter((m) => m.getAttribute('data-brand') !== 'kit').length, typed: typed.length, tiles: tiles.length }
    })
    check(`brand ${p}: the kit logo is there and nothing else passes for one`, r.marks > 0 && r.notKit === 0 && r.typed === 0 && r.tiles === 0, JSON.stringify(r))
  }
  await ctx.close()
  for (const f of ['/errors/5xx.html', '/errors/1xxx.html']) {
    const html = await (await fetch(BASE + f)).text()
    check(`${f}: inlines the kit wordmark (outlined paths), no typed SVG text`, html.includes('data-brand="kit"') && !/<text[\s>]/.test(html))
  }
  check('widget.js: the credit carries the kit mark', WIDGET_JS.toString().includes('/brand/gully-mark-96.png'))
  for (const f of ['/favicon.ico', '/favicon-32.png', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/brand/gullylabs-wordmark-on-dark.svg', '/brand/gullylabs-mascot-bust.png']) {
    check(`${f} is served`, (await fetch(BASE + f)).status === 200)
  }
})

await step('telegram mini app at 390', async () => {
  const ctx = await newContext({ width: 390, height: 844, mobile: true })
  const sdk = telegramSdkStub(signedInitData({ id: 424242, first_name: 'Eve' }), { bg_color: '#17212b', text_color: '#f5f5f5', hint_color: '#708499', button_color: '#5288c1', button_text_color: '#ffffff', secondary_bg_color: '#232e3c', section_bg_color: '#17212b' })
  let sdkUrl = null
  await ctx.route(/^https:\/\/telegram\.org\//, (route) => {
    sdkUrl = route.request().url()
    return route.fulfill({ status: 200, contentType: 'text/javascript', body: sdk })
  })
  const TG_LAUNCHES = { state: 'ok', asOf: new Date().toISOString(), error: null, chainNames: { 56: 'BNB Chain', 8453: 'Base' }, launches: [['BNB Chain', 56, 'bsc', 'AAA'], ['Base', 8453, 'base', 'BBB'], ['BNB Chain', 56, 'bsc', 'CCC']].map(([chainName, chainId, chainKey, symbol], i) => ({ key: `${chainKey}:${i}`, chainId, chainKey, chainName, token: `0x${String(i + 1).repeat(40)}`, symbol, createdAt: new Date(Date.now() - i * 600_000).toISOString(), legs: [{ kind: 'v2', quote: 'WETH', locked: true }], links: { token: 'https://deepcore.fun/token' } })) }
  await ctx.route(/\/api\/tg\/launches/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TG_LAUNCHES) }))
  const page = await ctx.newPage()
  const w = watch(page, '/tg at 390')
  await page.goto(BASE + '/tg')
  await page.getByRole('radiogroup', { name: 'Section' }).waitFor()
  check('mini app: loads the SDK from the exact telegram.org URL', sdkUrl === 'https://telegram.org/js/telegram-web-app.js?59', sdkUrl)
  check('mini app: the theme maps onto the tokens (Telegram bg)', (await page.evaluate(() => getComputedStyle(document.querySelector('main').parentElement).backgroundColor)) === 'rgb(23, 33, 43)')
  const nvda = page.getByRole('button', { name: /^NVDA on Robinhood Chain/ })
  await page.getByRole('button', { name: /^Show all \d+$/ }).waitFor()
  check('mini app: the gap list shows tracker rows', (await page.getByRole('button', { name: / on (Robinhood Chain|BNB Chain): gap / }).count()) > 3)
  const gapRows = page.getByRole('button', { name: / on (Robinhood Chain|BNB Chain|Solana): gap / })
  check('mini app: the gap list starts at 10 rows', (await gapRows.count()) === 10, String(await gapRows.count()))
  check('mini app: rows show chain logos, not chain-name tags', (await page.locator('main li img[alt=""]').count()) > 0 && (await page.getByText('BNB', { exact: true }).count()) <= 1)
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/after-390.png`, fullPage: true })
  const showAll = page.getByRole('button', { name: /^Show all \d+$/ })
  await showAll.click()
  check('mini app: Show all expands the list past 10 rows', (await gapRows.count()) > 10)
  await page.getByRole('button', { name: /^Show top 10$/ }).click()
  await page.getByRole('searchbox', { name: 'Search stocks' }).fill('nvda')
  const found = await gapRows.count()
  check('mini app: search filters across every row', found >= 1 && found < 10, String(found))
  await noHorizontalScroll(page, '/tg list')
  await nvda.click()
  await page.getByText('Gap to the real share price').waitFor()
  check('mini app: a tap opens the stock with a haptic, and shows BackButton', (await page.evaluate(() => window.__tg.haptics.includes('impact:light') && window.__tg.back)) === true)
  const below = page.getByRole('radio', { name: 'Below', exact: true })
  check('mini app: chips are at least 44 px tall and carry an icon', ((await below.boundingBox())?.height ?? 0) >= 44 && (await below.locator('svg').count()) === 1)
  await below.click()
  const mainBtn = await page.evaluate(() => window.__tg.main)
  check('mini app: MainButton offers to link a wallet when not linked', mainBtn?.is_visible === true && /Link wallet/.test(mainBtn.text), JSON.stringify(mainBtn))
  await noHorizontalScroll(page, '/tg stock')
  await page.evaluate(() => window.__tgBack())
  await page.getByRole('radiogroup', { name: 'Section' }).waitFor()
  check('mini app: BackButton returns to the list and hides', (await page.evaluate(() => window.__tg.back)) === false)
  await page.getByRole('radio', { name: 'Launches' }).click()
  await page.getByRole('button', { name: /^AAA on BNB Chain/ }).waitFor()
  await page.waitForTimeout(500)
  const launchImgs = await page.evaluate(() => [...document.querySelectorAll('main li img[alt$=" logo"]')].map((i) => i.getAttribute('src')))
  check('mini app: launch rows carry token logo images from the logo service', launchImgs.length === 3 && launchImgs.every((u) => /^\/api\/logo\//.test(u)), JSON.stringify(launchImgs))
  await noHorizontalScroll(page, '/tg launches')
  await page.getByRole('radio', { name: 'My alerts' }).click()
  check('mini app: alerts ask an unlinked user to link a wallet', await page.getByText('Link your wallet for alerts').isVisible())
  await noHorizontalScroll(page, '/tg')
  await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
  await ctx.close()
})

/* ------------------------------------------------------------- Cartel Family is gone --- */

// The project count comes from the source list, so adding or removing a project never breaks the suite.
const PROJECT_COUNT = (fs.readFileSync(path.join(ROOT, 'src/content/projects.ts'), 'utf8').match(/^\s{4}slug: /gm) ?? []).length

await step('no Cartel Family anywhere', async () => {
  check('projects list is not empty', PROJECT_COUNT >= 1, PROJECT_COUNT)
  const ctx = await newContext({ width: 1440 })
  const page = await ctx.newPage()
  const w = watch(page, 'no-cartel')
  for (const route of ['/', '/ecosystem', '/about', '/docs']) {
    await page.goto(BASE + route)
    await page.locator('main, body').first().waitFor()
    await page.waitForTimeout(600)
    const text = await page.locator('body').innerText()
    check(`${route}: no page text mentions Cartel`, !/cartel/i.test(text))
    check(`${route}: no link points at cartel`, (await page.locator('a[href*="cartel" i]').count()) === 0)
  }
  // The removed project's URL answers 404 from the server, then the page sends the visitor home: expected.
  w.expect(/\/projects\/cartel-family$/)
  await page.goto(BASE + '/projects/cartel-family')
  await page.waitForTimeout(400)
  check('/projects/cartel-family no longer renders a project page', new URL(page.url()).pathname === '/' && !/cartel/i.test(await page.locator('body').innerText()), page.url())
  for (const file of ['/llms.txt', '/.well-known/contracts.json', '/sitemap.xml', '/api/stats']) {
    const r = await fetch(BASE + file)
    check(`${file}: no mention of Cartel`, r.status === 200 && !/cartel/i.test(await r.text()), r.status)
  }
  const stats = await (await fetch(BASE + '/api/stats')).json()
  check('/api/stats: no cartel-family venue', !stats.venues.some((v) => /cartel/i.test(v.key)))
  await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
  await ctx.close()
})

/* ------------------------------------------------------------- live ledger chart --- */

await step('ledger chart', async () => {
  const stamp = (page) => page.locator('#ledger').getByText(/^read \d\d:\d\d UTC$/).first().innerText()
  const open = async (fixture, { clock = false } = {}) => {
    const ctx = await newContext()
    const page = await ctx.newPage()
    const w = watch(page, 'ledger chart')
    let n = 0
    await page.route(`${BASE}/api/stats`, (route) => json(route, fixture(n++)))
    if (clock) await page.clock.install()
    await page.goto(BASE + '/')
    await page.locator('#ledger').scrollIntoViewIfNeeded()
    await page.getByTestId('ledger-chart').waitFor()
    return { ctx, page, w, polls: () => n }
  }
  const at = Date.now()

  // Trading in the window: the chart opens on Volume, is live, the tabs switch, and the choice sticks.
  {
    const { ctx, page, w } = await open((i) => statsFixture(at, { step: i }))
    const root = page.getByTestId('ledger-chart')
    check('ledger chart: opens on Volume when the window has trades', (await root.getAttribute('data-metric')) === 'volume' && (await page.getByRole('tab', { name: 'Volume' }).getAttribute('aria-selected')) === 'true')
    check('ledger chart: three tabs (Value locked, Volume, Fees)', (await page.locator('#ledger').getByRole('tablist', { name: 'Metric' }).getByRole('tab').allInnerTexts()).join('|') === 'Value locked|Volume|Fees')
    check('ledger chart: live mode is set on the chart box', (await page.locator('#ledger [data-live]').count()) > 0, await page.locator('#ledger [data-live]').count())
    check('ledger chart: no ghost while there is data', (await page.getByTestId('ledger-ghost').count()) === 0)
    check('ledger chart: venue toggles carry their logos', (await page.locator('#ledger').getByRole('group', { name: 'Venues in the chart' }).getByRole('button', { name: /DeepCore/ }).locator('img, [role=img]').count()) > 0)
    check('ledger chart: the source is named under the chart', /DefiLlama|deepcore/i.test(await page.getByTestId('ledger-sources').innerText()), await page.getByTestId('ledger-sources').innerText())
    await page.getByRole('tab', { name: 'Value locked' }).click()
    check('ledger chart: the Value locked tab switches', (await root.getAttribute('data-metric')) === 'tvl' && (await page.getByRole('tab', { name: 'Value locked' }).getAttribute('aria-selected')) === 'true')
    await page.getByRole('tab', { name: 'Fees' }).click()
    check('ledger chart: the Fees tab switches', (await root.getAttribute('data-metric')) === 'fees')
    await page.getByRole('tab', { name: 'Value locked' }).click()
    await page.reload()
    await page.locator('#ledger').scrollIntoViewIfNeeded()
    await page.getByTestId('ledger-chart').waitFor()
    check('ledger chart: an explicit choice sticks for the session', (await page.getByTestId('ledger-chart').getAttribute('data-metric')) === 'tvl' && (await page.getByTestId('ledger-chart').getAttribute('data-auto')) === 'false')
    check('ledger chart: no "no series" chip once series exist', (await page.locator('#ledger').getByText('no series').count()) === 0)
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }

  // Production today: every volume day is zero. Value locked is the default, Volume shows the ghost and the honest line, no axis.
  {
    const { ctx, page, w } = await open((i) => statsFixture(at, { quiet: true, step: i }))
    const root = page.getByTestId('ledger-chart')
    check('ledger chart: all-zero volume opens on Value locked', (await root.getAttribute('data-metric')) === 'tvl' && (await root.getAttribute('data-auto')) === 'true')
    check('ledger chart: value locked is drawn (no ghost)', (await page.getByTestId('ledger-ghost').count()) === 0 && (await page.locator('#ledger [role=tabpanel] [data-chart]').count()) > 0)
    await page.getByRole('tab', { name: 'Volume' }).click()
    const ghost = page.getByTestId('ledger-ghost')
    await ghost.waitFor({ timeout: 10_000 })
    const text = await ghost.innerText()
    check('ledger chart: all-zero volume shows the ghost and the last-trade line', /No trades in the last 7 days · last trade [A-Z][a-z]{2} \d{1,2}, \d{4}/.test(text), text)
    check('ledger chart: no fake axis on an empty window', !/\$\d/.test(await page.locator('#ledger [role=tabpanel]').innerText()) && (await page.locator('#ledger [role=tabpanel] [data-chart]').count()) === 0)
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }

  // Polling: the page asks again after a minute and the read stamp moves on.
  {
    const { ctx, page, w, polls } = await open((i) => statsFixture(at, { step: i }), { clock: true })
    const first = await stamp(page)
    const before = polls()
    await page.clock.fastForward(61_000)
    await page.waitForTimeout(500)
    const second = await stamp(page)
    check('ledger chart: polls /api/stats again after a minute', polls() > before, `${before} -> ${polls()}`)
    check('ledger chart: the read stamp updates with polling', first !== second, `${first} -> ${second}`)
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }
})

/* ------------------------------------------------------------- ecosystem and partners --- */

await step('ecosystem and partners', async () => {
  for (const width of [1440, 390]) {
    const ctx = await newContext({ width, mobile: width < 600 })
    const page = await ctx.newPage()
    const w = watch(page, `/ecosystem ${width}`)
    await page.goto(BASE + '/ecosystem')
    await page.locator('[data-project]').first().waitFor()
    check(`/ecosystem ${width}: every project has its own card, none combined`, (await page.locator('[data-project]').count()) === PROJECT_COUNT)
    await page.getByText(/Source: /).first().waitFor()
    check(`/ecosystem ${width}: integrations are listed and labelled as what we use`, (await page.getByRole('heading', { name: 'Integrates with' }).count()) === 1 && (await page.getByText('Chainlink').count()) >= 1 && (await page.getByText(/partner/i).count()) <= 3)
    // Logo-led tiles: every one shows a loaded logo (naturalWidth > 0) or the lettermark, never "[object Object]".
    const tiles = page.locator('#integrates [data-integration]')
    const nTiles = await tiles.count()
    check(`/ecosystem ${width}: 20 integration tiles, grouped by category`, nTiles === 20 && (await page.locator('#integrates [data-kind]').count()) === 5)
    for (const t of await tiles.all()) await t.scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    const logos = await page.evaluate(() =>
      [...document.querySelectorAll('#integrates [data-integration]')].map((li) => {
        const img = li.querySelector('img')
        return { id: li.getAttribute('data-integration'), ok: img ? img.complete && img.naturalWidth > 0 : !!li.querySelector('[data-lettermark]') }
      }),
    )
    check(`/ecosystem ${width}: every integration tile has a loaded logo or the lettermark`, logos.every((l) => l.ok), logos.filter((l) => !l.ok).map((l) => l.id).join(', '))
    check(`/ecosystem ${width}: no "[object Object]" on the page`, !(await page.locator('body').innerText()).includes('[object Object]'))
    const first = tiles.first()
    check(`/ecosystem ${width}: tiles link out in a new tab`, (await first.locator('a').getAttribute('target')) === '_blank')
    await first.getByRole('button', { name: 'In code' }).click()
    check(`/ecosystem ${width}: "In code" shows the file path`, (await first.getByText('server/tracker.mjs').count()) === 1)
    const pads = page.locator('#launchpads [data-launchpad]')
    if (await pads.count()) {
      check(`/ecosystem ${width}: launchpads show chain names, a Visit link and the ghost tile`, (await page.locator('#launchpads').getByText('Your launchpad here').count()) === 1 && (await pads.first().getByRole('link', { name: /Visit/ }).count()) === 1 && (await pads.first().locator('img').count()) >= 2)
    }
    await page.getByRole('group', { name: 'Filter by kind' }).getByRole('button', { name: /^SECURITY/ }).click()
    await page.waitForTimeout(200)
    check(`/ecosystem ${width}: the kind filter narrows the list`, (await page.locator('#integrates [data-integration]').count()) === 5)
    await page.getByRole('group', { name: 'Filter by kind' }).getByRole('button', { name: /^ALL/ }).click()
    await noHorizontalScroll(page, `/ecosystem ${width}`)
    await designAudit(page, `/ecosystem ${width}`)
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()

    const ctx2 = await newContext({ width, mobile: width < 600 })
    const p2 = await ctx2.newPage()
    const w2 = watch(p2, `/partners ${width}`)
    await p2.goto(BASE + '/partners')
    await p2.locator('[data-benefit]').first().waitFor()
    const wlText = await p2.locator('[data-benefit="whitelabel"]').innerText()
    check(`/partners ${width}: seven benefits, white-label is live`, (await p2.locator('[data-benefit]').count()) === 7 && !/not live yet/i.test(wlText) && /\blive\b/i.test(wlText), wlText)
    await p2.getByRole('group', { name: 'I run a' }).getByRole('button', { name: 'CHAINS' }).click()
    check(`/partners ${width}: choosing chains puts Chain Kit or Gully Pay first`, /CHAIN KIT|GULLY PAY|HOLDER MAP/i.test((await p2.locator('[data-benefit]').first().innerText())))
    await p2.getByRole('group', { name: 'Snippet' }).getByRole('button', { name: 'SDK' }).click()
    check(`/partners ${width}: the SDK snippet shows the package`, (await p2.getByText('@gullylabs/tracker').count()) >= 1)
    // Form A: nothing is sent while invalid; the honeypot is out of sight; a valid one is stored for review.
    await p2.getByRole('button', { name: 'Submit for review' }).click()
    check(`/partners ${width}: an empty launchpad form shows errors and sends nothing`, (await p2.getByRole('alert').count()) >= 4)
    await p2.locator('#f-name').fill(`E2E Pad ${width}`)
    await p2.locator('#f-url').fill('https://e2e-pad.xyz')
    await p2.locator('#f-contact').fill('@e2epad_bot')
    await p2.getByRole('group', { name: 'Chains your launchpad is on' }).getByRole('button', { name: 'Base' }).click()
    await p2.locator('#f-factory').fill('0x1234')
    await p2.locator('#f-eventSignature').fill('TokenCreated(address,address)')
    await p2.getByRole('button', { name: 'Submit for review' }).click()
    await p2.getByText('A 0x address with 40 hex characters.').waitFor()
    await p2.locator('#f-factory').fill('0x' + 'ab'.repeat(20))
    await p2.getByRole('button', { name: 'Submit for review' }).click()
    await p2.getByText(/Received\. We read every submission/).waitFor()
    const listed = { data: await (await fetch(`${BASE}/api/admin/ecosystem/submissions`, { headers: { authorization: `Bearer ${admin}` } })).json() }
    check(`/partners ${width}: the submission is stored pending and nothing is listed`, listed.data.submissions.some((s) => s.name === `E2E Pad ${width}` && s.status === 'pending'))
    // Form B: the Holder Map route opens the map.
    await p2.getByRole('group', { name: 'Chain of the token' }).getByRole('button', { name: 'Robinhood Chain' }).click()
    await p2.locator('#f-token').fill(E2E_LAUNCH_TOKEN)
    await p2.getByRole('button', { name: 'Open the Holder Map' }).click()
    await p2.waitForURL(new RegExp(`/holders/robinhood/${E2E_LAUNCH_TOKEN}$`))
    check(`/partners ${width}: the token form opens the Holder Map`, true)
    await p2.goBack()
    await p2.locator('[data-benefit]').first().waitFor()
    await noHorizontalScroll(p2, `/partners ${width}`)
    await designAudit(p2, `/partners ${width}`)
    await w2.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx2.close()
  }
})

await step('discovery files and contracts page', async () => {
  const cj = await fetch(`${BASE}/.well-known/contracts.json`)
  const reg = await cj.json()
  check('contracts.json: 200, JSON, open CORS, cache header', cj.status === 200 && /json/.test(cj.headers.get('content-type')) && cj.headers.get('access-control-allow-origin') === '*' && /max-age/.test(cj.headers.get('cache-control') ?? ''))
  const safe = reg.contracts.find((c) => c.chainId === 8453 && c.address === '0xCaf7C1ce6F234bED687264cBE6210a4ab5c12fd6')
  check('contracts.json: the treasury Safe on Base, owned by gully-labs, with its source file', safe?.owner === 'gully-labs' && /CHOICE\.md$/.test(safe.source))
  check('contracts.json: the Request fee proxy is marked third-party', reg.contracts.some((c) => /ERC20FeeProxy/.test(c.name) && c.owner === 'third-party'))
  const ll = await (await fetch(`${BASE}/llms.txt`)).text()
  check('llms.txt: H1, docs and contracts links', ll.startsWith('# Gully Labs') && ll.includes('docs.gullylabs.xyz/contracts') && ll.includes('/llms-full.txt'))
  const lf = await (await fetch(`${BASE}/llms-full.txt`)).text()
  check('llms-full.txt: lists the treasury address and a roadmap section', lf.includes('0xCaf7C1ce6F234bED687264cBE6210a4ab5c12fd6') && lf.includes('## Roadmap (not available yet)'))
  const home = await (await fetch(`${BASE}/`)).text()
  check('home page head carries Organization and SoftwareApplication JSON-LD', home.includes('"@type":"Organization"') && home.includes('"@type":"SoftwareApplication"'))
  for (const width of [1440, 390]) {
    const ctx = await newContext({ width, mobile: width < 600 })
    const page = await ctx.newPage()
    const w = watch(page, `docs /contracts ${width}`)
    await page.goto(`${BASE}/docs/contracts`)
    await page.getByRole('heading', { level: 1, name: 'Contracts' }).waitFor()
    await page.locator('[data-contract]').first().waitFor()
    check(`docs /contracts ${width}: the treasury is listed with a copy button and an explorer link`, (await page.locator('[data-contract="0xCaf7C1ce6F234bED687264cBE6210a4ab5c12fd6"]').count()) >= 4 && (await page.getByRole('button', { name: /Copy address 0xCaf7/ }).count()) >= 4 && (await page.locator('a[href^="https://basescan.org/address/0xCaf7"]').count()) >= 1)
    await page.getByLabel('Search contracts').fill('ERC20FeeProxy')
    await page.getByText(/^\d+ of \d+ contracts$/).first().waitFor()
    check(`docs /contracts ${width}: the search narrows the list and the proxy shows THIRD PARTY`, (await page.getByText('THIRD PARTY').count()) >= 1 && (await page.locator('[data-contract]').count()) < 40)
    await noHorizontalScroll(page, `docs /contracts ${width}`)
    await designAudit(page, `docs /contracts ${width}`)
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }
})

await step('design audit 3 group 3: narrow-width fixes (D5 D6 D7 D10 D15 D16 D19 D21 + Telegram)', async () => {
  for (const width of [320, 390]) {
    const ctx = await newContext({ width, mobile: true })
    const page = await ctx.newPage()
    const w = watch(page, `da3-g3 ${width}`)
    const visit = async (route) => {
      await page.goto(BASE + route)
      await page.locator('h1').first().waitFor()
      await page.waitForTimeout(900)
    }
    // Every element of `sel` shows all its text (nothing cut by overflow) at this width.
    const unclipped = (sel) => page.evaluate((q) => [...document.querySelectorAll(q)].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => `${e.tagName} "${(e.textContent || '').trim().slice(0, 30)}"`).slice(0, 4), sel)
    await visit('/analytics')
    await noHorizontalScroll(page, 'da3-g3 /analytics')
    const srcBtn = page.locator('a[href*="gully-labs/umami"]')
    check(`da3-g3 analytics ${width}: the Source button stays inside the viewport`, (await srcBtn.count()) === 1 && (await srcBtn.evaluate((e) => e.getBoundingClientRect().right <= window.innerWidth && e.scrollWidth <= e.clientWidth + 1)))
    check(`da3-g3 ${width}: no link to the private gully-labs/blockscout repo anywhere on Chain Kit`, await (async () => { await visit('/chain-kit').catch(() => {}); return (await page.locator('a[href*="gully-labs/blockscout"]').count()) === 0 })())
    for (const route of ['/services', '/pricing', '/partners', '/ecosystem', '/about', '/status', '/']) {
      await visit(route)
      await noHorizontalScroll(page, `da3-g3 ${route}`)
      const cut = await unclipped('h1, h2, h3, [data-project] dd, [data-project] dt, section[aria-label="Services"] li, section[aria-label="Services"] span, dl dd, dl dt')
      check(`da3-g3 ${route} at ${width}: no clipped headings, figures or chips`, cut.length === 0, cut.join(' | '))
    }
    await visit('/services')
    const h2s = await page.locator('section[aria-label="Services"] h2').evaluateAll((els) => els.map((e) => e.scrollWidth <= e.clientWidth + 1))
    check(`da3-g3 services ${width}: the card headings fit`, h2s.length === 4 && h2s.every(Boolean))
    check(`da3-g3 services ${width}: venue and chain chips carry logos`, (await page.locator('[aria-label="Venues and chains"] img').count()) >= 4)
    await visit('/pricing')
    const h1 = await page.locator('h1').first().evaluate((e) => e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().right <= window.innerWidth)
    check(`da3-g3 pricing ${width}: the title stays inside the gutter`, h1)
    await visit('/partners')
    const notLive = page.locator('[data-benefit="chainkit"]')
    check(`da3-g3 partners ${width}: the not-live Chain Kit card is dashed and not dimmed`, (await notLive.evaluate((e) => getComputedStyle(e).borderStyle === 'dashed' && Number(getComputedStyle(e).opacity) === 1)) && (await notLive.getByText('NOT LIVE YET').count()) === 1)
    check(`da3-g3 partners ${width}: Chain Kit card says Built on Blockscout with its logo`, (await notLive.getByText('Built on Blockscout').count()) === 1 && (await notLive.locator('img').count()) >= 1)
    const tgP = page.locator('a[href="https://t.me/GullyLabsBot?start=partners"]')
    check(`da3-g3 partners ${width}: a Chat on Telegram button`, (await tgP.count()) === 1 && (await tgP.evaluate((e) => e.getBoundingClientRect().height >= 44)))
    check(`da3-g3 partners ${width}: chain chips carry logos`, (await page.locator('[aria-label="Chains on the Holder Map"] img').count()) >= 3)
    await visit('/about')
    check(`da3-g3 about ${width}: venue names are logo chips`, (await page.locator('section[aria-label="Gully Labs in numbers"] img').count()) >= 3)
    await visit('/status')
    check(`da3-g3 status ${width}: chains are logo chips`, (await page.locator('[aria-label="Chains the Holder Map covers"] img').count()) >= 3)
    for (const route of ['/', '/ecosystem']) {
      await visit(route)
      check(`da3-g3 ${route} at ${width}: no red "unreadable" text in a figure`, (await page.locator('dd .text-error').count()) === 0)
    }
    if (width === 390) {
      await visit('/')
      await page.getByRole('button', { name: /start a project|contact|get in touch/i }).first().click().catch(() => {})
      const tgC = page.locator('a[href="https://t.me/GullyLabsBot?start=contact"]')
      await tgC.first().waitFor({ timeout: 5000 }).catch(() => {})
      check('da3-g3 contact modal: a Chat on Telegram button next to the form', (await tgC.count()) === 1)
      await visit('/')
    }
    // D15: headings balance their lines.
    const bal = await page.evaluate(() => getComputedStyle(document.querySelector('h1')).textWrap)
    check(`da3-g3 ${width}: headings use text-wrap: balance`, bal === 'balance', bal)
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }
})

// Holder Map discovery: the header link, the hero search, the ⌘K hit, the Holders chips, Most mapped today, the announcement bar and the SEO.
await step('holder map discovery', async () => {
  const HX = holdersExtraFixtures()
  const SHOTS_HD = process.env.HD_SHOTS || null
  if (SHOTS_HD) fs.mkdirSync(SHOTS_HD, { recursive: true })
  const hdShot = (page, name, opts = {}) => SHOTS_HD && page.screenshot({ path: path.join(SHOTS_HD, name), ...opts })
  const SCORE_ADDR = '0x' + 'cd'.repeat(20)
  {
    // A scored contract of its own, so this step does not depend on the Gully Score step having run.
    const gs = await import('../server/gully-score.mjs')
    const nowIso = new Date().toISOString()
    gs.putScoreForTest({ chainId: 8453, chainKey: 'base', chainName: 'Base', address: SCORE_ADDR, name: 'E2E Vault', symbol: null, score: 74, grade: 'Fair', coverage: { weight: 75, components: 6, of: 9 }, computedAt: nowIso, methodVersion: 1, components: gs.COMPONENTS.map((c) => ({ ...c, evidence: [], available: false, score: null, value: 'Not available', reason: 'Not read in this test.' })), history: [{ at: nowIso, score: 74 }], changes: [] })
  }
  // 1. The header link: visible at 1440 and 1024 on one line, and in the mobile menu.
  for (const width of [1440, 1024]) {
    const ctx = await newContext({ width, height: 900, announce: true })
    const page = await ctx.newPage()
    const w = watch(page, `header ${width}`)
    await page.goto(BASE + '/')
    const link = page.locator('header nav[aria-label="Main"] a[href="/holders"]')
    await link.waitFor()
    check(`header ${width}: a top-level "Holder Map" link with a NEW dot`, (await link.isVisible()) && (await link.locator('[data-new-dot]').count()) === 1 && /Holder Map/.test(await link.innerText()))
    const heights = await page.evaluate(() => [...document.querySelectorAll('header nav a, header nav button')].filter((el) => el.getBoundingClientRect().width > 0).map((el) => Math.round(el.getBoundingClientRect().height)))
    check(`header ${width}: nothing in the header wraps`, heights.every((h) => h <= 44), heights.join(','))
    const hb = await page.locator('header').evaluate((h) => Math.round(h.getBoundingClientRect().height))
    check(`header ${width}: the header stays one row (${hb} px)`, hb <= 66, String(hb))
    await noHorizontalScroll(page, `home header ${width}`)
    if (width === 1440) await hdShot(page, 'home-1440.png', { fullPage: false })
    if (width === 1440) await hdShot(page, 'header-1440.png', { clip: { x: 0, y: 0, width: 1440, height: 130 } })
    if (width === 1024) await hdShot(page, 'header-1024.png', { clip: { x: 0, y: 0, width: 1024, height: 130 } })
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }
  for (const width of [390, 320]) {
    const ctx = await newContext({ width, height: 800, mobile: true, announce: true })
    const page = await ctx.newPage()
    const w = watch(page, `home ${width}`)
    await page.goto(BASE + '/')
    // 6. The announcement bar: compact, in flow above the header, dismissible, remembered.
    const bar = page.locator('[data-announcement]')
    await bar.waitFor()
    const bb = await bar.boundingBox()
    const hdr = await page.locator('header').boundingBox()
    check(`announcement ${width}: slim (${Math.round(bb.height)} px) and above the header, not covering it`, bb.height <= 48 && hdr.y >= bb.y + bb.height - 1)
    check(`announcement ${width}: the dismiss button is a 44 px tap target`, ((await page.getByRole('button', { name: 'Dismiss the announcement' }).boundingBox()).height ?? 0) >= 43.5)
    await noHorizontalScroll(page, `home with the announcement ${width}`)
    // 2. The hero search.
    const q = page.locator('#hero-hq')
    await q.waitFor()
    const qb = await q.boundingBox()
    check(`hero search ${width}: the box is on the first screen and 44 px tall`, qb.y + qb.height < 800 && qb.height >= 43.5, JSON.stringify(qb))
    if (width === 390) {
      await hdShot(page, 'home-390.png', { fullPage: false })
      await page.getByRole('button', { name: 'Menu' }).click()
      const mob = page.locator('nav[aria-label="Mobile"] a[href="/holders"]:has([data-new-dot])')
      await mob.waitFor()
      check('mobile menu: the "Holder Map" link with its NEW dot', (await mob.isVisible()) && (await mob.locator('[data-new-dot]').count()) === 1)
      await hdShot(page, 'menu-390.png', { fullPage: false })
      await page.getByRole('button', { name: 'Close' }).click()
    }
    await q.fill(E2E_ANY_TOKEN)
    await q.press('Enter')
    await page.waitForURL(new RegExp(`/holders/base/${E2E_ANY_TOKEN}$`))
    check(`hero search ${width}: Enter on a pasted address opens its map`, true)
    await page.goto(BASE + '/')
    await page.locator('#hero-hq').fill('$NVDA')
    await page.locator('[data-hero-holder-search]').getByRole('button', { name: 'Map it' }).click()
    await page.locator('[data-hero-holder-search] [data-resolve-matches] a').first().waitFor()
    check(`hero search ${width}: a ticker on two chains offers the chain picker`, (await page.locator('[data-hero-holder-search] [data-resolve-matches] a').count()) === 2)
    await noHorizontalScroll(page, `home hero search ${width}`)
    // 6. Dismissal is remembered.
    await page.getByRole('button', { name: 'Dismiss the announcement' }).click()
    check(`announcement ${width}: dismissing removes the bar`, (await page.locator('[data-announcement]').count()) === 0)
    await page.reload()
    await page.locator('#hero-hq').waitFor()
    check(`announcement ${width}: and it stays dismissed after a reload (localStorage)`, (await page.locator('[data-announcement]').count()) === 0 && (await page.evaluate(() => localStorage.getItem('gl-announce-holder-map'))) === '1')
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }
  {
    // 6. After 2026-11-02 the bar is gone by itself, with nothing stored.
    const ctx = await newContext({ width: 1440, announce: true })
    await ctx.addInitScript(() => {
      const real = Date.now
      const shift = Date.parse('2026-11-04T10:00:00Z') - real()
      Date.now = () => real() + shift
    })
    const page = await ctx.newPage()
    await page.goto(BASE + '/')
    await page.locator('#hero-hq').waitFor()
    check('announcement: expired after 2026-11-02 (the constant), nothing stored', (await page.locator('[data-announcement]').count()) === 0)
    await ctx.close()
    const c2 = await newContext({ width: 1440, announce: true })
    await c2.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('blocked')
        },
      })
    })
    const p2 = await c2.newPage()
    await p2.goto(BASE + '/')
    await p2.locator('[data-announcement]').waitFor()
    await p2.getByRole('button', { name: 'Dismiss the announcement' }).click()
    check('announcement: blocked storage does not break it (try/catch), it still hides for the visit', (await p2.locator('[data-announcement]').count()) === 0)
    await c2.close()
  }
  // 5. Most mapped today on the home page, 1440 and 390; and its ghost.
  for (const width of [1440, 390]) {
    const ctx = await newContext({ width, mobile: width < 600 })
    const page = await ctx.newPage()
    const w = watch(page, `most mapped ${width}`)
    await page.goto(BASE + '/')
    const list = page.locator('[data-most-mapped-list] li')
    await list.first().waitFor({ timeout: 20_000 })
    check(`most mapped ${width}: the live list renders the endpoint's rows`, (await list.count()) === HX.top.items.length)
    await page.locator('[data-most-mapped-list] img[src*="badge.svg"]').first().waitFor({ state: 'attached' })
    check(`most mapped ${width}: each row has a token logo and a health badge image`, (await page.locator('[data-most-mapped-list] li [data-logo], [data-most-mapped-list] li svg').count()) >= HX.top.items.length && (await page.locator('[data-most-mapped-list] img[src*="/badge.svg"]').count()) === HX.top.items.length)
    await page.locator('[data-most-mapped]').scrollIntoViewIfNeeded()
    await noHorizontalScroll(page, `home most mapped ${width}`)
    await page.waitForTimeout(800)
    await hdShot(page, `most-mapped-${width}.png`, { fullPage: false })
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }
  {
    const ctx = await newContext({ width: 390, mobile: true })
    await ctx.route(new RegExp(`^${BASE}/api/holders/top`), (route) => json(route, { day: '2026-10-19', items: [] }))
    const page = await ctx.newPage()
    await page.goto(BASE + '/')
    await page.locator('[data-most-mapped-ghost]').waitFor({ timeout: 20_000 })
    check('most mapped: nothing today shows the ghost rows and says so', (await page.locator('[data-most-mapped-ghost]').innerText()).includes('No maps opened yet today') && (await page.locator('[data-most-mapped-list]').count()) === 0)
    await noHorizontalScroll(page, 'home most mapped ghost 390')
    await ctx.close()
  }
  // 3. ⌘K: an address or a ticker puts "Open Holder Map for …" first.
  for (const width of [1440, 390]) {
    const ctx = await newContext({ width, mobile: width < 600 })
    const page = await ctx.newPage()
    const w = watch(page, `launcher ${width}`)
    await page.goto(BASE + '/pricing')
    await page.getByTestId('ask-fab').waitFor({ timeout: 10_000 })
    await page.getByTestId('ask-fab').click()
    const dlg = page.getByRole('dialog', { name: 'Gully AI' })
    await dlg.waitFor()
    const box = dlg.locator('textarea')
    await box.fill('how do gap alerts work?')
    await page.waitForTimeout(600)
    check(`launcher ${width}: an ordinary question shows no Holder Map hit`, (await dlg.locator('[data-holder-hit]').count()) === 0)
    await box.fill(E2E_ANY_TOKEN)
    const hit = dlg.locator('[data-holder-hit] a').first()
    await hit.waitFor()
    check(`launcher ${width}: a pasted address offers "Open Holder Map for …" above the question form`, /Open Holder Map for/.test(await hit.innerText()) && (await dlg.evaluate((d) => !!(d.querySelector('[data-holder-hit]').compareDocumentPosition(d.querySelector('form')) & Node.DOCUMENT_POSITION_FOLLOWING))))
    await box.fill('$DTC')
    await dlg.locator('[data-holder-hit] a').first().waitFor()
    check(`launcher ${width}: a ticker does too`, /\$DTC/.test(await dlg.locator('[data-holder-hit] a').first().innerText()))
    await dlg.locator('[data-holder-hit] a').first().click()
    await page.waitForURL(new RegExp(`/holders/robinhood/${E2E_LAUNCH_TOKEN}$`))
    check(`launcher ${width}: clicking it opens the map and closes the panel`, (await page.getByRole('dialog', { name: 'Gully AI' }).count()) === 0)
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }
  // 4. Holders chips: tracker rows, the stock page, DeepCore launch rows, the score page, the Ecosystem launchpads.
  for (const width of [1440, 390]) {
    const mobile = width < 600
    const ctx = await newContext({ width, mobile })
    await ctx.route(`${BASE}/api/ecosystem`, (route) => json(route, { chains: [], launchpads: [{ id: 'deepcore', name: 'DeepCore', url: 'https://deepcore.fun', chains: ['Robinhood Chain'] }] }))
    const page = await ctx.newPage()
    const w = watch(page, `holders chips ${width}`)
    const tall = (loc) => loc.evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0).every((e) => e.getBoundingClientRect().height >= 43.5))
    await page.goto(BASE + '/tracker')
    const visibleChip = page.locator('[data-holders-chip]:visible').first()
    await visibleChip.waitFor({ timeout: 15_000 })
    const th = await visibleChip.getAttribute('href')
    check(`tracker ${width}: a visible row has a Holders chip to /holders/<chain>/<ticker>`, /^\/holders\/(robinhood|bsc|solana)\/[A-Za-z0-9]+$/.test(th ?? ''), th)
    if (mobile) check('tracker 390: the chip is a 44 px tap target', await tall(page.locator('[data-holders-chip]:visible')))
    await noHorizontalScroll(page, `tracker chips ${width}`)
    await page.goto(BASE + '/tracker/robinhood/NVDA')
    const sc = page.locator('main section').first().locator('[data-holders-chip]')
    await sc.waitFor()
    check(`stock page ${width}: the header has a Holders chip to /holders/robinhood/NVDA`, (await sc.getAttribute('href')) === '/holders/robinhood/NVDA' && (!mobile || (await tall(sc))))
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(1200)
    await hdShot(page, `stock-${width}.png`, { fullPage: false })
    await noHorizontalScroll(page, `stock page chips ${width}`)
    await page.goto(BASE + '/projects/deepcore')
    const lc = page.locator('[data-launch-holders] [data-holders-chip]').first()
    await lc.waitFor({ timeout: 15_000 })
    check(`DeepCore launch rows ${width}: each row ends in a Holders chip and links to its map`, (await page.locator('[data-launch-holders] li a[href^="/holders/"]').count()) >= 1 && (await page.locator('[data-launch-holders] [data-holders-chip]').count()) === (await page.locator('[data-launch-holders] li').count()))
    await page.goto(`${BASE}/score/base/${SCORE_ADDR}`)
    await page.getByRole('heading', { level: 1, name: 'E2E Vault' }).waitFor()
    const sh = page.locator('main [data-holders-chip]').first()
    await sh.waitFor()
    check(`score page ${width}: the header has a Holders chip to the token's map`, (await sh.getAttribute('href')) === `/holders/base/${SCORE_ADDR}` && (!mobile || (await tall(sh))))
    await noHorizontalScroll(page, `score page chips ${width}`)
    await page.goto(BASE + '/ecosystem')
    const ec = page.locator('[data-launchpad] [data-holders-chip]').first()
    await ec.waitFor({ timeout: 15_000 })
    check(`ecosystem ${width}: a launchpad card has a Holders chip`, (await ec.getAttribute('href')) === '/holders' && (await tall(ec)))
    await noHorizontalScroll(page, `ecosystem chips ${width}`)
    await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
    await ctx.close()
  }
  // 7. SEO: server-rendered titles and descriptions, the card as og:image, and the sitemap section.
  {
    const holders = await import(new URL('../server/holders.mjs', import.meta.url).href)
    const intel = await import(new URL('../server/holders-intel.mjs', import.meta.url).href)
    const { sitemapFor } = await import(new URL('../server/seo.mjs', import.meta.url).href)
    holders.seedHolderMapForTest('robinhood', E2E_LAUNCH_TOKEN, holdersFixture('deepcore-launch'))
    const sym = holdersFixture('deepcore-launch').token?.symbol
    const meta = (h, n) => h.match(new RegExp(`<meta (?:property|name)="${n}" content="([^"]*)"`))?.[1] ?? ''
    const a = await (await fetch(`${BASE}/holders/robinhood/${E2E_LAUNCH_TOKEN}`)).text()
    const title = a.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''
    check(`seo: a launch's map title names its symbol and chain (${title})`, sym ? title.startsWith(`Who holds $${sym.toUpperCase()} on Robinhood Chain · Holder Map`) : /^Who holds .* on Robinhood Chain · Holder Map/.test(title), title)
    check('seo: description says who holds it, og:image is the map card.png', /Who holds/.test(meta(a, 'description')) && meta(a, 'og:image') === `https://gullylabs.xyz/api/holders/robinhood/${E2E_LAUNCH_TOKEN}/card.png`, meta(a, 'og:image'))
    const b = await (await fetch(`${BASE}/holders/robinhood/NVDA`)).text()
    check('seo: a ticker page reads "Who holds $NVDA on Robinhood Chain · Holder Map"', /<title>Who holds \$NVDA on Robinhood Chain · Holder Map/.test(b))
    const c = await (await fetch(`${BASE}/holders/solana/${'7'.repeat(43)}`)).text()
    check('seo: an unknown mint still gets a proper title and canonical', /<title>Who holds this token on Solana · Holder Map/.test(c) && c.includes(`rel="canonical" href="https://gullylabs.xyz/holders/solana/${'7'.repeat(43)}"`))
    // The sitemap lists the top mapped tokens: valid ones only, at most 200, no stock map without holder data.
    intel.resetScansForTest()
    const addr = (i) => '0x' + i.toString(16).padStart(40, '0')
    for (let i = 1; i <= 230; i++) intel.recordScan('base', addr(i), `T${i}`, 'token', `10.0.${i >> 8}.${i & 255}`)
    intel.recordScan('base', 'not-an-address', 'BAD', 'token', '10.9.9.9')
    intel.recordScan('robinhood', 'NVDA', 'NVDA', 'stock', '10.9.9.8')
    const sm = sitemapFor('gullylabs.xyz')
    const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    const held = locs.filter((u) => /\/holders\/base\/0x[0-9a-f]{40}$/.test(u))
    check(`sitemap: the most-mapped tokens are listed, capped at 200 (${held.length})`, held.length === 200 && new Set(locs).size === locs.length)
    check('sitemap: invalid tokens and a stock map without holder data are not listed', !sm.includes('not-an-address') && !locs.includes('https://gullylabs.xyz/holders/robinhood/NVDA'))
    intel.resetScansForTest()
    check('sitemap: with no scans there is no such section', !/\/holders\/base\/0x/.test(sitemapFor('gullylabs.xyz')))
  }
})

const unexpectedOutbound = blockedOutbound.filter((u) => !/dexscreener|geckoterminal|rpc\.|arbitrum\.io|mainnet\.base\.org|deepcore|drpc|publicnode|ordofi|blastapi|robinhood|binance|bsc|llama|peddle|solana|xstocks|jup\.ag/i.test(u))
check('the server made no unexpected outbound calls', unexpectedOutbound.length === 0, (unexpectedOutbound.length ? unexpectedOutbound : blockedOutbound).slice(0, 5).join(' | '))
await browser.close()
const secs = Math.round((Date.now() - started) / 1000)
// E2E_SHOTS adds full-page screenshots on top of the checks, so the budget applies to plain runs.
// 7 minutes since the status, docs-pages, analytics and every-app-page height steps (2026-10-18) were added.
check(`the suite runs in under 10 minutes (${secs} s${SHOTS ? ', screenshots on' : ''})`, SHOTS ? true : secs < 600)
console.log(`\n${t.passed} passed, ${t.failed} failed (${secs} s)`)
process.exit(t.failed ? 1 : 0)
