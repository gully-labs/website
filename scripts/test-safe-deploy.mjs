// Tests of one-click Safe deployment (server/safe-deploy.mjs) against stubbed chains.
//
//   node scripts/test-safe-deploy.mjs        (npm run test:safe-deploy; no build needed)
//
// Every chain is a local JSON-RPC stub (GULLY_RPC_<chainId>) answering from scripts/fixtures/safe-v141.json, which
// holds REAL Safe v1.4.1 code and the real creation of the 1-of-1 Safe 0x041F9F5F… read from Base Sepolia (so the
// pinned code hashes and the CREATE2 arithmetic are checked against genuine bytes). The stub plays:
//   8453   the origin: the Safe has code, its creation transaction and logs exist, old blocks have no code
//   42161  a target where Safe 1.4.1 is deployed (factory, SafeL2, fallback handler): deployable
//   1      a target with NO factory code: refused
//   56     a target whose factory code is tampered (hash differs): refused
//   10     OP Mainnet (a payment chain since feat/pay-chains) with Safe 1.4.1; 137 and 43114 without it
// Then the real server runs IN THIS PROCESS on TEST_PORT (default 8798) for the admin and merchant routes.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { guardTestRun, makeChecker, makeClient } from './test-helpers.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const F = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/safe-v141.json'), 'utf8'))
const PORT = Number(process.env.TEST_PORT) || 8798
await guardTestRun(PORT)
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-safe-'))
const ADMIN = crypto.randomBytes(24).toString('hex')
const t = makeChecker()
const { check } = t

const SAFE = F.safe.address.toLowerCase()
const FACTORY = F.contracts.factory.address
const SAFE_L2 = F.contracts.safeL2.address
const FALLBACK = F.contracts.fallback.address
const DEPLOY_BLOCK = Number(BigInt(F.creation.tx.blockNumber))
const HEAD = DEPLOY_BLOCK + 1000
const hex = (n) => '0x' + BigInt(n).toString(16)
const word = (n) => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0')
const pad = (a) => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0')
const SEL = { getOwners: '0xa0e67e2b', getThreshold: '0xe75235b8', VERSION: '0xffa1ad74', proxyCreationCode: '0x53e5d935', getModulesPaginated: '0xcc2f8452' }

/* ---------------------------------------------------------- chain stubs --- */

