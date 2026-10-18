// LIVE TESTNET run of the Gully Pay fee path on Base Sepolia (84532): Request Network's ERC20FeeProxy and
// EthereumFeeProxy (vendored and deployed by contracts/script/DeployFeeProxy.s.sol), the MockUSDT token, and a
// 1-of-1 Safe as the treasury. Every case is a real transaction; an expected revert is shown twice, first with
// eth_call (no gas spent) and then as one mined failing transaction with a fixed gas limit.
//
//   GULLY_TESTNET_ENV=<path to a KEY=VALUE file outside the repo> node scripts/testnet-fee-proxy.mjs
//
// The env file holds TESTNET_PK (payer), TREASURY_PK (owner of the Safe) and MERCHANT_ADDR / TREASURY_ADDR.
// Keys are never printed or written. The results (hashes, balances, gas) go to contracts/testnet-results.json,
// from which contracts/TESTNET-RESULTS.md is written. Refuses to run on any chain but Base Sepolia.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, erc20Abi, formatEther, formatUnits, http, parseAbi, parseEther, zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
  fs
    .readFileSync(process.env.GULLY_TESTNET_ENV ?? '', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
)
const RPC = process.env.GULLY_RPC_84532 ?? 'https://sepolia.base.org'
const EXPLORER = 'https://sepolia.basescan.org'
const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) })
if ((await pub.getChainId()) !== 84532) throw new Error('testnet only: the RPC is not Base Sepolia')

const payer = privateKeyToAccount(env.TESTNET_PK)
const safeOwner = privateKeyToAccount(env.TREASURY_PK)
const wallet = createWalletClient({ account: payer, chain: baseSepolia, transport: http(RPC) })
const MERCHANT = env.MERCHANT_ADDR
const TREASURY = env.TREASURY_ADDR

// Deployed by DeployFeeProxy.s.sol (its broadcast file), Circle's USDC and the canonical Safe v1.4.1 deployments.
const deploy = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts/broadcast/DeployFeeProxy.s.sol/84532/run-latest.json'), 'utf8'))
const deployed = Object.fromEntries(deploy.transactions.map((t) => [t.contractName, t.contractAddress]))
const PROXY = deployed.ERC20FeeProxy
const ETH_PROXY = deployed.EthereumFeeProxy
const MUSDT = deployed.MockUSDT
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' // Circle, Base Sepolia (developers.circle.com/stablecoins/usdc-contract-addresses)
const SAFE_FACTORY = '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67'
const SAFE_L2_SINGLETON = '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762'

const proxyAbi = parseAbi([
  'function transferFromWithReferenceAndFee(address tokenAddress, address to, uint256 amount, bytes paymentReference, uint256 feeAmount, address feeAddress)',
  'event TransferWithReferenceAndFee(address tokenAddress, address to, uint256 amount, bytes indexed paymentReference, uint256 feeAmount, address feeAddress)',
])
const ethProxyAbi = parseAbi([
  'function transferWithReferenceAndFee(address to, bytes paymentReference, uint256 feeAmount, address feeAddress) payable',
  'function transferExactEthWithReferenceAndFee(address to, uint256 amount, bytes paymentReference, uint256 feeAmount, address feeAddress) payable',
])
const musdtAbi = parseAbi(['function mint(address to, uint256 value)', 'function transfer(address to, uint256 value)', 'function approve(address spender, uint256 value)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address, address) view returns (uint256)'])
const factoryAbi = parseAbi(['function createProxyWithNonce(address singleton, bytes initializer, uint256 saltNonce) returns (address proxy)'])
const safeAbi = parseAbi([
  'function setup(address[] owners, uint256 threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)',
  'function nonce() view returns (uint256)',
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 nonce) view returns (bytes32)',
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)',
])

/* ------------------------------------------------------------ plumbing --- */

