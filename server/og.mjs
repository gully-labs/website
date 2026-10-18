// GET /og/blog/<slug>.png: the share image (og:image, twitter:image) for a blog post, 1200 x 630.
//
// The picture is the post's own generated banner (ghost/theme/gully/assets/js/banner.js, variant
// "share"), frozen at the same still frame reduced-motion visitors see on the blog, with the post's
// title, its primary tag and the GULLY LABS wordmark in the brand fonts.
//
// How it renders, with no native code: banner.js draws into any CanvasRenderingContext2D. SvgContext
// below is a small one that records those calls as SVG (the drawing code uses paths, rects, arcs,
// gradients, dashes and text only). Text is measured from the brand fonts' own advance widths (the
// @fontsource WOFF files, unpacked to TrueType here with zlib), so the banner's line wrapping works as
// it does in a browser. resvg (WebAssembly build, MPL-2.0, @resvg/resvg-wasm) turns the SVG into a PNG.
// The production image has no node_modules: the Dockerfile copies just that package, banner.js and the
// four font files next to the server (og/).
//
// Post data comes from Ghost's Content API (GHOST_CONTENT_KEY) over the project network, cached in
// memory for 5 minutes (unknown slugs for 1). PNGs are cached on disk under DATA_DIR/og-cache, named by
// slug plus a key over the post's updated_at (and this renderer's version), bounded by file count and
// bytes, least recently used first out.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { DATA_DIR } from './http.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const W = 1200
const H = 630
/** Bump to re-render every cached image (layout or renderer changes). banner.js changes re-key on their own. */
const RENDER_VERSION = '1'
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,189}[a-z0-9])?$/
const POST_TTL = 5 * 60_000
const MISS_TTL = 60_000

const env = (k, d) => process.env[k] || d
const cacheDir = () => env('OG_CACHE_DIR', path.join(DATA_DIR, 'og-cache'))
const maxFiles = () => Number(env('OG_CACHE_MAX_FILES', 500))
const maxBytes = () => Number(env('OG_CACHE_MAX_BYTES', 64 * 1024 * 1024))

/* ------------------------------------------------------------------ assets --- */

/** First existing path, or null. */
const firstFile = (...c) => c.find((p) => p && fs.existsSync(p)) ?? null

const FONT_FILES = [
  ['@fontsource/barlow-condensed', 'barlow-condensed-latin-800-normal.woff'],
  ['@fontsource/barlow-condensed', 'barlow-condensed-latin-ext-800-normal.woff'],
  ['@fontsource/ibm-plex-mono', 'ibm-plex-mono-latin-500-normal.woff'],
  ['@fontsource/ibm-plex-mono', 'ibm-plex-mono-latin-ext-500-normal.woff'],
]
const fontPath = (pkg, file) => firstFile(path.join(HERE, 'og', 'fonts', file), path.join(HERE, '..', 'node_modules', pkg, 'files', file))
const bannerPath = () => firstFile(env('OG_BANNER_JS'), path.join(HERE, 'og', 'banner.cjs'), path.join(HERE, '..', 'ghost', 'theme', 'gully', 'assets', 'js', 'banner.js'))

/* ------------------------------------------------------------------- fonts --- */

