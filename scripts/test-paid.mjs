// End-to-end test of the paid tiers: plans, crypto checkout verification, gap alerts and long history.
//
//   node scripts/test-paid.mjs            (no build needed; it tests the API, not the pages)
//
// It starts the real server IN THIS PROCESS on port 8791 with a fresh temporary DATA_DIR, so it can
// call the exported test hooks (alert evaluation with synthetic tracker rows, synthetic snapshots for
// the history archive). Nothing upstream is read: the tracker loop is off (TRACKER_LOOP=off) and Base
// is a local JSON-RPC stub (GULLY_BASE_RPC). Webhooks go to a local receiver, which is allowed only
// because GULLY_ALLOW_LOOPBACK_WEBHOOKS=1 is set here. A random wallet signs in; no real wallet is used.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { makeChecker, makeClient } from './test-helpers.mjs'

const PORT = 8791
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-paid-'))
const ADMIN = crypto.randomBytes(24).toString('hex')
const TREASURY = privateKeyToAccount(generatePrivateKey()).address.toLowerCase()
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const OTHER_TOKEN = '0x50c5725949a6f0c72e6c4a641f24049a917db0cb'
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

const t = makeChecker()
const { check } = t

/* ------------------------------------------------------------- Base RPC stub --- */

const HEAD = 1_000_000
const receipts = new Map() // hash -> receipt
const blockTime = new Map() // block number -> unix seconds
const pad = (a) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0')
const hex = (n) => '0x' + BigInt(n).toString(16)
const randHash = () => '0x' + crypto.randomBytes(32).toString('hex')
function addTx({ token = USDC, from, to = TREASURY, value, status = '0x1', block = HEAD - 20, minedAt = Math.floor(Date.now() / 1000) }) {
  const hash = randHash()
  blockTime.set(block, minedAt)
  receipts.set(hash, { transactionHash: hash, status, blockNumber: hex(block), logs: [{ address: token, topics: [TRANSFER, pad(from), pad(to)], data: pad(hex(value)) }] })
  return hash
}
const rpcStub = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const q = JSON.parse(body)
    let result = null
    if (q.method === 'eth_blockNumber') result = hex(HEAD)
    else if (q.method === 'eth_getTransactionReceipt') result = receipts.get(q.params[0]) ?? null
    else if (q.method === 'eth_getBlockByNumber') {
      const n = Number(BigInt(q.params[0]))
      result = blockTime.has(n) ? { number: q.params[0], timestamp: hex(blockTime.get(n)) } : null
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }))
  })
})
await new Promise((r) => rpcStub.listen(0, '127.0.0.1', r))

/* --------------------------------------------------------- webhook receiver --- */

const hooks = [] // { headers, raw, body }
const receiver = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    hooks.push({ headers: req.headers, raw, body: JSON.parse(raw) })
    res.writeHead(200)
    res.end('ok')
  })
})
await new Promise((r) => receiver.listen(0, '127.0.0.1', r))
const HOOK_URL = `http://127.0.0.1:${receiver.address().port}/hook`

/* ------------------------------------------------------------ start server --- */

Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: path.join(tmp, 'no-dist'),
  ADMIN_TOKEN: ADMIN,
  TRACKER_LOOP: 'off',
  GULLY_BASE_RPC: `http://127.0.0.1:${rpcStub.address().port}`,
  GULLY_TREASURY_ADDRESS: TREASURY,
  GULLY_ALLOW_LOOPBACK_WEBHOOKS: '1',
})
delete process.env.TELEGRAM_BOT_TOKEN
await import('../server/server.mjs')
const { evaluateAlerts, isPrivateIp, checkWebhookForm, COOLDOWN_MS } = await import('../server/alerts.mjs')
const { recordSnapshotForTest } = await import('../server/tracker.mjs')
await new Promise((r) => setTimeout(r, 300))

