// Holder Map Deep check bought through Gully Pay (server/gullypay.mjs + server/holders-deep-routes.mjs), offline:
// a fake Gully Pay API runs in this process (hosted checkout sessions), webhooks are signed here with the test
// signing key exactly as Gully Pay signs them, and the Deep check engine is a stub. The real server runs IN THIS
// PROCESS on TEST_PORT (default 9052) with a fresh temporary DATA_DIR.
//
//   npm run test:holders-deep-gullypay        (no build needed)

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { guardTestRun, makeChecker, makeClient } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 9052
await guardTestRun(PORT)
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-holders-deep-gp-'))
const SIGNING_KEY = crypto.randomBytes(32).toString('hex')
const API_KEY = 'rk_test_' + crypto.randomBytes(12).toString('hex')
const STORE = crypto.randomUUID()
const MERCHANT = crypto.randomUUID()

/* ---- the fake Gully Pay API -------------------------------------------------------------------------- */
const gp = { calls: [], fail: false, expiresAt: () => new Date(Date.now() + 3_600_000).toISOString(), sessions: new Map() }
const fake = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const m = req.url.match(/^\/api\/checkout\/hosted\/([0-9a-f-]{36})$/)
    if (req.method !== 'POST' || !m) return res.writeHead(404).end('{}')
    const parsed = JSON.parse(body || '{}')
    gp.calls.push({ storeId: m[1], auth: req.headers.authorization, body: parsed })
    if (gp.fail) return res.writeHead(500, { 'content-type': 'application/json' }).end('{"message":"down"}')
    if (req.headers.authorization !== `Bearer ${API_KEY}`) return res.writeHead(401).end('{}')
    const sessionId = crypto.randomUUID()
    gp.sessions.set(sessionId, parsed)
    res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ sessionId, checkoutUrl: `https://checkout.gullypay.xyz/${sessionId}`, expiresAt: gp.expiresAt() }))
  })
})
await new Promise((r) => fake.listen(0, '127.0.0.1', r))
const FAKE = `http://127.0.0.1:${fake.address().port}/api`

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
  HOLDER_DEEP_RETRY_MS: '50',
  GULLYPAY_API_URL: FAKE,
  GULLYPAY_STORE_ID: STORE,
  GULLYPAY_MERCHANT_ID: MERCHANT,
  GULLYPAY_API_KEY: API_KEY,
  GULLYPAY_WEBHOOK_SIGNING_KEY: SIGNING_KEY,
  ...Object.fromEntries([1, 56, 8453, 42161, 10, 137, 43114, 4663, 999, 485590].map((id) => [`GULLY_RPC_${id}`, 'http://127.0.0.1:9'])),
})
for (const k of ['TELEGRAM_BOT_TOKEN', 'ANTHROPIC_API_KEY', 'TELEGRAM_ADMIN_CHAT_ID', 'BLOCKSCOUT_API_KEY', 'GULLY_RPC_SOLANA', 'GULLY_TREASURY_ADDRESS', 'HOLDER_DEEP_ACCEPT_CARDS', 'GULLYPAY_CONFIG_FILE']) delete process.env[k]

const { HOLDER_CHAINS } = await import('../server/holders.mjs')
const { HOLDER_DEEP } = await import('../server/plans.mjs')
await import('../server/server.mjs')
const routes = await import('../server/holders-deep-routes.mjs')
const gullypay = await import('../server/gullypay.mjs')
const billing = await import('../server/billing.mjs')
await new Promise((r) => setTimeout(r, 300))

const t = makeChecker()
const { check } = t
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const addr = (n) => '0x' + n.toString(16).padStart(40, '0')

let runs = 0
const stubReport = ({ chain, token }) => ({ version: 1, chain: { key: chain }, token: { address: token, symbol: 'TST', name: 'Test', url: '' }, generatedAt: new Date().toISOString(), status: 'done', partial: null, budget: null, base: { mapState: 'ok' }, sections: {}, findings: [{ id: 'f1', section: 'funding', text: 'stub', confidence: 'high', source: 'stub' }], unavailable: [], notes: [] })
routes.setDeepEngineForTest({ deps: { chains: HOLDER_CHAINS, explorerKey: () => 'k', archive: true }, limits: HOLDER_DEEP.budgets, run: async (a) => (runs++, stubReport(a)) })

