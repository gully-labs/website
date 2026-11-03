// The signed-in Gully Labs App (app.gullylabs.xyz) at the design standard's five widths: an overflow check and
// screenshots of every page, the phone menu sheet and the Gully AI drawer.
//
//   npm run build && node scripts/hub-shots.mjs <out dir>       (TEST_PORT overrides the port, default 8794)
//
// Like scripts/e2e.mjs: the built site (dist/) served by the real server IN THIS PROCESS with every upstream stubbed
// (scripts/e2e-harness.mjs), a throwaway wallet signed in with SIWE, every request off localhost aborted. So the
// figures on the pages are the honest empty / unreadable states, never live data. For each page and width: no
// horizontal scroll, no element past the right edge (fixed and clipped ones aside), no page error. Exit 1 otherwise.
// Env: HUB_PAGES (comma-separated hash ids), HUB_WIDTHS (JSON array). Writes <out>/report.json too.
import fs from 'node:fs'
import { chromium } from 'playwright'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { bootServer } from './e2e-harness.mjs'
import { makeClient } from './test-helpers.mjs'

const out = process.argv[2]
if (!out) {
  console.error('usage: node scripts/hub-shots.mjs <out dir>')
  process.exit(2)
}
fs.mkdirSync(out, { recursive: true })
const PORT = Number(process.env.TEST_PORT) || 8794
const PAGES = (process.env.HUB_PAGES || 'overview,activity,products,keys,billing,team,settings,tracker,alerts').split(',').filter(Boolean)
const WIDTHS = JSON.parse(process.env.HUB_WIDTHS || '[390,768,1024,1440,1920]')

const { base: BASE } = await bootServer({ port: PORT })
const api = makeClient(BASE)
const signedIn = await api.signIn(privateKeyToAccount(generatePrivateKey()))
if (signedIn.status !== 200) {
  console.error(`sign-in failed: ${signedIn.status}`)
  process.exit(1)
}
const cookie = api.cookie.split('=').slice(1).join('=')

// Runs in the page: what the standard forbids at this width.
const inspect = () => {
  const de = document.documentElement
  const vw = de.clientWidth
  const clipped = (el) => {
    for (let a = el.parentElement; a; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return true
    return false
  }
  const name = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/)[0]}` : ''}${el.dataset.testid ? `[${el.dataset.testid}]` : ''}`
  const over = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed' && !clipped(el)) over.push(name(el))
  }
  // A product mark drawn outside its file's own ratio (stretched or squashed) is a pixel-perfect failure.
  const warped = []
  for (const img of document.querySelectorAll('img[data-product-logo], [data-product-logo] img, [data-product-mark]')) {
    if (!img.naturalWidth || !img.naturalHeight) continue
    const r = img.getBoundingClientRect()
    if (!r.width || !r.height) continue
    if (getComputedStyle(img).objectFit === 'contain') continue
    const ratio = r.width / r.height / (img.naturalWidth / img.naturalHeight)
    if (Math.abs(ratio - 1) > 0.03) warped.push(`${img.getAttribute('src')} ${Math.round(r.width)}x${Math.round(r.height)} vs ${img.naturalWidth}x${img.naturalHeight}`)
  }
  const small = []
  if (vw < 1024)
    for (const el of document.querySelectorAll('nav[aria-label="App pages"] a, [data-testid="tab-bar"] a, [data-testid="tab-bar"] button, [data-testid="products"] a, [data-testid="products"] button, [data-testid="tools"] button')) {
      const r = el.getBoundingClientRect()
      if (r.width && r.height && r.height < 43.5) small.push(`${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24)} ${Math.round(r.width)}x${Math.round(r.height)}`)
    }
  return { scrollW: de.scrollWidth, vw, height: de.scrollHeight, overflow: [...new Set(over)].slice(0, 8), warped, smallTargets: small.slice(0, 12), navCount: document.querySelectorAll('nav[aria-label="App pages"] a').length, navIds: document.querySelector('[data-nav-ids]')?.getAttribute('data-nav-ids') ?? null, title: document.title }
}

const browser = await chromium.launch()
const report = []
let bad = 0
const row = (r) => {
  report.push(r)
  const fail = r.scrollW > r.vw || r.overflow.length || r.errors.length || r.warped.length
  if (fail) bad++
  console.log(`${fail ? 'FAIL' : 'ok  '} ${r.name} ${r.w}: h ${r.height} | nav ${r.navCount} | overflow ${r.overflow.length}${r.scrollW > r.vw ? ` (scroll ${r.scrollW} > ${r.vw})` : ''} | warped ${r.warped.length} | small ${r.smallTargets.length} | errors ${r.errors.length}${r.errors.length ? ` ${r.errors[0]}` : ''}${r.overflow.length ? ` ${r.overflow.join(' ')}` : ''}${r.warped.length ? ` ${r.warped.join(' ')}` : ''}`)
}

for (const w of WIDTHS) {
  const mobile = w < 500
  const ctx = await browser.newContext({ viewport: { width: w, height: mobile ? 844 : w < 1100 ? 1024 : 900 }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}), serviceWorkers: 'block' })
  await ctx.addCookies([{ name: 'gl_dev', value: cookie, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }])
  await ctx.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => route.abort('blockedbyclient'))
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
  const shoot = async (name, ready) => {
    const errs0 = errors.length
    const ok = await page.locator(ready).first().waitFor({ timeout: 20_000 }).then(() => true, () => false)
    if (!ok) errors.push(`${name}: ${ready} did not appear`)
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${out}/${name}-${w}-fold.png` }).catch(() => {})
    const h = await page.evaluate(() => document.documentElement.scrollHeight)
    for (let y = 0; y < h; y += 700) {
      await page.evaluate((v) => window.scrollTo(0, v), y)
      await page.waitForTimeout(150)
    }
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(600)
    const m = await page.evaluate(inspect)
    await page.screenshot({ path: `${out}/${name}-${w}.png`, fullPage: true }).catch(() => {})
    row({ name, w, errors: errors.slice(errs0), ...m })
  }
  for (const id of PAGES) {
    await page.goto(`${BASE}/app#${id}`, { waitUntil: 'domcontentloaded' })
    await shoot(`hub-${id}`, id === 'tracker' ? '[data-service="tracker"] [data-testid="service-header"]' : `main[data-page="${id}"]`)
  }
  // The phone menu sheet (under 860 px) and the Gully AI drawer (every width; it needs Ask to be configured here).
  await page.goto(`${BASE}/app`, { waitUntil: 'domcontentloaded' })
  await page.locator('main[data-page="overview"]').waitFor({ timeout: 20_000 }).catch(() => {})
  if (w < 860) {
    const more = page.getByTestId('tab-more')
    if (await more.count()) {
      await more.click()
      await shoot('hub-menu-sheet', '[data-testid="app-sheet"]')
      await page.keyboard.press('Escape')
    }
  }
  const fab = page.getByTestId('ask-fab')
  if (await fab.count()) {
    await fab.click()
    await shoot('hub-ai-drawer', '[data-testid="ask-dialog"]')
    await page.keyboard.press('Escape')
  } else console.log(`note ${w}: Gully AI is not configured on this server, drawer not shot`)
  await ctx.close()
}
await browser.close()
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1))
console.log(bad ? `FAILED: ${bad} page(s) with overflow, warped marks or errors` : `no overflow, no warped mark, no page error (${report.length} shots)`)
process.exit(bad ? 1 : 0)
