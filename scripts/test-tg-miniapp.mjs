// Test of the Telegram Mini App's server side (server/telegram-miniapp.mjs): initData validation per
// Telegram's docs, the /api/tg/* routes (auth, the News channel gate, the linked account's alerts with a
// direction), and the /tg page's headers (CSP allows the SDK and Telegram Web's frame; noindex).
//
//   node scripts/test-tg-miniapp.mjs        (no build needed)
//
// The real server runs IN THIS PROCESS on port 8796 (TEST_PORT overrides) with a fresh temporary DATA_DIR,
// the tracker loop off and TELEGRAM_API pointing at a local Bot API stub (getMe, getChatMember, sendMessage).
// The bot token is a made-up one; a Telegram chat is linked to a throwaway wallet address in the seeded
// telegram.json, as the bot's /start <code> would leave it.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { makeChecker, guardTestRun } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8796
await guardTestRun(PORT)
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-tg-miniapp-'))
const BOT_ID = 7000000002
const TOKEN = `${BOT_ID}:${crypto.randomBytes(24).toString('base64url')}`
const LINKED_USER = 5001 // private chat linked to WALLET
const GROUP_USER = 5002 // linked a group, no private chat
const STRANGER = 5003 // follows the channel, nothing linked
const OUTSIDER = 5004 // does not follow the channel
const WALLET = '0x' + crypto.randomBytes(20).toString('hex')
const WALLET2 = '0x' + crypto.randomBytes(20).toString('hex')

const t = makeChecker()
const { check } = t

/* ---------------------------------------------------------- Bot API stub --- */

const calls = []
const stub = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    const m = req.url.match(/^\/bot([^/]+)\/(\w+)$/)
    const send = (j) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(j))
    }
    if (!m || m[1] !== TOKEN) return send({ ok: false, description: 'Unauthorized' })
    const body = raw ? JSON.parse(raw) : {}
    calls.push({ method: m[2], body })
    if (m[2] === 'getMe') return send({ ok: true, result: { id: BOT_ID, is_bot: true, username: 'GullyMiniTestBot' } })
    if (m[2] === 'getChatMember') return send({ ok: true, result: { status: Number(body.user_id) === OUTSIDER ? 'left' : 'member', user: { id: Number(body.user_id) } } })
    if (m[2] === 'sendMessage') return send({ ok: true, result: { message_id: calls.length, chat: { id: Number(body.chat_id) }, text: body.text } })
    return send({ ok: true, result: true })
  })
})
await new Promise((r) => stub.listen(0, '127.0.0.1', r))

/* ---------------------------------------------------------- start server --- */

const now = new Date().toISOString()
fs.writeFileSync(
  path.join(tmp, 'telegram.json'),
  JSON.stringify({
    links: [
      { address: WALLET, chatId: String(LINKED_USER), chatType: 'private', chatTitle: 'Ada (@ada)', linkedBy: String(LINKED_USER), linkedAt: now },
      { address: WALLET2, chatId: '-100777', chatType: 'supergroup', chatTitle: 'Desk', linkedBy: String(GROUP_USER), linkedAt: now },
    ],
    codes: [],
    banner: null,
  }),
)
// One alert stored before directions existed: it must read back as 'both' (migration on read).
fs.writeFileSync(path.join(tmp, 'alerts.json'), JSON.stringify({ alerts: [{ id: 'legacyAlert1', owner: WALLET2, name: 'old', chain: 'robinhood', ticker: 'NVDA', condition: { type: 'gap', pct: 2 }, webhook: null, telegram: { linked: true }, enabled: true, createdAt: now, lastFiredAt: null, disarmed: {}, deliveries: [] }] }))

Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: path.join(tmp, 'no-dist'),
  ADMIN_TOKEN: crypto.randomBytes(24).toString('hex'),
  TRACKER_LOOP: 'off',
  DEEPCORE_LOOP: 'off',
  TRACKER_SKIP_APIS: '1',
  ASK_REMOTE: 'off',
  TELEGRAM_BOT_TOKEN: TOKEN,
  TELEGRAM_API: `http://127.0.0.1:${stub.address().port}`,
})
for (const k of ['TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_REQUIRED_CHANNEL', 'TELEGRAM_MINIAPP_URL', 'ANTHROPIC_API_KEY', 'GULLY_TREASURY_ADDRESS']) delete process.env[k]
fs.mkdirSync(path.join(tmp, 'no-dist'), { recursive: true })
fs.writeFileSync(path.join(tmp, 'no-dist', 'index.html'), '<!doctype html><html><head><title>x</title><meta name="robots" content="index"></head><body><div id="root"></div></body></html>')
await import('../server/server.mjs')
const mini = await import('../server/telegram-miniapp.mjs')
const { alertsOf, evaluateAlerts } = await import('../server/alerts.mjs')
await new Promise((r) => setTimeout(r, 300))

