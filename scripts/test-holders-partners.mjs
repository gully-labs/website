// Holder Map partner webhooks and the launch-health badge (server/holders-partners.mjs), against an in-process
// server. Upstreams are stubs: the map builder and the on-chain existence check are functions, and the partner's
// endpoint is a local receiver (the URL guard allows loopback in test mode, as the Pay webhook tests do).
//
//   node scripts/test-holders-partners.mjs        (no build needed; TEST_PORT overrides the port, default 8797)

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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-hm-partners-'))
const dist = path.join(tmp, 'dist')
fs.mkdirSync(dist)
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><title>Gully Labs</title></head><body></body></html>')
const t = makeChecker()
const { check } = t

// The partner's receiver: records each request; `failNext` makes it answer 500 that many times first.
const received = []
let failNext = 0
const receiver = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    received.push({ headers: req.headers, raw, body: JSON.parse(raw) })
    if (failNext > 0) {
      failNext--
      res.statusCode = 500
      return res.end('no')
    }
    res.end('ok')
  })
})
await new Promise((r) => receiver.listen(0, '127.0.0.1', r))
const HOOK = `http://127.0.0.1:${receiver.address().port}/hook`

Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: dist,
  ADMIN_TOKEN: crypto.randomBytes(24).toString('hex'),
  TRACKER_LOOP: 'off',
  ASK_REMOTE: 'off',
  HOLDER_ALERTS_LOOP: 'off',
  GULLY_ALLOW_LOOPBACK_WEBHOOKS: '1',
  GULLY_PARTNER_TICK_MS: '0',
  GULLY_PARTNER_WEBHOOK_DELAYS_MS: '0,0,0,0,0',
})
for (const k of ['TELEGRAM_BOT_TOKEN', 'GULLY_TREASURY_ADDRESS', 'BLOCKSCOUT_API_KEY', 'MORALIS_API_KEY']) delete process.env[k]
await import('../server/server.mjs')
const P = await import('../server/holders-partners.mjs')
const H = await import('../server/holders.mjs')
await new Promise((r) => setTimeout(r, 200))

const addr = (n) => '0x' + n.toString(16).padStart(40, '0')
const tx = (n) => '0x' + n.toString(16).padStart(64, '0')
const KNOWN = new Set([addr(0xa1), addr(0xa2), addr(0xa3), addr(0xa4)])
let builds = 0
// A risky map: 4 bundled wallets (12%), 5 snipers, deployer 15%, and a deployer sell to the pool.
const riskyMap = (a) => ({
  state: 'ok', kind: 'launch', venue: 'ExamplePad', chain: { key: 'base', id: 8453, name: 'Base' }, token: { address: a, symbol: 'RISK', name: 'Risky' }, asOf: '2026-10-18T10:00:00.000Z',
  forensics: { deployer: addr(0xdd), bundled: { wallets: 4, pct: 12.4 }, snipers: { wallets: 5, pct: 20, blocks: 5 }, deployerPct: 15, funded: { wallets: 0, pct: 0 } },
  recentFlows: [{ from: addr(0xdd), to: addr(0x99), side: 'sell', pct: 1.5, tx: tx(7) }, { from: addr(0x55), to: addr(0x56), side: 'buy', pct: 1, tx: tx(8) }],
  health: { score: 38, level: 'poor', verdict: 'Strong warning signs: read the parts below.' }, summary: { plain: [] }, nodes: [],
})
const cleanMap = (a) => ({
  state: 'ok', kind: 'launch', venue: 'ExamplePad', chain: { key: 'base', id: 8453, name: 'Base' }, token: { address: a, symbol: 'CLEAN', name: 'Clean' }, asOf: '2026-10-18T10:00:00.000Z',
  forensics: { deployer: addr(0xdd), bundled: { wallets: 0, pct: 0 }, snipers: { wallets: 1, pct: 0.4, blocks: 5 }, deployerPct: 2, funded: { wallets: 0, pct: 0 } },
  recentFlows: [], health: { score: 82, level: 'good', verdict: 'Few warning signs on the checks we can run.' }, summary: { plain: [] }, nodes: [],
})
const maps = new Map([[addr(0xa1), riskyMap(addr(0xa1))], [addr(0xa2), cleanMap(addr(0xa2))]])
P.setPartnerHooksForTest({
  build: async (chain, token) => {
    builds++
    return maps.get(token.toLowerCase()) ?? { state: 'not-found', reason: 'not mapped' }
  },
  exists: async (chain, token) => (token === addr(0xbb) ? null : KNOWN.has(token.toLowerCase()) || token === addr(0xa5)),
})

