// General invoices for anything Gully Labs sells besides API plans (Chain Kit, Gully Analytics,
// services work). An admin creates one; anyone holding its link (/pay/<id>, an unguessable id) can pay
// it with the same quotes and checks as plan checkout (billing.mjs), from a wallet or by pasting a
// transaction hash. Nobody signs in on a pay page, so a payment matches a quote only by its exact amount.
//
// States: open, paid (with the payment), expired (past expiresAt, never paid), cancelled (by an admin).
//
// Public API (no session; POSTs carry X-Requested-With like the dashboard's):
//   GET  /api/pay/:id                              the invoice, its accepted assets and, once paid, the payment
//   POST /api/pay/:id/quote  { asset }             -> { quote }   20 minutes, exact amount in that asset
//   POST /api/pay/:id/verify { quoteId, txHash }   -> 200 paid | 202 not confirmed yet | 4xx
//   GET  /api/pay/price?asset=<native asset id>    -> { asset, symbol, chain, chainId, description, price,
//                                                     roundId, updatedAt, readAt }: the chain's Chainlink USD
//                                                     price now (readFeed, cached 30 s), for the pay pages' chart
// Admin API (admin.mjs, behind ADMIN_TOKEN):
//   adminListInvoices(), adminCreateInvoice(body), adminCancelInvoice(id),
//   adminSetInvoiceWebhook(id, url), adminRotateInvoiceWebhook(id), adminTestInvoiceWebhook(id)
// Pay links (paylinks.mjs) make invoices through createInvoiceRecord(); /api/pay/l/* is answered there.
// A paid invoice sends invoice.paid to its merchant webhooks (pay-webhooks.mjs); one an admin cancels sends
// invoice.cancelled.

import { checkInvoiceTx, createQuote, findQuote, isHash, badHash, ledger, normHash, paymentView, quoteView, recordPayment, save } from './billing.mjs'
import { checkEndpoint, deliveries, emitInvoiceCancelled, emitInvoicePaid, endpointView, makeEndpoint, newSecret, sendTest } from './pay-webhooks.mjs'
import { clientIp, json, readJson } from './http.mjs'
import { assetById, ASSET_IDS, ASSETS, CHAINS, fmtUnits, fmtUsd, parseUsdCents, publicAssets, readFeed } from './payments.mjs'
import { treasury } from './plans.mjs'
import { randomToken } from './store.mjs'

const ID_RE = /^inv_[A-Za-z0-9_-]{22}$/
const MAX_TITLE = 120
const MAX_NOTE = 1_000
const MAX_DAYS = 365

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

/** Called with (invoice, payment) once an invoice is paid (merchants.mjs: fee statements resume checkout). */
export const invoicePaidHooks = []

const invoices = () => ledger().invoices
const findInvoice = (id) => (ID_RE.test(String(id)) ? (invoices().find((i) => i.id === id) ?? null) : null)

export function invoiceStatus(inv, now = Date.now()) {
  if (inv.paymentId) return 'paid'
  if (inv.cancelledAt) return 'cancelled'
  return Date.parse(inv.expiresAt) <= now ? 'expired' : 'open'
}

function paymentOf(inv) {
  const p = inv.paymentId ? ledger().payments.find((x) => x.id === inv.paymentId) : null
  return p ? paymentView(p) : null
}

/** What anyone with the link sees. No internal notes, nothing about other invoices. */
export function publicInvoice(inv) {
  const status = invoiceStatus(inv)
  const t = treasury()
  return {
    id: inv.id,
    number: inv.number,
    title: inv.title,
    note: inv.note || null,
    usd: fmtUsd(inv.usdCents),
    usdCents: inv.usdCents,
    status,
    assets: publicAssets().filter((a) => inv.assets.includes(a.id)),
    createdAt: inv.createdAt,
    expiresAt: inv.expiresAt,
    paidAt: inv.paidAt ?? null,
    cancelledAt: inv.cancelledAt ?? null,
    payment: paymentOf(inv),
    linkId: inv.linkId ?? null,
    checkout: t ? { enabled: true, treasury: t } : { enabled: false, treasury: null, reason: 'This invoice cannot be paid yet: no treasury wallet is configured.' },
  }
}

