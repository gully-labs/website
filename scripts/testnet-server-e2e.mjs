// LIVE TESTNET end-to-end run of Gully Pay for merchants through OUR server, on Base Sepolia (84532).
//
//   GULLY_TESTNET_ENV=<path to a KEY=VALUE file outside the repo> node scripts/testnet-server-e2e.mjs
//
// The real server runs in this process on TEST_PORT (default 8797) with a fresh temporary DATA_DIR and Base Sepolia
// enabled only through the test flags (GULLY_TESTNET_CHAINS=84532, GULLY_FEEPROXY_84532 = the proxy deployed by
// contracts/script/DeployFeeProxy.s.sol). The free allowance is set to 0 so the fee applies from the first dollar.
// A store is set up through the portal API (SIWE sign-in, wallet, invoice); the payer then pays from the funded
// test wallet with the call data the server built, and the hash goes to the public verify endpoint. Checks:
//   1. a USDC quote carries a split; approve + proxy call from the server's bytes; verify marks the invoice paid
//      and records the fee as collected on chain, once;
//   2. the same hash is refused for the same invoice and for another one;
//   3. a spoofed proxy call (feeAddress = not the treasury) is not credited;
//   4. a native-ETH quote has no split; a plain transfer is verified and its fee left to the weekly statement.
// Results are appended to contracts/testnet-results.json (key "server"). Keys are never printed or written.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, encodeFunctionData, formatEther, formatUnits, getAddress, http, parseAbi } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { makeChecker, makeClient } from './test-helpers.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
  fs
    .readFileSync(process.env.GULLY_TESTNET_ENV ?? '', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
)
const RPC = 'https://sepolia.base.org'
const EXPLORER = 'https://sepolia.basescan.org'
const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) })
if ((await pub.getChainId()) !== 84532) throw new Error('testnet only')
const payer = privateKeyToAccount(env.TESTNET_PK)
const wallet = createWalletClient({ account: payer, chain: baseSepolia, transport: http(RPC) })
const MERCHANT = getAddress(env.MERCHANT_ADDR)
const TREASURY = env.TREASURY_ADDR.toLowerCase()
const USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e'
const deploy = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts/broadcast/DeployFeeProxy.s.sol/84532/run-latest.json'), 'utf8'))
const PROXY = deploy.transactions.find((t) => t.contractName === 'ERC20FeeProxy').contractAddress.toLowerCase()

/* ------------------------------------------------------------ the server --- */

const PORT = Number(process.env.TEST_PORT) || 8797
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-testnet-e2e-'))
Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: path.join(tmp, 'no-dist'),
  ADMIN_TOKEN: 'x'.repeat(48),
  TRACKER_LOOP: 'off',
  NODE_ENV: 'test',
  GULLY_TREASURY_ADDRESS: TREASURY,
  GULLY_TESTNET_CHAINS: '84532',
  GULLY_FEEPROXY_84532: PROXY,
  GULLY_PAY_WEBHOOK_TICK_MS: '0',
  GULLY_MERCHANT_TICK_MS: '0',
  GULLY_PAY_MERCHANT_FEE_BPS: '50',
  GULLY_PAY_MERCHANT_FREE_USD: '0',
})
delete process.env.TELEGRAM_BOT_TOKEN
await import('../server/server.mjs')
const M = await import('../server/merchants.mjs')
await new Promise((r) => setTimeout(r, 300))

const t = makeChecker()
const rows = []
const check = (name, ok, detail, extra = {}) => {
  t.check(name, ok, ok ? undefined : detail)
  rows.push({ check: name, pass: !!ok, detail: ok ? null : String(detail ?? ''), ...extra })
}

/* ------------------------------------------------------------ the chain --- */

let atBlock = await pub.getBlockNumber()
let nonce = await pub.getTransactionCount({ address: payer.address, blockTag: 'pending' })
const txs = []
async function send(label, { to, data = '0x', value = 0n }) {
  const hash = await wallet.sendTransaction({ to, data, value, nonce: nonce++, gas: 300_000n })
  const r = await pub.waitForTransactionReceipt({ hash, pollingInterval: 1_000, timeout: 120_000 })
  if (r.blockNumber > atBlock) atBlock = r.blockNumber
  txs.push({ label, tx: hash, status: r.status, gasUsed: Number(r.gasUsed), block: Number(r.blockNumber) })
  console.log(`  tx ${label}: ${EXPLORER}/tx/${hash} (${r.status}, gas ${r.gasUsed})`)
  return { hash, status: r.status }
}
/** A read pinned to the newest mined block we saw, retried while the load-balanced RPC's node lacks that block. */
async function pinned(fn) {
  for (let i = 0; ; i++) {
    try {
      return await fn(atBlock)
    } catch (e) {
      if (i >= 30 || !/block not found|header not found|unknown block/i.test(String(e?.details ?? e?.message))) throw e
      await new Promise((r) => setTimeout(r, 1_000))
    }
  }
}
const usdcOf = (who) => pinned((blockNumber) => pub.readContract({ address: USDC, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [who], blockNumber }))