const wallet = () => privateKeyToAccount(generatePrivateKey())
const owner = makeClient(BASE)
const viewer = makeClient(BASE)
const ownerWallet = wallet()
if ((await owner.signIn(ownerWallet)).status !== 200 || (await viewer.signIn(wallet())).status !== 200) throw new Error('sign-in failed')
const key1 = await owner.post('/api/developer/keys', { name: 'Launchpad' })
const SECRET = key1.data.secret
const key2 = (await owner.post('/api/developer/keys', { name: 'Second' })).data.secret
const launch = (body, auth = SECRET) =>
  fetch(`${BASE}/api/partners/launch`, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, headers: r.headers, data: await r.json().catch(() => null) }))
const verify = (r, secret) => {
  const ts = r.headers['x-gully-timestamp']
  const want = 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${r.raw}`).digest('hex')
  return r.headers['x-gully-signature'] === want
}
const wsOf = () => P.stateForTest().launches.at(-1).ws

try {
  /* ---- pure signals ---- */
  const sig = P.signalsOf(riskyMap(addr(0xa1)))
  check('signals: risky map has bundled, snipers, deployer-share, deployer-selling', ['bundled', 'snipers', 'deployer-share', 'deployer-selling'].every((id) => sig.some((s) => s.id === id)), sig.map((s) => s.id).join(','))
  check('signals: every signal states a fact, a value and a source', sig.every((s) => s.fact && s.value && s.source?.url && s.source?.name))
  check('signals: clean map has none', P.signalsOf(cleanMap(addr(0xa2))).length === 0)
  check('signals: a stock map without forensics has none', P.signalsOf({ state: 'ok', forensics: null }).length === 0)
  check('signals: a sell by someone else is not the deployer selling', !P.signalsOf({ ...riskyMap(addr(0xa1)), recentFlows: [{ from: addr(0x55), to: addr(1), side: 'sell', pct: 1, tx: tx(1) }] }).some((s) => s.id === 'deployer-selling'))
  check('signals: deployer threshold is configurable', P.signalsOf(cleanMap(addr(0xa2)), { deployerPct: 1 }).some((s) => s.id === 'deployer-share'))

  /* ---- inbound auth and validation ---- */
  check('launch: GET refused', (await fetch(`${BASE}/api/partners/launch`)).status === 405)
  check('launch: no key is 401', (await launch({ chain: 'base', token: addr(0xa1) }, null)).status === 401)
  check('launch: unknown key is 401', (await launch({ chain: 'base', token: addr(0xa1) }, 'gl_live_nope')).status === 401)
  check('launch: unknown chain is 400', (await launch({ chain: 'dogechain', token: addr(0xa1) })).status === 400)
  check('launch: bad token is 400', (await launch({ chain: 'base', token: '0x12' })).status === 400)
  check('launch: bad txHash is 400', (await launch({ chain: 'base', token: addr(0xa1), txHash: '0xabc' })).status === 400)
  check('launch: wrong event type is 400', (await launch({ type: 'launch.deleted', data: { chain: 'base', token: addr(0xa1) } })).status === 400)
  check('launch: a token that does not exist on chain is 404', (await launch({ chain: 'base', token: addr(0xee) })).status === 404)
  check('launch: chain that cannot be read is 503', (await launch({ chain: 'base', token: addr(0xbb) })).status === 503)
  check('launch: nothing was queued by the refusals', P.stateForTest().launches.length === 0)

  /* ---- webhook registration (SSRF guard, roles) ---- */
  check('webhook: http to a public host refused', (await owner.post('/api/developer/partners/webhook', { url: 'http://example.com/x' })).status === 400)
  check('webhook: private address refused', (await owner.post('/api/developer/partners/webhook', { url: 'https://192.168.1.10/x' })).status === 400)
  check('webhook: link-local metadata address refused', (await owner.post('/api/developer/partners/webhook', { url: 'https://169.254.169.254/latest' })).status === 400)
  check('webhook: credentials in the URL refused', (await owner.post('/api/developer/partners/webhook', { url: 'https://u:p@example.com/x' })).status === 400)
  check('webhook: a bad deployerPct refused', (await owner.post('/api/developer/partners/webhook', { url: HOOK, deployerPct: 99 })).status === 400)
  check('webhook: signed-out is 401', (await fetch(`${BASE}/api/developer/partners/deliveries`)).status === 401)
  check('test ping with no webhook is 409', (await owner.post('/api/developer/partners/test')).status === 409)
  const reg = await owner.post('/api/developer/partners/webhook', { url: HOOK })
  check('webhook: registered, secret shown once', reg.status === 200 && /^whsec_/.test(reg.data?.secret) && reg.data.endpoint.url === HOOK)
  const whsec = reg.data.secret
  const overview = await owner.call('/api/developer/partners')
  check('overview: never shows the secret', overview.status === 200 && !JSON.stringify(overview.data).includes(whsec) && overview.data.webhook.url === HOOK)

  /* ---- test ping ---- */
  const ping = await owner.post('/api/developer/partners/test')
  const pr = received.at(-1)
  check('ping: delivered', ping.status === 200 && ping.data.delivery.state === 'delivered' && pr?.body.type === 'webhook.test')
  check('ping: signed like Pay (X-Gully-Timestamp, sha256= HMAC of "<ts>.<body>")', !!pr && verify(pr, whsec) && /^sha256=[0-9a-f]{64}$/.test(pr.headers['x-gully-signature']))
  check('ping: a wrong secret does not verify', !!pr && !verify(pr, 'whsec_wrong'))

  /* ---- risky launch end to end ---- */
  received.length = 0
  const r1 = await launch({ chain: 'base', token: addr(0xa1), txHash: tx(1) })
  check('launch: accepted with 202 and queued', r1.status === 202 && r1.data.state === 'queued' && r1.data.id.startsWith('pl_'), JSON.stringify(r1.data))
  check('launch: not built inside the request', builds === 0)
  const dup = await launch({ type: 'launch.created', data: { chain: 'base', token: addr(0xa1) } })
  check('launch: same token again is a duplicate of the first job (envelope form)', dup.status === 200 && dup.data.duplicate === true && dup.data.id === r1.data.id)
  await P.processLaunches()
  check('builder called once, read-only', builds === 1)
  await P.processDeliveries()
  const ev = received.find((x) => x.body.type === 'launch.flagged')
  check('flagged: a signed launch.flagged arrived', !!ev && verify(ev, whsec))
  check('flagged: payload has token, txHash, health, signals with sources and a page link', ev?.body.data.token.symbol === 'RISK' && ev.body.data.txHash === tx(1) && ev.body.data.health.score === 38 && ev.body.data.signals.length === 4 && ev.body.data.signals.every((s) => s.source.url) && ev.body.data.page.includes('/holders/base/'))
  check('flagged: event id and content-type headers', /^evt_/.test(ev?.body.id) && ev.headers['content-type'] === 'application/json' && /GullyLabs-HolderMap/.test(ev.headers['user-agent']))

  /* ---- clean launch sends nothing ---- */
  received.length = 0
  const r2 = await launch({ chain: 'base', token: addr(0xa2) })
  await P.processLaunches()
  await P.processDeliveries()
  check('clean: no webhook for a clean map', r2.status === 202 && received.length === 0 && P.stateForTest().launches.find((l) => l.id === r2.data.id).state === 'clean')

  /* ---- unmapped token ---- */
  const r3 = await launch({ chain: 'base', token: addr(0xa5) })
  await P.processLaunches()
  check('unmapped: a token with no map is marked unmapped and sends nothing', P.stateForTest().launches.find((l) => l.id === r3.data.id).state === 'unmapped' && received.length === 0)

  /* ---- retries ---- */
  maps.set(addr(0xa3), { ...riskyMap(addr(0xa3)), token: { address: addr(0xa3), symbol: 'RETRY', name: 'Retry' } })
  received.length = 0
  failNext = 2
  await launch({ chain: 'base', token: addr(0xa3) })
  await P.processLaunches()
  await P.processDeliveries()
  const d1 = P.deliveriesOf(wsOf())[0]
  check('retry: first attempt failed and is pending a retry', d1.state === 'pending' && d1.attempts === 1 && d1.last.status === 500)
  await P.processDeliveries()
  await P.processDeliveries()
  const d2 = P.deliveriesOf(wsOf())[0]
  check('retry: delivered on the third attempt with the same event id', d2.state === 'delivered' && d2.attempts === 3 && new Set(received.filter((x) => x.body.type === 'launch.flagged').map((x) => x.body.id)).size === 1)

  /* ---- delivery log ---- */
  const log = await owner.call('/api/developer/partners/deliveries')
  check('log: lists deliveries newest first with state and attempts', log.status === 200 && log.data.deliveries.length >= 3 && log.data.deliveries[0].type === 'launch.flagged' && log.data.deliveries.some((d) => d.type === 'webhook.test' && d.test))
  check('log: another workspace sees none of it', (await viewer.call('/api/developer/partners/deliveries')).data.deliveries.length === 0)
  check('log: no body or secret in the view', !JSON.stringify(log.data).includes('whsec_') && !('body' in log.data.deliveries[0]))
  check('workspaces: each wallet registers its own webhook, separate from the first', (await viewer.post('/api/developer/partners/webhook', { url: HOOK })).status === 200)

  /* ---- fairness: another workspace gets the same facts ---- */
  const other = makeClient(BASE)
  await other.signIn(wallet())
  const otherSecret = (await other.post('/api/developer/keys', { name: 'Free' })).data.secret
  await other.post('/api/developer/partners/webhook', { url: HOOK })
  received.length = 0
  await launch({ chain: 'base', token: addr(0xa1) }, otherSecret)
  await P.processLaunches()
  await P.processDeliveries()
  const ev2 = received.find((x) => x.body.type === 'launch.flagged')
  check('fair: another workspace gets the identical signals for the same map', JSON.stringify(ev2?.body.data.signals) === JSON.stringify(ev.body.data.signals))

  /* ---- per-key rate limit ---- */
  P.resetPartnersForTest()
  await owner.post('/api/developer/partners/webhook', { url: HOOK })
  let limited = null
  let notFound = 0
  for (let i = 0; i < P.PER_KEY_PER_MIN + 3; i++) {
    const r = await launch({ chain: 'base', token: addr(0x1000 + i) }, key2)
    if (r.status === 429 && !limited) limited = r
    if (r.status === 404) notFound++
  }
  check('rate: the 31st launch.created in a minute is 429 with Retry-After', notFound === P.PER_KEY_PER_MIN && limited?.status === 429 && Number(limited.headers.get('retry-after')) > 0, `passed ${notFound}`)
  check('rate: another key is not affected', (await launch({ chain: 'base', token: addr(0xa2) })).status === 202)

  /* ---- badge ---- */
  const badge = (p) => fetch(`${BASE}/api/holders/${p}/badge.svg`)
  const before = builds
  const bn = await badge(`base/${addr(0xa7)}`)
  const bnText = await bn.text()
  check('badge: unknown token gets a neutral pill, 200 image/svg+xml', bn.status === 200 && bn.headers.get('content-type').startsWith('image/svg+xml') && bnText.includes('<title>Holder Map</title>') && !/<title>[^<]*(Health|bundle)/.test(bnText))
  check('badge: never builds (no uncached build)', builds === before && (await badge(`base/${addr(0xa1)}`)).status === 200 && builds === before)
  check('badge: bad chain and bad token still a neutral pill', (await (await badge('nochain/zzz')).text()).includes('<title>Holder Map</title>'))
  H.seedHolderMapForTest('base', addr(0xa2), cleanMap(addr(0xa2)))
  H.seedHolderMapForTest('base', addr(0xa1), riskyMap(addr(0xa1)))
  const good = await badge(`base/${addr(0xa2)}`)
  const goodText = await good.text()
  // Text is outlined to paths by badges.mjs, so the words are read from <title>; 70+ is the kit's frog green.
  check('badge: cached healthy map shows "Health 82" in green', goodText.includes('<title>Holder Map: Health 82</title>') && goodText.includes('#2F6B35'))
  check('badge: well-formed, kit styled, linked and sandboxed', goodText.startsWith('<svg') && goodText.trim().endsWith('</svg>') && goodText.includes('data:image/png') && goodText.includes('/holders/base/') && good.headers.get('content-security-policy').includes("default-src 'none'"))
  check('badge: cached by the CDN for 5 minutes (neutral 1 minute)', good.headers.get('cache-control') === 'public, max-age=300' && bn.headers.get('cache-control') === 'public, max-age=60')
  const bad = await (await badge(`base/${addr(0xa1)}`)).text()
  // Bundled wallets take the value slot ahead of the health score (badges.mjs holderMapFace), in the kit alert red.
  check('badge: a risky map shows its bundles in the kit alert red', bad.includes('<title>Holder Map: 4 bundles</title>') && bad.includes('#FF8A7A'))
  H.seedHolderMapForTest('base', addr(0xa4), { ...riskyMap(addr(0xa4)), health: null })
  check('badge: no health but a bundle shows "4 bundles"', (await (await badge(`base/${addr(0xa4)}`)).text()).includes('<title>Holder Map: 4 bundles</title>'))
  H.seedHolderMapForTest('base', addr(0xa3), { ...cleanMap(addr(0xa3)), health: null, forensics: null })
  check('badge: a map without a health score stays neutral', !/Health \d/.test(await (await badge(`base/${addr(0xa3)}`)).text()))
  check('badge: HEAD works and POST is refused', (await fetch(`${BASE}/api/holders/base/${addr(0xa2)}/badge.svg`, { method: 'HEAD' })).status === 200 && (await fetch(`${BASE}/api/holders/base/${addr(0xa2)}/badge.svg`, { method: 'POST' })).status === 405)
  check('badge: the plain map JSON route is unchanged', (await fetch(`${BASE}/api/holders/base/${addr(0xa2)}`)).status === 200)

  const bd = await P.holderBadgeData('base', addr(0xa2))
  check('badge data: cached map gives state ok, health and flags', bd.state === 'ok' && bd.health.score === 82 && bd.flags.signals.length === 0)
  check('badge data: uncached is unknown and builds nothing', (await P.holderBadgeData('base', addr(0xa8))).state === 'unknown' && builds === before)

  /* ---- rotate and remove ---- */
  const rot = await owner.post('/api/developer/partners/webhook/rotate')
  check('rotate: new secret', rot.status === 200 && rot.data.secret !== whsec && /^whsec_/.test(rot.data.secret))
  check('remove: webhook can be cleared', (await owner.post('/api/developer/partners/webhook', { url: null })).data.endpoint === null)

  /* ---- white-label embed key ---- */
  const billing = await import('../server/billing.mjs')
  const cfg = (qs) => fetch(`${BASE}/api/holders/embed-config?${qs}`).then(async (r) => ({ status: r.status, headers: r.headers, data: await r.json() }))
  check('embed-key: signed out is 401', (await fetch(`${BASE}/api/developer/partners/embed-key`)).status === 401)
  const ek = await owner.call('/api/developer/partners/embed-key')
  const EK = ek.data?.embedKey
  check('embed-key: a signed key, not the API secret, for the workspace; free plan has no white label', ek.status === 200 && /^gle_0x[0-9a-f]{40}\.[0-9a-f]{24}$/.test(EK ?? '') && ek.data.whiteLabel === false && !EK.includes(SECRET))
  check('embed-key: stable between calls', (await owner.call('/api/developer/partners/embed-key')).data.embedKey === EK)
  const free = await cfg(`key=${EK}&theme=light&accent=%23ff8800`)
  check('embed-config: a valid key on a plan WITHOUT white label gets the normal embed (credit stays)', free.status === 200 && free.data.whiteLabel === false && free.data.theme === null && free.headers.get('cache-control') === 'no-store')
  billing.adminSetPlan(ownerWallet.address.toLowerCase(), 'pro', 30)
  check('embed-config: Pro has no white label either', (await cfg(`key=${EK}`)).data.whiteLabel === false)
  billing.adminSetPlan(ownerWallet.address.toLowerCase(), 'business', 30)
  const wl = await cfg(`key=${EK}&theme=light&accent=%23FF8800`)
  check('embed-config: Business plan with its key: white label, light theme, accent lower-cased', wl.data.whiteLabel === true && wl.data.theme.mode === 'light' && wl.data.theme.accent === '#ff8800', JSON.stringify(wl.data))
  check('embed-config: theme defaults to dark, accent null when not given', JSON.stringify((await cfg(`key=${EK}`)).data.theme) === JSON.stringify({ mode: 'dark', accent: null }))
  for (const bad of ['red', 'url(javascript:alert(1))', '#12', '#12345', '#gggggg', '%23ff0000;background:url(x)', '#ff00001', 'expression(1)']) {
    const r = await cfg(`key=${EK}&accent=${encodeURIComponent(bad)}`)
    check(`embed-config: accent ${JSON.stringify(bad)} is refused (null), the white label itself stays`, r.data.whiteLabel === true && r.data.theme.accent === null)
  }
  check('embed-config: an unknown theme word is dark', (await cfg(`key=${EK}&theme=neon`)).data.theme.mode === 'dark')
  const tampered = EK.slice(0, -1) + (EK.endsWith('0') ? '1' : '0')
  check('embed-config: a tampered signature, another workspace, garbage and no key all get the normal embed', (await cfg(`key=${tampered}`)).data.whiteLabel === false && (await cfg(`key=${EK.replace(/gle_0x[0-9a-f]{40}/, 'gle_0x' + 'ab'.repeat(20))}`)).data.whiteLabel === false && (await cfg('key=nonsense')).data.whiteLabel === false && (await cfg('')).data.whiteLabel === false)
  check('embed-config: a client-side flag alone changes nothing (whitelabel=1, no key)', (await cfg('whitelabel=1&theme=light&accent=%23ff8800')).data.whiteLabel === false)
  check('embed-config: POST is refused', (await fetch(`${BASE}/api/holders/embed-config?key=${EK}`, { method: 'POST' })).status === 405)
  const rotated = await owner.post('/api/developer/partners/embed-key/rotate')
  check('embed-key: rotating gives a new key and ends the old one at once', rotated.status === 200 && rotated.data.embedKey !== EK && (await cfg(`key=${EK}`)).data.whiteLabel === false && (await cfg(`key=${rotated.data.embedKey}`)).data.whiteLabel === true)
  billing.adminSetPlan(ownerWallet.address.toLowerCase(), 'free', 0)
  check('embed-config: when the plan lapses the white label ends with it (the plan is read live)', (await cfg(`key=${rotated.data.embedKey}`)).data.whiteLabel === false)
} catch (e) {
  t.failed++
  console.error('FAIL  test run crashed:', e?.stack ?? e)
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
receiver.close()
process.exit(t.failed ? 1 : 0)
