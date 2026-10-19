// Test of the intake notifier (server/intake-notify.mjs): the admin message per kind (emoji, bold title, escaped
// fields, the exact admin link), the per-kind rate cap and its "N more" summary, a failing Telegram never failing a
// submission, honeypot / invalid / rate-limited posts staying silent, thank-yous only for known chat ids, the daily
// digest (content, skip when empty), masked logs and CSV safety.
//
//   node scripts/test-intake-notify.mjs      (no build needed; TEST_PORT overrides the port, default 9311)
//
// The real server runs IN THIS PROCESS with a fresh DATA_DIR and a stubbed Telegram Bot API (a local HTTP server
// named by TELEGRAM_API). Nothing ever reaches the real Telegram.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { guardTestRun, makeChecker } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 9311
await guardTestRun(PORT)
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-intake-'))
const ADMIN = crypto.randomBytes(24).toString('hex')
const t = makeChecker()
const { check } = t
const ADMIN_CHAT = '-1001234567'
const KNOWN_CHAT = '424242'

/* ---- the stubbed Bot API ---- */
const sent = [] // { chat, text }
let failSends = false
const api = http.createServer((req, res) => {
  let b = ''
  req.on('data', (c) => (b += c))
  req.on('end', () => {
    const method = req.url.split('/').pop()
    let body = {}
    try {
      body = JSON.parse(b || '{}')
    } catch {
      /* ignore */
    }
    res.setHeader('content-type', 'application/json')
    if (method === 'sendMessage') {
      if (failSends) return res.writeHead(500).end(JSON.stringify({ ok: false, description: 'stub: down' }))
      sent.push({ chat: String(body.chat_id), text: body.text })
      return res.end(JSON.stringify({ ok: true, result: { message_id: sent.length } }))
    }
    res.end(JSON.stringify({ ok: true, result: method === 'getMe' ? { username: 'GullyLabsBot' } : true }))
  })
})
await new Promise((r) => api.listen(0, '127.0.0.1', r))

fs.writeFileSync(path.join(tmp, 'bot-users.json'), JSON.stringify({ users: { [KNOWN_CHAT]: { firstSeen: '2026-01-01T00:00:00Z', lastSeen: '2026-01-01T00:00:00Z', lang: 'en', username: 'knownperson', linked: false, follows: null, followsAt: null, blocked: null, optedOut: null, source: 'start' } } }))
Object.assign(process.env, {
  PORT: String(PORT), DATA_DIR: tmp, TRACKER_DATA: path.join(tmp, 'tracker-history.json'), DIST_DIR: path.join(tmp, 'no-dist'), ADMIN_TOKEN: ADMIN, TRACKER_LOOP: 'off', DEEPCORE_LOOP: 'off', TRACKER_SKIP_APIS: '1', ASK_REMOTE: 'off',
  TELEGRAM_BOT_TOKEN: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh', TELEGRAM_API: `http://127.0.0.1:${api.address().port}`, TELEGRAM_ADMIN_CHAT_ID: ADMIN_CHAT,
})
const logs = []
for (const m of ['log', 'error']) {
  const orig = console[m].bind(console)
  console[m] = (...a) => {
    logs.push(a.join(' '))
    orig(...a)
  }
}
await import('../server/server.mjs')
await new Promise((r) => setTimeout(r, 400))
const N = await import('../server/intake-notify.mjs')
N.setIntakeNotifyForTest({ retryMs: 50 })

let ipN = 0
const call = async (p, { method = 'GET', body, token } = {}) => {
  const headers = { 'cf-connecting-ip': `198.51.100.${++ipN}`, 'x-requested-with': 'gully' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    /* not json */
  }
  return { status: r.status, data, text, headers: r.headers }
}
const waitFor = async (fn, ms = 8000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (fn()) return true
    await new Promise((r) => setTimeout(r, 40))
  }
  return fn()
}
const quiet = (ms = 700) => new Promise((r) => setTimeout(r, ms))
const toAdmin = () => sent.filter((s) => s.chat === ADMIN_CHAT)
const show = (label, text) => console.log(`\n--- sample: ${label} ---\n${text}\n---`)

