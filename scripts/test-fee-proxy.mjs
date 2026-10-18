// Tests of the one-transaction merchant + fee payment through Request Network's ERC20FeeProxy
// (server/payments.mjs: withFeeSplit, quoteSplit, feeProxyPayments, creditFeeProxy and the readPayment hook),
// of the fee-proxy guards (server/fee-proxy-guard.mjs, server/pay-guard.mjs: every rule, each broken one way at a
// time) and of the balance monitor (server/fee-proxy-monitor.mjs) against stubbed balances.
//
//   node scripts/test-fee-proxy.mjs      (no build, no network: every chain is a local JSON-RPC stub)
//
// Call data is checked by decoding it with viem (an encoder independent of the server's hand-written one);
// the stub's logs are encoded with viem too, in the exact layout the fork tests in contracts/ saw on chain.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { decodeFunctionData, encodeAbiParameters, encodeFunctionData, erc20Abi, keccak256, parseAbi, toEventSelector } from 'viem'
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
// Balances the monitor reads: `${chainId}:${holder}` (coin) and `${chainId}:${token}:${holder}` (ERC-20), default 0.
const balances = new Map()
const balanceReads = { n: 0, fail: new Set() } // fail: keys whose read answers an RPC error
function makeStub(chainId) {
  return http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      const q = JSON.parse(body)
      let result = null
      let error = null
      if (q.method === 'eth_chainId') result = hex(chainId)
      else if (q.method === 'eth_blockNumber') result = hex(head)
      else if (q.method === 'eth_getTransactionReceipt') result = receipts.get(q.params[0]) ?? null
      else if (q.method === 'eth_getTransactionByHash') result = txs.get(q.params[0]) ?? null
      else if (q.method === 'eth_getBalance') {
        const key = `${chainId}:${String(q.params[0]).toLowerCase()}`
        balanceReads.n++
        if (balanceReads.fail.has(key)) error = { code: -32000, message: 'stub: node down' }
        else result = pad(hex(balances.get(key) ?? 0n))
      } else if (q.method === 'eth_call' && String(q.params[0].data).startsWith('0x70a08231')) {
        const key = `${chainId}:${String(q.params[0].to).toLowerCase()}:0x${q.params[0].data.slice(34).toLowerCase()}`
        balanceReads.n++
        if (balanceReads.fail.has(key)) error = { code: -32000, message: 'stub: node down' }
        else result = pad(hex(balances.get(key) ?? 0n))
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(error ? { jsonrpc: '2.0', id: q.id, error } : { jsonrpc: '2.0', id: q.id, result }))
    })
  })
}
const stubs = Object.fromEntries([8453, 1, 56, 42161].map((id) => [id, makeStub(id)]))
for (const s of Object.values(stubs)) await new Promise((r) => s.listen(0, '127.0.0.1', r))
const server = stubs[8453]
for (const [id, s] of Object.entries(stubs)) process.env[`GULLY_RPC_${id}`] = `http://127.0.0.1:${s.address().port}`
delete process.env.GULLY_BASE_RPC
process.env.GULLY_TREASURY_ADDRESS = TREASURY
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-feeproxy-'))
process.env.DATA_DIR = tmp // the monitor's state file

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

/* --------------------------------------------- fee-proxy guard: the rules --- */
// server/fee-proxy-guard.mjs is pure and shared with the browser. Every rule, each broken one way at a time.