function makeChain(chainId, { factory = true, tamperFactory = false, safeHere = false, history = false } = {}) {
  const c = { chainId, calls: [], receipts: new Map(), txs: new Map(), code: new Map(), storage: new Map(), safes: new Map(), pccOverride: null }
  if (factory) {
    c.code.set(FACTORY, tamperFactory ? F.contracts.factory.code + '00' : F.contracts.factory.code)
    c.code.set(SAFE_L2, F.contracts.safeL2.code)
    c.code.set(F.contracts.safe.address, F.contracts.safe.code)
    c.code.set(FALLBACK, F.contracts.fallback.code)
  }
  /** Puts a Safe proxy at `address` with owners/threshold (what a deployment leaves behind). */
  c.putSafe = (address, { owners, threshold, singleton = SAFE_L2, fallbackHandler = null }) => {
    const a = address.toLowerCase()
    c.code.set(a, F.contracts.proxy.code)
    c.storage.set(`${a}:0x0`, pad(singleton))
    if (fallbackHandler) c.storage.set(`${a}:0x6c9a6c4a39284e37ed1cf53d337577d14212a4870fb976a4366c693b939918d5`, pad(fallbackHandler))
    c.safes.set(a, { owners, threshold })
  }
  if (safeHere) {
    c.putSafe(SAFE, { owners: ['0x7329e717276d7C05E8C2D6Ed772114b93b34bFA4'], threshold: 1 })
    c.txs.set(F.creation.tx.hash, { ...F.creation.tx, hash: F.creation.tx.hash })
    c.receipts.set(F.creation.tx.hash, F.creation.receipt)
  }
  c.server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      const q = JSON.parse(body)
      c.calls.push(q.method)
      let result = null
      let error = null
      const p = q.params ?? []
      if (q.method === 'eth_chainId') result = hex(chainId)
      else if (q.method === 'eth_blockNumber') result = hex(HEAD)
      else if (q.method === 'eth_getCode') {
        const a = String(p[0]).toLowerCase()
        const block = p[1]
        if (block !== 'latest') {
          if (!history) error = { code: -32000, message: 'missing trie node (archive requests require a token)' }
          else result = a === SAFE && Number(BigInt(block)) < DEPLOY_BLOCK ? '0x' : (c.code.get(a) ?? '0x')
        } else result = c.code.get(a) ?? '0x'
      } else if (q.method === 'eth_getStorageAt') result = c.storage.get(`${String(p[0]).toLowerCase()}:${p[1]}`) ?? pad('0x0')
      else if (q.method === 'eth_getTransactionReceipt') result = c.receipts.get(p[0]) ?? null
      else if (q.method === 'eth_getTransactionByHash') result = c.txs.get(p[0]) ?? null
      else if (q.method === 'eth_estimateGas') result = c.code.get(String(p[0].to).toLowerCase()) ? hex(236_880) : (error = { code: 3, message: 'execution reverted' })
      else if (q.method === 'eth_gasPrice') result = hex(1_000_000_000)
      else if (q.method === 'eth_getLogs') {
        const f = p[0]
        const from = Number(BigInt(f.fromBlock))
        const to = f.toBlock === 'latest' ? HEAD : Number(BigInt(f.toBlock))
        if (to - from > 200) error = { code: -32614, message: 'eth_getLogs is limited to a 200 range' }
        else result = safeHere && from <= DEPLOY_BLOCK && to >= DEPLOY_BLOCK ? F.creation.receipt.logs.filter((l) => !f.topics || l.topics[0] === f.topics[0]) : []
      } else if (q.method === 'eth_call') {
        const to = String(p[0].to).toLowerCase()
        const data = String(p[0].data)
        const s = c.safes.get(to)
        if (to === FACTORY && data === SEL.proxyCreationCode) result = c.pccOverride ?? '0x' + word(32) + word((F.proxyCreationCode.length - 2) / 2) + F.proxyCreationCode.slice(2).padEnd(Math.ceil((F.proxyCreationCode.length - 2) / 64) * 64, '0')
        else if (s && data === SEL.getOwners) result = '0x' + word(32) + word(s.owners.length) + s.owners.map((o) => word(BigInt(o))).join('')
        else if (s && data === SEL.getThreshold) result = '0x' + word(s.threshold)
        else if (s && data === SEL.VERSION) result = F.safe.version
        else if (s && data.startsWith(SEL.getModulesPaginated)) result = F.safe.modulesPaginated
        else error = { code: 3, message: 'execution reverted' }
      } else error = { code: -32601, message: `method ${q.method} not stubbed` }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(error ? { jsonrpc: '2.0', id: q.id, error } : { jsonrpc: '2.0', id: q.id, result }))
    })
  })
  return c
}

// 10 (OP Mainnet) has Safe 1.4.1, so the treasury can be deployed there; 137 and 43114 have no factory.
const chains = { 8453: makeChain(8453, { safeHere: true, history: true }), 42161: makeChain(42161), 1: makeChain(1, { factory: false }), 56: makeChain(56, { tamperFactory: true }), 10: makeChain(10), 137: makeChain(137, { factory: false }), 43114: makeChain(43114, { factory: false }) }
for (const c of Object.values(chains)) await new Promise((r) => c.server.listen(0, '127.0.0.1', r))
const CHAIN_ENV = Object.fromEntries(Object.values(chains).map((c) => [`GULLY_RPC_${c.chainId}`, `http://127.0.0.1:${c.server.address().port}`]))
const EOA = privateKeyToAccount(generatePrivateKey()).address
Object.assign(process.env, { PORT: String(PORT), DATA_DIR: tmp, TRACKER_DATA: path.join(tmp, 'tracker-history.json'), DIST_DIR: path.join(tmp, 'no-dist'), ADMIN_TOKEN: ADMIN, TRACKER_LOOP: 'off', GULLY_TREASURY_ADDRESS: EOA, GULLY_MERCHANT_TICK_MS: '0', GULLY_PAY_WEBHOOK_TICK_MS: '0', ...CHAIN_ENV })
for (const k of ['GULLY_BASE_RPC', 'GULLY_MIN_CONFIRMATIONS', 'TELEGRAM_BOT_TOKEN', 'GULLY_TESTNET_CHAINS']) delete process.env[k]

