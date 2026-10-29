// The home ledger's data (server/stats.mjs) and its watchdog (server/stats-watchdog.mjs), against a stubbed network:
//   - per-venue daily series for volume, fees and value locked, the venue's own API first and DefiLlama second;
//   - the source named per series, `fallback` set when DefiLlama filled it;
//   - lastActivity (the last non-zero volume day), a flat venue series replaced by DefiLlama's when that shows activity;
//   - graceful degradation (DefiLlama down, an unknown slug), the cache, and Cartel Family never coming back;
//   - the pure window logic the chart uses (src/lib/ledgerSeries.ts);
//   - the watchdog: error / empty / flat, one Telegram alert per venue per day, the daily cap, the retry pause.
//   npm run test:stats      (no build, no network, no real Telegram)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-stats-'))
process.env.DATA_DIR = tmp

const DAY = 86400
const today = Math.floor(Date.now() / 1000 / DAY) * DAY
const dayN = (n) => today - n * DAY // n days ago, seconds

/* ---- the stubbed network ---- */
const calls = []
let llamaDown = false
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const llamaChart = (pts) => ({ total24h: pts.at(-1)?.[1] ?? 0, total7d: 0, totalAllTime: pts.reduce((a, p) => a + p[1], 0), chains: ['Robinhood'], totalDataChart: pts })
const tvlDoc = (pts) => ({ currentChainTvls: { Robinhood: pts.at(-1).totalLiquidityUSD }, tvl: pts })
// Peddles: trades up to 12 days ago, then none. Fees follow the trades.
const peddlesVol = Array.from({ length: 40 }, (_, i) => [dayN(39 - i), 39 - i >= 12 ? 100 + i : 0])
const peddlesFees = peddlesVol.map(([t, v]) => [t, v / 100])
// Value locked history ends YESTERDAY, so today's point must come from the venue's own reading.
const peddlesTvl = Array.from({ length: 40 }, (_, i) => ({ date: dayN(40 - i), totalLiquidityUSD: 60_000 + i * 100 }))
const questTvl = Array.from({ length: 20 }, (_, i) => ({ date: dayN(19 - i), totalLiquidityUSD: 5000 + i }))

globalThis.fetch = async (input) => {
  const url = String(input?.url ?? input)
  calls.push(url)
  const u = new URL(url)
  if (u.hostname === 'api.llama.fi') {
    if (llamaDown) throw new TypeError('fetch failed')
    if (u.pathname === '/summary/dexs/peddles') return json(llamaChart(peddlesVol))
    if (u.pathname === '/summary/fees/peddles') return json(llamaChart(peddlesFees))
    if (u.pathname === '/protocol/peddles') return json(tvlDoc(peddlesTvl))
    if (u.pathname === '/summary/fees/peddlequest') return json(llamaChart(Array.from({ length: 20 }, (_, i) => [dayN(19 - i), i % 3 === 0 ? 2 : 0])))
    if (u.pathname === '/protocol/peddlequest') return json(tvlDoc(questTvl))
    return json({ message: 'Protocol not found' }, 404)
  }
  if (u.hostname.endsWith('peddleswap.xyz')) {
    if (u.hostname !== 'api.peddleswap.xyz') throw new TypeError('fetch failed')
    return json({ volumeUsd24h: 0, tvlUsd: 0, fees24hUsd: 0, counts: { pools: 0, activeLocks: 0 }, volumeSeries: Array.from({ length: 30 }, (_, i) => ({ t: (dayN(29 - i)) * 1000, v: 0 })), tvlSeries: Array.from({ length: 5 }, (_, i) => ({ t: (dayN(5 - i)) * 1000, v: 0 })) })
  }
  if (u.hostname === 'indexer.gullychain.xyz') {
    const row = (a, vol) => ({ address: a, symbol: 'T', source: 'launchpad', creator: '0x' + '12'.repeat(20), createdAt: dayN(1), createdBlock: '74', win: { h24: { vol, buys: 1, sells: 1, makers: 1 } }, liquidityEth: 0.5, mcapEth: 2, holders: 3, txns: 4, progressPct: 10, graduated: false, pool: null, pools: [] })
    if (u.pathname === '/head') return json({ chainId: 485590, block: 207, timestamp: dayN(0) })
    if (u.pathname === '/tokens') return json({ tokens: [row('0x' + 'a1'.repeat(20), 0.25), row('0x' + 'a2'.repeat(20), 0.75)] })
    if (u.pathname.endsWith('/candles')) return json({ candles: [{ t: dayN(20), v: 1 }, { t: dayN(19), v: 0.5 }, { t: dayN(0), v: 0 }] })
    return json({ error: 'not found' }, 404)
  }
  if (u.hostname === 'api.peddles.xyz') {
    if (u.pathname.endsWith('/analytics/platform')) return json({ data: { chains: [{ chainId: 4663, tvlUsd: 72_000, volume24hUsd: 0 }], poolCount: 4, totalUsers: 9, launches24h: 0 } })
    return json({ data: { creatorFees: { total: { symbol: 'ETH', currentRaw: '1000000000000000', decimals: 18 } }, allTime: { volume: { since: '2026-09-01' } } } })
  }
  throw new TypeError(`fetch failed (stub: ${u.hostname})`)
}

