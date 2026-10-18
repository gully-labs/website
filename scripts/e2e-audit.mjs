// Design audit for scripts/e2e.mjs: run in the page after it has settled, it reports what the pixel
// pass (2026-10-17) fixed so it stays fixed:
//   - no text under 11 px (the site's minimum; chart axis labels included),
//   - no colour painted that is not a token (src/index.css @theme, the chart palette, the project
//     accents, the chain and token brand marks, the wordmark gradient),
//   - every link to another host opens in a new tab with rel="noopener" (the app host is ours and
//     opens in place, like "Launch app" does).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Files whose 6-digit hex values are, by definition, the token set. Anything else on a page is off-token. */
const TOKEN_FILES = ['src/index.css', 'src/components/charts/chartPresets.ts', 'src/content/projects.ts', 'src/lib/tracker.ts', 'src/components/brand/kit.generated.ts', 'src/components/logos/registry.ts']

/** Every token colour, lower-case `#rrggbb`. */
export function tokenColors() {
  const out = new Set()
  for (const f of TOKEN_FILES) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
    for (const m of src.matchAll(/#([0-9a-fA-F]{6})\b/g)) out.add('#' + m[1].toLowerCase())
  }
  return [...out]
}

/** Hosts that are this site's own app: links to them open in place. */
export const IN_PLACE_HOSTS = ['app.gullylabs.xyz', 'developers.gullylabs.xyz']

/**
 * Runs in the browser (page.evaluate). Returns the findings; each list is empty when the page passes.
 * `allowed` is tokenColors(); `inPlace` is IN_PLACE_HOSTS.
 */
export function auditPage({ allowed, inPlace }) {
  const small = []
  const offToken = new Map()
  const ext = []
  const vis = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0
  }
  const sel = (el) => {
    const parts = []
    for (let e = el, i = 0; e && e.nodeType === 1 && i < 3; e = e.parentElement, i++) parts.unshift(e.tagName.toLowerCase() + (e.id ? '#' + e.id : e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : ''))
    return parts.join(' > ')
  }
  const parse = (c) => {
    let m = c && c.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
    if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] }
    m = c && c.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/)
    if (m) return { r: Math.round(+m[1] * 255), g: Math.round(+m[2] * 255), b: Math.round(+m[3] * 255), a: m[4] === undefined ? 1 : +m[4] }
    return null
  }
  const tokens = allowed.map((h) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) }))
  const near = (c) => tokens.some((t) => Math.abs(t.r - c.r) <= 2 && Math.abs(t.g - c.g) <= 2 && Math.abs(t.b - c.b) <= 2)
  const neutral = (c) => Math.abs(c.r - c.g) <= 1 && Math.abs(c.g - c.b) <= 1 // black, white and greys: logo discs and shadows
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
  const paint = (value, el, kind) => {
    const c = parse(value)
    if (!c || c.a === 0 || near(c) || neutral(c)) return
    const k = hex(c)
    const cur = offToken.get(k) ?? { color: k, count: 0, kind, sample: sel(el) }
    cur.count++
    offToken.set(k, cur)
  }
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue
    const cs = getComputedStyle(el)
    // Text under 11 px (the element's own text nodes; .sr-only text is not rendered).
    if (!el.classList.contains('sr-only') && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
      const fs = parseFloat(cs.fontSize)
      if (fs < 11) small.push({ size: fs, sel: sel(el), text: el.textContent.trim().slice(0, 40) })
    }
    // Colours: text, fills, borders; SVG fills and strokes outside <img> logos. An element whose colour is
    // mid-transition (a hover fade, a count-up flash) is skipped: it is on its way to a token.
    // An inherited colour moves with its parent's animation (a count-up flash on the figure's wrapper).
    const running = (e) => !!e && typeof e.getAnimations === 'function' && e.getAnimations().some((a) => a.playState === 'running' || a.pending)
    const moving = running(el) || running(el.parentElement) || running(el.parentElement?.parentElement)
    if (moving) {
      // fall through to the link check below
    } else if (el instanceof SVGElement) {
      if (cs.fill && cs.fill !== 'none') paint(cs.fill, el, 'fill')
      if (cs.stroke && cs.stroke !== 'none') paint(cs.stroke, el, 'stroke')
    } else {
      paint(cs.color, el, 'text')
      paint(cs.backgroundColor, el, 'bg')
      if (parseFloat(cs.borderTopWidth) > 0) paint(cs.borderTopColor, el, 'border')
    }
    // Links to other hosts.
    if (el.tagName === 'A' && /^https?:/.test(el.href)) {
      const host = new URL(el.href).host
      if (host !== location.host && !inPlace.includes(host)) {
        const rel = (el.getAttribute('rel') || '').split(/\s+/)
        if (el.target !== '_blank' || !rel.includes('noopener')) ext.push({ href: el.href.slice(0, 90), sel: sel(el) })
      }
    }
  }
  return { small, offToken: [...offToken.values()], ext }
}
