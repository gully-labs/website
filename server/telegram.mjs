// The Gully Labs Telegram bot: gap alerts to a linked chat, and a few read-only commands.
// No dependency: the Bot API over fetch. Everything is off unless TELEGRAM_BOT_TOKEN is set.
//
// Env
//   TELEGRAM_BOT_TOKEN       the token from @BotFather. Never logged; redacted from every error text.
//   TELEGRAM_WEBHOOK_SECRET  optional: the secret Telegram sends back in X-Telegram-Bot-Api-Secret-Token.
//                            Default: derived from the token (HMAC), so one variable is enough.
//   TELEGRAM_API             optional, tests only: the Bot API base URL (default https://api.telegram.org).
//
// Updates arrive by webhook: POST /api/telegram/<path>, where <path> is the first 32 hex of
// sha256(token) and the secret header must match. On start (startTelegram) the server calls setWebhook
// for https://gullylabs.xyz/api/telegram/<path> (allowed_updates message + callback_query), setMyCommands
// and getMe; failures are logged (without the token) and retried, never fatal.
//
// Linking (no chat ids to paste): the dashboard asks for a one-time code (10 minutes, single use, only
// its SHA-256 is stored) and opens https://t.me/<bot>?start=<code>. "/start <code>" links that chat to the
// wallet account; "/stop" unlinks. A group is linked the same way ("/start <code>" in the group, or the
// ?startgroup= link); only the Telegram user who linked a group may unlink it or mute from it.
// One chat per account; a newer link replaces the older one.
//
// Commands: /gap TICKER [chain], /top, /movers (only when the tracker has movers), /launches [chain],
// /alerts, /ask QUESTION, /help.
// Chats that are not linked get only /start, /help, /gap, /top, /launches and /ask; everything else from
// them is ignored. /launches reads DeepCore's latest launches from deepcore.mjs's cache (never more than
// one DeepCore read per poll interval, however many chats ask).
// /ask answers through Gully Ask (ask.mjs), limited per chat and by Ask's daily cap.
// Replies are plain and short, in HTML parse mode with every dynamic piece escaped. A figure that could
// not be read is said to be unreadable, never shown as zero.
//
// Sending respects Telegram's limits: at most one message a second per chat, 30 a second overall, and
// a 429's retry_after is waited out (up to 60 s, three attempts).
//
// Stored in DATA_DIR/telegram.json: { links: [...], codes: [...] }.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, json, readJson } from './http.mjs'
import { alertsForChat, muteAlert } from './alerts.mjs'
import { randomToken, sha256 } from './store.mjs'
import * as tracker from './tracker.mjs'
import { askConfigured, askForChat, MAX_QUESTION } from './ask.mjs'
import { DEEPCORE_CHAINS, readLaunches } from './deepcore.mjs'

const FILE = path.join(DATA_DIR, 'telegram.json')
const SITE = 'https://gullylabs.xyz'
const CODE_TTL_MS = 10 * 60_000
const PER_CHAT_MS = 1_000
const GLOBAL_PER_S = 30
const MAX_RETRY_AFTER_S = 60
const TIMEOUT_MS = 10_000
const MAX_TEXT = 3_800 // Telegram's cap is 4096 characters after entities are parsed
const MAX_UPDATE_BYTES = 64_000
const MUTE_MS = 24 * 3_600_000
const CHAIN_NAMES = { robinhood: 'Robinhood Chain', bsc: 'BNB Chain' }
const TRUSTED = new Set(['in-line', 'drifting', 'premium', 'discount'])

/* ---------------------------------------------------------------- store --- */

let db
try {
  db = JSON.parse(fs.readFileSync(FILE, 'utf8'))
} catch {
  db = {}
}
db.links ??= [] // { address, chatId, chatType, chatTitle, linkedBy, linkedAt }
db.codes ??= [] // { hash, address, expiresAt, usedAt }

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

