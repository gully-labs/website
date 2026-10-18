// End-to-end test of the @GullyLabsNews channel posts (server/telegram-channel.mjs) and their admin routes.
//
//   node scripts/test-tg-channel.mjs        (no build needed)
//
// The real server runs IN THIS PROCESS on port 8801 (TEST_PORT overrides) with a fresh temporary DATA_DIR
// and the tracker loop off. Nothing real is ever called: TELEGRAM_API points at a local Bot API stub that
// records every call and can be told to fail one; GHOST_URL at a Ghost Content API stub; DEEPCORE_API at a
// DeepCore stub (launch events go through deepcore.mjs's real poller and listeners); ANTHROPIC_API_URL at a
// Messages API stub for the Gully AI draft. The token is a made-up one; the channel is a made-up one too.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { guardTestRun, makeChecker, makeClient } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8801
await guardTestRun(PORT, { watchdogMs: 6 * 60_000 })
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-tg-channel-'))
const BOT_ID = 7000000002
const TOKEN = `${BOT_ID}:${crypto.randomBytes(24).toString('base64url')}`
const CHANNEL = '@GullyTestNews'
const ADMIN = crypto.randomBytes(24).toString('hex')
const t = makeChecker()
const { check } = t

/* -------------------------------------------------------------- Bot API stub --- */

const calls = []
let nextMsgId = 500
let members = 1234
const failNext = new Map() // method -> description (one failure)
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
    calls.push({ method, body })
    if (failNext.has(method)) {
      const d = failNext.get(method)
      failNext.delete(method)
      return send(400, { ok: false, error_code: 400, description: d })
    }
    if (method === 'getMe') return send(200, { ok: true, result: { id: BOT_ID, is_bot: true, username: 'GullyTestBot' } })
    if (method === 'getChatMemberCount') return send(200, { ok: true, result: members })
    if (['sendMessage', 'sendPhoto', 'sendAnimation'].includes(method)) {
      const id = nextMsgId++
      const result = { message_id: id, chat: { id: -1001, username: CHANNEL.slice(1) } }
      if (method === 'sendAnimation') result.animation = { file_id: typeof body.animation === 'string' && !body.animation.startsWith('http') ? body.animation : 'BANNER_FILE_1' }
      return send(200, { ok: true, result })
    }
    return send(200, { ok: true, result: true })
  })
})
await new Promise((r) => stub.listen(0, '127.0.0.1', r))
const chCalls = (method) => calls.filter((c) => c.method === method && c.body.chat_id === CHANNEL)
const last = (method, chat = CHANNEL) => calls.filter((c) => c.method === method && String(c.body.chat_id) === String(chat)).at(-1)?.body

/* ---------------------------------------------------------------- Ghost stub --- */

const GHOST_KEY = 'a'.repeat(26)
const ghostPosts = [{ id: 'g1', title: 'Old post', url: 'https://blog.gullylabs.xyz/old/', excerpt: 'Old.', published_at: '2026-10-01T00:00:00Z' }]
let ghostHits = 0
const ghost = http.createServer((req, res) => {
  ghostHits++
  const u = new URL(req.url, 'http://x')
  res.writeHead(u.pathname === '/ghost/api/content/posts/' && u.searchParams.get('key') === GHOST_KEY ? 200 : 401, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ posts: [...ghostPosts].reverse() }))
})
await new Promise((r) => ghost.listen(0, '127.0.0.1', r))

/* -------------------------------------------------------------- DeepCore stub --- */

const dcItem = (n) => ({ chainId: 8453, token: `0x${String(n).padStart(40, '0')}`, launchToken: { symbol: `T${n}` }, createdAt: { blockTimestamp: new Date(Date.UTC(2026, 9, 17, 10, n)).toISOString(), txHash: '0x' + 'ab'.repeat(32) }, legs: [{ kind: 'CL', quote: { symbol: 'WETH' }, lock: { status: 'indexed', lockId: 1 } }] })
const dcItems = [dcItem(1)]
const deepcore = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ data: { items: [...dcItems].reverse(), chains: [{ chainId: 8453, status: 'ok', total: dcItems.length }] } }))
})
await new Promise((r) => deepcore.listen(0, '127.0.0.1', r))

/* ------------------------------------------------------------- Anthropic stub --- */

const claudeCalls = []
const claude = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    claudeCalls.push(JSON.parse(raw || '{}'))
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ content: [{ type: 'text', text: '<b>Gap alerts on Telegram</b>\nGet a message when a gap opens.\n<a href="https://gullylabs.xyz/developers">Set one up</a>\n\nSources: [1]' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }))
  })
})
await new Promise((r) => claude.listen(0, '127.0.0.1', r))

