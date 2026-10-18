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
//   POST /api/admin/pay-webhooks/deliveries/:id/redeliver   send a finished delivery's event again (same
//                                             event id, a new attempt series) -> { delivery }
//   GET  /api/admin/telegram                  linked Telegram chats: account, chat type, title, linked date,
//                                             alerts using Telegram, last Telegram delivery. No message content.
//   GET  /api/admin/analytics                Gully Analytics accounts: wallet, plan, sites, events this month
//   POST /api/admin/analytics/:address/plan   { plan: 'starter'|'growth'|'none', days? }  grant for `days` (30) or stop now
//   POST /api/admin/analytics/:address/delete  only once the dashboard's grace period after a lapse is over
//   POST /api/admin/ask/draft, GET /api/admin/ask/log, GET /api/admin/ask/gaps   Gully Ask content studio, ask log, unanswered / low-rated questions (ask.mjs)
//   GET  /api/admin/charts?days=7|30|90       daily series for the dashboard's charts (admin-charts.mjs)
//   /api/admin/channel*                       @GullyLabsNews channel posts and auto posts (telegram-channel.mjs)
//   /api/admin/security*                      Gully Security: scan queue, failures, review requests (security-routes.mjs)
//   /api/admin/broadcasts*                    DMs to everyone who started the bot, by segment (telegram-broadcast.mjs)
//   GET  /api/admin/health                    live health of every background part (Holder Map data sources per chain,
//                                             security monitors, the DeepCore poller, the bot webhook, the scan engine,
//                                             Gully AI retrieval), with a per-minute history for sparklines
//   GET  /api/admin/alerts                    every alert and monitor across accounts, and the alert webhook log
//   GET  /api/admin/workspaces                workspaces with members or open invites
//   GET  /api/admin/chain-kit                 Chain Kit explorer requests and the Gully Chains Devnet waitlist
//   POST /api/admin/telegram/:address/unlink  unlink an account's Telegram chat (telegram.mjs adminUnlinkTelegram)

import fs from 'node:fs'
import { accessStats } from './access.mjs'
import { adminCharts } from './admin-charts.mjs'
import { handleAskAdmin } from './ask.mjs'
import { adminAnalyticsAccounts, adminAnalyticsDelete, adminAnalyticsSetPlan } from './analytics-accounts.mjs'
import { alertStats, alertsOf } from './alerts.mjs'
import { adminSetPlan, allPayments } from './billing.mjs'
import { adminCancelInvoice, adminCreateInvoice, adminInvoiceDeliveries, adminListInvoices, adminRotateInvoiceWebhook, adminSetInvoiceWebhook, adminTestInvoiceWebhook } from './invoices.mjs'
import { adminCreateLink, adminLinkDetail, adminListLinks, adminRotateLinkSecret, adminSetLinkActive, adminTestLinkWebhook, adminUpdateLink } from './paylinks.mjs'
import { defaultEndpoint, deliveries, redeliver, rotateDefaultSecret, sendTest, setDefaultEndpoint, webhookStats } from './pay-webhooks.mjs'
import { CHAIN_LIST, publicAssets, rpc } from './payments.mjs'
import { checkTreasuryChains, treasuryStatus } from './treasury-chains.mjs'
import { handleMerchantsAdmin } from './merchants.mjs'
import { handleSecurityAdmin } from './security-routes.mjs'
import { handleAdminSafe } from './safe-deploy.mjs'
import { planOf, publicPlans, treasury } from './plans.mjs'
import { guardOr, recentRefusals, refusedCheckout } from './pay-guard.mjs'
import { checkFeeProxies, feeProxyView } from './fee-proxy-monitor.mjs'
import { isFeeProxy } from './fee-proxy-guard.mjs'

/** The plan offer for admin views: still loads when the fee-proxy guard refuses the treasury (and says why). */
const adminOffer = () => guardOr(() => publicPlans(), (e) => ({ ...publicPlans({ treasuryOverride: null }), checkout: refusedCheckout(e) }))
const PROXY_ACCOUNT = "That address is Request Network's fee proxy contract, not a wallet."
import { bearer, clientIp, DATA_DIR, json, readJson } from './http.mjs'
import { readStats } from './stats.mjs'
import { umamiConfigured } from './umami.mjs'
import { linkedChat, telegramStats } from './telegram.mjs'
import { handleChannelAdmin } from './telegram-channel.mjs'
import { handleBroadcastAdmin } from './telegram-broadcast.mjs'
import { deleteSessionsOf, developers, listEnquiries, listLaunch, markEnquiry, safeEqual, saveDevelopers, setBlocked } from './store.mjs'
import { trackerHealth } from './tracker.mjs'
import * as holdersMod from './holders.mjs'
import * as secMon from './sec-monitor.mjs'
import * as tgMod from './telegram.mjs'
import * as storeMod from './store.mjs'
import { deepcoreHealth, pollMs as deepcorePollMs } from './deepcore.mjs'
import { status as scanEngineStatus } from './security-engine.mjs'
import { askStatus } from './ask.mjs'
import { embedStatus } from './ask-embed.mjs'
import { teamView } from './workspaces.mjs'

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

