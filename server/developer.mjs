// /api/developer/* — the app dashboard's API.
//
// Wallet accounts (Sign-In with Ethereum, EIP-4361; see siwe.mjs). The account is the wallet address,
// lower-cased. Keys are issued instantly, up to MAX_KEYS_PER_ACCOUNT live keys per wallet.
//   GET  /api/developer/nonce                 -> { nonce, expiresAt }            single use, 10 minutes
//   POST /api/developer/siwe    { message, signature }  -> { address }  and sets the session cookie
//   POST /api/developer/logout
//   GET  /api/developer/account               -> address, limits, keys (prefix only, never secrets)
//   POST /api/developer/keys    { name }      -> { key, secret }   the secret is shown once
//   POST /api/developer/keys/:id/rename { name }
//   POST /api/developer/keys/:id/rotate       -> { key, secret }   same key id and history, new secret
//   POST /api/developer/keys/:id/revoke
//   POST /api/developer/keys/link { key }     attach a key issued by the old request flow to this wallet
//   GET  /api/developer/usage?range=24h|7d|30d
//   GET  /api/developer/requests              last 50 requests made with this wallet's keys
//   GET  /api/developer/billing               plan in force, payments, open checkouts, plans on offer
//   POST /api/developer/checkout { plan, asset? }  -> { intent }  a 20-minute quote: exact amount in that asset
//                                             (default USDC on Base) and the treasury (billing.mjs, payments.mjs)
//   POST /api/developer/checkout/verify { plan, txHash, quoteId? } -> 200 plan applied | 202 not confirmed yet | 4xx
//   GET|POST /api/developer/alerts…           gap alerts (alerts.mjs)
//   GET|POST /api/developer/analytics…        Gully Analytics self-serve: trial, websites, plan (analytics-accounts.mjs)
//   GET|POST /api/developer/telegram…         link a Telegram chat to the account (telegram.mjs)
//
// App dashboard v2 (workspaces.mjs, profile.mjs, activity.mjs, exports.mjs):
//   GET  /api/developer/me                    (with a session; a Bearer key still gets the legacy view below)
//   POST /api/developer/profile | company,  GET /api/developer/sessions,  POST /api/developer/sessions/revoke
//   POST /api/developer/workspace/switch | name,  GET /api/developer/team,  POST /api/developer/team/…
//   GET  /api/developer/invite/:token (public preview),  POST /api/developer/invite/accept
//   GET  /api/developer/activity?cursor=,  GET /api/developer/export/usage.csv | payments.csv
//
// Workspaces: every signed-in route runs in the session's active workspace (the wallet's own by default).
// The gate checks membership on every request, resolves `address` to the workspace owner and calls the
// handlers unchanged, so keys, alerts, analytics, billing and Telegram stay keyed by the owner. Every
// POST is checked against the role's write permissions (workspaces.mjs, canWrite). The acting wallet and
// role are on req.gully = { user, workspace, role, sessionId, ip } for handlers that need them.
//
// Sessions: an HttpOnly, SameSite=Lax cookie (Secure off localhost) holding a random id; only its
// SHA-256 is stored (sessions.json), 30 days. CSRF: every POST must carry `X-Requested-With: gully`
// (a header a foreign page cannot send without a CORS preflight we never grant) and, when the browser
// sends an Origin, it must be this host.
//
// Legacy (kept so existing key holders keep working; no longer in the UI):
//   POST /api/developer/request, POST /api/developer/claim, GET /api/developer/me, POST /api/developer/rotate

