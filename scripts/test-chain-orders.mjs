// Test of Create a chain's server side (server/chain-orders.mjs, quoteOrder in server/chains-plans.mjs): one test per step
// of the flow, plus failed payment, webhook replay, double order and status changes.
//
//   node scripts/test-chain-orders.mjs      (no build and no npm packages needed; TEST_PORT overrides the port, default 9183)
//
// The real server runs IN THIS PROCESS with a fresh temporary DATA_DIR, a fake Gully ID and a fake Gully Pay on local
// ports (chain-flow-mocks.mjs). Nothing here reaches a real payment service.

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deliver, fakeGullyId, fakeGullyPay, GP, sessionEvent } from './chain-flow-mocks.mjs'

const PORT = Number(process.env.TEST_PORT) || 9183
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-chain-orders-'))
const addr = (c) => '0x' + c.repeat(40)
const USERS = { 'tok-a': { sub: 'sub-a', address: addr('a') }, 'tok-b': { sub: 'sub-b', address: addr('b') }, 'tok-c': { sub: 'sub-c', address: addr('d') } }
const gid = await fakeGullyId(USERS)
const pay = await fakeGullyPay()
const ADMIN = crypto.randomBytes(24).toString('hex')

for (const k of ['TELEGRAM_BOT_TOKEN', 'MAINNET_ORDERS', 'MAINNET_PRICE_CONFIRMED', 'CHAIN_GULLYPAY_MODE', 'CHAIN_MAIL_API_KEY', 'CHAIN_MAIL_FROM']) delete process.env[k]
// The payment path needs a charge, so this file runs with one. The default of $0 has its own section at the end.
Object.assign(process.env, { CHAIN_TESTNET_TEST_CHARGE_USD: '1', PORT: String(PORT), DATA_DIR: tmp, TRACKER_DATA: path.join(tmp, 'tracker-history.json'), DIST_DIR: path.join(tmp, 'no-dist'), ADMIN_TOKEN: ADMIN, ADMIN_PASSWORD_LOGIN: 'on', TRACKER_LOOP: 'off', DEEPCORE_LOOP: 'off', TRACKER_SKIP_APIS: '1', ASK_REMOTE: 'off', CHAINLIST_URL: 'off', GULLY_ID_ISSUER: gid.url, GULLYPAY_API_URL: pay.url, GULLYPAY_CHECKOUT_URL: pay.url, CHAIN_GULLYPAY_MERCHANT_ID: GP.merchantId, CHAIN_GULLYPAY_STORE_ID: GP.storeId, CHAIN_GULLYPAY_API_KEY: GP.apiKey, CHAIN_GULLYPAY_WEBHOOK_SECRET: GP.secret })

await import('../server/server.mjs')
const orders = await import('../server/chain-orders.mjs')
const plans = await import('../server/chains-plans.mjs')
await new Promise((r) => setTimeout(r, 300))

