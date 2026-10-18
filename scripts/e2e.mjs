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
import path from 'node:path'
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

await step('pay', async () => {
  const inv = await adminCall('/api/admin/invoices', { title: 'E2E: first month', usd: '25', assets: ['base-usdc', 'base-eth'] })
  check('pay: the admin API creates an invoice', inv.status === 201 && /^inv_/.test(inv.data?.invoice?.id ?? ''))
  const ctx = await newContext()
  const page = await ctx.newPage()
  await page.clock.install()
  const w = watch(page, 'pay page')
  await page.goto(`${BASE}/pay/${inv.data.invoice.id}`)
  await page.getByRole('radiogroup', { name: 'Pay with' }).getByRole('radio', { name: 'USDC on Base' }).click()
  await page.getByRole('img', { name: /^Wallet payment request:/ }).waitFor({ timeout: 10_000 })
  check('pay: a quote shows its wallet QR code', true)
  check('pay: the quote counts down', (await page.getByRole('timer').count()) > 0)
  await page.clock.fastForward('21:00')
  await page.getByText('quote ran out').first().waitFor({ timeout: 10_000 })
  check('pay: the quote expires after 20 minutes and offers a new one', (await page.getByRole('button', { name: 'New quote' }).count()) > 0)
  await w.verify()
  await ctx.close()

  const link = await adminCall('/api/admin/paylinks', { title: 'E2E pay link', amount: { type: 'fixed', usd: '49' }, assets: ['base-usdc'] })
  check('pay: the admin API creates a pay link', link.status === 201 && /^pl_/.test(link.data?.link?.id ?? ''))
  const ctx2 = await newContext()
  const p2 = await ctx2.newPage()
  const w2 = watch(p2, 'pay link page')
  await p2.goto(`${BASE}/pay/l/${link.data.link.id}`)
  await p2.getByRole('button', { name: 'Continue to checkout' }).click()
  await p2.waitForURL(/\/pay\/inv_/)
  check('pay link: continue makes an invoice and opens its checkout', true)
  await w2.verify()
  await ctx2.close()
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

const DOCS = ['', 'methodology', 'api', 'widget', 'api-keys', 'plans-alerts', 'sdk', 'teams', 'analytics', 'gully-pay', 'changelog']
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
      await w.verify()
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
  for (const [p, want] of [['/this-page-does-not-exist', 404], ['/tracker/robinhood/ZZZZ', 404], ['/docs/nope', 404], ['/developers', 200], ['/admin', 200], ['/docs/teams', 200], ['/pricing', 200]]) {
    const r = await fetch(BASE + p)
    const html = await r.text()
    check(`HTTP ${want} for ${p}`, r.status === want && (want === 404 ? /noindex/.test(html) : !/Not found ·/.test(html)), `${r.status}`)
  }
})

await step('pages at 390', async () => {
  const ctx = await newContext({ width: 390, height: 844, mobile: true })
  const page = await ctx.newPage()
  for (const p of ['/tracker', '/tracker/robinhood/NVDA', '/pricing', '/widget', '/ask', '/analytics', '/chain-kit', '/services', '/about', '/developers']) {
    const w = watch(page, `${p} at 390`)
    if (p === '/developers') w.expect(/\/api\/developer\//)
    await page.goto(BASE + p)
    await page.waitForLoadState('networkidle').catch(() => {})
    await noHorizontalScroll(page, p)
    await w.verify([/li\.quest|lifi|wagmi|ERR_BLOCKED_BY_CLIENT/i])
  }
  await ctx.close()
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
  await page.getByText('Gap to fair').waitFor()
  check('mini app: a tap opens the stock with a haptic, and shows BackButton', (await page.evaluate(() => window.__tg.haptics.includes('impact:light') && window.__tg.back)) === true)
  await page.getByRole('radio', { name: '▼ Discount' }).click()
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
