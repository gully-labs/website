// Workspace activity log and usage-threshold notices (app dashboard v2).
//
// Activity: one JSON-lines file per workspace, DATA_DIR/activity/<ownerAddress>.jsonl, each line
//   { id, at, actor, action, target, detail }
// actor is the wallet that acted (lower-case) or 'system'. A workspace keeps its newest KEEP events and
// nothing older than KEEP_DAYS; the file is rewritten (atomically) when it grows past that.
//
// Events come from two places: the portal v2 modules record their own (team, profile, company,
// sessions), and developer.mjs's gate observes the successful answers of the older routes (keys, alerts,
// analytics, billing) and maps them to events with eventFor(), so those modules are not edited.
//
// Usage thresholds: every minute, each workspace's busiest key over the last hour (access.mjs's per-key
// minute counter) is compared with its plan's per-minute limit. Passing 80% or 100% records an activity
// event and, when the owner's profile has notify.telegramUsage on, sends a Telegram message to the
// owner's linked chat. Each threshold fires at most once per 24 hours per workspace (DATA_DIR/usage-notices.json).

import fs from 'node:fs'
import path from 'node:path'
import { peakPerMinute } from './access.mjs'
import { DATA_DIR } from './http.mjs'
import { planOf } from './plans.mjs'
import { profileOf } from './profile.mjs'
import { developers, getAccount, randomToken } from './store.mjs'
import * as telegram from './telegram.mjs'

const DIR = path.join(DATA_DIR, 'activity')
const NOTICES = path.join(DATA_DIR, 'usage-notices.json')
export const KEEP = 1000
export const KEEP_DAYS = 180
const KEEP_MS = KEEP_DAYS * 86_400_000
const PAGE = 50
const ADDR_RE = /^0x[0-9a-f]{40}$/

const cache = new Map() // workspace -> events, oldest first

const fileOf = (ws) => path.join(DIR, `${ws}.jsonl`)

function load(ws) {
  let list = cache.get(ws)
  if (list) return list
  list = []
  try {
    for (const line of fs.readFileSync(fileOf(ws), 'utf8').split('\n')) {
      if (!line) continue
      try {
        list.push(JSON.parse(line))
      } catch {
        /* a torn line is skipped */
      }
    }
  } catch {
    /* no file yet */
  }
  cache.set(ws, list)
  return list
}

function rewrite(ws, list) {
  try {
    fs.mkdirSync(DIR, { recursive: true })
    const f = fileOf(ws)
    fs.writeFileSync(f + '.tmp', list.map((e) => JSON.stringify(e)).join('\n') + (list.length ? '\n' : ''))
    fs.renameSync(f + '.tmp', f)
  } catch (e) {
    console.error('activity write:', e?.message ?? e)
  }
}

const clip = (v, n) => (v === null || v === undefined ? null : String(v).slice(0, n))

/** Appends one event to a workspace's log. `detail` is a small object of plain values (never a secret). */
export function recordEvent(ws, { actor, action, target = null, detail = null, at = Date.now() }) {
  if (!ADDR_RE.test(String(ws))) return null
  const list = load(ws)
  const e = { id: `${at.toString(36)}${randomToken(4)}`, at: new Date(at).toISOString(), actor: clip(actor, 42) ?? 'system', action: clip(action, 40), target: clip(target, 120), detail: detail && typeof detail === 'object' ? detail : null }
  list.push(e)
  const cutoff = new Date(Date.now() - KEEP_MS).toISOString()
  if (list.length > KEEP + 100 || (list[0] && list[0].at < cutoff)) {
    const kept = list.filter((x) => x.at >= cutoff).slice(-KEEP)
    list.splice(0, list.length, ...kept)
    rewrite(ws, list)
  } else {
    try {
      fs.mkdirSync(DIR, { recursive: true })
      fs.appendFileSync(fileOf(ws), JSON.stringify(e) + '\n')
    } catch (err) {
      console.error('activity append:', err?.message ?? err)
    }
  }
  return e
}

/**
 * A page of a workspace's log, newest first: { events, nextCursor }. `cursor` is the id of the last event
 * of the previous page (nextCursor); an unknown cursor answers null.
 */
export function activityPage(ws, cursor = null, limit = PAGE) {
  const cutoff = new Date(Date.now() - KEEP_MS).toISOString()
  const list = load(ws).filter((e) => e.at >= cutoff)
  let end = list.length
  if (cursor) {
    const i = list.findIndex((e) => e.id === cursor)
    if (i < 0) return null
    end = i
  }
  const start = Math.max(0, end - limit)
  const events = list.slice(start, end).reverse().map(({ id, at, actor, action, target, detail }) => ({ id, at, actor, action, target, detail }))
  return { events, nextCursor: start > 0 ? list[start].id : null }
}

