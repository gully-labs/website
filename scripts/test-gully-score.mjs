// The Gully Score (server/gully-score.mjs), against an in-process server.
//
//   node scripts/test-gully-score.mjs        (no build needed; TEST_PORT overrides the port, default 8798)
//
// The chain is a JavaScript stub (setScoreRpcForTest / setMonitorRpcForTest), Sourcify and the Holder Map are a
// stubbed fetch, DeepCore's launch list and the published-report source are stub functions. Nothing upstream is read.
//
// Covers: the component maths for each kind of control and upgrade setup, missing data left out (never 0) and no
// score under the minimum coverage, the published-report-only rule, that nothing paid can change a score (imports,
// plan on the reader, listing on or off), history and change log, the index and sitemap listing rule, page head tags,
// and the badge SVG (well-formed, kit mark, score and date).

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { guardTestRun, hostRequest, makeChecker, makeClient } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8798
await guardTestRun(PORT)
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-score-'))
const dist = path.join(tmp, 'dist')
fs.mkdirSync(dist)
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><title>Gully Labs</title><meta name="description" content="x" /><meta name="robots" content="index" /><link rel="canonical" href="https://gullylabs.xyz/" /></head><body><div id="root"></div></body></html>')
const ADMIN = crypto.randomBytes(24).toString('hex')
const t = makeChecker()
const { check } = t

const hooks = []
const receiver = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    hooks.push(JSON.parse(raw))
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
  ADMIN_TOKEN: ADMIN,
  TRACKER_LOOP: 'off',
  DEEPCORE_LOOP: 'off',
  ASK_REMOTE: 'off',
  GULLY_ALLOW_LOOPBACK_WEBHOOKS: '1',
  ...Object.fromEntries([1, 8453, 56, 42161, 10, 137, 43114].map((id) => [`GULLY_RPC_${id}`, 'http://127.0.0.1:9'])),
})
for (const k of ['TELEGRAM_BOT_TOKEN', 'GULLY_TREASURY_ADDRESS', 'ETHERSCAN_API_KEY', 'GULLY_HOLDERS_API']) delete process.env[k]
await import('../server/server.mjs')
const score = await import('../server/gully-score.mjs')
const mon = await import('../server/sec-monitor.mjs')
await new Promise((r) => setTimeout(r, 200))

/* --------------------------------------------------------------------- stubs --- */