/** WOFF 1.0 to a plain sfnt (TrueType) buffer: inflate each table and rebuild the table directory. */
export function woffToSfnt(woff) {
  if (woff.toString('latin1', 0, 4) !== 'wOFF') throw new Error('not a WOFF file')
  const flavor = woff.readUInt32BE(4)
  const n = woff.readUInt16BE(12)
  const tables = []
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20
    const tag = woff.toString('latin1', o, o + 4)
    const off = woff.readUInt32BE(o + 4)
    const comp = woff.readUInt32BE(o + 8)
    const orig = woff.readUInt32BE(o + 12)
    const sum = woff.readUInt32BE(o + 16)
    const raw = woff.subarray(off, off + comp)
    tables.push({ tag, sum, data: comp < orig ? zlib.inflateSync(raw) : Buffer.from(raw) })
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1))
  let pow = 1
  let log = 0
  while (pow * 2 <= n) {
    pow *= 2
    log++
  }
  const head = 12 + 16 * n
  const size = tables.reduce((s, t) => s + ((t.data.length + 3) & ~3), head)
  const out = Buffer.alloc(size)
  out.writeUInt32BE(flavor, 0)
  out.writeUInt16BE(n, 4)
  out.writeUInt16BE(pow * 16, 6)
  out.writeUInt16BE(log, 8)
  out.writeUInt16BE(n * 16 - pow * 16, 10)
  let at = head
  tables.forEach((t, i) => {
    const r = 12 + i * 16
    out.write(t.tag, r, 'latin1')
    out.writeUInt32BE(t.sum, r + 4)
    out.writeUInt32BE(at, r + 8)
    out.writeUInt32BE(t.data.length, r + 12)
    t.data.copy(out, at)
    at += (t.data.length + 3) & ~3
  })
  return out
}

/** The metrics text layout needs: family, weight, units per em, ascent/descent, char to advance. */
export function readFont(sfnt) {
  const n = sfnt.readUInt16BE(4)
  const dir = {}
  for (let i = 0; i < n; i++) {
    const r = 12 + i * 16
    dir[sfnt.toString('latin1', r, r + 4)] = { off: sfnt.readUInt32BE(r + 8), len: sfnt.readUInt32BE(r + 12) }
  }
  const upem = sfnt.readUInt16BE(dir.head.off + 18)
  const hh = dir.hhea.off
  const ascent = sfnt.readInt16BE(hh + 4)
  const descent = sfnt.readInt16BE(hh + 6)
  const nMetrics = sfnt.readUInt16BE(hh + 34)
  const weight = sfnt.readUInt16BE(dir['OS/2'].off + 4)
  const adv = (g) => sfnt.readUInt16BE(dir.hmtx.off + 4 * Math.min(g, nMetrics - 1))
  // Family name: name ID 1 (Windows, UTF-16BE) or 16 (typographic family) if present.
  const nm = dir.name.off
  const count = sfnt.readUInt16BE(nm + 2)
  const strOff = nm + sfnt.readUInt16BE(nm + 4)
  const names = {}
  for (let i = 0; i < count; i++) {
    const r = nm + 6 + i * 12
    const [plat, , , id, len, off] = [0, 2, 4, 6, 8, 10].map((k) => sfnt.readUInt16BE(r + k))
    if (plat !== 3 || names[id]) continue
    const b = Buffer.from(sfnt.subarray(strOff + off, strOff + off + len))
    names[id] = b.swap16().toString('utf16le')
  }
  // cmap: format 12 (full Unicode) when present, else format 4 (BMP).
  const cm = dir.cmap.off
  const subs = sfnt.readUInt16BE(cm + 2)
  let f4 = -1
  let f12 = -1
  for (let i = 0; i < subs; i++) {
    const r = cm + 4 + i * 8
    const p = sfnt.readUInt16BE(r)
    const e = sfnt.readUInt16BE(r + 2)
    const o = cm + sfnt.readUInt32BE(r + 4)
    const fmt = sfnt.readUInt16BE(o)
    if (p === 3 && e === 10 && fmt === 12) f12 = o
    if ((p === 3 && e === 1) || p === 0) {
      if (fmt === 4 && f4 < 0) f4 = o
      if (fmt === 12 && f12 < 0) f12 = o
    }
  }
  const map = new Map()
  if (f12 >= 0) {
    const groups = sfnt.readUInt32BE(f12 + 12)
    for (let i = 0; i < groups; i++) {
      const g = f12 + 16 + i * 12
      const start = sfnt.readUInt32BE(g)
      const end = sfnt.readUInt32BE(g + 4)
      const gid = sfnt.readUInt32BE(g + 8)
      for (let c = start; c <= end; c++) map.set(c, gid + c - start)
    }
  } else if (f4 >= 0) {
    const segX2 = sfnt.readUInt16BE(f4 + 6)
    const ends = f4 + 14
    const starts = ends + segX2 + 2
    const deltas = starts + segX2
    const ranges = deltas + segX2
    for (let s = 0; s < segX2; s += 2) {
      const end = sfnt.readUInt16BE(ends + s)
      const start = sfnt.readUInt16BE(starts + s)
      const delta = sfnt.readInt16BE(deltas + s)
      const ro = sfnt.readUInt16BE(ranges + s)
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g
        if (ro === 0) g = (c + delta) & 0xffff
        else {
          g = sfnt.readUInt16BE(ranges + s + ro + 2 * (c - start))
          if (g) g = (g + delta) & 0xffff
        }
        if (g) map.set(c, g)
      }
    }
  }
  return { family: names[16] || names[1], weight, upem, ascent, descent: Math.abs(descent), advance: (cp) => (map.has(cp) ? adv(map.get(cp)) : null) }
}

