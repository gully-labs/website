#!/usr/bin/env node
/* Brings the Gully Labs brand kit into the stack. Nothing brand-shaped is drawn by hand anywhere in
   this repository: every logo comes from the kit's own files, through this script.

     node scripts/brand-from-kit.mjs [path/to/design_handoff_gully_labs_brand_kit]

   The kit (source of truth): C:\Users\Admin\Desktop\GRAPHICS\Gully Labs\design_handoff_gully_labs_brand_kit
   (its README.md is the brand guide; the SVG wordmark is Barlow Condensed 700 outlined to paths, so no
   font is needed to render it anywhere).

   What it writes:
   - public/brand/            the kit masters, byte for byte: the SVGs (wordmark, horizontal and stacked
                              lockups, on dark and on light), the mascot bust PNG they link to (1x and 2x),
                              the wordmark PNGs, the mascot master render, the icon master, tokens, README.
   - src/components/brand/kit.generated.ts
                              the wordmark's paths, gradient stops and the lockups' geometry, read out of
                              the kit SVGs (and checked against them: the lockup files must be the wordmark
                              paths under one translate+scale, or this script fails).
   - server/brand.mjs         the same data for server-rendered pages (analytics SSO, blog share images).
   - ghost/theme/gully/assets/js/banner.js
                              the same data between the kit-wordmark markers (the blog's banners and share
                              images draw the wordmark from it).
   - ghost/theme/gully/partials/brand/wordmark.hbs
                              the inline wordmark for the blog theme (header, footer, menu, error page).
   - public/errors/*.html     the inline wordmark between the kit-wordmark markers (self-contained pages).
   Then it runs scripts/brand-icons.py, which downsizes the kit's icon master to the favicon set and the
   marks (never upscaled). */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const KIT = process.argv[2] || process.env.GULLY_BRAND_KIT || 'C:/Users/Admin/Desktop/GRAPHICS/Gully Labs/design_handoff_gully_labs_brand_kit'
if (!existsSync(join(KIT, 'svg', 'gullylabs-wordmark-on-dark.svg'))) {
  console.error(`brand kit not found at ${KIT} (pass the path, or set GULLY_BRAND_KIT)`)
  process.exit(2)
}
const OUT = join(root, 'public', 'brand')
mkdirSync(join(OUT, 'tokens'), { recursive: true })

/* ------------------------------------------------------------------ masters, byte for byte --- */

const MASTERS = [
  ['svg/gullylabs-wordmark-on-dark.svg', 'gullylabs-wordmark-on-dark.svg'],
  ['svg/gullylabs-wordmark-on-light.svg', 'gullylabs-wordmark-on-light.svg'],
  ['svg/gullylabs-logo-horizontal-on-dark.svg', 'gullylabs-logo-horizontal-on-dark.svg'],
  ['svg/gullylabs-logo-horizontal-on-light.svg', 'gullylabs-logo-horizontal-on-light.svg'],
  ['svg/gullylabs-logo-stacked-on-dark.svg', 'gullylabs-logo-stacked-on-dark.svg'],
  ['svg/gullylabs-logo-stacked-on-light.svg', 'gullylabs-logo-stacked-on-light.svg'],
  ['svg/gullylabs-mascot-bust.svg', 'gullylabs-mascot-bust.svg'],
  // The lockup SVGs link gullylabs-mascot-bust.png from their own folder: it has to sit next to them.
  ['png/transparent/gullylabs-mascot-bust.png', 'gullylabs-mascot-bust.png'],
  ['png/transparent/gullylabs-mascot-bust-2x.png', 'gullylabs-mascot-bust-2x.png'],
  ['png/transparent/gullylabs-wordmark-on-dark.png', 'gullylabs-wordmark-on-dark.png'],
  ['png/transparent/gullylabs-wordmark-on-dark-2x.png', 'gullylabs-wordmark-on-dark-2x.png'],
  ['png/transparent/gullylabs-wordmark-on-light.png', 'gullylabs-wordmark-on-light.png'],
  ['png/transparent/gullylabs-wordmark-on-light-2x.png', 'gullylabs-wordmark-on-light-2x.png'],
  ['png/mascot/gullylabs-mascot-00-scientist-1024.png', 'gullylabs-mascot-00-scientist-1024.png'],
  // The icon master: the kit's own instruction (CLAUDE_PROMPT.md) is to cut favicons and app icons from it.
  ['png/social/telegram/gullylabs-telegram-channel-640x640.png', 'gullylabs-mark-640.png'],
  ['tokens/tokens.css', 'tokens/tokens.css'],
  ['tokens/tokens.json', 'tokens/tokens.json'],
  ['README.md', 'README.md'],
]
for (const [from, to] of MASTERS) copyFileSync(join(KIT, from), join(OUT, to))