let passed = 0
let failed = 0
const check = (name, ok, extra = '') => {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && extra !== '' ? `  (${typeof extra === 'string' ? extra : JSON.stringify(extra)})` : ''}`)
}
const watchdog = setTimeout(() => {
  console.error('watchdog: over 3 minutes')
  process.exit(2)
}, 180_000)
watchdog.unref()

function client() {
  let cookie = ''
  const call = async (p, { method = 'GET', body, headers = {} } = {}) => {
    const r = await fetch(BASE + p, { method, redirect: 'manual', headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await r.text()
    let data = null
    try {
      data = JSON.parse(text)
    } catch {
      /* not json */
    }
    return { status: r.status, data, headers: r.headers }
  }
  const post = (p, body = {}, headers = {}) => call(p, { method: 'POST', body, headers: { 'x-requested-with': 'gully', ...headers } })
  const signIn = async (accessToken) => {
    const r = await post('/api/developer/gully', { accessToken })
    cookie = (r.headers.get('set-cookie') ?? '').split(';')[0]
    return r
  }
  return { call, post, signIn, setCookie: (c) => (cookie = c) }
}

const admin = (p, opts = {}) => fetch(BASE + p, { ...opts, headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' } }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }))
const toStatus = (id, status, note) => admin(`/api/admin/chain-orders/${id}/status`, { method: 'POST', body: JSON.stringify({ status, note }) })

const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), crypto.randomBytes(40)]).toString('base64')
let nextId = 7_100_000
const good = (over = {}) => ({ tier: 'testnet', name: 'Acme Chain', chainId: ++nextId, gasToken: 'eth', parentChainId: 421614, addons: ['explorer', 'rpc'], email: 'Team@Example.com', expect: { dueCents: 100 }, ...over })

const A = client()
const B = client()
const S = (o) => pay.sessions.find((s) => s.clientReferenceId === `chain:${o.id}`)

try {
  /* ---- pricing: the one config ---- */
  const t = plans.quoteOrder('testnet', ['explorer', 'gully-core'])
  check('testnet: free 30 days, then 15% under the $250 published trial testnet', t.freeDays === 30 && t.monthlyUsd === 212.5 && t.headline === 'Free for 30 days')
  check('testnet: the checkout charge is a test amount in cents', t.dueCents === 100 && t.testCharge === true)
  const m = plans.quoteOrder('mainnet', ['explorer', 'multisig'])
  check('mainnet: $4,250 a month + 4.25% of sequencer profit, DA at cost', m.monthlyUsd === 4250 && m.dueCents === 425_000 && m.sequencerProfitPct === 4.25 && m.daAtCost === true)
  check('mainnet: a price-on-request add-on says so and adds nothing', m.priceWithUs === true)
  check('mainnet has no faucet; an unknown add-on and an unknown tier are refused', plans.quoteOrder('mainnet', ['faucet']) === null && plans.quoteOrder('testnet', ['nope']) === null && plans.quoteOrder('x') === null)
  check('every benchmark names a source; an unpublished price stays null', plans.PRICE_BENCHMARKS.sources.every((s) => /^https:/.test(s.url)) && plans.PRICE_BENCHMARKS.sources.filter((s) => s.published === null).length === 3)
  check('the unsourced mainnet base is flagged for the owner', /\$4,250/.test(plans.PRICE_BENCHMARKS.ownerToConfirm))

  /* ---- step 1: name, chain id check, gas token, logo ---- */
  const offer = (await A.call('/api/chain-orders/offer')).data
  check('offer: testnet on, mainnet off by default, test mode', offer.flags.testnetOrders === true && offer.flags.mainnetOrders === false && offer.checkout.mode === 'test' && offer.checkout.enabled === true)
  check('offer: seven add-ons and the Nitro licence note', offer.addons.length === 7 && /Arbitrum One, Arbitrum Nova or Arbitrum Sepolia/.test(offer.licenceNote))
  check('offer: no competitor or benchmark reaches a page', !/conduit|caldera/i.test(JSON.stringify(offer)))
  check('chain id: a free one', (await A.call('/api/chain-orders/check?chainId=7099999')).data.free === true)
  check('chain id: Gully Chain Testnet is reserved', (await A.call('/api/chain-orders/check?chainId=485590')).data.free === false)
  check('chain id: not a number', (await A.call('/api/chain-orders/check?chainId=abc')).data.free === false)
  await B.signIn('tok-b')
  check('wizard probe: signed out answers 200, false', (await A.call('/api/chain-orders/session')).data.gullyId === false)
  check('signed out: an order is 401 and names Gully ID', (await A.post('/api/chain-orders', good())).data?.code === 'gully-id-required')
  check('sign in with Gully ID works', (await A.signIn('tok-a')).status === 200)
  check('wizard probe: signed in', (await A.call('/api/chain-orders/session')).data.gullyId === true)
  const bad = async (over) => (await A.post('/api/chain-orders', good(over))).status
  check('step 1: a bad name is refused', (await bad({ name: '<script>' })) === 400)
  check('step 1: a chain id that is not a number is refused', (await bad({ chainId: '7' })) === 400)
  check('step 1: an unlisted gas token is refused', (await bad({ gasToken: 'doge' })) === 400)
  check('step 1: a custom gas token needs a symbol', (await bad({ gasToken: 'custom' })) === 400)
  check('step 1: SVG logos are refused', (await bad({ logo: 'data:image/svg+xml;base64,PHN2Zz4=' })) === 400)
  check('step 1: a logo must be the image it claims to be', (await bad({ logo: 'data:image/png;base64,AAAAAAAAAAAA' })) === 400)
  check('step 1: a logo over 96 KB is refused', (await bad({ logo: 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e47', 'hex'), Buffer.alloc(100_000)]).toString('base64') })) === 400)

  /* ---- step 2: tier, parents, add-ons ---- */
  check('step 2: a parent outside the free Nitro grant is refused', (await bad({ parentChainId: 8453 })) === 400)
  check('step 2: an unknown add-on is refused', (await bad({ addons: ['nope'] })) === 400)
  const off = await A.post('/api/chain-orders', good({ tier: 'mainnet', parentChainId: 42161, addons: [], expect: { dueCents: 425_000 } }))
  check('step 2: MAINNET_ORDERS off answers 403 mainnet-off', off.status === 403 && off.data.code === 'mainnet-off')
  process.env.MAINNET_ORDERS = 'on'
  const unconfirmed = await A.post('/api/chain-orders', good({ tier: 'mainnet', parentChainId: 42161, addons: [], expect: { dueCents: 425_000 } }))
  check('step 2: MAINNET_ORDERS alone stays shut: the owner has not confirmed the price', unconfirmed.data?.code === 'mainnet-off' && (await A.call('/api/chain-orders/offer')).data.flags.mainnetOrders === false)
  process.env.MAINNET_PRICE_CONFIRMED = 'on'
  const noLive = await A.post('/api/chain-orders', good({ tier: 'mainnet', parentChainId: 42161, addons: [], expect: { dueCents: 425_000 } }))
  check('step 2: mainnet with test payments is refused', noLive.status === 403 && noLive.data.code === 'mode-mismatch')
  delete process.env.MAINNET_ORDERS
  delete process.env.MAINNET_PRICE_CONFIRMED

  /* ---- step 3: price ---- */
  const q = await A.call('/api/chain-orders/quote?tier=testnet&addons=explorer,rpc')
  check('step 3: the quote endpoint answers the config', q.data.quote.dueCents === 100)
  check('step 3: a bad quote is 400', (await A.call('/api/chain-orders/quote?tier=testnet&addons=nope')).status === 400)
  const stale = await A.post('/api/chain-orders', good({ expect: { dueCents: 1 } }))
  check('step 3: a price the buyer did not see is 409 price-changed', stale.status === 409 && stale.data.code === 'price-changed' && stale.data.quote.dueCents === 100)
  const tampered = await A.post('/api/chain-orders', good({ dueCents: 1, quote: { dueCents: 1 } }))
  check('step 3: prices in the body are ignored', tampered.status === 201 && tampered.data.order.quote.dueCents === 100)

  /* ---- step 4: Gully ID ---- */
  const wallet = client()
  const store = await import('../server/store.mjs')
  store.touchAccount(addr('c'))
  wallet.setCookie(`gl_dev=${store.createSession(addr('c'))}`)
  check('step 4: a wallet session is not Gully ID', (await wallet.post('/api/chain-orders', good())).data?.code === 'gully-id-required')
  check('step 4: a POST without the CSRF header is refused', (await A.call('/api/chain-orders', { method: 'POST', body: good() })).status === 403)
  check('step 4: a POST from another site is refused', (await A.post('/api/chain-orders', good(), { origin: 'https://evil.example' })).status === 403)

  /* ---- step 5: Gully Pay ---- */
  const placed = await A.post('/api/chain-orders', good({ logo: PNG }))
  const o1 = placed.data.order
  check('step 5: order placed, awaiting payment, email lower-cased, logo kept', placed.status === 201 && o1.status === 'awaiting_payment' && o1.email === 'team@example.com' && o1.logo === PNG)
  check('step 5: the buyer view has no internal fields', !('address' in o1) && !('sessions' in o1) && !('review' in o1))
  check('step 5: another buyer gets 404', (await B.call(`/api/chain-orders/${o1.id}`)).status === 404)
  check('step 5: and cannot open its checkout', (await B.post(`/api/chain-orders/${o1.id}/checkout`)).status === 404)
  const c1 = await A.post(`/api/chain-orders/${o1.id}/checkout`)
  const s1 = S(o1)
  check('step 5: hosted checkout opened for the exact amount, on the chain store', c1.status === 200 && s1.amount === 100 && s1.currency === 'USD' && c1.data.payUrl.startsWith(pay.url))
  check('step 5: the return address is the order page', s1.successUrl.includes(`/create-chain/orders/${o1.id}`) && s1.cancelUrl.includes('checkout=cancelled'))
  const c2 = await A.post(`/api/chain-orders/${o1.id}/checkout`)
  check('step 5: a second press reuses the open session', c2.data.payUrl === c1.data.payUrl && pay.sessions.filter((s) => s.clientReferenceId === `chain:${o1.id}`).length === 1)
  check('step 5: the return page alone does not pay an order', (await A.call(`/api/chain-orders/${o1.id}?checkout=done`)).data.order.status === 'awaiting_payment')

  /* ---- webhook: signature ---- */
  const paid = sessionEvent('checkout.session.completed', s1)
  check('webhook: no signature is 401', (await deliver(BASE, paid, { sig: 'nope' })).status === 401)
  check('webhook: the wrong key is 401', (await deliver(BASE, paid, { key: 'x'.repeat(64) })).status === 401)
  check('webhook: a stale signature (10 minutes) is 401', (await deliver(BASE, paid, { t: Math.floor(Date.now() / 1000) - 600 })).status === 401)
  check('webhook: a changed body is 401', (await deliver(BASE, paid, { raw: JSON.stringify({ ...paid, id: 'x' }), sig: (await import('./chain-flow-mocks.mjs')).signature(JSON.stringify(paid), GP.secret) })).status === 401)
  check('webhook: an order stays unpaid after all of those', (await A.call(`/api/chain-orders/${o1.id}`)).data.order.status === 'awaiting_payment')
  const paidOk = await deliver(BASE, paid)
  const afterPaid = (await A.call(`/api/chain-orders/${o1.id}`)).data.order
  check('webhook: verified completed marks it paid', paidOk.status === 200 && paidOk.data.outcome === 'handled' && afterPaid.status === 'paid' && !!afterPaid.paidAt)

  /* ---- webhook replay ---- */
  const replay = await deliver(BASE, paid)
  const replayed = (await A.call(`/api/chain-orders/${o1.id}`)).data.order
  check('replay: the same event id is a duplicate, nothing changes', replay.status === 200 && replay.data.duplicate === true && replayed.history.length === afterPaid.history.length)
  const newId = await deliver(BASE, sessionEvent('checkout.session.completed', s1))
  check('replay: a new id for the same session changes nothing either', newId.status === 200 && (await A.call(`/api/chain-orders/${o1.id}`)).data.order.history.length === afterPaid.history.length)
  const onDisk = JSON.parse(fs.readFileSync(path.join(tmp, 'chain-orders.json'), 'utf8'))
  check('replay: the event ids survive a restart (on disk)', !!onDisk.events[paid.id])
  check('no card or key data on disk', !onDisk.orders.some((o) => JSON.stringify(o).includes(GP.apiKey)))

  /* ---- failed payment ---- */
  const f = (await A.post('/api/chain-orders', good())).data.order
  await A.post(`/api/chain-orders/${f.id}/checkout`)
  const fs1 = S(f)
  await deliver(BASE, sessionEvent('checkout.session.payment_failed', fs1, { status: 'open', failureReason: 'Your card was declined.' }))
  const failedView = (await A.call(`/api/chain-orders/${f.id}`)).data.order
  check('failed payment: the order stays unpaid and shows why', failedView.status === 'awaiting_payment' && failedView.payment.lastError === 'Your card was declined.')
  await deliver(BASE, sessionEvent('checkout.session.expired', fs1, { status: 'expired' }))
  const reopen = await A.post(`/api/chain-orders/${f.id}/checkout`)
  check('failed payment: after expiry a new session opens', reopen.status === 200 && pay.sessions.filter((s) => s.clientReferenceId === `chain:${f.id}`).length === 2)
  const fs2 = pay.sessions.filter((s) => s.clientReferenceId === `chain:${f.id}`)[1]
  await deliver(BASE, sessionEvent('checkout.session.completed', fs2))
  const nowPaid = (await A.call(`/api/chain-orders/${f.id}`)).data.order
  check('failed payment: paying the retry clears the error', nowPaid.status === 'paid' && nowPaid.payment.lastError === null)
  await deliver(BASE, sessionEvent('checkout.session.completed', fs1))
  const twice = (await admin('/api/admin/chain-orders')).data.orders.find((o) => o.id === f.id)
  check('two sessions both paid: the order holds for a refund, once', twice.review.filter((r) => r.code === 'second-payment').length === 1 && twice.status === 'paid')
  pay.state.failNext = true
  const down = (await A.post('/api/chain-orders', good())).data.order
  const gpDown = await A.post(`/api/chain-orders/${down.id}/checkout`)
  check('Gully Pay down: 502, nothing charged, the order can retry', gpDown.status === 502 && /Nothing was charged/.test(gpDown.data.error) && (await A.post(`/api/chain-orders/${down.id}/checkout`)).status === 200)

  /* ---- held payments ---- */
  const held = (await A.post('/api/chain-orders', good())).data.order
  await A.post(`/api/chain-orders/${held.id}/checkout`)
  await deliver(BASE, sessionEvent('checkout.session.completed', S(held), { paymentMethod: 'card', crypto: null }))
  const heldView = (await A.call(`/api/chain-orders/${held.id}`)).data.order
  check('test order paid by card: not marked paid, held for a person', heldView.status === 'awaiting_payment' && heldView.payment.onHold === true)
  const mains = (await A.post('/api/chain-orders', good())).data.order
  await A.post(`/api/chain-orders/${mains.id}/checkout`)
  await deliver(BASE, sessionEvent('checkout.session.completed', S(mains), { crypto: { chain: 'base', token: 'USDC', txHash: '0x1' } }))
  check('test order paid on a real chain: held', (await A.call(`/api/chain-orders/${mains.id}`)).data.order.payment.onHold === true)
  const wrong = (await A.post('/api/chain-orders', good())).data.order
  await A.post(`/api/chain-orders/${wrong.id}/checkout`)
  await deliver(BASE, sessionEvent('checkout.session.completed', S(wrong), { amount: 1 }))
  check('a paid amount that differs is held, not paid', (await A.call(`/api/chain-orders/${wrong.id}`)).data.order.status === 'awaiting_payment')
  const foreign = await deliver(BASE, sessionEvent('checkout.session.completed', S(wrong), { storeId: '33333333-3333-4333-8333-333333333333' }))
  check("another store's event is ignored", foreign.data.outcome === 'ignored')
  const unknown = await deliver(BASE, sessionEvent('checkout.session.completed', { sessionId: 'x', amount: 100, clientReferenceId: 'hd:other' }))
  check("another product's session is ignored", unknown.data.outcome === 'ignored')

  /* ---- five unpaid orders is the limit ---- */
  const sixth = await A.post('/api/chain-orders', good())
  check('a buyer holds at most five open orders', sixth.status === 429)
  for (const o of [tampered.data.order, held, mains, wrong]) await A.post(`/api/chain-orders/${o.id}/cancel`)

  /* ---- double order ---- */
  const dupId = ++nextId
  const [d1, d2] = await Promise.all([A.post('/api/chain-orders', good({ chainId: dupId })), A.post('/api/chain-orders', good({ chainId: dupId }))])
  const dupRows = (await A.call('/api/chain-orders')).data.orders.filter((o) => o.chainId === dupId)
  check('double order: two presses make one order', dupRows.length === 1 && [d1.status, d2.status].sort().join() === '200,201')
  check('double order: the second says duplicate', [d1, d2].some((r) => r.data.duplicate === true && r.data.order.id === dupRows[0].id))
  const taken = await B.post('/api/chain-orders', good({ chainId: dupId }))
  check('double order: another buyer gets 409 chain-taken', taken.status === 409 && taken.data.code === 'chain-taken')
  check('double order: the check shows it taken to others, free to its holder', (await B.call(`/api/chain-orders/check?chainId=${dupId}`)).data.free === false && (await A.call(`/api/chain-orders/check?chainId=${dupId}`)).data.free === true)
  const cancelled = await A.post(`/api/chain-orders/${dupRows[0].id}/cancel`)
  check('cancel before payment frees the id', cancelled.data.order.status === 'cancelled' && (await B.post('/api/chain-orders', good({ chainId: dupId }))).status === 201)
  check('a paid order cannot be cancelled by its buyer', (await A.post(`/api/chain-orders/${o1.id}/cancel`)).status === 409)

  /* ---- paid after cancel ---- */
  const late = (await A.post('/api/chain-orders', good())).data.order
  await A.post(`/api/chain-orders/${late.id}/checkout`)
  await A.post(`/api/chain-orders/${late.id}/cancel`)
  await deliver(BASE, sessionEvent('checkout.session.completed', S(late)))
  const lateView = (await admin('/api/admin/chain-orders')).data.orders.find((o) => o.id === late.id)
  check('paid after cancel: completed is final, reopened and flagged', lateView.status === 'paid' && lateView.review.some((r) => r.code === 'paid-after-cancel'))

  /* ---- status changes ---- */
  const mails = []
  orders.setChainMailFetchForTest(async (u, o) => (mails.push({ u, body: JSON.parse(o.body) }), { ok: true, status: 200 }))
  Object.assign(process.env, { CHAIN_MAIL_API_KEY: 'test-mail-key', CHAIN_MAIL_FROM: 'Gully Labs <orders@example.com>', CHAIN_MAIL_URL: 'http://localhost:1/none' })
  check('status: the admin list needs the admin', (await fetch(`${BASE}/api/admin/chain-orders`)).status === 401)
  check('status: an admin cannot mark an order paid', (await toStatus(down.id, 'paid')).status === 409)
  check('status: paid cannot jump to live', (await toStatus(o1.id, 'live')).status === 409)
  check('status: an unknown status is 400', (await toStatus(o1.id, 'done')).status === 400)
  check('status: an unknown order is 404', (await toStatus('co_nothinghere00', 'live')).status === 404)
  check('status: paid to setting up', (await toStatus(o1.id, 'setting_up', 'Box ordered')).data?.order?.status === 'setting_up')
  check('status: setting up to live', (await toStatus(o1.id, 'live')).data?.order?.status === 'live')
  const liveView = (await A.call(`/api/chain-orders/${o1.id}`)).data.order
  check('status: the buyer sees it live, with the whole history and the note', liveView.status === 'live' && liveView.history.map((h) => h.status).join() === 'awaiting_payment,paid,setting_up,live' && liveView.history[2].note === 'Box ordered')
  await new Promise((r) => setTimeout(r, 50))
  check('status: a mail per change, to the buyer', mails.length === 2 && mails.every((x) => x.body.to[0] === 'team@example.com') && /is live/.test(mails[1].body.subject) && mails[0].body.text.includes(`/create-chain/orders/${o1.id}`))
  check('status: cancelled is the end', (await toStatus(o1.id, 'cancelled')).status === 200 && (await toStatus(o1.id, 'live')).status === 409)

  /* ---- nothing due, reservation, limits, admin views ---- */
  const adminList = (await admin('/api/admin/chain-orders')).data
  check('admin: orders carry the wallet and the held reasons; the list has no logo bytes to the buyer', adminList.orders.length > 5 && adminList.orders.every((o) => /^0x/.test(o.address)))
  check('buyer list drops the logo', (await A.call('/api/chain-orders')).data.orders.every((o) => o.logo === null))
  const stay = (await A.post('/api/chain-orders', good())).data.order
  const raw = JSON.parse(fs.readFileSync(path.join(tmp, 'chain-orders.json'), 'utf8'))
  check('reservation: 7 days after creation an unpaid order is released', orders.sweepOrders(Date.parse(stay.createdAt) + 8 * 86_400_000) >= 1 && raw.orders.length > 0 && (await A.call(`/api/chain-orders/${stay.id}`)).data.order.status === 'cancelled')
  check('the session cookie is the only identity: another Gully ID sees nothing of mine', (await B.call('/api/chain-orders')).data.orders.every((o) => !o.id || o.chainId === dupId))
  const stop = (await import('../server/gullypay.mjs')).gullyPayEnabled
  delete process.env.CHAIN_GULLYPAY_API_KEY
  check('checkout off: the offer says so', (await A.call('/api/chain-orders/offer')).data.checkout.enabled === false && typeof stop === 'function')
  const cOff = await A.post('/api/chain-orders', good())
  check('checkout off: no order is left waiting', cOff.status === 503 && cOff.data.code === 'checkout-off')
  process.env.CHAIN_GULLYPAY_API_KEY = GP.apiKey
  delete process.env.CHAIN_GULLYPAY_WEBHOOK_SECRET
  check('no secret set: the webhook answers 503', (await deliver(BASE, paid)).status === 503)
  process.env.CHAIN_GULLYPAY_WEBHOOK_SECRET = GP.secret
  const src = fs.readFileSync(new URL('../server/chain-orders.mjs', import.meta.url), 'utf8')
  check('the secrets come from the environment only', !/rk_[a-z0-9]{8,}/i.test(src) && src.includes('CHAIN_GULLYPAY_WEBHOOK_SECRET'))
  /* ---- when the owner opens mainnet: both switches, a real amount, and a real rail counts as paid ---- */
  Object.assign(process.env, { MAINNET_ORDERS: 'on', MAINNET_PRICE_CONFIRMED: 'on', CHAIN_GULLYPAY_MODE: 'live' })
  const mo = await A.post('/api/chain-orders', good({ tier: 'mainnet', parentChainId: 42170, addons: ['explorer'], expect: { dueCents: 425_000 } }))
  check('mainnet on: an order for the first month, settling to Nova', mo.status === 201 && mo.data.order.quote.dueCents === 425_000 && mo.data.order.parent.name === 'Arbitrum Nova')
  await A.post(`/api/chain-orders/${mo.data.order.id}/checkout`)
  await deliver(BASE, sessionEvent('checkout.session.completed', S(mo.data.order), { paymentMethod: 'card', crypto: null }))
  check('mainnet on: a card payment marks a live order paid', (await A.call(`/api/chain-orders/${mo.data.order.id}`)).data.order.status === 'paid')
  check('mainnet on: testnet orders with a test charge pause, they never take real money', (await A.post('/api/chain-orders', good())).data?.code === 'mode-mismatch')
  delete process.env.MAINNET_ORDERS
  delete process.env.MAINNET_PRICE_CONFIRMED
  delete process.env.CHAIN_GULLYPAY_MODE

  /* ---- the default: no charge, no Gully Pay settings, the order is still recorded ---- */
  delete process.env.CHAIN_TESTNET_TEST_CHARGE_USD
  for (const k of ['CHAIN_GULLYPAY_STORE_ID', 'CHAIN_GULLYPAY_MERCHANT_ID', 'CHAIN_GULLYPAY_API_KEY', 'CHAIN_GULLYPAY_WEBHOOK_SECRET']) delete process.env[k]
  const zero = plans.quoteOrder('testnet', ['explorer'])
  check('default: a testnet order charges nothing', zero.dueCents === 0 && zero.testCharge === false)
  for (const v of ['-1', 'abc', '']) {
    process.env.CHAIN_TESTNET_TEST_CHARGE_USD = v
    check(`default: a charge of "${v}" is no charge`, plans.quoteOrder('testnet', []).dueCents === 0)
  }
  delete process.env.CHAIN_TESTNET_TEST_CHARGE_USD
  const shut = (await A.call('/api/chain-orders/offer')).data
  check('default: the offer says checkout is off and mainnet is shut', shut.checkout.enabled === false && shut.flags.mainnetOrders === false)
  const C = client()
  await C.signIn('tok-c')
  const sessionsBefore = pay.sessions.length
  const fz = await C.post('/api/chain-orders', good({ expect: { dueCents: 0 } }))
  check('default: the order is recorded, nothing charged, Gully Pay not called', fz.status === 201 && fz.data.order.status === 'paid' && fz.data.order.payment.dueCents === 0 && pay.sessions.length === sessionsBefore)
  check('default: the buyer sees Received, never Paid', fz.data.order.statusLabel === 'Received')
  check('default: a free order has no checkout', (await C.post(`/api/chain-orders/${fz.data.order.id}/checkout`)).status === 409 && pay.sessions.length === sessionsBefore)
  const fzRow = (await admin('/api/admin/chain-orders')).data.orders.find((o) => o.id === fz.data.order.id)
  check('default: the admin sees it as Received, ready to set up', fzRow.statusLabel === 'Received' && fzRow.next.includes('setting_up'))
  const fzGone = await C.post(`/api/chain-orders/${fz.data.order.id}/cancel`)
  check('default: the buyer can cancel a free order', fzGone.status === 200 && fzGone.data.order.status === 'cancelled')
  const five = []
  for (let i = 0; i < 5; i++) five.push(await C.post('/api/chain-orders', good({ expect: { dueCents: 0 } })))
  check('default: free orders count towards the limit of five', five.every((r) => r.status === 201) && (await C.post('/api/chain-orders', good({ expect: { dueCents: 0 } }))).status === 429)
  await toStatus(five[0].data.order.id, 'setting_up')
  check('default: once a person starts, the buyer cannot cancel', (await C.post(`/api/chain-orders/${five[0].data.order.id}/cancel`)).status === 409)
  const freeMails = []
  orders.setChainMailFetchForTest(async (u, o) => (freeMails.push(JSON.parse(o.body)), { ok: true, status: 200 }))
  await toStatus(five[0].data.order.id, 'live')
  await new Promise((r) => setTimeout(r, 50))
  check('default: a free order still gets its status mails', freeMails.length === 1 && /is live/.test(freeMails[0].subject))
  Object.assign(process.env, { CHAIN_GULLYPAY_MERCHANT_ID: GP.merchantId, CHAIN_GULLYPAY_STORE_ID: GP.storeId, CHAIN_GULLYPAY_API_KEY: GP.apiKey, CHAIN_GULLYPAY_WEBHOOK_SECRET: GP.secret, CHAIN_TESTNET_TEST_CHARGE_USD: '1' })

  const { pageMeta } = await import('../server/seo.mjs')
  check('pages: the wizard is indexable on the app host, an order is not', pageMeta('app.gullylabs.xyz', '/create-chain').found === true && !pageMeta('app.gullylabs.xyz', '/create-chain').noindex && pageMeta('app.gullylabs.xyz', '/create-chain/orders/co_x').noindex === true)
  check('pages: both answer 200 on localhost too, not a 404 document', pageMeta('localhost', '/create-chain').found === true && pageMeta('localhost', '/create-chain/orders/co_x').found === true)

  const page = (await fetch(`${BASE}/api/chains/plans`).then((r) => r.json())).mainnet
  check('/api/chains/plans follows the same config', page.fromUsdPerMonth === 4250 && page.sequencerProfitPct === 4.25)
} catch (e) {
  check(`no test threw (${e?.stack ?? e})`, false)
} finally {
  gid.close()
  pay.close()
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
