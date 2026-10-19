// End-to-end test of the Telegram support relay (server/telegram-relay.mjs) against a local Bot API stub.
//
//   node scripts/test-tg-relay.mjs        (no build needed; TEST_PORT overrides 8830)
//
// The real server runs IN THIS PROCESS with a fresh temporary DATA_DIR. TELEGRAM_API points at a local stub that
// records every call; nothing real is ever contacted. The token and the chats are made up.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { guardTestRun, makeChecker } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8830
await guardTestRun(PORT)
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-tg-relay-'))
const BOT_ID = 7000000005
const TOKEN = `${BOT_ID}:${crypto.randomBytes(24).toString('base64url')}`
const ADMIN = -1009000001
const t = makeChecker()
const { check } = t

/* -------------------------------------------------------------- Bot API stub --- */

const calls = []
let nextMsgId = 2_000
const nonMembers = new Set()
const failFor = new Set() // chat ids the stub refuses (the user blocked the bot)
const stub = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', async () => {
    const m = req.url.match(/^\/bot([^/]+)\/(\w+)$/)
    const send = (status, j) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(j))
    }
    if (!m || m[1] !== TOKEN) return send(401, { ok: false, error_code: 401, description: 'Unauthorized' })
    const raw = Buffer.concat(chunks)
    const ct = String(req.headers['content-type'] ?? '')
    let body = {}
    if (ct.startsWith('multipart/form-data')) {
      for (const [k, v] of await new Response(raw, { headers: { 'content-type': ct } }).formData()) body[k] = typeof v === 'string' ? v : { file: true }
    } else if (raw.length) body = JSON.parse(raw.toString('utf8'))
    const method = m[2]
    const call = { method, body, resultId: null }
    calls.push(call)
    if (method === 'getMe') return send(200, { ok: true, result: { id: BOT_ID, is_bot: true, username: 'GullyTestBot' } })
    if (method === 'getChatMember') return send(200, { ok: true, result: { status: nonMembers.has(Number(body.user_id)) ? 'left' : 'member', user: { id: Number(body.user_id) } } })
    if (['sendMessage', 'sendPhoto', 'sendDocument', 'sendAnimation'].includes(method)) {
      if (failFor.has(String(body.chat_id))) return send(403, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' })
      const id = nextMsgId++
      call.resultId = id
      return send(200, { ok: true, result: { message_id: id, chat: { id: Number(body.chat_id) } } })
    }
    return send(200, { ok: true, result: true })
  })
})
await new Promise((r) => stub.listen(0, '127.0.0.1', r))

Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: path.join(tmp, 'no-dist'),
  ADMIN_TOKEN: crypto.randomBytes(24).toString('hex'),
  TRACKER_LOOP: 'off',
  TRACKER_SKIP_APIS: '1',
  TELEGRAM_API: `http://127.0.0.1:${stub.address().port}`,
  TELEGRAM_ADMIN_CHAT_ID: String(ADMIN),
  TELEGRAM_GATE_FREE_ACTIONS: '0', // a hard wall: non-members get nothing but the join screen
  ASK_REMOTE: 'off',
})
for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'ANTHROPIC_API_KEY']) delete process.env[k]
for (const k of ['GULLY_RPC_1', 'GULLY_RPC_56', 'GULLY_RPC_8453', 'GULLY_RPC_42161']) process.env[k] = 'http://127.0.0.1:9'
await import('../server/server.mjs')
const tg = await import('../server/telegram.mjs')
const relay = await import('../server/telegram-relay.mjs')
await new Promise((r) => setTimeout(r, 300))
process.env.TELEGRAM_BOT_TOKEN = TOKEN
await tg.startTelegram()

