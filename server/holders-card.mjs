// The Holder Map's share card: GET /api/holders/:chain/:token/card.png, 1200 x 630.
//
// Drawn the way the blog's share images are (og.mjs): calls on og.mjs's SvgContext record an SVG in the
// card fonts (Barlow Condensed 800, IBM Plex Mono 500, measured from the font files), the HolderMaps kit lockup
// is embedded from public/brand/holdermaps (the Holder Map is the HolderMaps product, on every host), and resvg
// (WebAssembly) turns it into a PNG. Every figure on the card is the map's own (summary, forensics, asOf); bubbles are
// the mapped wallets sized by share, laid out deterministically so the same map gives the same picture.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadFonts, loadResvg, SvgContext } from './og.mjs'
import { encodeJpeg } from './holders-jpeg.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const W = 1200
const H = 630
// The HolderMaps kit tokens (brand-kit CLAUDE_INTEGRATION_PROMPT.md section 6; src/holdermaps/hm.css) under the card's
// old names: ink, carbon, yellow, yellow-hi, white; muted/dim are hm.css's greys; moss (deployer) is a data colour.
const K = { night: '#0A0A0A', midnight: '#161616', slate: '#333333', bone: '#FFFFFF', gold: '#FFD52E', pale: '#FFE03A', muted: '#B3B3B3', dim: '#9A9A9A', moss: '#3c553b' }
/** The kit lockup (brand-kit logo/holdermaps-logo-on-dark-sm.png, transparent, 744 x 154), drawn at its own ratio. */
const LOGO = { file: 'holdermaps-logo-on-dark-sm.png', w: 744, h: 154 }
const INFRA = new Set(['pool', 'lock', 'burn', 'token', 'deepcore', 'router', 'gully', 'exchange'])

const firstFile = (...c) => c.find((p) => p && fs.existsSync(p)) ?? null
let logo
function logoUri() {
  if (logo !== undefined) return logo
  const rel = ['brand', 'holdermaps', LOGO.file]
  const p = firstFile(process.env.DIST_DIR && path.join(process.env.DIST_DIR, ...rel), path.join(HERE, 'dist', ...rel), path.join(HERE, '..', 'public', ...rel))
  logo = p ? `data:image/png;base64,${fs.readFileSync(p).toString('base64')}` : null
  return logo
}
/** The lockup top left of the text column, 300 px wide. */
function drawLogo(ctx, x, y) {
  const m = logoUri()
  if (m) ctx.out.push(`<image x="${x}" y="${y}" width="300" height="${Math.round((300 * LOGO.h) / LOGO.w)}" href="${m}"/>`)
}

/** Deterministic bubble layout: biggest in the middle, the rest on a golden-angle spiral, then pushed apart. */
export function layoutBubbles(nodes, { cx, cy, rMax, rMin, box }) {
  const maxPct = Math.max(...nodes.map((n) => n.pct ?? 0), 0.0001)
  const placed = nodes.map((n, i) => {
    const r = Math.max(rMin, rMax * Math.sqrt((n.pct ?? 0) / maxPct))
    const a = i * 2.39996
    const d = i === 0 ? 0 : 26 * Math.sqrt(i) + rMax * 0.35
    return { n, r, x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d }
  })
  for (let pass = 0; pass < 120; pass++) {
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const p = placed[i]
        const q = placed[j]
        const dx = q.x - p.x
        const dy = q.y - p.y
        const dist = Math.hypot(dx, dy) || 0.01
        const min = p.r + q.r + 3
        if (dist < min) {
          const push = (min - dist) / 2
          const ux = dx / dist
          const uy = dy / dist
          p.x -= ux * push
          p.y -= uy * push
          q.x += ux * push
          q.y += uy * push
        }
      }
    }
    for (const p of placed) {
      p.x = Math.min(box.x1 - p.r, Math.max(box.x0 + p.r, p.x))
      p.y = Math.min(box.y1 - p.r, Math.max(box.y0 + p.r, p.y))
    }
  }
  return placed
}

/** Wraps text to lines no wider than `w` in the context's current font. */
function wrap(ctx, text, w, max) {
  const words = String(text).split(/\s+/)
  const lines = []
  let cur = ''
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word
    if (ctx.measureText(next).width > w && cur) {
      lines.push(cur)
      cur = word
    } else cur = next
  }
  if (cur) lines.push(cur)
  if (lines.length > max) {
    const kept = lines.slice(0, max)
    kept[max - 1] = kept[max - 1].replace(/\s*\S*$/, '') + '…'
    return kept
  }
  return lines
}

