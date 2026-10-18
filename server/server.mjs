// Production server for self-hosting: serves the built site from dist/ with an
// SPA fallback, handles POST /api/contact and answers GET /api/stats (the live
// cross-venue figures, see stats.mjs). No dependencies beyond Node.
import http from 'node:http'
import { handleIndexNowKey } from './indexnow.mjs'
import { readStats } from './stats.mjs'
import { onSnapshot, readGapIndex, readHistory, readHistoryDays, readMovers, readTracker, startTrackerLoop } from './tracker.mjs'
import { shapeMovers } from './movers.mjs'
import { evaluateAlerts, evaluateLaunchAlerts, startHolderAlerts } from './alerts.mjs'
import { handleDeepcoreLaunches, handleDeepcoreQuote, onLaunches, startDeepcore } from './deepcore.mjs'
import { alertChannels, handleTelegramWebhook, startTelegram } from './telegram.mjs'
import { handleMiniApp } from './telegram-miniapp.mjs'
import { handleHolders } from './holders.mjs'
import { startChannel } from './telegram-channel.mjs'
import { handleBroadcastRedirect, startBroadcasts } from './telegram-broadcast.mjs'
import { ANONYMOUS, PLANS, publicPlans } from './plans.mjs'
import { apiAccess, flushUsage, observe } from './access.mjs'
import { addEnquiry, addToLaunchList } from './store.mjs'
import { clientIp, DATA_DIR, readJson } from './http.mjs'
import { handleAdmin } from './admin.mjs'
import { pageMeta, renderHead, robotsFor, sitemapFor } from './seo.mjs'
import { handleBlog } from './blog.mjs'
import { handleOg } from './og.mjs'
import { handleAnalytics } from './analytics.mjs'
import { flushAnalyticsUsage } from './analytics-accounts.mjs'
import { handleDeveloper } from './developer.mjs'
import { APP_URL, isAppHost } from './hosts.mjs'
import { handlePay } from './invoices.mjs'
import { handleGas } from './gas.mjs'
import { handleSecurityPublic } from './security-routes.mjs'
import { startEngine as startSecurityEngine } from './security-engine.mjs'
import { CHAIN_LIST, rpc } from './payments.mjs'
import { treasury } from './plans.mjs'
import { startTreasuryWatch } from './treasury-chains.mjs'
import { geoFor } from './geo.mjs'
import { handleAsk, startAsk } from './ask.mjs'
import { handleSolana } from './solana-routes.mjs'
import { GUARD_PUBLIC_ERROR, PaymentGuardError } from './pay-guard.mjs'
import { startFeeProxyMonitor } from './fee-proxy-monitor.mjs'
import { startSecMonitor } from './sec-monitor.mjs'
import { handleScore, startScoreRefresh } from './gully-score.mjs'
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
   inline because React style props need it; connections allow any https/wss origin because the app
   dashboard's wallets and payment checks talk to public RPCs and WalletConnect relays chosen at runtime.
   The admin host and the app may not be framed at all; the main site only by itself.
   The Telegram Mini App (/tg on the main host) also loads Telegram's WebApp SDK from telegram.org and may be
   framed by Telegram Web (web.telegram.org), which shows Mini Apps in an iframe. */