/**
 * Linked Telegram chats, read-only from the stored links (telegram.mjs linkedChat, one per account) and the
 * account's alerts (alerts.mjs). Never the chat id or any message text.
 */
async function telegramChats(accounts) {
  const chats = []
  for (const a of accounts) {
    const l = linkedChat(a.address)
    if (!l) continue
    let alerts = null
    let last = null
    try {
      const v = await alertsOf(a.address)
      const tg = v.alerts.filter((x) => x.telegram)
      alerts = { telegram: tg.length, enabled: tg.filter((x) => x.enabled).length, total: v.alerts.length }
      for (const x of tg)
        for (const d of x.deliveries)
          if (d.channel === 'telegram' && (!last || d.at > last.at)) last = { at: d.at, ok: !!d.ok, test: !!d.test, status: d.status ?? null, error: d.ok ? null : (d.error ?? null) }
    } catch {
      alerts = null
    }
    chats.push({ address: a.address, chatType: l.chatType === 'private' ? 'private' : 'group', chatKind: l.chatType, chatTitle: l.chatTitle || null, linkedAt: l.linkedAt ?? null, alerts, lastDelivery: last })
  }
  return chats.sort((x, y) => String(y.linkedAt).localeCompare(String(x.linkedAt)))
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

/* ---------------------------------------------------------------- health --- */

// GET /api/admin/health: one read of every background part, plus a per-minute history (in memory, ~3 hours)
// so each item can draw a sparkline. Only env var NAMES are ever reported, never their values.

const HEALTH_KEEP = 180
const HEALTH_EVERY_MS = 60_000
const healthRing = []
const iso = (t) => (t == null ? null : typeof t === 'number' ? new Date(t).toISOString() : String(t))
const ageMs = (t, now) => {
  if (t == null) return null
  const v = typeof t === 'number' ? t : Date.parse(String(t))
  return Number.isFinite(v) ? Math.max(0, now - v) : null
}
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`no answer within ${ms / 1000} s`)), ms).unref?.())])
const safe = (fn, fallback = null) => {
  try {
    return fn()
  } catch {
    return fallback
  }
}

/** Holder Map data per chain, from holders.mjs holdersSourceHealth(): the source, its env var NAME (operators only,
    never a value), and whether stock tokens and DeepCore launches can be mapped there now. */
function holderSources() {
  const rows = safe(() => holdersMod.holdersSourceHealth(), [])
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    chain: r.chain,
    name: r.name,
    source: r.source ?? null,
    env: r.env ?? null,
    available: !!r.stocks,
    launches: !!r.launches,
    reason: r.stocks ? null : r.env ? `not configured: ${r.env}` : 'no stock holder source',
  }))
}

/** The security monitors' loop: `monitorHealth()` when sec-monitor has it, else what its stats can tell. */
function monitorPart(now) {
  const stats = safe(() => secMon.monitorStats(), null)
  const base = { monitors: stats?.monitors ?? null, live: stats?.live ?? null, requestsPerMin: stats?.load?.totalPerMin ?? null }
  if (typeof secMon.monitorHealth === 'function') {
    const h = safe(() => secMon.monitorHealth(), null)
    if (h) return { ...base, lastTickAt: iso(h.lastTickAt), lastTickMs: h.lastTickMs ?? null, lagMs: h.lagMs ?? ageMs(h.lastTickAt, now), ticks: h.ticks ?? null, errors: h.errors ?? null, lastError: h.lastError ?? null, lastErrorAt: iso(h.lastErrorAt), detail: 'loop' }
  }
  // Fallback: the per-chain cursors' errors (this build does not export the loop's tick time).
  const chains = Object.values(stats?.chains ?? {})
  const errs = chains.filter((c) => c?.lastError)
  const last = errs.map((c) => c.lastErrorAt).filter(Boolean).sort().at(-1) ?? null
  return { ...base, lastTickAt: null, lastTickMs: null, lagMs: null, ticks: null, errors: errs.length, lastError: errs.find((c) => c.lastErrorAt === last)?.lastError ?? null, lastErrorAt: last, detail: 'chains' }
}