// The server imports its own modules with extensions; the chart's pure helpers import './stats' without one.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('./') && !path.extname(spec) && ctx.parentURL?.includes('/src/')) return next(spec + '.ts', ctx)
    return next(spec, ctx)
  },
})

const S = await import('../server/stats.mjs')
const W = await import('../server/stats-watchdog.mjs')
const N = await import('../server/intake-notify.mjs')
const L = await import('../src/lib/ledgerSeries.ts')

const venue = (doc, key) => doc.venues.find((v) => v.key === key)
const iso = (t) => new Date(t * 1000).toISOString()

test('every venue carries series for volume, fees and value locked, with a source per series', async () => {
  S.resetStatsForTest()
  const doc = await S.readStats()
  assert.equal(doc.venues.length, 4)
  assert.ok(!doc.venues.some((v) => /cartel/i.test(v.key)), 'Cartel Family never comes back')
  assert.ok(!doc.venues.some((v) => v.key === 'deepcore'), 'DeepCore is not read since the partnership ended (2026-10-29)')
  assert.ok(!calls.some((c) => /deepcore/i.test(c)), 'nothing asks DeepCore or its DefiLlama adapter')
  for (const v of doc.venues) {
    assert.equal(v.state, 'ok', `${v.key} read`)
    assert.deepEqual(Object.keys(v.series).sort(), ['fees', 'tvl', 'volume'])
    assert.deepEqual(Object.keys(v.sources).sort(), ['fees', 'tvl', 'volume'])
    assert.deepEqual(v.daily, v.series.volume, 'daily stays for older readers')
    for (const m of ['volume', 'fees', 'tvl']) for (const p of v.series[m]) assert.ok(Number.isFinite(p.t) && Number.isFinite(p.v))
  }
})

test('Gully Chain Testnet: test-ETH figures only, never in the dollar totals or the stacked chart', async () => {
  const doc = await S.readStats()
  const g = venue(doc, 'gullychain')
  assert.equal(g.state, 'ok')
  assert.equal(g.testnet, true)
  assert.equal(g.noUsd, true)
  for (const f of ['volumeAllUsd', 'volume24hUsd', 'tvlUsd', 'fees24hUsd', 'feesAllUsd']) assert.equal(g[f], null, f)
  assert.deepEqual(g.daily, [])
  assert.equal(g.native.symbol, 'ETH')
  assert.equal(g.native.testnet, true)
  assert.equal(g.native.volume24h, 1)
  assert.equal(g.native.volumeAll, 3)
  assert.deepEqual(g.native.daily, [{ t: dayN(20), v: 2 }, { t: dayN(19), v: 1 }, { t: dayN(0), v: 0 }])
  assert.equal(g.lastActivity, iso(dayN(19) + 86399), 'the end of its last day with volume')
  assert.equal(g.counts.launches, 2)
  assert.equal(g.counts.holders, 6)
  assert.match(g.sourceNote, /block 207/)
  for (const f of Object.keys(doc.totals.covers)) assert.ok(!doc.totals.covers[f].includes('gullychain'), `${f} never covered by the testnet`)
  assert.ok(g.notes.some((n) => /test ETH/.test(n)))
})

