// Who has started @GullyLabsBot in a private chat: the audience for admin broadcasts (telegram-broadcast.mjs).
// Lightweight on purpose: no names, no usernames, no message content.
//
// Stored in DATA_DIR/bot-users.json (written atomically: .tmp then rename):
//   users { [chatId]: { firstSeen, lastSeen, lang, linked, follows, followsAt, blocked: null | { at, reason },
//           optedOut: null | iso, source: 'start' | 'link' } }
//
// A user is recorded when they send /start in a private chat (and backfilled from the private chats already
// linked to an account, see telegram.mjs). lastSeen moves on every private update from a known user (saved at
// most every few seconds). A 403 ("bot was blocked") or 400 ("chat not found") on a broadcast marks the user
// blocked; their next /start clears it. optedOut is set by the "🔕 Stop announcements" button or
// "/stop announcements": broadcasts never go to them again until they switch announcements back on.
// Opting out of announcements never touches alerts.

import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './http.mjs'

const FILE = () => path.join(DATA_DIR, 'bot-users.json')
const TOUCH_SAVE_MS = 5_000

let db
function load() {
  try {
    db = JSON.parse(fs.readFileSync(FILE(), 'utf8'))
  } catch {
    db = {}
  }
  if (!db.users || typeof db.users !== 'object') db.users = {}
}
load()

let dirtyTimer = null
function save() {
  clearTimeout(dirtyTimer)
  dirtyTimer = null
  try {
    fs.mkdirSync(path.dirname(FILE()), { recursive: true })
    fs.writeFileSync(FILE() + '.tmp', JSON.stringify(db))
    fs.renameSync(FILE() + '.tmp', FILE())
  } catch (e) {
    console.error('bot-users save:', e?.message ?? e)
  }
}
function saveSoon() {
  if (dirtyTimer) return
  dirtyTimer = setTimeout(save, TOUCH_SAVE_MS)
  dirtyTimer.unref?.()
}

const isPrivateId = (chatId) => /^\d{1,20}$/.test(String(chatId ?? ''))
const langOf = (from) => {
  const l = String(from?.language_code ?? '').toLowerCase().slice(0, 2)
  return /^[a-z]{2}$/.test(l) ? l : null
}

/** The stored record of a private chat, or null. */
export const botUser = (chatId) => db.users[String(chatId)] ?? null

/** /start in a private chat: creates the user (or updates the visit), clears a blocked flag. */
export function recordStart(chatId, from, { linked } = {}) {
  const id = String(chatId)
  if (!isPrivateId(id)) return null
  const now = new Date().toISOString()
  const u = db.users[id] ?? { firstSeen: now, lastSeen: now, lang: null, linked: false, follows: null, followsAt: null, blocked: null, optedOut: null, source: 'start' }
  u.lastSeen = now
  u.lang = langOf(from) ?? u.lang
  if (linked !== undefined) u.linked = !!linked
  u.blocked = null
  db.users[id] = u
  save()
  return u
}

/** Any private update from a known user: moves lastSeen (saved a few seconds later). */
export function touchUser(chatId, from) {
  const u = botUser(chatId)
  if (!u) return null
  u.lastSeen = new Date().toISOString()
  u.lang = langOf(from) ?? u.lang
  if (u.blocked) u.blocked = null // they wrote to the bot: not blocking it any more
  saveSoon()
  return u
}

/** The News channel membership the gate last read for a user (a real answer only, never the fail-open). */
export function setFollows(userId, follows) {
  const u = botUser(userId)
  if (!u) return
  // Funnel: someone who was shown the join screen and now follows has joined.
  if (follows && u.gateShownAt && !u.joinedAt) {
    u.joinedAt = new Date().toISOString()
    saveSoon()
  }
  if (u.follows === !!follows) return
  u.follows = !!follows
  u.followsAt = new Date().toISOString()
  saveSoon()
}

/* The News gate funnel: join screen shown -> joined -> first command after joining. Counts only, no content.
   A non-follower also gets a few free actions before the join screen (telegram.mjs gate()). */
const ensureUser = (chatId) => {
  const id = String(chatId)
  if (!isPrivateId(id)) return null
  const now = new Date().toISOString()
  return (db.users[id] ??= { firstSeen: now, lastSeen: now, lang: null, linked: false, follows: null, followsAt: null, blocked: null, optedOut: null, source: 'start' })
}
/** The join screen was shown to this private chat (first time only is recorded). */
export function noteGateShown(chatId) {
  const u = ensureUser(chatId)
  if (!u) return
  u.gateViews = (u.gateViews ?? 0) + 1
  u.gateShownAt ??= new Date().toISOString()
  saveSoon()
}
/** A follower used a feature: the first one after the join screen closes the funnel. */
export function noteFirstUse(chatId) {
  const u = botUser(chatId)
  if (!u || !u.gateShownAt || u.firstUseAt) return
  if (!u.joinedAt) u.joinedAt = new Date().toISOString()
  u.firstUseAt = new Date().toISOString()
  saveSoon()
}
/** Spends one of a non-follower's free actions; false when they are used up (or `limit` is 0). */
export function takeFreeAction(chatId, limit) {
  if (!(limit > 0)) return false
  const u = ensureUser(chatId)
  if (!u || (u.freeUsed ?? 0) >= limit) return false
  u.freeUsed = (u.freeUsed ?? 0) + 1
  saveSoon()
  return true
}