function deepcorePart(now) {
  const h = safe(() => deepcoreHealth(), {}) ?? {}
  return { lastOkAt: iso(h.lastOkAt), lagMs: ageMs(h.lastOkAt, now), pollMs: safe(() => deepcorePollMs(), 90_000), lastError: h.lastError ? String(h.lastError?.message ?? h.lastError).slice(0, 200) : null, baselineAt: iso(h.baselineAt), seen: h.seen ?? null, cached: h.cached ?? null }
}

function botPart(now) {
  const st = safe(() => telegramStats(), { enabled: false, links: 0 })
  if (typeof tgMod.botWebhookHealth === 'function') {
    const h = safe(() => tgMod.botWebhookHealth(), null)
    if (h) return { enabled: !!h.enabled, links: st.links, lastUpdateAt: iso(h.lastUpdateAt), sinceUpdateMs: ageMs(h.lastUpdateAt, now), updates: h.updates ?? null, errors: h.errors ?? null, lastError: h.lastError ?? null, lastErrorAt: iso(h.lastErrorAt), detail: 'webhook' }
  }
  return { enabled: !!st.enabled, links: st.links, lastUpdateAt: null, sinceUpdateMs: null, updates: null, errors: null, lastError: null, lastErrorAt: null, detail: 'stats' }
}

async function enginePart() {
  try {
    const s = await withTimeout(scanEngineStatus(), 4_000)
    return { ok: true, ai: !!s?.ai, worker: { reachable: !!s?.worker?.reachable, tools: Array.isArray(s?.worker?.tools) ? s.worker.tools : [], reason: s?.worker?.reason ?? null }, explorerKey: !!s?.explorers?.etherscanKey, queue: { running: s?.queue?.running ?? null, queued: s?.queue?.queued ?? null }, error: null }
  } catch (e) {
    return { ok: false, ai: null, worker: null, explorerKey: null, queue: null, error: String(e?.message ?? e).slice(0, 200) }
  }
}

function embeddingsPart() {
  const a = safe(() => askStatus(), null)
  const e = safe(() => embedStatus(), null)
  return {
    configured: a?.configured ?? null,
    retrieval: a?.retrieval ?? null,
    indexSize: a?.indexSize ?? null,
    indexUpdatedAt: a?.updatedAt ?? null,
    embeddings: e ? { configured: !!e.configured, model: e.model ?? null, ready: e.ready ?? null, total: e.total ?? null, syncing: !!e.syncing, lastSyncAt: iso(e.lastSyncAt), lastError: e.lastError ? String(e.lastError?.message ?? e.lastError).slice(0, 200) : null, needs: e.configured ? null : 'VOYAGE_API_KEY' } : null,
  }
}

async function healthNow() {
  const now = Date.now()
  const engine = await enginePart()
  return { at: new Date(now).toISOString(), holders: holderSources(), monitors: monitorPart(now), deepcore: deepcorePart(now), bot: botPart(now), engine, embeddings: embeddingsPart() }
}

/** One history point per minute: what each sparkline draws (null = not known, never 0). */
function sample(h) {
  const prev = healthRing.at(-1)
  const delta = (cur, last) => (cur == null || last == null || cur < last ? null : cur - last)
  healthRing.push({
    at: h.at,
    holdersAvailable: h.holders.filter((c) => c.available).length,
    monitorsLagS: h.monitors.lagMs == null ? null : Math.round(h.monitors.lagMs / 1000),
    monitorsErrors: h.monitors.errors,
    deepcoreLagS: h.deepcore.lagMs == null ? null : Math.round(h.deepcore.lagMs / 1000),
    deepcoreCached: h.deepcore.cached,
    botUpdates: h.bot.updates,
    botUpdatesPerMin: delta(h.bot.updates, prev?.botUpdates),
    botErrors: h.bot.errors,
    scanQueued: h.engine.queue?.queued ?? null,
    scanRunning: h.engine.queue?.running ?? null,
    embedReady: h.embeddings.embeddings?.ready ?? null,
  })
  if (healthRing.length > HEALTH_KEEP) healthRing.splice(0, healthRing.length - HEALTH_KEEP)
}

