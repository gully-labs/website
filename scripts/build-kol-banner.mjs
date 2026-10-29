// Builds the KOL / launch announcement banner from the Gully Labs brand kit, as a seamless 7 s loop that
// RETIRED 2026-10-26: built the old frog banner. public/brand/telegram/banner.{mp4,gif} are now the 2026 kit OG image (social/og-image-1200x630.png) as a still clip; nothing to build.
console.error("retired"); process.exit(1)
// shows the product line-up and gullylabs.xyz:
//
//   marketing/kol/announce-1280x720.mp4      Telegram channel post (@GullyLabsNews), H.264, under 2 MB
//   marketing/kol/announce-1080x1080.mp4     X / Instagram square
//   marketing/kol/announce-1080x1920.mp4     stories (9:16; content kept out of the top and bottom 250 px)
//   marketing/kol/announce-*.gif             GIF fallbacks at half size, 15 fps
//   marketing/kol/announce-*-poster.png      frame 0 at full size
//   public/brand/kol/announce-1280x720.mp4   the Telegram cut, served at https://gullylabs.xyz/brand/kol/… so the
//   public/brand/kol/announce-1280x720-poster.png   admin channel composer can post it by URL
//
//   node scripts/build-kol-banner.mjs [--verify out-dir]   (ffmpeg on PATH, or FFMPEG=path/to/ffmpeg)
//
// Same method as scripts/build-telegram-banner.mjs: the kit's horizontal lockup SVG is inlined unchanged
// (only its provenance metadata dropped and its mascot <image> pointed at the -2x bust, so the bust is only
// ever scaled down), kit colours from scripts/brand-kit/tokens.css, kit fonts (Barlow Condensed 700 from
// @fontsource, JetBrains Mono 500 from the kit). Product icons are lucide (rendered from lucide-react), the
// Telegram glyph is the simple-icons path the site uses (src/components/SocialIcon.tsx). Every frame is drawn
// from t in [0, 1) in Playwright's Chromium at the output's own size (smaller sizes use CSS zoom, so text and
// paths rasterise natively, never upscaled), then encoded with ffmpeg.
//
// The loop: a gold highlight walks the twelve tiles once (each tile's intensity is a function of its circular
// distance from the walking head, so t = 1 meets t = 0), the 64 px background grid drifts by exactly one cell,
// and the glow behind the mascot pulses once. No figures: an animation cannot stay current.
//
// --verify <dir>: writes 1:1 side-by-sides of the lockup (the banner's crop beside the kit master rendered alone
// at the same size) and a pixel diff of the lockup layer against the master, per format.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Activity, ArrowLeftRight, BellRing, Boxes, ChartNoAxesCombined, CircleDollarSign, Layers, MousePointerClick, Orbit, Rocket, Sparkles } from 'lucide-react'
import { chromium } from 'playwright'

const root = process.cwd()
const kit = (f) => path.join(root, 'scripts/brand-kit', f)
const outDir = path.join(root, 'marketing/kol')
const pubDir = path.join(root, 'public/brand/kol')
const verifyDir = process.argv.includes('--verify') ? process.argv[process.argv.indexOf('--verify') + 1] : null
const previewDir = process.argv.includes('--preview') ? process.argv[process.argv.indexOf('--preview') + 1] : null
const FFMPEG = process.env.FFMPEG || 'ffmpeg'
const LOOP_S = 7

// Brand tokens (scripts/brand-kit/tokens.css). Only these colours are used.
const C = {
  night: '#0D141C',
  midnight: '#151D28',
  slate: '#2A3542',
  bone: '#F4F2EC',
  gold: '#D9B563',
  paleGold: '#F2D58A',
  muted: '#AEB5BE',
  dim: '#7D8794',
}

