// End-to-end test of the bot's admin broadcasts (server/telegram-broadcast.mjs), the bot-user store
// (server/telegram-users.mjs), the command menu set at startup, and the channel's "post and DM users".
//
//   node scripts/test-tg-broadcast.mjs        (no build needed)
//
// The real server runs IN THIS PROCESS on port 8803 (TEST_PORT overrides) with a fresh temporary DATA_DIR and
// the tracker loop off. Nothing real is ever called: TELEGRAM_API points at a local Bot API stub that records
// every call and can answer 403 "bot was blocked", 400 "chat not found" or a temporary failure for chosen chats.
// The token, the channel and every chat id are made up.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { guardTestRun, makeChecker, makeClient } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8803
await guardTestRun(PORT, { watchdogMs: 6 * 60_000 })
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-tg-broadcast-'))
const BOT_ID = 7000000003
const TOKEN = `${BOT_ID}:${crypto.randomBytes(24).toString('base64url')}`
const CHANNEL = '@GullyTestNews'
const ADMIN_CHAT = '-100999'
const ADMIN = crypto.randomBytes(24).toString('hex')
const t = makeChecker()
const { check } = t

/* -------------------------------------------------------------- Bot API stub --- */

const calls = [] // { method, body, at }
let nextMsgId = 10_000
const blocked403 = new Set()
const notFound400 = new Set()
const flaky = new Set() // a temporary failure (500) while in the set
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
    calls.push({ method, body, at: Date.now() })
    const chat = String(body.chat_id ?? '')
    if (method === 'getMe') return send(200, { ok: true, result: { id: BOT_ID, is_bot: true, username: 'GullyTestBot' } })
    if (['sendMessage', 'sendPhoto', 'sendAnimation'].includes(method)) {
      if (blocked403.has(chat)) return send(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' })
      if (notFound400.has(chat)) return send(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' })
      if (flaky.has(chat)) return send(500, { ok: false, error_code: 500, description: 'Internal Server Error' })
      const id = nextMsgId++
      const result = { message_id: id, chat: { id: Number(chat) || chat } }
      if (method === 'sendAnimation') result.animation = { file_id: typeof body.animation === 'string' && !body.animation.startsWith('http') ? body.animation : 'BANNER_FILE_B' }
      return send(200, { ok: true, result })
    }
    return send(200, { ok: true, result: true })
  })
})
await new Promise((r) => stub.listen(0, '127.0.0.1', r))
const SENDS = new Set(['sendMessage', 'sendPhoto', 'sendAnimation'])
const sendsTo = (chat) => calls.filter((c) => SENDS.has(c.method) && String(c.body.chat_id) === String(chat))
const textOf = (c) => c.body.text ?? c.body.caption ?? ''
const withMarker = (marker) => calls.filter((c) => SENDS.has(c.method) && textOf(c).includes(marker))

/* ------------------------------------------------------------ start server --- */

Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: path.join(tmp, 'no-dist'),
  ADMIN_TOKEN: ADMIN,
  TRACKER_LOOP: 'off',
  TRACKER_SKIP_APIS: '1',
  GULLY_RPC_1: 'http://127.0.0.1:9',
  GULLY_RPC_56: 'http://127.0.0.1:9',
  GULLY_RPC_8453: 'http://127.0.0.1:9',
  GULLY_RPC_42161: 'http://127.0.0.1:9',
  TELEGRAM_API: `http://127.0.0.1:${stub.address().port}`,
  TELEGRAM_BOT_TOKEN: TOKEN,
  TELEGRAM_NEWS_CHANNEL: CHANNEL,
  TELEGRAM_REQUIRED_CHANNEL: 'off',
  TELEGRAM_ADMIN_CHAT_ID: ADMIN_CHAT,
  ASK_REMOTE: 'off',
})
for (const k of ['ANTHROPIC_API_KEY', 'GHOST_CONTENT_KEY', 'TELEGRAM_WEBHOOK_SECRET', 'GULLY_TREASURY_ADDRESS']) delete process.env[k]
await import('../server/server.mjs')
const tg = await import('../server/telegram.mjs')
const ch = await import('../server/telegram-channel.mjs')
const bc = await import('../server/telegram-broadcast.mjs')
const users = await import('../server/telegram-users.mjs')
ch.stopChannel()
bc.stopBroadcasts() // the test drives the sender by hand
// Startup (setWebhook, setMyCommands x3, setChatMenuButton) runs in the background: wait for its last call, with a
// deadline, instead of guessing how long it takes on a busy machine.
for (const deadline = Date.now() + 30_000; Date.now() < deadline && !calls.some((c) => c.method === 'setChatMenuButton'); ) await new Promise((r) => setTimeout(r, 25))