/** The card as SVG. */
export function renderHolderCardSvg(map) {
  const ctx = new SvgContext(W, H, loadFonts())
  ctx.fillStyle = K.night
  ctx.fillRect(0, 0, W, H)
  // A quiet lab grid.
  ctx.strokeStyle = K.midnight
  ctx.lineWidth = 1
  for (let x = 40; x < W; x += 40) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, H)
    ctx.stroke()
  }
  for (let y = 30; y < H; y += 40) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y)
    ctx.stroke()
  }

  // Bubbles (left 600 px).
  const nodes = (map.nodes ?? []).slice(0, 36)
  const placed = layoutBubbles(nodes, { cx: 300, cy: 315, rMax: 118, rMin: 7, box: { x0: 30, y0: 30, x1: 580, y1: 600 } })
  const at = new Map(placed.map((p) => [p.n.id, p]))
  ctx.strokeStyle = K.gold
  ctx.globalAlpha = 0.55
  ctx.lineWidth = 1.5
  for (const l of map.links ?? []) {
    const a = at.get(l.source)
    const b = at.get(l.target)
    if (!a || !b) continue
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  const big = map.clusters?.[0]?.id ?? null
  for (const p of placed) {
    const infra = INFRA.has(p.n.label?.kind)
    const inBig = big && p.n.cluster === big
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
    ctx.fillStyle = infra ? K.slate : inBig ? K.gold : p.n.cluster ? K.pale : p.n.label?.kind === 'deployer' ? K.moss : K.midnight
    ctx.globalAlpha = infra ? 0.9 : p.n.cluster ? 0.85 : 1
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = infra ? K.dim : p.n.cluster ? K.pale : K.muted
    ctx.lineWidth = 1.5
    ctx.stroke()
    if (p.r >= 30) {
      ctx.font = `500 ${Math.min(22, Math.round(p.r / 2.6))}px "IBM Plex Mono"`
      ctx.fillStyle = infra || !p.n.cluster ? K.bone : K.night
      const t = `${p.n.pct < 0.1 ? '<0.1' : p.n.pct >= 10 ? Math.round(p.n.pct) : p.n.pct.toFixed(1)}%`
      ctx.textBaseline = 'middle'
      ctx.fillText(t, p.x - ctx.measureText(t).width / 2, p.y)
      // Big pools, locks and burns say what they are.
      if (infra && p.r >= 56 && p.n.label?.name) {
        ctx.font = '500 13px "IBM Plex Mono"'
        ctx.fillStyle = K.muted
        const name = p.n.label.name.length > 22 ? p.n.label.name.slice(0, 21) + '…' : p.n.label.name
        ctx.fillText(name, p.x - ctx.measureText(name).width / 2, p.y + 24)
      }
      ctx.textBaseline = 'alphabetic'
    }
  }

  // Text column (right).
  const X = 640
  const TW = W - X - 50
  drawLogo(ctx, X - 4, 36)
  ctx.font = '500 16px "IBM Plex Mono"'
  ctx.fillStyle = K.gold
  ctx.fillText('HOLDER MAP', X, 118)
  ctx.font = '800 72px "Barlow Condensed"'
  ctx.fillStyle = K.bone
  const title = String(map.token?.symbol ?? map.token?.address?.slice(0, 10) ?? 'Token').slice(0, 14)
  ctx.fillText(title, X, 192)
  ctx.font = '500 18px "IBM Plex Mono"'
  ctx.fillStyle = K.muted
  ctx.fillText(`${map.kind === 'deepcore-launch' ? 'DeepCore launch' : map.kind === 'launch' ? `${map.venue ?? 'Launchpad'} launch` : map.kind === 'token' ? 'Token' : 'Stock token'} · ${map.chain?.name ?? ''}`, X, 226)
  ctx.font = '800 34px "Barlow Condensed"'
  ctx.fillStyle = K.pale
  let y = 284
  for (const line of wrap(ctx, map.summary?.line ?? '', TW, 3)) {
    ctx.fillText(line, X, y)
    y += 38
  }
  ctx.font = '500 18px "IBM Plex Mono"'
  ctx.fillStyle = K.bone
  y += 10
  const extra = map.forensics?.riskLine ?? map.summary?.plain?.find((p) => /premium|discount/.test(p)) ?? map.summary?.plain?.[1] ?? ''
  for (const line of wrap(ctx, extra, TW, 4)) {
    ctx.fillText(line, X, y)
    y += 26
  }
  ctx.font = '500 15px "IBM Plex Mono"'
  ctx.fillStyle = K.dim
  const asOf = map.asOf ? new Date(map.asOf).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : ''
  ctx.fillText(`As of ${asOf} · information only, not advice`, X, 566)
  ctx.fillStyle = K.gold
  ctx.fillText('holdermaps.xyz', X, 592)
  return ctx.toSvg()
}

/**
 * The card for a token with no map to draw (chain source not set up yet, not a mapped token, or a read
 * that failed): the kit's wordmark and mascot, the token and chain, and a plain "coming soon" line. Share
 * previews always get a real image, never JSON.
 */
