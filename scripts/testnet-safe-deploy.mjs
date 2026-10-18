// LIVE TESTNET run of one-click Safe deployment (server/safe-deploy.mjs) on Base Sepolia (84532).
//
//   GULLY_TESTNET_ENV=<path to a KEY=VALUE file outside the repo> node scripts/testnet-safe-deploy.mjs
//
// The env file holds TESTNET_PK (the wallet that pays the gas) and TREASURY_ADDR (the owner of the new Safe).
// Keys are never printed or written. Testnet only: refuses any RPC that is not Base Sepolia, and the module's own
// chain table only knows the testnets named in GULLY_TESTNET_CHAINS (set below, before the import).
//
//   (a) the existing 1-of-1 Safe 0x041F9F5F… (contracts/TESTNET-RESULTS.md, S1): recover its initializer and salt
//       nonce from its ProxyCreation log and show the CREATE2 prediction equals its address; plan its copy on
//       OP Sepolia (calldata and predicted address; not sent, that wallet holds no OP Sepolia ETH);
//   (b) a NEW 1-of-1 Safe planned by the server (mode 'new'): the server's calldata is sent as a real transaction,
//       followed with deploymentStatus until verified (code + owners), then its copy on OP Sepolia is planned too.
// Results: contracts/testnet-safe-results.json (no secrets), from which TESTNET-RESULTS.md's section is written.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from 'viem'
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

// The module reads the chain tables at import: the testnets must be named first. DATA_DIR keeps the record of the new
// Safe out of the repo.
process.env.GULLY_TESTNET_CHAINS = '84532,11155420'
process.env.DATA_DIR = fs.mkdtempSync(path.join(process.env.TEMP ?? '/tmp', 'gully-safe-live-'))
process.env.GULLY_RPC_84532 = RPC
const S = await import('../server/safe-deploy.mjs')

const payer = privateKeyToAccount(env.TESTNET_PK)
const wallet = createWalletClient({ account: payer, chain: baseSepolia, transport: http(RPC) })
const OWNER = env.TREASURY_ADDR
const SAFE_S1 = '0x041F9F5Fb5b21b69d8DF639c36fC5E72af98FE84'
const out = { chainId: 84532, rpc: RPC, explorer: EXPLORER, startedAt: new Date().toISOString(), payer: payer.address, steps: [] }
const say = (s) => (console.log(`- ${s.title}${s.ok === false ? '  FAIL' : ''}${s.detail ? `: ${s.detail}` : ''}`), out.steps.push(s))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