const S = await import('../server/safe-deploy.mjs')
const lower = (a) => String(a).toLowerCase()
const same = (a, b) => lower(a) === lower(b)

try {
  /* --------------------------------------------------- pure arithmetic --- */
  const calls = S.decodeFactoryCalls(F.creation.tx.input)
  check('the creation input decodes to one createProxyWithNonce call', calls.length === 1 && calls[0].kind === 'createProxyWithNonce' && same(calls[0].singleton, SAFE_L2), JSON.stringify(calls.map((c) => c.kind)))
  check('its salt nonce is the original one (0x1a14c8cd37b)', calls[0]?.saltNonce === '0x1a14c8cd37b', calls[0]?.saltNonce)
  const setup = S.decodeSetup(calls[0].initializer)
  check('the initializer is setup(): owner 0x7329…bFA4, threshold 1, no fallback handler, no payment', setup && setup.owners.length === 1 && same(setup.owners[0], '0x7329e717276d7C05E8C2D6Ed772114b93b34bFA4') && setup.threshold === 1 && /^0x0{40}$/.test(setup.fallbackHandler) && setup.payment === '0', JSON.stringify(setup))
  const predicted = S.predictProxy({ factory: FACTORY, singleton: SAFE_L2, initializer: calls[0].initializer, saltNonce: calls[0].saltNonce, proxyCreationCode: F.proxyCreationCode })
  check('CREATE2 prediction from the recovered inputs equals the Safe’s address', same(predicted, SAFE), predicted)
  check('re-encoding the call gives the original transaction input, byte for byte', lower(S.encodeCreateProxyWithNonce(SAFE_L2, calls[0].initializer, calls[0].saltNonce)) === lower(F.creation.tx.input))
  check('encodeSetup/decodeSetup round-trip with two owners, threshold 2 and a fallback handler', (() => {
    const o = ['0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222']
    const d = S.decodeSetup(S.encodeSetup({ owners: o, threshold: 2, fallbackHandler: FALLBACK }))
    return d && d.owners.length === 2 && d.threshold === 2 && same(d.fallbackHandler, FALLBACK) && d.data === '0x'
  })())
  check('a tampered initializer predicts a different address (so a wrong plan can never pass)', !same(S.predictProxy({ factory: FACTORY, singleton: SAFE_L2, initializer: calls[0].initializer.replace(/7329e717/, '7329e718'), saltNonce: calls[0].saltNonce, proxyCreationCode: F.proxyCreationCode }), SAFE))
  check('a wrapped call (another contract’s input containing the factory call) is still found', S.decodeFactoryCalls('0x8d80ff0a' + word(32) + word(500) + '00'.repeat(53) + F.creation.tx.input.slice(2) + '00'.repeat(11)).some((c) => c.saltNonce === '0x1a14c8cd37b'))
  const cb = S.decodeFactoryCalls(S.SEL.createProxyWithCallback + word(BigInt(SAFE_L2)) + word(128) + word(7) + word(BigInt('0x3333333333333333333333333333333333333333')) + word(4) + 'deadbeef'.padEnd(64, '0'))
  check('createProxyWithCallback decodes with the derived salt nonce keccak256(nonce ++ callback)', cb.length === 1 && cb[0].kind === 'createProxyWithCallback' && cb[0].originalSaltNonce === '0x7' && cb[0].saltNonce === '0x' + BigInt(S.keccakHex(word(7) + '3333333333333333333333333333333333333333')).toString(16), JSON.stringify(cb))
  check('createProxy (plain CREATE) is recognised as not reproducible', S.isPlainCreateProxy(S.SEL.createProxy + word(1)) && !S.isPlainCreateProxy(F.creation.tx.input))
  check('the pinned topics are Safe’s', S.TOPICS.proxyCreation === '0x4f51faf6c4561ff95f067657e43439f0f856d97c04d9ec9070a6199ad418e235' && S.TOPICS.safeSetup === '0x141df868a6331af528e38c83b7aa03edc19be66e37ae67f9285bf4f8e3c6a1a8')

  /* ---------------------------------------------------------- chain reads --- */
  const read = await S.readSafe(8453, SAFE)
  check('readSafe: SafeL2 1.4.1, one owner, threshold 1', read.ok && read.singletonName === 'SafeL2' && read.version === '1.4.1' && read.owners.length === 1 && read.threshold === 1, JSON.stringify(read))
  const notSafe = await S.readSafe(8453, FACTORY)
  check('readSafe refuses a contract whose storage slot 0 is not a known singleton', !notSafe.ok && notSafe.code === 'not-a-safe')
  const first = await S.firstBlockWithCode(8453, SAFE)
  check(`firstBlockWithCode finds the creation block ${DEPLOY_BLOCK} by binary search`, first === DEPLOY_BLOCK, String(first))
  await check('firstBlockWithCode stops at once on a node without archive state', await S.firstBlockWithCode(42161, SAFE).then(() => false, (e) => /archive/i.test(e.message)))
  const fromTx = await S.creationFromTx(8453, SAFE, F.creation.tx.hash)
  check('creationFromTx: inputs recovered and verified from the creation transaction', fromTx.ok && same(fromTx.factory, FACTORY) && fromTx.saltNonce === '0x1a14c8cd37b', JSON.stringify(fromTx).slice(0, 200))
  check('creationFromTx: an unknown hash is refused', !(await S.creationFromTx(8453, SAFE, '0x' + 'ab'.repeat(32))).ok)
  check('creationFromTx: a transaction that did not create this Safe is refused', !(await S.creationFromTx(8453, EOA, F.creation.tx.hash)).ok)
  const found = await S.findCreation(8453, SAFE)
  check('findCreation: without a hint, the chain’s history (first block with code, then that block’s ProxyCreation log) finds it', found.ok && found.source === 'chain', JSON.stringify(found).slice(0, 160))
  const n8453 = chains[8453].calls.filter((m) => m === 'eth_getLogs').length
  check('findCreation asked for logs of ONE block only (public nodes cap the range)', n8453 >= 1 && n8453 <= 2, String(n8453))

  /* ---------------------------------------------------------- reproduce plans --- */
  const plan = await S.planReproduce({ address: SAFE, targetChainId: 42161, from: EOA })
  check('plan (8453 -> 42161): ok, predicted address equals the Safe', plan.ok && !plan.alreadyDeployed && same(plan.predicted, SAFE) && plan.matches, plan.error)
  check('plan: the factory call is the original input, to the official factory, value 0', plan.ok && same(plan.tx.to, FACTORY) && lower(plan.tx.data) === lower(F.creation.tx.input) && plan.tx.value === '0x0')
  check('plan: origin read on Base, version 1.4.1, creation found from the chain', plan.ok && plan.origin.chainId === 8453 && plan.origin.version === '1.4.1' && plan.origin.source === 'chain')
  check('plan: every check passed (factory, singleton and prediction on the target)', plan.ok && plan.checks.length >= 5 && plan.checks.every((c) => c.ok), JSON.stringify(plan.checks))
  check('plan: gas estimated (236,880 at 1 gwei = 0.00023688 ETH)', plan.ok && plan.gas.estimate === 236_880 && plan.gas.cost === '0.00023688 ETH' && plan.gas.error === null, JSON.stringify(plan.gas))
  check('plan: the chain view carries what wallet_addEthereumChain needs', plan.ok && plan.chain.hexId === '0xa4b1' && plan.chain.native.symbol === 'ETH' && plan.chain.rpcs.length > 0)
  const noFactory = await S.planReproduce({ address: SAFE, targetChainId: 1 })
  check('plan (-> 1, no factory code): refused with no-factory and the failing check named', !noFactory.ok && noFactory.status === 422 && noFactory.code === 'no-factory' && noFactory.checks.some((c) => c.id === 'target-factory' && !c.ok), JSON.stringify(noFactory.checks))
  const tampered = await S.planReproduce({ address: SAFE, targetChainId: 56 })
  check('plan (-> 56, factory code differs from the pinned hash): refused', !tampered.ok && tampered.code === 'no-factory' && /differs/.test(tampered.error), tampered.error)
  const already = await S.planReproduce({ address: SAFE, targetChainId: 8453 })
  check('plan (-> 8453, already there): alreadyDeployed, kind safe', already.ok && already.alreadyDeployed && already.kind === 'safe' && /1 owner/.test(already.what), JSON.stringify(already))
  chains[42161].pccOverride = '0x' + word(32) + word(32) + 'beef'.repeat(16)
  S.resetForTest()
  const mismatch = await S.planReproduce({ address: SAFE, targetChainId: 42161 })
  check('plan: a target factory whose creation code differs predicts another address -> refused (mismatch)', !mismatch.ok && mismatch.code === 'mismatch' && /would create 0x/.test(mismatch.error), mismatch.error)
  chains[42161].pccOverride = null
  S.resetForTest()
  const feeProxy = await S.planReproduce({ address: '0x1892196e80c4c17ea5100da765ab48c1fe2fb814', targetChainId: 42161 })
  check('plan: a fee-proxy address is never a target', !feeProxy.ok && feeProxy.code === 'forbidden')
  const noOrigin = await S.planReproduce({ address: EOA, targetChainId: 42161 })
  check('plan: an address with no Safe anywhere is refused (no-origin)', !noOrigin.ok && noOrigin.code === 'no-origin' && noOrigin.status === 422)
  const forbid = await S.planReproduce({ address: SAFE, targetChainId: 42161, forbid: [SAFE] })
  check('plan: the merchant path refuses our own treasury', !forbid.ok && forbid.code === 'forbidden')
  check('plan: a bad address and a bad deployTx are 400s', (await S.planReproduce({ address: '0x12', targetChainId: 42161 })).status === 400 && (await S.planReproduce({ address: SAFE, targetChainId: 42161, deployTx: '0xzz' })).status === 400)
  const given = await S.planReproduce({ address: SAFE, targetChainId: 42161, deployTx: F.creation.tx.hash })
  check('plan with the creation tx given: source tx', given.ok && given.origin.source === 'tx')

  /* -------------------------------------------------------------- new Safes --- */
  const O1 = '0x1111111111111111111111111111111111111111'
  const O2 = '0x2222222222222222222222222222222222222222'
  const n1 = await S.planNew({ chainId: 42161, owners: [O1, O2], threshold: 2, scope: 'ws-a', from: EOA })
  check('new Safe (42161): ok, SafeL2 1.4.1, fallback handler set, no payment', n1.ok && !n1.alreadyDeployed && n1.singletonName === 'SafeL2' && n1.version === '1.4.1' && same(n1.setup.fallbackHandler, FALLBACK) && n1.setup.payment === '0', n1.error)
  const n1b = await S.planNew({ chainId: 8453, owners: [O2, O1], threshold: 2, scope: 'ws-a' })
  check('new Safe: deterministic: the same owners (any order), threshold and scope give the same address on another chain', n1b.ok && same(n1b.predicted, n1.predicted) && n1b.saltNonce === n1.saltNonce, `${n1.predicted} vs ${n1b.predicted}`)
  check('new Safe: the local CREATE2 arithmetic agrees with the plan', same(S.predictProxy({ factory: n1.factory, singleton: n1.singleton, initializer: n1.initializer, saltNonce: n1.saltNonce, proxyCreationCode: n1.proxyCreationCode }), n1.predicted))
  check('new Safe: another scope or salt gives another address', !same((await S.planNew({ chainId: 42161, owners: [O1, O2], threshold: 2, scope: 'ws-b' })).predicted, n1.predicted) && !same((await S.planNew({ chainId: 42161, owners: [O1, O2], threshold: 2, scope: 'ws-a', salt: '2' })).predicted, n1.predicted))
  check('new Safe: recorded with its inputs', !!S.recordOf(n1.predicted) && S.recordOf(n1.predicted).saltNonce === n1.saltNonce && S.recordOf(n1.predicted).scope === 'ws-a')
  check('new Safe: duplicate owners, a threshold above the owner count, a bad address and no factory are refused', (await S.planNew({ chainId: 42161, owners: [O1, O1], threshold: 1, scope: 'x' })).status === 400 && (await S.planNew({ chainId: 42161, owners: [O1], threshold: 2, scope: 'x' })).status === 400 && (await S.planNew({ chainId: 42161, owners: ['0x12'], threshold: 1, scope: 'x' })).status === 400 && (await S.planNew({ chainId: 1, owners: [O1], threshold: 1, scope: 'x' })).code === 'no-factory')
  check('new Safe on Ethereum would use the Safe (L1) singleton', (await S.planNew({ chainId: 56, owners: [O1], threshold: 1, scope: 'x' })).code === 'no-factory' && S.NEW_SAFE.singletonL1.name === 'Safe')

  /* ------------------------------------------------------------- status --- */
  const H = '0x' + crypto.randomBytes(32).toString('hex')
  check('status: pending while there is no receipt', (await S.deploymentStatus({ chainId: 42161, hash: H, address: n1.predicted })).state === 'pending')
  chains[42161].receipts.set(H, { transactionHash: H, status: '0x0', blockNumber: hex(HEAD), gasUsed: hex(50_000), logs: [] })
  check('status: failed when the receipt reverted', (await S.deploymentStatus({ chainId: 42161, hash: H, address: n1.predicted })).state === 'failed')
  chains[42161].receipts.set(H, { transactionHash: H, status: '0x1', blockNumber: hex(HEAD), gasUsed: hex(236_000), logs: [{ address: FACTORY, topics: [S.TOPICS.proxyCreation, pad(n1.predicted)], data: pad(SAFE_L2) }] })
  check('status: mined but not verified while the address still has no code', (await S.deploymentStatus({ chainId: 42161, hash: H, address: n1.predicted })).state === 'mined')
  chains[42161].putSafe(n1.predicted, { owners: [O1, O2], threshold: 2, fallbackHandler: FALLBACK })
  const v = await S.deploymentStatus({ chainId: 42161, hash: H, address: n1.predicted })
  check('status: verified once eth_getCode and getOwners answer; owners and threshold reported', v.state === 'verified' && v.owners.length === 2 && v.threshold === 2 && v.gasUsed === 236_000, JSON.stringify(v))
  check('status: the verified deployment is recorded on the Safe', S.recordOf(n1.predicted).deployments['42161']?.tx === H)
  const again = await S.planNew({ chainId: 42161, owners: [O1, O2], threshold: 2, scope: 'ws-a' })
  check('new Safe plan on a chain where it now exists: alreadyDeployed', again.ok && again.alreadyDeployed && again.kind === 'safe')
  const copy = await S.planReproduce({ address: n1.predicted, targetChainId: 8453, from: EOA })
  check('reproducing the new Safe on another chain uses our record (no log scan) and predicts its address', copy.ok && copy.origin.source === 'record' && same(copy.predicted, n1.predicted) && same(copy.setup.fallbackHandler, FALLBACK), copy.error)
  check('status: a wrong hash or chain is a 400', (await S.deploymentStatus({ chainId: 42161, hash: '0x12', address: SAFE })).status === 400 && (await S.deploymentStatus({ chainId: 999, hash: H, address: SAFE })).status === 400)

  /* --------------------------------------------------------------- routes --- */
  await import('../server/server.mjs')
  await new Promise((r) => setTimeout(r, 300))
  const admin = (p, method = 'GET', body) => fetch(BASE + p, { method, headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }))
  const tEoa = await admin('/api/admin/safe/treasury')
  check('admin treasury (an EOA everywhere): every chain kind eoa, nothing to deploy, note says so', tEoa.status === 200 && tEoa.data.set && tEoa.data.chains.every((c) => c.kind === 'eoa' && !c.canDeploy) && /normal wallet/.test(tEoa.data.note ?? ''), JSON.stringify(tEoa.data).slice(0, 200))
  // The admin card's contract: one row per payment chain (payments.mjs CHAIN_LIST, OP Mainnet, Polygon and Avalanche
  // included since feat/pay-chains), each marked a payment chain, with what the treasury is there (deployed or not).
  const { CHAIN_LIST } = await import('../server/payments.mjs')
  check('admin treasury lists every payment chain, in order, each marked payments (OP Mainnet, Polygon and Avalanche included)', tEoa.data.chains.map((c) => c.chainId).join() === CHAIN_LIST.map((c) => c.id).join() && [8453, 1, 56, 42161, 10, 137, 43114].every((id) => tEoa.data.chains.some((c) => c.chainId === id)) && tEoa.data.chains.every((c) => c.payments === true), JSON.stringify(tEoa.data.chains.map((c) => [c.chainId, c.payments])))
  process.env.GULLY_TREASURY_ADDRESS = SAFE
  const tSafe = await admin('/api/admin/safe/treasury?fresh=1')
  const row = (id) => tSafe.data.chains.find((c) => c.chainId === id)
  check('admin treasury (the Safe): Base is a Safe 1.4.1 (origin), Arbitrum can be deployed, Ethereum is listed too', tSafe.status === 200 && row(8453).kind === 'safe' && tSafe.data.origin.chainId === 8453 && row(42161).canDeploy && row(1).kind === 'eoa', JSON.stringify(tSafe.data.chains.map((c) => [c.chainId, c.kind, c.canDeploy])))
  check('admin treasury rows: every payment chain carries its status: deployed (kind safe, no Deploy) on Base, not deployed (kind eoa, canDeploy) on the rest', tSafe.data.chains.every((c) => c.payments && (c.chainId === 8453 ? c.kind === 'safe' && !c.canDeploy && c.safe?.version === '1.4.1' : c.kind === 'eoa' && c.canDeploy)), JSON.stringify(tSafe.data.chains.map((c) => [c.chainId, c.kind, c.canDeploy])))
  check('admin treasury rows: OP Mainnet, Polygon and Avalanche are read too (not deployed there, deployable)', [10, 137, 43114].every((id) => row(id).kind === 'eoa' && row(id).canDeploy))
  const aOp = await admin('/api/admin/safe/plan', 'POST', { chainId: 10 })
  check('admin plan (-> OP Mainnet, Safe not deployed there yet): ok, same predicted address, Etherscan (OP) explorer', aOp.status === 200 && same(aOp.data.predicted, SAFE) && /optimistic\.etherscan\.io/.test(aOp.data.explorerUrl) && aOp.data.chain.hexId === '0xa', JSON.stringify(aOp.data).slice(0, 160))
  check('admin plan (-> Polygon, no factory): 422 no-factory', (await admin('/api/admin/safe/plan', 'POST', { chainId: 137 })).data.code === 'no-factory')
  const aPlan = await admin('/api/admin/safe/plan', 'POST', { chainId: 42161, from: EOA })
  check('admin plan (-> Arbitrum): ok, the treasury’s address predicted, calldata and gas returned', aPlan.status === 200 && same(aPlan.data.predicted, SAFE) && same(aPlan.data.tx.to, FACTORY) && aPlan.data.gas.estimate === 236_880, JSON.stringify(aPlan.data).slice(0, 160))
  const aNo = await admin('/api/admin/safe/plan', 'POST', { chainId: 1 })
  check('admin plan (-> Ethereum, no factory): 422 with the checks', aNo.status === 422 && aNo.data.code === 'no-factory' && Array.isArray(aNo.data.checks))
  check('admin plan: an unknown chain is a 400; GET on plan is 405', (await admin('/api/admin/safe/plan', 'POST', { chainId: 4242 })).status === 400 && (await admin('/api/admin/safe/plan')).status === 405)
  check('admin status: pending for an unseen hash', (await admin('/api/admin/safe/status', 'POST', { chainId: 42161, hash: '0x' + 'cd'.repeat(32) })).data.state === 'pending')
  check('admin routes need the token', (await fetch(BASE + '/api/admin/safe/treasury')).status === 401)

  const owner = privateKeyToAccount(generatePrivateKey())
  const O = makeClient(BASE)
  check('a store owner signs in (SIWE)', (await O.signIn(owner)).status === 200)
  const g = await O.call('/api/developer/merchant/safe')
  check('GET /merchant/safe: the store’s chains and no recorded Safes yet', g.status === 200 && g.data.safes.length === 0 && g.data.chains.some((c) => c.id === 8453) && g.data.newSafe.version === '1.4.1', JSON.stringify(g.data).slice(0, 160))
  const mTreasury = await O.post('/api/developer/merchant/safe/plan', { chainId: 42161, address: SAFE })
  check('merchant plan for our treasury address: refused (forbidden)', mTreasury.status === 400 && mTreasury.data.code === 'forbidden', JSON.stringify(mTreasury.data))
  process.env.GULLY_TREASURY_ADDRESS = EOA
  const mPlan = await O.post('/api/developer/merchant/safe/plan', { chainId: 42161, address: SAFE, from: owner.address })
  check('merchant plan (8453 -> 42161): ok with calldata, prediction and gas', mPlan.status === 200 && same(mPlan.data.predicted, SAFE) && mPlan.data.tx.data.length > 10 && mPlan.data.gas.estimate === 236_880, JSON.stringify(mPlan.data).slice(0, 160))
  const mNew = await O.post('/api/developer/merchant/safe/plan', { chainId: 42161, mode: 'new', owners: [owner.address], threshold: 1 })
  check('merchant new-Safe plan: 1-of-1 with the owner’s wallet, recorded under the workspace', mNew.status === 200 && mNew.data.setup.owners.length === 1 && same(mNew.data.setup.owners[0], owner.address) && S.recordOf(mNew.data.predicted)?.scope === owner.address.toLowerCase(), JSON.stringify(mNew.data).slice(0, 160))
  const g2 = await O.call('/api/developer/merchant/safe')
  check('GET /merchant/safe now lists the recorded Safe', g2.data.safes.length === 1 && same(g2.data.safes[0].address, mNew.data.predicted))
  // 250 (Fantom) is in neither payments.mjs nor the Safe chains: genuinely not a store chain.
  check('merchant plan: a chain that is not a store chain is a 400', !S.storeChains().some((c) => c.id === 250) && (await O.post('/api/developer/merchant/safe/plan', { chainId: 250, address: SAFE })).status === 400)
  check('merchant status: pending for an unseen hash', (await O.post('/api/developer/merchant/safe/status', { chainId: 42161, hash: '0x' + 'ef'.repeat(32), address: mNew.data.predicted })).data.state === 'pending')
  check('merchant routes need a session', (await fetch(BASE + '/api/developer/merchant/safe')).status === 401)
  const anon = makeClient(BASE)
  check('merchant routes refuse a cross-site POST', (await anon.call('/api/developer/merchant/safe/plan', { method: 'POST', body: { chainId: 42161, address: SAFE } })).status !== 200)
} catch (e) {
  t.failed++
  console.log('FAIL  uncaught', e?.stack ?? e)
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
for (const c of Object.values(chains)) c.server.close()
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(t.failed ? 1 : 0)
