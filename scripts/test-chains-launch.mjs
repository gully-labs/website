// Test of the chain launch flow's server side (server/chains-launch.mjs): input validation, that no key material is
// accepted or stored, workspace auth and roles, and that the testnet-only parent chain is enforced on the server.
//
//   node scripts/test-chains-launch.mjs     (no build needed; TEST_PORT overrides the port, default 9181)
//
// The real server runs IN THIS PROCESS with a fresh temporary DATA_DIR; chainlist is switched off (CHAINLIST_URL=off)
// except for one check that serves a tiny chainlist from a local stub. Throwaway wallets sign in with SIWE.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { guardTestRun, makeChecker, makeClient } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 9181
await guardTestRun(PORT)
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-chains-launch-'))

Object.assign(process.env, { PORT: String(PORT), DATA_DIR: tmp, TRACKER_DATA: path.join(tmp, 'tracker-history.json'), DIST_DIR: path.join(tmp, 'no-dist'), ADMIN_TOKEN: crypto.randomBytes(24).toString('hex'), TRACKER_LOOP: 'off', DEEPCORE_LOOP: 'off', TRACKER_SKIP_APIS: '1', ASK_REMOTE: 'off', CHAINLIST_URL: 'off' })
delete process.env.TELEGRAM_BOT_TOKEN
await import('../server/server.mjs')
const mod = await import('../server/chains-launch.mjs')
const ws = await import('../server/workspaces.mjs')
await new Promise((r) => setTimeout(r, 300))

const t = makeChecker()
const { check } = t
const wallet = () => privateKeyToAccount(generatePrivateKey())
const W = { owner: wallet(), dev: wallet(), viewer: wallet(), other: wallet() }
const A = Object.fromEntries(Object.entries(W).map(([k, w]) => [k, w.address.toLowerCase()]))
const C = Object.fromEntries(Object.keys(W).map((k) => [k, makeClient(BASE)]))
for (const k of Object.keys(W)) {
  const r = await C[k].signIn(W[k])
  if (r.status !== 200) throw new Error(`sign-in failed for ${k}: ${r.status}`)
}
const { owner: O, dev: D, viewer: V, other: X } = C
const hex = (n) => '0x' + crypto.randomBytes(n).toString('hex')
const good = (n = 1) => ({ name: `Test Chain ${n}`, chainId: 7_000_000 + n, type: 'rollup', parentChainId: 421614, owner: A.owner, validators: [hex(20)], batchPosters: [hex(20)], gasToken: 'ETH', txHash: hex(32) })
const core = () => ({ rollup: hex(20), inbox: hex(20), outbox: hex(20), bridge: hex(20), sequencerInbox: hex(20), upgradeExecutor: hex(20), nativeToken: '0x0000000000000000000000000000000000000000', deployedAtBlockNumber: 123 })
const URL_ = '/api/developer/chains-launch'
const stored = () => fs.readFileSync(path.join(tmp, 'chains-launch.json'), 'utf8')

