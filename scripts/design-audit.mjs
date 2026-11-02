// The design standard's automated checks (gully-protocol/design/DESIGN-STANDARD.md): overflow, text overlap, AA contrast
// and tap targets, with a first-screen and a full-page shot, at 390, 768, 1024, 1440 and 1920 px.
//   node scripts/design-audit.mjs <out dir> [--dist dist]
// With --dist the built site is served on the real hostnames from that folder while /api/* goes to the live site, so the
// pages read real data before anything is deployed; without it the live sites themselves are checked.
// Env: TARGETS='[["hub","https://gullylabs.xyz/"],...]', WIDTHS='[390,...]'. Exit 1 on overflow or a page error.
import fs from 'node:fs'
import path from 'node:path'
import { chromium, request } from 'playwright'

const out = process.argv[2]
const di = process.argv.indexOf('--dist')
const dist = di > 0 ? process.argv[di + 1] : null
fs.mkdirSync(out, { recursive: true })
const TARGETS = JSON.parse(process.env.TARGETS || '[["hub","https://gullylabs.xyz/"],["products","https://gullylabs.xyz/products"],["hm","https://holdermaps.xyz/"],["hm-token","https://holdermaps.xyz/robinhood/AAPL"],["hm-gully","https://holdermaps.xyz/gully/0xf0fd2800d4d6201857c674369411a7536e633008"]]')
const WIDTHS = JSON.parse(process.env.WIDTHS || '[390,768,1024,1440,1920]')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }

// The kept hero map, read once before any page opens (a first read can take a minute, longer than a page stays open).
let heroStandIn = JSON.stringify({ state: 'reading' })
async function prepareStandIn() {
  const api = await request.newContext()
  for (let i = 0; i < 4; i++) {
    const map = await api.get('https://holdermaps.xyz/api/holders/robinhood/AAPL?peek=1', { timeout: 120_000 }).then((r) => r.json()).catch(() => null)
    if (map?.state === 'ok') {
      heroStandIn = JSON.stringify({ ...map, pick: { chain: 'robinhood', token: 'AAPL' } })
      break
    }
  }
  await api.dispose()
}

async function serveDist(ctx) {
  const index = fs.readFileSync(path.join(dist, 'index.html'))
  await ctx.route(/^https:\/\/(gullylabs\.xyz|holdermaps\.xyz)\//, async (route) => {
    const u = new URL(route.request().url())
    // A build tested before its deploy: the hero's kept map may not be live yet, so stand in the real map it would keep.
    if (u.pathname === '/api/holders/hero') {
      const live = await route.fetch().catch(() => null)
      if (live?.ok()) return route.fulfill({ response: live })
      return route.fulfill({ status: 200, contentType: 'application/json', body: heroStandIn })
    }
    // Reading a map from a test must never count as somebody opening it.
    if (/^\/api\/holders\/[^/]+\/[^/]+$/.test(u.pathname) && !u.searchParams.has('peek')) {
      u.searchParams.set('peek', '1')
      return route.continue({ url: u.href })
    }
    if (u.pathname.startsWith('/api/')) return route.continue()
    const f = path.join(dist, decodeURIComponent(u.pathname))
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] ?? 'application/octet-stream', body: fs.readFileSync(f) })
    if (path.extname(u.pathname)) return route.continue()
    return route.fulfill({ status: 200, contentType: 'text/html', body: index })
  })
}