/** One Bot API call. Returns { ok, status, result, retryAfter, error }; never throws. */
async function tg(method, body) {
  const token = telegramToken()
  if (!token) return { ok: false, status: null, result: null, retryAfter: null, error: 'Telegram is not configured on the server.' }
  try {
    const r = await fetch(`${apiBase()}/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}), redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
    const j = await r.json().catch(() => null)
    const ok = r.ok && !!j?.ok
    return { ok, status: r.status, result: ok ? j.result : null, retryAfter: Number(j?.parameters?.retry_after) || null, error: ok ? null : redact(j?.description ?? `HTTP ${r.status}`) }
  } catch (e) {
    return { ok: false, status: null, result: null, retryAfter: null, error: redact(e?.name === 'TimeoutError' ? `timed out after ${TIMEOUT_MS / 1000} s` : (e?.message ?? e)) }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const chatTail = new Map() // chatId -> promise of the last queued send
const chatNextAt = new Map() // chatId -> earliest time of its next send
const globalSent = [] // send times within the last second
const grants = [] // the last 200 { chatId, at } turns granted (tests read the spacing here, not at the network)

async function waitTurn(chatId) {
  for (;;) {
    const now = Date.now()
    while (globalSent.length && now - globalSent[0] >= 1_000) globalSent.shift()
    const w = Math.max((chatNextAt.get(chatId) ?? 0) - now, globalSent.length >= GLOBAL_PER_S ? 1_000 - (now - globalSent[0]) : 0)
    if (w <= 0) {
      globalSent.push(now)
      chatNextAt.set(chatId, now + PER_CHAT_MS)
      grants.push({ chatId, at: now })
      if (grants.length > 200) grants.shift()
      return
    }
    await sleep(w)
  }
}

/** Sends one message-like call to a chat through the per-chat queue, honouring 429 retry_after. */
function sendToChat(chatId, method, body) {
  const key = String(chatId)
  const prev = chatTail.get(key) ?? Promise.resolve()
  const run = prev.then(async () => {
    let r
    for (let attempt = 0; attempt < 3; attempt++) {
      await waitTurn(key)
      r = await tg(method, { chat_id: key, ...body })
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

const sendText = (chatId, text, extra = {}) => sendToChat(chatId, 'sendMessage', { text: cap(text), parse_mode: 'HTML', disable_web_page_preview: true, ...extra })

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

// /movers reads the tracker's top movers (GET /api/tracker/movers, tracker.readMovers).
const movers = () => true

function commandList() {
  return [
    { command: 'gap', description: 'Gap of one stock: /gap NVDA or /gap NVDA bsc' },
    { command: 'top', description: 'The five widest trusted gaps now' },
    ...(movers() ? [{ command: 'movers', description: 'Biggest gap moves in 24 hours' }] : []),
    { command: 'launches', description: 'Latest DeepCore launches: /launches or /launches base' },
    { command: 'ask', description: 'Ask about Gully Labs: /ask how do alerts work?' },
    { command: 'alerts', description: 'Your alerts (linked chats)' },
    { command: 'stop', description: 'Unlink this chat from your account' },
    { command: 'help', description: 'What this bot does' },
  ]
}

let startTimer = null

/** Registers the webhook and the command list. Safe to call more than once; never throws. */
export async function startTelegram({ attempt = 0 } = {}) {
  const token = telegramToken()
  if (!token) {
    if (process.env.TELEGRAM_BOT_TOKEN) console.error('telegram: TELEGRAM_BOT_TOKEN is malformed; the bot is off')
    return { ok: false, enabled: false }
  }
  const url = `${SITE}/api/telegram/${webhookPathFor(token)}`
  const hook = await tg('setWebhook', { url, secret_token: webhookSecretFor(token), allowed_updates: ['message', 'callback_query'], max_connections: 10 })
  const cmds = await tg('setMyCommands', { commands: commandList() })
  const name = await botUsername()
  if (!hook.ok) console.error(`telegram: setWebhook failed: ${hook.error}`)
  if (!cmds.ok) console.error(`telegram: setMyCommands failed: ${cmds.error}`)
  if (hook.ok) console.log(`telegram: webhook set${name ? ` for @${name}` : ''}`)
  if ((!hook.ok || !cmds.ok) && attempt < 5) {
    clearTimeout(startTimer)
    startTimer = setTimeout(() => startTelegram({ attempt: attempt + 1 }), 60_000 * (attempt + 1))
    startTimer.unref?.()
  }
  return { ok: hook.ok && cmds.ok, enabled: true }
}

/* ------------------------------------------------------------ formatting --- */

/** HTML-escapes text for Telegram's HTML parse mode. */
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cap = (s) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT).replace(/<[^>]*$/, '') + '…' : s)
const chainName = (k) => CHAIN_NAMES[k] ?? k
const stockUrl = (chain, ticker) => `${SITE}/tracker/${encodeURIComponent(chain)}/${encodeURIComponent(ticker)}`
const signed = (n, d = 2) => `${n > 0 ? '+' : ''}${n.toFixed(d)}`
const usd = (n) => (typeof n === 'number' && Number.isFinite(n) ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null)
const usd0 = (n) => (typeof n === 'number' && Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : null)
const shortAddr = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`
const when = (iso) => new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'

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

/* ---------------------------------------------------------- alert sends --- */

/**
 * Sends one alert delivery to Telegram. Called by alerts.mjs.
 * @param {{ owner: string, alertId: string, name: string | null, conditionText: string, chatId?: string | null, events: object[], test: boolean }} a
 */
export async function sendAlertTelegram(a) {
  if (!telegramEnabled()) return { status: null, ok: false, error: 'Telegram is not configured on the server.' }
  const chatId = a.chatId ?? linkedChat(a.owner)?.chatId ?? null
  if (!chatId) return { status: null, ok: false, error: 'No Telegram chat is linked to this account.' }
  const title = `<b>Gully Labs alert</b>${a.name ? ` “${esc(a.name)}”` : ''}`
  if (a.test) {
    const r = await sendText(chatId, `${title}\nTest message (${esc(a.conditionText)}). Deliveries for this alert reach this chat.`)
    return { status: r.status, ok: r.ok, error: r.error }
  }
  if (a.events.some((e) => e.kind === 'deepcore.launch')) {
    const shownL = a.events.slice(0, 5)
    const text = `${title}\n${esc(a.conditionText)}\n\n${shownL.map(launchBlock).join('\n\n')}${a.events.length > shownL.length ? `\n…and ${a.events.length - shownL.length} more on deepcore.fun` : ''}`
    const open = shownL.slice(0, 3).map((e) => ({ text: `Open ${e.symbol ?? 'token'} on DeepCore`.slice(0, 40), url: e.links.token }))
    const r = await sendText(chatId, text, { reply_markup: { inline_keyboard: [...(open.length ? [open] : []), [{ text: 'Mute 24h', callback_data: `mute:${a.alertId}`.slice(0, 64) }]] } })
    return { status: r.status, ok: r.ok, error: r.error }
  }
  const shown = a.events.slice(0, 5)
  const blocks = shown.map((e) => {
    const lines = [`<b>${esc(e.ticker)}</b> · ${esc(e.chainName ?? chainName(e.chain))}`, `Gap <b>${esc(signed(e.gapPct))}%</b> vs fair (${esc(e.status)})`]
    const on = usd(e.onchain)
    const fair = usd(e.fair)
    if (on && fair) lines.push(`On chain ${esc(on)} · fair ${esc(fair)}`)
    const liq = usd0(e.poolLiquidityUsd)
    lines.push(liq ? `Pool liquidity ${esc(liq)}` : 'Pool liquidity not reported')
    lines.push(`<a href="${esc(stockUrl(e.chain, e.ticker))}">${esc(`gullylabs.xyz/tracker/${e.chain}/${e.ticker}`)}</a>`)
    return lines.join('\n')
  })
  const more = a.events.length > shown.length ? `\n…and ${a.events.length - shown.length} more on ${SITE}/tracker` : ''
  const text = `${title}\n${esc(a.conditionText)}\n\n${blocks.join('\n\n')}${more}`
  const open = shown.slice(0, 3).map((e) => ({ text: `Open ${e.ticker}`.slice(0, 40), url: stockUrl(e.chain, e.ticker) }))
  const reply_markup = { inline_keyboard: [...(open.length ? [open] : []), [{ text: 'Mute 24h', callback_data: `mute:${a.alertId}`.slice(0, 64) }]] }
  const r = await sendText(chatId, text, { reply_markup })
  return { status: r.status, ok: r.ok, error: r.error }
}

/** One DeepCore launch, in the bot's style: token, chain, time, pools and locks as DeepCore states them. */
function launchBlock(l) {
  const head = `<b>${esc(l.symbol ?? shortAddr(l.token))}</b> · ${esc(l.chainName)} · ${esc(when(l.createdAt))}`
  const legs = (l.pools ?? l.legs ?? []).map((g) => {
    const lock = g.locked === true ? `liquidity locked${g.lockId ? ` (lock #${esc(g.lockId)})` : ''}` : g.locked === false ? 'no liquidity lock' : 'lock not reported'
    return `${esc(g.kind ?? 'Pool')} pool vs ${esc(g.quote ?? '?')} · ${lock}`
  })
  const lines = [head, legs.length ? legs.join('\n') : 'Pool not reported', `<a href="${esc(l.links.token)}">${esc(`deepcore.fun/tokens/${shortAddr(l.token)}`)}</a> · <a href="${esc(l.links.swap)}">swap on DeepCore</a>`]
  return lines.join('\n')
}

/* ------------------------------------------------------------- commands --- */

let readRows = async () => {
  const body = await tracker.readTracker()
  const open = Object.fromEntries((body?.chains ?? []).map((c) => [c.key, c.sessionOpen]))
  return (body?.rows ?? []).map((r) => ({ ...r, sessionOpen: open[r.chain] ?? null }))
}
let readMoversFn = (window) => tracker.readMovers(window)
/** Test hooks: replace the tracker read (rows with sessionOpen) and the movers read. */
export function setTrackerReaderForTest(fn) {
  readRows = fn
}
export function setMoversReaderForTest(fn) {
  readMoversFn = fn
}

const helpText = (linked) =>
  [
    '<b>Gully Labs gap bot</b>',
    'The gap between a tokenised stock’s on-chain price and its Chainlink fair price, from the Gully Labs tracker.',
    '',
    '/gap NVDA · one stock (add <code>bsc</code> or <code>robinhood</code> for one chain)',
    '/top · the five widest trusted gaps now',
    ...(movers() ? ['/movers · biggest gap moves in 24 hours'] : []),
    '/launches · the latest token launches on DeepCore (add a chain: <code>bsc</code>, <code>base</code>, <code>robinhood</code>, <code>hyperevm</code>)',
    '/ask · a question about Gully Labs, answered from the docs',
    ...(linked ? ['/alerts · your alerts', '/stop · unlink this chat'] : ['Alerts: open the developer dashboard, Alerts tab, and press Connect Telegram.']),
    '',
    `<a href="${SITE}/tracker">gullylabs.xyz/tracker</a>`,
  ].join('\n')

function rowText(r) {
  const head = `<b>${esc(r.ticker)}</b> · ${esc(chainName(r.chain))}`
  const link = `<a href="${esc(stockUrl(r.chain, r.ticker))}">Open ${esc(r.ticker)}</a>`
  const fair = usd(r.fair)
  const on = usd(r.onchain)
  const liq = usd0(r.pool?.liquidityUsd)
  let body
  if (r.status === 'feed-unreadable') body = 'The fair price (Chainlink feed) could not be read just now.'
  else if (r.status === 'pool-unreadable') body = `The pool could not be read just now.${fair ? ` Fair ${esc(fair)}.` : ''}`
  else if (r.status === 'no-pool') body = `No pool found for this token.${fair ? ` Fair ${esc(fair)}.` : ''}`
  else if (r.status === 'unverified') body = [`Unverified: ${esc(r.untrustedReason ?? 'the on-chain price could not be confirmed.')}`, `On chain ${esc(on ?? 'unreadable')} · fair ${esc(fair ?? 'unreadable')}`, liq ? `Pool liquidity ${esc(liq)}` : 'Pool liquidity not reported'].join('\n')
  else if (typeof r.gapPct !== 'number' || !Number.isFinite(r.gapPct)) body = 'The gap could not be read just now.'
  else {
    const lines = [`Gap <b>${esc(signed(r.gapPct))}%</b> (${esc(r.status)})`, `On chain ${esc(on ?? 'unreadable')} · fair ${esc(fair ?? 'unreadable')}`, liq ? `Pool liquidity ${esc(liq)}` : 'Pool liquidity not reported']
    if (r.status === 'thin') lines.push('The pool is too thin for the tracker to flag this gap.')
    if (r.poolStale) lines.push('The pool read is stale; this gap is not current.')
    if (r.sessionOpen === false) lines.push('The feed session is closed: the gap is against the last session’s price.')
    body = lines.join('\n')
  }
  return `${head}\n${body}\n${link}`
}

async function cmdGap(args) {
  const [rawTicker, rawChain] = args.split(/\s+/).filter(Boolean)
  if (!rawTicker) return 'Name a stock: <code>/gap NVDA</code>, or <code>/gap NVDA bsc</code> for one chain.'
  const ticker = rawTicker.toUpperCase().replace(/^\$/, '').slice(0, 12)
  const chainArg = rawChain?.toLowerCase().slice(0, 20)
  const chainKey = chainArg ? (['bnb', 'bsc', 'binance'].includes(chainArg) ? 'bsc' : ['robinhood', 'rh', 'hood'].includes(chainArg) ? 'robinhood' : chainArg) : null
  if (!/^[A-Z.]{1,8}$/.test(ticker)) return 'That is not a ticker. Try <code>/gap NVDA</code>.'
  const followed = tracker.trackedStocks().filter((s) => s.ticker === ticker && (!chainKey || s.chain === chainKey))
  if (!followed.length) return `${esc(ticker)}${chainKey ? ` on ${esc(chainName(chainKey))}` : ''} is not a stock the tracker follows. The list: <a href="${SITE}/tracker">gullylabs.xyz/tracker</a>`
  let rows
  try {
    rows = await readRows()
  } catch {
    return 'The tracker could not be read just now. Try again in a minute.'
  }
  const mine = rows.filter((r) => r.ticker === ticker && (!chainKey || r.chain === chainKey))
  if (!mine.length) return `The tracker has no row for ${esc(ticker)} right now. Try again in a minute.`
  return mine.map(rowText).join('\n\n')
}

const trustedNow = (r) => TRUSTED.has(r.status) && typeof r.gapPct === 'number' && Number.isFinite(r.gapPct) && !r.poolStale && r.sessionOpen !== false

async function cmdTop() {
  let rows
  try {
    rows = await readRows()
  } catch {
    return 'The tracker could not be read just now. Try again in a minute.'
  }
  const ok = rows.filter(trustedNow).sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct)).slice(0, 5)
  const closed = rows.filter((r) => r.sessionOpen === false).length
  const closedText = closed === 1 ? '1 stock is outside its feed session' : `${closed} stocks are outside their feed session`
  if (!ok.length) return `No stock has a trusted gap right now (a readable feed and pool, a pool deep enough to count, a fresh read and an open feed session).${closed ? ` ${closedText}.` : ''}\n<a href="${SITE}/tracker">gullylabs.xyz/tracker</a>`
  const lines = ok.map((r, i) => `${i + 1}. <a href="${esc(stockUrl(r.chain, r.ticker))}">${esc(r.ticker)}</a> · ${esc(chainName(r.chain))}: <b>${esc(signed(r.gapPct))}%</b> (${esc(r.status)})${r.pool?.liquidityUsd ? `, pool ${esc(usd0(r.pool.liquidityUsd))}` : ''}`)
  return `<b>Widest trusted gaps now</b>\n${lines.join('\n')}${closed ? `\n${closedText} and not ranked.` : ''}\n<a href="${SITE}/tracker">gullylabs.xyz/tracker</a>`
}

const LAUNCH_CHAIN_ALIASES = { bnb: 56, bsc: 56, binance: 56, hyperevm: 999, hype: 999, hl: 999, robinhood: 4663, rh: 4663, hood: 4663, base: 8453 }

let readLaunchesFn = (o) => readLaunches(o)
/** Test hook: replace the DeepCore launches read. */
export function setLaunchesReaderForTest(fn) {
  readLaunchesFn = fn
}

/** /launches [chain]: the latest DeepCore launches, newest first. */
async function cmdLaunches(args) {
  const arg = args.split(/\s+/).filter(Boolean)[0]?.toLowerCase().slice(0, 20)
  const chainId = arg ? (LAUNCH_CHAIN_ALIASES[arg] ?? (DEEPCORE_CHAINS[Number(arg)] ? Number(arg) : undefined)) : null
  if (chainId === undefined) return `DeepCore runs on ${Object.values(DEEPCORE_CHAINS).map((c) => esc(c.key)).join(', ')}. Try <code>/launches</code> or <code>/launches base</code>.`
  let r
  try {
    r = await readLaunchesFn({ chainId, limit: 5 })
  } catch {
    r = { state: 'unreadable', launches: [] }
  }
  const where = chainId ? ` on ${esc(DEEPCORE_CHAINS[chainId].name)}` : ''
  if (r.state === 'unreadable') return `DeepCore’s launches could not be read just now. Try again in a minute.\n<a href="https://deepcore.fun">deepcore.fun</a>`
  const unread = (r.chains ?? []).filter((c) => c.status !== 'ok' && (!chainId || c.chainId === chainId)).map((c) => esc(c.name))
  const notes = []
  if (r.state === 'stale') notes.push(`<i>DeepCore could not be read just now; this is the list as of ${esc(when(r.asOf))}.</i>`)
  if (unread.length) notes.push(`<i>DeepCore could not read ${unread.join(', ')}; launches there may be missing.</i>`)
  if (!r.launches.length) return [`No launches on DeepCore${where} yet.`, ...notes, '<a href="https://deepcore.fun">deepcore.fun</a>'].join('\n')
  const list = r.launches.map((l, i) => `${i + 1}. ${launchBlock(l)}`)
  return [`<b>Latest DeepCore launches${where}</b>`, list.join('\n\n'), ...notes, `<i>Read from api.deepcore.fun${r.asOf ? ` at ${esc(when(r.asOf))}` : ''}. Information only.</i>`].join('\n')
}

async function cmdMovers() {
  let m
  try {
    m = await readMoversFn('24h')
  } catch {
    return 'Movers could not be read just now. Try again in a minute.'
  }
  const list = Array.isArray(m?.byGap) ? m.byGap.slice(0, 5) : null
  if (!list) return 'Movers could not be read just now. Try again in a minute.'
  if (!list.length) return esc(m.note ?? 'Not enough snapshots yet to compare with 24 hours ago.')
  const lines = list.map((e, i) => `${i + 1}. <a href="${esc(stockUrl(e.chain, e.ticker))}">${esc(e.ticker)}</a> · ${esc(chainName(e.chain))}: gap ${esc(signed(e.gapChangePp))} pp in 24h, now ${esc(signed(e.gapNow))}%`)
  return `<b>Biggest gap moves, 24 hours</b>\n${lines.join('\n')}\n<a href="${SITE}/tracker">gullylabs.xyz/tracker</a>`
}

/** /ask QUESTION: Gully Ask's answer, with its sources as links. */
async function cmdAsk(chatId, question) {
  if (!askConfigured()) return 'Ask is not available yet. The docs: <a href="https://docs.gullylabs.xyz">docs.gullylabs.xyz</a>'
  const q = question.replace(/\s+/g, ' ').trim()
  if (!q) return 'Ask a question after the command: <code>/ask how do gap alerts work?</code>'
  if (q.length > MAX_QUESTION) return `A question can be at most ${MAX_QUESTION} characters.`
  const r = await askForChat(chatId, q)
  if (!r.ok) return esc(r.error)
  const body = esc(r.answer.replace(/\*\*([^*]+)\*\*/g, '$1'))
  const sources = r.citations.map((c) => `[${c.n}] <a href="${esc(c.url)}">${esc(c.title)}</a>`)
  return `${body}${sources.length ? `\n\n<b>Sources</b>\n${sources.join('\n')}` : ''}\n\n<i>Information only, not investment advice.</i>`
}

function cmdAlerts(link) {
  const list = alertsForChat(link.address)
  if (!list.length) return `No alerts on ${esc(shortAddr(link.address))} yet. Make one in the developer dashboard, Alerts tab, and tick Telegram.`
  const lines = list.slice(0, 20).map((a) => `• ${esc(a.label)}: ${esc(a.condition)} · <i>${esc(a.state)}</i>${a.telegram ? '' : ' · not sent to Telegram'}`)
  return `<b>Alerts on ${esc(shortAddr(link.address))}</b>\n${lines.join('\n')}${list.length > 20 ? `\n…and ${list.length - 20} more in the dashboard.` : ''}`
}

/* ---------------------------------------------------------------- updates --- */

const PUBLIC_COMMANDS = new Set(['start', 'help', 'gap', 'top', 'ask', 'launches'])
const cmdHits = new Map()
const seenUpdates = new Set()

/** Per-chat command limit: 20 a minute. Returns 'ok', 'warn' (first refusal) or 'drop'. */
function commandAllowed(chatId) {
  const now = Date.now()
  const s = cmdHits.get(chatId) ?? { list: [], warned: 0 }
  s.list = s.list.filter((t) => now - t < 60_000)
  cmdHits.set(chatId, s)
  if (s.list.length >= 20) {
    if (now - s.warned < 60_000) return 'drop'
    s.warned = now
    return 'warn'
  }
  s.list.push(now)
  return 'ok'
}
setInterval(() => {
  const now = Date.now()
  for (const [k, s] of cmdHits) if (!s.list.some((t) => now - t < 60_000)) cmdHits.delete(k)
}, 600_000).unref?.()

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
  return `Linked to <b>${esc(shortAddr(c.address))}</b>. Alerts with Telegram delivery arrive here.\n/alerts lists them · /stop unlinks${chat.type === 'private' ? '' : ' (only you can unlink this group)'}.`
}

async function onMessage(msg) {
  if (!msg?.chat || typeof msg.text !== 'string') return
  const m = msg.text.slice(0, 800).match(/^\/([a-z_]{1,32})(?:@([A-Za-z0-9_]{3,64}))?(?:\s+([\s\S]*))?$/i)
  if (!m) return
  const [, rawCmd, at, rawArgs = ''] = m
  if (at) {
    const name = await botUsername()
    if (!name || at.toLowerCase() !== name.toLowerCase()) return // addressed to another bot
  }
  const cmd = rawCmd.toLowerCase()
  const chatId = String(msg.chat.id)
  const args = rawArgs.trim().slice(0, 100)
  const longArgs = rawArgs.trim().slice(0, MAX_QUESTION + 1)
  const link = linkOfChat(chatId)
  if (!link && !PUBLIC_COMMANDS.has(cmd)) return
  const gate = commandAllowed(chatId)
  if (gate === 'drop') return
  if (gate === 'warn') return void (await sendText(chatId, 'Too many commands in a minute. Try again shortly.'))

  let reply
  if (cmd === 'start') {
    const code = args.split(/\s+/)[0]
    if (code && /^[A-Za-z0-9_-]{16,64}$/.test(code)) reply = await linkWithCode(msg, code)
    else if (code) reply = 'That link is not valid. Make a new one in the developer dashboard (Alerts tab, Connect Telegram).'
    else reply = helpText(!!link)
  } else if (cmd === 'help') reply = helpText(!!link)
  else if (cmd === 'gap') reply = await cmdGap(args)
  else if (cmd === 'top') reply = await cmdTop()
  else if (cmd === 'launches') reply = await cmdLaunches(args)
  else if (cmd === 'ask') {
    tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => undefined)
    reply = await cmdAsk(chatId, longArgs)
  }
  else if (cmd === 'movers') reply = movers() ? await cmdMovers() : helpText(true)
  else if (cmd === 'alerts') reply = cmdAlerts(link)
  else if (cmd === 'stop') {
    if (link.chatType !== 'private' && String(msg.from?.id) !== link.linkedBy) reply = 'Only the person who linked this group can unlink it.'
    else {
      db.links = db.links.filter((l) => l !== link)
      save()
      reply = 'Unlinked. This chat no longer receives alerts. Link again from the developer dashboard at any time.'
    }
  } else return
  if (reply) await sendText(chatId, reply)
}

