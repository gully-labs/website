// End-to-end test of self-serve Gully Analytics: trial sign-up, websites, the proxy's quota and lapse
// enforcement, paying for a plan with Gully Pay, and the admin's grant / revoke / delete.
//
//   node scripts/test-analytics.mjs      (no build needed; it tests the API and the proxy, not the pages)
//
// The real server runs IN THIS PROCESS on port 8793 (TEST_PORT overrides) with a fresh temporary DATA_DIR.
// Gully Analytics is a local STUB of the Umami 3.4 endpoints the server uses (ANALYTICS_UPSTREAM), and Base
// is a local JSON-RPC stub (GULLY_RPC_8453). Random wallets sign in; nothing upstream is read.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { makeChecker, makeClient, guardTestRun } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8793
await guardTestRun(PORT)
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-analytics-'))
const ADMIN = crypto.randomBytes(24).toString('hex')
const UMAMI_ADMIN_PASSWORD = 'stub-admin-' + crypto.randomBytes(12).toString('hex')
const TREASURY = privateKeyToAccount(generatePrivateKey()).address.toLowerCase()
const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const GULLY_SITE = '78f29233-9f70-4c45-a440-35d1457d2207' // the Gully Labs site (index.html), never self-serve
const DAY = 86_400_000

const t = makeChecker()
const { check } = t

/* ------------------------------------------------------------ Umami stub --- */

const APP_SECRET = 'stub-app-secret-' + crypto.randomBytes(12).toString('hex')
const { parseUserToken } = await import('../server/umami.mjs')
const umami = { users: new Map(), websites: new Map(), tokens: new Map(), received: [], logins: 0, loginHits: 0, staticHits: 0 }
umami.users.set('admin-id', { id: 'admin-id', username: 'admin', password: UMAMI_ADMIN_PASSWORD, role: 'admin', deletedAt: null })
umami.websites.set(GULLY_SITE, { id: GULLY_SITE, name: 'Gully Labs', domain: 'gullylabs.xyz', userId: 'admin-id', createdBy: 'admin-id', deletedAt: null })

