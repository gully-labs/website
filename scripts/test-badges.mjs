// The badge system's visual and geometry check (server/badges.mjs).
//
//   npm run test:badges          [--out <dir>]  (no build, no server)
//
// For every kind x size x theme x tone it asserts: the SVG is well formed; there is no <text> (paths only) and no
// font reference; every box (svg, rects, mark, value segment) sits on whole pixels; the height is 20/28/36; every
// colour is a kit token or one of the wordmark's own gradient stops; the width is exactly what the glyph advances
// add up to (recomputed here from the glyph table, not from the renderer); the ink of each text run stays inside
// its box; and the edge between the label and the value segment is crisp in a 1x raster (no blended pixels).
// It also drives the Holder Map badge route with and without holderBadgeData, and the "Built by" route.
// With --out (default: BADGE_PROOF_DIR or the temp folder) it renders every badge to PNG at 1:1 and 2:1 with
// Playwright (Chromium, the SVGs as <img> on a grid), to compare with the kit by eye.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { makeChecker } from './test-helpers.mjs'
import GLYPHS from '../server/badge-glyphs.mjs'
import { badgeMetrics, holderMapFace, KINDS, renderBadge, renderBadgePng, SIZES, THEMES, TOKENS } from '../server/badges.mjs'
import { handleBadgeRoutes } from '../server/badge-routes.mjs'
import { KIT } from '../server/brand.mjs'

const t = makeChecker()
const { check } = t
const outIdx = process.argv.indexOf('--out')
const OUT = outIdx > 0 ? process.argv[outIdx + 1] : process.env.BADGE_PROOF_DIR || path.join(os.tmpdir(), 'badge-proof')
fs.mkdirSync(OUT, { recursive: true })

const KIT_COLOURS = new Set(
  [
    ...Object.values(TOKENS),
    KIT.wordmark.fill.dark,
    KIT.wordmark.fill.light,
    ...['dark', 'light'].flatMap((v) => [...KIT.wordmark.labsGradient[v], ...KIT.wordmark.barGradient[v]].map((s) => s[1])),
  ].map((c) => c.toUpperCase()),
)
const tokensJson = JSON.parse(fs.readFileSync(new URL('../public/brand/tokens/tokens.json', import.meta.url), 'utf8'))
check('TOKENS are the kit tokens (public/brand/tokens/tokens.json)', Object.values(TOKENS).every((c) => Object.values(tokensJson.color).map((x) => x.toUpperCase()).includes(c)))

/* The spec, restated here: geometry per size. */
const SPEC = {
  S: { h: 20, pad: 5, markW: 15, markH: 14, gap: 5, label: 12, value: 10, seg: 6, wm: 11 },
  M: { h: 28, pad: 6, markW: 21, markH: 20, gap: 6, label: 16, value: 12, seg: 8, wm: 16 },
  L: { h: 36, pad: 8, markW: 27, markH: 26, gap: 8, label: 20, value: 14, seg: 10, wm: 22 },
}
const adv = (fontKey, text, px, track = 0) => {
  const f = GLYPHS.fonts[fontKey]
  const chars = [...text]
  return chars.reduce((a, ch) => a + ((f.glyphs[ch] ?? f.glyphs['?']).a * px) / f.upm, 0) + track * px * Math.max(0, chars.length - 1)
}

/** Min and max x and y of a path made of M L H V Q Z (absolute). */
function bbox(d) {
  const tk = d.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g)
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  let cmd = ''
  const px = (v) => {
    x0 = Math.min(x0, v)
    x1 = Math.max(x1, v)
  }
  const py = (v) => {
    y0 = Math.min(y0, v)
    y1 = Math.max(y1, v)
  }
  for (let i = 0; i < tk.length; ) {
    if (/[A-Za-z]/.test(tk[i])) cmd = tk[i++]
    else if (cmd === 'M') cmd = 'L'
    if (cmd === 'Z') continue
    if (cmd === 'H') px(+tk[i++])
    else if (cmd === 'V') py(+tk[i++])
    else {
      const n = cmd === 'Q' ? 2 : 1
      for (let k = 0; k < n; k++) {
        px(+tk[i++])
        py(+tk[i++])
      }
    }
  }
  return { x0, x1, y0, y1 }
}
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
const isInt = (v) => v !== undefined && Number.isInteger(Number(v))
const wellFormed = (s) => {
  const st = []
  for (const m of s.matchAll(/<(\/?)([A-Za-z][\w:-]*)([^>]*?)(\/?)>/g)) {
    if (m[4]) continue
    if (m[1]) {
      if (st.pop() !== m[2]) return false
    } else st.push(m[2])
  }
  return st.length === 0
}

