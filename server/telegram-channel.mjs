// Posts to the Gully Labs News channel (@GullyLabsNews) from the admin dashboard, plus optional automatic posts.
// The bot (TELEGRAM_BOT_TOKEN) is an administrator of the channel; every call goes through telegram.mjs's
// rate-limited queue (sendToChannel), so the channel shares the bot's 1/s-per-chat and 30/s limits.
//
// Env
//   TELEGRAM_NEWS_CHANNEL  where posts go (default @GullyLabsNews; a numeric -100… id also works)
//   GHOST_CONTENT_KEY      the blog's Content API key: the "new blog post" auto post is off without it
//   GHOST_URL              tests only: the blog's base URL (default https://blog.gullylabs.xyz)
//
// Stored in DATA_DIR/channel-posts.json (written atomically: .tmp then rename):
//   posts[]    { id, status: draft|scheduled|sent|failed|deleted, text (Telegram HTML, sanitized), media:
//                null | { kind: 'photo'|'animation', url } | { kind: 'animation', banner: true } | { kind, fileId },
//                buttons: [{ text, url }] (≤ 3, https), pin, scheduledAt, sentAt, messageId, chat, error,
//                createdBy ('admin' | 'auto:<type>'), autoKey, createdAt, updatedAt, history: [{ at, action, ok, error?, by }] }
//   settings   { testChat: chatId of a linked chat | null, auto: { timezone, quietHours, minGapMinutes, <type>: {...} } }
//   state      { seen: { blog: [], releases: [], launches: [] }, baselined: { blog, releases }, pending: [], lastDaily, lastWeekly }
//   followers  [{ day: 'YYYY-MM-DD', count, at }]  one sample a UTC day (getChatMemberCount), 400 kept
//
// Routes (admin-token gated by admin.mjs, which forwards /api/admin/channel*):
//   GET  /api/admin/channel                     posts (newest first), settings, linked chats for the test, limits
//   POST /api/admin/channel/validate            { text, media, buttons } -> { text (sanitized), length, limit, errors }
//   POST /api/admin/channel/test                { text, media, buttons, chatId? } -> sends to the admin's linked chat
//   POST /api/admin/channel/posts               { text, media, buttons, pin, action: draft|post|schedule, scheduledAt? } -> 201 { post }
//   POST /api/admin/channel/posts/:id           update: a draft/scheduled/failed post is rewritten; a sent post is edited live
//   POST /api/admin/channel/posts/:id/post|retry|delete|unschedule
//   GET  /api/admin/channel/followers           { count (live), at, series: [{ day, count }] }
//   POST /api/admin/channel/auto                partial auto-post settings -> { auto }
//   POST /api/admin/channel/auto/:type/preview  the next auto post of that type, rendered, never sent
//
// Scheduler (startChannel, from server.mjs startLoops: never in deploy standby): every 30 s it posts the
// scheduled posts that are due (a post more than 6 h overdue, e.g. after a long outage, is marked failed
// with "missed" instead of going out late; Retry posts it), runs the due auto posts, and samples the follower
// count once a UTC day. The blog is polled every 10 minutes, the changelog index is re-read every 10 minutes,
// DeepCore launches arrive through deepcore.mjs's onLaunches.
//
// Automatic posts are all OFF by default. Rules: an event type (DeepCore launch, blog post, release) queues
// one item per new thing (deduplicated by key, remembered across restarts); the first check after a type
// is switched on only records what already exists (no backlog). Every auto post waits for quiet hours to
// end and for the minimum gap since the channel's last post (manual or auto), then goes out through the
// same sanitizer, limits and history as a manual post. Queued launch items older than 6 h are dropped.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_DIR, json, readJson } from './http.mjs'
import { channelBanner, linkedChat, linkedChatById, sendToChannel, telegramEnabled } from './telegram.mjs'
import { readHistoryDays, readTracker } from './tracker.mjs'
import { onLaunches, readLaunches } from './deepcore.mjs'
import { chainName, esc, signed, SITE, trustedNow } from './telegram-ui.mjs'
import { developers } from './store.mjs'

const FILE = path.join(DATA_DIR, 'channel-posts.json')
const HERE = path.dirname(fileURLToPath(import.meta.url))
export const MAX_TEXT = 4096
export const MAX_CAPTION = 1024
export const MAX_BUTTONS = 3
const TICK_MS = 30_000
const BLOG_POLL_MS = 10 * 60_000
const CHANGELOG_POLL_MS = 10 * 60_000
const MISSED_MS = 6 * 3_600_000
const PENDING_TTL_MS = 6 * 3_600_000
const KEEP_POSTS = 1_000
const KEEP_SEEN = 2_000
const KEEP_HISTORY = 30

export const newsChannel = () => {
  const c = String(process.env.TELEGRAM_NEWS_CHANNEL ?? '').trim()
  return /^@[A-Za-z][\w]{3,31}$/.test(c) || /^-100\d{5,15}$/.test(c) ? c : '@GullyLabsNews'
}
/** t.me link of a channel message (public channels only). */
export const messageUrl = (messageId) => {
  const c = newsChannel()
  return c.startsWith('@') && messageId ? `https://t.me/${c.slice(1)}/${messageId}` : null
}

/* ---------------------------------------------------------------- clock --- */

let nowFn = () => Date.now()
const now = () => nowFn()
const iso = (t = now()) => new Date(t).toISOString()
/** Tests: replace the clock (quiet hours, daily/weekly times, min gap). null restores it. */
export function setNowForTest(fn) {
  nowFn = fn ?? (() => Date.now())
}

/* ---------------------------------------------------------------- store --- */