const umamiServer = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    const send = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
      res.end(JSON.stringify(data))
    }
    const bad = (message) => send(400, { error: { message, code: 'bad-request', status: 400 } })
    const unauthorized = () => send(401, { error: { message: 'Unauthorized', code: 'unauthorized', status: 401 } })
    const u = new URL(req.url, 'http://stub')
    const p = u.pathname
    let data = null
    try {
      data = body ? JSON.parse(body) : null
    } catch {
      return bad('Invalid JSON')
    }
    // Pages the proxy caches or replaces (counted, so the tests see what reached Umami).
    if (p === '/login' && req.method === 'GET') {
      umami.loginHits++
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; connect-src 'self' https:;" })
      return res.end('<!doctype html><title>Umami login</title><form id="umami-login"></form>')
    }
    if (p.startsWith('/_next/static/') && req.method === 'GET') {
      umami.staticHits++
      res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'public, max-age=31536000, immutable' })
      return res.end('/* chunk ' + p + ' */')
    }
    // Umami's checkAuth for a token the portal minted (umami.mjs mintUserToken), as /api/auth/verify uses it.
    if (p === '/api/auth/verify' && req.method === 'POST') {
      const payload = parseUserToken(String(req.headers.authorization ?? '').replace(/^Bearer /, ''), APP_SECRET)
      const user = payload && umami.users.get(payload.userId)
      if (!user || user.deletedAt) return unauthorized()
      return send(200, { id: user.id, username: user.username, role: user.role })
    }
    // Public tracker routes.
    if (p === '/script.js' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/javascript' })
      return res.end('/* stub tracker */')
    }
    if (p === '/api/send' && req.method === 'POST') {
      const site = umami.websites.get(data?.payload?.website)
      if (!site || site.deletedAt) return bad('Website not found.')
      umami.received.push(data.payload.website)
      return send(200, { cache: 'stub-cache', sessionId: 's', visitId: 'v' })
    }
    if (p === '/api/batch' && req.method === 'POST') {
      if (!Array.isArray(data)) return bad('array')
      for (const d of data) umami.received.push(d?.payload?.website)
      return send(200, { size: data.length, processed: data.length, errors: 0, details: [], cache: null })
    }
    if (p === '/api/auth/login' && req.method === 'POST') {
      const user = [...umami.users.values()].find((x) => x.username === data?.username && !x.deletedAt)
      if (!user || user.password !== data?.password) return unauthorized()
      const token = 'tok_' + crypto.randomBytes(8).toString('hex')
      umami.tokens.set(token, user.id)
      umami.logins++
      return send(200, { token, user: { id: user.id, username: user.username, role: user.role, isAdmin: user.role === 'admin' } })
    }
    const caller = umami.users.get(umami.tokens.get(String(req.headers.authorization ?? '').replace(/^Bearer /, '')))
    if (!caller) return unauthorized()
    const isAdmin = caller.role === 'admin'
    if (p === '/api/users' && req.method === 'POST') {
      if (!isAdmin) return unauthorized()
      if (typeof data?.username !== 'string' || typeof data?.password !== 'string' || data.password.length < 8 || !['admin', 'user', 'view-only'].includes(data.role)) return bad('Bad request')
      if ([...umami.users.values()].some((x) => x.username === data.username.toLowerCase())) return bad('User already exists')
      const user = { id: crypto.randomUUID(), username: data.username.toLowerCase(), password: data.password, role: data.role, deletedAt: null }
      umami.users.set(user.id, user)
      return send(200, { id: user.id, username: user.username, role: user.role, createdAt: new Date().toISOString() })
    }
    let m = p.match(/^\/api\/users\/([\w-]+)$/)
    if (m) {
      const user = umami.users.get(m[1])
      if (!isAdmin && caller.id !== m[1]) return unauthorized()
      if (!user || user.deletedAt) return send(404, { error: { message: 'Not found', status: 404 } })
      if (req.method === 'GET') return send(200, { id: user.id, username: user.username, role: user.role })
      if (req.method === 'POST') {
        if (data?.password) user.password = data.password
        return send(200, { id: user.id, username: user.username, role: user.role })
      }
      if (req.method === 'DELETE') {
        if (!isAdmin) return unauthorized()
        user.deletedAt = new Date().toISOString()
        for (const w of umami.websites.values()) if (w.userId === user.id) w.deletedAt = user.deletedAt
        return send(200, { ok: true })
      }
    }
    if (p === '/api/websites' && req.method === 'POST') {
      if (!data?.name || !data?.domain) return bad('Bad request')
      const w = { id: crypto.randomUUID(), name: data.name, domain: data.domain, userId: caller.id, createdBy: caller.id, deletedAt: null }
      umami.websites.set(w.id, w)
      return send(200, { ...w, shareId: null })
    }
    m = p.match(/^\/api\/websites\/([\w-]+)(\/transfer|\/stats|\/events\/stats)?$/)
    if (m) {
      const w = umami.websites.get(m[1])
      if (!w || w.deletedAt) return send(404, { error: { message: 'Not found', status: 404 } })
      if (!isAdmin && w.userId !== caller.id) return unauthorized()
      if (m[2] === '/transfer' && req.method === 'POST') {
        if (!umami.users.has(data?.userId)) return bad('Bad request')
        w.userId = data.userId
        return send(200, w)
      }
      if (m[2] === '/stats' && req.method === 'GET') {
        if (!u.searchParams.get('startAt') || !u.searchParams.get('endAt')) return bad('Either startAt+endAt or startDate+endDate must be provided')
        const n = umami.received.filter((x) => x === w.id).length
        return send(200, { pageviews: n, visitors: 1, visits: 1, bounces: 0, totaltime: 0, comparison: {} })
      }
      if (m[2] === '/events/stats' && req.method === 'GET') return send(200, { events: 0, visitors: 0, visits: 0, uniqueEvents: 0, comparison: {} })
      if (!m[2] && req.method === 'DELETE') {
        w.deletedAt = new Date().toISOString()
        return send(200, { ok: true })
      }
    }
    send(404, { error: { message: 'Not found', status: 404 } })
  })
})
await new Promise((r) => umamiServer.listen(0, '127.0.0.1', r))

/* ------------------------------------------------------------ Base stub --- */