import { accountUsage, ANON_LIMIT_PER_MIN, keyUsage, lastUsed, recentRequests, usageExtras } from './access.mjs'
import { eventFor, noteTelegramConnect, recordEvent, activityPage, syncTelegram } from './activity.mjs'
import { handleAlerts } from './alerts.mjs'
import { handleExport } from './exports.mjs'
import { handleProfileRoutes } from './profile.mjs'
import { canWrite, forbidden, handleInvitePreview, handleWorkspaceRoutes, roleIn } from './workspaces.mjs'
import { handleAnalyticsAccount } from './analytics-accounts.mjs'
import { handleTelegramAccount } from './telegram.mjs'
import { billingOf, openIntent, verifyPayment } from './billing.mjs'
import { APP_URL, SIGN_IN_HOSTS } from './hosts.mjs'
import { bearer, clientIp, json, readJson } from './http.mjs'
import { planOf, publicPlans } from './plans.mjs'
import { verifySiwe, issueNonce } from './siwe.mjs'
import {
  createSession,
  deleteSession,
  developers,
  findKey,
  findSession,
  getAccount,
  issueKey,
  KEY_LIMIT_PER_MIN,
  keysOf,
  MAX_KEYS_PER_ACCOUNT,
  randomToken,
  rotateKeySecret,
  safeEqual,
  saveDevelopers,
  setSessionWorkspace,
  sha256,
  SESSION_TTL_MS,
  touchAccount,
  touchSession,
} from './store.mjs'

const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}$/
const NAME_RE = /^[\p{L}\p{N} ._\-]{1,40}$/u
const hits = new Map() // `${bucket}:${who}` -> [timestamps]

/** Records a hit and says whether `who` is still under `max` hits per `ms` in this bucket. */
function allow(bucket, who, max, ms) {
  const k = `${bucket}:${who}`
  const now = Date.now()
  const list = (hits.get(k) ?? []).filter((t) => now - t < ms)
  if (list.length >= max) {
    hits.set(k, list)
    return false
  }
  list.push(now)
  hits.set(k, list)
  return true
}
setInterval(() => {
  const now = Date.now()
  for (const [k, list] of hits) if (!list.some((t) => now - t < 3_600_000)) hits.delete(k)
}, 600_000).unref?.()

const clean = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

const hostOf = (req) => String(req.headers.host ?? '').toLowerCase()
const isLocalHost = (host) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)

/* ------------------------------------------------------------ sessions --- */

const cookieName = (req) => (isLocalHost(hostOf(req)) ? 'gl_dev' : '__Host-gl_dev')

function readCookie(req, name) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

function sessionCookie(req, value, maxAgeSec) {
  const secure = isLocalHost(hostOf(req)) ? '' : '; Secure'
  return `${cookieName(req)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`
}

function currentSession(req) {
  const id = readCookie(req, cookieName(req))
  const s = id ? findSession(id) : null
  return s ? { id, ...s } : null
}

/** CSRF guard for every state-changing request. */
function sameSite(req) {
  if (req.headers['x-requested-with'] !== 'gully') return false
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host.toLowerCase() === hostOf(req)
  } catch {
    return false
  }
}

/* --------------------------------------------------------------- views --- */

// A wallet's key is limited by the wallet's plan; a legacy key with no wallet by its own stored limit.
const keyView = (k) => ({ id: k.id, name: k.name ?? k.project ?? 'Key', prefix: k.prefix, limit: k.owner ? planOf(k.owner).perMin : k.limit, createdAt: k.createdAt, rotatedAt: k.rotatedAt ?? null, revokedAt: k.revokedAt, lastUsed: lastUsed(k.id) })

function accountView(address) {
  const a = getAccount(address)
  const keys = keysOf(address)
  const plan = planOf(address)
  return {
    address,
    createdAt: a?.createdAt ?? null,
    blocked: !!a?.blocked,
    plan: { id: plan.id, name: plan.name, expiresAt: plan.expiresAt, source: plan.source, alerts: plan.alerts, historyDays: plan.historyDays },
    limits: { anonymousPerMin: ANON_LIMIT_PER_MIN, keyPerMin: plan.perMin, freeKeyPerMin: KEY_LIMIT_PER_MIN, maxKeys: MAX_KEYS_PER_ACCOUNT },
    keys: keys.map(keyView),
  }
}

/* ------------------------------------------------------------- handler --- */