let sampling = null
function sampleNow() {
  sampling ??= healthNow()
    .then((h) => (sample(h), h))
    .finally(() => (sampling = null))
  return sampling
}
// The background sampler. Off in the tests (TRACKER_LOOP=off) unless ADMIN_HEALTH_LOOP=on; ADMIN_HEALTH_LOOP=off stops it.
if (process.env.ADMIN_HEALTH_LOOP !== 'off' && (process.env.TRACKER_LOOP !== 'off' || process.env.ADMIN_HEALTH_LOOP === 'on')) {
  setTimeout(() => sampleNow().catch(() => undefined), 20_000).unref?.()
  setInterval(() => sampleNow().catch(() => undefined), HEALTH_EVERY_MS).unref?.()
}

async function healthView() {
  const last = healthRing.at(-1)
  const fresh = last && Date.now() - Date.parse(last.at) < 55_000
  const h = fresh ? await healthNow() : await sampleNow()
  return { ...h, everySeconds: HEALTH_EVERY_MS / 1000, history: healthRing }
}

/* ------------------------------------------------ alerts, workspaces, chain kit --- */

const hostOf = (u) => safe(() => new URL(u).host, null)
const conditionLabel = (x) => {
  const c = x.condition ?? {}
  if (c.type === 'gap') return `gap ${c.direction === 'above' ? '≥ +' : c.direction === 'below' ? '≤ −' : '± '}${c.pct}%`
  if (c.type === 'deepcore-launch') return `DeepCore launch${c.chainId ? ` · chain ${c.chainId}` : ''}`
  if (c.type === 'holders') return `holders · ${c.symbol ?? c.token ?? ''}`
  if (c.type === 'status') return `status ${c.status}`
  return c.type ?? null
}

/** Every alert and monitor across accounts, and the webhook log (newest first). No secrets, no chat ids, no full URLs. */
async function alertsAdmin(accounts) {
  const alerts = []
  const log = []
  const monitors = []
  for (const a of accounts) {
    try {
      const v = await alertsOf(a.address)
      for (const x of v.alerts) {
        const last = x.deliveries[0] ?? null
        alerts.push({ owner: a.address, id: x.id, name: x.name, kind: x.kind, chain: x.chain ?? null, ticker: x.ticker ?? null, condition: safe(() => conditionLabel(x), null), enabled: !!x.enabled, mutedUntil: x.mutedUntil ?? null, coveredByPlan: !!x.coveredByPlan, telegram: !!x.telegram, webhookHost: x.webhook ? hostOf(x.webhook.url) : null, createdAt: x.createdAt, lastFiredAt: x.lastFiredAt ?? null, deliveries: x.deliveries.length, lastDelivery: last ? { at: last.at, channel: last.channel, ok: !!last.ok, status: last.status ?? null } : null })
        for (const d of x.deliveries) if (d.channel === 'webhook') log.push({ at: d.at, owner: a.address, id: x.id, host: x.webhook ? hostOf(x.webhook.url) : null, ok: !!d.ok, status: d.status ?? null, error: d.ok ? null : String(d.error ?? '').slice(0, 160) || null, ms: d.ms ?? null, test: !!d.test, source: 'alert' })
      }
    } catch {
      /* one unreadable account does not hide the rest */
    }
    try {
      const mv = secMon.monitorsOf(a.address)
      for (const m of mv.monitors) {
        monitors.push({ workspace: a.address, id: m.id, name: m.name, chain: m.chain, address: m.address, explorer: m.explorer, enabled: !!m.enabled, coveredByPlan: !!m.coveredByPlan, telegram: !!m.telegram, webhookHost: m.webhook ? hostOf(m.webhook.url) : null, lastCheckedAt: m.lastCheckedAt, lastError: m.lastError, events: m.events.length, lastEventAt: m.events[0]?.at ?? null })
        for (const d of m.deliveries ?? []) if (d.channel === 'webhook') log.push({ at: d.at, owner: a.address, id: m.id, host: m.webhook ? hostOf(m.webhook.url) : null, ok: !!d.ok, status: d.status ?? null, error: d.ok ? null : String(d.error ?? '').slice(0, 160) || null, ms: d.ms ?? null, test: !!d.test, source: 'monitor' })
      }
    } catch {
      /* the monitors store may be unreadable */
    }
  }
  log.sort((x, y) => String(y.at).localeCompare(String(x.at)))
  alerts.sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))
  return { alerts, monitors, webhookLog: log.slice(0, 200), stats: alertStats() }
}