const RESULTS = path.join(ROOT, 'contracts/testnet-results.json')
// GULLY_TESTNET_RESUME=1 continues an interrupted run: cases already recorded are skipped, the same Safe is reused.
const prior = process.env.GULLY_TESTNET_RESUME === '1' && fs.existsSync(RESULTS) ? JSON.parse(fs.readFileSync(RESULTS, 'utf8')) : null
const out = prior ?? { chainId: 84532, rpc: RPC, explorer: EXPLORER, startedAt: new Date().toISOString(), addresses: { payer: payer.address, merchant: MERCHANT, treasuryEoa: TREASURY, safeOwner: safeOwner.address, erc20FeeProxy: PROXY, ethereumFeeProxy: ETH_PROXY, mockUsdt: MUSDT, usdc: USDC, safeFactory: SAFE_FACTORY, safeSingleton: SAFE_L2_SINGLETON }, deploys: [], cases: [] }
const saveOut = () => fs.writeFileSync(RESULTS, JSON.stringify(out, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n')
if (!prior) for (const t of deploy.transactions) {
  // Matched by the created address: the broadcast file's receipts are not in the order of its transactions.
  const r = deploy.receipts.find((x) => x.contractAddress?.toLowerCase() === t.contractAddress.toLowerCase())
  out.deploys.push({ contract: t.contractName, address: t.contractAddress, tx: r.transactionHash, gasUsed: Number(BigInt(r.gasUsed)), status: r.status === '0x1' ? 'success' : 'reverted' })
}

let nonce = await pub.getTransactionCount({ address: payer.address, blockTag: 'pending' })
const MIN_ETH = parseEther('0.005')

// The public RPC is load-balanced, so a read right after a receipt can hit a node that is a block behind. Every
// read is pinned to the newest block we have seen mined, and retried until the node serving it has that block.
let atBlock = await pub.getBlockNumber()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function pinned(fn) {
  for (let i = 0; ; i++) {
    try {
      return await fn({ blockNumber: atBlock })
    } catch (e) {
      // Only a node that lacks the block is retried; a revert is an answer.
      if (i >= 30 || /revert/i.test(String(e?.message)) || !/header not found|unknown block|block not found|missing trie|could not find block|after last accepted|behind/i.test(String(e?.details ?? e?.message))) throw e
      await sleep(1_000)
    }
  }
}

async function send({ to, data = '0x', value = 0n, gas }) {
  const bal = await pub.getBalance({ address: payer.address })
  if (bal < MIN_ETH) throw new Error(`stop: payer ETH ${formatEther(bal)} is below 0.005`)
  // A fixed gas limit: estimating against a node a block behind can fail (or succeed) on stale state.
  const hash = await wallet.sendTransaction({ to, data, value, nonce: nonce++, gas: gas ?? 400_000n })
  const r = await pub.waitForTransactionReceipt({ hash, pollingInterval: 1_000, timeout: 120_000 })
  if (r.blockNumber > atBlock) atBlock = r.blockNumber
  return { hash, status: r.status, gasUsed: Number(r.gasUsed), logs: r.logs, block: Number(r.blockNumber), receipt: r }
}

/** eth_call of a transaction that should revert: { reverted, reason } (no gas spent). */
async function dryRun({ to, data, value = 0n }) {
  try {
    await pinned((b) => pub.call({ account: payer.address, to, data, value, ...b }))
    return { reverted: false, reason: null }
  } catch (e) {
    const m = String(e?.details ?? e?.shortMessage ?? e?.message ?? e)
    return { reverted: true, reason: m.split('\n')[0].slice(0, 200) }
  }
}

const tokBal = (token, who) => pinned((b) => (token ? pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [who], ...b }) : pub.getBalance({ address: who, ...b })))
const readAt = (args) => pinned((b) => pub.readContract({ ...args, ...b }))
async function snapshot(token, who) {
  const o = {}
  for (const [k, a] of Object.entries(who)) o[k] = await tokBal(token, a)
  return o
}
const delta = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, b[k] - a[k]]))

/**
 * One case: optional setup transactions, then the call itself; balances of `who` in `token` (null = ETH)
 * around the call. `expect` is 'success' or 'revert'. `check(d, tx)` returns a string of what failed, or ''.
 */
