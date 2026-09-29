// Smoke test for the contact modal: open, close via Esc / × / overlay, focus handling.
// Usage: npm run dev (in another terminal), then `node compare/modal-test.mjs`.
import { chromium } from 'playwright'

const SITE = process.env.SITE_URL ?? 'http://localhost:5173'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(5000)
await page.goto(SITE + '/services')

let failed = false
for (const how of ['esc', 'close button', 'overlay']) {
  await page.getByRole('button', { name: 'Start a project' }).first().click()
  await page.waitForTimeout(300)
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('name') ?? document.activeElement?.tagName)
  if (how === 'esc') await page.keyboard.press('Escape')
  if (how === 'close button') await page.getByRole('button', { name: 'Close' }).click()
  if (how === 'overlay') await page.mouse.click(10, 450)
  await page.waitForTimeout(500)
  const gone = (await page.locator('[role=dialog]').count()) === 0
  failed ||= !gone
  console.log(`${how}: focus on open -> ${focused}, closed -> ${gone}`)
}

await browser.close()
process.exit(failed ? 1 : 0)
