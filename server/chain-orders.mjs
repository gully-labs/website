// Create a chain, Stage 1: a real order with payment. A person provisions each chain by hand; nothing here deploys.
//
// Prices come from chains-plans.mjs (quoteOrder), the only place they live. The order stores the quote it was sold at.
//
// PUBLIC
//   GET  /api/chain-orders/offer                     tiers, add-ons, parents, flags (no order data)
//   GET  /api/chain-orders/check?chainId=N           { chainId, free, reason? }
//   GET  /api/chain-orders/quote?tier=&addons=a,b    { quote }
//   GET  /api/chain-orders/session                   { gullyId } this browser holds a Sign in with Gully ID session
//   POST /api/chain-orders/webhook                   Gully Pay, signed (below)
// SIGNED IN WITH GULLY ID (a wallet session is refused: 401 gully-id-required). A POST needs X-Requested-With: gully.
//   GET  /api/chain-orders                           { orders } mine, newest first
//   POST /api/chain-orders                           { tier, name, chainId, gasToken, gasSymbol?, parentChainId, addons[], logo?, email?, expect: { dueCents } }
//     201 { order } · 200 { order, duplicate: true } the same buyer already has this chain id open
//     400 bad input · 403 { code: 'mainnet-off' } · 409 { code: 'chain-taken' | 'price-changed' } · 429 too many open
//     503 { code: 'checkout-off' } Gully Pay is not connected yet
//   GET  /api/chain-orders/:id                       { order } the buyer's own; anyone else gets 404
//   POST /api/chain-orders/:id/checkout              { payUrl } opens a hosted checkout, or returns the one still open
//   POST /api/chain-orders/:id/cancel                { order } before payment, or on an order with nothing to pay; frees the chain id
// ADMIN (admin.mjs, after its own auth)
//   GET  /api/admin/chain-orders                     { orders } every order, with internal fields
//   POST /api/admin/chain-orders/:id/status          { status, note? } paid -> setting_up -> live; any -> cancelled
//
// STATUS  awaiting_payment -> paid -> setting_up -> live, and cancelled. ONLY a verified webhook sets paid (or a quote
// that charges nothing). An admin cannot mark an order paid. A quote that charges nothing shows as Received, never Paid.
//
// WHAT TAKES MONEY. By default nothing does: a testnet order charges $0 and needs no Gully Pay settings, and mainnet is shut.
//   CHAIN_TESTNET_TEST_CHARGE_USD   0 (default): a testnet order is recorded with no payment. Above 0: that charge, by checkout.
//   MAINNET_ORDERS, MAINNET_PRICE_CONFIRMED   both on to open mainnet. The second is the owner confirming the base price
//                                             (chains-plans.mjs): it has no public source.
//
// GULLY PAY. Chain orders use THEIR OWN store, never the HolderMaps store of gullypay.mjs:
//   CHAIN_GULLYPAY_STORE_ID, CHAIN_GULLYPAY_MERCHANT_ID, CHAIN_GULLYPAY_API_KEY, CHAIN_GULLYPAY_WEBHOOK_SECRET
//   CHAIN_GULLYPAY_MODE  test (default) | live
//   MAINNET_ORDERS       off (default) | on: mainnet orders also need MAINNET_PRICE_CONFIRMED and CHAIN_GULLYPAY_MODE=live
// Gully Pay has no sandbox in its code (its docs describe rk_test_ keys; every key is rk_<hex>). "Test mode" here is
// testnet USDC.e on chain 485590 for that store's key (GULLY_CHAIN_TESTNET_CHECKOUT_MERCHANTS on Gully Pay). A hosted
// checkout can still offer real rails, so a test order that is paid any other way is NOT marked paid: it is held for a
// person with review code 'real-money-on-test-order'.
//
// WEBHOOK. Timestamped HMAC (gullypay.mjs verifyTimestampedSignature, 5 minutes), own secret, own endpoint. Every event
// id is handled once and kept 45 days. 401 bad or stale · 400 not JSON or no id · 200 handled, ignored or duplicate ·
// 500 could not save (not recorded, so Gully Pay retries) · 503 not configured. checkout.session.completed is final even
// after .expired (a late crypto payment), as Gully Pay's docs say.
//
// MAIL. No provider is wired in this site yet. With CHAIN_MAIL_API_KEY and CHAIN_MAIL_FROM set, status mails go through
// Resend's HTTP API (CHAIN_MAIL_URL overrides it). Unset: no mail, and the order page and the operators' Telegram still work.
//
// Storage: DATA_DIR/chain-orders.json (tmp + rename) { orders: [...], events: { [id]: { at, type, outcome } } }.
// The handlers change state synchronously after their awaits, so two requests cannot both pass a check.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { GAS_TOKENS, BILLING, CHAINS, NITRO_LICENCE_NOTE, ORDER_ADDONS, ORDER_PARENTS, quoteOrder } from './chains-plans.mjs'
import { checkChainId } from './chains-launch.mjs'
import { sameSite, sessionGullyId } from './developer.mjs'
import { createHostedCheckout, gullyPayConfig, gullyPayEnabled, verifyTimestampedSignature } from './gullypay.mjs'
import { clientIp, DATA_DIR, json, readJson } from './http.mjs'
import { APP_URL } from './hosts.mjs'
import { notifyIntake } from './intake-notify.mjs'