const G = await import('../server/fee-proxy-guard.mjs')
const ZERO = '0x' + '0'.repeat(40)
const ALL = G.allFeeProxies()
check('registry: every Gully Pay chain has its split proxy, and it is in the registry', P.CHAIN_LIST.every((c) => G.SPLIT_PROXIES[c.id] && G.FEE_PROXY_REGISTRY[c.id]?.erc20.includes(G.SPLIT_PROXIES[c.id])))
check('registry: payments.FEE_PROXIES is the guard list', Object.entries(P.FEE_PROXIES).every(([id, a]) => G.splitProxyFor(Number(id)) === a))
check('registry: the mainnet proxies of CHOICE.md (both kinds) and the Base Sepolia ones are known', ['0x370de27fdb7d1ff1e1baa7d11c5820a324cf623c', '0x0dfbee143b42b41efc5a6f87bfd1ffc78c2f0ac9', '0x1892196e80c4c17ea5100da765ab48c1fe2fb814', '0xfcfbcfc4f5a421089e3df45455f7f4985fe2d6a8', '0xd9c3889eb8da6ce449bffe3cd194d08a436e96f2', '0x399f5ee127ce7432e4921a61b8cf52b0af52cbfe', '0xe11bf2fda23bf0a98365e1a4c04a87c9339e8687', '0xae5508e1509cce6a73b38d8b19fedfdbd0080c18', '0xd302ce9e3048ad676c6e74be57042aca31e2957e'].every((a) => ALL.has(a)), [...ALL].join())
check('isFeeProxy: every known proxy, in any case, with spaces; never a wallet, zero or garbage', [...ALL].every((a) => G.isFeeProxy(a) && G.isFeeProxy(a.toUpperCase().replace('0X', '0x')) && G.isFeeProxy(` ${a} `)) && !G.isFeeProxy(MERCHANT) && !G.isFeeProxy(ZERO) && !G.isFeeProxy('proxy') && !G.isFeeProxy(null))
process.env.GULLY_FEEPROXY_84532 = '0x' + 'ab'.repeat(20)
check('isFeeProxy: a testnet proxy from GULLY_FEEPROXY_<chainId> counts too, and is the split proxy there', G.isFeeProxy('0x' + 'ab'.repeat(20)) && G.splitProxyFor(84532) === '0x' + 'ab'.repeat(20))
delete process.env.GULLY_FEEPROXY_84532
check('splitProxyFor: Base Sepolia falls back to the registry proxy we deployed; an unknown chain has none', G.splitProxyFor(84532) === '0xae5508e1509cce6a73b38d8b19fedfdbd0080c18' && G.splitProxyFor(999) === null)

// (a) recipients
check('rule a: a wallet passes', G.recipientViolations(MERCHANT, { chainId: 8453 }).length === 0 && G.recipientViolations(TREASURY).length === 0)
check('rule a: every known proxy is refused as a recipient, on every chain (not only its own)', [...ALL].every((a) => [8453, 1, 56, 42161, 10].every((id) => G.recipientViolations(a, { chainId: id }).some((v) => /fee proxy/.test(v)))))
check('rule a: the zero address, a non-address, nothing', G.recipientViolations(ZERO).some((v) => /zero/.test(v)) && G.recipientViolations('0x1234').some((v) => /not an EVM/.test(v)) && G.recipientViolations('').length === 1 && G.recipientViolations(null).length === 1)
check('rule a: a Solana (base58) recipient is not an EVM proxy', G.recipientViolations('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', { chainId: G.SOLANA_LEDGER_CHAIN_ID }).length === 0)

// (c) assets
const mainnetTokens = P.ASSETS.filter((a) => a.kind === 'token' && !a.chainId.toString().startsWith('1151'))
check('rule c: every token in the asset list is an allowed stablecoin, with the right symbol', mainnetTokens.every((a) => G.allowedToken(a.chainId, a.address) === a.symbol && G.assetViolations(a).length === 0))
check('rule c: every allowed mainnet token is in the asset list (the two lists agree both ways)', Object.entries(G.ALLOWED_TOKENS).filter(([id]) => P.CHAIN_LIST.some((c) => c.id === Number(id))).every(([id, m]) => Object.entries(m).every(([addr, sym]) => P.ASSETS.some((a) => a.chainId === Number(id) && a.address === addr && a.symbol === sym))))
check('rule c: native coins pass; a native asset with a token address does not', G.assetViolations(baseEth).length === 0 && G.assetViolations({ ...baseEth, address: USDC }).length === 1)
check('rule c: an unknown token, a known token on the wrong chain, a wrong symbol, a proxy as token', G.assetViolations({ chainId: 8453, kind: 'token', symbol: 'DAI', address: OTHER }).length === 1 && G.assetViolations({ chainId: 1, kind: 'token', symbol: 'USDC', address: USDC }).length === 1 && G.assetViolations({ chainId: 8453, kind: 'token', symbol: 'USDT', address: USDC }).length === 1 && G.assetViolations({ chainId: 8453, kind: 'token', symbol: 'USDC', address: PROXY }).length === 1 && G.assetViolations(null).length === 1 && G.assetViolations({ chainId: 8453, kind: 'nft', address: USDC }).length === 1)