/** Workspaces that have members besides the owner, open invites or a name of their own. */
function workspacesAdmin(accounts) {
  const out = []
  for (const a of accounts) {
    const t = safe(() => teamView(a.address, a.address), null)
    if (!t) continue
    const members = t.members.length
    if (members <= 1 && !t.invites.length && t.workspace.name.endsWith("'s workspace")) continue
    const roles = {}
    for (const m of t.members) roles[m.role] = (roles[m.role] ?? 0) + 1
    out.push({ id: a.address, name: t.workspace.name, members, roles, invites: t.invites.length, blocked: !!a.blocked, lastSeenAt: t.members.map((m) => m.lastSeenAt).filter(Boolean).sort().at(-1) ?? null })
  }
  return { workspaces: out.sort((x, y) => y.members - x.members), accounts: accounts.length }
}

/** Chain Kit requests and the Devnet waitlist: store.mjs helpers when present, else the contact form and launch list. */
function chainKitAdmin() {
  const requests = typeof storeMod.chainKitRequests === 'function' ? safe(() => storeMod.chainKitRequests(), null) : null
  const waitlist = typeof storeMod.chainsWaitlist === 'function' ? safe(() => storeMod.chainsWaitlist(), null) : null
  const fromEnquiries = () =>
    listEnquiries()
      .filter((e) => /Topic: Chain Kit/i.test(e.message ?? ''))
      .map((e) => ({ at: e.receivedAt, email: e.email, chain: /Chain: (.*)/.exec(e.message)?.[1]?.trim() ?? null, workspace: /Workspace: .*\((0x[0-9a-fA-F]{40})\)/.exec(e.message)?.[1] ?? null, address: /Requested by: (0x[0-9a-fA-F]{40})/.exec(e.message)?.[1] ?? null }))
  const fromLaunch = () => listLaunch().filter((r) => String(r.slot) === '90').map((r) => ({ at: r.addedAt, email: r.email }))
  const pub = (via) => (r) => ({ at: r.at ?? r.createdAt ?? null, email: r.email ?? null, chain: r.chain ?? null, workspace: r.workspace ?? null, address: r.address ?? null, status: r.status ?? null, via })
  const byNewest = (x, y) => String(y.at).localeCompare(String(x.at))
  // Requests made before the app kept them server-side arrived as contact enquiries and "notify me" rows: both are shown.
  const merge = (stored, legacy, same) => [...stored.map(pub('app')), ...legacy.map(pub('legacy')).filter((l) => !stored.some((s) => same(s, l)))].sort(byNewest)
  return {
    stored: Array.isArray(requests) || Array.isArray(waitlist),
    requests: merge(Array.isArray(requests) ? requests : [], fromEnquiries(), (s, l) => s.email === l.email && (s.chain ?? null) === l.chain),
    waitlist: merge(Array.isArray(waitlist) ? waitlist : [], fromLaunch(), (s, l) => String(s.email ?? '').toLowerCase() === String(l.email ?? '').toLowerCase()),
  }
}

