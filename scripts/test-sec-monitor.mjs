// Gully Security monitoring (server/sec-monitor.mjs), end to end against an in-process server.
//
//   node scripts/test-sec-monitor.mjs        (no build needed; TEST_PORT overrides the port, default 8797)
//
// The real server runs IN THIS PROCESS with a fresh temporary DATA_DIR, the minute loop off (TRACKER_LOOP=off), and
// the chain replaced by a JavaScript stub (setMonitorRpcForTest): code, storage slots, calls, balances and logs are
// whatever the test sets. Webhooks go to a local receiver (GULLY_ALLOW_LOOPBACK_WEBHOOKS=1). A random wallet signs in.
//
// Covers: event signatures, log decoding for every kind (indexed and not), the plain-language text and a jargon
// sweep, outflow thresholds (token % and native % or amount), never alerting twice (including a cursor rewind),
// restart resume, range halving and back-off, plan limits and coverage, HMAC-signed deliveries, and that the loop
// only starts from startLoops().

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { guardTestRun, makeChecker, makeClient } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8797
await guardTestRun(PORT)
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-secmon-'))
const ADMIN = crypto.randomBytes(24).toString('hex')
const t = makeChecker()
const { check } = t

/* --------------------------------------------------------------- webhook receiver --- */

const hooks = []
const receiver = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    hooks.push({ headers: req.headers, raw, body: JSON.parse(raw) })
    res.writeHead(200)
    res.end('ok')
  })
})
await new Promise((r) => receiver.listen(0, '127.0.0.1', r))
const HOOK = `http://127.0.0.1:${receiver.address().port}/hook`

Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: path.join(tmp, 'no-dist'),
  ADMIN_TOKEN: ADMIN,
  TRACKER_LOOP: 'off',
  DEEPCORE_LOOP: 'off',
  ASK_REMOTE: 'off',
  GULLY_ALLOW_LOOPBACK_WEBHOOKS: '1',
  ...Object.fromEntries([1, 8453, 56, 42161, 10, 137, 43114].map((id) => [`GULLY_RPC_${id}`, 'http://127.0.0.1:9'])),
})
delete process.env.TELEGRAM_BOT_TOKEN
delete process.env.GULLY_TREASURY_ADDRESS
await import('../server/server.mjs')
const mon = await import('../server/sec-monitor.mjs')
await new Promise((r) => setTimeout(r, 200))

/* ------------------------------------------------------------------- chain stub --- */

const hex = (n) => '0x' + BigInt(n).toString(16)
const pad = (a) => '0x' + String(a).toLowerCase().replace(/^0x/, '').padStart(64, '0')
const word = (v) => BigInt(v).toString(16).padStart(64, '0')
const addr = (n) => '0x' + n.toString(16).padStart(40, '0')
const txh = () => '0x' + crypto.randomBytes(32).toString('hex')
const VAULT = addr(0xa11ce)
const OTHER = addr(0xb0b)
const THIRD = addr(0xc0c)
const SAFE = addr(0x5afe)
const TOKEN = addr(0x70c3)
const [IMPL1, IMPL2, IMPL3, EOA, NEWADMIN, BEACON, S1, S2, S3, S4, TO] = [0x1001, 0x1002, 0x1003, 0xe0a, 0xad, 0xbea, 0x51, 0x52, 0x53, 0x54, 0x70].map(addr)

