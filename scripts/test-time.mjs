// One clock for everything a person reads: Los Angeles, labelled PT, daylight saving handled by Intl (src/lib/time.ts).
// npm run test:time
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
after(() => vite.close())
const T = await vite.ssrLoadModule('/src/lib/time.ts')

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
