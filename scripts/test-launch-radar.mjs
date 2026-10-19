// Test of the daily Launch radar (server/launch-radar.mjs): the draft built from launch fixtures, the wording
// rules (measured facts only, no accusatory words, the "signals, not verdicts" note), draft-only by default,
// the TELEGRAM_RADAR_AUTOPOST flag, and the admin route POST /api/admin/channel/radar.
//
//   node scripts/test-launch-radar.mjs        (no build needed)
//
// The real server runs IN THIS PROCESS on port 8812 (TEST_PORT overrides) with a fresh temporary DATA_DIR.
// Nothing real is called: TELEGRAM_API points at a local Bot API stub that records every call, the launch feed
// and the cached maps are fixtures, and the clock is fixed. The token and the channel are made up.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { guardTestRun, makeChecker, makeClient } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8812
await guardTestRun(PORT)
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-radar-'))
const TOKEN = `7000000003:${crypto.randomBytes(24).toString('base64url')}`
const CHANNEL = '@GullyTestNews'
const ADMIN = crypto.randomBytes(24).toString('hex')
const t = makeChecker()
const { check } = t

/* -------------------------------------------------------------- Bot API stub --- */

const calls = []
let nextMsgId = 900
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
    calls.push({ method: m[2], body })
    if (m[2] === 'getMe') return send(200, { ok: true, result: { id: 7000000003, is_bot: true, username: 'GullyTestBot' } })
    if (['sendMessage', 'sendPhoto', 'sendAnimation'].includes(m[2])) {
      const result = { message_id: nextMsgId++, chat: { id: -1001, username: CHANNEL.slice(1) } }
      if (m[2] === 'sendAnimation') result.animation = { file_id: 'BANNER_FILE_1' }
      return send(200, { ok: true, result })
    }
    return send(200, { ok: true, result: true })
  })
})
await new Promise((r) => stub.listen(0, '127.0.0.1', r))
const posted = () => calls.filter((c) => ['sendMessage', 'sendPhoto', 'sendAnimation'].includes(c.method) && c.body.chat_id === CHANNEL)

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
  TELEGRAM_API: `http://127.0.0.1:${stub.address().port}`,
  TELEGRAM_BOT_TOKEN: TOKEN,
  TELEGRAM_NEWS_CHANNEL: CHANNEL,
  TELEGRAM_REQUIRED_CHANNEL: 'off',
  ASK_REMOTE: 'off',
})
for (const k of ['TELEGRAM_RADAR_AUTOPOST', 'TELEGRAM_RADAR_TIME', 'TELEGRAM_RADAR_DRAFTS', 'TELEGRAM_WEBHOOK_SECRET', 'ANTHROPIC_API_KEY']) delete process.env[k]
await import('../server/server.mjs')
const ch = await import('../server/telegram-channel.mjs')
const radar = await import('../server/launch-radar.mjs')
ch.stopChannel() // the test drives the scheduler by hand
await new Promise((r) => setTimeout(r, 300))

const admin = makeClient(BASE)
const A = (p, body) => (body === undefined ? admin.call(p, { auth: ADMIN }) : admin.call(p, { method: 'POST', body, auth: ADMIN }))

/* ----------------------------------------------------------------- fixtures --- */

const addr = (n) => `0x${n.toString(16).padStart(40, '0')}`
// score, top 10 share, largest linked group ({ pct, wallets } or null)
const FIX = [
  { n: 1, symbol: 'AAA', chain: 'base', name: 'Base', score: 91, top10: 18.4, cluster: null },
  { n: 2, symbol: 'BBB', chain: 'bsc', name: 'BNB Chain', score: 84, top10: 22.1, cluster: { pct: 6.2, wallets: 2 } },
  { n: 3, symbol: 'CCC', chain: 'base', name: 'Base', score: 78, top10: 30.5, cluster: { pct: 9, wallets: 2 } },
  { n: 4, symbol: 'DDD', chain: 'robinhood', name: 'Robinhood Chain', score: 35, top10: 71, cluster: { pct: 62, wallets: 3 } },
  { n: 5, symbol: 'EEE', chain: 'base', name: 'Base', score: 41, top10: 66.6, cluster: { pct: 48.3, wallets: 5 } },
  { n: 6, symbol: 'RUGGED', chain: 'bsc', name: 'BNB Chain', score: 29, top10: 70, cluster: { pct: 55, wallets: 4 } },
  { n: 7, symbol: '<b>X&', chain: 'base', name: 'Base', score: null, top10: 44, cluster: null },
  { n: 8, symbol: 'GGG', chain: 'base', name: 'Base', score: null, top10: 12, cluster: null, state: 'checking' },
]
let fixtures = FIX
const mapFor = (f) => ({ state: 'ok', chain: { key: f.chain, name: f.name }, token: { address: addr(f.n), symbol: f.symbol }, health: f.score === null ? null : { score: f.score }, summary: { top10Pct: f.top10, largestCluster: f.cluster } })
const feedOf = (list) => ({ state: 'ok', launches: list.map((f) => ({ chainKey: f.chain, chainName: f.name, token: addr(f.n), symbol: f.symbol, state: f.state ?? 'checked' })) })
const useFixtures = (list) => {
  fixtures = list
  radar.setRadarSourcesForTest({
    feed: async () => feedOf(fixtures),
    peekMap: (c, tk) => {
      const f = fixtures.find((x) => x.chain === c && addr(x.n) === tk)
      return f ? mapFor(f) : null
    },
  })
}
useFixtures(FIX)