// (b) the split, as quoteSplit builds it
const ctx = { chainId: 8453, token: USDC, total: q.amountRaw, to: MERCHANT, feeTo: TREASURY }
const goodSplit = P.quoteSplit(q)
check('rule b: the split quoteSplit builds passes every check', G.splitViolations(goodSplit, ctx).length === 0, G.splitViolations(goodSplit, ctx).join('; '))
check('rule b: decodePayCall agrees with viem', (() => { const d = G.decodePayCall(goodSplit.pay.data); return d.token === USDC && d.to === MERCHANT && d.amount === 99_500_123n && d.fee === 500_000n && d.feeAddress === TREASURY && d.ref === q.ref })())
check('rule b: decodeApprove agrees with viem', (() => { const d = G.decodeApprove(goodSplit.approve.data); return d.spender === PROXY && d.amount === 100_000_123n })())
const payData = (over = {}) => encodeFunctionData({ abi: proxyAbi, functionName: 'transferFromWithReferenceAndFee', args: [over.token ?? USDC, over.to ?? MERCHANT, over.amount ?? 99_500_123n, over.ref ?? q.ref, over.fee ?? 500_000n, over.feeAddress ?? TREASURY] })
const approveData = (spender, amount) => encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] })
const broken = (name, mutate, re, c = ctx) => {
  const s = structuredClone(goodSplit)
  mutate(s)
  const v = G.splitViolations(s, c)
  check(`rule b: ${name} is refused`, v.length > 0 && (!re || v.some((x) => re.test(x))), v.join('; ') || 'no violation')
}
broken('a split naming another contract as the proxy', (s) => (s.proxy = OTHER), /other than the known fee proxy/)
broken('a split whose spender is not the proxy', (s) => (s.spender = OTHER), /other than the known fee proxy/)
broken('a payment call to a contract other than the proxy', (s) => (s.pay.to = OTHER), /does not target the fee proxy/)
broken('native value on the payment call', (s) => (s.pay.value = '1'), /native value/)
broken('native value on the approval', (s) => (s.approve.value = '0x1'), /native value/)
broken('native value on the allowance reset', (s) => (s.approveReset.value = 5), /native value/)
broken('a token that is not an allowed stablecoin', () => {}, /not an allowed stablecoin/, { ...ctx, token: OTHER })
broken('a payment call that is not transferFromWithReferenceAndFee (ERC-20 transfer)', (s) => (s.pay.data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [MERCHANT, 1n] })), /not transferFromWithReferenceAndFee/)
broken('unreadable call data', (s) => (s.pay.data = '0xc219a14d00'), /not transferFromWithReferenceAndFee/)
broken('a non-canonical encoding (reference offset moved)', (s) => (s.pay.data = '0x' + s.pay.data.slice(2, 10 + 3 * 64) + (200n).toString(16).padStart(64, '0') + s.pay.data.slice(10 + 4 * 64)), /not transferFromWithReferenceAndFee/)
broken('a payment call naming another token', (s) => (s.pay.data = payData({ token: OTHER })), /another token/)
broken('`to` = the fee proxy', (s) => (s.pay.data = payData({ to: PROXY })), /`to` is zero or a fee proxy/)
broken('`to` = another chain\'s fee proxy', (s) => (s.pay.data = payData({ to: '0x0dfbee143b42b41efc5a6f87bfd1ffc78c2f0ac9' })), /`to` is zero or a fee proxy/)
broken('`to` = the zero address', (s) => (s.pay.data = payData({ to: ZERO })), /`to` is zero or a fee proxy/)
broken('`to` = someone other than the quote recipient', (s) => (s.pay.data = payData({ to: OTHER })), /not the expected recipient/)
broken('`feeAddress` = the fee proxy', (s) => (s.pay.data = payData({ feeAddress: PROXY })), /`feeAddress` is zero or a fee proxy/)
broken('`feeAddress` = the zero address', (s) => (s.pay.data = payData({ feeAddress: ZERO })), /`feeAddress` is zero or a fee proxy/)
broken('`feeAddress` = someone other than the treasury', (s) => (s.pay.data = payData({ feeAddress: OTHER })), /not the treasury/)
broken('`feeAddress` = `to`', (s) => (s.pay.data = payData({ feeAddress: MERCHANT })), /`feeAddress` equals `to`/, { ...ctx, feeTo: MERCHANT })
broken('a zero fee', (s) => (s.pay.data = payData({ fee: 0n, amount: 100_000_123n })), /fee is not between/)
broken('a fee not below the amount', (s) => (s.pay.data = payData({ fee: 60_000_000n, amount: 40_000_123n })), /fee is not between/)
broken('amount + fee that is not what the payer pays', (s) => (s.pay.data = payData({ amount: 99_500_122n })), /not what the payer pays/)
broken('a payment reference that is not the quote\'s', (s) => (s.pay.data = payData({ ref: '0x' + '11'.repeat(8) })), /reference does not match/)
broken('a summary that disagrees with the call data', (s) => (s.merchantRaw = '1'), /summary does not match/)
broken('an approval for another spender', (s) => (s.approve.data = approveData(OTHER, 100_000_123n)), /approval is not for the fee proxy/)
broken('an approval above amount + fee', (s) => (s.approve.data = approveData(PROXY, 100_000_124n)), /approval is not for the fee proxy/)
broken('an approval below amount + fee', (s) => (s.approve.data = approveData(PROXY, 100_000_122n)), /approval is not for the fee proxy/)
broken('an approval on another token', (s) => (s.approve.to = OTHER), /approval is not for the fee proxy/)
broken('an allowance reset that is not approve(proxy, 0)', (s) => (s.approveReset.data = approveData(PROXY, 1n)), /allowance reset/)
broken('a chain with no fee proxy', () => {}, /no fee proxy is known/, { ...ctx, chainId: 999 })
check('rule b: a missing split', G.splitViolations(null, ctx).length === 1 && G.splitViolations('x', ctx).length === 1)

