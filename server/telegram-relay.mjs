// Support relay: a visitor taps https://t.me/<bot>?start=chains (or contact, partners, security, pay) or sends
// /contact, writes to the bot, and the Gully Labs team answers from the operators' chat (TELEGRAM_ADMIN_CHAT_ID).
//
//   user -> team   Their private messages (text, or a photo / document with a caption) are sent to the admin chat as
//                  ONE new message: a header (topic, name, @username, id, "Reply to this message to answer") and the
//                  text. The admin message id is mapped to the user's chat (DATA_DIR/tg-relay.json, 5 000 entries,
//                  30-day TTL).
//   team -> user   A REPLY (reply_to_message) to such a message, sent in the admin chat, goes to the user as plain
//                  text, photo or document prefixed "Gully Labs team:", and the admin chat gets a "✓ Sent" ack.
//                  Only replies from the admin chat are relayed; everything else there is ignored (except /block).
//   limits         Open for 24 h of inactivity, or until Done / Cancel / /cancel. 10 messages per 10 minutes per user,
//                  2 000 characters per message. /block <user id> (or /block as a reply) in the admin chat stops
//                  relaying for that user; /unblock undoes it. User text is only ever sent as Telegram text.
//   groups         Private chats only: /contact in a group answers with a deep link.
//
// This runs BEFORE the News channel gate (support is never gated). handle(u) returns true when it consumed the update.

import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './http.mjs'
import * as ui from './telegram-ui.mjs'

const FILE = path.join(DATA_DIR, 'tg-relay.json')
const OPEN_MS = 24 * 3_600_000
const MAP_TTL_MS = 30 * 86_400_000
const MAP_CAP = 5_000
const RATE_MAX = 10
const RATE_WINDOW_MS = 10 * 60_000
export const MAX_USER_TEXT = 2_000
const MAX_CAPTION_BODY = 600 // header + caption must fit Telegram's 1 024-character caption cap
const MAX_REPLY = 3_800
export const TOPICS = { chains: 'Chains', contact: 'Contact', partners: 'Partners', security: 'Security', pay: 'Gully Pay' }
const TOPIC_RE = /^(chains|contact|partners|security|pay)$/i
export const PROMPT = 'Write your message; the Gully Labs team reads every one and replies here.'
export const PREFIX = 'Gully Labs team:'
const DONE = 'rly:x'

let db = { map: {}, open: {}, blocked: [] } // map: adminMsgId -> { c: chatId, u: userId, t }; open: chatId -> { topic, last, u, sent }
try {
  const j = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  db = { map: j.map ?? {}, open: j.open ?? {}, blocked: Array.isArray(j.blocked) ? j.blocked.map(String) : [] }
} catch {
  /* first run */
}

function save() {
  const now = Date.now()
  for (const [k, v] of Object.entries(db.map)) if (now - v.t > MAP_TTL_MS) delete db.map[k]
  const keys = Object.keys(db.map)
  for (const k of keys.slice(0, Math.max(0, keys.length - MAP_CAP))) delete db.map[k]
  for (const [k, v] of Object.entries(db.open)) if (now - v.last > 2 * OPEN_MS) delete db.open[k]
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(db))
    fs.renameSync(FILE + '.tmp', FILE)
  } catch (e) {
    console.error('telegram relay save:', e?.message ?? e)
  }
}

const rate = new Map() // userId -> { list: [times], warned }
function rateOk(userId) {
  const now = Date.now()
  const s = rate.get(userId) ?? { list: [], warned: 0 }
  s.list = s.list.filter((t) => now - t < RATE_WINDOW_MS)
  rate.set(userId, s)
  if (s.list.length >= RATE_MAX) {
    if (now - s.warned < RATE_WINDOW_MS) return 'drop'
    s.warned = now
    return 'warn'
  }
  s.list.push(now)
  return 'ok'
}
const groupHint = new Map() // chatId -> time of the last "message me privately"

/** Test hooks. */
export const relayStateForTest = () => ({ map: { ...db.map }, open: { ...db.open }, blocked: [...db.blocked] })
export function ageConversationForTest(chatId, ms) {
  if (db.open[String(chatId)]) db.open[String(chatId)].last -= ms
}

const nameOf = (from) => [from?.first_name, from?.last_name].filter(Boolean).join(' ') || 'Unknown'

/**
 * @param {{ send: (chatId: string|number, method: string, body: object) => Promise<{ ok: boolean, result: any, error: string|null }>,
 *           tg: (method: string, body: object) => Promise<any>, adminChatId: () => string|null, botUsername: () => Promise<string|null> }} deps
 */
