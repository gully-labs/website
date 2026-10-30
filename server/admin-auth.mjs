// Who may use the admin dashboard (admin.gullylabs.xyz, /api/admin/*). Owner decision 2026-10-30:
//
//   1. Sign in with Gully ID + allowlist (admin-gully-id.mjs, shared with the other Gully admin consoles).
//      GET /auth/gully/start (admin host) runs a server-side OIDC code flow with PKCE on client gully-labs; the callback
//      GET /auth/gully/callback (registered automatically: admin.gullylabs.xyz is an origin of gully-labs) checks the
//      token at gullyid.xyz /v1/profile, requires client === gully-labs and the sub in ADMIN_GULLY_SUBS, and sets an
//      HttpOnly, Secure, SameSite=Strict session cookie (__Host-gl_admin; 8 h, 1 h idle, in memory). Every admin call
//      then sends the session's CSRF token as `Authorization: Bearer <csrf>`, so the dashboard code is unchanged: a
//      cross-site page can neither read that token nor add the header, and the cookie alone is never enough.
//   2. Break-glass: the old `Authorization: Bearer <ADMIN_TOKEN>` while ADMIN_PASSWORD_LOGIN=on (default on for this
//      release). The owner sets ADMIN_PASSWORD_LOGIN=off once a Gully ID sign-in works; scripts that call /api/admin
//      with ADMIN_TOKEN stop working then.
//
// The dashboard is off (503) unless one way in exists. Logs: one JSON line per sign-in, the sub as a 12-hex tag only.
import { AdminSessions, GullyIdAdminLogin, TX_COOKIE, adminAuthConfig, clearTxCookie, logAuth, parseCookies, publicAuthConfig, same, txCookie } from './admin-gully-id.mjs'
import { bearer, json } from './http.mjs'

export const ADMIN_COOKIE = '__Host-gl_admin'
const TX_PATH = '/auth/gully'

let st = null
let lastTokenLog = 0
/** Settings are read on first use (tests set the environment before importing the server). */
function state() {
  if (!st) configureAdminAuth()
  return st
}

/** (Re)reads the settings. Tests pass a fetch for a mock Gully ID and a clock. */
export function configureAdminAuth({ fetchImpl, now = Date.now } = {}) {
  const c = adminAuthConfig(process.env, { clientId: 'gully-labs' })
  st = {
    c,
    origin: String(process.env.ADMIN_ORIGIN || 'https://admin.gullylabs.xyz').replace(/\/+$/, ''),
    login: new GullyIdAdminLogin(c, { ...(fetchImpl ? { fetchImpl } : {}), now }),
    sessions: new AdminSessions({ ttlMs: c.sessionMs, idleMs: c.idleMs, now }),
  }
  return st
}

const tokenOk = () => {
  const t = process.env.ADMIN_TOKEN
  return typeof t === 'string' && t.length >= 24
}

function cookieOf(req) {
  return parseCookies(req.headers.cookie)[ADMIN_COOKIE]
}

const sessionCookie = (token, c) => `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(c.sessionMs / 1000)}`
const clearSession = () => `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`

/** Is this request allowed into /api/admin/*? -> { ok: true, via } | { ok: false, status, error, counts } */
export function checkAdmin(req) {
  const { c, sessions } = state()
  const password = c.passwordLogin && tokenOk()
  const gully = c.gullyId && !!c.clientId && c.subs.size > 0
  if (!password && !gully) return { ok: false, status: 503, error: 'The admin dashboard is disabled: set ADMIN_GULLY_SUBS (Sign in with Gully ID), or ADMIN_TOKEN with ADMIN_PASSWORD_LOGIN=on.', counts: false }
  const b = bearer(req) ?? ''
  const s = sessions.get(cookieOf(req))
  if (s && same(b, s.csrf)) return { ok: true, via: s.via }
  if (password && same(b, process.env.ADMIN_TOKEN)) {
    // The token has no sign-in step: log its use at most every 10 minutes, so break-glass use stays visible.
    if (Date.now() - lastTokenLog > 600_000) {
      lastTokenLog = Date.now()
      logAuth(console, 'login', { result: 'ok', via: 'token' })
    }
    return { ok: true, via: 'token' }
  }
  if (b && !s) logAuth(console, 'login', { result: 'fail', via: 'token', code: 'bad_token' })
  if (s) return { ok: false, status: 403, error: 'Missing or wrong CSRF token. Reload the page.', counts: true }
  return { ok: false, status: 401, error: b ? 'Wrong admin token.' : 'Sign in first.', counts: !!b }
}