// what a wallet may send
check('tx: the split calls pass (approve on the token, the pay call on the proxy with value 0)', G.txViolations({ to: goodSplit.approve.to, data: goodSplit.approve.data, value: 0n }).length === 0 && G.txViolations({ to: goodSplit.pay.to, data: goodSplit.pay.data, value: 0n }).length === 0 && G.txViolations({ to: PROXY, data: goodSplit.pay.data }).length === 0)
check('tx: plain transfers to a wallet pass (coin and token)', G.txViolations({ to: MERCHANT, value: 10n ** 18n }).length === 0 && G.txViolations({ to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [MERCHANT, 5n] }) }).length === 0)
check('tx: native value to a proxy is refused', G.txViolations({ to: PROXY, value: 1n }).some((v) => /native value/.test(v)) && G.txViolations({ to: PROXY, data: goodSplit.pay.data, value: '0x1' }).some((v) => /native value/.test(v)))
check('tx: a call to a proxy other than transferFromWithReferenceAndFee is refused (empty data too)', G.txViolations({ to: PROXY, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [MERCHANT, 1n] }) }).length === 1 && G.txViolations({ to: PROXY }).length === 1)
check('tx: an ERC-20 transfer whose recipient is a proxy is refused', G.txViolations({ to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [PROXY, 5n] }) }).some((v) => /token transfer to a fee proxy/.test(v)))
check('tx: an ERC-20 transferFrom whose recipient is a proxy is refused', G.txViolations({ to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transferFrom', args: [PAYER, '0xfcfbcfc4f5a421089e3df45455f7f4985fe2d6a8', 5n] }) }).some((v) => /token transfer to a fee proxy/.test(v)))
check('tx: no recipient', G.txViolations({ to: '0x12' }).length === 1 && G.txViolations(null).length === 1)

// the URIs
const uriTok = P.paymentUri(base, MERCHANT, '100000123')
const uriEth = P.paymentUri(baseEth, MERCHANT, '1000')
check('uri: parses the EIP-681 token form', JSON.stringify(G.parsePaymentUri(uriTok)) === JSON.stringify({ scheme: 'ethereum', token: USDC, chainId: 8453, to: MERCHANT, amount: '100000123' }), uriTok)
check('uri: parses the EIP-681 coin form', JSON.stringify(G.parsePaymentUri(uriEth)) === JSON.stringify({ scheme: 'ethereum', token: null, chainId: 8453, to: MERCHANT, amount: '1000' }), uriEth)
check('uri: parses a Solana Pay request', G.parsePaymentUri('solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v?amount=1.5&spl-token=Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB&reference=abc')?.amount === '1.5')
check('uri: anything else is unreadable', G.parsePaymentUri('ethereum:' + PROXY) === null && G.parsePaymentUri('') === null && G.parsePaymentUri(null) === null)
check('paymentUri refuses a fee proxy (any chain) and the zero address as recipient', [...ALL, ZERO].every((a) => { try { P.paymentUri(base, a, '1'); return false } catch (e) { return /refusing a payment link/.test(e.message) } }))
check('paymentUri refuses a coin link to a proxy too', (() => { try { P.paymentUri(baseEth, PROXY, '1'); return false } catch { return true } })())

// withFeeSplit / quoteSplit
check('withFeeSplit: a proxy as fee address keeps the plain transfer', P.withFeeSplit(quote(), { bps: 50, feeTo: PROXY }).feeRaw === undefined && P.withFeeSplit(quote(), { bps: 50, feeTo: '0xfcfbcfc4f5a421089e3df45455f7f4985fe2d6a8' }).feeRaw === undefined)
check('withFeeSplit: a proxy as recipient is never split', P.withFeeSplit(quote({ treasury: PROXY }), { bps: 50, feeTo: TREASURY }).feeRaw === undefined)
check('quoteSplit: every call carries value 0 explicitly', goodSplit.pay.value === '0' && goodSplit.approve.value === '0' && goodSplit.approveReset.value === '0')

// pay-guard.mjs: the server-side check of a quote view
const PG = await import('../server/pay-guard.mjs')
const view = (over = {}) => ({ id: 'q_view', kind: 'merchant', asset: { id: 'base-usdc', chainId: 8453, chain: 'Base', symbol: 'USDC', kind: 'token', address: USDC, decimals: 6 }, chainId: 8453, token: USDC, treasury: MERCHANT, amountRaw: q.amountRaw, uri: P.paymentUri(base, MERCHANT, q.amountRaw), split: null, ...over })
check('pay-guard: a plain quote view passes', PG.quoteViolations(view()).length === 0, PG.quoteViolations(view()).join('; '))
check('pay-guard: a split quote view passes (feeAddress = GULLY_TREASURY_ADDRESS)', PG.quoteViolations(view({ split: goodSplit })).length === 0, PG.quoteViolations(view({ split: goodSplit })).join('; '))
check('pay-guard: a coin quote view passes', PG.quoteViolations(view({ asset: { id: 'base-eth', chainId: 8453, chain: 'Base', symbol: 'ETH', kind: 'native', address: null, decimals: 18 }, token: null, uri: uriEth, amountRaw: '1000' })).length === 0)
check('pay-guard: a proxy as the quote recipient', PG.quoteViolations(view({ treasury: PROXY, uri: `ethereum:${P.checksumAddress(USDC)}@8453/transfer?address=${P.checksumAddress(PROXY)}&uint256=${q.amountRaw}` })).some((v) => /fee proxy/.test(v)))
check('pay-guard: a link that does not say what the quote says (other recipient, amount, chain, token)', PG.quoteViolations(view({ uri: P.paymentUri(base, OTHER, q.amountRaw) })).some((v) => /pays someone other/.test(v)) && PG.quoteViolations(view({ uri: P.paymentUri(base, MERCHANT, '1') })).some((v) => /another amount/.test(v)) && PG.quoteViolations(view({ uri: uriTok.replace('@8453', '@1') })).some((v) => /another chain/.test(v)) && PG.quoteViolations(view({ uri: P.paymentUri(baseEth, MERCHANT, q.amountRaw) })).some((v) => /another token/.test(v)))
check('pay-guard: an unknown asset, a mismatched asset, a non-positive amount, a split on a coin', PG.quoteViolations(view({ asset: { id: 'nope' } })).length === 1 && PG.quoteViolations(view({ token: OTHER })).some((v) => /does not match the asset list/.test(v)) && PG.quoteViolations(view({ amountRaw: '0' })).some((v) => /not positive/.test(v)) && PG.quoteViolations(view({ asset: { id: 'base-eth', chainId: 8453, chain: 'Base', symbol: 'ETH', kind: 'native', address: null, decimals: 18 }, token: null, uri: uriEth, amountRaw: '1000', split: goodSplit })).some((v) => /split on a native coin/.test(v)))
const before = PG.recentRefusals().length
let thrown = null
try {
  PG.guardQuoteView(view({ treasury: PROXY }), 'test quote')
} catch (e) {
  thrown = e
}
check('pay-guard: guardQuoteView throws PaymentGuardError (status 500) and records the refusal', thrown instanceof PG.PaymentGuardError && thrown.status === 500 && thrown.violations.length > 0 && PG.recentRefusals().length === before + 1 && /^test quote/.test(PG.recentRefusals()[0].where))
check('pay-guard: the public message names no address', !/0x[0-9a-f]{40}/i.test(PG.GUARD_PUBLIC_ERROR))
check('pay-guard: guardRecipient returns a wallet unchanged and throws on a proxy', PG.guardRecipient(MERCHANT, 't') === MERCHANT && PG.guardRecipient(null, 't') === null && (() => { try { PG.guardRecipient(PROXY, 't'); return false } catch (e) { return e instanceof PG.PaymentGuardError } })())
check('pay-guard: guardOr falls back on a refusal only', PG.guardOr(() => PG.guardRecipient(PROXY, 't'), () => 'fallback') === 'fallback' && (() => { try { PG.guardOr(() => { throw new Error('other') }, () => 'x'); return false } catch (e) { return e.message === 'other' } })())

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

r = await P.readPayment(baseEth, addTx({ to: PROXY, value: 10n ** 18n, logs: [] }), MERCHANT)
check('coin sent straight to a proxy: 422, named as an unrecoverable mis-send', !r.ok && r.status === 422 && r.error === P.PROXY_MIS_SEND)
r = await P.readPayment(base, addTx({ to: USDC, logs: [transferLog(USDC, PAYER, PROXY, amount)] }), MERCHANT)
check('token sent straight to a proxy: 422, named as an unrecoverable mis-send', !r.ok && r.status === 422 && r.error === P.PROXY_MIS_SEND)

const two = addTx({
  logs: [transferLog(USDC, PAYER, MERCHANT, amount), transferLog(USDC, PAYER, TREASURY, fee), proxyLog({ amount, fee, ref: q.ref }), transferLog(USDC, PAYER, MERCHANT, amount), transferLog(USDC, PAYER, TREASURY, fee), proxyLog({ amount, fee, ref: q.ref })],
})
r = await P.readPayment(base, two, MERCHANT)
check('two proxy payments in one tx: each credit made whole once', r.ok && r.credits.length === 2 && r.credits.every((c) => c.value === amount + fee && c.fee === fee))

/* ------------------------------------------------- the balance monitor --- */
// Every proxy on every Gully Pay chain, USDC/USDT and coin, against the stubs' balances (all zero to start).

const Mon = await import('../server/fee-proxy-monitor.mjs')
const sent = []
let reply = { ok: true, status: 200, error: null }
Mon.setFeeProxyNotifierForTest(async (text) => (sent.push(text), reply))
const expectedReads = Mon.targets().reduce((n, c) => n + c.proxies.length * c.assets.length, 0)
check('monitor: watches every chain, both proxy kinds, coin and stablecoins (about 25 reads an hour)', Mon.targets().length === P.CHAIN_LIST.length && Mon.targets().every((c) => c.proxies.length >= 2 && c.assets.length >= 2) && expectedReads >= 20 && expectedReads <= 30, String(expectedReads))
balanceReads.n = 0
let v = await Mon.checkFeeProxies()
check('monitor: a pass reads each balance once; all zero, no alert, no Telegram', balanceReads.n === expectedReads && v.alerts.length === 0 && sent.length === 0 && v.chains.every((c) => c.checkedAt && !c.error && c.proxies.every((p) => p.balances.every((b) => b.raw === '0'))), `${balanceReads.n} reads, ${v.alerts.length} alerts`)
v = await Mon.checkFeeProxies()
check('monitor: a second pass inside the cache window reads nothing from the chain', balanceReads.n === expectedReads)
check('monitor: the state file is written under DATA_DIR', fs.existsSync(path.join(tmp, 'fee-proxy-monitor.json')))

balances.set(`8453:${USDC}:${PROXY}`, 1_500_000n)
Mon.clearFeeProxyCacheForTest()
v = await Mon.checkFeeProxies()
const a0 = v.alerts[0]
check('monitor: 1.5 USDC in the Base ERC20FeeProxy raises one alert', v.alerts.length === 1 && a0.chain === 'Base' && a0.proxy === PROXY && a0.kind === 'ERC20FeeProxy' && a0.symbol === 'USDC' && a0.amount === '1.5' && a0.raw === '1500000', JSON.stringify(v.alerts))
check('monitor: the alert says it is a third-party mis-send that cannot be recovered, with the explorer link', /third-party mis-send/.test(a0.message) && /cannot be recovered/.test(a0.message) && a0.message.includes(`basescan.org/address/${PROXY}`) && a0.message.startsWith('Fee proxy balance: 1.5 USDC'))
check('monitor: one Telegram message, the same text, marked sent', sent.length === 1 && sent[0] === a0.message && a0.telegram === true)
Mon.clearFeeProxyCacheForTest()
v = await Mon.checkFeeProxies()
check('monitor: the same balance next hour is not announced again', sent.length === 1 && v.alerts.length === 1 && v.alerts[0].firstSeenAt === a0.firstSeenAt)
balances.set(`8453:${USDC}:${PROXY}`, 2_500_000n)
Mon.clearFeeProxyCacheForTest()
v = await Mon.checkFeeProxies()
check('monitor: a grown balance is announced once more (2.5 USDC), first seen unchanged', sent.length === 2 && v.alerts.length === 1 && v.alerts[0].amount === '2.5' && v.alerts[0].firstSeenAt === a0.firstSeenAt && /2\.5 USDC/.test(sent[1]))

const ETH_PROXY = '0xfcfbcfc4f5a421089e3df45455f7f4985fe2d6a8'
balances.set(`1:${ETH_PROXY}`, 10n ** 16n)
reply = { ok: false, status: null, error: 'TELEGRAM_ADMIN_CHAT_ID is not set.' }
Mon.clearFeeProxyCacheForTest()
v = await Mon.checkFeeProxies()
const a1 = v.alerts.find((x) => x.chain === 'Ethereum')
check('monitor: 0.01 ETH in the Ethereum EthereumFeeProxy is a second alert', !!a1 && a1.kind === 'EthereumFeeProxy' && a1.symbol === 'ETH' && a1.amount === '0.01' && v.alerts.length === 2, JSON.stringify(v.alerts.map((x) => [x.chain, x.kind, x.amount])))
check('monitor: without an admin chat, the banner is the alert (not retried, telegram false)', sent.length === 3 && a1.telegram === false)
Mon.clearFeeProxyCacheForTest()
await Mon.checkFeeProxies()
check('monitor: "not configured" is final for that amount: no retry next pass', sent.length === 3)
balances.set(`1:${ETH_PROXY}`, 2n * 10n ** 16n)
reply = { ok: false, status: 502, error: 'network' }
Mon.clearFeeProxyCacheForTest()
v = await Mon.checkFeeProxies()
check('monitor: a failed send is retried next pass', sent.length === 4 && v.alerts.find((x) => x.chain === 'Ethereum').telegram === false)
reply = { ok: true, status: 200, error: null }
Mon.clearFeeProxyCacheForTest()
v = await Mon.checkFeeProxies()
check('monitor: ... and succeeds', sent.length === 5 && v.alerts.find((x) => x.chain === 'Ethereum').telegram === true)

balanceReads.fail.add(`42161:${P.assetById('arb-usdc').address}:0x0dfbee143b42b41efc5a6f87bfd1ffc78c2f0ac9`)
Mon.clearFeeProxyCacheForTest()
v = await Mon.checkFeeProxies()
const arb = v.chains.find((c) => c.chainId === 42161)
check('monitor: a failed read is reported on its chain, retried next hour, and raises no alert', /1 balance read failed/.test(arb.error ?? '') && arb.proxies.some((p) => p.balances.some((b) => b.error && b.raw === null)) && v.alerts.length === 2 && v.chains.filter((c) => c.error).length === 1, arb.error)
balanceReads.fail.clear()

process.env.GULLY_TREASURY_ADDRESS = PROXY
check('monitor view: a treasury that is a fee proxy is flagged as a configuration error', Mon.feeProxyView().config.length === 1 && /GULLY_TREASURY_ADDRESS is a fee proxy/.test(Mon.feeProxyView().config[0]))
process.env.GULLY_TREASURY_ADDRESS = TREASURY
check('monitor view: shape for the admin card', (() => { const x = Mon.feeProxyView(); return typeof x.running === 'boolean' && x.intervalMs === Mon.DEFAULT_INTERVAL_MS && typeof x.checkedAt === 'string' && Array.isArray(x.chains) && Array.isArray(x.alerts) && x.misSend === Mon.MIS_SEND_TEXT && x.alerts.every((a) => a.short && a.message) })())
process.env.GULLY_FEEPROXY_MONITOR_MS = '0'
Mon.startFeeProxyMonitor()
check('monitor: GULLY_FEEPROXY_MONITOR_MS=0 keeps the loop off', Mon.feeProxyView().running === false)
delete process.env.GULLY_FEEPROXY_MONITOR_MS

for (const s of Object.values(stubs)) s.close()
try {
  fs.rmSync(tmp, { recursive: true, force: true })
} catch {
  /* windows may hold a file */
}
console.log(`\n${t.passed} passed, ${t.failed} failed`)
process.exit(t.failed ? 1 : 0)
