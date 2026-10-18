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
import { blockedOutbound, bootServer, historyFixture, ROOT, SAFE_FIXTURE, seedTrackerHistory, signedInitData, statsFixture, telegramSdkStub, trackerFixture } from './e2e-harness.mjs'
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
  // Header menus.
  await page.evaluate(() => window.scrollTo(0, 0))
  for (const [menu, item] of [['Products', /^Stock tracker/], ['Developers', /^API docs/], ['Company', /^Services/]]) {
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

await step('privacy page', async () => {
  const ctx = await newContext()
  const page = await ctx.newPage()
  const w = watch(page, 'privacy page')
  await page.goto(BASE + '/legal/privacy')
  await page.getByRole('heading', { level: 1, name: 'Privacy policy' }).waitFor()
  const ids = await page.evaluate(() => [...document.querySelectorAll('article section[id^="s"]')].map((x) => x.id))
  check('privacy: twelve numbered sections, s1 to s12, each linked from the section nav', ids.join() === Array.from({ length: 12 }, (_, i) => `s${i + 1}`).join() && (await page.getByRole('navigation', { name: 'Sections' }).getByRole('link').count()) === 12, ids.join())
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
  await page.goto(BASE + '/developers#keys')
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
  // Gully Analytics tab (sign-up is off on this server: it must say so, not break).
  await appNav.getByRole('link', { name: /^Analytics/ }).click()
  await page.getByText(/not switched on/).first().waitFor()
  check('analytics tab: says self-serve is off here', true)
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
  // Activity lists what happened, in the UI.
  await appNav.getByRole('link', { name: /^Activity/ }).click()
  await page.getByRole('heading', { name: 'Activity' }).waitFor()
  // The heading renders before GET /api/developer/activity answers (skeleton rows meanwhile): wait for the list.
  await page.locator('[data-testid="activity-list"] > li').first().waitFor({ timeout: 10_000 })
  const actText = await page.locator('[data-testid="activity-list"]').textContent()
  check('activity: the log shows the key, alert and team changes', /key/i.test(actText) && /alert/i.test(actText) && /invite|member|role/i.test(actText), actText?.slice(0, 160))
  // CSV downloads from Billing.
  await appNav.getByRole('link', { name: /^Billing/ }).click()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /Payments CSV/ }).click()])
  check('CSV: payments downloads', /payments.*\.csv$/.test(dl.suggestedFilename()), dl.suggestedFilename())
  const usageLink = page.getByRole('link', { name: /Download usage CSV/ }).first()
  const [dl2] = await Promise.all([page.waitForEvent('download'), usageLink.click()])
  const csv = fs.readFileSync(await dl2.path(), 'utf8')
  check('CSV: usage downloads with its header row', csv.startsWith('time,key,'), csv.slice(0, 40))
  await w.verify()
  await ctx.close()
})

/* ------------------------------------------------------------- pay --- */

const adminCall = async (p, body) => {
  const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => null) }
}