const AUTO_TYPES = ['launches', 'dailyGaps', 'weeklyMovers', 'blog', 'releases']
const DEFAULT_TEMPLATES = {
  launches: '🚀 <b>New on DeepCore: {symbol}</b>\n{chain} · {pools}\n\n<a href="{link}">See it on DeepCore</a>',
  dailyGaps: '📊 <b>Widest trusted gaps · {date}</b>\n\n{list}\n\nGap = on-chain price against the Chainlink fair price. Information only, not advice.\n<a href="{link}">Live tracker</a>',
  weeklyMovers: '📈 <b>The week in tokenised stocks · {date}</b>\n\n{list}\n\nOn-chain price change over 7 days. Information only, not advice.\n<a href="{link}">Live tracker</a>',
  blog: '📝 <b>{title}</b>\n\n{excerpt}\n\n<a href="{link}">Read on the blog</a>',
  releases: '🆕 <b>What’s new · {date}</b>\n\n{summary}\n\n<a href="{link}">Full changelog</a>',
}
const DEFAULT_BUTTONS = { launches: 'View on DeepCore', dailyGaps: 'Open the tracker', weeklyMovers: 'Open the tracker', blog: 'Read the post', releases: 'Read the changelog' }
const defaultAuto = () => ({
  timezone: 'UTC',
  quietHours: { enabled: false, start: '23:00', end: '07:00' },
  minGapMinutes: 60,
  launches: { enabled: false, template: DEFAULT_TEMPLATES.launches },
  dailyGaps: { enabled: false, template: DEFAULT_TEMPLATES.dailyGaps, time: '14:00' },
  weeklyMovers: { enabled: false, template: DEFAULT_TEMPLATES.weeklyMovers, day: 5, time: '21:00' },
  blog: { enabled: false, template: DEFAULT_TEMPLATES.blog },
  releases: { enabled: false, template: DEFAULT_TEMPLATES.releases },
})

let db
function load() {
  try {
    db = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch {
    db = {}
  }
  db.posts ??= []
  db.settings ??= {}
  db.settings.testChat ??= null
  const auto = defaultAuto()
  db.settings.auto = { ...auto, ...(db.settings.auto ?? {}) }
  for (const t of AUTO_TYPES) db.settings.auto[t] = { ...auto[t], ...(db.settings.auto[t] ?? {}) }
  db.settings.auto.quietHours = { ...auto.quietHours, ...(db.settings.auto.quietHours ?? {}) }
  db.state ??= {}
  db.state.seen ??= {}
  for (const t of ['blog', 'releases', 'launches']) db.state.seen[t] ??= []
  db.state.baselined ??= {}
  db.state.pending ??= [] // { type, key, at, data }
  db.state.lastDaily ??= null
  db.state.lastWeekly ??= null
  db.followers ??= []
}
load()

function save() {
  if (db.posts.length > KEEP_POSTS) db.posts = db.posts.slice(-KEEP_POSTS)
  for (const t of Object.keys(db.state.seen)) db.state.seen[t] = db.state.seen[t].slice(-KEEP_SEEN)
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(db))
    fs.renameSync(FILE + '.tmp', FILE)
  } catch (e) {
    console.error('channel save:', e?.message ?? e)
  }
}

/** Tests: read the store from disk again, as a restarted server would. */
export function reloadChannelForTest() {
  load()
}

/* ------------------------------------------------------------ sanitizer --- */

const ALLOWED = new Set(['b', 'i', 'u', 's', 'a', 'code', 'pre', 'blockquote', 'tg-spoiler'])
const ALIAS = { strong: 'b', em: 'i', ins: 'u', strike: 's', del: 's' }
const ENTITY = /^&(?:lt|gt|amp|quot|#\d{1,7}|#x[0-9a-f]{1,6});/i

/** An http(s) or tg:// link fit for Telegram's <a href>, or null. */
function safeHref(raw) {
  const v = decodeEntities(String(raw ?? '').trim())
  if (/^tg:\/\/[\w?=&./-]+$/i.test(v)) return v
  try {
    const u = new URL(v)
    if ((u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password && v.length <= 2_048) return u.href
  } catch {
    /* not a URL */
  }
  return null
}
const escAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
    .replace(/&amp;/gi, '&')
}
const safeChar = (n) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '')

/**
 * Telegram HTML, sanitized: only b, i, u, s, a href (http/https/tg), code, pre, blockquote, tg-spoiler
 * (strong/em/ins/strike/del become their Telegram twins, <br> a line break); every other tag is dropped
 * with its text kept; attributes other than href are dropped; stray "<", ">" and "&" are escaped; tags are
 * balanced (unclosed ones closed at the end, stray closers dropped); nothing nests inside code or pre.
 */
export function sanitizeTelegramHtml(input) {
  const src = String(input ?? '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '')
  let out = ''
  const stack = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '&') {
      const m = src.slice(i, i + 12).match(ENTITY)
      if (m) {
        out += m[0]
        i += m[0].length
      } else {
        out += '&amp;'
        i++
      }
      continue
    }
    if (ch === '>') {
      out += '&gt;'
      i++
      continue
    }
    if (ch !== '<') {
      out += ch
      i++
      continue
    }
    const m = src.slice(i).match(/^<\s*(\/?)\s*([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)\s*(\/?)>/)
    if (!m) {
      // A comment or a broken tag: drop comments, escape the rest.
      const c = src.slice(i).match(/^<!--[\s\S]*?-->/)
      if (c) i += c[0].length
      else {
        out += '&lt;'
        i++
      }
      continue
    }
    i += m[0].length
    const closing = !!m[1]
    let name = m[2].toLowerCase()
    name = ALIAS[name] ?? name
    if (name === 'br') {
      out += '\n'
      continue
    }
    if (name === 'p' || name === 'div') {
      if (closing) out += '\n'
      continue
    }
    if (name === 'script' || name === 'style') {
      // Drop the element and its content.
      if (!closing) {
        const end = src.slice(i).search(new RegExp(`<\\s*/\\s*${m[2]}\\s*>`, 'i'))
        i = end < 0 ? src.length : i + end + src.slice(i + end).indexOf('>') + 1
      }
      continue
    }
    if (!ALLOWED.has(name)) continue
    const top = stack.at(-1)
    const inCode = stack.includes('code') || (stack.includes('pre') && !(name === 'code' && top === 'pre'))
    if (closing) {
      const at = stack.lastIndexOf(name)
      if (at < 0) continue
      // Close anything opened after it first (keeps the markup well formed).
      while (stack.length > at) out += `</${stack.pop()}>`
      continue
    }
    if (m[4]) continue // a self-closing allowed tag means nothing
    if (inCode) continue
    if (name === 'a') {
      const h = m[3].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i)
      const href = h ? safeHref(h[1] ?? h[2] ?? h[3]) : null
      if (!href || stack.includes('a')) continue
      out += `<a href="${escAttr(href)}">`
      stack.push('a')
      continue
    }
    out += `<${name}>`
    stack.push(name)
  }
  while (stack.length) out += `</${stack.pop()}>`
  return out.replace(/\n{3,}/g, '\n\n').trim()
}