const b64 = (f) => fs.readFileSync(f).toString('base64')
const fontBarlow = `data:font/woff2;base64,${b64(path.join(root, 'node_modules/@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2'))}`
const fontMono = `data:font/woff2;base64,${b64(kit('jetbrains-mono-latin-500-normal.woff2'))}`
const bust = `data:image/png;base64,${b64(kit('gullylabs-mascot-bust-2x.png'))}`
// The kit's lockup, unchanged apart from dropping its provenance metadata and linking the -2x bust.
const lockupSvg = fs
  .readFileSync(kit('gullylabs-logo-horizontal-on-dark.svg'), 'utf8')
  .replace(/<metadata>[\s\S]*?<\/metadata>/, '')
  .replace(/ xmlns:c2pa="[^"]*"/, '')
  .replace(/((?:xlink:)?href)="gullylabs-mascot-bust\.png"/g, `$1="${bust}"`)
  .replace(/^<svg /, '<svg class="lockup" ')
if (!lockupSvg.includes(bust)) throw new Error('the lockup SVG no longer links gullylabs-mascot-bust.png')
const LOCKUP = { w: 1245, h: 439, mascotW: 460 } // the SVG's own viewBox and mascot image width

const lucide = (Icon) => renderToStaticMarkup(createElement(Icon, { size: 24, strokeWidth: 1.75, color: 'currentColor', 'aria-hidden': true }))
// Telegram: the simple-icons path from src/components/SocialIcon.tsx (lucide ships no brand marks).
const TELEGRAM = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>'

// The line-up, in the site's own words (src/content/site.ts, the landing's ProductConsole, server/telegram.mjs).
// Holder Map is in development (coming soon); the L3 is a roadmap item (docs.gullylabs.xyz/roadmap-l3).
const TILES = [
  { icon: lucide(Activity), label: 'Stock tracker', sub: 'Robinhood · BNB · Solana' },
  { icon: lucide(ArrowLeftRight), label: 'Swap', sub: 'From every stock page' },
  { icon: lucide(Rocket), label: 'Gully Core', sub: 'Gully Chain launchpad' },
  { icon: lucide(BellRing), label: 'Alerts', sub: 'Telegram or webhook' },
  { icon: lucide(Sparkles), label: 'Gully AI', sub: 'Answers, with sources' },
  { icon: lucide(ChartNoAxesCombined), label: 'Gully Analytics', sub: 'Wallet-aware analytics' },
  { icon: lucide(CircleDollarSign), label: 'Gully Pay', sub: 'Crypto checkout, pay links' },
  { icon: lucide(Boxes), label: 'Chain Kit', sub: 'Branded block explorers' },
  { icon: TELEGRAM, label: 'Telegram bot', sub: 'Bot + Mini App' },
  { icon: lucide(Orbit), label: 'Holder Map', sub: 'Who holds a token', badge: 'Soon' },
  { icon: lucide(Layers), label: 'Gully L3', sub: 'Arbitrum Orbit L3', badge: 'Roadmap' },
  { icon: lucide(MousePointerClick), label: 'gullylabs.xyz', sub: 'Try it live', cta: true },
]

// Layouts in design units (1 unit = 1 output pixel at full size). Lockup clear space (kit README): at least the
// wordmark cap height (119 of the SVG's 439 units) on every side of the lockup box.
const LAYOUTS = {
  wide: {
    W: 1280, H: 720,
    lockup: { x: 64, y: 44, w: 380 },
    tag: { right: 64, y: 72, size: 46, align: 'right', lines: ['Building the next gen', '<b>multi-chain dApps & tools</b>'] },
    grid: { x: 64, y: 222, w: 1152, h: 454, cols: 4, gap: 16 },
    tile: { pad: 18, icon: 40, label: 30, sub: 14, row: false },
  },
  square: {
    W: 1080, H: 1080,
    lockup: { x: (1080 - 520) / 2, y: 64, w: 520 },
    tag: { center: true, y: 300, size: 46, align: 'center', lines: ['Building the next gen <b>multi-chain dApps & tools</b>'] },
    grid: { x: 56, y: 392, w: 968, h: 632, cols: 3, gap: 16 },
    tile: { pad: 20, icon: 44, label: 32, sub: 15, row: false },
  },
  story: {
    W: 1080, H: 1920,
    lockup: { x: (1080 - 760) / 2, y: 260, w: 760 },
    tag: { center: true, y: 594, size: 64, align: 'center', lines: ['Building the next gen', '<b>multi-chain dApps & tools</b>'] },
    grid: { x: 72, y: 800, w: 936, h: 860, cols: 2, gap: 16 },
    tile: { pad: 22, icon: 52, label: 36, sub: 16, row: true },
  },
}