// E2E_SHOTS=<dir>: full-page screenshots of every checkout state at 1440 and 390 land there (nothing is written without it).
const SHOTS = process.env.E2E_SHOTS ? path.resolve(process.env.E2E_SHOTS) : null
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const shot = async (page, name) => {
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
  await shot(page, 'gully-invoice-quote')
  await page.clock.fastForward('21:00')
  await page.getByText('quote ran out').first().waitFor({ timeout: 10_000 })
  check('pay: the quote expires after 20 minutes and offers a new one', (await page.getByRole('button', { name: 'New quote' }).count()) > 0)
  await shot(page, 'gully-invoice-quote-expired')
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
    await shot(p, 'gully-invoice-paid')
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
  await shot(p2, 'gully-link')
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
  await page.goto(BASE + '/developers#merchant')
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
    await shot(page, 'merchant-link-unnamed')
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
      await shot(p, 'merchant-link-open')
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
      await shot(p, 'merchant-invoice-quote')
      if (width === 1440) {
        await p.clock.fastForward('21:00')
        await p.getByText('quote ran out').first().waitFor({ timeout: 10_000 })
        check('store invoice: an expired quote offers a new one', (await p.getByRole('button', { name: 'New quote' }).count()) > 0)
        await shot(p, 'merchant-invoice-quote-expired')
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
      await shot(p, 'merchant-invoice-items')
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
      if (opts.cookie) check('closed link, owner: sees the fix with a link to the Merchant tab', (await p.getByTestId('owner-fixes').count()) === 1 && /#m-wallets$/.test(await p.getByTestId('owner-fixes').getByRole('link').first().getAttribute('href')))
      else check(`closed link, ${label}: a payer sees no owner hints`, (await p.getByTestId('owner-fixes').count()) === 0)
      if (opts.width === 390) await noHorizontalScroll(p, 'closed link')
      await shot(p, opts.cookie ? 'merchant-link-closed-owner' : 'merchant-link-closed')
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
      await shot(p, 'merchant-link-expired')
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
      await shot(p, name)
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
      await shot(p, 'merchant-invoice-paid')
      if (width === 1440) {
        await p.getByRole('link', { name: 'View receipt' }).click()
        await p.waitForURL(/\/receipt$/)
        await p.getByTestId('receipt-page').waitFor()
        check('store receipt: names the store, the lines and PAID IN FULL', (await p.getByText('PAID IN FULL').count()) === 1 && (await p.getByTestId('receipt-page').getByText('Acme Coffee').count()) >= 1 && (await p.getByTestId('receipt-page').getByText('Descaler, 500 ml').count()) === 1)
        await shot(p, 'merchant-receipt')
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
  for (const h of ['Developer wallets', 'Pay links', 'Gully Analytics', 'Treasury Safe']) check(`admin: the ${h} section renders`, (await page.getByRole('heading', { name: h }).count()) > 0)
  check('admin: the invoice made above is listed', (await page.getByText('E2E: first month').count()) > 0)
  // Treasury Safe: Base holds the Safe, Arbitrum is deployable, the plan reaches "connect a wallet".
  const base = page.getByTestId('treasury-chain-8453')
  await base.getByText(/Safe 1\.4\.1/).waitFor({ timeout: 15_000 })
  check('admin treasury: Base shows the Safe (1.4.1, 1/1) and Arbitrum offers Deploy', (await base.getByText(/Safe 1\.4\.1 · 1\/1/).count()) === 1 && (await page.getByRole('button', { name: 'Deploy Safe on Arbitrum' }).count()) === 1)
  check('admin treasury: the extra chains are listed ahead of payments', (await page.getByTestId('treasury-chain-10').count()) === 1 && (await page.getByTestId('treasury-chain-137').count()) === 1)
  await page.getByRole('button', { name: 'Deploy Safe on Arbitrum' }).click()
  const tp = page.getByTestId('treasury-chain-42161').locator('[data-testid="safe-deploy"]')
  await tp.getByText('address verified').waitFor({ timeout: 20_000 })
  check('admin treasury: the plan predicts the treasury address and waits for a wallet', /0\.00023688 ETH/.test(await tp.textContent()) && (await tp.getByRole('button', { name: 'Connect a wallet to deploy' }).count()) === 1)
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
  for (const [p, want] of [['/this-page-does-not-exist', 404], ['/tracker/robinhood/ZZZZ', 404], ['/docs/nope', 404], ['/developers', 200], ['/admin', 200], ['/docs/teams', 200], ['/pricing', 200], ['/legal/merchant-terms', 200], ['/legal/privacy', 200], ['/links', 200]]) {
    const r = await fetch(BASE + p)
    const html = await r.text()
    check(`HTTP ${want} for ${p}`, r.status === want && (want === 404 ? /noindex/.test(html) : !/Not found ·/.test(html)), `${r.status}`)
  }
})

await step('pages at 390', async () => {
  const ctx = await newContext({ width: 390, height: 844, mobile: true })
  const page = await ctx.newPage()
  for (const p of ['/tracker', '/tracker/robinhood/NVDA', '/pricing', '/widget', '/ask', '/analytics', '/chain-kit', '/services', '/about', '/legal/privacy', '/developers', '/links']) {
    const w = watch(page, `${p} at 390`)
    if (p === '/developers') w.expect(/\/api\/developer\//)
    await page.goto(BASE + p)
    await page.waitForLoadState('networkidle').catch(() => {})
    await noHorizontalScroll(page, p)
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
      soon: /Holder Map/.test(document.body.textContent ?? ''),
    }
  })
  check('/links: the kit lockup is there', r.kit > 0, JSON.stringify(r))
  check('/links: at least 15 links, each a new tab with noopener and an icon', r.n >= 15 && !r.bad.length && !r.noIcon.length, JSON.stringify(r))
  check('/links: every web link carries the KOL UTM tags', !r.untagged.length, JSON.stringify(r.untagged))
  check('/links: the Gully Pay fee is read from the server', r.pay)
  check('/links: Holder Map is listed as coming soon', r.soon)
  check('/links: the title', (await page.title()) === 'Links · Gully Labs', await page.title())
  await noHorizontalScroll(page, '/links')
  await w.verify([/ERR_BLOCKED_BY_CLIENT/i])
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
check(`the suite runs in under 5 minutes (${secs} s)`, secs < 300)
console.log(`\n${t.passed} passed, ${t.failed} failed (${secs} s)`)
process.exit(t.failed ? 1 : 0)