export async function handleAdmin(req, res, url) {
  const p = url.pathname
  if (!p.startsWith('/api/admin/')) return false
  if (!authorised(req, res)) return true
  // Gully Ask content studio and ask log (ask.mjs): POST /api/admin/ask/draft, GET /api/admin/ask/log.
  if (p.startsWith('/api/admin/ask/')) return handleAskAdmin(req, res, url)
  if (p === '/api/admin/merchants' || p.startsWith('/api/admin/merchants/')) return handleMerchantsAdmin(req, res, url)
  if (p === '/api/admin/channel' || p.startsWith('/api/admin/channel/')) return handleChannelAdmin(req, res, url)
  if (p === '/api/admin/security' || p.startsWith('/api/admin/security/')) return handleSecurityAdmin(req, res, url)
  // The treasury Safe per chain and its one-click deployment (safe-deploy.mjs).
  if (p.startsWith('/api/admin/safe/')) return handleAdminSafe(req, res, url)
  if (p === '/api/admin/broadcasts' || p.startsWith('/api/admin/broadcasts/')) return handleBroadcastAdmin(req, res, url)
  const db = developers()

  // Fee-proxy monitor (fee-proxy-monitor.mjs): read every proxy's balances now. Reads under CACHE_MS are reused, so
  // pressing it repeatedly costs nothing on the RPCs; a non-zero balance raises the alert as the hourly pass would.
  if (p === '/api/admin/fee-proxy/check') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    const view = await checkFeeProxies()
    return json(res, 200, { feeProxy: { ...view, refusals: recentRefusals() } }), true
  }

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
      // Fee-proxy balances (fee-proxy-monitor.mjs) and recent pay-guard refusals: the admin banner and card.
      feeProxy: { ...feeProxyView(), refusals: recentRefusals() },
      process: { uptimeSeconds: Math.round(process.uptime()), rssMb: Math.round(mem.rss / 1e6), heapMb: Math.round(mem.heapUsed / 1e6), node: process.version, dataDirBytes: dirBytes(DATA_DIR) },
    }), true
  }

  if (p === '/api/admin/health') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    return json(res, 200, await healthView()), true
  }
  if (p === '/api/admin/alerts') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    return json(res, 200, await alertsAdmin(db.accounts)), true
  }
  if (p === '/api/admin/workspaces') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    return json(res, 200, workspacesAdmin(db.accounts)), true
  }
  if (p === '/api/admin/chain-kit') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    return json(res, 200, chainKitAdmin()), true
  }

  if (p === '/api/admin/charts') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    return json(res, 200, adminCharts(url.searchParams.get('days') ?? 30)), true
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

  // Treasury deployment gate (treasury-chains.mjs): read eth_getCode(treasury) on every chain now, e.g. right after
  // deploying the Safe on a new chain, instead of waiting for the hourly pass.
  if (p === '/api/admin/treasury/check') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    return json(res, 200, { treasury: await checkTreasuryChains({ rpc, chains: CHAIN_LIST, treasury }) }), true
  }

  if (p === '/api/admin/billing') {
    const subscriptions = db.accounts
      .filter((a) => a.plan)
      .map((a) => {
        const live = planOf(a.address)
        return { address: a.address, plan: a.plan.id, since: a.plan.since ?? null, expiresAt: a.plan.expiresAt, source: a.plan.source ?? null, active: live.id === a.plan.id && !!live.expiresAt }
      })
      .sort((x, y) => y.expiresAt.localeCompare(x.expiresAt))
    return json(res, 200, { subscriptions, payments: allPayments(), offer: adminOffer(), alerts: alertStats(), treasury: treasuryStatus(CHAIN_LIST, treasury()) }), true
  }

  m = p.match(/^\/api\/admin\/accounts\/(0x[0-9a-f]{40})\/plan$/)
  if (m) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    if (isFeeProxy(m[1])) return json(res, 400, { error: PROXY_ACCOUNT }), true
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

  // Send a finished delivery again (any target: link, invoice or the default endpoint).
  m = p.match(/^\/api\/admin\/pay-webhooks\/deliveries\/(whd_[\w-]{12})\/redeliver$/)
  if (m) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    const r = await redeliver(m[1])
    return (r.ok ? json(res, 200, { delivery: r.delivery }) : json(res, r.status, { error: r.error }), true)
  }

  if (p === '/api/admin/telegram') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    const s = telegramStats()
    return json(res, 200, { enabled: s.enabled, links: s.links, canUnlink: typeof tgMod.adminUnlinkTelegram === 'function', chats: await telegramChats(db.accounts) }), true
  }
  m = p.match(/^\/api\/admin\/telegram\/(0x[0-9a-f]{40})\/unlink$/)
  if (m) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    if (typeof tgMod.adminUnlinkTelegram !== 'function') return json(res, 501, { error: 'Unlinking from admin is not available on this build.' }), true
    const ok = await tgMod.adminUnlinkTelegram(m[1])
    return (ok ? json(res, 200, { address: m[1], unlinked: true }) : json(res, 404, { error: 'That account has no linked chat.' }), true)
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

  if (p === '/api/admin/analytics') return json(res, 200, { configured: umamiConfigured(), accounts: adminAnalyticsAccounts(), offer: adminOffer().analytics }), true

  m = p.match(/^\/api\/admin\/analytics\/(0x[0-9a-f]{40})\/(plan|delete)$/)
  if (m) {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    if (m[2] === 'delete') {
      const r = await adminAnalyticsDelete(m[1])
      return (r.ok ? json(res, 200, { address: m[1], deleted: true }) : json(res, r.status, { error: r.error }), true)
    }
    if (isFeeProxy(m[1])) return json(res, 400, { error: PROXY_ACCOUNT }), true
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