/* ------------------------------------------------ observed (older) routes --- */

const pick = (o, keys) => {
  const out = {}
  for (const k of keys) if (o?.[k] !== undefined && o[k] !== null) out[k] = typeof o[k] === 'object' ? null : o[k]
  return out
}

/**
 * Maps a successful POST answer of an older /api/developer route to an activity event, or null.
 *   sub:  the path after /api/developer (e.g. '/keys/abc/rename')
 *   body: the parsed JSON answer (only named, non-secret fields are copied)
 *   pre:  state read before the handler ran ({ keyName })
 */
export function eventFor(method, sub, status, body, pre = {}) {
  if (method !== 'POST' || status < 200 || status >= 300) return null
  let m
  if (sub === '/keys') return { action: 'key.created', target: body?.key?.name ?? null, detail: pick(body?.key, ['id', 'prefix']) }
  if (sub === '/keys/link') return { action: 'key.linked', target: body?.key?.name ?? null, detail: pick(body?.key, ['id', 'prefix']) }
  if ((m = sub.match(/^\/keys\/([\w-]{1,40})\/(rename|rotate|revoke)$/))) {
    const action = { rename: 'key.renamed', rotate: 'key.rotated', revoke: 'key.revoked' }[m[2]]
    const detail = { id: m[1] }
    if (m[2] === 'rename') Object.assign(detail, { from: pre.keyName ?? null, to: body?.key?.name ?? null })
    if (m[2] === 'rotate') detail.prefix = body?.key?.prefix ?? null
    return { action, target: body?.key?.name ?? pre.keyName ?? m[1], detail }
  }
  if (sub === '/alerts') return { action: 'alert.created', target: body?.alert?.name || body?.alert?.id || null, detail: { id: body?.alert?.id ?? null } }
  if ((m = sub.match(/^\/alerts\/([\w-]{1,40})\/(pause|resume|delete|test|rotate|telegram)$/))) {
    if (m[2] === 'delete') return { action: 'alert.deleted', target: m[1], detail: { id: m[1] } }
    if (m[2] === 'test') return { action: 'alert.tested', target: body?.alert?.name || m[1], detail: { id: m[1] } }
    const change = m[2] === 'rotate' ? 'webhook-secret-rotated' : m[2] === 'telegram' ? (body?.alert?.telegram ? 'telegram-on' : 'telegram-off') : m[2] === 'pause' ? 'paused' : 'resumed'
    return { action: 'alert.updated', target: body?.alert?.name || m[1], detail: { id: m[1], change } }
  }
  if (sub === '/analytics/start') return { action: 'analytics.trial', target: null, detail: null }
  if (sub === '/analytics/sites') return { action: 'analytics.site_added', target: body?.site?.domain ?? null, detail: pick(body?.site, ['id', 'name']) }
  if ((m = sub.match(/^\/analytics\/sites\/([0-9a-f-]{36})\/delete$/))) return { action: 'analytics.site_removed', target: m[1], detail: { id: m[1] } }
  if (sub === '/analytics/password') return { action: 'analytics.password_reset', target: null, detail: null }
  if (sub === '/analytics/checkout') return { action: 'analytics.quote', target: body?.intent?.plan ?? null, detail: { plan: body?.intent?.plan ?? null, usd: body?.intent?.usd ?? null, asset: body?.intent?.asset?.id ?? null } }
  if (sub === '/analytics/checkout/verify') return { action: 'analytics.plan', target: body?.payment?.plan ?? null, detail: { plan: body?.payment?.plan ?? null, usd: body?.payment?.usd ?? null, txHash: body?.payment?.txHash ?? null, chain: body?.payment?.chain ?? null } }
  if (sub === '/checkout') return { action: 'billing.quote', target: body?.intent?.plan ?? null, detail: { plan: body?.intent?.plan ?? null, usd: body?.intent?.usd ?? null, asset: body?.intent?.asset?.id ?? null } }
  if (sub === '/checkout/verify') return { action: 'billing.paid', target: body?.payment?.plan ?? null, detail: { plan: body?.payment?.plan ?? null, usd: body?.payment?.usd ?? null, txHash: body?.payment?.txHash ?? null, chain: body?.payment?.chain ?? null } }
  return null
}

/* --------------------------------------------------- Telegram link state --- */

