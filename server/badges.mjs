// The one badge system: "kit mark | label | value", for every embeddable Gully Labs badge.
//
//   renderBadge({ kind, label, value, tone, size, theme, href, title }) -> SVG string
//   badgeMetrics(opts)                                                 -> { width, height, ... } (what the SVG is built from)
//   renderBadgePng(opts, scale = 1 | 2)                                -> Promise<Buffer> (resvg, the OG cards' renderer)
//
// kind   'score' | 'holders' | 'security' | 'project'   styles nothing by itself; 'project' puts the kit wordmark
//                                                        (its own outlined paths, server/brand.mjs) in the value slot
// size   'S' (20 px tall) | 'M' (28) | 'L' (36)
// theme  'dark' | 'light'
// tone   'brand' (gold on midnight) | 'neutral' | 'good' (frog green) | 'warn' (a solid alert-red field with lab-night ink:
//        the site's error red, the kit's warning colour since 2026-10-19)
//
// What makes it pixel-exact:
//  - Every letter is a path. scripts/gen-badge-glyphs.py outlines the kit typefaces (Barlow Condensed 700 for the
//    label, JetBrains Mono 500 for the value) into server/badge-glyphs.mjs, so the SVG has no <text> and needs no
//    font on the viewer's machine. The width of a run is the sum of its glyph advances (plus fixed tracking).
//  - The mark is the Gully Labs kit icon (brand-kit icon/favicon-48.png and app-icon-180.png, embedded as data URIs).
//  - Every box (badge, mark, divider, segment, bar) sits on whole pixels at 1x. Edges are filled shapes, never
//    half-pixel strokes: the 1 px border is an outer rounded rect under an inner one. Text baselines are whole pixels.
//  - Colours are the kit tokens (public/brand/tokens/tokens.json) and the wordmark's own gradients, nothing else.
//
// Kerning pairs are not applied (the runs are short, upper-case labels and mono values; mono has none).

import GLYPHS from './badge-glyphs.mjs'
import { KIT } from './brand.mjs'

/** The badge palette: the 2026 Gully Labs kit (bg #06050D, surface #0B0A16, cyan #00D2FF, blue #248BFF, muted #A3A8C3), keyed by the old
    token names so the themes below are unchanged; green and red stay as the good / warning status tones. */
export const TOKENS = {
  labNight: '#06050D',
  midnight: '#0B0A16',
  slate: '#1A1830',
  bone: '#FFFFFF',
  labGold: '#00D2FF',
  paleGold: '#248BFF',
  frogGreen: '#2F6B35',
  moss: '#3C553B',
  textMuted: '#A3A8C3',
  textDim: '#7D8794',
  // The site's error red (src/index.css --color-error), added to the badge kit by the owner on 2026-10-19 as the warning tone.
  alertRed: '#FF8A7A',
}

export const SIZES = ['S', 'M', 'L']
export const THEMES = ['dark', 'light']
export const TONES = ['brand', 'neutral', 'good', 'warn']
export const KINDS = ['score', 'holders', 'security', 'project']

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * What the Holder Map badge says, from holderBadgeData (holders-partners.mjs):
 * { state: 'ok', health: { score, level } | null, flags: { bundledWallets, ... } | null } or { state: 'unknown' }.
 * Bundled wallets say "N bundles" in the warning tone, else "Health N"; nothing known is the neutral pill (value '').
 */
export function holderMapFace(data) {
  if (!data || typeof data !== 'object' || data.state === 'unknown') return { value: '', tone: 'neutral' }
  const bundles = num(data.flags?.bundledWallets ?? data.bundles)
  if (bundles !== null && bundles > 0) return { value: `${bundles} ${bundles === 1 ? 'bundle' : 'bundles'}`, tone: 'warn' }
  const score = num(data.health?.score ?? (typeof data.health === 'number' ? data.health : null))
  if (score !== null) {
    const h = Math.max(0, Math.min(100, Math.round(score)))
    return { value: `Health ${h}`, tone: h >= 70 ? 'good' : h >= 40 ? 'brand' : 'warn' }
  }
  return { value: '', tone: 'neutral' }
}

/** Accepts the holders route's call: kind 'holder-map' with the holderBadgeData fields spread in. */
function normalise(opts) {
  if (opts.kind !== 'holder-map' && opts.kind !== 'holders') return opts
  const face = opts.value === undefined ? holderMapFace(opts) : { value: opts.value, tone: opts.tone ?? 'neutral' }
  return { ...opts, kind: 'holders', label: opts.label ?? 'Holder Map', value: face.value, tone: opts.tone ?? face.tone, title: opts.title ?? (face.value ? `Holder Map: ${face.value}` : 'Holder Map') }
}

