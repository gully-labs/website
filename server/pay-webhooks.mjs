// Gully Pay merchant webhooks: signed events about invoices, sent to the endpoint of the invoice, of the
// pay link it came from, or (when neither has one) to the global default set in the admin dashboard.
//
// Events (JSON body, see docs.gullylabs.xyz/gully-pay#webhooks):
//   invoice.paid     an invoice was paid and confirmed: chain, asset, exact amount, tx hash, block,
//                    confirmations, payer address, invoice and link ids
//   invoice.expired  an open invoice ran out without a payment
//   invoice.cancelled an admin cancelled an open (or expired) invoice; it can no longer be paid
//   webhook.test     sent by the admin's "Send test event"; never retried
//
// Signing is the same scheme as gap alerts (alerts.mjs), with the endpoint's own secret (whsec_…, shown
// once when the endpoint is set and again only when it is rotated):
//   X-Gully-Timestamp: <unix seconds>
//   X-Gully-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
// The URL rules and the request itself are alerts.mjs's: https only, no credentials, the host must
// resolve to public addresses only and the request is pinned to the checked one, 5 s, no redirects.
//
// Delivery: the first attempt goes out at once; a failure (no 2xx) is retried after 1, 5, 10, 20 and 30
// minutes, six attempts over about an hour, then the delivery is marked failed. The queue lives in
// DATA_DIR/pay-webhooks.json (tmp + rename) so a restart loses nothing: due attempts run on start.
// Each event keeps its id across retries, so a receiver can drop duplicates by `id`.
//
// Redeliver: an admin may send a finished delivery (failed or delivered, never a test event) again. The
// SAME event (same id, same body) goes out as a new delivery with its own attempt series (first attempt at
// once, then the usual retries), signed with the endpoint's current secret. The new delivery records
// `redeliveryOf` (the delivery it repeats); the original keeps its own log untouched.
//
// Env (tests): GULLY_PAY_WEBHOOK_DELAYS_MS  comma-separated retry delays in ms (five of them)
//              GULLY_PAY_WEBHOOK_TICK_MS    queue check interval (default 10000; 0 turns the timer off)

import fs from 'node:fs'
import path from 'node:path'
import { checkWebhookForm, postWebhook, resolvePublic } from './alerts.mjs'
import { ledger, paymentView, save as saveLedger } from './billing.mjs'
import { DATA_DIR } from './http.mjs'
import { fmtUsd } from './payments.mjs'
import { randomToken } from './store.mjs'
import { payBase } from './hosts.mjs'

const FILE = path.join(DATA_DIR, 'pay-webhooks.json')
const USER_AGENT = 'GullyLabs-Pay/1 (+https://docs.gullylabs.xyz/gully-pay)'
export const MAX_ATTEMPTS = 6
const DEFAULT_DELAYS = [60_000, 5 * 60_000, 10 * 60_000, 20 * 60_000, 30 * 60_000]
const KEEP_FINISHED = 1_000
/** invoice.expired is only sent for invoices that ran out within this window (never a backlog flood). */
const EXPIRED_LOOKBACK_MS = 24 * 3_600_000

function delays() {
  const env = String(process.env.GULLY_PAY_WEBHOOK_DELAYS_MS ?? '').trim()
  const list = env ? env.split(',').map(Number).filter((n) => Number.isFinite(n) && n >= 0) : []
  return list.length === MAX_ATTEMPTS - 1 ? list : DEFAULT_DELAYS
}

let db
try {
  db = JSON.parse(fs.readFileSync(FILE, 'utf8'))
} catch {
  db = {}
}
db.default ??= null // { url, secret, createdAt, rotatedAt }
db.deliveries ??= []

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(db))
    fs.renameSync(FILE + '.tmp', FILE)
  } catch (e) {
    console.error('pay webhooks save:', e?.message ?? e)
  }
}

export const newSecret = () => `whsec_${randomToken(24)}`

/**
 * Checks an endpoint URL the way alerts do (form, then DNS: public addresses only).
 * Resolves to { ok: true, url } or { ok: false, error }.
 */
export async function checkEndpoint(raw) {
  const form = checkWebhookForm(raw)
  if (!form.ok) return form
  const target = await resolvePublic(form.url)
  if (!target.ok) return target
  return { ok: true, url: form.url.toString() }
}

/** A fresh endpoint record for a checked URL; its secret is returned to the admin once. */
export function makeEndpoint(url) {
  const now = new Date().toISOString()
  return { url, secret: newSecret(), createdAt: now, rotatedAt: null }
}

/** What an admin is shown of an endpoint: never the secret. */
export const endpointView = (w) => (w ? { url: w.url, createdAt: w.createdAt ?? null, rotatedAt: w.rotatedAt ?? null } : null)

