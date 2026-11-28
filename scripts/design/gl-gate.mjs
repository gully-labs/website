#!/usr/bin/env node
// Gully Labs design gate (owner, 2026-11-26: one design standard, pixel perfect). Two checks on real pages in Chromium:
//   layout: no sideways scroll, no blank region of 288x288 px or more inside the content column, no clipped text,
//           no tap target under 44 px on phones, no console error, no failed request to our own hosts.
//   pixel:  the first screen of each page, data masked (live numbers, charts, times), against the approved reference in
//           design/reference/<screen>-<width>-<theme>.png; more than 8 % of pixels different fails.
// Usage: node scripts/design/gl-gate.mjs --base https://gullylabs.xyz [--out dir] [--pixel] [--update-ref] [--audit]
//        [--routes /,/projects] [--widths 390,768,1440,1920] [--themes dark,light] [--ref design/reference]
// --audit writes full-page screenshots too and never fails (exit 0); without it any finding exits 1.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1] }
const flag = (k) => process.argv.includes(`--${k}`)
const BASE = arg('base', 'https://gullylabs.xyz').replace(/\/$/, '')
const OUT = arg('out', 'design-gate-out')
const REF = arg('ref', path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', '..', 'design', 'reference'))
const AUDIT = flag('audit')
const PIXEL = flag('pixel') || flag('update-ref')
const UPDATE = flag('update-ref')
const LIMIT = Number(arg('limit', '8'))
/** --ignore-net: network-level failures (a filtered laptop network) are not page findings. The box run never sets it. */
const IGNORE_NET = flag('ignore-net')
/** Screens that fail the deploy. The rest are measured and printed (REPORT lines) until their redesign round brings
 *  them to zero; a screen joins BLOCKING after two clean runs (same rule as kre8's gate 3). 2026-11-27: downloads,
 *  explain and ai-tools joined (clean on the live round-3 deploy gate and the round-4 candidate). */
/** The gated screens: every page of the site that is drawn on the server or is a public read view. `key` names the file. */
export const SCREENS = [
  { key: 'home', path: '/' },
  { key: 'projects', path: '/projects' },
  { key: 'services', path: '/services' },
  { key: 'about', path: '/about' },
  { key: 'tracker', path: '/tracker' },
  { key: 'pricing', path: '/pricing' },
  { key: 'status', path: '/status' },
  { key: 'gully-id', path: '/gully-id' },
  { key: 'ecosystem', path: '/ecosystem' },
  { key: 'holders', path: '/holders' },
  { key: 'ask', path: '/ask' },
  { key: 'terms', path: '/terms' },
  { key: 'downloads', path: '/downloads' },
  { key: 'explain', path: '/explain' },
  { key: 'ai-tools', path: '/ai-tools' },
]
/** --home /preview/landing: where the home page lives on a local server (the root path needs the built SPA there). */
const HOME = arg('home', '/')
const pick = arg('routes', '')
// Every screen blocks (design round 5, 2026-11-27): pixel < 8 % vs design/reference and the layout rules. --blocking a,b narrows it.
const BLOCKING = new Set(arg('blocking', SCREENS.map((s) => s.key).join(',')).split(','))
const screens = pick ? SCREENS.filter((s) => pick.split(',').includes(s.path) || pick.split(',').includes(s.key)) : SCREENS
const widths = arg('widths', '390,768,1440,1920').split(',').map(Number)
const themes = arg('themes', 'dark,light').split(',')
const OWN = /(^|\.)gullylabs\.xyz$|^127\.0\.0\.1$|^localhost$/
/** Live figures, charts and clocks change every minute: hidden (layout kept) before the pixel shot. [data-live] = the
 *  ECharts frames of the React pages, tracker-kpis = the tracker figures, tbody td = live table rows. */
const MASK = '[data-live],[data-live-area],[data-testid=tracker-kpis] *,tbody td,[data-b],[data-tk],[data-u],[data-sv-word],[data-sv-ms],[data-mask],.g,.cells,.cmap,.orbit,.spark,time,.toast,#toasts,.kpis b,.st,canvas,iframe,video{visibility:hidden!important}*,*:before,*:after{animation:none!important;transition:none!important;caret-color:transparent!important}'

fs.mkdirSync(OUT, { recursive: true })
const findings = []
const pixels = []
const browser = await chromium.launch()
for (const theme of themes) {
  for (const width of widths) {
    const ctx = await browser.newContext({ viewport: { width, height: width <= 430 ? 844 : 900 }, colorScheme: theme, deviceScaleFactor: 1, reducedMotion: 'reduce', isMobile: width <= 430, hasTouch: width <= 430 })
    for (const s of screens) {
      const page = await ctx.newPage()
      const errs = []
      page.on('console', (m) => { if (m.type() === 'error' && !(IGNORE_NET && /net::ERR_/.test(m.text()))) errs.push(m.text().slice(0, 200)) })
      page.on('response', (r) => { try { const u = new URL(r.url()); if (OWN.test(u.hostname) && r.status() >= 400 && !u.pathname.startsWith('/api/auth')) errs.push(`${r.status()} ${u.pathname}`) } catch {} })
      const at = `${s.key} ${width} ${theme}`
      try {
        await page.goto(BASE + (s.path === '/' ? HOME : s.path), { waitUntil: 'load', timeout: 45_000 })
        await page.waitForTimeout(2500)
        const r = await page.evaluate(checkLayout, { phone: width <= 430 })
        for (const f of r) findings.push({ at, ...f })
        for (const e of errs) findings.push({ at, rule: 'console', note: e })
        if (AUDIT) await page.screenshot({ path: path.join(OUT, `${s.key}-${width}-${theme}-full.png`), fullPage: true, clip: undefined, timeout: 30_000 }).catch(() => {})
        if (PIXEL) {
          await page.addStyleTag({ content: MASK })
          await page.evaluate(() => window.scrollTo(0, 0))
          await page.waitForTimeout(300)
          const buf = await page.screenshot({ fullPage: false })
          const file = `${s.key}-${width}-${theme}.png`
          fs.writeFileSync(path.join(OUT, file), buf)
          if (UPDATE) { fs.mkdirSync(REF, { recursive: true }); fs.writeFileSync(path.join(REF, file), buf) }
          else if (fs.existsSync(path.join(REF, file))) {
            const a = PNG.sync.read(fs.readFileSync(path.join(REF, file)))
            const b = PNG.sync.read(buf)
            if (a.width !== b.width || a.height !== b.height) { pixels.push({ at, pct: 100 }); findings.push({ at, rule: 'pixel', note: 'size differs from reference' }) }
            else {
              const diff = new PNG({ width: a.width, height: a.height })
              const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 })
              const pct = Math.round((n / (a.width * a.height)) * 10000) / 100
              pixels.push({ at, pct })
              if (pct > LIMIT) { findings.push({ at, rule: 'pixel', note: `${pct}% of the first screen differs from the reference (limit ${LIMIT}%)` }); fs.writeFileSync(path.join(OUT, `${s.key}-${width}-${theme}-diff.png`), PNG.sync.write(diff)) }
            }
          } else pixels.push({ at, pct: null, note: 'no reference' })
        }
      } catch (e) { findings.push({ at, rule: 'load', note: String(e.message ?? e).slice(0, 200) }) }
      await page.close()
    }
    await ctx.close()
  }
}
await browser.close()
fs.writeFileSync(path.join(OUT, 'findings.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), findings, pixels }, null, 2))
const blocking = findings.filter((f) => BLOCKING.has(f.at.split(' ')[0]))
for (const f of findings) console.log(`${BLOCKING.has(f.at.split(' ')[0]) ? 'FAIL' : 'REPORT'} ${f.at}: ${f.rule}: ${f.note}`)
for (const p of pixels) console.log(`PIXEL ${p.at}: ${p.pct == null ? p.note : `${p.pct}%`}`)
console.log(`${blocking.length ? 'GATE FAIL' : 'GATE PASS'}: ${screens.length} screens x ${widths.length} widths x ${themes.length} themes, ${blocking.length} blocking findings, ${findings.length - blocking.length} report-only`)
process.exit(blocking.length && !AUDIT ? 1 : 0)

/** Runs in the page. Returns [{ rule, note }]. */
function checkLayout({ phone }) {
  const out = []
  const W = innerWidth
  const de = document.scrollingElement || document.documentElement
  if (de.scrollWidth > W + 1) out.push({ rule: 'sideways', note: `page is ${de.scrollWidth}px wide at ${W}px` })
  // Screen-reader-only boxes (1 px, clipped) are meant to be invisible: never a finding.
  const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); if (el.closest('.sr-only,.visually-hidden') || (cs.clip && cs.clip !== 'auto') || cs.clipPath.startsWith('inset(50%')) return false; return cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 2 && r.height > 2 }
  // Tap targets on phones: links and buttons that stand alone (not words inside a sentence).
  if (phone) {
    let small = []
    for (const el of document.querySelectorAll('a[href],button,[role=tab],input:not([type=hidden]),select')) {
      if (!vis(el)) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'inline' && el.closest('p,li p,td,figcaption,.prose,article')) continue
      const r = el.getBoundingClientRect()
      if (r.height < 43.5 || r.width < 24) small.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`)
    }
    if (small.length) out.push({ rule: 'tap', note: `${small.length} targets under 44 px: ${small.slice(0, 4).join('; ')}` })
  }
  // Clipped text: a box that cuts its own words with no ellipsis.
  const clipped = []
  for (const el of document.querySelectorAll('h1,h2,h3,p,b,span,a,button,li,small,td,th')) {
    if (!vis(el) || !el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue
    const cs = getComputedStyle(el)
    if (cs.overflowX === 'visible' || cs.textOverflow === 'ellipsis') continue
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) clipped.push(`${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 30)}"`)
  }
  if (clipped.length) out.push({ rule: 'clipped', note: `${clipped.length} cut text boxes: ${clipped.slice(0, 3).join('; ')}` })
  // Blank regions inside the content column: sample the page every 32 px; a point is blank when it lands on a plain
  // layout box (no own words, no media, no border, no fill). 9 x 9 blank cells (288 px) in one rectangle fails.
  const inner = [...document.querySelectorAll('main .w, main .gt-wrap, main .hm-wrap')]
  // The content column: the page's own .w / .gt-wrap boxes; on pages without one (the React pages), the span of every
  // box in <main> that carries words, so a centred column's side gutters are not counted as blank regions.
  let cols = (inner.length ? inner : []).map((e) => e.getBoundingClientRect()).filter((r) => r.width > 200)
  if (!cols.length) {
    const words = [...document.querySelectorAll('main *')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && vis(e)).map((e) => e.getBoundingClientRect())
    cols = words.length ? [{ left: Math.min(...words.map((r) => r.left)), right: Math.max(...words.map((r) => r.right)) }] : [...document.querySelectorAll('main')].map((e) => e.getBoundingClientRect())
  }
  const left = Math.max(0, Math.min(...cols.map((r) => r.left), W))
  const right = Math.min(W, Math.max(...cols.map((r) => r.right), 0))
  // Only <main> is judged: the header and footer have their own layouts and gutters.
  const mainEl = document.querySelector('main')
  const mainTop = mainEl ? Math.max(0, mainEl.getBoundingClientRect().top + de.scrollTop) : 0
  const H = Math.min(mainEl ? mainTop + mainEl.getBoundingClientRect().height : de.scrollHeight, 9000)
  const STEP = 32
  const nx = Math.floor((right - left) / STEP)
  const plain = (el) => {
    if (!el) return true
    for (let e = el, d = 0; e && d < 3; e = e.parentElement, d++) {
      const t = e.tagName
      if (/^(IMG|SVG|CANVAS|VIDEO|PICTURE|INPUT|BUTTON|SELECT|TEXTAREA|IFRAME|path|rect|circle|text|g)$/i.test(t)) return false
      // A chart that is still loading (ChartSkeleton, with its "Loading the chart…" words) holds its box: not blank space.
      if (e.hasAttribute && e.hasAttribute('data-gl-skeleton')) return false
      const cs = getComputedStyle(e)
      if (d === 0 && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return false
      if (parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0) return false
      if (cs.backgroundImage !== 'none') return false
      if (d === 0 && /^(HTML|BODY|MAIN|SECTION|DIV|ARTICLE|HEADER|FOOTER|NAV|UL|OL)$/.test(t) === false) return false
    }
    return true
  }
  const grid = []
  const y0 = Math.floor(mainTop / STEP) * STEP
  for (let y = y0; y < H; y += STEP) {
    window.scrollTo(0, Math.max(0, y - innerHeight / 2))
    const sy = y - de.scrollTop
    const row = []
    for (let i = 0; i < nx; i++) row.push(plain(document.elementFromPoint(left + i * STEP + STEP / 2, sy + STEP / 2)) ? 1 : 0)
    grid.push(row)
  }
  window.scrollTo(0, 0)
  // Largest all-blank rectangle (histogram method), ignoring the footer's last rows.
  const hgt = new Array(nx).fill(0)
  let best = { a: 0 }
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < nx; c++) hgt[c] = grid[r][c] ? hgt[c] + 1 : 0
    const st = []
    for (let c = 0; c <= nx; c++) {
      const h = c < nx ? hgt[c] : 0
      let start = c
      while (st.length && st[st.length - 1][1] >= h) { const [i, hh] = st.pop(); const w = c - i; if (w >= 9 && hh >= 9 && w * hh > best.a) best = { a: w * hh, x: left + i * STEP, y: y0 + (r - hh + 1) * STEP, w: w * STEP, h: hh * STEP }; start = i }
      st.push([start, h])
    }
  }
  if (best.a) out.push({ rule: 'blank', note: `blank ${best.w}x${best.h} at ${Math.round(best.x)},${best.y}` })
  return out
}
