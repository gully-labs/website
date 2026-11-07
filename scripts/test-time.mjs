// One clock for everything a person reads: Los Angeles, labelled PT, daylight saving handled by Intl (src/lib/time.ts).
// npm run test:time
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
after(() => vite.close())
const T = await vite.ssrLoadModule('/src/lib/time.ts')
const S = await import('../server/time-la.mjs')

test('summer is PDT (UTC-7), winter is PST (UTC-8), no fixed offset', () => {
  assert.equal(T.timePT('2026-07-01T20:05:09Z'), '13:05 PT')
  assert.equal(T.timePT('2026-12-01T20:05:09Z'), '12:05 PT')
  assert.equal(T.timePT('2026-12-01T20:05:09Z', true), '12:05:09 PT')
})
test('the day is the Los Angeles day, across midnight UTC', () => {
  assert.equal(T.dayPT('2026-11-07T02:00:00Z'), '2026-11-06')
  assert.equal(T.dateTimePT('2026-11-07T02:00:00Z'), 'Nov 6, 18:00 PT')
  assert.equal(T.datePT('2026-11-07T02:00:00Z'), 'Nov 6, 2026')
})
test('a 23 hour day (clocks forward) and a 25 hour day (clocks back) keep every day once', () => {
  for (const now of ['2026-03-09T20:00:00Z', '2026-11-02T20:00:00Z']) {
    const d = T.lastDaysPT(5, now)
    assert.equal(new Set(d.map((x) => x.key)).size, 5)
    assert.deepEqual(d.map((x) => x.key), [...d.map((x) => x.key)].sort())
  }
  assert.deepEqual(T.lastDaysPT(2, '2026-11-07T02:00:00Z'), [{ key: '2026-11-05', label: 'Nov 5' }, { key: '2026-11-06', label: 'Nov 6' }])
})

test('the server buckets by the Los Angeles day across both clock changes', () => {
  // Clocks go forward on 2026-03-08 (23 hours), back on 2026-11-01 (25 hours).
  assert.equal(S.dayLA('2026-11-07T02:00:00Z'), '2026-11-06')
  assert.equal(new Date(S.dayStartLA('2026-03-08T20:00:00Z')).toISOString(), '2026-03-08T08:00:00.000Z')
  assert.equal(new Date(S.nextDayStartLA('2026-03-08T20:00:00Z')).toISOString(), '2026-03-09T07:00:00.000Z')
  assert.equal(new Date(S.dayStartLA('2026-11-01T20:00:00Z')).toISOString(), '2026-11-01T07:00:00.000Z')
  assert.equal(new Date(S.nextDayStartLA('2026-11-01T20:00:00Z')).toISOString(), '2026-11-02T08:00:00.000Z')
  assert.equal(S.nextDayStartLA('2026-03-08T20:00:00Z') - S.dayStartLA('2026-03-08T20:00:00Z'), 23 * 3_600_000)
  assert.equal(S.nextDayStartLA('2026-11-01T20:00:00Z') - S.dayStartLA('2026-11-01T20:00:00Z'), 25 * 3_600_000)
  assert.deepEqual(S.lastDaysLA(3, Date.parse('2026-11-02T20:00:00Z')), ['2026-10-31', '2026-11-01', '2026-11-02'])
  assert.deepEqual(S.lastDaysLA(3, Date.parse('2026-03-09T20:00:00Z')), ['2026-03-07', '2026-03-08', '2026-03-09'])
  assert.equal(S.minuteOfDayLA('2026-07-01T20:05:00Z'), 13 * 60 + 5)
  assert.equal(S.timeLA('2026-12-01T20:05:00Z'), '12:05 PT')
})
