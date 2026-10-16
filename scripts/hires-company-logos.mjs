// Upgrades low-resolution company logos. Loads each company's homepage in Chromium, gathers every
// icon it declares (plus the conventional apple-touch-icon paths), and keeps the largest raster
// (>= 96 px) or an SVG. Usage: node scripts/hires-company-logos.mjs [TICKER ...]
import fs from 'node:fs'
import { chromium } from 'playwright'

const HOME = {
  AMD: 'https://www.amd.com/', AMZN: 'https://www.amazon.com/', ASML: 'https://www.asml.com/', EWY: 'https://www.ishares.com/us', SLV: 'https://www.ishares.com/us',
  GME: 'https://www.gamestop.com/', GOOGL: 'https://www.google.com/', NVDA: 'https://www.nvidia.com/', PLTR: 'https://www.palantir.com/', RKLB: 'https://www.rocketlabcorp.com/',
  SNDK: 'https://www.sandisk.com/', SPCX: 'https://www.spacex.com/', SPY: 'https://www.ssga.com/us/en/intermediary', TSLA: 'https://www.tesla.com/', TSM: 'https://www.tsmc.com/english',
  INTC: 'https://www.intel.com/', ORCL: 'https://www.oracle.com/', MSFT: 'https://www.microsoft.com/', BABA: 'https://www.alibabagroup.com/', META: 'https://www.meta.com/',
}
const dir = 'public/tokens/logos'
const sources = JSON.parse(fs.readFileSync(`${dir}/SOURCES.json`, 'utf8'))
const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(HOME)

function pngSize(buf) {
  if (buf.slice(1, 4).toString() === 'PNG') return buf.readUInt32BE(16)
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i < buf.length - 9; ) {
      if (buf[i] !== 0xff) return 0
      const m = buf[i + 1]
      if (m >= 0xc0 && m <= 0xc3) return buf.readUInt16BE(i + 7)
      i += 2 + buf.readUInt16BE(i + 2)
    }
  }
  if (buf.slice(8, 12).toString() === 'WEBP') return buf.slice(12, 16).toString() === 'VP8X' ? 1 + buf.readUIntLE(24, 3) : 0
  if (buf[0] === 0 && buf[2] === 1) return Math.max(...Array.from({ length: buf.readUInt16LE(4) }, (_, i) => buf[6 + 16 * i] || 256))
  return 0
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' })
for (const t of want) {
  const home = HOME[t]
  const page = await ctx.newPage()
  let links = []
  try {
    await page.goto(home, { waitUntil: 'domcontentloaded', timeout: 30000 })
    links = await page.$$eval('link[rel*="icon" i]', (els) => els.filter((e) => !/mask/i.test(e.rel)).map((e) => e.href))
  } catch {}
  const origin = new URL(page.url() || home).origin
  links.push(`${origin}/apple-touch-icon.png`, `${origin}/apple-touch-icon-precomposed.png`, `${origin}/apple-touch-icon-180x180.png`)
  let best = null
  for (const url of [...new Set(links)]) {
    try {
      const r = await page.request.get(url, { timeout: 20000 })
      if (!r.ok()) continue
      const type = r.headers()['content-type'] ?? ''
      const buf = await r.body()
      const svg = type.includes('svg') || buf.slice(0, 200).toString().includes('<svg')
      const size = svg ? 10000 : pngSize(buf)
      const ext = svg ? 'svg' : buf.slice(1, 4).toString() === 'PNG' ? 'png' : buf[0] === 0xff ? 'jpg' : buf.slice(8, 12).toString() === 'WEBP' ? 'webp' : 'ico'
      if (size >= 96 && (!best || size > best.size)) best = { url, size, ext, buf }
    } catch {}
  }
  await page.close()
  const have = sources[t]
  if (!best) { console.log(t.padEnd(5), 'no icon >= 96 px; kept', have?.file); continue }
  for (const e of ['svg', 'png', 'jpg', 'webp', 'ico']) fs.rmSync(`${dir}/${t}.${e}`, { force: true })
  fs.writeFileSync(`${dir}/${t}.${best.ext}`, best.buf)
  sources[t] = { ticker: t, file: `/tokens/logos/${t}.${best.ext}`, from: best.url, site: new URL(home).hostname.replace(/^www\./, ''), size: best.ext === 'svg' ? 'vector' : best.size, fetchedAt: new Date().toISOString(), note: 'largest icon the company homepage declares, read in Chromium (scripts/hires-company-logos.mjs)' }
  console.log(t.padEnd(5), best.ext === 'svg' ? 'SVG' : `${best.size}px`, best.url)
}
await browser.close()
fs.writeFileSync(`${dir}/SOURCES.json`, JSON.stringify(sources, null, 2) + '\n')