const dev = makeClient(BASE)
const anon = makeClient(BASE)
const admin = (p, method = 'GET', body) => fetch(BASE + p, { method, headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }))
const wallet = privateKeyToAccount(generatePrivateKey())
const me = wallet.address.toLowerCase()
const stranger = privateKeyToAccount(generatePrivateKey()).address.toLowerCase()

try {
  /* ------------------------------------------------------------ plans --- */
  const plans = await anon.call('/api/plans')
  check('GET /api/plans lists free, pro and business with prices from plans.mjs', plans.status === 200 && plans.data.plans.map((p) => p.id).join() === 'free,pro,business' && plans.data.plans[1].priceUsdc > 0)
  check('checkout is enabled with the configured treasury', plans.data.checkout.enabled === true && plans.data.checkout.treasury === TREASURY)
  delete process.env.GULLY_TREASURY_ADDRESS
  const off = await anon.call('/api/plans')
  check('without GULLY_TREASURY_ADDRESS checkout is off and no address is shown', off.data.checkout.enabled === false && off.data.checkout.treasury === null && !!off.data.checkout.reason)

  check('signs in with a random wallet', (await dev.signIn(wallet)).status === 200)
  const noTreasury = await dev.post('/api/developer/checkout', { plan: 'pro' })
  check('starting a checkout without a treasury is refused (503)', noTreasury.status === 503, noTreasury.data?.error)
  process.env.GULLY_TREASURY_ADDRESS = TREASURY

  const acct = await dev.call('/api/developer/account')
  check('a new wallet is on Free', acct.data?.plan?.id === 'free' && acct.data.limits.keyPerMin === 600)
  const key = (await dev.post('/api/developer/keys', { name: 'paid test' })).data?.secret
  const lim = async () => (await anon.call('/api/tracker/history?chain=robinhood&ticker=NVDA', { auth: key, useCookie: false })).headers.get('x-ratelimit-limit')
  check('a Free key gets 600 a minute', (await lim()) === '600')

  /* ---------------------------------------------------------- history --- */
  const day = 86_400_000
  const row = (o) => ({ chain: 'robinhood', ticker: 'AAPL', name: 'Apple', gapPct: 0.4, status: 'in-line', fair: 200, onchain: 200.8, poolStale: false, sessionOpen: false, ...o })
  recordSnapshotForTest([row({ gapPct: 1.11 })], Date.now() - 25 * day)
  recordSnapshotForTest([row({ gapPct: 2.22 })], Date.now() - 3 * day)
  recordSnapshotForTest([row({ gapPct: 0.33 })], Date.now())
  const dayDir = new Date(Date.now() - 25 * day).toISOString().slice(0, 10)
  check('snapshots are archived as daily append-only files', fs.existsSync(path.join(tmp, 'history', dayDir, 'robinhood-AAPL.ndjson')))
  const h0 = await anon.call('/api/tracker/history?chain=robinhood&ticker=AAPL')
  check('history without ?days keeps the old shape (7 days from memory)', h0.status === 200 && Array.isArray(h0.data.points) && h0.data.points.length === 2 && h0.data.points[0].length === 4, JSON.stringify(h0.data?.points))
  const h7 = await anon.call('/api/tracker/history?chain=robinhood&ticker=AAPL&days=2')
  check('?days=2 trims to two days', h7.status === 200 && h7.data.points.length === 1 && h7.data.days === 2)
  check('anonymous ?days=30 is refused (403)', (await anon.call('/api/tracker/history?chain=robinhood&ticker=AAPL&days=30')).status === 403)
  check('Free key ?days=8 is refused (403)', (await anon.call('/api/tracker/history?chain=robinhood&ticker=AAPL&days=8', { auth: key, useCookie: false })).status === 403)
  check('?days=400 is a bad request (400)', (await anon.call('/api/tracker/history?chain=robinhood&ticker=AAPL&days=400', { auth: key, useCookie: false })).status === 400)

  /* ---------------------------------------------------------- alerts --- */
  check('SSRF guard: private and reserved addresses are refused', ['10.0.0.1', '172.16.5.4', '192.168.1.1', '127.0.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1', '64:ff9b::a00:1'].every(isPrivateIp))
  check('SSRF guard: public addresses pass', ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'].every((ip) => !isPrivateIp(ip)))
  check('webhooks must be https (http only for loopback in tests)', !checkWebhookForm('http://example.com/x').ok && !checkWebhookForm('ftp://example.com').ok && !checkWebhookForm('https://user:pw@example.com').ok)
  const priv = await dev.post('/api/developer/alerts', { condition: { type: 'gap', pct: 2 }, webhookUrl: 'https://10.0.0.5/hook' })
  check('an alert to a private address is refused', priv.status === 400, priv.data?.error)
  const meta = await dev.call('/api/developer/alerts')
  check('Telegram is hidden when TELEGRAM_BOT_TOKEN is unset', meta.data?.telegram?.enabled === false)
  const tg = await dev.post('/api/developer/alerts', { condition: { type: 'gap', pct: 2 }, telegramChatId: '12345' })
  check('a Telegram alert is refused when Telegram is off', tg.status === 400)

  const created = await dev.post('/api/developer/alerts', { name: 'NVDA wide', chain: 'robinhood', ticker: 'NVDA', condition: { type: 'gap', pct: 2 }, webhookUrl: HOOK_URL })
  const secret = created.data?.secret
  const alertId = created.data?.alert?.id
  check('an alert is created and its secret is shown once', created.status === 201 && /^whsec_/.test(secret ?? ''), created.data?.error)
  check('the alert list never shows the secret', !JSON.stringify((await dev.call('/api/developer/alerts')).data).includes(secret))
  const second = await dev.post('/api/developer/alerts', { condition: { type: 'status', status: 'either' }, webhookUrl: HOOK_URL })
  check('Free allows one alert; a second is refused', second.status === 403, second.data?.error)

  const nvda = (o) => ({ chain: 'robinhood', ticker: 'NVDA', name: 'NVIDIA', gapPct: 3.1, status: 'premium', fair: 180, onchain: 185.58, poolStale: false, sessionOpen: true, feedUpdatedAt: new Date().toISOString(), pool: { liquidityUsd: 50_000 }, ...o })
  let now = Date.now()
  await evaluateAlerts([nvda()], now)
  check('a crossing fires one webhook', hooks.length === 1 && hooks[0].body.type === 'alert.triggered' && hooks[0].body.events[0].ticker === 'NVDA', `${hooks.length} deliveries`)
  const h = hooks[0]
  const expect = 'sha256=' + crypto.createHmac('sha256', secret).update(`${h.headers['x-gully-timestamp']}.${h.raw}`).digest('hex')
  check('the X-Gully-Signature verifies with the alert secret', h.headers['x-gully-signature'] === expect)
  check('a wrong secret does not verify', h.headers['x-gully-signature'] !== 'sha256=' + crypto.createHmac('sha256', 'whsec_wrong').update(`${h.headers['x-gully-timestamp']}.${h.raw}`).digest('hex'))
  await evaluateAlerts([nvda({ gapPct: 3.5 })], now + 60_000)
  check('it does not fire again while the condition stays true', hooks.length === 1)
  await evaluateAlerts([nvda({ gapPct: 0.4, status: 'in-line' })], now + 120_000)
  await evaluateAlerts([nvda({ gapPct: 2.6 })], now + 180_000)
  check('re-armed, but held by the 30-minute cooldown', hooks.length === 1)
  await evaluateAlerts([nvda({ gapPct: 2.6 })], now + COOLDOWN_MS + 60_000)
  check('fires after the cooldown while still true', hooks.length === 2)
  await evaluateAlerts([nvda({ gapPct: 0.2, status: 'in-line' })], now + COOLDOWN_MS + 120_000)
  await evaluateAlerts([nvda({ gapPct: 9, status: 'thin' }), nvda({ gapPct: 9, poolStale: true }), nvda({ gapPct: 9, sessionOpen: false }), nvda({ gapPct: null, status: 'pool-unreadable' })], now + 3 * COOLDOWN_MS)
  check('thin, stale, closed-session or unreadable rows never fire', hooks.length === 2)
  const test = await dev.post(`/api/developer/alerts/${alertId}/test`)
  check('a test delivery reaches the webhook, with no invented events', test.status === 200 && hooks.at(-1).body.type === 'alert.test' && hooks.at(-1).body.events.length === 0 && test.data.results[0].status === 200)
  const log = (await dev.call('/api/developer/alerts')).data.alerts.find((a) => a.id === alertId).deliveries
  check('the delivery log keeps status codes', log.length === 3 && log.every((d) => d.status === 200 && d.ok), JSON.stringify(log.map((d) => d.status)))
  const paused = await dev.post(`/api/developer/alerts/${alertId}/pause`)
  await evaluateAlerts([nvda({ gapPct: 0.1, status: 'in-line' })], now + 4 * COOLDOWN_MS)
  await evaluateAlerts([nvda({ gapPct: 5 })], now + 5 * COOLDOWN_MS)
  check('a paused alert does not fire', paused.status === 200 && hooks.length === 3)
  await dev.post(`/api/developer/alerts/${alertId}/resume`)
  const rotated = await dev.post(`/api/developer/alerts/${alertId}/rotate`)
  check('the secret can be rotated', rotated.status === 200 && rotated.data.secret !== secret)

  /* --------------------------------------------------- admin grant plan --- */
  const grant = await admin(`/api/admin/accounts/${me}/plan`, 'POST', { plan: 'pro', days: 30 })
  check('admin grants Pro', grant.status === 200 && grant.data.plan.id === 'pro')
  check('a Pro key gets 3000 a minute', (await lim()) === '3000')
  const h30 = await anon.call('/api/tracker/history?chain=robinhood&ticker=AAPL&days=30', { auth: key, useCookie: false })
  check('a Pro key reads 30 days, archive included', h30.status === 200 && h30.data.points.length === 3 && h30.data.points[0][1] === 1.11, JSON.stringify(h30.data?.points?.map((p) => p[1])))
  check('long history is not publicly cacheable', /private/.test(h30.headers.get('cache-control') ?? ''))
  check('a Pro key cannot read 120 days', (await anon.call('/api/tracker/history?chain=robinhood&ticker=AAPL&days=120', { auth: key, useCookie: false })).status === 403)
  let made = 1
  for (let i = 0; i < 12; i++) if ((await dev.post('/api/developer/alerts', { condition: { type: 'gap', pct: 5 + i }, webhookUrl: HOOK_URL })).status === 201) made++
  check('Pro allows ten alerts', made === 10, `${made} alerts`)
  const subs = await admin('/api/admin/billing')
  check('admin sees the subscription', subs.data?.subscriptions?.some((s) => s.address === me && s.plan === 'pro' && s.source === 'admin' && s.active))
  await admin(`/api/admin/accounts/${me}/plan`, 'POST', { plan: 'free' })
  check('admin revokes: back to 600 a minute', (await lim()) === '600')
  const listed = (await dev.call('/api/developer/alerts')).data
  check('alerts beyond the Free allowance are shown as not covered', listed.alerts.filter((a) => a.coveredByPlan).length === 1 && listed.limits.max === 1)

  /* --------------------------------------------------------- checkout --- */
  const intent = (await dev.post('/api/developer/checkout', { plan: 'pro' })).data?.intent
  check('a checkout gives an exact amount above the price and the treasury', intent && BigInt(intent.amountRaw) > 49_000_000n && BigInt(intent.amountRaw) < 49_010_000n && intent.treasury === TREASURY, JSON.stringify(intent))
  check('the same checkout comes back while open', (await dev.post('/api/developer/checkout', { plan: 'pro' })).data?.intent?.amountRaw === intent.amountRaw)
  const verify = (plan, txHash) => dev.post('/api/developer/checkout/verify', { plan, txHash })
  let r = await verify('pro', addTx({ token: OTHER_TOKEN, from: me, value: 49_000_000 }))
  check('refused: wrong token', r.status === 422 && /other than USDC/.test(r.data?.error), r.data?.error)
  r = await verify('pro', addTx({ from: me, to: stranger, value: 49_000_000 }))
  check('refused: wrong recipient', r.status === 422 && /not to the Gully Labs treasury/.test(r.data?.error), r.data?.error)
  r = await verify('pro', addTx({ from: me, value: 48_999_999 }))
  check('refused: too little', r.status === 422 && /costs 49 USDC/.test(r.data?.error), r.data?.error)
  r = await verify('pro', addTx({ from: me, value: 49_000_000, status: '0x0' }))
  check('refused: failed transaction', r.status === 422)
  r = await verify('pro', randHash())
  check('unknown transaction: 202, try again', r.status === 202 && r.data?.pending === true)
  r = await verify('pro', addTx({ from: me, value: 49_000_000, block: HEAD - 2 }))
  check('too few confirmations: 202 with the count', r.status === 202 && r.data?.confirmations === 3, r.data?.error)
  r = await verify('pro', addTx({ from: stranger, value: 49_000_000 }))
  check('refused: from another wallet without the exact checkout amount', r.status === 422, r.data?.error)
  r = await verify('pro', 'not-a-hash')
  check('refused: malformed hash', r.status === 400)

  const good = addTx({ from: me, value: 49_000_000 })
  r = await verify('pro', good)
  check('a good payment from the signed-in wallet buys Pro for 30 days', r.status === 200 && r.data.plan.id === 'pro' && Math.abs(Date.parse(r.data.plan.expiresAt) - Date.now() - 30 * day) < 60_000, r.data?.error)
  check('the paid plan applies to the key', (await lim()) === '3000')
  r = await verify('pro', good)
  check('refused: a reused transaction hash', r.status === 409, r.data?.error)
  r = await verify('pro', addTx({ from: me, value: 49_000_000 }))
  check('a second payment extends Pro from its end (60 days)', r.status === 200 && Math.abs(Date.parse(r.data.plan.expiresAt) - Date.now() - 60 * day) < 60_000)

  const bIntent = (await dev.post('/api/developer/checkout', { plan: 'business' })).data.intent
  r = await verify('business', addTx({ from: stranger, value: Number(bIntent.amountRaw), minedAt: Math.floor(Date.now() / 1000) - 3 * 86_400 }))
  check('refused: an exact-amount payment made before the checkout opened', r.status === 422, r.data?.error)
  r = await verify('business', addTx({ from: stranger, value: Number(bIntent.amountRaw) }))
  check('a payment from another wallet is matched by the exact checkout amount', r.status === 200 && r.data.plan.id === 'business', r.data?.error)
  const bill = await dev.call('/api/developer/billing')
  check('payment history lists the payments, newest first', bill.data?.payments?.length === 3 && bill.data.payments[0].plan === 'business' && bill.data.payments[0].amount === bIntent.amount)
  check('admin sees every payment', (await admin('/api/admin/billing')).data?.payments?.length === 3)
  check('a Business key reads 365 days', (await anon.call('/api/tracker/history?chain=robinhood&ticker=AAPL&days=365', { auth: key, useCookie: false })).status === 200)
} catch (e) {
  check(`no exception (${e?.stack ?? e})`, false)
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
rpcStub.close()
receiver.close()
try {
  fs.rmSync(tmp, { recursive: true, force: true })
} catch {
  /* temp dir */
}
process.exit(t.failed ? 1 : 0)
