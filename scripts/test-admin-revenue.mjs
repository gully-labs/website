// The admin revenue page's API: server/revenue.mjs behind the admin guard.
//
//   npm run test:admin-revenue        (no build needed)
//
// The real server runs in this process with a temporary DATA_DIR. gullyid.xyz, the indexers, the Gully ID revenue API and
// the Gully Chain RPC are mock HTTP servers here. Covers: who is refused (no sign-in, a wrong token, an account not on
// the allowlist, the cookie without its CSRF token), read-only, testnet never in the money total, every line present
// with an honest status, a missing source says what it needs, a failed source is an error and not 0, a mainnet indexer
// that is really testnet is refused, the cache, and that no key reaches the browser.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { guardTestRun, hostRequest, makeChecker } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8799
const BASE = `http://localhost:${PORT}`
await guardTestRun(PORT)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-admin-revenue-'))
const dist = path.join(tmp, 'dist')
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><title>Gully Labs</title></head><body><div id="root"></div></body></html>')

const listen = (handler) =>
  new Promise((done) => {
    const s = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const send = (status, o) => {
          res.writeHead(status, { 'content-type': 'application/json' })
          res.end(JSON.stringify(o))
        }
        handler(req, new URL(req.url, 'http://x'), body, send)
      })
    })
    s.listen(0, '127.0.0.1', () => done(s))
  })

const NOW = Math.floor(Date.now() / 1000)
const HOUR = 3600
const DAY = 86_400
const USDCE = '0x65ba03c6fa90ed549f465d4c8f2e784d6eeb7e76'

