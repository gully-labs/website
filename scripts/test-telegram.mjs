// End-to-end test of the Telegram bot (server/telegram.mjs, server/telegram-ui.mjs) against a local stub
// of the Bot API.
//
//   node scripts/test-telegram.mjs        (no build needed)
//
// The real server runs IN THIS PROCESS on port 8795 (TEST_PORT overrides) with a fresh temporary
// DATA_DIR and the tracker loop off. TELEGRAM_API points at a local stub that records every call
// (getMe, setWebhook, setMyCommands, setChatMenuButton, sendMessage, sendAnimation, editMessageText,
// answerCallbackQuery), keeps the messages it was sent so edits behave like Telegram's ("message is not
// modified", "message to edit not found"), parses the banner's multipart upload and can answer 429.
// Tracker rows, history, movers, DeepCore launches and (for the Gully AI buttons) Ask are synthetic,
// through the bot's test hooks; nothing upstream is read. The token is a made-up one.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { makeChecker, makeClient, guardTestRun } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8795
await guardTestRun(PORT)
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-telegram-'))
const BOT_ID = 7000000001
const TOKEN = `${BOT_ID}:${crypto.randomBytes(24).toString('base64url')}`
const BOT = 'GullyTestBot'
const BANNER_FILE_ID = 'BANNER_FILE_ID_1'

const t = makeChecker()
const { check } = t

/* --------------------------------------------------- output capture (token leak) --- */

const logged = []
for (const k of ['log', 'error', 'warn']) {
  const orig = console[k].bind(console)
  console[k] = (...a) => {
    logged.push(a.map(String).join(' '))
    orig(...a)
  }
}

/* -------------------------------------------------------------- Bot API stub --- */

const calls = [] // { method, body, at, resultId }
const nonMembers = new Set() // user ids the stub reports as not following the News channel
let memberCheckBroken = false // the stub refuses getChatMember (bot not an admin of the channel)
const msgs = new Map() // message_id -> { chatId, kind, text, markup }
let nextMsgId = 1_000
let fail429 = 0
const stub = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', async () => {
    const raw = Buffer.concat(chunks)
    const m = req.url.match(/^\/bot([^/]+)\/(\w+)$/)
    const send = (status, j) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(j))
    }
    if (!m || m[1] !== TOKEN) return send(401, { ok: false, error_code: 401, description: 'Unauthorized' })
    const ct = String(req.headers['content-type'] ?? '')
    let body = {}
    if (ct.startsWith('multipart/form-data')) {
      const fd = await new Response(raw, { headers: { 'content-type': ct } }).formData()
      body = { multipart: true }
      for (const [k, v] of fd) body[k] = typeof v === 'string' ? v : { file: true, name: v.name, size: v.size, type: v.type }
      if (body.reply_markup) body.reply_markup = JSON.parse(body.reply_markup)
    } else body = raw.length ? JSON.parse(raw.toString('utf8')) : {}
    const method = m[2]
    const call = { method, body, at: Date.now(), resultId: null }
    calls.push(call)
    const bad = (description) => send(400, { ok: false, error_code: 400, description })
    if (method === 'getMe') return send(200, { ok: true, result: { id: BOT_ID, is_bot: true, username: BOT } })
    if (method === 'getChatMember') {
      if (memberCheckBroken) return bad('Bad Request: member list is inaccessible')
      return send(200, { ok: true, result: { status: nonMembers.has(Number(body.user_id)) ? 'left' : 'member', user: { id: Number(body.user_id) } } })
    }
    if (method === 'sendMessage' && fail429 > 0) {
      fail429--
      return send(429, { ok: false, error_code: 429, description: 'Too Many Requests: retry after 1', parameters: { retry_after: 1 } })
    }
    if (method === 'sendMessage') {
      const id = nextMsgId++
      call.resultId = id
      msgs.set(id, { chatId: String(body.chat_id), kind: 'text', text: body.text, markup: JSON.stringify(body.reply_markup ?? null) })
      return send(200, { ok: true, result: { message_id: id, chat: { id: Number(body.chat_id) }, text: body.text } })
    }
    if (method === 'sendAnimation') {
      const id = nextMsgId++
      call.resultId = id
      msgs.set(id, { chatId: String(body.chat_id), kind: 'animation', text: body.caption, markup: JSON.stringify(body.reply_markup ?? null) })
      const fileId = typeof body.animation === 'string' && !body.animation.startsWith('http') ? body.animation : BANNER_FILE_ID
      return send(200, { ok: true, result: { message_id: id, chat: { id: Number(body.chat_id) }, animation: { file_id: fileId, file_unique_id: 'u1', width: 640, height: 320, duration: 3 }, caption: body.caption } })
    }
    if (method === 'editMessageText') {
      const msg = msgs.get(Number(body.message_id))
      if (!msg || msg.chatId !== String(body.chat_id)) return bad('Bad Request: message to edit not found')
      if (msg.kind !== 'text') return bad('Bad Request: there is no text in the message to edit')
      const markup = JSON.stringify(body.reply_markup ?? null)
      if (msg.text === body.text && msg.markup === markup) return bad('Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message')
      Object.assign(msg, { text: body.text, markup })
      call.resultId = Number(body.message_id)
      return send(200, { ok: true, result: { message_id: Number(body.message_id), chat: { id: Number(body.chat_id) }, text: body.text } })
    }
    return send(200, { ok: true, result: true })
  })
})
await new Promise((r) => stub.listen(0, '127.0.0.1', r))

// A stub of the Anthropic Messages API for /ask (Gully Ask). Every answer cites source 1 and carries HTML
// that must arrive escaped.
const claudeCalls = []
const claude = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    claudeCalls.push(JSON.parse(raw || '{}'))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ content: [{ type: 'text', text: 'Alerts can go to **Telegram** <b>now</b> [1].' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }))
  })
})
await new Promise((r) => claude.listen(0, '127.0.0.1', r))

/* ------------------------------------------------------------ start server --- */

Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: path.join(tmp, 'no-dist'),
  ADMIN_TOKEN: crypto.randomBytes(24).toString('hex'),
  TRACKER_LOOP: 'off',
  TRACKER_SKIP_APIS: '1',
  GULLY_RPC_1: 'http://127.0.0.1:9',
  GULLY_RPC_56: 'http://127.0.0.1:9',
  GULLY_RPC_8453: 'http://127.0.0.1:9',
  GULLY_RPC_42161: 'http://127.0.0.1:9',
  GULLY_RPC_10: 'http://127.0.0.1:9',
  GULLY_RPC_137: 'http://127.0.0.1:9',
  GULLY_RPC_43114: 'http://127.0.0.1:9',
  TELEGRAM_API: `http://127.0.0.1:${stub.address().port}`,
  ANTHROPIC_API_URL: `http://127.0.0.1:${claude.address().port}`,
  ASK_REMOTE: 'off',
})
delete process.env.ANTHROPIC_API_KEY
// A file_id cached for an older banner file (the GIF): the first /start must upload the current file instead.
fs.writeFileSync(path.join(tmp, 'telegram.json'), JSON.stringify({ banner: { fileId: 'STALE_GIF_FILE_ID', sha: '0123456789abcdef' } }))
const BANNER_MP4 = fs.readFileSync(path.join(import.meta.dirname, '../public/brand/telegram/banner.mp4'))
delete process.env.ASK_DAILY_LIMIT
delete process.env.TELEGRAM_BOT_TOKEN
delete process.env.TELEGRAM_WEBHOOK_SECRET
delete process.env.GULLY_TREASURY_ADDRESS
await import('../server/server.mjs')
const tg = await import('../server/telegram.mjs')
const ui = await import('../server/telegram-ui.mjs')
const { evaluateAlerts } = await import('../server/alerts.mjs')
await new Promise((r) => setTimeout(r, 300))

