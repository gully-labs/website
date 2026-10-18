// Gully Analytics, self-serve: a wallet signed in to the developer portal starts a free trial, gets its own
// Gully Analytics (Umami) user, adds websites, and buys or extends a plan through Gully Pay. The proxy in
// analytics.mjs asks admitEvents() before forwarding tracker calls, and counts what was accepted.
//
//   GET  /api/developer/analytics                      account (or null), plans on offer, payments, open checkouts
//   POST /api/developer/analytics/start                -> 201 { account, password }   the password is shown ONCE
//   POST /api/developer/analytics/password             -> { password }                a new one, shown once
//   POST /api/developer/analytics/sso                  -> 201 { url, expiresAt }      one-click sign-in (analytics-sso.mjs)
//   POST /api/developer/analytics/sites  { name, domain } -> 201 { site }
//   POST /api/developer/analytics/sites/:id/delete
//   GET  /api/developer/analytics/usage                Umami's own figures for this month, per site
//   POST /api/developer/analytics/checkout { plan, asset? } -> { intent }   (Gully Pay quote, billing.mjs)
//   POST /api/developer/analytics/checkout/verify { quoteId, txHash } -> 200 { payment, account } | 202 | 4xx
//
// The Umami password is never stored: it is generated, set through the admin API and shown once; "reset"
// sets a new one. Only the user id and username are kept.
//
// Data: DATA_DIR/analytics.json { accounts: [{ address, umamiUserId, username, createdAt, trialEndsAt,
//   plan: null | { id, since, expiresAt, source: 'payment' | 'admin' }, sites: [{ id, name, domain, createdAt }] }],
//   trialsUsed: [address] }   and DATA_DIR/analytics-usage.json { months: { 'YYYY-MM': { websiteId: count } } }.
// Websites not created here (the Gully Labs site itself, for one) are unknown to this module and never blocked.

import fs from 'node:fs'
import path from 'node:path'
import { openProductQuote, productBilling, verifyProductPayment } from './billing.mjs'
import { DATA_DIR, json, readJson } from './http.mjs'
import { ANALYTICS_GRACE_DAYS, ANALYTICS_PAID_IDS, ANALYTICS_PLANS, ANALYTICS_TRIAL_DAYS, PERIOD_MS, publicPlans } from './plans.mjs'
import { randomToken } from './store.mjs'
import * as umami from './umami.mjs'
import { issueSso } from './analytics-sso.mjs'

const FILE = path.join(DATA_DIR, 'analytics.json')
const USAGE_FILE = path.join(DATA_DIR, 'analytics-usage.json')
export const KIND = 'analytics'
export const DASHBOARD_ORIGIN = String(process.env.ANALYTICS_PUBLIC_ORIGIN ?? 'https://analytics.gullylabs.xyz').replace(/\/+$/, '')
const DAY = 86_400_000
const MONTHS_KEPT = 13
// Umami's own rule for a website's domain (src/lib/constants.ts, DOMAIN_REGEX).
const DOMAIN_RE = /^(localhost(:[1-9]\d{0,4})?|((?=[a-z0-9-_]{1,63}\.)(xn--)?[a-z0-9-_]+(-[a-z0-9-_]+)*\.)+(xn--)?[a-z0-9-_]{2,63})$/
const NAME_RE = /^[\p{L}\p{N} .,'&()_\-]{1,60}$/u
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function readFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
function writeFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file + '.tmp', JSON.stringify(data))
  fs.renameSync(file + '.tmp', file)
}

const db = readFile(FILE, {})
db.accounts ??= []
db.trialsUsed ??= []
const save = () => writeFile(FILE, db)

const usage = readFile(USAGE_FILE, {})
usage.months ??= {}
let usageDirty = false

/** websiteId -> wallet address, for every self-serve website. */
const siteOwner = new Map()
function reindex() {
  siteOwner.clear()
  for (const a of db.accounts) for (const s of a.sites) siteOwner.set(s.id, a.address)
}
reindex()