export const STATUSES = ['awaiting_payment', 'paid', 'setting_up', 'live', 'cancelled']
const NEXT = { awaiting_payment: ['cancelled'], paid: ['setting_up', 'cancelled'], setting_up: ['live', 'cancelled'], live: ['cancelled'], cancelled: [] }
const LABEL = { awaiting_payment: 'Awaiting payment', paid: 'Paid', setting_up: 'Setting up', live: 'Live', cancelled: 'Cancelled' }
const TAKEN = (o) => o.status !== 'cancelled'
/** Nothing was charged. It is "paid" to the state machine; the buyer, the admin and the mails say Received. */
const nothingDue = (o) => o.quote.dueCents === 0
const labelOf = (o) => (o.status === 'paid' && nothingDue(o) ? 'Received' : LABEL[o.status])
/** Counts against the limit: waiting to pay, or a free order a person has not finished. */
const stillOpen = (o) => o.status === 'awaiting_payment' || (nothingDue(o) && (o.status === 'paid' || o.status === 'setting_up'))
export const MAX_OPEN_PER_BUYER = 5
const RESERVE_MS = 7 * 86_400_000
const SESSION_MS = 30 * 60_000
const EVENT_KEEP_MS = 45 * 86_400_000
const MAX_BODY = 200_000
const MAX_LOGO_BYTES = 96 * 1024
const MAX_WEBHOOK = 65_536
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{2,39}$/u
const SYMBOL_RE = /^[A-Z][A-Z0-9]{1,7}$/
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
// Chains we run or settle to: chainlist may not list them, and they can never be sold.
const RESERVED = new Map([[485590, 'Gully Chain Testnet'], [48559, 'Gully Chain'], [421614, 'Arbitrum Sepolia'], [42161, 'Arbitrum One'], [42170, 'Arbitrum Nova'], [1, 'Ethereum']])

/* ------------------------------------------------------------------ config --- */

const on = (v) => ['on', 'true', '1', 'yes'].includes(String(v ?? '').trim().toLowerCase())
export const mainnetOrdersOn = (env = process.env) => on(env.MAINNET_ORDERS) && on(env.MAINNET_PRICE_CONFIRMED)
export const payMode = (env = process.env) => (String(env.CHAIN_GULLYPAY_MODE ?? '').trim().toLowerCase() === 'live' ? 'live' : 'test')