async function runCase({ group, id, title, token, decimals = 6, who, setup = [], call, expect = 'success', check = () => '', note = '' }) {
  if (out.cases.some((c) => c.id === id)) return null
  const steps = []
  for (const s of setup) {
    const tx = await send(s.tx)
    steps.push({ label: s.label, tx: tx.hash, status: tx.status, gasUsed: tx.gasUsed })
    if (tx.status !== 'success') throw new Error(`${id}: setup ${s.label} failed (${tx.hash})`)
  }
  const before = await snapshot(token, who)
  let dry = null
  if (expect === 'revert') {
    dry = await dryRun(call)
    if (!dry.reverted) throw new Error(`${id}: eth_call did not revert`)
  }
  const tx = await send(expect === 'revert' ? { ...call, gas: call.gas ?? 200_000n } : call)
  const after = await snapshot(token, who)
  const d = delta(before, after)
  let problem = tx.status === (expect === 'revert' ? 'reverted' : 'success') ? '' : `status ${tx.status}, expected ${expect}`
  if (!problem) problem = check(d, tx) || ''
  const row = {
    group,
    id,
    title,
    expected: expect,
    actual: tx.status === 'success' ? 'success' : 'reverted',
    pass: !problem,
    problem: problem || null,
    tx: tx.hash,
    block: tx.block,
    gasUsed: tx.gasUsed,
    ethCall: dry,
    setup: steps,
    unit: token ? (token === MUSDT ? 'mUSDT' : 'USDC') : 'ETH',
    before: Object.fromEntries(Object.entries(before).map(([k, v]) => [k, token ? formatUnits(v, decimals) : formatEther(v)])),
    after: Object.fromEntries(Object.entries(after).map(([k, v]) => [k, token ? formatUnits(v, decimals) : formatEther(v)])),
    delta: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, token ? formatUnits(v, decimals) : formatEther(v)])),
    note,
  }
  out.cases.push(row)
  saveOut()
  console.log(`${row.pass ? 'PASS' : 'FAIL'} ${id} ${title} ${EXPLORER}/tx/${tx.hash} gas=${tx.gasUsed}${problem ? ' :: ' + problem : ''}`)
  return { row, tx, d }
}

const want = (cond, msg) => (cond ? '' : msg)
const all = (...xs) => xs.filter(Boolean).join('; ')
const U = (s) => BigInt(Math.round(Number(s) * 1e6)) // USDC / mUSDT, 6 decimals
const approve = (token, spender, value) => ({ to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, value] }) })
const pay = (token, to, amount, ref, fee, feeAddress) => ({ to: PROXY, data: encodeFunctionData({ abi: proxyAbi, functionName: 'transferFromWithReferenceAndFee', args: [token, to, amount, ref, fee, feeAddress] }) })
const REF = '0x9f1c2a7be04d33aa' // 8 bytes, the size Gully Pay sends

/** The proxy's event in a receipt, decoded, or null. */
function proxyEvent(tx) {
  const l = tx.logs.find((x) => x.address.toLowerCase() === PROXY.toLowerCase())
  return l ? decodeEventLog({ abi: proxyAbi, data: l.data, topics: l.topics }).args : null
}

/* ---------------------------------------------------------------- start --- */

const startEth = await pub.getBalance({ address: payer.address })
const startUsdc = await tokBal(USDC, payer.address)
if (!prior) out.start = { eth: formatEther(startEth), usdc: formatUnits(startUsdc, 6) }
console.log(`payer ${payer.address}: ${formatEther(startEth)} ETH, ${formatUnits(startUsdc, 6)} USDC`)

/* ----------------------------------------------------- Safe (treasury) --- */