let clock = Date.UTC(2026, 9, 18, 16, 0, 0)
ch.setNowForTest(() => clock)

try {
  /* ------------------------------------------------------------- the words --- */
  for (const w of ['scam', 'scammer', 'rug', 'rugpull', 'rug pull', 'rugged', 'fraud', 'fraudulent', 'honeypot', 'ponzi', 'steal', 'fake', 'malicious', 'criminal', 'cheat', 'dumped']) check(`word list: "${w}" is caught`, !!radar.findBanned(`This is a ${w} token`))
  check('word list: plain launch wording is not caught', !radar.findBanned('62% held by 3 linked wallets. Top 10 wallets hold 41%. Health 72/100. Signals, not verdicts.'))

  /* --------------------------------------------------------------- the build --- */
  const b = await radar.buildRadar(clock)
  check('build: enough measured launches make a post', b.ok === true && b.day === '2026-10-18', b.skip)
  const text = b.v?.text ?? ''
  const sample = text
  check('build: best health scores first (91, 84, 78)', JSON.stringify(b.picks.clean.map((f) => f.symbol)) === JSON.stringify(['AAA', 'BBB', 'CCC']))
  check('build: most concentrated next, by the biggest linked group (62%, 55%, 48%)', b.picks.concentrated[0].symbol === 'DDD' && b.picks.concentrated[2].symbol === 'EEE' && b.picks.concentrated.length === 3)
  check('build: the line reads "62% held by 3 linked wallets"', text.includes('62% held by 3 linked wallets'), text)
  check('build: a launch without a linked group shows the top 10 share (e.g. "top 10 wallets hold" only where there is no group)', !/linked wallets/.test(text.split('Best health scores')[1].split('Most concentrated')[0]))
  check('build: a launch is not in both lists', new Set([...b.picks.clean, ...b.picks.concentrated].map((f) => f.token)).size === b.picks.clean.length + b.picks.concentrated.length)
  check('build: a launch with no built map (checking) is left out', !text.includes(addr(8)) && !/GGG/.test(text))
  check('build: a token whose name trips the word list is shown by address, never by name', !/RUGGED/i.test(text) && text.includes(`${addr(6).slice(0, 6)}…${addr(6).slice(-4)}`))
  check('build: no accusatory word anywhere in the text', radar.findBanned(text) === null, text)
  check('build: the "signals, not verdicts" note is the last line', /Signals, not verdicts/.test(text) && /<\/i>$/.test(text.trim()))
  check('build: it fits a photo caption and passes the composer validation', b.v.errors.length === 0 && b.v.length <= 1024 && b.v.limit === 1024)
  check('build: the brand-kit banner is the media and the buttons are https', b.v.media?.banner === true && b.v.buttons.length >= 1 && b.v.buttons.every((x) => x.url.startsWith('https://')))
  check('build: each launch links to its Holder Map page', text.includes(`https://gullylabs.xyz/holders/base/${addr(1)}`))

  useFixtures(FIX.map((f) => ({ ...f, state: 'checking' })))
  const thin = await radar.buildRadar(clock)
  check('build: with no built maps it skips, with a reason, instead of posting nothing', thin.ok === false && /needs at least/.test(thin.skip))
  useFixtures([FIX[0]])
  check('build: one launch is too few to rank', (await radar.buildRadar(clock)).ok === false)
  useFixtures(FIX)

  /* -------------------------------------------------- draft by default (tick) --- */
  clock = Date.UTC(2026, 9, 18, 14, 0, 0)
  await radar.radarTick()
  check('scheduler: before the daily time (15:00 UTC) nothing is made', (await A('/api/admin/channel')).data.posts.length === 0)
  clock = Date.UTC(2026, 9, 18, 16, 0, 0)
  await radar.radarTick()
  let posts = (await A('/api/admin/channel')).data.posts
  check('scheduler: the daily job writes ONE DRAFT (autopost is off by default)', posts.length === 1 && posts[0].status === 'draft' && posts[0].autoKey === 'radar:2026-10-18' && posts[0].media?.banner === true)
  check('scheduler: nothing was sent to the channel', posted().length === 0)
  await radar.radarTick()
  await radar.radarTick()
  check('scheduler: later ticks the same day do not make another draft or send it', (await A('/api/admin/channel')).data.posts.length === 1 && posted().length === 0)
  check('draft text passes the same word rule', radar.findBanned(posts[0].text) === null)

  /* ------------------------------------------------------------- admin route --- */
  check('admin: no token is 401', (await admin.call('/api/admin/channel/radar')).status === 401)
  const g = await A('/api/admin/channel/radar')
  check('admin: GET shows autopost off, the time and today’s draft', g.status === 200 && g.data.autopost === false && g.data.draftsEnabled === true && g.data.time === '15:00' && g.data.today?.status === 'draft', JSON.stringify(g.data).slice(0, 200))
  check('admin: a bad action is 400', (await A('/api/admin/channel/radar', { action: 'send' })).status === 400)
  const d2 = await A('/api/admin/channel/radar', { action: 'draft' })
  check('admin: draft again refreshes today’s draft (same id, still one post)', d2.status === 201 && d2.data.refreshed === true && d2.data.post.id === posts[0].id && (await A('/api/admin/channel')).data.posts.length === 1)
  check('admin: drafting sends nothing', posted().length === 0)
  const p1 = await A('/api/admin/channel/radar', { action: 'post' })
  check('admin: post publishes today’s draft to the channel (banner animation with the caption)', p1.status === 200 && p1.data.post.status === 'sent' && p1.data.post.id === posts[0].id && posted().length === 1 && posted()[0].method === 'sendAnimation' && String(posted()[0].body.caption).includes('Launch radar'), JSON.stringify(p1.data).slice(0, 200))
  check('admin: a second post the same day is refused (409)', (await A('/api/admin/channel/radar', { action: 'post' })).status === 409 && posted().length === 1)
  check('admin: drafting after it was sent is refused (409)', (await A('/api/admin/channel/radar', { action: 'draft' })).status === 409)
  useFixtures(FIX.map((f) => ({ ...f, state: 'checking' })))
  clock = Date.UTC(2026, 9, 19, 16, 0, 0)
  const sk = await A('/api/admin/channel/radar', { action: 'draft' })
  check('admin: not enough measured data is a 409 with the reason, no empty post', sk.status === 409 && /needs at least/.test(sk.data.skip ?? '') && (await A('/api/admin/channel')).data.posts.length === 1)
  const sk2 = await A('/api/admin/channel/radar', { action: 'post' })
  check('admin: post with no data and no draft is also refused', sk2.status === 409 && posted().length === 1)
  useFixtures(FIX)

  /* ------------------------------------------------- the TELEGRAM_RADAR_AUTOPOST flag --- */
  radar.resetRadarForTest()
  clock = Date.UTC(2026, 9, 20, 16, 0, 0)
  process.env.TELEGRAM_RADAR_AUTOPOST = '0'
  await radar.radarTick()
  posts = (await A('/api/admin/channel')).data.posts
  check('flag: TELEGRAM_RADAR_AUTOPOST=0 still only drafts', posts.length === 2 && posts[0].status === 'draft' && posted().length === 1)
  process.env.TELEGRAM_RADAR_AUTOPOST = 'true'
  await radar.radarTick()
  check('flag: only the exact value 1 turns it on ("true" does not)', (await A('/api/admin/channel')).data.posts[0].status === 'draft' && posted().length === 1)
  process.env.TELEGRAM_RADAR_AUTOPOST = '1'
  check('flag: GET reports autopost on', (await A('/api/admin/channel/radar')).data.autopost === true)
  await radar.radarTick()
  check('flag: with TELEGRAM_RADAR_AUTOPOST=1 the day’s draft goes out through the composer', (await A('/api/admin/channel')).data.posts[0].status === 'sent' && posted().length === 2)
  clock = Date.UTC(2026, 9, 21, 16, 0, 0)
  await radar.radarTick()
  check('flag: with autopost on the next day makes its own post and sends it', (await A('/api/admin/channel')).data.posts.length === 3 && posted().length === 3)
  delete process.env.TELEGRAM_RADAR_AUTOPOST

  process.env.TELEGRAM_RADAR_DRAFTS = '0'
  clock = Date.UTC(2026, 9, 22, 16, 0, 0)
  await radar.radarTick()
  check('flag: TELEGRAM_RADAR_DRAFTS=0 stops the scheduled drafts', (await A('/api/admin/channel')).data.posts.length === 3)
  delete process.env.TELEGRAM_RADAR_DRAFTS

  /* ------------------------------------------------------------- sample draft --- */
  console.log('\n--- sample radar draft ---\n' + sample.replace(/<\/?[a-z]+(?: href="[^"]*")?>/g, '') + '\n--------------------------\n')
} catch (e) {
  check(`no exception (${e?.stack ?? e})`, false)
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(t.failed ? 1 : 0)
