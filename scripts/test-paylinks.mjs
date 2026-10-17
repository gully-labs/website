// End-to-end test of Gully Pay links, wallet payment URIs (EIP-681) and merchant webhooks (with redeliver
// and invoice.cancelled).
//
//   node scripts/test-paylinks.mjs        (no build needed; it tests the API, not the pages)
//
// Same approach as test-pay.mjs: the real server runs IN THIS PROCESS on TEST_PORT (default 8793) with a
// fresh temporary DATA_DIR; every chain is a local JSON-RPC stub (GULLY_RPC_<chainId>) with its own
// Chainlink answer, and the merchant endpoint is a local HTTP receiver (loopback webhooks are allowed for
// tests only with GULLY_ALLOW_LOOPBACK_WEBHOOKS=1). The webhook queue timer is off; the test drives it.
// The last part restarts the webhook queue in a CHILD process on the same DATA_DIR to prove a pending
// delivery survives a restart.

import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { makeChecker, makeClient } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8793
const BASE = `http://localhost:${PORT}`
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-paylinks-'))
const ADMIN = crypto.randomBytes(24).toString('hex')
const TREASURY = privateKeyToAccount(generatePrivateKey()).address.toLowerCase()
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const TOKENS = { baseUsdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', bnbUsdc: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', bnbUsdt: '0x55d398326f99059ff775485246999027b3197955', ethUsdt: '0xdac17f958d2ee523a2206206994597c13d831ec7' }
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
  const c = { chainId, head: 5_000_000, receipts: new Map(), txs: new Map(), blocks: new Map(), feed: { roundId: 777n, answer, updatedAt: nowSec() - 60 } }
  c.add = ({ hash = randHash(), from, to = TREASURY, value, token = null, status = '0x1', block = c.head - 30, minedAt = nowSec() }) => {
    c.blocks.set(block, minedAt)
    const logs = token ? [{ address: token, topics: [TRANSFER, pad(from), pad(to)], data: pad(hex(value)) }] : []
    c.receipts.set(hash, { transactionHash: hash, status, blockNumber: hex(block), from, logs })
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
const [base, eth, bnb] = [chains[8453], chains[1], chains[56]]

/* ----------------------------------------------------- merchant receiver --- */

// Answers with `hook.status` (200 by default) and records every request with its raw body.
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

/** Verifies a delivery exactly as a merchant would (see the docs): HMAC over "<timestamp>.<raw body>". */
function merchantVerifies(req, secret) {
  const ts = req.headers['x-gully-timestamp'] ?? ''
  const sig = req.headers['x-gully-signature'] ?? ''
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${req.body}`).digest('hex')
  const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  return ok && Math.abs(Date.now() / 1000 - Number(ts)) < 300
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
  ...CHAIN_ENV,
})
delete process.env.GULLY_BASE_RPC
delete process.env.GULLY_MIN_CONFIRMATIONS
await import('../server/server.mjs')
const { paymentUri, checksumAddress, assetById } = await import('../server/payments.mjs')
const { expireLinkForTest } = await import('../server/paylinks.mjs')
const { processDue, sweepExpired, deliveriesForTest } = await import('../server/pay-webhooks.mjs')
await new Promise((r) => setTimeout(r, 300))

const anon = makeClient(BASE)
const admin = (p, method = 'GET', body, token = ADMIN) => fetch(BASE + p, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }))
// Each simulated payer has its own address (the server reads cf-connecting-ip first).
const asIp = (ip) => ({ headers: { 'cf-connecting-ip': ip } })
const payPost = (p, body, ip = '198.51.100.7') => anon.post(p, body, asIp(ip))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  /* ------------------------------------------------- EIP-681 payment URIs --- */
  const T = checksumAddress(TREASURY)
  check('checksumAddress matches viem getAddress (EIP-55)', T === getAddress(TREASURY) && checksumAddress(TOKENS.bnbUsdc) === getAddress(TOKENS.bnbUsdc))
  const cases = [
    ['base-usdc', 49_000_123n, `ethereum:${getAddress(TOKENS.baseUsdc)}@8453/transfer?address=${T}&uint256=49000123`],
    ['eth-usdt', 1_500_004_321n, `ethereum:${getAddress(TOKENS.ethUsdt)}@1/transfer?address=${T}&uint256=1500004321`],
    ['bnb-usdc', 49_000_123_000_000_000_000n, `ethereum:${getAddress(TOKENS.bnbUsdc)}@56/transfer?address=${T}&uint256=49000123000000000000`],
    ['bnb-usdt', 123_456_789_012_345_678_901_234n, `ethereum:${getAddress(TOKENS.bnbUsdt)}@56/transfer?address=${T}&uint256=123456789012345678901234`],
    ['base-eth', 20_416_667_000_004_321n, `ethereum:${T}@8453?value=20416667000004321`],
    ['bnb-bnb', 70_000_000_001_000_000n, `ethereum:${T}@56?value=70000000001000000`],
    ['arb-eth', 1n, `ethereum:${T}@42161?value=1`],
  ]
  for (const [id, units, want] of cases) check(`EIP-681 URI for ${id} uses exact base units`, paymentUri(assetById(id), TREASURY, units) === want, paymentUri(assetById(id), TREASURY, units))
  check('EIP-681: an amount beyond 2^53 keeps every digit (BigInt, no float)', paymentUri(assetById('bnb-usdt'), TREASURY, '9007199254740993000000001').endsWith('uint256=9007199254740993000000001'))
  let threw = false
  try {
    paymentUri(assetById('base-usdc'), TREASURY, 0n)
  } catch {
    threw = true
  }
  check('EIP-681: a zero amount is refused', threw)

  /* -------------------------------------------------- link validation --- */
  check('admin links need the admin token (401)', (await admin('/api/admin/paylinks', 'GET', undefined, 'x'.repeat(48))).status === 401)
  const bad = async (name, body) => {
    const r = await admin('/api/admin/paylinks', 'POST', body)
    check(`refused: ${name} (400)`, r.status === 400, r.data?.error)
  }
  await bad('a link without a title', { amount: { type: 'fixed', usd: '10' } })
  await bad('a fixed amount with three decimals', { title: 'X', amount: { type: 'fixed', usd: '10.001' } })
  await bad('an amount of zero', { title: 'X', amount: { type: 'fixed', usd: '0' } })
  await bad('an open amount whose minimum is above its maximum', { title: 'X', amount: { type: 'open', min: '50', max: '10' } })
  await bad('an open amount without a maximum', { title: 'X', amount: { type: 'open', min: '5' } })
  await bad('an unknown amount type', { title: 'X', amount: { type: 'any' } })
  await bad('an unknown asset', { title: 'X', amount: { type: 'fixed', usd: '10' }, assets: ['base-usdc', 'sol-sol'] })
  await bad('an expiry in the past', { title: 'X', amount: { type: 'fixed', usd: '10' }, expiresAt: new Date(Date.now() - 60_000).toISOString() })
  await bad('maxUses of zero', { title: 'X', amount: { type: 'fixed', usd: '10' }, maxUses: 0 })
  await bad('an http:// webhook to a public host', { title: 'X', amount: { type: 'fixed', usd: '10' }, webhookUrl: 'http://example.com/hook' })

  /* ------------------------------------------------------------ SSRF --- */
  for (const u of ['https://10.0.0.5/hook', 'https://192.168.1.1/hook', 'https://169.254.169.254/latest/meta-data', 'https://[fd00::1]/hook', 'https://[fe80::1]/hook', 'https://100.64.0.1/hook', 'https://printer.local/hook', 'https://user:pw@example.com/hook', 'ftp://example.com/hook']) {
    const r = await admin('/api/admin/paylinks', 'POST', { title: 'SSRF', amount: { type: 'fixed', usd: '1' }, webhookUrl: u })
    check(`SSRF: refused webhook ${u}`, r.status === 400, r.data?.error)
  }
  // (Loopback itself is allowed here only because this test turns GULLY_ALLOW_LOOPBACK_WEBHOOKS on.)
  const ssrfDefault2 = await admin('/api/admin/pay-webhooks/default', 'POST', { url: 'https://172.16.0.1/hook' })
  check('SSRF: the default endpoint refuses a private address too', ssrfDefault2.status === 400, ssrfDefault2.data?.error)
  await admin('/api/admin/pay-webhooks/default', 'POST', { url: null })

  /* ------------------------------------------------------- fixed link --- */
  const c1 = await admin('/api/admin/paylinks', 'POST', { title: 'Chain Kit setup', description: 'One-off setup of your explorer.', amount: { type: 'fixed', usd: '1500' }, assets: ['base-usdc', 'bnb-usdc', 'base-eth'], webhookUrl: HOOK('/fixed') })
  const fixed = c1.data?.link
  const fixedSecret = c1.data?.secret
  check('admin creates a fixed link with an unguessable id', c1.status === 201 && /^pl_[\w-]{16}$/.test(fixed?.id) && fixed.path === `/pay/l/${fixed.id}` && fixed.state === 'active' && fixed.amount.usd === '1,500', c1.data?.error)
  check('the webhook secret is shown once at creation', /^whsec_[\w-]{32}$/.test(fixedSecret ?? '') && fixed.webhook?.url === HOOK('/fixed'))
  const listed = (await admin('/api/admin/paylinks')).data
  check('the list never shows a webhook secret', listed.links[0].id === fixed.id && !JSON.stringify(listed).includes('whsec_'))
  const pubL = await anon.call(`/api/pay/l/${fixed.id}`)
  check('the public link shows title, description, amount and assets', pubL.status === 200 && pubL.data.link.title === 'Chain Kit setup' && pubL.data.link.description === 'One-off setup of your explorer.' && pubL.data.link.amount.type === 'fixed' && pubL.data.link.assets.map((a) => a.id).join() === 'base-usdc,base-eth,bnb-usdc')
  check('the public link has no secret, use count or webhook', !JSON.stringify(pubL.data).includes('whsec_') && !('webhook' in pubL.data.link) && !('paidUses' in pubL.data.link))
  check('an unknown link is 404', (await anon.call('/api/pay/l/pl_' + 'a'.repeat(16))).status === 404)
  check('a link invoice POST without X-Requested-With is refused', (await anon.call(`/api/pay/l/${fixed.id}/invoice`, { method: 'POST', body: {} })).status === 403)
  let r = await payPost(`/api/pay/l/${fixed.id}/invoice`, { asset: 'arb-usdc' })
  check('refused: an asset the link does not take', r.status === 400, r.data?.error)
  r = await payPost(`/api/pay/l/${fixed.id}/invoice`, { asset: 'bnb-usdc', usd: '1' })
  const inv1 = r.data?.invoice
  check('a payer makes an invoice from the fixed link (the client cannot change the amount)', r.status === 201 && /^inv_/.test(inv1?.id) && inv1.usd === '1,500' && inv1.linkId === fixed.id && r.data.path === `/pay/${inv1.id}?asset=bnb-usdc`, r.data?.error)
  check('the link invoice runs out after an hour', Math.abs(Date.parse(inv1.expiresAt) - Date.parse(inv1.createdAt) - 3_600_000) < 2000)

  /* ------------------------ pay a link invoice through the stub RPCs --- */
  const q1 = (await payPost(`/api/pay/${inv1.id}/quote`, { asset: 'bnb-usdc' })).data?.quote
  check('the quote carries its EIP-681 URI with the exact 18-decimal amount', q1?.uri === `ethereum:${getAddress(TOKENS.bnbUsdc)}@56/transfer?address=${T}&uint256=${q1?.amountRaw}` && BigInt(q1.amountRaw) > 1500n * 10n ** 18n, q1?.uri)
  r = await payPost(`/api/pay/${inv1.id}/verify`, { quoteId: q1.id, txHash: bnb.add({ from: '0x' + '42'.repeat(20), value: BigInt(q1.amountRaw), token: TOKENS.bnbUsdc, block: bnb.head - 4 }) })
  check('pending: 5 of 15 confirmations, with n / needed', r.status === 202 && r.data?.confirmations === 5 && r.data?.needed === 15, r.data?.error)
  const payer = '0x' + 'ab'.repeat(20)
  const paidHash = bnb.add({ from: payer, value: BigInt(q1.amountRaw), token: TOKENS.bnbUsdc })
  r = await payPost(`/api/pay/${inv1.id}/verify`, { quoteId: q1.id, txHash: paidHash })
  check('the link invoice is paid with the exact amount', r.status === 200 && r.data.invoice.status === 'paid' && r.data.invoice.payment.txHash === paidHash, r.data?.error)
  const detail = (await admin(`/api/admin/paylinks/${fixed.id}`)).data
  check('the admin sees the payment under its link, and one paid use', detail.link.paidUses === 1 && detail.invoices[0]?.id === inv1.id && detail.invoices[0].payment?.txHash === paidHash && detail.link.stats.paidUsd === '1,500')

  /* ----------------------------------------- invoice.paid webhook, signed --- */
  await processDue()
  const paidReq = hook.got.find((g) => g.path === '/fixed')
  const paidEvt = paidReq ? JSON.parse(paidReq.body) : null
  check('invoice.paid reaches the link endpoint', paidEvt?.type === 'invoice.paid' && /^evt_/.test(paidEvt.id), paidReq?.body)
  check('the merchant verifies the HMAC exactly as documented', !!paidReq && merchantVerifies(paidReq, fixedSecret))
  check('a wrong secret does not verify', !!paidReq && !merchantVerifies(paidReq, 'whsec_wrong'))
  check('the signature header is sha256=<64 hex> and the timestamp is unix seconds', /^sha256=[0-9a-f]{64}$/.test(paidReq?.headers['x-gully-signature'] ?? '') && /^\d{10}$/.test(paidReq?.headers['x-gully-timestamp'] ?? ''))
  const pp = paidEvt?.data?.payment
  check(
    'invoice.paid carries chain, asset, amount, tx hash, block, confirmations, payer, invoice and link ids',
    pp?.chainId === 56 && pp.chain === 'BNB Chain' && pp.asset === 'bnb-usdc' && pp.symbol === 'USDC' && pp.amountRaw === q1.amountRaw && pp.amount === q1.amount && pp.txHash === paidHash && pp.blockNumber === bnb.head - 30 && pp.confirmations === 31 && pp.payer === payer && paidEvt.data.invoice.id === inv1.id && paidEvt.data.invoice.linkId === fixed.id && paidEvt.data.link?.id === fixed.id,
    JSON.stringify(pp),
  )
  check('the user agent names Gully Pay', /GullyLabs-Pay/.test(paidReq?.headers['user-agent'] ?? ''))
  const log1 = (await admin(`/api/admin/paylinks/${fixed.id}`)).data.deliveries
  check('the link shows its delivery log', log1[0]?.type === 'invoice.paid' && log1[0].state === 'delivered' && log1[0].attempts === 1 && log1[0].last?.status === 200)

  /* ------------------------------------------------------ test event --- */
  hook.got.length = 0
  r = await admin(`/api/admin/paylinks/${fixed.id}/test`, 'POST')
  const testReq = hook.got[0]
  check('"Send test event" delivers webhook.test at once, signed', r.status === 200 && r.data.delivery?.state === 'delivered' && JSON.parse(testReq?.body ?? '{}').type === 'webhook.test' && merchantVerifies(testReq, fixedSecret), r.data?.error)
  const rot = await admin(`/api/admin/paylinks/${fixed.id}/rotate`, 'POST')
  check('rotating shows a new secret once', rot.status === 200 && /^whsec_/.test(rot.data.secret) && rot.data.secret !== fixedSecret)
  hook.got.length = 0
  await admin(`/api/admin/paylinks/${fixed.id}/test`, 'POST')
  check('after rotation the new secret signs and the old one does not', merchantVerifies(hook.got[0], rot.data.secret) && !merchantVerifies(hook.got[0], fixedSecret))
  check('a test event on a link without a webhook is refused (409)', (await admin(`/api/admin/paylinks/${(await admin('/api/admin/paylinks', 'POST', { title: 'No hook', amount: { type: 'fixed', usd: '5' } })).data.link.id}/test`, 'POST')).status === 409)

  /* ------------------------------------------------------- open link --- */
  const c2 = await admin('/api/admin/paylinks', 'POST', { title: 'Tip jar', amount: { type: 'open', min: '5', max: '250.50' } })
  const open = c2.data.link
  check('admin creates an open link with bounds', c2.status === 201 && open.amount.type === 'open' && open.amount.min === '5' && open.amount.max === '250.50' && open.assets.length === 10 && c2.data.secret === null)
  r = await payPost(`/api/pay/l/${open.id}/invoice`, {}, '198.51.100.20')
  check('refused: an open link with no amount', r.status === 400, r.data?.error)
  r = await payPost(`/api/pay/l/${open.id}/invoice`, { usd: '4.99' }, '198.51.100.20')
  check('refused: below the minimum (server-side)', r.status === 400 && /from 5 to 250\.50/.test(r.data?.error), r.data?.error)
  r = await payPost(`/api/pay/l/${open.id}/invoice`, { usd: '250.51' }, '198.51.100.20')
  check('refused: above the maximum', r.status === 400, r.data?.error)
  r = await payPost(`/api/pay/l/${open.id}/invoice`, { usd: '12.345' }, '198.51.100.20')
  check('refused: three decimals', r.status === 400, r.data?.error)
  r = await payPost(`/api/pay/l/${open.id}/invoice`, { usd: '-10' }, '198.51.100.20')
  check('refused: a negative amount', r.status === 400, r.data?.error)
  r = await payPost(`/api/pay/l/${open.id}/invoice`, { usd: '42.50', asset: 'eth-usdt' }, '198.51.100.20')
  const inv2 = r.data?.invoice
  check('an open amount within bounds makes an invoice for exactly that amount', r.status === 201 && inv2.usd === '42.50' && inv2.usdCents === '4250', r.data?.error)
  const q2 = (await payPost(`/api/pay/${inv2.id}/quote`, { asset: 'eth-usdt' })).data.quote
  check('its quote is for 42.50 USDT plus a tag, with a 6-decimal URI', /^42\.50\d{0,4}$/.test(q2.amount) && q2.uri === `ethereum:${getAddress(TOKENS.ethUsdt)}@1/transfer?address=${T}&uint256=${q2.amountRaw}`, q2.uri)
  const qn = (await payPost(`/api/pay/${inv2.id}/quote`, { asset: 'base-eth' })).data.quote
  check('a native quote URI carries value=<wei> exactly', qn.uri === `ethereum:${T}@8453?value=${qn.amountRaw}` && BigInt(qn.amountRaw) % 10n ** 9n === 0n, qn.uri)

  /* --------------------------------------- inactive / expired / used up --- */
  check('admin deactivates a link', (await admin(`/api/admin/paylinks/${open.id}/deactivate`, 'POST')).data?.link?.state === 'inactive')
  const pubOff = (await anon.call(`/api/pay/l/${open.id}`)).data.link
  check('an inactive link is shown as such, with clear words', pubOff.state === 'inactive' && /switched off/.test(pubOff.stateText))
  r = await payPost(`/api/pay/l/${open.id}/invoice`, { usd: '10' }, '198.51.100.21')
  check('refused: an invoice from an inactive link (409)', r.status === 409 && r.data.state === 'inactive', r.data?.error)
  check('admin activates it again', (await admin(`/api/admin/paylinks/${open.id}/activate`, 'POST')).data?.link?.state === 'active')

  const edited = await admin(`/api/admin/paylinks/${open.id}`, 'POST', { title: 'Tip jar (edited)', amount: { type: 'open', min: '1', max: '100' } })
  check('admin edits a link (title and bounds); the rest is kept', edited.status === 200 && edited.data.link.title === 'Tip jar (edited)' && edited.data.link.amount.max === '100' && edited.data.link.assets.length === 10)
  check('an edit with a bad value is refused', (await admin(`/api/admin/paylinks/${open.id}`, 'POST', { maxUses: -1 })).status === 400)

  const c3 = await admin('/api/admin/paylinks', 'POST', { title: 'Soon gone', amount: { type: 'fixed', usd: '9' }, expiresAt: new Date(Date.now() + 86_400_000).toISOString() })
  expireLinkForTest(c3.data.link.id)
  const pubExp = (await anon.call(`/api/pay/l/${c3.data.link.id}`)).data.link
  r = await payPost(`/api/pay/l/${c3.data.link.id}/invoice`, {}, '198.51.100.22')
  check('an expired link is shown as expired and makes no invoice', pubExp.state === 'expired' && r.status === 409 && r.data.state === 'expired', r.data?.error)

  const c4 = await admin('/api/admin/paylinks', 'POST', { title: 'One seat', amount: { type: 'fixed', usd: '20' }, assets: ['base-usdc'], maxUses: 1 })
  const one = c4.data.link
  r = await payPost(`/api/pay/l/${one.id}/invoice`, {}, '198.51.100.23')
  const inv4 = r.data.invoice
  r = await payPost(`/api/pay/l/${one.id}/invoice`, {}, '198.51.100.24')
  check('max uses 1: a second checkout is refused while the first is open', r.status === 409 && /in progress/.test(r.data?.error), r.data?.error)
  const q4 = (await payPost(`/api/pay/${inv4.id}/quote`, { asset: 'base-usdc' }, '198.51.100.23')).data.quote
  r = await payPost(`/api/pay/${inv4.id}/verify`, { quoteId: q4.id, txHash: base.add({ from: payer, value: BigInt(q4.amountRaw), token: TOKENS.baseUsdc }) }, '198.51.100.23')
  check('the one seat is paid', r.status === 200, r.data?.error)
  const pubUsed = (await anon.call(`/api/pay/l/${one.id}`)).data.link
  r = await payPost(`/api/pay/l/${one.id}/invoice`, {}, '198.51.100.25')
  check('a used-up link is shown as used up and makes no invoice', pubUsed.state === 'used-up' && r.status === 409 && r.data.state === 'used-up', r.data?.error)

  /* ---------------------------------------------------------- rate limit --- */
  let made = 0
  let limited = false
  for (let i = 0; i < 12 && !limited; i++) {
    const x = await payPost(`/api/pay/l/${open.id}/invoice`, { usd: '3' }, '203.0.113.9')
    if (x.status === 201) made++
    limited = x.status === 429
  }
  check('invoice creation from links is rate-limited per IP (10 an hour)', made === 10 && limited, `${made} made`)
  check('another IP is not affected', (await payPost(`/api/pay/l/${open.id}/invoice`, { usd: '3' }, '203.0.113.10')).status === 201)

  /* ------------------------------------------------- retries and backoff --- */
  hook.status = 503
  hook.got.length = 0
  const c5 = await admin('/api/admin/paylinks', 'POST', { title: 'Retry me', amount: { type: 'fixed', usd: '30' }, assets: ['eth-usdt'], webhookUrl: HOOK('/retry') })
  const retryLink = c5.data.link
  const retrySecret = c5.data.secret
  const inv5 = (await payPost(`/api/pay/l/${retryLink.id}/invoice`, {}, '198.51.100.30')).data.invoice
  const q5 = (await payPost(`/api/pay/${inv5.id}/quote`, { asset: 'eth-usdt' }, '198.51.100.30')).data.quote
  r = await payPost(`/api/pay/${inv5.id}/verify`, { quoteId: q5.id, txHash: eth.add({ from: payer, value: BigInt(q5.amountRaw), token: TOKENS.ethUsdt }) }, '198.51.100.30')
  check('the retry link invoice is paid', r.status === 200, r.data?.error)
  await processDue()
  let d5 = deliveriesForTest().find((d) => d.linkId === retryLink.id && d.type === 'invoice.paid')
  check('a 503 answer leaves the delivery pending with a later retry', d5?.state === 'pending' && d5.attempts.length === 1 && d5.attempts[0].status === 503 && Date.parse(d5.nextAt) > Date.now())
  await processDue()
  check('it is not retried before its time', d5.attempts.length === 1)
  for (let i = 0; i < 4; i++) {
    await sleep(600)
    await processDue()
  }
  check('retried with backoff: five attempts so far, still pending', d5.attempts.length === 5 && d5.state === 'pending', `${d5.attempts.length} ${d5.state}`)
  const ids = new Set(hook.got.filter((g) => g.path === '/retry').map((g) => JSON.parse(g.body).id))
  check('every retry carries the same event id (dedupe by id)', ids.size === 1 && hook.got.filter((g) => g.path === '/retry').length === 5)
  await sleep(600)
  await processDue()
  check('after six attempts the delivery is marked failed', d5.attempts.length === 6 && d5.state === 'failed')
  const persisted = JSON.parse(fs.readFileSync(path.join(tmp, 'pay-webhooks.json'), 'utf8'))
  check('the queue is persisted to DATA_DIR/pay-webhooks.json (atomic tmp + rename)', persisted.deliveries.some((d) => d.id === d5.id && d.state === 'failed') && !fs.existsSync(path.join(tmp, 'pay-webhooks.json.tmp')))

  /* ------------------------------------------------------- invoice.expired --- */
  hook.status = 200
  hook.got.length = 0
  const inv6 = (await payPost(`/api/pay/l/${retryLink.id}/invoice`, {}, '198.51.100.31')).data.invoice
  const { ledger } = await import('../server/billing.mjs')
  ledger().invoices.find((i) => i.id === inv6.id).expiresAt = new Date(Date.now() - 1000).toISOString()
  sweepExpired()
  await processDue()
  const expReq = hook.got.find((g) => g.path === '/retry' && JSON.parse(g.body).type === 'invoice.expired')
  check('invoice.expired goes out once an open link invoice runs out', !!expReq && JSON.parse(expReq.body).data.invoice.id === inv6.id && JSON.parse(expReq.body).data.invoice.status === 'expired' && merchantVerifies(expReq, retrySecret))
  sweepExpired()
  await processDue()
  check('invoice.expired is sent only once', hook.got.filter((g) => JSON.parse(g.body).type === 'invoice.expired' && JSON.parse(g.body).data.invoice.id === inv6.id).length === 1)

  /* ------------------------------------------------------------ redeliver --- */
  // The failed d5 (six 503s) is sent again: same event id and body, a new delivery with its own attempts.
  hook.status = 200
  hook.got.length = 0
  const firstBody = JSON.parse(fs.readFileSync(path.join(tmp, 'pay-webhooks.json'), 'utf8')).deliveries.find((d) => d.id === d5.id).body
  r = await admin(`/api/admin/pay-webhooks/deliveries/${d5.id}/redeliver`, 'POST')
  const rd = r.data?.delivery
  check('redeliver: a failed delivery is sent again at once', r.status === 200 && rd?.state === 'delivered' && rd.attempts === 1 && rd.last?.status === 200, r.data?.error)
  check('redeliver: a NEW delivery with the SAME event id, pointing at the original', rd && rd.id !== d5.id && rd.eventId === d5.eventId && rd.redeliveryOf === d5.id && rd.type === 'invoice.paid')
  check('redeliver: the receiver gets the identical body (same id), signed with the link secret', hook.got.length === 1 && hook.got[0].path === '/retry' && hook.got[0].body === firstBody && JSON.parse(hook.got[0].body).id === d5.eventId && merchantVerifies(hook.got[0], retrySecret))
  check('redeliver: the original keeps its own log (failed, six attempts)', d5.state === 'failed' && d5.attempts.length === 6)
  const linkLog = (await admin(`/api/admin/paylinks/${retryLink.id}`)).data.deliveries
  check('redeliver: the link log shows both, newest first', linkLog[0]?.id === rd?.id && linkLog[0].redeliveryOf === d5.id && linkLog.some((d) => d.id === d5.id && d.state === 'failed'))
  r = await admin(`/api/admin/pay-webhooks/deliveries/${rd?.id}/redeliver`, 'POST')
  check('redeliver: a delivered (past) delivery may be sent again too, same event id', r.status === 200 && r.data.delivery.eventId === d5.eventId && hook.got.length === 2 && JSON.parse(hook.got[1].body).id === d5.eventId)
  hook.status = 503
  r = await admin(`/api/admin/pay-webhooks/deliveries/${d5.id}/redeliver`, 'POST')
  const rdFail = deliveriesForTest().find((d) => d.id === r.data?.delivery?.id)
  check('redeliver: a failing redelivery starts a new retry series (pending, 1 of 6, next retry set)', r.status === 200 && r.data.delivery.state === 'pending' && r.data.delivery.attempts === 1 && r.data.delivery.maxAttempts === 6 && Date.parse(r.data.delivery.nextAt) > Date.now())
  r = await admin(`/api/admin/pay-webhooks/deliveries/${rdFail?.id}/redeliver`, 'POST')
  check('redeliver: refused while the delivery is still being retried (409)', r.status === 409, r.data?.error)
  hook.status = 200
  await sleep(150)
  await processDue()
  check('…and its retry delivers it with the same event id', rdFail?.state === 'delivered' && rdFail.attempts.length === 2 && rdFail.eventId === d5.eventId)
  const testD = deliveriesForTest().find((d) => d.test)
  check('redeliver: refused for a test event (409)', (await admin(`/api/admin/pay-webhooks/deliveries/${testD.id}/redeliver`, 'POST')).status === 409)
  check('redeliver: an unknown delivery is 404', (await admin('/api/admin/pay-webhooks/deliveries/whd_aaaaaaaaaaaa/redeliver', 'POST')).status === 404)
  check('redeliver: needs the admin token (401)', (await admin(`/api/admin/pay-webhooks/deliveries/${d5.id}/redeliver`, 'POST', undefined, 'x'.repeat(48))).status === 401)
  check('redeliver: GET is refused (405)', (await admin(`/api/admin/pay-webhooks/deliveries/${d5.id}/redeliver`)).status === 405)

  /* ----------------------------------------------------- invoice.cancelled --- */
  hook.got.length = 0
  const cx = await admin('/api/admin/invoices', 'POST', { title: 'To cancel', usd: '20', assets: ['base-usdc'], webhookUrl: HOOK('/cancel') })
  r = await admin(`/api/admin/invoices/${cx.data.invoice.id}/cancel`, 'POST')
  await processDue()
  const cReq = hook.got.find((g) => g.path === '/cancel')
  const cEvt = cReq ? JSON.parse(cReq.body) : null
  check('invoice.cancelled goes to the invoice endpoint when an admin cancels it', r.status === 200 && cEvt?.type === 'invoice.cancelled' && /^evt_/.test(cEvt.id) && cEvt.data.invoice.id === cx.data.invoice.id && cEvt.data.invoice.status === 'cancelled' && !!cEvt.data.invoice.cancelledAt, cReq?.body)
  check('…signed with the invoice secret', !!cReq && merchantVerifies(cReq, cx.data.secret))
  check('…and logged under the invoice', (await admin(`/api/admin/invoices/${cx.data.invoice.id}/deliveries`)).data.deliveries.some((d) => d.type === 'invoice.cancelled' && d.state === 'delivered'))
  check('cancelling twice is refused and sends nothing more', (await admin(`/api/admin/invoices/${cx.data.invoice.id}/cancel`, 'POST')).status === 409 && (await processDue(), hook.got.filter((g) => g.path === '/cancel').length === 1))
  hook.got.length = 0
  const inv8 = (await payPost(`/api/pay/l/${retryLink.id}/invoice`, {}, '198.51.100.32')).data.invoice
  await admin(`/api/admin/invoices/${inv8.id}/cancel`, 'POST')
  await processDue()
  const c8 = hook.got.find((g) => g.path === '/retry' && JSON.parse(g.body).type === 'invoice.cancelled')
  check('a cancelled link invoice sends invoice.cancelled to the link endpoint, with the link', !!c8 && JSON.parse(c8.body).data.link?.id === retryLink.id && merchantVerifies(c8, retrySecret))
  sweepExpired(Date.now() + 2 * 3_600_000)
  await processDue()
  check('a cancelled invoice never sends invoice.expired later', !hook.got.some((g) => JSON.parse(g.body).type === 'invoice.expired' && JSON.parse(g.body).data.invoice.id === inv8.id))

  /* ---------------------------------- invoice webhook and global default --- */
  const ci = await admin('/api/admin/invoices', 'POST', { title: 'Audit', usd: '100', assets: ['base-usdc'], webhookUrl: HOOK('/invoice') })
  check('an invoice may have its own webhook; its secret is shown once', ci.status === 201 && /^whsec_/.test(ci.data.secret) && ci.data.invoice.webhook?.url === HOOK('/invoice') && !JSON.stringify(ci.data.invoice).includes('whsec_'))
  hook.got.length = 0
  check('test event on an invoice webhook', (await admin(`/api/admin/invoices/${ci.data.invoice.id}/webhook/test`, 'POST')).data?.delivery?.state === 'delivered' && merchantVerifies(hook.got[0], ci.data.secret))
  check('refused: an invoice webhook to a private address', (await admin(`/api/admin/invoices/${ci.data.invoice.id}/webhook`, 'POST', { url: 'https://10.1.2.3/x' })).status === 400)
  const def = await admin('/api/admin/pay-webhooks/default', 'POST', { url: HOOK('/default') })
  check('a global default endpoint is set; its secret is shown once', def.status === 200 && /^whsec_/.test(def.data.secret) && (await admin('/api/admin/pay-webhooks')).data.default?.url === HOOK('/default'))
  const plain = (await admin('/api/admin/invoices', 'POST', { title: 'No own hook', usd: '15', assets: ['base-usdc'] })).data.invoice
  const qp = (await payPost(`/api/pay/${plain.id}/quote`, { asset: 'base-usdc' }, '198.51.100.40')).data.quote
  hook.got.length = 0
  r = await payPost(`/api/pay/${plain.id}/verify`, { quoteId: qp.id, txHash: base.add({ from: payer, value: BigInt(qp.amountRaw), token: TOKENS.baseUsdc }) }, '198.51.100.40')
  await processDue()
  check('an invoice with no endpoint of its own sends to the default', r.status === 200 && hook.got.length === 1 && hook.got[0].path === '/default' && merchantVerifies(hook.got[0], def.data.secret) && JSON.parse(hook.got[0].body).data.link === null)

  /* -------------------------------------------- persistence across a restart --- */
  // A delivery fails now and is due later; a NEW process loads the queue from disk and delivers it.
  await admin('/api/admin/pay-webhooks/default', 'POST', { url: null })
  hook.status = 500
  hook.got.length = 0
  const inv7 = (await payPost(`/api/pay/l/${retryLink.id}/invoice`, {}, '198.51.100.50')).data.invoice
  const q7 = (await payPost(`/api/pay/${inv7.id}/quote`, { asset: 'eth-usdt' }, '198.51.100.50')).data.quote
  r = await payPost(`/api/pay/${inv7.id}/verify`, { quoteId: q7.id, txHash: eth.add({ from: payer, value: BigInt(q7.amountRaw), token: TOKENS.ethUsdt }) }, '198.51.100.50')
  await processDue()
  const d7 = deliveriesForTest().find((d) => d.invoiceId === inv7.id && d.type === 'invoice.paid')
  check('before the restart: one failed attempt, pending', r.status === 200 && d7?.state === 'pending' && d7.attempts.length === 1)
  hook.status = 200
  hook.got.length = 0
  const child = spawn(process.execPath, ['--input-type=module', '-e', "const w = await import('./server/pay-webhooks.mjs'); await new Promise((r) => setTimeout(r, 400)); const n = await w.processDue(Date.now() + 3_600_000); console.log('sent', n); process.exit(0)"], {
    cwd: ROOT,
    env: { ...process.env, ...CHAIN_ENV, DATA_DIR: tmp, GULLY_PAY_WEBHOOK_TICK_MS: '0', GULLY_ALLOW_LOOPBACK_WEBHOOKS: '1', TRACKER_LOOP: 'off', TELEGRAM_BOT_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', (d) => (out += d))
  child.stderr.on('data', (d) => (out += d))
  await new Promise((res) => child.on('exit', res))
  const after = JSON.parse(fs.readFileSync(path.join(tmp, 'pay-webhooks.json'), 'utf8')).deliveries.find((d) => d.id === d7.id)
  check('after a restart the pending delivery is sent from the saved queue', /sent [1-9]/.test(out) && hook.got.some((g) => g.path === '/retry' && JSON.parse(g.body).data?.invoice?.id === inv7.id), out.trim().slice(0, 300))
  check('…signed with the link secret, and recorded as delivered on disk', hook.got.some((g) => merchantVerifies(g, retrySecret)) && after?.state === 'delivered' && after.attempts.length === 2)

  /* ------------------------------------------------------------- pages --- */
  const { pageMeta } = await import('../server/seo.mjs')
  const lm = pageMeta('gullylabs.xyz', `/pay/l/${fixed.id}`)
  check('/pay/l/<id> is a page that is never indexed', lm.found && lm.noindex && !lm.canonical)
  check('the Gully Pay docs page has its own title', pageMeta('docs.gullylabs.xyz', '/gully-pay').found)
} catch (e) {
  check(`no exception (${e?.stack ?? e})`, false)
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
for (const c of Object.values(chains)) c.server.close()
hook.server.close()
try {
  fs.rmSync(tmp, { recursive: true, force: true })
} catch {
  /* temp dir */
}
process.exit(t.failed ? 1 : 0)
