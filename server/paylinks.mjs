// Gully Pay links: one reusable page (/pay/l/<id>, an unguessable id) that makes a normal invoice for
// each payer, with the same quotes and checks as any invoice (invoices.mjs, billing.mjs). The link holds a
// fixed USD amount, or an open one the payer types between a minimum and a maximum (checked here, never
// trusted from the page). Stored in billing.json next to the invoices (db.links), written atomically.
//
// Link record:
//   { id: 'pl_…', title, description, amount: { type: 'fixed', usdCents } | { type: 'open', minCents, maxCents },
//     assets: string[], active, expiresAt: iso | null, maxUses: number | null, paidUses, lastPaidAt,
//     webhook: { url, secret, createdAt, rotatedAt } | null, createdAt, updatedAt }
// States: active, inactive (an admin switched it off), expired (past expiresAt), used-up (paidUses has
// reached maxUses). Only an active link makes invoices. With maxUses set, invoices still open count
// against it too (so a link for one sale cannot be paid twice); an open link invoice runs out after an hour.
//
// Public API (no session; the POST carries X-Requested-With like the rest of /api/pay):
//   GET  /api/pay/l/:id                       the link as the payer sees it, with its state
//   POST /api/pay/l/:id/invoice { usd?, asset? }  -> 201 { invoice, path }   10 per IP per hour
// Admin API (admin.mjs, behind ADMIN_TOKEN): see the handlers at the end of this file.

import { ledger, save } from './billing.mjs'
import { clientIp, json, readJson } from './http.mjs'
import { adminInvoice, createInvoiceRecord, invoiceStatus, publicInvoice } from './invoices.mjs'
import { checkEndpoint, deliveries, endpointView, makeEndpoint, newSecret, sendTest } from './pay-webhooks.mjs'
import { assetById, ASSET_IDS, fmtUsd, parseUsdCents, publicAssets } from './payments.mjs'
import { treasury } from './plans.mjs'
import { guardOr, guardRecipient, refusedCheckout } from './pay-guard.mjs'
import { randomToken } from './store.mjs'
import { payUrl } from './hosts.mjs'

export const LINK_ID_RE = /^pl_[A-Za-z0-9_-]{16}$/
const MAX_TITLE = 120
const MAX_DESC = 1_000
const MAX_CENTS = 100_000_000n * 100n
/** An invoice made from a link stays open this long (a quote holds 20 minutes and can be renewed). */
export const LINK_INVOICE_TTL_MS = 60 * 60_000
/** Invoices one IP may make from links per hour. */
export const LINK_INVOICES_PER_HOUR = 10

const hits = new Map()
function allow(bucket, who, max, ms) {
  const k = `${bucket}:${who}`
  const now = Date.now()
  const list = (hits.get(k) ?? []).filter((t) => now - t < ms)
  if (list.length >= max) return hits.set(k, list), false
  list.push(now)
  hits.set(k, list)
  return true
}
setInterval(() => {
  const now = Date.now()
  for (const [k, list] of hits) if (!list.some((t) => now - t < 3_600_000)) hits.delete(k)
}, 600_000).unref?.()

const links = () => ledger().links
export const findLink = (id) => (LINK_ID_RE.test(String(id)) ? (links().find((l) => l.id === id) ?? null) : null)
const linkInvoices = (id) => ledger().invoices.filter((i) => i.linkId === id)

export function linkState(l, now = Date.now()) {
  if (!l.active) return 'inactive'
  if (l.expiresAt && Date.parse(l.expiresAt) <= now) return 'expired'
  if (l.maxUses != null && (l.paidUses ?? 0) >= l.maxUses) return 'used-up'
  return 'active'
}

const STATE_TEXT = {
  inactive: 'This payment link is switched off and takes no payments.',
  expired: 'This payment link has expired and takes no more payments.',
  'used-up': 'This payment link has been used as many times as it allows and takes no more payments.',
}