const init = encodeFunctionData({ abi: safeAbi, functionName: 'setup', args: [[safeOwner.address], 1n, zeroAddress, '0x', zeroAddress, zeroAddress, 0n, zeroAddress] })
const salt = BigInt(Date.now())
const SAFE = out.addresses.safe ?? (await pub.simulateContract({ account: payer.address, address: SAFE_FACTORY, abi: factoryAbi, functionName: 'createProxyWithNonce', args: [SAFE_L2_SINGLETON, init, salt] })).result
if (!out.addresses.safe) {
  const tx = await send({ to: SAFE_FACTORY, data: encodeFunctionData({ abi: factoryAbi, functionName: 'createProxyWithNonce', args: [SAFE_L2_SINGLETON, init, salt] }) })
  const owners = await readAt({ address: SAFE, abi: safeAbi, functionName: 'getOwners' })
  const threshold = await readAt({ address: SAFE, abi: safeAbi, functionName: 'getThreshold' })
  const ok = tx.status === 'success' && owners.length === 1 && owners[0].toLowerCase() === safeOwner.address.toLowerCase() && threshold === 1n
  out.addresses.safe = SAFE
  out.cases.push({ group: 'Safe', id: 'S1', title: 'Deploy a 1-of-1 Safe (v1.4.1 SafeL2) through the official SafeProxyFactory', expected: 'success', actual: tx.status === 'success' ? 'success' : 'reverted', pass: ok, problem: ok ? null : 'owners/threshold wrong', tx: tx.hash, block: tx.block, gasUsed: tx.gasUsed, ethCall: null, setup: [], unit: null, before: {}, after: {}, delta: {}, note: `Safe ${SAFE}, owner ${safeOwner.address}, threshold 1` })
  saveOut()
  console.log(`${ok ? 'PASS' : 'FAIL'} S1 Safe ${SAFE} ${EXPLORER}/tx/${tx.hash}`)
}
const who = { payer: payer.address, merchant: MERCHANT, treasury: TREASURY, safe: SAFE, proxy: PROXY }

/* ---------------------------------------------------- ERC20FeeProxy: USDC --- */

