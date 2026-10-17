// End-to-end test of the Telegram bot (server/telegram.mjs) against a local stub of the Bot API.
//
//   node scripts/test-telegram.mjs        (no build needed)
//
// The real server runs IN THIS PROCESS on port 8795 (TEST_PORT overrides) with a fresh temporary
// DATA_DIR and the tracker loop off. TELEGRAM_API points at a local stub that records every call
// (getMe, setWebhook, setMyCommands, sendMessage, answerCallbackQuery) and can answer 429. Tracker rows
// are synthetic, through the bot's test hook; nothing upstream is read. The token is a made-up one.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { makeChecker, makeClient } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8795
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-telegram-'))
const TOKEN = `7000000001:${crypto.randomBytes(24).toString('base64url')}`
const BOT = 'GullyTestBot'

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

const calls = [] // { method, body, at, token }
let fail429 = 0
const stub = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    const m = req.url.match(/^\/bot([^/]+)\/(\w+)$/)
    const body = raw ? JSON.parse(raw) : {}
    const send = (status, j) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(j))
    }
    if (!m || m[1] !== TOKEN) return send(401, { ok: false, error_code: 401, description: 'Unauthorized' })
    const method = m[2]
    calls.push({ method, body, at: Date.now() })
    if (method === 'getMe') return send(200, { ok: true, result: { id: 7000000001, is_bot: true, username: BOT } })
    if (method === 'sendMessage' && fail429 > 0) {
      fail429--
      return send(429, { ok: false, error_code: 429, description: 'Too Many Requests: retry after 1', parameters: { retry_after: 1 } })
    }
    if (method === 'sendMessage') return send(200, { ok: true, result: { message_id: calls.length, chat: { id: Number(body.chat_id) }, text: body.text } })
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
  TELEGRAM_API: `http://127.0.0.1:${stub.address().port}`,
  ANTHROPIC_API_URL: `http://127.0.0.1:${claude.address().port}`,
  ASK_REMOTE: 'off',
})
delete process.env.ANTHROPIC_API_KEY
delete process.env.ASK_DAILY_LIMIT
delete process.env.TELEGRAM_BOT_TOKEN
delete process.env.TELEGRAM_WEBHOOK_SECRET
delete process.env.GULLY_TREASURY_ADDRESS
await import('../server/server.mjs')
const tg = await import('../server/telegram.mjs')
const { evaluateAlerts } = await import('../server/alerts.mjs')
await new Promise((r) => setTimeout(r, 300))

