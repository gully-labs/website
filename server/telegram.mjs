// The Gully Labs Telegram bot: a menu-driven bot (buttons, one message edited in place per screen) for
// the gap tracker, DeepCore launches, gap alerts to a linked chat and Gully AI. Views and keyboards live
// in telegram-ui.mjs; this file talks to the Bot API, reads the data and routes updates.
// No dependency: the Bot API over fetch. Everything is off unless TELEGRAM_BOT_TOKEN is set.
//
// Env
//   TELEGRAM_BOT_TOKEN       the token from @BotFather. Never logged; redacted from every error text.
//   TELEGRAM_WEBHOOK_SECRET  optional: the secret Telegram sends back in X-Telegram-Bot-Api-Secret-Token.
//                            Default: derived from the token (HMAC), so one variable is enough.
//   TELEGRAM_API             optional, tests only: the Bot API base URL (default https://api.telegram.org).
//   TELEGRAM_MINIAPP_URL     optional: the Mini App's https URL (default https://gullylabs.xyz/tg).
//   TELEGRAM_ADMIN_CHAT_ID   optional: the operators' chat for admin alerts (sendAdminTelegram; the fee-proxy monitor).
//
// Updates arrive by webhook: POST /api/telegram/<path>, where <path> is the first 32 hex of
// sha256(token) and the secret header must match. On start (startTelegram) the server calls setWebhook
// for https://gullylabs.xyz/api/telegram/<path> (allowed_updates message + callback_query), setMyCommands
// per scope (private chats: start, app, gap, top, movers, launches, alerts, ask, help, stop; groups: gap,
// top, launches, help; the default scope gets the private list), setChatMenuButton { type: 'commands' } so
// the Menu button next to the text box lists those commands, and getMe; failures are logged (without the
// token) and retried, never fatal. The Mini App opens from the "📱 Open app" inline web_app button on the
// main menu (private chats only: Telegram refuses web_app buttons in groups), from /app, and from the bot
// profile's "Open app" button once the owner sets it in BotFather (Bot Settings → Configure Mini App; the
// admin dashboard's Broadcasts card has the steps). The Mini App's own API (initData validation, the
// channel gate, the linked account's alerts) is telegram-miniapp.mjs.
//
// Bot users (telegram-users.mjs, DATA_DIR/bot-users.json): every private /start is recorded (first and
// last seen, language, linked, News channel membership as last read, blocked, opted out of announcements),
// and the private chats already linked are backfilled. Admin broadcasts (telegram-broadcast.mjs) go to them
// only. "🔕 Stop announcements" (callback bco, on every broadcast) and "/stop announcements" opt a user out
// of broadcasts, never of alerts; Settings switches announcements back on (san:1).
//
// Linking (no chat ids to paste): the dashboard asks for a one-time code (10 minutes, single use, only
// its SHA-256 is stored) and opens https://t.me/<bot>?start=<code>. "/start <code>" links that chat to the
// wallet account; "/stop" or Settings → Unlink unlinks. A group is linked the same way; only the Telegram
// user who linked a group may unlink it, create alerts there, or pause, mute, test or delete them.
// One chat per account; a newer link replaces the older one.
//
// /start without a code sends the banner (an H.264 MP4 animation, public/brand/telegram/banner.mp4, with
// banner.gif as the fallback, both built from the brand kit by scripts/build-telegram-banner.mjs) with the
// main menu. Telegram's file_id for it is kept in DATA_DIR/telegram.json after the first upload, keyed on
// the file's hash, and reused until the file changes. Screens: Stocks (chain → ticker grid → card
// with a 24h sparkline → alert stepper), Top gaps, Movers (24h/1h), DeepCore launches (chain filter →
// launch card, new-launch alert), My alerts (pause, resume, mute, test, delete), Gully AI (force_reply)
// and Settings (mute all, usage notices, unlink). The routes and their callback encoding are listed at
// the top of telegram-ui.mjs. Typed commands (/gap /top /movers /launches /alerts /ask /stop /help /menu)
// answer with the matching screen.
//
// Alerts are created, paused, resumed, tested and deleted through alerts.mjs's own route handler
// (handleAlerts) for the linked account, so the bot has exactly the dashboard's validation, plan
// limits and channel defaults (Telegram on, no webhook). Usage notices go through profile.mjs's route.
//
// Everything is HTML parse mode with every dynamic piece escaped. A figure that could not be read is
// said to be unreadable, never shown as zero.
//
// Sending and editing respect Telegram's limits: at most one call a second per chat, 30 a second
// overall, and a 429's retry_after is waited out (up to 60 s, three attempts). Commands, button presses
// and replies are limited per chat as well.
//
// Stored in DATA_DIR/telegram.json: { links: [...], codes: [...], banner: { fileId, sha } }.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { DATA_DIR, json, readJson } from './http.mjs'
import { alertsOf, handleAlerts, muteAlert } from './alerts.mjs'
import { getAccount, randomToken, sha256 } from './store.mjs'
import * as tracker from './tracker.mjs'
import { askConfigured, askForChat, MAX_QUESTION } from './ask.mjs'
import { DEEPCORE_CHAINS, readDeepcorePool, readLaunches } from './deepcore.mjs'
import { handleProfileRoutes, profileOf } from './profile.mjs'
import { workspaceName } from './workspaces.mjs'
import * as ui from './telegram-ui.mjs'
import { backfillFromLinks, botUser, recordStart, setFollows, setLinked, setOptOut, touchUser } from './telegram-users.mjs'

const { chainName, shortAddr, btn, ubtn } = ui

/** HTML-escapes text for Telegram's HTML parse mode. */
export const esc = ui.esc

const FILE = path.join(DATA_DIR, 'telegram.json')
const SITE = ui.SITE
const CODE_TTL_MS = 10 * 60_000
const PER_CHAT_MS = 1_000
const GLOBAL_PER_S = 30
const MAX_RETRY_AFTER_S = 60
const TIMEOUT_MS = 10_000
const MAX_TEXT = 3_800 // Telegram's cap is 4096 characters after entities are parsed
const MAX_CAPTION = 1_000 // Telegram's caption cap is 1024
const MAX_UPDATE_BYTES = 64_000
const MUTE_MS = 24 * 3_600_000
const BANNER_URL = `${SITE}/brand/telegram/banner.mp4`

/* ---------------------------------------------------------------- store --- */

let db
try {
  db = JSON.parse(fs.readFileSync(FILE, 'utf8'))
} catch {
  db = {}
}
db.links ??= [] // { address, chatId, chatType, chatTitle, linkedBy, linkedAt }
db.codes ??= [] // { hash, address, expiresAt, usedAt }
db.banner ??= null // { fileId, sha } Telegram's file_id of the uploaded banner, and the hash of the file it came from
backfillFromLinks(db.links) // private chats linked before bot-users.json existed are bot users too

function save() {
  const now = Date.now()
  db.codes = db.codes.filter((c) => Date.parse(c.expiresAt) > now - 86_400_000)
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(db))
    fs.renameSync(FILE + '.tmp', FILE)
  } catch (e) {
    console.error('telegram save:', e?.message ?? e)
  }
}

/** The chat linked to a wallet account, or null. */
export const linkedChat = (address) => db.links.find((l) => l.address === address) ?? null
const linkOfChat = (chatId) => db.links.find((l) => l.chatId === String(chatId)) ?? null

/**
 * The link a Telegram user acts through in the Mini App: their private chat with the bot when it is
 * linked (a private chat's id is the user's id), else a group they linked themselves. Null when neither.
 */
export function linkForTelegramUser(userId) {
  const id = String(userId ?? '')
  if (!/^\d{1,20}$/.test(id)) return null
  return db.links.find((l) => l.chatType === 'private' && l.chatId === id) ?? db.links.find((l) => l.linkedBy === id) ?? null
}

/* ---------------------------------------------------------------- config --- */

/** The bot token when it is set and well formed, else null (and the bot is off). */
export function telegramToken() {
  const t = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim()
  return /^\d+:[\w-]{20,}$/.test(t) ? t : null
}
export const telegramEnabled = () => !!telegramToken()

function apiBase() {
  const raw = String(process.env.TELEGRAM_API ?? '').trim()
  if (!raw) return 'https://api.telegram.org'
  try {
    const u = new URL(raw)
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin + u.pathname.replace(/\/+$/, '')
  } catch {
    /* fall through */
  }
  return 'https://api.telegram.org'
}

/** The webhook path segment: first 32 hex of sha256(token). */
export const webhookPathFor = (token) => sha256(String(token)).slice(0, 32)
/** The X-Telegram-Bot-Api-Secret-Token value: env, or derived from the token. */
export function webhookSecretFor(token) {
  const env = String(process.env.TELEGRAM_WEBHOOK_SECRET ?? '').trim()
  if (/^[A-Za-z0-9_-]{16,256}$/.test(env)) return env
  return crypto.createHmac('sha256', String(token)).update('gully-telegram-webhook').digest('hex').slice(0, 48)
}

