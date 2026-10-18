// End-to-end test of DeepCore in the server (server/deepcore.mjs): the launch poller and its state, the
// "DeepCore new launch" alert kind (webhook delivery, signing, log, mute, plan limit, chain filter,
// cooldown), and the router-quote proxy GET /api/deepcore/quote (cache, limits, geo gate, errors).
//
//   npm run test:deepcore-alerts        (no build needed; TEST_PORT overrides the port, default 8796)
//
// The real server runs IN THIS PROCESS with a fresh DATA_DIR. DEEPCORE_API points at a local stub of
// api.deepcore.fun that answers /v1/launches and /v1/chains/:id/quote in DeepCore's real shapes (read
// live on 2026-10-17) and can be switched to fail. Nothing upstream is read.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { makeChecker, makeClient, guardTestRun } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8796
await guardTestRun(PORT)
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-dc-'))
const t = makeChecker()
const { check } = t
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------- DeepCore API stub --- */

const META_RH = '0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35'
let mode = 'ok' // ok | down | shape | noroute
const launches = [] // newest first, like the API
const dcCalls = []
const launch = (chainId, token, symbol, createdAt = new Date().toISOString(), locked = true) => ({
  kitVersion: 2,
  poolIds: ['0x' + crypto.randomBytes(32).toString('hex')],
  token,
  launchToken: { symbol, decimals: 18 },
  creator: '0x35f00ef756ac4cb99abef3603dccf2578971c595',
  schedule: { startTime: String(Math.floor(Date.parse(createdAt) / 1000)), startTimeIso: createdAt },
  legs: [{ poolId: '0x' + 'ab'.repeat(32), kind: 'CL', quote: { address: '0x0bd7d308f8e1639fab988df18a8011f41eacad73', symbol: 'WETH', decimals: 18 }, launchFee: { feePips: 10000 }, lock: locked ? { status: 'indexed', lockId: '7' } : null }],
  createdAt: { blockNumber: '85689748', blockTimestamp: createdAt, txHash: '0x' + crypto.randomBytes(32).toString('hex') },
  chainId,
})
const addr = () => '0x' + crypto.randomBytes(20).toString('hex')
const QUOTE = {
  requestId: 'x',
  chainId: 4663,
  tokenIn: '0x0000000000000000000000000000000000000000',
  tokenOut: META_RH,
  amountIn: '100000000000000000',
  amountOut: '340732514899995633',
  minAmountOut: '339028852325495654',
  slippageBps: 50,
  priceImpactBps: 3,
  protocolFee: { bps: 15, amount: '149775336994508', currency: '0x0000000000000000000000000000000000000000', exempt: false, readFrom: '0x7878624417E9d69219EAdD14bA1B01459C87b578' },
  route: {
    source: 'RAMSES_CL',
    execution: 'deepcore-fill-router',
    legs: [{ shareBps: 10000, source: 'RAMSES_CL', hops: [{ kind: 'slipstream', tokenIn: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', tokenOut: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', pool: '0xFAE65eAa11943f45E83D5B45DC7A7C801C51bfB0' }, { kind: 'slipstream', tokenIn: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', tokenOut: META_RH, pool: '0x960f79D8DfEC7F2F0C1b24CdAC6BB9Df1371C6e2' }] }],
  },
  alternatives: [{ source: 'UNISWAP_V3', amountOut: '339391592250201853' }],
  quotedAt: 1792263664,
  expiresAt: 1792263694,
  blockNumber: '91157911',
}
const stub = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  dcCalls.push(u.pathname + u.search)
  const send = (s, j) => {
    res.writeHead(s, { 'content-type': 'application/json' })
    res.end(JSON.stringify(j))
  }
  if (mode === 'down') return send(503, { error: { code: 'STATE_UNREADABLE', message: 'indexer down' } })
  if (u.pathname === '/v1/launches') {
    if (mode === 'shape') return send(200, { data: { rows: [] } })
    const chains = [56, 999, 4663, 8453].map((chainId) => ({ chainId, status: chainId === 999 && mode === 'partial' ? 'error' : 'ok', total: launches.filter((l) => l.chainId === chainId).length }))
    return send(200, { data: { items: launches.slice(0, Number(u.searchParams.get('limit')) || 50), chains, limit: 50, offset: 0 }, provenance: { source: 'deepcore-indexer' } })
  }
  const q = u.pathname.match(/^\/v1\/chains\/(\d+)\/quote$/)
  if (q) {
    if (mode === 'noroute') return send(404, { error: { code: 'NO_ROUTE', message: 'no route' } })
    if (!/^\d+$/.test(u.searchParams.get('amount') ?? '')) return send(422, { error: { code: 'VALIDATION_FAILED' } })
    return send(200, { data: { ...QUOTE, chainId: Number(q[1]), tokenOut: u.searchParams.get('tokenOut'), amountIn: u.searchParams.get('amount') }, provenance: { source: 'chain' } })
  }
  send(404, { error: { code: 'NOT_FOUND' } })
})
await new Promise((r) => stub.listen(0, '127.0.0.1', r))

/* ---------------------------------------------------------- webhook receiver --- */

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
const HOOK_URL = `http://127.0.0.1:${receiver.address().port}/hook`

/* ------------------------------------------------------------ start server --- */

Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: path.join(tmp, 'no-dist'),
  ADMIN_TOKEN: crypto.randomBytes(24).toString('hex'),
  TRACKER_LOOP: 'off',
  TRACKER_SKIP_APIS: '1',
  GULLY_RPC_1: 'http://127.0.0.1:9',
  GULLY_RPC_56: 'http://127.0.0.1:9',
  GULLY_RPC_8453: 'http://127.0.0.1:9',
  GULLY_RPC_42161: 'http://127.0.0.1:9',
  GULLY_RPC_10: 'http://127.0.0.1:9',
  GULLY_RPC_137: 'http://127.0.0.1:9',
  GULLY_RPC_43114: 'http://127.0.0.1:9',
  GULLY_ALLOW_LOOPBACK_WEBHOOKS: '1',
  DEEPCORE_API: `http://127.0.0.1:${stub.address().port}`,
  ASK_REMOTE: 'off',
})
delete process.env.TELEGRAM_BOT_TOKEN
delete process.env.GULLY_TREASURY_ADDRESS
delete process.env.DEEPCORE_LOOP
await import('../server/server.mjs')
const dc = await import('../server/deepcore.mjs')
const { evaluateLaunchAlerts, muteAlert, LAUNCH_COOLDOWN_MS } = await import('../server/alerts.mjs')
dc.setDecimalsReaderForTest(async () => 18)
await sleep(300)