const DEEP = '/api/holders/deep'
const HOOK = '/api/gullypay/webhook'
let ipN = 10
const anon = () => {
  const ip = `198.51.100.${ipN++}`
  const c = makeClient(BASE)
  return { ip, post: (p, b) => c.post(p, b, { headers: { 'cf-connecting-ip': ip } }), get: (p) => c.call(p, { headers: { 'cf-connecting-ip': ip } }) }
}
const get = (id) => fetch(`${BASE}${DEEP}/${id}`).then((r) => r.json()).then((j) => j.check)
const waitFor = async (id, until, ms = 8_000) => {
  const end = Date.now() + ms
  let last = null
  while (Date.now() < end) {
    last = await get(id)
    if (last && until(last)) return last
    await sleep(50)
  }
  return last
}
const finished = (c) => ['done', 'partial', 'failed'].includes(c.status)

/** A Gully Pay delivery: { id, type, created, data: { object } }, signed like dev-portal.service.ts attemptPost. */
function event(type, object, { id = crypto.randomUUID(), key = SIGNING_KEY, t = Math.floor(Date.now() / 1000), sig } = {}) {
  const raw = JSON.stringify({ id, type, created: new Date().toISOString(), data: { object } })
  const headers = { 'content-type': 'application/json', 'x-gullypay-event': type, 'x-gullypay-event-id': id }
  if (sig !== null) headers['x-gullypay-timestamped-signature'] = sig ?? gullypay.signForTest(raw, key, t)
  return { id, send: () => fetch(BASE + HOOK, { method: 'POST', headers, body: raw }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) })) }
}
const sessionObject = (check, over = {}) => ({ object: 'checkout.session', id: check.payment.sessionId, status: 'completed', storeId: STORE, merchantId: MERCHANT, amount: Math.round(check.priceUsd * 100), currency: 'USD', clientReferenceId: gp.sessions.get(check.payment.sessionId)?.clientReferenceId, paymentMethod: 'crypto', crypto: { chain: 'base', token: 'USDC', txHash: '0x' + 'ab'.repeat(32) }, occurredAt: new Date().toISOString(), ...over })

