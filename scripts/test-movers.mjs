// Top-movers computation (server/movers.mjs) against synthetic history: no server, no network.
// Run: npm run test:movers
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeMovers, shapeMovers } from '../server/movers.mjs'

const NOW = Date.parse('2026-10-16T15:00:00Z')
const nowS = NOW / 1000
const STEP = 300

/** Five-minute points from `hoursBack` ago to now, gap and price from a function of the age in seconds. */
function series(hoursBack, f, { endAgo = 0 } = {}) {
  const out = []
  for (let t = nowS - hoursBack * 3600; t <= nowS - endAgo; t += STEP) {
    const [gap, price] = f(nowS - t)
    out.push([t, gap, price, price])
  }
  return out
}

const row = (ticker, status = 'drifting', gapPct = 1.5, chain = 'robinhood') => ({ chain, ticker, name: ticker + ' Inc', token: '0x' + ticker, status, gapPct, onchain: 100, fair: 99, pool: { liquidityUsd: 50_000 } })

test('ranks by absolute gap change and price change over 24h', () => {
  const hist = {
    // gap 0.5 -> 2.5 (+2.0 pp), price 100 -> 110 (+10%)
    'robinhood:AAA': series(26, (age) => (age >= 86400 ? [0.5, 100] : age === 0 ? [2.5, 110] : [1, 105])),
    // gap 1 -> -2 (-3.0 pp), price 50 -> 49 (-2%)
    'robinhood:BBB': series(26, (age) => (age >= 86400 ? [1, 50] : age === 0 ? [-2, 49] : [0, 50])),
    // gap flat, price 10 -> 13 (+30%)
    'bsc:CCC': series(26, (age) => (age >= 86400 ? [0.2, 10] : age === 0 ? [0.2, 13] : [0.2, 11])),
  }
  const rows = [row('AAA', 'premium', 2.5), row('BBB', 'discount', -2), row('CCC', 'in-line', 0.2, 'bsc')]
  const m = computeMovers({ rows, historyOf: (c, t) => hist[`${c}:${t}`] ?? [], window: '24h', now: NOW })
  assert.equal(m.eligible, 3)
  assert.equal(m.note, null)
  assert.deepEqual(
    m.byGap.map((e) => [e.ticker, e.gapChangePp]),
    [
      ['BBB', -3],
      ['AAA', 2],
      ['CCC', 0],
    ],
  )
  assert.deepEqual(
    m.byPrice.map((e) => [e.ticker, e.priceChangePct]),
    [
      ['CCC', 30],
      ['AAA', 10],
      ['BBB', -2],
    ],
  )
  assert.equal(m.asOf, new Date(NOW).toISOString())
  assert.equal(m.from, new Date(NOW - 86_400_000).toISOString())
  const a = m.byGap.find((e) => e.ticker === 'AAA')
  assert.equal(a.from, new Date(NOW - 86_400_000).toISOString())
  assert.equal(a.gapThen, 0.5)
  assert.ok(a.spark.length <= 48 && a.spark.at(-1)[1] === 2.5, 'spark is thinned and ends on the latest point')
})

test('1h window uses the snapshot closest to one hour ago', () => {
  const hist = { 'robinhood:AAA': series(3, (age) => [age >= 3600 ? 1 : 1.75, 100]) }
  const m = computeMovers({ rows: [row('AAA')], historyOf: (c, t) => hist[`${c}:${t}`] ?? [], window: '1h', now: NOW })
  assert.equal(m.byGap[0].gapChangePp, 0.75)
  assert.equal(m.byGap[0].from, new Date(NOW - 3_600_000).toISOString())
})

test('untrusted, stale and too-short series are left out, and the answer says why', () => {
  const hist = {
    'robinhood:THIN': series(30, () => [5, 100]),
    'robinhood:SHORT': series(3, () => [1, 100]),
    'robinhood:OLD': series(30, () => [1, 100], { endAgo: 7200 }),
  }
  const rows = [row('THIN', 'thin', 5), row('SHORT'), row('OLD'), row('NONE'), row('UNREAD', 'feed-unreadable', null)]
  const m = computeMovers({ rows, historyOf: (c, t) => hist[`${c}:${t}`] ?? [], window: '24h', now: NOW })
  assert.equal(m.eligible, 0)
  assert.deepEqual(m.byGap, [])
  assert.deepEqual(m.left, { untrusted: 2, noHistory: 1, staleHistory: 1, tooShort: 1 })
  assert.equal(m.asOf, null)
  assert.match(m.note, /^Needs 24h of snapshots: the longest series so far covers 3 h\.$/)
})

test('a gap in the history wider than the tolerance is not bridged', () => {
  // points only from 30h to 27h ago, then the last 2 hours: nothing within 2h of 24h ago
  const pts = [...series(30, () => [1, 100]).filter((p) => nowS - p[0] >= 27 * 3600), ...series(2, () => [2, 100])]
  const m = computeMovers({ rows: [row('GAP')], historyOf: () => pts, window: '24h', now: NOW })
  assert.equal(m.eligible, 0)
  assert.equal(m.left.tooShort, 1)
})

test('shapeMovers cuts to the limit, filters a chain and finds one stock', () => {
  const hist = Object.fromEntries(['A', 'B', 'C'].map((t, i) => [`robinhood:${t}`, series(25, (age) => [age >= 86400 ? 0 : i + 1, 100])]))
  hist['bsc:D'] = series(25, (age) => [age >= 86400 ? 0 : 9, 100])
  const rows = [row('A'), row('B'), row('C'), row('D', 'drifting', 1.5, 'bsc')]
  const full = computeMovers({ rows, historyOf: (c, t) => hist[`${c}:${t}`] ?? [], now: NOW })
  const top = shapeMovers(full, { limit: 2 })
  assert.deepEqual(
    top.byGap.map((e) => e.ticker),
    ['D', 'C'],
  )
  const rh = shapeMovers(full, { limit: 2, chain: 'robinhood', ticker: 'A' })
  assert.deepEqual(
    rh.byGap.map((e) => e.ticker),
    ['C', 'B'],
  )
  assert.equal(rh.stock.ticker, 'A')
  assert.equal(shapeMovers(full, { chain: 'robinhood', ticker: 'ZZZ' }).stock, null)
})
