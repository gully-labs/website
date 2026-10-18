// analytics.gullylabs.xyz: a reverse proxy to Gully Analytics (our Umami fork, container
// gully-analytics on the gully_default network). Cloudflare sends every request on the zone to this
// server, so the analytics app is reached through here, like the blog.
//
// Tracker calls are the one thing looked at on the way: POST /api/send ({ type, payload: { website } })
// and POST /api/batch (an array of those, Umami 3.4 src/app/api/batch/route.ts). Their JSON body (at most
// 64 KB) is read, and events for a self-serve website whose account has lapsed, is over its monthly quota
// or is beyond its plan's website count are answered 402 here without reaching Umami
// (analytics-accounts.mjs decides, from memory). Accepted events are counted per website per month.
// Websites not created through self-serve, like the Gully Labs site itself, are never blocked.
//
// What else the proxy does itself (2026-10-17):
// - GET /sso?code=…: one-click sign-in from the app dashboard (analytics-sso.mjs).
// - GET /login (a document navigation): a branded way in that points to the portal (one click, no
//   password), with Umami's own form one link away at /login?form=password.
// - Speed. Umami server-renders /login on every hit (1.5 to 3.5 s measured through Cloudflare), so the
//   login HTML is kept for 5 minutes and refreshed in the background (it holds nothing per visitor and
//   sets no cookie). /_next/static/* (content-hashed, immutable) is kept in memory (LRU, 48 MB) so a
//   chunk never waits on the upstream twice. Upstream sockets are kept alive. Umami compresses (gzip)
//   when asked, and the caches keep its encodings.
// - Headers. Umami's CSP gets Cloudflare Web Analytics (the zone injects its beacon) added to
//   script-src and connect-src. Tracker endpoints always answer CORS, preflights included, even when
//   Umami is down, so a visitor's console never shows a CORS error for our own beacon.
// Everything else streams through untouched.

import http from 'node:http'
import { admitEvents, recordEvents } from './analytics-accounts.mjs'
import { loginInterstitial, ssoPage } from './analytics-sso.mjs'
import { ANALYTICS_TRIAL_DAYS } from './plans.mjs'

const upstreamUrl = () => new URL(process.env.ANALYTICS_UPSTREAM ?? 'http://gully-analytics:3000')
const MAX_EVENT_BODY = 64 * 1024
const MAX_BUFFERED = 8 * 1024 * 1024
const agent = new http.Agent({ keepAlive: true, keepAliveMsecs: 15_000, maxSockets: 64, maxFreeSockets: 16 })
const CF_SCRIPT = 'https://static.cloudflareinsights.com'
const CF_CONNECT = 'https://cloudflareinsights.com'
const TRACKER_CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '86400' }
const HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer']

function forwardHeaders(req) {
  const h = { ...req.headers }
  for (const k of HOP) delete h[k]
  return {
    ...h,
    'x-forwarded-proto': 'https',
    'x-forwarded-host': req.headers.host ?? '',
    // Umami reads the visitor's address for country and unique-visitor counts.
    'x-forwarded-for': String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? ''),
  }
}

const isTrackerPath = (p) => p === '/api/send' || p === '/api/batch' || p === '/script.js'

function unavailable(req, res) {
  if (res.headersSent) return res.destroy()
  const p = String(req.url ?? '/').replace(/\?.*$/, '')
  if (p.startsWith('/api/') || isTrackerPath(p)) {
    res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '30', ...TRACKER_CORS })
    return res.end(JSON.stringify({ error: { message: 'Gully Analytics is starting or unavailable.', code: 'unavailable', status: 502 } }))
  }
  res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '30', 'Cache-Control': 'no-store' })
  res.end('<!doctype html><title>Gully Analytics</title><body style="background:#0b0e13;color:#a6b0bd;font:16px system-ui;padding:48px">Gully Analytics is starting or unavailable. Try again in a minute. <a style="color:#e8c060" href="https://gullylabs.xyz/">Back to Gully Labs</a></body>')
}

/** Umami's CSP, plus Cloudflare Web Analytics (script and beacon), which the zone injects into pages. */
export function patchCsp(value) {
  if (!value) return value
  const parts = String(value).split(';').map((s) => s.trim()).filter(Boolean)
  const add = (name, src) => {
    const i = parts.findIndex((d) => d.split(/\s+/)[0] === name)
    if (i < 0) parts.push(`${name} 'self' ${src}`)
    else if (!parts[i].split(/\s+/).includes(src)) parts[i] += ` ${src}`
  }
  add('script-src', CF_SCRIPT)
  add('connect-src', CF_CONNECT)
  return parts.join('; ') + ';'
}