/** Gully Pay settings for chain orders: the shared API address, this product's own store and secret. */
export function chainPayConfig(env = process.env) {
  const shared = gullyPayConfig()
  const pick = (k) => String(env[k] ?? '').trim()
  return { apiUrl: shared.apiUrl, checkoutUrl: shared.checkoutUrl, merchantId: pick('CHAIN_GULLYPAY_MERCHANT_ID'), storeId: pick('CHAIN_GULLYPAY_STORE_ID'), apiKey: pick('CHAIN_GULLYPAY_API_KEY'), signingKey: pick('CHAIN_GULLYPAY_WEBHOOK_SECRET') }
}

/* ------------------------------------------------------------------- store --- */

const file = () => path.join(process.env.DATA_DIR ?? DATA_DIR, 'chain-orders.json')
let db = null
function load() {
  if (db) return db
  try {
    db = JSON.parse(fs.readFileSync(file(), 'utf8'))
  } catch {
    db = {}
  }
  db.orders ??= []
  db.events ??= {}
  return db
}
function save() {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file() + '.tmp', JSON.stringify(db))
  fs.renameSync(file() + '.tmp', file())
}
/** Tests: forget the in-memory copy. */
export const resetChainOrdersForTest = () => (db = null)
const find = (id) => load().orders.find((o) => o.id === id) ?? null
const nowIso = (t = Date.now()) => new Date(t).toISOString()

/** Unpaid orders older than the reservation give their chain id back. */
export function sweepOrders(now = Date.now()) {
  let n = 0
  for (const o of load().orders) {
    if (o.status !== 'awaiting_payment' || now - Date.parse(o.createdAt) < RESERVE_MS) continue
    setStatus(o, 'cancelled', { by: 'system', note: 'Not paid within 7 days.', at: nowIso(now) })
    n++
  }
  if (n) save()
  return n
}

function setStatus(o, status, { by, note = null, at = nowIso() }) {
  o.status = status
  o.history.push({ at, status, by, note })
}

/* ------------------------------------------------------------------- views --- */

const paymentView = (o) => {
  const last = o.sessions.at(-1)
  return { mode: o.mode, testCharge: o.quote.testCharge, dueCents: o.quote.dueCents, lastError: o.lastError ?? null, sessionOpen: !!last && last.status === 'open' && Date.parse(last.expiresAt) > Date.now(), onHold: o.review.some((r) => !r.resolved) }
}
const buyerView = (o) => ({ id: o.id, status: o.status, statusLabel: labelOf(o), tier: o.tier, name: o.name, chainId: o.chainId, gasToken: o.gasToken, gasSymbol: o.gasSymbol, parent: o.parent, quote: o.quote, logo: o.logo, email: o.email, createdAt: o.createdAt, paidAt: o.paidAt, history: o.history, payment: paymentView(o) })
const listView = (o) => ({ ...buyerView(o), logo: null })
const adminView = (o) => ({ ...buyerView(o), address: o.address, gullySub: o.gullySub, review: o.review, sessions: o.sessions.map((s) => ({ id: s.id, status: s.status, createdAt: s.createdAt, expiresAt: s.expiresAt })), next: NEXT[o.status] })

/* --------------------------------------------------------------- the offer --- */

export function publicOffer() {
  return {
    flags: { testnetOrders: true, mainnetOrders: mainnetOrdersOn() },
    checkout: { enabled: gullyPayEnabled(chainPayConfig()), mode: payMode() },
    freeDays: CHAINS.testnet.freeDays,
    addons: ORDER_ADDONS.map(({ id, name, icon, body, standard, testnetOnly = false, fee = null }) => ({ id, name, icon, body, standard, testnetOnly, fee })),
    parents: ORDER_PARENTS,
    gasTokens: GAS_TOKENS,
    billing: BILLING,
    licenceNote: NITRO_LICENCE_NOTE,
  }
}

const heldBy = (o, address) => o.address === address && TAKEN(o)

