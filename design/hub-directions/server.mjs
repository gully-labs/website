// Gully Labs hub (gullylabs.xyz) landing previews: one dependency-free static server on three ports.
//   http://localhost:5260  picker (both directions side by side)
//   http://localhost:5261  Direction A "Constellation" (Gully Terminal)
//   http://localhost:5262  Direction B "The Gully stack" (editorial, light)
// Every number on both pages comes from a real public endpoint, fetched through /live/<name> on the same origin so
// that CORS never blocks localhost (Gully Pay and Gully RPC send no Access-Control-Allow-Origin for localhost).
// Responses are cached 20 s here so two open previews do not double the load on the sources.
// The contact form posts to /api/contact, forwarded to the LIVE gullylabs.xyz intake (it reaches the operators'
// Telegram chat) only when CONTACT_LIVE=1; otherwise the preview answers { ok: true, preview: true } and sends nothing.
// Run: node server.mjs
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const SITES = { 5260: 'picker', 5261: 'a', 5262: 'b' }
const HUB = process.env.HUB_ORIGIN || 'https://gullylabs.xyz'
const LIVE = {
  hub: `${HUB}/api/hub`,                                   // service uptime, chain head, quests, x402, RPC gateway, status page
  products: `${HUB}/api/hub/products`,                     // Gully Chain hourly blocks/txs, launch/trade/swap activity, bridge, HolderMaps, Security
  stats: `${HUB}/api/stats`,                               // venues the studio built (Peddles, PeddleSwap, PeddleQuest, Gully Chain)
  id: 'https://gullyid.xyz/v1/stats/public',               // Gully ID aggregate sign-ins (no PII)
  pay: 'https://gullypay.xyz/api/status',                  // Gully Pay service states
  x402: 'https://gullypay.xyz/x402/status',                // Gully Pay x402 facilitator: networks + assets
  rpc: 'https://gullyrpc.xyz/status.json',                 // Gully RPC live / beta / coming-soon per feature and chain
  head: 'https://indexer.gullychain.xyz/head',             // Gully Chain indexer: latest block
  feed: 'https://indexer.gullychain.xyz/feed?limit=12',    // Gully Chain indexer: latest on-chain events
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.xml': 'application/xml' }
const cache = new Map()

async function live(res, name) {
  const url = LIVE[name]
  if (!url) return notFound(res)
  const hit = cache.get(name)
  if (hit && Date.now() - hit.at < 20_000) return sendLive(res, hit)
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000) })
    const entry = { at: Date.now(), status: r.status, type: r.headers.get('content-type') || 'application/json', body: Buffer.from(await r.arrayBuffer()), host: new URL(url).host }
    if (r.ok) cache.set(name, entry)
    sendLive(res, entry)
  } catch (e) {
    if (hit) return sendLive(res, hit)
    res.writeHead(502, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ code: 'upstream_unreachable', source: new URL(url).host, message: String(e?.message || e) }))
  }
}
function sendLive(res, e) {
  res.writeHead(e.status, { 'content-type': e.type, 'cache-control': 'no-store', 'x-upstream': e.host, 'x-fetched-at': new Date(e.at).toISOString() })
  res.end(e.body)
}

function contact(req, res) {
  let body = ''
  req.on('data', (c) => { body += c; if (body.length > 20_000) req.destroy() })
  req.on('end', async () => {
    if (process.env.CONTACT_LIVE !== '1') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ ok: true, preview: true }))
    }
    try {
      const r = await fetch(`${HUB}/api/contact`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(12_000) })
      res.writeHead(r.status, { 'content-type': 'application/json' })
      res.end(Buffer.from(await r.arrayBuffer()))
    } catch {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false }))
    }
  })
}

async function serveFile(res, base, path) {
  const rel = normalize(decodeURIComponent(path)).replace(/^[\\/]+/, '')
  const full = join(base, rel)
  if (!full.startsWith(base)) return notFound(res)
  try {
    let f = full
    if ((await stat(f)).isDirectory()) f = join(f, 'index.html')
    const buf = await readFile(f)
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' })
    res.end(buf)
  } catch {
    notFound(res)
  }
}
const notFound = (res) => { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found') }

for (const [port, site] of Object.entries(SITES)) {
  createServer(async (req, res) => {
    const p = new URL(req.url, 'http://localhost').pathname
    if (p.startsWith('/live/')) return live(res, p.slice(6))
    if (p === '/api/contact' && req.method === 'POST') return contact(req, res)
    if (p.startsWith('/shared/')) return serveFile(res, join(ROOT, 'shared') + sep, p.slice('/shared/'.length))
    return serveFile(res, join(ROOT, site) + sep, p === '/' ? 'index.html' : p)
  }).listen(Number(port), '127.0.0.1', () => console.log(`${site.padEnd(6)} http://localhost:${port}`))
}