const wallet = privateKeyToAccount(generatePrivateKey())
const owner = wallet.address.toLowerCase()
const dev = makeClient(BASE)
const deliveriesOf = async (id) => (await dev.call('/api/developer/alerts')).data.alerts.find((a) => a.id === id)

try {
  check('the background poll is off in tests (TRACKER_LOOP=off)', dcCalls.length === 0)

  /* ------------------------------------------------------ first read: baseline --- */
  launches.unshift(launch(4663, addr(), 'OLD', '2026-10-11T08:20:21.000Z'))
  const first = await dc.pollLaunchesNow()
  check('the first good read records the backlog without reporting it as new', first.ok && first.fresh.length === 0)
  const state = JSON.parse(fs.readFileSync(path.join(tmp, 'deepcore.json'), 'utf8'))
  check('state is kept in DATA_DIR/deepcore.json (seen keys, baseline, last read)', state.seen.length === 1 && !!state.baselineAt && !!state.lastOkAt && state.launches[0].symbol === 'OLD')
  check('the launches read asks the documented endpoint', dcCalls.at(-1) === '/v1/launches?limit=50')

  /* -------------------------------------------------------- create the alert --- */
  await dev.signIn(wallet)
  const view0 = (await dev.call('/api/developer/alerts')).data
  const kind = view0.kinds?.find((k) => k.id === 'deepcore-launch')
  check('the alerts view offers the "DeepCore new launch" kind with DeepCore’s chains', kind?.label === 'DeepCore new launch' && kind.chains.map((c) => c.chainId).join() === '56,999,4663,8453')
  const bad1 = await dev.post('/api/developer/alerts', { condition: { type: 'deepcore-launch', chainId: 1 }, webhookUrl: HOOK_URL })
  check('a chain DeepCore does not run on is refused', bad1.status === 400 && /DeepCore runs on/.test(bad1.data?.error))
  const bad2 = await dev.post('/api/developer/alerts', { chain: 'robinhood', ticker: 'NVDA', condition: { type: 'deepcore-launch' }, webhookUrl: HOOK_URL })
  check('a launch alert with a stock target is refused', bad2.status === 400 && /no stock/.test(bad2.data?.error))
  const bad3 = await dev.post('/api/developer/alerts', { condition: { type: 'deepcore-launch' } })
  check('a launch alert needs a channel', bad3.status === 400)
  const created = await dev.post('/api/developer/alerts', { name: 'New launches', condition: { type: 'deepcore-launch', chainId: null }, webhookUrl: HOOK_URL })
  const id = created.data?.alert?.id
  const secret = created.data?.secret
  check('a DeepCore launch alert is created (any chain), with a signing secret shown once', created.status === 201 && created.data.alert.kind === 'deepcore-launch' && created.data.alert.condition.chainId === null && /^whsec_/.test(secret ?? ''), created.data?.error)
  const over = await dev.post('/api/developer/alerts', { condition: { type: 'gap', pct: 2 }, webhookUrl: HOOK_URL })
  check('it counts against the plan’s alerts (Free: 1)', over.status === 403 && /includes 1 alert/.test(over.data?.error), over.data?.error)

  /* --------------------------------------------------------- a new launch fires --- */
  const tokB = addr()
  launches.unshift(launch(8453, tokB, 'NEWB'))
  const r1 = await dc.pollLaunchesNow()
  await sleep(300)
  check('a launch not seen before is reported as new', r1.fresh.length === 1 && r1.fresh[0].symbol === 'NEWB')
  check('the alert POSTs one webhook', hooks.length === 1, `${hooks.length} hooks`)
  const h = hooks[0]
  const ev = h?.body.events?.[0]
  check('payload: alert.triggered, kind deepcore-launch, the condition', h?.body.type === 'alert.triggered' && h.body.alert.kind === 'deepcore-launch' && h.body.alert.id === id)
  check('event: token, symbol, chain, time, pool and lock, deepcore.fun links', ev?.kind === 'deepcore.launch' && ev.token === tokB && ev.chainId === 8453 && ev.chainName === 'Base' && ev.pools[0].locked === true && ev.pools[0].lockId === '7' && ev.links.token === `https://deepcore.fun/tokens/${tokB}?net=base` && ev.links.swap.startsWith('https://deepcore.fun/app/swap?net=base&in=0x0000000000000000000000000000000000000000&out='))
  const sig = crypto.createHmac('sha256', secret).update(`${h.headers['x-gully-timestamp']}.${h.raw}`).digest('hex')
  check('the webhook is signed like every other alert', h.headers['x-gully-signature'] === `sha256=${sig}`)
  const log1 = (await deliveriesOf(id)).deliveries
  check('the delivery is logged with the launch', log1.length === 1 && log1[0].ok && log1[0].events[0] === 'deepcore:base:NEWB')

  /* ------------------------------------------------------------- cooldown --- */
  launches.unshift(launch(56, addr(), 'NEWC'))
  await dc.pollLaunchesNow()
  await sleep(200)
  check('a launch within the cooldown waits (no second POST yet)', hooks.length === 1 && (await deliveriesOf(id)).pendingLaunches === 1)
  await evaluateLaunchAlerts([], Date.now() + LAUNCH_COOLDOWN_MS + 1_000)
  check('after the cooldown the waiting launch goes out', hooks.length === 2 && hooks[1].body.events[0].symbol === 'NEWC' && (await deliveriesOf(id)).pendingLaunches === 0)
  const again = await dc.pollLaunchesNow()
  check('a launch already seen is never reported twice', again.fresh.length === 0)

  /* ----------------------------------------------------------------- mute --- */
  const m = muteAlert(id, owner, 24 * 3_600_000)
  launches.unshift(launch(4663, addr(), 'MUTED'))
  await dc.pollLaunchesNow()
  await evaluateLaunchAlerts([], Date.now() + 2 * LAUNCH_COOLDOWN_MS)
  check('a muted alert neither sends nor keeps the launch for later', m.ok && hooks.length === 2 && (await deliveriesOf(id)).pendingLaunches === 0)
  await dev.post(`/api/developer/alerts/${id}/resume`)

  /* -------------------------------------------------------- chain filter --- */
  await dev.post(`/api/developer/alerts/${id}/delete`)
  const only = await dev.post('/api/developer/alerts', { condition: { type: 'deepcore-launch', chainId: 8453 }, webhookUrl: HOOK_URL })
  check('an alert can be limited to one chain', only.status === 201 && only.data.alert.condition.chainId === 8453)
  launches.unshift(launch(4663, addr(), 'RHOOD'))
  await dc.pollLaunchesNow()
  await sleep(200)
  check('a launch on another chain does not fire it', hooks.length === 2)
  launches.unshift(launch(8453, addr(), 'BASED'))
  await dc.pollLaunchesNow()
  await sleep(300)
  check('a launch on its chain fires it', hooks.length === 3 && hooks[2].body.events.length === 1 && hooks[2].body.events[0].symbol === 'BASED')
  const test = await dev.post(`/api/developer/alerts/${only.data.alert.id}/test`)
  check('a test delivery works for a launch alert', test.status === 200 && test.data.results[0].ok && hooks.at(-1).body.type === 'alert.test')

  /* --------------------------------------------------- unreadable stays so --- */
  const before = dc.deepcoreHealth().cached
  mode = 'down'
  const down = await dc.pollLaunchesNow()
  check('a failed read is reported as unreadable, never as zero launches', !down.ok && /indexer down/.test(down.error) && dc.deepcoreHealth().cached === before)
  const stale = await dc.readLaunches()
  check('the bot then serves the last good list, labelled stale', stale.state === 'stale' && stale.launches.length === 5 && stale.launches[0].symbol === 'BASED')
  mode = 'shape'
  const shape = await dc.pollLaunchesNow()
  check('an answer in an unexpected shape is unreadable too', !shape.ok && /unexpected answer shape/.test(shape.error))
  mode = 'partial'
  await dc.pollLaunchesNow()
  const part = await dc.readLaunches()
  check('a chain DeepCore could not read is named as unreadable, its total unknown', part.state === 'ok' && part.chains.find((c) => c.chainId === 999).status === 'unreadable' && part.chains.find((c) => c.chainId === 999).total === null)
  mode = 'ok'
  const base = await dc.readLaunches({ chainId: 8453 })
  check('readLaunches filters by chain, newest first', base.launches.map((l) => l.symbol).join() === 'BASED,NEWB')

  /* ------------------------------------------------------ persistence --- */
  const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'deepcore.json'), 'utf8'))
  check('seen launches survive in the state file (a restart does not re-alert)', saved.seen.length === 6 && saved.seen.includes(`8453:${tokB.toLowerCase()}`))
  const alertsFile = JSON.parse(fs.readFileSync(path.join(tmp, 'alerts.json'), 'utf8'))
  check('the alert and its log are stored with the other alerts', alertsFile.alerts.length === 1 && alertsFile.alerts[0].condition.type === 'deepcore-launch' && alertsFile.alerts[0].deliveries.length === 2)

  /* --------------------------------------------------------- quote proxy --- */
  const q = (params, headers = {}) => fetch(`${BASE}/api/deepcore/quote?${new URLSearchParams(params)}`, { headers }).then(async (r) => ({ status: r.status, j: await r.json() }))
  const n0 = dcCalls.length
  const ok = await q({ chain: 'robinhood', token: META_RH, amount: '0.1' })
  const qq = ok.j.quote
  check('quote: 200 with the output in token units', ok.status === 200 && qq.out.amount === '0.340732514899995633' && qq.out.symbol === 'META' && qq.pay.symbol === 'ETH' && qq.pay.amount === '0.1', JSON.stringify(ok.j).slice(0, 200))
  check('quote: the route names its venues and hops', qq.route.venues.join() === 'Ramses CL' && qq.route.hops.map((x) => `${x.from}>${x.to}`).join() === 'WETH>USDG,USDG>META')
  check('quote: the 0.15% routing fee at an external venue', qq.fee.pct === 0.15 && qq.fee.amount === '0.000149775336994508' && qq.onDeepcorePool === false)
  check('quote: labelled comparison only, with a deepcore.fun swap link', qq.comparisonOnly === true && qq.links.swap === `https://deepcore.fun/app/swap?net=robinhood&in=0x0000000000000000000000000000000000000000&out=${META_RH}`)
  check('quote: the upstream call is DeepCore’s router quote, native in, wei amount', dcCalls.at(-1) === `/v1/chains/4663/quote?tokenIn=0x0000000000000000000000000000000000000000&tokenOut=${META_RH}&amount=100000000000000000&slippageBps=50`)
  const again2 = await q({ chain: 'robinhood', token: META_RH, amount: '0.10000' })
  check('quote: the same amount within 20 s is served from the cache', again2.status === 200 && again2.j.cached === true && dcCalls.length === n0 + 1)
  check('quote: an untracked token is refused', (await q({ chain: 'robinhood', token: addr(), amount: '1' })).status === 400)
  check('quote: a bad amount is refused', (await q({ chain: 'bsc', token: '0x7425889FE94F9d693E8daefE88BCCed6AcFEf4c0', amount: '-1' })).status === 400)
  const blocked = await q({ chain: 'robinhood', token: META_RH, amount: '0.2' }, { 'cf-ipcountry': 'US' })
  check('quote: a blocked region gets no quote (451), like the swap card', blocked.status === 451 && blocked.j.code === 'REGION')
  mode = 'noroute'
  const nr = await q({ chain: 'robinhood', token: META_RH, amount: '0.3' })
  check('quote: no route is said plainly, with the token’s DeepCore links', nr.status === 404 && nr.j.code === 'NO_ROUTE' && !!nr.j.links?.token)
  mode = 'down'
  const dn = await q({ chain: 'robinhood', token: META_RH, amount: '0.4' })
  check('quote: an upstream failure is unreadable (502), not a zero output', dn.status === 502 && dn.j.code === 'UNREADABLE' && !('quote' in dn.j))
  mode = 'ok'
  let limited = null
  for (let i = 0; i < 12 && !limited; i++) {
    const r = await q({ chain: 'robinhood', token: META_RH, amount: String(1 + i) })
    if (r.status === 429) limited = r
  }
  check('quote: at most 10 fresh quotes a minute per address', limited?.j.code === 'RATE_LIMITED')
} catch (e) {
  check(`no exception (${e?.stack ?? e})`, false)
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(t.failed ? 1 : 0)