/** Free for this buyer: chainlist, chains launched here, chains we run, and orders that hold the id. */
export async function chainIdStatus(chainId, address = null) {
  if (RESERVED.has(chainId)) return { free: false, reason: `${RESERVED.get(chainId)} uses this id.` }
  const base = await checkChainId(chainId)
  if (!base.free) return base
  const holder = load().orders.find((o) => o.chainId === chainId && TAKEN(o))
  if (holder && holder.address !== address) return { free: false, reason: 'Another order already holds this id.' }
  return base
}

/* ----------------------------------------------------------------- reading --- */

function readLogo(v) {
  if (v === undefined || v === null || v === '') return { ok: true, logo: null }
  const m = typeof v === 'string' && /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(v)
  if (!m) return { ok: false, error: 'The logo must be a PNG, JPEG or WebP image.' }
  const bytes = Buffer.from(m[2], 'base64')
  if (bytes.length > MAX_LOGO_BYTES) return { ok: false, error: 'The logo must be under 96 KB.' }
  // The bytes, not the label, decide. SVG is refused: it can carry scripts.
  const sig = { png: bytes.subarray(0, 4).toString('hex') === '89504e47', jpeg: bytes.subarray(0, 3).toString('hex') === 'ffd8ff', webp: bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' }
  return sig[m[1]] ? { ok: true, logo: v } : { ok: false, error: 'The logo file is not the image it says it is.' }
}

/** Validates a body. { ok: true, row } or { ok: false, status, error, code? }. Prices are not read from it. */
export function readOrder(b) {
  const tier = b?.tier
  if (tier !== 'testnet' && tier !== 'mainnet') return { ok: false, status: 400, error: 'Pick testnet or managed mainnet.' }
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!NAME_RE.test(name)) return { ok: false, status: 400, error: 'A chain name is 3 to 40 letters, numbers, spaces, dots or dashes.' }
  if (!Number.isSafeInteger(b.chainId)) return { ok: false, status: 400, error: 'A chain id is a whole number.' }
  if (!GAS_TOKENS.some((g) => g.id === b.gasToken)) return { ok: false, status: 400, error: 'Pick a gas token.' }
  const gasSymbol = b.gasToken === 'eth' ? 'ETH' : String(b.gasSymbol ?? '').trim()
  if (b.gasToken === 'custom' && !SYMBOL_RE.test(gasSymbol)) return { ok: false, status: 400, error: 'A token symbol is 2 to 8 capital letters or numbers.' }
  const parent = ORDER_PARENTS[tier].find((p) => p.id === b.parentChainId)
  if (!parent) return { ok: false, status: 400, error: 'That parent chain is not offered. Nitro is free only on Arbitrum One, Nova or Sepolia.' }
  if (!Array.isArray(b.addons) || b.addons.length > ORDER_ADDONS.length || b.addons.some((a) => typeof a !== 'string')) return { ok: false, status: 400, error: 'One of the add-ons is not offered.' }
  const quote = quoteOrder(tier, b.addons)
  if (!quote) return { ok: false, status: 400, error: 'One of the add-ons is not offered.' }
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
  if (email && (!EMAIL_RE.test(email) || email.length > 254)) return { ok: false, status: 400, error: 'That email address does not look right.' }
  const logo = readLogo(b.logo)
  if (!logo.ok) return { ok: false, status: 400, error: logo.error }
  return { ok: true, row: { tier, name, chainId: b.chainId, gasToken: b.gasToken, gasSymbol, parent, quote, email: email || null, logo: logo.logo } }
}

/* ------------------------------------------------------------ notifications --- */

let mailImpl = (...a) => fetch(...a)
/** Tests: the fetch that sends mail. */
export const setChainMailFetchForTest = (f) => (mailImpl = f ?? ((...a) => fetch(...a)))