/** The length Telegram counts: the visible text (tags removed, entities decoded), in UTF-16 units. */
export const visibleLength = (html) => decodeEntities(String(html ?? '').replace(/<[^>]*>/g, '')).length

/* ----------------------------------------------------------- validation --- */

const isHttps = (s) => {
  try {
    const u = new URL(String(s))
    return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password && String(s).length <= 2_048
  } catch {
    return false
  }
}

/** Buttons: at most three, each { text 1–64 characters, url https }. Returns { buttons, errors }. */
export function validateButtons(raw) {
  const errors = []
  if (raw == null) return { buttons: [], errors }
  if (!Array.isArray(raw)) return { buttons: [], errors: ['Buttons must be a list.'] }
  const list = raw.filter((b) => b && (String(b.text ?? '').trim() || String(b.url ?? '').trim()))
  if (list.length > MAX_BUTTONS) errors.push(`At most ${MAX_BUTTONS} buttons.`)
  const buttons = []
  list.slice(0, MAX_BUTTONS).forEach((b, n) => {
    const text = String(b.text ?? '').trim()
    const url = String(b.url ?? '').trim()
    if (!text || text.length > 64) errors.push(`Button ${n + 1}: a label of 1 to 64 characters is needed.`)
    if (!isHttps(url)) errors.push(`Button ${n + 1}: the link must be a full https:// URL.`)
    else buttons.push({ text: text.slice(0, 64), url: new URL(url).href })
  })
  return { buttons, errors }
}

/** Media: null, an https photo/GIF URL, the Gully banner, or a Telegram file_id. Returns { media, errors }. */
export function validateMedia(raw) {
  if (raw == null || raw === '' || raw === false) return { media: null, errors: [] }
  const kind = raw.kind === 'photo' ? 'photo' : raw.kind === 'animation' ? 'animation' : null
  if (!kind) return { media: null, errors: ['Media kind must be photo or animation.'] }
  if (raw.banner === true) return { media: { kind: 'animation', banner: true }, errors: [] }
  if (typeof raw.fileId === 'string' && /^[\w-]{10,200}$/.test(raw.fileId)) return { media: { kind, fileId: raw.fileId }, errors: [] }
  if (isHttps(raw.url)) return { media: { kind, url: new URL(raw.url).href }, errors: [] }
  return { media: null, errors: ['The image or GIF must be a full https:// URL.'] }
}

/** Everything a post carries, sanitized and checked against Telegram's limits. */
export function validatePost(body) {
  const text = sanitizeTelegramHtml(body?.text ?? '')
  const m = validateMedia(body?.media)
  const b = validateButtons(body?.buttons)
  const errors = [...m.errors, ...b.errors]
  const limit = m.media ? MAX_CAPTION : MAX_TEXT
  const length = visibleLength(text)
  if (!m.media && !length) errors.push('The post needs some text.')
  if (length > limit) errors.push(m.media ? `A caption can be at most ${MAX_CAPTION} characters (this one is ${length}).` : `A post can be at most ${MAX_TEXT} characters (this one is ${length}).`)
  return { text, media: m.media, buttons: b.buttons, pin: !!body?.pin, length, limit, errors }
}

/* ------------------------------------------------------------ Bot API --- */

const markup = (buttons) => (buttons.length ? { inline_keyboard: buttons.map((b) => [{ text: b.text, url: b.url }]) } : undefined)

/** Sends a post's content to a chat. Returns { ok, messageId, error }. */
async function sendContent(chatId, p) {
  const reply_markup = markup(p.buttons)
  let r
  if (!p.media) {
    r = await sendToChannel(chatId, 'sendMessage', { text: p.text, parse_mode: 'HTML', ...(reply_markup ? { reply_markup } : {}) })
  } else {
    const method = p.media.kind === 'photo' ? 'sendPhoto' : 'sendAnimation'
    const field = p.media.kind === 'photo' ? 'photo' : 'animation'
    const base = { caption: p.text, parse_mode: 'HTML', ...(reply_markup ? { reply_markup } : {}) }
    if (p.media.banner) {
      const b = channelBanner()
      r = await sendToChannel(chatId, method, () => {
        if (b.fileId) return { chat_id: String(chatId), [field]: b.fileId, ...base }
        if (!b.file) return { chat_id: String(chatId), [field]: b.url, ...base }
        const f = new FormData()
        f.set('chat_id', String(chatId))
        f.set(field, new Blob([b.file.buf], { type: b.file.type }), b.file.upload)
        f.set('caption', p.text)
        f.set('parse_mode', 'HTML')
        f.set('width', String(b.file.width))
        f.set('height', String(b.file.height))
        if (reply_markup) f.set('reply_markup', JSON.stringify(reply_markup))
        return f
      })
      const fileId = r.result?.animation?.file_id ?? r.result?.document?.file_id ?? null
      if (r.ok && fileId) b.remember(fileId)
    } else {
      r = await sendToChannel(chatId, method, { [field]: p.media.fileId ?? p.media.url, ...base })
    }
  }
  return { ok: r.ok, messageId: r.result?.message_id ?? null, error: r.ok ? null : r.error }
}

/* ---------------------------------------------------------------- posts --- */

const newId = () => `cp_${crypto.randomBytes(8).toString('hex')}`
const byId = (id) => db.posts.find((p) => p.id === id) ?? null
function logTo(p, action, ok, error = null, by = 'admin') {
  p.history = [...(p.history ?? []), { at: iso(), action, ok, ...(error ? { error } : {}), by }].slice(-KEEP_HISTORY)
  p.updatedAt = iso()
}
const busy = new Set() // ids being sent: a tick and a click never send the same post twice

