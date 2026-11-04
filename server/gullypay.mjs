// Gully Pay (gullypay.xyz) as this server's payment gateway: hosted checkout sessions created with the HolderMaps
// merchant's store API key, and the signed merchant webhook that tells us a session was paid. Owner rule
// (2026-10-24): every Gully product bills through Gully Pay checkout + webhooks.
//
// CONFIG (never in the repo): a JSON file, mode 600, at GULLYPAY_CONFIG_FILE (default <DATA_DIR>/secrets/gullypay.json)
//   { "apiUrl": "https://gullypay.xyz/api", "checkoutUrl": "https://checkout.gullypay.xyz", "merchantId": "<uuid>",
//     "storeId": "<uuid>", "apiKey": "rk_…", "webhookSigningKey": "<hex>" }
// or the same values as env vars GULLYPAY_API_URL, GULLYPAY_CHECKOUT_URL, GULLYPAY_MERCHANT_ID, GULLYPAY_STORE_ID,
// GULLYPAY_API_KEY, GULLYPAY_WEBHOOK_SIGNING_KEY (env wins). The file is re-read when it changes, no restart needed.
// `webhookSigningKey` is the `secretHash` Gully Pay returns once when the webhook subscription is created.
//
// WEBHOOK: POST /api/gullypay/webhook (public, no CSRF header: Gully Pay is the caller; the signature is the auth).
//   Headers X-GullyPay-Event, X-GullyPay-Event-Id, X-GullyPay-Timestamped-Signature `t=<unix>,v1=<hex>` where v1 is
//   HMAC-SHA256(signingKey, "<t>.<raw body>"); |now - t| <= 300 s. Body { id, type, created, data: { object } }.
//   401 bad or stale signature (nothing recorded) · 400 not JSON / no event id · 200 { ok, duplicate? } handled or
//   ignored · 500 a handler threw (not recorded, so Gully Pay retries) · 503 not configured.
//   Every event id is handled at most once: ids are kept in <DATA_DIR>/gullypay-events.json for 45 days.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, json } from './http.mjs'

const dataDir = () => process.env.DATA_DIR ?? DATA_DIR
const configFile = () => process.env.GULLYPAY_CONFIG_FILE || path.join(dataDir(), 'secrets', 'gullypay.json')
export const SIGNATURE_TOLERANCE_S = 300
const EVENT_KEEP_MS = 45 * 86_400_000

/* ------------------------------------------------------------------ config --- */