const orderUrl = (o) => `${APP_URL}/create-chain/orders/${o.id}`
const MAIL = {
  paid: (o) => [nothingDue(o) ? `Order received for ${o.name}` : `Payment received for ${o.name}`, `We have your order for ${o.name} (chain ${o.chainId}). A person at Gully Labs sets it up next.`],
  setting_up: (o) => [`We are setting up ${o.name}`, `${o.name} (chain ${o.chainId}) is being set up now.`],
  live: (o) => [`${o.name} is live`, `${o.name} (chain ${o.chainId}) is live. Your order page has the details.`],
  cancelled: (o) => [`Your order for ${o.name} is cancelled`, `The order for ${o.name} (chain ${o.chainId}) is cancelled. Write to team@gullylabs.xyz with any questions.`],
}

/** Never throws and never delays the caller. */
async function sendMail(o, status) {
  const key = String(process.env.CHAIN_MAIL_API_KEY ?? '').trim()
  const from = String(process.env.CHAIN_MAIL_FROM ?? '').trim()
  const make = MAIL[status]
  if (!key || !from || !o.email || !make) return false
  const [subject, line] = make(o)
  try {
    const r = await mailImpl(process.env.CHAIN_MAIL_URL || 'https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [o.email], subject, text: `${line}\n\n${orderUrl(o)}\n\nGully Labs` }),
      signal: AbortSignal.timeout(8_000),
    })
    if (!r.ok) console.error(`chain-orders: mail answered ${r.status}`)
    return r.ok
  } catch (e) {
    console.error('chain-orders: mail failed:', e?.message ?? e)
    return false
  }
}

function tell(o, title, extra = []) {
  void notifyIntake({ kind: 'chain-order', title: `${title}: ${o.name}`, fields: [['Chain id', String(o.chainId)], ['Tier', o.tier], ['Status', labelOf(o)], ...extra] })
}

function hold(o, code, detail) {
  o.review.push({ at: nowIso(), code, detail, resolved: false })
  tell(o, 'Chain order needs a person', [['Why', detail]])
}

/* ----------------------------------------------------------------- webhook --- */

