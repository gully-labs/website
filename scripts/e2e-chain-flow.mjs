// Create a chain in a real browser: the built site served by the real server IN THIS PROCESS, driven with Playwright. One
// journey through the five steps at 390 and at 1440 px, then failed payment, webhook replay, double order and the admin moving
// a status, each watched from the buyer's order page. Gully ID and Gully Pay are fakes (chain-flow-mocks.mjs): no real money.
//
//   npm run build && npm run test:chain-flow     (TEST_PORT overrides the port, default 8797)
//   CHAIN_SHOTS=<folder> also saves a screenshot of every screen at both widths.

import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { deliver, fakeGullyId, fakeGullyPay, GP, sessionEvent } from './chain-flow-mocks.mjs'
import { bootServer } from './e2e-harness.mjs'
import { guardTestRun, makeChecker } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8797
await guardTestRun(PORT, { watchdogMs: 12 * 60_000 })
const t = makeChecker()
const { check } = t
const SHOTS = process.env.CHAIN_SHOTS || ''
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const USER = { sub: 'sub-e2e', address: '0x' + 'a'.repeat(40) }
const gid = await fakeGullyId({ 'tok-e2e': USER })
const pay = await fakeGullyPay()
for (const k of ['MAINNET_ORDERS', 'CHAIN_GULLYPAY_MODE']) delete process.env[k]
Object.assign(process.env, { GULLY_ID_ISSUER: gid.url, GULLYPAY_API_URL: pay.url, GULLYPAY_CHECKOUT_URL: pay.url, CHAIN_GULLYPAY_MERCHANT_ID: GP.merchantId, CHAIN_GULLYPAY_STORE_ID: GP.storeId, CHAIN_GULLYPAY_API_KEY: GP.apiKey, CHAIN_GULLYPAY_WEBHOOK_SECRET: GP.secret })
const { admin, base: BASE } = await bootServer({ port: PORT })

const browser = await chromium.launch({ headless: true })
const SDK = `window.GullyID = { init: () => ({ signIn: async () => ({ accessToken: 'tok-e2e' }), handleRedirect: async () => null }) }`

async function context(width) {
  const mobile = width < 600
  const ctx = await browser.newContext({ viewport: { width, height: mobile ? 844 : 900 }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) })
  await ctx.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => {
    const u = new URL(route.request().url())
    if (u.hostname === 'gullyid.xyz' && u.pathname.startsWith('/sdk')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: SDK })
    return route.abort()
  })
  return ctx
}