// Linking happens in the bot (a /start message), not on a dashboard route, so the link state of each
// workspace is compared on its dashboard requests and a change becomes an event.
let notices = { usage: {}, telegram: {} }
try {
  notices = { usage: {}, telegram: {}, ...JSON.parse(fs.readFileSync(NOTICES, 'utf8')) }
} catch {
  /* fresh */
}
function saveNotices() {
  try {
    fs.mkdirSync(path.dirname(NOTICES), { recursive: true })
    fs.writeFileSync(NOTICES + '.tmp', JSON.stringify(notices))
    fs.renameSync(NOTICES + '.tmp', NOTICES)
  } catch {
    /* kept in memory */
  }
}
const connectedBy = new Map() // workspace -> wallet that last opened a link code

/** Remembers who started a Telegram link (POST /telegram/connect), so the later link is credited to them. */
export const noteTelegramConnect = (ws, user) => connectedBy.set(ws, user)

/** Compares a workspace's Telegram link with the last one seen; a change becomes an event. */
export function syncTelegram(ws, actor) {
  const l = typeof telegram.linkedChat === 'function' ? telegram.linkedChat(ws) : null
  const now = l ? `${l.chatId}` : ''
  const known = notices.telegram[ws]
  if (known === now) return
  notices.telegram[ws] = now
  saveNotices()
  if (known === undefined) return
  if (now) recordEvent(ws, { actor: connectedBy.get(ws) ?? actor, action: 'telegram.linked', target: l.chatTitle ?? l.chatType ?? null, detail: { chatType: l.chatType ?? null } })
  else recordEvent(ws, { actor, action: 'telegram.unlinked', target: null, detail: null })
}

/* ------------------------------------------------------- usage thresholds --- */

const DAY_MS = 86_400_000
// The Telegram sender: telegram.mjs's sendAccountTelegram(address, text) when it exists; a test can stub it.
let sender = null
/** Test hook: replace the Telegram sender ((address, text) => Promise). Pass null to restore. */
export function setUsageNotifierForTest(fn) {
  sender = fn
}
const currentSender = () => sender ?? (typeof telegram.sendAccountTelegram === 'function' ? telegram.sendAccountTelegram : null)

/** Test hook / introspection: when each threshold last fired for a workspace. */
export const usageNoticesOf = (ws) => ({ ...(notices.usage[ws] ?? {}) })

/**
 * Checks every workspace's busiest key over the last hour against its plan limit. Returns the notices
 * fired, as [{ workspace, threshold, peak, limit, keyId, sent }].
 */
export async function checkUsageThresholds(now = Date.now()) {
  const busiest = new Map() // owner -> { key, peak }
  for (const k of developers().keys) {
    if (!k.owner || k.revokedAt) continue
    const peak = peakPerMinute(k.id, now)
    if (!peak) continue
    const cur = busiest.get(k.owner)
    if (!cur || peak > cur.peak) busiest.set(k.owner, { key: k, peak })
  }
  const fired = []
  for (const [ws, { key, peak }] of busiest) {
    if (getAccount(ws)?.blocked) continue
    const plan = planOf(ws)
    const limit = plan.perMin
    if (!limit) continue
    const threshold = peak >= limit ? 100 : peak >= 0.8 * limit ? 80 : null
    if (!threshold) continue
    const st = (notices.usage[ws] ??= {})
    const last = st[threshold] ? Date.parse(st[threshold]) : 0
    if (now - last < DAY_MS) continue
    st[threshold] = new Date(now).toISOString()
    // Passing 100% covers 80% too: no 80% notice after it on the same day.
    if (threshold === 100 && !(now - (st[80] ? Date.parse(st[80]) : 0) < DAY_MS)) st[80] = st[100]
    saveNotices()
    const keyName = key.name ?? key.project ?? key.prefix
    recordEvent(ws, { actor: 'system', action: 'usage.threshold', target: keyName, detail: { threshold, peakPerMin: peak, limitPerMin: limit, plan: plan.id, keyId: key.id }, at: now })
    let sent = false
    const send = currentSender()
    if (send && profileOf(ws).notify.telegramUsage) {
      const pct = Math.round((peak / limit) * 100)
      const text = threshold === 100
        ? `Gully Labs API: your key "${keyName}" reached its limit (${peak} requests in one minute; the ${plan.name} plan allows ${limit}). Requests over the limit get 429. Upgrade at https://app.gullylabs.xyz`
        : `Gully Labs API: your key "${keyName}" used ${pct}% of its per-minute limit (${peak} of ${limit} on the ${plan.name} plan) in the last hour.`
      try {
        const r = await send(ws, text)
        sent = r === undefined ? true : !!(r?.ok ?? r)
      } catch {
        sent = false
      }
    }
    fired.push({ workspace: ws, threshold, peak, limit, keyId: key.id, sent })
  }
  return fired
}

setInterval(() => {
  checkUsageThresholds().catch((e) => console.error('usage thresholds:', e?.message ?? e))
}, 60_000).unref?.()