const anon = makeClient(BASE)
const owner = makeClient(BASE)
/** POSTs verify until it stops answering 202 (waiting for confirmations), up to two minutes. */
async function verify(invId, quoteId, txHash) {
  for (let i = 0; i < 60; i++) {
    const r = await anon.post(`/api/pay/m/i/${invId}/verify`, { quoteId, txHash })
    if (r.status !== 202) return r
    await new Promise((res) => setTimeout(res, 2_000))
  }
  return { status: 202, data: { error: 'still pending' } }
}
const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
const newInvoice = async (usd, description) => (await owner.post('/api/developer/merchant/invoices', { items: [{ description, unitUsd: usd }], dueDate: due })).data?.invoice
const quote = async (invId, asset) => (await anon.post(`/api/pay/m/i/${invId}/quote`, { asset })).data?.quote

try {
  /* --------------------------------------------------------------- store --- */
  check('owner signs in (SIWE, throwaway key)', (await owner.signIn(privateKeyToAccount(generatePrivateKey()))).status === 200)
  const w = await owner.post('/api/developer/merchant/wallets', { acceptTerms: true, address: MERCHANT, type: 'eoa', chains: [84532] })
  check('store wallet on Base Sepolia (testnet flag on): accepted and enabled', w.status === 200 && w.data.results?.[0]?.ok && w.data.results[0].wallet.enabled, JSON.stringify(w.data))

  /* ----------------------------------------------- 1. USDC through the proxy --- */
  const inv1 = await newInvoice('1', 'Testnet order 1')
  const q1 = await quote(inv1.id, 'base-sepolia-usdc')
  const s = q1?.split
  check('USDC quote carries a split to our proxy and the treasury (0.5% fee, free allowance 0)', !!s && s.proxy === PROXY && s.feeTo === TREASURY && BigInt(s.merchantRaw) + BigInt(s.feeRaw) === BigInt(q1.amountRaw) && q1.treasury === MERCHANT.toLowerCase(), JSON.stringify(q1))
  const b0 = { payer: await usdcOf(payer.address), merchant: await usdcOf(MERCHANT), treasury: await usdcOf(TREASURY) }
  const ap = await send('approve (server bytes)', s.approve)
  const pay1 = await send('transferFromWithReferenceAndFee (server bytes)', s.pay)
  const b1 = { payer: await usdcOf(payer.address), merchant: await usdcOf(MERCHANT), treasury: await usdcOf(TREASURY) }
  check('on chain: the merchant got total - fee, the treasury got the fee', ap.status === 'success' && pay1.status === 'success' && b1.merchant - b0.merchant === BigInt(s.merchantRaw) && b1.treasury - b0.treasury === BigInt(s.feeRaw) && b0.payer - b1.payer === BigInt(q1.amountRaw), JSON.stringify({ b0, b1 }, (_, v) => (typeof v === 'bigint' ? v.toString() : v)), {
    tx: pay1.hash,
    deltas: { payer: formatUnits(b1.payer - b0.payer, 6), merchant: formatUnits(b1.merchant - b0.merchant, 6), treasury: formatUnits(b1.treasury - b0.treasury, 6) },
  })
  const v1 = await verify(inv1.id, q1.id, pay1.hash)
  check('verify: 200, invoice paid', v1.status === 200, JSON.stringify(v1.data), { tx: pay1.hash })
  const mdb = M.merchantsDbForTest()
  const p1 = mdb.payments.filter((x) => x.txHash === pay1.hash)
  const f1 = mdb.fees.filter((x) => x.paymentId === p1[0]?.id)
  check('ledger: one payment, crediting the full quote, with the fee taken on chain', p1.length === 1 && p1[0].amountRaw === q1.amountRaw && p1[0].feeRaw === s.feeRaw, JSON.stringify(p1))
  check('ledger: one fee row, collected on chain in full, nothing left to bill', f1.length === 1 && f1[0].onchain === true && f1[0].collectedMicros === f1[0].feeMicros && f1[0].feeMicros === s.feeRaw, JSON.stringify(f1))
  check('the store invoice reads as paid', (await anon.call(`/api/pay/m/i/${inv1.id}`)).data?.invoice?.status === 'paid' || mdb.invoices.find((x) => x.id === inv1.id)?.paidAt != null)

  /* ------------------------------------------------------------ 2. re-use --- */
  const again = await verify(inv1.id, q1.id, pay1.hash)
  check('re-using the hash on the same invoice: refused (409)', again.status === 409, JSON.stringify(again.data))
  const inv2 = await newInvoice('1', 'Testnet order 2')
  const q2 = await quote(inv2.id, 'base-sepolia-usdc')
  const reuse = await verify(inv2.id, q2.id, pay1.hash)
  check('re-using the hash on another invoice: refused (409)', reuse.status === 409, JSON.stringify(reuse.data))
  check('the fee was recorded once', M.merchantsDbForTest().fees.filter((x) => x.onchain).length === 1)

  /* ------------------------------------------------ 3. spoofed fee address --- */
  // Same quote shape, but the proxy is called with feeAddress = the payer itself (not our treasury).
  const s2 = q2.split
  const spoofData = encodeFunctionData({
    abi: parseAbi(['function transferFromWithReferenceAndFee(address,address,uint256,bytes,uint256,address)']),
    args: [USDC, MERCHANT, BigInt(s2.merchantRaw), s2.ref, BigInt(s2.feeRaw), payer.address],
  })
  await send('approve for the spoof', s2.approve)
  const spoof = await send('proxy call with feeAddress = payer (spoof)', { to: PROXY, data: spoofData })
  const vs = await verify(inv2.id, q2.id, spoof.hash)
  check('spoofed fee address: not credited (422), invoice stays open', spoof.status === 'success' && vs.status === 422 && !M.merchantsDbForTest().payments.some((x) => x.txHash === spoof.hash), `${vs.status} ${JSON.stringify(vs.data)}`, { tx: spoof.hash })

  /* -------------------------------------------- 4. native ETH, plain transfer --- */
  const inv3 = await newInvoice('0.25', 'Testnet order 3 (ETH)')
  const q3 = await quote(inv3.id, 'base-sepolia-eth')
  check('ETH quote: priced by the Base Sepolia ETH / USD feed, no split (fee invoiced)', !!q3 && q3.split === null && !!q3.price && BigInt(q3.amountRaw) > 0n, JSON.stringify(q3))
  const e0 = await pinned((blockNumber) => pub.getBalance({ address: MERCHANT, blockNumber }))
  const ethTx = await send(`plain ETH transfer of ${formatEther(BigInt(q3.amountRaw))} to the store`, { to: MERCHANT, value: BigInt(q3.amountRaw) })
  const e1 = await pinned((blockNumber) => pub.getBalance({ address: MERCHANT, blockNumber }))
  const v3 = await verify(inv3.id, q3.id, ethTx.hash)
  const p3 = M.merchantsDbForTest().payments.find((x) => x.txHash === ethTx.hash)
  const f3 = M.merchantsDbForTest().fees.find((x) => x.paymentId === p3?.id)
  check('ETH: verify 200, paid; fee accrued and left for the weekly statement (not on chain)', v3.status === 200 && e1 - e0 === BigInt(q3.amountRaw) && f3?.onchain === false && f3.collectedMicros === '0' && BigInt(f3.feeMicros) > 0n, `${v3.status} ${JSON.stringify(v3.data)} ${JSON.stringify(f3)}`, { tx: ethTx.hash, deltas: { merchant: formatEther(e1 - e0) + ' ETH' } })
  const ethAgain = await verify(inv3.id, q3.id, ethTx.hash)
  check('ETH: re-using the hash is refused (409)', ethAgain.status === 409, JSON.stringify(ethAgain.data))
} catch (e) {
  check('no exception', false, e?.stack ?? e)
} finally {
  const file = path.join(ROOT, 'contracts/testnet-results.json')
  const out = JSON.parse(fs.readFileSync(file, 'utf8'))
  out.server = { ranAt: new Date().toISOString(), port: PORT, flags: { GULLY_TESTNET_CHAINS: '84532', GULLY_FEEPROXY_84532: PROXY, GULLY_PAY_MERCHANT_FEE_BPS: '50', GULLY_PAY_MERCHANT_FREE_USD: '0' }, txs, checks: rows }
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n')
  fs.rmSync(tmp, { recursive: true, force: true })
  const failed = rows.filter((r) => !r.pass).length
  console.log(`\n${rows.length - failed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
