// Screenshots and a motion sequence of the Holder Map for review (not part of the test run):
//   npm run build && TEST_PORT=9321 node scripts/bubble-shots.mjs <out-dir>
// It boots the real server against dist/ with the e2e harness (scripts/e2e-harness.mjs) and drives Playwright
// over the harness's holder fixtures: a DeepCore launch, a Solana token (top holders, no links), a stock token,
// a busy 320-wallet map and the embed, at 1440 and 390.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { bootServer, E2E_LAUNCH_TOKEN, holdersExtraFixtures, holdersFixture } from './e2e-harness.mjs'
import { guardTestRun } from './test-helpers.mjs'
import { busyFixture, solanaFixture, SOLANA_TOKEN } from './holders-shots-fixtures.mjs'

const PORT = Number(process.env.TEST_PORT) || 9321
const OUT = path.resolve(process.argv[2] || 'bubble-v3')
fs.mkdirSync(OUT, { recursive: true })
await guardTestRun(PORT, { watchdogMs: Number(process.env.E2E_WATCHDOG_MS) || 1_800_000 })
const { base: BASE } = await bootServer({ port: PORT })
const browser = await chromium.launch()
const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
const HX = holdersExtraFixtures()

async function ctxFor(width) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, ...(width < 600 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}), serviceWorkers: 'block' })
  await ctx.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (r) => r.abort('blockedbyclient'))
  await ctx.route(`${BASE}/api/geo`, (r) => json(r, { country: 'GB', allowed: true, reason: 'ok' }))
  await ctx.route(new RegExp(`^${BASE}/api/holders/[^/]+/[^/.]+$`), (r) => json(r, holdersFixture(/\/0x[0-9a-f]{40}$/i.test(new URL(r.request().url()).pathname) ? 'deepcore-launch' : 'stock')))
  await ctx.route(`${BASE}/api/holders/solana/${SOLANA_TOKEN}`, (r) => json(r, solanaFixture()))
  await ctx.route(`${BASE}/api/holders/base/0x000000000000000000000000000000000b0b0b05`, (r) => json(r, busyFixture()))
  await ctx.route(new RegExp(`^${BASE}/api/holders/[^/]+/[^/]+/live`), (r) => json(r, HX.live))
  await ctx.route(new RegExp(`^${BASE}/api/holders/[^/]+/[^/]+/wallet/`), (r) => json(r, HX.wallet))
  return ctx
}

const shots = [
  ['launch', `/holders/robinhood/${E2E_LAUNCH_TOKEN}`],
  ['solana', `/holders/solana/${SOLANA_TOKEN}`],
  ['stock', '/holders/robinhood/NVDA'],
  ['embed', `/embed/holders/robinhood/${E2E_LAUNCH_TOKEN}`],
]
for (const width of [1440, 390]) {
  for (const [name, url] of shots) {
    const ctx = await ctxFor(width)
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e)))
    page.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 160)))
    await page.goto(BASE + url)
    await page.locator('[data-holder-map="ok"]').waitFor()
    await page.locator('[data-chart] canvas').first().waitFor()
    await page.addStyleTag({ content: '[data-testid="ask-fab"] { display: none !important }' })
    await page.locator('[data-supply-strip]').scrollIntoViewIfNeeded().catch(() => {})
    await page.waitForTimeout(2500)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(2500)
    if (width < 600 && name !== 'embed') {
      await page.locator('[data-holder-map="ok"]').screenshot({ path: path.join(OUT, `${name}-${width}.png`) })
    } else await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`), fullPage: name !== 'embed' })
    if (name === 'launch' && width === 1440) {
      // Motion: four frames, 700 ms apart, of the map only.
      const el = page.locator('[data-map-stage]')
      for (let i = 0; i < 4; i++) {
        await el.screenshot({ path: path.join(OUT, `motion-${i + 1}.png`) })
        await page.waitForTimeout(700)
      }
      // Hover the biggest non-pool bubble.
      const big = JSON.parse((await page.locator('[data-bubble-canvas]').getAttribute('data-big')) ?? '{}')
      const box = await page.locator('[data-bubble-canvas]').boundingBox()
      await page.mouse.move(box.x + big.x, box.y + big.y)
      await page.waitForTimeout(500)
      await el.screenshot({ path: path.join(OUT, 'hover.png') })
      await page.mouse.click(box.x + big.x, box.y + big.y)
      await page.waitForTimeout(1200)
      await el.screenshot({ path: path.join(OUT, 'clicked-zoom.png') })
    }
    if (errs.length) console.log(`${name} ${width}: ${errs.slice(0, 3).join(' | ')}`)
    await ctx.close()
  }
}
{
  const ctx = await ctxFor(1440)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/holders/base/0x000000000000000000000000000000000b0b0b05`)
  await page.locator('[data-chart] canvas').first().waitFor()
  await page.waitForTimeout(5200)
  await page.screenshot({ path: path.join(OUT, 'busy-1440.png') })
  await ctx.close()
}
await browser.close()
console.log('shots in', OUT)
process.exit(0)