const chainsBody = (n, extra = {}) => ({ project: `Proj <b>${n}</b> & Co`, contact: `team${n}@example.com`, useCase: 'defi', scale: 'small', gasToken: 'eth', da: 'rollup', wantsAa: 'yes', wantsDeepcore: 'no', notes: 'hello <script>x</script>', ...extra })
const ecoBody = (extra = {}) => ({ name: 'Notify Pad', url: 'https://notify-pad.xyz/', contact: 'team@notify-pad.xyz', chains: ['base'], factory: '0x' + 'ab'.repeat(20), eventSignature: 'TokenCreated(address,address,string)', ...extra })

try {
  /* ============ every intake, through the real routes ============ */
  let n0 = toAdmin().length
  let r = await call('/api/chains/waitlist', { method: 'POST', body: chainsBody(1) })
  check('chains waitlist: sign-up answers 201', r.status === 201)
  check('chains waitlist: the admin chat is told', await waitFor(() => toAdmin().length === n0 + 1))
  let m = toAdmin().at(-1)?.text ?? ''
  show('Gully Chains waitlist', m)
  check('chains waitlist: kind emoji and bold title', m.startsWith('⛓️ <b>New Gully Chains waitlist sign-up: Proj &lt;b&gt;1&lt;/b&gt; &amp; Co</b>'))
  check('chains waitlist: fields shown, escaped once (no double escaping, no raw markup)', m.includes('<b>Contact:</b> team1@example.com') && m.includes('hello &lt;script&gt;x&lt;/script&gt;') && !m.includes('&amp;lt;') && !m.includes('<script>'))
  check('chains waitlist: links to the Chain Kit admin section', m.includes('<a href="https://admin.gullylabs.xyz/#chainkit">Open in admin</a>'))

  // Honeypot, invalid, duplicate and rate-limited posts stay silent.
  n0 = toAdmin().length
  check('honeypot answered like a success', (await call('/api/chains/waitlist', { method: 'POST', body: chainsBody(2, { website: 'http://spam' }) })).status === 201)
  check('invalid post is refused', (await call('/api/chains/waitlist', { method: 'POST', body: chainsBody(3, { useCase: 'nope' }) })).status === 400)
  check('duplicate sign-up answers 200', (await call('/api/chains/waitlist', { method: 'POST', body: chainsBody(1) })).status === 200)
  const same = { 'cf-connecting-ip': '203.0.113.9', 'x-requested-with': 'gully', 'content-type': 'application/json' }
  const codes = []
  for (let i = 0; i < 7; i++) codes.push((await fetch(BASE + '/api/chains/waitlist', { method: 'POST', headers: same, body: JSON.stringify(chainsBody(100 + i)) })).status)
  check('the per-IP limit kicks in (429 seen)', codes.includes(429), codes.join(','))
  const accepted = codes.filter((c) => c === 201).length
  await quiet(accepted * 1100 + 300)
  check('only the accepted posts notified; honeypot, invalid, duplicate and 429 did not', toAdmin().length === n0 + accepted, `${toAdmin().length - n0} vs ${accepted}`)

  // Ecosystem
  n0 = toAdmin().length
  check('ecosystem: honeypot silent', (await call('/api/ecosystem/submissions', { method: 'POST', body: ecoBody({ company: 'bot' }) })).status === 200)
  check('ecosystem: invalid silent', (await call('/api/ecosystem/submissions', { method: 'POST', body: ecoBody({ url: 'http://x' }) })).status === 400)
  await quiet(300)
  check('ecosystem: honeypot and invalid sent nothing', toAdmin().length === n0)
  check('ecosystem: submission answers 200', (await call('/api/ecosystem/submissions', { method: 'POST', body: ecoBody({ note: 'a < b & "c"' }) })).status === 200)
  check('ecosystem: the admin chat is told', await waitFor(() => toAdmin().length === n0 + 1))
  m = toAdmin().at(-1)?.text ?? ''
  show('Ecosystem submission', m)
  check('ecosystem: emoji, title, escaped note, admin link', m.startsWith('🚀 <b>New launchpad submission: Notify Pad</b>') && m.includes('a &lt; b &amp; &quot;c&quot;') && m.includes('#chainkit'))

  // Contact form
  n0 = toAdmin().length
  check('contact: invalid post refused', (await call('/api/contact', { method: 'POST', body: { email: 'nope', types: [] } })).status === 400)
  check('contact: post answers 200', (await call('/api/contact', { method: 'POST', body: { name: 'Ann <i>', email: 'ann@example.com', types: ['Infrastructure'], budget: '10k', message: 'Hi & hello' } })).status === 200)
  check('contact: the admin chat is told', await waitFor(() => toAdmin().length === n0 + 1))
  m = toAdmin().at(-1)?.text ?? ''
  show('Contact form', m)
  check('contact: emoji, escaped name, link to Enquiries', m.startsWith('✉️ <b>New contact form message from Ann &lt;i&gt;</b>') && m.includes('Hi &amp; hello') && m.includes('#inbox'))

  // Security review
  n0 = toAdmin().length
  const sec = { name: 'Sam', email: 'sam@example.com', project: 'SecPad', scope: 'Please review the staking contract and the fee router.', tier: 'review' }
  r = await call('/api/security/review-requests', { method: 'POST', body: { ...sec, website: 'bot' } })
  await quiet(300)
  check('security: honeypot silent', r.status === 201 && toAdmin().length === n0)
  r = await call('/api/security/review-requests', { method: 'POST', body: sec })
  check('security: request accepted', r.status === 201, String(r.status))
  check('security: the admin chat is told', await waitFor(() => toAdmin().length === n0 + 1))
  m = toAdmin().at(-1)?.text ?? ''
  show('Security review request', m)
  check('security: emoji, project in title, link to Security', m.startsWith('🛡️ <b>New Security Review request: SecPad</b>') && m.includes('#security'))

  /* ============ confirmation to the submitter ============ */
  check('known handle: the sign-up is accepted', (await call('/api/chains/waitlist', { method: 'POST', body: chainsBody(7, { contact: '@KnownPerson' }) })).status === 201)
  check('known handle: one thank-you reaches that chat id', await waitFor(() => sent.some((s) => s.chat === KNOWN_CHAT)))
  const thanks = sent.find((s) => s.chat === KNOWN_CHAT)?.text ?? ''
  show('Confirmation to the submitter', thanks)
  check('the thank-you is short and says what happens next', thanks.includes('Thanks') && thanks.includes('waitlist') && thanks.length < 250)
  check('unknown handle: nobody but the admin chat is messaged', (await call('/api/chains/waitlist', { method: 'POST', body: chainsBody(8, { contact: '@stranger_person' }) })).status === 201 && (await quiet(1500), sent.filter((s) => s.chat !== ADMIN_CHAT && s.chat !== KNOWN_CHAT).length === 0))
  check('email contact: no confirmation', (await call('/api/chains/waitlist', { method: 'POST', body: chainsBody(9) })).status === 201 && (await quiet(1500), sent.filter((s) => s.chat === KNOWN_CHAT).length === 1))
  check('a t.me link is read as a handle', N.telegramHandleOf('https://t.me/KnownPerson') === 'knownperson' && N.telegramHandleOf('t.me/knownperson/') === 'knownperson' && N.telegramHandleOf('a@b.co') === null)

  /* ============ Telegram failing never fails a submission ============ */
  failSends = true
  const errs0 = logs.length
  r = await call('/api/chains/waitlist', { method: 'POST', body: chainsBody(10, { contact: 'secretperson10@example.com' }) })
  check('Telegram down: the sign-up still succeeds (201)', r.status === 201)
  r = await call('/api/contact', { method: 'POST', body: { email: 'down@example.com', types: ['Other'], message: 'x' } })
  check('Telegram down: the contact form still succeeds (200)', r.status === 200)
  r = await call('/api/ecosystem/submissions', { method: 'POST', body: ecoBody({ name: 'Down Pad', url: 'https://down-pad.xyz/' }) })
  check('Telegram down: the ecosystem submission still succeeds (200)', r.status === 200)
  await waitFor(() => logs.slice(errs0).filter((l) => l.includes('intake notify')).length >= 3, 6000)
  const newLogs = logs.slice(errs0).join('\n')
  check('the failure is logged, without the bot token', newLogs.includes('intake notify:') && !newLogs.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ'))
  check('logs never hold a full contact', !newLogs.includes('secretperson10@example.com') && !newLogs.includes('down@example.com'))
  check('logs carry the masked contact', newLogs.includes('se***@ex***.com'), N.maskContact('secretperson10@example.com'))
  // A retry: one failure then success is delivered once.
  const before = toAdmin().length
  const p = N.notifyIntake({ kind: 'contact', title: 'Retry me', fields: [['Email', 'r@example.com']], contact: 'r@example.com' })
  setTimeout(() => (failSends = false), 20)
  const res = await p
  check('a failed send is retried once and then delivered', res.sent === true && toAdmin().length === before + 1)
  failSends = false

  /* ============ unit level: the cap, kinds, digest, CSV ============ */
  const unit = []
  N.setIntakeNotifyForTest({ perHour: 3, retryMs: 0, send: { admin: async (h) => (unit.push(h), { ok: true }), chat: async () => ({ ok: true }) } })
  await N.flushIntakeSummariesForTest()
  unit.length = 0
  const t0 = Date.now()
  const rs = []
  for (let i = 0; i < 8; i++) rs.push(await N.notifyIntake({ kind: 'ecosystem', title: `Pad ${i}`, fields: { Site: 'https://x.xyz' }, now: t0 + i }))
  check('rate cap: only the first 3 of 8 are sent', unit.length === 3 && rs.filter((x) => x.sent).length === 3 && rs.filter((x) => x.capped).length === 5)
  await N.notifyIntake({ kind: 'contact', title: 'Other kind', now: t0 + 10 })
  check('rate cap: another kind has its own budget', unit.length === 4)
  check('rate cap: one "N more" summary after the hour', (await N.flushIntakeSummariesForTest()) === 1 && /<b>5 more Launchpad submission entries<\/b>/.test(unit.at(-1)) && unit.length === 5)
  show('"N more" summary', unit.at(-1))
  check('rate cap: the summary is sent once only', (await N.flushIntakeSummariesForTest()) === 0)
  // A new hour starts the budget again and flushes a pending summary.
  unit.length = 0
  for (let i = 0; i < 4; i++) await N.notifyIntake({ kind: 'security', title: `S${i}`, now: t0 })
  await N.notifyIntake({ kind: 'security', title: 'next hour', now: t0 + 3_600_001 })
  await new Promise((r) => setTimeout(r, 20))
  check('rate cap: the next hour flushes "1 more" and sends the new one', unit.some((h) => h.includes('1 more Security review request entry')) && unit.some((h) => h.includes('next hour')))
  await N.flushIntakeSummariesForTest()

  // One message per kind: emoji and link.
  unit.length = 0
  N.setIntakeNotifyForTest({ perHour: 100 })
  for (const k of Object.keys(N.KINDS)) await N.notifyIntake({ kind: k, title: `T ${k}`, fields: [['A', '<x>']] })
  const want = { 'chains-waitlist': ['⛓️', 'chainkit'], 'chain-kit': ['🧰', 'chainkit'], 'chains-devnet': ['🧪', 'chainkit'], ecosystem: ['🚀', 'chainkit'], contact: ['✉️', 'inbox'], security: ['🛡️', 'security'] }
  for (const [k, [emoji, hash]] of Object.entries(want)) {
    const msg = unit.find((h) => h.includes(`T ${k}`)) ?? ''
    check(`kind ${k}: ${emoji}, bold title, escaped field, #${hash}`, msg.startsWith(`${emoji} <b>T ${k}</b>`) && msg.includes('<b>A:</b> &lt;x&gt;') && msg.includes(`https://admin.gullylabs.xyz/#${hash}`))
  }
  show('Chain Kit waitlist (sample layout)', unit.find((h) => h.includes('T chain-kit')) ?? '')
  check('an unknown kind sends nothing', (await N.notifyIntake({ kind: 'nope', title: 'x' })).sent === false)
  await N.notifyIntake({ kind: 'contact', title: 'u', adminUrl: 'https://admin.gullylabs.xyz/#inbox' })
  check('a custom adminUrl is used', unit.at(-1).includes('href="https://admin.gullylabs.xyz/#inbox"'))
  await N.notifyIntake({ kind: 'contact', title: 'L', fields: [['Message', 'y'.repeat(2000)]] })
  check('long values are cut', unit.at(-1).length < 600)
  check('maskContact never returns the full value', N.maskContact('longname@example.org') === 'lo***@ex***.org' && N.maskContact('@somehandle') === '@so***' && N.maskContact('plain-text') === 'pl***' && N.maskContact('') === '(none)')

  // Digest.
  const day = Date.parse('2026-10-20T09:30:00Z')
  const ago = (h) => new Date(day - h * 3_600_000).toISOString()
  N.setDigestSourcesForTest(async () => ({ 'chains-waitlist': [ago(1), ago(5), ago(30)], 'chain-kit': [ago(40)], 'chains-devnet': [], ecosystem: [ago(2)], contact: [ago(3), ago(4), ago(100)], security: [] }))
  const dg = await N.digestMessage({ now: day })
  show('Daily digest', dg ?? '(none)')
  check('digest: counts per kind (new and total) and the overall new count', dg.includes('Gully Chains waitlist: <b>2</b> new · 3 total') && dg.includes('Chain Kit waitlist: <b>0</b> new · 1 total') && dg.includes('Launchpad submission: <b>1</b> new · 1 total') && dg.includes('Contact form: <b>2</b> new · 3 total') && dg.includes('<b>5</b> new in total'))
  N.setDigestSourcesForTest(async () => ({ 'chains-waitlist': [ago(30)], 'chain-kit': [], 'chains-devnet': [], ecosystem: [], contact: [], security: [] }))
  check('digest: skipped when nothing is new in 24 h', (await N.digestMessage({ now: day })) === null)
  process.env.INTAKE_DIGEST_TIME = '09:00'
  const m1 = N.digestMinute()
  process.env.INTAKE_DIGEST_TIME = '7:45'
  const m2 = N.digestMinute()
  process.env.INTAKE_DIGEST_TIME = 'soon'
  const m3 = N.digestMinute()
  process.env.INTAKE_DIGEST_TIME = '09:00'
  check('INTAKE_DIGEST_TIME parses (and falls back to 09:00)', m1 === 540 && m2 === 465 && m3 === 540)
  N.setDigestSourcesForTest(async () => ({ 'chains-waitlist': [ago(1)], 'chain-kit': [], 'chains-devnet': [], ecosystem: [], contact: [], security: [] }))
  unit.length = 0
  check('digest clock: before 09:00 UTC nothing is sent', (await N.digestTick({ now: Date.parse('2026-10-20T08:59:00Z') })) === 'not-due' && unit.length === 0)
  check('digest clock: at 09:00 UTC it is sent', (await N.digestTick({ now: Date.parse('2026-10-20T09:00:30Z') })) === 'sent' && unit.length === 1 && unit[0].includes('Daily intake digest'))
  check('digest clock: not sent twice the same day', (await N.digestTick({ now: Date.parse('2026-10-20T15:00:00Z') })) === 'not-due' && unit.length === 1)
  N.setDigestSourcesForTest(async () => ({}))
  check('digest clock: an empty day sends nothing', (await N.digestTick({ now: Date.parse('2026-10-21T09:05:00Z') })) === 'empty' && unit.length === 1)
  N.setDigestSourcesForTest(null)
  const real = await N.digestMessage({ now: Date.now() })
  check('digest: the real stores are readable (the sign-ups made above are counted)', typeof real === 'string' && /Gully Chains waitlist: <b>\d+<\/b> new/.test(real) && /Security review request: <b>1<\/b>/.test(real), real?.slice(0, 80))

  // CSV.
  check('csv: = + - @ cells get a leading quote', ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx'].every((v) => N.csvCell(v).replace(/^"/, '').startsWith("'")))
  check('csv: quotes, commas and newlines are quoted and doubled', N.csvCell('a,"b"\nc') === '"a,""b""\nc"' && N.csvCell(null) === '' && N.csvCell('plain') === 'plain')
  const evil = await call('/api/chains/waitlist', { method: 'POST', body: chainsBody(50, { project: '=HYPERLINK("http://evil","x")', notes: '@SUM(1)' }) })
  check('csv: formula-looking sign-up accepted', evil.status === 201)
  const csv = await fetch(BASE + '/api/admin/chains/waitlist?format=csv', { headers: { authorization: `Bearer ${ADMIN}` } })
  const body = await csv.text()
  check('csv: chains waitlist export is a text/csv attachment', csv.status === 200 && /text\/csv/.test(csv.headers.get('content-type')) && /attachment; filename="chains-waitlist.csv"/.test(csv.headers.get('content-disposition')))
  check('csv: header row and the sign-ups are in it', body.includes('signed_up_at,project,contact') && body.includes('team1@example.com'))
  check('csv: the formula project is neutralised, not executable', body.includes(`"'=HYPERLINK(""http://evil"",""x"")"`) && !/(^|,)=HYPERLINK/m.test(body) && body.includes("'@SUM(1)"))
  check('csv: stored entities are decoded (readable, not &lt;)', body.includes('hello <script>x</script>') && !body.includes('&lt;'))
  check('csv: without the admin token it is refused', [401, 403].includes((await fetch(BASE + '/api/admin/chains/waitlist?format=csv')).status) && [401, 403].includes((await fetch(BASE + '/api/admin/ecosystem/submissions?format=csv')).status) && [401, 403].includes((await fetch(BASE + '/api/admin/chain-kit?format=csv')).status))
  const ecoCsv = await fetch(BASE + '/api/admin/ecosystem/submissions?format=csv', { headers: { authorization: `Bearer ${ADMIN}` } })
  const ecoText = await ecoCsv.text()
  check('csv: ecosystem export has the submissions', ecoCsv.status === 200 && ecoText.includes('submitted_at,status,name,website') && ecoText.includes('Notify Pad') && ecoText.includes('a < b & ""c"""'))
  const kitCsv = await fetch(BASE + '/api/admin/chain-kit?format=csv&list=requests', { headers: { authorization: `Bearer ${ADMIN}` } })
  check('csv: Chain Kit export answers with its header', kitCsv.status === 200 && (await kitCsv.text()).replace(/^﻿/, '').startsWith('requested_at,email,chain'))
  const devCsv = await fetch(BASE + '/api/admin/chain-kit?format=csv&list=waitlist', { headers: { authorization: `Bearer ${ADMIN}` } })
  check('csv: Devnet waitlist export has its own file name', devCsv.status === 200 && /devnet-waitlist\.csv/.test(devCsv.headers.get('content-disposition')))
  check('the JSON admin lists are unchanged', Array.isArray((await call('/api/admin/chains/waitlist', { token: ADMIN })).data?.rows) && Array.isArray((await call('/api/admin/ecosystem/submissions', { token: ADMIN })).data?.submissions))
} catch (e) {
  t.failed++
  console.log('FAIL  the suite crashed:', e?.stack ?? e)
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
api.close()
process.exit(t.failed ? 1 : 0)
