// The Gully Labs Telegram Mini App's API (the app itself is src/pages/tg, served at gullylabs.xyz/tg and
// opened from the bot's menu button or its "📱 Open app" button).
//
// Auth: every request carries the Mini App's raw initData in `Authorization: tma <initData>`. It is
// validated as Telegram's docs say (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
//   secret_key       = HMAC-SHA256(key "WebAppData", message bot token)
//   data_check_string = every field but `hash`, as key=value sorted by key, joined with "\n"
//   hash             = hex(HMAC-SHA256(key secret_key, message data_check_string))
// The hash is compared in constant time; initData older than 24 hours (auth_date), dated in the future,
// or without a user is refused. Nothing is stored: no session, no cookie, so there is nothing to forge
// across sites (CSRF) either.
//
// The Telegram user is mapped to the account linked to their chat with the bot (telegram.mjs,
// linkForTelegramUser): their private chat, else a group they linked. Alerts are that account's, through
// alerts.mjs's own route handler, so the app has the dashboard's validation and plan limits.
//
// The News channel gate applies here as in the bot: a user who does not follow @GullyLabsNews gets 403
// with { gate } on every route but /api/tg/me, which says whether they follow (the app shows the join
// screen). If membership cannot be checked the gate lets people through, as the bot does.
//
//   GET  /api/tg/me[?fresh=1]          -> { user, gate, linked, portal }
//   GET  /api/tg/sparks                -> { sparks: { "<chain>:<TICKER>": number[] } }   24h of gap, ~24 points
//   GET  /api/tg/launches[?chain=<id>] -> DeepCore launches (deepcore.mjs readLaunches)
//   GET  /api/tg/alerts                -> the linked account's alerts and limits
//   POST /api/tg/alerts                { chain, ticker, pct, direction } -> 201 { alert }   (Telegram delivery)
//   POST /api/tg/alerts/:id/pause|resume|test|delete

import crypto from 'node:crypto'
import { json, readJson } from './http.mjs'
import { getAccount } from './store.mjs'
import { alertsOf } from './alerts.mjs'
import { readLaunches, DEEPCORE_CHAINS } from './deepcore.mjs'
import { readHistory, trackedStocks } from './tracker.mjs'
import { alertsRouteFor, channelUrl, followsChannel, linkForTelegramUser, requiredChannel, telegramToken } from './telegram.mjs'

export const INIT_DATA_MAX_AGE_S = 24 * 3600
const MAX_INIT_DATA = 4_096
const FUTURE_SKEW_S = 300
const PORTAL = 'https://app.gullylabs.xyz'

/**
 * Validates a Mini App's raw initData string with the bot token.
 * @returns {{ ok: true, user: { id: string, firstName: string, lastName: string | null, username: string | null, languageCode: string | null }, authDate: number, startParam: string | null } | { ok: false, error: string }}
 */