/** Geometry per size, whole pixels. */
const GEO = {
  S: { h: 20, r: 4, pad: 5, mark: [14, 14], gap: 5, label: 12, value: 10, seg: 6, wm: 11 },
  M: { h: 28, r: 6, pad: 6, mark: [20, 20], gap: 6, label: 16, value: 12, seg: 8, wm: 16 },
  L: { h: 36, r: 6, pad: 8, mark: [26, 26], gap: 8, label: 20, value: 14, seg: 10, wm: 22 },
}
/** Label tracking in em (Barlow Condensed, upper case). */
const LABEL_TRACK = 0.04

const THEME = {
  dark: { bg: TOKENS.labNight, border: TOKENS.slate, ink: TOKENS.bone },
  light: { bg: TOKENS.bone, border: TOKENS.slate, ink: TOKENS.labNight },
}
/** The value segment per theme and tone: { field, ink }. */
const SEGMENT = {
  dark: {
    brand: { field: TOKENS.midnight, ink: TOKENS.labGold },
    neutral: { field: TOKENS.midnight, ink: TOKENS.textMuted },
    good: { field: TOKENS.frogGreen, ink: TOKENS.bone },
    warn: { field: TOKENS.alertRed, ink: TOKENS.labNight },
  },
  light: {
    brand: { field: TOKENS.labNight, ink: TOKENS.labGold },
    neutral: { field: TOKENS.slate, ink: TOKENS.bone },
    good: { field: TOKENS.frogGreen, ink: TOKENS.bone },
    warn: { field: TOKENS.alertRed, ink: TOKENS.labNight },
  },
}

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const n2 = (v) => String(Math.round(v * 100) / 100)

/** The glyph for a character, '?' when the font has none. */
const glyphOf = (font, ch) => font.glyphs[ch] ?? font.glyphs['?']

/** The advance width of a run in px: glyph advances at the font size, plus tracking between letters. */
export function runWidth(fontKey, text, px, trackEm = 0) {
  const font = GLYPHS.fonts[fontKey]
  const chars = [...text]
  let w = 0
  for (const ch of chars) w += (glyphOf(font, ch).a * px) / font.upm
  return w + trackEm * px * Math.max(0, chars.length - 1)
}

/** Parse a glyph path (absolute M L H V Q Z, implicit repeats) and scale it into one string at (x, baseline). */
function placePath(d, x, base, sc) {
  const t = d.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g)
  let out = ''
  let i = 0
  let cmd = ''
  let cx = 0
  let cy = 0
  const px = (v) => n2(x + v * sc)
  const py = (v) => n2(base - v * sc)
  while (i < t.length) {
    if (/[A-Za-z]/.test(t[i])) cmd = t[i++]
    else if (cmd === 'M') cmd = 'L'
    if (cmd === 'Z') {
      out += 'Z'
      continue
    }
    if (cmd === 'M' || cmd === 'L') {
      cx = +t[i++]
      cy = +t[i++]
      out += `${cmd}${px(cx)} ${py(cy)}`
    } else if (cmd === 'H') {
      cx = +t[i++]
      out += `H${px(cx)}`
    } else if (cmd === 'V') {
      cy = +t[i++]
      out += `V${py(cy)}`
    } else if (cmd === 'Q') {
      const a = +t[i++]
      const b = +t[i++]
      cx = +t[i++]
      cy = +t[i++]
      out += `Q${px(a)} ${py(b)} ${px(cx)} ${py(cy)}`
    } else throw new Error(`badge glyph path: unsupported command ${cmd}`)
  }
  return out
}

/** One run of text as a single path `d`, starting at x with its baseline on y. */
function runPath(fontKey, text, px, trackEm, x, base) {
  const font = GLYPHS.fonts[fontKey]
  const sc = px / font.upm
  let pen = x
  let d = ''
  for (const ch of text) {
    const g = glyphOf(font, ch)
    if (g.d) d += placePath(g.d, pen, base, sc)
    pen += g.a * sc + trackEm * px
  }
  return d
}

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** Everything the SVG is built from, in whole pixels. */
export function badgeMetrics(opts = {}) {
  opts = normalise(opts)
  const size = SIZES.includes(opts.size) ? opts.size : 'M'
  const theme = THEMES.includes(opts.theme) ? opts.theme : 'dark'
  const tone = TONES.includes(opts.tone) ? opts.tone : 'brand'
  const kind = KINDS.includes(opts.kind) ? opts.kind : 'project'
  const g = GEO[size]
  const label = clean(opts.label, 28).toUpperCase()
  // 'project' badges name Gully Labs in the badge's own mono type beside the kit icon (the retired gold
  // wordmark paths are gone; the kit's wordmark is a raster too heavy to embed in a README badge).
  const value = kind === 'project' ? 'GULLY LABS' : clean(opts.value, 36)
  const labelW = Math.ceil(runWidth('display', label, g.label, LABEL_TRACK))
  const wmS = g.wm / (KIT.wordmark.height || 176)
  const valueW = Math.ceil(runWidth('mono', value, g.value))
  const markX = g.pad
  const labelX = markX + g.mark[0] + g.gap
  // No value (a neutral pill): the badge ends after the label, with the mark's padding on the right.
  const hasSeg = kind === 'project' || value !== ''
  const segX = labelX + labelW + g.gap
  const valueX = segX + g.seg
  const width = hasSeg ? valueX + valueW + g.seg + 1 : labelX + labelW + g.pad + 1
  const markY = (g.h - g.mark[1]) / 2
  // Whole-pixel baselines: the cap height of each face is centred on the badge, then rounded.
  const labelBase = Math.round(g.h / 2 + (GLYPHS.fonts.display.cap * g.label) / GLYPHS.fonts.display.upm / 2)
  const valueBase = Math.round(g.h / 2 + (GLYPHS.fonts.mono.cap * g.value) / GLYPHS.fonts.mono.upm / 2)
  return { kind, size, theme, tone, label, value, hasSeg, g, width, height: g.h, markX, markY, labelX, labelW, labelBase, segX, valueX, valueW, valueBase, wmScale: wmS }
}

