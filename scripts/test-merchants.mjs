// End-to-end test of Gully Pay for merchants (server/merchants.mjs, server/merchant-fees.mjs).
//
//   node scripts/test-merchants.mjs        (npm run test:merchants; no build needed, it tests the API)
//
// Same approach as test-pay.mjs and test-paylinks.mjs: the real server runs IN THIS PROCESS on TEST_PORT
// (default 8796) with a fresh temporary DATA_DIR; every chain is a local JSON-RPC stub (GULLY_RPC_<chainId>)
// that also answers eth_getCode, so wallets can be EOAs, deployed Safes, undeployed Safes or EIP-7702 EOAs.
// Throwaway wallets sign in with SIWE like test-siwe.mjs. The merchant's webhook endpoint and logo host are
// local HTTP servers (loopback allowed for tests only). Timers are off; the test drives the queue and ticks.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { getAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { makeChecker, makeClient } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8796
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-merchants-'))
const ADMIN = crypto.randomBytes(24).toString('hex')
const TREASURY = privateKeyToAccount(generatePrivateKey()).address.toLowerCase()
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const USDC = { 8453: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 56: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', 1: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' }
const FEEDS = { 8453: '0x71041dddad3595f9ced3dccfbe3d1f4b0a16bb70', 1: '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419', 56: '0x0567f2323251f0aab15c8dfb1967e4e8a7d42aee', 42161: '0x639fe6ab55c921f74e7fac1ee960c0b6293ba612' }

const t = makeChecker()
const { check } = t

/* ---------------------------------------------------------- chain stubs --- */

const pad = (a) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0')
const hex = (n) => '0x' + BigInt(n).toString(16)
const word = (n) => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0')
const randHash = () => '0x' + crypto.randomBytes(32).toString('hex')
const nowSec = () => Math.floor(Date.now() / 1000)

function makeChain(chainId, answer) {
  const c = { chainId, head: 5_000_000, receipts: new Map(), txs: new Map(), blocks: new Map(), code: new Map(), feed: { roundId: 777n, answer, updatedAt: nowSec() - 60 } }
  c.add = ({ hash = randHash(), from, to, value, token = null, block = c.head - 30, minedAt = nowSec() }) => {
    c.blocks.set(block, minedAt)
    const logs = token ? [{ address: token, topics: [TRANSFER, pad(from), pad(to)], data: pad(hex(value)) }] : []
    c.receipts.set(hash, { transactionHash: hash, status: '0x1', blockNumber: hex(block), from, logs })
    c.txs.set(hash, { hash, from, to: token ?? to, value: token ? '0x0' : hex(value), blockNumber: hex(block), chainId: hex(chainId) })
    return hash
  }
  c.server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      const q = JSON.parse(body)
      let result = null
      if (q.method === 'eth_chainId') result = hex(chainId)
      else if (q.method === 'eth_blockNumber') result = hex(c.head)
      else if (q.method === 'eth_getCode') result = c.code.get(String(q.params[0]).toLowerCase()) ?? '0x'
      else if (q.method === 'eth_getTransactionReceipt') result = c.receipts.get(q.params[0]) ?? null
      else if (q.method === 'eth_getTransactionByHash') result = c.txs.get(q.params[0]) ?? null
      else if (q.method === 'eth_getBlockByNumber') {
        const n = Number(BigInt(q.params[0]))
        result = c.blocks.has(n) ? { number: q.params[0], timestamp: hex(c.blocks.get(n)) } : null
      } else if (q.method === 'eth_call' && q.params[0].to.toLowerCase() === FEEDS[chainId] && q.params[0].data === '0xfeaf968c') {
        const f = c.feed
        result = '0x' + word(f.roundId) + word(f.answer) + word(f.updatedAt) + word(f.updatedAt) + word(f.roundId)
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }))
    })
  })
  return c
}

const chains = { 8453: makeChain(8453, 2_400_00000000n), 1: makeChain(1, 2_500_00000000n), 56: makeChain(56, 700_00000000n), 42161: makeChain(42161, 2_450_00000000n) }
for (const c of Object.values(chains)) await new Promise((r) => c.server.listen(0, '127.0.0.1', r))

/* ------------------------------------------- webhook receiver, logo host --- */