const findAccount = (address) => db.accounts.find((a) => a.address === address) ?? null

/* ---------------------------------------------------------------- usage --- */

export const monthKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 7)
const monthStart = (t = Date.now()) => {
  const d = new Date(t)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}
const siteCount = (id, key = monthKey()) => usage.months[key]?.[id] ?? 0
const usedBy = (acc, key = monthKey()) => acc.sites.reduce((n, s) => n + siteCount(s.id, key), 0)

export function flushAnalyticsUsage() {
  if (!usageDirty) return
  usageDirty = false
  const keys = Object.keys(usage.months).sort()
  for (const k of keys.slice(0, Math.max(0, keys.length - MONTHS_KEPT))) delete usage.months[k]
  try {
    writeFile(USAGE_FILE, usage)
  } catch (e) {
    usageDirty = true
    console.error('analytics usage:', e?.message ?? e)
  }
}
setInterval(flushAnalyticsUsage, 15_000).unref?.()

/** Counts accepted events: `counts` maps websiteId -> number. Websites not created here are not counted. */
export function recordEvents(counts) {
  const key = monthKey()
  for (const [id, n] of counts) {
    if (!siteOwner.has(id) || !(n > 0)) continue
    const m = (usage.months[key] ??= {})
    m[id] = (m[id] ?? 0) + n
    usageDirty = true
  }
}

/* --------------------------------------------------------------- status --- */

/** The plan in force for an account: paid or granted plan, else the trial, else lapsed. */
export function statusOf(acc, now = Date.now()) {
  const p = acc.plan
  if (p && ANALYTICS_PLANS[p.id] && Date.parse(p.expiresAt) > now) return { state: 'active', plan: ANALYTICS_PLANS[p.id], expiresAt: p.expiresAt, source: p.source ?? null, lapsedAt: null, readableUntil: null, deletable: false }
  const trialEnd = Date.parse(acc.trialEndsAt)
  if (trialEnd > now) return { state: 'trial', plan: ANALYTICS_PLANS.trial, expiresAt: acc.trialEndsAt, source: 'trial', lapsedAt: null, readableUntil: null, deletable: false }
  const lapsed = Math.max(trialEnd || 0, p ? Date.parse(p.expiresAt) || 0 : 0)
  const readable = lapsed + ANALYTICS_GRACE_DAYS * DAY
  return { state: 'lapsed', plan: null, expiresAt: null, source: null, lapsedAt: new Date(lapsed).toISOString(), readableUntil: new Date(readable).toISOString(), deletable: now > readable }
}

const BLOCK = {
  lapsed: { code: 'gully-plan-lapsed', message: 'This Gully Analytics account has no running plan or trial, so events are not recorded. Renew at https://app.gullylabs.xyz/#analytics.' },
  sites: { code: 'gully-site-limit', message: 'This website is beyond the number of websites the account’s plan includes, so its events are not recorded.' },
  quota: { code: 'gully-quota-exceeded', message: 'This Gully Analytics account has used its events for this month. Upgrade at https://app.gullylabs.xyz/#analytics.' },
}

/** Why a website's events are refused right now, or null when they are accepted. */
function blockOf(acc, st, siteId) {
  if (st.state === 'lapsed') return BLOCK.lapsed
  if (acc.sites.findIndex((s) => s.id === siteId) >= st.plan.sites) return BLOCK.sites
  if (usedBy(acc) >= st.plan.eventsPerMonth) return BLOCK.quota
  return null
}

/**
 * The proxy's question, for the website ids of one tracker call (one for /api/send, one per item for
 * /api/batch; null for an item without a website). Answers one { ok, block? } per id. A website not
 * created here is always accepted. Items of the same call share the account's remaining quota.
 */
