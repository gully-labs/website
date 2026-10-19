// Admin broadcasts: one message sent as a private DM to the people who started @GullyLabsBot
// (telegram-users.mjs), from the admin dashboard. Also the "New in the channel →" teaser DM that the
// channel composer can send after a post to @GullyLabsNews (telegram-channel.mjs calls createTeaser).
//
// Rules
//   - Audience: private chats in bot-users.json only, by segment (all, linked accounts, unlinked, has alerts,
//     followed the News channel, language, active in the last N days). Users who opted out of announcements or
//     who blocked the bot are never sent a broadcast, whatever the segment.
//   - Sending or scheduling needs `confirm` equal to the exact audience count at that moment (the admin's
//     confirm step); anything else is refused (409) with the count.
//   - At most one broadcast in any 24 hours unless the admin ticks Urgent (429 otherwise).
//   - Every broadcast ends with a "🔕 Stop announcements" button (callback bco, handled in telegram.mjs).
//   - URL buttons go through https://gullylabs.xyz/r/<id>.<button>.<recipient> so link opens are counted (one per
//     recipient); /r only redirects to the stored button URL of that broadcast, never to a URL from the request.
//
// Delivery: through telegram.mjs's queue (1 a second per chat, 30 a second overall, 429 retry_after), here in
// batches of at most 25 a second. Progress is saved before and after every batch, so a restart resumes where
// it stopped: a recipient whose send was in flight when the server stopped is marked failed ("interrupted") and
// never sent twice; "Re-send to failed" retries it. 403 (blocked, deactivated) and 400 "chat not found" mark
// the user blocked in bot-users.json and skip them from then on. Pause, resume and cancel act between batches.
// "Delete for everyone" calls deleteMessage on every delivered copy, within 48 hours of the send (Telegram's
// window for bots in private chats).
//
// Stored in DATA_DIR/broadcasts.json (atomic: .tmp then rename):
//   broadcasts[] { id: bc_<12 hex>, kind: manual|teaser, status: scheduled|sending|paused|sent|cancelled|deleting|deleted,
//                  text, media, buttons, segment, urgent, audience, scheduledAt, createdAt, startedAt, finishedAt,
//                  recipients: [{ c: chatId, s: pending|inflight|sent|failed|blocked|skipped|cancelled, m, e, at, d }],
//                  opened: [recipient index], clicks, optOuts, channelPost: { id, url } | null, error, history[] }
//
// Routes (admin-token gated by admin.mjs, which forwards /api/admin/broadcasts*):
//   GET  /api/admin/broadcasts                    stats, growth, broadcasts (newest first, no recipient list), test targets
//   POST /api/admin/broadcasts/audience           { segment } -> { count, total, optedOut, blocked }
//   POST /api/admin/broadcasts/validate           { text, media, buttons } -> sanitized text, length, errors
//   POST /api/admin/broadcasts/test               { text, media, buttons, chatId? } -> TELEGRAM_ADMIN_CHAT_ID or a linked chat
//   POST /api/admin/broadcasts                    { text, media, buttons, segment, urgent, action: send|schedule, scheduledAt?, confirm }
//   GET  /api/admin/broadcasts/:id                one broadcast with its per-recipient status (chat ids masked)
//   POST /api/admin/broadcasts/:id/pause|resume|cancel|resend|delete
// Public: GET /r/<12 hex>.<n>.<base36> (handleBroadcastRedirect, from server.mjs).

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, json, readJson } from './http.mjs'
import { adminChatId, channelBanner, linkedChat, linkedChatById, onAnnouncementOptOut, sendToChannel, telegramEnabled } from './telegram.mjs'
import { messageUrl, newsChannel, sendContent, validatePost, visibleLength } from './telegram-channel.mjs'
import { allBotUsers, botUser, botUserStats, markBlocked } from './telegram-users.mjs'
import { alertCountOf } from './alerts.mjs'
import { developers } from './store.mjs'
import { announceOffBtn, esc, SITE } from './telegram-ui.mjs'

const FILE = () => path.join(DATA_DIR, 'broadcasts.json')
export const RATE_PER_S = 25
// The pause after a batch has FINISHED (every response in), not after it started: under load a batch's requests can
// reach Telegram well after it began, and a pause counted from the start let the next batch land inside the same
// second (27-30 sends in a second on the wire). Counted from the end, no second can hold two batches.
const BATCH_MS = 1_050
const DAY_MS = 24 * 3_600_000
const DELETE_WINDOW_MS = 48 * 3_600_000
const MISSED_MS = 6 * 3_600_000
const TICK_MS = 5_000
const KEEP = 200
const KEEP_HISTORY = 40
const SEGMENTS = ['all', 'linked', 'unlinked', 'alerts', 'follows', 'language', 'active']

