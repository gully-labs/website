// Builds the Telegram bot's animated banner from the Gully Labs brand kit, as a seamless 6 s loop:
//
//   public/brand/telegram/banner.mp4                 1280×640 H.264, no audio: what the bot sends (sendAnimation)
//   public/brand/telegram/banner.gif                 640×320 GIF fallback (and the admin channel preview)
//   public/brand/telegram/banner-poster.png          1280×640, frame 0
//   public/brand/telegram/description-640x360.mp4    BotFather /setdescriptionpic (16:9)
//   public/brand/telegram/description-640x360.gif    the same as a GIF
//
//   node scripts/build-telegram-banner.mjs [--frames out-dir]   (ffmpeg on PATH, or FFMPEG=path/to/ffmpeg)
//
// Source of truth: the brand kit (GRAPHICS/Gully Labs/design_handoff_gully_labs_brand_kit), whose master
// files are copied unchanged into scripts/brand-kit/: the horizontal lockup SVG (outlined wordmark, LABS
// and bar gradients), the mascot bust (the -2x PNG, so it is only ever scaled down), tokens.css and
// JetBrains Mono 500. Barlow Condensed 700 comes from @fontsource. Nothing of the logo is redrawn: the SVG
// is inlined as is, with its mascot <image> pointed at the -2x bust.
//
// Every frame is drawn from a time value (render(t), t in [0, 1)) as HTML/SVG in Playwright's Chromium at
// the output's own size (smaller sizes use CSS zoom, so text and paths are rasterised natively, never
// upscaled), then encoded with ffmpeg: H.264 yuv420p BT.709 for MP4; palettegen + paletteuse (ordered
// dither, changed rectangle only) for GIF. The loop: two price lines scroll by exactly one period, the
// gap between the on-chain price and the fair price is shaded, and the gold glow behind the mascot
// pulses once. No figures: an animation cannot stay current.
//
// public/brand/telegram/userpic-640.png is the kit's Telegram channel avatar
// (png/social/telegram/gullylabs-telegram-channel-640x640.png), copied as is for BotFather /setuserpic.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright'

const root = process.cwd()
const kit = (f) => path.join(root, 'scripts/brand-kit', f)
const outDir = path.join(root, 'public/brand/telegram')
const framesArg = process.argv.includes('--frames') ? process.argv[process.argv.indexOf('--frames') + 1] : null
const FFMPEG = process.env.FFMPEG || 'ffmpeg'
const LOOP_S = 6