const HOOK = tg.webhookPathFor(TOKEN)
const SECRET = tg.webhookSecretFor(TOKEN)
let uid = 1
const post = (update) => fetch(`${BASE}/api/telegram/${HOOK}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET }, body: JSON.stringify({ update_id: uid++, ...update }) }).then((r) => r.status)
const priv = (id, name = 'Ada') => ({ id, type: 'private', first_name: name })
const user = (id, name = 'Ada', username) => ({ id, is_bot: false, first_name: name, ...(username ? { username } : {}) })
const msg = (chat, from, extra) => post({ message: { message_id: 5_000 + uid, date: Math.floor(Date.now() / 1000), chat, from, ...extra } })
const say = (id, text, { name = 'Ada', username = undefined } = {}) => msg(priv(id, name), user(id, name, username), { text })
const adminChat = { id: ADMIN, type: 'supergroup', title: 'Ops' }
const adminSay = (text, extra = {}) => msg(adminChat, user(42, 'Owner'), { text, ...extra })
const replyTo = (id, chat = ADMIN) => ({ reply_to_message: { message_id: id, chat: { id: chat } } })
const sentTo = (chatId, from = 0) => calls.slice(from).filter((c) => c.method.startsWith('send') && String(c.body.chat_id) === String(chatId))
const lastTo = (chatId) => calls.filter((c) => c.method === 'sendMessage' && String(c.body.chat_id) === String(chatId)).at(-1)?.body
const mark = () => calls.length
const sample = []

try {
  /* ----------------------------------------------------- commands and help --- */
  const privCmds = calls.find((c) => c.method === 'setMyCommands' && c.body.scope?.type === 'all_private_chats')?.body.commands.map((c) => c.command) ?? []
  check('setMyCommands: contact is in the private list', privCmds.includes('contact'), privCmds.join())
  const groupCmds = calls.find((c) => c.method === 'setMyCommands' && c.body.scope?.type === 'all_group_chats')?.body.commands.map((c) => c.command) ?? []
  check('setMyCommands: groups keep their short list', !groupCmds.includes('contact'), groupCmds.join())
  await say(100, '/help')
  check('help text lists /contact', /\/contact/.test(lastTo(100)?.text ?? ''), lastTo(100)?.text)

  /* ------------------------------ every start param; the News gate does not apply --- */
  const startFor = { 201: 'chains', 202: 'contact', 203: 'partners', 204: 'security', 205: 'pay' }
  for (const [id, topic] of Object.entries(startFor)) {
    nonMembers.add(Number(id))
    const n = mark()
    await say(Number(id), `/start ${topic}`)
    const out = sentTo(id, n)
    const prompt = lastTo(id)
    check(`/start ${topic} (not a News follower): the prompt with a Cancel button, no join screen`, out.length === 1 && prompt?.text === relay.PROMPT && prompt.reply_markup.inline_keyboard[0][0].text === 'Cancel' && relay.relayStateForTest().open[id]?.topic === topic, prompt?.text)
  }
  sample.push(['prompt', lastTo(205).text])
  nonMembers.add(206)
  const n0 = mark()
  await say(206, '/gap NVDA')
  check('control: the gate still applies to other commands (a non-follower gets the join screen for /gap)', calls.slice(n0).some((c) => /Follow|join/i.test(String(c.body.text ?? c.body.caption ?? ''))))
  const n0b = mark()
  await say(201, 'a message from a non-follower in an open conversation')
  check('a non-follower in a conversation is relayed (support is never gated)', sentTo(ADMIN, n0b).length === 1)

  /* ---------------------------------------------- /contact; user -> admin --- */
  await say(300, '/contact')
  check('/contact: opens the mode with the prompt', lastTo(300).text === relay.PROMPT && relay.relayStateForTest().open['300']?.topic === 'contact')
  const n1 = mark()
  await say(300, 'Hi, I <b>need</b> a chain added & fast', { name: 'Ada', username: 'ada_l' })
  const adminMsg = calls.slice(n1).find((c) => c.method === 'sendMessage' && String(c.body.chat_id) === String(ADMIN))
  const adm = adminMsg.body
  const adminId = adminMsg.resultId
  check('user -> admin: one new message with topic, name, @username, id and the reply hint', /Support · Contact/.test(adm.text) && /From: Ada/.test(adm.text) && /@ada_l/.test(adm.text) && /id <code>300<\/code>/.test(adm.text) && /Reply to this message to answer/.test(adm.text), adm.text)
  check('user -> admin: user text is HTML-escaped, never passed as HTML; no forwardMessage', adm.text.includes('Hi, I &lt;b&gt;need&lt;/b&gt; a chain added &amp; fast') && adm.parse_mode === 'HTML' && !calls.some((c) => c.method === 'forwardMessage'))
  sample.push(['admin message', adm.text])
  const st = relay.relayStateForTest()
  check('mapping: admin message id -> user chat id, stored in DATA_DIR/tg-relay.json', st.map[String(adminId)]?.c === '300' && st.map[String(adminId)]?.u === '300' && JSON.parse(fs.readFileSync(path.join(tmp, 'tg-relay.json'), 'utf8')).map[String(adminId)]?.c === '300')
  check('the user is told it was sent, with a Done button', /Sent/.test(lastTo(300).text) && lastTo(300).reply_markup.inline_keyboard[0][0].text === 'Done')

  /* ------------------------------------------------------ admin -> user --- */
  await adminSay('Thanks Ada, which chain? <i>tell us</i>', replyTo(adminId))
  const reply = lastTo(300)
  check('admin reply -> user: "Gully Labs team:" prefix, plain text (no parse_mode)', reply.text === 'Gully Labs team:\nThanks Ada, which chain? <i>tell us</i>' && reply.parse_mode === undefined, reply.text)
  sample.push(['to user', reply.text])
  check('admin reply: acknowledged in the admin chat', lastTo(ADMIN).text === '✓ Sent' && lastTo(ADMIN).reply_to_message_id !== undefined)
  sample.push(['admin ack', lastTo(ADMIN).text])
  const n3 = mark()
  await adminSay('just chatting, not a reply')
  check('admin chat: a non-reply message is ignored', calls.slice(n3).filter((c) => c.method.startsWith('send')).length === 0)
  const n4 = mark()
  await adminSay('reply to something unmapped', replyTo(99_999))
  check('admin chat: a reply to an unmapped message is ignored', calls.slice(n4).filter((c) => c.method.startsWith('send')).length === 0)
  const n5 = mark()
  await msg({ id: -1007, type: 'supergroup', title: 'Other' }, user(77, 'Eve'), { text: 'forged answer', ...replyTo(adminId, -1007) })
  await msg(priv(78, 'Mal'), user(78, 'Mal'), { text: 'forged answer', ...replyTo(adminId, 78) })
  check('messages from other chats are never relayed (even replying to a mapped id)', calls.slice(n5).filter((c) => c.method.startsWith('send') && ['300', String(ADMIN)].includes(String(c.body.chat_id))).length === 0)

  /* ------------------------------------------------------ photo + caption --- */
  const n6 = mark()
  await msg(priv(300), user(300, 'Ada', 'ada_l'), { photo: [{ file_id: 'SMALL', width: 10, height: 10 }, { file_id: 'BIG', width: 800, height: 600 }], caption: 'screenshot <of> the error' })
  const ph = calls.slice(n6).find((c) => c.method === 'sendPhoto' && String(c.body.chat_id) === String(ADMIN))
  check('photo with caption: sent to the admin as a photo (largest size) with header and escaped caption', ph?.body.photo === 'BIG' && /Support · Contact/.test(ph.body.caption) && /screenshot &lt;of&gt; the error/.test(ph.body.caption) && ph.body.caption.length <= 1024, ph?.body.caption)
  check('photo: also mapped', relay.relayStateForTest().map[String(ph?.resultId)]?.c === '300')
  const n7 = mark()
  await msg(priv(300), user(300, 'Ada'), { document: { file_id: 'DOC1', file_name: 'log.txt' }, caption: 'the log' })
  check('document with caption: sent to the admin as a document', calls.slice(n7).some((c) => c.method === 'sendDocument' && c.body.document === 'DOC1' && String(c.body.chat_id) === String(ADMIN)))
  const n8 = mark()
  await adminSay('see attached', { photo: [{ file_id: 'ASMALL' }, { file_id: 'ABIG' }], ...replyTo(ph.resultId) })
  const ap = calls.slice(n8).find((c) => c.method === 'sendPhoto' && String(c.body.chat_id) === '300')
  check('admin photo reply -> user: a photo with the prefix', ap?.body.photo === 'ABIG' && ap.body.caption === 'Gully Labs team:\nsee attached', ap?.body.caption)
  const n9 = mark()
  await adminSay('the fix', { document: { file_id: 'ADOC' }, ...replyTo(ph.resultId) })
  check('admin document reply -> user', calls.slice(n9).some((c) => c.method === 'sendDocument' && c.body.document === 'ADOC' && String(c.body.chat_id) === '300'))

  /* ------------------------------------------------- length and rate limit --- */
  const n9b = mark()
  await say(300, 'x'.repeat(relay.MAX_USER_TEXT + 1))
  check('a message over the length cap is refused with a notice, not forwarded', /too long/.test(lastTo(300).text) && sentTo(ADMIN, n9b).length === 0)
  await say(400, '/start partners')
  const n10 = mark()
  for (let i = 0; i < 14; i++) await say(400, `msg ${i}`)
  const fwd = sentTo(ADMIN, n10).length
  const warns = sentTo(400, n10).filter((c) => /very quickly/.test(c.body.text ?? '')).length
  check(`rate limit: 10 messages relayed, the rest dropped, one warning (${fwd} relayed, ${warns} warning)`, fwd === 10 && warns === 1)
  sample.push(['rate-limit warning', sentTo(400, n10).find((c) => /very quickly/.test(c.body.text ?? ''))?.body.text])

  /* ----------------------------------------------------------- /cancel, Done --- */
  await say(500, '/contact')
  await say(500, '/cancel')
  check('/cancel: closes the conversation', /closed/.test(lastTo(500).text) && !relay.relayStateForTest().open['500'])
  const n11 = mark()
  await say(500, 'hello? anyone')
  check('after /cancel nothing is relayed', sentTo(ADMIN, n11).length === 0)
  await say(501, '/contact')
  await post({ callback_query: { id: 'cq-done', from: user(501), message: { message_id: 1, chat: priv(501), text: 'x' }, data: 'rly:x' } })
  check('Cancel / Done button: closes the conversation and answers the tap', !relay.relayStateForTest().open['501'] && calls.some((c) => c.method === 'answerCallbackQuery' && c.body.callback_query_id === 'cq-done'))

  /* ---------------------------------------------------------------- 24 h expiry --- */
  await say(600, '/start pay')
  relay.ageConversationForTest(600, 23 * 3_600_000)
  const n12 = mark()
  await say(600, 'still within a day')
  check('23 h of inactivity: still open and relayed', sentTo(ADMIN, n12).length === 1)
  relay.ageConversationForTest(600, 25 * 3_600_000)
  const n13 = mark()
  await say(600, 'a day later')
  check('25 h of inactivity: closed with a notice, not relayed', /timed out/.test(lastTo(600).text) && sentTo(ADMIN, n13).length === 0)

  /* ------------------------------------------------------------------- /block --- */
  await say(700, '/start chains', { name: 'Spam' })
  const n14 = mark()
  await say(700, 'buy my coin')
  const spamId = calls.slice(n14).find((c) => String(c.body.chat_id) === String(ADMIN)).resultId
  await adminSay('/block 700')
  check('/block in the admin chat: confirmed and stored', /Blocked 700/.test(lastTo(ADMIN).text) && relay.relayStateForTest().blocked.includes('700'))
  const n15 = mark()
  await say(700, 'buy my coin again')
  await say(700, '/contact')
  check('blocked user: nothing relayed, no new conversation', sentTo(ADMIN, n15).length === 0 && !relay.relayStateForTest().open['700'])
  const n16 = mark()
  await adminSay('hello', replyTo(spamId))
  check('blocked user: admin replies are not delivered either', sentTo(700, n16).length === 0)
  const n17 = mark()
  await msg(priv(701), user(701), { text: '/block 701' })
  check('/block from a non-admin chat does nothing', !relay.relayStateForTest().blocked.includes('701'))
  await adminSay('/unblock 700')
  await say(700, '/contact')
  check('/unblock: the user can write again', !relay.relayStateForTest().blocked.includes('700') && !!relay.relayStateForTest().open['700'])
  void n17

  /* ------------------------------------------------------------------- groups --- */
  const n18 = mark()
  await msg({ id: -5555, type: 'supergroup', title: 'Fans' }, user(800, 'Gus'), { text: '/contact@GullyTestBot' })
  const g = lastTo(-5555)
  check('group: /contact answers "message me privately" with the deep link and starts nothing', /message me privately/.test(g.text) && g.text.includes('https://t.me/GullyTestBot?start=contact') && !relay.relayStateForTest().open['-5555'] && !relay.relayStateForTest().open['800'])
  sample.push(['group', g.text])
  await msg({ id: -5555, type: 'supergroup', title: 'Fans' }, user(800, 'Gus'), { text: 'plain chatter' })
  check('group: chatter is never relayed', sentTo(ADMIN, n18).length === 0)
  const n19 = mark()
  await msg({ id: -5556, type: 'supergroup', title: 'Fans 2' }, user(800, 'Gus'), { text: '/contact@OtherBot' })
  check('group: /contact for another bot is ignored', sentTo(-5556, n19).length === 0)

  /* ---------------------------------------------------- delivery failures, off --- */
  await say(900, '/contact')
  const n20 = mark()
  await say(900, 'will you see this')
  const id900 = calls.slice(n20).find((c) => String(c.body.chat_id) === String(ADMIN)).resultId
  failFor.add('900')
  await adminSay('reply to a user who blocked the bot', replyTo(id900))
  check('delivery failure: the admin is told, no false ✓', /Not delivered/.test(lastTo(ADMIN).text))
  failFor.delete('900')
  process.env.TELEGRAM_ADMIN_CHAT_ID = ''
  await say(901, '/contact')
  check('no admin chat configured: a polite notice, no conversation', /not available/.test(lastTo(901).text) && !relay.relayStateForTest().open['901'])
  process.env.TELEGRAM_ADMIN_CHAT_ID = String(ADMIN)

  /* ---------------------------------------------------------------- invariants --- */
  check('no forwardMessage / copyMessage was used', !calls.some((c) => ['forwardMessage', 'copyMessage'].includes(c.method)))
  check('the token is not in the stored relay data', !fs.readFileSync(path.join(tmp, 'tg-relay.json'), 'utf8').includes(TOKEN.split(':')[1]))
  for (const [k, v] of sample) console.log(`  sample ${k}: ${JSON.stringify(v)}`)
} catch (e) {
  check(`no exception (${e?.stack ?? e})`, false)
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(t.failed ? 1 : 0)