export function admitEvents(ids) {
  const pending = new Map() // address -> accepted so far in this call
  return ids.map((id) => {
    const address = typeof id === 'string' ? siteOwner.get(id) : undefined
    if (!address) return { ok: true }
    const acc = findAccount(address)
    if (!acc) return { ok: true }
    const st = statusOf(acc)
    const b = blockOf(acc, st, id)
    if (b) return { ok: false, block: b }
    const n = pending.get(address) ?? 0
    if (usedBy(acc) + n >= st.plan.eventsPerMonth) return { ok: false, block: BLOCK.quota }
    pending.set(address, n + 1)
    return { ok: true }
  })
}

/* ----------------------------------------------------------------- views --- */

const dashboardUrl = (id) => `${DASHBOARD_ORIGIN}/websites/${id}`

function accountView(acc) {
  const st = statusOf(acc)
  const key = monthKey()
  return {
    username: acc.username,
    createdAt: acc.createdAt,
    state: st.state,
    plan: st.plan,
    expiresAt: st.expiresAt,
    source: st.source,
    lapsedAt: st.lapsedAt,
    readableUntil: st.readableUntil,
    trialEndsAt: acc.trialEndsAt,
    lastPlan: acc.plan ? { id: acc.plan.id, name: ANALYTICS_PLANS[acc.plan.id]?.name ?? acc.plan.id, expiresAt: acc.plan.expiresAt } : null,
    month: key,
    monthStart: new Date(monthStart()).toISOString(),
    eventsThisMonth: usedBy(acc, key),
    loginUrl: `${DASHBOARD_ORIGIN}/login`,
    // One-click sign-in (POST /api/developer/analytics/sso) works on this server.
    ssoAvailable: umami.ssoConfigured(),
    sites: acc.sites.map((s) => {
      const b = blockOf(acc, st, s.id)
      return { id: s.id, name: s.name, domain: s.domain, createdAt: s.createdAt, eventsThisMonth: siteCount(s.id, key), dashboardUrl: dashboardUrl(s.id), blocked: b ? b.code : null }
    }),
  }
}

/** Admin: every analytics account. */
export function adminAnalyticsAccounts() {
  return db.accounts.map((a) => {
    const st = statusOf(a)
    return { address: a.address, username: a.username, createdAt: a.createdAt, state: st.state, plan: st.plan?.id ?? null, planName: st.plan?.name ?? null, expiresAt: st.expiresAt, source: st.source, lapsedAt: st.lapsedAt, readableUntil: st.readableUntil, deletable: st.deletable, sites: a.sites.length, eventsThisMonth: usedBy(a), eventsLimit: st.plan?.eventsPerMonth ?? null }
  })
}

/* ----------------------------------------------------------------- plans --- */

function applyPlan(acc, planId, source, periodMs = PERIOD_MS) {
  const now = Date.now()
  const cur = acc.plan
  const running = cur && cur.id === planId && Date.parse(cur.expiresAt) > now
  const start = running ? Date.parse(cur.expiresAt) : now
  acc.plan = { id: planId, since: running ? cur.since : new Date(now).toISOString(), expiresAt: new Date(start + periodMs).toISOString(), source }
  save()
  return { ok: true, periodStart: new Date(start).toISOString(), expiresAt: acc.plan.expiresAt }
}

/** Admin: grant a paid plan for `days` from now (replacing what runs), or `none` to stop the plan and any trial now. */
export function adminAnalyticsSetPlan(address, planId, days = 30) {
  const acc = findAccount(address)
  if (!acc) return { ok: false, status: 404, error: 'This wallet has no analytics account.' }
  if (planId === 'none') {
    const now = new Date().toISOString()
    acc.plan = null
    if (Date.parse(acc.trialEndsAt) > Date.now()) acc.trialEndsAt = now
    save()
    return { ok: true, account: adminAnalyticsAccounts().find((a) => a.address === address) }
  }
  if (!ANALYTICS_PAID_IDS.includes(planId)) return { ok: false, status: 400, error: `plan must be none, ${ANALYTICS_PAID_IDS.join(' or ')}.` }
  const d = Number(days)
  if (!Number.isInteger(d) || d < 1 || d > 3660) return { ok: false, status: 400, error: 'days must be a whole number from 1 to 3660.' }
  const now = Date.now()
  acc.plan = { id: planId, since: new Date(now).toISOString(), expiresAt: new Date(now + d * DAY).toISOString(), source: 'admin' }
  save()
  return { ok: true, account: adminAnalyticsAccounts().find((a) => a.address === address) }
}