/** Publishes a post to the channel (with the pin when asked). Mutates and saves the post. */
async function publish(p, by = 'admin') {
  if (busy.has(p.id)) return { ok: false, status: 409, error: 'This post is being sent already.' }
  if (!telegramEnabled()) {
    p.status = 'failed'
    p.error = 'Telegram is not configured on the server (TELEGRAM_BOT_TOKEN).'
    logTo(p, 'post', false, p.error, by)
    save()
    return { ok: false, status: 503, error: p.error }
  }
  busy.add(p.id)
  try {
    const chat = newsChannel()
    const r = await sendContent(chat, p)
    if (!r.ok) {
      p.status = 'failed'
      p.error = r.error
      logTo(p, 'post', false, r.error, by)
      save()
      return { ok: false, status: 502, error: `Telegram refused the post: ${r.error}` }
    }
    Object.assign(p, { status: 'sent', sentAt: iso(), messageId: r.messageId, chat, error: null, pinned: false })
    logTo(p, 'post', true, null, by)
    if (p.pin && r.messageId) {
      const pin = await sendToChannel(chat, 'pinChatMessage', { message_id: r.messageId, disable_notification: true })
      p.pinned = pin.ok
      logTo(p, 'pin', pin.ok, pin.ok ? null : pin.error, by)
    }
    save()
    return { ok: true }
  } finally {
    busy.delete(p.id)
  }
}

/** Edits a sent post in place: text or caption (with buttons), or only the buttons; pin/unpin. */
async function editSent(p, v) {
  if (JSON.stringify(v.media ?? null) !== JSON.stringify(p.media ?? null)) return { ok: false, status: 409, error: 'The image or GIF of a sent post cannot be changed. Delete it and post again.' }
  const reply_markup = markup(v.buttons) ?? { inline_keyboard: [] }
  const textChanged = v.text !== p.text
  const buttonsChanged = JSON.stringify(v.buttons) !== JSON.stringify(p.buttons)
  if (textChanged) {
    const r = p.media
      ? await sendToChannel(p.chat, 'editMessageCaption', { message_id: p.messageId, caption: v.text, parse_mode: 'HTML', reply_markup })
      : await sendToChannel(p.chat, 'editMessageText', { message_id: p.messageId, text: v.text, parse_mode: 'HTML', reply_markup })
    if (!r.ok && !/not modified/i.test(r.error ?? '')) {
      logTo(p, 'edit', false, r.error)
      save()
      return { ok: false, status: 502, error: `Telegram refused the edit: ${r.error}` }
    }
  } else if (buttonsChanged) {
    const r = await sendToChannel(p.chat, 'editMessageReplyMarkup', { message_id: p.messageId, reply_markup })
    if (!r.ok && !/not modified/i.test(r.error ?? '')) {
      logTo(p, 'edit', false, r.error)
      save()
      return { ok: false, status: 502, error: `Telegram refused the edit: ${r.error}` }
    }
  }
  if (textChanged || buttonsChanged) {
    Object.assign(p, { text: v.text, buttons: v.buttons })
    logTo(p, 'edit', true)
  }
  if (v.pin !== !!p.pinned) {
    const r = await sendToChannel(p.chat, v.pin ? 'pinChatMessage' : 'unpinChatMessage', { message_id: p.messageId, ...(v.pin ? { disable_notification: true } : {}) })
    if (r.ok) p.pinned = v.pin
    p.pin = v.pin
    logTo(p, v.pin ? 'pin' : 'unpin', r.ok, r.ok ? null : r.error)
  }
  save()
  return { ok: true }
}

function createPost(v, { by = 'admin', autoKey = null, status = 'draft', scheduledAt = null } = {}) {
  const p = { id: newId(), status, text: v.text, media: v.media, buttons: v.buttons, pin: v.pin, scheduledAt, sentAt: null, messageId: null, chat: null, pinned: false, error: null, createdBy: by, autoKey, createdAt: iso(), updatedAt: iso(), history: [] }
  logTo(p, status === 'scheduled' ? 'schedule' : 'create', true, null, by)
  db.posts.push(p)
  save()
  return p
}

const publicPost = (p) => ({ ...p, url: p.status === 'sent' || (p.status === 'deleted' && p.messageId) ? messageUrl(p.messageId) : null, length: visibleLength(p.text), limit: p.media ? MAX_CAPTION : MAX_TEXT })

function parseWhen(s) {
  const t = Date.parse(String(s ?? ''))
  return Number.isFinite(t) ? t : null
}

/* ------------------------------------------------------------ scheduler --- */

/** One scheduler pass: due scheduled posts, due auto posts, the daily follower sample. Exported for tests. */
export async function tickChannel() {
  const t = now()
  for (const p of db.posts.filter((x) => x.status === 'scheduled' && parseWhen(x.scheduledAt) !== null && parseWhen(x.scheduledAt) <= t)) {
    if (t - parseWhen(p.scheduledAt) > MISSED_MS) {
      p.status = 'failed'
      p.error = `Missed its time (${p.scheduledAt}) by more than 6 hours, probably while the server was down. Retry posts it now.`
      logTo(p, 'post', false, p.error, 'scheduler')
      save()
      continue
    }
    await publish(p, 'scheduler')
  }
  await runAuto()
  await sampleFollowers()
}

let tickTimer = null
let blogTimer = null
let firstRun = null
let unsubscribe = null
/** Starts the 30 s scheduler, the blog poll and the DeepCore launch hook. Idempotent. */
export function startChannel() {
  if (tickTimer) return
  const safe = (fn) => () => Promise.resolve().then(fn).catch((e) => console.error('channel:', e?.message ?? e))
  tickTimer = setInterval(safe(tickChannel), TICK_MS)
  tickTimer.unref?.()
  blogTimer = setInterval(safe(checkSources), Math.min(BLOG_POLL_MS, CHANGELOG_POLL_MS))
  blogTimer.unref?.()
  unsubscribe ??= onLaunches((fresh) => onNewLaunches(fresh))
  firstRun = setTimeout(safe(async () => (await checkSources(), await tickChannel())), 5_000)
  firstRun.unref?.()
}
/** Tests: stop the timers (the DeepCore launch hook stays, so tests drive everything by hand). */
export function stopChannel() {
  clearInterval(tickTimer)
  clearInterval(blogTimer)
  clearTimeout(firstRun)
  tickTimer = blogTimer = firstRun = null
}