/* ---------------------------------------------------------------- clock --- */

let nowFn = () => Date.now()
const now = () => nowFn()
const iso = (t = now()) => new Date(t).toISOString()
/** Tests: replace the clock (24 h limit, 48 h delete window, schedules). null restores it. */
export function setBroadcastNowForTest(fn) {
  nowFn = fn ?? (() => Date.now())
}

/* ---------------------------------------------------------------- store --- */

let db
function load() {
  try {
    db = JSON.parse(fs.readFileSync(FILE(), 'utf8'))
  } catch {
    db = {}
  }
  if (!Array.isArray(db.broadcasts)) db.broadcasts = []
  // A send in flight when the server stopped may or may not have arrived: never send it twice.
  for (const b of db.broadcasts) {
    for (const r of b.recipients ?? []) {
      if (r.s === 'inflight') Object.assign(r, { s: 'failed', e: 'Interrupted by a restart; not sent again so nobody gets it twice. Use Re-send to failed.', at: iso() })
    }
    if (b.status === 'deleting') b.status = 'sent' // the delete pass did not finish: it can be started again
  }
}
load()

let saveTimer = null
function save() {
  clearTimeout(saveTimer)
  saveTimer = null
  if (db.broadcasts.length > KEEP) db.broadcasts = db.broadcasts.slice(-KEEP)
  try {
    fs.mkdirSync(path.dirname(FILE()), { recursive: true })
    fs.writeFileSync(FILE() + '.tmp', JSON.stringify(db))
    fs.renameSync(FILE() + '.tmp', FILE())
  } catch (e) {
    console.error('broadcasts save:', e?.message ?? e)
  }
}
const saveSoon = () => {
  if (saveTimer) return
  saveTimer = setTimeout(save, 2_000)
  saveTimer.unref?.()
}

const byId = (id) => db.broadcasts.find((b) => b.id === id) ?? null
function logTo(b, action, detail = null, by = 'admin') {
  b.history = [...(b.history ?? []), { at: iso(), action, by, ...(detail ? { detail: String(detail).slice(0, 200) } : {}) }].slice(-KEEP_HISTORY)
}

/** Tests: read the store from disk again, as a restarted server would (in-flight sends become failed). */
export function reloadBroadcastsForTest() {
  if (saveTimer) save()
  running.clear()
  load()
}

/* ------------------------------------------------------------- audience --- */

/** A segment from the request: { kind, language?, days? } with its errors. */
export function validSegment(raw) {
  const kind = SEGMENTS.includes(raw?.kind) ? raw.kind : null
  if (!kind) return { segment: null, errors: ['Pick who gets it.'] }
  if (kind === 'language') {
    const l = String(raw.language ?? '').toLowerCase()
    return /^[a-z]{2}$/.test(l) ? { segment: { kind, language: l }, errors: [] } : { segment: null, errors: ['Pick a language.'] }
  }
  if (kind === 'active') {
    const d = Number(raw.days)
    return Number.isInteger(d) && d >= 1 && d <= 365 ? { segment: { kind, days: d }, errors: [] } : { segment: null, errors: ['Active days must be 1 to 365.'] }
  }
  return { segment: { kind }, errors: [] }
}

function matches(id, u, seg) {
  if (seg.kind === 'all') return true
  const link = linkedChatById(id)
  if (seg.kind === 'linked') return !!link
  if (seg.kind === 'unlinked') return !link
  if (seg.kind === 'alerts') return !!link && alertCountOf(link.address) > 0
  if (seg.kind === 'follows') return u.follows === true
  if (seg.kind === 'language') return u.lang === seg.language
  if (seg.kind === 'active') return Date.parse(u.lastSeen) >= now() - seg.days * 86_400_000
  return false
}

/** Who a segment reaches now: ids (opted-out and blocked users removed) and the counts. */
export function audienceOf(seg) {
  const ids = []
  let total = 0
  let optedOut = 0
  let blocked = 0
  for (const [id, u] of allBotUsers()) {
    if (!/^\d{1,20}$/.test(id)) continue
    total++
    if (!matches(id, u, seg)) continue
    if (u.optedOut) optedOut++
    else if (u.blocked) blocked++
    else ids.push(id)
  }
  return { ids, count: ids.length, total, optedOut, blocked }
}