/** Admin: delete an account whose plan lapsed more than the grace period ago, with its Umami user and data. */
export async function adminAnalyticsDelete(address) {
  const acc = findAccount(address)
  if (!acc) return { ok: false, status: 404, error: 'This wallet has no analytics account.' }
  const st = statusOf(acc)
  if (!st.deletable) return { ok: false, status: 409, error: st.state === 'lapsed' ? `Its dashboard stays readable until ${st.readableUntil}.` : 'It still has a running plan or trial.' }
  const r = await umami.deleteUser(acc.umamiUserId)
  if (!r.ok && r.status !== 404) return r
  db.accounts = db.accounts.filter((a) => a !== acc)
  save()
  reindex()
  return { ok: true }
}

/** Tests only: moves an account's trial and plan end `ms` into the past. */
export function shiftAccountForTest(address, ms) {
  const acc = findAccount(address)
  if (!acc) return
  acc.trialEndsAt = new Date(Date.parse(acc.trialEndsAt) - ms).toISOString()
  if (acc.plan) acc.plan.expiresAt = new Date(Date.parse(acc.plan.expiresAt) - ms).toISOString()
  save()
}

/* --------------------------------------------------------------- handler --- */

const hits = new Map()
function allow(bucket, who, max, ms) {
  const k = `${bucket}:${who}`
  const now = Date.now()
  const list = (hits.get(k) ?? []).filter((t) => now - t < ms)
  if (list.length >= max) return false
  list.push(now)
  hits.set(k, list)
  return true
}

const starting = new Set()
const newPassword = () => randomToken(18)

/** Normalises what a user types as a domain: no scheme, path, port (except localhost) or trailing dot. */
export function cleanDomain(v) {
  let d = String(v ?? '').trim().toLowerCase()
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/\.$/, '')
  if (!d.startsWith('localhost')) d = d.replace(/:\d+$/, '')
  return d.length <= 253 && DOMAIN_RE.test(d) ? d : null
}

async function start(address) {
  if (!umami.umamiConfigured()) return { ok: false, status: 503, error: 'Self-serve Gully Analytics is not switched on yet on this server. Write to hello@gullylabs.xyz.' }
  if (findAccount(address)) return { ok: false, status: 409, error: 'This wallet already has a Gully Analytics account.' }
  if (starting.has(address)) return { ok: false, status: 409, error: 'Your account is being created already.' }
  starting.add(address)
  try {
    const hex = address.slice(2)
    const password = newPassword()
    let user = null
    for (const username of [`w_${hex.slice(0, 10)}`, `w_${hex.slice(0, 16)}`, `w_${hex}`]) {
      const r = await umami.createUser(username, password)
      if (r.ok) {
        user = r.user
        break
      }
      if (!r.taken) return r
    }
    if (!user?.id) return { ok: false, status: 502, error: 'Gully Analytics did not create the user. Try again in a minute.' }
    const now = Date.now()
    // One trial per wallet: a wallet whose account was deleted starts again without one.
    const hadTrial = db.trialsUsed.includes(address)
    const acc = { address, umamiUserId: user.id, username: user.username, createdAt: new Date(now).toISOString(), trialEndsAt: new Date(hadTrial ? now : now + ANALYTICS_TRIAL_DAYS * DAY).toISOString(), plan: null, sites: [] }
    db.accounts.push(acc)
    if (!hadTrial) db.trialsUsed.push(address)
    save()
    return { ok: true, account: accountView(acc), password }
  } finally {
    starting.delete(address)
  }
}