/* ----------------------------------------------------------- auto posts --- */

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
function validTz(tz) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz })
    return true
  } catch {
    return false
  }
}
/** Local parts of time t in the auto-post timezone. */
function localParts(t) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: db.settings.auto.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
  const o = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]))
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday)
  return { date: `${o.year}-${o.month}-${o.day}`, minutes: Number(o.hour) * 60 + Number(o.minute), weekday: wd }
}
const toMin = (s) => {
  const m = HHMM.exec(s)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0
}
function inQuietHours(t = now()) {
  const q = db.settings.auto.quietHours
  if (!q.enabled) return false
  const m = localParts(t).minutes
  const a = toMin(q.start)
  const b = toMin(q.end)
  return a === b ? false : a < b ? m >= a && m < b : m >= a || m < b
}
function lastPostAt() {
  let last = 0
  for (const p of db.posts) if (p.sentAt) last = Math.max(last, Date.parse(p.sentAt))
  return last
}
/** Why an auto post may not go out now ('quiet', 'gap'), or null. */
function autoBlocked(t = now()) {
  if (inQuietHours(t)) return 'quiet'
  const gap = Math.max(0, Number(db.settings.auto.minGapMinutes) || 0) * 60_000
  if (gap && t - lastPostAt() < gap) return 'gap'
  return null
}

/** Fills a template: {name} becomes the escaped value; values marked raw are inserted as built HTML. */
function fill(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? (vars[k]?.raw ?? esc(String(vars[k] ?? ''))) : m))
}
const raw = (html) => ({ raw: html })
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s)

/** Builds an auto post from a template and checks it like a manual one. Long content is clipped to fit. */
function buildAuto(type, vars, link, media = null) {
  const cfg = db.settings.auto[type]
  const buttons = link ? [{ text: DEFAULT_BUTTONS[type], url: link }] : []
  let v = validatePost({ text: fill(cfg.template, vars), media, buttons })
  for (const k of ['excerpt', 'summary', 'list']) {
    if (!v.errors.length || !(k in vars)) continue
    const s = typeof vars[k] === 'string' ? vars[k] : null
    if (s) v = validatePost({ text: fill(cfg.template, { ...vars, [k]: clip(s, Math.max(40, s.length - (v.length - v.limit) - 20)) }), media, buttons })
  }
  return v
}

/* --- sources --- */

let readRows = async () => {
  const body = await readTracker()
  const chains = Object.fromEntries((body?.chains ?? []).map((c) => [c.key, c]))
  return (body?.rows ?? []).map((r) => ({ ...r, sessionOpen: chains[r.chain]?.sessionOpen ?? null }))
}
let historyDays = (chain, ticker, days) => readHistoryDays(chain, ticker, days)
let readChangelog = () => changelogFromIndex()
let launchesReader = (o) => readLaunches(o)
/** Tests: synthetic tracker rows, history, changelog and launches. */
export function setChannelSourcesForTest({ rows, history, changelog, launches } = {}) {
  if (rows) readRows = rows
  if (history) historyDays = history
  if (changelog) readChangelog = changelog
  if (launches) launchesReader = launches
}

/** Changelog entries from the Ask index (server/data/ask-index.json): one per dated section, newest first. */
function changelogFromIndex() {
  let idx
  try {
    idx = JSON.parse(fs.readFileSync(path.join(HERE, 'data/ask-index.json'), 'utf8'))
  } catch {
    return []
  }
  const by = new Map()
  for (const c of idx?.chunks ?? []) {
    if (c?.source !== 'Changelog' || !c.section || !String(c.url ?? '').includes('#')) continue
    const e = by.get(c.url) ?? { key: c.url, date: c.section, url: c.url, text: '' }
    e.text = `${e.text} ${c.text ?? ''}`.trim()
    by.set(c.url, e)
  }
  return [...by.values()].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
}

const ghostBase = () => String(process.env.GHOST_URL ?? 'https://blog.gullylabs.xyz').replace(/\/+$/, '')
/** The newest published blog posts from Ghost's Content API, or null when it cannot be read. */
async function readBlog(limit = 10) {
  const key = String(process.env.GHOST_CONTENT_KEY ?? '').trim()
  if (!key) return null
  try {
    const r = await fetch(`${ghostBase()}/ghost/api/content/posts/?key=${encodeURIComponent(key)}&limit=${limit}&order=published_at%20desc&fields=id,title,url,custom_excerpt,excerpt,published_at`, { signal: AbortSignal.timeout(10_000), redirect: 'manual' })
    if (!r.ok) return null
    const j = await r.json()
    return (j?.posts ?? []).filter((p) => p?.id && p.title && isHttps(p.url)).map((p) => ({ key: String(p.id), title: String(p.title).slice(0, 200), excerpt: String(p.custom_excerpt || p.excerpt || '').replace(/\s+/g, ' ').trim(), url: p.url, publishedAt: p.published_at ?? null }))
  } catch {
    return null
  }
}

/* --- builders: the next post of each type, from live data --- */

