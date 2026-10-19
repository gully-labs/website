// Lists clipped or truncated elements on the holder map page at 390 and 320 (dev aid): TEST_PORT=9321 node scripts/holders-clip-scan.mjs
import { chromium } from 'playwright'
import { bootServer, E2E_LAUNCH_TOKEN, holdersExtraFixtures, holdersFixture } from './e2e-harness.mjs'
import { guardTestRun } from './test-helpers.mjs'
import { clippedIn } from './holders-clip.mjs'
const PORT = Number(process.env.TEST_PORT) || 9321
await guardTestRun(PORT, { watchdogMs: 1_800_000 })
const { base: BASE } = await bootServer({ port: PORT })
const browser = await chromium.launch()
const HX = holdersExtraFixtures()
const json = (r, b) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })
for (const width of [390, 320]) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' })
  await ctx.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (r) => r.abort())
  await ctx.route(`${BASE}/api/geo`, (r) => json(r, { country: 'GB', allowed: true, reason: 'ok' }))
  await ctx.route(new RegExp(`^${BASE}/api/holders/[^/]+/[^/.]+$`), (r) => json(r, holdersFixture('deepcore-launch')))
  await ctx.route(new RegExp(`^${BASE}/api/holders/[^/]+/[^/]+/live`), (r) => json(r, HX.live))
  const page = await ctx.newPage()
  await page.goto(`${BASE}/holders/robinhood/${E2E_LAUNCH_TOKEN}`)
  await page.locator('[data-holder-map="ok"]').waitFor()
  await page.waitForTimeout(2500)
  console.log(width, 'seg', JSON.stringify(await page.locator('[data-segmented]').first().boundingBox()), 'chip', JSON.stringify(await page.getByRole('button', { name: /Showing contracts/ }).boundingBox()));console.log(width, JSON.stringify(await clippedIn(page, '[data-holder-map="ok"]'), null, 1))
  await page.locator('[data-holder-map="ok"]').screenshot({ path: `${process.env.TEMP}/clip-${width}.png` })
  await ctx.close()
}
process.exit(0)