function html(L, zoom, { lockupOnly = false } = {}) {
  const s = L.lockup.w / LOCKUP.w
  const lockH = LOCKUP.h * s
  const glowD = LOCKUP.mascotW * s * 1.9
  const glowX = L.lockup.x + (LOCKUP.mascotW * s) / 2 - glowD / 2
  const glowY = L.lockup.y + lockH / 2 - glowD / 2
  const g = L.grid
  const rows = Math.ceil(TILES.length / g.cols)
  const tw = (g.w - (g.cols - 1) * g.gap) / g.cols
  const th = (g.h - (rows - 1) * g.gap) / rows
  const T = L.tile
  const tagPos = L.tag.center ? `left:0;width:${L.W}px;text-align:center` : `right:${L.tag.right}px;text-align:right`
  const tiles = TILES.map((tile, i) => {
    const x = g.x + (i % g.cols) * (tw + g.gap)
    const y = g.y + Math.floor(i / g.cols) * (th + g.gap)
    return `<div class="tile${tile.cta ? ' cta' : ''}" id="t${i}" style="left:${x}px;top:${y}px;width:${tw}px;height:${th}px">
  <div class="ic">${tile.icon}</div>
  <div class="tx"><div class="lb">${tile.label}</div><div class="sb">${tile.sub}</div></div>
  ${tile.badge ? `<div class="bd">${tile.badge}</div>` : ''}
</div>`
  }).join('\n')
  const hide = lockupOnly ? '.bg,.grid,.glow,.tag,.tile{display:none!important}html,body{background:transparent!important}' : ''
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'Barlow Condensed';font-weight:700;src:url(${fontBarlow}) format('woff2')}
@font-face{font-family:'JetBrains Mono';font-weight:500;src:url(${fontMono}) format('woff2')}
*{box-sizing:border-box;margin:0;padding:0}
html{zoom:${zoom}}
html,body{width:${L.W}px;height:${L.H}px;overflow:hidden;background:${C.night}}
body{position:relative;-webkit-font-smoothing:antialiased}
/* the kit's background treatment: --gl-bg, a 1 px grid in rgba(244,242,236,.035) and --gl-glow behind the mascot */
.bg{position:absolute;inset:0;background:radial-gradient(ellipse at 70% 40%,#1D2836 0%,#111923 50%,#0B1118 100%)}
.grid{position:absolute;left:-64px;top:-64px;width:${L.W + 128}px;height:${L.H + 128}px;background-image:linear-gradient(rgba(244,242,236,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(244,242,236,.035) 1px,transparent 1px);background-size:64px 64px}
.glow{position:absolute;left:${glowX}px;top:${glowY}px;width:${glowD}px;height:${glowD}px;border-radius:50%;background:radial-gradient(circle,rgba(217,181,99,.16) 0%,rgba(217,181,99,0) 65%)}
.lockup{position:absolute;left:${L.lockup.x}px;top:${L.lockup.y}px;width:${L.lockup.w}px;height:${lockH}px;display:block}
.tag{position:absolute;top:${L.tag.y}px;${tagPos};font:700 ${L.tag.size}px/0.92 'Barlow Condensed';text-transform:uppercase;color:${C.bone};letter-spacing:.01em}
.tag b{font-weight:700;color:${C.gold}}
/* cards: radius 16, no shadows (kit) */
.tile{position:absolute;border-radius:16px;border:1px solid ${C.slate};background:rgba(21,29,40,.86);padding:${T.pad}px;display:flex;${T.row ? 'flex-direction:row;align-items:center;gap:20px' : 'flex-direction:column;justify-content:space-between'};overflow:hidden}
.tile .ic{flex:none;width:${T.icon}px;height:${T.icon}px;border-radius:10px;display:grid;place-items:center;background:${C.night};border:1px solid ${C.slate};color:${C.muted}}
.tile .ic svg{width:${Math.round(T.icon * 0.55)}px;height:${Math.round(T.icon * 0.55)}px;display:block}
.tile .lb{font:700 ${T.label}px/0.92 'Barlow Condensed';text-transform:uppercase;color:${C.bone};letter-spacing:.01em;white-space:nowrap}
.tile .sb{margin-top:${Math.round(T.sub * 0.6)}px;font:500 ${T.sub}px/1.2 'JetBrains Mono';color:${C.muted};white-space:nowrap}
.tile .bd{position:absolute;top:${T.pad}px;right:${T.pad}px;font:500 ${Math.max(11, T.sub - 3)}px/1 'JetBrains Mono';letter-spacing:.14em;text-transform:uppercase;color:${C.gold};border:1px solid rgba(217,181,99,.45);border-radius:6px;padding:6px 8px}
.tile.cta{background:rgba(217,181,99,.10);border-color:rgba(217,181,99,.55)}
.tile.cta .lb{text-transform:none;font:500 ${Math.round(T.label * 0.78)}px/1 'JetBrains Mono';color:${C.gold};letter-spacing:.02em}
.tile.cta .ic{color:${C.gold}}
${hide}
</style></head><body>
<div class="bg"></div><div class="grid" id="grid"></div><div class="glow" id="glow"></div>
${lockupSvg}
<div class="tag">${L.tag.lines.join('<br>')}</div>
${tiles}
<script>
  const N = ${TILES.length}, TAU = Math.PI * 2
  const tiles = [...document.querySelectorAll('.tile')]
  const mix = (a, b, k) => { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return 'rgb(' + A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',') + ')' }
  window.ready = () => document.fonts.ready.then(() => document.fonts.check("700 20px 'Barlow Condensed'") && document.fonts.check("500 20px 'JetBrains Mono'"))
  window.render = (t) => {
    const head = t * N
    tiles.forEach((el, i) => {
      let d = Math.abs(head - i); d = Math.min(d, N - d)                 // circular distance in tiles
      const k = Math.pow(Math.max(0, 1 - d / 1.25), 2)                   // 0..1 highlight
      const cta = el.classList.contains('cta')
      el.style.borderColor = cta ? mix('${C.gold}', '${C.paleGold}', k) : mix('${C.slate}', '${C.gold}', k)
      el.style.transform = 'translateY(' + (-4 * k).toFixed(2) + 'px)'
      const ic = el.querySelector('.ic')
      ic.style.color = cta ? '${C.gold}' : mix('${C.muted}', '${C.gold}', k)
      ic.style.borderColor = mix('${C.slate}', '${C.gold}', k * 0.6)
      el.querySelector('.sb').style.color = mix('${C.muted}', '${C.bone}', k)
    })
    document.getElementById('grid').style.transform = 'translate(' + (64 * t).toFixed(3) + 'px,' + (64 * t).toFixed(3) + 'px)' // one cell per loop
    document.getElementById('glow').style.opacity = (0.8 + 0.2 * Math.cos(TAU * t)).toFixed(3)                               // the kit's glow pulse
  }
</script></body></html>`
}

/** The kit master alone, at the same size and position as in a layout (for --verify). */
function masterHtml(L, zoom) {
  const s = L.lockup.w / LOCKUP.w
  const master = fs.readFileSync(kit('gullylabs-logo-horizontal-on-dark.svg'), 'utf8').replace(/((?:xlink:)?href)="gullylabs-mascot-bust\.png"/g, `$1="${bust}"`)
  return `<!doctype html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0}html{zoom:${zoom}}html,body{width:${L.W}px;height:${L.H}px;overflow:hidden;background:transparent}
svg{position:absolute;left:${L.lockup.x}px;top:${L.lockup.y}px;width:${L.lockup.w}px;height:${LOCKUP.h * s}px;display:block}</style></head><body>${master}</body></html>`
}

function ffmpeg(args) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.error) throw new Error(`ffmpeg not runnable (${r.error.code}); install it or set FFMPEG=path/to/ffmpeg`)
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-kol-'))
const browser = await chromium.launch()

/** Renders one loop of a layout at an output width and frame rate into tmp/<name>/f0000.png ... */
async function capture(name, layout, outW, fps) {
  const L = LAYOUTS[layout]
  const zoom = outW / L.W
  const outH = Math.round(L.H * zoom)
  const page = await browser.newPage({ viewport: { width: outW, height: outH }, deviceScaleFactor: 1 })
  await page.setContent(html(L, zoom), { waitUntil: 'load' })
  if (!(await page.evaluate(() => window.ready()))) throw new Error('brand fonts did not load')
  // Nothing may overflow its tile: a label or line wider than its box would be clipped.
  const over = await page.evaluate(() => [...document.querySelectorAll('.tile')].filter((t) => [...t.querySelectorAll('.lb,.sb')].some((e) => e.getBoundingClientRect().right > t.getBoundingClientRect().right - 8) || t.scrollHeight > t.clientHeight + 1).map((t) => t.querySelector('.lb').textContent))
  if (over.length) throw new Error(`${name}: text overflows tiles: ${over.join(', ')}`)
  const dir = path.join(tmp, name)
  fs.mkdirSync(dir)
  const n = LOOP_S * fps
  for (let i = 0; i < n; i++) {
    await page.evaluate((t) => window.render(t), i / n)
    await page.screenshot({ path: path.join(dir, `f${String(i).padStart(4, '0')}.png`), clip: { x: 0, y: 0, width: outW, height: outH } })
  }
  await page.close()
  return { dir, pattern: path.join(dir, 'f%04d.png'), fps, w: outW, h: outH, n }
}

// H.264: yuv420p, BT.709 limited range (tagged), High profile, no audio, faststart (Telegram, X and Instagram all take it).
function mp4(src, out, crf) {
  ffmpeg(['-framerate', String(src.fps), '-i', src.pattern, '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryslow', '-tune', 'animation', '-crf', String(crf), '-profile:v', 'high', '-level', '4.1', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-an', '-movflags', '+faststart', out])
}
// GIF: one palette for the whole loop, ordered dither (stable from frame to frame), only the changed rectangle re-dithered.
function gif(src, out) {
  const pal = path.join(src.dir, 'palette.png')
  ffmpeg(['-framerate', String(src.fps), '-i', src.pattern, '-vf', 'palettegen=max_colors=256:stats_mode=full', pal])
  ffmpeg(['-framerate', String(src.fps), '-i', src.pattern, '-i', pal, '-lavfi', 'paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle', '-loop', '0', out])
}

/** --verify: the lockup layer of a layout against the kit master rendered alone, pixel for pixel, plus a side-by-side. */
async function verify(layout, outW) {
  const L = LAYOUTS[layout]
  const zoom = outW / L.W
  const outH = Math.round(L.H * zoom)
  const s = L.lockup.w / LOCKUP.w
  const clip = { x: Math.floor(L.lockup.x * zoom), y: Math.floor(L.lockup.y * zoom), width: Math.ceil(L.lockup.w * zoom) + 1, height: Math.ceil(LOCKUP.h * s * zoom) + 1 }
  const shot = async (content, transparent) => {
    const p = await browser.newPage({ viewport: { width: outW, height: outH }, deviceScaleFactor: 1 })
    await p.setContent(content, { waitUntil: 'load' })
    await p.evaluate(async () => {
      await document.fonts.ready
      if (typeof window.render === 'function') window.render(0)
    })
    const buf = await p.screenshot({ clip, omitBackground: transparent })
    await p.close()
    return buf
  }
  const ours = await shot(html(L, zoom, { lockupOnly: true }), true)
  const master = await shot(masterHtml(L, zoom), true)
  const inBanner = await shot(html(L, zoom), false)
  // Pixel diff in the browser (canvas), so no image library is needed.
  const p = await browser.newPage()
  const diff = await p.evaluate(async ([a, b]) => {
    const load = (u) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u })
    const [A, B] = await Promise.all([load(a), load(b)])
    const cv = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data }
    const da = cv(A), db = cv(B)
    let max = 0, n = 0
    for (let i = 0; i < da.length; i++) { const d = Math.abs(da[i] - db[i]); if (d > max) max = d; if (d > 2) n++ }
    return { w: A.width, h: A.height, sameSize: A.width === B.width && A.height === B.height, maxChannelDiff: max, channelsOver2: n }
  }, [`data:image/png;base64,${ours.toString('base64')}`, `data:image/png;base64,${master.toString('base64')}`])
  // Side-by-side: the banner's own crop (with its background) | the kit master on Lab Night, same size, 1:1.
  const sbs = await p.evaluate(async ([a, b]) => {
    const load = (u) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u })
    const [A, B] = await Promise.all([load(a), load(b)])
    const c = document.createElement('canvas'); c.width = A.width * 2 + 24; c.height = A.height
    const x = c.getContext('2d'); x.fillStyle = '#2A3542'; x.fillRect(0, 0, c.width, c.height)
    x.drawImage(A, 0, 0); x.fillStyle = '#0D141C'; x.fillRect(A.width + 24, 0, B.width, B.height); x.drawImage(B, A.width + 24, 0)
    return c.toDataURL('image/png').split(',')[1]
  }, [`data:image/png;base64,${inBanner.toString('base64')}`, `data:image/png;base64,${master.toString('base64')}`])
  await p.close()
  fs.writeFileSync(path.join(verifyDir, `lockup-${outW}x${outH}-side-by-side.png`), Buffer.from(sbs, 'base64'))
  return { layout: `${outW}x${outH}`, ...diff }
}

const OUT = [
  { name: 'wide', layout: 'wide', W: 1280, H: 720, crf: 20 },
  { name: 'square', layout: 'square', W: 1080, H: 1080, crf: 20 },
  { name: 'story', layout: 'story', W: 1080, H: 1920, crf: 20 },
]

if (previewDir) {
  // --preview <dir>: three stills per layout (t = 0, 1/3, 2/3) at full size, nothing encoded.
  fs.mkdirSync(previewDir, { recursive: true })
  for (const o of OUT) {
    const L = LAYOUTS[o.layout]
    const page = await browser.newPage({ viewport: { width: o.W, height: o.H }, deviceScaleFactor: 1 })
    await page.setContent(html(L, 1), { waitUntil: 'load' })
    await page.evaluate(() => window.ready())
    for (const t of [0, 1 / 3, 2 / 3]) {
      await page.evaluate((x) => window.render(x), t)
      await page.screenshot({ path: path.join(previewDir, `${o.name}-${Math.round(t * 100)}.png`) })
    }
    await page.close()
  }
  await browser.close()
  process.exit(0)
}

try {
  fs.mkdirSync(outDir, { recursive: true })
  fs.mkdirSync(pubDir, { recursive: true })
  const report = []
  for (const o of OUT) {
    const base = `announce-${o.W}x${o.H}`
    const full = await capture(`${o.name}-full`, o.layout, o.W, 30)
    mp4(full, path.join(outDir, `${base}.mp4`), o.crf)
    fs.copyFileSync(path.join(full.dir, 'f0000.png'), path.join(outDir, `${base}-poster.png`))
    fs.rmSync(full.dir, { recursive: true, force: true })
    const half = await capture(`${o.name}-half`, o.layout, o.W / 2, 15)
    gif(half, path.join(outDir, `${base}.gif`))
    fs.rmSync(half.dir, { recursive: true, force: true })
    for (const f of [`${base}.mp4`, `${base}.gif`, `${base}-poster.png`]) report.push(`marketing/kol/${f}: ${(fs.statSync(path.join(outDir, f)).size / 1024).toFixed(0)} KB`)
  }
  for (const f of ['announce-1280x720.mp4', 'announce-1280x720-poster.png']) fs.copyFileSync(path.join(outDir, f), path.join(pubDir, f))
  console.log(report.join('\n'))
  const tg = fs.statSync(path.join(outDir, 'announce-1280x720.mp4')).size
  if (tg >= 2 * 1024 * 1024) throw new Error(`announce-1280x720.mp4 is ${tg} bytes: the Telegram cut must stay under 2 MB`)
  if (verifyDir) {
    fs.mkdirSync(verifyDir, { recursive: true })
    const v = []
    for (const o of OUT) v.push(await verify(o.layout, o.W))
    fs.writeFileSync(path.join(verifyDir, 'lockup-diff.json'), JSON.stringify(v, null, 2))
    console.log(JSON.stringify(v))
    if (v.some((r) => !r.sameSize || r.maxChannelDiff > 0)) throw new Error('the lockup differs from the kit master')
  }
} finally {
  await browser.close().catch(() => {})
  fs.rmSync(tmp, { recursive: true, force: true })
}
