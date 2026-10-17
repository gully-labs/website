// BSC only: Robinhood stock tokens all carry Robinhood's feather (see fetch-company-logos.mjs).
// Downloads each tracked stock token's logo once, from the token's own GeckoTerminal/CoinGecko
// listing, into public/tokens/<chain>/<address>.<ext>, and records where each came from in
// public/tokens/SOURCES.json. Re-run when a stock is added. The site serves these files itself.
import fs from 'node:fs'
import path from 'node:path'

const CHAINS = [
  { key: 'bsc', gecko: 'bsc', file: 'server/data/bsc-stocks.json' },
]
const out = 'public/tokens'
// Keep the hand-sourced coin marks (coin/ETH, coin/USDC…) that live in the same file.
const prev = fs.existsSync(path.join(out, 'SOURCES.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'SOURCES.json'), 'utf8')) : {}
const sources = Object.fromEntries(Object.entries(prev).filter(([k]) => k.startsWith('coin/')))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

for (const c of CHAINS) {
  const stocks = JSON.parse(fs.readFileSync(c.file, 'utf8')).stocks
  fs.mkdirSync(path.join(out, c.key), { recursive: true })
  for (let i = 0; i < stocks.length; i += 30) {
    const batch = stocks.slice(i, i + 30)
    const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/${c.gecko}/tokens/multi/${batch.map((s) => s.token).join(',')}`)
    if (!r.ok) throw new Error(`${c.key}: GeckoTerminal ${r.status}`)
    const { data } = await r.json()
    for (const t of data) {
      const addr = t.attributes.address.toLowerCase()
      const url = t.attributes.image_url
      const stock = batch.find((s) => s.token.toLowerCase() === addr)
      if (!stock || !url || /missing/.test(url)) continue
      const img = await fetch(url)
      if (!img.ok) continue
      const type = img.headers.get('content-type') ?? ''
      const ext = type.includes('svg') ? 'svg' : type.includes('webp') ? 'webp' : type.includes('jpeg') ? 'jpg' : 'png'
      const buf = Buffer.from(await img.arrayBuffer())
      if (buf.length < 200) continue
      fs.writeFileSync(path.join(out, c.key, `${addr}.${ext}`), buf)
      sources[`${c.key}/${addr}`] = { ticker: stock.ticker, file: `/tokens/${c.key}/${addr}.${ext}`, from: url.split('?')[0], listing: `https://www.geckoterminal.com/${c.gecko}/tokens/${addr}`, fetchedAt: new Date().toISOString() }
    }
    await sleep(2500)
  }
  console.log(c.key, Object.keys(sources).filter((k) => k.startsWith(c.key)).length, 'of', stocks.length)
}
fs.writeFileSync(path.join(out, 'SOURCES.json'), JSON.stringify(sources, null, 2) + '\n')