const hex = (n) => '0x' + BigInt(n).toString(16)
const pad = (a) => '0x' + String(a).toLowerCase().replace(/^0x/, '').padStart(64, '0')
const word = (v) => BigInt(v).toString(16).padStart(64, '0')
const addr = (n) => '0x' + n.toString(16).padStart(40, '0')
const [A, C, D, E, F, G, H, EOA, SAFE, TL, IMPL, S1, S2, S3, L] = [0xa, 0xc, 0xd, 0xe, 0xf, 0x9, 0x8, 0xe0a, 0x5afe, 0x71, 0x1001, 0x51, 0x52, 0x53, 0x1a] .map((n) => addr(n + 0x10000))
const NOW = Date.now()
const DAY = 86_400_000
// L: a Gully Launchpad token on Gully Chain Testnet (indexer row; the chain stub answers its balance and the transfer probe).
const launchRow = { address: L, symbol: 'LABRAT', name: 'Lab Rat', source: 'launchpad', launchpad: '0x3378b659f6dda7f13d87599b383b3995f82d0974', launchpadVersion: '2.0.0', creator: EOA, createdAt: Math.floor((NOW - 3 * DAY) / 1000), createdBlock: '74', progressPct: 2.88, complete: false, graduated: false, pool: null, totalSupply: '1000' }
const st = {
  head: 5_000_000,
  code: new Map([A, C, D, F, G, H, SAFE, TL].map((x) => [x, '0x6080'])),
  slots: new Map([[`${A}:${mon.SLOTS.implementation}`, pad(IMPL)]]),
  calls: new Map([
    [`${A}:${mon.SEL.owner}`, pad(EOA)],
    [`${A}:${mon.SEL.name}`, '0x' + word(32) + word(5) + Buffer.from('Vault').toString('hex').padEnd(64, '0')],
    [`${C}:${mon.SEL.owner}`, pad(TL)],
    [`${TL}:0xf27a0c92`, '0x' + word(2 * 86_400)],
    [`${D}:${mon.SEL.owner}`, pad('0x0')],
    [`${F}:${mon.SEL.owner}`, pad(SAFE)],
    [`${SAFE}:${mon.SEL.getThreshold}`, '0x' + word(2)],
    [`${SAFE}:${mon.SEL.getOwners}`, '0x' + word(32) + word(3) + [S1, S2, S3].map((a) => a.slice(2).padStart(64, '0')).join('')],
    [`${H}:${mon.SEL.owner}`, pad(EOA)],
  ]),
  logs: [],
  blocks: new Map([[1000, Math.floor((NOW - 400 * DAY) / 1000)], [2000, Math.floor((NOW - 45 * DAY) / 1000)]]),
}
// E is a minimal clone (EIP-1167) of IMPL.
st.code.set(E, '0x363d3d373d3d3d363d73' + IMPL.slice(2) + '5af43d82803e903d91602b57fd5bf3')
// L: an ERC-20 dispatcher (transfer, balanceOf) with a mint function; the probe call (to EOA, state override) is a 5% fee.
st.code.set(L, '0x' + ['a9059cbb', '70a08231', '40c10f19'].map((s) => `63${s}14`).join(''))
st.calls.set(`${L}:0x70a08231`, '0x' + word(1000n * 10n ** 18n))
st.calls.set(`${EOA}:0x00000000`, '0x' + word(0) + word(1) + word(1) + word(32) + word((100n * 10n ** 18n * 95n) / 100n))
async function stub(chainId, method, params) {
  switch (method) {
    case 'eth_blockNumber':
      return hex(st.head)
    case 'eth_getCode':
      return st.code.get(params[0].toLowerCase()) ?? '0x'
    case 'eth_getStorageAt':
      return st.slots.get(`${params[0].toLowerCase()}:${params[1]}`) ?? '0x0'
    case 'eth_getBalance':
      return '0x0'
    case 'eth_getBlockByNumber': {
      const ts = st.blocks.get(Number(BigInt(params[0])))
      return ts ? { number: params[0], timestamp: hex(ts) } : null
    }
    case 'eth_call': {
      const { to, data } = params[0]
      const v = st.calls.get(`${to.toLowerCase()}:${data.slice(0, 10)}`)
      if (v === undefined) throw new Error('execution reverted')
      return v
    }
    case 'eth_getLogs': {
      const q = params[0]
      const from = Number(BigInt(q.fromBlock))
      const to = Number(BigInt(q.toBlock))
      const addrs = q.address?.map((a) => a.toLowerCase()) ?? null
      return st.logs.filter((l) => Number(BigInt(l.blockNumber)) >= from && Number(BigInt(l.blockNumber)) <= to && (!addrs || addrs.includes(l.address)) && (!q.topics?.[0] || [q.topics[0]].flat().includes(l.topics[0])) && (!q.topics?.[1] || [q.topics[1]].flat().includes(l.topics[1])))
    }
  }
  return null
}
score.setScoreRpcForTest(stub)
mon.setMonitorRpcForTest(stub)

// Sourcify: A, C and F verified exactly (deployed at block 1000 or 2000), D partially, G not verified, H unreachable.
const sourcify = {
  [A]: { match: 'exact_match', compilation: { name: 'VaultProxy' }, deployment: { blockNumber: '1000', transactionHash: '0x' + 'aa'.repeat(32) } },
  [C]: { match: 'exact_match', deployment: { blockNumber: '1000', transactionHash: '0x' + 'cc'.repeat(32) } },
  [D]: { match: 'match', deployment: { blockNumber: '2000', transactionHash: '0x' + 'dd'.repeat(32) } },
  [E]: { match: 'exact_match' },
  [F]: { match: 'exact_match', deployment: { blockNumber: '2000', transactionHash: '0x' + 'ff'.repeat(32) } },
}
// Etherscan V2 fallback (only with ETHERSCAN_API_KEY): ES is verified on Etherscan only, SF fully on Sourcify.
const [ES, SF] = [0x61, 0x62].map((n) => addr(n + 0x10000))
for (const x of [ES, SF]) st.code.set(x, '0x6080')
sourcify[SF] = { match: 'exact_match', deployment: { blockNumber: '1000', transactionHash: '0x' + '5f'.repeat(32) } }
const etherscanHits = []
const holders = { [F]: { state: 'ok', health: { score: 72, verdict: 'mostly spread out' }, summary: { top10Pct: 31, line: 'Top 10 wallets hold 31%.' } } }
const fetched = []
score.setHoldersBaseForTest('http://holders.test')
score.setScoreFetchForTest(async (url) => {
  fetched.push(String(url))
  const u = new URL(String(url))
  const j = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  if (u.hostname === 'sourcify.dev') {
    const a = u.pathname.split('/').pop().toLowerCase()
    if (a === H) throw new TypeError('fetch failed')
    return sourcify[a] ? j(sourcify[a]) : j({ match: null }, 404)
  }
  if (u.hostname === 'holders.test') {
    const a = u.pathname.split('/').pop().toLowerCase()
    return holders[a] ? j(holders[a]) : new Response('<!doctype html><title>Not found</title>', { status: 404, headers: { 'content-type': 'text/html' } })
  }
  if (u.hostname === 'indexer.gullychain.xyz') {
    if (u.pathname === `/tokens/${L}`) return j({ token: launchRow, curve: {}, graduation: null, pools: [] })
    if (u.pathname === '/tokens') return j({ tokens: [launchRow, { ...launchRow, address: addr(0x1234), symbol: 'TWO', graduated: true }] })
    if (u.pathname === `/tokens/${L}/holders`) return j({ holders: [{ address: EOA, balance: '100', pct: 10, tag: null }], holderCount: 1, totalSupply: '1000' })
    if (u.pathname === '/names') return j({ names: { [EOA]: 'gullytester.gully' } })
    return j({ error: 'not found' }, 404)
  }
  if (u.hostname === 'api.etherscan.io') {
    const a = (u.searchParams.get('address') ?? u.searchParams.get('contractaddresses') ?? '').toLowerCase()
    etherscanHits.push(a)
    if (u.searchParams.get('action') === 'getcontractcreation') return j({ status: '1', result: a === ES ? [{ txHash: '0x' + 'ee'.repeat(32), timestamp: String(Math.floor((NOW - 10 * DAY) / 1000)) }] : [] })
    return j({ status: '1', result: [a === ES ? { SourceCode: 'contract EsOnly {}', ContractName: 'EsOnly' } : { SourceCode: '', ContractName: '' }] })
  }
  throw new TypeError(`unexpected fetch ${url}`)
})
score.setLaunchesForTest(async (chainId) => ({ state: 'ok', launches: chainId === 8453 ? [{ token: F, legs: [{ locked: true }, { locked: true }], links: { token: `https://deepcore.fun/tokens/${F}?net=base` } }] : [] }))
let report = null
score.setReportSource(async (chainId, a) => (a === A ? report : null))