try {
  /* ---- auth ---- */
  check('signed out: GET is 401', (await O.call(URL_, { useCookie: false })).status === 401)
  check('signed out: POST is 401 or refused', [401, 403].includes((await O.call(URL_, { method: 'POST', body: good(), useCookie: false, headers: { 'x-requested-with': 'gully' } })).status))
  check('POST without the CSRF header is refused', (await O.call(URL_, { method: 'POST', body: good() })).status === 403)
  check('POST with a foreign Origin is refused', (await O.post(URL_, good(), { headers: { origin: 'https://evil.example' } })).status === 403)
  const empty = await O.call(URL_)
  check('GET answers the parent chain, the types and an empty list', empty.status === 200 && empty.data?.parent?.id === 421614 && empty.data.chains.length === 0 && empty.data.types.join() === 'rollup,anytrust')

  /* ---- a good record ---- */
  const g1 = good(1)
  const ok = await O.post(URL_, g1)
  check('a valid chain is recorded (201)', ok.status === 201 && ok.data?.chain?.chainId === g1.chainId && ok.data.chain.status === 'submitted' && ok.data.chain.id.startsWith('cl_'), JSON.stringify(ok.data))
  check('it lists back, addresses lower-cased', (await O.call(URL_)).data.chains[0].owner === g1.owner && (await O.call(URL_)).data.chains[0].validators[0] === g1.validators[0].toLowerCase())
  const dep = await O.post(URL_, { ...g1, status: 'deployed', coreContracts: core() })
  check('the same transaction moves to deployed with its core addresses (200, still one chain)', dep.status === 200 && dep.data.chain.status === 'deployed' && dep.data.chain.coreContracts.rollup && dep.data.chains.length === 1, JSON.stringify(dep.data))
  const back = await O.post(URL_, g1)
  check('a later "submitted" for a deployed chain does not downgrade it', back.status === 200 && back.data.chain.status === 'deployed')
  check('the activity log has the launch', (await O.call('/api/developer/activity')).data.events.some((e) => e.action === 'chain.launched'))

  /* ---- testnet only, enforced here ---- */
  for (const bad of [1, 42161, 421613, 8453, 0, '421614', null, undefined]) {
    const r = await O.post(URL_, { ...good(2), parentChainId: bad })
    check(`parent chain ${JSON.stringify(bad)} is refused (400, testnet only)`, r.status === 400 && /testnet only/i.test(r.data?.error ?? ''), JSON.stringify(r.data))
  }
  check('a custom gas token is refused for now', (await O.post(URL_, { ...good(3), gasToken: 'USDC' })).status === 400)
  check('an unknown chain type is refused', (await O.post(URL_, { ...good(3), type: 'validium' })).status === 400)
  const anytrust = await O.post(URL_, { ...good(4), type: 'anytrust' })
  check('an AnyTrust chain is accepted', anytrust.status === 201 && anytrust.data.chain.type === 'anytrust')

  /* ---- input validation ---- */
  const refused = async (label, patch) => check(`refused: ${label}`, (await O.post(URL_, { ...good(5), ...patch })).status === 400)
  await refused('a 2-character name', { name: 'ab' })
  await refused('a name with markup', { name: '<script>alert(1)</script>' })
  await refused('a 41-character name', { name: 'x'.repeat(41) })
  await refused('a fractional chain id', { chainId: 12.5 })
  await refused('a zero chain id', { chainId: 0 })
  await refused('a negative chain id', { chainId: -4 })
  await refused('a string chain id', { chainId: '412346' })
  await refused('an unsafe-integer chain id', { chainId: 2 ** 60 })
  await refused('a bad owner address', { owner: '0x123' })
  await refused('no validators', { validators: [] })
  await refused('a validator that is not an address', { validators: ['hello'] })
  await refused('the zero address as a batch poster', { batchPosters: ['0x0000000000000000000000000000000000000000'] })
  await refused('9 validators', { validators: Array.from({ length: 9 }, () => hex(20)) })
  await refused('a short tx hash', { txHash: '0x1234' })
  await refused('a rollup address that is not an address', { status: 'deployed', coreContracts: { ...core(), rollup: 'nope' } })
  await refused('a deployed chain without addresses', { status: 'deployed' })
  check('a body that is not an object is refused', (await O.post(URL_, [1, 2])).status === 400)
  const extra = await O.post(URL_, { ...good(6), evil: '<img src=x onerror=1>', coreContracts: { ...core(), junk: hex(20) }, status: 'deployed' })
  check('extra fields do not reach the stored row', extra.status === 201 && !stored().includes('onerror') && !stored().includes('junk'))

  /* ---- no key material ---- */
  const key = hex(32)
  const keyless = key.slice(2)
  for (const [label, patch] of [
    ['a privateKey field', { privateKey: key }],
    ['a nested batchPosterPrivateKey', { config: { batchPosterPrivateKey: key } }],
    ['a mnemonic field', { mnemonic: 'test test test test test test test test test test test junk' }],
    ['a seed field', { seed: 'abc' }],
    ['a secret field', { secret: 'abc' }],
    ['a raw key as a validator', { validators: [key] }],
    ['a raw key (no 0x) as the owner', { owner: keyless }],
    ['a raw key inside coreContracts', { status: 'deployed', coreContracts: { ...core(), upgradeExecutor: keyless } }],
    ['a raw key in an array', { notes: [keyless] }],
  ]) {
    const r = await O.post(URL_, { ...good(7), ...patch })
    check(`key material refused: ${label}`, r.status === 400 && /key|never|looks like/i.test(r.data?.error ?? ''), JSON.stringify(r.data))
  }
  await O.post(URL_, { ...good(8), privateKey: key })
  check('the refused key is nowhere on disk', !fs.readdirSync(tmp).some((f) => fs.statSync(path.join(tmp, f)).isFile() && fs.readFileSync(path.join(tmp, f), 'utf8').includes(keyless)))
  check('keyMaterialIn: a tx hash in txHash is fine, anywhere else it is not', mod.keyMaterialIn({ txHash: hex(32) }) === null && mod.keyMaterialIn({ x: hex(32) }) !== null)
  check('no private-key field is stored', !/priv/i.test(stored()))

  /* ---- chain id uniqueness ---- */
  const dup = await O.post(URL_, { ...good(9), chainId: g1.chainId })
  check('a chain id another launch already uses is refused (409)', dup.status === 409, JSON.stringify(dup.data))
  const dupOther = await X.post(URL_, { ...good(9), chainId: g1.chainId, owner: A.other })
  check('...also from another workspace (409)', dupOther.status === 409)
  const c1 = await O.call(`${URL_}/check?chainId=${g1.chainId}`)
  check('check: a used id is not free', c1.status === 200 && c1.data.free === false && /already uses/.test(c1.data.reason))
  check('check: an unused id is free', (await O.call(`${URL_}/check?chainId=8123456`)).data.free === true)
  check('check: a junk id is not free and not an error', (await O.call(`${URL_}/check?chainId=abc`)).data.free === false && (await O.call(`${URL_}/check?chainId=-1`)).data.free === false)
  check('check without a session is 401', (await O.call(`${URL_}/check?chainId=1`, { useCookie: false })).status === 401)

  /* ---- workspaces and roles ---- */
  check("another wallet sees none of the owner's chains", (await X.call(URL_)).data.chains.length === 0)
  const mine = await X.post(URL_, { ...good(10), owner: A.other })
  check('another wallet records its own chain in its own workspace', mine.status === 201 && mine.data.chains.length === 1 && (await O.call(URL_)).data.chains.every((c) => c.id !== mine.data.chain.id))
  check("removing another workspace's chain is a 404", (await X.post(`${URL_}/remove`, { id: (await O.call(URL_)).data.chains[0].id })).status === 404)
  const join = async (role, who) => {
    const i = await O.post('/api/developer/team/invite', { role })
    const token = String(i.data.link).split('#invite=')[1]
    await who.post('/api/developer/invite/accept', { token })
    await who.post('/api/developer/workspace/switch', { id: A.owner })
  }
  await join('viewer', V)
  await join('developer', D)
  const vget = await V.call(URL_)
  check("a viewer of the owner's workspace can read the list", vget.status === 200 && vget.data.chains.length >= 3, JSON.stringify(vget.data).slice(0, 200))
  const vpost = await V.post(URL_, good(11))
  check('a viewer cannot record a chain (403 forbidden-role)', vpost.status === 403 && vpost.data?.code === 'forbidden-role')
  check('a viewer cannot remove one', (await V.post(`${URL_}/remove`, { id: vget.data.chains[0].id })).status === 403)
  const dpost = await D.post(URL_, good(12))
  check('a developer can record a chain in the shared workspace', dpost.status === 201 && dpost.data.chain.by === A.dev, JSON.stringify(dpost.data).slice(0, 200))
  check('canWrite: viewer no, developer yes, billing no', ws.canWrite('viewer', URL_) === false && ws.canWrite('developer', URL_) === true && ws.canWrite('billing', URL_) === false)

  /* ---- limits and removal ---- */
  const n0 = (await O.call(URL_)).data.chains.length
  const rm = await O.post(`${URL_}/remove`, { id: dpost.data.chain.id })
  check('the owner removes a chain', rm.status === 200 && rm.data.chains.length === n0 - 1)
  check('removing an unknown id is a 404', (await O.post(`${URL_}/remove`, { id: 'cl_nope' })).status === 404)
  let n = (await O.call(URL_)).data.chains.length
  let last = null
  for (let i = 0; n < mod.MAX_PER_WORKSPACE; i++, n++) last = await O.post(URL_, good(100 + i))
  check('the list fills to the cap', last?.status === 201 && (await O.call(URL_)).data.chains.length === mod.MAX_PER_WORKSPACE)
  check('past the cap is refused (409)', (await O.post(URL_, good(200))).status === 409)

  /* ---- chainlist (local stub) ---- */
  const stub = http.createServer((q, r) => r.end(JSON.stringify([...Array.from({ length: 150 }, (_, i) => ({ name: `Chain ${i + 1}`, chainId: i + 1 })), { name: 'Listed Chain', chainId: 9_999_001 }])))
  await new Promise((r) => stub.listen(0, '127.0.0.1', r))
  process.env.CHAINLIST_URL = `http://127.0.0.1:${stub.address().port}/chains.json`
  const l1 = await X.call(`${URL_}/check?chainId=9999001`)
  check('chainlist: a listed id is not free, naming the chain', l1.data.free === false && /Listed Chain/.test(l1.data.reason), JSON.stringify(l1.data))
  check('chainlist: an unlisted id is free and the list was checked', (await X.call(`${URL_}/check?chainId=9999002`)).data.checkedChainlist === true)
  const lp = await X.post(URL_, { ...good(13), chainId: 9_999_001, owner: A.other })
  check('chainlist: recording a listed id is refused (409)', lp.status === 409)
  stub.close()
} catch (e) {
  t.failed++
  console.error('FAIL  test crashed:', e)
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(t.failed ? 1 : 0)