function readRaw(req) {
  return new Promise((resolve) => {
    const chunks = []
    let n = 0
    req.on('data', (c) => {
      n += c.length
      if (n > MAX_WEBHOOK) {
        resolve(null)
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(null))
  })
}

/** Applies one event. Returns 'handled' or 'ignored'. Synchronous: it cannot interleave with another request. */
function applyEvent(type, s, cfg) {
  if (!s || s.object !== 'checkout.session') return 'ignored'
  if ((cfg.merchantId && s.merchantId && s.merchantId !== cfg.merchantId) || (cfg.storeId && s.storeId && s.storeId !== cfg.storeId)) return 'ignored'
  const ref = /^chain:(co_[A-Za-z0-9_-]+)$/.exec(String(s.clientReferenceId ?? ''))
  const o = ref ? find(ref[1]) : null
  if (!o) return 'ignored'
  const session = o.sessions.find((x) => x.id === s.id)
  if (!session) {
    hold(o, 'unknown-session', `Gully Pay sent ${type} for session ${String(s.id).slice(0, 40)}, which this order did not open.`)
    return 'handled'
  }
  if (type === 'checkout.session.expired') {
    if (session.status === 'open') session.status = 'expired'
    return 'handled'
  }
  if (type === 'checkout.session.payment_failed') {
    o.lastError = typeof s.failureReason === 'string' && s.failureReason.trim() ? s.failureReason.trim().slice(0, 200) : 'The payment did not go through.'
    return 'handled'
  }
  if (type !== 'checkout.session.completed') return 'ignored'

  if (s.amount !== o.quote.dueCents || String(s.currency ?? '').toUpperCase() !== 'USD') {
    hold(o, 'amount-mismatch', `Gully Pay reports ${s.amount} ${s.currency}, the order is ${o.quote.dueCents} USD cents.`)
    return 'handled'
  }
  if (o.mode === 'test' && !(s.paymentMethod === 'crypto' && s.crypto?.chain === 'gully-chain-testnet')) {
    session.status = 'paid'
    hold(o, 'real-money-on-test-order', `A test order was paid by ${s.paymentMethod ?? 'an unknown method'}${s.crypto?.chain ? ` on ${s.crypto.chain}` : ''}. Refund it.`)
    return 'handled'
  }
  session.status = 'paid'
  if (['paid', 'setting_up', 'live'].includes(o.status)) {
    if (o.paidSession !== session.id) hold(o, 'second-payment', `Session ${String(s.id).slice(0, 40)} also paid. Refund one.`)
    return 'handled'
  }
  if (o.status === 'cancelled') {
    if (load().orders.some((x) => x.id !== o.id && x.chainId === o.chainId && TAKEN(x))) hold(o, 'paid-after-cancel', 'Paid after it was cancelled, and another order now holds the chain id. Refund it.')
    else hold(o, 'paid-after-cancel', 'Paid after it was cancelled. Reopened as paid.')
  }
  o.paidAt = s.occurredAt && Number.isFinite(Date.parse(s.occurredAt)) ? new Date(s.occurredAt).toISOString() : nowIso()
  o.paidSession = session.id
  o.paidBy = s.paymentMethod ?? null
  o.lastError = null
  setStatus(o, 'paid', { by: 'gully-pay' })
  tell(o, 'Chain order paid')
  void sendMail(o, 'paid')
  return 'handled'
}

async function handleWebhook(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }, { Allow: 'POST' })
  const cfg = chainPayConfig()
  if (!cfg.signingKey) return json(res, 503, { error: 'Chain order webhooks are not configured here.' })
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
  const d = load()
  if (d.events[eventId]) return json(res, 200, { ok: true, duplicate: true })
  const outcome = applyEvent(type, event?.data?.object ?? null, cfg)
  const now = Date.now()
  for (const [k, v] of Object.entries(d.events)) if (now - Date.parse(v.at) > EVENT_KEEP_MS) delete d.events[k]
  d.events[eventId] = { at: nowIso(now), type, outcome }
  try {
    save()
  } catch (e) {
    delete d.events[eventId]
    console.error(`chain-orders webhook ${type}:`, e?.message ?? e)
    return json(res, 500, { error: 'Could not save; retry.' })
  }
  return json(res, 200, { ok: true, outcome })
}

/* ---------------------------------------------------------------- checkout --- */

const inFlight = new Map()

/** The open session, or a new one. Two presses share one session. */
async function openCheckout(o) {
  const open = o.sessions.at(-1)
  if (open?.status === 'open' && Date.parse(open.expiresAt) > Date.now() + 60_000) return open
  if (inFlight.has(o.id)) return inFlight.get(o.id)
  const back = orderUrl(o)
  const run = createHostedCheckout({ amountCents: o.quote.dueCents, currency: 'USD', clientReferenceId: `chain:${o.id}`, successUrl: `${back}?checkout=done`, cancelUrl: `${back}?checkout=cancelled`, customerEmail: o.email ?? undefined, config: chainPayConfig() }).then((s) => {
    const row = { id: s.sessionId, url: s.checkoutUrl, status: 'open', createdAt: nowIso(), expiresAt: s.expiresAt ?? nowIso(Date.now() + SESSION_MS) }
    o.sessions.push(row)
    o.lastError = null
    save()
    return row
  })
  inFlight.set(o.id, run)
  try {
    return await run
  } finally {
    inFlight.delete(o.id)
  }
}

/* ------------------------------------------------------------------ routes --- */

const hits = new Map()
function allow(key, max, windowMs) {
  const now = Date.now()
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs)
  if (list.length >= max) return hits.set(key, list), false
  list.push(now)
  hits.set(key, list)
  return true
}
setInterval(() => {
  const now = Date.now()
  for (const [k, list] of hits) if (!list.some((t) => now - t < 3_600_000)) hits.delete(k)
}, 600_000).unref?.()

const noStore = { 'Cache-Control': 'no-store' }

