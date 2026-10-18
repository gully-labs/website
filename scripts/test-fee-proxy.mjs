// Tests of the one-transaction merchant + fee payment through Request Network's ERC20FeeProxy
// (server/payments.mjs: withFeeSplit, quoteSplit, feeProxyPayments, creditFeeProxy and the readPayment hook).
//
//   node scripts/test-fee-proxy.mjs      (no build, no network: Base is a local JSON-RPC stub)
//
// Call data is checked by decoding it with viem (an encoder independent of the server's hand-written one);
// the stub's logs are encoded with viem too, in the exact layout the fork tests in contracts/ saw on chain.

import crypto from 'node:crypto'
import http from 'node:http'
import { decodeFunctionData, encodeAbiParameters, erc20Abi, keccak256, parseAbi, toEventSelector } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { makeChecker } from './test-helpers.mjs'

const t = makeChecker()
const { check } = t
const addr = () => privateKeyToAccount(generatePrivateKey()).address.toLowerCase()
const TREASURY = addr()
const MERCHANT = addr()
const PAYER = addr()
const OTHER = addr()
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const PROXY = '0x1892196e80c4c17ea5100da765ab48c1fe2fb814'
const TRANSFER = toEventSelector('Transfer(address,address,uint256)')
const FEE_EVENT = 'TransferWithReferenceAndFee(address,address,uint256,bytes,uint256,address)'
const proxyAbi = parseAbi(['function transferFromWithReferenceAndFee(address tokenAddress, address to, uint256 amount, bytes paymentReference, uint256 feeAmount, address feeAddress)'])

/* ---------------------------------------------------------- Base stub --- */

const pad = (a) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0')
const hex = (n) => '0x' + BigInt(n).toString(16)
const randHash = () => '0x' + crypto.randomBytes(32).toString('hex')
const head = 5_000_000
const receipts = new Map()
const txs = new Map()
const transferLog = (token, from, to, value) => ({ address: token, topics: [TRANSFER, pad(from), pad(to)], data: pad(hex(value)) })
const proxyLog = ({ emitter = PROXY, token = USDC, to = MERCHANT, amount, ref, fee, feeAddress = TREASURY }) => ({
  address: emitter,
  topics: [toEventSelector(FEE_EVENT), keccak256(ref)],
  data: encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address' }], [token, to, amount, fee, feeAddress]),
})
function addTx({ logs, to = PROXY, value = 0n, from = PAYER }) {
  const hash = randHash()
  receipts.set(hash, { transactionHash: hash, status: '0x1', blockNumber: hex(head - 30), from, logs })
  txs.set(hash, { hash, from, to, value: hex(value), blockNumber: hex(head - 30), chainId: hex(8453) })
  return hash
}
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    const q = JSON.parse(body)
    let result = null
    if (q.method === 'eth_chainId') result = hex(8453)
    else if (q.method === 'eth_blockNumber') result = hex(head)
    else if (q.method === 'eth_getTransactionReceipt') result = receipts.get(q.params[0]) ?? null
    else if (q.method === 'eth_getTransactionByHash') result = txs.get(q.params[0]) ?? null
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }))
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
process.env.GULLY_RPC_8453 = `http://127.0.0.1:${server.address().port}`
process.env.GULLY_TREASURY_ADDRESS = TREASURY

const P = await import('../server/payments.mjs')
const base = P.assetById('base-usdc')
const baseEth = P.assetById('base-eth')

/* ----------------------------------------------------------- constants --- */

check('event topic matches the ABI (viem)', P.FEE_PROXY_TOPIC === toEventSelector(FEE_EVENT), P.FEE_PROXY_TOPIC)
check('a proxy on every Gully Pay chain', P.CHAIN_LIST.every((c) => /^0x[0-9a-f]{40}$/.test(P.FEE_PROXIES[c.id] ?? '')))
check('proxy addresses are the verified ones', P.FEE_PROXIES[8453] === PROXY && P.FEE_PROXIES[1] === '0x370de27fdb7d1ff1e1baa7d11c5820a324cf623c' && P.FEE_PROXIES[56] === '0x0dfbee143b42b41efc5a6f87bfd1ffc78c2f0ac9' && P.FEE_PROXIES[42161] === '0x0dfbee143b42b41efc5a6f87bfd1ffc78c2f0ac9')
const r1 = P.paymentReference('q_abc')
check('payment reference is 8 bytes and stable', /^0x[0-9a-f]{16}$/.test(r1) && r1 === P.paymentReference('q_abc') && r1 !== P.paymentReference('q_abd'), r1)
check('fee rounds down', P.feeOf(199n, 50) === 0n && P.feeOf(200n, 50) === 1n && P.feeOf(100_000_000n, 50) === 500_000n)