const fmtDate = (t = now()) => new Intl.DateTimeFormat('en-GB', { timeZone: db.settings.auto.timezone, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(t))

function launchPost(l) {
  const pools = (l.legs ?? []).map((g) => [g.kind === 'CL' ? 'CL pool' : g.kind === 'Bin' ? 'Bin pool' : 'pool', g.quote ? `vs ${g.quote}` : null, g.locked === true ? 'liquidity locked' : null].filter(Boolean).join(' ')).join(' · ') || 'pool details on DeepCore'
  return buildAuto('launches', { symbol: l.symbol ?? 'a new token', chain: l.chainName ?? chainName(l.chainKey), pools, link: l.links?.token ?? 'https://deepcore.fun' }, l.links?.token ?? null)
}
async function dailyGapsPost() {
  const rows = await readRows().catch(() => null)
  if (!rows) return { skip: 'The tracker could not be read.' }
  const top = rows.filter(trustedNow).sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct)).slice(0, 5)
  if (!top.length) return { skip: 'No stock has a trusted gap right now.' }
  const list = top.map((r, i) => `${i + 1}. <b>${esc(r.ticker)}</b> · ${esc(chainName(r.chain))} · <b>${esc(signed(r.gapPct))}%</b> ${esc(r.status)}`).join('\n')
  const link = `${SITE}/tracker`
  return buildAuto('dailyGaps', { list: raw(list), date: fmtDate(), link }, link)
}
async function weeklyMoversPost() {
  const rows = await readRows().catch(() => null)
  if (!rows) return { skip: 'The tracker could not be read.' }
  const t = now() / 1000
  const moves = []
  for (const r of rows.filter((x) => trustedNow(x))) {
    const pts = historyDays(r.chain, r.ticker, 7) ?? []
    if (pts.length < 2) continue
    const first = pts[0]
    const last = pts[pts.length - 1]
    if (t - first[0] < 5 * 86_400 || !(first[2] > 0) || !(last[2] > 0)) continue
    moves.push({ r, pct: ((last[2] - first[2]) / first[2]) * 100 })
  }
  if (!moves.length) return { skip: 'Not enough history for a 7-day change yet (needs at least 5 days of snapshots).' }
  const list = moves
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, 5)
    .map((m, i) => `${i + 1}. <b>${esc(m.r.ticker)}</b> · ${esc(chainName(m.r.chain))} · <b>${esc(signed(m.pct))}%</b> · gap now ${esc(signed(m.r.gapPct))}%`)
    .join('\n')
  const link = `${SITE}/tracker`
  return buildAuto('weeklyMovers', { list: raw(list), date: fmtDate(), link }, link)
}
const blogPost = (b) => buildAuto('blog', { title: b.title, excerpt: clip(b.excerpt || '', 600), link: b.url }, b.url)
const releasePost = (e) => buildAuto('releases', { date: e.date, summary: clip(e.text, 700), link: e.url }, e.url)

/* --- events --- */

function seen(type, key) {
  return db.state.seen[type].includes(key)
}
function queueItem(type, key, data) {
  if (seen(type, key)) return false
  db.state.seen[type].push(key)
  if (db.state.pending.length < 50) db.state.pending.push({ type, key, at: iso(), data })
  return true
}

/** deepcore.mjs's onLaunches: queue each new launch when the type is on. */
export function onNewLaunches(fresh) {
  if (!db.settings.auto.launches.enabled || !fresh?.length) return
  let n = 0
  for (const l of fresh) if (l?.key && queueItem('launches', l.key, l)) n++
  if (n) save()
}

/** Blog and changelog: new items queued, the first check after switching on only records what exists. */
export async function checkSources() {
  const a = db.settings.auto
  let changed = false
  if (a.blog.enabled) {
    const posts = await readBlog()
    if (posts) {
      if (!db.state.baselined.blog) {
        for (const p of posts) if (!seen('blog', p.key)) db.state.seen.blog.push(p.key)
        db.state.baselined.blog = iso()
      } else for (const p of [...posts].reverse()) queueItem('blog', p.key, p)
      changed = true
    }
  }
  if (a.releases.enabled) {
    const entries = readChangelog() ?? []
    if (!db.state.baselined.releases) {
      for (const e of entries) if (!seen('releases', e.key)) db.state.seen.releases.push(e.key)
      db.state.baselined.releases = iso()
    } else for (const e of [...entries].reverse()) queueItem('releases', e.key, e)
    changed = true
  }
  if (changed) save()
}

/** Runs what is due: one queued item, or the daily/weekly post, when quiet hours and the gap allow. */
async function runAuto() {
  const a = db.settings.auto
  const t = now()
  // Drop items of types switched off, and launch items too old to be news.
  const before = db.state.pending.length
  db.state.pending = db.state.pending.filter((x) => a[x.type]?.enabled && !(x.type === 'launches' && t - Date.parse(x.at) > PENDING_TTL_MS))
  if (db.state.pending.length !== before) save()
  if (autoBlocked(t)) return
  const local = localParts(t)
  // Daily and weekly posts go out within 3 hours of their time (later than that, that day is skipped).
  const due = (hhmm) => local.minutes >= toMin(hhmm) && local.minutes < toMin(hhmm) + 180
  if (a.dailyGaps.enabled && db.state.lastDaily !== local.date && due(a.dailyGaps.time)) {
    db.state.lastDaily = local.date
    save()
    const v = await dailyGapsPost()
    if (!v.skip) return void (await sendAuto('dailyGaps', v, `daily:${local.date}`))
  }
  const week = isoWeek(t)
  if (a.weeklyMovers.enabled && db.state.lastWeekly !== week && local.weekday === Number(a.weeklyMovers.day) && due(a.weeklyMovers.time)) {
    db.state.lastWeekly = week
    save()
    const v = await weeklyMoversPost()
    if (!v.skip) return void (await sendAuto('weeklyMovers', v, `weekly:${week}`))
  }
  const item = db.state.pending.shift()
  if (!item) return
  save()
  const v = item.type === 'launches' ? launchPost(item.data) : item.type === 'blog' ? blogPost(item.data) : releasePost(item.data)
  await sendAuto(item.type, v, `${item.type}:${item.key}`)
}
const isoWeek = (t) => {
  const d = new Date(t)
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 3)
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  return `${d.getUTCFullYear()}-W${String(1 + Math.round((d - first) / 604_800_000)).padStart(2, '0')}`
}

async function sendAuto(type, v, autoKey) {
  if (db.posts.some((p) => p.autoKey === autoKey && p.status !== 'failed')) return // never twice
  const p = createPost(v, { by: `auto:${type}`, autoKey })
  if (v.errors.length) {
    p.status = 'failed'
    p.error = v.errors.join(' ')
    logTo(p, 'post', false, p.error, `auto:${type}`)
    save()
    return
  }
  await publish(p, `auto:${type}`)
}