export function setLinked(chatId, linked) {
  const u = botUser(chatId)
  if (!u || u.linked === !!linked) return
  u.linked = !!linked
  save()
}

/** A broadcast was refused for good (403 blocked, 400 chat not found): skipped from now on. */
export function markBlocked(chatId, reason) {
  const u = botUser(chatId)
  if (!u) return
  u.blocked = { at: new Date().toISOString(), reason: String(reason ?? '').slice(0, 120) }
  save()
}

/** Announcements off (true) or back on (false). Creates the record for a private chat that never sent /start. */
export function setOptOut(chatId, out, from = null) {
  const id = String(chatId)
  if (!isPrivateId(id)) return null
  const now = new Date().toISOString()
  const u = db.users[id] ?? { firstSeen: now, lastSeen: now, lang: langOf(from), linked: false, follows: null, followsAt: null, blocked: null, optedOut: null, source: 'start' }
  u.optedOut = out ? (u.optedOut ?? now) : null
  db.users[id] = u
  save()
  return u
}

/** Backfill from the private chats linked to an account (first seen = when it was linked). Idempotent. */
export function backfillFromLinks(links) {
  let n = 0
  for (const l of links ?? []) {
    if (l?.chatType !== 'private' || !isPrivateId(l.chatId)) continue
    const u = db.users[l.chatId]
    if (u) {
      if (!u.linked) ((u.linked = true), n++)
      continue
    }
    const at = Number.isFinite(Date.parse(l.linkedAt)) ? l.linkedAt : new Date().toISOString()
    db.users[l.chatId] = { firstSeen: at, lastSeen: at, lang: null, linked: true, follows: null, followsAt: null, blocked: null, optedOut: null, source: 'link' }
    n++
  }
  if (n) save()
  return n
}

/** Every recorded user as [chatId, record]. */
export const allBotUsers = () => Object.entries(db.users)

/** The join-screen funnel: users shown the screen, those who then joined, those who then used the bot. */
export function gateFunnel(list = Object.values(db.users)) {
  const shown = list.filter((u) => u.gateShownAt)
  const joined = shown.filter((u) => u.joinedAt)
  const used = joined.filter((u) => u.firstUseAt)
  const free = list.filter((u) => (u.freeUsed ?? 0) > 0).length
  return { freeActionUsers: free, shown: shown.length, joined: joined.length, used: used.length, joinRate: shown.length ? Math.round((joined.length / shown.length) * 1000) / 10 : null }
}

/** Counts and the daily growth series (users by first-seen day, cumulative). */
export function botUserStats() {
  const list = Object.values(db.users)
  const byDay = new Map()
  for (const u of list) {
    const d = String(u.firstSeen ?? '').slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) byDay.set(d, (byDay.get(d) ?? 0) + 1)
  }
  let total = 0
  const growth = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, n]) => ({ day, added: n, total: (total += n) }))
  const languages = {}
  for (const u of list) if (u.lang) languages[u.lang] = (languages[u.lang] ?? 0) + 1
  return {
    users: list.length,
    optedOut: list.filter((u) => u.optedOut).length,
    blocked: list.filter((u) => u.blocked).length,
    linked: list.filter((u) => u.linked).length,
    follows: list.filter((u) => u.follows === true).length,
    gate: gateFunnel(list),
    growth,
    languages: Object.entries(languages).sort((a, b) => b[1] - a[1]).map(([lang, count]) => ({ lang, count })),
  }
}

/** Tests: flush pending writes and read the store from disk again, as a restarted server would. */
export function reloadBotUsersForTest() {
  if (dirtyTimer) save()
  load()
}
/** Tests and e2e: add users directly (chatId -> partial record). */
export function seedBotUsersForTest(entries) {
  const now = new Date().toISOString()
  for (const [id, rec] of Object.entries(entries)) db.users[id] = { firstSeen: now, lastSeen: now, lang: null, linked: false, follows: null, followsAt: null, blocked: null, optedOut: null, source: 'start', ...rec }
  save()
}
/** Flushes a pending lastSeen write now (shutdown, tests). */
export const flushBotUsers = () => dirtyTimer && save()