const get = async (chainId, a) => (await score.computeScore(chainId, a)).result
const part = (r, id) => r.components.find((c) => c.id === id)
const W = Object.fromEntries(score.COMPONENTS.map((c) => [c.id, c.weight]))

try {
  /* ------------------------------------------------------------- the maths --- */
  check('the weights add up to 100', score.COMPONENTS.reduce((s, c) => s + c.weight, 0) === 100)
  const cb = score.combine([
    { id: 'verified', available: true, score: 100 },
    { id: 'control', available: true, score: 15 },
    { id: 'timelock', available: false, score: null },
    { id: 'upgradeability', available: true, score: 30 },
    { id: 'age', available: true, score: 50 },
  ])
  check('combine: the weighted mean of the available parts', cb.score === Math.round((W.verified * 100 + W.control * 15 + W.upgradeability * 30 + W.age * 50) / (W.verified + W.control + W.upgradeability + W.age)) && cb.coverage === W.verified + W.control + W.upgradeability + W.age && cb.available === 4, JSON.stringify(cb))
  check('combine: a missing part is left out, not counted as 0', score.combine([{ id: 'verified', available: true, score: 100 }, { id: 'control', available: true, score: 100 }, { id: 'review', available: false, score: null }, { id: 'changes', available: false, score: null }, { id: 'timelock', available: true, score: 100 }, { id: 'upgradeability', available: true, score: 100 }]).score === 100)
  check(`combine: under ${score.MIN_COVERAGE} weight points there is no score`, score.combine([{ id: 'verified', available: true, score: 100 }, { id: 'age', available: true, score: 100 }, { id: 'timelock', available: true, score: 100 }]).score === null)
  check('review points: 100 less 40/20/5/1, unresolved when stated', score.reviewPoints({ severities: { critical: 0, high: 1, medium: 2, low: 3 } }) === 67 && score.reviewPoints({ severities: { critical: 2, high: 5 }, unresolved: { critical: 0, high: 1 } }) === 80 && score.reviewPoints({ severities: { critical: 3 } }) === 0)
  check('holder spread points: 20% → 100, 55% → 50, 90% → 0', score.spreadPoints(20) === 100 && score.spreadPoints(55) === 50 && score.spreadPoints(90) === 0 && score.spreadPoints(5) === 100)
  check('age and change points', score.agePoints(400) === 100 && score.agePoints(45) === 50 && score.agePoints(2) === 10 && score.changePoints(0) === 100 && score.changePoints(2) === 50 && score.changePoints(9) === 0)

  /* -------------------------------------------------------- one wallet (A) --- */
  const a = await get(8453, A)
  check('A: verified exact match scores 100, with a Sourcify link', part(a, 'verified').score === 100 && part(a, 'verified').evidence[0].url.includes('sourcify'))
  check('A: one wallet in control scores 15 and names it', part(a, 'control').score === 15 && /single wallet \(0x0000…0e0a\)/.test(part(a, 'control').reason))
  check('A: no delay scores 0 (a real reading, not missing)', part(a, 'timelock').available && part(a, 'timelock').score === 0)
  check('A: upgradeable scores 30 and names the current code', part(a, 'upgradeability').score === 30 && /0x0000…1001/.test(part(a, 'upgradeability').reason))
  check('A: deployed 400 days ago scores 100', part(a, 'age').score === 100 && /400 days ago/.test(part(a, 'age').reason), part(a, 'age').reason)
  check('A: not watched → recent changes not available, with the reason', !part(a, 'changes').available && /does not watch/.test(part(a, 'changes').reason))
  check('A: not a DeepCore launch → liquidity not available', !part(a, 'liquidity').available)
  check('A: Holder Map answers 404 → not available, said plainly', !part(a, 'holders').available && /not running on this server/.test(part(a, 'holders').reason), part(a, 'holders').reason)
  check('A: no report → review not available', !part(a, 'review').available)
  const expectA = Math.round((W.verified * 100 + W.control * 15 + W.timelock * 0 + W.upgradeability * 30 + W.age * 100) / (W.verified + W.control + W.timelock + W.upgradeability + W.age))
  check(`A: score = weighted mean of the 5 available parts (${expectA})`, a.score === expectA && a.coverage.weight === W.verified + W.control + W.timelock + W.upgradeability + W.age && a.coverage.components === 5, `${a.score} ${JSON.stringify(a.coverage)}`)
  check('A: not a token (no transfer/balanceOf) → behaviour not available, said plainly', !part(a, 'behaviour').available && /Not a token/.test(part(a, 'behaviour').reason))
  check('A: name from the chain, grade in words', a.name === 'Vault' && a.grade === score.grade(expectA))
  check('every part carries its weight, source, value and reason', a.components.every((c) => typeof c.weight === 'number' && c.source && c.value && c.reason))

  /* ------------------------------------------ Gully Chain Testnet (read only) --- */
  {
    const pay = await import('../server/payments.mjs')
    const before = fetched.length
    const gc = await get(485590, H)
    check('Gully Chain Testnet: scored from chain reads only (no Sourcify or Etherscan call)', gc?.chainKey === 'gully' && fetched.slice(before).every((u) => !/sourcify|etherscan/.test(u)), JSON.stringify(fetched.slice(before)))
    check('Gully Chain Testnet: the code counts as not verified, saying no service covers the chain', part(gc, 'verified').available && part(gc, 'verified').score === 0 && /no source verification service/.test(part(gc, 'verified').reason) && part(gc, 'verified').evidence[0].url.startsWith('https://testnet-explorer.gullychain.xyz/address/'))
    check('Gully Chain Testnet: control is read from the chain (one wallet)', part(gc, 'control').score === 15)
    check('Gully Chain Testnet: never offered or priced for payment (read-only chain)', !pay.CHAINS[485590] && !pay.ASSETS.some((x) => x.chainId === 485590) && !pay.publicChains({ all: true }).some((c) => c.id === 485590) && pay.chainInfo(485590)?.readOnly === true)
    check('Gully Chain Testnet: not offered for monitoring', !mon.monitorChains().some((c) => c.id === 485590) && mon.scoreChainOf('gully')?.id === 485590)
    const r = await fetch(`${BASE}/api/score/gully/${H}`)
    const j = await r.json()
    check('GET /api/score/gully/:address answers with CORS and the testnet explorer', r.status === 200 && r.headers.get('access-control-allow-origin') === '*' && j.chain?.key === 'gully' && /testnet-explorer\.gullychain\.xyz/.test(j.links?.explorer ?? ''), `${r.status} ${JSON.stringify(j).slice(0, 200)}`)

    // A Gully Launchpad token: known code, the curve holds the liquidity, the creator's record, a simulated 5% fee.
    const gl = await get(485590, L)
    check('Gully Launchpad token: counts as known code (85) and names the launchpad version', part(gl, 'verified').score === 85 && /Gully Launchpad token \(v2\.0\.0\)/.test(part(gl, 'verified').value) && part(gl, 'verified').evidence[0].url.endsWith('/address/0x3378b659f6dda7f13d87599b383b3995f82d0974'), JSON.stringify(part(gl, 'verified')))
    check('Gully Launchpad token: on the curve → liquidity 100, with the creator’s .gully name and record', part(gl, 'liquidity').score === 100 && /On the curve, 2\.88%/.test(part(gl, 'liquidity').value) && /gullytester\.gully/.test(part(gl, 'liquidity').reason) && /launched 2 tokens here, 1 graduated/.test(part(gl, 'liquidity').reason), part(gl, 'liquidity').reason)
    check('Gully Launchpad token: behaviour from the code and a simulated transfer (5% fee → 85; the launchpad’s fixed-supply mint costs nothing)', part(gl, 'behaviour').score === 85 && part(gl, 'behaviour').value === '5% fee on transfer' && part(gl, 'behaviour').simulation?.feePct === 5 && part(gl, 'behaviour').evidence.some((e) => e.url.endsWith(`/address/${EOA}`)), JSON.stringify(part(gl, 'behaviour')))
    check('Gully Launchpad token: age from the launch record (3 days → 10)', part(gl, 'age').available && part(gl, 'age').score === 10, JSON.stringify(part(gl, 'age')))
    check('Gully Launchpad token: the result carries the launch block with the creator’s record', gl.launch?.venue === 'gully-launchpad' && gl.launch.creator?.name === 'gullytester.gully' && gl.launch.creator.launches === 2 && gl.launch.curve.progressPct === 2.88, JSON.stringify(gl.launch))
    check('Gully Launchpad token: a score exists (enough coverage for the app to use it)', typeof gl.score === 'number' && gl.coverage.weight >= score.MIN_COVERAGE, JSON.stringify(gl.coverage))
    check('a non-launch on Gully Chain: liquidity not available, said plainly', !part(gc, 'liquidity').available && /not launched there/.test(part(gc, 'liquidity').reason), part(gc, 'liquidity').reason)
  }

  /* ------------------------------------------------------ other setups --- */
  const c = await get(8453, C)
  check('C: a timelock in control scores 80, a 2-day delay 100', part(c, 'control').score === 80 && part(c, 'timelock').score === 100 && part(c, 'timelock').value === '2 days')
  const d = await get(8453, D)
  check('D: ownership given up scores 100; nothing to delay is not available', part(d, 'control').score === 100 && part(d, 'control').value === 'Nobody' && !part(d, 'timelock').available)
  check('D: a partial Sourcify match scores 85; 45 days old scores 50', part(d, 'verified').score === 85 && part(d, 'age').score === 50)
  const e = await get(8453, E)
  check('E: a minimal clone cannot change its code: 100', part(e, 'upgradeability').score === 100 && /clone/.test(part(e, 'upgradeability').value.toLowerCase()))
  const f = await get(8453, F)
  check('F: a Safe needing 2 of 3 scores 100', part(f, 'control').score === 100 && part(f, 'control').value === 'Safe, 2 of 3')
  check('F: a DeepCore launch with every pool locked scores 100, linked to DeepCore', part(f, 'liquidity').score === 100 && part(f, 'liquidity').evidence[0].url.startsWith('https://deepcore.fun/'))
  check('F: Launch Health from the Holder Map is used when present', part(f, 'holders').score === 72 && part(f, 'holders').evidence[0].url.endsWith(`/holders/base/${F}`))
  const g = await get(8453, G)
  check('G: not verified is a real 0 (available), not missing', part(g, 'verified').available && part(g, 'verified').score === 0)
  check('G: too little data → no score, and the page says how much was read', g.score === null && g.grade === null && g.coverage.weight < score.MIN_COVERAGE, JSON.stringify(g.coverage))
  const h = await get(8453, H)
  check('H: Sourcify unreachable → verified not available (not 0)', !part(h, 'verified').available && /could not be reached/.test(part(h, 'verified').reason))
  check('an address with no code is refused (404), not scored', (await score.computeScore(8453, addr(0x777))).status === 404)
  check('chains without Holder Map coverage say so', !part(await get(8453, D), 'holders').available)

  /* ------------------------------------------- Sourcify first, Etherscan fallback --- */
  check('Sourcify full match: value, provider and match in the part, linked to the contract on sourcify.dev', part(a, 'verified').value === 'Full match (Sourcify)' && part(a, 'verified').provider === 'sourcify' && part(a, 'verified').match === 'full' && part(a, 'verified').evidence[0].label === 'Sourcify: full match' && part(a, 'verified').evidence[0].url === `https://repo.sourcify.dev/8453/${A}`, JSON.stringify(part(a, 'verified')))
  check('Sourcify partial match: said as partial, with the link', part(d, 'verified').value === 'Partial match (Sourcify)' && part(d, 'verified').match === 'partial' && part(d, 'verified').evidence[0].label === 'Sourcify: partial match' && part(d, 'verified').evidence[0].url === `https://repo.sourcify.dev/8453/${D}`)
  check('Sourcify none: not verified, with a Sourcify lookup link', part(g, 'verified').value === 'Not verified' && part(g, 'verified').evidence[0].url === `https://sourcify.dev/#/lookup/${G}`)
  check('without ETHERSCAN_API_KEY Etherscan is never asked', etherscanHits.length === 0)
  process.env.ETHERSCAN_API_KEY = 'test-key-not-real'
  try {
    const sf = await get(8453, SF)
    check('with a key: a full Sourcify match (with its deployment) does not ask Etherscan', part(sf, 'verified').match === 'full' && !etherscanHits.includes(SF), etherscanHits.join())
    const es = await get(8453, ES)
    check('with a key: Sourcify none falls back to Etherscan V2 (verified, age from its creation record)', etherscanHits.includes(ES) && part(es, 'verified').score === 100 && part(es, 'verified').provider === 'etherscan' && part(es, 'verified').value === 'Verified (Etherscan)' && part(es, 'age').available && /10 days ago/.test(part(es, 'age').reason), JSON.stringify(part(es, 'verified')))
  } finally {
    delete process.env.ETHERSCAN_API_KEY
  }

  /* ------------------------------------------------ published reports only --- */
  report = { status: 'draft', publishedAt: null, url: 'https://gullylabs.xyz/security/reports/r1', severities: { critical: 1 } }
  let a2 = await get(8453, A)
  check('a draft report counts for nothing', !part(a2, 'review').available && a2.score === a.score)
  report = { status: 'published', publishedAt: null, url: 'https://gullylabs.xyz/security/reports/r1', severities: { high: 1 } }
  check('a "published" report with no publish date counts for nothing', !part(await get(8453, A), 'review').available)
  report = { status: 'published', publishedAt: '2026-10-01T00:00:00Z', url: 'https://gullylabs.xyz/security/reports/r1', title: 'Vault review', severities: { critical: 0, high: 1, medium: 2, low: 0, info: 3 } }
  a2 = await get(8453, A)
  check('a published report counts, linked, with its severity counts', part(a2, 'review').available && part(a2, 'review').score === 70 && part(a2, 'review').evidence[0].url === report.url && /0 critical, 1 high, 2 medium, 0 low, 3 info/.test(part(a2, 'review').reason), part(a2, 'review').reason)
  check('history: a new point when the score moves', a2.history.length >= 2 && a2.history[a2.history.length - 1].score === a2.score)
  check('change log: the review part moved from not available to 70', a2.changes.some((x) => x.id === 'review' && x.from === null && x.to === 70))
  check('change log starts with "First scored"', a2.changes[0].label === 'First scored')

  /* ------------------------------------------------------ nothing paid --- */
  const src = fs.readFileSync(new URL('../server/gully-score.mjs', import.meta.url), 'utf8')
  const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
  check('the score module imports nothing about plans, payments or accounts', !imports.some((m) => /plans|billing|store|workspaces|developer|access|payments\.mjs$/.test(m) && m !== './payments.mjs') && !imports.some((m) => /plans|billing|store|workspaces|developer|access/.test(m)), imports.join(', '))
  const code = src
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')
  check('computeScore takes a chain and an address, nothing about who asks', score.computeScore.length <= 3 && !/planOf|getAccount|billing|sessionAddress|req.gully/.test(code))
  const anon = makeClient(BASE)
  const r1 = await anon.call(`/api/score/base/${C}`)
  const dev = makeClient(BASE)
  const w = privateKeyToAccount(generatePrivateKey())
  await dev.signIn(w)
  await fetch(BASE + `/api/admin/accounts/${w.address.toLowerCase()}/plan`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'business', days: 30 }) })
  score.resetScoresForTest()
  const r2 = await dev.call(`/api/score/base/${C}`)
  // The reset dropped every stored score: put back the ones the listing checks below rely on.
  await get(8453, A)
  await get(8453, G)
  const same = (x, y) => x.score === y.score && JSON.stringify(x.components.map((p) => [p.id, p.score, p.available])) === JSON.stringify(y.components.map((p) => [p.id, p.score, p.available]))
  check('a Business-plan reader gets exactly the score an anonymous reader gets', r1.status === 200 && r2.status === 200 && same(r1.data, r2.data), `${r1.data?.score} vs ${r2.data?.score}`)

  /* -------------------------------------------- monitoring and listing --- */
  const m1 = await dev.post('/api/developer/monitors', { chain: 'base', address: D, webhookUrl: HOOK, publicScore: true })
  const m2 = await dev.post('/api/developer/monitors', { chain: 'base', address: E, webhookUrl: HOOK, publicScore: false })
  check('two contracts watched (one listed, one not)', m1.status === 201 && m2.status === 201, `${m1.status} ${m2.status} ${m1.data?.error ?? ''}`)
  const dWatched = await get(8453, D)
  check('watched with nothing seen: recent changes 100, "None"', part(dWatched, 'changes').score === 100 && part(dWatched, 'changes').value === 'None')
  const eListed = await get(8453, E)
  const eUnlisted = (await score.computeScore(8453, E)).result
  check('listing on or off does not change a score', eListed.score === eUnlisted.score && same(eListed, eUnlisted))
  await mon.tickMonitorsNow()
  st.logs.push({ address: D, topics: [mon.TOPICS.paused], data: '0x' + word(BigInt(EOA)), blockNumber: hex(st.head + 1), logIndex: '0x0', transactionHash: '0x' + 'ee'.repeat(32) })
  st.head += 10
  await mon.tickMonitorsNow()
  const dAfter = await get(8453, D)
  check('a monitored privileged change lowers "recent changes" to 75, linked to the transaction', part(dAfter, 'changes').score === 75 && part(dAfter, 'changes').evidence[0].url.endsWith('ee'.repeat(32)), JSON.stringify(part(dAfter, 'changes')))
  check('…and is in the change log', dAfter.changes.some((x) => x.id === 'changes' && x.from === 100 && x.to === 75))
  const refreshed = await score.refreshScoresNow({ max: 5 })
  check('the refresh loop recomputes contracts a monitored change touched', refreshed.some((x) => x.key === `8453:${D}`), JSON.stringify(refreshed))

  const idx = await anon.call('/api/score')
  const keys = idx.data.scores.map((r) => r.address)
  check('index: lists the watched-and-listed contract and the one with a published report', keys.includes(D) && keys.includes(A), keys.join())
  check('index: leaves out unlisted and merely looked-up contracts', !keys.includes(E) && !keys.includes(C) && !keys.includes(G))
  check('index: best first, with the methodology', idx.data.scores[0].score >= idx.data.scores[idx.data.scores.length - 1].score && idx.data.methodology.components.length === 10 && idx.data.methodology.rules.some((x) => /Nothing paid goes in/.test(x)))
  check('methodology says informational, not advice', (await anon.call('/api/score/methodology')).data.rules.some((x) => /not an endorsement and not investment advice/.test(x)))

  const sm = await hostRequest(BASE, 'gullylabs.xyz', '/sitemap.xml')
  check('sitemap: /score and the listed score pages', sm.text.includes('https://gullylabs.xyz/score</loc>') && sm.text.includes(`/score/base/${D}</loc>`) && sm.text.includes(`/score/base/${A}</loc>`) && !sm.text.includes(`/score/base/${E}</loc>`))
  const pageD = await hostRequest(BASE, 'gullylabs.xyz', `/score/base/${D}`)
  check('a listed score page: 200, its own title and canonical, indexable', pageD.status === 200 && /Gully Score on Base · Gully Labs<\/title>/.test(pageD.text) && pageD.text.includes(`<link rel="canonical" href="https://gullylabs.xyz/score/base/${D}"`) && !/content="noindex"/.test(pageD.text))
  const pageE = await hostRequest(BASE, 'gullylabs.xyz', `/score/base/${E}`)
  check('an unlisted score page: 200 but noindex', pageE.status === 200 && /content="noindex"/.test(pageE.text))
  check('an unknown chain in the path is a 404 page', (await hostRequest(BASE, 'gullylabs.xyz', `/score/mars/${D}`)).status === 404)
  check('the index page has its title', /Gully Score: transparent contract scores/.test((await hostRequest(BASE, 'gullylabs.xyz', '/score')).text))

  /* ------------------------------------- privacy: private monitors stay private --- */
  // A monitor added with publicScore: false must never feed a public score, the index or the sitemap.
  st.logs.push({ address: E, topics: [mon.TOPICS.paused], data: '0x' + word(BigInt(EOA)), blockNumber: hex(st.head + 1), logIndex: '0x0', transactionHash: '0x' + 'ab'.repeat(32) })
  st.head += 10
  await mon.tickMonitorsNow()
  check('privacy: monitorFacts ignores a private monitor', mon.monitorFacts(8453, E) === null)
  const ePub = await anon.call(`/api/score/base/${E}`)
  check('privacy: a private monitor’s change is not on the public score (recent changes not known)', ePub.status === 200 && part(ePub.data, 'changes').available === false && !JSON.stringify(ePub.data).includes('ab'.repeat(32)), JSON.stringify(part(ePub.data, 'changes')))
  const refreshed2 = await score.refreshScoresNow({ max: 5 })
  check('privacy: a private monitor’s change does not queue a public score refresh', !refreshed2.some((x) => x.key === `8453:${E}`), JSON.stringify(refreshed2))
  const pageE2 = await hostRequest(BASE, 'gullylabs.xyz', `/score/base/${E}`)
  check('privacy: the private contract’s page stays noindex and out of the sitemap', /content="noindex"/.test(pageE2.text) && !(await hostRequest(BASE, 'gullylabs.xyz', '/sitemap.xml')).text.includes(`/score/base/${E}</loc>`))
  // Removing the only public monitor: the stored score built from its events is dropped, not served.
  const dBefore = (await anon.call(`/api/score/base/${D}`)).data
  check('privacy: (setup) the public monitor fed D’s stored score', part(dBefore, 'changes').available === true)
  const del = await dev.post(`/api/developer/monitors/${m1.data.monitor.id}/delete`, {})
  check('privacy: (setup) D’s monitor deleted', del.status === 200, `${del.status} ${JSON.stringify(del.data)}`)
  const dGone = await anon.call(`/api/score/base/${D}`)
  check('privacy: once no public monitor watches D, its score is worked out again without monitoring facts', dGone.status === 200 && part(dGone.data, 'changes').available === false && !JSON.stringify(dGone.data).includes('ee'.repeat(32)), JSON.stringify(part(dGone.data, 'changes')))
  const idx2 = (await anon.call('/api/score')).data.scores.map((r) => r.address)
  const sm2 = (await hostRequest(BASE, 'gullylabs.xyz', '/sitemap.xml')).text
  check('privacy: D leaves the index and the sitemap with its monitor', !idx2.includes(D) && !sm2.includes(`/score/base/${D}</loc>`), idx2.join())

  /* ---------------------------------------------------------------- the badge --- */
  const badge = await fetch(`${BASE}/score/base/${A}/badge.svg`)
  const svg = await badge.text()
  check('badge: served as SVG, cacheable, open to any origin', badge.status === 200 && /image\/svg\+xml/.test(badge.headers.get('content-type')) && /max-age=3600/.test(badge.headers.get('cache-control')) && badge.headers.get('access-control-allow-origin') === '*')
  check('badge: well-formed XML', wellFormed(svg), svg.slice(0, 120))
  const stored = (await anon.call(`/api/score/base/${A}`)).data
  const date = new Date(stored.computedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  // The badge is the shared kit badge (server/badges.mjs): every letter is a path, so the score, grade and date are
  // read from its <title> and aria-label; the geometry and colour checks live in scripts/test-badges.mjs.
  check('badge: the title says the score, the grade and the date it was read', svg.includes(`<title>Gully Score ${stored.score} out of 100 (${stored.grade}), ${date}</title>`) && svg.includes(`aria-label="Gully Score ${stored.score} out of 100 (${stored.grade}), ${date}"`), date)
  check('badge: paths only (no <text>), the kit mark is embedded and it links back', !/<text/.test(svg) && svg.includes('data:image/png;base64,iVBOR') && /<image [^>]*width="21" height="20"/.test(svg) && svg.includes(`https://gullylabs.xyz/score/base/${A}`))
  check('badge: kit colours only', [...svg.matchAll(/#[0-9A-Fa-f]{6}/g)].every((m) => ['#0D141C', '#2A3542', '#151D28', '#D9B563', '#F4F2EC', '#7D8794', '#6F7560', '#F2D58A', '#AEB5BE', '#2F6B35', '#3C553B'].includes(m[0].toUpperCase())))
  check('badge: ?size=L&theme=light is honoured (36 px tall, bone field)', /height="36"/.test(await (await fetch(`${BASE}/score/base/${A}/badge.svg?size=L&theme=light`)).text()) && (await (await fetch(`${BASE}/score/base/${A}/badge.svg?theme=light`)).text()).includes('#F4F2EC'))
  const blank = await (await fetch(`${BASE}/score/base/${addr(0x777)}/badge.svg`)).text()
  check('badge for a contract never scored: valid, says so, no number', wellFormed(blank) && blank.includes('<title>Gully Score: not scored yet</title>') && !/out of 100/.test(blank))
  const gb = await (await fetch(`${BASE}/score/base/${G}/badge.svg`)).text()
  check('badge with too little data: N/A, not 0', wellFormed(gb) && gb.includes('<title>Gully Score: not enough data</title>') && !/out of 100/.test(gb))
  check('badge on an unknown chain: 404', (await fetch(`${BASE}/score/mars/${A}/badge.svg`)).status === 404)
  check('the badge never computes (a page view does)', !fetched.some((u) => u.includes(addr(0x777))))
} catch (err) {
  check(`unexpected error: ${err?.stack ?? err}`, false)
} finally {
  receiver.close()
  console.log(`\n${t.passed} passed, ${t.failed} failed`)
  process.exit(t.failed ? 1 : 0)
}

/** A small well-formedness check: tags nest and close, attributes are quoted, one root. */
function wellFormed(xml) {
  const s = xml.replace(/<\?xml[^>]*\?>/, '').trim()
  if (!s.startsWith('<svg') || !s.endsWith('</svg>')) return false
  const stack = []
  const re = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g
  let last = 0
  let m
  while ((m = re.exec(s))) {
    if (/[<>]/.test(s.slice(last, m.index))) return false
    last = re.lastIndex
    if (m[1]) {
      if (stack.pop() !== m[2]) return false
    } else if (!m[4]) stack.push(m[2])
    if (!stack.length && last !== s.length) return false
  }
  return stack.length === 0 && last === s.length
}
