// Gully AI in the single Gully Labs Telegram bot: the pure rules for the four modes (flag AI_TG_MODES=1; NOT yet wired into
// telegram.mjs, which owns the webhook; wiring is the follow-up listed in SPEC.md section 4). Facts from
// https://core.telegram.org/bots/features (read 2026-11-23): privacy mode is ON by default, so a bot in a group sees only
// commands addressed to it (/ask@bot), replies to its own messages and inline messages sent via it, unless it is a group
// admin; bots receive all private-chat messages and all posts of channels they are a member of; command lists can differ per
// BotCommandScope; updates do not say which scope a command came from, so the backend always validates and authorises.
//
//   PERSONAL (private chat): a linked Gully ID gives "my" tools; opt-in memory is per user and OFF by default.
//   GROUPS: answers when asked (/ask@bot q, @bot q, or a reply to the bot); NEVER wallet data (ctx null); settings changed
//           only by a group admin; per-user cooldown + the per-chat caps (5/min, 60/day, as telegram.mjs ASK_CHAT_*).
//   CHANNELS: post-only (digests and alerts a channel owner opts into). Bots DO receive channel posts they are a member of,
//           but a channel has no conversation to answer: questions belong in the linked discussion group or the DM.
//   INLINE: "@bot <query>": one short answer + an "Open in Gully AI" button (never wallet data, never a long answer).

import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../http.mjs'

export const tgModesEnabled = () => String(process.env.AI_TG_MODES ?? '').trim() === '1'
const FILE = () => path.join(process.env.DATA_DIR ?? DATA_DIR, 'tg-group-settings.json')

export const DEFAULT_GROUP = { lang: 'auto', scope: 'gully', projectId: null, perMin: 5, perDay: 60, cooldownS: 20, quiet: false, billing: 'free' }
const LIMITS = { perMin: [1, 5], perDay: [1, 60], cooldownS: [0, 600] } // a group admin can only tighten, never exceed the global caps

const load = () => {
  try {
    return JSON.parse(fs.readFileSync(FILE(), 'utf8'))
  } catch {
    return {}
  }
}
export const groupSettings = (chatId) => ({ ...DEFAULT_GROUP, ...(load()[String(chatId)] ?? {}) })

/** Validates and stores a settings patch. `isAdmin` must come from getChatMember (creator/administrator); never from the message text. */
export function updateGroupSettings(chatId, patch, { isAdmin }) {
  if (!isAdmin) return { ok: false, error: 'Only a group admin can change Gully AI settings.' }
  const cur = groupSettings(chatId)
  const next = { ...cur }
  if ('lang' in patch) next.lang = /^(auto|[a-z]{2}(-[A-Z]{2})?)$/.test(patch.lang) ? patch.lang : cur.lang
  if ('scope' in patch && ['gully', 'project'].includes(patch.scope)) next.scope = patch.scope
  if ('projectId' in patch) next.projectId = /^[a-z0-9][a-z0-9-]{1,40}$/.test(String(patch.projectId)) ? String(patch.projectId) : null
  if ('quiet' in patch) next.quiet = patch.quiet === true
  if ('billing' in patch && ['free', 'group-credits'].includes(patch.billing)) next.billing = patch.billing
  for (const k of Object.keys(LIMITS)) if (k in patch) next[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], Math.floor(Number(patch[k]) || cur[k])))
  if (next.scope === 'project' && !next.projectId) return { ok: false, error: 'Project mode needs a project id.' }
  const db = load()
  db[String(chatId)] = next
  fs.mkdirSync(path.dirname(FILE()), { recursive: true })
  fs.writeFileSync(FILE(), JSON.stringify(db))
  return { ok: true, settings: next }
}

const lastAsk = new Map() // `${chat}:${user}` -> ms
const chatWindow = new Map() // chat -> { minute: [ms], day: day, dayN }
export const resetTgModesForTest = () => (lastAsk.clear(), chatWindow.clear())

/** The group's own caps (set by an admin, never above the global ones): true when this ask may go on, and counts it. */
function takeChatAllowance(chatId, s, now) {
  const w = chatWindow.get(chatId) ?? { minute: [], day: '', dayN: 0 }
  w.minute = w.minute.filter((t) => now - t < 60_000)
  const day = new Date(now).toISOString().slice(0, 10)
  if (w.day !== day) Object.assign(w, { day, dayN: 0 })
  if (w.minute.length >= s.perMin || w.dayN >= s.perDay) return false
  w.minute.push(now)
  w.dayN++
  chatWindow.set(chatId, w)
  if (chatWindow.size > 5000) chatWindow.delete(chatWindow.keys().next().value)
  return true
}