/** /api/admin/auth/*: the sign-in card's options, the cookie session's CSRF token, sign-out. Before checkAdmin. */
export function handleAdminAuth(req, res, url) {
  const p = url.pathname
  if (!p.startsWith('/api/admin/auth/')) return false
  const { c, sessions } = state()
  if (p === '/api/admin/auth/config' && req.method === 'GET') {
    const pub = publicAuthConfig(c)
    return json(res, 200, { ...pub, passwordLogin: c.passwordLogin && tokenOk() }), true
  }
  if (p === '/api/admin/auth/session' && req.method === 'GET') {
    const s = sessions.get(cookieOf(req))
    if (!s) return json(res, 401, { error: 'No admin session.' }, { 'Set-Cookie': clearSession() }), true
    return json(res, 200, { csrf: s.csrf, via: s.via, expiresAt: new Date(s.created + c.sessionMs).toISOString() }), true
  }
  if (p === '/api/admin/auth/logout' && req.method === 'POST') {
    const token = cookieOf(req)
    const s = sessions.get(token)
    if (s && !same(bearer(req) ?? '', s.csrf)) return json(res, 403, { error: 'Missing or wrong CSRF token. Reload the page.' }), true
    if (s) logAuth(console, 'logout', { result: 'ok', via: s.via, sub: s.sub ?? undefined })
    sessions.destroy(token)
    return json(res, 200, { ok: true }, { 'Set-Cookie': clearSession() }), true
  }
  return json(res, 404, { error: 'not found' }), true
}

const esc = (v) => String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
function page(res, status, title, body, headers = {}) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)} · Gully Labs admin</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#06050D;color:#F4F1FF;font:15px/1.5 Inter,system-ui,sans-serif;padding:24px}main{max-width:440px;border:1px solid #2A2540;border-radius:16px;padding:28px;background:#0E0B1A}h1{margin:0 0 8px;font-size:24px}code{display:block;word-break:break-all;background:#06050D;border:1px solid #2A2540;border-radius:8px;padding:8px 10px;margin:6px 0}a{display:inline-flex;margin-top:12px;color:#F9AE1B}</style></head><body><main><h1>${esc(title)}</h1>${body}<a href="/">Back to the admin sign-in</a></main></body></html>`
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  res.end(html)
}

/** GET /auth/gully/start and /auth/gully/callback on the admin host. Returns true when handled. */
export async function handleGullyAdminRoute(req, res, url) {
  const p = url.pathname
  if (p !== '/auth/gully/start' && p !== '/auth/gully/callback') return false
  const { c, login, sessions, origin } = state()
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'GET only' }), true
  if (!login.enabled) return json(res, 404, { error: 'Sign in with Gully ID is turned off on this dashboard.' }), true
  if (p === '/auth/gully/start') {
    const { location, state: s } = login.start(`${origin}/auth/gully/callback`)
    res.writeHead(302, { Location: location, 'Set-Cookie': txCookie(s, TX_PATH), 'Cache-Control': 'no-store' })
    return res.end(), true
  }
  const r = await login.finish(url.searchParams, parseCookies(req.headers.cookie)[TX_COOKIE])
  if (!r.ok) {
    logAuth(console, 'login', { result: 'fail', via: 'gully_id', code: r.code, sub: r.sub })
    // A refused account sees its own sub, so the owner can copy theirs into ADMIN_GULLY_SUBS (ops/DEPLOY.md).
    const own = r.code === 'not_allowlisted' && r.sub ? `<p>Your Gully ID account id (sub):</p><code>${esc(r.sub)}</code><p>If this is the owner's account, add it to ADMIN_GULLY_SUBS in the server's .env and restart it.</p>` : ''
    return page(res, r.status, r.code === 'not_allowlisted' ? 'Not on the admin list' : 'Sign-in failed', `<p>${esc(r.message)}</p>${own}`, { 'Set-Cookie': clearTxCookie(TX_PATH) }), true
  }
  const s = sessions.create('gully_id', r.sub)
  logAuth(console, 'login', { result: 'ok', via: 'gully_id', sub: r.sub })
  res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store', 'Set-Cookie': [clearTxCookie(TX_PATH), sessionCookie(s.token, c)] })
  return res.end(), true
}
