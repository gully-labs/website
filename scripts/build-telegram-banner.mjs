// Builds the Telegram bot's /start banner: public/brand/telegram/banner.gif (640×320, a seamless loop).
//
//   node scripts/build-telegram-banner.mjs [--frames out-dir]
//
// The banner is drawn as HTML/SVG with the brand's own fonts, one frame at a time from a time value
// (render(t), so every frame is exact and the loop closes), captured with Playwright's Chromium and
// encoded with gifenc (MIT, pure JS): one global palette, and pixels unchanged since the previous
// frame written as transparent, which keeps the file small. The ticker strip shows symbols and a LIVE
// pulse only: a GIF cannot stay current, so it carries no figures. --frames also saves frame 0 as PNG.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { PNG } from 'pngjs'
import gifenc from 'gifenc'

const { GIFEncoder, quantize, applyPalette } = gifenc
const root = process.cwd()
const W = 640
const H = 320
const FRAMES = 50
const DELAY_MS = 60 // 50 × 60 ms = 3.0 s, 16.7 fps
const LOOP_S = (FRAMES * DELAY_MS) / 1000
const out = path.join(root, 'public/brand/telegram/banner.gif')
const framesDir = process.argv.includes('--frames') ? process.argv[process.argv.indexOf('--frames') + 1] : null