function amountView(a) {
  return a.type === 'fixed' ? { type: 'fixed', usd: fmtUsd(a.usdCents), usdCents: a.usdCents } : { type: 'open', min: fmtUsd(a.minCents), max: fmtUsd(a.maxCents), minCents: a.minCents, maxCents: a.maxCents }
}

/** What anyone with the link sees: no use counts, no webhook, nothing about other payers. */
export function publicLink(l, { treasuryOverride } = {}) {
  const state = linkState(l)
  const t = treasuryOverride === undefined ? treasury() : treasuryOverride
  return {
    id: l.id,
    title: l.title,
    description: l.description || null,
    amount: amountView(l.amount),
    assets: publicAssets().filter((a) => l.assets.includes(a.id)),
    state,
    stateText: STATE_TEXT[state] ?? null,
    expiresAt: l.expiresAt,
    checkout: t ? { enabled: true, treasury: guardRecipient(t, `pay link ${l.id} checkout`) } : { enabled: false, treasury: null, reason: 'This link cannot be paid yet: no treasury wallet is configured.' },
  }
}

function adminLinkView(l) {
  const inv = linkInvoices(l.id)
  const paid = inv.filter((i) => i.paymentId)
  return {
    ...guardOr(() => publicLink(l), (e) => ({ ...publicLink(l, { treasuryOverride: null }), checkout: refusedCheckout(e) })),
    active: l.active,
    maxUses: l.maxUses,
    paidUses: l.paidUses ?? 0,
    lastPaidAt: l.lastPaidAt ?? null,
    webhook: endpointView(l.webhook),
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
    path: `/pay/l/${l.id}`,
    url: payUrl(`/pay/l/${l.id}`),
    stats: { invoices: inv.length, paid: paid.length, open: inv.filter((i) => invoiceStatus(i) === 'open').length, paidUsd: fmtUsd(paid.reduce((a, i) => a + BigInt(i.usdCents), 0n)) },
  }
}

/* --------------------------------------------------------- validation --- */

const bad = (error) => ({ ok: false, status: 400, error })
const centsOk = (c) => c != null && c <= MAX_CENTS

/**
 * Checks a create (`prev` null) or an edit (`prev` the stored link; absent fields keep their value).
 * Resolves to { ok: true, fields, webhook?: 'clear' | endpoint } or { ok: false, status, error }.
 */
async function parseLink(body, prev = null) {
  const has = (k) => body != null && Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined
  const f = {}
  if (!prev || has('title')) {
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    if (!title || title.length > MAX_TITLE) return bad(`Give the link a title of 1 to ${MAX_TITLE} characters.`)
    f.title = title
  }
  if (!prev || has('description')) {
    const d = body?.description == null ? '' : typeof body.description === 'string' ? body.description.trim() : null
    if (d == null || d.length > MAX_DESC) return bad(`The description can be at most ${MAX_DESC} characters.`)
    f.description = d
  }
  if (!prev || has('amount')) {
    const a = body?.amount
    if (a?.type === 'fixed') {
      const c = parseUsdCents(a.usd)
      if (!centsOk(c)) return bad('A fixed amount must be a positive dollar amount with at most two decimals, e.g. 49 or 249.99.')
      f.amount = { type: 'fixed', usdCents: String(c) }
    } else if (a?.type === 'open') {
      const min = parseUsdCents(a.min)
      const max = parseUsdCents(a.max)
      if (!centsOk(min) || !centsOk(max)) return bad('An open amount needs a minimum and a maximum in dollars, each positive with at most two decimals.')
      if (min > max) return bad('The minimum must not be above the maximum.')
      f.amount = { type: 'open', minCents: String(min), maxCents: String(max) }
    } else return bad('amount must be { type: "fixed", usd } or { type: "open", min, max }.')
  }
  if (!prev || has('assets')) {
    const list = body?.assets == null ? ASSET_IDS : Array.isArray(body.assets) ? [...new Set(body.assets.map(String))] : null
    if (!list || !list.length || list.some((x) => !assetById(x))) return bad(`assets must be a non-empty list of: ${ASSET_IDS.join(', ')}.`)
    f.assets = ASSET_IDS.filter((x) => list.includes(x))
  }
  if (!prev || has('expiresAt')) {
    const e = body?.expiresAt
    if (e == null || e === '') f.expiresAt = null
    else {
      const t = Date.parse(String(e))
      if (!Number.isFinite(t)) return bad('expiresAt must be a date and time (ISO 8601), or null for no expiry.')
      if (t <= Date.now()) return bad('expiresAt must be in the future.')
      if (t > Date.now() + 5 * 366 * 86_400_000) return bad('expiresAt can be at most five years away.')
      f.expiresAt = new Date(t).toISOString()
    }
  }
  if (!prev || has('maxUses')) {
    const m = body?.maxUses
    if (m == null || m === '') f.maxUses = null
    else {
      const n = Number(m)
      if (!Number.isInteger(n) || n < 1 || n > 1_000_000) return bad('maxUses must be a whole number from 1 to 1000000, or null for no limit.')
      f.maxUses = n
    }
  }
  if (!prev || has('active')) {
    if (prev && typeof body.active !== 'boolean') return bad('active must be true or false.')
    f.active = prev ? body.active : body?.active !== false
  }
  let webhook
  if (has('webhookUrl')) {
    const raw = body.webhookUrl
    if (raw === null || raw === '') webhook = 'clear'
    else if (prev?.webhook && String(raw).trim() === prev.webhook.url) webhook = undefined // unchanged: keep the secret
    else {
      const c = await checkEndpoint(raw)
      if (!c.ok) return bad(c.error)
      webhook = makeEndpoint(c.url)
    }
  }
  return { ok: true, fields: f, webhook }
}

