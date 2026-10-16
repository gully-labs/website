// Production server for self-hosting: serves the built site from dist/ with an
// SPA fallback, handles POST /api/contact and answers GET /api/stats (the live
// cross-venue figures, see stats.mjs). No dependencies beyond Node.
import http from 'node:http'
import { readStats } from './stats.mjs'
import { readHistory, readTracker, startTrackerLoop } from './tracker.mjs'
import https from 'node:https'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'

const PORT = Number(process.env.PORT ?? 8080)
const ROOT = path.resolve(process.env.DIST_DIR ?? 'dist')
const INDEX = path.join(ROOT, 'index.html')
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const MAX_BODY = 20_000

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers)
  res.end(body)
}

function handleContact(req, res) {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
    if (body.length > MAX_BODY) req.destroy()
  })
  req.on('end', () => {
    let data
    try {
      data = JSON.parse(body)
    } catch {
      return send(res, 400, JSON.stringify({ ok: false }), { 'Content-Type': 'application/json' })
    }
    if (!EMAIL_RE.test(data?.email ?? '') || !Array.isArray(data?.types) || data.types.length === 0) {
      return send(res, 400, JSON.stringify({ ok: false }), { 'Content-Type': 'application/json' })
    }
    // TODO: forward the enquiry to the email provider or CRM (e.g. Resend).
    console.log('New enquiry', JSON.stringify(data))
    send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json' })
  })
}

function serveFile(res, file, method) {
  const ext = path.extname(file)
  // Hashed build assets never change; everything else revalidates.
  const cache = file.includes(`${path.sep}assets${path.sep}`) && /-[\w-]{8}\./.test(file)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache'
  res.writeHead(200, { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': cache })
  if (method === 'HEAD') return res.end()
  fs.createReadStream(file).pipe(res)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (url.pathname === '/api/contact') {
    if (req.method !== 'POST') return send(res, 405, '', { Allow: 'POST' })
    return handleContact(req, res)
  }
  // Fair-price tracker. Both answers are cacheable at the edge: every visitor shares one upstream read
  // per refresh, however many there are.
  if (url.pathname === '/api/tracker') {
    if (req.method !== 'GET') return send(res, 405, '', { Allow: 'GET' })
    return readTracker().then(
      (body) => send(res, 200, JSON.stringify(body), { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300' }),
      (err) => send(res, 502, JSON.stringify({ error: String(err?.message ?? err) }), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }),
    )
  }
  if (url.pathname === '/api/tracker/history') {
    if (req.method !== 'GET') return send(res, 405, '', { Allow: 'GET' })
    const ticker = (url.searchParams.get('ticker') ?? '').toUpperCase()
    const chain = (url.searchParams.get('chain') ?? 'robinhood').toLowerCase()
    if (!/^[A-Z.]{1,8}$/.test(ticker) || !/^[a-z]{2,12}$/.test(chain)) return send(res, 400, JSON.stringify({ error: 'chain and ticker' }), { 'Content-Type': 'application/json' })
    return send(res, 200, JSON.stringify({ chain, ticker, points: readHistory(chain, ticker) }), { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60, s-maxage=120, stale-while-revalidate=600' })
  }
  if (url.pathname === '/api/stats') {
    if (req.method !== 'GET') return send(res, 405, '', { Allow: 'GET' })
    return readStats().then(
      (body) => send(res, 200, JSON.stringify(body), { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' }),
      (err) => send(res, 502, JSON.stringify({ error: String(err?.message ?? err) }), { 'Content-Type': 'application/json' }),
    )
  }
  if (url.pathname === '/healthz') return send(res, 200, 'ok')
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '')

  const file = path.join(ROOT, decodeURIComponent(url.pathname))
  if (!file.startsWith(ROOT)) return send(res, 400, '')

  fs.stat(file, (err, stat) => {
    if (!err && stat.isFile()) return serveFile(res, file, req.method)
    // Unknown paths get the app shell so client-side routes work on reload.
    serveFile(res, INDEX, req.method)
  })
})

server.listen(PORT, () => console.log(`gully-web listening on :${PORT}`))
startTrackerLoop()

// Optional public port for Cloudflare. It speaks both HTTPS and plain HTTP on the
// same port (sniffing the first byte), so it works whatever the zone's SSL mode is.
const TLS_PORT = process.env.TLS_PORT
if (TLS_PORT) {
  const tls = https.createServer(
    { cert: fs.readFileSync(process.env.TLS_CERT ?? '/certs/origin.pem'), key: fs.readFileSync(process.env.TLS_KEY ?? '/certs/origin.key') },
    server.listeners('request')[0],
  )
  net
    .createServer((socket) => {
      socket.once('data', (buf) => {
        socket.pause()
        socket.unshift(buf)
        // 0x16 is a TLS handshake record.
        ;(buf[0] === 0x16 ? tls : server).emit('connection', socket)
        process.nextTick(() => socket.resume())
      })
      socket.on('error', () => socket.destroy())
    })
    .listen(Number(TLS_PORT), () => console.log(`gully-web public listener on :${TLS_PORT}`))
}