export function createRelay({ send, tg, adminChatId, botUsername }) {
  const esc = ui.esc
  const text = (chatId, t, extra = {}) => send(chatId, 'sendMessage', { text: t, disable_web_page_preview: true, ...extra })
  const doneKb = (label) => ({ inline_keyboard: [[{ text: label, callback_data: DONE }]] })

  async function startMode(msg, topic) {
    const chatId = String(msg.chat.id)
    const userId = String(msg.from?.id ?? chatId)
    if (db.blocked.includes(userId)) return
    if (!adminChatId()) return void (await text(chatId, 'Messaging the team is not available right now. Please try again later.'))
    ui.setState(chatId, { pending: null })
    db.open[chatId] = { topic, last: Date.now(), u: userId, sent: 0 }
    save()
    await text(chatId, PROMPT, { reply_markup: doneKb('Cancel') })
  }

  function closeMode(chatId) {
    const had = !!db.open[chatId]
    delete db.open[chatId]
    if (had) save()
    return had
  }

  /** A user message in an open conversation: forward to the admin chat. */
  async function toTeam(msg, conv) {
    const chatId = String(msg.chat.id)
    const userId = String(msg.from.id)
    const admin = adminChatId()
    const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo.at(-1).file_id : null
    const doc = msg.document?.file_id ?? null
    const body = String(msg.text ?? msg.caption ?? '')
    if (!body.trim() && !photo && !doc) return void (await text(chatId, 'Send text, a photo or a document.'))
    if (body.length > MAX_USER_TEXT) return void (await text(chatId, `That message is too long (${MAX_USER_TEXT} characters at most). Please shorten it or split it.`))
    const rl = rateOk(userId)
    if (rl === 'warn') return void (await text(chatId, 'You are sending messages very quickly. Please wait a few minutes before writing again.'))
    if (rl === 'drop') return
    const header = [
      `📨 <b>Support · ${esc(TOPICS[conv.topic] ?? conv.topic)}</b>`,
      `From: ${esc(nameOf(msg.from))}`,
      `${msg.from.username ? '@' + esc(msg.from.username) : 'no username'} · id <code>${esc(userId)}</code>`,
      '<i>Reply to this message to answer.</i>',
    ].join('\n')
    let r
    if (photo || doc) {
      const caption = `${header}${body ? '\n\n' + esc(body.slice(0, MAX_CAPTION_BODY)) : ''}`
      r = await send(admin, photo ? 'sendPhoto' : 'sendDocument', { [photo ? 'photo' : 'document']: photo ?? doc, caption, parse_mode: 'HTML' })
    } else r = await text(admin, `${header}\n\n${esc(body)}`, { parse_mode: 'HTML' })
    if (!r.ok || !r.result?.message_id) return void (await text(chatId, 'Your message could not be delivered. Please try again in a minute.'))
    db.map[String(r.result.message_id)] = { c: chatId, u: userId, t: Date.now() }
    conv.last = Date.now()
    conv.sent = (conv.sent ?? 0) + 1
    save()
    if (conv.sent === 1) await text(chatId, 'Sent ✓ The team will reply here. Keep writing if you like, or tap Done.', { reply_markup: doneKb('Done') })
    else send(chatId, 'setMessageReaction', { message_id: msg.message_id, reaction: [{ type: 'emoji', emoji: '👍' }] }).catch(() => undefined)
  }

  /** The operators' chat: a reply to a relayed message goes to its user; /block and /unblock. Returns true when consumed. */
  async function fromAdmin(msg) {
    const chatId = String(msg.chat.id)
    const cmd = typeof msg.text === 'string' ? msg.text.slice(0, 200).match(/^\/(block|unblock)(?:@\w+)?(?:\s+(\d{1,20}))?\s*$/i) : null
    if (cmd) {
      const entry = db.map[String(msg.reply_to_message?.message_id)]
      const id = cmd[2] ?? entry?.u
      if (!id) {
        await text(chatId, `Usage: /${cmd[1].toLowerCase()} <user id> (or send it as a reply to their message).`)
        return true
      }
      const on = cmd[1].toLowerCase() === 'block'
      db.blocked = db.blocked.filter((x) => x !== id)
      if (on) {
        db.blocked.push(id)
        for (const [c, v] of Object.entries(db.open)) if (v.u === id) delete db.open[c]
      }
      save()
      await text(chatId, on ? `Blocked ${id}. Their messages are no longer relayed.` : `Unblocked ${id}.`)
      return true
    }
    const rt = msg.reply_to_message
    const entry = rt ? db.map[String(rt.message_id)] : null
    if (!entry) return false // anything else in the admin chat is ignored by the relay
    if (db.blocked.includes(entry.u)) {
      await text(chatId, 'That user is blocked. /unblock them first.', { reply_to_message_id: msg.message_id })
      return true
    }
    const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo.at(-1).file_id : null
    const doc = msg.document?.file_id ?? null
    const body = String(msg.text ?? msg.caption ?? '')
    let r
    if (photo || doc) r = await send(entry.c, photo ? 'sendPhoto' : 'sendDocument', { [photo ? 'photo' : 'document']: photo ?? doc, caption: `${PREFIX}${body ? '\n' + body : ''}`.slice(0, 1_000) })
    else if (body.trim()) r = await text(entry.c, `${PREFIX}\n${body.slice(0, MAX_REPLY)}`)
    else {
      await text(chatId, 'Only text, photos and documents are relayed.', { reply_to_message_id: msg.message_id })
      return true
    }
    if (!r.ok) {
      await text(chatId, `Not delivered: ${r.error ?? 'unknown error'}`, { reply_to_message_id: msg.message_id })
      return true
    }
    const conv = db.open[entry.c]
    if (conv) conv.last = Date.now()
    else db.open[entry.c] = { topic: 'contact', last: Date.now(), u: entry.u, sent: 1 }
    save()
    await text(chatId, '✓ Sent', { reply_to_message_id: msg.message_id })
    return true
  }

  /** @returns {Promise<boolean>} true when the update was consumed */
  async function handle(u) {
    const cq = u?.callback_query
    if (cq) {
      if (cq.data !== DONE || cq.message?.chat?.type !== 'private') return false
      const chatId = String(cq.message.chat.id)
      const had = closeMode(chatId)
      await tg('answerCallbackQuery', { callback_query_id: String(cq.id) }).catch(() => undefined)
      if (had) await text(chatId, 'Conversation closed. Send /contact any time to write to us again.')
      return true
    }
    const msg = u?.message
    if (!msg?.chat || !msg.from || msg.from.is_bot) return false
    const chatId = String(msg.chat.id)
    const admin = adminChatId()
    if (admin && chatId === admin) return await fromAdmin(msg)
    const t = typeof msg.text === 'string' ? msg.text.slice(0, 800) : ''
    const cm = t.match(/^\/([a-z_]{1,32})(?:@([A-Za-z0-9_]{3,64}))?(?:\s+([\s\S]*))?$/i)
    if (cm && cm[2]) {
      const name = await botUsername()
      if (!name || cm[2].toLowerCase() !== name.toLowerCase()) return false
    }
    const cmd = cm?.[1].toLowerCase()
    const arg = (cm?.[3] ?? '').trim().split(/\s+/)[0] ?? ''
    if (msg.chat.type !== 'private') {
      if (cmd !== 'contact' && !(cmd === 'start' && TOPIC_RE.test(arg))) return false
      if (Date.now() - (groupHint.get(chatId) ?? 0) < 30_000) return true
      groupHint.set(chatId, Date.now())
      if (groupHint.size > 2_000) groupHint.delete(groupHint.keys().next().value)
      const name = await botUsername()
      const link = name ? `https://t.me/${name}?start=contact` : null
      await text(chatId, `To reach the Gully Labs team, message me privately${link ? `: ${link}` : '.'}`, link ? { reply_markup: { inline_keyboard: [[{ text: 'Message the team', url: link }]] } } : {})
      return true
    }
    if (cmd === 'contact') {
      await startMode(msg, 'contact')
      return true
    }
    if (cmd === 'start' && TOPIC_RE.test(arg)) {
      await startMode(msg, arg.toLowerCase())
      return true
    }
    const conv = db.open[chatId]
    if (cmd === 'cancel') {
      if (!conv) return false
      closeMode(chatId)
      await text(chatId, 'Conversation closed. Send /contact any time to write to us again.')
      return true
    }
    if (cmd) return false // any other command goes to the bot as usual
    if (!conv) return false
    if (Date.now() - conv.last > OPEN_MS) {
      closeMode(chatId)
      await text(chatId, 'That conversation timed out after 24 hours. Send /contact to start a new one.')
      return true
    }
    if (db.blocked.includes(String(msg.from.id))) return true
    if (ui.getState(chatId)?.pending) return false // answering one of the bot's own prompts
    await toTeam(msg, conv)
    return true
  }

  return { handle }
}