/* -------------------------------------------------------------- targets --- */

/** Endpoint kinds owned by other modules (merchants.mjs: 'merchant' -> the workspace's endpoint), by target id. */
const targetResolvers = new Map()
export const registerWebhookTarget = (name, endpointOfId) => targetResolvers.set(name, endpointOfId)

const findLink = (id) => (id ? (ledger().links.find((l) => l.id === id) ?? null) : null)
const findInvoice = (id) => ledger().invoices.find((i) => i.id === id) ?? null

/** The endpoint record a delivery goes to, read at send time so a rotated secret signs retries. */
function endpointOf(d) {
  if (targetResolvers.has(d.target)) return targetResolvers.get(d.target)(d.targetId)
  if (d.target === 'default') return db.default
  if (d.target === 'link') return findLink(d.targetId)?.webhook ?? null
  if (d.target === 'invoice') return findInvoice(d.targetId)?.webhook ?? null
  return null
}

/** Where an invoice's events go: its own endpoint and its link's; the default only when it has neither. */
function targetsFor(inv) {
  const out = []
  if (inv.webhook) out.push({ target: 'invoice', targetId: inv.id, url: inv.webhook.url })
  const link = findLink(inv.linkId)
  if (link?.webhook && !out.some((t) => t.url === link.webhook.url)) out.push({ target: 'link', targetId: link.id, url: link.webhook.url })
  if (!out.length && db.default) out.push({ target: 'default', targetId: null, url: db.default.url })
  return out
}

/* --------------------------------------------------------------- events --- */

function invoiceBrief(inv) {
  const status = inv.paymentId ? 'paid' : inv.cancelledAt ? 'cancelled' : Date.parse(inv.expiresAt) <= Date.now() ? 'expired' : 'open'
  return { id: inv.id, number: inv.number, title: inv.title, usd: fmtUsd(inv.usdCents), usdCents: inv.usdCents, status, url: `${payBase()}/pay/${inv.id}`, linkId: inv.linkId ?? null, createdAt: inv.createdAt, expiresAt: inv.expiresAt, paidAt: inv.paidAt ?? null, cancelledAt: inv.cancelledAt ?? null }
}

function linkBrief(id) {
  const l = findLink(id)
  return l ? { id: l.id, title: l.title, url: `${payBase()}/pay/l/${l.id}` } : null
}

/** The body of an invoice.paid event. `confirmations` is what the chain showed when it was accepted. */
export function paidEvent(inv, p, confirmations) {
  const v = paymentView(p)
  return {
    id: `evt_${randomToken(12)}`,
    type: 'invoice.paid',
    createdAt: new Date().toISOString(),
    data: {
      invoice: invoiceBrief(inv),
      link: linkBrief(inv.linkId),
      payment: {
        chainId: v.chainId,
        chain: v.chain,
        asset: v.asset,
        symbol: v.symbol,
        decimals: p.decimals,
        amount: v.amount,
        amountRaw: String(p.amountRaw),
        usd: v.usd,
        txHash: v.txHash,
        txUrl: v.txUrl,
        blockNumber: v.blockNumber,
        confirmations,
        payer: v.from,
        to: v.to,
        paidAt: v.at,
        price: v.price,
      },
    },
  }
}

function expiredEvent(inv) {
  return { id: `evt_${randomToken(12)}`, type: 'invoice.expired', createdAt: new Date().toISOString(), data: { invoice: invoiceBrief(inv), link: linkBrief(inv.linkId) } }
}

function cancelledEvent(inv) {
  return { id: `evt_${randomToken(12)}`, type: 'invoice.cancelled', createdAt: new Date().toISOString(), data: { invoice: invoiceBrief(inv), link: linkBrief(inv.linkId) } }
}

export function enqueue(event, inv, targets = targetsFor(inv)) {
  const body = JSON.stringify(event)
  const now = Date.now()
  for (const t of targets) {
    db.deliveries.push({ id: `whd_${randomToken(9)}`, eventId: event.id, type: event.type, test: false, target: t.target, targetId: t.targetId, url: t.url, invoiceId: inv.id, linkId: inv.linkId ?? null, body, state: 'pending', attempts: [], nextAt: new Date(now).toISOString(), createdAt: new Date(now).toISOString(), finishedAt: null })
  }
  if (targets.length) {
    prune()
    save()
    kick()
  }
  return targets.length
}

/** Queues invoice.paid for an invoice that was just paid. Returns how many endpoints it goes to. */
export function emitInvoicePaid(inv, payment, confirmations) {
  return enqueue(paidEvent(inv, payment, confirmations), inv)
}

