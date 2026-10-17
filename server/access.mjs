// Public API access control: who may call /api/tracker*, and how often.
//
//   anonymous: ANON_LIMIT_PER_MIN requests per minute per IP
//   API key (Authorization: Bearer gl_live_…): the per-key limit of its wallet's plan (plans.mjs)
//
// Fixed one-minute windows held in memory (fast; a restart forgets them, which only ever errs in the
// caller's favour). Usage per key is kept for the developer dashboard and flushed to disk every minute:
// totals, a per-day count, per-hour buckets split by status class (kept 31 days) and a ring buffer of
// the last 50 requests (time, path, status, latency).
// Note: responses are edge-cacheable, so a request served by Cloudflare's cache never reaches this
// code. Limits protect the origin; they are not a billing meter.

import fs from 'node:fs'
import path from 'node:path'
import { bearer, clientIp, DATA_DIR } from './http.mjs'
import { ANONYMOUS, planOf, PLANS } from './plans.mjs'
import { findKey } from './store.mjs'

export const ANON_LIMIT_PER_MIN = ANONYMOUS.perMin
const USAGE_FILE = path.join(DATA_DIR, 'api-usage.json')
const HOUR_MS = 3_600_000
const KEEP_HOURS = 31 * 24
const RECENT = 50

const windows = new Map() // id -> { minute, count }
let usage
try {
  usage = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'))
} catch {
  usage = { since: new Date().toISOString(), anonymous: { requests: 0, limited: 0 }, keys: {}, days: {} }
}
let dirty = false

const today = () => new Date().toISOString().slice(0, 10)
const hourKey = (ms) => new Date(ms).toISOString().slice(0, 13)
const utcDayStart = (ms) => {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function count(id, limit) {
  const minute = Math.floor(Date.now() / 60_000)
  let w = windows.get(id)
  if (!w || w.minute !== minute) {
    w = { minute, count: 0 }
    windows.set(id, w)
  }
  w.count++
  return { allowed: w.count <= limit, remaining: Math.max(0, limit - w.count), retryAfter: 60 - Math.floor((Date.now() / 1000) % 60) }
}

function keyRecord(keyId) {
  const k = (usage.keys[keyId] ??= { requests: 0, limited: 0, lastUsed: null, days: {} })
  k.hours ??= {}
  k.recent ??= []
  return k
}

function tally(keyId, limited) {
  const d = today()
  usage.days[d] ??= { anonymous: 0, keyed: 0, limited: 0 }
  if (limited) usage.days[d].limited++
  if (keyId) {
    const k = keyRecord(keyId)
    k.requests++
    if (limited) k.limited++
    k.lastUsed = new Date().toISOString()
    k.days[d] = (k.days[d] ?? 0) + 1
    usage.days[d].keyed++
  } else {
    usage.anonymous.requests++
    if (limited) usage.anonymous.limited++
    usage.days[d].anonymous++
  }
  dirty = true
}

export function apiAccess(req) {
  const secret = bearer(req)
  if (secret) {
    const key = findKey(secret)
    if (!key) return { ok: false, status: 401, error: 'Unknown or revoked API key. Create one at https://developers.gullylabs.xyz.' }
    // A wallet's key gets its plan's limit; a legacy key with no wallet keeps its own (the Free limit).
    const plan = key.owner ? planOf(key.owner) : { ...PLANS.free, perMin: key.limit }
    const c = count(`key:${key.id}`, plan.perMin)
    tally(key.id, !c.allowed)
    return c.allowed
      ? { ok: true, keyId: key.id, limit: plan.perMin, remaining: c.remaining, plan: plan.id, historyDays: plan.historyDays }
      : { ok: false, status: 429, keyId: key.id, error: `Rate limit reached for this key (${plan.perMin} a minute on the ${plan.name} plan).`, retryAfter: c.retryAfter }
  }
  const c = count(`ip:${clientIp(req)}`, ANON_LIMIT_PER_MIN)
  tally(null, !c.allowed)
  return c.allowed
    ? { ok: true, keyId: null, limit: ANON_LIMIT_PER_MIN, remaining: c.remaining, plan: 'anonymous', historyDays: ANONYMOUS.historyDays }
    : { ok: false, status: 429, error: `Anonymous limit is ${ANON_LIMIT_PER_MIN} requests a minute. A free API key raises it: https://developers.gullylabs.xyz.`, retryAfter: c.retryAfter }
}

// Hour bucket: [total, 2xx/3xx, 4xx other than 429, 429, 5xx]
function bucketIndex(status) {
  if (status === 429) return 3
  if (status >= 500) return 4
  if (status >= 400) return 2
  return 1
}

/**
 * Records a keyed request's outcome once its response has been sent: the hour bucket by status class
 * and the recent-requests ring buffer. Anonymous requests are only counted in apiAccess.
 */
export function observe(req, res, keyId) {
  if (!keyId) return
  const start = Date.now()
  const u = new URL(req.url ?? '/', 'http://x')
  const shown = (u.pathname + u.search).slice(0, 200)
  res.once('finish', () => {
    const k = keyRecord(keyId)
    const h = (k.hours[hourKey(start)] ??= [0, 0, 0, 0, 0])
    h[0]++
    h[bucketIndex(res.statusCode)]++
    k.recent.push([start, req.method ?? 'GET', shown, res.statusCode, Date.now() - start])
    if (k.recent.length > RECENT) k.recent.splice(0, k.recent.length - RECENT)
    dirty = true
  })
}

/** One key's usage, for the legacy key-holder view (GET /api/developer/me). */
export function keyUsage(keyId) {
  const k = usage.keys[keyId]
  const days = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
    days.push({ day: d, requests: k?.days?.[d] ?? 0 })
  }
  return { requests: k?.requests ?? 0, limited: k?.limited ?? 0, lastUsed: k?.lastUsed ?? null, today: k?.days?.[today()] ?? 0, days }
}