/* ------------------------------------------------------------------ read the wordmark --- */

const svgText = (f) => readFileSync(join(KIT, 'svg', f), 'utf8').replace(/<metadata>[\s\S]*?<\/metadata>/, '')
const num = (s) => Math.round(parseFloat(s) * 1000) / 1000

/** The paths, bar and gradients of a wordmark file. */
function readWordmark(file) {
  const s = svgText(file)
  const vb = s.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  const paths = [...s.matchAll(/<path fill="([^"]+)" d="([^"]+)"/g)].map((m) => ({ fill: m[1], d: m[2] }))
  const rect = s.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="url\(#(\w+)\)"/)
  const grads = Object.fromEntries(
    [...s.matchAll(/<linearGradient id="(\w+)" gradientUnits="userSpaceOnUse" x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)">([\s\S]*?)<\/linearGradient>/g)].map((m) => [
      m[1],
      { x1: num(m[2]), y1: num(m[3]), x2: num(m[4]), y2: num(m[5]), stops: [...m[6].matchAll(/<stop offset="([\d.]+)" stop-color="(#[0-9A-Fa-f]{6})"/g)].map((t) => [num(t[1]), t[2]]) },
    ]),
  )
  if (paths.length !== 2 || !rect || !vb) throw new Error(`${file}: unexpected structure`)
  const labsId = paths[1].fill.match(/url\(#(\w+)\)/)[1]
  return {
    width: num(vb[1]),
    height: num(vb[2]),
    gully: { fill: paths[0].fill, d: paths[0].d },
    labs: { d: paths[1].d, grad: grads[labsId] },
    bar: { x: num(rect[1]), y: num(rect[2]), width: num(rect[3]), height: num(rect[4]), grad: grads[rect[5]] },
  }
}

const dark = readWordmark('gullylabs-wordmark-on-dark.svg')
const light = readWordmark('gullylabs-wordmark-on-light.svg')
if (dark.gully.d !== light.gully.d || dark.labs.d !== light.labs.d) throw new Error('on-dark and on-light wordmarks differ in shape')

/**
 * A lockup file must be the mascot image plus the wordmark paths under one translate+scale. Finds
 * that transform from the first coordinates of the GULLY path and checks every coordinate with it.
 */
function readLockup(file) {
  const s = svgText(file)
  const vb = s.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)
  const img = s.match(/<image width="([\d.]+)" height="([\d.]+)" x="([\d.]+)" y="([\d.]+)" href="gullylabs-mascot-bust\.png"/)
  const paths = [...s.matchAll(/<path fill="[^"]+" d="([^"]+)"/g)].map((m) => m[1])
  const rect = s.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="url\(#\w+\)"/)
  if (!vb || !img || paths.length !== 2 || !rect) throw new Error(`${file}: unexpected structure`)
  const nums = (d) => d.match(/-?[\d.]+/g).map(Number)
  const a = nums(dark.gully.d)
  const b = nums(paths[0])
  if (a.length !== b.length) throw new Error(`${file}: GULLY path differs from the wordmark`)
  // x' = sx * x + tx (and y likewise): a least-squares fit over every coordinate, since both files
  // carry rounded numbers (the wordmark to 0.1, the lockups to 0.01).
  const fit = (parity) => {
    const xs = a.filter((_, k) => k % 2 === parity)
    const ys = b.filter((_, k) => k % 2 === parity)
    const mx = xs.reduce((t, v) => t + v, 0) / xs.length
    const my = ys.reduce((t, v) => t + v, 0) / ys.length
    let cov = 0
    let vr = 0
    xs.forEach((v, k) => {
      cov += (v - mx) * (ys[k] - my)
      vr += (v - mx) ** 2
    })
    const sc = cov / vr
    return [sc, my - sc * mx]
  }
  const [sx, tx] = fit(0)
  const [sy, ty] = fit(1)
  if (Math.abs(sx - sy) > 0.001) throw new Error(`${file}: non-uniform scale ${sx} / ${sy}`)
  const scale = Math.round(sx * 10000) / 10000
  const check = (from, to) => {
    const p = nums(from)
    const q = nums(to)
    for (let k = 0; k < p.length; k++) {
      const want = k % 2 ? scale * p[k] + ty : scale * p[k] + tx
      if (Math.abs(want - q[k]) > 0.05 * scale + 0.01) throw new Error(`${file}: coordinate ${k} is ${q[k]}, the wordmark under the transform gives ${want.toFixed(2)}`)
    }
  }
  check(dark.gully.d, paths[0])
  check(dark.labs.d, paths[1])
  const r = [num(rect[1]), num(rect[2]), num(rect[3]), num(rect[4])]
  const want = [scale * dark.bar.x + tx, scale * dark.bar.y + ty, scale * dark.bar.width, scale * dark.bar.height]
  want.forEach((w, k) => {
    if (Math.abs(w - r[k]) > 0.05 * scale + 0.01) throw new Error(`${file}: bar differs (${r[k]} vs ${w.toFixed(2)})`)
  })
  return {
    width: num(vb[1]),
    height: num(vb[2]),
    image: { x: num(img[3]), y: num(img[4]), width: num(img[1]), height: num(img[2]) },
    wordmark: { x: Math.round(tx * 100) / 100, y: Math.round(ty * 100) / 100, scale },
  }
}

