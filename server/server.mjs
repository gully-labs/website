// Production server for self-hosting: serves the built site from dist/ with an
// SPA fallback, handles POST /api/contact and answers GET /api/stats (the live
// cross-venue figures, see stats.mjs). No dependencies beyond Node.
import http from 'node:http'
import { readStats } from './stats.mjs'
import { onSnapshot, readHistory, readHistoryDays, readTracker, startTrackerLoop } from './tracker.mjs'
import { evaluateAlerts } from './alerts.mjs'
import { ANONYMOUS, PLANS, publicPlans } from './plans.mjs'
import { apiAccess, flushUsage, observe } from './access.mjs'
import { addEnquiry, addToLaunchList } from './store.mjs'
import { clientIp, DATA_DIR, readJson } from './http.mjs'
import { handleAdmin } from './admin.mjs'
import { pageMeta, renderHead, robotsFor, sitemapFor } from './seo.mjs'
import { handleBlog } from './blog.mjs'
import { handleAnalytics } from './analytics.mjs'
import { handleDeveloper } from './developer.mjs'
import { handlePay } from './invoices.mjs'
import https from 'node:https'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'

const PORT = Number(process.env.PORT ?? 8080)
const ROOT = path.resolve(process.env.DIST_DIR ?? 'dist')
const INDEX = path.join(ROOT, 'index.html')
const ASSET_ARCHIVE = path.join(DATA_DIR, 'assets-archive')
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
    // Saved for the admin dashboard (/admin). Forwarding to email or Telegram is still to be wired.
    const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '')
    addEnquiry({ name: str(data.name, 120), email: str(data.email, 254), message: str(data.message, 5000), types: data.types.slice(0, 8).map((t) => str(t, 40)), budget: str(data.budget, 40) })
    console.log('New enquiry saved')
    send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json' })
  })
}