/* ------------------------------------------------------------ start server --- */

Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: path.join(tmp, 'no-dist'),
  ADMIN_TOKEN: ADMIN,
  TRACKER_LOOP: 'off',
  TRACKER_SKIP_APIS: '1',
  DEEPCORE_LOOP: 'off',
  DEEPCORE_API: `http://127.0.0.1:${deepcore.address().port}`,
  GULLY_RPC_1: 'http://127.0.0.1:9',
  GULLY_RPC_56: 'http://127.0.0.1:9',
  GULLY_RPC_8453: 'http://127.0.0.1:9',
  GULLY_RPC_42161: 'http://127.0.0.1:9',
  GULLY_RPC_10: 'http://127.0.0.1:9',
  GULLY_RPC_137: 'http://127.0.0.1:9',
  GULLY_RPC_43114: 'http://127.0.0.1:9',
  TELEGRAM_API: `http://127.0.0.1:${stub.address().port}`,
  TELEGRAM_BOT_TOKEN: TOKEN,
  TELEGRAM_NEWS_CHANNEL: CHANNEL,
  TELEGRAM_REQUIRED_CHANNEL: 'off',
  GHOST_URL: `http://127.0.0.1:${ghost.address().port}`,
  ANTHROPIC_API_URL: `http://127.0.0.1:${claude.address().port}`,
  ASK_REMOTE: 'off',
})
for (const k of ['ANTHROPIC_API_KEY', 'GHOST_CONTENT_KEY', 'ASK_DAILY_LIMIT', 'TELEGRAM_WEBHOOK_SECRET', 'GULLY_TREASURY_ADDRESS']) delete process.env[k]
await import('../server/server.mjs')
const tg = await import('../server/telegram.mjs')
const ch = await import('../server/telegram-channel.mjs')
const dc = await import('../server/deepcore.mjs')
ch.stopChannel() // the test drives the scheduler by hand
await new Promise((r) => setTimeout(r, 300))

const admin = makeClient(BASE)
const A = (p, body) => (body === undefined ? admin.call(p, { auth: ADMIN }) : admin.call(p, { method: 'POST', body, auth: ADMIN }))
const findPost = async (id) => (await A('/api/admin/channel')).data.posts.find((p) => p.id === id)

// Synthetic tracker rows and 7 days of history for the gaps and movers posts.
const row = (o) => ({ chain: 'robinhood', ticker: 'NVDA', name: 'NVIDIA', status: 'premium', gapPct: 3.1, fair: 180, onchain: 185.58, poolStale: false, sessionOpen: true, pool: { liquidityUsd: 50_000 }, ...o })
const ROWS = [row({}), row({ ticker: 'TSLA', status: 'discount', gapPct: -2.5 }), row({ ticker: 'META', status: 'in-line', gapPct: 0.4 }), row({ ticker: 'AMZN', status: 'thin', gapPct: 9 }), row({ ticker: 'GOOGL', status: 'unverified', gapPct: null }), row({ ticker: 'MSFT', chain: 'bsc', status: 'drifting', gapPct: 1.5 }), row({ ticker: 'AAPL', status: 'premium', gapPct: 2.2 }), row({ ticker: 'AMD', status: 'premium', gapPct: 4.4 })]
let rowsOk = true
const changelog = [{ key: 'https://docs.gullylabs.xyz/changelog#2026-10-16', date: '16 October 2026', url: 'https://docs.gullylabs.xyz/changelog#2026-10-16', text: 'Older release.' }]
ch.setChannelSourcesForTest({
  rows: async () => (rowsOk ? ROWS : null),
  history: (c, tk) => {
    const s = Math.floor(Date.now() / 1000)
    const base = tk === 'NVDA' ? 100 : tk === 'TSLA' ? 200 : 50
    return [[s - 6 * 86_400, 1, base, base], [s - 60, 1, tk === 'NVDA' ? 110 : tk === 'TSLA' ? 190 : 50.5, base]]
  },
  changelog: () => [...changelog].reverse(),
})