/** Last-used time of a key (null when never used). */
export const lastUsed = (keyId) => usage.keys[keyId]?.lastUsed ?? null

const RANGES = { '24h': { buckets: 24, hours: 1 }, '7d': { buckets: 7 * 24, hours: 1 }, '30d': { buckets: 30, hours: 24 } }

/**
 * Usage of a set of keys for the wallet dashboard. Everything comes from the hourly buckets, so only
 * requests recorded since hourly counting began appear; nothing is estimated or back-filled.
 *   range: '24h' and '7d' are hourly; '30d' is daily (UTC days)
 */
export function accountUsage(keyIds, range = '24h') {
  const r = RANGES[range] ?? RANGES['24h']
  const now = Date.now()
  const sizeMs = r.hours * HOUR_MS
  const lastStart = r.hours === 24 ? utcDayStart(now) : Math.floor(now / HOUR_MS) * HOUR_MS
  const first = lastStart - (r.buckets - 1) * sizeMs
  const points = []
  for (let i = 0; i < r.buckets; i++) points.push({ t: new Date(first + i * sizeMs).toISOString(), total: 0, errors: 0, keys: {} })

  const empty = () => ({ total: 0, ok: 0, client: 0, limited: 0, server: 0 })
  const todayTotals = empty()
  const weekTotals = empty()
  const rangeTotals = empty()
  const add = (s, b) => {
    s.total += b[0]
    s.ok += b[1]
    s.client += b[2]
    s.limited += b[3]
    s.server += b[4]
  }
  const dayStart = utcDayStart(now)
  const weekStart = Math.floor(now / HOUR_MS) * HOUR_MS - (7 * 24 - 1) * HOUR_MS
  let since = null
  for (const id of keyIds) {
    for (const [hk, b] of Object.entries(usage.keys[id]?.hours ?? {})) {
      const t = Date.parse(hk + ':00:00Z')
      if (since === null || t < since) since = t
      if (t >= dayStart) add(todayTotals, b)
      if (t >= weekStart) add(weekTotals, b)
      const i = Math.floor((t - first) / sizeMs)
      if (i < 0 || i >= r.buckets) continue
      add(rangeTotals, b)
      points[i].total += b[0]
      points[i].errors += b[2] + b[3] + b[4]
      points[i].keys[id] = (points[i].keys[id] ?? 0) + b[0]
    }
  }
  return { range: RANGES[range] ? range : '24h', bucket: r.hours === 24 ? 'day' : 'hour', points, today: todayTotals, last7d: weekTotals, rangeTotals, countingSince: since === null ? null : new Date(since).toISOString() }
}

/** The most recent requests across a set of keys, newest first. */
export function recentRequests(keyIds, limit = RECENT) {
  const rows = []
  for (const id of keyIds) for (const [t, method, p, status, ms] of usage.keys[id]?.recent ?? []) rows.push({ keyId: id, at: new Date(t).toISOString(), method, path: p, status, ms })
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
}

/** For the admin dashboard: a snapshot of API traffic. */
export function accessStats() {
  const days = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
    days.push({ day: d, ...(usage.days[d] ?? { anonymous: 0, keyed: 0, limited: 0 }) })
  }
  return {
    since: usage.since,
    anonymousLimitPerMin: ANON_LIMIT_PER_MIN,
    anonymous: usage.anonymous,
    keys: Object.entries(usage.keys).map(([id, k]) => ({ id, requests: k.requests, limited: k.limited, lastUsed: k.lastUsed })),
    days,
    liveWindows: windows.size,
  }
}

/** Writes usage to disk (done every minute), dropping hour buckets older than 31 days. */
export function flushUsage() {
  if (!dirty) return
  dirty = false
  const oldest = hourKey(Date.now() - KEEP_HOURS * HOUR_MS)
  for (const k of Object.values(usage.keys)) for (const hk of Object.keys(k.hours ?? {})) if (hk < oldest) delete k.hours[hk]
  try {
    fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true })
    fs.writeFileSync(USAGE_FILE + '.tmp', JSON.stringify(usage))
    fs.renameSync(USAGE_FILE + '.tmp', USAGE_FILE)
  } catch {
    /* in memory */
  }
}

// Flush usage every minute; drop windows older than two minutes so memory stays flat.
setInterval(() => {
  const minute = Math.floor(Date.now() / 60_000)
  for (const [id, w] of windows) if (w.minute < minute - 1) windows.delete(id)
  flushUsage()
}, 60_000).unref?.()