/** Queues invoice.cancelled for an invoice an admin just cancelled. Returns how many endpoints it goes to. */
export function emitInvoiceCancelled(inv) {
  return enqueue(cancelledEvent(inv), inv)
}

/** Queues invoice.expired for every open invoice that ran out recently and was not announced yet. */
export function sweepExpired(now = Date.now()) {
  let changed = 0
  for (const inv of ledger().invoices) {
    if (inv.paymentId || inv.cancelledAt || inv.expiredEventAt) continue
    const exp = Date.parse(inv.expiresAt)
    if (exp > now) continue
    inv.expiredEventAt = new Date(now).toISOString()
    changed++
    if (now - exp <= EXPIRED_LOOKBACK_MS) enqueue(expiredEvent(inv), inv)
  }
  if (changed) saveLedger()
  return changed
}

/* ------------------------------------------------------------- delivery --- */

const inFlight = new Set()

function prune() {
  const finished = db.deliveries.filter((d) => d.state !== 'pending')
  if (finished.length <= KEEP_FINISHED) return
  const drop = new Set(finished.slice(0, finished.length - KEEP_FINISHED).map((d) => d.id))
  db.deliveries = db.deliveries.filter((d) => !drop.has(d.id))
}

async function attempt(d) {
  const ep = endpointOf(d)
  const at = new Date().toISOString()
  const t0 = Date.now()
  const r = ep ? await postWebhook(ep.url, ep.secret, d.body, { userAgent: USER_AGENT }) : { status: null, ok: false, error: 'the endpoint was removed' }
  d.attempts.push({ at, status: r.status, ok: r.ok, error: r.error ?? null, ms: Date.now() - t0 })
  if (ep) d.url = ep.url
  if (r.ok) {
    d.state = 'delivered'
    d.finishedAt = new Date().toISOString()
    d.nextAt = null
  } else if (!ep || d.attempts.length >= MAX_ATTEMPTS) {
    d.state = 'failed'
    d.finishedAt = new Date().toISOString()
    d.nextAt = null
  } else {
    d.nextAt = new Date(Date.now() + delays()[d.attempts.length - 1]).toISOString()
  }
  return r
}

/** Sends every pending delivery that is due at `now`. Exported as the test hook; the timer calls it too. */
export async function processDue(now = Date.now()) {
  const due = db.deliveries.filter((d) => d.state === 'pending' && !inFlight.has(d.id) && Date.parse(d.nextAt) <= now)
  if (!due.length) return 0
  for (const d of due) inFlight.add(d.id)
  try {
    // A few at a time: each is capped at 5 s.
    for (let i = 0; i < due.length; i += 4) await Promise.all(due.slice(i, i + 4).map(attempt))
  } finally {
    for (const d of due) inFlight.delete(d.id)
    save()
  }
  return due.length
}

let kicking = null
function kick() {
  if (process.env.GULLY_PAY_WEBHOOK_TICK_MS === '0') return
  kicking ??= processDue()
    .catch((e) => console.error('pay webhooks:', e?.message ?? e))
    .finally(() => (kicking = null))
}

const tickMs = Number(process.env.GULLY_PAY_WEBHOOK_TICK_MS ?? 10_000)
if (tickMs > 0) {
  setInterval(() => {
    try {
      sweepExpired()
    } catch (e) {
      console.error('pay webhooks sweep:', e?.message ?? e)
    }
    kick()
  }, tickMs).unref?.()
  // Attempts that came due while the server was down go out shortly after start.
  setTimeout(kick, 2_000).unref?.()
}

/** Test hook: the stored queue, as on disk. */
export const deliveriesForTest = () => db.deliveries

/* ------------------------------------------------------------ test event --- */

/**
 * Sends a webhook.test event to one endpoint now (no retries) and logs it. `target` is
 * { target: 'link'|'invoice'|'default', targetId, linkId?, invoiceId? }.
 */