try {
  /* ---- offer and checkout ------------------------------------------------------------------------- */
  const GULLY_TOKEN = addr(0x48)
  const A = anon()
  {
    const g = await A.get(DEEP)
    check('GET: checkout on through Gully Pay (provider gullypay), Gully Chain offered', g.status === 200 && g.data.checkout.enabled === true && g.data.checkout.provider === 'gullypay' && !!g.data.coverage.gully)
    const q = await A.post(DEEP, { chain: 'gully', token: GULLY_TOKEN })
    check('quote for a Gully Chain token: 200, $9, provider gullypay, nothing created at Gully Pay', q.status === 200 && q.data.quote.priceUsd === 9 && q.data.quote.chain.id === 485590 && q.data.quote.checkout.provider === 'gullypay' && gp.calls.length === 0, `${q.status} ${JSON.stringify(q.data).slice(0, 200)}`)
    const qr = await A.post(DEEP, { chain: 'robinhood', token: addr(0x49) })
    check('quote on another chain (Robinhood): 200, $9', qr.status === 200 && qr.data.quote.priceUsd === 9)
  }

  let C1
  {
    const r = await A.post(DEEP, { chain: 'gully', token: GULLY_TOKEN, expect: { priceUsd: 9 } })
    C1 = r.data?.check
    const call = gp.calls.at(-1)
    check('confirmed: 202, awaiting payment, a Gully Pay hosted checkout (absolute URL, session id), no invoice', r.status === 202 && C1?.status === 'awaiting_payment' && r.data.payment.provider === 'gullypay' && r.data.payment.invoiceId === null && /^https:\/\/checkout\.gullypay\.xyz\/[0-9a-f-]{36}$/.test(r.data.payment.payUrl) && r.data.payment.usd === 9 && !!r.data.payment.expiresAt, JSON.stringify(r.data).slice(0, 300))
    check('the session was created for this store with the API key, 900 cents USD', call?.storeId === STORE && call.auth === `Bearer ${API_KEY}` && call.body.amount === 900 && call.body.currency === 'USD')
    check('clientReferenceId names the check, the chain id and the token; buyer returns to holdermaps.xyz/deep/<id>', call?.body.clientReferenceId === `hd:${C1.id}:485590:${GULLY_TOKEN}` && call.body.successUrl === `https://holdermaps.xyz/deep/${C1.id}` && call.body.cancelUrl === call.body.successUrl)
    const dup = await A.post(DEEP, { chain: 'gully', token: GULLY_TOKEN, expect: { priceUsd: 9 } })
    check('the same token again while unpaid: the same check, no second session', dup.status === 200 && dup.data.duplicate === true && dup.data.check.id === C1.id && gp.calls.length === 1)
    await sleep(300)
    const still = await get(C1.id)
    check('reading the check never unlocks it: still awaiting payment, no report, the engine did not run', still.status === 'awaiting_payment' && still.report === null && runs === 0 && still.payment.status === 'open')
  }

  /* ---- the webhook refuses what is not a verified, matching payment ---------------------------------- */
  {
    const obj = sessionObject(C1)
    check('webhook without a signature: 401', (await event('checkout.session.completed', obj, { sig: null }).send()).status === 401)
    check('webhook signed with another key: 401', (await event('checkout.session.completed', obj, { key: 'x'.repeat(64) }).send()).status === 401)
    check('webhook with a stale timestamp (400 s old): 401', (await event('checkout.session.completed', obj, { t: Math.floor(Date.now() / 1000) - 400 }).send()).status === 401)
    check('webhook with a v1 for another body (the signature only covers its own body): 401', (await event('checkout.session.completed', obj, { sig: gullypay.signForTest('{}', SIGNING_KEY) }).send()).status === 401)
    const wrongAmount = await event('checkout.session.completed', sessionObject(C1, { amount: 100 })).send()
    check('a completed session for the wrong amount: 200 ignored, not unlocked', wrongAmount.status === 200 && wrongAmount.data.outcome === 'ignored')
    const wrongCur = await event('checkout.session.completed', sessionObject(C1, { currency: 'EUR' })).send()
    check('a completed session in another currency: ignored', wrongCur.data?.outcome === 'ignored')
    const testnet = await event('checkout.session.completed', sessionObject(C1, { crypto: { chain: 'gully-chain-testnet', token: 'USDC.e', txHash: '0x' + '11'.repeat(32) } })).send()
    check('paid with a TESTNET coin: ignored, never unlocks a paid check', testnet.data?.outcome === 'ignored')
    const card = await event('checkout.session.completed', sessionObject(C1, { paymentMethod: 'card', crypto: null })).send()
    check('a card payment while cards run on the Stripe mock: ignored', card.data?.outcome === 'ignored')
    const otherSession = await event('checkout.session.completed', sessionObject(C1, { id: crypto.randomUUID() })).send()
    check('the right reference with another session id: ignored', otherSession.data?.outcome === 'ignored')
    const foreign = await event('checkout.session.completed', sessionObject(C1, { merchantId: crypto.randomUUID() })).send()
    check('another merchant\'s session: ignored (foreign)', foreign.data?.outcome === 'foreign')
    const otherStore = await event('checkout.session.completed', sessionObject(C1, { storeId: crypto.randomUUID() })).send()
    check('another store\'s session: ignored (foreign)', otherStore.data?.outcome === 'foreign')
    const pending = await event('checkout.session.completed', sessionObject(C1, { status: 'open' })).send()
    check('an event whose session is not completed: ignored', pending.data?.outcome === 'ignored')
    check('not JSON (signed): 400', (await fetch(BASE + HOOK, { method: 'POST', headers: { 'x-gullypay-event-id': 'e1', 'x-gullypay-timestamped-signature': gullypay.signForTest('nope', SIGNING_KEY) }, body: 'nope' })).status === 400)
    check('GET on the webhook: 405', (await fetch(BASE + HOOK)).status === 405)
    await sleep(200)
    const c = await get(C1.id)
    check('after all of that the check is still awaiting payment and nothing ran', c.status === 'awaiting_payment' && runs === 0 && c.payment.status === 'open')
  }

  /* ---- a verified payment unlocks it, once ------------------------------------------------------------- */
  {
    const ev = event('checkout.session.completed', sessionObject(C1))
    const [a, b] = await Promise.all([ev.send(), ev.send()])
    const outcomes = [a.data?.duplicate === true, b.data?.duplicate === true].filter(Boolean).length
    check('the verified completed event: 200 handled; the same event delivered twice at once is handled once', a.status === 200 && b.status === 200 && outcomes === 1 && [a, b].some((x) => x.data?.outcome === 'handled'), JSON.stringify([a, b]))
    const done = await waitFor(C1.id, finished)
    check('the paid check runs and finishes with its report', done?.status === 'done' && done.report?.status === 'done' && runs === 1 && done.payment.status === 'paid')
    const replay = await ev.send()
    check('replaying the event id later: 200 duplicate, nothing runs again', replay.status === 200 && replay.data.duplicate === true && runs === 1)
    const again = await event('checkout.session.completed', sessionObject(C1)).send()
    await sleep(200)
    check('a second, distinct completed event for the same session changes nothing', again.status === 200 && runs === 1 && (await get(C1.id)).status === 'done')
    const log = JSON.parse(fs.readFileSync(path.join(tmp, 'gullypay-events.json'), 'utf8'))
    check('the event ids are kept on disk (idempotent across a restart)', !!log[ev.id] && log[ev.id].outcome === 'handled')
    gullypay.resetGullyPayForTest()
    const afterRestart = await ev.send()
    check('after the in-memory log is dropped the same event id is still a duplicate', afterRestart.data?.duplicate === true && runs === 1)
  }

  /* ---- Gully Pay down: nothing stored or charged ---------------------------------------------------- */
  {
    const B = anon()
    gp.fail = true
    const r = await B.post(DEEP, { chain: 'base', token: addr(0xb1), expect: { priceUsd: 9 } })
    gp.fail = false
    check('Gully Pay answers 500: 502 checkout-unavailable, says nothing was charged', r.status === 502 && r.data.code === 'checkout-unavailable' && /Nothing was charged/.test(r.data.error))
    const r2 = await B.post(DEEP, { chain: 'base', token: addr(0xb1), expect: { priceUsd: 9 } })
    check('and no check was stored: the next try creates a fresh one (not a duplicate)', r2.status === 202 && !r2.data.duplicate)
  }

  /* ---- expiry, late payment, cancel ------------------------------------------------------------------ */
  {
    const E = anon()
    const r = await E.post(DEEP, { chain: 'gully', token: addr(0xe1), expect: { priceUsd: 9 } })
    const ck = r.data.check
    const exp = await event('checkout.session.expired', { ...sessionObject(ck), status: 'expired', crypto: null, paymentMethod: null }).send()
    const c1 = await get(ck.id)
    check('checkout.session.expired cancels the unpaid check (unpaid-expired)', exp.data?.outcome === 'handled' && c1.status === 'cancelled' && c1.cancelReason === 'unpaid-expired')
    const late = await event('checkout.session.completed', sessionObject(ck)).send()
    const c2 = await waitFor(ck.id, finished)
    check('a completed payment that arrives after the expiry still runs the check (the buyer paid)', late.data?.outcome === 'handled' && c2.status === 'done')

    const K = anon()
    const rk = await K.post(DEEP, { chain: 'base', token: addr(0xe2), expect: { priceUsd: 9 } })
    const stranger = await anon().post(`${DEEP}/${rk.data.check.id}/cancel`)
    check('someone else cannot cancel it (403)', stranger.status === 403)
    const cancel = await K.post(`${DEEP}/${rk.data.check.id}/cancel`)
    check('the buyer cancels before paying: 200 cancelled', cancel.status === 200 && cancel.data.check.status === 'cancelled')
    await event('checkout.session.completed', sessionObject(rk.data.check)).send()
    check('paid anyway after cancelling: the check runs (money is never lost)', (await waitFor(rk.data.check.id, finished))?.status === 'done')
    const paidCancel = await K.post(`${DEEP}/${rk.data.check.id}/cancel`)
    check('a paid, finished check cannot be cancelled (409)', paidCancel.status === 409)

    const S = anon()
    gp.expiresAt = () => new Date(Date.now() - 3 * 3_600_000).toISOString()
    const rs = await S.post(DEEP, { chain: 'base', token: addr(0xe3), expect: { priceUsd: 9 } })
    gp.expiresAt = () => new Date(Date.now() + 3_600_000).toISOString()
    const fresh = await S.post(DEEP, { chain: 'base', token: addr(0xe4), expect: { priceUsd: 9 } })
    const swept = routes.sweepDeep()
    check('the sweep gives up on a Gully Pay check only well after its session expired', swept.includes(rs.data.check.id) && !swept.includes(fresh.data.check.id) && (await get(fresh.data.check.id)).status === 'awaiting_payment')
  }

  /* ---- plan subscribers: 3 free a month, counted on the server ------------------------------------- */
  {
    const w = privateKeyToAccount(generatePrivateKey())
    const sub = makeClient(BASE)
    if ((await sub.signIn(w)).status !== 200) throw new Error('sign-in failed')
    billing.adminSetPlan(w.address.toLowerCase(), 'pro', 30)
    const before = gp.calls.length
    for (let i = 0; i < 3; i++) {
      const r = await sub.post(DEEP, { chain: 'gully', token: addr(0x500 + i), expect: { priceUsd: 0 } })
      check(`Pro free check ${i + 1}: 201, free, no payment, no Gully Pay session`, r.status === 201 && r.data.check.free === true && r.data.check.payment === null && gp.calls.length === before)
      await waitFor(r.data.check.id, finished)
    }
    const forged = await sub.post(DEEP, { chain: 'gully', token: addr(0x503), expect: { priceUsd: 0 } })
    check('a 4th "free" confirmation: 409 price-changed (the quota is the server\'s count, not the client\'s)', forged.status === 409 && forged.data.code === 'price-changed' && forged.data.quote.quota.used === 3 && forged.data.quote.quota.left === 0)
    const paid = await sub.post(DEEP, { chain: 'gully', token: addr(0x503), expect: { priceUsd: 9 } })
    check('the 4th check this month is $9 through Gully Pay', paid.status === 202 && paid.data.payment.provider === 'gullypay' && gp.calls.length === before + 1)
  }

  /* ---- not configured ------------------------------------------------------------------------------- */
  {
    delete process.env.GULLYPAY_WEBHOOK_SIGNING_KEY
    const g = await anon().get(DEEP)
    check('without Gully Pay (and no treasury): checkout off, provider invoice', g.data.checkout.enabled === false && g.data.checkout.provider === 'invoice')
    check('without a signing key the webhook answers 503', (await event('checkout.session.completed', {}).send()).status === 503)
    // The config file path (the box keeps the secrets in a mode-600 file, not in env).
    const f = path.join(tmp, 'secrets', 'gullypay.json')
    fs.mkdirSync(path.dirname(f), { recursive: true })
    for (const k of ['GULLYPAY_API_URL', 'GULLYPAY_STORE_ID', 'GULLYPAY_MERCHANT_ID', 'GULLYPAY_API_KEY']) delete process.env[k]
    fs.writeFileSync(f, JSON.stringify({ apiUrl: FAKE, merchantId: MERCHANT, storeId: STORE, apiKey: API_KEY, webhookSigningKey: SIGNING_KEY }), { mode: 0o600 })
    const g2 = await anon().get(DEEP)
    check('the secrets file in DATA_DIR/secrets/gullypay.json switches Gully Pay on without a restart', g2.data.checkout.provider === 'gullypay' && g2.data.checkout.enabled === true)
    const r = await anon().post(DEEP, { chain: 'base', token: addr(0xf1), expect: { priceUsd: 9 } })
    check('and checks are sold through it', r.status === 202 && r.data.payment.provider === 'gullypay')
  }
} catch (e) {
  check(`no exception (${String(e?.stack ?? e).split('\n').slice(0, 4).join(' | ')})`, false)
}

fake.close()
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${t.passed} passed, ${t.failed} failed`)
process.exit(t.failed ? 1 : 0)