/** The badge as an SVG string. */
export function renderBadge(opts = {}) {
  opts = normalise(opts)
  const m = badgeMetrics(opts)
  const { g, width: W, height: H } = m
  const th = THEME[m.theme]
  const seg = SEGMENT[m.theme][m.tone]
  const title = clean(opts.title, 200) || (m.kind === 'project' ? `${m.label} Gully Labs`.replace(/^BUILT BY /, 'Built by ') : `${clean(opts.label, 28)}: ${m.value}`)
  const markPx = g.mark[1] * 2 > 64 ? '128' : '64'
  const ri = g.r - 1
  const parts = []
  // Border and fill: an outer rounded rect in the border colour under an inner one, so the 1 px edge is exact.
  parts.push(`<rect width="${W}" height="${H}" rx="${g.r}" fill="${th.border}"/>`)
  parts.push(`<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="${ri}" fill="${th.bg}"/>`)
  // The value segment: square on its left, the badge's inner radius on its right.
  if (m.hasSeg) parts.push(`<path d="M${m.segX} 1H${W - 1 - ri}A${ri} ${ri} 0 0 1 ${W - 1} ${1 + ri}V${H - 1 - ri}A${ri} ${ri} 0 0 1 ${W - 1 - ri} ${H - 1}H${m.segX}Z" fill="${seg.field}"/>`)
  parts.push(`<image x="${m.markX}" y="${m.markY}" width="${g.mark[0]}" height="${g.mark[1]}" href="${GLYPHS.marks[markPx]}"/>`)
  parts.push(`<path fill="${th.ink}" d="${runPath('display', m.label, g.label, LABEL_TRACK, m.labelX, m.labelBase)}"/>`)
  let defs = ''
  if (m.value) {
    parts.push(`<path fill="${seg.ink}" d="${runPath('mono', m.value, g.value, 0, m.valueX, m.valueBase)}"/>`)
  }
  const body = parts.join('\n')
  const href = opts.href ? xmlEsc(opts.href) : ''
  const inner = href ? `<a xlink:href="${href}" href="${href}" target="_blank" rel="noopener noreferrer">\n${body}\n</a>` : body
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${xmlEsc(title)}">\n<title>${xmlEsc(title)}</title>\n${defs}${inner}\n</svg>`
}

/** The badge as PNG bytes at 1x or 2x (resvg, the renderer the OG cards use). */
export async function renderBadgePng(opts = {}, scale = 1) {
  const { loadResvg } = await import('./og.mjs')
  const { Resvg } = await loadResvg()
  const r = new Resvg(renderBadge(opts), { fitTo: scale === 1 ? { mode: 'original' } : { mode: 'zoom', value: scale }, shapeRendering: 2, imageRendering: 0 })
  const img = r.render()
  const png = Buffer.from(img.asPng())
  img.free()
  r.free()
  return png
}

/** Response headers for a served badge. `maxAge` seconds; the CSP lets only the embedded mark load. */
export const badgeHeaders = (maxAge = 3600) => ({
  'Content-Type': 'image/svg+xml; charset=utf-8',
  'Cache-Control': `public, max-age=${maxAge}`,
  'Access-Control-Allow-Origin': '*',
  'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
})

/** Badge options from a query string (?size=S|M|L&theme=dark|light), shared by every badge route. */
export function badgeStyleFrom(searchParams) {
  const size = String(searchParams?.get?.('size') ?? '').toUpperCase()
  const theme = String(searchParams?.get?.('theme') ?? '').toLowerCase()
  return { size: SIZES.includes(size) ? size : 'M', theme: THEMES.includes(theme) ? theme : 'dark' }
}
