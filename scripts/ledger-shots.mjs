// Screenshots of the home hero ledger from a built dist/, with /api/stats answered by a fixture shaped like production
// on 2026-10-19: every venue at $0 daily volume, TVL $72.3K, Peddles' history only on DefiLlama.
//
//   node scripts/ledger-shots.mjs <distDir> <outDir> <prefix> [--series]    (TEST_PORT, default 9461)
//
// --series adds the new `series` / `sources` / `lastActivity` fields (what the fixed server sends); without it the
// document is the old shape, so the same fixture draws the "before" picture with an old build.

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright'

const [distArg, outArg, prefix = 'ledger'] = process.argv.slice(2)
const withSeries = process.argv.includes('--series')
if (!distArg || !outArg) throw new Error('usage: node scripts/ledger-shots.mjs <distDir> <outDir> <prefix> [--series]')
const DIST = path.resolve(distArg)
const OUT = path.resolve(outArg)
fs.mkdirSync(OUT, { recursive: true })
const PORT = Number(process.env.TEST_PORT) || 9461

const DAY = 86400
const now = Date.now()
const today = Math.floor(now / 1000 / DAY) * DAY
const days = (n, f) => Array.from({ length: n }, (_, i) => ({ t: today - (n - 1 - i) * DAY, v: f(i) }))
const zeros = (n) => days(n, () => 0)

function stats() {
  const iso = new Date(now).toISOString()
  const tvl = (base) => days(40, (i) => Math.round(base * (0.9 + (i / 39) * 0.1 + Math.sin(i / 4) * 0.02)))
  const venue = (key, o) => ({ key, state: 'ok', volumeAllUsd: null, volumeAllSince: null, volume24hUsd: 0, tvlUsd: null, fees24hUsd: 0, feesAllUsd: null, daily: [], counts: {}, notes: [], source: { url: `https://${key}.example/api`, readAt: iso }, ...o })
  const v = [
    venue('deepcore', { daily: zeros(9), tvlUsd: 1200, volumeAllUsd: 0, volumeAllSince: iso, feesAllUsd: 2 }),
    venue('peddleswap', { daily: zeros(30), tvlUsd: 0, volume30dUsd: 0 }),
    venue('peddles', { tvlUsd: 70000, volumeAllUsd: 41000, feesAllUsd: 410, fees24hUsd: 0 }),
    venue('peddlequest', { tvlUsd: 1100, feesAllUsd: 22 }),
  ]
  if (withSeries) {
    const dl = { name: 'DefiLlama', url: 'https://api.llama.fi', fallback: true }
    const own = (n) => ({ name: n, url: `https://${n}.example`, fallback: false })
    const peddlesVol = days(60, (i) => (i < 48 ? 300 + ((i * 37) % 500) : 0))
    Object.assign(v[0], { series: { volume: zeros(9), fees: [], tvl: tvl(1200) }, sources: { volume: own('DeepCore API'), fees: null, tvl: dl }, lastActivity: null })
    Object.assign(v[1], { series: { volume: zeros(30), fees: [], tvl: [] }, sources: { volume: own('PeddleSwap API'), fees: null, tvl: null }, lastActivity: null })
    Object.assign(v[2], { daily: peddlesVol, series: { volume: peddlesVol, fees: peddlesVol.map((p) => ({ t: p.t, v: p.v / 100 })), tvl: tvl(70000) }, sources: { volume: dl, fees: dl, tvl: dl }, lastActivity: new Date((today - 12 * DAY) * 1000).toISOString() })
    Object.assign(v[3], { series: { volume: [], fees: days(40, (i) => (i % 5 === 0 ? 1.5 : 0)), tvl: tvl(1100) }, sources: { volume: null, fees: dl, tvl: dl }, lastActivity: null })
  }
  const covers = { volumeAllUsd: ['deepcore', 'peddles'], volume24hUsd: ['deepcore', 'peddleswap', 'peddles'], tvlUsd: v.map((x) => x.key), fees24hUsd: ['deepcore', 'peddleswap', 'peddles'], feesAllUsd: ['deepcore', 'peddles', 'peddlequest'] }
  return { generatedAt: iso, totals: { volumeAllUsd: 41000, volume24hUsd: 0, tvlUsd: 72300, fees24hUsd: 0, feesAllUsd: 434, covers, unread: [] }, daily: [], venues: v }
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json' }
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname.startsWith('/api/')) {
    res.writeHead(u.pathname === '/api/stats' ? 200 : 404, { 'content-type': 'application/json' })
    return res.end(u.pathname === '/api/stats' ? JSON.stringify(stats()) : '{}')
  }
  let f = path.join(DIST, u.pathname)
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html')
  res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' })
  fs.createReadStream(f).pipe(res)
})
await new Promise((r) => server.listen(PORT, r))

const browser = await chromium.launch()
try {
  for (const [width, mobile] of [[1440, false], [390, true]]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}), serviceWorkers: 'block' })
    await ctx.route(/^https?:\/\/(?!localhost[:/])/, (r) => r.abort())
    const page = await ctx.newPage()
    await page.goto(`http://localhost:${PORT}/`)
    const el = page.locator('#ledger')
    await el.scrollIntoViewIfNeeded()
    await page.waitForTimeout(2500)
    await el.screenshot({ path: path.join(OUT, `${prefix}-${width}.png`) })
    console.log('saved', `${prefix}-${width}.png`)
    if (withSeries) {
      const tab = page.getByRole('tab', { name: 'Volume' })
      if (await tab.count()) {
        await tab.click()
        await page.waitForTimeout(1500)
        await el.screenshot({ path: path.join(OUT, `${prefix}-${width}-volume-empty.png`) })
        console.log('saved', `${prefix}-${width}-volume-empty.png`)
      }
    }
    await ctx.close()
  }
} finally {
  await browser.close()
  server.close()
}