const pad = (a) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0')
const hex = (n) => '0x' + BigInt(n).toString(16)
const chain = { head: 5_000_000, receipts: new Map(), txs: new Map(), blocks: new Map() }
chain.add = ({ from, value, to = TREASURY }) => {
  const hash = '0x' + crypto.randomBytes(32).toString('hex')
  const block = chain.head - 30
  chain.blocks.set(block, Math.floor(Date.now() / 1000))
  chain.receipts.set(hash, { transactionHash: hash, status: '0x1', blockNumber: hex(block), from, logs: [{ address: BASE_USDC, topics: [TRANSFER, pad(from), pad(to)], data: pad(hex(value)) }] })
  chain.txs.set(hash, { hash, from, to: BASE_USDC, value: '0x0', blockNumber: hex(block), chainId: hex(8453) })
  return hash
}
const rpc = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    const q = JSON.parse(body)
    let result = null
    if (q.method === 'eth_chainId') result = hex(8453)
    else if (q.method === 'eth_blockNumber') result = hex(chain.head)
    else if (q.method === 'eth_getTransactionReceipt') result = chain.receipts.get(q.params[0]) ?? null
    else if (q.method === 'eth_getTransactionByHash') result = chain.txs.get(q.params[0]) ?? null
    else if (q.method === 'eth_getBlockByNumber') {
      const n = Number(BigInt(q.params[0]))
      result = chain.blocks.has(n) ? { number: q.params[0], timestamp: hex(chain.blocks.get(n)) } : null
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }))
  })
})
await new Promise((r) => rpc.listen(0, '127.0.0.1', r))

/* ------------------------------------------------------------ start server --- */

Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: path.join(tmp, 'no-dist'),
  ADMIN_TOKEN: ADMIN,
  TRACKER_LOOP: 'off',
  GULLY_TREASURY_ADDRESS: TREASURY,
  GULLY_RPC_8453: `http://127.0.0.1:${rpc.address().port}`,
  ANALYTICS_UPSTREAM: `http://127.0.0.1:${umamiServer.address().port}`,
  ANALYTICS_ADMIN_PASSWORD: UMAMI_ADMIN_PASSWORD,
  ANALYTICS_APP_SECRET: APP_SECRET,
})
delete process.env.ANALYTICS_ADMIN_USERNAME
delete process.env.GULLY_BASE_RPC
delete process.env.GULLY_MIN_CONFIRMATIONS
await import('../server/server.mjs')
const accounts = await import('../server/analytics-accounts.mjs')
await new Promise((r) => setTimeout(r, 300))

const admin = (p, method = 'GET', body) => fetch(BASE + p, { method, headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }))

/** A request to analytics.gullylabs.xyz, which this server proxies to the stub. */
function proxy(pathname, { method = 'GET', body = null, raw = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = raw ?? (body === null ? null : Buffer.from(JSON.stringify(body)))
    const r = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method, headers: { host: 'analytics.gullylabs.xyz', origin: 'https://customer.example', ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}), ...headers } }, (res) => {
      let text = ''
      res.on('data', (d) => (text += d))
      res.on('end', () => {
        let data = null
        try {
          data = JSON.parse(text)
        } catch {
          /* not json */
        }
        resolve({ status: res.statusCode, data, text, headers: res.headers })
      })
    })
    r.on('error', reject)
    r.end(payload ?? undefined)
  })
}
const event = (website) => ({ type: 'event', payload: { website, hostname: 'customer.example', url: '/', title: 'Home' } })
const sendEvent = (website) => proxy('/api/send', { method: 'POST', body: event(website) })

const wa = privateKeyToAccount(generatePrivateKey())
const wb = privateKeyToAccount(generatePrivateKey())
const wc = privateKeyToAccount(generatePrivateKey())
const A = wa.address.toLowerCase()
const B = wb.address.toLowerCase()
const ca = makeClient(BASE)
const cb = makeClient(BASE)
const cc = makeClient(BASE)
const anon = makeClient(BASE)

