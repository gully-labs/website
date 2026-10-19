// Intake notifier: every sign-up and submission that lands in admin storage also tells the operators' Telegram chat
// (TELEGRAM_ADMIN_CHAT_ID), with a link to the exact admin section. One entry point:
//
//   notifyIntake({ kind, title, fields, adminUrl?, contact?, confirm? })   -> Promise<{ sent, capped, confirmed }>
//
// It never throws and callers do not await it (`void notifyIntake(...)`): a Telegram failure must never fail the
// person's submission. Wired in: chains-waitlist.mjs (chains-waitlist), developer.mjs (chain-kit, chains-devnet),
// ecosystem.mjs (ecosystem), server.mjs handleContact (contact), security-routes.mjs (security). Honeypot hits and
// rate-limited or invalid posts never reach it.
//
// Message: a kind emoji, a bold title, the key fields (each escaped for Telegram HTML) and an "Open in admin" link
// to admin.gullylabs.xyz/#<section>. Contacts are shown to the owner only and are masked in every server log line.
//
// Reliability: at most INTAKE_NOTIFY_PER_HOUR (30) messages per kind per rolling hour; the rest are counted and
// answered with ONE "N more" summary when the hour ends. A failed send is retried once after a short wait.
//
// Confirmation to the submitter (Telegram only): when `contact` is a Telegram handle (@name or a t.me link) AND that
// person has started @GullyLabsBot (telegram-users.mjs knows their chat id by @username), one short thank-you says
// what happens next. Anyone else gets nothing.
// TODO(email): there is no mail provider, so e-mail confirmations are not sent. Adding one (Resend, Postmark, SES)
// means calling it from sendConfirmation() for e-mail contacts; see ops/ for the note.
//
// Daily digest: once a day at INTAKE_DIGEST_TIME (UTC, default 09:00) the admin chat gets the new counts per kind in
// the last 24 h and the totals; nothing is sent when nothing is new. A 30 s unref'd interval checks the clock; the
// day last sent is kept in DATA_DIR/intake-notify.json so a restart does not repeat it.
//
// Also here: the CSV helpers the admin exports use (csvCell prefixes = + - @ and tab/CR with a quote).

import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './http.mjs'

export const ADMIN_BASE = 'https://admin.gullylabs.xyz/'
const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const MAX_FIELD = 300

/** kind -> emoji, label (digest + message), admin section hash. */
export const KINDS = {
  'chains-waitlist': { emoji: '⛓️', label: 'Gully Chains waitlist', section: 'chainkit', thanks: 'you are on the Gully Chains waitlist. We will message you when early access opens, and we read every answer you gave.' },
  'chain-kit': { emoji: '🧰', label: 'Chain Kit waitlist', section: 'chainkit', thanks: 'you are on the Chain Kit waitlist. We will write when the kit opens.' },
  'chains-devnet': { emoji: '🧪', label: 'Devnet waitlist', section: 'chainkit', thanks: 'you are on the Gully Chains devnet waitlist. We will write when devnet access opens.' },
  ecosystem: { emoji: '🚀', label: 'Launchpad submission', section: 'chainkit', thanks: 'we got your launchpad submission. We review each one by hand and nothing is listed automatically; we will reply with the result.' },
  contact: { emoji: '✉️', label: 'Contact form', section: 'inbox', thanks: 'we got your message and will reply as soon as we can.' },
  security: { emoji: '🛡️', label: 'Security review request', section: 'security', thanks: 'we got your security review request. We will reply with scope, price and timing.' },
}

/* ------------------------------------------------------------- helpers --- */

/** HTML-escapes text for Telegram's HTML parse mode. */
export const escTg = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Undoes the entity-escaping some intakes store with (&amp; &lt; ...), so the notifier escapes once, not twice. */
export const decodeEntities = (s) => String(s ?? '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')