const horizontal = readLockup('gullylabs-logo-horizontal-on-dark.svg')
const stacked = readLockup('gullylabs-logo-stacked-on-dark.svg')
readLockup('gullylabs-logo-horizontal-on-light.svg')
readLockup('gullylabs-logo-stacked-on-light.svg')

const KIT_DATA = {
  source: 'design_handoff_gully_labs_brand_kit (svg/), via scripts/brand-from-kit.mjs',
  wordmark: {
    width: dark.width,
    height: dark.height,
    gully: dark.gully.d,
    labs: dark.labs.d,
    bar: { x: dark.bar.x, y: dark.bar.y, width: dark.bar.width, height: dark.bar.height },
    fill: { dark: dark.gully.fill, light: light.gully.fill },
    labsGradient: { x1: dark.labs.grad.x1, y1: dark.labs.grad.y1, x2: dark.labs.grad.x2, y2: dark.labs.grad.y2, dark: dark.labs.grad.stops, light: light.labs.grad.stops },
    barGradient: { x1: dark.bar.grad.x1, y1: dark.bar.grad.y1, x2: dark.bar.grad.x2, y2: dark.bar.grad.y2, dark: dark.bar.grad.stops, light: light.bar.grad.stops },
  },
  lockups: { horizontal, stacked },
  bust: { width: 440, height: 420, src: '/brand/gullylabs-mascot-bust.png', src2x: '/brand/gullylabs-mascot-bust-2x.png' },
}

/* ------------------------------------------------------------------ the inline SVG --- */

/** The wordmark as inline SVG markup. `height` in CSS px (width follows the kit's ratio). Ids are prefixed so several can share a page. */
function wordmarkSvg({ height = 28, theme = 'dark', id = 'glk', attrs = '', title = 'Gully Labs' } = {}) {
  const w = KIT_DATA.wordmark
  const width = Math.round((height * w.width) / w.height * 100) / 100
  const stops = (list) => list.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')
  const lg = w.labsGradient
  const bg = w.barGradient
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.width} ${w.height}" width="${width}" height="${height}" role="img" aria-label="${title}" data-brand="kit" ${attrs}>` +
    `<title>${title}</title>` +
    `<defs><linearGradient id="${id}-labs" gradientUnits="userSpaceOnUse" x1="${lg.x1}" y1="${lg.y1}" x2="${lg.x2}" y2="${lg.y2}">${stops(lg[theme])}</linearGradient>` +
    `<linearGradient id="${id}-bar" gradientUnits="userSpaceOnUse" x1="${bg.x1}" y1="${bg.y1}" x2="${bg.x2}" y2="${bg.y2}">${stops(bg[theme])}</linearGradient></defs>` +
    `<path fill="${w.fill[theme]}" d="${w.gully}"/>` +
    `<path fill="url(#${id}-labs)" d="${w.labs}"/>` +
    `<rect x="${w.bar.x}" y="${w.bar.y}" width="${w.bar.width}" height="${w.bar.height}" fill="url(#${id}-bar)"/>` +
    `</svg>`
  )
}

/* ------------------------------------------------------------------ outputs --- */