// Brand tokens (scripts/brand-kit/tokens.css). Only these colours are used.
const C = {
  night: '#0D141C',
  slate: '#2A3542',
  bone: '#F4F2EC',
  gold: '#D9B563',
  muted: '#AEB5BE',
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

// Layouts in design units (1 unit = 1 output pixel at full size). The 2:1 one is the bot banner, the 16:9
// one the BotFather description picture. Lockup clear space (kit README): at least the wordmark cap height (119
// units in the SVG, 61 px for the 640-wide lockup, 71 px for the 740-wide one) on every side, so the legend sits
// at least that far below the lockup box (the mascot image spans the full 439-unit height).
const LAYOUTS = {
  banner: { W: 1280, H: 640, lockup: { w: 640, y: 64 }, chart: { x: 96, y: 400, w: 1088, h: 96 }, tag: { y: 584, size: 52 } },
  description: { W: 1280, H: 720, lockup: { w: 740, y: 72 }, chart: { x: 96, y: 444, w: 1088, h: 104 }, tag: { y: 652, size: 58 } },
}

function html(L, zoom) {
  const s = L.lockup.w / LOCKUP.w
  const lockH = LOCKUP.h * s
  const lockX = (L.W - L.lockup.w) / 2
  const glowD = LOCKUP.mascotW * s * 1.9
  const glowX = lockX + (LOCKUP.mascotW * s) / 2 - glowD / 2
  const glowY = L.lockup.y + lockH / 2 - glowD / 2
  const { chart: c, tag } = L
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'Barlow Condensed';font-weight:700;src:url(${fontBarlow}) format('woff2')}
@font-face{font-family:'JetBrains Mono';font-weight:500;src:url(${fontMono}) format('woff2')}
*{box-sizing:border-box;margin:0;padding:0}
html{zoom:${zoom}}
html,body{width:${L.W}px;height:${L.H}px;overflow:hidden;background:${C.night}}
body{position:relative;-webkit-font-smoothing:antialiased}
/* the kit's background treatment: --gl-bg, a 1 px grid in rgba(244,242,236,.035) and --gl-glow behind the mascot */
.bg{position:absolute;inset:0;background:radial-gradient(ellipse at 70% 40%,#1D2836 0%,#111923 50%,#0B1118 100%)}
.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(244,242,236,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(244,242,236,.035) 1px,transparent 1px);background-size:64px 64px}
.glow{position:absolute;left:${glowX}px;top:${glowY}px;width:${glowD}px;height:${glowD}px;border-radius:50%;background:radial-gradient(circle,rgba(217,181,99,.16) 0%,rgba(217,181,99,0) 65%)}
.lockup{position:absolute;left:${lockX}px;top:${L.lockup.y}px;width:${L.lockup.w}px;height:${lockH}px;display:block}
.chart{position:absolute;left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;overflow:visible}
.legend{position:absolute;left:${c.x}px;top:${c.y - 40}px;display:flex;gap:32px;font:500 18px/1 'JetBrains Mono';letter-spacing:.14em;text-transform:uppercase;color:${C.muted}}
.legend span{display:flex;align-items:center;gap:10px}
.legend i{display:block;width:18px;height:3px;border-radius:2px}
.tag{position:absolute;left:${c.x}px;top:${tag.y}px;transform:translateY(-100%);font:700 ${tag.size}px/1 'Barlow Condensed';text-transform:uppercase;color:${C.bone};letter-spacing:.01em;white-space:nowrap}
.tag b{font-weight:700;color:${C.gold}}
.url{position:absolute;right:${L.W - c.x - c.w}px;top:${tag.y}px;transform:translateY(-100%);font:500 22px/1 'JetBrains Mono';letter-spacing:.14em;color:${C.gold};white-space:nowrap}
</style></head><body>
<div class="bg"></div><div class="grid"></div><div class="glow" id="glow"></div>
${lockupSvg}
<div class="legend"><span><i style="background:${C.bone}"></i>On-chain price</span><span><i style="background:${C.gold}"></i>Fair price</span></div>
<svg class="chart" viewBox="0 0 ${c.w} ${c.h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".16" stop-color="#fff" stop-opacity="1"/></linearGradient>
    <mask id="m" maskUnits="userSpaceOnUse" x="-20" y="-20" width="${c.w + 40}" height="${c.h + 40}"><rect x="-20" y="-20" width="${c.w + 40}" height="${c.h + 40}" fill="url(#fade)"/></mask>
  </defs>
  <line x1="0" y1="${c.h + 0.5}" x2="${c.w}" y2="${c.h + 0.5}" stroke="${C.slate}" stroke-width="1"/>
  <g mask="url(#m)">
    <path id="gap" fill="${C.gold}" fill-opacity=".2"/>
    <path id="fair" fill="none" stroke="${C.gold}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <path id="chain" fill="none" stroke="${C.bone}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  </g>
  <line id="cursor" y1="0" y2="${c.h}" stroke="${C.slate}" stroke-width="1" stroke-dasharray="3 5"/>
  <line id="bracket" stroke="${C.gold}" stroke-width="2"/>
  <circle id="dChain" r="6" fill="${C.bone}"/>
  <circle id="dFair" r="6" fill="${C.gold}"/>
  <text id="gapLabel" font-family="JetBrains Mono" font-weight="500" font-size="18" letter-spacing="2.5" fill="${C.gold}" dominant-baseline="central">GAP</text>
</svg>
<div class="tag">Fair price, <b>on chain.</b></div>
<div class="url">gullylabs.xyz</div>
<script>
  const W = ${c.w}, H = ${c.h}, HEAD = Math.round(W * 0.82), P = W, TAU = Math.PI * 2
  const mid = H * 0.6
  // Both series are periodic in u with period P, so scrolling by P per loop closes seamlessly.
  const fair = (u) => mid + 12 * Math.sin(TAU * u / P + 0.6) + 6 * Math.sin(TAU * 2 * u / P + 2.1) + 3 * Math.sin(TAU * 5 * u / P + 0.3)
  const gap = (u) => -(22 + 9 * Math.sin(TAU * 3 * u / P + 1.2) + 6 * Math.sin(TAU * 7 * u / P + 0.4)) // on-chain above fair, by a gap of 7 to 37 units
  const chain = (u) => fair(u) + gap(u)
  const f2 = (n) => n.toFixed(2)
  const el = (id) => document.getElementById(id)
  window.ready = () => document.fonts.ready.then(() => document.fonts.check("700 20px 'Barlow Condensed'") && document.fonts.check("500 20px 'JetBrains Mono'"))
  window.render = (t) => {
    const off = t * P
    const xs = []
    for (let x = 0; x <= HEAD; x += 2) xs.push(x)
    if (xs[xs.length - 1] !== HEAD) xs.push(HEAD)
    const fy = xs.map((x) => fair(x + off)), cy = xs.map((x) => chain(x + off))
    const line = (ys) => xs.map((x, i) => (i ? 'L' : 'M') + x + ' ' + f2(ys[i])).join('')
    el('fair').setAttribute('d', line(fy))
    el('chain').setAttribute('d', line(cy))
    el('gap').setAttribute('d', line(cy) + xs.slice().reverse().map((x, i) => 'L' + x + ' ' + f2(fy[fy.length - 1 - i])).join('') + 'Z')
    const yf = fy[fy.length - 1], yc = cy[cy.length - 1]
    for (const [id, y] of [['dFair', yf], ['dChain', yc]]) { el(id).setAttribute('cx', HEAD); el(id).setAttribute('cy', f2(y)) }
    el('cursor').setAttribute('x1', HEAD); el('cursor').setAttribute('x2', HEAD)
    const bx = HEAD + 22
    el('bracket').setAttribute('x1', bx); el('bracket').setAttribute('x2', bx)
    el('bracket').setAttribute('y1', f2(Math.min(yf, yc))); el('bracket').setAttribute('y2', f2(Math.max(yf, yc)))
    el('gapLabel').setAttribute('x', bx + 14); el('gapLabel').setAttribute('y', f2((yf + yc) / 2))
    el('glow').style.opacity = (0.8 + 0.2 * Math.cos(TAU * t)).toFixed(3) // the kit's glow pulse, once per loop
  }
</script></body></html>`
}

function ffmpeg(args) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] })
  if (r.error) throw new Error(`ffmpeg not runnable (${r.error.code}); install it or set FFMPEG=path/to/ffmpeg`)
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${args.join(' ')}`)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-banner-'))
const browser = await chromium.launch()

/** Renders one loop of a layout at an output width and frame rate into tmp/<name>/f0000.png ... */
async function capture(name, layout, outW, fps) {
  const L = LAYOUTS[layout]
  const zoom = outW / L.W
  const outH = Math.round(L.H * zoom)
  const page = await browser.newPage({ viewport: { width: outW, height: outH }, deviceScaleFactor: 1 })
  await page.setContent(html(L, zoom), { waitUntil: 'load' })
  if (!(await page.evaluate(() => window.ready()))) throw new Error('brand fonts did not load')
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

// H.264 for Telegram: yuv420p, BT.709 limited range (tagged), Main profile, no audio, faststart.
function mp4(src, out) {
  ffmpeg(['-framerate', String(src.fps), '-i', src.pattern, '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryslow', '-tune', 'animation', '-crf', '16', '-profile:v', 'main', '-level', '4.0', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-an', '-movflags', '+faststart', out])
}
// GIF: one palette for the whole loop, ordered dither (stable from frame to frame), and only the changed rectangle re-dithered.
function gif(src, out) {
  const pal = path.join(src.dir, 'palette.png')
  ffmpeg(['-framerate', String(src.fps), '-i', src.pattern, '-vf', 'palettegen=max_colors=256:stats_mode=full', pal])
  ffmpeg(['-framerate', String(src.fps), '-i', src.pattern, '-i', pal, '-lavfi', 'paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle', '-loop', '0', out])
}

try {
  fs.mkdirSync(outDir, { recursive: true })
  const banner30 = await capture('banner-1280', 'banner', 1280, 30)
  const banner25 = await capture('banner-640', 'banner', 640, 25)
  const desc30 = await capture('desc-640-30', 'description', 640, 30)
  const desc25 = await capture('desc-640-25', 'description', 640, 25)
  await browser.close()

  mp4(banner30, path.join(outDir, 'banner.mp4'))
  fs.copyFileSync(path.join(banner30.dir, 'f0000.png'), path.join(outDir, 'banner-poster.png'))
  gif(banner25, path.join(outDir, 'banner.gif'))
  mp4(desc30, path.join(outDir, 'description-640x360.mp4'))
  gif(desc25, path.join(outDir, 'description-640x360.gif'))

  if (framesArg) {
    fs.mkdirSync(framesArg, { recursive: true })
    for (const s of [banner30, banner25, desc30]) for (const i of [0, Math.round(s.n / 3), Math.round((2 * s.n) / 3)]) fs.copyFileSync(path.join(s.dir, `f${String(i).padStart(4, '0')}.png`), path.join(framesArg, `${path.basename(s.dir)}-f${String(i).padStart(4, '0')}.png`))
  }
  for (const f of ['banner.mp4', 'banner.gif', 'banner-poster.png', 'description-640x360.mp4', 'description-640x360.gif']) {
    const kb = (fs.statSync(path.join(outDir, f)).size / 1024).toFixed(0)
    console.log(`public/brand/telegram/${f}: ${kb} KB`)
  }
  const big = fs.statSync(path.join(outDir, 'banner.mp4')).size
  if (big >= 1024 * 1024) throw new Error(`banner.mp4 is ${big} bytes: Telegram wants under 1 MB`)
} finally {
  await browser.close().catch(() => {})
  fs.rmSync(tmp, { recursive: true, force: true })
}