test('Peddles has no daily series of its own: DefiLlama fills volume, fees and TVL, named as the fallback', async () => {
  const p = venue(await S.readStats(), 'peddles')
  assert.ok(p.series.volume.length >= 30)
  assert.ok(p.series.fees.length >= 30)
  for (const m of ['volume', 'fees']) {
    assert.equal(p.sources[m].name, 'DefiLlama')
    assert.equal(p.sources[m].fallback, true)
    assert.match(p.sources[m].url, /^https:\/\/api\.llama\.fi\/summary\//)
  }
  assert.match(p.sources.tvl.name, /^DefiLlama/)
  assert.equal(p.sources.tvl.fallback, true)
})

test('lastActivity is the last day with non-zero volume, even when the window since is all zero', async () => {
  const doc = await S.readStats()
  const p = venue(doc, 'peddles')
  assert.equal(p.lastActivity, iso(dayN(12)))
  assert.ok(p.series.volume.slice(-7).every((x) => x.v === 0), 'the last week is flat')
  assert.equal(venue(doc, 'peddleswap').lastActivity, null, 'a venue that never traded has none')
  assert.equal(doc.lastActivity, iso(dayN(12)), 'the document carries the newest')
})

test("the venue's own series comes first; DefiLlama only when it is empty or flat while DefiLlama shows activity", async () => {
  S.resetStatsForTest()
  // PeddleSwap: own 30 zeros, no DefiLlama: own.
  const ps = venue(await S.readStats(), 'peddleswap')
  assert.equal(ps.series.volume.length, 30)
  assert.equal(ps.sources.volume.fallback, false)
})

test("TVL: DefiLlama's history, with the venue's own reading as today's point and the source saying so", async () => {
  S.resetStatsForTest()
  const p = venue(await S.readStats(), 'peddles')
  const lastPt = p.series.tvl.at(-1)
  assert.equal(lastPt.t, today)
  assert.equal(lastPt.v, 72_000, "today is the Peddles API's own reading")
  assert.match(p.sources.tvl.name, /DefiLlama \+ Peddles API \(latest point\)/)
  const q = venue(await S.readStats(), 'peddlequest')
  assert.equal(q.series.tvl.at(-1).v, 5019, 'PeddleQuest has no API of its own: DefiLlama only')
  assert.equal(q.sources.tvl.name, 'DefiLlama')
})

test('a venue that cannot supply a metric says so with [] and a null source, never zeros', async () => {
  const q = venue(await S.readStats(), 'peddlequest')
  assert.deepEqual(q.series.volume, [])
  assert.equal(q.sources.volume, null)
  assert.ok(q.series.fees.length > 0)
})

test('an unknown DefiLlama slug degrades quietly with a note; the venue stays ok', async () => {
  S.resetStatsForTest()
  const ps = venue(await S.readStats(), 'peddleswap')
  assert.equal(ps.state, 'ok')
  assert.deepEqual(ps.series.fees, [])
  assert.ok(ps.notes.some((n) => /DefiLlama has no fees history for peddleswap/.test(n)))
  assert.ok(ps.series.tvl.length >= 5, 'TVL comes from the venue API when DefiLlama has none')
  assert.equal(ps.sources.tvl?.name, 'PeddleSwap API')
  assert.deepEqual(W.findIssues({ venues: [ps] }), [], 'so the watchdog sees no empty series')
})

test('summedTvl: chains summed per day, a skipped day carries the last value, nothing before a first point', () => {
  const d = (n) => (20_000 + n) * 86400
  const a = [{ t: d(1) * 1000, v: 10 }, { t: d(3) * 1000, v: 30 }]
  const b = [{ t: d(2), v: 5 }, { t: d(3), v: 'x' }]
  assert.deepEqual(S.summedTvl([a, b, undefined]), [{ t: d(1), v: 10 }, { t: d(2), v: 15 }, { t: d(3), v: 35 }])
})

test('DefiLlama down: venues stay readable on their own APIs, series fall back to what they publish', async () => {
  S.resetStatsForTest()
  llamaDown = true
  try {
    const doc = await S.readStats()
    assert.deepEqual(doc.totals.unread.filter((k) => k !== 'peddlequest'), [])
    assert.equal(venue(doc, 'peddlequest').state, 'error', 'PeddleQuest has no other source, so it says unreadable')
    assert.equal(venue(doc, 'peddleswap').series.volume.length, 30)
    assert.deepEqual(venue(doc, 'peddles').series.volume, [])
  } finally {
    llamaDown = false
  }
})

test('the document is cached, and DefiLlama is read once per ten minutes even across documents', async () => {
  S.resetStatsForTest()
  calls.length = 0
  await S.readStats()
  const before = calls.length
  await S.readStats()
  assert.equal(calls.length, before, 'cached document: no new calls')
  S.resetStatsForTest({ documentOnly: true })
  await S.readStats()
  assert.equal(calls.filter((u) => u.includes('api.llama.fi')).length, new Set(calls.filter((u) => u.includes('api.llama.fi'))).size, 'every DefiLlama URL was read once')
})

/* ---- the chart's pure logic ---- */

const mk = (key, vol, tvl = [], fees = [], extra = {}) => ({ key, state: 'ok', daily: vol, series: { volume: vol, tvl, fees }, ...extra })
const pts = (vals, end = today) => vals.map((v, i) => ({ t: end - (vals.length - 1 - i) * DAY, v }))

test('window logic: the default metric is the one with data, volume wins when trades are in the window', () => {
  const flat = mk('a', pts([0, 0, 0, 0, 0, 0, 0, 0]), pts([10, 10, 11, 11, 12, 12, 12, 13]))
  assert.equal(L.autoMetric([flat], 7), 'tvl')
  const trading = mk('a', pts([0, 0, 0, 0, 0, 0, 4, 5]), pts([10, 10, 11, 11, 12, 12, 12, 13]))
  assert.equal(L.autoMetric([trading], 7), 'volume')
  assert.equal(L.autoMetric([mk('a', pts([0, 0]))], 7), 'tvl', 'nothing anywhere: value locked, which then shows the ghost')
  assert.equal(L.autoMetric([mk('a', pts([0, 0]), [], pts([0, 0, 3]))], 7), 'fees')
})

test('window logic: windows are consecutive days, gaps are null (TVL carries a short gap), empty windows have no data', () => {
  const v = mk('a', [{ t: today - 3 * DAY, v: 1 }, { t: today, v: 3 }], [{ t: today - 5 * DAY, v: 50 }])
  const days = L.windowDays([v], 'volume', 7)
  assert.equal(days.length, 7)
  assert.equal(days.at(-1), today)
  assert.equal(L.valueOn(v, 'volume', today - DAY), null, 'a missing volume day is no reading, not zero')
  assert.equal(L.valueOn(v, 'tvl', today - 2 * DAY), 50, 'TVL carries the last reading across a short gap')
  assert.equal(L.valueOn(v, 'tvl', today), null, 'but not for ever')
  assert.deepEqual(L.windowDays([mk('a', [])], 'volume', 7), [])
  assert.equal(L.hasData([mk('a', pts([0, 0, 0]))], 'volume', L.windowDays([mk('a', pts([0, 0, 0]))], 'volume', 7)), false)
})

test('the empty line names the window and the last trade; without one it says so', () => {
  const f = (t) => `D${t}`
  assert.equal(L.emptyLine('volume', 7, 123, f), 'No trades in the last 7 days · last trade D123')
  assert.equal(L.emptyLine('volume', 7, null, f), 'No trades in the last 7 days · last trade not on record')
  const a = mk('a', pts([0, 0, 0]), [], [], { lastActivity: iso(dayN(12)) })
  assert.equal(L.lastActive([a], 'volume'), dayN(12))
})

test('sparklines use the column asked for, else the first metric that has activity', () => {
  const v = mk('a', pts([0, 0, 0]), pts([5, 6, 7]))
  assert.equal(L.sparkPoints(v, 'volume').metric, 'tvl')
  assert.equal(L.sparkPoints(v, 'tvl').metric, 'tvl')
  assert.equal(L.sparkPoints(mk('a', pts([1, 2, 3])), 'volume').metric, 'volume')
})

/* ---- the watchdog ---- */

const sent = []
let sendOk = true
N.setIntakeNotifyForTest({ retryMs: 0, send: { admin: async (html) => (sent.push(html), sendOk ? { ok: true } : { ok: false, error: 'boom' }), chat: async () => ({ ok: true }) } })
const good = (key, extra = {}) => ({ key, state: 'ok', series: { volume: pts([1, 2, 3, 4]), tvl: pts([5, 6, 7, 8]), fees: pts([1, 1, 1, 1]) }, volume24hUsd: 4, volumeAllUsd: 100, feesAllUsd: 10, ...extra })
const docOf = (...venues) => ({ venues })
const NOW = Date.parse('2026-10-19T10:00:00Z')

test('findIssues: unreadable, missing series, and a flat series over a moving venue', () => {
  assert.deepEqual(W.findIssues(docOf(good('peddleswap'), good('peddles'))), [])
  const err = W.findIssues(docOf({ key: 'peddles', state: 'error', error: 'HTTP 502' }))
  assert.deepEqual(err.map((i) => i.kind), ['error'])
  assert.match(err[0].detail, /HTTP 502/)
  const empty = W.findIssues(docOf(good('peddles', { series: { volume: [], tvl: pts([1, 2]), fees: [] } })))
  assert.deepEqual(empty.map((i) => i.kind), ['empty'])
  assert.match(empty[0].detail, /volume/)
  const flat = (o) => good('peddles', { series: { volume: pts([0, 0, 0, 0]), tvl: pts([1, 2]), fees: [] }, ...o })
  assert.deepEqual(W.findIssues(docOf(flat({ volume24hUsd: 0, volumeAllUsd: 100 })), { peddles: { volumeAllUsd: 100, feesAllUsd: 10 } }), [], 'flat and totals still: a quiet venue, fine')
  const moved = W.findIssues(docOf(flat({ volume24hUsd: 0, volumeAllUsd: 150 })), { peddles: { volumeAllUsd: 100, feesAllUsd: 10 } })
  assert.deepEqual(moved.map((i) => i.kind), ['flat'])
  assert.match(moved[0].detail, /all-time volume moved/)
  assert.deepEqual(W.findIssues(docOf(flat({ volume24hUsd: 25 }))).map((i) => i.kind), ['flat'], '24 h volume while the series is flat')
  assert.deepEqual(W.findIssues(docOf({ key: 'peddlequest', state: 'ok', series: { volume: [], tvl: pts([1, 2]), fees: pts([1, 2]) }, volume24hUsd: null })), [], 'PeddleQuest has no volume by design')
})

test('watchdog: ONE alert per venue per day, however many passes', async () => {
  const bad = docOf({ key: 'peddles', state: 'error', error: 'HTTP 502' }, good('peddleswap'))
  sent.length = 0
  let r = await W.watchdogTick({ now: NOW, doc: bad })
  assert.deepEqual(r.alerted, ['peddles'])
  assert.equal(sent.length, 1)
  assert.match(sent[0], /Live ledger data: Peddles/)
  assert.match(sent[0], /HTTP 502/)
  assert.match(sent[0], /admin\.gullylabs\.xyz\/#health/)
  for (let i = 1; i <= 5; i++) await W.watchdogTick({ now: NOW + i * 15 * 60_000, doc: bad })
  assert.equal(sent.length, 1, 'five more passes the same day: still one')
  assert.equal(W.statsWatchdogHealth().issues.length, 1, 'the Health card still shows it')
  r = await W.watchdogTick({ now: NOW + 86_400_000, doc: bad })
  assert.equal(sent.length, 1, 'the next UTC day, the same problem: no repeat')
  assert.match(sent[0], /when this changes, or in 7 days/)
  const worse = docOf({ key: 'peddles', state: 'error', error: 'HTTP 503' }, good('peddleswap'))
  await W.watchdogTick({ now: NOW + 86_400_000 + 60_000, doc: worse })
  assert.equal(sent.length, 2, 'the problem changed: one more')
  await W.watchdogTick({ now: NOW + 8 * 86_400_000 + 60_000, doc: worse })
  assert.equal(sent.length, 3, 'still the same after 7 days: a reminder')
  await W.watchdogTick({ now: NOW + 9 * 86_400_000, doc: docOf(good('peddles'), good('peddleswap')) })
  await W.watchdogTick({ now: NOW + 9 * 86_400_000 + 60_000, doc: worse })
  assert.equal(sent.length, 4, 'fine, then broken again: a relapse alerts at once')
})

test('watchdog: another venue is its own alert; the daily total is capped; a failed send waits an hour', async () => {
  sent.length = 0
  const day = NOW + 13 * 86_400_000
  const many = docOf(...['peddleswap', 'peddles', 'peddlequest', 'x1', 'x2', 'x3', 'x4', 'x5'].map((key) => ({ key, state: 'error', error: 'down' })))
  await W.watchdogTick({ now: day, doc: many })
  assert.equal(sent.length, W.MAX_PER_DAY, `capped at ${W.MAX_PER_DAY}`)
  await W.watchdogTick({ now: day + 20 * 60_000, doc: many })
  assert.equal(sent.length, W.MAX_PER_DAY, 'and not past it later the same day')

  sent.length = 0
  sendOk = false
  const day2 = NOW + 15 * 86_400_000
  const one = docOf({ key: 'peddles', state: 'error', error: 'down, a new reason' })
  const origErr = console.error
  console.error = () => undefined
  try {
    await W.watchdogTick({ now: day2, doc: one })
    const afterFirst = sent.length
    await W.watchdogTick({ now: day2 + 15 * 60_000, doc: one })
    assert.equal(sent.length, afterFirst, 'a failed send is not retried within the hour')
    sendOk = true
    await W.watchdogTick({ now: day2 + 61 * 60_000, doc: one })
    assert.equal(sent.length > afterFirst, true, 'it is retried after the hour')
    assert.deepEqual(W.statsWatchdogHealth().alerted, ['peddles'])
  } finally {
    console.error = origErr
    sendOk = true
  }
})

test('watchdog: totals are remembered only for venues that read fine, and a flat series with moving totals is caught on the next pass', async () => {
  sent.length = 0
  const day = NOW + 20 * 86_400_000
  const flatDoc = (all) => docOf(good('peddles', { series: { volume: pts([0, 0, 0, 0]), tvl: pts([1, 2]), fees: pts([1, 2]) }, volume24hUsd: 0, volumeAllUsd: all }))
  await W.watchdogTick({ now: day, doc: flatDoc(100) })
  assert.equal(sent.length, 0, 'first sight of a flat series with nothing to compare against: quiet')
  await W.watchdogTick({ now: day + 15 * 60_000, doc: flatDoc(180) })
  assert.equal(sent.length, 1)
  assert.match(sent[0], /flat/)
})

test.after(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})