const adminView = (inv) => ({ ...publicInvoice(inv), path: `/pay/${inv.id}`, webhook: endpointView(inv.webhook) })

/**
 * A new open invoice (admin or pay link). `usdCents` is a BigInt already checked by the caller.
 * Returns the stored record.
 */
export function createInvoiceRecord({ title, note = '', usdCents, assets, ttlMs, linkId = null, webhook = null }) {
  const now = Date.now()
  const inv = {
    id: 'inv_' + randomToken(16),
    number: `GL-${String(invoices().length + 1).padStart(4, '0')}`,
    title,
    note,
    usdCents: String(usdCents),
    assets: ASSET_IDS.filter((a) => assets.includes(a)),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    cancelledAt: null,
    paidAt: null,
    paymentId: null,
    linkId,
    webhook,
  }
  invoices().push(inv)
  save()
  return inv
}

/* -------------------------------------------------------------- admin --- */

export const adminListInvoices = () => [...invoices()].reverse().map(adminView)
/** One invoice for the admin, or null. */
export const adminInvoice = (id) => {
  const inv = findInvoice(id)
  return inv ? adminView(inv) : null
}

/**
 * body: { title, usd, note?, assets?: string[], expiresInDays? (1..365, default 30), webhookUrl? }
 * Resolves to { ok, invoice, secret? }: the webhook's signing secret is shown this once.
 */
export async function adminCreateInvoice(body) {
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  if (!title || title.length > MAX_TITLE) return { ok: false, status: 400, error: `Give the invoice a title of 1 to ${MAX_TITLE} characters.` }
  const cents = parseUsdCents(body?.usd)
  if (cents == null || cents > 100_000_000n * 100n) return { ok: false, status: 400, error: 'usd must be a positive dollar amount with at most two decimals, e.g. 1500 or 249.99.' }
  const note = typeof body?.note === 'string' ? body.note.trim() : ''
  if (note.length > MAX_NOTE) return { ok: false, status: 400, error: `The note can be at most ${MAX_NOTE} characters.` }
  const list = body?.assets == null ? ASSET_IDS : Array.isArray(body.assets) ? [...new Set(body.assets.map(String))] : null
  if (!list || !list.length || list.some((a) => !assetById(a))) return { ok: false, status: 400, error: `assets must be a non-empty list of: ${ASSET_IDS.join(', ')}.` }
  const days = body?.expiresInDays == null ? 30 : Number(body.expiresInDays)
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return { ok: false, status: 400, error: `expiresInDays must be a whole number from 1 to ${MAX_DAYS}.` }
  let webhook = null
  if (body?.webhookUrl) {
    const c = await checkEndpoint(body.webhookUrl)
    if (!c.ok) return { ok: false, status: 400, error: c.error }
    webhook = makeEndpoint(c.url)
  }
  const inv = createInvoiceRecord({ title, note, usdCents: cents, assets: list, ttlMs: days * 86_400_000, webhook })
  return { ok: true, invoice: adminView(inv), secret: webhook?.secret ?? null }
}

/** Sets (url) or removes (null / '') an invoice's own webhook. Resolves to { ok, invoice, secret? }. */
export async function adminSetInvoiceWebhook(id, raw) {
  const inv = findInvoice(id)
  if (!inv) return { ok: false, status: 404, error: 'No such invoice.' }
  if (raw === null || raw === undefined || raw === '') {
    inv.webhook = null
    save()
    return { ok: true, invoice: adminView(inv), secret: null }
  }
  const c = await checkEndpoint(raw)
  if (!c.ok) return { ok: false, status: 400, error: c.error }
  inv.webhook = makeEndpoint(c.url)
  save()
  return { ok: true, invoice: adminView(inv), secret: inv.webhook.secret }
}

export function adminRotateInvoiceWebhook(id) {
  const inv = findInvoice(id)
  if (!inv) return { ok: false, status: 404, error: 'No such invoice.' }
  if (!inv.webhook) return { ok: false, status: 409, error: 'This invoice has no webhook.' }
  inv.webhook.secret = newSecret()
  inv.webhook.rotatedAt = new Date().toISOString()
  save()
  return { ok: true, invoice: adminView(inv), secret: inv.webhook.secret }
}

