// Public API access control: who may call /api/tracker*, and how often.
//
//   anonymous: ANON_LIMIT_PER_MIN requests per minute per IP
//   API key (Authorization: Bearer gl_live_…): the key's own limit per minute
//
// Fixed one-minute windows held in memory (fast; a restart forgets them, which only ever errs in the
// caller's favour). Usage per key per day is kept for the developer dashboard and flushed to disk.
// Note: responses are edge-cacheable, so a request served by Cloudflare's cache never reaches this
// code. Limits protect the origin; they are not a billing meter.

import fs from 'node:fs'
import path from 'node:path'
import { bearer, clientIp, DATA_DIR } from './http.mjs'
import { findKey } from './store.mjs'

export const ANON_LIMIT_PER_MIN = 60
const USAGE_FILE = path.join(DATA_DIR, 'api-usage.json')

const windows = new Map() // id -> { minute, count }
let usage
try {
  usage = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'))
} catch {
  usage = { since: new Date().toISOString(), anonymous: { requests: 0, limited: 0 }, keys: {}, days: {} }
}
let dirty = false

const today = () => new Date().toISOString().slice(0, 10)

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

function tally(keyId, limited) {
  const d = today()
  usage.days[d] ??= { anonymous: 0, keyed: 0, limited: 0 }
  if (limited) usage.days[d].limited++
  if (keyId) {
    const k = (usage.keys[keyId] ??= { requests: 0, limited: 0, lastUsed: null, days: {} })
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
    if (!key) return { ok: false, status: 401, error: 'Unknown or revoked API key. Request one at https://developers.gullylabs.xyz.' }
    const c = count(`key:${key.id}`, key.limit)
    tally(key.id, !c.allowed)
    return c.allowed ? { ok: true, keyId: key.id, limit: key.limit, remaining: c.remaining } : { ok: false, status: 429, error: 'Rate limit reached for this key.', retryAfter: c.retryAfter }
  }
  const c = count(`ip:${clientIp(req)}`, ANON_LIMIT_PER_MIN)
  tally(null, !c.allowed)
  return c.allowed
    ? { ok: true, keyId: null, limit: ANON_LIMIT_PER_MIN, remaining: c.remaining }
    : { ok: false, status: 429, error: `Anonymous limit is ${ANON_LIMIT_PER_MIN} requests a minute. An API key raises it: https://developers.gullylabs.xyz.`, retryAfter: c.retryAfter }
}

/** One key's usage, for its holder's dashboard. */
export function keyUsage(keyId) {
  const k = usage.keys[keyId]
  const days = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
    days.push({ day: d, requests: k?.days?.[d] ?? 0 })
  }
  return { requests: k?.requests ?? 0, limited: k?.limited ?? 0, lastUsed: k?.lastUsed ?? null, today: k?.days?.[today()] ?? 0, days }
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

// Flush usage every minute; drop windows older than two minutes so memory stays flat.
setInterval(() => {
  const minute = Math.floor(Date.now() / 60_000)
  for (const [id, w] of windows) if (w.minute < minute - 1) windows.delete(id)
  if (!dirty) return
  dirty = false
  try {
    fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true })
    fs.writeFileSync(USAGE_FILE + '.tmp', JSON.stringify(usage))
    fs.renameSync(USAGE_FILE + '.tmp', USAGE_FILE)
  } catch {
    /* in memory */
  }
}, 60_000).unref?.()