/**
 * Websites the user added in the Gully Analytics dashboard itself (not through the app) belong to the
 * account too: list them here and count them against the plan. Read at most once a minute per account.
 */
const adoptedAt = new Map()
async function adoptDashboardSites(acc) {
  const last = adoptedAt.get(acc.umamiUserId) ?? 0
  if (Date.now() - last < Number(process.env.ANALYTICS_ADOPT_MS ?? 60_000)) return
  adoptedAt.set(acc.umamiUserId, Date.now())
  const r = await umami.websitesOf(acc.umamiUserId)
  if (!r.ok) return
  const known = new Set(acc.sites.map((s) => s.id))
  const added = r.websites.filter((w) => !known.has(w.id))
  if (!added.length) return
  for (const w of added) acc.sites.push({ id: w.id, name: w.name || w.domain, domain: w.domain, createdAt: w.createdAt ?? new Date().toISOString(), source: 'dashboard' })
  await save()
}

/** Every /api/developer/analytics* route for a signed-in wallet (developer.mjs checks the session and CSRF). */
export async function handleAnalyticsAccount(req, res, url, address) {
  const p = url.pathname
  const post = req.method === 'POST'
  const acc = findAccount(address)

  if (p === '/api/developer/analytics') {
    if (post) return json(res, 405, { error: 'GET only' }), true
    if (acc) await adoptDashboardSites(acc)
    return json(res, 200, { configured: umami.umamiConfigured(), trialAvailable: !db.trialsUsed.includes(address), account: acc ? accountView(acc) : null, offer: publicPlans(), dashboardOrigin: DASHBOARD_ORIGIN, ...productBilling(KIND, address) }), true
  }

  if (p === '/api/developer/analytics/usage') {
    if (post) return json(res, 405, { error: 'GET only' }), true
    if (!acc) return json(res, 404, { error: 'Start your free trial first.' }), true
    if (!allow('a-usage', address, 120, 3_600_000)) return json(res, 429, { error: 'Too many usage reads in the last hour. Try again later.' }), true
    const from = monthStart()
    const to = Date.now()
    const sites = await Promise.all(acc.sites.map(async (s) => {
      const r = await umami.websiteStats(s.id, from, to)
      return r.ok ? { id: s.id, ok: true, stats: r.stats } : { id: s.id, ok: false, error: r.error }
    }))
    return json(res, 200, { from: new Date(from).toISOString(), to: new Date(to).toISOString(), sites }), true
  }

  if (!post) return json(res, 405, { error: 'POST only' }), true

  if (p === '/api/developer/analytics/start') {
    if (!allow('a-start', address, 5, 3_600_000)) return json(res, 429, { error: 'Too many attempts in the last hour. Try again later.' }), true
    const r = await start(address)
    return r.ok ? json(res, 201, { account: r.account, password: r.password }) : json(res, r.status, { error: r.error }), true
  }

  if (!acc) return json(res, 404, { error: 'Start your free trial first.' }), true

  if (p === '/api/developer/analytics/sso') return issueSso(req, res, acc, statusOf)

  if (p === '/api/developer/analytics/password') {
    if (!allow('a-password', address, 10, 3_600_000)) return json(res, 429, { error: 'Too many password resets in the last hour. Try again later.' }), true
    const password = newPassword()
    const r = await umami.setPassword(acc.umamiUserId, password)
    return r.ok ? json(res, 200, { username: acc.username, password }) : json(res, r.status, { error: r.error }), true
  }

  if (p === '/api/developer/analytics/sites') {
    const body = await readJson(req, 2_000)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const domain = cleanDomain(body?.domain)
    if (!NAME_RE.test(name)) return json(res, 400, { error: 'Name the website: 1 to 60 letters, digits, spaces or simple punctuation.' }), true
    if (!domain) return json(res, 400, { error: 'Give the website’s domain, like example.com or app.example.com.' }), true
    const st = statusOf(acc)
    if (st.state === 'lapsed') return json(res, 402, { error: 'Your trial or plan has ended. Choose a plan to add websites again.' }), true
    if (acc.sites.length >= st.plan.sites) return json(res, 409, { error: `${st.plan.name} includes ${st.plan.sites} website${st.plan.sites === 1 ? '' : 's'}. Remove one or upgrade to add another.` }), true
    if (acc.sites.some((s) => s.domain === domain)) return json(res, 409, { error: `${domain} is on your account already.` }), true
    if (!allow('a-site', address, 20, 3_600_000)) return json(res, 429, { error: 'Too many websites added in the last hour. Try again later.' }), true
    const r = await umami.createWebsiteFor(acc.umamiUserId, name, domain)
    if (!r.ok) return json(res, r.status, { error: r.error }), true
    const site = { id: r.website.id, name: r.website.name, domain: r.website.domain, createdAt: new Date().toISOString() }
    acc.sites.push(site)
    save()
    reindex()
    return json(res, 201, { site: accountView(acc).sites.find((s) => s.id === site.id) }), true
  }

  const m = p.match(/^\/api\/developer\/analytics\/sites\/([0-9a-f-]{36})\/delete$/)
  if (m) {
    const site = UUID_RE.test(m[1]) ? acc.sites.find((s) => s.id === m[1]) : null
    if (!site) return json(res, 404, { error: 'No such website on your account.' }), true
    const r = await umami.deleteWebsite(site.id)
    if (!r.ok && r.status !== 404) return json(res, r.status, { error: r.error }), true
    acc.sites = acc.sites.filter((s) => s !== site)
    save()
    reindex()
    return json(res, 200, { ok: true }), true
  }

  if (p === '/api/developer/analytics/checkout') {
    if (!allow('a-checkout', address, 30, 3_600_000)) return json(res, 429, { error: 'Too many checkouts started in the last hour. Try again later.' }), true
    const body = await readJson(req, 1_000)
    const planId = String(body?.plan ?? '')
    if (!ANALYTICS_PAID_IDS.includes(planId)) return json(res, 400, { error: `Choose a plan: ${ANALYTICS_PAID_IDS.join(' or ')}.` }), true
    const r = await openProductQuote({ kind: KIND, address, planId, usdCents: Math.round(ANALYTICS_PLANS[planId].priceUsdc * 100), assetId: body?.asset ? String(body.asset) : undefined })
    return r.ok ? json(res, 200, { intent: r.intent }) : json(res, r.status, { error: r.error }), true
  }

  if (p === '/api/developer/analytics/checkout/verify') {
    if (!allow('a-verify', address, 60, 3_600_000)) return json(res, 429, { error: 'Too many payment checks in the last hour. Try again later.' }), true
    const body = await readJson(req, 1_000)
    const r = await verifyProductPayment({
      kind: KIND,
      address,
      quoteId: body?.quoteId,
      txHashIn: body?.txHash,
      label: (q) => `Gully Analytics ${ANALYTICS_PLANS[q.plan]?.name ?? q.plan}`,
      apply: (q) => (ANALYTICS_PLANS[q.plan] ? applyPlan(acc, q.plan, 'payment') : { ok: false, status: 409, error: 'That plan is no longer offered. Write to hello@gullylabs.xyz with the hash.' }),
    })
    if (r.ok) return json(res, 200, { payment: r.payment, account: accountView(acc) }), true
    return json(res, r.status, { error: r.error, ...(r.pending ? { pending: true, confirmations: r.confirmations, needed: r.needed } : {}) }), true
  }

  return json(res, 404, { error: 'not found' }), true
}
