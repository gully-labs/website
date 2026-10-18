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
import { blockedOutbound, bootServer, historyFixture, ROOT, seedTrackerHistory, signedInitData, statsFixture, telegramSdkStub, trackerFixture } from './e2e-harness.mjs'
import { makeChecker, makeClient, guardTestRun } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8792
await guardTestRun(PORT, { watchdogMs: 8 * 60_000 })
const started = Date.now()
const t = makeChecker()
const { check } = t
process.env.GULLY_ALLOW_LOOPBACK_WEBHOOKS = '1'
const { admin, base: BASE } = await bootServer({ port: PORT })
const TRACKER = trackerFixture()
await seedTrackerHistory(TRACKER)
const STATS = statsFixture()
const WIDGET_JS = fs.readFileSync(path.join(ROOT, 'dist', 'widget.js'))

/* ------------------------------------------------------------- browser plumbing --- */

const browser = await chromium.launch({ headless: !process.env.E2E_HEADED })
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
const QUOTE = { chain: 'robinhood', ticker: 'NVDA', pay: { symbol: 'ETH', amount: '0.1' }, out: { symbol: 'NVDA', amount: '1.84', minimum: '1.82' }, priceImpactPct: 0.21, slippagePct: 0.5, fee: { pct: 0.3, amount: '0.0003', symbol: 'ETH', exempt: false }, onDeepcorePool: true, route: { venues: ['DeepCore'], hops: [{ venue: 'DeepCore', from: 'ETH', to: 'NVDA' }] }, alternatives: [], quotedAt: new Date().toISOString(), links: { swap: 'https://deepcore.fun/swap', token: 'https://deepcore.fun/token' } }