function responseHeaders(upHeaders, status, path) {
  const h = { ...upHeaders }
  for (const k of HOP) delete h[k]
  if (h['content-security-policy']) h['content-security-policy'] = patchCsp(h['content-security-policy'])
  if (path.startsWith('/_next/static/') && status < 300) h['cache-control'] = 'public, max-age=31536000, immutable'
  if (isTrackerPath(path)) for (const [k, v] of Object.entries(TRACKER_CORS)) h[k.toLowerCase()] = v
  return h
}

/** Sends one request upstream; `body` is a Buffer (already read) or null to stream `req`. */
function forward(req, res, body, onStatus) {
  const headers = forwardHeaders(req)
  if (body) headers['content-length'] = String(body.length)
  const u = upstreamUrl()
  const path = String(req.url ?? '/').replace(/\?.*$/, '')
  const upstream = http.request({ hostname: u.hostname, port: u.port || 80, path: req.url, method: req.method, headers, agent, timeout: 60_000 }, (up) => {
    const status = up.statusCode ?? 502
    onStatus?.(status)
    res.writeHead(status, responseHeaders(up.headers, status, path))
    up.pipe(res)
  })
  upstream.on('timeout', () => upstream.destroy(new Error('timeout')))
  upstream.on('error', () => unavailable(req, res))
  if (body) upstream.end(body)
  else req.pipe(upstream)
}

/** One buffered GET upstream (for the caches). Resolves { status, headers, body } or null. */
function fetchUpstream(path, headers) {
  const u = upstreamUrl()
  return new Promise((resolve) => {
    const r = http.request({ hostname: u.hostname, port: u.port || 80, path, method: 'GET', headers, agent, timeout: 30_000 }, (up) => {
      const chunks = []
      let size = 0
      up.on('data', (c) => {
        size += c.length
        if (size <= MAX_BUFFERED) chunks.push(c)
      })
      up.on('end', () => resolve(size > MAX_BUFFERED ? null : { status: up.statusCode ?? 502, headers: up.headers, body: Buffer.concat(chunks) }))
      up.on('error', () => resolve(null))
    })
    r.on('timeout', () => r.destroy(new Error('timeout')))
    r.on('error', () => resolve(null))
    r.end()
  })
}

const wantsGzip = (req) => /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))

function sendEntry(req, res, entry, path, extra = {}) {
  const h = { ...responseHeaders(entry.headers, entry.status, path), ...extra }
  h['content-length'] = String(entry.body.length)
  res.writeHead(entry.status, h)
  res.end(req.method === 'HEAD' ? undefined : entry.body)
}

/* ----------------------------------------------------------- static cache --- */
// Content-hashed build files, kept per encoding (gzip or identity, as Umami answered them).

const STATIC_MAX = 48 * 1024 * 1024
const staticCache = new Map() // key -> { status, headers, body }, oldest first
let staticBytes = 0

function remember(key, entry) {
  if (entry.body.length > 6 * 1024 * 1024) return
  staticCache.set(key, entry)
  staticBytes += entry.body.length
  for (const [k, v] of staticCache) {
    if (staticBytes <= STATIC_MAX) break
    staticCache.delete(k)
    staticBytes -= v.body.length
  }
}

async function serveStatic(req, res, path) {
  const enc = wantsGzip(req) ? 'gzip' : 'identity'
  const key = `${req.url}|${enc}`
  const hit = staticCache.get(key)
  if (hit) {
    staticCache.delete(key) // least recently used goes first
    staticCache.set(key, hit)
    return sendEntry(req, res, hit, path, { 'x-gully-cache': 'HIT' })
  }
  const headers = forwardHeaders(req)
  headers['accept-encoding'] = enc
  delete headers['if-none-match']
  delete headers['if-modified-since']
  const r = await fetchUpstream(req.url, headers)
  if (!r) return unavailable(req, res)
  if (r.status === 200) remember(key, r)
  sendEntry(req, res, r, path, { 'x-gully-cache': 'MISS' })
}

/* ------------------------------------------------------------ login cache --- */
// Umami's /login?form=password HTML. The same for every visitor; refreshed in the background.

const LOGIN_TTL_MS = 5 * 60_000
const LOGIN_FORM = '/login?form=password'
const loginCache = new Map() // `${url}|${enc}` -> { at, entry }
const loading = new Map() // key -> Promise

function loadLogin(url, enc, host) {
  const key = `${url}|${enc}`
  if (loading.has(key)) return loading.get(key)
  const p = (async () => {
    const r = await fetchUpstream(url, { host, accept: 'text/html', 'accept-encoding': enc, 'x-forwarded-proto': 'https', 'x-forwarded-host': host })
    if (!r) return null
    const cacheable = r.status === 200 && /text\/html/.test(String(r.headers['content-type'] ?? '')) && !r.headers['set-cookie']
    if (cacheable) loginCache.set(key, { at: Date.now(), entry: r })
    return r
  })().finally(() => loading.delete(key))
  loading.set(key, p)
  return p
}

