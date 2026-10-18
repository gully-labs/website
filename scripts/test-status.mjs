// Tracker freshness on the status page (server/status.mjs trackerComponents, server/tracker.mjs notePriceReads).
// A chain is fresh by when its prices were last read on chain, not by the hourly pool discovery.
//   npm run test:status

import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { test } from 'node:test'

// Keep the status store out of the real data directory and the loops off.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-status-'))
process.env.DATA_DIR = tmp
process.env.STATUS_LOOP = 'off'

const { trackerComponents } = await import('../server/status.mjs')
const tracker = await import('../server/tracker.mjs')

const NOW = Date.parse('2026-10-18T12:00:00Z')
const ago = (min) => new Date(NOW - min * 60_000).toISOString()
const chain = (o) => ({ key: 'robinhood', name: 'Robinhood Chain', stocks: 40, lastPoolRead: ago(63), backoffUntil: null, lastPriceRead: ago(1), pricesRead: 40, rows: 40, ...o })
const one = (o) => trackerComponents({ chains: [chain(o)] }, NOW)[0]

test('a stale pool discovery with a fresh price read is up', () => {
  const c = one({})
  assert.equal(c.state, 'up')
  assert.match(c.detail, /^Prices read on chain 60 s ago\. 40 of 40 tokens priced/)
  assert.match(c.detail, /Pools rediscovered 63 min ago\./)
})

test('a discovery back-off does not mark fresh prices degraded', () => {
  assert.equal(one({ backoffUntil: new Date(NOW + 60_000).toISOString() }).state, 'up')
})

test('prices 10 to 30 minutes old are degraded; older is down', () => {
  assert.equal(one({ lastPriceRead: ago(9) }).state, 'up')
  assert.equal(one({ lastPriceRead: ago(12) }).state, 'degraded')
  assert.equal(one({ lastPriceRead: ago(30) }).state, 'degraded')
  const down = one({ lastPriceRead: ago(31) })
  assert.equal(down.state, 'down')
  assert.match(down.detail, /Robinhood Chain prices aren’t being read right now/)
})

test('a chain whose builds price nothing is down, in plain words', () => {
  const c = trackerComponents({ chains: [chain({ key: 'solana', name: 'Solana', stocks: 49, lastPoolRead: null, lastPriceRead: null, pricesRead: 0, rows: 49 })] }, NOW)[0]
  assert.equal(c.id, 'tracker-solana')
  assert.equal(c.state, 'down')
  assert.equal(c.detail, 'Solana prices aren’t being read right now (0 of 49 tokens).')
})

test('before the first build the state is unknown, not down', () => {
  assert.equal(one({ lastPoolRead: null, lastPriceRead: null, pricesRead: null, rows: null }).state, 'unknown')
})

test('notePriceReads keeps the newest onchainAt per chain and the last read count', () => {
  tracker.resetPriceReadsForTest()
  const t1 = new Date().toISOString()
  tracker.notePriceReads([
    { chain: 'robinhood', onchainAt: ago(3) },
    { chain: 'robinhood', onchainAt: t1 },
    { chain: 'robinhood', onchainAt: null },
    { chain: 'solana', onchainAt: null },
  ])
  const h = tracker.trackerHealth().chains
  const rh = h.find((c) => c.key === 'robinhood')
  const sol = h.find((c) => c.key === 'solana')
  assert.equal(rh.lastPriceRead, t1)
  assert.equal(rh.pricesRead, 2)
  assert.equal(rh.rows, 3)
  assert.equal(sol.lastPriceRead, null)
  assert.equal(sol.pricesRead, 0)
  // A later build that prices nothing keeps the last good time, so its age grows.
  tracker.notePriceReads([{ chain: 'robinhood', onchainAt: null }])
  const again = tracker.trackerHealth().chains.find((c) => c.key === 'robinhood')
  assert.equal(again.lastPriceRead, t1)
  assert.equal(again.pricesRead, 0)
})

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
