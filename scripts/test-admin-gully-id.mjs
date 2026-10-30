// Admin dashboard: Sign in with Gully ID + allowlist, and the break-glass ADMIN_TOKEN (server/admin-auth.mjs).
//
//   npm run test:admin-gully-id        (no build needed)
//
// The real server runs IN THIS PROCESS on TEST_PORT (default 8798) with a temporary DATA_DIR; gullyid.xyz is a mock
// HTTP server here (authorize is simulated, /oauth2/token checks PKCE, /v1/profile answers per token). Covers: an
// allowlisted sub gets in, a non-listed sub gets 403, a token for another client is refused, state binding, cookie
// flags, CSRF (the cookie alone is never enough), idle and absolute expiry, sign-out, ADMIN_PASSWORD_LOGIN on/off.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { guardTestRun, hostRequest, makeChecker } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8798
const BASE = `http://localhost:${PORT}`
await guardTestRun(PORT)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-admin-gid-'))
const dist = path.join(tmp, 'dist')
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><title>Gully Labs</title></head><body><div id="root"></div></body></html>')

// ---- mock gullyid.xyz
const codes = new Map()
const tokens = new Map()
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
let clock = Date.now()
const mock = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const u = new URL(req.url, 'http://x')
    const send = (status, o) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(o))
    }
    if (u.pathname === '/oauth2/token' && req.method === 'POST') {
      const f = new URLSearchParams(body)
      const c = codes.get(f.get('code'))
      codes.delete(f.get('code'))
      const ok = c && f.get('client_id') === 'gully-labs' && f.get('redirect_uri') === c.redirectUri && crypto.createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url') === c.challenge
      if (!ok) return send(400, { error: 'invalid_grant' })
      const at = crypto.randomBytes(16).toString('hex')
      tokens.set(at, c)
      return send(200, { access_token: at, token_type: 'bearer', id_token: `${b64u({ alg: 'RS256' })}.${b64u({ iss: `${ISSUER}/`, aud: [c.client], sub: c.sub, nonce: c.nonce, exp: Math.floor(clock / 1000) + 3600 })}.sig` })
    }
    if (u.pathname === '/v1/profile') {
      const t = tokens.get(String(req.headers.authorization ?? '').replace(/^Bearer /, ''))
      return t ? send(200, { sub: t.sub, name: 'Owner', client: t.client }) : send(401, { error: 'unauthorized' })
    }
    send(404, { error: 'not found' })
  })
})
await new Promise((r) => mock.listen(0, '127.0.0.1', r))
const ISSUER = `http://127.0.0.1:${mock.address().port}`
const OWNER = 'owner-sub-0001'
const ADMIN = crypto.randomBytes(24).toString('hex')

Object.assign(process.env, {
  PORT: String(PORT), DATA_DIR: tmp, TRACKER_DATA: path.join(tmp, 'tracker-history.json'), DIST_DIR: dist,
  ADMIN_TOKEN: ADMIN, TRACKER_LOOP: 'off', TRACKER_SKIP_APIS: '1', DEEPCORE_LOOP: 'off', ASK_REMOTE: 'off',
  IPFS_API: 'http://127.0.0.1:9', IPFS_GATEWAY: 'http://127.0.0.1:9', GULLYPAY_STATUS_URL: 'http://127.0.0.1:9', GULLYRPC_STATUS_URL: 'http://127.0.0.1:9',
  GULLY_ID_ISSUER: ISSUER, ADMIN_GULLY_SUBS: `${OWNER}, other-admin-2`, ADMIN_PASSWORD_LOGIN: 'on',
})
for (const k of ['TELEGRAM_BOT_TOKEN', 'GULLY_TREASURY_ADDRESS', 'ANTHROPIC_API_KEY', 'ADMIN_GULLY_ID', 'ADMIN_GULLY_ID_CLIENT_ID']) delete process.env[k]

await import('../server/server.mjs')
const auth = await import('../server/admin-auth.mjs')
auth.configureAdminAuth({ now: () => clock })
await new Promise((r) => setTimeout(r, 300))