async function serveLoginForm(req, res, path) {
  const enc = wantsGzip(req) ? 'gzip' : 'identity'
  const host = String(req.headers.host ?? 'analytics.gullylabs.xyz')
  const c = loginCache.get(`${req.url}|${enc}`)
  if (c) {
    if (Date.now() - c.at > LOGIN_TTL_MS) loadLogin(req.url, enc, host).catch(() => {})
    return sendEntry(req, res, c.entry, path, { 'x-gully-cache': 'HIT' })
  }
  const entry = await loadLogin(req.url, enc, host)
  if (!entry) return unavailable(req, res)
  sendEntry(req, res, entry, path, { 'x-gully-cache': 'MISS' })
}

/** Warms the password form in the background (the interstitial calls this, so the next click is fast). */
function warmLogin(host) {
  for (const enc of ['gzip', 'identity']) {
    const c = loginCache.get(`${LOGIN_FORM}|${enc}`)
    if (!c || Date.now() - c.at > LOGIN_TTL_MS) loadLogin(LOGIN_FORM, enc, host).catch(() => {})
  }
}

/* ---------------------------------------------------------------- events --- */

// The tracker reads `disabled` from any answer and stops sending for the rest of the page view.
function refuse(req, res, block) {
  const origin = req.headers.origin
  res.writeHead(402, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': origin ? String(origin) : '*',
    ...(origin ? { 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' } : {}),
  })
  res.end(JSON.stringify({ error: { message: block.message, code: block.code, status: 402 }, disabled: true }))
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    let over = false
    req.on('data', (c) => {
      if (over) return
      size += c.length
      if (size > MAX_EVENT_BODY) {
        over = true
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks)))
    req.on('error', () => resolve(null))
  })
}

async function handleEvents(req, res, batch) {
  const body = await readBody(req)
  if (!body) {
    res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...TRACKER_CORS })
    return res.end(JSON.stringify({ error: { message: 'Tracker calls are limited to 64 KB.', code: 'payload-too-large', status: 413 } }))
  }
  let parsed
  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch {
    return forward(req, res, body) // Umami answers malformed bodies itself.
  }
  const items = batch ? (Array.isArray(parsed) ? parsed : null) : [parsed]
  if (!items) return forward(req, res, body)
  const ids = items.map((it) => (typeof it?.payload?.website === 'string' ? it.payload.website.toLowerCase() : null))
  const verdicts = admitEvents(ids)
  const keep = items.filter((_, i) => verdicts[i].ok)
  if (!keep.length) return refuse(req, res, verdicts.find((v) => !v.ok).block)
  const counts = new Map()
  ids.forEach((id, i) => id && verdicts[i].ok && counts.set(id, (counts.get(id) ?? 0) + 1))
  const out = keep.length === items.length ? body : Buffer.from(JSON.stringify(keep))
  forward(req, res, out, (status) => status < 400 && recordEvents(counts))
}

function sendPage(res, page, method) {
  const html = Buffer.from(page.html)
  res.writeHead(page.status, { ...page.headers, 'Content-Length': String(html.length) })
  res.end(method === 'HEAD' ? undefined : html)
}

// A real page load, not Next's client-side navigation (which fetches the RSC payload instead).
const isDocument = (req, url) => !req.headers.rsc && !url.searchParams.has('_rsc') && /text\/html|\*\/\*/.test(String(req.headers.accept ?? '*/*'))

export function handleAnalytics(req, res) {
  const url = new URL(req.url ?? '/', 'http://analytics')
  const path = url.pathname
  const get = req.method === 'GET' || req.method === 'HEAD'
  if (req.method === 'POST' && (path === '/api/send' || path === '/api/batch')) return handleEvents(req, res, path === '/api/batch')
  if (req.method === 'OPTIONS' && isTrackerPath(path)) {
    res.writeHead(204, TRACKER_CORS)
    return res.end()
  }
  if (get && path === '/sso' && url.searchParams.has('code')) return sendPage(res, ssoPage(req, url), req.method)
  if (get && path === '/login' && isDocument(req, url)) {
    if (url.searchParams.get('form') === 'password' && url.search === '?form=password') return serveLoginForm(req, res, path)
    if (!url.search) {
      warmLogin(String(req.headers.host ?? 'analytics.gullylabs.xyz'))
      return sendPage(res, loginInterstitial(ANALYTICS_TRIAL_DAYS), req.method)
    }
  }
  if (get && path.startsWith('/_next/static/') && !req.headers.range) return serveStatic(req, res, path)
  forward(req, res, null)
}

/** Tests only. */
export const analyticsCacheStatsForTest = () => ({ staticEntries: staticCache.size, staticBytes, loginEntries: loginCache.size })