const TG_SDK_URL = 'https://telegram.org/js/telegram-web-app.js'
function securityHeaders(host, pathname = '/') {
  const local = /^(localhost|127.0.0.1|[::1])$/.test(host)
  const strict = host.startsWith('admin.') || isAppHost(host)
  // The docs host runs the widget's live examples, which load https://gullylabs.xyz/widget.js (its
  // reads of /api/tracker and the logos are covered by connect-src https: and img-src https:).
  const docs = host.startsWith('docs.') || local
  const miniApp = !strict && !host.startsWith('docs.') && (pathname === '/tg' || pathname.startsWith('/tg/'))
  // The embeddable Holder Map (widget.js) is the one page any site may frame.
  const embed = !strict && !host.startsWith('docs.') && pathname.startsWith('/embed/')
  const csp = [
    "default-src 'self'",
    // Cloudflare Web Analytics is enabled on the zone and injects its beacon into every page.
    `script-src 'self' https://static.cloudflareinsights.com https://analytics.gullylabs.xyz${docs ? ' https://gullylabs.xyz' : ''}${miniApp ? ` ${TG_SDK_URL}` : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    'frame-src https:',
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${strict ? "'none'" : embed ? '*' : miniApp ? "'self' https://web.telegram.org" : "'self'"}`,
    ...(local ? [] : ['upgrade-insecure-requests']),
  ].join('; ')
  return {
    ...(local ? {} : { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    // Wallet popups (Coinbase Wallet, WalletConnect) need to talk back to the opener.
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    // X-Frame-Options cannot name another origin; the Mini App relies on frame-ancestors alone.
    ...(miniApp || embed ? {} : { 'X-Frame-Options': strict ? 'DENY' : 'SAMEORIGIN' }),
    'Content-Security-Policy': csp,
  }
}

/* A handler that throws answers 500 instead of leaving the request hanging. A payment instruction refused by the
   fee-proxy guard (pay-guard.mjs PaymentGuardError, already logged there) is one such case: nothing is emitted. */
const server = http.createServer(async (req, res) => {
  try {
    await handleRequest(req, res)
  } catch (e) {
    if (!(e instanceof PaymentGuardError)) console.error(`request ${req.method} ${String(req.url ?? '').split('?')[0]}:`, e?.stack ?? e)
    if (!res.headersSent) send(res, 500, JSON.stringify({ error: e instanceof PaymentGuardError ? GUARD_PUBLIC_ERROR : 'Internal error.' }), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    else res.destroy()
  }
})

async function handleRequest(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')

  // Hosts. The admin dashboard and its API live on admin.gullylabs.xyz only: on any other public host
  // /admin is a permanent redirect and /api/admin is not found. localhost keeps both for development.
  const host = String(req.headers.host ?? '').split(':')[0].toLowerCase()
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)
  const isAdmin = host.startsWith('admin.')
  // The blog is self-hosted Ghost in its own container; every path on its host goes there.
  if (handleIndexNowKey(req, res, url)) return
  if (host.startsWith('blog.')) return handleBlog(req, res, url)
  // Gully Analytics (Umami fork) in its own container; every path on its host goes there.
  if (host.startsWith('analytics.')) return handleAnalytics(req, res)
  // Security headers for everything this server answers itself (the blog and analytics set their own).
  for (const [k, v] of Object.entries(securityHeaders(host, url.pathname))) res.setHeader(k, v)
  if (!isAdmin && !isLocal && (url.pathname === '/admin' || url.pathname.startsWith('/admin/'))) {
    return send(res, 301, '', { Location: 'https://admin.gullylabs.xyz/', 'Cache-Control': 'public, max-age=3600' })
  }
  // The Gully Labs App (the app dashboard) lives on app.gullylabs.xyz (hosts.mjs). Elsewhere /app and the
  // retired /developers path answer 301 to https://app.gullylabs.xyz/; on that host any other page belongs
  // to the main site.
  const isApp = isAppHost(host)
  const isPage = url.pathname !== '/healthz' && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/assets/') && !/\.[a-z0-9]+$/i.test(url.pathname)
  if (!isApp && !isLocal && /^\/(app|developers)(\/|$)/.test(url.pathname)) {
    return send(res, 301, '', { Location: `${APP_URL}/`, 'Cache-Control': 'public, max-age=3600' })
  }
  if (isApp && isPage && url.pathname !== '/') {
    return send(res, 301, '', { Location: 'https://gullylabs.xyz' + url.pathname + url.search, 'Cache-Control': 'public, max-age=3600' })
  }
  // The docs live on their own host; /docs on the main site moves there, path kept.
  if (!isLocal && !host.startsWith('docs.') && (url.pathname === '/docs' || url.pathname.startsWith('/docs/'))) {
    return send(res, 301, '', { Location: 'https://docs.gullylabs.xyz' + (url.pathname.slice(5) || '/'), 'Cache-Control': 'public, max-age=3600' })
  }
  if (url.pathname === '/robots.txt') return send(res, 200, robotsFor(host), { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' })
  if (url.pathname === '/sitemap.xml') {
    const map = sitemapFor(host)
    if (!map) return send(res, 404, '', { 'Cache-Control': 'public, max-age=3600' })
    return send(res, 200, map, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' })
  }
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
  // The Telegram Mini App's API (telegram-miniapp.mjs): initData-authenticated, 404 without a bot token.
  if (url.pathname.startsWith('/api/tg/')) return void (await handleMiniApp(req, res, url))
  // Telegram's webhook (telegram.mjs): 404 unless the bot is configured and the secret path matches.
  if (url.pathname.startsWith('/api/telegram/')) return void (await handleTelegramWebhook(req, res, url))
  // Tracked links in bot broadcasts (telegram-broadcast.mjs): count one open, redirect to the broadcast's own button URL.
  if (url.pathname.startsWith('/r/')) return void handleBroadcastRedirect(req, res, url)
  // Which alert delivery channels this server offers (the pricing page and the docs read it). Public.
  if (url.pathname === '/api/alerts/channels') {
    if (req.method !== 'GET') return send(res, 405, '', { Allow: 'GET' })
    return send(res, 200, JSON.stringify(await alertChannels()), { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' })
  }
  // DeepCore router quote for the stock pages' comparison panel (deepcore.mjs): cached and rate limited here.
  if (url.pathname === '/api/deepcore/quote') return void (await handleDeepcoreQuote(req, res, url, geoFor(req, isLocal)))
  // DeepCore's latest launches from the poller's cache (the app dashboard's DeepCore view). Public.
  if (url.pathname === '/api/deepcore/launches') return void (await handleDeepcoreLaunches(req, res, url))
  // Solana (solana-routes.mjs): the RPC proxy, Solana Pay reference lookup and the geo-gated Jupiter quote/swap proxy.
  if (url.pathname.startsWith('/api/solana/')) {
    if (await handleSolana(req, res, url, geoFor(req, isLocal))) return
    return send(res, 404, JSON.stringify({ error: 'not found' }), { 'Content-Type': 'application/json' })
  }
  // The Gully Score (gully-score.mjs): the public index, one contract's score, and its embeddable badge.
  if (url.pathname === '/api/score' || url.pathname.startsWith('/api/score/') || (url.pathname.startsWith('/score/') && url.pathname.endsWith('/badge.svg'))) {
    if (await handleScore(req, res, url)) return
    return send(res, 404, JSON.stringify({ error: 'not found' }), { 'Content-Type': 'application/json' })
  }
  // Gully Ask (ask.mjs): POST /api/ask, GET /api/ask/status and POST /api/ask/feedback.
  if (url.pathname === '/api/ask' || url.pathname === '/api/ask/status' || url.pathname === '/api/ask/feedback') return void (await handleAsk(req, res, url))
  // Gully Pay gas costs per chain, cached (gas.mjs): the app's Merchant tab reads it. Public.
  if (url.pathname === '/api/pay/gas') return void (await handleGas(req, res))
  // Gully Pay: public invoice pages read and pay through here (invoices.mjs).
  if (url.pathname.startsWith('/api/pay/')) {
    if (await handlePay(req, res, url)) return
    return send(res, 404, JSON.stringify({ error: 'not found' }), { 'Content-Type': 'application/json' })
  }
  // Gully Security (security-routes.mjs): published reports, the scan counter, review requests.
  if (url.pathname.startsWith('/api/security/')) return void ((await handleSecurityPublic(req, res, url)) || send(res, 404, JSON.stringify({ error: 'not found' }), { 'Content-Type': 'application/json' }))
  let access = null
  if (url.pathname.startsWith('/api/tracker') || url.pathname.startsWith('/api/holders/')) {
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

  // Holder Map (holders.mjs): who holds a DeepCore launch or a stock token, with the same key limits as the tracker.
  if (url.pathname.startsWith('/api/holders/')) {
    if (await handleHolders(req, res, url, access)) return
    return send(res, 404, JSON.stringify({ error: 'not found' }), { 'Content-Type': 'application/json' })
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
  if (url.pathname === '/api/tracker/gap-index') {
    if (req.method !== 'GET') return send(res, 405, '', { Allow: 'GET' })
    return readGapIndex().then(
      (body) => send(res, 200, JSON.stringify(body), { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300' }),
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
  // Top movers: each trusted token's gap and price change over 1h or 24h, from the snapshots above.
  if (url.pathname === '/api/tracker/movers') {
    if (req.method !== 'GET') return send(res, 405, '', { Allow: 'GET' })
    const window = url.searchParams.get('window') ?? '24h'
    const limit = Number(url.searchParams.get('limit') ?? 10)
    const chain = url.searchParams.get('chain')?.toLowerCase() ?? null
    const ticker = url.searchParams.get('ticker')?.toUpperCase() ?? null
    if (window !== '1h' && window !== '24h') return send(res, 400, JSON.stringify({ error: 'window must be 1h or 24h' }), { 'Content-Type': 'application/json' })
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) return send(res, 400, JSON.stringify({ error: 'limit must be a whole number from 1 to 50' }), { 'Content-Type': 'application/json' })
    if ((chain !== null && !/^[a-z]{2,12}$/.test(chain)) || (ticker !== null && (!chain || !/^[A-Z.]{1,8}$/.test(ticker)))) return send(res, 400, JSON.stringify({ error: 'chain, and ticker with a chain' }), { 'Content-Type': 'application/json' })
    return readMovers(window).then(
      (full) => send(res, 200, JSON.stringify(shapeMovers(full, { limit, chain, ticker })), { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300' }),
      (err) => send(res, 502, JSON.stringify({ error: String(err?.message ?? err) }), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }),
    )
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
  // Whether the stock pages may show the swap here (geo.mjs). Per visitor, so never cached.
  if (url.pathname === '/api/geo') {
    if (req.method !== 'GET') return send(res, 405, '', { Allow: 'GET' })
    return send(res, 200, JSON.stringify(geoFor(req, isLocal)), { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' })
  }
  // Blog share images (og:image), one per post, rendered from the post's banner (og.mjs).
  if (url.pathname.startsWith('/og/blog/')) {
    if (await handleOg(req, res, url)) return
    return send(res, 404, '')
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
      res.writeHead(meta.found ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' })
      res.end(req.method === 'HEAD' ? undefined : renderHead(html, meta))
    })
  })
}

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
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => (flushUsage(), flushAnalyticsUsage(), process.exit(0)))
// Gap alerts are evaluated on every recorded tracker snapshot.
onSnapshot((rows, at) => evaluateAlerts(rows, at))
// DeepCore launch alerts run on every DeepCore poll (DEEPCORE_LOOP=off in tests: polled on demand).
onLaunches((fresh, at) => evaluateLaunchAlerts(fresh, at))

/* Background loops (upstream polls that fire alerts, the Telegram webhook, Gully Ask's refresh). During a
   zero-downtime deploy (ops/deploy.sh) the new container starts with GULLY_STANDBY=1: it answers requests
   (health checks, warm-up) but runs no loops, so alerts are not sent twice while the old container still
   serves. The deploy promotes it with SIGUSR2 once traffic is on it. Promotion is remembered in the data
   volume per container (its hostname is the container id), so a later restart of the same container
   starts its loops at once. */
let loopsStarted = false
function startLoops() {
  if (loopsStarted) return
  loopsStarted = true
  // TRACKER_LOOP=off (tests) skips the five-minute upstream reads; the API still answers on demand.
  if (process.env.TRACKER_LOOP !== 'off') startTrackerLoop()
  startDeepcore()
  // Holder Map alerts: each watched token's map is re-read every ten minutes (alerts.mjs).
  startHolderAlerts()
  // The Telegram bot registers its webhook and commands when TELEGRAM_BOT_TOKEN is set; otherwise it stays off.
  startTelegram().catch((e) => console.error('telegram start:', e?.message ?? e))
  startChannel() // @GullyLabsNews: scheduled posts and auto posts (telegram-channel.mjs)
  startBroadcasts() // bot DMs: scheduled broadcasts, and resuming one a restart interrupted (telegram-broadcast.mjs)
  // Gully Ask: log pruning, and the remote corpus refresh when ANTHROPIC_API_KEY is set.
  startAsk()
  // Hourly balance check of every fee-proxy contract (fee-proxy-monitor.mjs): non-zero = a third-party mis-send.
  startFeeProxyMonitor()
  // Gully Security's scan queue (server/security): requeues interrupted scans and starts the runner.
  startSecurityEngine()
  // Gully Security monitoring: watched contracts read every minute, alerts by Telegram and webhook (sec-monitor.mjs).
  startSecMonitor()
  // Gully Score: listed scores refreshed every 6 hours, and soon after a monitored change (gully-score.mjs).
  startScoreRefresh()
}
// The treasury deployment gate (treasury-chains.mjs) runs in standby too: a standby answers /api/plans and quotes,
// so it must know on which chains the Safe treasury exists. Read-only (eth_getCode), hourly, timers unref'd.
startTreasuryWatch({ rpc, chains: CHAIN_LIST, treasury })
const PROMOTED = path.join(DATA_DIR, `.promoted-${(process.env.HOSTNAME ?? 'local').replace(/[^\w-]/g, '')}`)
if (process.env.GULLY_STANDBY !== '1' || fs.existsSync(PROMOTED)) startLoops()
else console.log('standby: serving requests; background loops wait for SIGUSR2 (ops/deploy.sh)')
process.on('SIGUSR2', () => {
  if (loopsStarted) return
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(PROMOTED, new Date().toISOString())
    // Markers of containers that no longer exist are tiny; keep the newest five.
    const old = fs.readdirSync(DATA_DIR).filter((f) => f.startsWith('.promoted-')).map((f) => [f, fs.statSync(path.join(DATA_DIR, f)).mtimeMs]).sort((a, b) => b[1] - a[1]).slice(5)
    for (const [f] of old) fs.rmSync(path.join(DATA_DIR, f), { force: true })
  } catch (e) {
    console.error('promote marker:', e?.message ?? e)
  }
  console.log('promoted: starting background loops')
  startLoops()
})

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
