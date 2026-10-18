// A small server-side client for the Gully Analytics (Umami 3.4 fork) REST API, signed in as its admin.
// The admin password (ANALYTICS_ADMIN_PASSWORD) never leaves this process: no page or API answer
// carries it or the admin token. Unset, self-serve analytics is off and says so.
//
// Endpoints used, as the fork defines them (gully-labs/umami, src/app/api/...):
//   POST   /api/auth/login              { username, password } -> { token, user }
//   POST   /api/users                   { username, password, role: 'user' } -> user   (admin only)
//   POST   /api/users/:id               { password } -> user                          (admin may update anyone)
//   DELETE /api/users/:id               soft-deletes the user and its websites, deletes their events
//   POST   /api/websites                { name, domain } -> website, owned by the CALLER (userId = token's user)
//   POST   /api/websites/:id/transfer   { userId } -> website                         (admin may transfer any)
//   DELETE /api/websites/:id
//   GET    /api/websites/:id/stats?startAt&endAt         -> { pageviews, visitors, visits, bounces, totaltime, comparison }
//   GET    /api/websites/:id/events/stats?startAt&endAt  -> { events, visitors, visits, uniqueEvents, comparison }
//   GET    /api/users/:id               -> user                                         (admin only)
// Every call carries `Authorization: Bearer <token>`.

import crypto from 'node:crypto'

const TIMEOUT_MS = 10_000

export const upstream = () => String(process.env.ANALYTICS_UPSTREAM ?? 'http://gully-analytics:3000').replace(/\/+$/, '')
const adminUser = () => String(process.env.ANALYTICS_ADMIN_USERNAME ?? 'admin')
const adminPassword = () => String(process.env.ANALYTICS_ADMIN_PASSWORD ?? '')

/** Whether the server can create analytics accounts at all. */
export const umamiConfigured = () => adminPassword().length > 0

let token = null

async function raw(method, path, body, auth) {
  try {
    const r = await fetch(upstream() + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = await r.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = null
    }
    return { ok: r.ok, status: r.status, data }
  } catch (e) {
    return { ok: false, status: 0, data: null, error: String(e?.message ?? e) }
  }
}

async function login() {
  const r = await raw('POST', '/api/auth/login', { username: adminUser(), password: adminPassword() })
  if (r.ok && typeof r.data?.token === 'string') {
    token = r.data.token
    return true
  }
  token = null
  return false
}

const unreachable = { ok: false, status: 502, error: 'Gully Analytics could not be reached. Try again in a minute.' }
const notConfigured = { ok: false, status: 503, error: 'Self-serve Gully Analytics is not switched on yet on this server.' }

/** One admin call. Signs in when needed and once more when the token was refused. */
async function call(method, path, body) {
  if (!umamiConfigured()) return notConfigured
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!token && !(await login())) return { ...unreachable, error: 'Gully Analytics refused the server’s admin sign-in. Write to hello@gullylabs.xyz.' }
    const r = await raw(method, path, body, token)
    if (r.status === 401 && attempt === 0) {
      token = null
      continue
    }
    if (r.status === 0) return unreachable
    if (!r.ok) return { ok: false, status: r.status >= 500 ? 502 : r.status, error: r.data?.error?.message ?? `Gully Analytics answered ${r.status}.` }
    return { ok: true, status: r.status, data: r.data }
  }
  return unreachable
}

/** Creates a user with role 'user'. A taken username answers { ok: false, taken: true }. */
export async function createUser(username, password) {
  const r = await call('POST', '/api/users', { username, password, role: 'user' })
  if (!r.ok && r.status === 400 && /exists/i.test(r.error)) return { ...r, taken: true }
  return r.ok ? { ok: true, user: r.data } : r
}

export const setPassword = (userId, password) => call('POST', `/api/users/${encodeURIComponent(userId)}`, { password })
export const deleteUser = (userId) => call('DELETE', `/api/users/${encodeURIComponent(userId)}`)
export const deleteWebsite = (id) => call('DELETE', `/api/websites/${encodeURIComponent(id)}`)

/**
 * A website owned by `userId`. Umami gives a new website to whoever creates it, so the admin creates it
 * and transfers it to the user; if the transfer fails the half-made website is removed again.
 */
export async function createWebsiteFor(userId, name, domain) {
  const c = await call('POST', '/api/websites', { name, domain })
  if (!c.ok) return c
  const id = c.data?.id
  if (typeof id !== 'string') return { ok: false, status: 502, error: 'Gully Analytics did not return the new website.' }
  const t = await call('POST', `/api/websites/${encodeURIComponent(id)}/transfer`, { userId })
  if (!t.ok) {
    await deleteWebsite(id)
    return t
  }
  return { ok: true, website: { id, name: c.data.name ?? name, domain: c.data.domain ?? domain } }
}