const SPECS = [
  { kind: 'score', label: 'Gully Score', value: '82 Strong', tone: 'good' },
  { kind: 'score', label: 'Gully Score', value: '64 Fair', tone: 'brand' },
  { kind: 'score', label: 'Gully Score', value: 'N/A', tone: 'neutral' },
  { kind: 'holders', label: 'Holder Map', value: 'Health 82', tone: 'good' },
  { kind: 'holders', label: 'Holder Map', value: '3 bundles', tone: 'warn' },
  { kind: 'holders', label: 'Holder Map', value: '', tone: 'neutral' },
  { kind: 'security', label: 'Gully Security', value: 'Scanned 12 Oct 2026', tone: 'brand' },
  { kind: 'project', label: 'Built by', value: '', tone: 'brand' },
]
const ALL = []
for (const theme of THEMES) for (const size of SIZES) for (const s of SPECS) ALL.push({ ...s, size, theme })

const bad = { text: [], geo: [], colour: [], width: [], ink: [], xml: [] }
for (const o of ALL) {
  const id = `${o.kind}/${o.tone}/${o.size}/${o.theme}/${o.value || o.label}`
  const svg = renderBadge(o)
  const m = badgeMetrics(o)
  const sp = SPEC[o.size]
  if (!wellFormed(svg)) bad.xml.push(id)
  if (/<text\b|font-family|font-size/.test(svg)) bad.text.push(id)
  // whole-pixel boxes
  const root = svg.match(/<svg [^>]*>/)[0]
  const boxes = [...svg.matchAll(/<(rect|image) [^>]*>/g)].map((x) => x[0]).filter((x) => !x.includes('url(#'))
  const ok =
    isInt(attr(root, 'width')) &&
    isInt(attr(root, 'height')) &&
    Number(attr(root, 'height')) === sp.h &&
    attr(root, 'viewBox') === `0 0 ${attr(root, 'width')} ${attr(root, 'height')}` &&
    boxes.every((b) => ['x', 'y', 'width', 'height'].every((a) => attr(b, a) === undefined || isInt(attr(b, a))))
  const seg = svg.match(/<path d="(M\d+ 1H[^"]*)"/)
  const segInts = !seg || !/\d\.\d/.test(seg[1])
  if (!ok || !segInts) bad.geo.push(id)
  // the bar of the wordmark is a rect with a gradient fill: whole pixels too
  for (const b of svg.matchAll(/<rect [^>]*url\(#[^>]*>/g)) if (!['x', 'y', 'width', 'height'].every((a) => isInt(attr(b[0], a)))) bad.geo.push(id + ' bar')
  // colours
  for (const c of svg.matchAll(/#[0-9A-Fa-f]{6}\b/g)) if (!KIT_COLOURS.has(c[0].toUpperCase())) bad.colour.push(`${id} ${c[0]}`)
  if (/rgba?\(|hsl|opacity/.test(svg)) bad.colour.push(id + ' non-token colour')
  // width from the glyph advances, restated
  const labelW = Math.ceil(adv('display', o.label.toUpperCase(), sp.label, 0.04))
  const hasSeg = o.kind === 'project' || o.value !== ''
  const valueW = o.kind === 'project' ? Math.ceil(KIT.wordmark.width * (sp.wm / KIT.wordmark.height)) : Math.ceil(adv('mono', o.value, sp.value))
  const expected = hasSeg ? sp.pad + sp.markW + sp.gap + labelW + sp.gap + sp.seg + valueW + sp.seg + 1 : sp.pad + sp.markW + sp.gap + labelW + sp.pad + 1
  if (Number(attr(root, 'width')) !== expected || m.width !== expected) bad.width.push(`${id} ${attr(root, 'width')} != ${expected}`)
  // ink inside its box
  const runs = [...svg.matchAll(/<path fill="(#[0-9A-Fa-f]{6})" d="([^"]+)"\/>/g)].filter((p) => !p[2].includes('A'))
  const labelBox = bbox(runs[0][2])
  if (labelBox.x0 < m.labelX - 0.01 || labelBox.x1 > m.labelX + labelW + 0.01 || labelBox.y0 < 1 || labelBox.y1 > sp.h - 1) bad.ink.push(id + ' label')
  if (o.kind !== 'project' && hasSeg) {
    const vb = bbox(runs[1][2])
    if (vb.x0 < m.valueX - 0.01 || vb.x1 > m.valueX + valueW + 0.01 || vb.y0 < 1 || vb.y1 > sp.h - 1) bad.ink.push(id + ' value')
    // the run is as wide as its advances (the last glyph's right bearing aside)
    if (vb.x1 - vb.x0 < adv('mono', o.value, sp.value) - sp.value * 0.35) bad.ink.push(id + ' value narrower than its advances')
  }
}
check(`${ALL.length} badges (${KINDS.length} kinds, ${SIZES.length} sizes, ${THEMES.length} themes) are well-formed XML`, bad.xml.length === 0, bad.xml.slice(0, 3).join('; '))
check('no <text>, font-family or font-size anywhere: letters are paths', bad.text.length === 0, bad.text.slice(0, 3).join('; '))
check('integer geometry: svg size, rects, mark, segment path, wordmark bar; heights 20 / 28 / 36', bad.geo.length === 0, bad.geo.slice(0, 3).join('; '))
check('kit colours only (tokens.json and the wordmark gradients), no rgba or opacity', bad.colour.length === 0, bad.colour.slice(0, 3).join('; '))
check('width = the glyph advances, recomputed from the glyph table', bad.width.length === 0, bad.width.slice(0, 3).join('; '))
check('each text run stays inside its box, inside the border', bad.ink.length === 0, bad.ink.slice(0, 3).join('; '))
check(
  'every glyph used is outlined (a label or value never falls back to a missing glyph)',
  ALL.every((o) => [...o.label.toUpperCase()].every((ch) => GLYPHS.fonts.display.glyphs[ch]) && [...o.value].every((ch) => GLYPHS.fonts.mono.glyphs[ch])),
)
check('the kit mark is embedded (mark-64 or mark-128 data URI)', renderBadge(ALL[0]).includes('data:image/png;base64,iVBOR'))
const proj = renderBadge({ kind: 'project', label: 'Built by', size: 'M' })
check('project badge carries the kit wordmark paths verbatim', proj.includes(KIT.wordmark.gully) && proj.includes(KIT.wordmark.labs))
check('a link is added only when asked', !renderBadge(ALL[0]).includes('<a ') && renderBadge({ ...ALL[0], href: 'https://gullylabs.xyz/x?a=1&b=2' }).includes('href="https://gullylabs.xyz/x?a=1&amp;b=2"'))
const evil = renderBadge({ kind: 'score', label: '</svg><script>', value: '"><b>', title: '<x>' })
check('markup in a label, value or title is escaped and cannot break out', wellFormed(evil) && !evil.includes('<script') && !evil.includes('<x>'))
check('unknown size, theme and tone fall back to M, dark and brand', badgeMetrics({ size: 'XL', theme: 'x', tone: 'x', kind: 'score', label: 'a', value: 'b' }).height === 28)

/* The raster: the edge between the label field and the value segment is crisp at 1x. */
{
  const { loadResvg } = await import('../server/og.mjs')
  const { Resvg } = await loadResvg()
  let blended = 0
  let checked = 0
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).join()
  for (const theme of THEMES)
    for (const size of SIZES) {
      const o = { kind: 'holders', label: 'Holder Map', value: 'Health 82', tone: 'good', size, theme }
      const m = badgeMetrics(o)
      const r = new Resvg(renderBadge(o), { fitTo: { mode: 'original' }, shapeRendering: 2 })
      const img = r.render()
      const px = (x, y) => [...img.pixels.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)]
      const left = px(m.segX - 1, 2)
      const right = px(m.segX, 2)
      const top = px(Math.floor(m.width / 2), 0)
      checked += 3
      if (left.slice(0, 3).join() !== hex(theme === 'dark' ? TOKENS.labNight : TOKENS.bone) || left[3] !== 255) blended++
      if (right.slice(0, 3).join() !== hex(TOKENS.frogGreen) || right[3] !== 255) blended++
      if (top.slice(0, 3).join() !== hex(TOKENS.slate) || top[3] !== 255) blended++
      img.free()
      r.free()
    }
  check('1x raster: the label/value edge and the 1 px border are whole, unblended pixels', blended === 0, `${blended} of ${checked}`)
}

/* The Holder Map badge face and routes. */
// The partners branch calls renderBadge({ kind: 'holder-map', ...holderBadgeData, href }); fixtures shaped like its data.
const OK = (health, bundledWallets) => ({ state: 'ok', chain: 'base', token: '0x8d901a1b3f3a57f9c36a71382fa183476c41545b', page: '/holders/base/x', symbol: 'TKN', health: health === null ? null : { score: health, level: 'good' }, flags: bundledWallets === null ? null : { bundledWallets, snipers: 0, signals: [] } })
check(
  'holder-map face: health, bundles (warn), singular, neutral without data or when unknown',
  holderMapFace(OK(82, 0)).value === 'Health 82' &&
    holderMapFace(OK(82, 3)).value === '3 bundles' &&
    holderMapFace(OK(82, 3)).tone === 'warn' &&
    holderMapFace(OK(null, 1)).value === '1 bundle' &&
    holderMapFace(OK(30, 0)).tone === 'warn' &&
    holderMapFace(OK(82, 0)).tone === 'good' &&
    holderMapFace(OK(null, null)).value === '' &&
    holderMapFace({ state: 'unknown' }).value === '' &&
    holderMapFace(null).tone === 'neutral',
)
{
  const href = 'https://gullylabs.xyz/holders/base/x'
  const health = renderBadge({ kind: 'holder-map', ...OK(82, 0), href, size: 'L', theme: 'light' })
  const bundles = renderBadge({ kind: 'holder-map', ...OK(82, 3), href })
  const unknown = renderBadge({ kind: 'holder-map', state: 'unknown', href })
  check('renderBadge({ kind: "holder-map", ...holderBadgeData }): "Holder Map | Health 82", "3 bundles" in the warning field, neutral pill when unknown', health.includes('<title>Holder Map: Health 82</title>') && health.includes('height="36"') && bundles.includes('<title>Holder Map: 3 bundles</title>') && bundles.includes(`fill="${TOKENS.labGold}"`) && unknown.includes('<title>Holder Map</title>') && !/<text/.test(health + bundles + unknown) && health.includes(`href="${href}"`) && wellFormed(health) && wellFormed(unknown))
  check('the neutral pill is the narrowest (no value field)', badgeMetrics({ kind: 'holder-map', state: 'unknown' }).width < badgeMetrics({ kind: 'holder-map', ...OK(82, 0) }).width)
}
const call = async (urlPath, method = 'GET') => {
  const out = { status: 0, headers: {}, body: '' }
  const res = {
    writeHead: (s, h) => {
      out.status = s
      out.headers = h ?? {}
      return res
    },
    end: (b) => {
      out.body = b ?? ''
      return res
    },
  }
  const handled = await handleBadgeRoutes({ method }, res, new URL(urlPath, 'https://gullylabs.xyz'))
  return { handled, ...out }
}
const built = await call('/badges/built-by-gully-labs.svg?theme=light&size=S')
check('Built by Gully Labs: served, S and light honoured, links to the site', built.status === 200 && built.body.includes('height="20"') && built.body.includes('#F4F2EC') && built.body.includes('href="https://gullylabs.xyz"') && built.body.includes('<title>Built by Gully Labs</title>'))
check('an unrelated path is not answered', (await call('/badges/nope.svg')).handled === false)

/* Proof PNGs: every badge at 1:1 and 2:1 in Chromium, on a grid, to compare with the kit by eye. */
{
  const browser = await chromium.launch()
  const wrote = []
  for (const theme of THEMES) {
    const rows = ALL.filter((o) => o.theme === theme && o.value !== '' || (o.theme === theme && o.kind === 'project'))
    const bg = theme === 'dark' ? '#0B1118' : '#ECEAE3'
    const cells = rows.map((o) => `<div class="c"><img alt="" src="data:image/svg+xml;base64,${Buffer.from(renderBadge(o)).toString('base64')}"><span>${o.kind} ${o.tone} ${o.size}</span></div>`).join('')
    const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:16px;background:${bg};font:11px/1 monospace;color:#7D8794}.g{display:grid;grid-template-columns:repeat(3,max-content);gap:16px 32px;align-items:start}.c{display:flex;flex-direction:column;gap:6px}img{display:block}</style><div class="g">${cells}</div>`
    for (const dpr of [1, 2]) {
      const ctx = await browser.newContext({ deviceScaleFactor: dpr, viewport: { width: 1500, height: 1400 } })
      const page = await ctx.newPage()
      await page.setContent(html)
      await page.waitForLoadState('networkidle')
      const file = path.join(OUT, `badges-${theme}-${dpr}x.png`)
      await page.locator('.g').screenshot({ path: file })
      wrote.push(file)
      await ctx.close()
    }
  }
  await browser.close()
  // plus the resvg renders of one badge of each kind, 1x and 2x (what the PNG renderer serves)
  for (const o of [SPECS[0], SPECS[3], SPECS[4], SPECS[6], SPECS[7]])
    for (const sc of [1, 2]) {
      const f = path.join(OUT, `resvg-${o.kind}-${o.tone}-M-dark-${sc}x.png`)
      fs.writeFileSync(f, await renderBadgePng({ ...o, size: 'M', theme: 'dark' }, sc))
      wrote.push(f)
    }
  const sig = (f) => fs.readFileSync(f).subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  check('proof PNGs written (Chromium and resvg, 1x and 2x)', wrote.every(sig), `${wrote.length} files in ${OUT}`)
  for (const f of wrote) console.log('  ' + f.replace(/\\/g, '/'))
  const a = fs.readFileSync(path.join(OUT, 'resvg-score-good-M-dark-1x.png'))
  const b = fs.readFileSync(path.join(OUT, 'resvg-score-good-M-dark-2x.png'))
  check('resvg 2x is twice the size of 1x', b.readUInt32BE(16) === a.readUInt32BE(16) * 2 && b.readUInt32BE(20) === a.readUInt32BE(20) * 2)
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
process.exit(t.failed ? 1 : 0)