/* ---------------------------------------------------------------- limits --- */

const sentCount = (b) => (b.recipients ?? []).filter((r) => r.s === 'sent').length
/** When a broadcast counts for the once-a-day rule: its start (if anything went or is going), or its schedule. */
function countsAt(b) {
  if (b.status === 'scheduled') return Date.parse(b.scheduledAt)
  if (!b.startedAt) return null
  if (b.status === 'cancelled' && !sentCount(b)) return null
  return Date.parse(b.startedAt)
}
/** null when a broadcast may go out at `t`; else { status: 429, error, nextAt }. */
function dailyLimit(t, urgent, exceptId = null) {
  if (urgent) return null
  let near = null
  for (const b of db.broadcasts) {
    if (b.id === exceptId) continue
    const at = countsAt(b)
    if (at !== null && Number.isFinite(at) && Math.abs(t - at) < DAY_MS && (near === null || at > near)) near = at
  }
  if (near === null) return null
  const hours = Math.max(1, Math.round(Math.abs(t - near) / 3_600_000))
  return { status: 429, error: `One broadcast a day: another one ${near <= t ? `went out ${hours} h before` : `is scheduled ${hours} h after`} this time. Tick Urgent to send anyway.`, nextAt: iso(near + DAY_MS) }
}

/* ------------------------------------------------------------- messages --- */

const shortId = (b) => b.id.slice(3)
/** The tracked link for button `n` of a broadcast, for recipient `idx`. */
export const trackUrl = (b, n, idx) => `${SITE}/r/${shortId(b)}.${n}.${idx.toString(36)}`
/** The keyboard a recipient gets: the URL buttons (tracked, or the plain URLs for a test), then 🔕 Stop announcements. */
function keyboardOf(b, idx = null) {
  return [...(b.buttons ?? []).map((x, n) => [{ text: x.text, url: idx === null ? x.url : trackUrl(b, n, idx) }]), [announceOffBtn]]
}

/* ---------------------------------------------------------------- worker --- */