/* ---------------------------------------------------------- withFeeSplit --- */

const quote = (over = {}) => ({ id: 'q_' + crypto.randomBytes(6).toString('hex'), assetId: 'base-usdc', amountRaw: '100000123', treasury: MERCHANT, ...over })
const q = P.withFeeSplit(quote(), { bps: 50, feeTo: TREASURY })
check('token quote gets a split', q.feeRaw === '500000' && q.feeTo === TREASURY && q.ref === P.paymentReference(q.id), JSON.stringify(q))
check('native coin keeps the plain transfer', P.withFeeSplit(quote({ assetId: 'base-eth' }), { bps: 50, feeTo: TREASURY }).feeRaw === undefined)
check('zero fee (free tier) keeps the plain transfer', P.withFeeSplit(quote(), { bps: 0, feeTo: TREASURY }).feeRaw === undefined)
check('fee too small to round above 0 keeps the plain transfer', P.withFeeSplit(quote({ amountRaw: '199' }), { bps: 50, feeTo: TREASURY }).feeRaw === undefined)
check('no split when the merchant is the treasury', P.withFeeSplit(quote({ treasury: TREASURY }), { bps: 50, feeTo: TREASURY }).feeRaw === undefined)
check('no split without a valid treasury', P.withFeeSplit(quote(), { bps: 50, feeTo: '0x' + '0'.repeat(40) }).feeRaw === undefined && P.withFeeSplit(quote(), { bps: 50, feeTo: null }).feeRaw === undefined)
check("an explicit fee (a store's fee above its free allowance) is used as given", P.withFeeSplit(quote(), { bps: 50, feeTo: TREASURY, feeRaw: 123_456n }).feeRaw === '123456')
check('an explicit fee not below the amount keeps the plain transfer', P.withFeeSplit(quote(), { bps: 50, feeTo: TREASURY, feeRaw: BigInt(quote().amountRaw) }).feeRaw === undefined)

/* ------------------------------------------------------------ quoteSplit --- */