const G1 = 'ERC20FeeProxy (USDC)'
{
  const amount = U(0.995), fee = U(0.005)
  await runCase({
    group: G1, id: 'E1', title: 'approve, then pay with a fee: merchant gets amount, EOA treasury gets fee, proxy keeps 0', token: USDC, who,
    setup: [{ label: 'approve(proxy, amount + fee)', tx: approve(USDC, PROXY, amount + fee) }],
    call: pay(USDC, MERCHANT, amount, REF, fee, TREASURY),
    check: (d, tx) => {
      const ev = proxyEvent(tx)
      return all(want(d.merchant === amount, 'merchant delta'), want(d.treasury === fee, 'treasury delta'), want(d.payer === -(amount + fee), 'payer delta'), want(d.proxy === 0n, 'proxy delta'), want(ev && ev.amount === amount && ev.feeAmount === fee && ev.feeAddress.toLowerCase() === TREASURY.toLowerCase(), 'event'))
    },
  })
}
{
  const amount = U(0.9), fee = U(0.1)
  await runCase({
    group: G1, id: 'E2', title: 'pay with a fee to the Safe treasury: the Safe receives the fee', token: USDC, who,
    setup: [{ label: 'approve(proxy, amount + fee)', tx: approve(USDC, PROXY, amount + fee) }],
    call: pay(USDC, MERCHANT, amount, REF, fee, SAFE),
    check: (d) => all(want(d.merchant === amount, 'merchant delta'), want(d.safe === fee, 'Safe delta'), want(d.treasury === 0n, 'EOA treasury untouched'), want(d.proxy === 0n, 'proxy delta')),
  })
}
{
  const amount = U(0.5)
  await runCase({
    group: G1, id: 'E3', title: 'zero fee: the treasury leg is skipped', token: USDC, who,
    setup: [{ label: 'approve(proxy, amount)', tx: approve(USDC, PROXY, amount) }],
    call: pay(USDC, MERCHANT, amount, REF, 0n, TREASURY),
    check: (d, tx) => all(want(d.merchant === amount, 'merchant delta'), want(d.treasury === 0n, 'treasury delta'), want(tx.logs.filter((l) => l.address.toLowerCase() === USDC.toLowerCase()).length === 1, 'exactly one Transfer log')),
  })
}
{
  const amount = U(0.5), fee = U(0.0025)
  await runCase({
    group: G1, id: 'E4', title: 'empty payment reference (0x)', token: USDC, who,
    setup: [{ label: 'approve', tx: approve(USDC, PROXY, amount + fee) }],
    call: pay(USDC, MERCHANT, amount, '0x', fee, TREASURY),
    check: (d, tx) => all(want(d.merchant === amount && d.treasury === fee, 'deltas'), want(tx.logs.at(-1).topics[1] === '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470', 'topic1 = keccak256(empty)')),
  })
}
{
  const amount = U(0.5), fee = U(0.0025)
  await runCase({
    group: G1, id: 'E5', title: 'all-zero payment reference (8 zero bytes)', token: USDC, who,
    setup: [{ label: 'approve', tx: approve(USDC, PROXY, amount + fee) }],
    call: pay(USDC, MERCHANT, amount, '0x0000000000000000', fee, TREASURY),
    check: (d) => want(d.merchant === amount && d.treasury === fee, 'deltas'),
  })
}
{
  const amount = U(0.5)
  await runCase({
    group: G1, id: 'E6', title: 'feeAddress = zero address with a zero fee', token: USDC, who,
    setup: [{ label: 'approve', tx: approve(USDC, PROXY, amount) }],
    call: pay(USDC, MERCHANT, amount, REF, 0n, zeroAddress),
    check: (d) => all(want(d.merchant === amount, 'merchant delta'), want(d.payer === -amount, 'payer delta')),
  })
}
{
  const amount = U(0.5), fee = U(0.0025)
  await runCase({
    group: G1, id: 'E7', title: 'feeAddress = zero address with a NON-zero fee: the fee leg is skipped, but the event still reports the fee', token: USDC, who,
    setup: [{ label: 'approve(proxy, amount only)', tx: approve(USDC, PROXY, amount) }],
    call: pay(USDC, MERCHANT, amount, REF, fee, zeroAddress),
    check: (d, tx) => all(want(d.merchant === amount && d.payer === -amount, 'only the merchant leg moved'), want(proxyEvent(tx)?.feeAmount === fee, 'event claims the fee')),
    note: 'Why the server never trusts the event alone: creditFeeProxy also needs the fee Transfer log to the treasury.',
  })
}
{
  const amount = U(0.5), fee = U(0.0025)
  await runCase({
    group: G1, id: 'E8', title: 'merchant is the payer (to = msg.sender)', token: USDC, who,
    setup: [{ label: 'approve', tx: approve(USDC, PROXY, amount + fee) }],
    call: pay(USDC, payer.address, amount, REF, fee, TREASURY),
    check: (d) => all(want(d.payer === -fee, 'payer only loses the fee'), want(d.treasury === fee, 'treasury delta')),
  })
}
{
  const amount = U(0.5)
  await runCase({
    group: G1, id: 'E9', title: 'no allowance: reverts, nothing moves', token: USDC, who, expect: 'revert',
    setup: [{ label: 'approve(proxy, 0)', tx: approve(USDC, PROXY, 0n) }],
    call: pay(USDC, MERCHANT, amount, REF, 0n, TREASURY),
    check: (d) => want(Object.values(d).every((v) => v === 0n), 'balances moved'),
  })
}
{
  const amount = U(0.5), fee = U(0.0025)
  await runCase({
    group: G1, id: 'E10', title: 'allowance = amount only (short of amount + fee): reverts, the merchant leg is undone too', token: USDC, who, expect: 'revert',
    setup: [{ label: 'approve(proxy, amount)', tx: approve(USDC, PROXY, amount) }],
    call: pay(USDC, MERCHANT, amount, REF, fee, TREASURY),
    check: (d) => want(Object.values(d).every((v) => v === 0n), 'balances moved'),
  })
}