try {
  const bal = await pub.getBalance({ address: payer.address })
  console.log(`payer ${payer.address}: ${formatEther(bal)} ETH on Base Sepolia`)
  if (bal < parseEther('0.003')) throw new Error('stop: payer ETH is below 0.003')
  out.payerBalanceBefore = formatEther(bal)

  /* (a) the existing Safe: recover and verify its creation */
  const found = await S.findCreation(84532, SAFE_S1)
  say({ id: 'a1', title: 'S1 Safe: creation recovered from the chain', ok: found.ok && found.source === 'chain', detail: found.ok ? `tx ${found.tx} (block ${found.blockNumber}), source ${found.source}, saltNonce ${found.saltNonce}` : found.error, tx: found.tx ?? null })
  const setup = found.ok ? S.decodeSetup(found.initializer) : null
  say({ id: 'a2', title: 'S1 Safe: initializer decodes to setup()', ok: !!setup && setup.owners.length === 1 && same(setup.owners[0], OWNER) && setup.threshold === 1, detail: setup ? `owner ${setup.owners[0]}, threshold ${setup.threshold}, fallback ${setup.fallbackHandler}` : 'no' })
  const pcc = await S.proxyCreationCode(84532, found.factory)
  const predicted = found.ok ? S.predictProxy({ factory: found.factory, singleton: found.singleton, initializer: found.initializer, saltNonce: found.saltNonce, proxyCreationCode: pcc }) : null
  say({ id: 'a3', title: 'S1 Safe: CREATE2 prediction from the recovered inputs equals its address', ok: same(predicted, SAFE_S1), detail: predicted })
  const copy1 = await S.planReproduce({ address: SAFE_S1, targetChainId: 11155420, originChainId: 84532 })
  say({ id: 'a4', title: 'S1 Safe: plan for OP Sepolia (not sent: no OP Sepolia ETH)', ok: copy1.ok && same(copy1.predicted, SAFE_S1) && !copy1.alreadyDeployed, detail: copy1.ok ? `factory ${copy1.tx.to}, calldata ${copy1.tx.data.length / 2 - 1} bytes, predicted ${copy1.predicted}, checks ${copy1.checks.filter((c) => c.ok).length}/${copy1.checks.length}` : copy1.error, calldata: copy1.ok ? copy1.tx : null, checks: copy1.checks ?? null, gas: copy1.gas ?? null })

  /* (b) a new Safe through the server's calldata */
  const salt = `live-${Date.now()}`
  const plan = await S.planNew({ chainId: 84532, owners: [OWNER], threshold: 1, scope: 'testnet', salt, from: payer.address })
  say({ id: 'b1', title: 'new Safe: server plan (1-of-1, SafeL2 1.4.1, CompatibilityFallbackHandler)', ok: plan.ok && !plan.alreadyDeployed && plan.gas.estimate > 0, detail: plan.ok ? `predicted ${plan.predicted}, saltNonce ${plan.saltNonce}, gas ≈ ${plan.gas.estimate} (${plan.gas.cost})` : plan.error, predicted: plan.predicted ?? null, saltNonce: plan.saltNonce ?? null, gas: plan.gas ?? null, salt })
  if (!plan.ok) throw new Error('no plan')
  const local = S.predictProxy({ factory: plan.factory, singleton: plan.singleton, initializer: plan.initializer, saltNonce: plan.saltNonce, proxyCreationCode: plan.proxyCreationCode })
  say({ id: 'b2', title: 'new Safe: the address is recomputed before sending', ok: same(local, plan.predicted), detail: local })
  const hash = await wallet.sendTransaction({ to: plan.tx.to, data: plan.tx.data, value: 0n, gas: BigInt(Math.ceil(plan.gas.estimate * 1.15)) })
  say({ id: 'b3', title: 'new Safe: the server-built calldata sent by the test wallet', ok: true, detail: `${EXPLORER}/tx/${hash}`, tx: hash })
  let status
  for (let i = 0; i < 60; i++) {
    status = await S.deploymentStatus({ chainId: 84532, hash, address: plan.predicted })
    if (status.state === 'verified' || status.state === 'failed') break
    await sleep(3_000)
  }
  say({ id: 'b4', title: 'new Safe: deploymentStatus follows sent -> mined -> verified (code + getOwners)', ok: status?.state === 'verified' && status.owners?.length === 1 && same(status.owners[0], OWNER) && status.threshold === 1, detail: status ? `${status.state}, block ${status.blockNumber}, gas used ${status.gasUsed}, owners ${JSON.stringify(status.owners)}, threshold ${status.threshold}, version ${status.version}` : 'no status', tx: hash, status })
  const code = await pub.getCode({ address: plan.predicted })
  say({ id: 'b5', title: 'new Safe: eth_getCode at the predicted address, read independently with viem', ok: !!code && code.length > 2, detail: `${(code?.length ?? 2) / 2 - 1} bytes, ${EXPLORER}/address/${plan.predicted}` })
  const again = await S.planNew({ chainId: 84532, owners: [OWNER], threshold: 1, scope: 'testnet', salt })
  say({ id: 'b6', title: 'new Safe: planning it again reports alreadyDeployed', ok: again.ok && again.alreadyDeployed && again.kind === 'safe', detail: again.kind })
  const copy2 = await S.planReproduce({ address: plan.predicted, targetChainId: 11155420 })
  say({ id: 'b7', title: 'new Safe: plan for OP Sepolia uses our record, same address (not sent)', ok: copy2.ok && copy2.origin.source === 'record' && same(copy2.predicted, plan.predicted), detail: copy2.ok ? `source ${copy2.origin.source}, predicted ${copy2.predicted}, calldata identical to Base Sepolia's: ${copy2.tx.data.toLowerCase() === plan.tx.data.toLowerCase()}` : copy2.error, calldata: copy2.ok ? copy2.tx : null })
  S.resetForTest()
  const copy3 = await S.planReproduce({ address: plan.predicted, targetChainId: 11155420 })
  say({ id: 'b8', title: 'new Safe: without the record, the chain’s history recovers the same inputs', ok: copy3.ok && copy3.origin.source === 'chain' && same(copy3.predicted, plan.predicted) && copy3.saltNonce === plan.saltNonce, detail: copy3.ok ? `source ${copy3.origin.source}, saltNonce ${copy3.saltNonce}` : copy3.error })
  out.payerBalanceAfter = formatEther(await pub.getBalance({ address: payer.address }))
} catch (e) {
  say({ id: 'x', title: 'uncaught', ok: false, detail: String(e?.message ?? e) })
}
out.finishedAt = new Date().toISOString()
fs.writeFileSync(path.join(ROOT, 'contracts/testnet-safe-results.json'), JSON.stringify(out, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n')
const failed = out.steps.filter((s) => s.ok === false).length
console.log(`\n${out.steps.length - failed} of ${out.steps.length} steps passed; payer ${out.payerBalanceBefore} -> ${out.payerBalanceAfter ?? '?'} ETH`)
process.exit(failed ? 1 : 0)