function serveFile(res, file, method) {
  const ext = path.extname(file)
  // Hashed build assets never change; everything else revalidates.
  const cache = file.includes(`${path.sep}assets${path.sep}`) && /-[\w-]{8}\./.test(file)
    ? 'public, max-age=31536000, immutable'
    : /[\\/](tokens|chains|social)[\\/]/.test(file)
      ? 'public, max-age=86400'
      : 'no-cache'
  res.writeHead(200, { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': cache })
  if (method === 'HEAD') return res.end()
  fs.createReadStream(file).pipe(res)
}

// The public API may be called from any site (the widget, integrators): read-only GETs, no credentials.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400' }

const notifyHits = new Map()

/* Security headers. The CSP keeps scripts to this origin (no inline scripts exist in the build); styles allow
   inline because React style props need it; connections allow any https/wss origin because the developer
   portal's wallets and payment checks talk to public RPCs and WalletConnect relays chosen at runtime.
   The admin host and the developer portal may not be framed at all; the main site only by itself. */
function securityHeaders(host) {
  const local = /^(localhost|127.0.0.1|[::1])$/.test(host)
  const strict = host.startsWith('admin.') || host.startsWith('developers.')
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    'frame-src https:',
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${strict ? "'none'" : "'self'"}`,
    ...(local ? [] : ['upgrade-insecure-requests']),
  ].join('; ')
  return {
    ...(local ? {} : { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    // Wallet popups (Coinbase Wallet, WalletConnect) need to talk back to the opener.
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'X-Frame-Options': strict ? 'DENY' : 'SAMEORIGIN',
    'Content-Security-Policy': csp,
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')

  // Hosts. The admin dashboard and its API live on admin.gullylabs.xyz only: on any other public host
  // /admin is a permanent redirect and /api/admin is not found. localhost keeps both for development.
  const host = String(req.headers.host ?? '').split(':')[0].toLowerCase()
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)
  const isAdmin = host.startsWith('admin.')
  // The blog is self-hosted Ghost in its own container; every path on its host goes there.
  if (host.startsWith('blog.')) return handleBlog(req, res, url)
  // Gully Analytics (Umami fork) in its own container; every path on its host goes there.
  if (host.startsWith('analytics.')) return handleAnalytics(req, res)
  // Security headers for everything this server answers itself (the blog and analytics set their own).
  for (const [k, v] of Object.entries(securityHeaders(host))) res.setHeader(k, v)
  if (!isAdmin && !isLocal && (url.pathname === '/admin' || url.pathname.startsWith('/admin/'))) {
    return send(res, 301, '', { Location: 'https://admin.gullylabs.xyz/', 'Cache-Control': 'public, max-age=3600' })
  }
  // The developer dashboard lives on developers.gullylabs.xyz. Elsewhere /developers moves there; on that
  // host any other page belongs to the main site.
  const isDevelopers = host.startsWith('developers.')
  const isPage = !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/assets/') && !/\.[a-z0-9]+$/i.test(url.pathname)
  if (!isDevelopers && !isLocal && (url.pathname === '/developers' || url.pathname.startsWith('/developers/'))) {
    return send(res, 301, '', { Location: 'https://developers.gullylabs.xyz/', 'Cache-Control': 'public, max-age=3600' })
  }
  if (isDevelopers && isPage && url.pathname !== '/') {
    return send(res, 301, '', { Location: 'https://gullylabs.xyz' + url.pathname + url.search, 'Cache-Control': 'public, max-age=3600' })
  }
  // The docs live on their own host; /docs on the main site moves there, path kept.
  if (!isLocal && !host.startsWith('docs.') && (url.pathname === '/docs' || url.pathname.startsWith('/docs/'))) {
    return send(res, 301, '', { Location: 'https://docs.gullylabs.xyz' + (url.pathname.slice(5) || '/'), 'Cache-Control': 'public, max-age=3600' })
  }
  if (url.pathname === '/robots.txt') return send(res, 200, robotsFor(host), { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' })
  if (url.pathname === '/sitemap.xml') return send(res, 200, sitemapFor(host), { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' })
  if (isAdmin) res.setHeader('X-Robots-Tag', 'noindex, nofollow')

  if (url.pathname.startsWith('/api/admin/')) {
    if (!isAdmin && !isLocal) return send(res, 404, JSON.stringify({ error: 'not found' }), { 'Content-Type': 'application/json' })
    if (await handleAdmin(req, res, url)) return
    return send(res, 404, JSON.stringify({ error: 'not found' }), { 'Content-Type': 'application/json' })
  }
  if (url.pathname.startsWith('/api/developer/')) {
    if (await handleDeveloper(req, res, url)) return
    return send(res, 404, JSON.stringify({ error: 'not found' }), { 'Content-Type': 'application/json' })
  }
  // Gully Pay: public invoice pages read and pay through here (invoices.mjs).
  if (url.pathname.startsWith('/api/pay/')) {
    if (await handlePay(req, res, url)) return
    return send(res, 404, JSON.stringify({ error: 'not found' }), { 'Content-Type': 'application/json' })
  }
  let access = null
  if (url.pathname.startsWith('/api/tracker')) {
    if (req.method === 'OPTIONS') return send(res, 204, '', CORS)
    access = apiAccess(req)
    // Keyed requests are recorded (status class, latency) for the holder's dashboard once answered.
    observe(req, res, access.keyId)
    if (!access.ok) {
      return send(res, access.status, JSON.stringify({ error: access.error }), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...(access.retryAfter ? { 'Retry-After': String(access.retryAfter) } : {}) })
    }
    if (access.limit) {
      res.setHeader('X-RateLimit-Limit', String(access.limit))
      res.setHeader('X-RateLimit-Remaining', String(access.remaining))
    }
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
  }

  // "Notify me" on a project still in the lab: saves the email to the launch list (admin dashboard).
  if (url.pathname === '/api/notify') {
    if (req.method !== 'POST') return send(res, 405, '', { Allow: 'POST' })
    const ip = clientIp(req)
    const hits = (notifyHits.get(ip) ?? []).filter((t) => Date.now() - t < 3_600_000)
    if (hits.length >= 10) return send(res, 429, JSON.stringify({ error: 'Too many sign-ups from this address. Try again later.' }), { 'Content-Type': 'application/json' })
    notifyHits.set(ip, [...hits, Date.now()])
    const body = await readJson(req, 2_000)
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : ''
    const slot = typeof body?.slot === 'string' && /^\d{2}$/.test(body.slot) ? body.slot : null
    if (!EMAIL_RE.test(email) || !slot) return send(res, 400, JSON.stringify({ error: 'A valid email is required.' }), { 'Content-Type': 'application/json' })
    const added = addToLaunchList(email, slot)
    return send(res, 200, JSON.stringify({ ok: true, alreadyOnList: !added }), { 'Content-Type': 'application/json' })
  }
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
    // ?days= asks for a window; beyond seven days it needs a plan that includes that much history.
    const daysParam = url.searchParams.get('days')
    if (daysParam === null) return send(res, 200, JSON.stringify({ chain, ticker, points: readHistory(chain, ticker) }), { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60, s-maxage=120, stale-while-revalidate=600' })
    const days = Number(daysParam)
    const maxDays = PLANS.business.historyDays
    if (!Number.isInteger(days) || days < 1 || days > maxDays) return send(res, 400, JSON.stringify({ error: `days must be a whole number from 1 to ${maxDays}` }), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    const allowed = access?.historyDays ?? ANONYMOUS.historyDays
    if (days > allowed) {
      const needs = Object.values(PLANS).find((p) => p.historyDays >= days)
      return send(res, 403, JSON.stringify({ error: `Your ${access.keyId ? 'plan' : 'anonymous access'} includes ${allowed} days of history; ${days} days needs the ${needs?.name ?? 'Business'} plan (https://gullylabs.xyz/pricing).`, historyDays: allowed }), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS })
    }
    // Within the public 7 days the answer is the same for everyone; past it, it depends on the key.
    const cache = days <= ANONYMOUS.historyDays ? 'public, max-age=60, s-maxage=120, stale-while-revalidate=600' : 'private, max-age=60'
    return send(res, 200, JSON.stringify({ chain, ticker, days, points: readHistoryDays(chain, ticker, days) }), { 'Content-Type': 'application/json', 'Cache-Control': cache, ...(days > ANONYMOUS.historyDays ? { Vary: 'Authorization' } : {}) })
  }
  // The paid tiers: limits and prices from plans.mjs, and whether checkout is open. Public.
  if (url.pathname === '/api/plans') {
    if (req.method !== 'GET') return send(res, 405, '', { Allow: 'GET' })
    return send(res, 200, JSON.stringify(publicPlans()), { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' })
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
    // A code file from an earlier build, asked for by a page opened before the last deploy.
    if (url.pathname.startsWith('/assets/')) {
      const old = path.join(ASSET_ARCHIVE, path.basename(url.pathname))
      if (fs.existsSync(old)) return serveFile(res, old, req.method)
      return send(res, 404, '')
    }
    // Every other path gets the app shell, with that page's own head tags so crawlers and link
    // previews see the right title, description and canonical. A path no page owns is a 404.
    fs.readFile(INDEX, 'utf8', (e, html) => {
      if (e) return send(res, 500, '')
      const meta = pageMeta(host, url.pathname)
      res.writeHead(meta.found || isLocal ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' })
      res.end(req.method === 'HEAD' ? undefined : renderHead(html, meta))
    })
  })
})

// Keep every build's hashed files for 30 days in the data volume, so a page left open across a deploy
// can still load the chunks it was built with. Hashed names never collide between builds.
function archiveAssets() {
  try {
    fs.mkdirSync(ASSET_ARCHIVE, { recursive: true })
    const live = path.join(ROOT, 'assets')
    for (const f of fs.existsSync(live) ? fs.readdirSync(live) : []) {
      const dst = path.join(ASSET_ARCHIVE, f)
      if (!fs.existsSync(dst)) fs.copyFileSync(path.join(live, f), dst)
    }
    const cutoff = Date.now() - 30 * 86_400_000
    for (const f of fs.readdirSync(ASSET_ARCHIVE)) {
      const p = path.join(ASSET_ARCHIVE, f)
      if (fs.statSync(p).mtimeMs < cutoff && !fs.existsSync(path.join(live, f))) fs.rmSync(p)
    }
  } catch (e) {
    console.error('asset archive:', e?.message ?? e)
  }
}
archiveAssets()

server.listen(PORT, () => console.log(`gully-web listening on :${PORT}`))
// Keep the last minute of API usage across a restart or redeploy.
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => (flushUsage(), process.exit(0)))
// Gap alerts are evaluated on every recorded tracker snapshot.
onSnapshot((rows, at) => evaluateAlerts(rows, at))
// TRACKER_LOOP=off (tests) skips the five-minute upstream reads; the API still answers on demand.
if (process.env.TRACKER_LOOP !== 'off') startTrackerLoop()

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