export async function adminTestInvoiceWebhook(id) {
  const inv = findInvoice(id)
  if (!inv) return { ok: false, status: 404, error: 'No such invoice.' }
  return sendTest({ target: 'invoice', targetId: inv.id, invoiceId: inv.id, linkId: inv.linkId ?? null })
}

/** An invoice's webhook deliveries (to any endpoint), newest first. */
export const adminInvoiceDeliveries = (id) => deliveries({ invoiceId: id })

export function adminCancelInvoice(id) {
  const inv = findInvoice(id)
  if (!inv) return { ok: false, status: 404, error: 'No such invoice.' }
  const s = invoiceStatus(inv)
  if (s === 'paid') return { ok: false, status: 409, error: 'This invoice is paid; it cannot be cancelled.' }
  if (s === 'cancelled') return { ok: false, status: 409, error: 'Already cancelled.' }
  inv.cancelledAt = new Date().toISOString()
  save()
  try {
    emitInvoiceCancelled(inv)
  } catch (e) {
    console.error('invoice.cancelled webhook:', e?.message ?? e)
  }
  return { ok: true, invoice: adminView(inv) }
}

/** Test hook: moves an invoice's expiry into the past. */
export function expireInvoiceForTest(id) {
  const inv = findInvoice(id)
  if (inv) inv.expiresAt = new Date(Date.now() - 1000).toISOString()
}

/* ------------------------------------------------------------- public --- */

async function quoteFor(inv, assetId) {
  const s = invoiceStatus(inv)
  if (s !== 'open') return { ok: false, status: 409, error: s === 'paid' ? 'This invoice is paid already.' : s === 'cancelled' ? 'This invoice was cancelled.' : 'This invoice has expired. Ask Gully Labs for a new one.' }
  if (!inv.assets.includes(assetId)) return { ok: false, status: 400, error: 'This invoice cannot be paid in that asset.' }
  // A quote never outlives its invoice by more than its own 20 minutes; reuse one with time left.
  const live = ledger().quotes.find((q) => q.kind === 'invoice' && q.invoiceId === inv.id && q.assetId === assetId && !q.paidAt && Date.parse(q.expiresAt) - Date.now() > 5 * 60_000)
  if (live) return { ok: true, quote: live }
  if (ledger().quotes.filter((q) => q.invoiceId === inv.id && Date.parse(q.expiresAt) > Date.now()).length >= 30) return { ok: false, status: 429, error: 'Too many open quotes for this invoice. Use one you have, or try again in 20 minutes.' }
  return createQuote({ kind: 'invoice', assetId, usdCents: BigInt(inv.usdCents), invoiceId: inv.id })
}

async function verifyFor(inv, quoteId, txHashIn) {
  const quote = findQuote(String(quoteId ?? ''))
  if (!quote || quote.kind !== 'invoice' || quote.invoiceId !== inv.id) return { ok: false, status: 404, error: 'No such quote for this invoice. Get a new quote.' }
  const txHash = normHash(txHashIn)
  if (!isHash(txHash)) return badHash
  const s = invoiceStatus(inv)
  if (s === 'paid') return { ok: false, status: 409, error: 'This invoice is paid already.' }
  if (s === 'cancelled') return { ok: false, status: 409, error: 'This invoice was cancelled. Write to hello@gullylabs.xyz if you paid it.' }
  // An expired invoice still accepts a payment for a quote made while it was open (the quote's own
  // window is checked against the block time).
  return checkInvoiceTx({
    quote,
    txHash,
    run: async ({ match, read, asset }) => {
      if (invoiceStatus(inv) === 'paid' || inv.cancelledAt) return { ok: false, status: 409, error: 'This invoice is no longer open.' }
      const payment = recordPayment({ kind: 'invoice', invoiceId: inv.id, txHash, chainId: asset.chainId, assetId: asset.id, symbol: asset.symbol, decimals: asset.decimals, amountRaw: String(match.value), usdCents: quote.usdCents, price: quote.price, quoteId: quote.id, from: match.from, blockNumber: read.blockNumber }, quote)
      inv.paymentId = payment.id
      inv.paidAt = payment.at
      // A pay link counts its paid uses (max uses and the admin's view read this).
      const link = inv.linkId ? ledger().links.find((l) => l.id === inv.linkId) : null
      if (link) {
        link.paidUses = (link.paidUses ?? 0) + 1
        link.lastPaidAt = payment.at
      }
      save()
      for (const h of invoicePaidHooks) {
        try {
          h(inv, payment)
        } catch (e) {
          console.error('invoice paid hook:', e?.message ?? e)
        }
      }
      try {
        emitInvoicePaid(inv, payment, read.confirmations)
      } catch (e) {
        console.error('invoice.paid webhook:', e?.message ?? e)
      }
      return { ok: true }
    },
  })
}