const HEADER = 'Generated by scripts/brand-from-kit.mjs from the Gully Labs brand kit. Do not edit: run the script.'
const json = JSON.stringify(KIT_DATA, null, 2)

mkdirSync(join(root, 'src', 'components', 'brand'), { recursive: true })
writeFileSync(
  join(root, 'src', 'components', 'brand', 'kit.generated.ts'),
  `/* ${HEADER}
   The wordmark is the kit's outlined Barlow Condensed 700 paths (GULLY, LABS, the underline bar) in a
   ${dark.width} x ${dark.height} box; the lockups place the mascot bust and that wordmark exactly as the kit's SVGs do. */
export type KitTheme = 'dark' | 'light'
export type Stops = [number, string][]
export const KIT = ${json.replace(/"(\w+)":/g, '$1:')} as const
`,
)

writeFileSync(
  join(root, 'server', 'brand.mjs'),
  `// ${HEADER}
// The Gully Labs wordmark for server-rendered HTML and SVG (analytics SSO pages, blog share images).
export const KIT = ${json}

${wordmarkSvg.toString().replace('function wordmarkSvg', 'export function wordmarkSvg').replace('KIT_DATA.wordmark', 'KIT.wordmark')}
`,
)

// banner.js: the data between the markers; the drawing code around them is hand-written once.
const bannerPath = join(root, 'ghost', 'theme', 'gully', 'assets', 'js', 'banner.js')
const banner = readFileSync(bannerPath, 'utf8')
const START = '    /* kit-wordmark:start */'
const END = '    /* kit-wordmark:end */'
const bs = banner.indexOf(START)
const be = banner.indexOf(END)
if (bs < 0 || be < 0) throw new Error('banner.js: kit-wordmark markers missing')
const wm = KIT_DATA.wordmark
const bannerData =
  `${START}\n` +
  `    /* The kit wordmark (${HEADER.replace('Generated by', 'generated by')}) */\n` +
  `    var KIT_WORDMARK = ${JSON.stringify({ width: wm.width, height: wm.height, gully: wm.gully, labs: wm.labs, bar: wm.bar, fill: wm.fill, labsGradient: wm.labsGradient, barGradient: wm.barGradient })};\n`
writeFileSync(bannerPath, banner.slice(0, bs) + bannerData + banner.slice(be))

// Blog theme partial.
mkdirSync(join(root, 'ghost', 'theme', 'gully', 'partials', 'brand'), { recursive: true })
writeFileSync(
  join(root, 'ghost', 'theme', 'gully', 'partials', 'brand', 'wordmark.hbs'),
  `{{!-- ${HEADER}
     The Gully Labs wordmark, inline (the kit's outlined paths; no font needed). Sized by CSS: .gl-wordmark-svg --}}\n` +
    wordmarkSvg({ height: 26, theme: 'dark', id: 'glk-blog', attrs: 'class="gl-wordmark-svg" aria-hidden="true" focusable="false"' }).replace(' role="img" aria-label="Gully Labs"', '') +
    '\n',
)

// Error pages: between the HTML markers.
for (const f of ['1xxx.html', '5xx.html', 'offline.html']) {
  const p = join(root, 'public', 'errors', f)
  const html = readFileSync(p, 'utf8')
  const s = html.indexOf('<!-- kit-wordmark:start -->')
  const e = html.indexOf('<!-- kit-wordmark:end -->')
  if (s < 0 || e < 0) throw new Error(`${f}: kit-wordmark markers missing`)
  writeFileSync(p, html.slice(0, s) + '<!-- kit-wordmark:start -->' + wordmarkSvg({ height: 28, theme: 'dark', id: 'glk', attrs: 'class="logo"' }) + html.slice(e))
}

/* ------------------------------------------------------------------ icons --- */

const py = spawnSync('python', ['-I', join(root, 'scripts', 'brand-icons.py'), join(OUT, 'gullylabs-mark-640.png'), root], { stdio: 'inherit' })
if (py.status !== 0) throw new Error('brand-icons.py failed')

console.log(`brand kit in place: ${MASTERS.length} masters in public/brand, wordmark ${dark.width}x${dark.height}, lockups horizontal ${horizontal.width}x${horizontal.height} (wordmark at ${horizontal.wordmark.x},${horizontal.wordmark.y} x${horizontal.wordmark.scale}), stacked ${stacked.width}x${stacked.height} (x${stacked.wordmark.scale})`)