const st = {
  head: 1_000,
  code: new Map([[VAULT, '0x6080'], [OTHER, '0x6080'], [THIRD, '0x6080'], [SAFE, '0x6080'], [TOKEN, '0x6080']]),
  slots: new Map([[`${VAULT}:${mon.SLOTS.implementation}`, pad(IMPL1)]]),
  calls: new Map([
    [`${VAULT}:${mon.SEL.owner}`, pad(SAFE)],
    [`${SAFE}:${mon.SEL.getThreshold}`, '0x' + word(2)],
    [`${SAFE}:${mon.SEL.getOwners}`, '0x' + word(32) + word(3) + [S1, S2, S3].map((a) => a.slice(2).padStart(64, '0')).join('')],
    [`${TOKEN}:${mon.SEL.decimals}`, '0x' + word(6)],
    [`${TOKEN}:${mon.SEL.symbol}`, '0x' + word(32) + word(4) + Buffer.from('USDC').toString('hex').padEnd(64, '0')],
  ]),
  balances: new Map([[VAULT, 10n * 10n ** 18n]]),
  tokenBal: new Map([[`${TOKEN}:${VAULT}`, 400_000_000n]]),
  logs: [],
  fail: false,
  maxRange: Infinity,
  log: [],
}
async function stub(chainId, method, params) {
  st.log.push({ method, params })
  if (st.fail) throw Object.assign(new Error('HTTP 503'), { nodeFault: true })
  switch (method) {
    case 'eth_blockNumber':
      return hex(st.head)
    case 'eth_getCode':
      return st.code.get(params[0].toLowerCase()) ?? '0x'
    case 'eth_getStorageAt':
      return st.slots.get(`${params[0].toLowerCase()}:${params[1]}`) ?? '0x0'
    case 'eth_getBalance':
      return hex(st.balances.get(params[0].toLowerCase()) ?? 0n)
    case 'eth_call': {
      const { to, data } = params[0]
      if (data.startsWith(mon.SEL.balanceOf)) return '0x' + word(st.tokenBal.get(`${to}:${'0x' + data.slice(-40)}`) ?? 0n)
      const v = st.calls.get(`${to.toLowerCase()}:${data.slice(0, 10)}`)
      if (v === undefined) throw new Error('execution reverted')
      return v
    }
    case 'eth_getLogs': {
      const q = params[0]
      const from = Number(BigInt(q.fromBlock))
      const to = Number(BigInt(q.toBlock))
      if (to - from + 1 > st.maxRange) throw new Error('block range too large')
      const addrs = q.address ? q.address.map((a) => a.toLowerCase()) : null
      const t0 = q.topics?.[0]
      const t1 = q.topics?.[1]
      return st.logs.filter((l) => {
        const n = Number(BigInt(l.blockNumber))
        if (n < from || n > to) return false
        if (addrs && !addrs.includes(l.address)) return false
        if (t0 && !(Array.isArray(t0) ? t0 : [t0]).includes(l.topics[0])) return false
        if (t1 && !(Array.isArray(t1) ? t1 : [t1]).includes(l.topics[1])) return false
        return true
      })
    }
    default:
      return null
  }
}
mon.setMonitorRpcForTest(stub)
let li = 0
const L = (address, topics, data = '0x', block = st.head + 1) => {
  const l = { address, topics, data, blockNumber: hex(block), logIndex: hex(li++), transactionHash: txh() }
  st.logs.push(l)
  return l
}
const T = mon.TOPICS
const delivered = () => hooks.filter((h) => h.body.type === 'monitor.alert')
const kindsOf = (h) => h.body.events.map((e) => e.kind)

const JARGON = /\b(log|logs|topic|topics|slot|storage|bytes32|selector|calldata|revert|eip-?\d+|erc-?\d+|implementation|proxy|beacon|null|undefined|nan|keccak|abi|wei)\b/i
const FULL_HEX = /0x[0-9a-fA-F]{40}/
/** The alert text without its trailing link (URLs carry full hashes by design). */
const plain = (text) => text.replace(/ · https?:\/\/\S+$/, '')