/**
 * What to do with one group message. msg: { chatId, chatType, fromId, text, replyToBot }; bot: username without @.
 * Returns { act: 'ask'|'ignore'|'cooldown'|'limited', question?, settings?, retryAfter? }. ctx is never offered for a group.
 */
export function decideGroupMessage(msg, bot, now = Date.now()) {
  if (!['group', 'supergroup'].includes(msg.chatType)) return { act: 'ignore' }
  const text = String(msg.text ?? '').trim()
  const b = bot.replace(/^@/, '')
  let q = null
  const cmd = text.match(new RegExp(`^/ask@${b}(?:\\s+([\\s\\S]*))?$`, 'i'))
  if (cmd) q = cmd[1] ?? ''
  else if (new RegExp(`^@${b}\\b`, 'i').test(text)) q = text.replace(new RegExp(`^@${b}\\b`, 'i'), '')
  else if (msg.replyToBot && text && !text.startsWith('/')) q = text
  if (q === null) return { act: 'ignore' }
  q = q.replace(/\s+/g, ' ').trim()
  if (!q) return { act: 'ignore' }
  const s = groupSettings(msg.chatId)
  const key = `${msg.chatId}:${msg.fromId}`
  const last = lastAsk.get(key)
  const wait = last === undefined ? 0 : last + s.cooldownS * 1000 - now
  if (wait > 0) return { act: 'cooldown', retryAfter: Math.ceil(wait / 1000), settings: s }
  if (!takeChatAllowance(String(msg.chatId), s, now)) return { act: 'limited', settings: s }
  lastAsk.set(key, now)
  if (lastAsk.size > 5000) lastAsk.delete(lastAsk.keys().next().value)
  return { act: 'ask', question: q, settings: s }
}

/** setMyCommands payloads per scope (all, private chats, group chats, group admins). Telegram does not tell us the scope of a typed command: authorise server-side anyway. */
export function commandScopes() {
  const base = [{ command: 'ask', description: 'Ask Zayden (Gully AI)' }, { command: 'help', description: 'What Zayden can do' }]
  return [
    { scope: { type: 'default' }, commands: base },
    { scope: { type: 'all_private_chats' }, commands: [...base, { command: 'link', description: 'Link your Gully ID' }, { command: 'credits', description: 'Your Gully AI credits' }, { command: 'memory', description: 'Turn chat memory on or off' }, { command: 'menu', description: 'Main menu' }] },
    { scope: { type: 'all_group_chats' }, commands: base },
    { scope: { type: 'all_chat_administrators' }, commands: [...base, { command: 'aisettings', description: 'Gully AI settings for this group' }] },
  ]
}

/** One inline result: a short answer (<= 500 chars, no wallet data) with an "Open in Gully AI" button. */
export function inlineResult(id, question, shortAnswer, openUrl) {
  const text = String(shortAnswer ?? '').slice(0, 500)
  return { type: 'article', id: String(id).slice(0, 64), title: String(question).slice(0, 60), description: text.slice(0, 100), input_message_content: { message_text: `${text}\n\nAI answer from Zayden, Gully AI.` }, reply_markup: { inline_keyboard: [[{ text: 'Open Zayden in Gully AI', url: openUrl }]] } }
}

/** A scheduled channel digest is post-only: it carries facts the caller already read, a footer and no question UI. */
export function channelDigest(lines, footer = 'AI-assisted digest. Information only, not financial advice.') {
  return `${lines.slice(0, 8).map((l) => String(l).slice(0, 200)).join('\n')}\n\n${footer}`
}

/** Parses "/aisettings ..." arguments into a settings patch, or { help }. */
export function parseSettingsArgs(args) {
  const [k, v, w] = String(args ?? '').trim().split(/\s+/)
  if (!k) return { help: true }
  if (k === 'lang') return { patch: { lang: v === 'auto' ? 'auto' : v } }
  if (k === 'scope') return v === 'project' ? { patch: { scope: 'project', projectId: w } } : { patch: { scope: 'gully' } }
  if (k === 'limit') return { patch: { perMin: Number(v), ...(w ? { perDay: Number(w) } : {}) } }
  if (k === 'cooldown') return { patch: { cooldownS: Number(v) } }
  if (k === 'quiet') return { patch: { quiet: v === 'on' } }
  if (k === 'billing') return { patch: { billing: v } }
  return { help: true }
}
