// /api/admin/* — the private admin dashboard's API.
//
// Auth: `Authorization: Bearer <ADMIN_TOKEN>`, compared in constant time. ADMIN_TOKEN lives only in
// the box's .env (never the repo). Unset or short, every admin route answers 503, so a missing secret
// fails closed. Ten failed attempts per IP per 15 minutes lock that address out.
//
//   GET  /api/admin/overview                  tracker health, API traffic, venues, process, counts
//   GET  /api/admin/developers                key requests and keys (no hashes, no secrets)
//   POST /api/admin/requests/:id/approve|reject
//   POST /api/admin/keys/:id/revoke
//   POST /api/admin/accounts/:address/block|unblock   wallet accounts (Sign-In with Ethereum)
//   GET  /api/admin/enquiries                 contact-form enquiries, newest first
//   GET  /api/admin/launch-list[?format=csv]  "notify me" sign-ups
//   POST /api/admin/enquiries/:id/handled     { handled: boolean }
//   GET  /api/admin/billing                   subscriptions (wallets with a plan), every payment, checkout state
//   POST /api/admin/accounts/:address/plan    { plan: 'pro'|'business'|'free', days? }  grant for `days` (30) or revoke
//   GET  /api/admin/invoices                  every invoice (Gully Pay), newest first, and the accepted assets
//   POST /api/admin/invoices                  { title, usd, note?, assets?, expiresInDays? } -> 201 { invoice }
//   POST /api/admin/invoices/:id/cancel
//   GET  /api/admin/invoices/:id/deliveries   the invoice's merchant webhook deliveries
//   POST /api/admin/invoices/:id/webhook      { url | null } set or remove its own webhook -> { invoice, secret? }
//   POST /api/admin/invoices/:id/webhook/rotate|test
//   GET  /api/admin/paylinks                  Gully Pay links, the assets, the default webhook
//   POST /api/admin/paylinks                  { title, description?, amount, assets?, expiresAt?, maxUses?, webhookUrl? } -> 201 { link, secret? }
//   GET  /api/admin/paylinks/:id              the link, its invoices and payments, its webhook deliveries
//   POST /api/admin/paylinks/:id              any of the create fields, or active -> { link, secret? }
//   POST /api/admin/paylinks/:id/activate|deactivate|rotate|test
//   GET  /api/admin/pay-webhooks              the default endpoint and the latest deliveries
//   POST /api/admin/pay-webhooks/default      { url | null } -> { endpoint, secret? }
//   POST /api/admin/pay-webhooks/default/rotate|test
//   GET  /api/admin/analytics                Gully Analytics accounts: wallet, plan, sites, events this month
//   POST /api/admin/analytics/:address/plan   { plan: 'starter'|'growth'|'none', days? }  grant for `days` (30) or stop now
//   POST /api/admin/analytics/:address/delete  only once the dashboard's grace period after a lapse is over

import fs from 'node:fs'
import { accessStats } from './access.mjs'
import { adminAnalyticsAccounts, adminAnalyticsDelete, adminAnalyticsSetPlan } from './analytics-accounts.mjs'
import { alertStats } from './alerts.mjs'
import { adminSetPlan, allPayments } from './billing.mjs'
import { adminCancelInvoice, adminCreateInvoice, adminInvoiceDeliveries, adminListInvoices, adminRotateInvoiceWebhook, adminSetInvoiceWebhook, adminTestInvoiceWebhook } from './invoices.mjs'
import { adminCreateLink, adminLinkDetail, adminListLinks, adminRotateLinkSecret, adminSetLinkActive, adminTestLinkWebhook, adminUpdateLink } from './paylinks.mjs'
import { defaultEndpoint, deliveries, rotateDefaultSecret, sendTest, setDefaultEndpoint, webhookStats } from './pay-webhooks.mjs'
import { publicAssets } from './payments.mjs'
import { planOf, publicPlans } from './plans.mjs'
import { bearer, clientIp, DATA_DIR, json, readJson } from './http.mjs'
import { readStats } from './stats.mjs'
import { umamiConfigured } from './umami.mjs'
import { deleteSessionsOf, developers, listEnquiries, listLaunch, markEnquiry, safeEqual, saveDevelopers, setBlocked } from './store.mjs'
import { trackerHealth } from './tracker.mjs'