async function createOrder(req, res, who) {
  const body = await readJson(req, MAX_BODY)
  if (!body || typeof body !== 'object') return json(res, 400, { error: 'The request could not be read.' })
  const r = readOrder(body)
  if (!r.ok) return json(res, r.status, { error: r.error, code: r.code })
  const row = r.row
  if (row.tier === 'mainnet' && !mainnetOrdersOn()) return json(res, 403, { error: 'Mainnet orders are not open yet. Talk to us.', code: 'mainnet-off' })
  const mode = row.tier === 'mainnet' ? 'live' : 'test'
  if (row.quote.dueCents > 0 && mode !== payMode()) return json(res, 403, { error: row.tier === 'mainnet' ? 'Mainnet orders need live payments. Talk to us.' : 'Testnet orders are paused. Talk to us.', code: 'mode-mismatch' })
  if (row.quote.dueCents > 0 && !gullyPayEnabled(chainPayConfig())) return json(res, 503, { error: 'Payments are not connected yet. Talk to us.', code: 'checkout-off' })
  if (body.expect?.dueCents !== row.quote.dueCents) return json(res, 409, { error: 'The price changed. Check the summary and try again.', code: 'price-changed', quote: row.quote })
  const st = await chainIdStatus(row.chainId, who.address)
  // Nothing awaits from here on: this block is one step, so two presses cannot make two orders.
  if (!st.free) return json(res, 409, { error: st.reason, code: 'chain-taken' })
  sweepOrders()
  const d = load()
  const same = d.orders.find((o) => o.chainId === row.chainId && heldBy(o, who.address))
  if (same) return json(res, 200, { order: buyerView(same), duplicate: true })
  if (d.orders.filter((o) => heldBy(o, who.address) && stillOpen(o)).length >= MAX_OPEN_PER_BUYER) return json(res, 429, { error: 'You have five open orders. Finish or cancel one first.' })
  const at = nowIso()
  const paidNow = row.quote.dueCents === 0
  const o = { id: `co_${crypto.randomBytes(12).toString('base64url')}`, address: who.address, gullySub: who.sub, ...row, mode, status: 'awaiting_payment', createdAt: at, paidAt: null, paidSession: null, paidBy: null, lastError: null, sessions: [], review: [], history: [{ at, status: 'awaiting_payment', by: 'buyer', note: null }] }
  if (paidNow) {
    o.paidAt = at
    setStatus(o, 'paid', { by: 'free' })
  }
  d.orders.push(o)
  save()
  tell(o, 'New chain order', [['Contact', o.email ?? 'none given']])
  if (paidNow) void sendMail(o, 'paid')
  return json(res, 201, { order: buyerView(o) })
}