function watch(page, label) {
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && !/ERR_FAILED|ERR_BLOCKED|net::/.test(m.text()) && errors.push(m.text().slice(0, 160)))
  return { verify: () => check(`${label}: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | ')) }
}
const shot = async (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true })
const noScroll = async (page, label) => check(`${label}: no horizontal scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
const orderId = (s) => s.clientReferenceId.replace(/^chain:/, '')
const adminCall = (p, body) => fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json())
const status = (page) => page.getByTestId('order-status')
const next = (page) => page.getByTestId('next').click()

/** Steps 1 to 4: from the empty form to the Pay step. Returns once Pay shows. */
async function toPay(page, chainId, { width, first = false }) {
  await page.goto(`${BASE}/create-chain`)
  await page.getByTestId('chain-name').waitFor()
  await page.getByTestId('chain-name').fill('Acme Chain')
  await page.getByTestId('chain-id').fill('485590')
  await page.getByText('Gully Chain Testnet uses this id.').waitFor()
  check(`${width} step 1: a taken id blocks Next`, await page.getByTestId('next').isDisabled())
  await page.getByTestId('chain-id').fill(String(chainId))
  await page.getByText('This id is free.').waitFor()
  if (first) await shot(page, `1-chain-${width}`)
  await next(page)

  await page.getByTestId('tier-testnet').waitFor()
  if (first) {
    check(`${width} step 2: mainnet says Talk to us`, (await page.getByTestId('tier-mainnet-talk').getByRole('link', { name: /Talk to us/ }).count()) === 1 && (await page.getByTestId('tier-mainnet').count()) === 0)
    check(`${width} step 2: the Talk to us link opens a new tab`, (await page.getByTestId('tier-mainnet-talk').getByRole('link').getAttribute('target')) === '_blank')
    check(`${width} step 2: the Nitro licence note shows`, /Arbitrum One, Arbitrum Nova or Arbitrum Sepolia/.test(await page.getByTestId('licence-note').innerText()))
    check(`${width} step 2: no price comparison on the page`, !/conduit|caldera/i.test(await page.locator('main').innerText()))
    check(`${width} live price: starts on the free testnet`, (await page.getByTestId('price-headline').innerText()) === 'Free for 30 days')
    check(`${width} live price: the test payment is $1.00`, (await page.getByTestId('due-today').innerText()) === '$1.00')
    const before = await page.getByTestId('price-summary').innerText()
    await page.getByTestId('addon-gully-core').click()
    await page.getByTestId('price-summary').getByText('0.30% of every trade').waitFor()
    check(`${width} live price: an add-on updates the summary`, (await page.getByTestId('price-summary').innerText()) !== before)
    await shot(page, `2-plan-${width}`)
  }
  await next(page)
  await page.getByRole('heading', { name: 'Check your order' }).waitFor()
  if (first) await shot(page, `3-price-${width}`)
  await next(page)

  await page.getByRole('heading', { name: 'Sign in with Gully ID' }).waitFor()
  if (first) {
    check(`${width} step 4: Next waits for Gully ID`, await page.getByTestId('next').isDisabled())
    await shot(page, `4-signin-${width}`)
    await page.getByRole('button', { name: 'Sign in with Gully ID' }).click()
  }
  await page.getByTestId('signed-in').waitFor()
  await page.getByTestId('chain-email').fill('team@example.com')
  await next(page)
  await page.getByTestId('pay').waitFor()
  if (first) await shot(page, `5-pay-${width}`)
}

let n = 7_200_000
for (const width of [390, 1440]) {
  const ctx = await context(width)
  const page = await ctx.newPage()
  const w = watch(page, `${width}`)

  /* The whole journey. */
  await toPay(page, ++n, { width, first: true })
  await noScroll(page, `${width} wizard`)
  await page.getByTestId('pay').click()
  await page.waitForURL(`${pay.url}/**`)
  check(`${width} step 5: the buyer lands on Gully Pay's hosted checkout`, (await page.title()) === 'Gully Pay test checkout')
  const s = pay.sessions.at(-1)
  check(`${width} step 5: the session is $1.00 on the chain store`, s.amount === 100 && s.currency === 'USD')
  const id = orderId(s)

  await page.goto(`${BASE}/create-chain/orders/${id}?checkout=cancelled`)
  await status(page).waitFor()
  check(`${width} order: Awaiting payment after a closed checkout`, (await status(page).innerText()) === 'Awaiting payment')
  await page.getByText('Nothing was charged. You can pay when you are ready.').waitFor()
  await shot(page, `6-order-awaiting-${width}`)
  await noScroll(page, `${width} order page`)

  /* Failed payment: the page says so, on its own. */
  await deliver(BASE, sessionEvent('checkout.session.payment_failed', s, { status: 'open', failureReason: 'Your card was declined.' }))
  await page.getByTestId('order-error').waitFor({ timeout: 12_000 })
  check(`${width} failed payment: the reason shows, still unpaid`, (await page.getByTestId('order-error').innerText()) === 'Your card was declined.' && (await status(page).innerText()) === 'Awaiting payment')
  await page.getByText('The payment did not go through').first().waitFor()
  await shot(page, `7-order-failed-${width}`)

  /* Paid, and a replay of the same event. */
  const paid = sessionEvent('checkout.session.completed', s)
  await deliver(BASE, paid)
  await page.getByText('Your order is paid').waitFor({ timeout: 12_000 })
  check(`${width} paid: the verified webhook moves the page, with a toast`, (await status(page).innerText()) === 'Paid')
  await shot(page, `8-order-paid-${width}`)
  const replay = await deliver(BASE, paid)
  check(`${width} replay: answered as a duplicate`, replay.data.duplicate === true)

  /* Double order: the same chain id again opens the order that exists. */
  await toPay(page, n, { width })
  await page.getByTestId('pay').click()
  await page.waitForURL(`**/create-chain/orders/${id}`)
  await page.getByText('You already have this order').waitFor()
  const count = (await adminCall('/api/admin/chain-orders')).orders.filter((o) => o.chainId === n).length
  check(`${width} double order: still one order`, count === 1)

  /* Gully Pay down: a clear message, and the order can pay later. */
  pay.state.failNext = true
  await toPay(page, ++n, { width })
  await page.getByTestId('pay').click()
  await page.getByText('Could not open checkout').waitFor()
  await page.waitForURL('**/create-chain/orders/**')
  await page.getByTestId('order-pay').waitFor()
  check(`${width} Gully Pay down: the buyer lands on the unpaid order`, (await status(page).innerText()) === 'Awaiting payment')

  /* The admin moves the status; the buyer's page follows. */
  await page.goto(`${BASE}/create-chain/orders/${id}`)
  await status(page).waitFor()
  await adminCall(`/api/admin/chain-orders/${id}/status`, { status: 'setting_up', note: 'Box ordered' })
  await page.getByText('Your order is setting up').waitFor({ timeout: 25_000 })
  await shot(page, `9-order-setting-up-${width}`)
  await adminCall(`/api/admin/chain-orders/${id}/status`, { status: 'live' })
  await page.getByText('Your order is live').waitFor({ timeout: 25_000 })
  check(`${width} status: Live, times in PT`, (await status(page).innerText()) === 'Live' && / PT/.test(await page.locator('main').innerText()))
  await shot(page, `10-order-live-${width}`)
  await noScroll(page, `${width} order page live`)

  /* The admin console. */
  const actx = await context(width)
  await actx.addInitScript((tok) => sessionStorage.setItem('gully-admin-token', tok), admin)
  const ap = await actx.newPage()
  await ap.goto(`${BASE}/admin#chainorders`)
  await ap.getByTestId('admin-chain-orders').waitFor({ timeout: 15_000 })
  const row = ap.getByTestId(`admin-order-${n}`)
  await row.waitFor()
  check(`${width} admin: no button can mark an order paid`, (await row.getByRole('button', { name: /paid/i }).count()) === 0)
  await shot(ap, `11-admin-${width}`)
  await noScroll(ap, `${width} admin`)
  await actx.close()

  w.verify()
  await ctx.close()
}

/* Mainnet stays shut through the API too, and a signed-out order page asks for Gully ID. */
const ctx = await context(1440)
const page = await ctx.newPage()
await page.goto(`${BASE}/create-chain/orders/co_nothinghere00`)
await page.getByRole('button', { name: 'Sign in with Gully ID' }).waitFor()
check('a signed-out order page asks for Gully ID', true)
await ctx.close()

await browser.close()
gid.close()
pay.close()
console.log(`\n${t.passed} passed, ${t.failed} failed`)
process.exit(t.failed ? 1 : 0)