const oneLine = (v, n = MAX_FIELD) => {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

/** Hides most of a contact for logs: "ab***@ex***.com", "@ab***". Never returns the full value. */
export function maskContact(v) {
  const s = String(v ?? '').trim()
  if (!s) return '(none)'
  const m = s.match(/^([^@\s]+)@([^@\s]+?)(\.[^.@\s]+)?$/)
  if (m) return `${m[1].slice(0, 2)}***@${m[2].slice(0, 2)}***${m[3] ?? ''}`
  const t = telegramHandleOf(s)
  if (t) return `@${t.slice(0, 2)}***`
  return `${s.slice(0, 2)}***`
}

/** The Telegram username in "@name", "name"-with-@, "t.me/name" or "https://t.me/name", else null. */
export function telegramHandleOf(contact) {
  const s = String(contact ?? '').trim()
  const m = s.match(/^@([A-Za-z][A-Za-z0-9_]{4,31})$/) ?? s.match(/^(?:https?:\/\/)?t\.me\/@?([A-Za-z][A-Za-z0-9_]{4,31})\/?$/i)
  return m ? m[1].toLowerCase() : null
}

export const adminLink = (kind) => `${ADMIN_BASE}#${KINDS[kind]?.section ?? 'inbox'}`

/** The admin message for one intake. `fields` is [[label, value], ...] or { label: value }. */
export function buildMessage({ kind, title, fields, adminUrl }) {
  const k = KINDS[kind] ?? { emoji: '📥', label: kind }
  const rows = (Array.isArray(fields) ? fields : Object.entries(fields ?? {}))
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
    .map(([l, v]) => `<b>${escTg(oneLine(l, 40))}:</b> ${escTg(oneLine(v))}`)
  const url = String(adminUrl ?? adminLink(kind))
  return [`${k.emoji} <b>${escTg(oneLine(title || k.label, 120))}</b>`, ...rows, '', `<a href="${escTg(url)}">Open in admin</a>`].join('\n')
}

/* --------------------------------------------------------------- config --- */

const cfg = { perHour: Math.max(1, Number(process.env.INTAKE_NOTIFY_PER_HOUR) || 30), retryMs: 3_000 }
let transport = null // tests: { admin(html), chat(chatId, html) }
/** Tests: replace the cap, the retry wait and (optionally) the Telegram transport. */
export function setIntakeNotifyForTest(o = {}) {
  if (o.perHour) cfg.perHour = o.perHour
  if (o.retryMs !== undefined) cfg.retryMs = o.retryMs
  if ('send' in o) transport = o.send ?? null
}

async function sendAdmin(html) {
  if (transport) return transport.admin(html)
  return (await import('./telegram.mjs')).sendAdminHtml(html)
}
async function sendChat(chatId, html) {
  if (transport) return transport.chat(chatId, html)
  return (await import('./telegram.mjs')).sendHtmlToPrivateChat(chatId, html)
}
/** Not configured is a quiet "no", not a failure worth retrying or logging. */
const notConfigured = (r) => /not set|not configured/i.test(r?.error ?? '')

/** Sends, and retries once after cfg.retryMs on a failure. Resolves true when delivered. */
async function sendWithRetry(fn, what) {
  let last = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      last = await fn()
    } catch (e) {
      last = { ok: false, error: String(e?.message ?? e).slice(0, 120) }
    }
    if (last?.ok) return true
    if (notConfigured(last)) return false
    if (attempt === 0 && cfg.retryMs >= 0) await new Promise((r) => setTimeout(r, cfg.retryMs))
  }
  console.error(`intake notify: ${what} not delivered: ${String(last?.error ?? 'unknown').replace(/\d{6,}:[\w-]{20,}/g, '[token]').slice(0, 120)}`)
  return false
}

/** A plain operator alert (not an intake: no kind, no digest line, no per-kind cap; the caller rate-limits).
    Same transport, retry and quiet "not configured" as notifyIntake. Never throws. Resolves { sent }. */
export async function notifyAdminAlert({ emoji = '🚨', title, fields, adminUrl } = {}) {
  try {
    const rows = (Array.isArray(fields) ? fields : Object.entries(fields ?? {}))
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
      .map(([l, v]) => `<b>${escTg(oneLine(l, 40))}:</b> ${escTg(oneLine(v))}`)
    const html = [`${emoji} <b>${escTg(oneLine(title, 120))}</b>`, ...rows, '', `<a href="${escTg(String(adminUrl ?? ADMIN_BASE + '#health'))}">Open in admin</a>`].join('\n')
    return { sent: await sendWithRetry(() => sendAdmin(html), `alert ${oneLine(title, 40)}`) }
  } catch (e) {
    console.error('admin alert:', String(e?.message ?? e).slice(0, 120))
    return { sent: false }
  }
}

/* ------------------------------------------------------------- rate cap --- */

const windows = new Map() // kind -> { start, sent, over, timer }