/** /api/chain-orders*. Resolves true when it answered. */
export async function handleChainOrders(req, res, url) {
  const p = url.pathname
  const get = req.method === 'GET'
  if (p === '/api/chain-orders/webhook') return await handleWebhook(req, res), true
  if (p === '/api/chain-orders/offer') return get ? json(res, 200, publicOffer(), { 'Cache-Control': 'public, max-age=30' }) : json(res, 405, { error: 'GET only' }), true
  if (p === '/api/chain-orders/quote') {
    if (!get) return json(res, 405, { error: 'GET only' }), true
    const raw = url.searchParams.get('addons') ?? ''
    const quote = quoteOrder(url.searchParams.get('tier'), raw ? raw.split(',').slice(0, 20) : [])
    return quote ? json(res, 200, { quote }) : json(res, 400, { error: 'Pick a listed plan and add-ons.' }), true
  }
  if (p === '/api/chain-orders/check') {
    if (!get) return json(res, 405, { error: 'GET only' }), true
    if (!allow(`check:${clientIp(req)}`, 60, 60_000)) return json(res, 429, { error: 'Too many checks. Wait a minute.' }), true
    const raw = url.searchParams.get('chainId') ?? ''
    const chainId = /^[0-9]{1,17}$/.test(raw) ? Number(raw) : NaN
    sweepOrders()
    const who = sessionGullyId(req)
    return json(res, 200, { chainId: Number.isSafeInteger(chainId) ? chainId : null, ...(await chainIdStatus(chainId, who?.address ?? null)) }, noStore), true
  }

  if (p === '/api/chain-orders/session') return json(res, 200, { gullyId: !!sessionGullyId(req) }, noStore), true

  const who = sessionGullyId(req)
  if (!who) return json(res, 401, { error: 'Sign in with Gully ID to continue.', code: 'gully-id-required' }), true
  if (!get && !sameSite(req)) return json(res, 403, { error: 'Cross-site request refused.' }), true

  if (p === '/api/chain-orders') {
    if (get) return json(res, 200, { orders: load().orders.filter((o) => o.address === who.address).reverse().map(listView) }, noStore), true
    if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST' }), true
    if (!allow(`create:${who.address}`, 60, 3_600_000)) return json(res, 429, { error: 'Too many tries. Wait an hour, or write to team@gullylabs.xyz.' }), true
    return await createOrder(req, res, who), true
  }

  const m = /^\/api\/chain-orders\/(co_[A-Za-z0-9_-]{8,40})(?:\/(checkout|cancel))?$/.exec(p)
  if (!m) return false
  const o = find(m[1])
  if (!o || o.address !== who.address) return json(res, 404, { error: 'No such order.' }), true
  if (!m[2]) return get ? json(res, 200, { order: buyerView(o) }, noStore) : json(res, 405, { error: 'GET only' }), true
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
  const freeCancel = m[2] === 'cancel' && o.status === 'paid' && nothingDue(o)
  if (o.status !== 'awaiting_payment' && !freeCancel) return json(res, 409, { error: 'This order is already past payment.', code: 'not-awaiting-payment', order: buyerView(o) }), true

  if (m[2] === 'cancel') {
    setStatus(o, 'cancelled', { by: 'buyer' })
    save()
    tell(o, 'Chain order cancelled by the buyer')
    return json(res, 200, { order: buyerView(o) }), true
  }
  try {
    const s = await openCheckout(o)
    return json(res, 200, { payUrl: s.url, expiresAt: s.expiresAt }, noStore), true
  } catch (e) {
    return json(res, e?.code === 'gullypay-off' ? 503 : 502, { error: e?.message || 'Gully Pay did not answer. Nothing was charged.', code: e?.code ?? 'gullypay-error' }), true
  }
}

/** /api/admin/chain-orders*. The caller has already checked the admin. */
export async function handleChainOrdersAdmin(req, res, url) {
  const p = url.pathname
  if (p === '/api/admin/chain-orders') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    sweepOrders()
    return json(res, 200, { orders: [...load().orders].reverse().map(adminView), flags: publicOffer().flags, checkout: publicOffer().checkout }, noStore), true
  }
  const m = /^\/api\/admin\/chain-orders\/(co_[A-Za-z0-9_-]{8,40})\/(status|resolve)$/.exec(p)
  if (!m) return false
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
  const o = find(m[1])
  if (!o) return json(res, 404, { error: 'No such order.' }), true
  const body = await readJson(req, 2_000)
  if (m[2] === 'resolve') {
    for (const r of o.review) r.resolved = true
    save()
    return json(res, 200, { order: adminView(o) }), true
  }
  const status = body?.status
  if (!STATUSES.includes(status)) return json(res, 400, { error: 'Not a status.' }), true
  if (!NEXT[o.status].includes(status)) return json(res, 409, { error: `An order that is ${LABEL[o.status].toLowerCase()} cannot move to ${LABEL[status].toLowerCase()}.`, code: 'bad-transition' }), true
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 300) : ''
  setStatus(o, status, { by: 'admin', note: note || null })
  save()
  void sendMail(o, status)
  return json(res, 200, { order: adminView(o) }), true
}