/* --------------------------------------- ERC20FeeProxy + MockUSDT (no bool) --- */

const G2 = 'MockUSDT (USDT-style, no return value)'
const whoM = { payer: payer.address, merchant: MERCHANT, treasury: TREASURY, proxy: PROXY }
const m = (fn, args) => ({ to: MUSDT, data: encodeFunctionData({ abi: musdtAbi, functionName: fn, args }) })
const mAllow = () => readAt({ address: MUSDT, abi: musdtAbi, functionName: 'allowance', args: [payer.address, PROXY] })
await runCase({ group: G2, id: 'M1', title: 'mint 10 mUSDT to the payer', token: MUSDT, who: whoM, call: m('mint', [payer.address, U(10)]), check: (d) => want(d.payer === U(10), 'payer delta') })
await runCase({ group: G2, id: 'M2', title: 'transfer (returns nothing) 0.5 to the merchant', token: MUSDT, who: whoM, call: m('transfer', [MERCHANT, U(0.5)]), check: (d) => want(d.merchant === U(0.5) && d.payer === -U(0.5), 'deltas') })
await runCase({ group: G2, id: 'M3', title: 'approve(proxy, 0.3) from a zero allowance', token: MUSDT, who: whoM, call: m('approve', [PROXY, U(0.3)]) })
await runCase({
  group: G2, id: 'M4', title: 'approve(proxy, 1.005) while the allowance is non-zero: reverts (USDT rule)', token: MUSDT, who: whoM, expect: 'revert',
  call: m('approve', [PROXY, U(1.005)]),
})
if (out.cases.at(-1).id === 'M4' && !out.cases.at(-1).note) out.cases.at(-1).note = `allowance after: ${formatUnits(await mAllow(), 6)} (unchanged)`
{
  // The page's flow for USDT: the server's approveReset, then approve, then the proxy call (payments.mjs quoteSplit).
  // The two approve call datas do not depend on the token, so the server's own bytes are sent to MockUSDT here.
  process.env.GULLY_TESTNET_CHAINS = '84532'
  process.env.GULLY_FEEPROXY_84532 = PROXY
  const P = await import('../server/payments.mjs')
  const amount = U(1), fee = U(0.005)
  const q = P.withFeeSplit({ id: 'q_testnet_musdt', assetId: 'base-sepolia-usdc', amountRaw: String(amount + fee), treasury: MERCHANT.toLowerCase() }, { bps: 50, feeTo: TREASURY })
  const s = P.quoteSplit(q)
  if (!s) throw new Error('server built no split for the testnet quote')
  await runCase({
    group: G2, id: 'M5', title: "server's reset-then-approve (approveReset, approve(total)), then pay 1 + 0.005 fee through the proxy", token: MUSDT, who: whoM,
    setup: [
      { label: 'approve(proxy, 0.3): a non-zero allowance left over, as from an abandoned checkout', tx: m('approve', [PROXY, U(0.3)]) },
      { label: 'server approveReset: approve(proxy, 0)', tx: { to: MUSDT, data: s.approveReset.data } },
      { label: 'server approve: approve(proxy, total)', tx: { to: MUSDT, data: s.approve.data } },
    ],
    call: pay(MUSDT, MERCHANT, BigInt(s.merchantRaw), q.ref, BigInt(s.feeRaw), TREASURY),
    check: (d) => all(want(d.merchant === BigInt(s.merchantRaw), 'merchant delta'), want(d.treasury === BigInt(s.feeRaw), 'treasury delta'), want(d.proxy === 0n, 'proxy delta')),
  })
  out.cases.at(-1).note = `allowance after: ${formatUnits(await mAllow(), 6)}; fee = 0.5% of the total, rounded down`
  saveOut()
}

/* --------------------------------------------- EthereumFeeProxy (native) --- */