/** The next post of a type, rendered from live data, never sent. */
async function previewAuto(type) {
  if (type === 'dailyGaps') return dailyGapsPost()
  if (type === 'weeklyMovers') return weeklyMoversPost()
  if (type === 'launches') {
    const queued = db.state.pending.find((x) => x.type === 'launches')
    const l = queued?.data ?? (await launchesReader({ limit: 1 }).catch(() => null))?.launches?.[0]
    return l ? launchPost(l) : { skip: 'No DeepCore launch could be read just now.' }
  }
  if (type === 'blog') {
    const queued = db.state.pending.find((x) => x.type === 'blog')
    if (queued) return blogPost(queued.data)
    if (!String(process.env.GHOST_CONTENT_KEY ?? '').trim()) return { skip: 'GHOST_CONTENT_KEY is not set on the server, so the blog cannot be read.' }
    const posts = await readBlog(1)
    return posts?.[0] ? blogPost(posts[0]) : { skip: 'The blog could not be read, or has no published post yet.' }
  }
  const queued = db.state.pending.find((x) => x.type === 'releases')
  const e = queued?.data ?? readChangelog()?.[0]
  return e ? releasePost(e) : { skip: 'No changelog entry was found.' }
}

/* ------------------------------------------------------------ followers --- */

let liveCount = { count: null, at: 0, error: null }
let sampleFailedAt = 0
async function memberCount({ fresh = false } = {}) {
  if (!telegramEnabled()) return { count: null, at: null, error: 'Telegram is not configured on the server.' }
  if (!fresh && liveCount.at && now() - liveCount.at < 60_000) return liveCount
  const r = await sendToChannel(newsChannel(), 'getChatMemberCount', {})
  liveCount = r.ok && Number.isInteger(r.result) ? { count: r.result, at: now(), error: null } : { count: null, at: now(), error: r.error ?? 'unreadable' }
  return liveCount
}
async function sampleFollowers() {
  const day = iso().slice(0, 10)
  if (!telegramEnabled() || db.followers.some((f) => f.day === day) || now() - sampleFailedAt < 10 * 60_000) return
  const c = await memberCount({ fresh: true })
  if (c.count === null) return void (sampleFailedAt = now())
  db.followers.push({ day, count: c.count, at: iso() })
  db.followers = db.followers.slice(-400)
  save()
}

/* --------------------------------------------------------------- routes --- */

/** The chats an admin may test-send to: every linked chat (account, title, type). */
function linkedChats() {
  const out = []
  for (const a of developers().accounts) {
    const l = linkedChat(a.address)
    if (l) out.push({ chatId: l.chatId, address: a.address, chatType: l.chatType, chatTitle: l.chatTitle || null })
  }
  return out
}

function settingsView() {
  const a = db.settings.auto
  return { ...a, ghostConfigured: !!String(process.env.GHOST_CONTENT_KEY ?? '').trim(), pending: db.state.pending.map((x) => ({ type: x.type, key: x.key, at: x.at })), blocked: autoBlocked(), lastDaily: db.state.lastDaily, lastWeekly: db.state.lastWeekly }
}

function updateAuto(body) {
  const a = db.settings.auto
  const errors = []
  if (body?.timezone !== undefined) {
    if (typeof body.timezone === 'string' && validTz(body.timezone)) a.timezone = body.timezone
    else errors.push('Unknown timezone.')
  }
  if (body?.minGapMinutes !== undefined) {
    const n = Number(body.minGapMinutes)
    if (Number.isInteger(n) && n >= 0 && n <= 1_440) a.minGapMinutes = n
    else errors.push('The minimum gap must be 0 to 1440 minutes.')
  }
  if (body?.quietHours !== undefined) {
    const q = body.quietHours ?? {}
    if (q.start !== undefined && !HHMM.test(q.start)) errors.push('Quiet hours start must be HH:MM.')
    if (q.end !== undefined && !HHMM.test(q.end)) errors.push('Quiet hours end must be HH:MM.')
    if (!errors.length) a.quietHours = { enabled: q.enabled === undefined ? a.quietHours.enabled : !!q.enabled, start: q.start ?? a.quietHours.start, end: q.end ?? a.quietHours.end }
  }
  for (const t of AUTO_TYPES) {
    const c = body?.[t]
    if (c === undefined) continue
    const cur = a[t]
    if (c.template !== undefined) {
      const tpl = String(c.template)
      if (!tpl.trim() || tpl.length > 2_000) errors.push(`${t}: the template must be 1 to 2000 characters.`)
      else cur.template = tpl
    }
    if (c.reset === true) cur.template = DEFAULT_TEMPLATES[t]
    if (c.time !== undefined && 'time' in cur) {
      if (HHMM.test(c.time)) cur.time = c.time
      else errors.push(`${t}: the time must be HH:MM.`)
    }
    if (c.day !== undefined && 'day' in cur) {
      const d = Number(c.day)
      if (Number.isInteger(d) && d >= 0 && d <= 6) cur.day = d
      else errors.push(`${t}: the day must be 0 (Sunday) to 6.`)
    }
    if (c.enabled !== undefined) {
      const on = !!c.enabled
      // Switching a polled type on starts from what exists now: no backlog.
      if (on && !cur.enabled && (t === 'blog' || t === 'releases')) db.state.baselined[t] = null
      cur.enabled = on
    }
  }
  save()
  return errors
}