// Fonts inline as data: URLs (a page set with setContent cannot load file: URLs).
const font = (pkg, file) => `data:font/woff2;base64,${fs.readFileSync(path.join(root, 'node_modules/@fontsource', pkg, 'files', file)).toString('base64')}`
const stocks = (f) => JSON.parse(fs.readFileSync(path.join(root, 'server/data', f), 'utf8')).stocks.map((s) => s.ticker)
// Illustrative symbols from the tracker's own tables (no numbers: the GIF is static).
const TICKERS = [...new Set([...stocks('robinhood-stocks.json'), ...stocks('bsc-stocks.json')])].slice(0, 14)

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Barlow;font-weight:800;src:url(${font('barlow-condensed', 'barlow-condensed-latin-800-normal.woff2')})}
@font-face{font-family:Barlow;font-weight:700;src:url(${font('barlow-condensed', 'barlow-condensed-latin-700-normal.woff2')})}
@font-face{font-family:Plex;font-weight:500;src:url(${font('ibm-plex-mono', 'ibm-plex-mono-latin-500-normal.woff2')})}
*{box-sizing:border-box;margin:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:#0B0E13}
body{position:relative;color:#EEF0F2;font-family:Plex}
.grid{position:absolute;inset:0;background-image:linear-gradient(#1a2029 1px,transparent 1px),linear-gradient(90deg,#1a2029 1px,transparent 1px);background-size:40px 40px;opacity:.55}
.glow{position:absolute;left:-60px;top:-80px;width:360px;height:360px;border-radius:50%;background:radial-gradient(circle,#E8C06022 0%,#0B0E1300 70%)}
.mark{position:absolute;left:40px;top:44px;width:132px;height:132px}
.word{position:absolute;left:200px;top:46px;font-family:Barlow;font-weight:800;font-size:22px;letter-spacing:2px}
.word b{color:#E8C060}
h1{position:absolute;left:198px;top:74px;font-family:Barlow;font-weight:800;font-size:64px;line-height:.95;text-transform:uppercase;letter-spacing:.5px;width:420px}
h1 em{font-style:normal;color:#E8C060}
.sub{position:absolute;left:200px;top:204px;font-size:13px;letter-spacing:1.5px;color:#8b96a5;text-transform:uppercase}
.strip{position:absolute;left:0;right:0;bottom:0;height:62px;background:#10141b;border-top:2px solid #E8C060}
.live{position:absolute;left:0;top:0;bottom:0;width:104px;background:#10141b;display:flex;align-items:center;gap:8px;padding-left:18px;z-index:2;font-size:14px;letter-spacing:2px;color:#E8C060;box-shadow:12px 0 14px #10141b}
.dot{width:12px;height:12px;border-radius:50%;background:#E8C060}
.ring{position:absolute;left:12px;top:19px;width:24px;height:24px;border-radius:50%;border:2px solid #E8C060}
.track{position:absolute;left:0;top:0;bottom:0;display:flex;align-items:center;white-space:nowrap;will-change:transform}
.chip{display:flex;align-items:center;gap:10px;padding:0 22px;font-family:Barlow;font-weight:700;font-size:26px;letter-spacing:1px;color:#EEF0F2}
.chip i{display:block;width:16px;height:2px;background:#E8C060}
.chip s{text-decoration:none;font-family:Plex;font-size:12px;color:#8b96a5;letter-spacing:1px}
</style></head><body>
<div class="grid"></div><div class="glow"></div>
<svg class="mark" viewBox="0 0 132 132" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F6DC92"/><stop offset=".55" stop-color="#E8C060"/><stop offset="1" stop-color="#B88F3A"/></linearGradient>
    <clipPath id="c"><rect x="6" y="6" width="120" height="120" rx="28"/></clipPath>
  </defs>
  <rect x="6" y="6" width="120" height="120" rx="28" fill="#141922" stroke="url(#g)" stroke-width="5"/>
  <path d="M92 44 A34 34 0 1 0 100 70 L100 66 L68 66" fill="none" stroke="url(#g)" stroke-width="15" stroke-linecap="square"/>
  <g clip-path="url(#c)"><rect id="shine" x="-60" y="-20" width="26" height="180" fill="#FFF6D8" opacity=".22" transform="rotate(20 66 66)"/></g>
</svg>
<div class="word">GULLY <b>LABS</b></div>
<h1>Fair price,<br><em>on chain</em></h1>
<div class="sub">Stock tokens vs their fair price</div>
<div class="strip">
  <div class="track" id="track"></div>
  <div class="live"><span class="ring" id="ring"></span><span class="dot"></span>LIVE</div>
</div>
<script>
  const T = ${JSON.stringify(TICKERS)}
  const set = T.map((t) => '<span class="chip">' + t + '<i></i><s>GAP</s></span>').join('')
  const track = document.getElementById('track')
  track.innerHTML = set + set + set
  let unit = 0
  window.ready = () => document.fonts.ready.then(() => { unit = track.scrollWidth / 3; return unit })
  window.render = (p) => { // p in [0, 1): one loop
    track.style.transform = 'translateX(' + (-(p * unit) + 104).toFixed(2) + 'px)'
    const pulse = (p * 2) % 1
    const ring = document.getElementById('ring')
    ring.style.transform = 'scale(' + (0.5 + pulse * 1.1).toFixed(3) + ')'
    ring.style.opacity = (1 - pulse).toFixed(3)
    const s = Math.min(1, p / 0.45) // the shine crosses the mark in the first 45% of the loop
    document.getElementById('shine').setAttribute('x', (-60 + s * 230).toFixed(1))
  }
</script></body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
await page.setContent(html, { waitUntil: 'load' })
const unit = await page.evaluate(() => window.ready())
if (!unit) throw new Error('the ticker strip did not lay out')

const frames = []
for (let i = 0; i < FRAMES; i++) {
  await page.evaluate((p) => window.render(p), i / FRAMES)
  const png = PNG.sync.read(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: W, height: H } }))
  frames.push(new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length))
  if (i === 0 && framesDir) {
    fs.mkdirSync(framesDir, { recursive: true })
    fs.writeFileSync(path.join(framesDir, 'banner-frame0.png'), PNG.sync.write(png))
  }
}
await browser.close()

// One palette for the whole loop (every 5th frame sampled), with index 255 kept for "unchanged".
const sample = new Uint8Array(frames.filter((_, i) => i % 5 === 0).reduce((n, f) => n + f.length, 0))
let o = 0
for (const f of frames.filter((_, i) => i % 5 === 0)) {
  sample.set(f, o)
  o += f.length
}
const palette = quantize(sample, 255, { format: 'rgb565' })
while (palette.length < 255) palette.push([0, 0, 0])
palette.push([255, 0, 255]) // 255: transparent
const TRANSPARENT = 255

const gif = GIFEncoder()
let prev = null
frames.forEach((rgba, i) => {
  const index = applyPalette(rgba, palette.slice(0, 255), 'rgb565')
  const shown = index.slice()
  if (prev) for (let p = 0; p < index.length; p++) if (index[p] === prev[p]) index[p] = TRANSPARENT
  gif.writeFrame(index, W, H, { palette: i === 0 ? palette : undefined, delay: DELAY_MS, transparent: i > 0, transparentIndex: TRANSPARENT, dispose: 1, repeat: 0 })
  prev = shown
})
gif.finish()
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, gif.bytes())
if (framesDir) fs.copyFileSync(out, path.join(framesDir, 'banner.gif'))
const kb = (fs.statSync(out).size / 1024).toFixed(0)
console.log(`${path.relative(root, out)}: ${W}×${H}, ${FRAMES} frames at ${(1000 / DELAY_MS).toFixed(1)} fps, ${LOOP_S.toFixed(1)} s loop, ${kb} KB`)