const s = P.quoteSplit(q)
check('quoteSplit builds the calls', !!s && s.proxy === PROXY && s.pay.to === PROXY && s.approve.to === USDC)
const pay = decodeFunctionData({ abi: proxyAbi, data: s.pay.data })
check(
  'pay data decodes (viem) to token, merchant, total - fee, ref, fee, treasury',
  pay.functionName === 'transferFromWithReferenceAndFee' &&
    pay.args[0].toLowerCase() === USDC &&
    pay.args[1].toLowerCase() === MERCHANT &&
    pay.args[2] === 99_500_123n &&
    pay.args[3] === q.ref &&
    pay.args[4] === 500_000n &&
    pay.args[5].toLowerCase() === TREASURY,
  JSON.stringify(pay.args, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
)
check('merchant + fee = what the payer pays', BigInt(s.merchantRaw) + BigInt(s.feeRaw) === BigInt(q.amountRaw))
const ap = decodeFunctionData({ abi: erc20Abi, data: s.approve.data })
check('approve is for the proxy and exactly the total', ap.functionName === 'approve' && ap.args[0].toLowerCase() === PROXY && ap.args[1] === 100_000_123n)
const rs = decodeFunctionData({ abi: erc20Abi, data: s.approveReset.data })
check('approveReset sets the allowance to 0 (USDT)', rs.args[0].toLowerCase() === PROXY && rs.args[1] === 0n)
const long = P.quoteSplit({ ...q, ref: '0x' + 'ab'.repeat(40) })
check('references longer than one word encode correctly', decodeFunctionData({ abi: proxyAbi, data: long.pay.data }).args[3] === '0x' + 'ab'.repeat(40))
check('no split for a plain quote', P.quoteSplit(quote()) === null && P.quoteSplit(null) === null)
check('no split for native coin even if fields are forced', P.quoteSplit({ ...q, assetId: 'base-eth' }) === null)
check('no split when fee >= total', P.quoteSplit({ ...q, feeRaw: q.amountRaw }) === null)

/* ----------------------------------------------- reading proxy payments --- */

const amount = 99_500_123n
const fee = 500_000n
const viaProxy = (over = {}) =>
  addTx({ logs: [transferLog(USDC, PAYER, MERCHANT, amount), transferLog(USDC, PAYER, over.feeAddress ?? TREASURY, fee), proxyLog({ amount, fee, ref: q.ref, ...over })] })

let r = await P.readPayment(base, viaProxy(), MERCHANT)
check('proxy payment: credited as merchant leg + fee', r.ok && r.credits.length === 1 && r.credits[0].from === PAYER && r.credits[0].value === amount + fee, JSON.stringify(r, (_, v) => (typeof v === 'bigint' ? v.toString() : v)))
check('proxy payment: carries the fee and the reference topic', r.credits[0].fee === fee && r.credits[0].ref === keccak256(q.ref))
check('proxy payment: total equals the quote, so the exact-amount match holds', r.credits[0].value === BigInt(q.amountRaw))

r = await P.readPayment(base, addTx({ to: USDC, logs: [transferLog(USDC, PAYER, MERCHANT, BigInt(q.amountRaw))] }), MERCHANT)
check('plain transfer (QR / EIP-681) still credited in full, no fee', r.ok && r.credits[0].value === BigInt(q.amountRaw) && r.credits[0].fee === undefined)

r = await P.readPayment(base, viaProxy({ feeAddress: OTHER }), MERCHANT)
check('fee to anyone but the treasury does not count', r.ok && r.credits[0].value === amount && r.credits[0].fee === undefined)

r = await P.readPayment(base, addTx({ logs: [transferLog(USDC, PAYER, MERCHANT, amount), transferLog(USDC, PAYER, TREASURY, fee), proxyLog({ emitter: OTHER, amount, fee, ref: q.ref })] }), MERCHANT)
check('an event from another contract is ignored', r.ok && r.credits[0].value === amount && r.credits[0].fee === undefined)

r = await P.readPayment(base, addTx({ logs: [transferLog(USDC, PAYER, MERCHANT, amount), proxyLog({ amount, fee, ref: q.ref })] }), MERCHANT)
check('an event without the fee Transfer is ignored', r.ok && r.credits[0].value === amount && r.credits[0].fee === undefined)

r = await P.readPayment(base, addTx({ logs: [transferLog(USDC, PAYER, MERCHANT, amount), transferLog(USDC, OTHER, TREASURY, fee), proxyLog({ amount, fee, ref: q.ref })] }), MERCHANT)
check('a fee paid by another wallet is not added', r.ok && r.credits[0].value === amount && r.credits[0].fee === undefined)

r = await P.readPayment(base, viaProxy({ to: OTHER }), MERCHANT)
check('an event for another merchant adds nothing', r.ok && r.credits[0].value === amount && r.credits[0].fee === undefined)

r = await P.readPayment(base, addTx({ logs: [transferLog(USDC, PAYER, OTHER, amount), transferLog(USDC, PAYER, TREASURY, fee), proxyLog({ to: OTHER, amount, fee, ref: q.ref })] }), MERCHANT)
check('a proxy payment to another merchant is not ours', !r.ok && r.status === 422)

r = await P.readPayment(base, viaProxy(), TREASURY)
check('paying the treasury itself: plain Transfer reading, no double count', r.ok && r.credits.length === 1 && r.credits[0].value === fee && r.credits[0].fee === undefined)

r = await P.readPayment(baseEth, addTx({ to: MERCHANT, value: 10n ** 18n, logs: [] }), MERCHANT)
check('native coin reading is unchanged', r.ok && r.credits[0].value === 10n ** 18n)

const two = addTx({
  logs: [transferLog(USDC, PAYER, MERCHANT, amount), transferLog(USDC, PAYER, TREASURY, fee), proxyLog({ amount, fee, ref: q.ref }), transferLog(USDC, PAYER, MERCHANT, amount), transferLog(USDC, PAYER, TREASURY, fee), proxyLog({ amount, fee, ref: q.ref })],
})
r = await P.readPayment(base, two, MERCHANT)
check('two proxy payments in one tx: each credit made whole once', r.ok && r.credits.length === 2 && r.credits.every((c) => c.value === amount + fee && c.fee === fee))

server.close()
console.log(`\n${t.passed} passed, ${t.failed} failed`)
process.exit(t.failed ? 1 : 0)
