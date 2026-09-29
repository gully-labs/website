// Pixel check: renders every page of the kit prototype and of this site under the
// same conditions (fonts loaded, animations frozen at their end state) and diffs them.
// Usage: npm run dev (in another terminal), then `node compare/compare.mjs [--kit]`.
// --kit also diffs against the PNGs shipped in gully-labs-kit/screenshots.
import { chromium } from 'playwright'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const KIT = process.env.GULLY_KIT ?? 'C:/Users/Admin/Downloads/Gully Labs landing directions (1)/gully-labs-kit'
const SITE = process.env.SITE_URL ?? 'http://localhost:5173'
const OUT = path.resolve('compare/out')
fs.mkdirSync(OUT, { recursive: true })

const FREEZE = `*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition:none!important;caret-color:transparent!important}`

const viewports = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
}

// Prototype navigation is in-page state, so each page is reached by clicking.
const clickText = (text) => async (page) => {
  await page.locator('button', { hasText: text }).first().click()
}

const pages = [
  { name: 'home', site: '/', proto: null, kit: { desktop: 'desktop-01-home.png', mobile: 'mobile-01-home.png' } },
  { name: 'project', site: '/projects/cartel-family', proto: clickText('Cartel Family'), kit: { desktop: 'desktop-02-project-detail.png' } },
  { name: 'services', site: '/services', proto: clickText('All services'), kit: { desktop: 'desktop-03-services.png' } },
  { name: 'about', site: '/about', proto: null, protoAbout: true, kit: { desktop: 'desktop-04-about.png' } },
]

async function settle(page) {
  await page.addStyleTag({ content: FREEZE })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(2300) // count-up (1.8s) and fade-ins
  await page.mouse.move(0, 0)
}

async function shoot(browser, vp, url, prep) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  if (prep) {
    await prep(page)
    await page.waitForTimeout(100)
  }
  await settle(page)
  const buf = await page.screenshot({ fullPage: true })
  await ctx.close()
  return PNG.sync.read(buf)
}

function pad(img, w, h) {
  if (img.width === w && img.height === h) return img
  const out = new PNG({ width: w, height: h })
  out.data.fill(0)
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255
  PNG.bitblt(img, out, 0, 0, Math.min(img.width, w), Math.min(img.height, h), 0, 0)
  return out
}

function diff(a, b, file) {
  const w = Math.max(a.width, b.width)
  const h = Math.max(a.height, b.height)
  const A = pad(a, w, h)
  const B = pad(b, w, h)
  const d = new PNG({ width: w, height: h })
  const n = pixelmatch(A.data, B.data, d.data, w, h, { threshold: 0.1 })
  fs.writeFileSync(path.join(OUT, file), PNG.sync.write(d))
  return { pct: (n / (w * h)) * 100, size: `${b.width}x${b.height} vs ${a.width}x${a.height}` }
}

const browser = await chromium.launch()
const proto = pathToFileURL(path.join(KIT, 'gully-labs-site-standalone.html')).href
const withKit = process.argv.includes('--kit')
const rows = []

for (const [vpName, vp] of Object.entries(viewports)) {
  for (const p of pages) {
    let prep = p.proto
    if (p.protoAbout) prep = clickText('About')
    if (vpName === 'mobile' && prep && p.name !== 'project' && p.name !== 'services') {
      // Nav links live in the mobile menu.
      const target = prep
      prep = async (page) => {
        await page.locator('button', { hasText: 'Menu' }).first().click()
        await target(page)
      }
    }
    const ours = await shoot(browser, vp, SITE + p.site)
    const ref = await shoot(browser, vp, proto, prep)
    fs.writeFileSync(path.join(OUT, `${vpName}-${p.name}-site.png`), PNG.sync.write(ours))
    fs.writeFileSync(path.join(OUT, `${vpName}-${p.name}-proto.png`), PNG.sync.write(ref))
    const r = diff(ours, ref, `${vpName}-${p.name}-diff.png`)
    const row = { page: `${vpName}/${p.name}`, vsPrototype: r.pct.toFixed(2) + '%', size: r.size }
    const kitFile = p.kit?.[vpName]
    if (withKit && kitFile) {
      const kitPng = PNG.sync.read(fs.readFileSync(path.join(KIT, 'screenshots', kitFile)))
      row.vsKitPng = diff(ours, kitPng, `${vpName}-${p.name}-kitdiff.png`).pct.toFixed(2) + '%'
    }
    rows.push(row)
  }
}

// Contact modal (desktop, viewport only).
{
  const vp = viewports.desktop
  const open = async (page) => {
    await page.locator('button', { hasText: 'Start a project' }).first().click()
  }
  const ours = await shoot(browser, vp, SITE + '/', open)
  const ref = await shoot(browser, vp, proto, open)
  const r = diff(ours, ref, 'desktop-modal-diff.png')
  rows.push({ page: 'desktop/modal', vsPrototype: r.pct.toFixed(2) + '%', size: r.size })
}

await browser.close()
console.table(rows)