/** Handles /api/pay/*. Returns true when it answered. */
export async function handlePay(req, res, url) {
  // Pay links live in paylinks.mjs (loaded on first use; it imports this module).
  if (url.pathname.startsWith('/api/pay/l/')) return (await import('./paylinks.mjs')).handlePayLink(req, res, url)
  // Merchant stores (merchants.mjs): /api/pay/m/* (their invoices, links, logos), paid to the merchant's wallet.
  if (url.pathname.startsWith('/api/pay/m/')) return (await import('./merchants.mjs')).handleMerchantPay(req, res, url)
  // The live Chainlink price of a native coin, for the pay pages' "price at quote vs now" chart.
  if (url.pathname === '/api/pay/price') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    if (!allow('price', clientIp(req), 600, 3_600_000)) return json(res, 429, { error: 'Too many price reads. Try again later.' }), true
    const a = assetById(String(url.searchParams.get('asset') ?? ''))
    if (!a || a.kind !== 'native') return json(res, 400, { error: `asset must be a native coin: ${ASSETS.filter((x) => x.kind === 'native').map((x) => x.id).join(', ')}.` }), true
    const r = await readFeed(a.chainId)
    if (!r.ok) return json(res, r.status, { error: r.error }), true
    const p = r.price
    return json(res, 200, { asset: a.id, symbol: a.symbol, chain: CHAINS[a.chainId].name, chainId: a.chainId, description: p.description, price: fmtUnits(p.answer, p.decimals), roundId: p.roundId, updatedAt: p.updatedAt, readAt: p.readAt }, { 'Cache-Control': 'public, max-age=30' }), true
  }
  const m = url.pathname.match(/^\/api\/pay\/([^/]+)(?:\/(quote|verify))?$/)
  if (!m) return false
  const inv = findInvoice(m[1])
  const ip = clientIp(req)
  if (!m[2]) {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    if (!allow('read', ip, 600, 3_600_000)) return json(res, 429, { error: 'Too many requests. Try again later.' }), true
    if (!inv) return json(res, 404, { error: 'No such invoice. Check the link you were given.' }), true
    return json(res, 200, { invoice: publicInvoice(inv) }, { 'X-Robots-Tag': 'noindex' }), true
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
  if (req.headers['x-requested-with'] !== 'gully') return json(res, 403, { error: 'Cross-site request refused.' }), true
  if (!inv) return json(res, 404, { error: 'No such invoice. Check the link you were given.' }), true
  const body = await readJson(req, 1_000)
  if (m[2] === 'quote') {
    if (!allow('quote', ip, 30, 3_600_000)) return json(res, 429, { error: 'Too many quotes asked for in the last hour. Try again later.' }), true
    const r = await quoteFor(inv, String(body?.asset ?? ''))
    return (r.ok ? json(res, 200, { quote: quoteView(r.quote) }) : json(res, r.status, { error: r.error }), true)
  }
  if (!allow('verify', ip, 120, 3_600_000)) return json(res, 429, { error: 'Too many payment checks in the last hour. Try again later.' }), true
  const r = await verifyFor(inv, body?.quoteId, body?.txHash)
  if (r.ok) return json(res, 200, { invoice: publicInvoice(inv) }), true
  return json(res, r.status, { error: r.error, ...(r.pending ? { pending: true, confirmations: r.confirmations, needed: r.needed } : {}) }), true
}
