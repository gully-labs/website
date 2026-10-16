// Company logos for tickers whose token carries no company mark (Robinhood's stock tokens all use
// Robinhood's feather). Each is the company's OWN site icon: the largest apple-touch-icon or icon
// its homepage declares, else /apple-touch-icon.png, else /favicon.ico. Written to
// public/tokens/logos/<TICKER>.<ext>, with the source recorded in public/tokens/logos/SOURCES.json.
import fs from 'node:fs'

const DOMAINS = {
  NVDA: 'nvidia.com', SPCX: 'spacex.com', META: 'https://investor.atmeta.com/', GME: 'https://investor.gamestop.com/', USO: 'uscfinvestments.com',
  TSLA: 'tesla.com', CLSK: 'cleanspark.com', IONQ: 'ionq.com', ASML: 'asml.com', DELL: 'dell.com',
  RGTI: 'rigetti.com', RKLB: 'rocketlabcorp.com', MSTR: 'strategy.com', TSM: 'https://www.tsmc.com/english', BABA: 'alibabagroup.com',
  EWY: 'ishares.com', NBIS: 'nebius.com', MSFT: 'microsoft.com', AAPL: 'apple.com', AMD: 'amd.com',
  SLV: 'ishares.com', CRCL: 'circle.com', CRWV: 'coreweave.com', GOOGL: 'google.com', PLTR: 'palantir.com',
  INTC: 'intel.com', QQQ: 'invesco.com', AMZN: 'amazon.com', ORCL: 'oracle.com', MU: 'micron.com',
  SNDK: 'sandisk.com', SPY: 'ssga.com', COIN: 'coinbase.com',
}
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', accept: 'text/html,image/*,*/*' }
const dir = 'public/tokens/logos'
fs.mkdirSync(dir, { recursive: true })
const prev = fs.existsSync(`${dir}/SOURCES.json`) ? JSON.parse(fs.readFileSync(`${dir}/SOURCES.json`, 'utf8')) : {}
const only = process.argv.slice(2)

async function get(url, ms = 15000) {
  return fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(ms) })
}
function candidates(html, base) {
  const out = []
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0]
    const rel = /rel=["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() ?? ''
    if (!/icon/.test(rel) || /mask-icon/.test(rel)) continue
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1]
    if (!href) continue
    const size = Number(/sizes=["'](\d+)x/i.exec(tag)?.[1] ?? (/apple-touch/.test(rel) ? 180 : /\.svg/i.test(href) ? 512 : 32))
    try { out.push({ url: new URL(href.replace(/&amp;/g, '&'), base).href, size }) } catch {}
  }
  return out.sort((a, b) => b.size - a.size)
}
const extOf = (type, url) => (type.includes('svg') ? 'svg' : type.includes('png') ? 'png' : type.includes('jpeg') ? 'jpg' : type.includes('webp') ? 'webp' : /\.ico/.test(url) || type.includes('icon') ? 'ico' : null)

const sources = { ...prev }
for (const [ticker, domain] of Object.entries(DOMAINS)) {
  if (only.length && !only.includes(ticker)) continue
  // A logo saved by hand (prev[ticker].note says why) is kept unless the ticker is named on the command line.
  if (!only.length && prev[ticker]?.note) { console.log(ticker.padEnd(5), 'kept (saved by hand)'); continue }
  let list = []
  let base = domain.includes('/') ? domain : `https://www.${domain}/`
  try {
    const r = await get(base)
    base = r.url
    if (r.ok) list = candidates(await r.text(), base)
  } catch {}
  list.push({ url: new URL('/apple-touch-icon.png', base).href, size: 180 }, { url: new URL('/favicon.ico', base).href, size: 16 })
  let saved = null
  for (const c of list) {
    try {
      const r = await get(c.url)
      if (!r.ok) continue
      const type = r.headers.get('content-type') ?? ''
      const ext = extOf(type, c.url)
      if (!ext) continue
      const buf = Buffer.from(await r.arrayBuffer())
      if (buf.length < 100) continue
      for (const e of ['svg', 'png', 'jpg', 'webp', 'ico']) fs.rmSync(`${dir}/${ticker}.${e}`, { force: true })
      fs.writeFileSync(`${dir}/${ticker}.${ext}`, buf)
      saved = { ticker, file: `/tokens/logos/${ticker}.${ext}`, from: c.url, site: domain, declaredSize: c.size, fetchedAt: new Date().toISOString() }
      break
    } catch {}
  }
  if (saved) sources[ticker] = saved
  console.log(ticker.padEnd(5), saved ? `${saved.file.split('/').pop()}  ${saved.from}` : 'NONE')
}
fs.writeFileSync(`${dir}/SOURCES.json`, JSON.stringify(sources, null, 2) + '\n')