async function flushSummary(kind, w) {
  clearTimeout(w.timer)
  w.timer = null
  const n = w.over
  w.over = 0
  if (n <= 0) return false
  const k = KINDS[kind]
  const html = `${k?.emoji ?? '📥'} <b>${n} more ${escTg(k?.label ?? kind)} entr${n === 1 ? 'y' : 'ies'}</b> in the last hour (individual alerts were capped at ${cfg.perHour}).\n\n<a href="${escTg(adminLink(kind))}">Open in admin</a>`
  return sendWithRetry(() => sendAdmin(html), `${kind} summary`)
}

/** Takes one slot for `kind`: 'send' or 'capped'. Rolls the window and sends the finished window's summary. */
function slot(kind, now) {
  let w = windows.get(kind)
  if (w && now - w.start >= HOUR_MS) {
    if (w.over > 0) void flushSummary(kind, w)
    w = null
  }
  if (!w) windows.set(kind, (w = { start: now, sent: 0, over: 0, timer: null }))
  if (w.sent < cfg.perHour) {
    w.sent++
    return 'send'
  }
  w.over++
  if (!w.timer) {
    w.timer = setTimeout(() => void flushSummary(kind, w), Math.max(1_000, w.start + HOUR_MS - now))
    w.timer.unref?.()
  }
  return 'capped'
}

/** Tests: send every pending "N more" summary now and reset the windows. Resolves how many summaries went out. */
export async function flushIntakeSummariesForTest() {
  let n = 0
  for (const [kind, w] of windows) if (w.over > 0 && (await flushSummary(kind, w))) n++
  windows.clear()
  return n
}

/* ---------------------------------------------------------- confirmation --- */

async function sendConfirmation(kind, contact, text) {
  // TODO(email): e-mail contacts get nothing until a mail provider exists (see the header).
  const handle = telegramHandleOf(contact)
  if (!handle) return false
  try {
    const { chatIdOfUsername } = await import('./telegram-users.mjs')
    const chatId = chatIdOfUsername(handle)
    if (!chatId) return false
    const body = `<b>Gully Labs</b>\nThanks, ${escTg(text ?? KINDS[kind]?.thanks ?? 'we got your request.')}`
    return await sendWithRetry(() => sendChat(chatId, body), `${kind} confirmation to ${maskContact(contact)}`)
  } catch {
    return false
  }
}

/* ---------------------------------------------------------------- notify --- */

/**
 * Tells the operators about one new intake, and thanks the submitter when they are reachable on the bot. Never throws.
 * @param {{ kind: keyof typeof KINDS, title?: string, fields?: [string, string][] | Record<string, string>, adminUrl?: string, contact?: string, confirm?: string, now?: number }} a
 */
export async function notifyIntake(a = {}) {
  const out = { sent: false, capped: false, confirmed: false }
  try {
    const kind = String(a.kind ?? '')
    if (!KINDS[kind]) return out
    const now = a.now ?? Date.now()
    if (slot(kind, now) === 'send') {
      const html = buildMessage({ kind, title: a.title, fields: a.fields, adminUrl: a.adminUrl })
      out.sent = await sendWithRetry(() => sendAdmin(html), `${kind} (${maskContact(a.contact)})`)
    } else out.capped = true
    if (a.contact) out.confirmed = await sendConfirmation(kind, a.contact, a.confirm)
  } catch (e) {
    console.error('intake notify:', String(e?.message ?? e).slice(0, 120))
  }
  return out
}

/* ------------------------------------------------------------------ digest --- */

const STATE = () => path.join(DATA_DIR, 'intake-notify.json')
const readState = () => {
  try {
    return JSON.parse(fs.readFileSync(STATE(), 'utf8')) ?? {}
  } catch {
    return {}
  }
}
const writeState = (s) => {
  try {
    fs.mkdirSync(path.dirname(STATE()), { recursive: true })
    fs.writeFileSync(STATE() + '.tmp', JSON.stringify(s))
    fs.renameSync(STATE() + '.tmp', STATE())
  } catch (e) {
    console.error('intake notify state:', e?.message ?? e)
  }
}