/** Removes the token from any text before it is logged or shown. */
function redact(s) {
  const t = telegramToken()
  let out = String(s ?? '')
  if (t) out = out.split(t).join('<token>')
  return out.replace(/bot\d+:[\w-]{20,}/g, 'bot<token>').slice(0, 200)
}

/* ------------------------------------------------------------- Bot API --- */

/**
 * One Bot API call. `body` is JSON, or a FormData for a file upload.
 * Returns { ok, status, result, retryAfter, error }; never throws.
 */
async function tg(method, body) {
  const token = telegramToken()
  if (!token) return { ok: false, status: null, result: null, retryAfter: null, error: 'Telegram is not configured on the server.' }
  try {
    const form = body instanceof FormData
    const r = await fetch(`${apiBase()}/bot${token}/${method}`, { method: 'POST', headers: form ? {} : { 'content-type': 'application/json' }, body: form ? body : JSON.stringify(body ?? {}), redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
    const j = await r.json().catch(() => null)
    const ok = r.ok && !!j?.ok
    return { ok, status: r.status, result: ok ? j.result : null, retryAfter: Number(j?.parameters?.retry_after) || null, error: ok ? null : redact(j?.description ?? `HTTP ${r.status}`) }
  } catch (e) {
    return { ok: false, status: null, result: null, retryAfter: null, error: redact(e?.name === 'TimeoutError' ? `timed out after ${TIMEOUT_MS / 1000} s` : (e?.message ?? e)) }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const chatTail = new Map() // chatId -> promise of the last queued call
const chatNextAt = new Map() // chatId -> earliest time of its next call
const globalSent = [] // call times within the last second
const grants = [] // the last 1000 { chatId, at } turns granted (tests read the spacing here, not at the network)

async function waitTurn(chatId) {
  for (;;) {
    const now = Date.now()
    while (globalSent.length && now - globalSent[0] >= 1_000) globalSent.shift()
    const w = Math.max((chatNextAt.get(chatId) ?? 0) - now, globalSent.length >= GLOBAL_PER_S ? 1_000 - (now - globalSent[0]) : 0)
    if (w <= 0) {
      globalSent.push(now)
      chatNextAt.set(chatId, now + PER_CHAT_MS)
      grants.push({ chatId, at: now })
      if (grants.length > 1_000) grants.shift()
      return
    }
    await sleep(w)
  }
}

/**
 * Runs one message-like call (send or edit) for a chat through the per-chat queue, honouring 429
 * retry_after. `make()` builds the request body afresh for each attempt (a FormData is single-use).
 */
function queued(chatId, method, make) {
  const key = String(chatId)
  const prev = chatTail.get(key) ?? Promise.resolve()
  const run = prev.then(async () => {
    let r
    for (let attempt = 0; attempt < 3; attempt++) {
      await waitTurn(key)
      r = await tg(method, make())
      if (r.status !== 429) return r
      if (!r.retryAfter || r.retryAfter > MAX_RETRY_AFTER_S) return r
      chatNextAt.set(key, Date.now() + r.retryAfter * 1_000)
    }
    return r
  })
  const tail = run.catch(() => undefined)
  chatTail.set(key, tail)
  tail.then(() => chatTail.get(key) === tail && chatTail.delete(key))
  return run
}
const sendToChat = (chatId, method, body) => queued(chatId, method, () => ({ chat_id: String(chatId), ...body }))

const cap = (s, max = MAX_TEXT) => (s.length > max ? s.slice(0, max).replace(/<[^>]*$/, '') + '…' : s)
const sendText = (chatId, text, extra = {}) => sendToChat(chatId, 'sendMessage', { text: cap(text), parse_mode: 'HTML', disable_web_page_preview: true, ...extra })
const markup = (keyboard) => ({ inline_keyboard: keyboard })

const NOT_MODIFIED = /message is not modified/i

/**
 * Shows a view: edits message `editId` in place when given, else sends a new message. "Not modified"
 * is quiet success; any other failed edit (deleted, too old, not a text message) sends a new message.
 * @returns {Promise<{ ok: boolean, id: number | null, notModified?: boolean }>}
 */
async function show(chatId, view, editId = null) {
  view = { ...view, keyboard: keyboardFor(chatId, view.keyboard) }
  if (editId) {
    const r = await sendToChat(chatId, 'editMessageText', { message_id: editId, text: cap(view.text), parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: markup(view.keyboard) })
    if (r.ok) return { ok: true, id: editId }
    if (NOT_MODIFIED.test(r.error ?? '')) return { ok: true, id: editId, notModified: true }
  }
  const r = await sendText(chatId, view.text, { reply_markup: markup(view.keyboard) })
  return { ok: r.ok, id: r.result?.message_id ?? null }
}

/* ------------------------------------------------------------ bot info --- */

let me = { token: null, username: null, at: 0 }

/** The bot's @username, read once with getMe (retried at most once a minute while unknown). */
export async function botUsername() {
  const token = telegramToken()
  if (!token) return null
  if (me.token !== token || (!me.username && Date.now() - me.at > 60_000)) {
    me = { token, username: null, at: Date.now() }
    const r = await tg('getMe')
    if (r.ok && typeof r.result?.username === 'string') me.username = r.result.username
  }
  return me.username
}
const botId = () => telegramToken()?.split(':')[0] ?? null

/** For the dashboard: whether the bot is on, its name, and the account's linked chat. */
export async function telegramInfo(address) {
  if (!telegramEnabled()) return { enabled: false, bot: null, linked: null }
  const l = address ? linkedChat(address) : null
  return { enabled: true, bot: await botUsername(), linked: l ? { chatType: l.chatType, chatTitle: l.chatTitle, linkedAt: l.linkedAt } : null }
}

/** GET /api/alerts/channels: which delivery channels this server offers. Public. */
export async function alertChannels() {
  const on = telegramEnabled()
  return { webhook: { enabled: true }, telegram: on ? { enabled: true, bot: await botUsername() } : { enabled: false, bot: null, reason: 'Telegram delivery is not configured on this server.' } }
}

/* -------------------------------------------------------------- startup --- */

// The commands people see behind the Menu button: short, plain words, one emoji first. /menu still works when
// typed; it is the same screen as /start's menu, so the list shows /start only.
const COMMANDS = {
  start: '🏠 Main menu',
  app: '📱 Open the Gully app inside Telegram',
  gap: '📈 One stock token, e.g. /gap NVDA',
  top: '🔥 Furthest from the real share price',
  movers: '🚀 Biggest gap moves in 24 hours',
  launches: '🛰 Newest tokens launched on DeepCore',
  alerts: '🔔 Your alerts: pause, mute, test or delete',
  ask: '🤖 Ask Gully AI a question',
  help: '❓ What this bot does',
  stop: '🔕 Stop announcements, or unlink this chat',
}
const SCOPE_COMMANDS = {
  private: ['start', 'app', 'gap', 'top', 'movers', 'launches', 'alerts', 'ask', 'help', 'stop'],
  group: ['gap', 'top', 'launches', 'help'],
}
/** The command list for one scope ('private' or 'group'). */
export const commandList = (scope = 'private') => SCOPE_COMMANDS[scope].map((command) => ({ command, description: COMMANDS[command] }))
/** Every setMyCommands call startup makes: the default scope and private chats get the full list, groups the short one. */
export const commandScopes = () => [
  { commands: commandList('private') },
  { commands: commandList('private'), scope: { type: 'all_private_chats' } },
  { commands: commandList('group'), scope: { type: 'all_group_chats' } },
]

/** The Mini App's URL: TELEGRAM_MINIAPP_URL when it is a well-formed https URL, else gullylabs.xyz/tg. */
export function miniAppUrl() {
  const raw = String(process.env.TELEGRAM_MINIAPP_URL ?? '').trim()
  try {
    const u = new URL(raw)
    if (u.protocol === 'https:' && !u.username && !u.password) return u.toString()
  } catch {
    /* default */
  }
  return `${SITE}/tg`
}

/** The chat menu button: the command list (the Mini App opens from "📱 Open app", /app and the bot profile). */
export const menuButton = () => ({ type: 'commands' })

/** The main menu keyboard for one chat: private chats get the "📱 Open app" web_app row on top. */
function keyboardFor(chatId, kb) {
  if (kb !== ui.MENU_KEYBOARD || !(Number(chatId) > 0)) return kb
  return [[ui.appBtn(miniAppUrl())], ...kb]
}

let startTimer = null

/** Registers the webhook, the command list and the menu button. Safe to call more than once; never throws. */
export async function startTelegram({ attempt = 0 } = {}) {
  const token = telegramToken()
  if (!token) {
    if (process.env.TELEGRAM_BOT_TOKEN) console.error('telegram: TELEGRAM_BOT_TOKEN is malformed; the bot is off')
    return { ok: false, enabled: false }
  }
  const url = `${SITE}/api/telegram/${webhookPathFor(token)}`
  const hook = await tg('setWebhook', { url, secret_token: webhookSecretFor(token), allowed_updates: ['message', 'callback_query'], max_connections: 10 })
  let cmds = { ok: true, error: null }
  for (const body of commandScopes()) {
    const r = await tg('setMyCommands', body)
    if (!r.ok) cmds = { ok: false, error: `${body.scope?.type ?? 'default'}: ${r.error}` }
  }
  const menuBtn = await tg('setChatMenuButton', { menu_button: menuButton() })
  const name = await botUsername()
  if (!hook.ok) console.error(`telegram: setWebhook failed: ${hook.error}`)
  if (!cmds.ok) console.error(`telegram: setMyCommands failed: ${cmds.error}`)
  if (!menuBtn.ok) console.error(`telegram: setChatMenuButton failed: ${menuBtn.error}`)
  if (hook.ok) console.log(`telegram: webhook set${name ? ` for @${name}` : ''}`)
  if ((!hook.ok || !cmds.ok || !menuBtn.ok) && attempt < 5) {
    clearTimeout(startTimer)
    startTimer = setTimeout(() => startTelegram({ attempt: attempt + 1 }), 60_000 * (attempt + 1))
    startTimer.unref?.()
  }
  return { ok: hook.ok && cmds.ok, enabled: true }
}

/* -------------------------------------------------------- account sends --- */

/**
 * Plain-text notice to an account's linked chat (usage thresholds and similar, from activity.mjs).
 * The text is escaped here, so callers pass plain text. Never throws.
 * @returns {Promise<{ ok: boolean, status: number | null, error: string | null }>}
 */
export async function sendAccountTelegram(address, text) {
  if (!telegramEnabled()) return { ok: false, status: null, error: 'Telegram is not configured on the server.' }
  const chatId = linkedChat(String(address ?? '').toLowerCase())?.chatId ?? linkedChat(address)?.chatId ?? null
  if (!chatId) return { ok: false, status: null, error: 'No Telegram chat is linked to this account.' }
  const r = await sendText(chatId, `<b>Gully Labs</b>
${esc(String(text ?? ''))}`)
  return { ok: r.ok, status: r.status ?? null, error: r.error ?? null }
}

/** The operators' chat for admin alerts (TELEGRAM_ADMIN_CHAT_ID: a numeric chat id, groups negative), or null. */
export function adminChatId() {
  const v = String(process.env.TELEGRAM_ADMIN_CHAT_ID ?? '').trim()
  return /^-?\d{1,20}$/.test(v) ? v : null
}

/**
 * Plain-text admin alert to the operators' chat (fee-proxy monitor and similar). Escaped here. Never throws.
 * @returns {Promise<{ ok: boolean, status: number | null, error: string | null }>}
 */
export async function sendAdminTelegram(text) {
  if (!telegramEnabled()) return { ok: false, status: null, error: 'Telegram is not configured on the server.' }
  const chatId = adminChatId()
  if (!chatId) return { ok: false, status: null, error: 'TELEGRAM_ADMIN_CHAT_ID is not set.' }
  try {
    const r = await sendText(chatId, `<b>Gully Labs admin alert</b>
${esc(String(text ?? ''))}`)
    return { ok: r.ok, status: r.status ?? null, error: r.error ?? null }
  } catch (e) {
    return { ok: false, status: null, error: redact(e?.message ?? e) }
  }
}

/* ---------------------------------------------------------- alert sends --- */

/**
 * Sends one alert delivery to Telegram as a compact card. Called by alerts.mjs.
 * @param {{ owner: string, alertId: string, name: string | null, conditionText: string, chatId?: string | null, events: object[], test: boolean }} a
 */
export async function sendAlertTelegram(a) {
  if (!telegramEnabled()) return { status: null, ok: false, error: 'Telegram is not configured on the server.' }
  const chatId = a.chatId ?? linkedChat(a.owner)?.chatId ?? null
  if (!chatId) return { status: null, ok: false, error: 'No Telegram chat is linked to this account.' }
  const v = ui.deliveryView(a)
  const r = await sendText(chatId, v.text, v.keyboard ? { reply_markup: markup(v.keyboard) } : {})
  return { status: r.status, ok: r.ok, error: r.error }
}

/* ----------------------------------------------------------- data reads --- */

let readRows = async () => {
  const body = await tracker.readTracker()
  const chains = Object.fromEntries((body?.chains ?? []).map((c) => [c.key, c]))
  return (body?.rows ?? []).map((r) => ({ ...r, sessionOpen: chains[r.chain]?.sessionOpen ?? null, sessionName: chains[r.chain]?.sessionName ?? null, asOf: body.generatedAt ?? null }))
}
let readMoversFn = (window) => tracker.readMovers(window)
let readHistoryFn = (chain, ticker) => tracker.readHistory(chain, ticker)
let readLaunchesFn = (o) => readLaunches(o)
/** Price and market cap of one launch (readDeepcorePool's match), or null: the launch card shows them when DeepCore states them. */
let readLaunchMarketFn = async (l) => (await readDeepcorePool({ token: l.token, chain: l.chainId }))?.matches?.[0] ?? null
/** Gully AI's "my" tools in Telegram: only a private chat linked to a wallet, and only that link's workspace. */
const askCtxOf = (chatId) => {
  const l = linkOfChat(chatId)
  return l && l.chatType === 'private' ? { user: l.address, workspace: l.address, role: 'linked chat' } : null
}
let askFn = (chatId, q) => askForChat(chatId, q, askCtxOf(chatId))
let askReady = () => askConfigured()

/** Test hooks: replace the tracker read (rows with sessionOpen), movers, history, launches and Ask. */
export function setTrackerReaderForTest(fn) {
  readRows = fn
}
export function setMoversReaderForTest(fn) {
  readMoversFn = fn
}
export function setHistoryReaderForTest(fn) {
  readHistoryFn = fn
}
export function setLaunchesReaderForTest(fn, marketFn = async () => null) {
  readLaunchesFn = fn
  readLaunchMarketFn = marketFn
}
export function setAskForTest(fn, ready = () => true) {
  askFn = fn ?? ((chatId, q) => askForChat(chatId, q, askCtxOf(chatId)))
  askReady = fn ? ready : () => askConfigured()
}

/** Tracker rows, or null when the tracker cannot be read. */
const rowsOrNull = () => Promise.resolve().then(readRows).catch(() => null)
const rowCount = () => rowsOrNull().then((r) => (r?.length ? r.length : null))

/** Runs one of the dashboard's route handlers for the linked account, with a synthetic request. */
async function callRoute(handler, method, pathname, body, ...args) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)])
  Object.assign(req, { method, headers: { 'user-agent': 'GullyLabsBot' } })
  const out = { status: 500, data: null }
  const res = {
    statusCode: 200,
    writeHead(s) {
      out.status = s
      this.statusCode = s
    },
    end(b) {
      try {
        out.data = JSON.parse(String(b ?? 'null'))
      } catch {
        out.data = null
      }
    },
  }
  await handler(req, res, new URL(pathname, 'http://telegram.bot.internal'), ...args)
  return out
}
const alertsCall = (address, method, p, body) => callRoute(handleAlerts, method, p, body, address)