/* --------------------------------------------------------------- helpers --- */

/** initData as Telegram builds it: URL-encoded fields plus hash = HMAC(HMAC("WebAppData", token), check string). */
function initData({ user = { id: LINKED_USER, first_name: 'Ada', username: 'ada', language_code: 'en' }, authDate = Math.floor(Date.now() / 1000), token = TOKEN, extra = {} } = {}) {
  const fields = { query_id: 'AAHdF6IQAAAAAN0XohDhrOrc', auth_date: String(authDate), ...(user ? { user: JSON.stringify(user) } : {}), ...extra }
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest()
  const hash = crypto.createHmac('sha256', secret).update(check).digest('hex')
  return new URLSearchParams({ ...fields, hash }).toString()
}
const call = async (p, { data = initData(), method = 'GET', body } = {}) => {
  const r = await fetch(BASE + p, { method, headers: { ...(data === null ? {} : { authorization: `tma ${data}` }), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => null), headers: r.headers }
}

try {
  /* ------------------------------------------------- initData validation --- */
  const good = mini.validateInitData(initData(), TOKEN)
  check('valid initData: accepted, with the user', good.ok === true && good.user.id === String(LINKED_USER) && good.user.firstName === 'Ada' && good.user.username === 'ada', JSON.stringify(good))
  check('valid initData: a start_param and the newer signature field are covered by the hash', mini.validateInitData(initData({ extra: { start_param: 'nvda', signature: 'c2lnbmF0dXJl' } }), TOKEN).ok)

  const tampered = new URLSearchParams(initData())
  tampered.set('user', JSON.stringify({ id: 999, first_name: 'Mallory' }))
  const tam = mini.validateInitData(tampered.toString(), TOKEN)
  check('tampered data (user swapped, hash kept): refused', tam.ok === false && /signature does not match/.test(tam.error), JSON.stringify(tam))
  const flipped = new URLSearchParams(initData())
  const h = flipped.get('hash')
  flipped.set('hash', (h[0] === 'a' ? 'b' : 'a') + h.slice(1))
  check('tampered hash: refused', mini.validateInitData(flipped.toString(), TOKEN).ok === false)
  check('another bot’s token: refused', mini.validateInitData(initData({ token: `${BOT_ID}:${'x'.repeat(30)}` }), TOKEN).ok === false)
  check('no hash at all: refused', mini.validateInitData('auth_date=1&user=%7B%22id%22%3A1%7D', TOKEN).ok === false)

  const old = mini.validateInitData(initData({ authDate: Math.floor(Date.now() / 1000) - 24 * 3600 - 60 }), TOKEN)
  check('expired (auth_date over 24 h old): refused', old.ok === false && /expired/.test(old.error), JSON.stringify(old))
  check('23 h old: still accepted', mini.validateInitData(initData({ authDate: Math.floor(Date.now() / 1000) - 23 * 3600 }), TOKEN).ok)
  check('dated in the future: refused', mini.validateInitData(initData({ authDate: Math.floor(Date.now() / 1000) + 3600 }), TOKEN).ok === false)

  const noUser = mini.validateInitData(initData({ user: null }), TOKEN)
  check('missing user (validly signed): refused', noUser.ok === false && /no user/.test(noUser.error), JSON.stringify(noUser))
  check('a user without an id: refused', mini.validateInitData(initData({ user: { first_name: 'X' } }), TOKEN).ok === false)
  check('no token configured: refused', mini.validateInitData(initData(), null).ok === false)
  check('empty initData: refused', mini.validateInitData('', TOKEN).ok === false)

  /* ---------------------------------------------------------- API auth --- */
  check('API: no Authorization is 401', (await call('/api/tg/me', { data: null })).status === 401)
  check('API: tampered initData is 401', (await call('/api/tg/me', { data: tampered.toString() })).status === 401)
  check('API: expired initData is 401', (await call('/api/tg/me', { data: initData({ authDate: Math.floor(Date.now() / 1000) - 25 * 3600 }) })).status === 401)
  check('API: initData without a user is 401', (await call('/api/tg/me', { data: initData({ user: null }) })).status === 401)

  const me = await call('/api/tg/me')
  check('me: the linked private chat maps the user to the wallet', me.status === 200 && me.data.user.id === String(LINKED_USER) && me.data.linked?.chatType === 'private' && me.data.linked.account === `${WALLET.slice(0, 6)}…${WALLET.slice(-4)}`, JSON.stringify(me.data))
  check('me: the gate says the user follows @GullyLabsNews', me.data.gate.required === true && me.data.gate.follows === true && me.data.gate.channel === '@GullyLabsNews' && me.data.gate.url === 'https://t.me/GullyLabsNews')
  check('me: never returns the full wallet address or the token', !JSON.stringify(me.data).includes(WALLET.slice(2)) && !JSON.stringify(me.data).includes(TOKEN.split(':')[1]))
  const meGroup = await call('/api/tg/me', { data: initData({ user: { id: GROUP_USER, first_name: 'Gil' } }) })
  check('me: a user who linked a group maps to that group’s account', meGroup.data.linked?.chatType === 'supergroup' && meGroup.data.linked.chatTitle === 'Desk')
  const meStranger = await call('/api/tg/me', { data: initData({ user: { id: STRANGER, first_name: 'Sam' } }) })
  check('me: an unlinked user has linked: null', meStranger.status === 200 && meStranger.data.linked === null)

  /* ------------------------------------------------------------ the gate --- */
  const outsider = initData({ user: { id: OUTSIDER, first_name: 'Olu' } })
  const meOut = await call('/api/tg/me', { data: outsider })
  check('gate: a non-follower gets follows: false from /me (the app shows the join screen)', meOut.status === 200 && meOut.data.gate.follows === false)
  const gated = await call('/api/tg/sparks', { data: outsider })
  check('gate: every other route is 403 with the gate', gated.status === 403 && gated.data.gate?.url === 'https://t.me/GullyLabsNews')
  check('gate: alerts are gated too', (await call('/api/tg/alerts', { data: outsider })).status === 403)
  check('gate: membership was read with getChatMember on the channel', calls.some((c) => c.method === 'getChatMember' && c.body.chat_id === '@GullyLabsNews' && c.body.user_id === OUTSIDER))

  /* ------------------------------------------------------------ the reads --- */
  const sp = await call('/api/tg/sparks')
  check('sparks: answers an object of series', sp.status === 200 && typeof sp.data.sparks === 'object')
  const ln = await call('/api/tg/launches')
  check('launches: answers with a state (unreadable here: DeepCore is not reachable in tests)', ln.status === 200 && ['ok', 'stale', 'unreadable'].includes(ln.data.state) && Array.isArray(ln.data.launches) && ln.data.chainNames?.['56'] === 'BNB Chain')
  check('launches: an unknown chain is 400', (await call('/api/tg/launches?chain=12345')).status === 400)

  /* --------------------------------------------------- alerts, directions --- */
  const strangerAlerts = await call('/api/tg/alerts', { data: initData({ user: { id: STRANGER, first_name: 'Sam' } }) })
  check('alerts: an unlinked user is told to link (409)', strangerAlerts.status === 409 && strangerAlerts.data.linkNeeded === true)
  const legacy = (await alertsOf(WALLET2)).alerts.find((a) => a.id === 'legacyAlert1')
  check('migration on read: a stored gap alert without a direction reads as both', legacy?.condition.direction === 'both', JSON.stringify(legacy?.condition))
  const groupList = await call('/api/tg/alerts', { data: initData({ user: { id: GROUP_USER, first_name: 'Gil' } }) })
  check('alerts: the group linker sees the group account’s alerts', groupList.status === 200 && groupList.data.alerts.some((a) => a.id === 'legacyAlert1'))

  const bad = await call('/api/tg/alerts', { method: 'POST', body: { chain: 'robinhood', ticker: 'NVDA', pct: 2, direction: 'sideways' } })
  check('create: an unknown direction is 400', bad.status === 400 && /direction/.test(bad.data.error), JSON.stringify(bad.data))
  const made = await call('/api/tg/alerts', { method: 'POST', body: { chain: 'robinhood', ticker: 'NVDA', pct: 2, direction: 'below' } })
  check('create: a ▼ discount alert is created for the linked wallet, delivered to Telegram', made.status === 201 && made.data.alert.condition.type === 'gap' && made.data.alert.condition.direction === 'below' && made.data.alert.telegram?.linked === true, JSON.stringify(made.data))
  const id = made.data?.alert?.id
  const second = await call('/api/tg/alerts', { method: 'POST', body: { chain: 'robinhood', ticker: 'TSLA', pct: 2, direction: 'above' } })
  check('create: the plan limit applies (Free: one alert)', second.status === 403)
  const list = await call('/api/tg/alerts')
  check('alerts: the list is the wallet’s own', list.status === 200 && list.data.alerts.length === 1 && list.data.alerts[0].id === id && list.data.limits.max === 1)

  const row = (o) => ({ chain: 'robinhood', ticker: 'NVDA', name: 'NVIDIA', status: 'premium', gapPct: 3.1, fair: 180, onchain: 185.58, poolStale: false, sessionOpen: true, feedUpdatedAt: new Date().toISOString(), pool: { liquidityUsd: 50_000 }, ...o })
  const sends = () => calls.filter((c) => c.method === 'sendMessage' && String(c.body.chat_id) === String(LINKED_USER))
  let at = Date.now()
  await evaluateAlerts([row({ gapPct: 3.1, status: 'premium' })], at)
  check('below: a +3.1% premium does not fire a discount alert', sends().length === 0)
  await evaluateAlerts([row({ gapPct: -1.5, status: 'discount' })], (at += 60_000))
  check('below: a −1.5% discount is short of −2%', sends().length === 0)
  await evaluateAlerts([row({ gapPct: -2.4, status: 'discount' })], (at += 60_000))
  check('below: a −2.4% discount fires', sends().length === 1)
  check('the Telegram message states the condition in plain words', /Alert: ▼ 2% or more below the real share price/.test(sends()[0]?.body.text ?? '') && /NVDA token is <b>2\.40% below<\/b> the real share price\./.test(sends()[0]?.body.text ?? ''), sends()[0]?.body.text)

  const paused = await call(`/api/tg/alerts/${id}/pause`, { method: 'POST' })
  check('pause from the app', paused.status === 200 && paused.data.alert.enabled === false)
  const resumed = await call(`/api/tg/alerts/${id}/resume`, { method: 'POST' })
  check('resume from the app', resumed.status === 200 && resumed.data.alert.enabled === true)
  const tested = await call(`/api/tg/alerts/${id}/test`, { method: 'POST' })
  check('test from the app reaches the linked chat, with the condition', tested.status === 200 && /🧪.*\n?Test message \(Alert: ▼ 2% or more below the real share price\)/s.test(sends().at(-1)?.body.text ?? ''), sends().at(-1)?.body.text)
  check('another account’s alert is 404 from the app', (await call('/api/tg/alerts/legacyAlert1/delete', { method: 'POST' })).status === 404)
  const del = await call(`/api/tg/alerts/${id}/delete`, { method: 'POST' })
  check('delete from the app', del.status === 200 && (await call('/api/tg/alerts')).data.alerts.length === 0)

  /* ------------------------------------------------------- /tg page headers --- */
  const page = await fetch(BASE + '/tg')
  const csp = page.headers.get('content-security-policy') ?? ''
  const html = await page.text()
  check('/tg is a page (200) and noindex', page.status === 200 && /noindex/.test(html))
  check('/tg CSP allows the Telegram WebApp SDK script', /script-src [^;]*https:\/\/telegram\.org\/js\/telegram-web-app\.js/.test(csp), csp)
  check('/tg may be framed by Telegram Web (frame-ancestors), without X-Frame-Options', /frame-ancestors 'self' https:\/\/web\.telegram\.org/.test(csp) && !page.headers.get('x-frame-options'))
  const home = await fetch(BASE + '/')
  const homeCsp = home.headers.get('content-security-policy') ?? ''
  check('other pages do not allow telegram.org scripts and stay SAMEORIGIN', !/telegram\.org/.test(homeCsp) && home.headers.get('x-frame-options') === 'SAMEORIGIN')

  /* ------------------------------------------------------- plain words --- */
  // The app's own screens (src/pages/tg) are written for everyone: no source names, feeds, pools, "fair price",
  // "on chain" or UTC times in any string literal or JSX text. Code (imports, API paths, field names) is not text.
  const JARGON = /api\.deepcore|\bAPI\b|\bRPC\b|\bUTC\b|Chainlink|\bfeeds?\b|endpoint|indexer|\bpools?\b|fair price|\b[Ff]air\b|[Oo]n[- ]chain|unreadable|could not be read|re-arm/
  const tgSrc = ['screens.tsx', 'TgApp.tsx'].map((f) => fs.readFileSync(new URL(`../src/pages/tg/${f}`, import.meta.url), 'utf8')).join('\n')
  const literals = [...tgSrc.matchAll(/'((?:[^'\\\n]|\\.){2,})'|"((?:[^"\\\n]|\\.){2,})"|`((?:[^`\\\n]|\\.){2,})`/g)].map((m) => m[1] ?? m[2] ?? m[3])
  const jsxText = [...tgSrc.matchAll(/>([^<>{}\n]*[A-Za-z][^<>{}\n]*)</g)].map((m) => m[1].trim()).filter((x) => /\s/.test(x))
  const spoken = [...literals, ...jsxText].filter((x) => /\s[a-z]/.test(x) && !/^\/|^https?:|^[\w-]+(\s[\w[\]:()./%#-]+)*$/.test(x) || /\s(the|a|an|is|not|your|to)\s/.test(x))
  const jargonHits = spoken.filter((x) => JARGON.test(x))
  check(`plain words: the Mini App's texts never say "API", "feed", "pool", "fair price", "on chain" or "UTC" (${spoken.length} texts)`, spoken.length > 20 && jargonHits.length === 0, jargonHits.slice(0, 3).join(' | '))

  /* --------------------------------------------------------- no secrets --- */
  check('the token is not in any stored file', !fs.readdirSync(tmp).filter((f) => f.endsWith('.json')).some((f) => fs.readFileSync(path.join(tmp, f), 'utf8').includes(TOKEN.split(':')[1])))
} catch (e) {
  check(`no exception (${e?.stack ?? e})`, false)
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(t.failed ? 1 : 0)