export function renderHolderStatusCardSvg(body = {}) {
  const ctx = new SvgContext(W, H, loadFonts())
  ctx.fillStyle = K.night
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = K.midnight
  ctx.lineWidth = 1
  for (let x = 40; x < W; x += 40) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, H)
    ctx.stroke()
  }
  for (let y = 30; y < H; y += 40) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y)
    ctx.stroke()
  }
  // Placeholder rings where the bubbles will be: outlines only, so nothing reads as data.
  const rings = [[300, 300, 120], [170, 420, 64], [440, 200, 56], [420, 450, 44], [160, 190, 38], [300, 520, 26], [520, 330, 30]]
  ctx.lineWidth = 2
  for (const [x, y, r] of rings) {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.strokeStyle = K.slate
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.arc(300, 300, 10, 0, Math.PI * 2)
  ctx.fillStyle = K.gold
  ctx.fill()

  const X = 640
  const TW = W - X - 50
  drawLogo(ctx, X - 4, 36)
  ctx.font = '500 16px "IBM Plex Mono"'
  ctx.fillStyle = K.gold
  ctx.fillText('HOLDER MAP', X, 118)
  ctx.font = '800 72px "Barlow Condensed"'
  ctx.fillStyle = K.bone
  const title = String(body.token?.symbol ?? (body.token?.address ? `${String(body.token.address).slice(0, 6)}…${String(body.token.address).slice(-4)}` : 'Holder Map')).slice(0, 14)
  ctx.fillText(title, X, 192)
  ctx.font = '500 18px "IBM Plex Mono"'
  ctx.fillStyle = K.muted
  if (body.chain?.name) ctx.fillText(body.chain.name, X, 226)
  ctx.font = '800 44px "Barlow Condensed"'
  ctx.fillStyle = K.pale
  const head = body.state === 'not-found' ? 'NO MAP FOR THIS TOKEN' : body.comingSoon ? 'MAP COMING SOON' : 'MAP NOT READY YET'
  ctx.fillText(head, X, 300)
  ctx.font = '500 18px "IBM Plex Mono"'
  ctx.fillStyle = K.bone
  const line = body.state === 'not-found' ? 'The Holder Map covers DeepCore launches and the tokenised stocks the tracker follows.' : body.comingSoon ? `Holder data for ${body.chain?.name ?? 'this chain'} is coming soon. DeepCore launches already have live maps.` : 'The holders could not be read just now. Open the page to try again.'
  let y = 346
  for (const l of wrap(ctx, line, TW, 4)) {
    ctx.fillText(l, X, y)
    y += 26
  }
  ctx.font = '500 15px "IBM Plex Mono"'
  ctx.fillStyle = K.dim
  ctx.fillText('Information only, not advice', X, 566)
  ctx.fillStyle = K.gold
  ctx.fillText('holdermaps.xyz', X, 592)
  return ctx.toSvg()
}

const toPng = async (svg) => {
  const { Resvg } = await loadResvg()
  const r = new Resvg(svg, { fitTo: { mode: 'original' }, font: { fontBuffers: loadFonts().map((f) => new Uint8Array(f.buf)), loadSystemFonts: false, defaultFontFamily: 'IBM Plex Mono' }, shapeRendering: 2, textRendering: 1 })
  const img = r.render()
  const png = Buffer.from(img.asPng())
  img.free()
  r.free()
  return png
}

/** An SVG as JPEG bytes (Telegram's inline photo results must be JPEG): resvg's pixels through the small encoder. */
async function toJpeg(svg) {
  const { Resvg } = await loadResvg()
  const r = new Resvg(svg, { fitTo: { mode: 'original' }, font: { fontBuffers: loadFonts().map((f) => new Uint8Array(f.buf)), loadSystemFonts: false, defaultFontFamily: 'IBM Plex Mono' }, shapeRendering: 2, textRendering: 1 })
  const img = r.render()
  const jpg = encodeJpeg(img.pixels, img.width, img.height)
  img.free()
  r.free()
  return jpg
}

/** The "coming soon / not ready" card as JPEG bytes. */
export const renderHolderStatusCardJpeg = (body) => toJpeg(renderHolderStatusCardSvg(body))

/** The map's card as JPEG bytes. */
export const renderHolderCardJpeg = (map) => toJpeg(renderHolderCardSvg(map))

/** The "coming soon / not ready" card as PNG bytes. */
export const renderHolderStatusCard = (body) => toPng(renderHolderStatusCardSvg(body))

/** The site's static share image, the last resort when a card cannot be drawn at all (null if missing). */
export function fallbackCardPng() {
  const p = firstFile(process.env.DIST_DIR && path.join(process.env.DIST_DIR, 'social', 'og-image-1200x630.png'), path.join(HERE, 'dist', 'social', 'og-image-1200x630.png'), path.join(HERE, '..', 'public', 'social', 'og-image-1200x630.png'))
  return p ? fs.readFileSync(p) : null
}

/** The JPEG route has no static last resort (the site's share image is a PNG): null makes it answer 503. */
export const fallbackCardJpeg = () => null

/** The card as PNG bytes. */
export async function renderHolderCard(map) {
  const { Resvg } = await loadResvg()
  const r = new Resvg(renderHolderCardSvg(map), { fitTo: { mode: 'original' }, font: { fontBuffers: loadFonts().map((f) => new Uint8Array(f.buf)), loadSystemFonts: false, defaultFontFamily: 'IBM Plex Mono' }, shapeRendering: 2, textRendering: 1 })
  const img = r.render()
  const png = Buffer.from(img.asPng())
  img.free()
  r.free()
  return png
}