const running = new Map() // id -> promise of its send loop
let haltAfter = null // tests: stop the loop (status unchanged, as a crash would) after this many sends
/** Tests: simulate the server stopping after `n` more sends (null: never). */
export function haltBroadcastsAfterForTest(n) {
  haltAfter = n
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PERMANENT = /bot was blocked|user is deactivated|chat not found|bot can't initiate|PEER_ID_INVALID/i

async function sendOne(b, r, idx) {
  const u = botUser(r.c)
  if (!u || u.optedOut || u.blocked) return Object.assign(r, { s: 'skipped', e: !u ? 'not a bot user any more' : u.optedOut ? 'opted out' : 'blocked the bot', at: iso() })
  const res = await sendContent(r.c, b, keyboardOf(b, idx))
  if (res.ok) return Object.assign(r, { s: 'sent', m: res.messageId, e: null, at: iso() })
  if (res.status === 403 || (res.status === 400 && PERMANENT.test(res.error ?? '')) || PERMANENT.test(res.error ?? '')) {
    markBlocked(r.c, res.error)
    return Object.assign(r, { s: 'blocked', e: res.error, at: iso() })
  }
  return Object.assign(r, { s: 'failed', e: res.error ?? 'failed', at: iso() })
}

async function runLoop(b) {
  while (b.status === 'sending') {
    const pending = []
    b.recipients.forEach((r, i) => r.s === 'pending' && pending.push(i))
    if (!pending.length) {
      b.status = 'sent'
      b.finishedAt = iso()
      logTo(b, 'finished', `${sentCount(b)} delivered`, 'sender')
      save()
      return
    }
    if (haltAfter !== null && haltAfter <= 0) return // tests: the "server" stopped here
    // The first send of a new banner uploads it; the rest reuse Telegram's file_id.
    let size = b.media?.banner && !channelBanner().fileId ? 1 : RATE_PER_S
    if (haltAfter !== null) size = Math.min(size, haltAfter)
    const batch = pending.slice(0, size)
    for (const i of batch) b.recipients[i].s = 'inflight'
    save()
    await Promise.all(batch.map((i) => sendOne(b, b.recipients[i], i).catch((e) => Object.assign(b.recipients[i], { s: 'failed', e: String(e?.message ?? e).slice(0, 120), at: iso() }))))
    if (haltAfter !== null) haltAfter -= batch.length
    save()
    // A batch a second, with a small margin so network jitter never puts two batches in one second.
    if (b.recipients.some((r) => r.s === 'pending')) await sleep(BATCH_MS)
  }
}

function ensureWorker(b) {
  if (!running.has(b.id)) {
    const p = runLoop(b)
      .catch((e) => console.error('broadcast:', e?.message ?? e))
      .finally(() => running.delete(b.id))
    running.set(b.id, p)
  }
  return running.get(b.id)
}

function start(b, by = 'admin') {
  const aud = audienceOf(b.segment)
  b.recipients = aud.ids.map((c) => ({ c, s: 'pending' }))
  b.status = 'sending'
  b.startedAt = iso()
  logTo(b, 'start', `${aud.count} recipients`, by)
  save()
  ensureWorker(b)
}

/* --------------------------------------------------------------- delete --- */

async function deleteForEveryone(b) {
  const list = b.recipients.filter((r) => r.s === 'sent' && r.m && !r.d)
  let ok = 0
  let failed = 0
  for (let i = 0; i < list.length; i += RATE_PER_S) {
    await Promise.all(
      list.slice(i, i + RATE_PER_S).map(async (r) => {
        const res = await sendToChannel(r.c, 'deleteMessage', { message_id: r.m })
        if (res.ok || /message to delete not found/i.test(res.error ?? '')) ((r.d = true), ok++)
        else ((r.e = `delete: ${res.error}`), failed++)
      }),
    )
    save()
    if (i + RATE_PER_S < list.length) await sleep(BATCH_MS)
  }
  b.status = 'deleted'
  b.deletedAt = iso()
  logTo(b, 'delete', `${ok} deleted${failed ? `, ${failed} failed` : ''}`)
  save()
}

/* ------------------------------------------------------------ scheduler --- */

/** One pass: starts due scheduled broadcasts, resumes any left sending (after a restart). Resolves when every running send loop ends. */
export async function tickBroadcasts() {
  const t = now()
  for (const b of db.broadcasts) {
    if (b.status === 'scheduled' && Date.parse(b.scheduledAt) <= t) {
      if (t - Date.parse(b.scheduledAt) > MISSED_MS) {
        b.status = 'cancelled'
        b.error = `Missed its time by more than 6 hours (the server was probably down), so it was not sent late.`
        logTo(b, 'missed', null, 'scheduler')
        save()
      } else if (telegramEnabled()) start(b, 'scheduler')
    } else if (b.status === 'sending') ensureWorker(b)
  }
  await Promise.all([...running.values()])
}

let timer = null
let first = null
/** Starts the 5 s scheduler (from server.mjs startLoops). Idempotent. */
export function startBroadcasts() {
  if (timer) return
  const safe = () => tickBroadcasts().catch((e) => console.error('broadcasts:', e?.message ?? e))
  timer = setInterval(() => void safe(), TICK_MS)
  timer.unref?.()
  first = setTimeout(() => void safe(), 2_000)
  first.unref?.()
}
export function stopBroadcasts() {
  clearInterval(timer)
  clearTimeout(first)
  timer = first = null
}

/* ----------------------------------------------------------- link opens --- */

/** GET /r/<12 hex>.<n>.<base36>: counts one open per recipient and redirects to that broadcast's stored button URL. */
export function handleBroadcastRedirect(req, res, url) {
  const m = url.pathname.match(/^\/r\/([0-9a-f]{12})\.(\d)\.([0-9a-z]{1,7})$/)
  const b = m ? byId(`bc_${m[1]}`) : null
  const target = b?.buttons?.[Number(m?.[2])]?.url
  if (!b || !target || !/^https:\/\//.test(target)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' })
    res.end('This link is not valid any more.')
    return true
  }
  const idx = parseInt(m[3], 36)
  b.clicks = (b.clicks ?? 0) + 1
  if (Number.isInteger(idx) && idx < (b.recipients?.length ?? 0)) {
    b.opened ??= []
    if (!b.opened.includes(idx)) b.opened.push(idx)
  }
  saveSoon()
  res.writeHead(302, { Location: target, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' })
  res.end()
  return true
}

// 🔕 Stop announcements taps, counted on the broadcast whose message carried the button.
onAnnouncementOptOut((chatId, messageId) => {
  if (!messageId) return
  for (let i = db.broadcasts.length - 1; i >= 0; i--) {
    const b = db.broadcasts[i]
    if ((b.recipients ?? []).some((r) => r.c === String(chatId) && r.m === messageId)) {
      b.optOuts = (b.optOuts ?? 0) + 1
      saveSoon()
      return
    }
  }
})

/* ---------------------------------------------------------- the teaser --- */

/** Before a channel post with "and DM users": the same confirm and daily rules as a broadcast to everyone. */
export function teaserPrecheck({ confirm, urgent, at = now() }) {
  if (!telegramEnabled()) return { ok: false, status: 503, error: 'Telegram is not configured on the server (TELEGRAM_BOT_TOKEN).' }
  const aud = audienceOf({ kind: 'all' })
  if (!aud.count) return { ok: false, status: 400, error: 'Nobody can be sent a DM yet: no one who started the bot has announcements on.', count: 0 }
  if (Number(confirm) !== aud.count) return { ok: false, status: 409, error: `Confirm the DM to ${aud.count} people.`, count: aud.count, confirmRequired: true }
  const lim = dailyLimit(at, !!urgent)
  if (lim) return { ok: false, ...lim, count: aud.count }
  return { ok: true, count: aud.count }
}

/** After the channel post went out: a short "New in the channel →" DM linking to it, sent to everyone who has announcements on. */
export function createTeaser(post) {
  const plain = String(post.text ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  const excerpt = plain.length > 180 ? plain.slice(0, 179).replace(/\s+\S*$/, '') + '…' : plain
  const link = messageUrl(post.messageId) ?? (newsChannel().startsWith('@') ? `https://t.me/${newsChannel().slice(1)}` : 'https://t.me/GullyLabsNews')
  const b = newBroadcast({ text: `<b>📣 New in the channel →</b>${excerpt ? `\n${esc(excerpt)}` : ''}`, media: null, buttons: [{ text: 'Read it in Gully Labs News', url: link }] }, { kind: 'teaser', segment: { kind: 'all' }, urgent: !!post.dm?.urgent })
  b.channelPost = { id: post.id, url: link }
  start(b, 'channel')
  return b
}

/* ---------------------------------------------------------------- routes --- */

function newBroadcast(v, { kind = 'manual', segment, urgent = false, status = 'sending', scheduledAt = null, audience = null }) {
  const b = { id: `bc_${crypto.randomBytes(6).toString('hex')}`, kind, status, text: v.text, media: v.media, buttons: v.buttons, segment, urgent: !!urgent, audience, scheduledAt, createdAt: iso(), startedAt: null, finishedAt: null, recipients: [], opened: [], clicks: 0, optOuts: 0, channelPost: null, error: null, history: [] }
  logTo(b, status === 'scheduled' ? 'schedule' : 'create', urgent ? 'urgent' : null)
  db.broadcasts.push(b)
  save()
  return b
}

function counts(b) {
  const c = { total: b.recipients.length, pending: 0, sent: 0, failed: 0, blocked: 0, skipped: 0, cancelled: 0, deleted: 0 }
  for (const r of b.recipients) {
    if (r.s === 'inflight' || r.s === 'pending') c.pending++
    else if (c[r.s] !== undefined) c[r.s]++
    if (r.d) c.deleted++
  }
  return c
}
function summary(b) {
  const started = b.startedAt ? Date.parse(b.startedAt) : null
  const c = counts(b)
  return {
    id: b.id,
    kind: b.kind,
    status: b.status,
    text: b.text,
    media: b.media,
    buttons: b.buttons,
    segment: b.segment,
    urgent: b.urgent,
    audience: b.audience,
    scheduledAt: b.scheduledAt,
    createdAt: b.createdAt,
    startedAt: b.startedAt,
    finishedAt: b.finishedAt ?? null,
    deletedAt: b.deletedAt ?? null,
    error: b.error,
    channelPost: b.channelPost,
    counts: c,
    opened: (b.opened ?? []).length,
    clicks: b.clicks ?? 0,
    optOuts: b.optOuts ?? 0,
    length: visibleLength(b.text),
    canDelete: c.sent > c.deleted && started !== null && now() - started < DELETE_WINDOW_MS && !['deleting', 'deleted'].includes(b.status),
    deleteUntil: started ? iso(started + DELETE_WINDOW_MS) : null,
  }
}
const mask = (id) => `••••${String(id).slice(-4)}`

/** The chats an admin may test-send to: the operators' chat (TELEGRAM_ADMIN_CHAT_ID) and every linked chat. */
function testTargets() {
  const out = []
  const a = adminChatId()
  if (a) out.push({ chatId: 'admin', label: 'Operators’ chat (TELEGRAM_ADMIN_CHAT_ID)' })
  for (const acc of developers().accounts ?? []) {
    const l = linkedChat(acc.address)
    if (l) out.push({ chatId: l.chatId, label: `${l.chatTitle || l.chatType} · ${acc.address.slice(0, 6)}…${acc.address.slice(-4)}` })
  }
  return out
}

function overview() {
  const list = [...db.broadcasts].reverse()
  const last = list.find((b) => b.startedAt) ?? null
  const lim = dailyLimit(now(), false)
  return {
    enabled: telegramEnabled(),
    adminChat: !!adminChatId(),
    rate: RATE_PER_S,
    stats: botUserStats(),
    last: last ? summary(last) : null,
    nextAllowedAt: lim ? lim.nextAt : null,
    broadcasts: list.map(summary),
    testTargets: testTargets(),
  }
}

export async function handleBroadcastAdmin(req, res, url) {
  const p = url.pathname
  const method = req.method
  const body = method === 'POST' ? ((await readJson(req, 40_000)) ?? {}) : null
  const send = (status, j) => (json(res, status, j), true)

  if (p === '/api/admin/broadcasts') {
    if (method === 'GET') return send(200, overview())
    if (method !== 'POST') return send(405, { error: 'GET or POST only' })
    const v = validatePost(body)
    const sg = validSegment(body.segment)
    const errors = [...v.errors, ...sg.errors]
    if (errors.length) return send(400, { error: errors.join(' '), errors })
    if (!telegramEnabled()) return send(503, { error: 'Telegram is not configured on the server (TELEGRAM_BOT_TOKEN).' })
    const action = body.action === 'schedule' ? 'schedule' : body.action === 'send' ? 'send' : null
    if (!action) return send(400, { error: 'Choose Send now or Schedule.' })
    let t = now()
    if (action === 'schedule') {
      t = Date.parse(String(body.scheduledAt ?? ''))
      if (!Number.isFinite(t) || t < now() - 60_000) return send(400, { error: 'Pick a time in the future to schedule it.' })
      if (t > now() + 90 * 86_400_000) return send(400, { error: 'A broadcast can be scheduled at most 90 days ahead.' })
    }
    const aud = audienceOf(sg.segment)
    if (!aud.count) return send(400, { error: 'Nobody in this audience can be sent a DM (no one, or everyone opted out or blocked the bot).', count: 0 })
    if (body.confirm === undefined || Number(body.confirm) !== aud.count) return send(409, { error: `Confirm the exact audience first: ${aud.count} people.`, count: aud.count, confirmRequired: true })
    const lim = dailyLimit(t, !!body.urgent)
    if (lim) return send(lim.status, { error: lim.error, nextAt: lim.nextAt })
    const b = newBroadcast(v, { segment: sg.segment, urgent: !!body.urgent, status: action === 'schedule' ? 'scheduled' : 'sending', scheduledAt: action === 'schedule' ? iso(t) : null, audience: aud.count })
    if (action === 'send') start(b)
    return send(201, { broadcast: summary(b) })
  }
  if (p === '/api/admin/broadcasts/audience') {
    if (method !== 'POST') return send(405, { error: 'POST only' })
    const sg = validSegment(body.segment)
    if (sg.errors.length) return send(400, { error: sg.errors.join(' ') })
    const a = audienceOf(sg.segment)
    return send(200, { count: a.count, total: a.total, optedOut: a.optedOut, blocked: a.blocked })
  }
  if (p === '/api/admin/broadcasts/validate') {
    if (method !== 'POST') return send(405, { error: 'POST only' })
    const v = validatePost(body)
    return send(200, { text: v.text, length: v.length, limit: v.limit, errors: v.errors })
  }
  if (p === '/api/admin/broadcasts/test') {
    if (method !== 'POST') return send(405, { error: 'POST only' })
    const v = validatePost(body)
    if (v.errors.length) return send(400, { error: v.errors.join(' '), errors: v.errors })
    if (!telegramEnabled()) return send(503, { error: 'Telegram is not configured on the server (TELEGRAM_BOT_TOKEN).' })
    const asked = body.chatId == null || body.chatId === '' || body.chatId === 'admin' ? null : String(body.chatId)
    let chatId = null
    if (asked) {
      const l = linkedChatById(asked)
      if (!l) return send(400, { error: 'That chat is not linked to any account. Pick the operators’ chat or a linked chat.' })
      chatId = l.chatId
    } else chatId = adminChatId()
    if (!chatId) return send(400, { error: 'Set TELEGRAM_ADMIN_CHAT_ID on the server, or pick a linked chat for the test.' })
    const r = await sendContent(chatId, v, keyboardOf(v))
    return r.ok ? send(200, { ok: true }) : send(502, { error: `Telegram refused the test: ${r.error}` })
  }
  const m = p.match(/^\/api\/admin\/broadcasts\/(bc_[0-9a-f]{12})(?:\/(pause|resume|cancel|resend|delete))?$/)
  if (!m) return send(404, { error: 'not found' })
  const b = byId(m[1])
  if (!b) return send(404, { error: 'No such broadcast.' })
  const action = m[2]
  if (!action) {
    if (method !== 'GET') return send(405, { error: 'GET only' })
    return send(200, { broadcast: summary(b), recipients: b.recipients.slice(0, 2_000).map((r, i) => ({ n: i + 1, chat: mask(r.c), status: r.s === 'inflight' ? 'pending' : r.s, error: r.e ?? null, at: r.at ?? null, deleted: !!r.d, opened: (b.opened ?? []).includes(i) })), more: Math.max(0, b.recipients.length - 2_000) })
  }
  if (method !== 'POST') return send(405, { error: 'POST only' })
  if (action === 'pause') {
    if (b.status !== 'sending') return send(409, { error: 'Only a broadcast that is sending can be paused.' })
    b.status = 'paused'
    logTo(b, 'pause')
    save()
    return send(200, { broadcast: summary(b) })
  }
  if (action === 'resume') {
    if (b.status !== 'paused') return send(409, { error: 'Only a paused broadcast can be resumed.' })
    if (!telegramEnabled()) return send(503, { error: 'Telegram is not configured on the server (TELEGRAM_BOT_TOKEN).' })
    b.status = 'sending'
    logTo(b, 'resume')
    save()
    ensureWorker(b)
    return send(200, { broadcast: summary(b) })
  }
  if (action === 'cancel') {
    if (!['sending', 'paused', 'scheduled'].includes(b.status)) return send(409, { error: 'Only a scheduled, sending or paused broadcast can be cancelled.' })
    b.status = 'cancelled'
    for (const r of b.recipients) if (r.s === 'pending') r.s = 'cancelled'
    b.finishedAt = iso()
    logTo(b, 'cancel')
    save()
    return send(200, { broadcast: summary(b) })
  }
  if (action === 'resend') {
    const failed = b.recipients.filter((r) => r.s === 'failed')
    if (!failed.length) return send(409, { error: 'Nothing failed: there is nobody to re-send to.' })
    if (!['sent', 'cancelled', 'paused'].includes(b.status)) return send(409, { error: 'Wait until this broadcast has finished sending.' })
    if (!telegramEnabled()) return send(503, { error: 'Telegram is not configured on the server (TELEGRAM_BOT_TOKEN).' })
    for (const r of failed) Object.assign(r, { s: 'pending', e: null })
    b.status = 'sending'
    logTo(b, 'resend', `${failed.length} failed`)
    save()
    ensureWorker(b)
    return send(200, { broadcast: summary(b), resent: failed.length })
  }
  // delete for everyone
  const s = summary(b)
  if (b.status === 'deleting' || b.status === 'deleted') return send(409, { error: 'Already deleted.' })
  if (!s.counts.sent) return send(409, { error: 'Nothing was delivered, so there is nothing to delete.' })
  if (!s.canDelete) return send(409, { error: 'Telegram only lets the bot delete its messages within 48 hours of sending.' })
  if (b.status === 'sending' || b.status === 'paused') {
    for (const r of b.recipients) if (r.s === 'pending') r.s = 'cancelled'
  }
  b.status = 'deleting'
  logTo(b, 'deleting')
  save()
  const job = deleteForEveryone(b).catch((e) => console.error('broadcast delete:', e?.message ?? e))
  running.set(`${b.id}:delete`, job.finally(() => running.delete(`${b.id}:delete`)))
  return send(202, { broadcast: summary(b) })
}
