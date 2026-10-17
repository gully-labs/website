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

// Per key, the request count of each of the last 60 minutes ([minute, count] pairs, at most 61), for
// the usage-threshold notices (peakPerMinute). Only keys used in the last hour are held.
const minuteHistory = new Map() // keyId -> [[minute, count], ...]

function count(id, limit) {
  const minute = Math.floor(Date.now() / 60_000)
  let w = windows.get(id)
  if (!w || w.minute !== minute) {
    w = { minute, count: 0 }
    windows.set(id, w)
  }
  w.count++
  if (id.startsWith('key:')) noteMinute(id.slice(4), minute, w.count)
  return { allowed: w.count <= limit, remaining: Math.max(0, limit - w.count), retryAfter: 60 - Math.floor((Date.now() / 1000) % 60) }
}

function noteMinute(keyId, minute, n) {
  let h = minuteHistory.get(keyId)
  if (!h) minuteHistory.set(keyId, (h = []))
  const last = h.at(-1)
  if (last && last[0] === minute) last[1] = Math.max(last[1], n)
  else h.push([minute, n])
  while (h.length && h[0][0] < minute - 60) h.shift()
}

/** The busiest minute of a key over the last hour (requests counted against its limit, 429s included), or 0. */
export function peakPerMinute(keyId, now = Date.now()) {
  const minute = Math.floor(now / 60_000)
  let max = 0
  for (const [m, n] of minuteHistory.get(keyId) ?? []) if (m >= minute - 60 && n > max) max = n
  return max
}