export function validateInitData(raw, token, { now = Date.now(), maxAgeS = INIT_DATA_MAX_AGE_S } = {}) {
  if (!token) return { ok: false, error: 'The Mini App is not configured on this server.' }
  const s = String(raw ?? '')
  if (!s || s.length > MAX_INIT_DATA) return { ok: false, error: 'Missing or oversized initData.' }
  let params
  try {
    params = new URLSearchParams(s)
  } catch {
    return { ok: false, error: 'Unreadable initData.' }
  }
  const hash = params.get('hash') ?? ''
  if (!/^[a-f0-9]{64}$/.test(hash)) return { ok: false, error: 'initData has no valid hash.' }
  const keys = [...new Set([...params.keys()])]
  if (keys.length !== [...params.keys()].length) return { ok: false, error: 'initData repeats a field.' }
  const check = keys
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${params.get(k)}`)
    .join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(String(token)).digest()
  const want = crypto.createHmac('sha256', secret).update(check).digest()
  const got = Buffer.from(hash, 'hex')
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return { ok: false, error: 'initData signature does not match.' }
  const authDate = Number(params.get('auth_date'))
  const nowS = Math.floor(now / 1000)
  if (!Number.isInteger(authDate) || authDate <= 0) return { ok: false, error: 'initData has no auth_date.' }
  if (authDate > nowS + FUTURE_SKEW_S) return { ok: false, error: 'initData is dated in the future.' }
  if (nowS - authDate > maxAgeS) return { ok: false, error: 'initData has expired (older than 24 hours). Reopen the app.' }
  let user = null
  try {
    user = JSON.parse(params.get('user') ?? 'null')
  } catch {
    user = null
  }
  const id = user && (typeof user.id === 'number' || typeof user.id === 'string') ? String(user.id) : null
  if (!id || !/^\d{1,20}$/.test(id)) return { ok: false, error: 'initData carries no user.' }
  if (user.is_bot === true) return { ok: false, error: 'Bots cannot use the Mini App.' }
  const str = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : null)
  return {
    ok: true,
    user: { id, firstName: str(user.first_name, 64) ?? 'there', lastName: str(user.last_name, 64), username: str(user.username, 32), languageCode: str(user.language_code, 8) },
    authDate,
    startParam: str(params.get('start_param'), 64),
  }
}

/* ------------------------------------------------------------- limits --- */

const hits = new Map()
function allow(key, max = 120, ms = 60_000) {
  const now = Date.now()
  const list = (hits.get(key) ?? []).filter((t) => now - t < ms)
  if (list.length >= max) return false
  list.push(now)
  hits.set(key, list)
  if (hits.size > 10_000) hits.delete(hits.keys().next().value)
  return true
}

/* ------------------------------------------------------------- sparks --- */

const SPARK_POINTS = 24
let sparkCache = { at: 0, body: null }

/** 24 hours of each tracked stock's gap, thinned to about SPARK_POINTS points (shared, cached a minute). */
export function sparks(now = Date.now()) {
  if (sparkCache.body && now - sparkCache.at < 60_000) return sparkCache.body
  const since = Math.floor(now / 1000) - 24 * 3600
  const out = {}
  for (const s of trackedStocks()) {
    const pts = (readHistory(s.chain, s.ticker) ?? []).filter((p) => p[0] >= since && typeof p[1] === 'number' && Number.isFinite(p[1]))
    if (pts.length < 2) continue
    const step = Math.max(1, Math.ceil(pts.length / SPARK_POINTS))
    const thin = pts.filter((_, i) => i % step === 0)
    if (thin.at(-1) !== pts.at(-1)) thin.push(pts.at(-1))
    out[`${s.chain}:${s.ticker}`] = thin.map((p) => Math.round(p[1] * 100) / 100)
  }
  sparkCache = { at: now, body: out }
  return out
}

/* ------------------------------------------------------------- handler --- */

const tmaOf = (req) => {
  const h = String(req.headers.authorization ?? '')
  return h.startsWith('tma ') ? h.slice(4).trim() : null
}

const viewAlerts = (data) => ({
  alerts: data.alerts.map((a) => ({ ...a, deliveries: (a.deliveries ?? []).slice(0, 3) })),
  limits: data.limits,
})

/** /api/tg/*: the Mini App's API. Returns true when it answered. */
export async function handleMiniApp(req, res, url) {
  const p = url.pathname
  const token = telegramToken()
  if (!token) return json(res, 404, { error: 'The Telegram Mini App is not configured on this server.' }), true
  const auth = validateInitData(tmaOf(req), token)
  if (!auth.ok) return json(res, 401, { error: auth.error }), true
  const user = auth.user
  if (!allow(`u:${user.id}`)) return json(res, 429, { error: 'Too many requests in a minute. Try again shortly.' }), true

  const ch = requiredChannel()
  const follows = ch ? await followsChannel(user.id, { fresh: p === '/api/tg/me' && url.searchParams.get('fresh') === '1' }) : true
  const gate = { required: !!ch, follows, channel: ch, url: ch ? channelUrl(ch) : null }
  const link = linkForTelegramUser(user.id)
  const blocked = !!(link && getAccount(link.address)?.blocked)

  if (p === '/api/tg/me') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    const linked = link ? { chatType: link.chatType, chatTitle: link.chatTitle, account: `${link.address.slice(0, 6)}…${link.address.slice(-4)}`, blocked } : null
    return json(res, 200, { user, gate, linked, portal: `${PORTAL}/#alerts` }), true
  }
  if (!follows) return json(res, 403, { error: `Follow ${ch} to use the app.`, gate }), true

  if (p === '/api/tg/sparks') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    return json(res, 200, { sparks: sparks() }, { 'Cache-Control': 'private, max-age=60' }), true
  }
  if (p === '/api/tg/launches') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    const raw = url.searchParams.get('chain')
    const chainId = raw && raw !== '0' ? Number(raw) : null
    if (chainId !== null && !DEEPCORE_CHAINS[chainId]) return json(res, 400, { error: 'Unknown DeepCore chain.' }), true
    let r
    try {
      r = await readLaunches({ chainId, limit: 20 })
    } catch {
      r = { state: 'unreadable', launches: [], asOf: null, chains: [], error: 'DeepCore could not be read just now.' }
    }
    return json(res, 200, { ...r, chainNames: Object.fromEntries(Object.entries(DEEPCORE_CHAINS).map(([id, c]) => [id, c.name])) }), true
  }
  if (p === '/api/tg/alerts' || p.startsWith('/api/tg/alerts/')) {
    if (!link) return json(res, 409, { error: 'Link this Telegram account to a wallet first: in the app dashboard (app.gullylabs.xyz), Alerts tab, press Connect Telegram.', linkNeeded: true, portal: `${PORTAL}/#alerts` }), true
    if (p === '/api/tg/alerts' && req.method === 'GET') return json(res, 200, viewAlerts(await alertsOf(link.address))), true
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    if (blocked) return json(res, 403, { error: 'This account is blocked from the developer programme.' }), true
    if (!allow(`w:${user.id}`, 30)) return json(res, 429, { error: 'Too many changes in a minute. Try again shortly.' }), true
    if (p === '/api/tg/alerts') {
      const body = await readJson(req, 2_000)
      const r = await alertsRouteFor(link.address, 'POST', '/api/developer/alerts', {
        chain: body?.chain,
        ticker: body?.ticker,
        condition: { type: 'gap', pct: body?.pct, direction: body?.direction ?? 'both' },
        telegram: true,
      })
      return json(res, r.status, r.data ?? { error: 'The alert was not created.' }), true
    }
    const m = p.match(/^\/api\/tg\/alerts\/([\w-]{1,40})\/(pause|resume|test|delete)$/)
    if (!m) return json(res, 404, { error: 'not found' }), true
    const r = await alertsRouteFor(link.address, 'POST', `/api/developer/alerts/${m[1]}/${m[2]}`)
    return json(res, r.status, r.data ?? { error: 'Not changed.' }), true
  }
  return json(res, 404, { error: 'not found' }), true
}

/** Tests only: drop the per-user request counts. */
export const resetMiniAppLimitsForTest = () => hits.clear()