export async function sendTest(t) {
  const ep = targetResolvers.has(t.target) ? targetResolvers.get(t.target)(t.targetId) : t.target === 'default' ? db.default : t.target === 'link' ? findLink(t.targetId)?.webhook : findInvoice(t.targetId)?.webhook
  if (!ep) return { ok: false, status: 409, error: 'No webhook endpoint is set here.' }
  const event = { id: `evt_${randomToken(12)}`, type: 'webhook.test', createdAt: new Date().toISOString(), data: { target: { type: t.target, id: t.targetId ?? null }, message: 'A test event from Gully Pay. If you can read this and the signature checks out, the endpoint is ready.' } }
  const d = { id: `whd_${randomToken(9)}`, eventId: event.id, type: event.type, test: true, target: t.target, targetId: t.targetId ?? null, url: ep.url, invoiceId: t.invoiceId ?? null, linkId: t.linkId ?? null, body: JSON.stringify(event), state: 'pending', attempts: [], nextAt: null, createdAt: event.createdAt, finishedAt: null }
  db.deliveries.push(d)
  inFlight.add(d.id)
  try {
    const t0 = Date.now()
    const r = await postWebhook(ep.url, ep.secret, d.body, { userAgent: USER_AGENT })
    d.attempts.push({ at: event.createdAt, status: r.status, ok: r.ok, error: r.error ?? null, ms: Date.now() - t0 })
    d.state = r.ok ? 'delivered' : 'failed'
    d.finishedAt = new Date().toISOString()
  } finally {
    inFlight.delete(d.id)
    prune()
    save()
  }
  return { ok: true, delivery: deliveryView(d), event }
}

/* ------------------------------------------------------------- redeliver --- */

/**
 * Sends a finished delivery's event again: same event id and body, a new delivery with its own attempt
 * series. The first attempt goes out now (so the admin sees its answer); a failure is retried as usual.
 * Resolves to { ok, delivery } or { ok: false, status, error }.
 */
export async function redeliver(id) {
  const orig = db.deliveries.find((d) => d.id === id)
  if (!orig) return { ok: false, status: 404, error: 'No such delivery.' }
  if (orig.test) return { ok: false, status: 409, error: 'A test event is not redelivered. Send a new test event instead.' }
  if (orig.state === 'pending') return { ok: false, status: 409, error: 'This delivery is still being retried. Wait until it is delivered or failed.' }
  if (!endpointOf(orig)) return { ok: false, status: 409, error: 'The endpoint this delivery went to has been removed.' }
  const now = new Date().toISOString()
  const d = { id: `whd_${randomToken(9)}`, eventId: orig.eventId, type: orig.type, test: false, target: orig.target, targetId: orig.targetId, url: orig.url, invoiceId: orig.invoiceId, linkId: orig.linkId, body: orig.body, state: 'pending', attempts: [], nextAt: now, createdAt: now, finishedAt: null, redeliveryOf: orig.id }
  db.deliveries.push(d)
  inFlight.add(d.id)
  try {
    await attempt(d)
  } finally {
    inFlight.delete(d.id)
    prune()
    save()
  }
  return { ok: true, delivery: deliveryView(d) }
}

/* ---------------------------------------------------------------- views --- */

export function deliveryView(d) {
  const last = d.attempts.at(-1) ?? null
  return { id: d.id, eventId: d.eventId, type: d.type, test: d.test, target: d.target, targetId: d.targetId, url: d.url, invoiceId: d.invoiceId, linkId: d.linkId, state: d.state, attempts: d.attempts.length, maxAttempts: d.test ? 1 : MAX_ATTEMPTS, last, nextAt: d.nextAt, createdAt: d.createdAt, finishedAt: d.finishedAt, redeliveryOf: d.redeliveryOf ?? null }
}

/** Deliveries matching a filter, newest first. */
export function deliveries({ linkId, invoiceId, target, targetId, limit = 50 } = {}) {
  return db.deliveries
    .filter((d) => (linkId === undefined || d.linkId === linkId) && (invoiceId === undefined || d.invoiceId === invoiceId) && (target === undefined || d.target === target) && (targetId === undefined || d.targetId === targetId))
    .slice(-limit)
    .reverse()
    .map(deliveryView)
}

/* ------------------------------------------------------- global default --- */

export const defaultEndpoint = () => endpointView(db.default)

/** Sets (url) or clears (null) the default endpoint. Returns { ok, secret? }. */
export async function setDefaultEndpoint(raw) {
  if (raw === null || raw === '') {
    db.default = null
    save()
    return { ok: true, endpoint: null, secret: null }
  }
  const c = await checkEndpoint(raw)
  if (!c.ok) return { ok: false, status: 400, error: c.error }
  db.default = makeEndpoint(c.url)
  save()
  return { ok: true, endpoint: endpointView(db.default), secret: db.default.secret }
}

export function rotateDefaultSecret() {
  if (!db.default) return { ok: false, status: 409, error: 'No default endpoint is set.' }
  db.default.secret = newSecret()
  db.default.rotatedAt = new Date().toISOString()
  save()
  return { ok: true, endpoint: endpointView(db.default), secret: db.default.secret }
}

/** Counts for the admin. */
export const webhookStats = () => ({ pending: db.deliveries.filter((d) => d.state === 'pending').length, failed: db.deliveries.filter((d) => d.state === 'failed' && !d.test).length })