const t = makeChecker()
const { check } = t
const A = 'admin.gullylabs.xyz'
const get = (p, opts) => hostRequest(BASE, A, p, opts)
const cookies = (r) => [r.headers['set-cookie'] ?? []].flat()
const sessionCookie = (r) => cookies(r).find((c) => c.startsWith('__Host-gl_admin=') && !/Max-Age=0/.test(c))

/** Start -> simulated authorize at the mock (as `sub` for `client`) -> callback. */
async function signIn({ sub = OWNER, client = 'gully-labs', sendTx = true, state: forced } = {}) {
  const s = await get('/auth/gully/start')
  const loc = new URL(s.headers.location)
  const q = loc.searchParams
  const tx = cookies(s).find((c) => c.startsWith('gid_admin_tx='))
  const code = crypto.randomBytes(8).toString('hex')
  codes.set(code, { sub, client, nonce: q.get('nonce'), challenge: q.get('code_challenge'), redirectUri: q.get('redirect_uri') })
  const r = await get(`/auth/gully/callback?code=${code}&state=${encodeURIComponent(forced ?? q.get('state'))}`, { headers: sendTx && tx ? { cookie: tx.split(';')[0] } : {} })
  return { start: s, loc, q, tx, r }
}
const call = (p, { cookie, bearer, method = 'GET' } = {}) => get(p, { method, body: method === 'POST' ? {} : undefined, headers: { ...(cookie ? { cookie } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } })

try {
  {
    const c = await get('/api/admin/auth/config')
    check('config: public, Gully ID on with the issuer and client gully-labs, break-glass on, list size only', c.status === 200 && c.data.gullyId.enabled === true && c.data.gullyId.clientId === 'gully-labs' && c.data.gullyId.issuer === ISSUER && c.data.gullyId.allowlisted === 2 && c.data.passwordLogin === true && !c.text.includes(OWNER), c.text)
  }
  {
    const { start, loc, q, tx } = await signIn({ sub: 'nobody' })
    check('start: 302 to <issuer>/oauth2/auth with PKCE S256, client gully-labs, the admin callback', start.status === 302 && loc.origin + loc.pathname === `${ISSUER}/oauth2/auth` && q.get('code_challenge_method') === 'S256' && q.get('client_id') === 'gully-labs' && q.get('redirect_uri') === 'https://admin.gullylabs.xyz/auth/gully/callback' && q.get('response_type') === 'code')
    check('start: state cookie HttpOnly, Secure, SameSite=Lax, scoped to /auth/gully', /^gid_admin_tx=[^;]+; Path=\/auth\/gully; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/.test(tx ?? ''), tx)
  }
  {
    const { r } = await signIn({ sub: 'stranger-sub-9' })
    check('not on the list: 403, no session, the page shows the account its own sub', r.status === 403 && !sessionCookie(r) && r.text.includes('Not on the admin list') && r.text.includes('stranger-sub-9'), String(r.status))
  }
  {
    const { r } = await signIn({ client: 'gully-faucet' })
    check('a token issued to another Gully app is refused (401) even for the owner sub', r.status === 401 && !sessionCookie(r), String(r.status))
  }
  {
    const a = await signIn({ sendTx: false })
    const b = await signIn({ state: 'forged-state-value-0000000000000000' })
    check('callback without the state cookie, or with another state: 400, no session', a.r.status === 400 && b.r.status === 400 && !sessionCookie(a.r) && !sessionCookie(b.r))
  }
  {
    const { r } = await signIn()
    const sc = sessionCookie(r)
    check('allowlisted sub: 302 to / with a __Host- cookie, HttpOnly, Secure, SameSite=Strict, 8 h', r.status === 302 && r.headers.location === '/' && /^__Host-gl_admin=[^;]+; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800$/.test(sc ?? ''), sc)
    const cookie = sc.split(';')[0]
    const s = await call('/api/admin/auth/session', { cookie })
    check('session: the CSRF token, via gully_id', s.status === 200 && s.data.via === 'gully_id' && typeof s.data.csrf === 'string' && s.data.csrf.length > 20)
    const csrf = s.data.csrf
    check('cookie alone (no CSRF bearer) is refused: 403', (await call('/api/admin/overview', { cookie })).status === 403)
    check('cookie + wrong CSRF bearer is refused: 403', (await call('/api/admin/overview', { cookie, bearer: 'x'.repeat(32) })).status === 403)
    check('CSRF bearer without the cookie is refused: 401', (await call('/api/admin/overview', { bearer: csrf })).status === 401)
    check('cookie + CSRF bearer: the dashboard API answers', (await call('/api/admin/overview', { cookie, bearer: csrf })).status === 200)
    check('a state change with the session works (fee-proxy check POST)', [200, 502, 500].includes((await call('/api/admin/fee-proxy/check', { cookie, bearer: csrf, method: 'POST' })).status) && (await call('/api/admin/fee-proxy/check', { cookie, method: 'POST' })).status === 403)
    clock += 59 * 60_000
    check('inside the idle window (59 min): still signed in', (await call('/api/admin/auth/session', { cookie })).status === 200)
    clock += 61 * 60_000
    check('idle 61 min: session gone (401)', (await call('/api/admin/auth/session', { cookie })).status === 401 && (await call('/api/admin/overview', { cookie, bearer: csrf })).status === 401)
  }
  {
    const cookie = sessionCookie((await signIn()).r).split(';')[0]
    let alive = true
    for (let i = 0; i < 9; i++) {
      clock += 50 * 60_000
      alive &&= (await call('/api/admin/auth/session', { cookie })).status === 200
    }
    clock += 40 * 60_000
    check('active every 50 min: alive for 7 h 30, gone after 8 h (absolute lifetime)', alive && (await call('/api/admin/auth/session', { cookie })).status === 401)
  }
  {
    const cookie = sessionCookie((await signIn()).r).split(';')[0]
    const csrf = (await call('/api/admin/auth/session', { cookie })).data.csrf
    check('sign-out needs the CSRF token', (await call('/api/admin/auth/logout', { cookie, method: 'POST' })).status === 403)
    const out = await call('/api/admin/auth/logout', { cookie, bearer: csrf, method: 'POST' })
    check('sign-out clears the cookie and ends the session', out.status === 200 && cookies(out).some((c) => /^__Host-gl_admin=;.*Max-Age=0/.test(c)) && (await call('/api/admin/overview', { cookie, bearer: csrf })).status === 401)
  }
  check('break-glass on: ADMIN_TOKEN still opens the API', (await call('/api/admin/overview', { bearer: ADMIN })).status === 200)
  check('break-glass on: a wrong token is 401', (await call('/api/admin/overview', { bearer: 'y'.repeat(48) })).status === 401)
  check('Gully ID routes exist only on the admin host', (await hostRequest(BASE, 'gullylabs.xyz', '/auth/gully/start')).status !== 302)

  // ---- ADMIN_PASSWORD_LOGIN=off: the token stops working, Gully ID still does
  process.env.ADMIN_PASSWORD_LOGIN = 'off'
  auth.configureAdminAuth({ now: () => clock })
  {
    const c = await get('/api/admin/auth/config')
    check('off: config says passwordLogin false', c.data.passwordLogin === false)
    check('off: ADMIN_TOKEN is refused (401)', (await call('/api/admin/overview', { bearer: ADMIN })).status === 401)
    const cookie = sessionCookie((await signIn()).r)?.split(';')[0]
    const csrf = cookie && (await call('/api/admin/auth/session', { cookie })).data.csrf
    check('off: an allowlisted Gully ID still gets in', !!cookie && (await call('/api/admin/overview', { cookie, bearer: csrf })).status === 200)
  }
  // ---- no way in: password off and an empty list -> 503 everywhere
  process.env.ADMIN_GULLY_SUBS = ''
  auth.configureAdminAuth({ now: () => clock })
  check('no allowlist + password off: the dashboard API is off (503)', (await call('/api/admin/overview', { bearer: ADMIN })).status === 503)
} finally {
  mock.close()
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
process.exit(t.failed ? 1 : 0)