const admin = makeClient(BASE)
const A = (p, body) => (body === undefined ? admin.call(p, { auth: ADMIN }) : admin.call(p, { method: 'POST', body, auth: ADMIN }))
const HOOK = tg.webhookPathFor(TOKEN)
const SECRET = tg.webhookSecretFor(TOKEN)
let uid = 1
const update = (u) => fetch(`${BASE}/api/telegram/${HOOK}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET }, body: JSON.stringify({ update_id: uid++, ...u }) })
const say = (chatId, text, lang = 'en') => update({ message: { message_id: uid, date: Math.floor(Date.now() / 1000), chat: { id: chatId, type: 'private', first_name: 'P' }, from: { id: chatId, is_bot: false, first_name: 'P', language_code: lang }, text } })
const botUsers = () => {
  users.flushBotUsers()
  return JSON.parse(fs.readFileSync(path.join(tmp, 'bot-users.json'), 'utf8')).users
}
const SEG = (kind, extra = {}) => ({ kind, ...extra })
const aud = async (segment) => (await A('/api/admin/broadcasts/audience', { segment })).data
const sendNow = async (body) => {
  const a = await aud(body.segment)
  return A('/api/admin/broadcasts', { action: 'send', confirm: a.count, ...body })
}
const getB = async (id) => (await A(`/api/admin/broadcasts/${id}`)).data
const windowMax = (times) => {
  let best = 0
  for (let i = 0; i < times.length; i++) {
    let n = 0
    for (let j = i; j < times.length && times[j] - times[i] < 1_000; j++) n++
    best = Math.max(best, n)
  }
  return best
}
const JARGON = /api\.|\bAPI\b|\bRPC\b|\bfeeds?\b|\bUTC\b|endpoint|indexer|\bpool\b|not reported|unreadable|on[- ]chain|fair price|\d{4}-\d{2}-\d{2} \d{2}:\d{2}/i

try {
  /* ------------------------------------------------------- startup: menu --- */
  const cmdCalls = calls.filter((c) => c.method === 'setMyCommands')
  const scoped = (type) => cmdCalls.find((c) => (c.body.scope?.type ?? 'default') === type)?.body.commands?.map((x) => x.command) ?? null
  check('startup: setMyCommands for the default scope, private chats and groups', cmdCalls.length >= 3 && !!scoped('default') && !!scoped('all_private_chats') && !!scoped('all_group_chats'))
  check('startup: private chats get start, app, gap, top, movers, holders, alerts, security, score, ask, contact, help, stop', JSON.stringify(scoped('all_private_chats')) === JSON.stringify(['start', 'app', 'gap', 'top', 'movers', 'holders', 'alerts', 'security', 'score', 'ask', 'contact', 'help', 'stop']))
  check('startup: groups get gap, top, help only (/launches was retired on 2026-10-29)', JSON.stringify(scoped('all_group_chats')) === JSON.stringify(['gap', 'top', 'help']))
  check('startup: no scan command anywhere', !cmdCalls.some((c) => c.body.commands.some((x) => x.command === 'scan')))
  const menuAt = calls.findIndex((c) => c.method === 'setChatMenuButton')
  const lastCmdAt = calls.findLastIndex((c) => c.method === 'setMyCommands')
  check('startup: the Menu button lists the commands (setChatMenuButton type commands), set after every setMyCommands', calls[menuAt]?.body.menu_button?.type === 'commands' && lastCmdAt >= 0 && lastCmdAt < menuAt)
  check('startup: command descriptions are plain words led by an emoji', cmdCalls.flatMap((c) => c.body.commands).every((x) => /^\p{Extended_Pictographic}/u.test(x.description) && !JARGON.test(x.description) && x.description.length <= 60))

  /* ------------------------------------------------------- bot users --- */
  await say(2001, '/start', 'en')
  await say(2002, '/start', 'de')
  await say(2003, '/help', 'en') // never started: not a bot user
  const bu = botUsers()
  check('bot users: /start records the private chat with language', bu['2001']?.lang === 'en' && bu['2002']?.lang === 'de' && !bu['2003'])
  const dayAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString()
  const seed = {}
  for (let i = 1; i <= 60; i++) {
    const id = String(3000 + i)
    seed[id] = { firstSeen: dayAgo(60 - i), lastSeen: i >= 50 ? dayAgo(40) : dayAgo(1), lang: i > 40 ? 'de' : 'en', follows: i <= 10 ? true : null, optedOut: i === 11 ? dayAgo(2) : null, blocked: i === 12 ? { at: dayAgo(3), reason: 'Forbidden: bot was blocked by the user' } : null }
  }
  users.seedBotUsersForTest(seed)
  // Two linked accounts: 3001 with an alert, 3002 without.
  const w1 = privateKeyToAccount(generatePrivateKey())
  const w2 = privateKeyToAccount(generatePrivateKey())
  const d1 = makeClient(BASE)
  const d2 = makeClient(BASE)
  await d1.signIn(w1)
  await d2.signIn(w2)
  await say(3001, `/start ${(await d1.post('/api/developer/telegram/connect')).data.link.split('start=')[1]}`)
  await say(3002, `/start ${(await d2.post('/api/developer/telegram/connect')).data.link.split('start=')[1]}`)
  const al = await d1.post('/api/developer/alerts', { chain: 'robinhood', ticker: 'NVDA', condition: { type: 'gap', pct: 2 }, telegram: true })
  check('setup: two linked chats, one alert', (await d1.call('/api/developer/telegram')).data.linked?.chatType === 'private' && al.status === 201, JSON.stringify(al.data).slice(0, 160))
  check('bot users: linking marks the user linked', botUsers()['3001'].linked === true && botUsers()['3002'].linked === true)

  /* -------------------------------------------------------- admin auth --- */
  check('no token: 401', (await admin.call('/api/admin/broadcasts')).status === 401)
  check('wrong token: 401, nothing sent', (await admin.call('/api/admin/broadcasts', { method: 'POST', body: { text: 'x', segment: SEG('all'), action: 'send', confirm: 1 }, auth: 'z'.repeat(48) })).status === 401)

  /* -------------------------------------------------------- segments --- */
  // 62 users: 2001, 2002 and 3001..3060. 3011 opted out, 3012 blocked.
  const all = await aud(SEG('all'))
  check('segment all: everyone minus opted out and blocked', all.count === 60 && all.total === 62 && all.optedOut === 1 && all.blocked === 1, JSON.stringify(all))
  check('segment linked accounts', (await aud(SEG('linked'))).count === 2)
  check('segment unlinked', (await aud(SEG('unlinked'))).count === 58)
  check('segment has alerts', (await aud(SEG('alerts'))).count === 1)
  check('segment followed the News channel (3001..3010)', (await aud(SEG('follows'))).count === 10)
  check('segment language de (2002 and 3041..3060)', (await aud(SEG('language', { language: 'de' }))).count === 21)
  check('segment active in the last 30 days (3050..3060 were last seen 40 days ago)', (await aud(SEG('active', { days: 30 }))).count === 60 - 11)
  check('segment: unknown kinds and bad parameters are refused', (await A('/api/admin/broadcasts/audience', { segment: SEG('everyone') })).status === 400 && (await A('/api/admin/broadcasts/audience', { segment: SEG('active', { days: 0 }) })).status === 400 && (await A('/api/admin/broadcasts/audience', { segment: SEG('language', { language: 'xyz' }) })).status === 400)

  /* -------------------------------------------------------- validate, test --- */
  const v1 = await A('/api/admin/broadcasts/validate', { text: '<b>Hi</b><script>x</script>', buttons: [1, 2, 3, 4].map((n) => ({ text: `B${n}`, url: 'https://gullylabs.xyz' })) })
  check('validate: the channel sanitizer and the 3-button limit apply', v1.data.text === '<b>Hi</b>' && v1.data.errors.some((e) => /At most 3/.test(e)))
  const ts = await A('/api/admin/broadcasts/test', { text: '<b>Test</b> news', buttons: [{ text: 'Open', url: 'https://gullylabs.xyz/tracker' }] })
  const tsb = sendsTo(ADMIN_CHAT).at(-1)?.body
  check('send test to me: goes to TELEGRAM_ADMIN_CHAT_ID with the real link and 🔕 Stop announcements', ts.status === 200 && tsb?.text === '<b>Test</b> news' && tsb.reply_markup.inline_keyboard[0][0].url === 'https://gullylabs.xyz/tracker' && tsb.reply_markup.inline_keyboard.at(-1)[0].callback_data === 'bco', JSON.stringify(tsb))
  check('send test: a linked chat can be picked', (await A('/api/admin/broadcasts/test', { text: 'x', chatId: '3001' })).status === 200 && sendsTo(3001).length >= 1)
  check('send test: an unlinked chat is refused', (await A('/api/admin/broadcasts/test', { text: 'x', chatId: '3030' })).status === 400 && sendsTo(3030).length === 0)

  /* ------------------------------------------------------ confirm required --- */
  const before = calls.filter((c) => SENDS.has(c.method)).length
  const noConfirm = await A('/api/admin/broadcasts', { text: 'Hello', segment: SEG('all'), action: 'send' })
  check('confirm required: no confirm is 409 with the exact count, nothing sent', noConfirm.status === 409 && noConfirm.data.count === 60 && noConfirm.data.confirmRequired === true)
  check('confirm required: a wrong count is 409 too', (await A('/api/admin/broadcasts', { text: 'Hello', segment: SEG('all'), action: 'send', confirm: 59 })).status === 409)
  check('confirm required: nothing was sent', calls.filter((c) => SENDS.has(c.method)).length === before && (await A('/api/admin/broadcasts')).data.broadcasts.length === 0)

  /* ------------------------------------------- first broadcast: banner, blocked --- */
  blocked403.add('3005')
  notFound400.add('3006')
  flaky.add('3007')
  const M1 = 'MARK-ONE'
  const b1 = await sendNow({ text: `<b>${M1}</b> big news`, media: { kind: 'animation', banner: true }, buttons: [{ text: 'See it', url: 'https://gullylabs.xyz/tracker' }], segment: SEG('follows') })
  check('send now: 201, sending to the confirmed audience', b1.status === 201 && b1.data.broadcast.status === 'sending' && b1.data.broadcast.audience === 10, JSON.stringify(b1.data).slice(0, 200))
  const id1 = b1.data.broadcast.id
  await bc.tickBroadcasts()
  const g1 = await getB(id1)
  check('finished: 7 delivered, 2 blocked, 1 failed', g1.broadcast.status === 'sent' && g1.broadcast.counts.sent === 7 && g1.broadcast.counts.blocked === 2 && g1.broadcast.counts.failed === 1, JSON.stringify(g1.broadcast.counts))
  const m1 = withMarker(M1).filter((c) => !c.body.chat_id.startsWith('-'))
  check('banner: the file_id Telegram gave for the bot’s banner is reused, never one upload per recipient', calls.filter((c) => c.method === 'sendAnimation' && c.body.multipart).length === 1 && m1.filter((c) => c.method === 'sendAnimation' && c.body.animation === 'BANNER_FILE_B').length === 10, m1.map((c) => (c.body.multipart ? 'upload' : c.body.animation)).join())
  const kb1 = m1.find((c) => c.body.chat_id === '3001')?.body.reply_markup?.inline_keyboard
  check('every broadcast ends with 🔕 Stop announcements, and its link is tracked through /r', kb1?.at(-1)?.[0]?.callback_data === 'bco' && /^https:\/\/gullylabs\.xyz\/r\/[0-9a-f]{12}\.0\.[0-9a-z]+$/.test(kb1[0][0].url), JSON.stringify(kb1))
  check('blocked: 403 and 400 "chat not found" mark the users blocked', !!botUsers()['3005'].blocked && !!botUsers()['3006'].blocked && !botUsers()['3007'].blocked)
  check('blocked: they leave the audience', (await aud(SEG('follows'))).count === 8)
  check('per-recipient status, chat ids masked', g1.recipients.length === 10 && g1.recipients.every((r) => /^••••\d{4}$/.test(r.chat)) && g1.recipients.some((r) => r.status === 'blocked') && !JSON.stringify(g1.recipients).includes('"3005"'))
  check('opt-out never sent: 3011 (opted out) got nothing', sendsTo(3011).length === 0)

  /* ------------------------------------------------------- re-send to failed --- */
  flaky.delete('3007')
  const rs = await A(`/api/admin/broadcasts/${id1}/resend`, {})
  await bc.tickBroadcasts()
  const g1b = await getB(id1)
  check('re-send to failed: only the failed one, now delivered; blocked ones not retried', rs.status === 200 && rs.data.resent === 1 && g1b.broadcast.counts.sent === 8 && g1b.broadcast.counts.failed === 0 && sendsTo(3005).filter((c) => textOf(c).includes(M1)).length === 1)
  check('re-send: nothing failed now, so a second re-send is refused', (await A(`/api/admin/broadcasts/${id1}/resend`, {})).status === 409)

  /* ---------------------------------------------------------- 24 h limit --- */
  const lim = await sendNow({ text: 'second today', segment: SEG('linked') })
  check('24h limit: a second broadcast within a day is refused (429)', lim.status === 429 && /One broadcast a day/.test(lim.data.error), JSON.stringify(lim.data))
  check('24h limit: the overview says when the next one may go', !!(await A('/api/admin/broadcasts')).data.nextAllowedAt)
  const sch24 = await A('/api/admin/broadcasts', { text: 'tomorrow', segment: SEG('linked'), action: 'schedule', scheduledAt: new Date(Date.now() + 25 * 3_600_000).toISOString(), confirm: 2 })
  check('24h limit: scheduling more than 24 h later is fine', sch24.status === 201 && sch24.data.broadcast.status === 'scheduled')
  check('24h limit: … and then a send within a day of that schedule is refused', (await A('/api/admin/broadcasts', { text: 'x', segment: SEG('linked'), action: 'schedule', scheduledAt: new Date(Date.now() + 30 * 3_600_000).toISOString(), confirm: 2 })).status === 429)
  check('cancel a scheduled broadcast', (await A(`/api/admin/broadcasts/${sch24.data.broadcast.id}/cancel`, {})).data.broadcast.status === 'cancelled')

  /* ------------------------------------------------------- link tracking --- */
  const idx = parseInt(kb1[0][0].url.split('.').at(-1), 36)
  const r1 = await fetch(kb1[0][0].url.replace('https://gullylabs.xyz', BASE), { redirect: 'manual' })
  const r2 = await fetch(kb1[0][0].url.replace('https://gullylabs.xyz', BASE), { redirect: 'manual' })
  check('link tracking: /r redirects (302) to the broadcast’s own button URL, noindex, no-store', r1.status === 302 && r1.headers.get('location') === 'https://gullylabs.xyz/tracker' && /noindex/.test(r1.headers.get('x-robots-tag') ?? '') && r1.headers.get('cache-control') === 'no-store' && r2.status === 302)
  const g1c = await getB(id1)
  check('link tracking: one open per recipient, every click counted', g1c.broadcast.opened === 1 && g1c.broadcast.clicks === 2 && g1c.recipients[idx].opened === true)
  check('link tracking: an unknown broadcast or button is 404 (never an open redirect)', (await fetch(`${BASE}/r/000000000000.0.0`, { redirect: 'manual' })).status === 404 && (await fetch(`${BASE}/r/${id1.slice(3)}.5.0`, { redirect: 'manual' })).status === 404 && (await fetch(`${BASE}/r/${id1.slice(3)}.0.0?to=https://evil.example`, { redirect: 'manual' })).headers.get('location') === 'https://gullylabs.xyz/tracker')

  /* ------------------------------------------------ 🔕 Stop announcements tap --- */
  const msg3008 = m1.find((c) => c.body.chat_id === '3008')
  const msgId3008 = g1c.recipients.length && (await (async () => {
    const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'broadcasts.json'), 'utf8'))
    return raw.broadcasts.find((x) => x.id === id1).recipients.find((r) => r.c === '3008').m
  })())
  await update({ callback_query: { id: 'cq-opt', from: { id: 3008, is_bot: false, first_name: 'P' }, message: { message_id: msgId3008, chat: { id: 3008, type: 'private' }, text: 'x', reply_markup: msg3008.body.reply_markup }, data: 'bco' } })
  await new Promise((r) => setTimeout(r, 2_300)) // the opt-out count is saved a moment later
  check('🔕 Stop announcements: the user is opted out', !!botUsers()['3008'].optedOut)
  check('🔕 counted on the broadcast it came from', (await getB(id1)).broadcast.optOuts === 1)
  check('🔕 opted-out users leave every audience', (await aud(SEG('follows'))).count === 7 && (await aud(SEG('all'))).count === 57)

  /* ------------------------------------- urgent + throttle + resume after restart --- */
  const M2 = 'MARK-TWO'
  const allNow = await aud(SEG('all'))
  bc.haltBroadcastsAfterForTest(30)
  const b2 = await A('/api/admin/broadcasts', { text: `${M2} urgent update`, segment: SEG('all'), urgent: true, action: 'send', confirm: allNow.count })
  check('urgent: allowed within the 24 h window', b2.status === 201, JSON.stringify(b2.data).slice(0, 160))
  const id2 = b2.data.broadcast.id
  await bc.tickBroadcasts()
  const half = JSON.parse(fs.readFileSync(path.join(tmp, 'broadcasts.json'), 'utf8')).broadcasts.find((x) => x.id === id2)
  check('the "server" stopped after 30 sends: progress is on disk, still sending', half.status === 'sending' && half.recipients.filter((r) => r.s === 'sent').length === 30 && half.recipients.filter((r) => r.s === 'pending').length === allNow.count - 30, `${half.status} ${half.recipients.filter((r) => r.s === 'sent').length}`)
  bc.haltBroadcastsAfterForTest(null)
  bc.reloadBroadcastsForTest() // as a restarted server
  await bc.tickBroadcasts()
  const g2 = await getB(id2)
  const m2 = withMarker(M2)
  const perChat = new Map()
  for (const c of m2) perChat.set(c.body.chat_id, (perChat.get(c.body.chat_id) ?? 0) + 1)
  check('resume after restart: finished, every recipient got it exactly once', g2.broadcast.status === 'sent' && g2.broadcast.counts.sent === allNow.count && m2.length === allNow.count && [...perChat.values()].every((n) => n === 1), `${g2.broadcast.counts.sent}/${allNow.count}, ${m2.length} messages`)
  const times = m2.map((c) => c.at).sort((a, b) => a - b)
  check(`throttle: at most 25 sends in any second (max ${windowMax(times)}), so ${allNow.count} took over a second`, windowMax(times) <= 25 && times.at(-1) - times[0] >= 1_000)
  check('opt-out never sent: no opted-out user ever got a broadcast', sendsTo(3011).length === 0 && !withMarker(M2).some((c) => c.body.chat_id === '3008'))
  check('blocked users are skipped in later broadcasts', !m2.some((c) => ['3005', '3006', '3012'].includes(c.body.chat_id)))

  // A send that was in flight when the server stopped is never sent twice.
  const disk = JSON.parse(fs.readFileSync(path.join(tmp, 'broadcasts.json'), 'utf8'))
  const tgt = disk.broadcasts.find((x) => x.id === id2)
  tgt.status = 'sending'
  tgt.recipients[0].s = 'inflight'
  fs.writeFileSync(path.join(tmp, 'broadcasts.json'), JSON.stringify(disk))
  bc.reloadBroadcastsForTest()
  await bc.tickBroadcasts()
  const g2b = await getB(id2)
  check('in flight at a restart: marked failed ("interrupted"), not sent again', g2b.recipients[0].status === 'failed' && /Interrupted/.test(g2b.recipients[0].error) && withMarker(M2).length === allNow.count && g2b.broadcast.status === 'sent')

  /* ------------------------------------------------ pause, resume, cancel --- */
  const M3 = 'MARK-THREE'
  const un = await aud(SEG('unlinked'))
  const b3 = await A('/api/admin/broadcasts', { text: `${M3} paused one`, segment: SEG('unlinked'), urgent: true, action: 'send', confirm: un.count })
  const id3 = b3.data.broadcast.id
  const p3 = await A(`/api/admin/broadcasts/${id3}/pause`, {})
  await bc.tickBroadcasts()
  const g3 = await getB(id3)
  check('pause: stops between batches, the rest wait', p3.status === 200 && g3.broadcast.status === 'paused' && g3.broadcast.counts.pending > 0 && g3.broadcast.counts.sent < un.count, JSON.stringify(g3.broadcast.counts))
  const sentPaused = withMarker(M3).length
  await new Promise((r) => setTimeout(r, 300))
  check('pause: nothing more goes out while paused', withMarker(M3).length === sentPaused)
  check('resume', (await A(`/api/admin/broadcasts/${id3}/resume`, {})).status === 200)
  await bc.tickBroadcasts()
  check('resume: finishes the rest', (await getB(id3)).broadcast.status === 'sent' && withMarker(M3).length === un.count)
  const b4 = await A('/api/admin/broadcasts', { text: 'MARK-FOUR', segment: SEG('unlinked'), urgent: true, action: 'send', confirm: un.count })
  await A(`/api/admin/broadcasts/${b4.data.broadcast.id}/cancel`, {})
  await bc.tickBroadcasts()
  const g4 = await getB(b4.data.broadcast.id)
  check('cancel: stops, the rest are marked cancelled', g4.broadcast.status === 'cancelled' && g4.broadcast.counts.cancelled > 0 && withMarker('MARK-FOUR').length < un.count)

  /* --------------------------------------------------------- scheduled --- */
  const at5 = Date.now() + 60_000
  const b5 = await A('/api/admin/broadcasts', { text: 'MARK-FIVE scheduled', segment: SEG('linked'), urgent: true, action: 'schedule', scheduledAt: new Date(at5).toISOString(), confirm: 2 })
  await bc.tickBroadcasts()
  check('scheduled: nothing before its time', withMarker('MARK-FIVE').length === 0 && (await getB(b5.data.broadcast.id)).broadcast.status === 'scheduled')
  bc.setBroadcastNowForTest(() => at5 + 1_000)
  await bc.tickBroadcasts()
  check('scheduled: goes out when due', withMarker('MARK-FIVE').length === 2 && (await getB(b5.data.broadcast.id)).broadcast.status === 'sent')
  const b6 = await A('/api/admin/broadcasts', { text: 'MARK-SIX', segment: SEG('linked'), urgent: true, action: 'schedule', scheduledAt: new Date(at5 + 120_000).toISOString(), confirm: 2 })
  bc.setBroadcastNowForTest(() => at5 + 120_000 + 7 * 3_600_000)
  await bc.tickBroadcasts()
  check('scheduled: more than 6 h overdue (server down) is cancelled, not sent late', withMarker('MARK-SIX').length === 0 && (await getB(b6.data.broadcast.id)).broadcast.status === 'cancelled')
  bc.setBroadcastNowForTest(null)

  /* ---------------------------------------------------- delete for everyone --- */
  const del = await A(`/api/admin/broadcasts/${id1}/delete`, {})
  await bc.tickBroadcasts()
  const g1d = await getB(id1)
  const dels = calls.filter((c) => c.method === 'deleteMessage' && !String(c.body.chat_id).startsWith('@'))
  check('delete for everyone: deleteMessage for every delivered copy', del.status === 202 && g1d.broadcast.status === 'deleted' && g1d.broadcast.counts.deleted === 8 && dels.length >= 8)
  check('delete: a second delete is refused', (await A(`/api/admin/broadcasts/${id1}/delete`, {})).status === 409)
  bc.setBroadcastNowForTest(() => Date.now() + 49 * 3_600_000)
  check('delete: refused after 48 h (Telegram’s limit for bots)', (await A(`/api/admin/broadcasts/${id2}/delete`, {})).status === 409)
  bc.setBroadcastNowForTest(null)

  /* -------------------------------------------------- channel: post and DM users --- */
  const allNow2 = await aud(SEG('all'))
  const chanBefore = calls.filter((c) => c.body.chat_id === CHANNEL && c.method === 'sendMessage').length
  const bad = await A('/api/admin/channel/posts', { text: '<b>Launch</b> of the week', action: 'post', dm: { confirm: allNow2.count + 5 } })
  check('post and DM: a wrong confirm count is 409 and nothing is posted', bad.status === 409 && bad.data.count === allNow2.count && calls.filter((c) => c.body.chat_id === CHANNEL && c.method === 'sendMessage').length === chanBefore)
  const okp = await A('/api/admin/channel/posts', { text: '<b>Launch</b> of the week is here, with more inside', action: 'post', dm: { confirm: allNow2.count, urgent: true } })
  check('post and DM: the post goes to the channel', okp.status === 201 && okp.data.post.status === 'sent' && !!okp.data.post.dmBroadcastId, JSON.stringify(okp.data).slice(0, 200))
  await bc.tickBroadcasts()
  const teaser = (await A('/api/admin/broadcasts')).data.broadcasts.find((x) => x.id === okp.data.post.dmBroadcastId)
  const tMsg = withMarker('New in the channel').find((c) => c.body.chat_id === '3001')?.body
  check('post and DM: a "📣 New in the channel →" teaser DM went to everyone with announcements on', teaser?.kind === 'teaser' && teaser.status === 'sent' && teaser.counts.sent === allNow2.count && /Launch of the week/.test(tMsg?.text ?? ''))
  check('post and DM: the teaser links to the channel post (tracked) and ends with 🔕 Stop announcements', teaser.buttons[0].url === `https://t.me/${CHANNEL.slice(1)}/${okp.data.post.messageId}` && /\/r\//.test(tMsg.reply_markup.inline_keyboard[0][0].url) && tMsg.reply_markup.inline_keyboard.at(-1)[0].callback_data === 'bco')
  const noUrgent = await A('/api/admin/channel/posts', { text: 'Another post', action: 'post', dm: { confirm: allNow2.count } })
  check('post and DM: the once-a-day rule applies unless urgent (429, not posted)', noUrgent.status === 429)
  check('post without DM still posts normally', (await A('/api/admin/channel/posts', { text: 'Plain post', action: 'post' })).status === 201)

  /* ------------------------------------------------------------- overview --- */
  const ov = (await A('/api/admin/broadcasts')).data
  check('analytics: total bot users, opt-outs, blocked, growth series', ov.stats.users === 62 && ov.stats.optedOut === 2 && ov.stats.blocked === 3 && ov.stats.growth.length > 10 && ov.stats.growth.at(-1).total === 62, JSON.stringify({ u: ov.stats.users, o: ov.stats.optedOut, b: ov.stats.blocked, g: ov.stats.growth.length }))
  check('analytics: the last broadcast with delivered, failed and opened', !!ov.last && typeof ov.last.counts.sent === 'number' && typeof ov.last.opened === 'number')
  check('test targets: the operators’ chat and linked chats', ov.adminChat === true && ov.testTargets.some((x) => x.chatId === 'admin') && ov.testTargets.some((x) => x.chatId === '3001'))

  /* ---------------------------------------------------------------- sweeps --- */
  const userSends = calls.filter((c) => SENDS.has(c.method) && /^\d+$/.test(String(c.body.chat_id)))
  const broadcastTexts = userSends.filter((c) => /MARK-|New in the channel/.test(textOf(c)))
  check('every broadcast message carries 🔕 Stop announcements', broadcastTexts.length > 100 && broadcastTexts.every((c) => c.body.reply_markup.inline_keyboard.at(-1)[0].callback_data === 'bco'))
  check('plain words: the teaser and the opt-out button', !JARGON.test(tMsg.text) && !JARGON.test('🔕 Stop announcements'))
  check('callback data within 64 bytes', userSends.every((c) => (c.body.reply_markup?.inline_keyboard ?? []).flat().every((b) => !b.callback_data || Buffer.byteLength(b.callback_data) <= 64)))
  check('no broadcast ever went to a group or the channel', !calls.some((c) => SENDS.has(c.method) && /MARK-/.test(textOf(c)) && (String(c.body.chat_id).startsWith('-') || String(c.body.chat_id).startsWith('@'))))
  check('stored atomically (no leftover .tmp), token not stored', fs.existsSync(path.join(tmp, 'broadcasts.json')) && !fs.existsSync(path.join(tmp, 'broadcasts.json.tmp')) && !fs.readFileSync(path.join(tmp, 'broadcasts.json'), 'utf8').includes(TOKEN.split(':')[1]))
  check('bot-users.json holds no names', !/"first_name"|"P"/.test(fs.readFileSync(path.join(tmp, 'bot-users.json'), 'utf8')))
} catch (e) {
  check(`no exception (${e?.stack ?? e})`, false)
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(t.failed ? 1 : 0)