/** Test hook: counts `n` requests for a key in the current minute (as if they had been made). */
export function bumpMinuteForTest(keyId, n) {
  const minute = Math.floor(Date.now() / 60_000)
  const id = `key:${keyId}`
  let w = windows.get(id)
  if (!w || w.minute !== minute) windows.set(id, (w = { minute, count: 0 }))
  w.count += n
  noteMinute(keyId, minute, w.count)
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
    if (!key) return { ok: false, status: 401, error: 'Unknown or revoked API key. Create one at https://app.gullylabs.xyz.' }
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
    : { ok: false, status: 429, error: `Anonymous limit is ${ANON_LIMIT_PER_MIN} requests a minute. A free API key raises it: https://app.gullylabs.xyz.`, retryAfter: c.retryAfter }
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
// Endpoint templates counted per key and hour (the dashboard's "top endpoints"). A fixed set, so memory
// stays bounded: at most ENDPOINTS.length counters per key-hour, pruned with the hour buckets.
export const ENDPOINTS = ['/api/tracker', '/api/tracker/history', '/api/tracker/movers', '/api/plans', 'other']
/** A request path reduced to its route template (one of ENDPOINTS). */
export function endpointOf(pathname) {
  const p = String(pathname ?? '').split('?')[0].replace(/\/+$/, '') || '/'
  return p !== 'other' && ENDPOINTS.includes(p) ? p : 'other'
}

export function observe(req, res, keyId) {
  if (!keyId) return
  const start = Date.now()
  const u = new URL(req.url ?? '/', 'http://x')
  const shown = (u.pathname + u.search).slice(0, 200)
  const ep = endpointOf(u.pathname)
  res.once('finish', () => {
    const k = keyRecord(keyId)
    const hk = hourKey(start)
    const h = (k.hours[hk] ??= [0, 0, 0, 0, 0])
    h[0]++
    h[bucketIndex(res.statusCode)]++
    k.ep ??= {}
    const e = (k.ep[hk] ??= {})
    e[ep] = (e[ep] ?? 0) + 1
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
  for (let i = 0; i < r.buckets; i++) points.push({ t: new Date(first + i * sizeMs).toISOString(), total: 0, errors: 0, limited: 0, keys: {} })

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
      points[i].limited += b[3]
      points[i].keys[id] = (points[i].keys[id] ?? 0) + b[0]
    }
  }
  return { range: RANGES[range] ? range : '24h', bucket: r.hours === 24 ? 'day' : 'hour', points, today: todayTotals, last7d: weekTotals, rangeTotals, countingSince: since === null ? null : new Date(since).toISOString() }
}

/** Start and bucket size of a range's window (same arithmetic as accountUsage). */
function rangeWindow(range, now = Date.now()) {
  const r = RANGES[range] ?? RANGES['24h']
  const sizeMs = r.hours * HOUR_MS
  const lastStart = r.hours === 24 ? utcDayStart(now) : Math.floor(now / HOUR_MS) * HOUR_MS
  const first = lastStart - (r.buckets - 1) * sizeMs
  return { r, sizeMs, first, end: first + r.buckets * sizeMs }
}

/**
 * Extra usage figures for the dashboard (portal v2), over the same window as accountUsage(range):
 *   previous:   totals of the period of the same length just before, with its { from, to }
 *               (null when counting began after that period started, so it would be partial)
 *   byStatus:   { ok, client, limited, server } over the range (null when nothing was ever counted for these keys)
 *   byEndpoint: [{ endpoint, count }] over the range, busiest first (null when no endpoint counts exist yet)
 *   endpointsSince: first hour with endpoint counts, or null
 * Unknown figures are null, never 0.
 */
export function usageExtras(keyIds, range = '24h', now = Date.now()) {
  const { first, end } = rangeWindow(range, now)
  const prevStart = first - (end - first)
  const zero = () => ({ total: 0, ok: 0, client: 0, limited: 0, server: 0 })
  const prev = zero()
  const cur = zero()
  const add = (s, b) => {
    s.total += b[0]
    s.ok += b[1]
    s.client += b[2]
    s.limited += b[3]
    s.server += b[4]
  }
  let since = null
  let epSince = null
  const eps = {}
  for (const id of keyIds) {
    const k = usage.keys[id]
    for (const [hk, b] of Object.entries(k?.hours ?? {})) {
      const t = Date.parse(hk + ':00:00Z')
      if (since === null || t < since) since = t
      if (t >= first && t < end) add(cur, b)
      else if (t >= prevStart && t < first) add(prev, b)
    }
    for (const [hk, counts] of Object.entries(k?.ep ?? {})) {
      const t = Date.parse(hk + ':00:00Z')
      if (epSince === null || t < epSince) epSince = t
      if (t < first || t >= end) continue
      for (const [e, n] of Object.entries(counts)) eps[e] = (eps[e] ?? 0) + n
    }
  }
  return {
    previous: since !== null && since <= prevStart ? { ...prev, from: new Date(prevStart).toISOString(), to: new Date(first).toISOString() } : null,
    byStatus: since === null ? null : { ok: cur.ok, client: cur.client, limited: cur.limited, server: cur.server },
    byEndpoint: epSince === null ? null : Object.entries(eps).map(([endpoint, count]) => ({ endpoint, count })).sort((a, b) => b.count - a.count || a.endpoint.localeCompare(b.endpoint)),
    endpointsSince: epSince === null ? null : new Date(epSince).toISOString(),
  }
}

/**
 * Per-bucket, per-key rows for the CSV export: { t, keyId, total, ok, client, limited, server }, oldest
 * first; only buckets with traffic. '24h' and '7d' are hourly, '30d' daily (UTC days).
 */
export function usageRows(keyIds, range = '24h', now = Date.now()) {
  const { sizeMs, first, end } = rangeWindow(range, now)
  const rows = new Map() // `${bucketStart}|${keyId}` -> row
  for (const id of keyIds) {
    for (const [hk, b] of Object.entries(usage.keys[id]?.hours ?? {})) {
      const t = Date.parse(hk + ':00:00Z')
      if (t < first || t >= end) continue
      const start = first + Math.floor((t - first) / sizeMs) * sizeMs
      const key = `${start}|${id}`
      const r = rows.get(key) ?? { t: new Date(start).toISOString(), keyId: id, total: 0, ok: 0, client: 0, limited: 0, server: 0 }
      r.total += b[0]
      r.ok += b[1]
      r.client += b[2]
      r.limited += b[3]
      r.server += b[4]
      rows.set(key, r)
    }
  }
  return [...rows.values()].sort((a, b) => a.t.localeCompare(b.t) || a.keyId.localeCompare(b.keyId))
}

/** Test hook: adds one hour bucket [total, ok, client, limited, server] (and endpoint counts) to a key. */
export function addUsageForTest(keyId, atMs, bucket, endpoints = null) {
  const k = keyRecord(keyId)
  const hk = hourKey(atMs)
  const h = (k.hours[hk] ??= [0, 0, 0, 0, 0])
  for (let i = 0; i < 5; i++) h[i] += bucket[i] ?? 0
  if (endpoints) {
    k.ep ??= {}
    const e = (k.ep[hk] ??= {})
    for (const [ep, n] of Object.entries(endpoints)) e[ep] = (e[ep] ?? 0) + n
  }
  dirty = true
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
  for (const k of Object.values(usage.keys)) {
    for (const hk of Object.keys(k.hours ?? {})) if (hk < oldest) delete k.hours[hk]
    for (const hk of Object.keys(k.ep ?? {})) if (hk < oldest) delete k.ep[hk]
  }
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
  for (const [id, h] of minuteHistory) if (!h.length || h.at(-1)[0] < minute - 60) minuteHistory.delete(id)
  flushUsage()
}, 60_000).unref?.()