export async function handleDeveloper(req, res, url) {
  const p = url.pathname
  const ip = clientIp(req)
  const post = req.method === 'POST'

  /* ---------- wallet sign-in ---------- */

  if (p === '/api/developer/nonce') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    if (!allow('nonce', ip, 30, 60_000)) return json(res, 429, { error: 'Too many sign-in attempts. Wait a minute.' }), true
    const n = issueNonce()
    if (!n) return json(res, 503, { error: 'Sign-in is busy. Try again in a minute.' }), true
    return json(res, 200, n), true
  }

  if (p === '/api/developer/siwe') {
    if (!post) return json(res, 405, { error: 'POST only' }), true
    if (!sameSite(req)) return json(res, 403, { error: 'Cross-site request refused.' }), true
    if (!allow('siwe', ip, 20, 600_000)) return json(res, 429, { error: 'Too many sign-in attempts. Try again in ten minutes.' }), true
    const host = hostOf(req)
    const local = isLocalHost(host)
    // The SIWE domain must be the host asked (verifySiwe). The old developers host is still accepted while it is retired.
    if (!local && !SIGN_IN_HOSTS.includes(host)) return json(res, 400, { error: `Sign in at ${APP_URL}.` }), true
    const body = await readJson(req, 24_000)
    const v = await verifySiwe({ message: body?.message, signature: body?.signature, host, secureOrigin: !local })
    if (!v.ok) return json(res, 401, { error: v.error }), true
    if (getAccount(v.address)?.blocked) return json(res, 403, { error: 'This wallet is blocked from the developer programme. Contact hello@gullylabs.xyz.' }), true
    touchAccount(v.address)
    const id = createSession(v.address, { userAgent: String(req.headers['user-agent'] ?? '') })
    return json(res, 200, { address: v.address }, { 'Set-Cookie': sessionCookie(req, id, Math.floor(SESSION_TTL_MS / 1000)) }), true
  }

  if (p === '/api/developer/logout') {
    if (!post) return json(res, 405, { error: 'POST only' }), true
    if (!sameSite(req)) return json(res, 403, { error: 'Cross-site request refused.' }), true
    const s = currentSession(req)
    if (s) deleteSession(s.id)
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) }), true
  }

  /* ---------- signed-in routes ---------- */

  const accountRoute =
    p === '/api/developer/account' ||
    p === '/api/developer/usage' ||
    p === '/api/developer/requests' ||
    p === '/api/developer/keys' ||
    p.startsWith('/api/developer/keys/') ||
    p === '/api/developer/billing' ||
    p === '/api/developer/checkout' ||
    p === '/api/developer/checkout/verify' ||
    p === '/api/developer/alerts' ||
    p.startsWith('/api/developer/alerts/') ||
    p === '/api/developer/analytics' ||
    p.startsWith('/api/developer/analytics/') ||
    p === '/api/developer/telegram' ||
    p.startsWith('/api/developer/telegram/')
  // Portal v2: the public invite preview, then the signed-in routes of the new modules.
  if (p.startsWith('/api/developer/invite/') && p !== '/api/developer/invite/accept') return handleInvitePreview(req, res, url)
  const v2Route =
    (p === '/api/developer/me' && !bearer(req)) ||
    p === '/api/developer/profile' ||
    p === '/api/developer/company' ||
    p === '/api/developer/sessions' ||
    p === '/api/developer/sessions/revoke' ||
    p === '/api/developer/workspace/switch' ||
    p === '/api/developer/workspace/name' ||
    p === '/api/developer/team' ||
    p.startsWith('/api/developer/team/') ||
    p === '/api/developer/invite/accept' ||
    p === '/api/developer/activity' ||
    p.startsWith('/api/developer/export/')

  if (accountRoute || v2Route) {
    if (post && !sameSite(req)) return json(res, 403, { error: 'Cross-site request refused.' }), true
    if (!post && req.method !== 'GET') return json(res, 405, { error: 'GET or POST only' }), true
    const s = currentSession(req)
    if (!s) return json(res, 401, { error: 'Not signed in.' }), true
    const user = s.address
    const account = getAccount(user)
    if (!account || account.blocked) return json(res, 403, { error: 'This wallet is blocked from the developer programme. Contact hello@gullylabs.xyz.' }), true

    // The active workspace, re-checked on every request: a removed member falls back to their own.
    let workspace = s.activeWorkspace ?? user
    let role = roleIn(user, workspace)
    if (!role) {
      workspace = user
      role = 'owner'
      if (s.activeWorkspace) setSessionWorkspace(s.id, null)
    }
    touchSession(s.id)
    if (post && !canWrite(role, p)) return forbidden(res, role)
    const ctx = { user, workspace, role, sessionId: s.id, ip, clearCookie: sessionCookie(req, '', 0) }
    req.gully = ctx

    if (v2Route) {
      if (p === '/api/developer/activity') {
        if (post) return json(res, 405, { error: 'GET only' }), true
        const page = activityPage(workspace, url.searchParams.get('cursor') || null)
        if (!page) return json(res, 400, { error: 'That cursor is not valid any more. Load the log from the start.' }), true
        return json(res, 200, { workspace: { id: workspace }, ...page }), true
      }
      if (p.startsWith('/api/developer/export/')) return handleExport(req, res, url, ctx)
      if (p === '/api/developer/me' || p === '/api/developer/profile' || p === '/api/developer/company' || p.startsWith('/api/developer/sessions')) return handleProfileRoutes(req, res, url, ctx)
      return handleWorkspaceRoutes(req, res, url, ctx)
    }

    // The older routes run unchanged for the workspace owner's address; successful changes are logged.
    const sub = p.slice('/api/developer'.length)
    const km = post ? sub.match(/^\/keys\/([\w-]{1,40})\/rename$/) : null
    const pre = km ? { keyName: keysOf(workspace).find((k) => k.id === km[1])?.name ?? null } : {}
    let captured = null
    if (post) {
      const end = res.end
      res.end = function (chunk, ...rest) {
        if (typeof chunk === 'string' && chunk.length < 200_000) captured = chunk
        return end.call(this, chunk, ...rest)
      }
    }
    const handled = await ownerRoutes(req, res, url, workspace, p, post)
    try {
      if (post) {
        if (p === '/api/developer/telegram/connect' && res.statusCode === 200) noteTelegramConnect(workspace, user)
        let body = null
        try {
          body = captured ? JSON.parse(captured) : null
        } catch {
          /* not json */
        }
        const e = eventFor('POST', sub, res.statusCode, body, pre)
        if (e) recordEvent(workspace, { actor: user, ...e })
      }
      if (p.startsWith('/api/developer/telegram') || p.startsWith('/api/developer/alerts') || p === '/api/developer/account') syncTelegram(workspace, user)
    } catch (err) {
      console.error('activity:', err?.message ?? err)
    }
    return handled
  }

  return legacyRoutes(req, res, url, p, post, ip)
}