/** The websites a user owns in Gully Analytics, including ones they added in the dashboard itself. */
export async function websitesOf(userId) {
  const r = await call('GET', `/api/users/${encodeURIComponent(userId)}/websites?pageSize=200`)
  if (!r.ok) return r
  const list = Array.isArray(r.data) ? r.data : Array.isArray(r.data?.data) ? r.data.data : []
  return { ok: true, websites: list.filter((w) => w && typeof w.id === 'string' && !w.deletedAt).map((w) => ({ id: w.id, name: w.name ?? '', domain: w.domain ?? '', createdAt: w.createdAt ?? null })) }
}

/** Umami's own figures for a website between two instants: page views, visitors, visits and custom events. */
export async function websiteStats(id, startAt, endAt) {
  const q = `startAt=${startAt}&endAt=${endAt}`
  const [s, e] = await Promise.all([call('GET', `/api/websites/${encodeURIComponent(id)}/stats?${q}`), call('GET', `/api/websites/${encodeURIComponent(id)}/events/stats?${q}`)])
  if (!s.ok) return s
  const n = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))
  return { ok: true, stats: { pageviews: n(s.data?.pageviews), visitors: n(s.data?.visitors), visits: n(s.data?.visits), customEvents: e.ok ? n(e.data?.events) : null } }
}

/** The Umami user as the admin sees it (404 once deleted). */
export const getUser = (userId) => call('GET', `/api/users/${encodeURIComponent(userId)}`)

/* ---------------------------------------------------------- sign-in tokens --- */
// One-click sign-in from the developer portal (analytics-sso.mjs). Umami 3.4 keeps no server session
// without Redis: its token is a JWT (HS256) signed with secret() = sha512hex(APP_SECRET), then
// AES-256-GCM encrypted with a key derived from the same secret (src/lib/jwt.ts createSecureToken,
// src/lib/crypto.ts encrypt). checkAuth (src/lib/auth.ts) loads the user from Umami's own database on
// every call and accepts a token without a password fingerprint, so this server can mint one for a user
// it manages WITHOUT knowing, exposing or changing that user's password. ANALYTICS_APP_SECRET must be
// the value compose gives the analytics container as APP_SECRET (both come from ~/gully-web/.env).
// The token carries an expiry (jsonwebtoken checks exp), so a minted session ends on its own.

const appSecret = () => String(process.env.ANALYTICS_APP_SECRET ?? '')
/** Whether this server can mint Umami sign-in tokens. */
export const ssoConfigured = () => appSecret().length > 0 && umamiConfigured()
const umamiSecret = (source = appSecret()) => crypto.createHash('sha512').update(source).digest('hex')
const b64url = (v) => Buffer.from(v).toString('base64url')

/** Umami's encrypt(): base64(salt[64] | iv[16] | tag[16] | ciphertext), key = pbkdf2(secret, salt, 10000, 32, sha512). */
function encrypt(value, secret) {
  const salt = crypto.randomBytes(64)
  const iv = crypto.randomBytes(16)
  const key = crypto.pbkdf2Sync(secret, salt, 10_000, 32, 'sha512')
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  return Buffer.concat([salt, iv, cipher.getAuthTag(), enc]).toString('base64')
}

export const SSO_SESSION_SEC = 12 * 3600

/** A Umami session token for `userId`, valid for `ttlSec` seconds. */
export function mintUserToken(userId, role = 'user', ttlSec = SSO_SESSION_SEC) {
  const secret = umamiSecret()
  const now = Math.floor(Date.now() / 1000)
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify({ userId, role, iat: now, exp: now + ttlSec }))
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')
  return encrypt(`${head}.${body}.${sig}`, secret)
}

/** Umami's parseSecureToken (decrypt, verify HS256 and exp), for the tests and the local stub. */
export function parseUserToken(token, secretSource = appSecret()) {
  try {
    const secret = umamiSecret(secretSource)
    const buf = Buffer.from(String(token), 'base64')
    const key = crypto.pbkdf2Sync(secret, buf.subarray(0, 64), 10_000, 32, 'sha512')
    const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(64, 80))
    d.setAuthTag(buf.subarray(80, 96))
    const jwt = d.update(buf.subarray(96)).toString('utf8') + d.final('utf8')
    const [h, b, s] = jwt.split('.')
    const want = crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url')
    if (!s || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want))) return null
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'))
    return payload.exp * 1000 > Date.now() ? payload : null
  } catch {
    return null
  }
}

/** Tests only: forget the cached admin token. */
export const resetUmamiForTest = () => {
  token = null
}