const HOOK_PATH = tg.webhookPathFor(TOKEN)
const SECRET = tg.webhookSecretFor(TOKEN)
let updateId = 1
const postUpdate = (update, { secret = SECRET, hookPath = HOOK_PATH } = {}) =>
  fetch(`${BASE}/api/telegram/${hookPath}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret }) }, body: JSON.stringify({ update_id: updateId++, ...update }) }).then((r) => r.status)
const privateChat = (id, name = 'Ada') => ({ id, type: 'private', first_name: name })
const say = (chat, text, fromId = chat.id, extra = {}) => postUpdate({ message: { message_id: updateId, date: Math.floor(Date.now() / 1000), chat, from: { id: fromId, is_bot: false, first_name: 'U' }, text, ...extra } })
const pressedIds = []
/** A button press. msgId: the message the button sits on (default: the chat's current text screen; null: none). */
const press = (chat, data, { fromId = chat.id, msgId, banner = false } = {}) => {
  const id = `cq${updateId}`
  pressedIds.push(id)
  const mid = msgId === undefined ? screenId(chat.id) : msgId
  const message = mid === null ? undefined : { message_id: mid, chat, ...(banner ? { animation: { file_id: BANNER_FILE_ID }, caption: 'Gully Labs' } : { text: 'screen' }) }
  return postUpdate({ callback_query: { id, from: { id: fromId, is_bot: false, first_name: 'U' }, ...(message ? { message } : { message: { message_id: 0, chat, text: '' } }), data } })
}
const sent = (chatId) => calls.filter((c) => c.method === 'sendMessage' && String(c.body.chat_id) === String(chatId))
/** The last message of a chat as the user sees it: a text message, or an animation with its caption (the join screen rides on the banner). */
const lastShown = (chatId) => calls.filter((c) => (c.method === 'sendMessage' || c.method === 'sendAnimation') && String(c.body.chat_id) === String(chatId)).at(-1)?.body
const shownText = (chatId) => lastShown(chatId)?.text ?? lastShown(chatId)?.caption ?? ''
const lastText = (chatId) => sent(chatId).at(-1)?.body.text ?? ''
const answers = () => calls.filter((c) => c.method === 'answerCallbackQuery')
const lastAnswer = () => answers().at(-1)?.body ?? {}
const VIEW = new Set(['sendMessage', 'editMessageText', 'sendAnimation'])
const viewCalls = (chatId) => calls.filter((c) => VIEW.has(c.method) && String(c.body.chat_id) === String(chatId))
/** The chat's latest screen: method, text (or caption), inline keyboard and message id. */
const view = (chatId) => {
  const c = viewCalls(chatId).filter((x) => x.body.reply_markup?.inline_keyboard).at(-1)
  return c ? { method: c.method, text: c.body.text ?? c.body.caption ?? '', kb: c.body.reply_markup.inline_keyboard, id: c.resultId ?? c.body.message_id, body: c.body } : { method: null, text: '', kb: [], id: null, body: {} }
}
const screenId = (chatId) => [...msgs.entries()].filter(([, m]) => m.chatId === String(chatId) && m.kind === 'text').map(([id]) => id).at(-1) ?? null
const flat = (kb) => (kb ?? []).flat()
const data = (kb) => flat(kb).map((b) => b.callback_data).filter(Boolean)
const button = (kb, re) => flat(kb).find((b) => re.test(b.text))
const hasNav = (kb) => flat(kb).some((b) => b.text === '⬅ Back') && flat(kb).some((b) => b.text === '🏠 Menu' && /^m!?$/.test(b.callback_data))

const row = (o) => ({ chain: 'robinhood', ticker: 'NVDA', name: 'NVIDIA', status: 'premium', gapPct: 3.1, fair: 180, onchain: 185.58, poolStale: false, sessionOpen: true, sessionName: '24/5', asOf: new Date(Date.now() - 3 * 60_000).toISOString(), feedUpdatedAt: new Date().toISOString(), pool: { liquidityUsd: 50_000 }, ...o })
const ROWS = [
  row({}),
  row({ chain: 'bsc', status: 'thin', gapPct: 9.5, fair: 181, onchain: 198.2, pool: { liquidityUsd: 2_000 } }),
  row({ ticker: 'TSLA', name: 'Tesla', status: 'discount', gapPct: -2.5, fair: 400, onchain: 390 }),
  row({ ticker: 'AAPL', name: 'Apple', status: 'feed-unreadable', gapPct: null, fair: null, onchain: 230, pool: { liquidityUsd: 80_000 } }),
  row({ ticker: 'META', name: 'Meta', status: 'in-line', gapPct: 0.4, fair: 700, onchain: 702.8 }),
  row({ ticker: 'MSFT', name: 'Microsoft', chain: 'bsc', status: 'premium', gapPct: 12, sessionOpen: false }),
  row({ ticker: 'AMZN', name: 'Amazon', status: 'premium', gapPct: 7, poolStale: true }),
  row({ ticker: 'GOOGL', name: 'Alphabet', status: 'unverified', gapPct: null, rawGapPct: -29.45, fair: 706.52, onchain: 498.46, pool: { liquidityUsd: 269_113 }, untrustedReason: 'A 29.4% gap is implausible for a tokenised stock, and its price could not be confirmed on chain.' }),
]

// DeepCore launches as deepcore.mjs's readLaunches returns them (shapes from api.deepcore.fun/v1/launches).
const dcLaunch = (o) => ({ chainId: 4663, chainKey: 'robinhood', chainName: 'Robinhood Chain', token: '0x8d901a1b3f3a57f9c36a71382fa183476c41545b', symbol: 'DTC', createdAt: '2026-10-11T08:20:21.000Z', legs: [{ poolId: '0xb506', kind: 'CL', quote: 'WETH', locked: true, lockId: '1' }], links: { token: 'https://deepcore.fun/tokens/0x8d901a1b3f3a57f9c36a71382fa183476c41545b?net=robinhood', swap: 'https://deepcore.fun/app/swap?net=robinhood&in=0x0000000000000000000000000000000000000000&out=0x8d901a1b3f3a57f9c36a71382fa183476c41545b' }, ...o })
const LAUNCHES = [dcLaunch({ chainId: 8453, chainKey: 'base', chainName: 'Base', token: '0x1111111111111111111111111111111111111111', symbol: '<b>X&', createdAt: '2026-10-17T18:00:00.000Z', legs: [{ kind: 'Bin', quote: 'USDC', locked: false }], links: { token: 'https://deepcore.fun/tokens/0x1111111111111111111111111111111111111111?net=base', swap: 'https://deepcore.fun/app/swap?net=base&in=0x0&out=0x1111' } }), dcLaunch({})]
const launchesOk = (asked) => async (o) => {
  asked?.push(o)
  const l = LAUNCHES.filter((x) => !o.chainId || x.chainId === o.chainId)
  return { state: 'ok', launches: l, asOf: '2026-10-17T19:00:00.000Z', chains: [{ chainId: 999, name: 'HyperEVM', status: 'unreadable', total: null }] }
}

const wallet = privateKeyToAccount(generatePrivateKey())
const me = wallet.address.toLowerCase()
const other = privateKeyToAccount(generatePrivateKey())
const dev = makeClient(BASE)
const dev2 = makeClient(BASE)
const myAlerts = async () => (await dev.call('/api/developer/alerts')).data.alerts
const linkCode = async (client) => (await client.post('/api/developer/telegram/connect')).data.link.split('start=')[1]
const users = await import('../server/telegram-users.mjs')
const botUsers = () => {
  users.flushBotUsers()
  try {
    return JSON.parse(fs.readFileSync(path.join(tmp, 'bot-users.json'), 'utf8')).users
  } catch {
    return {}
  }
}

try {
  /* --------------------------------------------------------- no token --- */
  await dev.signIn(wallet)
  await dev2.signIn(other)
  check('no token: the webhook path is 404', (await postUpdate({ message: { chat: privateChat(1), text: '/help' } })) === 404)
  check('no token: any /api/telegram path is 404', (await fetch(`${BASE}/api/telegram/${'0'.repeat(32)}`, { method: 'POST' })).status === 404)
  const ch0 = await dev.call('/api/alerts/channels')
  check('no token: /api/alerts/channels says Telegram is off, with a reason', ch0.status === 200 && ch0.data.telegram.enabled === false && !!ch0.data.telegram.reason && ch0.data.webhook.enabled === true)
  const info0 = await dev.call('/api/developer/telegram')
  check('no token: the dashboard reads Telegram as not configured', info0.status === 200 && info0.data.enabled === false && info0.data.linked === null)
  check('no token: connect is 404', (await dev.post('/api/developer/telegram/connect')).status === 404)
  const tgOff = await dev.post('/api/developer/alerts', { condition: { type: 'gap', pct: 2 }, telegram: true })
  check('no token: a Telegram alert is refused', tgOff.status === 400, tgOff.data?.error)
  check('no token: nothing was sent to the Bot API', calls.length === 0)

  /* ---------------------------------------------------------- startup --- */
  process.env.TELEGRAM_BOT_TOKEN = TOKEN
  process.env.TELEGRAM_GATE_FREE_ACTIONS = '0' // the hard wall; the free-action tests below switch it on
  const started = await tg.startTelegram()
  const hook = calls.find((c) => c.method === 'setWebhook')
  check('startup: setWebhook to the secret path on gullylabs.xyz', started.ok && hook?.body.url === `https://gullylabs.xyz/api/telegram/${HOOK_PATH}`, hook?.body.url)
  check('startup: the secret token and allowed updates are sent', hook?.body.secret_token === SECRET && JSON.stringify(hook?.body.allowed_updates) === '["message","callback_query","inline_query"]')
  const cmdCalls = calls.filter((c) => c.method === 'setMyCommands')
  const scoped = (type) => cmdCalls.find((c) => (c.body.scope?.type ?? 'default') === type)?.body.commands ?? []
  const cmdList = scoped('all_private_chats')
  const cmds = cmdList.map((c) => c.command)
  check('startup: private chats see start, app, gap, top, movers, launches, holders, alerts, security, score, ask, help, stop (in that order, no scan)', JSON.stringify(cmds) === JSON.stringify(['start', 'app', 'gap', 'top', 'movers', 'launches', 'holders', 'alerts', 'security', 'score', 'ask', 'help', 'stop']), cmds.join())
  check('startup: groups see gap, top, launches, help only', JSON.stringify(scoped('all_group_chats').map((c) => c.command)) === JSON.stringify(['gap', 'top', 'launches', 'help']), scoped('all_group_chats').map((c) => c.command).join())
  check('startup: the default scope gets the private list', JSON.stringify(scoped('default').map((c) => c.command)) === JSON.stringify(cmds))
  check('startup: command descriptions are short, plain and start with an emoji (3 to 60 characters)', cmdCalls.flatMap((c) => c.body.commands).every((c) => c.description.length >= 3 && c.description.length <= 60 && /^\p{Extended_Pictographic}/u.test(c.description)), cmdList.map((c) => c.description).join(' | '))
  const menuButton = calls.find((c) => c.method === 'setChatMenuButton')?.body.menu_button
  check('startup: the chat menu button lists the commands (type commands), so users see them', menuButton?.type === 'commands' && Object.keys(menuButton).length === 1, JSON.stringify(menuButton))
  check('startup: getMe read the bot name', calls.some((c) => c.method === 'getMe'))
  check('startup is idempotent (a second run succeeds)', (await tg.startTelegram()).ok)
  const ch1 = await dev.call('/api/alerts/channels')
  check('with a token: channels say Telegram is on, with the bot name', ch1.data.telegram.enabled === true && ch1.data.telegram.bot === BOT)

  /* --------------------------------------------------- webhook secret --- */
  check('webhook: a wrong path is 404', (await postUpdate({ message: { chat: privateChat(1), text: '/help' } }, { hookPath: 'f'.repeat(32) })) === 404)
  check('webhook: no secret header is refused (401)', (await postUpdate({ message: { chat: privateChat(1), text: '/help' } }, { secret: null })) === 401)
  check('webhook: a wrong secret header is refused (401)', (await postUpdate({ message: { chat: privateChat(1), text: '/help' } }, { secret: 'x'.repeat(48) })) === 401)
  check('webhook: refused updates sent nothing', sent(1).length === 0)
  check('webhook: GET is refused', (await fetch(`${BASE}/api/telegram/${HOOK_PATH}`)).status === 405)

  /* ------------------------------------------------------------ /start --- */
  tg.setTrackerReaderForTest(async () => ROWS)
  const ada = privateChat(111, 'Ada <b>&')
  const conn = await dev.post('/api/developer/telegram/connect')
  const code = conn.data?.link?.match(/\?start=([\w-]+)$/)?.[1]
  check('connect gives a t.me deep link with a one-time code', conn.status === 200 && conn.data.link.startsWith(`https://t.me/${BOT}?start=`) && !!code && conn.data.groupLink.includes('startgroup='))
  check('connect: the code expires in 10 minutes', Math.abs(Date.parse(conn.data.expiresAt) - Date.now() - 600_000) < 5_000)
  check('webhook: a good update is accepted (200)', (await say(ada, `/start ${code}`)) === 200)
  check('/start with a valid code links the chat, with the menu', /Linked to/.test(lastText(111)) && data(view(111).kb).includes('ma'), lastText(111))
  const info1 = await dev.call('/api/developer/telegram')
  check('the dashboard shows the linked chat by name', info1.data.linked?.chatType === 'private' && info1.data.linked.chatTitle.startsWith('Ada <b>&'))
  await say(privateChat(222), `/start ${code}`)
  check('/start with a reused code is refused', /expired or was already used/.test(lastText(222)) && (await dev2.call('/api/developer/telegram')).data.linked === null)
  const conn2 = await dev2.post('/api/developer/telegram/connect')
  const code2 = conn2.data.link.split('start=')[1]
  tg.expireLinkCodesForTest()
  await say(privateChat(222), `/start ${code2}`)
  check('/start with an expired code is refused', /expired or was already used/.test(lastText(222)) && (await dev2.call('/api/developer/telegram')).data.linked === null)
  await say(privateChat(222), '/start nope')
  check('/start with a malformed code says so', /not valid/.test(lastText(222)))

  /* ------------------------------------------------------- /start banner --- */
  await say(privateChat(800), '/start')
  const an1 = calls.filter((c) => c.method === 'sendAnimation' && c.body.chat_id === '800').at(-1)
  check('/start sends an animation (sendAnimation), uploaded as the 1280×640 MP4 the first time', !!an1 && an1.body.multipart === true && an1.body.animation?.file === true && an1.body.animation.type === 'video/mp4' && an1.body.animation.name === 'gully-labs.mp4' && an1.body.animation.size === BANNER_MP4.length && an1.body.animation.size < 1_048_576 && an1.body.width === '1280' && an1.body.height === '640', JSON.stringify({ ...an1?.body.animation, w: an1?.body.width, h: an1?.body.height }))
  check('a file_id cached for an older banner file is not reused', an1?.body.animation !== 'STALE_GIF_FILE_ID' && calls.every((c) => c.body.animation !== 'STALE_GIF_FILE_ID'))
  const cap1 = an1?.body.caption ?? ''
  check('the caption: Gully Labs, the live count of stock tokens, alerts, Gully AI, not advice', cap1.startsWith('<b>Gully Labs</b> · see if stock tokens trade above or below the real share price.') && cap1.includes(`📈 ${ROWS.length} stock tokens on Robinhood Chain, BNB Chain and Solana`) && cap1.includes('🔔 alerts right here') && cap1.includes('🤖 Gully AI answers') && cap1.includes('Information only, not investment advice.') && cap1.length < 1024 && an1.body.parse_mode === 'HTML', cap1)
  const menuKb = an1?.body.reply_markup?.inline_keyboard ?? []
  check('the banner carries the main menu: 📱 Open app, then 11 buttons in 5 rows', menuKb.length === 6 && flat(menuKb).length === 12 && JSON.stringify(flat(menuKb).map((b) => b.text)) === JSON.stringify(['📱 Open app', '📈 Stocks', '🔥 Top gaps', '🚀 Movers', '🛰 DeepCore launches', '🔔 My alerts', '🤖 Gully AI', '👥 Holder Map', '🛡 Security', '💼 App dashboard ↗', '🧭 More', '⚙️ Settings']))
  check('📱 Open app is an inline web_app button to the Mini App (private chat)', menuKb[0]?.[0]?.web_app?.url === 'https://gullylabs.xyz/tg' && menuKb[0][0].callback_data === undefined && menuKb[0][0].url === undefined)
  check('the menu: App dashboard is a url button, the others are routes', button(menuKb, /App dashboard/)?.url === 'https://app.gullylabs.xyz' && JSON.stringify(data(menuKb)) === JSON.stringify(['stk', 'top', 'mv:24h', 'dc:0', 'ma', 'ai', 'hm', 'sec', 'more', 'set']))
  const storedBanner = JSON.parse(fs.readFileSync(path.join(tmp, 'telegram.json'), 'utf8')).banner
  check('the banner file_id is stored after the first upload, keyed on the hash of the MP4', storedBanner?.fileId === BANNER_FILE_ID && storedBanner.sha === crypto.createHash('sha256').update(BANNER_MP4).digest('hex').slice(0, 16), JSON.stringify(storedBanner))
  await say(privateChat(801), '/start')
  const an2 = calls.filter((c) => c.method === 'sendAnimation' && c.body.chat_id === '801').at(-1)
  check('a second /start reuses the file_id (no upload)', an2 && !an2.body.multipart && an2.body.animation === BANNER_FILE_ID)
  tg.setTrackerReaderForTest(async () => {
    throw new Error('down')
  })
  await say(privateChat(802), '/start')
  const cap3 = calls.filter((c) => c.method === 'sendAnimation' && c.body.chat_id === '802').at(-1)?.body.caption ?? ''
  check('caption: an unreadable tracker drops the number, never shows 0', cap3.includes('📈 Stock tokens on Robinhood Chain') && !/\d+ stock tokens/.test(cap3), cap3)
  tg.setTrackerReaderForTest(async () => ROWS)
  // Drill down from the banner: the first screen is a new text message, then that one is edited.
  const bannerId = calls.filter((c) => c.method === 'sendAnimation' && c.body.chat_id === '800').at(-1).resultId
  const n800 = sent(800).length
  await press(privateChat(800), 'stk', { msgId: bannerId, banner: true })
  const first = view(800)
  check('banner drill-down: the first screen is a new text message', first.method === 'sendMessage' && sent(800).length === n800 + 1 && /📈 Stocks/.test(first.text))
  await press(privateChat(800), 'top', { msgId: bannerId, banner: true })
  check('banner drill-down: the next press from the banner edits that screen', view(800).method === 'editMessageText' && view(800).id === first.id && /Top gaps/.test(view(800).text))
  await press(privateChat(800), 'stk')
  check('a press on a screen edits it in place', view(800).method === 'editMessageText' && view(800).id === first.id && sent(800).length === n800 + 1)
  check('callbacks are answered at once (one answer per press)', pressedIds.every((id) => answers().filter((a) => a.body.callback_query_id === id).length === 1))

  /* ------------------------------------------------- read-only commands --- */
  await say(privateChat(333), '/gap NVDA')
  const both = view(333)
  check('/gap NVDA (three chains, Solana included) offers every card', /NVDA<\/b> trades on 3 chains/.test(both.text) && data(both.kb).includes('c:rh:NVDA:x') && data(both.kb).includes('c:bn:NVDA:x') && data(both.kb).includes('c:sl:NVDA:x'), both.text)
  await say(privateChat(333), '/gap NVDA robinhood')
  const card = view(333)
  check('/gap NVDA robinhood answers with the stock card', /🔴 <b>NVDA<\/b> · Robinhood Chain/.test(card.text), card.text)
  check('card: the gap as a sentence, token and real share price, liquidity, market open', card.text.includes('NVDA token is <b>3.10% above</b> the real share price.') && card.text.includes('Token $185.58 · Real share $180.00') && card.text.includes('💧 Liquidity $50,000') && card.text.includes('☀️ Market open.'), card.text)
  check('card: "Updated 3 min ago" and the information-only line', /Updated 3 min ago · Information only, not advice\./.test(card.text), card.text)
  check('card buttons without holder data: Alert me, Refresh / Open page (url), Back, Menu (no empty Holders row)', JSON.stringify(card.kb.map((r) => r.map((b) => b.text))) === JSON.stringify([['🔔 Alert me', '🔄 Refresh'], ['🌐 Open page ↗', '⬅ Back', '🏠 Menu']]) && button(card.kb, /Open page/).url === 'https://gullylabs.xyz/tracker/robinhood/NVDA', JSON.stringify(card.kb.map((r) => r.map((b) => b.text))))
  tg.setHolderAvailabilityForTest((chain) => chain === 'robinhood')
  await say(privateChat(333), '/gap NVDA robinhood')
  const card2 = view(333)
  check('card buttons with holder data: Alert me, Refresh / Holders / Open page (url), Back, Menu', JSON.stringify(card2.kb.map((r) => r.map((b) => b.text))) === JSON.stringify([['🔔 Alert me', '🔄 Refresh'], ['👥 Holders'], ['🌐 Open page ↗', '⬅ Back', '🏠 Menu']]), JSON.stringify(card2.kb.map((r) => r.map((b) => b.text))))
  const hb = button(card2.kb, /Holders/)
  check('card: 👥 Holders in a private chat opens the Mini App’s holder screen (web_app)', hb?.web_app?.url === 'https://gullylabs.xyz/tg?holders=robinhood%3ANVDA' && hb.callback_data === undefined && hb.url === undefined, JSON.stringify(hb))
  await say(privateChat(335), '/gap NVDA bsc')
  check('card: a chain without holder data has no 👥 Holders', !flat(view(335).kb).some((b) => /Holders/.test(b.text)), JSON.stringify(view(335).kb))
  check('/gap is sent as HTML with link previews off', sent(333).at(-1).body.parse_mode === 'HTML' && sent(333).at(-1).body.disable_web_page_preview === true)
  await say(privateChat(334), '/gap nvda bsc')
  check('/gap NVDA bsc: thin trading is ⚪ and says "not enough trading" (no "pool", no "thin")', /⚪ <b>NVDA<\/b> · BNB Chain/.test(view(334).text) && /⚪ Not enough trading to compare right now\./.test(view(334).text) && !/pool|thin/i.test(view(334).text), view(334).text)
  await say(privateChat(335), '/gap AAPL robinhood')
  check('card: a missing real share price is said plainly, not as zero or "unreadable"', /⚪ The real share price isn’t available right now\./.test(view(335).text) && view(335).text.includes('Token $230.00') && !/Real share \$/.test(view(335).text) && !/\$0|unreadable|feed/i.test(view(335).text), view(335).text)
  await say(privateChat(336), '/gap ZZZZ')
  check('/gap: an unknown ticker is named as not followed', /isn’t a stock token we follow yet/.test(view(336).text) && data(view(336).kb).includes('stk'))
  await say(privateChat(336), '/gap MSFT bsc')
  check('card: a closed market is said in plain words', view(336).text.includes('🌙 Market closed: compared with the last closing price.') && !/session|feed/i.test(view(336).text), view(336).text)
  await say(privateChat(337), '/top')
  const top = view(337)
  const topData = data(top.kb)
  check('/top ranks trusted gaps widest first, as buttons to the cards', topData.indexOf('c:rh:NVDA:t') === 0 && topData.indexOf('c:rh:TSLA:t') === 1 && topData.indexOf('c:rh:META:t') === 2, topData.join())
  check('/top leaves out thin, unreadable, stale, closed and unverified rows', !topData.some((d) => /MSFT|AMZN|AAPL|GOOGL|c:bn:NVDA/.test(d)))
  check('/top buttons show rank, status, ticker, chain and gap', flat(top.kb)[0].text === '1. 🔴 NVDA · RH  +3.10%' && flat(top.kb)[1].text === '2. 🔴 TSLA · RH  −2.50%', flat(top.kb)[0].text)
  check('/top says how many stocks have a closed market', /🌙 Market closed for 1 stock: not ranked\./.test(top.text) && /furthest from the real share price/.test(top.text), top.text)
  check('/top has Refresh, Back and Menu', topData.includes('top') && hasNav(top.kb))
  tg.setTrackerReaderForTest(async () => {
    throw new Error('upstream down')
  })
  await say(privateChat(338), '/top')
  check('/top: a failed price read is said honestly, in plain words', /Prices aren’t available right now/.test(view(338).text) && !/tracker|read/.test(view(338).text), view(338).text)
  tg.setTrackerReaderForTest(async () => ROWS)
  check('HTML escaping: < > & " are escaped', tg.esc('<b>"x" & y</b>') === '&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;')
  await say(privateChat(339), '/gap GOOGL robinhood')
  const unv = view(339).text
  check('card: an unverified price says "not enough trading", shows the prices and no gap figure', unv.includes('⚪ Not enough trading to compare right now.') && !/% (above|below)/.test(unv) && !/29\.4|implausible|Unverified/i.test(unv) && unv.includes('Token $498.46 · Real share $706.52') && /^⚪/.test(unv), unv)

  /* ------------------------------------------------------------- /launches --- */
  const asked = []
  tg.setLaunchesReaderForTest(launchesOk(asked))
  await say(privateChat(340), '/launches')
  const ln = view(340)
  check('/launches answers in an unlinked chat (public, read-only)', /DeepCore launches/.test(ln.text), ln.text)
  const lnData = data(ln.kb)
  check('/launches lists launches newest first as buttons to their cards', lnData[0] === 'dl:8453:1111111111111111111111111111111111111111:0' && lnData[1] === 'dl:4663:8d901a1b3f3a57f9c36a71382fa183476c41545b:0', lnData.join())
  check('/launches: chain filters, launch alert, Refresh, Back, Menu', ['dc:0', 'dc:56', 'dc:999', 'dc:4663', 'dc:8453', 'dla:0'].every((d) => lnData.includes(d)) && hasNav(ln.kb))
  check('/launches names a chain that could not be checked, plainly', /HyperEVM couldn’t be checked; launches there may be missing/.test(ln.text) && !/read/.test(ln.text), ln.text)
  check('/launches: an information-only line, no source name, no timestamp', /Information only, not advice\./.test(ln.text) && !/api\.|UTC|Read from|deepcore\.fun/.test(ln.text), ln.text)
  check('/launches buttons: name, chain and how long ago (no raw time)', /^<b>X& · Base · \d+(h|d| min) ago$/.test(flat(ln.kb)[0].text), flat(ln.kb)[0].text)
  await press(privateChat(340), lnData[0])
  const lc = view(340)
  check('launch card: name (escaped), chain, how long ago, liquidity not locked; no pool details, no address, no raw time', lc.text.includes('&lt;b&gt;X&amp;') && !lc.text.includes('<b><b>X') && /Base · \d+(h|d| min) ago/.test(lc.text) && lc.text.includes('🔓 Liquidity not locked') && !/pool|0x|UTC|Bin|USDC/i.test(lc.text) && /Information only, not advice/.test(lc.text), lc.text)
  check('launch card: View on DeepCore (url), launch alert, Back to the list, Menu', button(lc.kb, /View on DeepCore/)?.url === LAUNCHES[0].links.token && data(lc.kb).includes('dla:0') && data(lc.kb).includes('dc:0') && hasNav(lc.kb))
  check('launch card: 👥 Holders opens the Mini App on that launch (DeepCore chain key + token)', button(lc.kb, /Holders/)?.web_app?.url === `https://gullylabs.xyz/tg?holders=${encodeURIComponent(`${LAUNCHES[0].chainKey}:${LAUNCHES[0].token.toLowerCase()}`)}`, JSON.stringify(button(lc.kb, /Holders/)))
  tg.setLaunchesReaderForTest(launchesOk(asked), async (l) => (l.token === LAUNCHES[1].token ? { priceUsd: 0.00123, marketCapUsd: 123456.7 } : null))
  await press(privateChat(340), lnData[1])
  const lc2 = view(340)
  check('launch card: price and market cap when DeepCore states them, liquidity locked', lc2.text.includes('<b>DTC</b> · Robinhood Chain') && lc2.text.includes('💵 Price $0.00123 · Market cap $123,457') && lc2.text.includes('🔒 Liquidity locked'), lc2.text)
  tg.setLaunchesReaderForTest(launchesOk(asked))
  await press(privateChat(340), 'dc:8453')
  check('launch filter: one chain', asked.at(-1).chainId === 8453 && /on Base<\/b>/.test(view(340).text) && !data(view(340).kb).some((d) => d.startsWith('dl:4663')))
  await say(privateChat(340), '/launches base')
  check('/launches base filters to one chain', asked.at(-1).chainId === 8453)
  await say(privateChat(340), '/launches solana')
  check('/launches with an unknown chain lists DeepCore’s chains by name', /DeepCore runs on BNB Chain, HyperEVM, Robinhood Chain, Base/.test(view(340).text), view(340).text)
  await press(privateChat(340), 'dla:0')
  check('launch alert in an unlinked chat: explains, with Link wallet to the portal Alerts tab', /need a linked account/.test(view(340).text) && button(view(340).kb, /Link wallet/)?.url === 'https://app.gullylabs.xyz/#alerts' && data(view(340).kb).includes('dc:0'))
  tg.setLaunchesReaderForTest(async () => ({ state: 'unreadable', launches: [], asOf: null, chains: [] }))
  await say(privateChat(341), '/launches')
  check('/launches: DeepCore not answering is said honestly, never "no launches"', /DeepCore isn’t answering right now/.test(view(341).text) && !/No launches|API|read/.test(view(341).text), view(341).text)
  tg.setLaunchesReaderForTest(async () => ({ state: 'stale', launches: [LAUNCHES[1]], asOf: '2026-10-17T18:00:00.000Z', chains: [] }))
  await say(privateChat(342), '/launches')
  check('/launches: a stale list says how old it is, without a raw timestamp', /DeepCore isn’t answering right now; this list is from \d+(h|d| min) ago\./.test(view(342).text) && !/UTC/.test(view(342).text), view(342).text)
  tg.setLaunchesReaderForTest(async () => ({ state: 'ok', launches: [], asOf: '2026-10-17T18:00:00.000Z', chains: [] }))
  await say(privateChat(343), '/launches base')
  check('/launches with none says so', /No launches on DeepCore on Base yet/.test(view(343).text))
  tg.setLaunchesReaderForTest(launchesOk(asked))

  /* ---------------------------------------------------------------- /ask --- */
  await say(privateChat(600), '/ask how do alerts work?')
  check('/ask without ANTHROPIC_API_KEY says Gully AI is not available yet', /not available yet/.test(lastText(600)) && claudeCalls.length === 0)
  process.env.ANTHROPIC_API_KEY = `sk-ant-test-${crypto.randomBytes(12).toString('hex')}`
  await say(privateChat(601), '/ask how do Telegram alerts work?')
  const askView = view(601)
  check('/ask in an unlinked chat answers through Gully Ask', claudeCalls.length === 1 && /Alerts can go to Telegram/.test(askView.text), askView.text)
  check('/ask escapes the answer’s HTML and keeps the citation', askView.text.includes('&lt;b&gt;now&lt;/b&gt; [1]') && !askView.text.includes('<b>now</b>'))
  check('/ask lists its sources, as url buttons, and says it is not advice', /<b>Sources<\/b>\n\[1\] /.test(askView.text) && /^https:\/\/docs\.gullylabs\.xyz\/(plans-alerts|telegram)/.test(button(askView.kb, /^📄 \[1\]/)?.url ?? '') && /not investment advice/.test(askView.text))
  check('/ask answer: Ask another and Menu open new messages (the answer stays)', data(askView.kb).includes('ai!') && data(askView.kb).includes('m!'))
  check('/ask is sent as HTML with link previews off', sent(601).at(-1).body.parse_mode === 'HTML' && sent(601).at(-1).body.disable_web_page_preview === true)
  await say(ada, '/ask what are the plans?')
  check('/ask works in a linked chat too', /Alerts can go to Telegram/.test(lastText(111)))
  await say(privateChat(602), '/ask')
  check('/ask with no question asks for one (force_reply)', lastText(602).startsWith('🤖 Ask Gully AI:') && sent(602).at(-1).body.reply_markup?.force_reply === true)
  await say(privateChat(602), `/ask ${'x'.repeat(501)}`)
  check('/ask with a question over 500 characters is refused', /at most 500 characters/.test(lastText(602)))
  const before602 = claudeCalls.length
  for (let i = 0; i < 6; i++) await say(privateChat(603), `/ask question ${i}?`)
  await new Promise((r) => setTimeout(r, 6_500))
  check('/ask: at most 5 a minute per chat', claudeCalls.length - before602 === 5 && /At most 5 questions a minute/.test(lastText(603)), `${claudeCalls.length - before602} answered; ${lastText(603)}`)
  process.env.ASK_DAILY_LIMIT = '1'
  await say(privateChat(604), '/ask one more?')
  check('/ask shares Ask’s daily cap', /as many questions as it can today/.test(lastText(604)))
  delete process.env.ASK_DAILY_LIMIT
  check('/ask: the Claude API never sees the chat id', !JSON.stringify(claudeCalls).includes('603'))

  /* -------------------------------------------------- unknown chats --- */
  const apiCalls = () => calls.filter((c) => c.method !== 'getChatMember').length // the News channel gate adds membership checks
  await say(privateChat(444), '/stop')
  check('unknown chats: /stop answers plainly (nothing to stop) and turns announcements off', sent(444).length === 1 && /isn’t linked to an account, so there’s nothing to stop/.test(lastText(444)) && /won’t get announcements/.test(lastText(444)) && !!botUsers()['444']?.optedOut, lastText(444))
  const before = apiCalls()
  const nAns = answers().length
  await say(privateChat(444), 'hello')
  await press(privateChat(444), 'mute:abc', { msgId: null })
  check('unknown chats: plain text is ignored', sent(444).length === 1)
  check('unknown chats: a Mute press is answered without acting', answers().length === nAns + 1 && /not linked/.test(lastAnswer().text) && apiCalls() === before + 1)
  await say(privateChat(444), '/alerts')
  check('unknown chats: /alerts explains linking, with Link wallet', /need a linked account/.test(view(444).text) && !!button(view(444).kb, /Link wallet/)?.url)
  await say(privateChat(445), '/help')
  check('unknown chats: /help is answered, with the menu', /Gully Labs bot/.test(view(445).text) && data(view(445).kb).includes('stk'))
  await say({ id: -100200, type: 'supergroup', title: 'Desk' }, '/gap@OtherBot NVDA', 9)
  check('a command addressed to another bot is ignored', sent(-100200).length === 0)
  await say({ id: -100200, type: 'supergroup', title: 'Desk' }, `/gap@${BOT} TSLA`, 9)
  check('a command addressed to this bot in a group is answered', /TSLA/.test(lastText(-100200)))
  await say({ id: -100200, type: 'supergroup', title: 'Desk' }, `/gap@${BOT} TSLA robinhood`, 9)
  const gkb = sent(-100200).at(-1)?.body.reply_markup?.inline_keyboard ?? []
  const ghb = flat(gkb).find((b) => b.text === '👥 Holders')
  check('group: 👥 Holders is a link to the site’s Holder Map (no web_app in groups)', !!ghb && ghb.url === 'https://gullylabs.xyz/holders/robinhood/TSLA' && !ghb.web_app, `${JSON.stringify(gkb).slice(0, 300)} | ${lastText(-100200).slice(0, 160)}`)
  tg.setHolderAvailabilityForTest(null)

  /* ---------------------------------------------------- alerts → Telegram --- */
  const created = await dev.post('/api/developer/alerts', { name: 'NVDA wide', chain: 'robinhood', ticker: 'NVDA', condition: { type: 'gap', pct: 2 }, telegram: true })
  const alertId = created.data?.alert?.id
  check('an alert can deliver to the linked Telegram chat', created.status === 201 && created.data.alert.telegram?.linked === true && created.data.secret === null, created.data?.error)
  const noLink = await dev2.post('/api/developer/alerts', { condition: { type: 'gap', pct: 2 }, telegram: true })
  check('Telegram delivery needs a linked chat', noLink.status === 400 && /Connect Telegram/.test(noLink.data?.error))
  const pasted = await dev2.post('/api/developer/alerts', { condition: { type: 'gap', pct: 2 }, telegramChatId: '12345' })
  check('pasted chat ids are refused', pasted.status === 400)
  await say(ada, '/alerts')
  check('/alerts lists the linked account’s alerts as buttons', data(view(111).kb).includes(`ac:${alertId}`) && /🟢 NVDA wide/.test(button(view(111).kb, /NVDA wide/)?.text ?? '') && /1 of 1 on Free/.test(view(111).text), view(111).text)

  tg.setMoversReaderForTest(async (w) => ({ window: w, byGap: [{ chain: 'bsc', ticker: 'TSLA', gapChangePp: -1.5, gapNow: -2.25 }], note: null }))
  await say(ada, '/movers')
  check('/movers lists movers as buttons to their cards', /Movers · 24h/.test(view(111).text) && flat(view(111).kb)[0].text === '1. TSLA · BNB  moved −1.50 → now −2.25%' && data(view(111).kb)[0] === 'c:bn:TSLA:m24', flat(view(111).kb)[0].text)
  tg.setMoversReaderForTest(async () => ({ byGap: [], note: 'Needs 24h of snapshots: the longest series so far covers 3 h.' }))
  await say(ada, '/movers')
  check('/movers with too little history says so in plain words (not the internal note)', /Not enough history yet to compare with 24h ago/.test(view(111).text) && !/snapshots/.test(view(111).text), view(111).text)

  const n0 = sent(111).length
  const now = Date.now()
  await evaluateAlerts([row({})], now)
  const msg = sent(111).at(-1)
  check('a firing alert sends one Telegram message', sent(111).length === n0 + 1)
  check('the delivery states the alert’s condition in plain words (an alert made without a direction is ↕ both)', msg.body.text.includes('Alert: ↕ 2% or more above or below the real share price'), msg.body.text)
  check('the delivery is a plain card: status emoji, ticker, chain, the gap as a sentence, token and real share price, liquidity', msg.body.text.includes('🔴 <b>NVDA</b> · Robinhood Chain\nNVDA token is <b>3.10% above</b> the real share price.') && msg.body.text.includes('Token $185.58 · Real share $180.00 · 💧 $50,000') && /Information only, not advice/.test(msg.body.text), msg.body.text)
  const kb = msg.body.reply_markup?.inline_keyboard ?? []
  check('delivery buttons: [🌐 Open ↗] [🔕 Mute 24h] [📈 Card]', JSON.stringify(flat(kb).map((b) => b.text)) === JSON.stringify(['🌐 Open ↗', '🔕 Mute 24h', '📈 Card']) && flat(kb)[0].url === 'https://gullylabs.xyz/tracker/robinhood/NVDA' && flat(kb)[1].callback_data === `mute:${alertId}` && flat(kb)[2].callback_data === 'c:rh:NVDA:x')
  const log1 = (await myAlerts()).find((a) => a.id === alertId).deliveries
  check('the delivery log records the Telegram send', log1.length === 1 && log1[0].channel === 'telegram' && log1[0].ok && log1[0].status === 200)
  await press(ada, 'c:rh:NVDA:x', { msgId: msg.resultId })
  check('📈 Card opens the stock card in place of the delivery', view(111).method === 'editMessageText' && view(111).id === msg.resultId && /🔴 <b>NVDA<\/b> · Robinhood Chain/.test(view(111).text))

  /* --------------------------------------------- DeepCore launch alert --- */
  const ev = { kind: 'deepcore.launch', chainId: 4663, chainKey: 'robinhood', chainName: 'Robinhood Chain', token: LAUNCHES[1].token, symbol: 'DTC', createdAt: LAUNCHES[1].createdAt, pools: LAUNCHES[1].legs, links: LAUNCHES[1].links }
  const lr = await tg.sendAlertTelegram({ owner: me, alertId: 'dcalert1', name: 'Launches', conditionText: 'new DeepCore launch on any chain', events: [ev], test: false })
  const lmsg = sent(111).at(-1)
  check('a DeepCore launch alert reaches the linked chat', lr.ok && /Gully Labs alert<\/b> “Launches”/.test(lmsg.body.text) && /new DeepCore launch on any chain/.test(lmsg.body.text) && lmsg.body.text.includes('<b>DTC</b> · Robinhood Chain'), lmsg?.body.text)
  const lkb = flat(lmsg.body.reply_markup?.inline_keyboard)
  check('launch alert: liquidity locked, no address or pool details', lmsg.body.text.includes('🔒 Liquidity locked') && !/0x|pool|lock #/i.test(lmsg.body.text), lmsg.body.text)
  check('launch alert buttons: "View DTC on DeepCore" and "Mute 24h"', lkb.some((b) => b.text === '🌐 View DTC on DeepCore ↗' && b.url === LAUNCHES[1].links.token) && lkb.some((b) => b.callback_data === 'mute:dcalert1'))
  // Holder Map alerts (alerts.mjs condition type 'holders'): plain words, Open map and Mute 24h.
  const hcond = { type: 'holders', chain: 'robinhood', token: '0x8d901a1b3f3a57f9c36a71382fa183476c41545b', symbol: 'DTC', metric: 'cluster', above: 20, dropPts: null }
  const hv = ui.deliveryView({ alertId: 'hold1', name: 'DTC whales', conditionText: 'x', condition: hcond, events: [{ kind: 'holders.alert', chain: 'robinhood', chainName: 'Robinhood Chain', token: hcond.token, symbol: 'DTC', metric: 'cluster', pct: 21.4, previousPct: 18.2, reason: 'above', pageUrl: 'https://gullylabs.xyz/holders/robinhood/0x8d901a1b3f3a57f9c36a71382fa183476c41545b', snapshotAt: new Date().toISOString() }], test: false })
  check('holder alert: the cluster’s share now and before, against the line, in plain words', hv.text.includes('🫧') && hv.text.includes('<b>DTC</b> on Robinhood Chain: the largest connected cluster now holds 21% (was 18%), above your 20% line.') && /Information only, not advice/.test(hv.text), hv.text)
  check('holder alert buttons: Open map (url) and Mute 24h', flat(hv.keyboard)[0].url === 'https://gullylabs.xyz/holders/robinhood/0x8d901a1b3f3a57f9c36a71382fa183476c41545b' && flat(hv.keyboard)[1].callback_data === 'mute:hold1', JSON.stringify(hv.keyboard))
  const hd = ui.deliveryView({ alertId: 'hold2', name: null, conditionText: 'x', condition: { ...hcond, above: null, dropPts: 5, metric: 'top10' }, events: [{ kind: 'holders.alert', chain: 'bsc', token: '0xabc', symbol: null, metric: 'top10', pct: 30, previousPct: 37.5, reason: 'drop', pageUrl: 'javascript:alert(1)' }], test: false })
  check('holder alert (sold): the drop in points; a non-https page falls back to the site’s map', hd.text.includes('the top 10 wallets now hold 30% (was 38%): they sold 7.5 points of their share.') && flat(hd.keyboard)[0].url === 'https://gullylabs.xyz/holders/bsc/0xabc', hd.text)
  check('holder alert: the condition reads plainly in My alerts', ui.conditionWords(hcond, {}) === 'the largest connected cluster of wallets of DTC · Robinhood Chain hold 20% or more' && ui.alertState({ coveredByPlan: true, enabled: true, armed: false, condition: hcond, kind: 'holders' }).emoji === '🟠', ui.conditionWords(hcond, {}))
  check('every callback_data in the card and launch views stays within 64 bytes', [...ui.callbackDataOf(card.kb), ...ui.callbackDataOf(lc.kb), ...ui.callbackDataOf(hv.keyboard)].every((d) => Buffer.byteLength(d) <= 64))

  /* -------------------------------------------------------------- Mute --- */
  await press(privateChat(444), `mute:${alertId}`, { msgId: null })
  check('Mute from an unlinked chat does nothing', /not linked/.test(lastAnswer().text) && !(await myAlerts())[0].mutedUntil)
  await say(privateChat(555, 'Bob'), `/start ${await linkCode(dev2)}`)
  await press(privateChat(555, 'Bob'), `mute:${alertId}`)
  check('Mute from another account’s chat is refused', /does not belong/.test(lastAnswer().text) && lastAnswer().show_alert === true)
  await press(ada, `mute:${alertId}`, { msgId: msg.resultId })
  const muted = (await myAlerts()).find((a) => a.id === alertId)
  check('Mute 24h from the linked chat pauses the alert for 24 hours', /Muted for 24h/.test(lastAnswer().text) && Math.abs(Date.parse(muted.mutedUntil) - Date.now() - 86_400_000) < 10_000)
  const n1 = sent(111).length
  await evaluateAlerts([row({ gapPct: 0.2, status: 'in-line' })], now + 40 * 60_000)
  await evaluateAlerts([row({ gapPct: 4 })], now + 80 * 60_000)
  check('a muted alert does not fire', sent(111).length === n1)
  await dev.post(`/api/developer/alerts/${alertId}/resume`)
  check('resume ends the mute', (await myAlerts()).find((a) => a.id === alertId).mutedUntil === null)

  /* --------------------------------------------------------- rate limits --- */
  fail429 = 1
  const t0 = Date.now()
  const test = await dev.post(`/api/developer/alerts/${alertId}/test`)
  // Spacing is read from the server's own send grants, not from when the stub received each call: network
  // and event-loop jitter under load moved arrivals by tens of ms and made these checks flaky.
  const tries = sent(111).filter((c) => c.at >= t0)
  const grantTries = tg.sendGrantsForTest(111).filter((x) => x >= t0)
  check('a 429 is retried after retry_after', test.data?.results?.[0]?.ok === true && tries.length === 2 && grantTries.length === 2 && grantTries[1] - grantTries[0] >= 1_000, `${tries.length} tries, ${grantTries[1] ? grantTries[1] - grantTries[0] : '-'} ms between grants`)

  /* ----------------------------------------------------- stocks and search --- */
  const c810 = privateChat(810)
  await press(c810, 'stk:rh:p1', { msgId: null })
  const g1 = view(810)
  const tick1 = flat(g1.kb).filter((b) => /^c:rh:/.test(b.callback_data ?? ''))
  const names1 = tick1.map((b) => b.text.split(' ').at(-1))
  check('grid: 12 tickers per page, 3 per row, alphabetical', tick1.length === 12 && g1.kb.slice(0, 4).every((r) => r.length === 3) && JSON.stringify(names1) === JSON.stringify([...names1].sort()), names1.join())
  check('grid: status colours from the live rows (NVDA 🔴, no reading ⚪)', tick1.some((b) => b.text === '🔴 AAPL') === false && tick1.some((b) => b.text === '⚪ AAPL') && flat(g1.kb).some((b) => /^⚪ AMD$/.test(b.text)))
  const pager = g1.kb.find((r) => r.some((b) => /^Page /.test(b.text)))
  check('grid: ◀ Page 1/3 ▶ (wrapping), Search, Back to chains, Menu', JSON.stringify(pager?.map((b) => [b.text, b.callback_data])) === JSON.stringify([['◀', 'stk:rh:p3'], ['Page 1/3', 'noop'], ['▶', 'stk:rh:p2']]) && data(g1.kb).includes('srch:rh') && hasNav(g1.kb) && button(g1.kb, /Back/).callback_data === 'stk')
  await press(c810, 'stk:rh:p2')
  const g2 = view(810)
  check('grid: page 2 is the next 12, edited in place', g2.method === 'editMessageText' && g2.id === g1.id && flat(g2.kb).filter((b) => /^c:rh:/.test(b.callback_data ?? '')).every((b) => b.callback_data.endsWith(':g2')) && /Page 2\/3/.test(JSON.stringify(g2.kb)))
  await press(c810, 'stk:rh:p3')
  check('grid: the last page holds the rest (33 = 12 + 12 + 9)', flat(view(810).kb).filter((b) => /^c:rh:/.test(b.callback_data ?? '')).length === 9)
  await press(c810, 'noop')
  check('the "Page x/y" label is answered and changes nothing', view(810).id === g1.id && /Page 3\/3/.test(JSON.stringify(view(810).kb)))
  await press(c810, 'stk:bn:p1')
  check('grid: BNB Chain has 14 stock tokens on 2 pages', /14 stock tokens/.test(view(810).text) && /Page 1\/2/.test(JSON.stringify(view(810).kb)))
  await press(c810, 'c:rh:NVDA:g2')
  check('card from grid page 2: Back returns to page 2', button(view(810).kb, /Back/).callback_data === 'stk:rh:p2')
  // Sparkline from 24h of history.
  const nowS = Date.now() / 1000
  const hist = Array.from({ length: 24 }, (_, i) => [nowS - 86_400 + i * 3600 + 60, -0.4 + (3.5 * i) / 23, 185, 180])
  tg.setHistoryReaderForTest((chain, ticker) => (chain === 'robinhood' && ticker === 'NVDA' ? hist : []))
  await press(c810, 'c:rh:NVDA:g1')
  const sp = view(810).text
  check('card: a 24h sparkline of the gap in Unicode blocks', /24h gap <code>[▁▂▃▄▅▆▇█ ]{20,24}<\/code>/.test(sp) && sp.includes('▁') && sp.includes('█'), sp)
  check('card: the sparkline’s min and max labels', sp.includes('low −0.40% · high +3.10%'), sp)
  await press(c810, 'c:rh:TSLA:g1')
  check('card: too little history says so (no flat line)', /not enough history yet/.test(view(810).text) && !/<code>/.test(view(810).text))
  check('sparkline: rising history climbs left to right', ui.sparkline(hist, Date.now()).line.startsWith('▁') && ui.sparkline(hist, Date.now()).line.endsWith('█'))
  // Search.
  await press(c810, 'srch:rh')
  const pr = sent(810).at(-1)
  check('Search asks for a ticker with force_reply', /^🔍 Search Robinhood Chain:/.test(pr.body.text) && pr.body.reply_markup?.force_reply === true && /reply box/.test(lastAnswer().text))
  await say(c810, 'nvda', 810, { reply_to_message: { message_id: pr.resultId, from: { id: BOT_ID, is_bot: true }, text: pr.body.text } })
  check('Search: an exact ticker opens its card', /🔴 <b>NVDA<\/b> · Robinhood Chain/.test(view(810).text) && button(view(810).kb, /Back/).callback_data === 'stk:rh:p1')
  await press(c810, 'srch:rh')
  await say(c810, 'micro')
  check('Search: a name matches (private chat, no reply needed)', JSON.stringify(data(view(810).kb).filter((d) => d.startsWith('c:'))) === JSON.stringify(['c:rh:MSFT:s', 'c:rh:MU:s']) && /2 matches/.test(view(810).text), data(view(810).kb).join())
  await press(c810, 'srch:rh')
  await say(c810, 'zzqq <b>')
  check('Search: no match says so, escaped, with Search again', /No stock token on Robinhood Chain matches “zzqq &lt;b&gt;”/.test(view(810).text) && data(view(810).kb).includes('srch:rh'))
  ui.clearStatesForTest()
  await say(c810, 'jpm', 810, { reply_to_message: { message_id: 1, from: { id: BOT_ID, is_bot: true }, text: '🔍 Search BNB Chain: type a ticker or a company name, e.g. NVDA.' } })
  check('Search: a reply still works after the state expired (read from the prompt)', /<b>JPM<\/b> · BNB Chain/.test(view(810).text))
  const n810 = viewCalls(810).length
  await say(c810, 'nvda')
  check('plain text with no prompt pending is ignored', viewCalls(810).length === n810)

  /* ---------------------------------------------------- top, movers, errors --- */
  const c820 = privateChat(820)
  tg.setMoversReaderForTest(async (w) => ({ window: w, byGap: [{ chain: 'bsc', ticker: 'TSLA', gapChangePp: w === '1h' ? 0.5 : -1.5, gapNow: -2.25 }], note: null }))
  await press(c820, 'mv:24h', { msgId: null })
  check('Movers: 24h / 1h toggles, Refresh, Back, Menu', ['mv:24h', 'mv:1h'].every((d) => data(view(820).kb).includes(d)) && hasNav(view(820).kb) && /• 24h •/.test(JSON.stringify(view(820).kb)))
  await press(c820, 'mv:1h')
  check('Movers: the 1h window', /Movers · 1h/.test(view(820).text) && data(view(820).kb)[0] === 'c:bn:TSLA:m1' && /moved \+0\.50 → now/.test(flat(view(820).kb)[0].text))
  await press(c820, 'c:bn:TSLA:m1')
  check('card from movers: Back returns to movers', button(view(820).kb, /Back/).callback_data === 'mv:1h')
  await press(c820, 'top')
  const sends820 = sent(820).length
  const edits820 = calls.filter((c) => c.method === 'editMessageText' && c.body.chat_id === '820').length
  await press(c820, 'top')
  check('"message is not modified" is quiet: no new message, the press is answered', sent(820).length === sends820 && calls.filter((c) => c.method === 'editMessageText' && c.body.chat_id === '820').length === edits820 + 1 && answers().at(-1).body.callback_query_id === pressedIds.at(-1))
  await press(c820, 'top', { msgId: 999_999 })
  check('"message to edit not found" sends the screen as a new message', sent(820).length === sends820 + 1 && /Top gaps/.test(lastText(820)))
  for (const stale of ['zz:old', 'v:stk:rh:p2', 'c:rh:ZZZZ:g1', 'stk:xx:p1', 'al:rh:NVDA:g1:500']) {
    const n = sent(820).length
    await press(c820, stale)
    check(`an expired or unknown button (${stale}) gets a toast and a fresh menu`, /This menu expired, here’s a fresh one/.test(lastAnswer().text) && sent(820).length === n + 1 && data(view(820).kb).includes('stk'))
  }

  /* ------------------------------------------------------- every route --- */
  // Crawl every button reachable from the menu in unlinked chats (each press in its own chat, so the
  // per-chat send limit does not slow the crawl). At most 3 routes of each shape.
  tg.setAskForTest(async () => ({ ok: true, answer: 'Stub answer.', citations: [] }))
  const seenShape = new Map()
  const queue = data(ui.MENU_KEYBOARD)
  const visited = new Set()
  let crawlChat = 900_000
  let crawlBad = []
  let crawled = 0
  while (queue.length && crawled < 160) {
    const d = queue.shift()
    if (visited.has(d) || d === 'noop') continue
    visited.add(d)
    const shape = d.replace(/[0-9a-f]{40}/, 'H').replace(/[A-Z.]{1,8}/g, 'T').replace(/\d+/g, 'N')
    if ((seenShape.get(shape) ?? 0) >= 3) continue
    seenShape.set(shape, (seenShape.get(shape) ?? 0) + 1)
    const chat = privateChat(++crawlChat)
    const nCalls = calls.length
    await press(chat, d, { msgId: null })
    crawled++
    const ans = answers().find((a) => a.body.callback_query_id === pressedIds.at(-1))
    if (!ans || /expired/.test(ans.body.text ?? '')) crawlBad.push(`${d}: ${ans ? 'expired' : 'not answered'}`)
    const shown = calls.slice(nCalls).filter((c) => VIEW.has(c.method) && c.body.reply_markup?.inline_keyboard)
    for (const s of shown) {
      const k = s.body.reply_markup.inline_keyboard
      if (d !== 'm' && !/^aiq/.test(d) && !hasNav(k)) crawlBad.push(`${d}: no Back/Menu`)
      for (const nd of data(k)) if (!visited.has(nd) && !nd.endsWith('!')) queue.push(nd)
    }
  }
  check(`every reachable route answers and is known (${crawled} routes crawled)`, crawled > 40 && !crawlBad.some((x) => /expired|answered/.test(x)), crawlBad.join('; '))
  check('every screen but the menu has Back and Menu', !crawlBad.some((x) => /Back/.test(x)), crawlBad.join('; '))
  tg.setAskForTest(null)

  /* ------------------------------------------- alert stepper, unlinked --- */
  await press(privateChat(840), 'al:rh:NVDA:g1', { msgId: null })
  check('Alert me in an unlinked chat explains, with Link wallet to the portal Alerts tab', /need a linked account/.test(view(840).text) && button(view(840).kb, /Link wallet/)?.url === 'https://app.gullylabs.xyz/#alerts' && button(view(840).kb, /Back/).callback_data === 'c:rh:NVDA:g1')
  await press(privateChat(840), 'ma', { msgId: null })
  check('My alerts in an unlinked chat explains, with Link wallet', /need a linked account/.test(view(840).text))

  /* -------------------------------------------- alert stepper, linked --- */
  await press(ada, 'al:rh:NVDA:g1', { msgId: null })
  const s1 = view(111)
  check('stepper 1/3: threshold ±1% ±2% ±3% Custom, Back to the card', JSON.stringify(s1.kb[0].map((b) => b.callback_data)) === JSON.stringify(['al:rh:NVDA:g1:1', 'al:rh:NVDA:g1:2', 'al:rh:NVDA:g1:3', 'alx:rh:NVDA:g1']) && button(s1.kb, /Back/).callback_data === 'c:rh:NVDA:g1' && /Step 1 of 3/.test(s1.text))
  await press(ada, 'al:rh:NVDA:g1:2')
  const s2 = view(111)
  check('stepper 2/3: direction ▲ Above / ▼ Below / ↕ Both, Back to step 1', JSON.stringify(s2.kb[0].map((b) => b.text)) === JSON.stringify(['▲ Above', '▼ Below', '↕ Both']) && JSON.stringify(s2.kb[0].map((b) => b.callback_data)) === JSON.stringify(['al:rh:NVDA:g1:2:p', 'al:rh:NVDA:g1:2:d', 'al:rh:NVDA:g1:2:e']) && button(s2.kb, /Back/).callback_data === 'al:rh:NVDA:g1' && s2.id === s1.id)
  check('stepper 2/3: each direction is explained with the chosen threshold, in plain words', /▲ Above: the token is 2% or more above the real share price/.test(s2.text) && /▼ Below: the token is 2% or more below it/.test(s2.text) && /↕ Both: either way/.test(s2.text) && !/fair|gap ≥|premium|discount/i.test(s2.text), s2.text)
  await press(ada, 'al:rh:NVDA:g1:2:p')
  check('stepper 3/3 (▲ Above): a one-sided threshold at the chosen percent', /Fires when the token is 2% or more above the real share price\./.test(view(111).text) && data(view(111).kb).includes('alk:rh:NVDA:g1:2:p'), view(111).text)
  await press(ada, 'al:rh:NVDA:g1:2:d')
  check('stepper 3/3 (▼ Below): a one-sided threshold at the chosen percent', /Fires when the token is 2% or more below the real share price\./.test(view(111).text) && data(view(111).kb).includes('alk:rh:NVDA:g1:2:d'), view(111).text)
  check('the stepper’s condition: p → above, d → below, e → both, at the chosen percent', JSON.stringify(['p', 'd', 'e'].map((d) => ui.conditionFor(1.5, d).condition)) === JSON.stringify([{ type: 'gap', pct: 1.5, direction: 'above' }, { type: 'gap', pct: 1.5, direction: 'below' }, { type: 'gap', pct: 1.5, direction: 'both' }]))
  await press(ada, 'al:rh:NVDA:g1:2:e')
  const s3 = view(111)
  check('stepper 3/3: summary with ✅ Create and Back', /Fires when the token is 2% or more above or below the real share price\./.test(s3.text) && data(s3.kb).includes('alk:rh:NVDA:g1:2:e') && button(s3.kb, /Back/).callback_data === 'al:rh:NVDA:g1:2')
  await press(ada, 'alk:rh:NVDA:g1:2:e')
  check('plan limit: the Free plan’s one alert is in use, with ⬆ Upgrade', /Plan limit reached/.test(view(111).text) && /Free plan includes 1 alert/.test(view(111).text) && button(view(111).kb, /Upgrade/)?.url === 'https://app.gullylabs.xyz/#billing' && (await myAlerts()).length === 1, view(111).text)
  // Custom threshold.
  await press(ada, 'alx:rh:NVDA:g1')
  const cp = sent(111).at(-1)
  check('✏️ Custom asks for a percentage with force_reply', /^✏️ Custom threshold for NVDA on Robinhood Chain:/.test(cp.body.text) && cp.body.reply_markup?.force_reply === true)
  await say(ada, '1.5%')
  check('Custom: the typed threshold moves on to the direction step (three buttons)', /Alert for NVDA<\/b> · 1\.5%/.test(view(111).text) && /Which direction/.test(view(111).text) && ['al:rh:NVDA:g1:1.5:p', 'al:rh:NVDA:g1:1.5:d', 'al:rh:NVDA:g1:1.5:e'].every((d) => data(view(111).kb).includes(d)), view(111).text)
  await press(ada, 'alx:rh:NVDA:g1')
  await say(ada, 'lots')
  check('Custom: a bad number is refused, with Try again', /not a percentage from 0\.1 to 100/.test(view(111).text) && data(view(111).kb).includes('alx:rh:NVDA:g1'))

  /* ------------------------------------------------------------ my alerts --- */
  await press(ada, 'ma')
  await press(ada, `ac:${alertId}`)
  const acard = view(111)
  check('alert card: condition, state, delivery and actions', /NVDA wide/.test(acard.text) && /When: ↕ 2% or more above or below the real share price/.test(acard.text) && /State: (watching|fired · watching again once the gap closes)/.test(acard.text) && JSON.stringify(data(acard.kb)) === JSON.stringify([`ap:${alertId}`, `am:${alertId}`, `at:${alertId}`, `ad:${alertId}`, 'ma', 'm']), JSON.stringify(data(acard.kb)))
  await press(ada, `ap:${alertId}`)
  check('⏸ Pause pauses it (alerts module) and the card offers ▶ Resume', /Paused/.test(lastAnswer().text) && (await myAlerts())[0].enabled === false && data(view(111).kb).includes(`ar:${alertId}`))
  await press(ada, `ar:${alertId}`)
  check('▶ Resume resumes it', /Resumed/.test(lastAnswer().text) && (await myAlerts())[0].enabled === true)
  await press(ada, `am:${alertId}`)
  check('🔕 Mute 24h mutes it, said as "for 24h" (no timestamp)', /Muted for 24h/.test(lastAnswer().text) && !!(await myAlerts())[0].mutedUntil && /State: muted for 24h/.test(view(111).text), view(111).text)
  const nT = sent(111).length
  await press(ada, `at:${alertId}`)
  check('🧪 Test sends a test delivery to this chat', sent(111).slice(nT).some((c) => /Test message/.test(c.body.text)) && /Last delivery: ✅ Telegram \(test\) · (just now|\d+ min ago)/.test(view(111).text), view(111).text)
  await press(ada, `ad:${alertId}`)
  check('🗑 Delete asks first', /Delete “NVDA wide”\?/.test(view(111).text) && data(view(111).kb).includes(`adx:${alertId}`) && button(view(111).kb, /Back/).callback_data === `ac:${alertId}` && (await myAlerts()).length === 1)
  await press(ada, `adx:${alertId}`)
  check('🗑 Yes, delete removes it and shows the list', /Deleted/.test(lastAnswer().text) && (await myAlerts()).length === 0 && /No alerts yet/.test(view(111).text))
  await press(ada, `ac:${alertId}`)
  check('a deleted alert’s old button says so', /no longer exists/.test(lastAnswer().text))
  await press(ada, 'alk:rh:NVDA:g1:2:e')
  const made = (await myAlerts())[0]
  check('✅ Create makes the alert through the alerts module (Telegram on, no webhook)', /Alert created/.test(view(111).text) && made?.chain === 'robinhood' && made.ticker === 'NVDA' && made.condition.type === 'gap' && made.condition.pct === 2 && made.telegram?.linked === true && made.webhook === null, JSON.stringify(made))
  check('✅ Create with ↕ Both stores direction both', made?.condition.direction === 'both', JSON.stringify(made?.condition))
  await press(ada, `adx:${made.id}`)
  await press(ada, 'alk:rh:NVDA:g1:1.5:d')
  const below = (await myAlerts())[0]
  check('✅ Create with ▼ Discount makes a one-sided alert (direction below)', /Alert created/.test(view(111).text) && /fires when the token is 1\.5% or more below the real share price/.test(view(111).text) && below?.condition.type === 'gap' && below.condition.pct === 1.5 && below.condition.direction === 'below', JSON.stringify(below?.condition))
  await press(ada, `ac:${below.id}`)
  check('the alert card states the direction', /When: ▼ 1\.5% or more below the real share price/.test(view(111).text), view(111).text)
  const nBelow = sent(111).length
  await evaluateAlerts([row({ gapPct: 3.1, status: 'premium' })], Date.now() + 40 * 60_000)
  check('a ▼ discount alert does not fire on a premium', sent(111).length === nBelow)
  await evaluateAlerts([row({ gapPct: -1.8, status: 'discount' })], Date.now() + 41 * 60_000)
  check('a ▼ discount alert fires on a discount, and its message says ▼ Discount', sent(111).length === nBelow + 1 && sent(111).at(-1).body.text.includes('Alert: ▼ 1.5% or more below the real share price'), sent(111).at(-1)?.body.text)
  await press(ada, `adx:${below.id}`)
  // DeepCore launch alert.
  await press(ada, 'dla:0')
  check('launch alert 1/2: chain choice (any or one)', JSON.stringify(data(view(111).kb).slice(0, 5)) === JSON.stringify(['dla:0:0', 'dla:0:56', 'dla:0:999', 'dla:0:4663', 'dla:0:8453']))
  await press(ada, 'dla:0:4663')
  check('launch alert 2/2: summary with Create', /every new token launched on DeepCore on Robinhood Chain/.test(view(111).text) && data(view(111).kb).includes('dlk:4663'))
  await press(ada, 'dlk:4663')
  const dca = (await myAlerts())[0]
  check('the DeepCore launch alert is created (kind deepcore-launch, chain 4663)', /Alert created/.test(view(111).text) && dca?.kind === 'deepcore-launch' && dca.condition.chainId === 4663 && dca.telegram?.linked === true, JSON.stringify(dca))

  /* -------------------------------------------------------------- Gully AI --- */
  const askedQ = []
  tg.setAskForTest(async (chatId, q) => {
    askedQ.push([chatId, q])
    return { ok: true, answer: 'Plans <b>x</b> and **bold**.', citations: [1, 2, 3, 4].map((n) => ({ n, title: `Doc ${n}`, url: `https://docs.gullylabs.xyz/p${n}` })) }
  })
  const c850 = privateChat(850)
  await press(c850, 'ai', { msgId: null })
  check('🤖 Gully AI: an intro screen and a force_reply prompt', calls.some((c) => c.method === 'sendMessage' && c.body.chat_id === '850' && c.body.reply_markup?.force_reply === true && /^🤖 Ask Gully AI:/.test(c.body.text)) && /Gully AI<\/b>\nAnswers from the Gully Labs docs/.test(view(850).text) && data(view(850).kb).includes('aiq:0'))
  await say(c850, 'What do the plans include?')
  const ai = view(850)
  check('Gully AI: the answer, escaped, with at most 3 source url buttons', askedQ.at(-1)?.[1] === 'What do the plans include?' && ai.text.includes('Plans &lt;b&gt;x&lt;/b&gt; and bold.') && flat(ai.kb).filter((b) => b.url).length === 3 && flat(ai.kb).filter((b) => b.url).every((b) => /^https:\/\/docs\.gullylabs\.xyz\/p[123]$/.test(b.url)))
  check('Gully AI: [💬 Ask another] [🏠 Menu]', JSON.stringify(ai.kb.at(-1).map((b) => b.text)) === JSON.stringify(['💬 Ask another', '🏠 Menu']))
  const nAi = sent(850).length
  await press(c850, 'ai!', { msgId: ai.id })
  check('Ask another sends a new prompt and leaves the answer untouched', sent(850).length === nAi + 1 && sent(850).at(-1).body.reply_markup?.force_reply === true && !calls.slice(-3).some((c) => c.method === 'editMessageText' && c.body.message_id === ai.id))
  await press(c850, 'm!', { msgId: ai.id })
  check('Menu from an answer opens a new menu message', sent(850).at(-1).body.reply_markup?.inline_keyboard && data(view(850).kb).includes('stk') && view(850).method === 'sendMessage')
  await press(c850, 'aiq:1', { msgId: null })
  check('an example question is answered', askedQ.at(-1)?.[1] === 'What does the gap measure?')
  ui.clearStatesForTest()
  await say(c850, 'after a restart?', 850, { reply_to_message: { message_id: 5, from: { id: BOT_ID, is_bot: true }, text: '🤖 Ask Gully AI: type your question about Gully Labs, the tracker, alerts or plans.' } })
  check('Gully AI: a reply to the prompt works without state', askedQ.at(-1)?.[1] === 'after a restart?')
  tg.setAskForTest(null)

  /* ------------------------------------------------------------ settings --- */
  await press(ada, 'set')
  const st = view(111)
  check('⚙️ Settings: wallet (short), workspace, chat, alerts, usage notices', st.text.includes(`Wallet: <code>${me.slice(0, 6)}…${me.slice(-4)}</code>`) && /Team: /.test(st.text) && /Chat: this private chat/.test(st.text) && /Alerts: 1/.test(st.text) && /Usage notices: off/.test(st.text), st.text)
  check('Settings buttons: Mute all, Usage notices, Announcements, Unlink, Back, Menu', JSON.stringify(data(st.kb)) === JSON.stringify(['smu', 'snt:1', 'san:0', 'sul', 'm', 'm']), JSON.stringify(data(st.kb)))
  check('Settings shows announcements on', /Announcements: on/.test(st.text))
  await press(ada, 'snt:1')
  const meNow = await dev.call('/api/developer/me')
  check('usage notices turn on (profile notify)', /Usage notices on/.test(lastAnswer().text) && meNow.data?.profile?.notify?.telegramUsage === true && /Usage notices: on/.test(view(111).text), JSON.stringify(meNow.data?.profile))
  await press(ada, 'smu')
  check('🔕 Mute all 24h mutes every alert', /1 alert muted for 24h/.test(lastAnswer().text) && !!(await myAlerts())[0].mutedUntil)
  await press(ada, 'sul')
  check('🔓 Unlink asks first', /Unlink this chat from/.test(view(111).text) && data(view(111).kb).includes('suly') && button(view(111).kb, /Back/).callback_data === 'set')
  await press(ada, 'suly')
  check('🔓 Yes, unlink unlinks the chat', /Unlinked/.test(view(111).text) && (await dev.call('/api/developer/telegram')).data.linked === null)
  await say(ada, `/start ${await linkCode(dev)}`)
  check('the chat links again', !!(await dev.call('/api/developer/telegram')).data.linked)

  /* -------------------------------------------------------------- groups --- */
  const group = { id: -100300, type: 'supergroup', title: 'Trading <desk>' }
  await say(group, `/start@${BOT} ${await linkCode(dev2)}`, 777)
  check('a group links with the code', /Linked to/.test(lastText(-100300)) && (await dev2.call('/api/developer/telegram')).data.linked?.chatTitle === 'Trading <desk>')
  check('linking the group replaced the account’s private chat', (await dev2.call('/api/developer/telegram')).data.linked.chatType === 'supergroup')
  await say(group, `/start ${await linkCode(dev)}`, 778)
  check('a group linked to one account cannot be taken by another', /already linked to another account/.test(lastText(-100300)))
  const gv = viewCalls(-100300).length
  await press(group, 'al:rh:NVDA:g1', { fromId: 778 })
  check('group: another member cannot start an alert (toast, no change)', /Only the person who linked this group can create alerts here/.test(lastAnswer().text) && lastAnswer().show_alert === true && viewCalls(-100300).length === gv)
  await press(group, 'alk:rh:NVDA:g1:2:e', { fromId: 778 })
  check('group: another member cannot create an alert', /Only the person who linked/.test(lastAnswer().text) && (await dev2.call('/api/developer/alerts')).data.alerts.length === 0)
  await press(group, 'sul', { fromId: 778 })
  check('group: another member cannot unlink from Settings', /Only the person who linked this group can unlink it/.test(lastAnswer().text))
  await press(group, 'al:rh:NVDA:g1', { fromId: 777 })
  check('group: the person who linked it gets the stepper', /Step 1 of 3/.test(view(-100300).text))
  await press(group, 'alk:rh:NVDA:g1:3:e', { fromId: 777 })
  const ga = (await dev2.call('/api/developer/alerts')).data.alerts
  check('group: the person who linked it creates an alert', ga.length === 1 && ga[0].condition.pct === 3)
  await press(group, `ap:${ga[0].id}`, { fromId: 778 })
  check('group: another member cannot pause it', /Only the person who linked/.test(lastAnswer().text) && (await dev2.call('/api/developer/alerts')).data.alerts[0].enabled === true)
  await press(group, 'ma', { fromId: 778 })
  check('group: any member can see the alerts', data(view(-100300).kb).includes(`ac:${ga[0].id}`))
  await say(group, '/stop', 778)
  check('only the user who linked a group can unlink it', /Only the person who linked/.test(lastText(-100300)) && !!(await dev2.call('/api/developer/telegram')).data.linked)
  await say(group, '/stop', 777)
  check('the user who linked the group unlinks it', /Unlinked/.test(lastText(-100300)) && (await dev2.call('/api/developer/telegram')).data.linked === null)

  /* ---------------------------------------------------------------- /stop --- */
  await say(ada, '/stop')
  check('/stop unlinks a private chat', /Unlinked/.test(lastText(111)) && (await dev.call('/api/developer/telegram')).data.linked === null)
  const n2 = sent(111).length
  await say(ada, '/stop')
  check('/stop again in the now unlinked chat answers "nothing to stop" and turns announcements off', sent(111).length === n2 + 1 && /nothing to stop/.test(lastText(111)) && !!botUsers()['111']?.optedOut)
  await press(ada, 'san:1', { msgId: null })
  check('announcements back on from the Settings switch', /Announcements on/.test(lastAnswer().text ?? '') && !botUsers()['111']?.optedOut)
  await say(ada, `/start ${await linkCode(dev)}`)
  const unl = await dev.post('/api/developer/telegram/unlink')
  check('the dashboard can unlink, and the chat is told', unl.status === 200 && (await dev.call('/api/developer/telegram')).data.linked === null)
  await new Promise((r) => setTimeout(r, 1_300))
  check('the unlinked chat got a notice', /unlinked from the app dashboard/.test(lastText(111)))

  /* --------------------------------------------------------- quality sweeps --- */
  const spaced = tg.sendGrantsForTest(111)
  const edits111 = calls.filter((c) => c.method === 'editMessageText' && c.body.chat_id === '111').length
  check('at most one send or edit a second per chat (edits count too)', edits111 > 10 && spaced.length >= viewCalls(111).length && spaced.slice(1).every((x, i) => x - spaced[i] >= 1_000), spaced.map((x, i) => (i ? x - spaced[i - 1] : 0)).join())
  const allKb = calls.filter((c) => c.body?.reply_markup?.inline_keyboard).flatMap((c) => data(c.body.reply_markup.inline_keyboard))
  const longest = allKb.reduce((a, d) => (Buffer.byteLength(d) > Buffer.byteLength(a) ? d : a), '')
  check(`callback_data is at most 64 bytes in every keyboard sent (${allKb.length} buttons; longest ${Buffer.byteLength(longest)} bytes)`, allKb.length > 300 && allKb.every((d) => Buffer.byteLength(d) <= 64), longest)
  check('every button press was answered exactly once', pressedIds.every((id) => answers().filter((a) => a.body.callback_query_id === id).length === 1), `${pressedIds.length} presses`)
  check('every inline button has a callback, a url or a web_app, and a short label', calls.filter((c) => c.body?.reply_markup?.inline_keyboard).every((c) => flat(c.body.reply_markup.inline_keyboard).every((b) => (b.callback_data || /^https:\/\//.test(b.url ?? b.web_app?.url ?? '')) && b.text.length <= 64)))
  const kbCalls = calls.filter((c) => c.body?.reply_markup?.inline_keyboard)
  check('web_app buttons only go to private chats (Telegram refuses them in groups)', kbCalls.some((c) => Number(c.body.chat_id) < 0) && !kbCalls.some((c) => Number(c.body.chat_id) < 0 && flat(c.body.reply_markup.inline_keyboard).some((b) => b.web_app)))
  // Plain words for everyone (owner, 2026-10-18): no source names, no technical terms, no raw timestamps on any
  // screen, alert or button. Gully AI's answers come from the docs and may name the API, so they are left out.
  const JARGON = /api\.|\bAPI\b|\bRPC\b|\bfeeds?\b|\bUTC\b|endpoint|indexer|\bpool\b|not reported|unreadable|on[- ]chain|fair price|\d{4}-\d{2}-\d{2} \d{2}:\d{2}/i
  const shownTexts = calls.filter((c) => VIEW.has(c.method) || c.method === 'answerCallbackQuery').map((c) => c.body.text ?? c.body.caption ?? '').filter((x) => !/^<b>🤖 Gully AI<\/b>/.test(x))
  const buttonTexts = calls.flatMap((c) => flat(c.body?.reply_markup?.inline_keyboard).map((b) => b.text)).filter((x) => !/^📄 \[\d\] /.test(x)) // Gully AI's source buttons carry doc titles
  const descriptions = cmdList.map((c) => c.description)
  const jargon = [...shownTexts, ...buttonTexts, ...descriptions].filter((x) => JARGON.test(x))
  check(`plain words: no screen, alert, toast, button or command says "api.", "API", "RPC", "feed", "UTC", "pool", "on-chain" or a raw time (${shownTexts.length} texts, ${buttonTexts.length} buttons)`, shownTexts.length > 100 && jargon.length === 0, jargon.slice(0, 3).join(' | '))
  const chainlink = shownTexts.filter((x) => /Chainlink/.test(x))
  check('Chainlink is named at most once per screen, and only in the help text', chainlink.every((x) => /Gully Labs bot/.test(x) && x.split('Chainlink').length === 2), chainlink.filter((x) => !/Gully Labs bot/.test(x)).slice(0, 2).join(' | '))
  check('"Information only" appears at most once per screen', shownTexts.every((x) => x.split(/information only/i).length <= 2), shownTexts.find((x) => x.split(/information only/i).length > 2))

  /* -------------------------------------------------- News channel gate --- */
  const ng1 = privateChat(9901, 'Gus')
  nonMembers.add(9901)
  await say(ng1, '/start')
  const ngMsg = lastShown(9901)
  const ngKb = ngMsg?.reply_markup?.inline_keyboard ?? []
  check('gate: a non-follower gets the Join @GullyLabsNews screen instead of the bot', /Follow Gully Labs News/.test(ngMsg?.text ?? ngMsg?.caption ?? '') && flat(ngKb).some((b) => b.url === 'https://t.me/GullyLabsNews') && data(ngKb).includes('jchk'), ngMsg?.text)
  await say(ng1, '/top')
  check('gate: commands stay blocked until they follow', /Follow Gully Labs News/.test(shownText(9901)))
  await press(ng1, 'jchk', { msgId: null })
  check('gate: "I’ve joined" without joining is refused with an alert', /Not joined yet/.test(lastAnswer().text ?? '') && /few seconds/.test(lastAnswer().text ?? '') && lastAnswer().show_alert === true)
  nonMembers.delete(9901)
  await press(ng1, 'jchk', { msgId: null })
  check('gate: after joining, "I’ve joined" opens the menu', /Thanks for following/.test(lastAnswer().text ?? '') && /Pick a screen below/.test(lastText(9901)))
  await say(ng1, '/help')
  check('gate: a follower uses the bot normally', !/Follow Gully Labs News/.test(lastText(9901)))
  const ng2 = privateChat(9902, 'Ivy')
  nonMembers.add(9902)
  await press(ng2, 'mute:nonexistent', { msgId: null })
  check('gate: Mute buttons on alert deliveries are never gated', !/Follow Gully Labs News/.test(lastText(9902)))
  memberCheckBroken = true
  const ng3 = privateChat(9903, 'Lee')
  nonMembers.add(9903)
  await say(ng3, '/help')
  check('gate: if membership cannot be checked, the bot fails open', !/Follow Gully Labs News/.test(lastText(9903)) && lastText(9903).length > 0)
  memberCheckBroken = false

  /* ---- gate improvements: one free action, a join screen that sells the channel, a friendlier retry, the funnel --- */
  process.env.TELEGRAM_GATE_FREE_ACTIONS = '1'
  const funBefore = users.gateFunnel()
  const fa = privateChat(9920, 'Zed')
  nonMembers.add(9920)
  await say(fa, '/start')
  check('free action: the menu itself is free (no join screen on /start)', !/Follow Gully Labs News/.test(shownText(9920)) && shownText(9920).length > 0, shownText(9920))
  await say(fa, '/top')
  check('free action: the first feature use goes through before the join screen', !/Follow Gully Labs News/.test(shownText(9920)) && shownText(9920).length > 0, shownText(9920))
  await say(fa, '/movers')
  const faGate = lastShown(9920)
  check('free action: the second one gets the join screen', /Follow Gully Labs News/.test(faGate?.text ?? faGate?.caption ?? ''), faGate?.text ?? faGate?.caption)
  check('join screen: sells the channel (gaps, launches, product drops) and keeps one Join button', /widest stock-token gaps/.test(faGate?.caption ?? faGate?.text ?? '') && /new DeepCore launches/.test(faGate?.caption ?? faGate?.text ?? '') && flat(faGate?.reply_markup?.inline_keyboard ?? []).filter((b) => b.url === 'https://t.me/GullyLabsNews').length === 1)
  check('join screen: private chats get it on the kit banner (an animation with the caption)', calls.some((c) => c.method === 'sendAnimation' && String(c.body.chat_id) === '9920' && /Follow Gully Labs News/.test(c.body.caption ?? '')))
  await press(fa, 'jchk', { msgId: null })
  check('retry wording: tells them Telegram can take a few seconds', /few seconds/.test(lastAnswer().text ?? ''), lastAnswer().text)
  let fun = users.gateFunnel()
  check('funnel: the join screen view and the free action user are counted', fun.shown === funBefore.shown + 1 && fun.freeActionUsers === funBefore.freeActionUsers + 1 && fun.joined === funBefore.joined, JSON.stringify(fun))
  nonMembers.delete(9920)
  await press(fa, 'jchk', { msgId: null })
  await say(fa, '/gap NVDA')
  fun = users.gateFunnel()
  check('funnel: joined and first command after joining are counted', fun.joined === funBefore.joined + 1 && fun.used === funBefore.used + 1 && fun.joinRate > 0, JSON.stringify(fun))
  const fa2 = privateChat(9921, 'Yan')
  nonMembers.add(9921)
  await say(fa2, '/top')
  await say(fa2, '/movers')
  check('free action: it is once per person, not once per chat message', /Follow Gully Labs News/.test(shownText(9921)))
  const faGroup = { id: -100778, type: 'supergroup', title: 'Fresh traders' }
  nonMembers.add(9922)
  await say(faGroup, '/top', 9922)
  check('free action: groups still get the join screen at once (no free action in groups)', sent(-100778).some((c) => /Follow Gully Labs News/.test(c.body.text ?? '')))
  nonMembers.delete(9921)
  nonMembers.delete(9922)
  process.env.TELEGRAM_GATE_FREE_ACTIONS = '0'
  const hw = privateChat(9923, 'Hal')
  nonMembers.add(9923)
  await say(hw, '/start')
  check('free action off (0): the hard wall is back from the first tap', /Follow Gully Labs News/.test(shownText(9923)))
  nonMembers.delete(9923)

  // N-29: in groups the join screen goes to a non-member once per half hour; commands for other bots never meet it.
  const ngGroup = { id: -100777, type: 'supergroup', title: 'Traders' }
  nonMembers.add(9904)
  await say(ngGroup, '/top@OtherBot', 9904)
  check('group gate: a command for another bot is not answered with the join screen', sent(-100777).length === 0)
  await say(ngGroup, '/top', 9904)
  await say(ngGroup, '/movers', 9904)
  await say(ngGroup, '/gap NVDA', 9904)
  check('group gate: a non-member’s commands show the join screen once, not every time', sent(-100777).filter((c) => /Follow Gully Labs News/.test(c.body.text ?? '')).length === 1, String(sent(-100777).length))
  nonMembers.delete(9904)

  // Holder Map, Security, More and /score answer in plain words.
  await say(privateChat(9905), '/holders')
  check('/holders: what the Holder Map is, with connected cluster and deployer explained', /Holder Map/.test(lastText(9905)) && /connected cluster/.test(lastText(9905)) && /deployer/.test(lastText(9905)))
  await say(privateChat(9906), '/security')
  check('/security: scans, Gully Score and monitors', /Gully Security/.test(lastText(9906)) && /Gully Score/.test(lastText(9906)) && /Monitors/.test(lastText(9906)))
  await say(privateChat(9907), '/score 0x00000000000000000000000000000000000000aa base')
  check('/score 0x… base: a button to that contract’s score page', flat(view(9907).kb).some((b) => b.url === 'https://gullylabs.xyz/score/base/0x00000000000000000000000000000000000000aa'), JSON.stringify(view(9907).kb))
  await say(privateChat(9908), '/score nope')
  check('/score with no address says what an address looks like', /not a contract address/.test(lastText(9908)))
  await press(privateChat(9909), 'mmu:mon_abcdefghijkl', { msgId: null })
  check('monitor Mute on an unlinked chat is answered plainly (never gated)', /not linked/.test(lastAnswer().text ?? ''), lastAnswer().text)
  const hh = tg.botWebhookHealth()
  check('webhook health: updates are counted, no message content', hh.enabled === true && hh.updates > 100 && typeof hh.errors === 'number' && !JSON.stringify(hh).includes('/score'), JSON.stringify(hh))

  /* ---------------------------------------------------- bot users, /app, announcements --- */
  await postUpdate({ message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: privateChat(9920, 'Dora'), from: { id: 9920, is_bot: false, first_name: 'Dora', language_code: 'de' }, text: '/start' } })
  const u9920 = botUsers()['9920']
  check('bot users: a private /start is recorded with first/last seen and language, no name', !!u9920 && u9920.lang === 'de' && !!u9920.firstSeen && !!u9920.lastSeen && u9920.linked === false && u9920.optedOut === null && !JSON.stringify(u9920).includes('Dora'), JSON.stringify(u9920))
  check('bot users: a linked private chat is recorded as linked', botUsers()['111']?.linked === false || botUsers()['111']?.linked === true)
  check('bot users: groups are never recorded', !Object.keys(botUsers()).some((k) => k.startsWith('-')))
  check('bot users: chats that never sent /start are not recorded (except an explicit opt-out)', !botUsers()['9903'] && !botUsers()['850'])
  const filled = users.backfillFromLinks([{ chatType: 'private', chatId: '5555', linkedAt: '2026-10-01T00:00:00.000Z' }, { chatType: 'supergroup', chatId: '-1009', linkedAt: '2026-10-01T00:00:00.000Z' }])
  check('bot users: backfilled from existing private links (first seen = linked at), groups skipped', filled === 1 && botUsers()['5555']?.source === 'link' && botUsers()['5555'].firstSeen === '2026-10-01T00:00:00.000Z' && botUsers()['5555'].linked === true && !botUsers()['-1009'])
  check('bot users: backfill is idempotent', users.backfillFromLinks([{ chatType: 'private', chatId: '5555', linkedAt: '2026-10-01T00:00:00.000Z' }]) === 0)
  await say(privateChat(9930), '/app')
  const appKb = view(9930).kb
  check('/app in a private chat: an inline web_app button to the Mini App', /Gully app/.test(view(9930).text) && flat(appKb)[0]?.web_app?.url === 'https://gullylabs.xyz/tg')
  const grp2 = { id: -100555, type: 'group', title: 'Desk' }
  await say(grp2, '/app', 31)
  check('/app in a group: a link to a private chat with the bot (no web_app in groups)', flat(view(-100555).kb)[0]?.url === `https://t.me/${BOT}` && !flat(view(-100555).kb).some((b) => b.web_app))
  await say(grp2, '/stop', 31)
  check('/stop in an unlinked group answers plainly', /This group isn’t linked to an account, so there’s nothing to stop/.test(lastText(-100555)))
  await say(privateChat(9920), '/stop announcements')
  check('/stop announcements: announcements off, said plainly, with a way back', /Announcements off/.test(lastText(9920)) && /Alerts you set up still arrive/.test(lastText(9920)) && data(view(9920).kb).includes('bci') && !!botUsers()['9920'].optedOut)
  await press(privateChat(9920), 'bci', { msgId: null })
  check('📣 Announcements back on (bci)', !botUsers()['9920'].optedOut && /Announcements on/.test(lastAnswer().text ?? ''))
  const bcMsg = { message_id: 4321, chat: privateChat(9920), text: 'News', reply_markup: { inline_keyboard: [[{ text: 'Read', url: 'https://gullylabs.xyz/r/abcdef012345.0.0' }], [{ text: '🔕 Stop announcements', callback_data: 'bco' }]] } }
  await postUpdate({ callback_query: { id: 'cq-bco', from: { id: 9920, is_bot: false, first_name: 'D' }, message: bcMsg, data: 'bco' } })
  await new Promise((r) => setTimeout(r, 1_100))
  const swap = calls.filter((c) => c.method === 'editMessageReplyMarkup' && c.body.chat_id === '9920').at(-1)?.body
  check('🔕 Stop announcements on a broadcast: opted out, toast says alerts still arrive', !!botUsers()['9920'].optedOut && /Announcements off\. Alerts still arrive/.test(answers().find((a) => a.body.callback_query_id === 'cq-bco')?.body.text ?? ''))
  check('🔕 the button turns into "📣 Announcements back on", the URL button stays', swap?.message_id === 4321 && swap.reply_markup.inline_keyboard[0][0].url === 'https://gullylabs.xyz/r/abcdef012345.0.0' && swap.reply_markup.inline_keyboard[1][0].callback_data === 'bci', JSON.stringify(swap))

  /* ------------------------------------- the exits are never gated (P0: left the channel) --- */
  const ex = privateChat(9910, 'Ned')
  nonMembers.add(9910)
  await say(ex, `/start ${await linkCode(dev)}`)
  check('non-member: /start <code> links the account (account management is not gated)', /Linked to/.test(lastText(9910)) && (await dev.call('/api/developer/telegram')).data.linked?.chatType === 'private', lastText(9910))
  await say(ex, '/top')
  check('non-member: features stay gated (/top shows the join screen)', /Follow Gully Labs News/.test(shownText(9910)))
  await say(ex, '/alerts')
  check('non-member: /alerts lists their alerts', /My alerts/.test(lastText(9910)), lastText(9910))
  const exA = (await myAlerts())[0]
  await press(ex, `ac:${exA.id}`)
  check('non-member: an alert card opens', new RegExp(`ap:${exA.id}|ar:${exA.id}`).test(JSON.stringify(view(9910).kb)))
  await press(ex, `am:${exA.id}`)
  check('non-member: the alert card’s Mute 24h works', /Muted/.test(lastAnswer().text ?? '') && !!(await myAlerts()).find((a) => a.id === exA.id).mutedUntil, lastAnswer().text)
  if ((await myAlerts()).find((a) => a.id === exA.id).enabled) await press(ex, `ap:${exA.id}`)
  check('non-member: Pause works', (await myAlerts()).find((a) => a.id === exA.id).enabled === false, lastAnswer().text)
  await press(ex, `ar:${exA.id}`)
  check('non-member: Resume is feature use and stays gated', /Follow Gully Labs News/.test(lastAnswer().text ?? '') && (await myAlerts()).find((a) => a.id === exA.id).enabled === false)
  await press(ex, 'smu')
  check('non-member: Mute all works', /muted/.test(lastAnswer().text ?? ''), lastAnswer().text)
  await press(ex, 'set')
  check('non-member: Settings opens', /Settings/.test(view(9910).text))
  await press(ex, 'bco', { msgId: null })
  check('non-member: 🔕 Stop announcements works', !!botUsers()['9910']?.optedOut)
  await press(ex, 'san:1', { msgId: null })
  check('non-member: the announcements switch works', !botUsers()['9910']?.optedOut)
  await say(ex, '/stop announcements')
  check('non-member: /stop announcements works and keeps the link', /Announcements off/.test(lastText(9910)) && !!botUsers()['9910']?.optedOut && !!(await dev.call('/api/developer/telegram')).data.linked)
  await press(ex, `ad:${exA.id}`)
  await press(ex, `adx:${exA.id}`)
  check('non-member: Delete works', !(await myAlerts()).some((a) => a.id === exA.id), lastAnswer().text)
  await press(ex, 'sul')
  await press(ex, 'suly')
  check('non-member: Settings → Unlink works', /Unlinked/.test(view(9910).text) && (await dev.call('/api/developer/telegram')).data.linked === null)
  await say(ex, `/start ${await linkCode(dev)}`)
  await say(ex, '/stop')
  check('non-member: /stop unlinks', /Unlinked/.test(lastText(9910)) && (await dev.call('/api/developer/telegram')).data.linked === null)
  await say(ex, '/stop')
  check('non-member: /stop in the unlinked chat still answers', /nothing to stop/.test(lastText(9910)))
  nonMembers.delete(9910)

  /* ------------------------------------------------------- inline mode --- */
  {
    const inl = await import('../server/telegram-inline.mjs')
    const holders = await import('../server/holders.mjs')
    inl.resetInlineForTest()
    const counts = { resolve: 0, build: 0 }
    const builds = []
    let resolveMatches = []
    let buildBody = { state: 'busy' }
    inl.setInlineForTest({
      wait: 300,
      resolve: async () => (counts.resolve++, { matches: resolveMatches }),
      build: async (chain, token, o) => (counts.build++, builds.push({ chain, token, ...o }), buildBody),
    })
    const ADDR = '0x2222222222222222222222222222222222222222'
    const mapOf = (address, over = {}) => ({ state: 'ok', kind: 'deepcore-launch', chain: { key: 'base', id: 8453, name: 'Base' }, token: { address, symbol: 'ZED', name: 'Zed' }, asOf: new Date().toISOString(), holders: { count: 1204 }, nodes: [], clusters: [{ id: 1 }], summary: { top10Pct: 41.2, largestCluster: { pct: 28, wallets: 3 } }, health: { score: 72, level: 'mixed' }, ...over })
    holders.seedHolderMapForTest('base', ADDR, mapOf(ADDR))
    const askInline = (userId, query, extra = {}) => postUpdate({ inline_query: { id: `iq${updateId}`, from: { id: userId, is_bot: false, first_name: 'U' }, query, offset: '', ...extra } })
    const inlineAnswers = () => calls.filter((c) => c.method === 'answerInlineQuery')
    const lastInline = () => inlineAnswers().at(-1)?.body ?? {}
    const nonMember = 6001
    nonMembers.add(nonMember)

    const n0 = inlineAnswers().length
    check('inline: the webhook accepts an inline_query (200)', (await askInline(nonMember, ADDR)) === 200)
    const hit = lastInline()
    const photo = hit.results?.[0]
    check('inline: a cached address answers one photo result, even for a user outside the News channel (no gate)', inlineAnswers().length === n0 + 1 && hit.results?.length === 1 && photo?.type === 'photo' && counts.build === 0 && counts.resolve === 0, JSON.stringify(hit).slice(0, 200))
    check('inline: the photo is the Holder Map share card, cache-busted by build time', photo?.photo_url === `https://gullylabs.xyz/api/holders/base/${ADDR}/card.png?v=${inl.buildTime()}` && photo.thumbnail_url === photo.photo_url && photo.photo_width === 1200 && photo.photo_height === 630, photo?.photo_url)
    check('inline: the caption holds measured facts (top 10 share, linked group, health score) and the signals note', /Top 10 wallets hold 41\.2%/.test(photo?.caption) && /3 wallets hold 28%/.test(photo.caption) && /Health score 72\/100/.test(photo.caption) && /signals not verdicts/.test(photo.caption) && photo.parse_mode === 'HTML' && photo.caption.length <= 1024, photo?.caption)
    const kbi = flat(photo?.reply_markup?.inline_keyboard)
    check('inline: buttons are Open Holder Map (site), Open in Mini App (startapp h_<chain>_<token>) and Join @GullyLabsNews', kbi.find((b) => b.text === 'Open Holder Map')?.url === `https://gullylabs.xyz/holders/base/${ADDR}` && kbi.find((b) => b.text === 'Open in Mini App')?.url === `https://t.me/${BOT}?startapp=h_base_${ADDR}` && kbi.find((b) => b.text === 'Join @GullyLabsNews')?.url === 'https://t.me/GullyLabsNews' && kbi.every((b) => b.url && !b.web_app), JSON.stringify(kbi))
    check('inline: cache_time is set on a hit (300 s) and the answer is not personal', hit.cache_time === 300 && hit.is_personal === false)
    check('inline: a tracked ticker answers without any lookup', (await askInline(nonMember, '$nvda')) === 200 && counts.resolve === 0 && builds.length <= 1 && lastInline().cache_time > 0 && Array.isArray(lastInline().results))
    check('inline: the inline answer never touched the News gate (no join screen sent)', !calls.some((c) => (c.method === 'sendMessage' || c.method === 'sendAnimation') && String(c.body.chat_id) === String(nonMember)))

    // Junk: no resolve, no build, empty answer with a cache_time.
    const before = { ...counts }
    const nJunk = inlineAnswers().length
    const junk = ['', '   ', 'hello world', '0x123', 'a'.repeat(200), '<b>', 'zzzzzzzzzzzz', '0xZZ22222222222222222222222222222222222222', 'ZZZZ']
    for (const q of junk) await askInline(7001, q)
    check('inline: junk queries (empty, spaces, words, short or broken addresses, unknown tickers) do no work', counts.resolve === before.resolve && counts.build === before.build && inlineAnswers().length === nJunk + junk.length)
    check('inline: a junk answer has no results and a cache_time', inlineAnswers().slice(-junk.length).every((c) => c.body.results.length === 0 && c.body.cache_time === 60))

    // Miss: a valid address that resolves nowhere answers an "Open Holder Map" article built on the site.
    const MISS = '0x3333333333333333333333333333333333333333'
    resolveMatches = []
    await askInline(7002, MISS)
    const miss = lastInline().results?.[0]
    check('inline: a miss answers an Open Holder Map article that links to the site, with a short cache_time', miss?.type === 'article' && miss.title === 'Open Holder Map' && flat(miss.reply_markup.inline_keyboard).some((b) => b.text === 'Open Holder Map' && b.url.startsWith('https://gullylabs.xyz/holders')) && flat(miss.reply_markup.inline_keyboard).some((b) => b.text === 'Join @GullyLabsNews') && lastInline().cache_time === 20 && counts.resolve === 1, JSON.stringify(lastInline()).slice(0, 300))
    // Uncached but resolvable: a fast-path build under the user's own budget key; a busy build falls back to the article.
    const LAUNCH = '0x4444444444444444444444444444444444444444'
    resolveMatches = [{ chain: 'base', token: LAUNCH, symbol: 'QQQ', kind: 'deepcore-launch' }]
    buildBody = { state: 'busy' }
    await askInline(7003, LAUNCH)
    check('inline: an uncached map starts one build keyed on the Telegram user (tg:<id>, free tier) and falls back to the article when it is not ready', builds.filter((b) => b.ip === 'tg:7003').length === 1 && builds.at(-1).ip === 'tg:7003' && builds.at(-1).tier === 'free' && lastInline().results[0].type === 'article' && lastInline().cache_time === 20, JSON.stringify(builds))
    buildBody = mapOf(LAUNCH)
    await askInline(7003, LAUNCH)
    check('inline: a build that finishes within the wait answers the card', lastInline().results[0].type === 'photo' && lastInline().results[0].photo_url.includes(`/base/${LAUNCH}/card.png?v=`) && lastInline().cache_time === 300)

    // Per-user budget: at most INLINE_WORK_PER_MIN lookups that do work a minute, per Telegram user.
    inl.resetInlineForTest()
    const w0 = counts.resolve
    resolveMatches = []
    for (let i = 0; i < 20; i++) await askInline(7100, '0x' + i.toString(16).padStart(2, '0') + 'dd'.repeat(19))
    check(`inline: one user is held to ${inl.INLINE_WORK_PER_MIN} lookups that do work a minute (the Holder Map's per-IP budget)`, counts.resolve - w0 === inl.INLINE_WORK_PER_MIN && inlineAnswers().slice(-20).every((c) => c.body.results[0]?.type === 'article'), `${counts.resolve - w0} ${inlineAnswers().slice(-20).map((c) => c.body.results[0]?.type).join()}`)
    const w1 = counts.resolve
    await askInline(7101, '0x' + 'ab'.repeat(20))
    check('inline: the budget is per user (another user still gets a lookup)', counts.resolve === w1 + 1)
    const builtBefore = counts.build
    await askInline(7100, ADDR)
    check('inline: a user over budget still gets cached answers', lastInline().results[0].type === 'photo' && counts.build === builtBefore)
    check('inline: every inline answer carries a cache_time', inlineAnswers().every((c) => Number.isInteger(c.body.cache_time) && c.body.cache_time > 0))
    const nBots = inlineAnswers().length
    await askInline(7300, ADDR, { from: { id: 7300, is_bot: true } })
    check('inline: a query from a bot sends no answer', inlineAnswers().length === nBots)
    inl.setInlineForTest()
    nonMembers.delete(nonMember)
  }

  /* ------------------------------------------------------------ token off --- */
  delete process.env.TELEGRAM_BOT_TOKEN
  check('token removed: the webhook is 404 again', (await postUpdate({ message: { chat: ada, text: '/help' } })) === 404)
  check('token removed: channels say off', (await dev.call('/api/alerts/channels')).data.telegram.enabled === false)
  check('the token never appears in any log line', !logged.some((l) => l.includes(TOKEN) || l.includes(TOKEN.split(':')[1])))
  check('the token is not in the stored data', !fs.readdirSync(tmp).filter((f) => f.endsWith('.json')).some((f) => fs.readFileSync(path.join(tmp, f), 'utf8').includes(TOKEN.split(':')[1])))
  check('link codes are stored as hashes only', !fs.readFileSync(path.join(tmp, 'telegram.json'), 'utf8').includes(code))
} catch (e) {
  check(`no exception (${e?.stack ?? e})`, false)
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(t.failed ? 1 : 0)