const hook = { status: 200, got: [] }
hook.server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    hook.got.push({ path: req.url, headers: req.headers, body })
    res.writeHead(hook.status)
    res.end()
  })
})
await new Promise((r) => hook.server.listen(0, '127.0.0.1', r))
const HOOK = (p = '/hook') => `http://127.0.0.1:${hook.server.address().port}${p}`

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const logoHost = http.createServer((req, res) => {
  if (req.url === '/logo.png') return res.writeHead(200, { 'content-type': 'image/png' }), res.end(PNG)
  if (req.url === '/big.png') return res.writeHead(200, { 'content-type': 'image/png' }), res.end(Buffer.concat([PNG, Buffer.alloc(300 * 1024)]))
  if (req.url === '/page.html') return res.writeHead(200, { 'content-type': 'text/html' }), res.end('<html><script>alert(1)</script></html>')
  res.writeHead(404)
  res.end()
})
await new Promise((r) => logoHost.listen(0, '127.0.0.1', r))
const LOGO = (p) => `http://127.0.0.1:${logoHost.address().port}${p}`

function verifies(req, secret) {
  const ts = req.headers['x-gully-timestamp'] ?? ''
  const sig = req.headers['x-gully-signature'] ?? ''
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${req.body}`).digest('hex')
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
}

/* ------------------------------------------------------------ start server --- */

const CHAIN_ENV = Object.fromEntries(Object.values(chains).map((c) => [`GULLY_RPC_${c.chainId}`, `http://127.0.0.1:${c.server.address().port}`]))
Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: path.join(tmp, 'no-dist'),
  ADMIN_TOKEN: ADMIN,
  TRACKER_LOOP: 'off',
  GULLY_TREASURY_ADDRESS: TREASURY,
  GULLY_ALLOW_LOOPBACK_WEBHOOKS: '1',
  GULLY_PAY_WEBHOOK_TICK_MS: '0',
  GULLY_PAY_WEBHOOK_DELAYS_MS: '100,200,300,400,500',
  GULLY_MERCHANT_TICK_MS: '0',
  GULLY_PAY_MERCHANT_FEE_BPS: '50',
  GULLY_PAY_MERCHANT_FREE_USD: '5000',
  ...CHAIN_ENV,
})
delete process.env.GULLY_BASE_RPC
delete process.env.GULLY_MIN_CONFIRMATIONS
delete process.env.TELEGRAM_BOT_TOKEN
await import('../server/server.mjs')
const M = await import('../server/merchants.mjs')
const { processDue } = await import('../server/pay-webhooks.mjs')
await new Promise((r) => setTimeout(r, 300))

const notices = []
M.setMerchantNotifierForTest((ws, text) => notices.push({ ws, text }))

const acct = () => privateKeyToAccount(generatePrivateKey())
const owner = acct()
const OW = owner.address.toLowerCase()
const O = makeClient(BASE)
const anon = makeClient(BASE)
const admin = (p, method = 'GET', body) => fetch(BASE + p, { method, headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }))
const asIp = (ip) => ({ headers: { 'cf-connecting-ip': ip } })
let ipN = 10
const payPost = (p, body) => anon.post(p, body, asIp(`198.51.100.${ipN++ % 250}`))
const usdcRaw = (q) => BigInt(q.amountRaw)

/** Pays a store quote (USDC) from a fresh payer to `to` on the quote's chain. Returns the tx hash. */
function sendUsdc(q, to = q.treasury, value = usdcRaw(q)) {
  const c = chains[q.chainId]
  return c.add({ from: acct().address.toLowerCase(), to, value, token: USDC[q.chainId] })
}

/** Opens a store invoice, quotes base-usdc and pays it to the store's wallet. */
async function payInvoice(id, asset = 'base-usdc') {
  const q = (await payPost(`/api/pay/m/i/${id}/quote`, { asset })).data?.quote
  const h = sendUsdc(q)
  const v = await payPost(`/api/pay/m/i/${id}/verify`, { quoteId: q.id, txHash: h })
  return { q, h, v }
}