const HOOK_PATH = tg.webhookPathFor(TOKEN)
const SECRET = tg.webhookSecretFor(TOKEN)
let updateId = 1
const postUpdate = (update, { secret = SECRET, hookPath = HOOK_PATH } = {}) =>
  fetch(`${BASE}/api/telegram/${hookPath}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret }) }, body: JSON.stringify({ update_id: updateId++, ...update }) }).then((r) => r.status)
const privateChat = (id, name = 'Ada') => ({ id, type: 'private', first_name: name })
const say = (chat, text, fromId = chat.id) => postUpdate({ message: { message_id: updateId, date: Math.floor(Date.now() / 1000), chat, from: { id: fromId, is_bot: false, first_name: 'U' }, text } })
const press = (chat, data, fromId = chat.id) => postUpdate({ callback_query: { id: String(updateId), from: { id: fromId, is_bot: false, first_name: 'U' }, message: { message_id: 1, chat }, data } })
const sent = (chatId) => calls.filter((c) => c.method === 'sendMessage' && String(c.body.chat_id) === String(chatId))
const lastText = (chatId) => sent(chatId).at(-1)?.text ?? sent(chatId).at(-1)?.body.text ?? ''
const answers = () => calls.filter((c) => c.method === 'answerCallbackQuery')

const row = (o) => ({ chain: 'robinhood', ticker: 'NVDA', name: 'NVIDIA', status: 'premium', gapPct: 3.1, fair: 180, onchain: 185.58, poolStale: false, sessionOpen: true, feedUpdatedAt: new Date().toISOString(), pool: { liquidityUsd: 50_000 }, ...o })
const ROWS = [
  row({}),
  row({ chain: 'bsc', status: 'thin', gapPct: 9.5, fair: 181, onchain: 198.2, pool: { liquidityUsd: 2_000 } }),
  row({ ticker: 'TSLA', name: 'Tesla', status: 'discount', gapPct: -2.5, fair: 400, onchain: 390 }),
  row({ ticker: 'AAPL', name: 'Apple', status: 'feed-unreadable', gapPct: null, fair: null, onchain: 230, pool: { liquidityUsd: 80_000 } }),
  row({ ticker: 'META', name: 'Meta', status: 'in-line', gapPct: 0.4, fair: 700, onchain: 702.8 }),
  row({ ticker: 'MSFT', name: 'Microsoft', chain: 'bsc', status: 'premium', gapPct: 12, sessionOpen: false }),
  row({ ticker: 'AMZN', name: 'Amazon', status: 'premium', gapPct: 7, poolStale: true }),
]

const wallet = privateKeyToAccount(generatePrivateKey())
const me = wallet.address.toLowerCase()
const other = privateKeyToAccount(generatePrivateKey())
const dev = makeClient(BASE)
const dev2 = makeClient(BASE)

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
  const started = await tg.startTelegram()
  const hook = calls.find((c) => c.method === 'setWebhook')
  check('startup: setWebhook to the secret path on gullylabs.xyz', started.ok && hook?.body.url === `https://gullylabs.xyz/api/telegram/${HOOK_PATH}`, hook?.body.url)
  check('startup: the secret token and allowed updates are sent', hook?.body.secret_token === SECRET && JSON.stringify(hook?.body.allowed_updates) === '["message","callback_query"]')
  const cmds = calls.find((c) => c.method === 'setMyCommands')?.body.commands.map((c) => c.command) ?? []
  check('startup: setMyCommands lists gap, top, alerts, stop, help', ['gap', 'top', 'alerts', 'stop', 'help'].every((c) => cmds.includes(c)), cmds.join())
  check('startup: /movers is offered (the tracker has movers)', cmds.includes('movers'))
  check('startup: /ask is in the command list', cmds.includes('ask'))
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
  const ada = privateChat(111, 'Ada <b>&')
  const conn = await dev.post('/api/developer/telegram/connect')
  const code = conn.data?.link?.match(/\?start=([\w-]+)$/)?.[1]
  check('connect gives a t.me deep link with a one-time code', conn.status === 200 && conn.data.link.startsWith(`https://t.me/${BOT}?start=`) && !!code && conn.data.groupLink.includes('startgroup='))
  check('connect: the code expires in 10 minutes', Math.abs(Date.parse(conn.data.expiresAt) - Date.now() - 600_000) < 5_000)
  check('webhook: a good update is accepted (200)', (await say(ada, `/start ${code}`)) === 200)
  check('/start with a valid code links the chat', /Linked to/.test(lastText(111)), lastText(111))
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
  await say(privateChat(222), '/start')
  check('/start without a code answers with help', /\/gap NVDA/.test(lastText(222)))

  /* ------------------------------------------------- read-only commands --- */
  tg.setTrackerReaderForTest(async () => ROWS)
  await say(privateChat(333), '/gap NVDA')
  const gap = lastText(333)
  check('/gap NVDA answers both chains', /NVDA<\/b> · Robinhood Chain/.test(gap) && /NVDA<\/b> · BNB Chain/.test(gap), gap)
  check('/gap shows gap, on chain vs fair, liquidity and a stock link', gap.includes('+3.10%') && gap.includes('On chain $185.58 · fair $180.00') && gap.includes('$50,000') && gap.includes('https://gullylabs.xyz/tracker/robinhood/NVDA'))
  check('/gap says a thin pool is not flagged', /too thin/.test(gap))
  check('/gap is sent as HTML with link previews off', sent(333).at(-1).body.parse_mode === 'HTML' && sent(333).at(-1).body.disable_web_page_preview === true)
  await say(privateChat(334), '/gap nvda bsc')
  check('/gap NVDA bsc answers one chain', /BNB Chain/.test(lastText(334)) && !/Robinhood Chain/.test(lastText(334)))
  await say(privateChat(335), '/gap AAPL robinhood')
  check('/gap: an unreadable feed is said to be unreadable, not zero', /could not be read/.test(lastText(335)) && !/\$0/.test(lastText(335)), lastText(335))
  await say(privateChat(336), '/gap ZZZZ')
  check('/gap: an unknown ticker is named as not followed', /not a stock the tracker follows/.test(lastText(336)))
  await say(privateChat(337), '/top')
  const top = lastText(337)
  const order = ['NVDA', 'TSLA', 'META'].map((x) => top.indexOf(`>${x}</a>`))
  check('/top ranks trusted gaps widest first', order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], top)
  check('/top leaves out thin, unreadable, stale and closed-session rows', !/MSFT|AMZN|AAPL/.test(top) && !/BNB Chain: <b>\+9/.test(top))
  check('/top says how many stocks are outside their session', /1 stock is outside its feed session and not ranked/.test(top))
  tg.setTrackerReaderForTest(async () => {
    throw new Error('upstream down')
  })
  await say(privateChat(338), '/top')
  check('/top: a failed tracker read is said honestly', /could not be read just now/.test(lastText(338)))
  tg.setTrackerReaderForTest(async () => ROWS)
  check('HTML escaping: < > & " are escaped', tg.esc('<b>"x" & y</b>') === '&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;')

  /* ---------------------------------------------------------------- /ask --- */
  await say(privateChat(600), '/ask how do alerts work?')
  check('/ask without ANTHROPIC_API_KEY says Ask is not available yet', /Ask is not available yet/.test(lastText(600)) && claudeCalls.length === 0)
  process.env.ANTHROPIC_API_KEY = `sk-ant-test-${crypto.randomBytes(12).toString('hex')}`
  await say(privateChat(601), '/ask how do Telegram alerts work?')
  const askText = lastText(601)
  check('/ask in an unlinked chat answers through Gully Ask', claudeCalls.length === 1 && /Alerts can go to Telegram/.test(askText), askText)
  check('/ask escapes the answer’s HTML and keeps the citation', askText.includes('&lt;b&gt;now&lt;/b&gt; [1]') && !askText.includes('<b>now</b>'))
  check('/ask lists its sources as links and says it is not advice', /<b>Sources<\/b>\n\[1\] <a href="https:\/\/docs\.gullylabs\.xyz\/plans-alerts/.test(askText) && /not investment advice/.test(askText))
  check('/ask is sent as HTML with link previews off', sent(601).at(-1).body.parse_mode === 'HTML' && sent(601).at(-1).body.disable_web_page_preview === true)
  await say(ada, '/ask what are the plans?')
  check('/ask works in a linked chat too', /Alerts can go to Telegram/.test(lastText(111)))
  await say(privateChat(602), '/ask')
  check('/ask with no question says how to ask', /Ask a question after the command/.test(lastText(602)))
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
  const before = calls.length
  await say(privateChat(444), '/alerts')
  await say(privateChat(444), '/stop')
  await say(privateChat(444), '/movers')
  await say(privateChat(444), 'hello')
  await press(privateChat(444), 'mute:abc')
  check('unknown chats: /alerts, /stop, /movers and plain text are ignored', sent(444).length === 0)
  check('unknown chats: a button press is answered without acting', answers().length === 1 && /not linked/.test(answers()[0].body.text) && calls.length === before + 1)
  await say(privateChat(444), '/help')
  check('unknown chats: /help is answered', sent(444).length === 1)
  await say({ id: -100200, type: 'supergroup', title: 'Desk' }, '/gap@OtherBot NVDA', 9)
  check('a command addressed to another bot is ignored', sent(-100200).length === 0)
  await say({ id: -100200, type: 'supergroup', title: 'Desk' }, `/gap@${BOT} TSLA`, 9)
  check('a command addressed to this bot in a group is answered', /TSLA/.test(lastText(-100200)))

  /* ---------------------------------------------------- alerts → Telegram --- */
  const created = await dev.post('/api/developer/alerts', { name: 'NVDA wide', chain: 'robinhood', ticker: 'NVDA', condition: { type: 'gap', pct: 2 }, telegram: true })
  const alertId = created.data?.alert?.id
  check('an alert can deliver to the linked Telegram chat', created.status === 201 && created.data.alert.telegram?.linked === true && created.data.secret === null, created.data?.error)
  const noLink = await dev2.post('/api/developer/alerts', { condition: { type: 'gap', pct: 2 }, telegram: true })
  check('Telegram delivery needs a linked chat', noLink.status === 400 && /Connect Telegram/.test(noLink.data?.error))
  const pasted = await dev2.post('/api/developer/alerts', { condition: { type: 'gap', pct: 2 }, telegramChatId: '12345' })
  check('pasted chat ids are refused', pasted.status === 400)
  await say(ada, '/alerts')
  check('/alerts lists the linked account’s alerts with status', /NVDA wide/.test(lastText(111)) && /watching/.test(lastText(111)), lastText(111))

  tg.setMoversReaderForTest(async () => ({ byGap: [{ chain: 'bsc', ticker: 'TSLA', gapChangePp: -1.5, gapNow: -2.25 }], note: null }))
  await say(ada, '/movers')
  check('/movers, when the tracker has movers, lists them with links', /Biggest gap moves, 24 hours/.test(lastText(111)) && lastText(111).includes('gap -1.50 pp in 24h, now -2.25%') && lastText(111).includes('/tracker/bsc/TSLA'))
  tg.setMoversReaderForTest(async () => ({ byGap: [], note: 'Needs 24h of snapshots: the longest series so far covers 3 h.' }))
  await say(ada, '/movers')
  check('/movers with too little history says so', /Needs 24h of snapshots/.test(lastText(111)))

  const n0 = sent(111).length
  const now = Date.now()
  await evaluateAlerts([row({})], now)
  const msg = sent(111).at(-1)
  check('a firing alert sends one Telegram message', sent(111).length === n0 + 1)
  check('the message has ticker, chain, gap, on chain vs fair, status, liquidity and the stock link', /NVDA<\/b> · Robinhood Chain/.test(msg.body.text) && msg.body.text.includes('+3.10%') && msg.body.text.includes('(premium)') && msg.body.text.includes('On chain $185.58 · fair $180.00') && msg.body.text.includes('$50,000') && msg.body.text.includes('href="https://gullylabs.xyz/tracker/robinhood/NVDA"'), msg.body.text)
  const kb = msg.body.reply_markup?.inline_keyboard?.flat() ?? []
  check('buttons: "Open NVDA" to the stock page and "Mute 24h"', kb.some((b) => b.text === 'Open NVDA' && b.url === 'https://gullylabs.xyz/tracker/robinhood/NVDA') && kb.some((b) => b.text === 'Mute 24h' && b.callback_data === `mute:${alertId}`))
  const log1 = (await dev.call('/api/developer/alerts')).data.alerts.find((a) => a.id === alertId).deliveries
  check('the delivery log records the Telegram send', log1.length === 1 && log1[0].channel === 'telegram' && log1[0].ok && log1[0].status === 200)

  /* -------------------------------------------------------------- Mute --- */
  await press(privateChat(444), `mute:${alertId}`)
  check('Mute from an unlinked chat does nothing', /not linked/.test(answers().at(-1).body.text) && !(await dev.call('/api/developer/alerts')).data.alerts[0].mutedUntil)
  const conn3 = await dev2.post('/api/developer/telegram/connect')
  await say(privateChat(555, 'Bob'), `/start ${conn3.data.link.split('start=')[1]}`)
  await press(privateChat(555, 'Bob'), `mute:${alertId}`)
  check('Mute from another account’s chat is refused', /does not belong/.test(answers().at(-1).body.text) && answers().at(-1).body.show_alert === true)
  await press(ada, `mute:${alertId}`)
  const muted = (await dev.call('/api/developer/alerts')).data.alerts.find((a) => a.id === alertId)
  check('Mute 24h from the linked chat pauses the alert for 24 hours', /Muted until/.test(answers().at(-1).body.text) && Math.abs(Date.parse(muted.mutedUntil) - Date.now() - 86_400_000) < 10_000)
  const n1 = sent(111).length
  await evaluateAlerts([row({ gapPct: 0.2, status: 'in-line' })], now + 40 * 60_000)
  await evaluateAlerts([row({ gapPct: 4 })], now + 80 * 60_000)
  check('a muted alert does not fire', sent(111).length === n1)
  await dev.post(`/api/developer/alerts/${alertId}/resume`)
  check('resume ends the mute', (await dev.call('/api/developer/alerts')).data.alerts.find((a) => a.id === alertId).mutedUntil === null)

  /* --------------------------------------------------------- rate limits --- */
  fail429 = 1
  const t0 = Date.now()
  const test = await dev.post(`/api/developer/alerts/${alertId}/test`)
  const tries = sent(111).filter((c) => c.at >= t0)
  check('a 429 is retried after retry_after', test.data?.results?.[0]?.ok === true && tries.length === 2 && tries[1].at - tries[0].at >= 990, `${tries.length} tries, ${tries[1] ? tries[1].at - tries[0].at : '-'} ms`)
  const spaced = sent(111).map((c) => c.at)
  check('at most one message a second per chat', spaced.slice(1).every((x, i) => x - spaced[i] >= 990), spaced.map((x, i) => (i ? x - spaced[i - 1] : 0)).join())

  /* -------------------------------------------------------------- groups --- */
  const group = { id: -100300, type: 'supergroup', title: 'Trading <desk>' }
  const conn4 = await dev2.post('/api/developer/telegram/connect')
  await say(group, `/start@${BOT} ${conn4.data.link.split('start=')[1]}`, 777)
  check('a group links with the code', /Linked to/.test(lastText(-100300)) && (await dev2.call('/api/developer/telegram')).data.linked?.chatTitle === 'Trading <desk>')
  check('linking the group replaced the account’s private chat', !/Linked/.test(lastText(555)) || (await dev2.call('/api/developer/telegram')).data.linked.chatType === 'supergroup')
  const conn5 = await dev.post('/api/developer/telegram/connect')
  await say(group, `/start ${conn5.data.link.split('start=')[1]}`, 778)
  check('a group linked to one account cannot be taken by another', /already linked to another account/.test(lastText(-100300)))
  await say(group, '/stop', 778)
  check('only the user who linked a group can unlink it', /Only the person who linked/.test(lastText(-100300)) && !!(await dev2.call('/api/developer/telegram')).data.linked)
  await say(group, '/stop', 777)
  check('the user who linked the group unlinks it', /Unlinked/.test(lastText(-100300)) && (await dev2.call('/api/developer/telegram')).data.linked === null)

  /* ---------------------------------------------------------------- /stop --- */
  await say(ada, '/stop')
  check('/stop unlinks a private chat', /Unlinked/.test(lastText(111)) && (await dev.call('/api/developer/telegram')).data.linked === null)
  const n2 = sent(111).length
  await say(ada, '/alerts')
  check('after /stop the chat is unknown again (/alerts ignored)', sent(111).length === n2)
  await evaluateAlerts([row({ gapPct: 0.1, status: 'in-line' })], now + 200 * 60_000)
  await evaluateAlerts([row({ gapPct: 5 })], now + 300 * 60_000)
  const log2 = (await dev.call('/api/developer/alerts')).data.alerts.find((a) => a.id === alertId).deliveries
  check('an alert whose chat was unlinked logs the failure honestly', sent(111).length === n2 && log2[0].ok === false && /No Telegram chat is linked/.test(log2[0].error))
  const conn6 = await dev.post('/api/developer/telegram/connect')
  await say(ada, `/start ${conn6.data.link.split('start=')[1]}`)
  const unl = await dev.post('/api/developer/telegram/unlink')
  check('the dashboard can unlink, and the chat is told', unl.status === 200 && (await dev.call('/api/developer/telegram')).data.linked === null)
  await new Promise((r) => setTimeout(r, 1_300))
  check('the unlinked chat got a notice', /unlinked from the developer dashboard/.test(lastText(111)))

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