// Runs in the page: what the standard forbids.
const inspect = () => {
  const de = document.documentElement
  const vw = de.clientWidth
  const shown = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none') return false
    for (let a = el; a; a = a.parentElement) if (+getComputedStyle(a).opacity === 0) return false
    return r.width > 1 && !(s.position === 'absolute' && s.clip !== 'auto' && r.width <= 1)
  }
  const srOnly = (el) => {
    for (let a = el; a; a = a.parentElement) {
      const r = a.getBoundingClientRect()
      if (r.width <= 1 || r.height <= 1 || a.classList?.contains('sr-only') || a.classList?.contains('hm-sr')) return true
    }
    return false
  }
  const clipped = (el) => {
    for (let a = el.parentElement; a; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return true
    return false
  }
  const name = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/)[0]}` : ''}`
  const over = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed' && !clipped(el)) over.push(name(el))
  }
  // Text: leaf elements with their own words.
  const texts = []
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('svg,canvas,[aria-hidden="true"],script,style,noscript')) continue
    const shut = el.closest('details:not([open])')
    if (shut && !el.closest('summary')) continue
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim())
    if (!own.length || !shown(el) || srOnly(el)) continue
    const range = document.createRange()
    range.selectNodeContents(own[0])
    let r = range.getBoundingClientRect()
    // Text clipped by its own box (an ellipsis) only takes the box's room on screen.
    if (getComputedStyle(el).overflow !== 'visible') {
      const b = el.getBoundingClientRect()
      r = { left: Math.max(r.left, b.left), right: Math.min(r.right, b.right), top: Math.max(r.top, b.top), bottom: Math.min(r.bottom, b.bottom), width: r.width, height: r.height }
    }
    if (r.width && r.height) texts.push({ el, r, t: own[0].textContent.trim().slice(0, 28), fixed: !!el.closest('[class*="fixed"],.cst-drawer') })
  }
  const overlap = []
  for (let i = 0; i < texts.length && overlap.length < 12; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i]
      const b = texts[j]
      if (a.fixed || b.fixed || a.el.contains(b.el) || b.el.contains(a.el)) continue
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left)
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top)
      if (w > 3 && h > 3) overlap.push(`${a.t} / ${b.t}`)
    }
  }
  // Contrast: the text colour against the first solid background behind it.
  const rgb = (c) => {
    const m = c.match(/[\d.]+/g)?.map(Number)
    return m && { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }
  }
  const lum = ({ r, g, b }) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const low = new Map()
  for (const { el, t } of texts) {
    const s = getComputedStyle(el)
    const fg = rgb(s.color)
    if (!fg || fg.a < 0.1 || s.webkitTextFillColor === 'transparent' || el.closest('[disabled],[aria-disabled="true"]')) continue
    let bg = null
    for (let a = el; a; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if (cs.backgroundImage !== 'none') break
      const c = rgb(cs.backgroundColor)
      if (c && c.a > 0.9) {
        bg = c
        break
      }
    }
    if (!bg) bg = { r: 0, g: 0, b: 0 }
    if (el.closest('[style*="gradient"]')) continue
    const hi = Math.max(lum(fg), lum(bg))
    const lo = Math.min(lum(fg), lum(bg))
    const ratio = (hi + 0.05) / (lo + 0.05)
    const size = parseFloat(s.fontSize)
    const large = size >= 24 || (size >= 18.66 && +s.fontWeight >= 700)
    if (ratio < (large ? 3 : 4.5)) low.set(`${t} ${ratio.toFixed(2)}`, 1)
  }
  const small = []
  if (vw < 1024)
    for (const el of document.querySelectorAll('a[href],button,input,select,summary,[role="button"],[role="tab"]')) {
      if (!shown(el) || srOnly(el) || el.closest('.sr-only,.hm-sr,svg')) continue
      const closed = el.closest('details:not([open])')
      if (closed && !el.closest('summary')) continue
      const r = el.getBoundingClientRect()
      const inline = getComputedStyle(el).display === 'inline'
      if (!inline && r.height < 43.5) small.push(`${(el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 22)} ${Math.round(r.width)}x${Math.round(r.height)}`)
    }
  const firstInput = document.querySelector('main input, input')?.getBoundingClientRect()
  const mapBox = document.querySelector('[data-map-stage]')?.getBoundingClientRect()
  return { scrollW: de.scrollWidth, vw, height: de.scrollHeight, overflow: [...new Set(over)].slice(0, 8), overlap: [...new Set(overlap)], lowContrast: [...low.keys()].slice(0, 14), smallTargets: small.slice(0, 16), title: document.title, h1: document.querySelector('h1')?.innerText?.replace(/\s+/g, ' ').slice(0, 80), inputY: firstInput ? Math.round(firstInput.y + scrollY) : null, mapY: mapBox ? Math.round(mapBox.y + scrollY) : null }
}

if (dist) await prepareStandIn()
const browser = await chromium.launch()
const report = []
let bad = 0
for (const [name, url] of TARGETS) {
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : w < 1100 ? 1024 : 900 }, deviceScaleFactor: w < 500 ? 2 : 1, ...(dist ? { serviceWorkers: 'block' } : {}) })
    if (dist) await serveDist(ctx)
    // Reading a map from a test must never count as somebody opening it, on the live sites either.
    else
      await ctx.route(/\/api\/holders\/[^/?]+\/[^/?]+(\?|$)/, (route) => {
        const u = new URL(route.request().url())
        u.searchParams.set('peek', '1')
        return route.continue({ url: u.href })
      })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch((e) => errors.push(`goto ${e.message.slice(0, 100)}`))
    await page.waitForTimeout(7000)
    const f1 = await page.screenshot({ path: `${out}/${name}-${w}-fold.png` }).catch(() => null)
    await page.waitForTimeout(1500)
    const f2 = await page.screenshot().catch(() => null)
    const moves = !!(f1 && f2 && !f1.equals(f2))
    // walk down the page so everything that waits to be on screen runs, then shoot it whole
    const h = await page.evaluate(() => document.documentElement.scrollHeight)
    for (let y = 0; y < h; y += 700) {
      await page.evaluate((v) => window.scrollTo(0, v), y)
      await page.waitForTimeout(220)
    }
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(1200)
    const m = await page.evaluate(inspect)
    await page.screenshot({ path: `${out}/${name}-${w}.png`, fullPage: true }).catch(() => {})
    const row = { name, w, errors, moves, ...m }
    report.push(row)
    if (m.scrollW > m.vw || m.overflow.length || errors.length) bad++
    console.log(`${name} ${w}: h ${m.height}${m.mapY != null ? ` map@${m.mapY}` : ''}${m.inputY != null ? ` input@${m.inputY}` : ''} | overflow ${m.overflow.length} | overlap ${m.overlap.length} | contrast ${m.lowContrast.length} | small ${m.smallTargets.length} | moves ${moves} | errors ${errors.length}`)
    await ctx.close()
  }
}
await browser.close()
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1))
console.log(bad ? `FAILED: ${bad} page(s) with overflow or errors` : 'no overflow, no page errors')
process.exit(bad ? 1 : 0)