const failures = new Map()

function authorised(req, res) {
  const token = process.env.ADMIN_TOKEN
  if (!token || token.length < 24) {
    json(res, 503, { error: 'The admin dashboard is disabled: ADMIN_TOKEN is not set on the server.' })
    return false
  }
  const ip = clientIp(req)
  const recent = (failures.get(ip) ?? []).filter((t) => Date.now() - t < 900_000)
  if (recent.length >= 10) {
    json(res, 429, { error: 'Too many failed attempts. Try again in 15 minutes.' })
    return false
  }
  if (!safeEqual(bearer(req) ?? '', token)) {
    failures.set(ip, [...recent, Date.now()])
    json(res, 401, { error: 'Wrong admin token.' })
    return false
  }
  return true
}

function dirBytes(dir) {
  try {
    return fs.readdirSync(dir).reduce((a, f) => {
      try {
        return a + fs.statSync(`${dir}/${f}`).size
      } catch {
        return a
      }
    }, 0)
  } catch {
    return null
  }
}

export async function handleAdmin(req, res, url) {
  const p = url.pathname
  if (!p.startsWith('/api/admin/')) return false
  if (!authorised(req, res)) return true
  const db = developers()

  if (p === '/api/admin/overview') {
    let venues
    try {
      const s = await readStats()
      venues = { generatedAt: s.generatedAt, unread: s.totals.unread, list: s.venues.map((v) => ({ key: v.key, state: v.state, error: v.state === 'error' ? v.error : null })) }
    } catch (e) {
      venues = { error: String(e?.message ?? e) }
    }
    const mem = process.memoryUsage()
    const enquiries = listEnquiries()
    return json(res, 200, {
      generatedAt: new Date().toISOString(),
      tracker: trackerHealth(),
      api: accessStats(),
      venues,
      developers: { pending: db.requests.filter((r) => r.status === 'pending').length, approved: db.requests.filter((r) => r.status === 'approved').length, liveKeys: db.keys.filter((k) => !k.revokedAt).length, accounts: db.accounts.length, blocked: db.accounts.filter((a) => a.blocked).length },
      enquiries: { total: enquiries.length, open: enquiries.filter((e) => !e.handled).length },
      launchList: listLaunch().length,
      process: { uptimeSeconds: Math.round(process.uptime()), rssMb: Math.round(mem.rss / 1e6), heapMb: Math.round(mem.heapUsed / 1e6), node: process.version, dataDirBytes: dirBytes(DATA_DIR) },
    }), true
  }

  if (p === '/api/admin/developers') {
    return json(res, 200, {
      requests: [...db.requests].reverse().map((r) => ({ id: r.id, email: r.email, project: r.project, url: r.url, use: r.use, status: r.status, createdAt: r.createdAt, decidedAt: r.decidedAt, keyId: r.keyId, claimedAt: r.claimedAt })),
      keys: [...db.keys].reverse().map((k) => ({ id: k.id, prefix: k.prefix, name: k.name ?? k.project, owner: k.owner ?? null, requestId: k.requestId, project: k.project, email: k.email, limit: k.limit, createdAt: k.createdAt, revokedAt: k.revokedAt })),
      accounts: [...db.accounts].reverse().map((a) => ({ ...a, planNow: planOf(a.address).id, keys: db.keys.filter((k) => k.owner === a.address).length, liveKeys: db.keys.filter((k) => k.owner === a.address && !k.revokedAt).length })),
    }), true
  }

  let m = p.match(/^\/api\/admin\/requests\/([\w-]+)\/(approve|reject)$/)
  if (m) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    const r = db.requests.find((x) => x.id === m[1])
    if (!r) return json(res, 404, { error: 'No such request.' }), true
    if (r.status !== 'pending') return json(res, 409, { error: `Already ${r.status}.` }), true
    r.status = m[2] === 'approve' ? 'approved' : 'rejected'
    r.decidedAt = new Date().toISOString()
    saveDevelopers()
    return json(res, 200, { id: r.id, status: r.status }), true
  }

  m = p.match(/^\/api\/admin\/keys\/([\w-]+)\/revoke$/)
  if (m) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    const k = db.keys.find((x) => x.id === m[1])
    if (!k) return json(res, 404, { error: 'No such key.' }), true
    k.revokedAt ??= new Date().toISOString()
    saveDevelopers()
    return json(res, 200, { id: k.id, revokedAt: k.revokedAt }), true
  }

  m = p.match(/^\/api\/admin\/accounts\/(0x[0-9a-f]{40})\/(block|unblock)$/)
  if (m) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    const a = setBlocked(m[1], m[2] === 'block')
    if (!a) return json(res, 404, { error: 'No such account.' }), true
    // A blocked wallet is signed out everywhere; its keys stop working while it stays blocked.
    if (a.blocked) deleteSessionsOf(a.address)
    return json(res, 200, { address: a.address, blocked: a.blocked }), true
  }

  if (p === '/api/admin/billing') {
    const subscriptions = db.accounts
      .filter((a) => a.plan)
      .map((a) => {
        const live = planOf(a.address)
        return { address: a.address, plan: a.plan.id, since: a.plan.since ?? null, expiresAt: a.plan.expiresAt, source: a.plan.source ?? null, active: live.id === a.plan.id && !!live.expiresAt }
      })
      .sort((x, y) => y.expiresAt.localeCompare(x.expiresAt))
    return json(res, 200, { subscriptions, payments: allPayments(), offer: publicPlans(), alerts: alertStats() }), true
  }

  m = p.match(/^\/api\/admin\/accounts\/(0x[0-9a-f]{40})\/plan$/)
  if (m) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    const body = await readJson(req, 1_000)
    const r = adminSetPlan(m[1], String(body?.plan ?? ''), body?.days ?? 30)
    return (r.ok ? json(res, 200, { address: m[1], plan: r.plan }) : json(res, r.status, { error: r.error }), true)
  }

  if (p === '/api/admin/invoices') {
    if (req.method === 'GET') return json(res, 200, { invoices: adminListInvoices(), assets: publicAssets() }), true
    if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST only' }), true
    const r = await adminCreateInvoice(await readJson(req, 4_000))
    return (r.ok ? json(res, 201, { invoice: r.invoice, secret: r.secret }) : json(res, r.status, { error: r.error }), true)
  }

  // Merchant webhooks of one invoice.
  m = p.match(/^\/api\/admin\/invoices\/([\w-]+)\/(deliveries|webhook|webhook\/rotate|webhook\/test)$/)
  if (m) {
    if (m[2] === 'deliveries') return json(res, 200, { deliveries: adminInvoiceDeliveries(m[1]) }), true
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    let r
    if (m[2] === 'webhook') r = await adminSetInvoiceWebhook(m[1], (await readJson(req, 2_000))?.url ?? null)
    else if (m[2] === 'webhook/rotate') r = adminRotateInvoiceWebhook(m[1])
    else r = await adminTestInvoiceWebhook(m[1])
    return (r.ok ? json(res, 200, { ...r, ok: undefined }) : json(res, r.status, { error: r.error }), true)
  }

  // Gully Pay links.
  if (p === '/api/admin/paylinks') {
    if (req.method === 'GET') return json(res, 200, { links: adminListLinks(), assets: publicAssets(), defaultWebhook: defaultEndpoint(), webhooks: webhookStats() }), true
    if (req.method !== 'POST') return json(res, 405, { error: 'GET or POST only' }), true
    const r = await adminCreateLink(await readJson(req, 6_000))
    return (r.ok ? json(res, 201, { link: r.link, secret: r.secret }) : json(res, r.status, { error: r.error }), true)
  }
  m = p.match(/^\/api\/admin\/paylinks\/(pl_[\w-]{16})(?:\/(activate|deactivate|rotate|test))?$/)
  if (m) {
    if (!m[2] && req.method === 'GET') {
      const d = adminLinkDetail(m[1])
      return (d ? json(res, 200, d) : json(res, 404, { error: 'No such link.' }), true)
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    let r
    if (!m[2]) r = await adminUpdateLink(m[1], await readJson(req, 6_000))
    else if (m[2] === 'activate' || m[2] === 'deactivate') r = adminSetLinkActive(m[1], m[2] === 'activate')
    else if (m[2] === 'rotate') r = adminRotateLinkSecret(m[1])
    else r = await adminTestLinkWebhook(m[1])
    return (r.ok ? json(res, 200, { ...r, ok: undefined }) : json(res, r.status, { error: r.error }), true)
  }

  // The default merchant webhook: events of invoices that have no endpoint of their own or of their link.
  if (p === '/api/admin/pay-webhooks') return json(res, 200, { default: defaultEndpoint(), deliveries: deliveries({ limit: 100 }), stats: webhookStats() }), true
  m = p.match(/^\/api\/admin\/pay-webhooks\/default(?:\/(rotate|test))?$/)
  if (m) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    let r
    if (!m[1]) r = await setDefaultEndpoint((await readJson(req, 2_000))?.url ?? null)
    else if (m[1] === 'rotate') r = rotateDefaultSecret()
    else r = await sendTest({ target: 'default', targetId: null })
    return (r.ok ? json(res, 200, { ...r, ok: undefined }) : json(res, r.status, { error: r.error }), true)
  }

  m = p.match(/^\/api\/admin\/invoices\/([\w-]+)\/cancel$/)
  if (m) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    const r = adminCancelInvoice(m[1])
    return (r.ok ? json(res, 200, { invoice: r.invoice }) : json(res, r.status, { error: r.error }), true)
  }

  if (p === '/api/admin/analytics') return json(res, 200, { configured: umamiConfigured(), accounts: adminAnalyticsAccounts(), offer: publicPlans().analytics }), true

  m = p.match(/^\/api\/admin\/analytics\/(0x[0-9a-f]{40})\/(plan|delete)$/)
  if (m) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    if (m[2] === 'delete') {
      const r = await adminAnalyticsDelete(m[1])
      return (r.ok ? json(res, 200, { address: m[1], deleted: true }) : json(res, r.status, { error: r.error }), true)
    }
    const body = await readJson(req, 1_000)
    const r = adminAnalyticsSetPlan(m[1], String(body?.plan ?? ''), body?.days ?? 30)
    return (r.ok ? json(res, 200, { account: r.account }) : json(res, r.status, { error: r.error }), true)
  }

  if (p === '/api/admin/enquiries') return json(res, 200, { enquiries: [...listEnquiries()].reverse() }), true

  if (p === '/api/admin/launch-list') {
    const rows = [...listLaunch()].reverse()
    if (url.searchParams.get('format') === 'csv') {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="launch-list.csv"', 'Cache-Control': 'no-store' })
      res.end(['email,slot,added_at', ...rows.map((r) => `${JSON.stringify(r.email)},${r.slot},${r.addedAt}`)].join('\n') + '\n')
      return true
    }
    return json(res, 200, { rows }), true
  }

  m = p.match(/^\/api\/admin\/enquiries\/([\w-]+)\/handled$/)
  if (m) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    const body = await readJson(req)
    return (markEnquiry(m[1], !!body?.handled) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'No such enquiry.' }), true)
  }

  return json(res, 404, { error: 'not found' }), true
}