// The DeepCore launch list as GET /api/deepcore/launches answers it (the poller is off in e2e).
const LAUNCHES = (() => {
  const chains = [[4663, 'Robinhood Chain'], [56, 'BNB Chain'], [8453, 'Base']]
  const launches = Array.from({ length: 12 }, (_, i) => {
    const [chainId, chainName] = chains[i % 3]
    const token = '0x' + (i + 1).toString(16).padStart(40, 'a')
    return { key: `${chainId}:${token}`, chainId, chainKey: String(chainId), chainName, token, symbol: `E2E${i}`, createdAt: new Date(Date.now() - i * 5 * 3600_000).toISOString(), txHash: null, creator: null, startsAt: null, totalSupply: null, legs: [{ poolId: null, kind: 'CL', quote: 'WETH', locked: i % 2 === 0, lockId: null, feePct: 1, quoteAddress: null }], links: { token: `https://deepcore.fun/tokens/${token}`, launch: `https://deepcore.fun/app/launch/v2/${token}`, swap: 'https://deepcore.fun/app/swap' } }
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

/** A context with every off-localhost request routed: Gully's own hosts to fixtures, the rest aborted. */
async function newContext({ width = 1440, height = 900, mobile = false, geo = { country: 'GB', allowed: true, reason: 'ok' }, cookie = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}), permissions: ['clipboard-read', 'clipboard-write'], serviceWorkers: 'block' })
  if (cookie) await ctx.addCookies([{ name: 'gl_dev', value: cookie, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }])
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

async function noHorizontalScroll(page, label) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  check(`${label}: no horizontal scroll at ${w[1]} px`, w[0] <= w[1], `scrollWidth ${w[0]}`)
}

const step = async (name, fn) => {
  try {
    await fn()
  } catch (e) {
    check(`${name} (${String(e?.message ?? e).split('\n')[0].slice(0, 200)})`, false)
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
  check('pricing: the payment line names the new chains from /api/plans (OP Mainnet, Polygon, Avalanche)', await page.locator('#pricing').getByText(/OP Mainnet, Polygon or Avalanche/).first().waitFor({ timeout: 8_000 }).then(() => true, () => false))
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
  // The server's head (crawlers, link previews) says Gully AI; the client-side <Seo> title is in quality-1's AskPage.tsx.
  check('Gully AI: the server-rendered title says Gully AI', (await (await fetch(BASE + '/ask')).text()).includes('<title>Gully AI · Gully Labs</title>'))
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
  check('keys: the new key\u2019s row has a ghosted spark, not a flat line', (await page.locator('[data-testid="key-spark"] svg[data-ghost]').count()) === 1)
  await page.getByRole('button', { name: 'Actions for e2e key' }).click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const rn = page.getByRole('dialog', { name: 'Rename key' })
  await rn.getByRole('textbox').fill('e2e key renamed')
  await rn.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Key renamed').first().waitFor()
  check('keys: rename', (await page.getByRole('button', { name: 'Actions for e2e key renamed' }).count()) === 1)
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
  await page.getByText(/not switched on/).first().waitFor()
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
  check(`${label}: five launches in the last 24 h, the newest named`, dc === '5' && /E2E0 on Robinhood Chain/.test(await band.getByTestId('mk-newest').textContent()), dc)
  check(`${label}: the API round-trip sparkline draws from /healthz`, await drawn('mk-status'))
  const ms = await figure('mk-status')
  check(`${label}: the round trip is a live millisecond figure`, /^\d+ ms$/.test(ms), ms)
}

const SERVICES = [
  ['tracker', 'Tracker'],
  ['pay', 'Gully Pay'],
  ['chain-kit', 'Chain Kit'],
  ['ai', 'Gully AI'],
  ['deepcore', 'DeepCore launches'],
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
  check('sidebar: grouped Workspace, Services, Developer, Account', JSON.stringify(groups) === JSON.stringify(['Workspace', 'Services', 'Developer', 'Account']), JSON.stringify(groups))
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
    await appNav.getByRole('link', { name: label, exact: true }).click()
    const view = page.locator(`[data-service="${id}"]`)
    await view.getByTestId('service-header').waitFor({ timeout: 15_000 })
    check(`app ${label}: the page renders with its header`, (await view.getByRole('heading', { level: 1 }).textContent())?.trim() === label)
    check(`app ${label}: the hash deep-links it`, new URL(page.url()).hash === `#${id}`, page.url())
    const ext = await view.getByTestId('service-header').locator('a').evaluateAll((as) => as.map((a) => [a.textContent, a.target, a.rel]))
    check(`app ${label}: Docs and Public page open in a new tab`, ext.length >= 2 && ext.every(([, t, r]) => t === '_blank' && /noopener/.test(r)), JSON.stringify(ext))
    await view.locator('[data-tile]').first().waitFor()
    if (id === 'tracker') await view.locator('tr[data-row]').first().waitFor({ timeout: 15_000 })
    if (id === 'deepcore') await view.getByTestId('deepcore-launches').waitFor({ timeout: 15_000 })
    if (id === 'widgets') await page.waitForFunction(() => [...document.querySelectorAll('[data-gully-widget]')].some((el) => /%/.test(el.shadowRoot?.textContent ?? '')), null, { timeout: 10_000 })
    if (id === 'ai') check('app Gully AI: the full chat is on the page', (await view.getByPlaceholder('How do gap alerts work?').count()) === 1)
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
  check('sidebar at 1440x840: every page fits with no inner scrollbar', await fits())
  await sp.setViewportSize({ width: 1440, height: 800 })
  await sp.waitForTimeout(200)
  check('sidebar at 1440x800: still no inner scrollbar', await fits())
  const rowH = await sNav.getByRole('link', { name: 'Keys' }).evaluate((a) => a.getBoundingClientRect().height)
  check('sidebar: rows are compact (32-36 px)', rowH >= 32 && rowH <= 36, String(rowH))
  check('sidebar: Docs, Status and home sit in the header, not in a block under the list', (await sp.getByTestId('header-links').locator('a, button').count()) === 3 && (await sp.getByTestId('app-sidebar').getByTestId('status-link').count()) === 0)
  await sp.getByTestId('header-links').getByTestId('status-link').click()
  const st = sp.getByRole('dialog', { name: 'Status' })
  await st.getByTestId('status-view').waitFor()
  await st.locator('[data-chart].opacity-100 svg').first().waitFor({ timeout: 20_000 }).catch(() => {})
  check('status: the Status button opens a Status view (API uptime and latency, tracker and DeepCore health), not another tab', (await st.getByText('Tracker data').count()) === 1 && (await st.getByText('DeepCore launch poller').count()) === 1 && /checks this session/.test((await st.textContent()) ?? '') && new URL(sp.url()).hash === '')
  await shot(sp, 'app-1440x840-status')
  await sp.keyboard.press('Escape')
  await st.waitFor({ state: 'hidden' })
  await sp.getByTestId('navgroup-toggle-developer').click()
  check('sidebar: a group folds', (await sNav.locator('[data-nav-group="Developer"]').getByRole('link').count()) === 0)
  // Reload on a page without the market band (its history reads count against the anonymous limit).
  await sp.goto(BASE + '/app#keys')
  await sNav.waitFor()
  check('sidebar: the folded group is remembered', (await sNav.locator('[data-nav-group="Developer"][data-folded]').count()) === 1 && (await sp.getByTestId('navgroup-toggle-developer').getAttribute('aria-expanded')) === 'false')
  await sp.getByTestId('navgroup-toggle-developer').click()
  check('sidebar: and unfolds', (await sNav.locator('[data-nav-group="Developer"]').getByRole('link').count()) === 3)
  await sNav.getByRole('link', { name: 'Overview', exact: true }).click()
  const gs = sp.getByTestId('get-started')
  await gs.waitFor()
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
  await mw.verify([/li\.quest|lifi|wagmi|ERR_BLOCKED_BY_CLIENT/i])
  await m.close()

  // E2E_SHOTS: full-page screenshots of Overview, Merchant, Analytics and Alerts at 1440x900 and 390, with each
  // page's height in px (page-heights.json), for the owner's "no page way too long" check.
  if (SHOTS) {
    const heights = {}
    for (const [width, height, mobile] of [[1440, 900, false], [390, 844, true]]) {
      const hc = await newContext({ width, height, mobile, cookie: cookieOf(api3) })
      const hp = await hc.newPage()
      for (const id of ['overview', 'merchant', 'analytics', 'alerts']) {
        await hp.goto(`${BASE}/app#${id}`)
        await hp.locator(`main[data-page="${id}"]`).waitFor({ timeout: 15_000 })
        await hp.waitForLoadState('networkidle').catch(() => {})
        // Charts draw when scrolled into view: walk down the page first so the full-page shot shows them drawn.
        for (let y = 0; y < (await hp.evaluate(() => document.documentElement.scrollHeight)); y += 500) {
          await hp.evaluate((top) => window.scrollTo(0, top), y)
          await hp.waitForTimeout(250)
        }
        await hp.evaluate(() => window.scrollTo(0, 0))
        await hp.waitForTimeout(1200)
        heights[`${id}-${width}`] = await hp.evaluate(() => document.documentElement.scrollHeight)
        await hp.screenshot({ path: path.join(SHOTS, `page-${id}-${width}.png`), fullPage: true })
      }
      await hc.close()
    }
    fs.writeFileSync(path.join(SHOTS, 'page-heights.json'), JSON.stringify(heights, null, 2))
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

  // The chain picker on a checkout taking every asset: the three new chains, each with its own mark.
  const invAll = await adminCall('/api/admin/invoices', { title: 'E2E: every chain', usd: '12' })
  check('pay: an invoice with no asset list takes every chain (18 assets)', invAll.status === 201 && invAll.data.invoice.assets.length === 18, String(invAll.data?.invoice?.assets?.length))
  const ctx3 = await newContext()
  const p3 = await ctx3.newPage()
  const w3 = watch(p3, 'pay page (every chain)')
  await p3.goto(`${BASE}/pay/${invAll.data.invoice.id}`)
  const picker = p3.getByRole('radiogroup', { name: 'Pay with' })
  await picker.getByRole('radio', { name: 'USDC on Avalanche' }).waitFor({ timeout: 10_000 })
  check('pay: the picker lists USDC on OP Mainnet, USDC on Polygon, POL on Polygon and AVAX on Avalanche', (await picker.getByRole('radio', { name: 'USDC on OP Mainnet' }).count()) === 1 && (await picker.getByRole('radio', { name: 'USDC on Polygon' }).count()) === 1 && (await picker.getByRole('radio', { name: 'POL on Polygon' }).count()) === 1 && (await picker.getByRole('radio', { name: 'AVAX on Avalanche' }).count()) === 1)
  check('pay: the picker shows seven chain groups with their marks (real logo files, no letter tiles)', (await picker.locator('img[src^="/chains/"]').count()) >= 7 && (await picker.locator('img[src="/chains/optimism.svg"]').count()) >= 1 && (await picker.locator('img[src="/chains/polygon.svg"]').count()) >= 1 && (await picker.locator('img[src="/chains/avalanche.svg"]').count()) >= 1)
  await picker.getByRole('radio', { name: 'USDC on Avalanche' }).click()
  await p3.getByRole('img', { name: /^Wallet payment request: .* USDC on Avalanche/ }).waitFor({ timeout: 10_000 })
  check('pay: a USDC on Avalanche quote shows its QR and says 2 confirmations', (await p3.getByText(/counts after 2 confirmations/).count()) > 0)
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
  await page.goto(BASE + '/admin')
  await page.getByRole('heading', { name: 'Invoices' }).waitFor({ timeout: 15_000 })
  for (const h of ['Developer wallets', 'Pay links', 'Gully Analytics']) check(`admin: the ${h} section renders`, (await page.getByRole('heading', { name: h }).count()) > 0)
  check('admin: the invoice made above is listed', (await page.getByText('E2E: first month').count()) > 0)
  // Tracker health and venues read live upstreams this server cannot reach here.
  await w.verify([/Failed to load resource/])
  await ctx.close()
})

/* ------------------------------------------------------------- docs --- */

const DOCS = ['', 'methodology', 'api', 'widget', 'api-keys', 'plans-alerts', 'sdk', 'teams', 'analytics', 'gully-pay', 'roadmap-l3', 'changelog']
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

/* ------------------------------------------------------------- 404s and mobile pages --- */

await step('404s', async () => {
  for (const [p, want] of [['/this-page-does-not-exist', 404], ['/tracker/robinhood/ZZZZ', 404], ['/docs/nope', 404], ['/developers', 200], ['/admin', 200], ['/docs/teams', 200], ['/pricing', 200], ['/legal/merchant-terms', 200]]) {
    const r = await fetch(BASE + p)
    const html = await r.text()
    check(`HTTP ${want} for ${p}`, r.status === want && (want === 404 ? /noindex/.test(html) : !/Not found ·/.test(html)), `${r.status}`)
  }
})

await step('pages at 390', async () => {
  const ctx = await newContext({ width: 390, height: 844, mobile: true })
  const page = await ctx.newPage()
  for (const p of ['/tracker', '/tracker/robinhood/NVDA', '/pricing', '/widget', '/ask', '/analytics', '/chain-kit', '/services', '/about', '/app']) {
    const w = watch(page, `${p} at 390`)
    if (p === '/app') w.expect(/\/api\/developer\//)
    await page.goto(BASE + p)
    await page.waitForLoadState('networkidle').catch(() => {})
    await noHorizontalScroll(page, p)
    await w.verify([/li\.quest|lifi|wagmi|ERR_BLOCKED_BY_CLIENT/i])
  }
  await ctx.close()
})

/* ------------------------------------------------------------- brand kit --- */

// Every logo is one of src/components/brand (data-brand="kit", from the kit's own files): no CSS-typed
// "GULLY LABS" wordmark, letter tile or hand-drawn SVG wordmark on any surface, the self-contained error
// pages and the widget included (owner rule, CLAUDE.md "Brand kit everywhere").
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
  const page = await ctx.newPage()
  const w = watch(page, '/tg at 390')
  await page.goto(BASE + '/tg')
  await page.getByRole('radiogroup', { name: 'Section' }).waitFor()
  check('mini app: loads the SDK from the exact telegram.org URL', sdkUrl === 'https://telegram.org/js/telegram-web-app.js?59', sdkUrl)
  check('mini app: the theme maps onto the tokens (Telegram bg)', (await page.evaluate(() => getComputedStyle(document.querySelector('main').parentElement).backgroundColor)) === 'rgb(23, 33, 43)')
  const nvda = page.getByRole('button', { name: /^NVDA on Robinhood Chain/ })
  await nvda.waitFor()
  check('mini app: the gap list shows tracker rows', (await page.getByRole('button', { name: / on (Robinhood Chain|BNB Chain): gap / }).count()) > 3)
  await nvda.click()
  await page.getByText('Gap to the real share price').waitFor()
  check('mini app: a tap opens the stock with a haptic, and shows BackButton', (await page.evaluate(() => window.__tg.haptics.includes('impact:light') && window.__tg.back)) === true)
  await page.getByRole('radio', { name: '▼ Below' }).click()
  const mainBtn = await page.evaluate(() => window.__tg.main)
  check('mini app: MainButton offers to link a wallet when not linked', mainBtn?.is_visible === true && /Link wallet/.test(mainBtn.text), JSON.stringify(mainBtn))
  await noHorizontalScroll(page, '/tg stock')
  await page.evaluate(() => window.__tgBack())
  await page.getByRole('radiogroup', { name: 'Section' }).waitFor()
  check('mini app: BackButton returns to the list and hides', (await page.evaluate(() => window.__tg.back)) === false)
  await page.getByRole('radio', { name: 'My alerts' }).click()
  check('mini app: alerts ask an unlinked user to link a wallet', await page.getByText('Link your wallet for alerts').isVisible())
  await noHorizontalScroll(page, '/tg')
  await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
  await ctx.close()
})

const unexpectedOutbound = blockedOutbound.filter((u) => !/dexscreener|geckoterminal|rpc\.|deepcore|drpc|publicnode|ordofi|blastapi|robinhood|binance|bsc|llama|cartel|peddle|solana|xstocks|jup\.ag/i.test(u))
check('the server made no unexpected outbound calls', unexpectedOutbound.length === 0, (unexpectedOutbound.length ? unexpectedOutbound : blockedOutbound).slice(0, 5).join(' | '))
await browser.close()
const secs = Math.round((Date.now() - started) / 1000)
// E2E_SHOTS adds full-page screenshots on top of the checks, so the budget applies to plain runs.
check(`the suite runs in under 5 minutes (${secs} s${SHOTS ? ', screenshots on' : ''})`, SHOTS ? true : secs < 300)
console.log(`\n${t.passed} passed, ${t.failed} failed (${secs} s)`)
process.exit(t.failed ? 1 : 0)