let cached = { file: null, mtime: -1, value: {} }
function fileConfig() {
  const f = configFile()
  let st
  try {
    st = fs.statSync(f)
  } catch {
    cached = { file: f, mtime: -1, value: {} }
    return cached.value
  }
  if (cached.file === f && cached.mtime === st.mtimeMs) return cached.value
  let value = {}
  try {
    const raw = JSON.parse(fs.readFileSync(f, 'utf8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) value = raw
  } catch (e) {
    console.error('gullypay: the config file is not valid JSON:', e?.message ?? e)
  }
  cached = { file: f, mtime: st.mtimeMs, value }
  return value
}

/** The Gully Pay settings (env over the config file). Secrets stay in this object; never log it. */
export function gullyPayConfig() {
  const f = fileConfig()
  const pick = (env, key, dflt = '') => String(process.env[env] ?? f[key] ?? dflt).trim()
  return {
    apiUrl: pick('GULLYPAY_API_URL', 'apiUrl', 'https://gullypay.xyz/api').replace(/\/+$/, ''),
    checkoutUrl: pick('GULLYPAY_CHECKOUT_URL', 'checkoutUrl', 'https://checkout.gullypay.xyz').replace(/\/+$/, ''),
    merchantId: pick('GULLYPAY_MERCHANT_ID', 'merchantId'),
    storeId: pick('GULLYPAY_STORE_ID', 'storeId'),
    apiKey: pick('GULLYPAY_API_KEY', 'apiKey'),
    signingKey: pick('GULLYPAY_WEBHOOK_SIGNING_KEY', 'webhookSigningKey'),
  }
}

/** Checkout can be offered: a store, its API key and the webhook signing key are all set. */
export function gullyPayEnabled() {
  const c = gullyPayConfig()
  return /^[0-9a-f-]{36}$/i.test(c.storeId) && c.apiKey.length > 8 && c.signingKey.length >= 16
}

/* ---------------------------------------------------------------- checkout --- */

let fetchImpl = (...a) => fetch(...a)
/** Test hook: the fetch used to call the Gully Pay API. */
export function setGullyPayFetchForTest(f) {
  fetchImpl = f ?? ((...a) => fetch(...a))
}

/**
 * Creates a hosted checkout session. `amountCents` in USD cents. Returns { sessionId, checkoutUrl, expiresAt }.
 * Throws an Error with `.code = 'gullypay-off' | 'gullypay-error'` (the message is safe to show).
 */
export async function createHostedCheckout({ amountCents, currency = 'USD', clientReferenceId, successUrl, cancelUrl }) {
  const c = gullyPayConfig()
  if (!gullyPayEnabled()) throw Object.assign(new Error('Gully Pay checkout is not configured.'), { code: 'gullypay-off' })
  const amount = Number(amountCents)
  if (!Number.isInteger(amount) || amount < 1) throw Object.assign(new Error('Bad amount.'), { code: 'gullypay-error' })
  let r
  try {
    r = await fetchImpl(`${c.apiUrl}/checkout/hosted/${c.storeId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.apiKey}`, 'user-agent': 'gully-labs-holdermaps/1' },
      body: JSON.stringify({ amount, currency, clientReferenceId, successUrl, cancelUrl }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (e) {
    console.error('gullypay: create checkout failed:', e?.message ?? e)
    throw Object.assign(new Error('Gully Pay did not answer. Nothing was charged; try again in a minute.'), { code: 'gullypay-error' })
  }
  let body = null
  try {
    body = await r.json()
  } catch {
    /* not JSON */
  }
  if (!r.ok || !body?.sessionId) {
    console.error(`gullypay: create checkout answered ${r.status}`)
    throw Object.assign(new Error('Gully Pay could not open a checkout. Nothing was charged; try again in a minute.'), { code: 'gullypay-error' })
  }
  const sessionId = String(body.sessionId)
  const url = typeof body.checkoutUrl === 'string' && /^https:\/\//.test(body.checkoutUrl) ? body.checkoutUrl : `${c.checkoutUrl}/${encodeURIComponent(sessionId)}`
  return { sessionId, checkoutUrl: url, expiresAt: body.expiresAt ? new Date(body.expiresAt).toISOString() : null }
}

/* ----------------------------------------------------------------- webhook --- */

/** Checks `t=<unix>,v1=<hex>` against HMAC-SHA256(key, "<t>.<raw>"), |now - t| <= tolerance. Constant time. */
export function verifyTimestampedSignature(header, raw, key, { now = Math.floor(Date.now() / 1000), toleranceS = SIGNATURE_TOLERANCE_S } = {}) {
  if (!header || !key) return false
  const parts = Object.fromEntries(String(header).split(',').map((kv) => kv.trim().split('=', 2)))
  const t = Number(parts.t)
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(parts.v1 ?? '')) return false
  if (Math.abs(now - t) > toleranceS) return false
  const want = crypto.createHmac('sha256', key).update(`${t}.${raw}`).digest()
  const got = Buffer.from(parts.v1, 'hex')
  return want.length === got.length && crypto.timingSafeEqual(want, got)
}

/** Signs a body the way Gully Pay does (tests and the live self-check use it). */
export function signForTest(raw, key, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${crypto.createHmac('sha256', key).update(`${t}.${raw}`).digest('hex')}`
}

const EVENTS_FILE = () => path.join(dataDir(), 'gullypay-events.json')
let seen = null
function seenEvents() {
  if (seen) return seen
  try {
    const raw = JSON.parse(fs.readFileSync(EVENTS_FILE(), 'utf8'))
    seen = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  } catch {
    seen = {}
  }
  return seen
}
function recordEvent(id, type, outcome) {
  const s = seenEvents()
  const now = Date.now()
  for (const [k, v] of Object.entries(s)) if (now - Date.parse(v.at) > EVENT_KEEP_MS) delete s[k]
  s[id] = { at: new Date(now).toISOString(), type, outcome }
  try {
    fs.mkdirSync(path.dirname(EVENTS_FILE()), { recursive: true })
    fs.writeFileSync(EVENTS_FILE() + '.tmp', JSON.stringify(s))
    fs.renameSync(EVENTS_FILE() + '.tmp', EVENTS_FILE())
  } catch (e) {
    console.error('gullypay: saving the event log failed:', e?.message ?? e)
  }
}
/** Test hook: forget the in-memory event log (re-read from DATA_DIR). */
export function resetGullyPayForTest() {
  seen = null
  cached = { file: null, mtime: -1, value: {} }
}

/**
 * Handlers for checkout.session.* events: fn({ type, eventId, object }) -> 'handled' | 'ignored' (or a promise).
 * Each product registers its own and ignores sessions that are not its (by clientReferenceId prefix).
 */
export const gullyPayHandlers = []

function readRaw(req, max = 65_536) {
  return new Promise((resolve) => {
    const chunks = []
    let n = 0
    req.on('data', (c) => {
      n += c.length
      if (n > max) {
        resolve(null)
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(null))
  })
}

// One webhook at a time: two deliveries of the same event never race past the duplicate check.
let chain = Promise.resolve()

/** POST /api/gullypay/webhook. */
export async function handleGullyPayWebhook(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }, { Allow: 'POST' })
  const cfg = gullyPayConfig()
  if (!cfg.signingKey) return json(res, 503, { error: 'Gully Pay webhooks are not configured here.' })
  const raw = await readRaw(req)
  if (raw == null) return json(res, 413, { error: 'Body too large.' })
  if (!verifyTimestampedSignature(req.headers['x-gullypay-timestamped-signature'], raw, cfg.signingKey)) return json(res, 401, { error: 'Bad or stale signature.' })
  let event
  try {
    event = JSON.parse(raw)
  } catch {
    return json(res, 400, { error: 'Not JSON.' })
  }
  const eventId = String(req.headers['x-gullypay-event-id'] ?? event?.id ?? '').trim()
  const type = String(event?.type ?? req.headers['x-gullypay-event'] ?? '')
  if (!eventId || eventId.length > 200) return json(res, 400, { error: 'No event id.' })
  const object = event?.data?.object ?? null
  const run = chain.then(async () => {
    if (seenEvents()[eventId]) return { status: 200, body: { ok: true, duplicate: true } }
    // Another merchant's or store's session is not ours to act on.
    const foreign = !object || (cfg.merchantId && object.merchantId && object.merchantId !== cfg.merchantId) || (cfg.storeId && object.storeId && object.storeId !== cfg.storeId)
    let outcome = 'ignored'
    if (!foreign) {
      for (const h of gullyPayHandlers) {
        const r = await h({ type, eventId, object })
        if (r === 'handled') outcome = 'handled'
      }
    }
    recordEvent(eventId, type, foreign ? 'foreign' : outcome)
    return { status: 200, body: { ok: true, outcome: foreign ? 'foreign' : outcome } }
  })
  chain = run.catch(() => {})
  try {
    const r = await run
    return json(res, r.status, r.body)
  } catch (e) {
    console.error(`gullypay webhook ${type} ${eventId}:`, e?.message ?? e)
    return json(res, 500, { error: 'Handler failed; retry.' })
  }
}