export async function handleChannelAdmin(req, res, url) {
  const p = url.pathname
  const method = req.method
  const body = method === 'POST' ? ((await readJson(req, 40_000)) ?? {}) : null
  const send = (status, j) => (json(res, status, j), true)

  if (p === '/api/admin/channel') {
    if (method !== 'GET') return send(405, { error: 'GET only' })
    const posts = [...db.posts].reverse().map(publicPost)
    return send(200, { channel: newsChannel(), channelUrl: messageUrl(1)?.replace(/\/1$/, '') ?? null, enabled: telegramEnabled(), limits: { text: MAX_TEXT, caption: MAX_CAPTION, buttons: MAX_BUTTONS }, posts, testChat: db.settings.testChat, linkedChats: linkedChats(), auto: settingsView() })
  }
  if (p === '/api/admin/channel/validate') {
    if (method !== 'POST') return send(405, { error: 'POST only' })
    const v = validatePost(body)
    return send(200, { text: v.text, length: v.length, limit: v.limit, errors: v.errors })
  }
  if (p === '/api/admin/channel/test') {
    if (method !== 'POST') return send(405, { error: 'POST only' })
    const v = validatePost(body)
    if (v.errors.length) return send(400, { error: v.errors.join(' '), errors: v.errors })
    if (!telegramEnabled()) return send(503, { error: 'Telegram is not configured on the server (TELEGRAM_BOT_TOKEN).' })
    const asked = body.chatId != null && String(body.chatId) !== '' ? String(body.chatId) : db.settings.testChat
    if (!asked) return send(400, { error: 'Pick your linked Telegram chat for tests first (link it from the developer portal, Alerts, Connect Telegram).' })
    const link = linkedChatById(asked)
    if (!link) return send(400, { error: 'That chat is not linked to any account. Link your own Telegram from the developer portal first.' })
    if (db.settings.testChat !== link.chatId) {
      db.settings.testChat = link.chatId
      save()
    }
    const r = await sendContent(link.chatId, v)
    return r.ok ? send(200, { ok: true, messageId: r.messageId, chatTitle: link.chatTitle || null }) : send(502, { error: `Telegram refused the test: ${r.error}` })
  }
  if (p === '/api/admin/channel/followers') {
    const c = await memberCount({ fresh: url.searchParams.get('fresh') === '1' })
    return send(200, { count: c.count, at: c.at ? new Date(c.at).toISOString() : null, error: c.error, series: db.followers.map((f) => ({ day: f.day, count: f.count })) })
  }
  if (p === '/api/admin/channel/auto') {
    if (method === 'GET') return send(200, { auto: settingsView() })
    if (method !== 'POST') return send(405, { error: 'GET or POST only' })
    const errors = updateAuto(body)
    return errors.length ? send(400, { error: errors.join(' '), auto: settingsView() }) : send(200, { auto: settingsView() })
  }
  let m = p.match(/^\/api\/admin\/channel\/auto\/(\w+)\/preview$/)
  if (m) {
    if (!AUTO_TYPES.includes(m[1])) return send(404, { error: 'No such auto-post type.' })
    const v = await previewAuto(m[1])
    if (v.skip) return send(200, { type: m[1], skip: v.skip, preview: null })
    return send(200, { type: m[1], skip: null, preview: { text: v.text, media: v.media, buttons: v.buttons, length: v.length, limit: v.limit, errors: v.errors }, blocked: autoBlocked() })
  }
  if (p === '/api/admin/channel/posts') {
    if (method !== 'POST') return send(405, { error: 'POST only' })
    const v = validatePost(body)
    if (v.errors.length) return send(400, { error: v.errors.join(' '), errors: v.errors })
    const action = ['draft', 'post', 'schedule'].includes(body.action) ? body.action : 'draft'
    if (action === 'schedule') {
      const t = parseWhen(body.scheduledAt)
      if (t === null || t < now() - 60_000) return send(400, { error: 'Pick a time in the future to schedule the post.' })
      if (t > now() + 90 * 86_400_000) return send(400, { error: 'Posts can be scheduled at most 90 days ahead.' })
      return send(201, { post: publicPost(createPost(v, { status: 'scheduled', scheduledAt: new Date(t).toISOString() })) })
    }
    const post = createPost(v)
    if (action === 'post') {
      const r = await publish(post)
      if (!r.ok) return send(r.status, { error: r.error, post: publicPost(post) })
    }
    return send(201, { post: publicPost(post) })
  }
  m = p.match(/^\/api\/admin\/channel\/posts\/(cp_[0-9a-f]{16})(?:\/(post|retry|delete|unschedule))?$/)
  if (m) {
    if (method !== 'POST') return send(405, { error: 'POST only' })
    const post = byId(m[1])
    if (!post) return send(404, { error: 'No such post.' })
    const action = m[2]
    if (!action) {
      const v = validatePost({ text: body.text ?? post.text, media: 'media' in body ? body.media : post.media, buttons: body.buttons ?? post.buttons, pin: body.pin ?? post.pin })
      if (v.errors.length) return send(400, { error: v.errors.join(' '), errors: v.errors })
      if (post.status === 'deleted') return send(409, { error: 'This post was deleted.' })
      if (post.status === 'sent') {
        const r = await editSent(post, v)
        return r.ok ? send(200, { post: publicPost(post) }) : send(r.status, { error: r.error, post: publicPost(post) })
      }
      Object.assign(post, { text: v.text, media: v.media, buttons: v.buttons, pin: v.pin })
      if (body.scheduledAt !== undefined && post.status === 'scheduled') {
        const t = parseWhen(body.scheduledAt)
        if (t === null || t < now() - 60_000) return send(400, { error: 'Pick a time in the future to schedule the post.' })
        post.scheduledAt = new Date(t).toISOString()
      }
      logTo(post, 'update', true)
      save()
      return send(200, { post: publicPost(post) })
    }
    if (action === 'post' || action === 'retry') {
      if (post.status === 'sent') return send(409, { error: 'Already posted.' })
      if (post.status === 'deleted') return send(409, { error: 'This post was deleted.' })
      const v = validatePost(post)
      if (v.errors.length) return send(400, { error: v.errors.join(' ') })
      const r = await publish(post)
      return r.ok ? send(200, { post: publicPost(post) }) : send(r.status, { error: r.error, post: publicPost(post) })
    }
    if (action === 'unschedule') {
      if (post.status !== 'scheduled') return send(409, { error: 'Only a scheduled post can be unscheduled.' })
      post.status = 'draft'
      post.scheduledAt = null
      logTo(post, 'unschedule', true)
      save()
      return send(200, { post: publicPost(post) })
    }
    // delete
    if (post.status === 'deleted') return send(200, { post: publicPost(post) })
    if (post.status === 'sent' && post.messageId) {
      const r = await sendToChannel(post.chat, 'deleteMessage', { message_id: post.messageId })
      if (!r.ok && !/message to delete not found/i.test(r.error ?? '')) {
        logTo(post, 'delete', false, r.error)
        save()
        return send(502, { error: `Telegram refused the delete: ${r.error}`, post: publicPost(post) })
      }
    }
    post.status = 'deleted'
    logTo(post, 'delete', true)
    save()
    return send(200, { post: publicPost(post) })
  }
  return send(404, { error: 'not found' })
}