try {
  /* ------------------------------------------------------------ offer --- */
  const plans = (await anon.call('/api/plans')).data
  const ap = plans?.analytics
  check('GET /api/plans has the analytics plans: trial, starter, growth', ap?.plans.map((p) => p.id).join() === 'trial,starter,growth' && ap.trialDays === 14 && ap.graceDays === 30, JSON.stringify(ap?.plans.map((p) => [p.id, p.sites, p.eventsPerMonth])))
  check('the API plans are unchanged', plans.plans.map((p) => p.id).join() === 'free,pro,business')
  check('the analytics trial is 1 site and 10k events; Starter 3 / 100k; Growth 10 / 1M', ap.plans[0].sites === 1 && ap.plans[0].eventsPerMonth === 10_000 && ap.plans[1].sites === 3 && ap.plans[1].eventsPerMonth === 100_000 && ap.plans[2].sites === 10 && ap.plans[2].eventsPerMonth === 1_000_000)

  /* ------------------------------------------------------------ sign-up --- */
  check('the analytics API needs a session', (await anon.call('/api/developer/analytics')).status === 401)
  check('wallet A signs in', (await ca.signIn(wa)).status === 200)
  let r = await ca.call('/api/developer/analytics')
  check('a new wallet has no analytics account and a trial on offer', r.status === 200 && r.data.account === null && r.data.trialAvailable === true && r.data.configured === true)
  check('POSTs need the CSRF header', (await ca.call('/api/developer/analytics/start', { method: 'POST', body: {} })).status === 403)

  r = await ca.post('/api/developer/analytics/start')
  const pwd1 = r.data?.password
  const userA = [...umami.users.values()].find((u) => u.username === `w_${A.slice(2, 12)}`)
  check('"Start free trial" creates a Umami user w_<first 10 hex> with role user', r.status === 201 && !!userA && userA.role === 'user', JSON.stringify(r.data))
  check('its strong random password is shown once and works on Umami', typeof pwd1 === 'string' && pwd1.length >= 20 && userA?.password === pwd1)
  check('the trial runs 14 days with 1 site and 10k events', r.data?.account?.state === 'trial' && r.data.account.plan.id === 'trial' && Math.abs(Date.parse(r.data.account.expiresAt) - Date.now() - 14 * DAY) < 60_000)
  const stored = fs.readFileSync(path.join(tmp, 'analytics.json'), 'utf8')
  check('the Umami password is not stored on our side', !stored.includes(pwd1) && stored.includes(userA.id))
  check('a second start is refused', (await ca.post('/api/developer/analytics/start')).status === 409)
  r = await ca.call('/api/developer/analytics')
  check('the account view never carries a password', r.status === 200 && !JSON.stringify(r.data).includes(pwd1) && !JSON.stringify(r.data).includes(UMAMI_ADMIN_PASSWORD) && r.data.account.username === userA.username)

  r = await ca.post('/api/developer/analytics/password')
  check('reset password sets a new one through the admin API', r.status === 200 && r.data.password !== pwd1 && userA.password === r.data.password)

  /* ------------------------------------------------------------ one-click sign-in --- */
  const UA = { 'user-agent': 'GullyTest/1.0 (sso)', 'cf-connecting-ip': '203.0.113.10' }
  const passwordBefore = userA.password
  check('the account view says one-click sign-in is on', (await ca.call('/api/developer/analytics')).data.account.ssoAvailable === true)
  check('SSO needs the CSRF header', (await ca.call('/api/developer/analytics/sso', { method: 'POST', body: {} })).status === 403)
  check('SSO needs a session', (await anon.post('/api/developer/analytics/sso')).status === 401)
  const { canWrite } = await import('../server/workspaces.mjs')
  check('SSO is for developer, admin and owner roles, not viewer or billing', canWrite('developer', '/api/developer/analytics/sso') && canWrite('admin', '/api/developer/analytics/sso') && !canWrite('viewer', '/api/developer/analytics/sso') && !canWrite('billing', '/api/developer/analytics/sso'))
  r = await ca.post('/api/developer/analytics/sso', {}, { headers: UA })
  const code1 = r.data?.url?.match(/\/sso\?code=([\w-]+)$/)?.[1]
  check('POST /sso answers a one-time link on the analytics host, valid 60 s', r.status === 201 && r.data.url.startsWith('https://analytics.gullylabs.xyz/sso?code=') && code1?.length === 43 && Math.abs(Date.parse(r.data.expiresAt) - Date.now() - 60_000) < 2_000, JSON.stringify(r.data))
  const ssoMod = await import('../server/analytics-sso.mjs')
  check('only a hash of the code is kept', ssoMod.ssoCodeCountForTest() >= 1 && !JSON.stringify([...Object.values(ssoMod)]).includes(code1))
  let px = await proxy(`/sso?code=${code1}`, { headers: { ...UA, 'cf-connecting-ip': '203.0.113.77', accept: 'text/html' } })
  const tokenJson = px.text.match(/localStorage\.setItem\('umami\.auth',("(?:[^"\\]|\\.)*")\)/)?.[1]
  const minted = tokenJson ? JSON.parse(JSON.parse(tokenJson)) : null
  check('the exchange page stores a token in umami.auth and goes to /dashboard', px.status === 200 && !!minted && px.text.includes("location.replace('/dashboard')"), px.text.slice(0, 200))
  const nonce = px.headers['content-security-policy']?.match(/'nonce-([^']+)'/)?.[1]
  check('its one script runs under a per-response CSP nonce; the page is no-store and no-referrer', !!nonce && px.text.includes(`<script nonce="${nonce}">`) && px.headers['cache-control'] === 'no-store' && px.headers['referrer-policy'] === 'no-referrer')
  const payload = parseUserToken(minted, APP_SECRET)
  check('the token is a Umami session for the workspace’s Umami user, expiring in 12 h', payload?.userId === userA.id && Math.abs(payload.exp - payload.iat - 12 * 3600) < 2, JSON.stringify(payload))
  r = await fetch(`${umamiServer ? `http://127.0.0.1:${umamiServer.address().port}` : ''}/api/auth/verify`, { method: 'POST', headers: { authorization: `Bearer ${minted}` } })
  check('Umami accepts the token (checkAuth semantics)', r.status === 200 && (await r.json()).id === userA.id)
  check('the password was neither read nor changed', userA.password === passwordBefore && !px.text.includes(passwordBefore))
  px = await proxy(`/sso?code=${code1}`, { headers: { ...UA, accept: 'text/html' } })
  check('a code works once', px.status === 410 && !px.text.includes('umami.auth') && /expired or was already used/.test(px.text))
  const code2 = (await ca.post('/api/developer/analytics/sso', {}, { headers: UA })).data.url.split('code=')[1]
  px = await proxy(`/sso?code=${code2}`, { headers: { ...UA, 'user-agent': 'OtherBrowser/2', accept: 'text/html' } })
  check('a code from another browser is refused (and spent)', px.status === 410 && /another browser/.test(px.text))
  const code3 = (await ca.post('/api/developer/analytics/sso', {}, { headers: UA })).data.url.split('code=')[1]
  px = await proxy(`/sso?code=${code3}`, { headers: { ...UA, 'cf-connecting-ip': '198.51.100.9', accept: 'text/html' } })
  check('a code used from another network is refused', px.status === 410)
  const code4 = (await ca.post('/api/developer/analytics/sso', {}, { headers: UA })).data.url.split('code=')[1]
  const realNow = Date.now
  Date.now = () => realNow() + 61_000
  px = await proxy(`/sso?code=${code4}`, { headers: { ...UA, accept: 'text/html' } })
  Date.now = realNow
  check('a code older than 60 s is refused', px.status === 410)
  check('a made-up code is refused', (await proxy('/sso?code=' + 'x'.repeat(43), { headers: { ...UA, accept: 'text/html' } })).status === 410)
  let issued = 4
  while (issued < 10) issued += (await ca.post('/api/developer/analytics/sso', {}, { headers: UA })).status === 201 ? 1 : 100
  check('codes are rate limited per wallet (10 per 10 minutes)', (await ca.post('/api/developer/analytics/sso', {}, { headers: UA })).status === 429)
  let fails = 0
  for (let i = 0; i < 25; i++) if ((await proxy('/sso?code=' + crypto.randomBytes(32).toString('base64url'), { headers: { 'user-agent': 'x', 'cf-connecting-ip': '192.0.2.50' } })).status === 429) fails++
  check('failed exchanges are rate limited per IP', fails >= 4, `429s: ${fails}`)
  delete process.env.ANALYTICS_APP_SECRET
  const noSso = await cb.signIn(wb).then(() => cb.post('/api/developer/analytics/sso'))
  check('without a workspace account, SSO answers 404', noSso.status === 404)
  check('without ANALYTICS_APP_SECRET the view says SSO is off', (await ca.call('/api/developer/analytics')).data.account.ssoAvailable === false)
  process.env.ANALYTICS_APP_SECRET = APP_SECRET

  /* ------------------------------------------------------------ proxy: login, speed, headers --- */
  const hitsBefore = umami.loginHits
  px = await proxy('/login', { headers: { accept: 'text/html' } })
  check('GET /login is the branded way in, with the portal first', px.status === 200 && px.text.includes('Sign in from the app dashboard') && px.text.includes('app.gullylabs.xyz/#analytics') && px.text.includes('Reset it in the portal') && px.text.includes('Start the 14-day free trial') && px.text.includes('/login?form=password'))
  check('the login page runs no script', /script-src 'none'/.test(px.headers['content-security-policy'] ?? '') && !px.text.includes('<script'))
  await new Promise((res) => setTimeout(res, 150))
  check('it warms Umami’s password form in the background', umami.loginHits > hitsBefore)
  const warm = umami.loginHits
  px = await proxy('/login?form=password', { headers: { accept: 'text/html', 'accept-encoding': 'gzip' } })
  const px2 = await proxy('/login?form=password', { headers: { accept: 'text/html', 'accept-encoding': 'gzip' } })
  check('the password form is Umami’s own page, served from the 5-minute cache', px.text.includes('umami-login') && px2.text.includes('umami-login') && umami.loginHits === warm && px2.headers['x-gully-cache'] === 'HIT', `hits ${umami.loginHits} vs ${warm}`)
  check('Umami’s CSP gains Cloudflare Web Analytics in script-src and connect-src', /script-src[^;]*https:\/\/static\.cloudflareinsights\.com/.test(px.headers['content-security-policy']) && /connect-src[^;]*https:\/\/cloudflareinsights\.com/.test(px.headers['content-security-policy']), px.headers['content-security-policy'])
  const rscHits = umami.loginHits
  await proxy('/login', { headers: { rsc: '1', accept: '*/*' } })
  check('Next’s client-side navigation to /login still reaches Umami', umami.loginHits === rscHits + 1)
  const s0 = umami.staticHits
  const c1 = await proxy('/_next/static/chunks/app-abc123.js', { headers: { 'accept-encoding': 'gzip' } })
  const c2 = await proxy('/_next/static/chunks/app-abc123.js', { headers: { 'accept-encoding': 'gzip' } })
  check('build chunks are fetched from Umami once, then served from memory', umami.staticHits === s0 + 1 && c2.headers['x-gully-cache'] === 'HIT' && c2.text === c1.text)
  check('build chunks are immutable for a year', c2.headers['cache-control'] === 'public, max-age=31536000, immutable')
  px = await proxy('/api/send', { method: 'OPTIONS', headers: { origin: 'https://app.gullylabs.xyz', 'access-control-request-method': 'POST' } })
  check('the tracker preflight is answered here with CORS', px.status === 204 && px.headers['access-control-allow-origin'] === '*')
  const up = process.env.ANALYTICS_UPSTREAM
  process.env.ANALYTICS_UPSTREAM = 'http://127.0.0.1:9'
  px = await proxy('/api/send', { method: 'POST', body: event(GULLY_SITE) })
  process.env.ANALYTICS_UPSTREAM = up
  check('with Umami down, the beacon still gets CORS headers (no console CORS error)', px.status === 502 && px.headers['access-control-allow-origin'] === '*')

  /* ------------------------------------------------------------ websites --- */
  check('a bad domain is refused', (await ca.post('/api/developer/analytics/sites', { name: 'Shop', domain: 'not a domain' })).status === 400)
  r = await ca.post('/api/developer/analytics/sites', { name: 'My dapp', domain: 'https://App.Example.com/path?x=1' })
  const siteA = r.data?.site
  const wA = umami.websites.get(siteA?.id)
  check('a website is created with the domain cleaned', r.status === 201 && siteA.domain === 'app.example.com' && siteA.dashboardUrl === `https://analytics.gullylabs.xyz/websites/${siteA.id}`, JSON.stringify(r.data))
  check('the website belongs to the wallet’s Umami user (created by the admin, then transferred)', wA?.userId === userA.id && wA.createdBy === 'admin-id')
  check('the trial includes one website', (await ca.post('/api/developer/analytics/sites', { name: 'Second', domain: 'two.example.com' })).status === 409)

  /* ------------------------------------------------------------ proxy --- */
  r = await proxy('/script.js')
  check('other paths stream through the proxy', r.status === 200 && r.text === '/* stub tracker */')
  r = await sendEvent(siteA.id)
  check('an event for a trial website is forwarded', r.status === 200 && r.data?.cache === 'stub-cache' && umami.received.at(-1) === siteA.id)
  r = await sendEvent(GULLY_SITE)
  check('an event for the Gully Labs site is forwarded', r.status === 200 && umami.received.at(-1) === GULLY_SITE)
  r = await proxy('/api/send', { method: 'POST', raw: Buffer.alloc(70 * 1024, 32) })
  check('a tracker call over 64 KB is refused with 413', r.status === 413)

  r = await ca.call('/api/developer/analytics')
  check('accepted events are counted per website', r.data.account.eventsThisMonth === 1 && r.data.account.sites[0].eventsThisMonth === 1)

  // Fill the trial's month up to 3 events short of its quota.
  accounts.recordEvents(new Map([[siteA.id, 10_000 - 4]]))
  r = await sendEvent(siteA.id)
  check('under the quota events still pass', r.status === 200)
  const before = umami.received.length
  r = await proxy('/api/batch', { method: 'POST', body: [event(siteA.id), event(siteA.id), event(siteA.id), event(GULLY_SITE)] })
  const got = umami.received.slice(before)
  check('a batch is cut to the quota: 2 of 3 events for the site, the Gully Labs one kept', r.status === 200 && got.filter((x) => x === siteA.id).length === 2 && got.includes(GULLY_SITE), JSON.stringify(got))
  const before2 = umami.received.length
  r = await sendEvent(siteA.id)
  check('over the quota: 402 without reaching Umami, and the tracker is told to stop', r.status === 402 && r.data?.error?.code === 'gully-quota-exceeded' && r.data?.disabled === true && umami.received.length === before2, JSON.stringify(r.data))
  check('the refusal can be read by the tracker cross-origin', r.headers['access-control-allow-origin'] === 'https://customer.example')
  r = await sendEvent(GULLY_SITE)
  check('the Gully Labs site is never blocked', r.status === 200)
  r = await ca.call('/api/developer/analytics')
  check('the account shows 10,000 events and the site as over quota', r.data.account.eventsThisMonth === 10_000 && r.data.account.sites[0].blocked === 'gully-quota-exceeded')
  r = await ca.call('/api/developer/analytics/usage')
  check('usage reads Umami’s own figures for this month', r.status === 200 && r.data.sites[0].ok && r.data.sites[0].stats.pageviews === umami.received.filter((x) => x === siteA.id).length && r.data.sites[0].stats.customEvents === 0, JSON.stringify(r.data))
  accounts.flushAnalyticsUsage()
  const persisted = JSON.parse(fs.readFileSync(path.join(tmp, 'analytics-usage.json'), 'utf8'))
  check('the counts are persisted in DATA_DIR', Object.values(persisted.months)[0]?.[siteA.id] === 10_000)

  /* ------------------------------------------------------------ pay for Starter --- */
  r = await ca.post('/api/developer/analytics/checkout', { plan: 'trial' })
  check('the trial cannot be bought', r.status === 400)
  r = await ca.post('/api/developer/analytics/checkout', { plan: 'starter', asset: 'base-usdc' })
  const q = r.data?.intent
  check('a Starter checkout quotes the plans price in USDC on Base', r.status === 200 && q.kind === 'analytics' && q.plan === 'starter' && q.usd === String(ap.plans[1].priceUsdc) && q.treasury === TREASURY, JSON.stringify(r.data))
  r = await ca.post('/api/developer/analytics/checkout/verify', { quoteId: q.id, txHash: chain.add({ from: A, value: BigInt(q.amountRaw) - 10_000n }) })
  check('an underpayment is refused', r.status === 422, r.data?.error)
  r = await ca.post('/api/developer/analytics/checkout/verify', { quoteId: q.id, txHash: chain.add({ from: A, value: BigInt(q.amountRaw) }) })
  check('paying the quote starts Starter for 30 days', r.status === 200 && r.data.account.state === 'active' && r.data.account.plan.id === 'starter' && Math.abs(Date.parse(r.data.account.expiresAt) - Date.now() - 30 * DAY) < 60_000, JSON.stringify(r.data))
  r = await sendEvent(siteA.id)
  check('after paying, the website’s events pass again', r.status === 200)
  r = await ca.call('/api/developer/analytics')
  check('the payment is listed under analytics', r.data.payments.length === 1 && r.data.payments[0].kind === 'analytics' && r.data.payments[0].plan === 'starter')
  r = await ca.call('/api/developer/billing')
  check('and not as a tracker API plan payment', r.status === 200 && r.data.payments.length === 0 && r.data.plan.id === 'free')
  r = await ca.post('/api/developer/analytics/sites', { name: 'Docs', domain: 'docs.example.com' })
  check('Starter allows more websites', r.status === 201)

  /* ------------------------------------------------------------ lapse --- */
  check('wallet B signs in and starts a trial', (await cb.signIn(wb)).status === 200 && (await cb.post('/api/developer/analytics/start')).status === 201)
  const siteB = (await cb.post('/api/developer/analytics/sites', { name: 'B site', domain: 'b.example.org' })).data?.site
  check('B’s website takes events', (await sendEvent(siteB.id)).status === 200)
  accounts.shiftAccountForTest(B, 15 * DAY)
  r = await sendEvent(siteB.id)
  check('when the trial lapses, events are refused with 402', r.status === 402 && r.data?.error?.code === 'gully-plan-lapsed')
  r = await cb.call('/api/developer/analytics')
  check('a lapsed account stays readable with its grace date', r.data.account.state === 'lapsed' && Math.abs(Date.parse(r.data.account.readableUntil) - Date.parse(r.data.account.lapsedAt) - 30 * DAY) < 1000)
  check('a lapsed account cannot add websites', (await cb.post('/api/developer/analytics/sites', { name: 'More', domain: 'more.example.org' })).status === 402)

  /* ------------------------------------------------------------ admin --- */
  check('the admin API needs the token', (await fetch(BASE + '/api/admin/analytics')).status === 401)
  r = await admin('/api/admin/analytics')
  const rowA = r.data?.accounts.find((x) => x.address === A)
  const rowB = r.data?.accounts.find((x) => x.address === B)
  check('the admin lists accounts with plan, sites and events this month', r.status === 200 && rowA?.plan === 'starter' && rowA.sites === 2 && rowA.eventsThisMonth === 10_001 && rowB?.state === 'lapsed', JSON.stringify(r.data?.accounts))
  check('the admin list carries no password', !JSON.stringify(r.data).includes(UMAMI_ADMIN_PASSWORD))
  r = await admin(`/api/admin/analytics/${B}/plan`, 'POST', { plan: 'growth', days: 30 })
  check('the admin grants Growth', r.status === 200 && r.data.account.plan === 'growth' && r.data.account.source === 'admin')
  check('a granted plan unblocks events', (await sendEvent(siteB.id)).status === 200)
  r = await admin(`/api/admin/analytics/${B}/plan`, 'POST', { plan: 'none' })
  check('the admin revokes it', r.status === 200 && r.data.account.state === 'lapsed')
  check('a revoked account is blocked again', (await sendEvent(siteB.id)).status === 402)
  check('a bad plan is refused', (await admin(`/api/admin/analytics/${B}/plan`, 'POST', { plan: 'pro' })).status === 400)
  r = await admin(`/api/admin/analytics/${B}/delete`, 'POST')
  check('an account inside its grace period cannot be deleted', r.status === 409, r.data?.error)
  accounts.shiftAccountForTest(B, 31 * DAY)
  r = await admin(`/api/admin/analytics/${B}/delete`, 'POST')
  const userB = [...umami.users.values()].find((u) => u.username === `w_${B.slice(2, 12)}`)
  check('after the grace period the admin deletes it, with its Umami user', r.status === 200 && !!userB?.deletedAt && umami.websites.get(siteB.id).deletedAt)
  check('its website is no longer self-serve, so the proxy leaves it to Umami', (await sendEvent(siteB.id)).status === 400)
  r = await cb.call('/api/developer/analytics')
  check('the wallet can start again, but without a second trial', r.data.account === null && r.data.trialAvailable === false)
  r = await cb.post('/api/developer/analytics/start')
  check('starting again creates a fresh user that needs a plan', r.status === 201 && r.data.account.state === 'lapsed' && r.data.account.username !== userB.username, JSON.stringify(r.data?.account))

  /* ------------------------------------------------------------ not configured --- */
  delete process.env.ANALYTICS_ADMIN_PASSWORD
  check('wallet C signs in', (await cc.signIn(wc)).status === 200)
  r = await cc.call('/api/developer/analytics')
  check('without ANALYTICS_ADMIN_PASSWORD the API says sign-up is off', r.data.configured === false)
  r = await cc.post('/api/developer/analytics/start')
  check('and starting a trial answers 503', r.status === 503, r.data?.error)
  process.env.ANALYTICS_ADMIN_PASSWORD = UMAMI_ADMIN_PASSWORD

  const { pageMeta } = await import('../server/seo.mjs')
  check('the docs have a Gully Analytics page', pageMeta('docs.gullylabs.xyz', '/analytics').found)
} catch (e) {
  check(`no exception (${e?.stack ?? e})`, false)
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
umamiServer.close()
rpc.close()
try {
  fs.rmSync(tmp, { recursive: true, force: true })
} catch {
  /* temp dir */
}
process.exit(t.failed ? 1 : 0)