/* -------------------------------------------------------------- banner --- */

const HERE = path.dirname(fileURLToPath(import.meta.url))
// The MP4 first: Telegram shows an MP4 as sent, while it re-encodes an uploaded GIF (the old 640×320 one came back at 320×160).
const BANNER_FILES = [
  { name: 'banner.mp4', type: 'video/mp4', upload: 'gully-labs.mp4', width: 1280, height: 640, is: (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' },
  { name: 'banner.gif', type: 'image/gif', upload: 'gully-labs.gif', width: 640, height: 320, is: (b) => b.subarray(0, 3).toString('latin1') === 'GIF' },
]
/** The banner to upload: { buf, sha, type, upload, width, height }, or null. `sha` keys the cached file_id, so a rebuilt banner is uploaded again. */
function bannerFile() {
  const dirs = [process.env.DIST_DIR && path.join(process.env.DIST_DIR, 'brand/telegram'), path.join(HERE, '../public/brand/telegram'), path.join(HERE, 'dist/brand/telegram')].filter(Boolean)
  for (const dir of dirs) {
    for (const f of BANNER_FILES) {
      try {
        const buf = fs.readFileSync(path.join(dir, f.name))
        if (buf.length > 12 && f.is(buf)) return { buf, sha: sha256(buf).slice(0, 16), type: f.type, upload: f.upload, width: f.width, height: f.height }
      } catch {
        /* next */
      }
    }
  }
  return null
}

/** /start: the animated banner with its caption and the main menu. Falls back to a text menu. */
async function sendBanner(chatId) {
  const n = await rowCount()
  const caption = cap(ui.menuCaption(n), MAX_CAPTION)
  const reply_markup = markup(keyboardFor(chatId, ui.MENU_KEYBOARD))
  const file = bannerFile()
  const sha = file?.sha ?? 'url'
  const cached = db.banner?.sha === sha ? db.banner.fileId : null
  const r = await queued(chatId, 'sendAnimation', () => {
    if (cached) return { chat_id: String(chatId), animation: cached, caption, parse_mode: 'HTML', reply_markup }
    if (!file) return { chat_id: String(chatId), animation: BANNER_URL, caption, parse_mode: 'HTML', reply_markup }
    const f = new FormData()
    f.set('chat_id', String(chatId))
    f.set('animation', new Blob([file.buf], { type: file.type }), file.upload)
    f.set('caption', caption)
    f.set('parse_mode', 'HTML')
    f.set('width', String(file.width))
    f.set('height', String(file.height))
    f.set('reply_markup', JSON.stringify(reply_markup))
    return f
  })
  const fileId = r.result?.animation?.file_id ?? r.result?.document?.file_id ?? null
  if (r.ok && fileId && !cached) {
    db.banner = { fileId, sha }
    save()
  }
  if (!r.ok) {
    if (cached) {
      db.banner = null // a stale file_id: upload again next time
      save()
    }
    const t = await show(chatId, ui.menuView(n))
    return { ok: t.ok, id: t.id, banner: false }
  }
  return { ok: true, id: r.result?.message_id ?? null, banner: true }
}

/* ------------------------------------------------------------- linking --- */

function chatTitleOf(chat) {
  if (chat.type === 'private') return [chat.first_name, chat.last_name].filter(Boolean).join(' ').slice(0, 64) + (chat.username ? ` (@${String(chat.username).slice(0, 32)})` : '')
  return String(chat.title ?? 'Group').slice(0, 64)
}

async function linkWithCode(msg, code) {
  const chat = msg.chat
  const chatId = String(chat.id)
  if (!['private', 'group', 'supergroup'].includes(chat.type)) return null
  const now = Date.now()
  const hash = sha256(code)
  const c = db.codes.find((x) => x.hash === hash)
  if (!c || c.usedAt || Date.parse(c.expiresAt) <= now) return 'That link has expired or was already used. Make a new one in the developer dashboard (Alerts tab, Connect Telegram).'
  const fromId = msg.from?.id !== undefined ? String(msg.from.id) : null
  if (!fromId) return 'This chat could not be linked: Telegram did not say who sent the command.'
  const existing = linkOfChat(chatId)
  if (existing && existing.address !== c.address && chat.type !== 'private') return 'This group is already linked to another account. The person who linked it can send /stop first.'
  c.usedAt = new Date(now).toISOString()
  db.links = db.links.filter((l) => l.address !== c.address && l.chatId !== chatId)
  db.links.push({ address: c.address, chatId, chatType: chat.type, chatTitle: chatTitleOf(chat), linkedBy: fromId, linkedAt: new Date(now).toISOString() })
  save()
  if (chat.type === 'private') setLinked(chatId, true)
  return `✅ Linked to <b>${esc(shortAddr(c.address))}</b>. Alerts with Telegram delivery arrive here.\nOpen 🔔 My alerts below, or press 🔔 Alert me on any stock card${chat.type === 'private' ? '' : ' (only you can create alerts in, or unlink, this group)'}.`
}

function unlink(link) {
  db.links = db.links.filter((l) => l !== link)
  save()
  if (link.chatType === 'private') setLinked(link.chatId, false)
}

/** Whether `fromId` may change the account's alerts and link from this chat. */
const mayAct = (link, fromId) => link.chatType === 'private' || String(fromId) === link.linkedBy
const blocked = (link) => !!getAccount(link.address)?.blocked

/* ---------------------------------------------------------------- views --- */

const NO_CHANGE = Symbol('no change')

/** The stock card for one chain, with its 24h sparkline. Null for a stock the tracker does not follow. */
async function stockCard(cc, ticker, from) {
  const chain = ui.CHAIN_OF[cc]
  const stock = tracker.trackedStocks().find((s) => s.chain === chain && s.ticker === ticker)
  if (!stock) return null
  const rows = await rowsOrNull()
  const row = rows?.find((r) => r.chain === chain && r.ticker === ticker) ?? null
  let spark = null
  try {
    spark = ui.sparkline(readHistoryFn(chain, ticker))
  } catch {
    spark = null
  }
  return ui.cardView({ cc, ticker, from, row, name: stock.name, spark })
}

async function launchesScreen(filter) {
  const f = Number(filter) || 0
  let r
  try {
    r = await readLaunchesFn({ chainId: f || null, limit: ui.LIST_MAX })
  } catch {
    r = { state: 'unreadable', launches: [] }
  }
  return ui.launchesView(r, f, DEEPCORE_CHAINS)
}

async function moversScreen(win) {
  let m = null
  try {
    m = await readMoversFn(win)
  } catch {
    m = null
  }
  return ui.moversView(m, win)
}

async function myAlertsScreen(link, page = 1) {
  if (!link) return ui.linkNeededView('m')
  return ui.myAlertsView(await alertsOf(link.address), page, DEEPCORE_CHAINS)
}

const alertById = async (link, id) => (await alertsOf(link.address)).alerts.find((a) => a.id === id) ?? null

/** Announcements state for a private chat (true on, false off), null for groups. */
const announceOf = (chatId) => (Number(chatId) > 0 ? !botUser(chatId)?.optedOut : null)

async function settingsScreen(link, fromId, chatId) {
  const announce = announceOf(chatId)
  if (!link) return ui.settingsView({ link: null, announce })
  const tryOr = async (fn) => {
    try {
      return await fn()
    } catch {
      return null
    }
  }
  const count = await tryOr(async () => (await alertsOf(link.address)).alerts.length)
  const notify = await tryOr(() => profileOf(link.address).notify ?? null)
  const workspace = await tryOr(() => workspaceName(link.address))
  return ui.settingsView({ link, workspace, notify, alertsCount: count, isLinker: String(fromId) === link.linkedBy, announce })
}

/** Gully AI: the answer screen for one question (Ask's own per-chat and daily limits apply). */
async function aiAnswer(chatId, question) {
  if (!askReady()) return { text: '<b>🤖 Gully AI</b>\nGully AI is not available yet. The docs: <a href="https://docs.gullylabs.xyz">docs.gullylabs.xyz</a>', keyboard: [[ubtn('📄 Docs ↗', 'https://docs.gullylabs.xyz'), btn('🏠 Menu', 'm!')]] }
  const q = String(question).replace(/\s+/g, ' ').trim()
  if (!q) return { text: '<b>🤖 Gully AI</b>\nType a question after the command: <code>/ask how do gap alerts work?</code>', keyboard: [[btn('💬 Ask', 'ai!'), btn('🏠 Menu', 'm!')]] }
  if (q.length > MAX_QUESTION) return { text: `<b>🤖 Gully AI</b>\nA question can be at most ${MAX_QUESTION} characters.`, keyboard: [[btn('💬 Ask another', 'ai!'), btn('🏠 Menu', 'm!')]] }
  tg('sendChatAction', { chat_id: String(chatId), action: 'typing' }).catch(() => undefined)
  let r
  try {
    r = await askFn(chatId, q)
  } catch {
    r = { ok: false, error: 'Gully AI could not answer just now. Try again in a minute.' }
  }
  return ui.aiAnswerView(r)
}

/** Sends a force_reply prompt and remembers what the reply is for. */
async function prompt(chatId, text, pending, placeholder) {
  const r = await sendText(chatId, esc(text), { reply_markup: { force_reply: true, input_field_placeholder: placeholder } })
  if (r.ok) ui.setState(chatId, { pending: { ...pending, promptId: r.result?.message_id ?? null } })
  return r
}

/* ------------------------------------------------------------ commands --- */

const LAUNCH_CHAIN_ALIASES = { bnb: 56, bsc: 56, binance: 56, hyperevm: 999, hype: 999, hl: 999, robinhood: 4663, rh: 4663, hood: 4663, base: 8453 }
const chainArgOf = (a) => (!a ? null : ['bnb', 'bsc', 'binance', 'bn'].includes(a) ? 'bsc' : ['robinhood', 'rh', 'hood'].includes(a) ? 'robinhood' : ['solana', 'sol', 'sl'].includes(a) ? 'solana' : a)

/** /gap TICKER [chain]: the card, a chain choice, or the stocks screen. */
async function gapScreen(args) {
  const [rawTicker, rawChain] = args.split(/\s+/).filter(Boolean)
  const stocks = tracker.trackedStocks()
  if (!rawTicker) return ui.chainPickerView(stocks, true)
  const ticker = rawTicker.toUpperCase().replace(/^\$/, '').slice(0, 12)
  const chainKey = chainArgOf(rawChain?.toLowerCase().slice(0, 20))
  if (!/^[A-Z.]{1,8}$/.test(ticker)) return { text: 'That is not a ticker. Try <code>/gap NVDA</code>, or browse 📈 Stocks.', keyboard: [[btn('📈 Stocks', 'stk')], ui.nav('m')] }
  const followed = stocks.filter((s) => s.ticker === ticker && (!chainKey || s.chain === chainKey))
  if (!followed.length) return { text: `${esc(ticker)}${chainKey ? ` on ${esc(chainName(chainKey))}` : ''} isn’t a stock token we follow yet. Browse the list in 📈 Stocks.`, keyboard: [[btn('📈 Stocks', 'stk')], ui.nav('m')] }
  if (followed.length === 1) return stockCard(ui.CODE_OF[followed[0].chain], ticker, 'x')
  const rows = await rowsOrNull()
  return ui.bothChainsView(
    ticker,
    followed.map((s) => ({ chain: s.chain, row: rows?.find((r) => r.chain === s.chain && r.ticker === ticker) ?? null })),
  )
}

/* ---------------------------------------------------------------- updates --- */

// Unlinked chats may use these; everything else from them is ignored.
const PUBLIC_COMMANDS = new Set(['start', 'help', 'menu', 'app', 'gap', 'top', 'movers', 'ask', 'launches', 'alerts'])
const hits = new Map()
const seenUpdates = new Set()

/** Per-chat limit: `max` a minute per bucket. Returns 'ok', 'warn' (first refusal) or 'drop'. */
function allowed(key, max) {
  const now = Date.now()
  const s = hits.get(key) ?? { list: [], warned: 0 }
  s.list = s.list.filter((t) => now - t < 60_000)
  hits.set(key, s)
  if (s.list.length >= max) {
    if (now - s.warned < 60_000) return 'drop'
    s.warned = now
    return 'warn'
  }
  s.list.push(now)
  return 'ok'
}
setInterval(() => {
  const now = Date.now()
  for (const [k, s] of hits) if (!s.list.some((t) => now - t < 60_000)) hits.delete(k)
  ui.sweepStates(now)
}, 600_000).unref?.()

/** Shows a view as a new message and makes it the chat's current screen. */
async function showNew(chatId, view) {
  const s = await show(chatId, view)
  if (s.id) ui.setState(chatId, { viewId: s.id })
  return s
}

async function onMessage(msg) {
  if (!msg?.chat || typeof msg.text !== 'string') return
  const m = msg.text.slice(0, 800).match(/^\/([a-z_]{1,32})(?:@([A-Za-z0-9_]{3,64}))?(?:\s+([\s\S]*))?$/i)
  if (!m) return onText(msg)
  const [, rawCmd, at, rawArgs = ''] = m
  if (at) {
    const name = await botUsername()
    if (!name || at.toLowerCase() !== name.toLowerCase()) return // addressed to another bot
  }
  const cmd = rawCmd.toLowerCase()
  const chatId = String(msg.chat.id)
  const args = rawArgs.trim().slice(0, 100)
  const link = linkOfChat(chatId)
  const priv = msg.chat.type === 'private'
  // /stop always answers (it is in the menu): unlink, or announcements off, or "nothing to stop" in a group.
  if (!link && !PUBLIC_COMMANDS.has(cmd) && cmd !== 'stop') return
  const gate = allowed(`cmd:${chatId}`, 20)
  if (gate === 'drop') return
  if (gate === 'warn') return void (await sendText(chatId, 'Too many commands in a minute. Try again shortly.'))

  let view = null
  if (cmd === 'start') {
    const code = args.split(/\s+/)[0]
    if (code && /^[A-Za-z0-9_-]{16,64}$/.test(code)) {
      const text = await linkWithCode(msg, code)
      if (text) view = { text, keyboard: /^✅/.test(text) ? ui.MENU_KEYBOARD : [[ubtn('🔗 Link wallet ↗', ui.PORTAL_ALERTS)], [btn('🏠 Menu', 'm')]] }
    } else if (code) view = { text: 'That link is not valid. Make a new one in the developer dashboard (Alerts tab, Connect Telegram).', keyboard: [[ubtn('🔗 Link wallet ↗', ui.PORTAL_ALERTS)], [btn('🏠 Menu', 'm')]] }
    else {
      const b = await sendBanner(chatId)
      if (b.id) ui.setState(chatId, b.banner ? { bannerId: b.id, viewId: null, pending: null } : { bannerId: null, viewId: b.id, pending: null })
      return
    }
  } else if (cmd === 'help') view = ui.helpView(!!link)
  else if (cmd === 'app') {
    if (priv) view = ui.appView(miniAppUrl())
    else {
      const name = await botUsername()
      view = ui.appGroupView(name ? `https://t.me/${name}` : miniAppUrl())
    }
  } else if (cmd === 'stop' && priv && (/^announce/i.test(args) || !link)) {
    // "/stop announcements" anywhere private, or /stop in a private chat with no link to undo: announcements off.
    setOptOut(chatId, true, msg.from)
    view = /^announce/i.test(args) ? ui.announceOffView() : ui.stopUnlinkedView()
  } else if (cmd === 'stop' && !link) view = ui.stopGroupView()
  else if (cmd === 'menu') view = ui.menuView(await rowCount())
  else if (cmd === 'gap') view = await gapScreen(args)
  else if (cmd === 'top') view = ui.topView(await rowsOrNull())
  else if (cmd === 'movers') view = await moversScreen('24h')
  else if (cmd === 'launches') {
    const a = args.split(/\s+/).filter(Boolean)[0]?.toLowerCase().slice(0, 20)
    const chainId = a ? (LAUNCH_CHAIN_ALIASES[a] ?? (DEEPCORE_CHAINS[Number(a)] ? Number(a) : undefined)) : 0
    if (chainId === undefined) view = { text: `DeepCore runs on ${Object.values(DEEPCORE_CHAINS).map((c) => esc(c.name)).join(', ')}. Try <code>/launches</code> or <code>/launches base</code>, or pick a chain below.`, keyboard: [[btn('🛰 DeepCore launches', 'dc:0')], ui.nav('m')] }
    else view = await launchesScreen(chainId)
  } else if (cmd === 'ask') {
    const q = rawArgs.trim().slice(0, MAX_QUESTION + 1)
    if (!q) return void (await prompt(chatId, ui.AI_PROMPT, { kind: 'ai' }, 'How do gap alerts work?'))
    view = await aiAnswer(chatId, q)
  } else if (cmd === 'alerts') view = await myAlertsScreen(link)
  else if (cmd === 'stop') {
    if (!mayAct(link, msg.from?.id)) view = { text: 'Only the person who linked this group can unlink it.', keyboard: [[btn('🏠 Menu', 'm')]] }
    else {
      unlink(link)
      view = { text: 'Unlinked. This chat no longer receives alerts. Link again from the developer dashboard at any time.', keyboard: [[ubtn('🔗 Link again ↗', ui.PORTAL_ALERTS), btn('🏠 Menu', 'm')], ...(priv && !botUser(chatId)?.optedOut ? [[btn('🔕 Stop announcements too', 'bco')]] : [])] }
    }
  } else return
  if (view) await showNew(chatId, view)
}

/** A plain-text message: the answer to one of the bot's force_reply prompts, or nothing. */
async function onText(msg) {
  const chatId = String(msg.chat.id)
  const st = ui.getState(chatId)
  const rt = msg.reply_to_message
  const toBot = !!rt && String(rt.from?.id) === botId()
  let pending = st?.pending && (msg.chat.type === 'private' || (toBot && rt.message_id === st.pending.promptId)) ? st.pending : null
  if (!pending && toBot && typeof rt.text === 'string') {
    // The state expired (or the server restarted): read the request back from the prompt itself.
    const s = rt.text.match(ui.SEARCH_PROMPT_RE)
    const c = rt.text.match(ui.CUSTOM_PROMPT_RE)
    if (s) pending = { kind: 'search', cc: ui.codeOfName(s[1]) }
    else if (c) pending = { kind: 'pct', cc: ui.codeOfName(c[2]), ticker: c[1], from: 'x' }
    else if (ui.AI_PROMPT_RE.test(rt.text)) pending = { kind: 'ai' }
  }
  if (!pending) return
  const gate = allowed(`cmd:${chatId}`, 20)
  if (gate === 'drop') return
  if (gate === 'warn') return void (await sendText(chatId, 'Too many messages in a minute. Try again shortly.'))
  ui.setState(chatId, { pending: null })
  const text = msg.text.trim()
  let view = null
  if (pending.kind === 'search') {
    const q = text.slice(0, 40)
    const { exact, list } = ui.searchMatches(pending.cc, q, tracker.trackedStocks())
    view = exact ? await stockCard(pending.cc, exact.ticker, 's') : ui.searchResultsView(pending.cc, q, list)
  } else if (pending.kind === 'ai') view = await aiAnswer(chatId, text.slice(0, MAX_QUESTION + 1))
  else if (pending.kind === 'pct') {
    const link = linkOfChat(chatId)
    const back = `al:${pending.cc}:${pending.ticker}:${pending.from}`
    const n = Number(text.replace(/^[±+-]\s*/, '').replace(/%$/, '').replace(',', '.').trim())
    if (!link) view = ui.linkNeededView(`c:${pending.cc}:${pending.ticker}:${pending.from}`)
    else if (!mayAct(link, msg.from?.id)) return
    else if (!Number.isFinite(n) || n < 0.1 || n > 100) view = { text: `“${esc(text.slice(0, 20))}” is not a percentage from 0.1 to 100.`, keyboard: [[btn('✏️ Try again', `alx:${pending.cc}:${pending.ticker}:${pending.from}`)], ui.nav(back)] }
    else view = ui.alertStep2View(pending.cc, pending.ticker, pending.from, Math.round(n * 100) / 100)
  }
  if (view) await showNew(chatId, view)
}

/**
 * One button press. Returns the view to show in place, NO_CHANGE, or undefined for a route that is
 * not (or no longer) known. `c.answer(text, alert)` sends the toast; navigation is answered before
 * any data is read.
 */
async function routeView(route, c) {
  const { chatId, link, fromId } = c
  const stocks = tracker.trackedStocks()
  const actGuard = (what) => {
    if (!link) return 'This chat is not linked to an account any more.'
    if (!mayAct(link, fromId)) return `Only the person who linked this group can ${what}.`
    if (blocked(link)) return 'This account is blocked from the developer programme.'
    return null
  }
  let m

  if (route === 'm') return c.answer(), ui.menuView(await rowCount())
  if (route === 'stk') return c.answer(), ui.chainPickerView(stocks, true)
  if ((m = route.match(/^stk:(rh|bn|sl):p(\d{1,2})$/))) return c.answer(), ui.gridView(m[1], Number(m[2]), stocks, await rowsOrNull())
  if ((m = route.match(/^srch:(rh|bn|sl)$/))) {
    c.answer('Type a ticker in the reply box')
    await prompt(chatId, ui.searchPrompt(m[1]), { kind: 'search', cc: m[1] }, 'NVDA')
    return NO_CHANGE
  }
  if ((m = route.match(/^c:(rh|bn|sl):([A-Z.]{1,8}):(\w{1,3})$/)) && ui.fromOk(m[3]) && stocks.some((s) => s.chain === ui.CHAIN_OF[m[1]] && s.ticker === m[2])) {
    c.answer()
    return stockCard(m[1], m[2], m[3])
  }
  if ((m = route.match(/^(al|alx|alk):(rh|bn|sl):([A-Z.]{1,8}):(\w{1,3})(?::(\d{1,3}(?:\.\d{1,2})?))?(?::([epd]))?$/)) && ui.fromOk(m[4])) {
    const [, kind, cc, ticker, from, pct, dir] = m
    if (!stocks.some((s) => s.chain === ui.CHAIN_OF[cc] && s.ticker === ticker)) return undefined
    if (pct !== undefined && (Number(pct) < 0.1 || Number(pct) > 100)) return undefined
    const card = `c:${cc}:${ticker}:${from}`
    if (!link) return c.answer(), ui.linkNeededView(card)
    if (!mayAct(link, fromId)) return c.answer('Only the person who linked this group can create alerts here.', true), NO_CHANGE
    if (kind === 'alx') {
      c.answer('Type a percentage in the reply box')
      await prompt(chatId, ui.customPctPrompt(cc, ticker), { kind: 'pct', cc, ticker, from }, '1.5')
      return NO_CHANGE
    }
    if (kind === 'al') {
      c.answer()
      if (pct === undefined) return ui.alertStep1View(cc, ticker, from)
      if (dir === undefined) return ui.alertStep2View(cc, ticker, from, Number(pct))
      return ui.alertStep3View(cc, ticker, from, Number(pct), dir)
    }
    if (pct === undefined || dir === undefined) return undefined
    const guard = actGuard('create alerts here')
    if (guard) return c.answer(guard, true), NO_CHANGE
    const cond = ui.conditionFor(Number(pct), dir)
    const r = await alertsCall(link.address, 'POST', '/api/developer/alerts', { chain: ui.CHAIN_OF[cc], ticker, condition: cond.condition, telegram: true })
    c.answer(r.status === 201 ? '✅ Alert created' : 'The alert was not created', r.status !== 201)
    return ui.createdView({ ok: r.status === 201, status: r.status, error: r.data?.error, back: card, what: `${ticker} · ${chainName(ui.CHAIN_OF[cc])}: fires when ${cond.text}.` })
  }
  if (route === 'top') return c.answer(), ui.topView(await rowsOrNull())
  if ((m = route.match(/^mv:(24h|1h)$/))) return c.answer(), moversScreen(m[1])
  if ((m = route.match(/^dc:(\d{1,5})$/)) && (m[1] === '0' || DEEPCORE_CHAINS[Number(m[1])])) return c.answer(), launchesScreen(m[1])
  if ((m = route.match(/^dl:(\d{1,5}):([0-9a-f]{40}):(\d{1,5})$/))) {
    c.answer()
    let r
    try {
      r = await readLaunchesFn({ chainId: Number(m[1]), limit: 50 })
    } catch {
      r = { launches: [] }
    }
    const l = (r?.launches ?? []).find((x) => String(x.token).toLowerCase() === `0x${m[2]}`) ?? null
    let market = null
    if (l) {
      try {
        market = await readLaunchMarketFn(l)
      } catch {
        market = null
      }
    }
    return ui.launchCardView(l, Number(m[3]) || 0, { market })
  }
  if ((m = route.match(/^dla:(\d{1,5})(?::(\d{1,5}))?$/))) {
    const [, f, cid] = m
    if (cid !== undefined && cid !== '0' && !DEEPCORE_CHAINS[Number(cid)]) return undefined
    if (!link) return c.answer(), ui.linkNeededView(`dc:${f}`, 'Launch alerts')
    if (!mayAct(link, fromId)) return c.answer('Only the person who linked this group can create alerts here.', true), NO_CHANGE
    c.answer()
    return cid === undefined ? ui.launchAlertStep1View(f, DEEPCORE_CHAINS) : ui.launchAlertStep2View(f, Number(cid), DEEPCORE_CHAINS)
  }
  if ((m = route.match(/^dlk:(\d{1,5})$/))) {
    const cid = Number(m[1])
    if (cid !== 0 && !DEEPCORE_CHAINS[cid]) return undefined
    if (!link) return c.answer(), ui.linkNeededView('dc:0', 'Launch alerts')
    const guard = actGuard('create alerts here')
    if (guard) return c.answer(guard, true), NO_CHANGE
    const r = await alertsCall(link.address, 'POST', '/api/developer/alerts', { condition: { type: 'deepcore-launch', chainId: cid || null }, telegram: true })
    c.answer(r.status === 201 ? '✅ Alert created' : 'The alert was not created', r.status !== 201)
    return ui.createdView({ ok: r.status === 201, status: r.status, error: r.data?.error, back: `dc:${cid}`, what: `New DeepCore launches on ${cid ? DEEPCORE_CHAINS[cid].name : 'any chain'}.` })
  }
  if ((m = route.match(/^ma(?::p(\d{1,2}))?$/))) return c.answer(), myAlertsScreen(link, Number(m[1] ?? 1))
  if ((m = route.match(/^(ac|ap|ar|am|at|ad|adx):([\w-]{1,40})$/))) {
    const [, act, id] = m
    if (!link) return c.answer(), ui.linkNeededView('m')
    const a = await alertById(link, id)
    if (!a) {
      c.answer('That alert no longer exists.')
      return myAlertsScreen(link)
    }
    if (act === 'ac') return c.answer(), ui.alertCardView(a, DEEPCORE_CHAINS)
    const guard = actGuard('change its alerts')
    if (guard) return c.answer(guard, true), NO_CHANGE
    if (act === 'ad') return c.answer(), ui.deleteConfirmView(a, DEEPCORE_CHAINS)
    if (act === 'adx') {
      const r = await alertsCall(link.address, 'POST', `/api/developer/alerts/${id}/delete`)
      c.answer(r.status === 200 ? '🗑 Deleted' : (r.data?.error ?? 'Not deleted'), r.status !== 200)
      return myAlertsScreen(link)
    }
    if (act === 'am') {
      const r = muteAlert(id, link.address, MUTE_MS)
      c.answer(r.ok ? `🔕 Muted ${ui.forTime(r.mutedUntil)}` : r.error, !r.ok)
    } else if (act === 'ap' || act === 'ar') {
      const r = await alertsCall(link.address, 'POST', `/api/developer/alerts/${id}/${act === 'ap' ? 'pause' : 'resume'}`)
      c.answer(r.status === 200 ? (act === 'ap' ? '⏸ Paused' : '▶ Resumed') : (r.data?.error ?? 'Not changed'), r.status !== 200)
    } else if (act === 'at') {
      c.answer('🧪 Sending a test…')
      await alertsCall(link.address, 'POST', `/api/developer/alerts/${id}/test`)
    }
    const fresh = await alertById(link, id)
    return fresh ? ui.alertCardView(fresh, DEEPCORE_CHAINS) : myAlertsScreen(link)
  }
  if (route === 'ai') {
    c.answer('Type your question in the reply box')
    await prompt(chatId, ui.AI_PROMPT, { kind: 'ai' }, 'How do gap alerts work?')
    return c.forceNew ? NO_CHANGE : ui.aiIntroView()
  }
  if ((m = route.match(/^aiq:(\d)$/)) && ui.AI_EXAMPLES[Number(m[1])]) {
    c.answer('Asking Gully AI…')
    await showNew(chatId, await aiAnswer(chatId, ui.AI_EXAMPLES[Number(m[1])]))
    return NO_CHANGE
  }
  if (route === 'set') return c.answer(), settingsScreen(link, fromId, chatId)
  if ((m = route.match(/^san:([01])$/))) {
    if (!(Number(chatId) > 0)) return undefined
    setOptOut(chatId, m[1] === '0', c.from)
    c.answer(m[1] === '0' ? '🔕 Announcements off. Alerts still arrive.' : '📣 Announcements on')
    return settingsScreen(link, fromId, chatId)
  }
  if (route === 'smu' || route === 'sul' || route === 'suly' || /^snt:[01]$/.test(route)) {
    if (!link) return c.answer(), ui.settingsView({ link: null, announce: announceOf(chatId) })
    const guard = actGuard(route === 'smu' ? 'mute its alerts' : route === 'sul' || route === 'suly' ? 'unlink it' : 'change its settings')
    if (guard) return c.answer(guard, true), NO_CHANGE
    if (route === 'sul') return c.answer(), ui.unlinkConfirmView(link)
    if (route === 'suly') {
      unlink(link)
      c.answer('🔓 Unlinked')
      return { text: '<b>🔓 Unlinked</b>\nThis chat no longer receives alerts. Link again from the developer portal at any time.', keyboard: [[ubtn('🔗 Link again ↗', ui.PORTAL_ALERTS)], [btn('🏠 Menu', 'm')]] }
    }
    if (route === 'smu') {
      let n = 0
      let until = null
      for (const a of (await alertsOf(link.address)).alerts) {
        const r = muteAlert(a.id, link.address, MUTE_MS)
        if (r.ok) {
          n++
          until = r.mutedUntil
        }
      }
      c.answer(n ? `🔕 ${n} alert${n === 1 ? '' : 's'} muted ${ui.forTime(until)}` : 'No alerts to mute.')
      return settingsScreen(link, fromId, chatId)
    }
    const on = route === 'snt:1'
    const r = await callRoute(handleProfileRoutes, 'POST', '/api/developer/profile', { notify: { telegramUsage: on } }, { user: link.address, workspace: link.address, role: 'owner', sessionId: null })
    c.answer(r.status === 200 ? `📣 Usage notices ${on ? 'on' : 'off'}` : (r.data?.error ?? 'Not changed'), r.status !== 200)
    return settingsScreen(link, fromId, chatId)
  }
  return undefined
}

/** One button press. Every press is answered exactly once (answerCallbackQuery), as early as possible. */
async function onCallback(cq) {
  let answering = null
  const answer = (text = '', alert = false) => {
    answering ??= tg('answerCallbackQuery', { callback_query_id: String(cq.id), ...(text ? { text: String(text).slice(0, 190), show_alert: alert } : {}) }).catch(() => undefined)
  }
  try {
    await pressed(cq, answer)
  } finally {
    answer()
    await answering
  }
}

async function pressed(cq, answer) {
  const data = typeof cq?.data === 'string' ? cq.data.slice(0, 64) : ''
  const chatId = cq?.message?.chat?.id !== undefined ? String(cq.message.chat.id) : null
  const link = chatId ? linkOfChat(chatId) : null
  const fromId = cq?.from?.id !== undefined ? String(cq.from.id) : null

  // 🔕 Stop announcements (on every broadcast) and its undo: opts the user out of broadcasts, never of alerts.
  if ((data === 'bco' || data === 'bci') && chatId) {
    if (!(Number(chatId) > 0)) return answer('Announcements only go to private chats.')
    const off = data === 'bco'
    setOptOut(chatId, off, cq.from)
    if (off) for (const fn of optOutListeners) Promise.resolve().then(() => fn(chatId, cq.message?.message_id ?? null)).catch(() => undefined)
    const kb = cq.message?.reply_markup?.inline_keyboard
    if (Array.isArray(kb) && cq.message?.message_id) {
      const swapped = kb.map((row) => (Array.isArray(row) ? row : []).map((b) => (b?.callback_data === 'bco' ? ui.announceOnBtn : b?.callback_data === 'bci' ? ui.announceOffBtn : b)))
      sendToChat(chatId, 'editMessageReplyMarkup', { message_id: cq.message.message_id, reply_markup: { inline_keyboard: swapped } }).catch(() => undefined)
    }
    return answer(off ? '🔕 Announcements off. Alerts still arrive. Switch them back on in ⚙️ Settings.' : '📣 Announcements on again.', off)
  }

  // Mute 24h on an alert delivery.
  const mm = data.match(/^mute:([\w-]{1,40})$/)
  if (mm || !chatId) {
    if (!mm) return answer('Unknown button.')
    if (!link) return answer('This chat is not linked to an account any more.', true)
    if (!mayAct(link, fromId)) return answer('Only the person who linked this group can mute its alerts.', true)
    const r = muteAlert(mm[1], link.address, MUTE_MS)
    if (!r.ok) return answer(r.error, true)
    return answer(`🔕 Muted ${ui.forTime(r.mutedUntil)}. Resume it in 🔔 My alerts.`)
  }
  const gate = allowed(`cb:${chatId}`, 60)
  if (gate !== 'ok') return answer(gate === 'warn' ? 'Too many taps in a minute. Try again shortly.' : '')
  if (data === 'noop') return answer()

  const forceNew = data.endsWith('!')
  const route = forceNew ? data.slice(0, -1) : data
  const src = cq.message
  const fromBanner = !!(src?.animation || src?.document || (src?.caption !== undefined && src?.text === undefined))
  let view
  try {
    view = await routeView(route, { chatId, link, fromId, answer, forceNew, from: cq.from })
  } catch (e) {
    console.error('telegram callback:', redact(e?.message ?? e))
    answer('Something went wrong. Try again in a minute.', true)
    return
  }
  if (view === undefined) {
    answer('This menu expired, here’s a fresh one')
    await showNew(chatId, ui.expiredView())
    return
  }
  answer()
  if (view === NO_CHANGE) return
  // The banner keeps its place: its first drill-down is a new text message, edited from then on.
  const st = ui.getState(chatId)
  let editId = forceNew ? null : (src?.message_id ?? null)
  if (fromBanner) editId = !forceNew && st?.bannerId === src?.message_id && st?.viewId ? st.viewId : null
  const s = await show(chatId, view, editId)
  if (s.id) ui.setState(chatId, fromBanner ? { bannerId: src?.message_id ?? null, viewId: s.id } : { viewId: s.id })
}

/* ------------------------------------------------------- channel gate --- */

/* Using the bot (menus, commands, Gully AI) requires following the Gully Labs News channel. Set with
   TELEGRAM_REQUIRED_CHANNEL (default @GullyLabsNews; "off" disables it). Telegram only answers
   getChatMember for a channel when the bot is an administrator there, so if the check itself fails the
   bot lets people through rather than locking everyone out. Alert deliveries and their Mute buttons
   are never gated: they are part of a service people may have paid for. Neither are the exits (EXIT_ROUTES,
   EXIT_COMMANDS): someone who left the channel can still list their alerts and mute, pause or delete them,
   mute all, unlink, stop announcements or usage notices, /stop, and link with /start <code>. The Mini App
   keeps the same exits open (telegram-miniapp.mjs). */
export const requiredChannel = () => {
  const v = String(process.env.TELEGRAM_REQUIRED_CHANNEL ?? '@GullyLabsNews').trim()
  return !v || v.toLowerCase() === 'off' ? null : v.startsWith('@') || /^-?\d+$/.test(v) ? v : `@${v}`
}
export const channelUrl = (ch) => (ch.startsWith('@') ? `https://t.me/${ch.slice(1)}` : 'https://t.me/GullyLabsNews')
const memberCache = new Map() // userId -> { ok, until }
let gateBroken = 0 // time the check last failed for a reason other than "not a member"

/** true when the user follows the channel, or when membership cannot be checked. Also gates the Mini App. */
export async function followsChannel(userId, { fresh = false } = {}) {
  const ch = requiredChannel()
  if (!ch || !userId) return true
  const hit = memberCache.get(userId)
  if (!fresh && hit && hit.until > Date.now()) return hit.ok
  const r = await tg('getChatMember', { chat_id: ch, user_id: Number(userId) })
  if (!r.ok) {
    if (Date.now() - gateBroken > 600_000) console.warn(`telegram: cannot check ${ch} membership (${r.error}); letting users through. Make the bot an admin of the channel.`)
    gateBroken = Date.now()
    return true
  }
  const st = r.result?.status
  const ok = st === 'creator' || st === 'administrator' || st === 'member' || (st === 'restricted' && r.result?.is_member === true)
  setFollows(userId, ok)
  memberCache.set(userId, { ok, until: Date.now() + (ok ? 30 * 60_000 : 20_000) })
  if (memberCache.size > 5_000) memberCache.delete(memberCache.keys().next().value)
  return ok
}

const gateView = (ch) => ({
  text: '<b>📣 Follow Gully Labs News to use this bot</b>\nLaunches, product updates and market notes from Gully Labs. Join the channel, then tap <b>I’ve joined</b>.',
  keyboard: [[ubtn(`📣 Join ${ch.startsWith('@') ? ch : 'the channel'} ↗`, channelUrl(ch))], [btn('✅ I’ve joined', 'jchk')]],
})

const EXIT_ROUTES = /^(?:mute:[\w-]+|bco|bci|ma(?::p\d{1,2})?|ac:[\w-]+|am:[\w-]+|ap:[\w-]+|ad:[\w-]+|adx:[\w-]+|set|smu|sul|suly|san:[01]|snt:0)!?$/
const EXIT_COMMANDS = /^\/(?:stop|alerts)(?:@\w+)?(?:\s|$)|^\/start(?:@\w+)?\s+[A-Za-z0-9_-]{16,64}\s*$/i

/** Gate for one update: true when it may proceed. Answers the update itself when it may not. */
async function gate(u) {
  const ch = requiredChannel()
  if (!ch) return true
  const cq = u?.callback_query
  const msg = u?.message
  const from = cq?.from ?? msg?.from
  if (!from || from.is_bot) return true
  if (msg && msg.chat?.type !== 'private' && !/^\//.test(String(msg.text ?? ''))) return true // group chatter is never ours
  // The exits are never gated (owner rule: muting is never gated): someone who left the channel can still see
  // their alerts and mute, pause or delete them, mute all, unlink, switch announcements or usage notices off,
  // stop, and link or unlink an account. Only feature use (stocks, gaps, new alerts, Gully AI...) waits.
  if (cq && EXIT_ROUTES.test(String(cq.data ?? ''))) return true
  if (msg && EXIT_COMMANDS.test(String(msg.text ?? ''))) return true
  const chatId = String((cq?.message?.chat ?? msg?.chat)?.id ?? from.id)
  if (cq && cq.data === 'jchk') {
    const ok = await followsChannel(String(from.id), { fresh: true })
    await tg('answerCallbackQuery', { callback_query_id: String(cq.id), text: ok ? 'Thanks for following! Opening the menu.' : 'Not joined yet: join the channel, then tap again.', show_alert: !ok }).catch(() => undefined)
    if (ok) await showNew(chatId, ui.menuView(await rowCount()))
    return false
  }
  if (await followsChannel(String(from.id))) return true
  if (cq) await tg('answerCallbackQuery', { callback_query_id: String(cq.id), text: 'Follow Gully Labs News first.' }).catch(() => undefined)
  await showNew(chatId, gateView(ch))
  return false
}

/** Handles one update. Exported for tests through the webhook only. */
async function onUpdate(u) {
  if (typeof u?.update_id === 'number') {
    if (seenUpdates.has(u.update_id)) return
    seenUpdates.add(u.update_id)
    if (seenUpdates.size > 1_000) seenUpdates.delete(seenUpdates.values().next().value)
  }
  // Bot users: a private /start records the user (even before the News channel gate); any other private
  // update from a known user moves their last-seen time.
  const pm = u?.message
  const pFrom = pm?.from ?? u?.callback_query?.from
  const pChat = pm?.chat ?? u?.callback_query?.message?.chat
  if (pChat?.type === 'private' && pFrom && !pFrom.is_bot) {
    if (typeof pm?.text === 'string' && /^\/start(?:@\w+)?(?:\s|$)/i.test(pm.text)) recordStart(pChat.id, pFrom, { linked: !!linkOfChat(pChat.id) })
    else touchUser(pChat.id, pFrom)
  }
  if (!(await gate(u))) return
  if (u?.callback_query) return onCallback(u.callback_query)
  if (u?.message) return onMessage(u.message)
}

/* -------------------------------------------------------------- handlers --- */

function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

/** POST /api/telegram/<path>: Telegram's webhook. 404 unless the bot is on and the path matches. */
export async function handleTelegramWebhook(req, res, url) {
  const token = telegramToken()
  const m = url.pathname.match(/^\/api\/telegram\/([a-f0-9]{32})$/)
  if (!token || !m || !safeEqual(m[1], webhookPathFor(token))) return json(res, 404, { error: 'not found' }), true
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
  if (!safeEqual(req.headers['x-telegram-bot-api-secret-token'] ?? '', webhookSecretFor(token))) return json(res, 401, { error: 'bad secret' }), true
  const update = await readJson(req, MAX_UPDATE_BYTES)
  if (!update || typeof update !== 'object') return json(res, 400, { error: 'bad update' }), true
  try {
    await onUpdate(update)
  } catch (e) {
    console.error('telegram update:', redact(e?.message ?? e))
  }
  return json(res, 200, { ok: true }), true
}

const linkHits = new Map()
/**
 * /api/developer/telegram* for a signed-in wallet (developer.mjs has checked the session and CSRF).
 *   GET  /api/developer/telegram           -> { enabled, bot, linked }
 *   POST /api/developer/telegram/connect   -> { link, groupLink, expiresAt }   one-time, 10 minutes
 *   POST /api/developer/telegram/unlink
 */
export async function handleTelegramAccount(req, res, url, address) {
  const p = url.pathname
  if (p === '/api/developer/telegram' && req.method === 'GET') return json(res, 200, await telegramInfo(address)), true
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
  if (!telegramEnabled()) return json(res, 404, { error: 'Telegram is not configured on this server.' }), true
  if (p === '/api/developer/telegram/connect') {
    const now = Date.now()
    const list = (linkHits.get(address) ?? []).filter((t) => now - t < 3_600_000)
    if (list.length >= 10) return json(res, 429, { error: 'Ten Telegram links an hour. Try again later.' }), true
    const bot = await botUsername()
    if (!bot) return json(res, 503, { error: 'The bot’s name could not be read from Telegram just now. Try again in a minute.' }), true
    linkHits.set(address, [...list, now])
    const code = randomToken(18) // 24 base64url characters
    db.codes = db.codes.filter((c) => !(c.address === address && !c.usedAt)) // one open code per account
    db.codes.push({ hash: sha256(code), address, expiresAt: new Date(now + CODE_TTL_MS).toISOString(), usedAt: null })
    save()
    return json(res, 200, { link: `https://t.me/${bot}?start=${code}`, groupLink: `https://t.me/${bot}?startgroup=${code}`, expiresAt: new Date(now + CODE_TTL_MS).toISOString() }), true
  }
  if (p === '/api/developer/telegram/unlink') {
    const l = linkedChat(address)
    if (!l) return json(res, 200, { ok: true, linked: null }), true
    unlink(l)
    sendText(l.chatId, 'This chat was unlinked from the developer dashboard. It no longer receives alerts.').catch(() => undefined)
    return json(res, 200, { ok: true, linked: null }), true
  }
  return json(res, 404, { error: 'not found' }), true
}

/** For the Mini App: run one of alerts.mjs's routes for a linked account (same validation and limits as the bot). */
export const alertsRouteFor = (address, method, p, body) => alertsCall(address, method, p, body)

/* ---------------------------------------------------- broadcasts (telegram-broadcast.mjs) --- */

const optOutListeners = new Set()
/** Called with (chatId, messageId) when someone taps 🔕 Stop announcements: the broadcast module counts opt-outs per broadcast. */
export function onAnnouncementOptOut(fn) {
  optOutListeners.add(fn)
  return () => optOutListeners.delete(fn)
}

/** Admin overview counts. */
export const telegramStats = () => ({ enabled: telegramEnabled(), links: db.links.length })

/** Test hook: every open link code expires now. */
export function expireLinkCodesForTest() {
  for (const c of db.codes) c.expiresAt = new Date(Date.now() - 1).toISOString()
}

/** Tests only: the send turns granted to one chat (ms timestamps), oldest first. */
export const sendGrantsForTest = (chatId) => grants.filter((g) => g.chatId === String(chatId)).map((g) => g.at)

/* ------------------------------------- @GullyLabsNews channel posts (telegram-channel.mjs) --- */

/** One Bot API call aimed at a chat (channel post, edit, delete, pin, member count) through the same per-chat queue, 30/s cap and 429 handling. `make` returns the body (a FormData for an upload); a plain object is used as is, with chat_id added. */
export const sendToChannel = (chatId, method, make) => queued(chatId, method, typeof make === 'function' ? make : () => ({ chat_id: String(chatId), ...make }))
/** The animated banner for a channel post: the cached file_id when the banner file is unchanged, else the file to upload (or its public URL), and remember(fileId) to cache Telegram's new file_id. */
export function channelBanner() {
  const file = bannerFile()
  const sha = file?.sha ?? 'url'
  return { fileId: db.banner?.sha === sha ? db.banner.fileId : null, file, url: BANNER_URL, remember: (fileId) => fileId && db.banner?.fileId !== fileId && ((db.banner = { fileId, sha }), save()) }
}
/** The linked chat with this chat id ({ address, chatId, chatType, chatTitle, ... }), or null: a test send only goes to a linked chat. */
export const linkedChatById = (chatId) => linkOfChat(chatId)