const G3 = 'EthereumFeeProxy (native ETH)'
const whoE = { payer: payer.address, merchant: MERCHANT, treasury: TREASURY, safe: SAFE, proxy: ETH_PROXY }
const ethPay = (to, ref, fee, feeAddress, value) => ({ to: ETH_PROXY, value, data: encodeFunctionData({ abi: ethProxyAbi, functionName: 'transferWithReferenceAndFee', args: [to, ref, fee, feeAddress] }) })
const V = parseEther('0.0001'), F = parseEther('0.000001')
await runCase({ group: G3, id: 'N1', title: 'transferWithReferenceAndFee: EOA merchant + EOA treasury', token: null, who: whoE, call: ethPay(MERCHANT, REF, F, TREASURY, V), check: (d) => all(want(d.merchant === V - F, 'merchant delta'), want(d.treasury === F, 'treasury delta'), want(d.proxy === 0n, 'proxy delta')) })
await runCase({ group: G3, id: 'N2', title: 'zero fee', token: null, who: whoE, call: ethPay(MERCHANT, REF, 0n, TREASURY, V), check: (d) => all(want(d.merchant === V, 'merchant delta'), want(d.treasury === 0n, 'treasury delta')) })
await runCase({
  group: G3, id: 'N3', title: 'fee to the Safe treasury: reverts (2300-gas transfer() cannot reach a Safe)', token: null, who: whoE, expect: 'revert',
  call: { ...ethPay(MERCHANT, REF, F, SAFE, V), gas: 150_000n },
  check: (d) => want(d.merchant === 0n && d.safe === 0n, 'value moved'),
  note: 'The CHOICE.md finding, live: coin payments stay plain transfers with the fee invoiced.',
})
await runCase({ group: G3, id: 'N4', title: 'merchant is a contract (the Safe), fee to an EOA: works (the merchant leg forwards all gas)', token: null, who: whoE, call: ethPay(SAFE, REF, F, TREASURY, V), check: (d) => all(want(d.safe === V - F, 'Safe delta'), want(d.treasury === F, 'treasury delta')) })
{
  const amt = parseEther('0.00005')
  await runCase({
    group: G3, id: 'N5', title: 'transferExactEthWithReferenceAndFee with overpayment: the rest is refunded to the payer', token: null, who: whoE,
    call: { to: ETH_PROXY, value: V, data: encodeFunctionData({ abi: ethProxyAbi, functionName: 'transferExactEthWithReferenceAndFee', args: [MERCHANT, amt, REF, F, TREASURY] }) },
    check: (d) => all(want(d.merchant === amt, 'merchant delta'), want(d.treasury === F, 'treasury delta'), want(d.proxy === 0n, 'proxy keeps nothing')),
  })
}

/* --------------------------------------------------- Safe spends its fees --- */

{
  const back = U(0.05)
  const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [payer.address, back] })
  const sn = await readAt({ address: SAFE, abi: safeAbi, functionName: 'nonce' })
  const h = await readAt({ address: SAFE, abi: safeAbi, functionName: 'getTransactionHash', args: [USDC, 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, sn] })
  const sig = await safeOwner.sign({ hash: h })
  await runCase({
    group: 'Safe', id: 'S2', title: 'execTransaction signed by the owner: the Safe sends 0.05 of its fee USDC back to the test wallet', token: USDC, who: { payer: payer.address, safe: SAFE },
    call: { to: SAFE, data: encodeFunctionData({ abi: safeAbi, functionName: 'execTransaction', args: [USDC, 0n, data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, sig] }) },
    check: (d) => want(d.safe === -back && d.payer === back, 'deltas'),
    note: `Safe nonce ${sn}; signed off-chain by the owner ${safeOwner.address}, relayed by the test wallet`,
  })
}

out.end = { eth: formatEther(await pub.getBalance({ address: payer.address })), usdc: formatUnits(await tokBal(USDC, payer.address), 6) }
out.finishedAt = new Date().toISOString()
saveOut()
const failed = out.cases.filter((c) => !c.pass)
console.log(`${out.cases.length - failed.length}/${out.cases.length} passed; payer now ${out.end.eth} ETH, ${out.end.usdc} USDC`)
process.exit(failed.length ? 1 : 0)