try {
  /* ------------------------------------------------------------- signatures --- */
  check('event signatures are the standard ones', T.ownershipTransferred === '0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0' && T.transfer === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' && T.upgraded === '0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b' && T.adminChanged === '0x7e644d79422f17c01e4894b5f4f588d331ebfa28653d42ae832dc59e38c9798f')
  check('AccessControl and Pausable signatures', T.roleGranted === '0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d' && T.roleRevoked === '0xf6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b' && T.paused === '0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258' && T.unpaused === '0x5db9ee0a495bf2e6ff9c91a7834c1ba4fdd244a5e8aa4e537bd38aeae4b073aa')
  check('beacon and Safe signatures', T.beaconUpgraded === '0x1cf3b03a6cf19fa2baba4df148e9dcabedea7f8a5c07840e207e5c089be95d3e' && T.addedOwner === '0x9465fa0c962cc76958e6373a993326400c1c94f8be2fe3a952adfa7f60b2ea26' && T.removedOwner === '0xf8d49fc529812e9a7c5c50e69c20f0dccc0db8fa95c98bc58cc9a4f1c1299eaf' && T.changedThreshold === '0x610f7ff2b304ae8903c3de74c60c6ab1f7d6226b3f52c5161905bb5ad4039c93')
  check('ERC-1967 slots are the standard ones', mon.SLOTS.implementation === '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' && mon.SLOTS.admin === '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103' && mon.SLOTS.beacon === '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50')

  /* --------------------------------------------------------------- decoding --- */
  const mk = (topics, data = '0x') => ({ address: VAULT, topics, data, blockNumber: '0x10', logIndex: '0x1', transactionHash: txh() })
  const minter = '0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6'
  const d = {
    owner: mon.decodeLog(mk([T.ownershipTransferred, pad(SAFE), pad(EOA)]), 8453),
    started: mon.decodeLog(mk([T.ownershipTransferStarted, pad(SAFE), pad(EOA)]), 8453),
    admin: mon.decodeLog(mk([T.adminChanged], '0x' + word(BigInt(EOA)) + word(BigInt(NEWADMIN))), 8453),
    granted: mon.decodeLog(mk([T.roleGranted, minter, pad(EOA), pad(SAFE)]), 8453),
    revoked: mon.decodeLog(mk([T.roleRevoked, '0x' + '0'.repeat(64), pad(EOA), pad(SAFE)]), 8453),
    upgraded: mon.decodeLog(mk([T.upgraded, pad(IMPL2)]), 8453),
    beacon: mon.decodeLog(mk([T.beaconUpgraded, pad(BEACON)]), 8453),
    paused: mon.decodeLog(mk([T.paused], '0x' + word(BigInt(EOA))), 8453),
    unpaused: mon.decodeLog(mk([T.unpaused], '0x' + word(BigInt(EOA))), 8453),
    added13: mon.decodeLog(mk([T.addedOwner], '0x' + word(BigInt(S4))), 8453),
    added141: mon.decodeLog(mk([T.addedOwner, pad(S4)]), 8453),
    removed: mon.decodeLog(mk([T.removedOwner, pad(S1)]), 8453),
    threshold: mon.decodeLog(mk([T.changedThreshold], '0x' + word(1)), 8453),
    transfer: mon.decodeLog({ ...mk([T.transfer, pad(VAULT), pad(TO)], '0x' + word(600_000_000n)), address: TOKEN }, 8453),
    nft: mon.decodeLog({ ...mk([T.transfer, pad(VAULT), pad(TO), pad(7)]), address: TOKEN }, 8453),
    other: mon.decodeLog(mk(['0x' + 'ab'.repeat(32)]), 8453),
  }
  check('decodes OwnershipTransferred (indexed)', d.owner.kind === 'owner-changed' && d.owner.from === SAFE && d.owner.to === EOA)
  check('decodes OwnershipTransferStarted', d.started.kind === 'owner-transfer-started' && d.started.to === EOA)
  check('decodes AdminChanged (both in data, ERC-1967)', d.admin.kind === 'admin-changed' && d.admin.from === EOA && d.admin.to === NEWADMIN)
  check('decodes RoleGranted with the role named', d.granted.kind === 'role-granted' && d.granted.roleName === 'minter' && d.granted.account === EOA && d.granted.sender === SAFE)
  check('decodes RoleRevoked of the default admin role', d.revoked.kind === 'role-revoked' && d.revoked.roleName === 'main admin')
  check('decodes Upgraded and BeaconUpgraded', d.upgraded.kind === 'upgraded' && d.upgraded.to === IMPL2 && d.beacon.kind === 'beacon-upgraded' && d.beacon.to === BEACON)
  check('decodes Paused / Unpaused (account in data)', d.paused.kind === 'paused' && d.paused.by === EOA && d.unpaused.kind === 'unpaused')
  check('decodes Safe AddedOwner in both Safe versions (data and indexed)', d.added13.account === S4 && d.added141.account === S4 && d.added13.kind === 'safe-owner-added')
  check('decodes Safe RemovedOwner and ChangedThreshold', d.removed.kind === 'safe-owner-removed' && d.removed.account === S1 && d.threshold.kind === 'safe-threshold-changed' && d.threshold.threshold === 1)
  check('decodes an ERC-20 Transfer out of the contract', d.transfer.kind === 'outflow' && d.transfer.token === TOKEN && d.transfer.from === VAULT && d.transfer.raw === '600000000')
  check('ignores NFT transfers and unknown events', d.nft === null && d.other === null)

  /* ------------------------------------------------------------ plain text --- */
  const M = { name: 'Treasury Vault', chainId: 8453, address: VAULT }
  const samples = [
    { ...d.owner },
    { ...d.owner, to: '0x0000000000000000000000000000000000000000' },
    d.started,
    d.admin,
    d.granted,
    d.revoked,
    { ...d.upgraded, prev: IMPL1 },
    d.beacon,
    { kind: 'code-changed', from: IMPL1, to: IMPL3, txHash: null },
    d.paused,
    d.unpaused,
    { ...d.added13, safe: SAFE },
    { ...d.removed, safe: SAFE },
    { ...d.threshold, safe: SAFE, owners: 3, prev: 2 },
    { ...d.transfer, symbol: 'USDC', decimals: 6, pct: 60 },
    { kind: 'native-outflow', raw: (6n * 10n ** 18n).toString(), pct: 60, since: new Date().toISOString(), txHash: null },
  ]
  const texts = samples.map((e) => mon.eventText(e, M))
  check('owner text reads as the spec asks', texts[0].startsWith('⚠️ Owner of Treasury Vault changed from 0x0000…5afe to 0x0000…0e0a · Base · https://basescan.org/tx/0x'), texts[0])
  check('renounced ownership says nobody owns it', /gave up ownership/.test(texts[1]) && /nobody owns it now/.test(texts[1]))
  check('outflow text has the amount, symbol and share', /Large outflow from Treasury Vault: 600 USDC sent to 0x0000…0070 \(60% of what it held\)/.test(texts[14]), texts[14])
  check('native outflow text names the coin and the drop', /balance fell by 6 ETH \(60%\)/.test(texts[15]), texts[15])
  check('Safe threshold text says n of m and what it was', /now needs 1 of 3 signatures to act \(it needed 2\)/.test(texts[13]), texts[13])
  const jargon = texts.filter((x) => JARGON.test(plain(x)) || FULL_HEX.test(plain(x)) || /undefined|null|NaN/.test(x))
  check(`jargon sweep: ${texts.length} alert lines in plain words, short addresses, no "log/slot/proxy/implementation…"`, jargon.length === 0, jargon.join(' | '))
  check('every alert line ends with a link to the explorer', texts.every((x) => / · https:\/\/basescan\.org\/(tx|address)\/0x[0-9a-f]+$/.test(x)))

  /* ---------------------------------------------------------- the API + plan --- */
  const dev = makeClient(BASE)
  const wallet = privateKeyToAccount(generatePrivateKey())
  const me = wallet.address.toLowerCase()
  check('signs in', (await dev.signIn(wallet)).status === 200)
  const admin = (p, body) => fetch(BASE + p, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status)
  const empty = await dev.call('/api/developer/monitors')
  check('GET monitors: none yet, Free covers 1', empty.status === 200 && empty.data.monitors.length === 0 && empty.data.limits.max === 1 && empty.data.limits.plan === 'free')
  check('the chains offered are the RPC-failover chains', empty.data.chains.map((c) => c.key).join() === 'base,ethereum,bnb,arbitrum,optimism,polygon,avalanche')
  check('a plain GET without a session is refused', (await fetch(BASE + '/api/developer/monitors')).status === 401)
  const bad = await dev.post('/api/developer/monitors', { chain: 'base', address: addr(0xdead), webhookUrl: HOOK })
  check('an address with no code is refused in plain words', bad.status === 400 && /no contract at that address on Base/.test(bad.data?.error), bad.data?.error)
  const badPct = await dev.post('/api/developer/monitors', { chain: 'base', address: VAULT, webhookUrl: HOOK, pct: 0 })
  check('an outflow share outside 1–100 is refused', badPct.status === 400)
  const noChan = await dev.post('/api/developer/monitors', { chain: 'base', address: VAULT })
  check('a monitor needs a webhook or Telegram', noChan.status === 400 && /webhook URL, or tick Telegram/.test(noChan.data?.error))
  const c1 = await dev.post('/api/developer/monitors', { chain: 'base', address: VAULT, name: 'Treasury Vault', webhookUrl: HOOK, pct: 10, native: '1' })
  check('watches a contract (201) and shows the secret once', c1.status === 201 && /^whsec_/.test(c1.data?.secret ?? ''), JSON.stringify(c1.data).slice(0, 200))
  const SECRET = c1.data.secret
  const m1 = c1.data.monitor
  check('the starting state is read: Safe 2 of 3, upgradeable', m1.control?.safe?.threshold === 2 && m1.control.safe.owners === 3 && m1.control.implementation === IMPL1)
  const dup = await dev.post('/api/developer/monitors', { chain: 'base', address: VAULT, webhookUrl: HOOK })
  check('the same contract twice is refused', dup.status === 409)
  const over = await dev.post('/api/developer/monitors', { chain: 'base', address: OTHER, webhookUrl: HOOK })
  check('Free plan: a second contract is refused with the plan named', over.status === 403 && over.data?.code === 'plan-limit' && /Free plan watches 1 contract/.test(over.data?.error), over.data?.error)
  check('admin grants Pro', (await admin(`/api/admin/accounts/${me}/plan`, { plan: 'pro', days: 30 })) === 200)
  const c2 = await dev.post('/api/developer/monitors', { chain: 'base', address: OTHER, name: 'Other', webhookUrl: HOOK })
  check('Pro plan: the second contract is accepted', c2.status === 201)
  check('Pro covers 10 (plans.mjs)', (await dev.call('/api/developer/monitors')).data.limits.max === 10)

  /* ------------------------------------------------------------- first pass --- */
  hooks.length = 0
  let r = await mon.tickMonitorsNow()
  check('first pass: the chain cursor starts at the head (no backlog alerts)', r.chains[8453]?.ok === true && r.chains[8453].events === 0 && hooks.length === 0)
  const start = r.chains[8453].cursor

  /* ---------------------------------------------------------- the events --- */
  const minterRole = minter
  L(VAULT, [T.ownershipTransferred, pad(SAFE), pad(EOA)])
  L(VAULT, [T.upgraded, pad(IMPL2)])
  L(VAULT, [T.roleGranted, minterRole, pad(EOA), pad(SAFE)])
  L(VAULT, [T.paused], '0x' + word(BigInt(EOA)))
  L(VAULT, [T.adminChanged], '0x' + word(0n) + word(BigInt(NEWADMIN)))
  L(VAULT, [T.beaconUpgraded, pad(BEACON)])
  L(SAFE, [T.changedThreshold], '0x' + word(1))
  L(SAFE, [T.addedOwner], '0x' + word(BigInt(S4)))
  L(SAFE, [T.removedOwner, pad(S1)])
  // 600 USDC out with 400 left: 60% of what it held (over 10%). Then 1 USDC with 399 left: 0.25% (under).
  L(TOKEN, [T.transfer, pad(VAULT), pad(TO)], '0x' + word(600_000_000n))
  L(TOKEN, [T.transfer, pad(VAULT), pad(TO)], '0x' + word(1_000_000n))
  L(TOKEN, [T.transfer, pad(VAULT), pad(TO), pad(9)]) // an NFT: ignored
  L(THIRD, [T.ownershipTransferred, pad(SAFE), pad(EOA)]) // not watched: ignored
  st.head += 20
  r = await mon.tickMonitorsNow()
  // The chain now reads as those events left it (later state reads must agree, or they would be news).
  st.slots.set(`${VAULT}:${mon.SLOTS.implementation}`, pad(IMPL2))
  st.slots.set(`${VAULT}:${mon.SLOTS.admin}`, pad(NEWADMIN))
  st.slots.set(`${VAULT}:${mon.SLOTS.beacon}`, pad(BEACON))
  st.calls.set(`${VAULT}:${mon.SEL.owner}`, pad(EOA))
  st.calls.set(`${SAFE}:${mon.SEL.getThreshold}`, '0x' + word(1))
  const got = delivered()
  check('one signed delivery for the pass', got.length === 1, String(got.length))
  const kinds = got[0] ? kindsOf(got[0]) : []
  check('every contract event kind arrives', ['owner-changed', 'upgraded', 'role-granted', 'paused', 'admin-changed', 'beacon-upgraded'].every((k) => kinds.includes(k)), kinds.join())
  check('Safe owner and threshold changes arrive', ['safe-threshold-changed', 'safe-owner-added', 'safe-owner-removed'].every((k) => kinds.includes(k)), kinds.join())
  check('the outflow over the threshold arrives, the small one does not', kinds.filter((k) => k === 'outflow').length === 1)
  check('unwatched contracts and NFTs are ignored', got[0]?.body.events.length === 10, String(got[0]?.body.events.length))
  const h0 = got[0]
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(`${h0.headers['x-gully-timestamp']}.${h0.raw}`).digest('hex')
  check('the delivery is HMAC-signed like every Gully alert', h0.headers['x-gully-signature'] === sig)
  check('the payload names the monitor and links its score', h0.body.monitor.address === VAULT && h0.body.monitor.chain === 'Base' && h0.body.monitor.score.endsWith(`/score/base/${VAULT}`))
  check('owner text in the delivery', h0.body.events.some((e) => e.text.startsWith('⚠️ Owner of Treasury Vault changed from 0x0000…5afe to 0x0000…0e0a · Base · https://basescan.org/tx/0x')))
  const deliveredJargon = h0.body.events.map((e) => e.text).filter((x) => JARGON.test(plain(x)) || FULL_HEX.test(plain(x)))
  check('jargon sweep on the delivered texts', deliveredJargon.length === 0, deliveredJargon.join(' | '))
  check('privileged flag set on changes, not on outflows', h0.body.events.every((e) => e.privileged === (e.kind !== 'outflow')))
  const view = (await dev.call('/api/developer/monitors')).data.monitors.find((m) => m.address === VAULT)
  check('the dashboard lists the events and the delivery', view.events.length === 10 && view.deliveries[0]?.ok === true)

  /* --------------------------------------------------------------- dedupe --- */
  hooks.length = 0
  await mon.tickMonitorsNow()
  check('a pass with nothing new sends nothing', hooks.length === 0)
  const file = path.join(tmp, 'sec-monitor.json')
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  check('state is on disk: cursor, monitors and sent keys', saved.chains[8453].cursor >= start + 15 && saved.monitors.length === 2 && Object.keys(saved.sent).length >= 10)
  saved.chains[8453].cursor = start // rewind: the same blocks are read again
  fs.writeFileSync(file, JSON.stringify(saved))
  mon.reloadMonitorsForTest()
  await mon.tickMonitorsNow()
  check('never twice: re-reading the same blocks after a rewind sends nothing', hooks.length === 0)

  /* ------------------------------------------------------- restart resume --- */
  mon.reloadMonitorsForTest() // as a restart: memory dropped, the file read again
  L(VAULT, [T.unpaused], '0x' + word(BigInt(EOA)))
  st.head += 10 // past the reorg margin (5 blocks on Base)
  await mon.tickMonitorsNow()
  check('after a restart it resumes from the cursor: only the new event is sent', delivered().length === 1 && kindsOf(delivered()[0]).join() === 'unpaused', delivered().map((h) => h.body.events.map((e) => e.text).join(' / ')).join(' | '))

  /* -------------------------------------------------------- range halving --- */
  hooks.length = 0
  st.maxRange = 50
  const before = JSON.parse(fs.readFileSync(file, 'utf8')).chains[8453].cursor
  L(VAULT, [T.paused], '0x' + word(BigInt(EOA)), st.head + 40)
  st.head += 400
  r = await mon.tickMonitorsNow()
  const after = r.chains[8453].cursor
  check('a node that refuses wide ranges: the range halves and the pass still advances', r.chains[8453].ok && after > before && after - before <= 4 * 250, `${before} -> ${after}`)
  for (let i = 0; i < 12 && (await mon.tickMonitorsNow()).chains[8453].cursor < st.head - 5; i++);
  check('it catches up over a few passes and reports what it found', delivered().some((h) => kindsOf(h).includes('paused')))
  st.maxRange = Infinity

  /* ------------------------------------------------------------- back-off --- */
  st.fail = true
  r = await mon.tickMonitorsNow()
  check('a failing chain is reported, not thrown', r.chains[8453].ok === false)
  st.fail = false
  r = await mon.tickMonitorsNow()
  check('then it backs off for a while instead of hammering the node', r.chains[8453].skipped === true)
  const failedView = (await dev.call('/api/developer/monitors')).data.monitors[0]
  check('the dashboard says the chain could not be read, in plain words', /Could not read Base just now; retrying\./.test(failedView.lastError ?? ''), failedView.lastError)
  mon.resetBackoffForTest()

  /* ------------------------------------------------------------ native coin --- */
  hooks.length = 0
  st.balances.set(VAULT, 4n * 10n ** 18n) // 10 -> 4: 60%
  for (let i = 0; i < mon.NATIVE_EVERY + 1; i++) await mon.tickMonitorsNow()
  const nat = delivered().flatMap((h) => h.body.events).filter((e) => e.kind === 'native-outflow')
  check('a native balance drop over the % is sent once', nat.length === 1 && /balance fell by 6 ETH \(60%\)/.test(nat[0].text), nat.map((e) => e.text).join(' | '))
  hooks.length = 0
  st.balances.set(VAULT, 39n * 10n ** 17n) // 4 -> 3.9: 2.5%, under 10% and under the 1 ETH amount
  for (let i = 0; i < mon.NATIVE_EVERY + 1; i++) await mon.tickMonitorsNow()
  check('a small drop under both thresholds is not', delivered().length === 0)

  /* ------------------------------------------------- silent change by reading --- */
  st.slots.set(`${VAULT}:${mon.SLOTS.implementation}`, pad(IMPL3))
  for (let i = 0; i < mon.STATE_EVERY + 1; i++) await mon.tickMonitorsNow()
  const code = delivered().flatMap((h) => h.body.events).filter((e) => e.kind === 'code-changed')
  check('a code change with no event is found by reading the contract, once', code.length === 1 && /without an upgrade notice/.test(code[0].text), delivered().map(kindsOf).join(' | '))
  hooks.length = 0
  for (let i = 0; i < mon.STATE_EVERY + 1; i++) await mon.tickMonitorsNow()
  check('and not again on the next reads', delivered().length === 0)

  /* ------------------------------------------------------- plan coverage --- */
  check('admin moves the account back to Free', (await admin(`/api/admin/accounts/${me}/plan`, { plan: 'free' })) === 200)
  const v2 = (await dev.call('/api/developer/monitors')).data
  check('over the plan: the oldest monitor stays covered, the newer one is marked', v2.monitors.find((m) => m.address === VAULT).coveredByPlan === true && v2.monitors.find((m) => m.address === OTHER).coveredByPlan === false)
  st.log.length = 0
  st.head += 2
  await mon.tickMonitorsNow()
  const asked = st.log.filter((x) => x.method === 'eth_getLogs' && x.params[0].address).flatMap((x) => x.params[0].address)
  check('only covered monitors are read', asked.includes(VAULT) && !asked.includes(OTHER), asked.join())

  /* ------------------------------------------------------ actions + test --- */
  hooks.length = 0
  const tst = await dev.post(`/api/developer/monitors/${m1.id}/test`)
  check('a test delivery goes out signed and typed monitor.test', tst.status === 200 && hooks.length === 1 && hooks[0].body.type === 'monitor.test' && hooks[0].body.events.length === 0)
  const p = await dev.post(`/api/developer/monitors/${m1.id}/pause`)
  check('pause', p.status === 200 && p.data.monitor.enabled === false)
  check('resume', (await dev.post(`/api/developer/monitors/${m1.id}/resume`)).data.monitor.enabled === true)
  const rot = await dev.post(`/api/developer/monitors/${m1.id}/rotate`)
  check('a new webhook secret', rot.status === 200 && /^whsec_/.test(rot.data.secret) && rot.data.secret !== SECRET)
  const stranger = makeClient(BASE)
  await stranger.signIn(privateKeyToAccount(generatePrivateKey()))
  check("another workspace cannot touch this workspace's monitor", (await stranger.post(`/api/developer/monitors/${m1.id}/delete`)).status === 404)
  check('delete', (await dev.post(`/api/developer/monitors/${c2.data.monitor.id}/delete`)).status === 200 && (await dev.call('/api/developer/monitors')).data.monitors.length === 1)

  /* -------------------------------------------------------------- load + loop --- */
  const load = mon.monitorLoad()
  check('RPC load: 3 calls a minute per chain, about 1 per contract', load.perChainPerMin === 3 && load.perContractPerMin === 1 && load.loopSeconds === 60, JSON.stringify(load))
  const src = fs.readFileSync(new URL('../server/server.mjs', import.meta.url), 'utf8')
  const loops = src.slice(src.indexOf('function startLoops()'), src.indexOf('function startLoops()') + 2000)
  check('the loop starts only from startLoops() (never in standby)', /startSecMonitor\(\)/.test(loops) && src.split('startSecMonitor()').length === 2)
  check('the score page links work from the facts the monitor keeps', mon.monitorFacts(8453, VAULT)?.events.some((e) => e.privileged) === true)
} catch (e) {
  check(`unexpected error: ${e?.stack ?? e}`, false)
} finally {
  receiver.close()
  console.log(`\n${t.passed} passed, ${t.failed} failed`)
  process.exit(t.failed ? 1 : 0)
}