const wallet = privateKeyToAccount(generatePrivateKey())
const dev = makeClient(BASE)
const HOOK = tg.webhookPathFor(TOKEN)
const SECRET = tg.webhookSecretFor(TOKEN)
let uid = 1
const say = (chatId, text) => fetch(`${BASE}/api/telegram/${HOOK}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET }, body: JSON.stringify({ update_id: uid++, message: { message_id: uid, date: Math.floor(Date.now() / 1000), chat: { id: chatId, type: 'private', first_name: 'Owner' }, from: { id: chatId, is_bot: false, first_name: 'Owner' }, text } }) })

try {
  /* --------------------------------------------------------------- admin auth --- */
  check('no token: 401', (await admin.call('/api/admin/channel')).status === 401)
  check('wrong token: 401', (await admin.call('/api/admin/channel', { auth: 'x'.repeat(48) })).status === 401)
  check('wrong token on a post route: 401, nothing sent', (await admin.call('/api/admin/channel/posts', { method: 'POST', body: { text: 'hi', action: 'post' }, auth: 'y'.repeat(48) })).status === 401 && !chCalls('sendMessage').length)
  const v0 = await A('/api/admin/channel')
  check('GET with the token: the channel, limits, no posts', v0.status === 200 && v0.data.channel === CHANNEL && v0.data.enabled && v0.data.limits.text === 4096 && v0.data.limits.caption === 1024 && v0.data.posts.length === 0, JSON.stringify(v0.data).slice(0, 200))

  /* ---------------------------------------------------------------- sanitizer --- */
  const S = ch.sanitizeTelegramHtml
  check('sanitizer: allowed tags stay', S('<b>a</b><i>b</i><u>c</u><s>d</s><code>e</code><pre>f</pre><blockquote>g</blockquote><tg-spoiler>h</tg-spoiler>') === '<b>a</b><i>b</i><u>c</u><s>d</s><code>e</code><pre>f</pre><blockquote>g</blockquote><tg-spoiler>h</tg-spoiler>')
  check('sanitizer: strong/em/del become b/i/s, <br> a line break', S('<strong>x</strong><em>y</em><del>z</del>a<br>b') === '<b>x</b><i>y</i><s>z</s>a\nb')
  check('sanitizer: other tags dropped, text kept; script removed with its content', S('<div>hi <span style="x">there</span></div><script>alert(1)</script><img src=x onerror=alert(1)>') === 'hi there', S('<div>hi <span style="x">there</span></div><script>alert(1)</script><img src=x onerror=alert(1)>'))
  check('sanitizer: attributes dropped (b onclick)', S('<b onclick="x()">a</b>') === '<b>a</b>')
  check('sanitizer: a href kept for https, quotes escaped', S('<a href="https://gullylabs.xyz/?a=1&b=2" target=_blank>go</a>') === '<a href="https://gullylabs.xyz/?a=1&amp;b=2">go</a>', S('<a href="https://gullylabs.xyz/?a=1&b=2" target=_blank>go</a>'))
  check('sanitizer: javascript: and data: links dropped (text kept)', S('<a href="javascript:alert(1)">x</a><a href="data:text/html,1">y</a>') === 'xy')
  check('sanitizer: stray < > & escaped, entities kept', S('1 < 2 & 3 > 2 &amp; &lt;b&gt;') === '1 &lt; 2 &amp; 3 &gt; 2 &amp; &lt;b&gt;')
  check('sanitizer: unclosed tags closed, stray closers dropped', S('<b>bold <i>both</b> tail</i></u>') === '<b>bold <i>both</i></b> tail')
  check('sanitizer: nothing nests inside code', S('<code><b>x</b></code>') === '<code>x</code>')
  check('sanitizer: pre may hold code', S('<pre><code>x</code></pre>') === '<pre><code>x</code></pre>')
  check('sanitizer: nested links dropped', S('<a href="https://a.io">1<a href="https://b.io">2</a></a>') === '<a href="https://a.io/">12</a>')
  check('sanitizer: comments removed', S('a<!-- hidden -->b') === 'ab')
  check('visible length counts text, not tags or entities', ch.visibleLength('<b>ab</b> &amp; <a href="https://x.io">c</a>') === 6)

  /* ------------------------------------------------------------------ limits --- */
  const val = (b) => A('/api/admin/channel/validate', b)
  const okLen = await val({ text: '<b>' + 'x'.repeat(4096) + '</b>' })
  check('limits: 4096 visible characters of text are fine (tags not counted)', okLen.data.errors.length === 0 && okLen.data.length === 4096)
  const tooLong = await val({ text: 'x'.repeat(4097) })
  check('limits: 4097 characters refused', tooLong.data.errors.some((e) => /4096/.test(e)))
  const cap = await val({ text: 'x'.repeat(1025), media: { kind: 'photo', url: 'https://gullylabs.xyz/a.png' } })
  check('limits: a caption over 1024 is refused when media is attached', cap.data.limit === 1024 && cap.data.errors.some((e) => /1024/.test(e)))
  check('limits: an empty post is refused', (await val({ text: '<b></b>' })).data.errors.some((e) => /needs some text/.test(e)))
  check('limits: a too-long post is refused by the post route (400) and nothing is sent', (await A('/api/admin/channel/posts', { text: 'x'.repeat(5000), action: 'post' })).status === 400 && !chCalls('sendMessage').length)
  check('media: an http (not https) image is refused', (await val({ text: 'x', media: { kind: 'photo', url: 'http://x.io/a.png' } })).data.errors.some((e) => /https/.test(e)))

  /* ----------------------------------------------------------------- buttons --- */
  const vb = ch.validateButtons
  check('buttons: up to three https buttons pass', vb([{ text: 'A', url: 'https://a.io' }, { text: 'B', url: 'https://b.io/x?y=1' }, { text: 'C', url: 'https://c.io' }]).errors.length === 0)
  check('buttons: a fourth is refused', vb([1, 2, 3, 4].map((n) => ({ text: `B${n}`, url: 'https://a.io' }))).errors.some((e) => /At most 3/.test(e)))
  check('buttons: http, javascript: and junk links refused', ['http://a.io', 'javascript:alert(1)', 'not a url', 'https://user:pw@a.io'].every((u) => vb([{ text: 'x', url: u }]).errors.length === 1))
  check('buttons: a label is required and at most 64 characters', vb([{ text: '', url: 'https://a.io' }]).errors.length === 1 && vb([{ text: 'x'.repeat(65), url: 'https://a.io' }]).errors.length === 1)
  check('buttons: empty rows are ignored', vb([{ text: '', url: '' }]).buttons.length === 0 && vb([{ text: '', url: '' }]).errors.length === 0)

  /* --------------------------------------------------------------- test send --- */
  const noLink = await A('/api/admin/channel/test', { text: '<b>Test</b>' })
  check('test send: refused until a linked chat is chosen', noLink.status === 400 && /link/i.test(noLink.data.error))
  check('test send: an unlinked chat id is refused', (await A('/api/admin/channel/test', { text: 'x', chatId: '999' })).status === 400)
  await dev.signIn(wallet)
  const code = (await dev.post('/api/developer/telegram/connect')).data.link.split('start=')[1]
  await say(4242, `/start ${code}`)
  await new Promise((r) => setTimeout(r, 300))
  const v1 = await A('/api/admin/channel')
  check('the linked chats are listed for the test target', v1.data.linkedChats.some((c) => c.chatId === '4242' && c.address === wallet.address.toLowerCase()))
  const ts = await A('/api/admin/channel/test', { text: '<b>Hello</b> <script>x</script>world', buttons: [{ text: 'Open', url: 'https://gullylabs.xyz' }], chatId: '4242' })
  const tsBody = last('sendMessage', '4242')
  check('test send: goes to the linked chat, sanitized, with the button', ts.status === 200 && tsBody?.text === '<b>Hello</b> world' && tsBody.parse_mode === 'HTML' && tsBody.reply_markup.inline_keyboard[0][0].url === 'https://gullylabs.xyz/', JSON.stringify(tsBody))
  check('test send: nothing went to the channel', chCalls('sendMessage').length === 0)
  check('test send: the chat is remembered for next time', (await A('/api/admin/channel/test', { text: 'again' })).status === 200 && (await A('/api/admin/channel')).data.testChat === '4242')

  /* ----------------------------------------------------- post, edit, delete, pin --- */
  const p1 = await A('/api/admin/channel/posts', { text: '<b>Launch</b> day', buttons: [{ text: 'Tracker', url: 'https://gullylabs.xyz/tracker' }], pin: true, action: 'post' })
  const sm = last('sendMessage')
  check('post: sendMessage to the channel with HTML and a URL keyboard', p1.status === 201 && sm?.text === '<b>Launch</b> day' && sm.parse_mode === 'HTML' && sm.reply_markup.inline_keyboard[0][0].text === 'Tracker')
  check('post: stored as sent with its message id and t.me link', p1.data.post.status === 'sent' && p1.data.post.messageId > 0 && p1.data.post.url === `https://t.me/${CHANNEL.slice(1)}/${p1.data.post.messageId}`)
  check('pin: pinChatMessage for the new message, silently', last('pinChatMessage')?.message_id === p1.data.post.messageId && last('pinChatMessage').disable_notification === true && p1.data.post.pinned === true)
  const id1 = p1.data.post.id
  const e1 = await A(`/api/admin/channel/posts/${id1}`, { text: '<b>Launch</b> day, edited' })
  check('edit text: editMessageText on the sent message', e1.status === 200 && last('editMessageText')?.text === '<b>Launch</b> day, edited' && last('editMessageText').message_id === p1.data.post.messageId)
  const nBefore = calls.length
  const e2 = await A(`/api/admin/channel/posts/${id1}`, { buttons: [{ text: 'Docs', url: 'https://docs.gullylabs.xyz' }] })
  check('edit buttons only: editMessageReplyMarkup', e2.status === 200 && calls.slice(nBefore).some((c) => c.method === 'editMessageReplyMarkup' && c.body.reply_markup.inline_keyboard[0][0].text === 'Docs') && !calls.slice(nBefore).some((c) => c.method === 'editMessageText'))
  const e3 = await A(`/api/admin/channel/posts/${id1}`, { pin: false })
  check('unpin: unpinChatMessage', e3.status === 200 && last('unpinChatMessage')?.message_id === p1.data.post.messageId && e3.data.post.pinned === false)
  check('edit: media cannot be swapped on a sent post (409)', (await A(`/api/admin/channel/posts/${id1}`, { media: { kind: 'photo', url: 'https://x.io/a.png' } })).status === 409)
  const p2 = await A('/api/admin/channel/posts', { text: 'Pic <i>caption</i>', media: { kind: 'photo', url: 'https://gullylabs.xyz/social/og-image-1200x630.png' }, action: 'post' })
  check('post with a photo: sendPhoto with a caption', p2.status === 201 && last('sendPhoto')?.photo === 'https://gullylabs.xyz/social/og-image-1200x630.png' && last('sendPhoto').caption === 'Pic <i>caption</i>')
  await A(`/api/admin/channel/posts/${p2.data.post.id}`, { text: 'New caption' })
  check('edit a media post: editMessageCaption', last('editMessageCaption')?.caption === 'New caption')
  const p3 = await A('/api/admin/channel/posts', { text: 'Banner!', media: { kind: 'animation', banner: true }, action: 'post' })
  const an = last('sendAnimation')
  check('the Gully banner: uploaded (or by URL) the first time', p3.status === 201 && (an?.multipart === true || /banner\.mp4$/.test(an?.animation ?? '')) && (an?.multipart !== true || (an.animation?.type === 'video/mp4' && an.animation?.name === 'gully-labs.mp4')))
  await A('/api/admin/channel/posts', { text: 'Banner again', media: { kind: 'animation', banner: true }, action: 'post' })
  check('the Gully banner: the cached file_id is reused next time', last('sendAnimation')?.animation === 'BANNER_FILE_1', JSON.stringify(last('sendAnimation')))
  const d1 = await A(`/api/admin/channel/posts/${id1}/delete`, {})
  check('delete: deleteMessage on the channel, status deleted', d1.status === 200 && last('deleteMessage')?.message_id === p1.data.post.messageId && d1.data.post.status === 'deleted')
  check('history records every action', (await findPost(id1)).history.map((h) => h.action).join() === 'create,post,pin,edit,edit,unpin,delete', (await findPost(id1)).history.map((h) => h.action).join())

  /* ---------------------------------------------------------- failure and retry --- */
  failNext.set('sendMessage', 'Bad Request: chat not found')
  const f1 = await A('/api/admin/channel/posts', { text: 'Will fail first', action: 'post' })
  check('failure: Telegram refusing gives 502 and a failed post with the error', f1.status === 502 && f1.data.post.status === 'failed' && /chat not found/.test(f1.data.post.error))
  const r1 = await A(`/api/admin/channel/posts/${f1.data.post.id}/retry`, {})
  check('retry: the failed post goes out', r1.status === 200 && r1.data.post.status === 'sent' && r1.data.post.error === null)
  check('retry: a sent post cannot be posted twice (409)', (await A(`/api/admin/channel/posts/${f1.data.post.id}/retry`, {})).status === 409)

  /* ----------------------------------------------------- schedule + restart --- */
  const soon = new Date(Date.now() + 120_000).toISOString()
  const s1 = await A('/api/admin/channel/posts', { text: 'Scheduled hello', action: 'schedule', scheduledAt: soon })
  check('schedule: stored as scheduled, nothing sent', s1.status === 201 && s1.data.post.status === 'scheduled' && !chCalls('sendMessage').some((c) => c.body.text === 'Scheduled hello'))
  check('schedule: a time in the past is refused', (await A('/api/admin/channel/posts', { text: 'x', action: 'schedule', scheduledAt: '2020-01-01T00:00:00Z' })).status === 400)
  await ch.tickChannel()
  check('schedule: not due yet, not sent', !chCalls('sendMessage').some((c) => c.body.text === 'Scheduled hello'))
  const old = await A('/api/admin/channel/posts', { text: 'Very late', action: 'schedule', scheduledAt: new Date(Date.now() + 60_000).toISOString() })
  // Restart: the store is read again from disk, with the clock moved on.
  ch.reloadChannelForTest()
  const t0 = Date.now()
  ch.setNowForTest(() => t0 + 150_000)
  await ch.tickChannel()
  const sp = await findPost(s1.data.post.id)
  check('restart: the scheduled post survived and went out when due', sp.status === 'sent' && chCalls('sendMessage').some((c) => c.body.text === 'Scheduled hello') && sp.history.some((h) => h.by === 'scheduler'))
  ch.setNowForTest(null)
  // A post more than 6 h overdue (server down) is marked missed instead of going out late.
  const late = await A('/api/admin/channel/posts', { text: 'Missed one', action: 'schedule', scheduledAt: new Date(Date.now() + 60_000).toISOString() })
  ch.setNowForTest(() => Date.now() + 7 * 3_600_000)
  await ch.tickChannel()
  ch.setNowForTest(null)
  const lp = await findPost(late.data.post.id)
  check('a post more than 6 h overdue is failed as missed, not sent', lp.status === 'failed' && /Missed/.test(lp.error) && !chCalls('sendMessage').some((c) => c.body.text === 'Missed one'))
  check('the other overdue one (within 6 h of the restart) was sent', (await findPost(old.data.post.id)).status !== 'scheduled')
  const un = await A('/api/admin/channel/posts', { text: 'Unschedule me', action: 'schedule', scheduledAt: new Date(Date.now() + 3_600_000).toISOString() })
  check('unschedule: back to draft', (await A(`/api/admin/channel/posts/${un.data.post.id}/unschedule`, {})).data.post.status === 'draft')

  /* --------------------------------------------------------------- auto posts --- */
  const auto0 = (await A('/api/admin/channel/auto')).data.auto
  check('auto posts: every type is off by default', ['launches', 'dailyGaps', 'weeklyMovers', 'blog', 'releases'].every((k) => auto0[k].enabled === false))
  const autoPosts = async (type) => (await A('/api/admin/channel')).data.posts.filter((p) => p.createdBy === `auto:${type}`)
  // A free clock: Saturday 17 Oct 2026, UTC.
  const at = (hhmm, day = 17) => Date.parse(`2026-10-${day}T${hhmm}:00Z`)
  let clock = at('09:00')
  ch.setNowForTest(() => clock)
  await A('/api/admin/channel/auto', { timezone: 'UTC', minGapMinutes: 0, quietHours: { enabled: false } })

  // DeepCore launches: off by default.
  await dc.pollLaunchesNow() // the baseline: what exists is never announced
  dcItems.push(dcItem(2))
  await dc.pollLaunchesNow()
  await ch.tickChannel()
  check('launches: off, a new launch posts nothing', (await autoPosts('launches')).length === 0)
  check('auto: bad settings refused', (await A('/api/admin/channel/auto', { timezone: 'Mars/Base', minGapMinutes: -1 })).status === 400)
  await A('/api/admin/channel/auto', { launches: { enabled: true } })
  dcItems.push(dcItem(3))
  await dc.pollLaunchesNow()
  await ch.tickChannel()
  let lp1 = await autoPosts('launches')
  check('launches: on, the new launch is posted once with a DeepCore button', lp1.length === 1 && /T3/.test(lp1[0].text) && /Base/.test(lp1[0].text) && lp1[0].buttons[0].url.startsWith('https://deepcore.fun/tokens/') && lp1[0].status === 'sent', JSON.stringify(lp1[0]?.text))
  await dc.pollLaunchesNow()
  await ch.tickChannel()
  check('launches: no duplicate on the next poll', (await autoPosts('launches')).length === 1)
  // Quiet hours hold the next one; it goes out when they end.
  await A('/api/admin/channel/auto', { quietHours: { enabled: true, start: '23:00', end: '01:00' } })
  clock = at('23:30')
  dcItems.push(dcItem(4))
  await dc.pollLaunchesNow()
  await ch.tickChannel()
  check('quiet hours: nothing posted at 23:30', (await autoPosts('launches')).length === 1 && (await A('/api/admin/channel/auto')).data.auto.blocked === 'quiet')
  clock = at('01:05', 18)
  await ch.tickChannel()
  check('quiet hours over: the held launch goes out', (await autoPosts('launches')).length === 2)
  // Minimum gap.
  await A('/api/admin/channel/auto', { minGapMinutes: 60 })
  dcItems.push(dcItem(5))
  await dc.pollLaunchesNow()
  clock = at('01:30', 18)
  await ch.tickChannel()
  check('min gap: a launch 25 min after the last post waits', (await autoPosts('launches')).length === 2 && (await A('/api/admin/channel/auto')).data.auto.blocked === 'gap')
  clock = at('02:10', 18)
  await ch.tickChannel()
  check('min gap passed: it goes out', (await autoPosts('launches')).length === 3)
  await A('/api/admin/channel/auto', { minGapMinutes: 0, quietHours: { enabled: false }, launches: { enabled: false } })

  // Blog: off by default; on: the first poll only records what exists; a new post is announced once.
  process.env.GHOST_CONTENT_KEY = GHOST_KEY
  ghostPosts.push({ id: 'g2', title: 'Before switching on', url: 'https://blog.gullylabs.xyz/before/', excerpt: 'x', published_at: '2026-10-02T00:00:00Z' })
  const hits0 = ghostHits
  await ch.checkSources()
  check('blog: off, Ghost is not even polled', ghostHits === hits0)
  await A('/api/admin/channel/auto', { blog: { enabled: true } })
  await ch.checkSources()
  await ch.tickChannel()
  check('blog: on, existing posts are not announced (no backlog)', (await autoPosts('blog')).length === 0 && ghostHits > hits0)
  ghostPosts.push({ id: 'g3', title: 'Gully <AI> & you', url: 'https://blog.gullylabs.xyz/gully-ai/', excerpt: 'What Gully AI does.', published_at: '2026-10-17T00:00:00Z' })
  await ch.checkSources()
  await ch.tickChannel()
  const bp = await autoPosts('blog')
  check('blog: the new post is announced with title (escaped), excerpt and link', bp.length === 1 && bp[0].text.includes('Gully &lt;AI&gt; &amp; you') && bp[0].text.includes('What Gully AI does.') && bp[0].buttons[0].url === 'https://blog.gullylabs.xyz/gully-ai/', bp[0]?.text)
  await ch.checkSources()
  await ch.tickChannel()
  check('blog: no duplicate on the next poll', (await autoPosts('blog')).length === 1)
  await A('/api/admin/channel/auto', { blog: { enabled: false } })

  // Product releases (changelog).
  await ch.checkSources()
  changelog.push({ key: 'https://docs.gullylabs.xyz/changelog#2026-10-17', date: '17 October 2026', url: 'https://docs.gullylabs.xyz/changelog#2026-10-17', text: 'Telegram channel posts from the admin dashboard.' })
  await ch.checkSources()
  await ch.tickChannel()
  check('releases: off, nothing posted', (await autoPosts('releases')).length === 0)
  await A('/api/admin/channel/auto', { releases: { enabled: true } })
  await ch.checkSources()
  await ch.tickChannel()
  check('releases: on, what exists is not announced', (await autoPosts('releases')).length === 0)
  changelog.push({ key: 'https://docs.gullylabs.xyz/changelog#2026-10-18', date: '18 October 2026', url: 'https://docs.gullylabs.xyz/changelog#2026-10-18', text: 'Weekly movers recap.' })
  await ch.checkSources()
  await ch.tickChannel()
  const rp = await autoPosts('releases')
  check('releases: a new changelog entry is announced once', rp.length === 1 && rp[0].text.includes('18 October 2026') && rp[0].text.includes('Weekly movers recap.'))
  await ch.checkSources()
  await ch.tickChannel()
  check('releases: no duplicate', (await autoPosts('releases')).length === 1)
  await A('/api/admin/channel/auto', { releases: { enabled: false } })

  // Daily widest gaps at a set time.
  clock = at('13:00', 19)
  await ch.tickChannel()
  check('daily gaps: off, nothing at any time', (await autoPosts('dailyGaps')).length === 0)
  await A('/api/admin/channel/auto', { dailyGaps: { enabled: true, time: '14:00' } })
  await ch.tickChannel()
  check('daily gaps: on, nothing before 14:00', (await autoPosts('dailyGaps')).length === 0)
  clock = at('14:01', 19)
  await ch.tickChannel()
  const dg = await autoPosts('dailyGaps')
  check('daily gaps: posted at 14:00 with the top 5 trusted gaps and the tracker link', dg.length === 1 && /AMD/.test(dg[0].text) && /NVDA/.test(dg[0].text) && !/AMZN/.test(dg[0].text) && !/GOOGL/.test(dg[0].text) && (dg[0].text.match(/^\d\. /gm) ?? []).length === 5 && dg[0].buttons[0].url === 'https://gullylabs.xyz/tracker', dg[0]?.text)
  clock = at('15:00', 19)
  await ch.tickChannel()
  check('daily gaps: once a day', (await autoPosts('dailyGaps')).length === 1)
  await A('/api/admin/channel/auto', { quietHours: { enabled: true, start: '13:00', end: '16:00' } })
  clock = at('14:05', 20)
  await ch.tickChannel()
  check('daily gaps: held during quiet hours', (await autoPosts('dailyGaps')).length === 1)
  clock = at('16:05', 20)
  await ch.tickChannel()
  check('daily gaps: posted when quiet hours end (within 3 h of its time)', (await autoPosts('dailyGaps')).length === 2)
  await A('/api/admin/channel/auto', { quietHours: { enabled: false }, dailyGaps: { enabled: false } })

  // Weekly movers on Friday 21:00 (default).
  clock = at('21:10', 23) // Friday 23 Oct
  await ch.tickChannel()
  check('weekly movers: off, nothing', (await autoPosts('weeklyMovers')).length === 0)
  await A('/api/admin/channel/auto', { weeklyMovers: { enabled: true } })
  clock = at('21:10', 22) // Thursday
  await ch.tickChannel()
  check('weekly movers: not on another day', (await autoPosts('weeklyMovers')).length === 0)
  clock = at('21:10', 23)
  await ch.tickChannel()
  const wm = await autoPosts('weeklyMovers')
  check('weekly movers: posted Friday with the 7-day changes', wm.length === 1 && /NVDA/.test(wm[0].text) && /\+10\.00%/.test(wm[0].text) && /TSLA/.test(wm[0].text), wm[0]?.text)
  clock = at('22:00', 23)
  await ch.tickChannel()
  check('weekly movers: once a week', (await autoPosts('weeklyMovers')).length === 1)
  await A('/api/admin/channel/auto', { weeklyMovers: { enabled: false } })
  ch.setNowForTest(null)

  // Previews render without sending.
  const sends0 = calls.filter((c) => /^send/.test(c.method)).length
  const pv = {}
  for (const k of ['launches', 'dailyGaps', 'weeklyMovers', 'blog', 'releases']) pv[k] = (await A(`/api/admin/channel/auto/${k}/preview`, {})).data
  check('preview: every type renders a post', Object.values(pv).every((x) => x.preview && x.preview.text.length > 10 && x.preview.errors.length === 0), JSON.stringify(Object.fromEntries(Object.entries(pv).map(([k, v]) => [k, v.skip ?? v.preview?.errors]))))
  check('preview: nothing was sent', calls.filter((c) => /^send/.test(c.method)).length === sends0)
  rowsOk = false
  check('preview: an unreadable tracker says so (no post)', (await A('/api/admin/channel/auto/dailyGaps/preview', {})).data.skip === 'The tracker could not be read.')
  rowsOk = true
  const tpl = await A('/api/admin/channel/auto', { blog: { template: '<b>{title}</b> <marquee>{link}</marquee>' } })
  const pvb = (await A('/api/admin/channel/auto/blog/preview', {})).data.preview
  check('auto templates go through the sanitizer', tpl.status === 200 && !/marquee/.test(pvb.text) && pvb.text.startsWith('<b>'), pvb.text)

  /* -------------------------------------------------------------- followers --- */
  const fo = await A('/api/admin/channel/followers')
  check('followers: the live count from getChatMemberCount', fo.status === 200 && fo.data.count === 1234 && calls.some((c) => c.method === 'getChatMemberCount' && c.body.chat_id === CHANNEL))
  const n0 = fo.data.series.length
  check('followers: samples are one per day', new Set(fo.data.series.map((x) => x.day)).size === n0 && n0 >= 1)
  members = 1300
  ch.setNowForTest(() => Date.parse('2026-11-02T12:00:00Z'))
  await ch.tickChannel()
  const fo2 = await A('/api/admin/channel/followers?fresh=1')
  check('followers: a new day stores one new sample', fo2.data.series.length === n0 + 1 && fo2.data.series.at(-1).count === 1300 && fo2.data.count === 1300)
  await ch.tickChannel()
  check('followers: not sampled twice the same day', (await A('/api/admin/channel/followers')).data.series.length === n0 + 1)
  ch.setNowForTest(null)

  /* --------------------------------------------------------------- AI draft --- */
  const dOff = await A('/api/admin/ask/draft', { kind: 'telegram_post', topic: 'Telegram alerts' })
  check('AI draft: telegram_post is a known kind (503 without a key, not 400)', dOff.status === 503, JSON.stringify(dOff.data))
  process.env.ANTHROPIC_API_KEY = 'sk-test-' + 'x'.repeat(20)
  const sendsBefore = calls.filter((c) => /^send/.test(c.method)).length
  const d = await A('/api/admin/ask/draft', { kind: 'telegram_post', topic: 'Telegram gap alerts' })
  const req = claudeCalls.at(-1)
  check('AI draft: returns editable Telegram HTML', d.status === 200 && d.data.markdown.startsWith('<b>Gap alerts on Telegram</b>') && d.data.kinds.includes('telegram_post'), JSON.stringify(d.data).slice(0, 200))
  check('AI draft: the prompt asks for ≤ 900 characters, the HTML subset, one CTA, no advice', /900 characters/.test(JSON.stringify(req)) && /Telegram HTML/.test(JSON.stringify(req)) && /call to action/.test(JSON.stringify(req)) && /No investment advice/.test(JSON.stringify(req)))
  check('AI draft: never posts by itself', calls.filter((c) => /^send/.test(c.method)).length === sendsBefore)
  check('AI draft: an unknown kind is still refused', (await A('/api/admin/ask/draft', { kind: 'tiktok', topic: 'x' })).status === 400)
  delete process.env.ANTHROPIC_API_KEY

  /* ---------------------------------------------------------------- sweeps --- */
  check('every channel call went to the configured channel or the linked test chat', calls.filter((c) => c.body.chat_id !== undefined).every((c) => [CHANNEL, '4242'].includes(String(c.body.chat_id))))
  check('every keyboard sent has https URL buttons only', calls.filter((c) => c.body.reply_markup?.inline_keyboard && c.body.chat_id === CHANNEL).every((c) => c.body.reply_markup.inline_keyboard.flat().every((b) => /^https:\/\//.test(b.url))))
  const store = JSON.parse(fs.readFileSync(path.join(tmp, 'channel-posts.json'), 'utf8'))
  check('stored atomically in channel-posts.json (no leftover .tmp)', Array.isArray(store.posts) && !fs.existsSync(path.join(tmp, 'channel-posts.json.tmp')))
  check('the token is not in the stored data', !fs.readFileSync(path.join(tmp, 'channel-posts.json'), 'utf8').includes(TOKEN.split(':')[1]))
} catch (e) {
  check(`no exception (${e?.stack ?? e})`, false)
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(t.failed ? 1 : 0)