/** The account routes as they were before workspaces, for the wallet `address` (the workspace owner). */
async function ownerRoutes(req, res, url, address, p, post) {
  {
    const mine = keysOf(address)

    if (p === '/api/developer/account') return json(res, 200, accountView(address)), true

    if (p === '/api/developer/usage') {
      const range = url.searchParams.get('range') ?? '24h'
      const ids = mine.map((k) => k.id)
      return json(res, 200, { ...accountUsage(ids, range), ...usageExtras(ids, range), keys: mine.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, revoked: !!k.revokedAt })) }), true
    }

    if (p === '/api/developer/requests') {
      const names = Object.fromEntries(mine.map((k) => [k.id, { name: k.name, prefix: k.prefix }]))
      return json(res, 200, { requests: recentRequests(mine.map((k) => k.id)).map((r) => ({ ...r, key: names[r.keyId] ?? null })) }), true
    }

    if (p === '/api/developer/alerts' || p.startsWith('/api/developer/alerts/')) return handleAlerts(req, res, url, address)

    if (p === '/api/developer/analytics' || p.startsWith('/api/developer/analytics/')) return handleAnalyticsAccount(req, res, url, address)
    if (p === '/api/developer/telegram' || p.startsWith('/api/developer/telegram/')) return handleTelegramAccount(req, res, url, address)

    if (p === '/api/developer/billing') return json(res, 200, { ...billingOf(address), offer: publicPlans() }), true

    if (!post) return json(res, 405, { error: 'POST only' }), true

    if (p === '/api/developer/checkout') {
      if (!allow('checkout', address, 30, 3_600_000)) return json(res, 429, { error: 'Too many checkouts started in the last hour. Try again later.' }), true
      const body = await readJson(req, 1_000)
      const r = await openIntent(address, String(body?.plan ?? ''), body?.asset ? String(body.asset) : undefined)
      return r.ok ? json(res, 200, { intent: r.intent }) : json(res, r.status, { error: r.error }), true
    }

    if (p === '/api/developer/checkout/verify') {
      if (!allow('verify', address, 60, 3_600_000)) return json(res, 429, { error: 'Too many payment checks in the last hour. Try again later.' }), true
      const body = await readJson(req, 1_000)
      const r = await verifyPayment(address, String(body?.plan ?? ''), body?.txHash, body?.quoteId ? String(body.quoteId) : null)
      if (r.ok) return json(res, 200, { payment: r.payment, plan: r.plan }), true
      return json(res, r.status, { error: r.error, ...(r.pending ? { pending: true, confirmations: r.confirmations, needed: r.needed } : {}) }), true
    }

    if (p === '/api/developer/keys') {
      const body = await readJson(req, 2_000)
      const name = clean(body?.name, 40)
      if (!NAME_RE.test(name)) return json(res, 400, { error: 'Name the key: 1 to 40 letters, digits, spaces, dots, dashes or underscores.' }), true
      if (mine.filter((k) => !k.revokedAt).length >= MAX_KEYS_PER_ACCOUNT) return json(res, 409, { error: `You have ${MAX_KEYS_PER_ACCOUNT} live keys, the most a wallet can hold. Revoke one first.` }), true
      if (!allow('newkey', address, 10, 3_600_000)) return json(res, 429, { error: 'Too many keys created in the last hour. Try again later.' }), true
      const { key, secret } = issueKey({ owner: address, name })
      return json(res, 201, { key: keyView(key), secret }), true
    }

    if (p === '/api/developer/keys/link') {
      if (!allow('link', address, 10, 900_000)) return json(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' }), true
      const body = await readJson(req, 2_000)
      const key = findKey(clean(body?.key, 100))
      if (!key) return json(res, 404, { error: 'No live key matches.' }), true
      if (key.owner && key.owner !== address) return json(res, 409, { error: 'That key already belongs to another wallet.' }), true
      if (!key.owner && mine.filter((k) => !k.revokedAt).length >= MAX_KEYS_PER_ACCOUNT) return json(res, 409, { error: `You have ${MAX_KEYS_PER_ACCOUNT} live keys. Revoke one first.` }), true
      key.owner = address
      key.name ??= key.project ?? 'Linked key'
      saveDevelopers()
      return json(res, 200, { key: keyView(key) }), true
    }

    const m = p.match(/^\/api\/developer\/keys\/([\w-]{1,40})\/(rename|rotate|revoke)$/)
    if (!m) return json(res, 404, { error: 'not found' }), true
    const key = mine.find((k) => k.id === m[1])
    if (!key) return json(res, 404, { error: 'No such key on this account.' }), true
    if (key.revokedAt) return json(res, 409, { error: 'That key is revoked.' }), true

    if (m[2] === 'rename') {
      const body = await readJson(req, 2_000)
      const name = clean(body?.name, 40)
      if (!NAME_RE.test(name)) return json(res, 400, { error: 'Name the key: 1 to 40 letters, digits, spaces, dots, dashes or underscores.' }), true
      key.name = name
      saveDevelopers()
      return json(res, 200, { key: keyView(key) }), true
    }
    if (m[2] === 'rotate') {
      if (!allow('newkey', address, 10, 3_600_000)) return json(res, 429, { error: 'Too many keys created in the last hour. Try again later.' }), true
      const secret = rotateKeySecret(key)
      return json(res, 200, { key: keyView(key), secret }), true
    }
    key.revokedAt = new Date().toISOString()
    saveDevelopers()
    return json(res, 200, { key: keyView(key) }), true
  }
}