/** kind -> the ISO timestamps of everything stored, from each intake's own store. */
async function defaultSources() {
  const safe = async (fn) => {
    try {
      const v = await fn()
      return Array.isArray(v) ? v : []
    } catch {
      return []
    }
  }
  return {
    'chains-waitlist': await safe(async () => (await import('./chains-waitlist.mjs')).waitlistRows().map((r) => r.at)),
    'chain-kit': await safe(async () => (await import('./store.mjs')).chainKitRequests().map((r) => r.at)),
    'chains-devnet': await safe(async () => (await import('./store.mjs')).chainsWaitlist().map((r) => r.at)),
    ecosystem: await safe(async () => (await import('./ecosystem.mjs')).listSubmissions().map((r) => r.createdAt)),
    // Enquiries also hold the security and Chain Kit rows (counted under their own kinds).
    contact: await safe(async () => (await import('./store.mjs')).listEnquiries().filter((e) => !e.securityReviewId && !/^Topic: Chain Kit/.test(e.message ?? '')).map((e) => e.receivedAt)),
    security: await safe(async () => (await import('./security-routes.mjs')).securityReviewRows().map((r) => r.createdAt)),
  }
}
let sourcesOverride = null
/** Tests: replace the stores the digest counts. fn() -> { kind: [iso, ...] }. */
export const setDigestSourcesForTest = (fn) => (sourcesOverride = fn)

/** The digest text, or null when nothing is new in the last 24 h. */
export async function digestMessage({ now = Date.now() } = {}) {
  const src = await (sourcesOverride ?? defaultSources)()
  let fresh = 0
  const lines = Object.entries(KINDS).map(([kind, k]) => {
    const all = src[kind] ?? []
    const n = all.filter((t) => now - Date.parse(t) < DAY_MS && Date.parse(t) <= now + 60_000).length
    fresh += n
    return `${k.emoji} ${escTg(k.label)}: <b>${n}</b> new · ${all.length} total`
  })
  if (!fresh) return null
  const day = new Date(now).toISOString().slice(0, 10)
  return [`📬 <b>Daily intake digest</b>`, `Last 24 h to ${day} ${new Date(now).toISOString().slice(11, 16)} UTC`, '', ...lines, '', `<b>${fresh}</b> new in total.`, `<a href="${ADMIN_BASE}">Open in admin</a>`].join('\n')
}

/** INTAKE_DIGEST_TIME as minutes after 00:00 UTC (default 09:00; a malformed value falls back to it). */
export function digestMinute() {
  const m = String(process.env.INTAKE_DIGEST_TIME ?? '09:00').trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 9 * 60
}

/** One scheduler pass: sends the digest when it is due and not yet sent today. Resolves 'sent' | 'empty' | 'not-due' | 'failed'. */
export async function digestTick({ now = Date.now() } = {}) {
  const d = new Date(now)
  const day = d.toISOString().slice(0, 10)
  if (d.getUTCHours() * 60 + d.getUTCMinutes() < digestMinute()) return 'not-due'
  const st = readState()
  if (st.lastDigestDay === day) return 'not-due'
  const text = await digestMessage({ now })
  if (!text) return writeState({ ...st, lastDigestDay: day }), 'empty'
  const ok = await sendWithRetry(() => sendAdmin(text), 'daily digest')
  // Not configured counts as handled for today; a real failure is tried again at the next pass.
  if (ok || !(await telegramReady())) writeState({ ...st, lastDigestDay: day })
  return ok ? 'sent' : 'failed'
}
async function telegramReady() {
  if (transport) return true
  const t = await import('./telegram.mjs')
  return t.telegramEnabled() && !!t.adminChatId()
}

let digestTimer = null
/** Starts the 30 s digest clock. Idempotent. */
export function startIntakeDigest() {
  if (digestTimer) return
  digestTimer = setInterval(() => void digestTick().catch((e) => console.error('intake digest:', String(e?.message ?? e).slice(0, 120))), 30_000)
  digestTimer.unref?.()
}

/* -------------------------------------------------------------------- CSV --- */

/** One CSV cell: a leading = + - @ (or tab / CR) gets a single quote so a spreadsheet never runs it as a formula. */
export function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** columns: [[header, (row) => value], ...]. Returns the CSV text with a trailing newline. */
export function toCsv(columns, rows) {
  return [columns.map(([h]) => csvCell(h)).join(','), ...rows.map((r) => columns.map(([, f]) => csvCell(f(r))).join(','))].join('\r\n') + '\r\n'
}

/** Sends a CSV download response (the admin bearer was already checked). */
export function sendCsv(res, filename, text) {
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' })
  res.end('﻿' + text)
  return true
}