// ---- mock indexer. `tables` by GraphQL name; `broken` tables answer 500, `headChain` is what /head claims.
const ETH_USD = 2000
const testTables = {
  feeEvents: [
    { timestamp: String(NOW - HOUR), kind: 'guard-fee', currency: '0x0000000000000000000000000000000000000000', protocolShare: '500000000000000', protocolUsd: 1 },
    { timestamp: String(NOW - 3 * DAY), kind: 'tax', currency: '0x0000000000000000000000000000000000000000', protocolShare: '250000000000000', protocolUsd: 0.5 },
    { timestamp: String(NOW - 40 * DAY), kind: 'guard-fee', currency: '0x0000000000000000000000000000000000000000', protocolShare: '1000000000000000', protocolUsd: 2 },
    { timestamp: String(NOW - HOUR), kind: 'guard-fee', currency: '0x0000000000000000000000000000000000000abc', protocolShare: '7', protocolUsd: null },
  ],
  poolSwaps: [{ timestamp: String(NOW - HOUR), protocolFeesUsd: 0.25 }],
  tokens: [
    { createdAt: String(NOW - HOUR), launchFeeWei: '1000000000000000' },
    { createdAt: String(NOW - HOUR), launchFeeWei: '0' },
  ],
  bridgeFees: [{ timestamp: String(NOW - HOUR), category: 'protocol', revenueWei: '100000000000000', revenueUsd: 0.2 }],
  routerSwaps: [
    { timestamp: String(NOW - HOUR), fee: '500000000000000', tokenIn: '0x26acccb2e98ca9e067e58668aa3b101bef432754' },
    { timestamp: String(NOW - HOUR), fee: '12345', tokenIn: '0x8386a49a61060cc3f21415bde2e78b2ecac209dc' },
  ],
  questFundings: [{ timestamp: String(NOW - HOUR), fee: '250000', asset: USDCE }],
  passSubscriptions: [{ timestamp: String(NOW - HOUR), fee: '500000' }],
  rentals: [{ timestamp: String(NOW - HOUR), fee: '100000' }],
}
const makeIndexer = (state) =>
  listen((req, u, body, send) => {
    state.calls++
    if (u.pathname === '/head') return send(200, { chainId: state.headChain, block: 10, timestamp: NOW })
    if (u.pathname === '/stats/analytics') return send(200, { ethUsd: ETH_USD })
    if (u.pathname === '/stats/fees') return send(200, { config: { protocolFee: { beneficiary: `0x${'4'.repeat(40)}` } }, categories: { delivery: { enabled: false } } })
    if (u.pathname === '/stats/flywheel') return send(200, { contracts: { safe: `0x${'5'.repeat(40)}`, flywheel: `0x${'6'.repeat(40)}` } })
    if (u.pathname === '/graphql') {
      const name = /^\{(\w+)\(/.exec(JSON.parse(body).query)?.[1]
      if (state.broken.has(name)) return send(500, { error: 'boom' })
      return send(200, { data: { [name]: { items: state.tables[name] ?? [], pageInfo: { hasNextPage: false, endCursor: null } } } })
    }
    send(404, { error: 'not found' })
  })
const test = { calls: 0, headChain: 485590, tables: testTables, broken: new Set() }
const mainIdx = { calls: 0, headChain: 485590, tables: {}, broken: new Set() }
const indexer = await makeIndexer(test)
const mainIndexer = await makeIndexer(mainIdx)

// ---- mock Gully Chain RPC: 12 blocks, each 21,000 gas at 0.1 gwei; one log of each kind.
const pad = (v) => BigInt(v).toString(16).padStart(64, '0')
const topicOf = async () => (await import('../server/revenue.mjs')).TOPICS
const logs = async () => {
  const T = await topicOf()
  const zero = `0x${'0'.repeat(64)}`
  return [
    { blockNumber: '0x3', address: '0x400c73ec3e40dd84a6bf3be8ecd5984a26bf1e9b', topics: [T.tipped, zero, zero, `0x${USDCE.slice(2).padStart(64, '0')}`], data: `0x${pad(2_000_000)}${pad(100_000)}${pad(0)}` },
    { blockNumber: '0x4', address: '0x2c6f37394763d0fa07292d96804cb44067a54a94', topics: [T.nameV11, zero, zero, zero], data: `0x${pad(1_000_000)}${pad(64)}${pad(0)}` },
    { blockNumber: '0x5', address: '0x1f9092ef9cbd36f1d13a10b2f2eb0696b869dfc2', topics: [T.subscribed, zero, zero, zero], data: `0x${pad(0)}${pad(1)}${pad(0)}${pad(10_000_000)}${pad(500_000)}${pad(9_500_000)}${pad(0)}` },
    { blockNumber: '0x6', address: '0x91281c011373350c0b5a6075078e56ca958bb448', topics: [T.minted, zero, zero, zero], data: `0x${pad(1)}${pad(BigInt(USDCE))}${pad(4_000_000)}${pad(200_000)}${pad(3_800_000)}${pad(0)}` },
  ]
}
const rpcState = { fail: false, logCalls: 0 }
const rpcServer = await listen(async (req, u, body, send) => {
  const { id, method } = JSON.parse(body)
  const ok = (result) => send(200, { jsonrpc: '2.0', id, result })
  if (rpcState.fail && method !== 'eth_chainId') return send(200, { jsonrpc: '2.0', id, error: { code: -32000, message: 'down' } })
  if (method === 'eth_chainId') return ok('0x' + (485590).toString(16))
  if (method === 'eth_blockNumber') return ok('0xb')
  if (method === 'eth_getBlockByNumber') return ok({ timestamp: '0x' + (NOW - HOUR).toString(16), gasUsed: '0x5208', baseFeePerGas: '0x5f5e100' })
  if (method === 'eth_getLogs') {
    rpcState.logCalls++
    return ok(await logs())
  }
  if (method === 'eth_getBalance') return ok('0xde0b6b3a7640000')
  if (method === 'eth_call') return ok(`0x${pad(BigInt('0x92cfc047652d6aef7eb0fa2744b912d9f627fa41'))}`)
  send(200, { jsonrpc: '2.0', id, error: { code: -32601, message: 'no' } })
})

// ---- mock gullyid.xyz (sign-in + the revenue API)
const codes = new Map()
const tokens = new Map()
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const ID_TOKEN = `gid-read-${crypto.randomBytes(16).toString('hex')}`
const idState = { revenue: 0, fail: false }
const idServer = await listen((req, u, body, send) => {
  if (u.pathname === '/oauth2/token' && req.method === 'POST') {
    const f = new URLSearchParams(body)
    const c = codes.get(f.get('code'))
    codes.delete(f.get('code'))
    if (!c) return send(400, { error: 'invalid_grant' })
    const at = crypto.randomBytes(16).toString('hex')
    tokens.set(at, c)
    return send(200, { access_token: at, token_type: 'bearer', id_token: `${b64u({ alg: 'RS256' })}.${b64u({ iss: `${ISSUER}/`, aud: [c.client], sub: c.sub, nonce: c.nonce, exp: NOW + 3600 })}.sig` })
  }
  if (u.pathname === '/v1/profile') {
    const t = tokens.get(String(req.headers.authorization ?? '').replace(/^Bearer /, ''))
    return t ? send(200, { sub: t.sub, name: 'x', client: t.client }) : send(401, { error: 'unauthorized' })
  }
  if (u.pathname === '/v1/admin/revenue') {
    idState.revenue++
    if (idState.fail || req.headers.authorization !== `Bearer ${ID_TOKEN}`) return send(401, { error: 'no' })
    const day = new Date((NOW - DAY) * 1000).toISOString().slice(0, 10)
    return send(200, { streams: [{ id: 'developer_plans', available: true, totalUsd: 58 }, { id: 'names', available: true, totalUsd: 999 }], dailyIdentityUsd: [], dailyDeveloperUsd: [{ day, usd: 29 }] })
  }
  send(404, { error: 'not found' })
})
const ISSUER = `http://127.0.0.1:${idServer.address().port}`
const OWNER = 'e3ed3aae-owner-sub'
const ADMIN = crypto.randomBytes(24).toString('hex')

Object.assign(process.env, {
  PORT: String(PORT), DATA_DIR: tmp, TRACKER_DATA: path.join(tmp, 'tracker-history.json'), DIST_DIR: dist,
  ADMIN_TOKEN: ADMIN, TRACKER_LOOP: 'off', TRACKER_SKIP_APIS: '1', DEEPCORE_LOOP: 'off', ASK_REMOTE: 'off',
  IPFS_API: 'http://127.0.0.1:9', IPFS_GATEWAY: 'http://127.0.0.1:9', GULLYPAY_STATUS_URL: 'http://127.0.0.1:9', GULLYRPC_STATUS_URL: 'http://127.0.0.1:9',
  GULLY_ID_ISSUER: ISSUER, ADMIN_GULLY_SUBS: OWNER, ADMIN_PASSWORD_LOGIN: 'on',
  GULLY_INDEXER: `http://127.0.0.1:${indexer.address().port}`, GULLY_ID_URL: ISSUER, GULLY_RPC_485590: `http://127.0.0.1:${rpcServer.address().port}`,
})
for (const k of ['TELEGRAM_BOT_TOKEN', 'GULLY_TREASURY_ADDRESS', 'ANTHROPIC_API_KEY', 'ADMIN_GULLY_ID', 'ADMIN_GULLY_ID_CLIENT_ID', 'GULLY_ID_ADMIN_TOKEN', 'REVENUE_MAINNET_INDEXER', 'GULLY_ID_REVENUE_NETWORK']) delete process.env[k]

await import('../server/server.mjs')
const auth = await import('../server/admin-auth.mjs')
const rev = await import('../server/revenue.mjs')
auth.configureAdminAuth()
await new Promise((r) => setTimeout(r, 300))

const t = makeChecker()
const { check } = t
const A = 'admin.gullylabs.xyz'
const get = (p, opts) => hostRequest(BASE, A, p, opts)
const cookies = (r) => [r.headers['set-cookie'] ?? []].flat()
const sessionCookie = (r) => cookies(r).find((c) => c.startsWith('__Host-gl_admin=') && !/Max-Age=0/.test(c))
async function signIn(sub) {
  const s = await get('/auth/gully/start')
  const q = new URL(s.headers.location).searchParams
  const tx = cookies(s).find((c) => c.startsWith('gid_admin_tx='))
  const code = crypto.randomBytes(8).toString('hex')
  codes.set(code, { sub, client: 'gully-labs', nonce: q.get('nonce') })
  return get(`/auth/gully/callback?code=${code}&state=${encodeURIComponent(q.get('state'))}`, { headers: { cookie: tx.split(';')[0] } })
}
const api = (p = '/api/admin/revenue?range=all', extra = {}) => get(p, { ...extra, headers: { authorization: `Bearer ${ADMIN}`, ...(extra.headers ?? {}) } })
const line = (v, id) => v.lines.find((l) => l.id === id)
const near = (a, b) => Math.abs(a - b) < 1e-6
const fresh = () => {
  rev.resetRevenueCache()
  rev.resetRevenueScan()
}

try {
  // ---- who gets in
  {
    const r = await get('/api/admin/revenue')
    check('no sign-in: 401, no figures', r.status === 401 && !('lines' in (r.data ?? {})), String(r.status))
    const w = await get('/api/admin/revenue', { headers: { authorization: 'Bearer wrong-token-wrong-token-wrong' } })
    check('a wrong token: 401', w.status === 401, String(w.status))
    const before = test.calls
    const stranger = await signIn('stranger-sub-9')
    check('an account not on the allowlist: 403 at sign-in and no session', stranger.status === 403 && !sessionCookie(stranger) && stranger.text.includes('Not on the admin list'), String(stranger.status))
    const after = await get('/api/admin/revenue', { headers: { cookie: cookies(stranger).map((c) => c.split(';')[0]).join('; ') } })
    check('that account still cannot read revenue', after.status === 401, String(after.status))
    check('a refused call reaches no source', test.calls === before, `${before} -> ${test.calls}`)

    const ok = await signIn(OWNER)
    const cookie = sessionCookie(ok).split(';')[0]
    check('the allowlisted account signs in', ok.status === 302, String(ok.status))
    const noCsrf = await get('/api/admin/revenue', { headers: { cookie } })
    check('the cookie alone is refused (no CSRF token)', noCsrf.status === 403 || noCsrf.status === 401, String(noCsrf.status))
    const s = await get('/api/admin/auth/session', { headers: { cookie } })
    const yes = await get('/api/admin/revenue?range=7d', { headers: { cookie, authorization: `Bearer ${s.data.csrf}` } })
    check('the allowlisted session reads revenue', yes.status === 200 && Array.isArray(yes.data.lines), String(yes.status))
    check('the answer is never cached by a browser or edge', /no-store/.test(yes.headers['cache-control'] ?? ''), yes.headers['cache-control'])
  }

  // ---- read-only and input
  {
    const p = await get('/api/admin/revenue', { method: 'POST', body: {}, headers: { authorization: `Bearer ${ADMIN}` } })
    check('POST is refused', p.status === 405, String(p.status))
    const b = await api('/api/admin/revenue?range=forever')
    check('an unknown range is refused', b.status === 400, String(b.status))
  }

  // ---- figures
  fresh()
  const all = (await api()).data
  {
    const ids = all.lines.map((l) => l.id)
    const asked = ['kre8_trade', 'core_builder', 'launch_fees', 'names', 'ads', 'tips_members', 'hyperlane', 'integrator', 'gully_id', 'gully_rpc', 'gully_pay', 'chain_gas', 'multisig']
    check('every income line the owner listed has a row', asked.every((a) => ids.includes(a)), ids.join())
    check('kre8 trade fee: the protocol share only, all time', near(line(all, 'kre8_trade').testnet.usd, 3.5), String(line(all, 'kre8_trade').testnet.usd))
    check('a fee in a coin with no price is counted, not valued', line(all, 'kre8_trade').testnet.unpriced === 1, String(line(all, 'kre8_trade').testnet.unpriced))
    check('launch fee: wei at the ETH price, free launches skipped', near(line(all, 'launch_fees').testnet.usd, 2) && line(all, 'launch_fees').testnet.count === 1, JSON.stringify(line(all, 'launch_fees').testnet.usd))
    check('swap router: WETH valued, the other coin only counted', near(line(all, 'swap_router').testnet.usd, 1) && line(all, 'swap_router').testnet.unpriced === 1)
    check('quest fee: USDC.e at $1', near(line(all, 'quests').testnet.usd, 0.25))
    check('.gully name: fee from the log', near(line(all, 'names').testnet.usd, 1))
    const tm = line(all, 'tips_members').testnet
    check('tips and memberships: tip, membership, edition, Pass and rental fees add up', near(tm.usd, 0.1 + 0.5 + 0.2 + 0.5 + 0.1), String(tm.usd))
    check('the five parts are named', tm.parts?.length === 5 && near(tm.parts[0].usd, 0.1))
    check('chain gas: 12 blocks of 21,000 gas at 0.1 gwei', near(line(all, 'chain_gas').testnet.usd, 12 * 21_000 * 1e8 / 1e18 * ETH_USD), String(line(all, 'chain_gas').testnet.usd))
    check('hyperlane: partial, and says the delivery margin is missing', line(all, 'hyperlane').testnet.status === 'partial' && /PONDER_HYPERLANE_IGP/.test(line(all, 'hyperlane').testnet.missing))
    const ranged = (await api('/api/admin/revenue?range=24h')).data
    check('24 h drops older fees', near(line(ranged, 'kre8_trade').testnet.usd, 1), String(line(ranged, 'kre8_trade').testnet.usd))
    const r30 = (await api('/api/admin/revenue?range=30d')).data
    check('30 d keeps the 3-day-old fee, drops the 40-day-old', near(line(r30, 'kre8_trade').testnet.usd, 1.5))
    for (const r of ['24h', '7d', '30d', 'all']) {
      const v = (await api(`/api/admin/revenue?range=${r}`)).data
      const c = line(v, 'kre8_trade').testnet
      check(`${r}: the series adds up to the figure and fits one chart`, near(c.series.reduce((s, x) => s + x, 0), c.usd) && c.series.length === v.buckets.length && v.buckets.length <= 122, `${c.series.length}`)
    }
  }

  // ---- testnet never in money
  {
    check('only mainnet is money', all.totals.mainnet.money === true && all.totals.testnet.money === false)
    check('with only testnet fees, the money total is exactly 0', all.totals.mainnet.usd === 0 && all.totals.mainnet.series.every((v) => v === 0), String(all.totals.mainnet.usd))
    const sum = all.lines.reduce((s, l) => s + (l.testnet.usd ?? 0), 0)
    check('the testnet total is its own sum', near(all.totals.testnet.usd, sum) && sum > 0, String(sum))
    check('no mainnet cell carries a testnet number', all.lines.every((l) => l.mainnet.usd == null || l.mainnet.usd === 0), all.lines.filter((l) => l.mainnet.usd).map((l) => l.id).join())
  }

  // ---- honest statuses
  {
    const empty = all.lines.filter((l) => ['not_tracked', 'not_live', 'not_billed', 'error'].includes(l.mainnet.status))
    check('a line with no number is null, never 0', empty.every((l) => l.mainnet.usd === null && l.mainnet.series === null))
    for (const id of ['ads', 'integrator', 'gully_rpc', 'gully_id']) check(`${id} says not tracked yet, and what it needs`, line(all, id).mainnet.status === 'not_tracked' && line(all, id).mainnet.missing.length > 20 && all.open.some((o) => o.id === id))
    check('Gully Multisig says not billed', line(all, 'multisig').mainnet.status === 'not_billed')
    check('Gully Pay is partial: the gullypay.xyz ledger is named as missing', line(all, 'gully_pay').mainnet.status === 'partial' && /gullypay\.xyz/.test(line(all, 'gully_pay').mainnet.missing))
    check('the fee receivers show on testnet, in no total', all.treasuries.testnet.some((h) => h.label === 'Chain network fee account' && h.native === 1) && all.treasuries.testnet.some((h) => h.label === 'Message fee beneficiary'))
    check('secrets are not in the answer', !JSON.stringify(all).includes(ADMIN) && !JSON.stringify(all).includes('127.0.0.1'))
  }

  // ---- a source that fails
  {
    test.broken.add('feeEvents')
    fresh()
    const v = (await api()).data
    check('a failed table is an error, not 0', line(v, 'kre8_trade').testnet.status === 'error' && line(v, 'kre8_trade').testnet.usd === null)
    check('the other lines still read', near(line(v, 'launch_fees').testnet.usd, 2))
    test.broken.clear()

    rpcState.fail = true
    fresh()
    const c = (await api()).data
    check('a failed RPC: names, tips and gas say so, not 0', ['names', 'tips_members', 'chain_gas'].every((id) => line(c, id).testnet.status === 'error' && line(c, id).testnet.usd === null), ['names', 'tips_members', 'chain_gas'].map((id) => line(c, id).testnet.status).join())
    rpcState.fail = false

    const keep = process.env.GULLY_INDEXER
    process.env.GULLY_INDEXER = 'http://127.0.0.1:9'
    fresh()
    const d = (await api()).data
    check('the whole indexer down: its lines are errors', line(d, 'launch_fees').testnet.status === 'error' && d.indexer.testnet === false)
    process.env.GULLY_INDEXER = keep
  }

  // ---- mainnet indexer guard
  {
    process.env.REVENUE_MAINNET_INDEXER = `http://127.0.0.1:${mainIndexer.address().port}`
    fresh()
    const v = (await api()).data
    check('a "mainnet" indexer that answers as testnet is refused', v.indexer.mainnet === 'refused' && line(v, 'kre8_trade').mainnet.status === 'error' && v.totals.mainnet.usd === 0)
    check('and it does not reach a test-money number', line(v, 'kre8_trade').mainnet.usd === null)
    mainIdx.headChain = 48559
    mainIdx.tables = { feeEvents: [{ timestamp: String(NOW - HOUR), kind: 'guard-fee', currency: USDCE, protocolShare: '4000000', protocolUsd: 4 }] }
    fresh()
    const m = (await api()).data
    check('a real mainnet indexer fills the mainnet column and the money total', near(line(m, 'kre8_trade').mainnet.usd, 4) && near(m.totals.mainnet.usd, 4) && near(line(m, 'kre8_trade').testnet.usd, 3.5), String(m.totals.mainnet.usd))
    delete process.env.REVENUE_MAINNET_INDEXER
  }

  // ---- Gully ID with a server-side key
  {
    process.env.GULLY_ID_ADMIN_TOKEN = ID_TOKEN
    fresh()
    const r = await api()
    const v = r.data
    check('with a key, Gully ID reads on the side it is set to (testnet by default)', near(line(v, 'gully_id').testnet.usd, 58) && line(v, 'gully_id').mainnet.usd === null && v.totals.mainnet.usd === 0, JSON.stringify(line(v, 'gully_id').testnet.usd))
    check('Gully ID names are not counted twice', line(v, 'gully_id').testnet.usd < 900)
    check('the key never reaches the browser', !r.text.includes(ID_TOKEN))
    process.env.GULLY_ID_REVENUE_NETWORK = 'mainnet'
    fresh()
    const m = (await api()).data
    check('set to mainnet, it joins the money total', near(line(m, 'gully_id').mainnet.usd, 58) && near(m.totals.mainnet.usd, 58) && line(m, 'gully_id').testnet.usd === null)
    idState.fail = true
    fresh()
    const f = (await api()).data
    check('a refused key is an error, not 0', line(f, 'gully_id').mainnet.status === 'error' && f.totals.mainnet.usd === 0)
    idState.fail = false
    delete process.env.GULLY_ID_ADMIN_TOKEN
    delete process.env.GULLY_ID_REVENUE_NETWORK
  }

  // ---- cache and incremental reads
  {
    fresh()
    await api()
    const calls = test.calls
    const logCalls = rpcState.logCalls
    await api('/api/admin/revenue?range=24h')
    await api('/api/admin/revenue?range=30d')
    check('a second read within the minute reaches no source', test.calls === calls && rpcState.logCalls === logCalls, `${calls} -> ${test.calls}`)
    await api('/api/admin/revenue?fresh=1')
    check('fresh=1 inside 15 s still answers from the cache', test.calls === calls, `${calls} -> ${test.calls}`)
    const burst = await Promise.all([1, 2, 3].map(() => api('/api/admin/revenue?range=7d')))
    check('parallel reads all answer', burst.every((b) => b.status === 200))
  }

  // ---- pure helpers
  {
    check('priced: ETH, USDC.e, and nothing else', rev.priced(null, 10n ** 18n, 2000) === 2000 && rev.priced(USDCE, 1_000_000n, 2000) === 1 && rev.priced(`0x${'9'.repeat(40)}`, 5n, 2000) === null)
    check('priced: ETH with no price is unknown, not 0', rev.priced(null, 1n, null) === null)
    const b = rev.bucketsOf('all', NOW, NOW - 400 * DAY)
    check('all time stays under 122 buckets', b.t.length <= 122 && b.t[0] <= NOW - 400 * DAY + b.step, String(b.t.length))
  }
} finally {
  for (const s of [indexer, mainIndexer, rpcServer, idServer]) s.close()
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(`
${t.passed} passed, ${t.failed} failed`)
process.exit(t.failed ? 1 : 0)