/* -------------------------------------------------------------- admin --- */

export const adminListLinks = () => [...links()].reverse().map(adminLinkView)

/** Resolves to { ok, link, secret? }: a webhook's signing secret is shown this once. */
export async function adminCreateLink(body) {
  const r = await parseLink(body)
  if (!r.ok) return r
  const now = new Date().toISOString()
  const l = { id: 'pl_' + randomToken(12), ...r.fields, paidUses: 0, lastPaidAt: null, webhook: r.webhook && r.webhook !== 'clear' ? r.webhook : null, createdAt: now, updatedAt: now }
  links().push(l)
  save()
  return { ok: true, link: adminLinkView(l), secret: l.webhook?.secret ?? null }
}

/** Edits any of the create fields, plus `active`. Resolves to { ok, link, secret? }. */
export async function adminUpdateLink(id, body) {
  const l = findLink(id)
  if (!l) return { ok: false, status: 404, error: 'No such link.' }
  const r = await parseLink(body ?? {}, l)
  if (!r.ok) return r
  Object.assign(l, r.fields)
  let secret = null
  if (r.webhook === 'clear') l.webhook = null
  else if (r.webhook) {
    l.webhook = r.webhook
    secret = r.webhook.secret
  }
  l.updatedAt = new Date().toISOString()
  save()
  return { ok: true, link: adminLinkView(l), secret }
}

export function adminSetLinkActive(id, active) {
  const l = findLink(id)
  if (!l) return { ok: false, status: 404, error: 'No such link.' }
  l.active = !!active
  l.updatedAt = new Date().toISOString()
  save()
  return { ok: true, link: adminLinkView(l) }
}

export function adminRotateLinkSecret(id) {
  const l = findLink(id)
  if (!l) return { ok: false, status: 404, error: 'No such link.' }
  if (!l.webhook) return { ok: false, status: 409, error: 'This link has no webhook.' }
  l.webhook.secret = newSecret()
  l.webhook.rotatedAt = new Date().toISOString()
  l.updatedAt = l.webhook.rotatedAt
  save()
  return { ok: true, link: adminLinkView(l), secret: l.webhook.secret }
}

export async function adminTestLinkWebhook(id) {
  const l = findLink(id)
  if (!l) return { ok: false, status: 404, error: 'No such link.' }
  return sendTest({ target: 'link', targetId: l.id, linkId: l.id })
}

