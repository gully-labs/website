import fs from 'node:fs'
import { chromium } from 'playwright'
import { bootServer, trackerFixture } from './e2e-harness.mjs'
const PORT = Number(process.env.TEST_PORT) || 9271
const OUT = process.env.OUT
const slugs = (process.env.SLUGS || '').split(',')
const { base: BASE } = await bootServer({ port: PORT })
const TRACKER = trackerFixture()
const browser = await chromium.launch()
fs.mkdirSync(OUT, { recursive: true })
for (const width of [1440, 390]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 500 })
  await ctx.route((u) => u.origin !== BASE, (r) => r.abort())
  const page = await ctx.newPage()
  await page.route(`${BASE}/api/tracker`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TRACKER) }))
  const msgs = []
  page.on('console', (m) => m.type() === 'error' && msgs.push(m.text()))
  for (const slug of slugs) {
    await page.goto(`${BASE}/docs${slug ? '/' + slug : ''}`)
    await page.locator('h1').first().waitFor()
    await page.waitForTimeout(2500)
    const h = await page.evaluate(() => document.documentElement.scrollHeight)
    const txt = await page.evaluate(() => document.querySelector('#docs-main')?.innerText ?? '')
    console.log(width, slug || 'index', 'viewports', (h / 900).toFixed(1), /undefined|\[object|\bnull\b/.test(txt) ? 'NOISE:' + (txt.match(/.{20}(undefined|\[object|\bnull\b).{20}/g) || []).slice(0, 3).join(' | ') : '')
    await page.screenshot({ path: `${OUT}/${slug || 'index'}-${width}.png`, fullPage: true })
  }
  console.log(width, 'console errors', msgs.length, msgs.slice(0, 3))
  await ctx.close()
}
await browser.close()
process.exit(0)