try {
  /* ----------------------------------------------------------- sign in --- */
  check('owner signs in (SIWE)', (await O.signIn(owner)).status === 200)
  const team = {}
  for (const role of ['developer', 'billing', 'viewer']) {
    const a = acct()
    const c = makeClient(BASE)
    await c.signIn(a)
    const inv = await O.post('/api/developer/team/invite', { role, address: a.address.toLowerCase() })
    const acc = await c.post('/api/developer/invite/accept', { inviteId: inv.data?.invite?.id })
    check(`a ${role} joins the owner's workspace`, acc.status === 200, acc.data?.error)
    team[role] = c
  }
  const outsider = makeClient(BASE)
  await outsider.signIn(acct())

  const empty = await O.call('/api/developer/merchant')
  check('GET /merchant: an empty store, not ready, with the non-custodial line', empty.status === 200 && empty.data.ready === false && empty.data.wallets.length === 0 && /Gully Labs never holds your funds/.test(empty.data.nonCustodial), empty.data?.error)
  check('fees: 0.5% after a $5,000 free allowance', empty.data.fees.bps === 50 && empty.data.fees.freeUsd === 5000 && empty.data.fees.freeLeftUsd === 5000)

  /* --------------------------------------------------------------- roles --- */
  check('roles: a viewer reads the store', (await team.viewer.call('/api/developer/merchant')).status === 200)
  check('roles: a viewer cannot change the profile (403)', (await team.viewer.post('/api/developer/merchant/profile', { name: 'X' })).status === 403)
  check('roles: a developer cannot set wallets (403)', (await team.developer.post('/api/developer/merchant/wallets', { address: owner.address, type: 'eoa', chains: [8453] })).status === 403)
  check('roles: a developer cannot make invoices (403)', (await team.developer.post('/api/developer/merchant/invoices', { items: [{ description: 'x', unitUsd: '1' }], dueDate: '2099-01-01' })).status === 403)
  check('roles: a viewer cannot make links (403)', (await team.viewer.post('/api/developer/merchant/links', { title: 'x', amount: { type: 'fixed', usd: '1' } })).status === 403)
  check('roles: a viewer cannot set the webhook (403)', (await team.viewer.post('/api/developer/merchant/webhook', { url: HOOK() })).status === 403)
  check('roles: signed out is 401', (await anon.call('/api/developer/merchant')).status === 401)

  /* ------------------------------------------------------------- wallets --- */
  const eoa = acct().address // EIP-55 from viem
  const wbad = async (name, body, want = 400) => {
    const r = await O.post('/api/developer/merchant/wallets', body)
    check(`wallet refused: ${name} (${want})`, r.status === want, r.data?.error)
    return r
  }
  await wbad('all lower case (no checksum)', { address: eoa.toLowerCase(), type: 'eoa', chains: [8453] })
  const flipped = eoa.slice(0, 2) + [...eoa.slice(2)].map((ch, i) => (i === [...eoa.slice(2)].findIndex((x) => /[a-fA-F]/.test(x)) ? (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()) : ch)).join('')
  await wbad('a wrong EIP-55 checksum', { address: flipped, type: 'eoa', chains: [8453] })
  await wbad("Gully Labs' own treasury", { address: getAddress(TREASURY), type: 'eoa', chains: [8453] })
  await wbad('an unknown chain', { address: eoa, type: 'eoa', chains: [10] })
  await wbad('no type', { address: eoa, chains: [8453] })

  // A Safe deployed on Base only.
  const safe = acct().address
  chains[8453].code.set(safe.toLowerCase(), '0x608060405234801561001057600080fd5b50')
  const sres = await O.post('/api/developer/merchant/wallets', { address: safe, type: 'contract', chains: [8453, 56] })
  const sBase = sres.data?.results?.find((x) => x.chainId === 8453)
  const sBnb = sres.data?.results?.find((x) => x.chainId === 56)
  check('a deployed Safe on Base is a contract and enabled', sres.status === 200 && sBase?.ok && sBase.wallet.kind === 'contract' && sBase.wallet.enabled, JSON.stringify(sres.data?.results))
  check('the same Safe on BNB Chain is NOT deployed there: refused, stored disabled', sBnb && !sBnb.ok && /no contract is deployed/i.test(sBnb.error) && sBnb.wallet.enabled === false && sBnb.wallet.status === 'not-deployed')
  check('enabling the undeployed chain is refused (422)', (await O.post('/api/developer/merchant/wallets/56', { enabled: true })).status === 422)
  // Declared "eoa", but it is a contract on Base: it is still not deployed on Ethereum, refused.
  const sEth = await O.post('/api/developer/merchant/wallets', { address: safe, type: 'eoa', chains: [1] })
  check('a contract elsewhere with no code here is refused even when declared an EOA', sEth.status === 422 && /contract on Base/.test(sEth.data?.error ?? ''), sEth.data?.error)
  const counterfactual = acct().address
  const cf = await O.post('/api/developer/merchant/wallets', { address: counterfactual, type: 'contract', chains: [42161] })
  check('a declared contract with no code anywhere is refused (422)', cf.status === 422, cf.data?.error)
  // Deploy on BNB Chain, check again: enabled.
  chains[56].code.set(safe.toLowerCase(), '0x6080')
  const recheck = await O.post('/api/developer/merchant/wallets/56/check', {})
  check('after deploying, "check again" enables the chain', recheck.status === 200 && recheck.data.wallet?.enabled === true && recheck.data.wallet.kind === 'contract', recheck.data?.error)
  // An EIP-7702 delegated EOA counts as an EOA with code.
  const e7702 = acct().address
  chains[1].code.set(e7702.toLowerCase(), '0xef0100' + 'ab'.repeat(20))
  const r7702 = await O.post('/api/developer/merchant/wallets', { address: e7702, type: 'eoa', chains: [1] })
  check('an EIP-7702 delegated EOA is accepted and shown as such', r7702.status === 200 && r7702.data.results[0].wallet.kind === 'eoa-7702')
  // The store's real wallet: one EOA on Base, Ethereum and BNB Chain (the same address on every chain is allowed).
  const wr = await O.post('/api/developer/merchant/wallets', { address: eoa, type: 'eoa', chains: [8453, 1, 56] })
  check('the same EOA on three chains: all enabled', wr.status === 200 && wr.data.results.every((x) => x.ok && x.wallet.kind === 'eoa' && x.wallet.enabled), wr.data?.error)
  await O.post('/api/developer/merchant/wallets/42161/remove', {})
  const MW = eoa.toLowerCase()
  check('the store is ready', (await O.call('/api/developer/merchant')).data.ready === true)

  /* ------------------------------------------------------------- profile --- */
  check('profile: a non-https logo host that is not loopback is refused', (await O.post('/api/developer/merchant/profile', { logoUrl: 'http://example.com/logo.png' })).status === 400)
  check('profile: an HTML page is not a logo (400)', (await O.post('/api/developer/merchant/profile', { logoUrl: LOGO('/page.html') })).status === 400)
  check('profile: a logo over 256 KB is refused (400)', (await O.post('/api/developer/merchant/profile', { logoUrl: LOGO('/big.png') })).status === 400)
  check('profile: a bad accent is refused (400)', (await O.post('/api/developer/merchant/profile', { accent: 'red' })).status === 400)
  const prof = await team.billing.post('/api/developer/merchant/profile', { name: 'Acme Coffee', logoUrl: LOGO('/logo.png'), accent: '#3FA7D6', supportEmail: 'Help@Acme.example', website: 'https://acme.example' })
  check('profile: billing sets name, logo (fetched and stored), accent, email, website', prof.status === 200 && prof.data.profile.name === 'Acme Coffee' && /^\/api\/pay\/m\/logo\/[0-9a-f]{32}$/.test(prof.data.profile.logoUrl ?? '') && prof.data.profile.accent === '#3fa7d6' && prof.data.profile.supportEmail === 'help@acme.example', prof.data?.error)
  const logoRes = await fetch(BASE + prof.data.profile.logoUrl)
  const logoBuf = Buffer.from(await logoRes.arrayBuffer())
  check('the logo is served from our origin, as an image, nosniff', logoRes.status === 200 && logoRes.headers.get('content-type') === 'image/png' && logoRes.headers.get('x-content-type-options') === 'nosniff' && logoBuf.equals(PNG))

  /* ------------------------------------------------------------ webhook --- */
  const wh = await team.developer.post('/api/developer/merchant/webhook', { url: HOOK('/store') })
  const SECRET = wh.data?.secret
  check('a developer sets the store webhook; the secret is shown once', wh.status === 200 && /^whsec_/.test(SECRET ?? ''))
  check('the store view never shows the secret', !JSON.stringify((await O.call('/api/developer/merchant')).data).includes('whsec_'))
  check('SSRF: a private webhook address is refused', (await O.post('/api/developer/merchant/webhook', { url: 'https://10.0.0.1/hook' })).status === 400)
  const tst = await O.post('/api/developer/merchant/webhook/test', {})
  const tReq = hook.got.at(-1)
  check('test event delivered, signed with the store secret', tst.status === 200 && tst.data.delivery.state === 'delivered' && verifies(tReq, SECRET) && JSON.parse(tReq.body).type === 'webhook.test')

  /* --------------------------------------------------------- links, invoices --- */
  const lk = await team.developer.post('/api/developer/merchant/links', { title: 'Bag of beans', description: '1 kg, whole bean.', amount: { type: 'fixed', usd: '200' }, assets: ['base-usdc', 'bnb-usdc', 'arb-usdc'], maxUses: 50 })
  const link = lk.data?.link
  check('a developer makes a fixed pay link', lk.status === 201 && /^ml_[\w-]{16}$/.test(link?.id) && link.path === `/pay/m/l/${link.id}`, lk.data?.error)
  const openLk = await O.post('/api/developer/merchant/links', { title: 'Tip jar', amount: { type: 'open', min: '1', max: '500' } })
  check('the owner makes an open-amount link', openLk.status === 201 && openLk.data.link.amount.type === 'open')
  check('links: a minimum above the maximum is refused', (await O.post('/api/developer/merchant/links', { title: 'x', amount: { type: 'open', min: '9', max: '1' } })).status === 400)
  const pubLink = await anon.call(`/api/pay/m/l/${link.id}`)
  check('the public link shows the store branding and only chains with a wallet', pubLink.status === 200 && pubLink.data.link.merchant.name === 'Acme Coffee' && pubLink.data.link.merchant.accent === '#3fa7d6' && pubLink.data.link.assets.map((a) => a.id).join() === 'base-usdc,bnb-usdc' && pubLink.data.link.checkout.enabled === true)

  const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
  const ib = await O.post('/api/developer/merchant/invoices', { items: [{ description: 'Espresso machine', quantity: 1, unitUsd: '4800' }, { description: 'Descaler', quantity: 4, unitUsd: '25' }], dueDate: due, customer: { name: 'Jane Roe', email: 'jane@example.com' }, notes: 'Thanks for your order.' })
  const inv1 = ib.data?.invoice
  check('the owner makes an invoice: line items, number, total', ib.status === 201 && inv1.number === 'INV-0001' && inv1.usd === '4,900' && inv1.items.length === 2 && inv1.path === `/pay/m/${inv1.id}`, ib.data?.error)
  check('invoices: a due date in the past is refused', (await O.post('/api/developer/merchant/invoices', { items: [{ description: 'x', unitUsd: '1' }], dueDate: '2020-01-01' })).status === 400)
  check('invoices: a bad customer email is refused', (await O.post('/api/developer/merchant/invoices', { items: [{ description: 'x', unitUsd: '1' }], dueDate: due, customer: { email: 'nope' } })).status === 400)
  check('invoices: a duplicate number is refused (409)', (await team.billing.post('/api/developer/merchant/invoices', { number: 'INV-0001', items: [{ description: 'x', unitUsd: '1' }], dueDate: due })).status === 409)

  const pub = await anon.call(`/api/pay/m/i/${inv1.id}`)
  const pi = pub.data?.invoice
  check('branded checkout: store name, logo, accent, support email, non-custodial line', pub.status === 200 && pi.merchant.name === 'Acme Coffee' && pi.merchant.logoUrl === prof.data.profile.logoUrl && pi.merchant.accent === '#3fa7d6' && pi.merchant.supportEmail === 'help@acme.example' && /never holds your funds/.test(pi.nonCustodial))
  check("the checkout pays the store's wallet on each chain (EIP-55)", pi.recipients['8453'] === eoa && pi.recipients['56'] === eoa && !('42161' in pi.recipients))
  check("the public invoice shows the customer's name, never the email", pi.customer?.name === 'Jane Roe' && !JSON.stringify(pi).includes('jane@example.com'))
  check('an unknown store invoice is 404', (await anon.call('/api/pay/m/i/mi_' + 'a'.repeat(22))).status === 404)
  check('a quote POST without X-Requested-With is refused', (await anon.call(`/api/pay/m/i/${inv1.id}/quote`, { method: 'POST', body: { asset: 'base-usdc' } })).status === 403)
  check('a quote in an asset on a chain without a wallet is refused', (await payPost(`/api/pay/m/i/${inv1.id}/quote`, { asset: 'arb-usdc' })).status >= 400)

  /* ---------------------------------------------------- paying the store --- */
  const q1 = (await payPost(`/api/pay/m/i/${inv1.id}/quote`, { asset: 'base-usdc' })).data?.quote
  check("the quote sends to the store's wallet, not the treasury", q1?.treasury === MW && q1.treasury !== TREASURY && q1.uri.includes(eoa))
  const toTreasury = sendUsdc(q1, TREASURY)
  const vt = await payPost(`/api/pay/m/i/${inv1.id}/verify`, { quoteId: q1.id, txHash: toTreasury })
  check("paying OUR treasury the exact amount does not count for the store (422)", vt.status === 422 && /store's wallet/.test(vt.data?.error ?? ''), vt.data?.error)
  const toOther = sendUsdc(q1, acct().address.toLowerCase())
  check('paying another address does not count (422)', (await payPost(`/api/pay/m/i/${inv1.id}/verify`, { quoteId: q1.id, txHash: toOther })).status === 422)
  const wrongAmt = sendUsdc(q1, MW, usdcRaw(q1) - 1n)
  check('paying the store less than the quote does not count (422)', (await payPost(`/api/pay/m/i/${inv1.id}/verify`, { quoteId: q1.id, txHash: wrongAmt })).status === 422)
  const goodHash = sendUsdc(q1)
  const v1 = await payPost(`/api/pay/m/i/${inv1.id}/verify`, { quoteId: q1.id, txHash: goodHash })
  check("paying the store's wallet the exact amount marks the invoice paid", v1.status === 200 && v1.data.invoice.status === 'paid' && v1.data.invoice.payment.to === MW, v1.data?.error)
  const twice = await payPost(`/api/pay/m/i/${inv1.id}/verify`, { quoteId: q1.id, txHash: goodHash })
  check('paying it twice is refused', twice.status === 409, `${twice.status} ${twice.data?.error}`)

  // Webhook: invoice.paid, signed with the store's secret, payment to the store's wallet.
  await processDue(Date.now() + 1000)
  const paidReq = hook.got.find((r) => r.path === '/store' && JSON.parse(r.body).type === 'invoice.paid')
  const paidEv = paidReq ? JSON.parse(paidReq.body) : null
  check('invoice.paid webhook signed with the store secret', !!paidReq && verifies(paidReq, SECRET))
  check('invoice.paid: store, invoice number, payment to the store wallet, tx hash', paidEv?.data.store.name === 'Acme Coffee' && paidEv.data.invoice.number === 'INV-0001' && paidEv.data.invoice.url.endsWith(`/pay/m/${inv1.id}`) && paidEv.data.payment.to === MW && paidEv.data.payment.txHash === goodHash)

  /* ----------------------------------------------------- global tx reuse --- */
  const gl = await admin('/api/admin/invoices', 'POST', { title: 'Chain Kit', usd: '4900', assets: ['base-usdc'] })
  const glq = (await payPost(`/api/pay/${gl.data.invoice.id}/quote`, { asset: 'base-usdc' })).data.quote
  const reuseOurs = await payPost(`/api/pay/${gl.data.invoice.id}/verify`, { quoteId: glq.id, txHash: goodHash })
  check("a store's tx cannot pay a Gully Labs invoice (global reuse, 409)", reuseOurs.status === 409, reuseOurs.data?.error)
  const ourHash = chains[8453].add({ from: acct().address.toLowerCase(), to: TREASURY, value: BigInt(glq.amountRaw), token: USDC[8453] })
  check('our own invoice is paid with its own tx', (await payPost(`/api/pay/${gl.data.invoice.id}/verify`, { quoteId: glq.id, txHash: ourHash })).status === 200)
  const inv2 = (await O.post('/api/developer/merchant/invoices', { items: [{ description: 'Grinder', unitUsd: '300' }], dueDate: due })).data.invoice
  const q2 = (await payPost(`/api/pay/m/i/${inv2.id}/quote`, { asset: 'base-usdc' })).data.quote
  const reuseTheirs = await payPost(`/api/pay/m/i/${inv2.id}/verify`, { quoteId: q2.id, txHash: ourHash })
  check("a Gully Labs tx cannot pay a store invoice (global reuse, 409)", reuseTheirs.status === 409, reuseTheirs.data?.error)

  /* ----------------------------------------------------- fees accrue --- */
  let f = (await O.call('/api/developer/merchant')).data.fees
  check('fees: the first $4,900 is inside the free allowance (no fee)', f.lifetimeUsd === 4900 && f.accruedUsd === 0 && f.freeLeftUsd === 100, JSON.stringify(f))
  // A $200 link checkout straddles the allowance: $100 free, $100 at 0.5% = $0.50.
  const lc = await payPost(`/api/pay/m/l/${link.id}/invoice`, { asset: 'base-usdc' })
  check('a link checkout makes a store invoice and hands over to /pay/m/', lc.status === 201 && lc.data.path.startsWith(`/pay/m/${lc.data.invoice.id}`), lc.data?.error)
  const pl = await payInvoice(lc.data.invoice.id)
  check('the link checkout is paid', pl.v.status === 200, pl.v.data?.error)
  f = (await O.call('/api/developer/merchant')).data.fees
  check('fees: a payment across the allowance pays only on the part above it ($0.50)', f.accruedUsd === 0.5 && f.freeLeftUsd === 0, JSON.stringify(f))
  const p2 = await payInvoice(inv2.id)
  check('another $300 store invoice is paid', p2.v.status === 200, p2.v.data?.error)
  f = (await O.call('/api/developer/merchant')).data.fees
  check('fees: $300 at 0.5% adds $1.50 (unbilled $2.00)', f.accruedUsd === 2 && f.unbilledUsd === 2, JSON.stringify(f))

  /* ------------------------------------------------------ statements --- */
  const issued = M.issueStatements(Date.now())
  check('a weekly run issues one statement of $2.00', issued.length === 1 && issued[0].usd === '2' && issued[0].state === 'open', JSON.stringify(issued))
  const st = issued[0]
  const glInv = await anon.call(`/api/pay/${st.invoiceId}`)
  check('the statement is a normal Gully Labs invoice, payable to the treasury', glInv.status === 200 && glInv.data.invoice.usd === '2' && glInv.data.invoice.checkout.treasury === TREASURY && /^GL-/.test(glInv.data.invoice.number))
  check('a notice went out at issue (Telegram when linked)', notices.some((n) => n.ws === OW && /fee statement/.test(n.text)))
  let act = (await O.call('/api/developer/activity')).data.events.map((e) => e.action)
  check('activity: merchant.fee_statement recorded', act.includes('merchant.fee_statement') && act.includes('merchant.payment'))
  f = (await O.call('/api/developer/merchant')).data.fees
  check('portal: the statement shows with a pay path; nothing unbilled', f.statements.length === 1 && f.statements[0].payPath === `/pay/${st.invoiceId}` && f.unbilledUsd === 0 && f.outstandingUsd === 2 && !f.paused)
  // A balance under $1 rolls over.
  const inv3 = (await O.post('/api/developer/merchant/invoices', { items: [{ description: 'Filters', unitUsd: '100' }], dueDate: due })).data.invoice
  await payInvoice(inv3.id)
  check('a balance under $1 ($0.50) gets no statement; it rolls into next week', M.issueStatements(Date.now()).length === 0 && (await O.call('/api/developer/merchant')).data.fees.unbilledUsd === 0.5)

  /* -------------------------------------------------- pause and resume --- */
  const stored = M.merchantsDbForTest().statements.find((s) => s.id === st.id)
  stored.issuedAt = new Date(Date.now() - 5.5 * 86_400_000).toISOString()
  stored.dueAt = new Date(Date.now() + 1.5 * 86_400_000).toISOString()
  M.merchantTick(Date.now())
  check('day 5: a reminder (activity + notice), checkout still open', notices.some((n) => /Reminder/.test(n.text)) && !(await O.call('/api/developer/merchant')).data.fees.paused)
  stored.issuedAt = new Date(Date.now() - 7.1 * 86_400_000).toISOString()
  stored.dueAt = new Date(Date.now() - 0.1 * 86_400_000).toISOString()
  M.merchantTick(Date.now())
  check('day 7: the pause notice went out', notices.some((n) => /checkout is paused/.test(n.text)))
  act = (await O.call('/api/developer/activity')).data.events.map((e) => e.action)
  check('activity: reminder and pause recorded', act.includes('merchant.fee_reminder') && act.includes('merchant.checkout_paused'))
  const inv4 = (await O.post('/api/developer/merchant/invoices', { items: [{ description: 'Mugs', unitUsd: '40' }], dueDate: due })).data.invoice
  const paused = (await anon.call(`/api/pay/m/i/${inv4.id}`)).data.invoice
  check("paused: the checkout says \"This store's checkout is paused\"", paused.checkout.enabled === false && paused.checkout.paused === true && /This store's checkout is paused/.test(paused.checkout.reason))
  check('paused: no quote (423)', (await payPost(`/api/pay/m/i/${inv4.id}/quote`, { asset: 'base-usdc' })).status === 423)
  check('paused: no new link checkout (423)', (await payPost(`/api/pay/m/l/${link.id}/invoice`, {})).status === 423)
  check('paused: the public link says so', (await anon.call(`/api/pay/m/l/${link.id}`)).data.link.checkout.paused === true)
  const pv = (await O.call('/api/developer/merchant')).data
  check('portal: paused, with the overdue statement', pv.fees.paused === true && pv.checkoutOpen === false && pv.fees.statements[0].state === 'overdue')
  let am = await admin('/api/admin/merchants')
  const row = am.data?.merchants?.find((x) => x.workspace === OW)
  check('admin: merchants list with volume, fees accrued/overdue and pause state', am.status === 200 && row?.name === 'Acme Coffee' && row.volumeUsd === 5500 && row.feesAccruedUsd === 2.5 && row.feesOverdueUsd === 2 && row.paused === true && am.data.totals.paused === 1, JSON.stringify(row))
  check('admin: merchants need the admin token', (await fetch(BASE + '/api/admin/merchants')).status === 401)

  // Pay the statement through the normal Gully Pay checkout, into the treasury.
  const sq = (await payPost(`/api/pay/${st.invoiceId}/quote`, { asset: 'base-usdc' })).data.quote
  check('the statement quote goes to the treasury', sq.treasury === TREASURY)
  const sh = chains[8453].add({ from: acct().address.toLowerCase(), to: TREASURY, value: BigInt(sq.amountRaw), token: USDC[8453] })
  const sv = await payPost(`/api/pay/${st.invoiceId}/verify`, { quoteId: sq.id, txHash: sh })
  check('the statement is paid through Gully Pay', sv.status === 200 && sv.data.invoice.status === 'paid', sv.data?.error)
  const resumed = (await anon.call(`/api/pay/m/i/${inv4.id}`)).data.invoice
  check('paying resumes checkout instantly', resumed.checkout.enabled === true && (await payPost(`/api/pay/m/i/${inv4.id}/quote`, { asset: 'bnb-usdc' })).status === 200)
  const after = (await O.call('/api/developer/merchant')).data.fees
  check('portal: statement paid, not paused', after.statements[0].state === 'paid' && !after.paused && after.paidUsd === 2)
  act = (await O.call('/api/developer/activity')).data.events.map((e) => e.action)
  check('activity + notice: fee paid, checkout running', act.includes('merchant.fee_paid') && notices.some((n) => /checkout is running/.test(n.text)))
  am = await admin('/api/admin/merchants')
  check('admin: fees paid, no longer paused', am.data.merchants.find((x) => x.workspace === OW).feesPaidUsd === 2 && am.data.totals.paused === 0)
  check('admin: run statements on demand', (await admin('/api/admin/merchants/statements/run', 'POST', {})).status === 200)

  /* ------------------------------------------- cancel, expire, redeliver --- */
  const can = await O.post(`/api/developer/merchant/invoices/${inv4.id}/cancel`, {})
  check('cancelling an open store invoice', can.status === 200 && can.data.invoice.status === 'cancelled')
  check('a viewer cannot cancel (403)', (await team.viewer.post(`/api/developer/merchant/invoices/${inv3.id}/cancel`, {})).status === 403)
  const inv5 = (await O.post('/api/developer/merchant/invoices', { items: [{ description: 'Old order', unitUsd: '12' }], dueDate: due })).data.invoice
  M.merchantsDbForTest().invoices.find((i) => i.id === inv5.id).expiresAt = new Date(Date.now() - 1000).toISOString()
  M.merchantTick(Date.now())
  await processDue(Date.now() + 1000)
  const types = hook.got.filter((r) => r.path === '/store').map((r) => JSON.parse(r.body).type)
  check('invoice.cancelled and invoice.expired reach the store webhook', types.includes('invoice.cancelled') && types.includes('invoice.expired'), types.join())
  check('every store delivery is signed with the store secret', hook.got.filter((r) => r.path === '/store').every((r) => verifies(r, SECRET)))
  const view = (await O.call('/api/developer/merchant')).data
  const paidDel = view.deliveries.find((d) => d.type === 'invoice.paid' && d.state === 'delivered')
  const rd = await team.developer.post(`/api/developer/merchant/webhook/deliveries/${paidDel.id}/redeliver`, {})
  const redReq = hook.got.at(-1)
  check('redeliver: the same event again, a new delivery, signed', rd.status === 200 && rd.data.delivery.redeliveryOf === paidDel.id && JSON.parse(redReq.body).id === paidDel.eventId && verifies(redReq, SECRET))
  const other = await outsider.post(`/api/developer/merchant/webhook/deliveries/${paidDel.id}/redeliver`, {})
  check("another workspace cannot redeliver this store's delivery (404)", other.status === 404)
  const rot = await O.post('/api/developer/merchant/webhook/rotate', {})
  check('rotating shows a new secret once', rot.status === 200 && rot.data.secret !== SECRET)

  /* ------------------------------------------------------ stats, CSV --- */
  const stats = await team.viewer.call('/api/developer/merchant/stats?range=30d')
  const s = stats.data
  check('stats: count, volume, average ticket', stats.status === 200 && s.totals.payments === 4 && s.totals.volumeUsd === 5500 && s.totals.avgTicketUsd === 1375, JSON.stringify(s?.totals))
  check('stats: volume by chain and by asset, 30 daily points', s.byChain.some((c) => c.name === 'Base' && c.data.length === 30 && c.data.at(-1) === 5500) && s.byAsset.some((a) => a.name === 'USDC · Base'))
  check('stats: conversion opened -> paid, top links', s.totals.opened >= 3 && s.totals.paid === 4 && typeof s.totals.conversion === 'number' && s.topLinks[0]?.id === link.id && s.topLinks[0].volumeUsd === 200, JSON.stringify(s.totals))
  const csvRes = await fetch(BASE + '/api/developer/merchant/export/payments.csv', { headers: { cookie: O.cookie } })
  const csv = await csvRes.text()
  check('CSV: header, one row per payment, tx hashes, fee column', csvRes.status === 200 && csv.startsWith('date,invoice,title,link,usd,amount,asset,chain,tx_hash,from,to,fee_usd,explorer_url') && csv.trim().split('\r\n').length === 5 && csv.includes(goodHash) && /,0\.50,/.test(csv))
  check("an outsider sees their own empty store, not this one", (await outsider.call('/api/developer/merchant')).data.links.length === 0)

  const cfg = await anon.call('/api/pay/m/config')
  check('public config for the docs: 0.5%, $5,000 free, 7 days', cfg.status === 200 && cfg.data.feePct === 0.5 && cfg.data.freeUsd === 5000 && cfg.data.pauseAfterDays === 7)
} catch (e) {
  console.error(e)
  check('no exception', false, String(e?.message ?? e))
} finally {
  console.log(`\n${t.passed} passed, ${t.failed} failed`)
  for (const c of Object.values(chains)) c.server.close()
  hook.server.close()
  logoHost.close()
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* windows may hold a file */
  }
  process.exit(t.failed ? 1 : 0)
}