/** One link with its invoices (and their payments) and its webhook delivery log. */
export function adminLinkDetail(id) {
  const l = findLink(id)
  if (!l) return null
  return { link: adminLinkView(l), invoices: [...linkInvoices(l.id)].reverse().map((i) => adminInvoice(i.id)), deliveries: deliveries({ linkId: l.id }) }
}

/** Test hook: moves a link's expiry into the past. */
export function expireLinkForTest(id) {
  const l = findLink(id)
  if (l) l.expiresAt = new Date(Date.now() - 1000).toISOString()
}

/* ------------------------------------------------------------- public --- */

/** Makes the invoice for one payer of a link. body: { usd? (open amounts), asset? }. */
export function invoiceFromLink(l, body) {
  const state = linkState(l)
  if (state !== 'active') return { ok: false, status: 409, error: STATE_TEXT[state] }
  if (!treasury()) return { ok: false, status: 503, error: 'This link cannot be paid yet: no treasury wallet is configured.' }
  guardRecipient(treasury(), `pay link ${l.id} invoice`) // no invoice is made toward a fee proxy
  let cents
  if (l.amount.type === 'fixed') cents = BigInt(l.amount.usdCents)
  else {
    cents = parseUsdCents(body?.usd)
    const min = BigInt(l.amount.minCents)
    const max = BigInt(l.amount.maxCents)
    if (cents == null) return bad(`Enter an amount in dollars, with at most two decimals, from ${fmtUsd(min)} to ${fmtUsd(max)}.`)
    if (cents < min || cents > max) return bad(`The amount must be from ${fmtUsd(min)} to ${fmtUsd(max)} USD.`)
  }
  const asset = body?.asset == null || body.asset === '' ? null : String(body.asset)
  if (asset && !l.assets.includes(asset)) return bad('This link cannot be paid in that asset.')
  if (l.maxUses != null) {
    const open = linkInvoices(l.id).filter((i) => invoiceStatus(i) === 'open').length
    if ((l.paidUses ?? 0) + open >= l.maxUses) return { ok: false, status: 409, error: 'Every remaining use of this link is held by a checkout in progress. Try again within the hour.' }
  }
  const inv = createInvoiceRecord({ title: l.title, note: l.description, usdCents: cents, assets: l.assets, ttlMs: LINK_INVOICE_TTL_MS, linkId: l.id })
  return { ok: true, invoice: inv, asset }
}

/** Handles /api/pay/l/*. Returns true when it answered. */
export async function handlePayLink(req, res, url) {
  const m = url.pathname.match(/^\/api\/pay\/l\/([^/]+)(?:\/(invoice))?$/)
  if (!m) return false
  const l = findLink(m[1])
  const ip = clientIp(req)
  if (!m[2]) {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    if (!allow('read', ip, 600, 3_600_000)) return json(res, 429, { error: 'Too many requests. Try again later.' }), true
    if (!l) return json(res, 404, { error: 'No such payment link. Check the link you were given.' }), true
    return json(res, 200, { link: publicLink(l) }, { 'X-Robots-Tag': 'noindex' }), true
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
  if (req.headers['x-requested-with'] !== 'gully') return json(res, 403, { error: 'Cross-site request refused.' }), true
  if (!l) return json(res, 404, { error: 'No such payment link. Check the link you were given.' }), true
  const body = await readJson(req, 1_000)
  // Checked before the rate limit counts, so a closed link does not use up a payer's tries.
  const state = linkState(l)
  if (state !== 'active') return json(res, 409, { error: STATE_TEXT[state], state }), true
  if (!allow('invoice', ip, LINK_INVOICES_PER_HOUR, 3_600_000)) return json(res, 429, { error: 'Too many checkouts started from this address in the last hour. Try again later.' }), true
  const r = invoiceFromLink(l, body)
  if (!r.ok) return json(res, r.status, { error: r.error }), true
  const payPath = `/pay/${r.invoice.id}${r.asset ? `?asset=${encodeURIComponent(r.asset)}` : ''}`
  return json(res, 201, { invoice: publicInvoice(r.invoice), path: payPath, url: payUrl(payPath) }), true
}