let fonts = null
/** Loads the brand fonts once: [{ buf (TrueType), family, weight, ... }]. */
export function loadFonts() {
  if (fonts) return fonts
  fonts = FONT_FILES.map(([pkg, file]) => {
    const p = fontPath(pkg, file)
    if (!p) throw new Error(`font missing: ${file}`)
    const buf = woffToSfnt(fs.readFileSync(p))
    return { buf, ...readFont(buf) }
  })
  return fonts
}

/* ------------------------------------------------------- canvas to SVG --- */

const r2 = (v) => Math.round(v * 100) / 100
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** '#rrggbb' or 'rgba(r,g,b,a)' to [hex, alpha]. */
function paint(c) {
  const s = String(c).trim()
  const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/)
  if (m) return ['#' + [m[1], m[2], m[3]].map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join(''), m[4] === undefined ? 1 : Number(m[4])]
  return [s, 1]
}

/** "800 92px \"Barlow Condensed\", sans-serif" to { weight, size, family }. */
function parseFont(f) {
  const m = String(f).match(/^\s*(?:(normal|bold|\d{3})\s+)?([\d.]+)px\s+(.+)$/)
  if (!m) return { weight: 400, size: 10, family: 'sans-serif' }
  const weight = m[1] === 'bold' ? 700 : Number(m[1]) || 400
  return { weight, size: Number(m[2]), family: m[3].split(',')[0].trim().replace(/^["']|["']$/g, '') }
}

/** Glyphs the brand fonts lack but banner.js uses: drawn as shapes so the tape keeps its separators. */
const SHAPES = { 0x25c6: 'diamond' }

/**
 * A CanvasRenderingContext2D stand-in that records what banner.js draws as SVG. Covers what banner.js
 * uses: save/restore, rects, paths (moveTo, lineTo, arc, closePath), fill/stroke with colours or
 * linear/radial gradients, line dashes, globalAlpha, and fillText/measureText in the loaded fonts.
 * Characters no loaded font has (emoji and the like) are dropped from text, as both measured and drawn.
 */
export class SvgContext {
  constructor(w, h, faces) {
    this.w = w
    this.h = h
    this.faces = faces
    this.out = []
    this.defs = []
    this.ids = 0
    this.stack = []
    this.st = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif', textBaseline: 'alphabetic', textAlign: 'left', globalAlpha: 1, globalCompositeOperation: 'source-over', dash: [] }
    this.d = []
    this.cur = null
    for (const k of Object.keys(this.st)) {
      if (k === 'dash') continue
      Object.defineProperty(this, k, { get: () => this.st[k], set: (v) => (this.st[k] = v), enumerable: true })
    }
  }

  save() {
    this.stack.push({ ...this.st, dash: [...this.st.dash] })
  }
  restore() {
    if (this.stack.length) this.st = this.stack.pop()
  }
  setTransform() {}
  setLineDash(a) {
    this.st.dash = [...a]
  }
  getLineDash() {
    return [...this.st.dash]
  }

  clearRect(x, y, w, h) {
    if (x <= 0 && y <= 0 && x + w >= this.w && y + h >= this.h) this.out = []
  }

  beginPath() {
    this.d = []
    this.cur = null
  }
  moveTo(x, y) {
    this.d.push(`M${r2(x)} ${r2(y)}`)
    this.cur = [x, y]
    this.start = [x, y]
  }
  lineTo(x, y) {
    if (!this.cur) return this.moveTo(x, y)
    this.d.push(`L${r2(x)} ${r2(y)}`)
    this.cur = [x, y]
  }
  closePath() {
    if (!this.cur) return
    this.d.push('Z')
    this.cur = this.start
  }
  arc(x, y, r, a0, a1, ccw = false) {
    const sx = x + r * Math.cos(a0)
    const sy = y + r * Math.sin(a0)
    if (this.cur) this.lineTo(sx, sy)
    else this.moveTo(sx, sy)
    let sweep = ccw ? a0 - a1 : a1 - a0
    if (sweep >= Math.PI * 2 - 1e-9) {
      // A full circle: two half arcs.
      const mx = x - r * Math.cos(a0)
      const my = y - r * Math.sin(a0)
      const f = ccw ? 0 : 1
      this.d.push(`A${r2(r)} ${r2(r)} 0 1 ${f} ${r2(mx)} ${r2(my)}`, `A${r2(r)} ${r2(r)} 0 1 ${f} ${r2(sx)} ${r2(sy)}`)
      this.cur = [sx, sy]
      return
    }
    sweep = ((sweep % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
    const ex = x + r * Math.cos(a1)
    const ey = y + r * Math.sin(a1)
    this.d.push(`A${r2(r)} ${r2(r)} 0 ${sweep > Math.PI ? 1 : 0} ${ccw ? 0 : 1} ${r2(ex)} ${r2(ey)}`)
    this.cur = [ex, ey]
  }
  rect(x, y, w, h) {
    this.moveTo(x, y)
    this.lineTo(x + w, y)
    this.lineTo(x + w, y + h)
    this.lineTo(x, y + h)
    this.closePath()
  }

  createLinearGradient(x0, y0, x1, y1) {
    return { kind: 'linear', a: { x1: x0, y1: y0, x2: x1, y2: y1 }, stops: [], addColorStop(o, c) { this.stops.push([o, c]) } }
  }
  createRadialGradient(x0, y0, r0, x1, y1, r1) {
    return { kind: 'radial', a: { fx: x0, fy: y0, fr: r0, cx: x1, cy: y1, r: r1 }, stops: [], addColorStop(o, c) { this.stops.push([o, c]) } }
  }

  /** fill/stroke attributes for a style (colour or gradient), with globalAlpha applied. */
  paintAttrs(style, kind) {
    const ga = this.st.globalAlpha
    if (style && typeof style === 'object' && style.stops) {
      const id = `g${this.ids++}`
      const tag = style.kind === 'linear' ? 'linearGradient' : 'radialGradient'
      const attrs = Object.entries(style.a).map(([k, v]) => `${k}="${r2(v)}"`).join(' ')
      const stops = style.stops
        .map(([o, c]) => {
          const [hex, a] = paint(c)
          return `<stop offset="${r2(o)}" stop-color="${hex}"${a < 1 ? ` stop-opacity="${r2(a)}"` : ''}/>`
        })
        .join('')
      this.defs.push(`<${tag} id="${id}" gradientUnits="userSpaceOnUse" ${attrs}>${stops}</${tag}>`)
      return `${kind}="url(#${id})"${ga < 1 ? ` ${kind}-opacity="${r2(ga)}"` : ''}`
    }
    const [hex, a] = paint(style)
    const op = a * ga
    return `${kind}="${hex}"${op < 1 ? ` ${kind}-opacity="${Math.round(op * 1000) / 1000}"` : ''}`
  }
  strokeAttrs() {
    const dash = this.st.dash.length ? ` stroke-dasharray="${this.st.dash.map(r2).join(' ')}"` : ''
    return `fill="none" ${this.paintAttrs(this.st.strokeStyle, 'stroke')} stroke-width="${r2(this.st.lineWidth)}"${dash}`
  }

  fill() {
    if (this.d.length) this.out.push(`<path d="${this.d.join('')}" ${this.paintAttrs(this.st.fillStyle, 'fill')}/>`)
  }
  stroke() {
    if (this.d.length) this.out.push(`<path d="${this.d.join('')}" ${this.strokeAttrs()}/>`)
  }
  fillRect(x, y, w, h) {
    this.out.push(`<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" ${this.paintAttrs(this.st.fillStyle, 'fill')}/>`)
  }
  strokeRect(x, y, w, h) {
    this.out.push(`<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" ${this.strokeAttrs()}/>`)
  }

  /** The loaded face for the current font and a code point: same family and weight, first that has it. */
  face(f, cp) {
    // Faces carry their full names ("Barlow Condensed ExtraBold"); CSS asks for the family.
    const fam = this.faces.filter((x) => x.family === f.family || x.family.startsWith(`${f.family} `))
    const pool = fam.length ? fam : this.faces
    const best = Math.min(...pool.map((x) => Math.abs(x.weight - f.weight)))
    const near = pool.filter((x) => Math.abs(x.weight - f.weight) === best)
    return cp === undefined ? near[0] : near.find((x) => x.advance(cp) !== null) ?? null
  }

  /** Splits text into runs of one face: [{ text, width, face, shape? }]. Characters no face has are dropped. */
  runs(text) {
    const f = parseFont(this.st.font)
    const out = []
    let cur = null
    for (const ch of String(text)) {
      const cp = ch.codePointAt(0)
      if (SHAPES[cp]) {
        cur = null
        out.push({ text: ch, width: f.size * 0.62, shape: SHAPES[cp] })
        continue
      }
      const face = this.face(f, cp)
      if (!face) continue
      const w = (face.advance(cp) * f.size) / face.upem
      if (!cur || cur.face !== face) out.push((cur = { text: '', width: 0, face }))
      cur.text += ch
      cur.width += w
    }
    return { f, runs: out }
  }

  measureText(text) {
    const { runs } = this.runs(text)
    return { width: runs.reduce((s, r) => s + r.width, 0) }
  }

  fillText(text, x, y) {
    const { f, runs } = this.runs(text)
    const base = this.face(f)
    const asc = (base.ascent / base.upem) * f.size
    const desc = (base.descent / base.upem) * f.size
    const tb = this.st.textBaseline
    const by = tb === 'top' || tb === 'hanging' ? y + asc : tb === 'middle' ? y + (asc - desc) / 2 : tb === 'bottom' || tb === 'ideographic' ? y - desc : y
    const fill = this.paintAttrs(this.st.fillStyle, 'fill')
    let cx = x
    for (const r of runs) {
      if (r.shape === 'diamond') {
        const s = f.size * 0.3
        const my = by - f.size * 0.33
        const mx = cx + r.width / 2
        this.out.push(`<path d="M${r2(mx)} ${r2(my - s)}L${r2(mx + s)} ${r2(my)}L${r2(mx)} ${r2(my + s)}L${r2(mx - s)} ${r2(my)}Z" ${fill}/>`)
      } else if (r.text.trim()) {
        this.out.push(`<text x="${r2(cx)}" y="${r2(by)}" font-family="${esc(r.face.family)}" font-weight="${r.face.weight}" font-size="${r2(f.size)}" ${fill} xml:space="preserve">${esc(r.text)}</text>`)
      }
      cx += r.width
    }
  }

  toSvg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${this.h}" viewBox="0 0 ${this.w} ${this.h}" stroke-miterlimit="10"><defs>${this.defs.join('')}</defs>${this.out.join('')}</svg>`
  }
}

/* ---------------------------------------------------------------- render --- */

let banner = null
let bannerHash = ''
function loadBanner() {
  if (banner) return banner
  const p = bannerPath()
  if (!p) throw new Error('banner.js missing')
  bannerHash = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 8)
  banner = createRequire(import.meta.url)(p)
  return banner
}

/** The banner input for a post, as the theme passes it (partials/banner.hbs): slug, title, primary tag. */
const bannerInput = (post) => ({ seed: post.slug, title: post.title ?? '', tag: post.primary_tag?.slug ?? '', tagName: post.primary_tag?.name ?? '' })

/** The post's share image as SVG (1200 x 630). */
export function renderOgSvg(post) {
  const ctx = new SvgContext(W, H, loadFonts())
  loadBanner().renderStill(ctx, bannerInput(post), W, H, { variant: 'share' })
  return ctx.toSvg()
}

/** How the share image sets the title: { size, lines }, measured in the brand fonts. */
export function titleLayout(title) {
  const ctx = new SvgContext(W, H, loadFonts())
  return loadBanner().shareTitle(ctx, title, W)
}

let resvg = null
async function loadResvg() {
  if (resvg) return resvg
  const require = createRequire(import.meta.url)
  const pkgDir = firstFile(path.join(HERE, 'node_modules', '@resvg', 'resvg-wasm'), path.join(HERE, '..', 'node_modules', '@resvg', 'resvg-wasm'))
  if (!pkgDir) throw new Error('@resvg/resvg-wasm missing')
  const mod = require(path.join(pkgDir, 'index.js'))
  await mod.initWasm(fs.readFileSync(path.join(pkgDir, 'index_bg.wasm')))
  resvg = mod
  return resvg
}

/** The post's share image as PNG bytes. Deterministic: the same post gives the same bytes. */
export async function renderOgPng(post) {
  const { Resvg } = await loadResvg()
  const svg = renderOgSvg(post)
  const r = new Resvg(svg, {
    fitTo: { mode: 'original' },
    font: { fontBuffers: loadFonts().map((f) => new Uint8Array(f.buf)), loadSystemFonts: false, defaultFontFamily: 'IBM Plex Mono' },
    shapeRendering: 2,
    textRendering: 1,
  })
  const img = r.render()
  const png = Buffer.from(img.asPng())
  img.free()
  r.free()
  return png
}

/* ------------------------------------------------------------- post data --- */

const posts = new Map()

/** Clears the in-memory post cache (tests). */
export function resetOgMemory() {
  posts.clear()
}

function ghostGet(pathname) {
  const base = new URL(env('OG_GHOST_URL', env('BLOG_UPSTREAM', 'http://gully-blog:2368')))
  const lib = base.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: base.hostname,
        port: base.port || (base.protocol === 'https:' ? 443 : 80),
        path: pathname,
        method: 'GET',
        // Ghost answers for its configured URL: the same host and scheme the blog proxy forwards.
        headers: { Host: env('BLOG_HOST', 'blog.gullylabs.xyz'), 'X-Forwarded-Proto': 'https', Accept: 'application/json', 'Accept-Version': 'v6.0' },
        timeout: 10_000,
      },
      (res) => {
        const chunks = []
        let size = 0
        res.on('data', (c) => {
          size += c.length
          if (size > 2_000_000) req.destroy(new Error('response too large'))
          else chunks.push(c)
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end()
  })
}

/** The post (slug, title, updated_at, primary_tag) or null when Ghost has no such published post. */
async function readPost(slug) {
  const hit = posts.get(slug)
  if (hit && hit.until > Date.now()) return hit.post
  const key = process.env.GHOST_CONTENT_KEY
  if (!key) throw Object.assign(new Error('GHOST_CONTENT_KEY not set'), { status: 503 })
  const q = new URLSearchParams({ key, include: 'tags', fields: 'slug,title,updated_at' })
  const r = await ghostGet(`/ghost/api/content/posts/slug/${encodeURIComponent(slug)}/?${q}`)
  let post = null
  if (r.status === 200) {
    const p = JSON.parse(r.body).posts?.[0]
    if (p) post = { slug: p.slug, title: p.title ?? '', updated_at: p.updated_at ?? '', primary_tag: p.primary_tag ? { slug: p.primary_tag.slug, name: p.primary_tag.name } : null }
  } else if (r.status !== 404) {
    throw Object.assign(new Error(`ghost answered ${r.status}`), { status: 502 })
  }
  if (posts.size >= 1000) posts.delete(posts.keys().next().value)
  posts.set(slug, { post, until: Date.now() + (post ? POST_TTL : MISS_TTL) })
  return post
}

/* ------------------------------------------------------------- disk cache --- */

function cacheName(post) {
  loadBanner()
  const k = crypto.createHash('sha1').update(`${RENDER_VERSION}\n${bannerHash}\n${post.updated_at}\n${post.title}\n${post.primary_tag?.slug ?? ''}`).digest('hex').slice(0, 16)
  return `${post.slug}.${k}.png`
}

/** Removes this slug's older images and keeps the folder under the file and byte limits (oldest use first). */
function prune(dir, keep, slug) {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.png'))
      .map((f) => {
        const st = fs.statSync(path.join(dir, f))
        return { f, size: st.size, t: st.mtimeMs }
      })
    const live = []
    for (const x of files) {
      if (x.f !== keep && x.f.startsWith(`${slug}.`)) fs.rmSync(path.join(dir, x.f), { force: true })
      else live.push(x)
    }
    live.sort((a, b) => a.t - b.t)
    let bytes = live.reduce((s, x) => s + x.size, 0)
    while (live.length && (live.length > maxFiles() || bytes > maxBytes())) {
      const x = live.shift()
      if (x.f === keep && live.length) {
        live.push(x)
        continue
      }
      fs.rmSync(path.join(dir, x.f), { force: true })
      bytes -= x.size
    }
  } catch (e) {
    console.error('og cache prune:', e?.message ?? e)
  }
}

const inflight = new Map()

/** { png, hit } for a post: from the disk cache, else rendered and stored. */
async function imageFor(post) {
  const dir = cacheDir()
  const name = cacheName(post)
  const file = path.join(dir, name)
  try {
    const png = fs.readFileSync(file)
    const now = new Date()
    fs.utimes(file, now, now, () => {})
    return { png, hit: true }
  } catch {
    /* not cached */
  }
  if (!inflight.has(name)) {
    inflight.set(
      name,
      renderOgPng(post)
        .then((png) => {
          try {
            fs.mkdirSync(dir, { recursive: true })
            const tmp = `${file}.${process.pid}.tmp`
            fs.writeFileSync(tmp, png)
            fs.renameSync(tmp, file)
            prune(dir, name, post.slug)
          } catch (e) {
            console.error('og cache write:', e?.message ?? e)
          }
          return png
        })
        .finally(() => inflight.delete(name)),
    )
  }
  return { png: await inflight.get(name), hit: false }
}

/* ----------------------------------------------------------------- route --- */

/** Handles GET/HEAD /og/blog/<slug>.png. Returns false when the path is not ours. */
export async function handleOg(req, res, url) {
  const m = url.pathname.match(/^\/og\/blog\/([^/]+)\.png$/)
  if (!m) return false
  const end = (status, body, headers = {}) => {
    res.writeHead(status, headers)
    res.end(req.method === 'HEAD' ? undefined : body)
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return end(405, '', { Allow: 'GET, HEAD' }), true
  const slug = m[1]
  const notFound = () => end(404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=60' })
  if (!SLUG.test(slug)) return notFound(), true
  try {
    const post = await readPost(slug)
    if (!post) return notFound(), true
    const { png, hit } = await imageFor(post)
    const etag = `"${crypto.createHash('sha1').update(png).digest('hex').slice(0, 20)}"`
    const headers = { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', ETag: etag, 'X-OG-Cache': hit ? 'hit' : 'miss' }
    if (req.headers['if-none-match'] === etag) return end(304, undefined, headers), true
    end(200, png, { ...headers, 'Content-Length': String(png.length) })
  } catch (e) {
    console.error('og image:', e?.message ?? e)
    end(e?.status === 503 ? 503 : 502, 'Share image unavailable', { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
  }
  return true
}