/** The legacy routes (manual approval flow, Bearer-key views). */
async function legacyRoutes(req, res, url, p, post, ip) {
  /* ---------- legacy: manual approval flow ---------- */

  if (p === '/api/developer/request') {
    if (!post) return json(res, 405, { error: 'POST only' }), true
    if (!allow('request', ip, 5, 3_600_000)) return json(res, 429, { error: 'Too many requests from this address. Try again in an hour.' }), true
    const body = await readJson(req)
    const email = clean(body?.email, 254).toLowerCase()
    const project = clean(body?.project, 80)
    const use = clean(body?.use, 1000)
    const site = clean(body?.url, 200)
    if (!EMAIL_RE.test(email)) return json(res, 400, { error: 'A valid email is required.' }), true
    if (project.length < 2) return json(res, 400, { error: 'Name your project.' }), true
    if (use.length < 10) return json(res, 400, { error: 'Say in a sentence what you will build.' }), true
    if (site && !/^https?:\/\/\S+$/.test(site)) return json(res, 400, { error: 'The website must start with http:// or https://.' }), true
    const claimCode = `glc_${randomToken(18)}`
    const r = { id: randomToken(9), email, project, url: site || null, use, claimHash: sha256(claimCode), status: 'pending', createdAt: new Date().toISOString(), decidedAt: null, keyId: null, claimedAt: null }
    developers().requests.push(r)
    saveDevelopers()
    return json(res, 201, { requestId: r.id, claimCode, status: 'pending' }), true
  }

  if (p === '/api/developer/claim') {
    if (!post) return json(res, 405, { error: 'POST only' }), true
    const failKey = `claimfail:${ip}`
    const fails = (hits.get(failKey) ?? []).filter((t) => Date.now() - t < 900_000)
    if (fails.length >= 10) return json(res, 429, { error: 'Too many failed attempts. Try again in 15 minutes.' }), true
    const body = await readJson(req)
    const r = developers().requests.find((x) => x.id === clean(body?.requestId, 40))
    if (!r || !safeEqual(r.claimHash, sha256(clean(body?.claimCode, 80)))) {
      hits.set(failKey, [...fails, Date.now()])
      return json(res, 404, { error: 'No request matches that ID and claim code.' }), true
    }
    if (r.status !== 'approved') return json(res, 200, { status: r.status, project: r.project, createdAt: r.createdAt }), true
    if (r.claimedAt) return json(res, 200, { status: 'claimed', project: r.project, claimedAt: r.claimedAt }), true
    const { key, secret } = issueKey({ requestId: r.id, project: r.project, email: r.email })
    r.keyId = key.id
    r.claimedAt = new Date().toISOString()
    saveDevelopers()
    return json(res, 200, { status: 'approved', project: r.project, key: secret, limit: key.limit }), true
  }

  if (p === '/api/developer/me') {
    const key = findKey(bearer(req))
    if (!key) return json(res, 401, { error: 'Sign in with a valid API key.' }), true
    return json(res, 200, { project: key.project ?? key.name, prefix: key.prefix, limit: key.limit, createdAt: key.createdAt, usage: keyUsage(key.id) }), true
  }

  if (p === '/api/developer/rotate') {
    if (!post) return json(res, 405, { error: 'POST only' }), true
    const key = findKey(bearer(req))
    if (!key) return json(res, 401, { error: 'Sign in with a valid API key.' }), true
    const secret = rotateKeySecret(key)
    return json(res, 200, { key: secret, limit: key.limit }), true
  }

  return false
}