async function onCallback(cq) {
  const answer = (text, alert = false) => tg('answerCallbackQuery', { callback_query_id: String(cq.id), text: text.slice(0, 190), show_alert: alert })
  const data = typeof cq?.data === 'string' ? cq.data : ''
  const chatId = cq?.message?.chat?.id !== undefined ? String(cq.message.chat.id) : null
  const link = chatId ? linkOfChat(chatId) : null
  const mm = data.match(/^mute:([\w-]{1,40})$/)
  if (!mm) return answer('Unknown button.')
  if (!link) return answer('This chat is not linked to an account any more.', true)
  if (link.chatType !== 'private' && String(cq.from?.id) !== link.linkedBy) return answer('Only the person who linked this group can mute its alerts.', true)
  const r = muteAlert(mm[1], link.address, MUTE_MS)
  if (!r.ok) return answer(r.error, true)
  return answer(`Muted until ${when(r.mutedUntil)}. Resume it any time in the dashboard.`)
}

/** Handles one update. Exported for tests through the webhook only. */
async function onUpdate(u) {
  if (typeof u?.update_id === 'number') {
    if (seenUpdates.has(u.update_id)) return
    seenUpdates.add(u.update_id)
    if (seenUpdates.size > 1_000) seenUpdates.delete(seenUpdates.values().next().value)
  }
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
    db.links = db.links.filter((x) => x !== l)
    save()
    sendText(l.chatId, 'This chat was unlinked from the developer dashboard. It no longer receives alerts.').catch(() => undefined)
    return json(res, 200, { ok: true, linked: null }), true
  }
  return json(res, 404, { error: 'not found' }), true
}

/** Admin overview counts. */
export const telegramStats = () => ({ enabled: telegramEnabled(), links: db.links.length })

/** Test hook: every open link code expires now. */
export function expireLinkCodesForTest() {
  for (const c of db.codes) c.expiresAt = new Date(Date.now() - 1).toISOString()
}

/** Tests only: the send turns granted to one chat (ms timestamps), oldest first. */
export const sendGrantsForTest = (chatId) => grants.filter((g) => g.chatId === String(chatId)).map((g) => g.at)
