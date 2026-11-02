// The holdermaps.xyz hero's map (server/holders-hero.mjs), with a stubbed builder: it never waits, keeps a last good copy
// across a restart, falls through the examples, and never replaces a good copy with nothing.
//   npm run test:holders-hero      (no network)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-hero-'))
process.env.DATA_DIR = tmp
const H = await import('../server/holders-hero.mjs')

const node = (i) => ({ id: `0x${String(i).padStart(40, '0')}`, pct: 10 - i / 100, cluster: null, flags: [] })
const map = (n, symbol = 'AAPL') => ({
  state: 'ok',
  kind: 'stock',
  chain: { key: 'robinhood', name: 'Robinhood Chain' },
  token: { symbol, address: '0x1' },
  asOf: '2026-11-01T00:00:00Z',
  holders: { count: 5, shown: n },
  nodes: Array.from({ length: n }, (_, i) => node(i)),
  links: [{ source: node(0).id, target: node(1).id, transfers: 1 }, { source: node(0).id, target: node(99).id, transfers: 1 }],
  clusters: [],
  summary: { top10Pct: 38, largestCluster: null, line: 'x', plain: ['y'] },
  timeline: { frames: [{ at: 'a', top10Pct: 1, holders: 2, pcts: [1, 2, 3] }] },
  recentFlows: [{ a: 1 }],
})
const saved = () => path.join(tmp, 'holders-hero.json')
const until = async (f) => {
  for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 5))
}

test('no copy yet: answers at once and reads in the background', async () => {
  let release
  const gate = new Promise((r) => (release = r))
  H.setHeroForTest({ read: () => gate.then(() => map(80)) })
  assert.deepEqual(H.readHero(), { state: 'reading' })
  release()
  await H.heroSettled()
  const b = H.readHero()
  assert.equal(b.state, 'ok')
  assert.deepEqual(b.pick, { chain: 'robinhood', token: 'AAPL' })
})

test('the copy is small: 72 wallets, links between them only, no per-wallet frames, no flows', async () => {
  H.setHeroForTest({ read: async () => map(80) })
  H.readHero()
  await H.heroSettled()
  const b = H.readHero()
  assert.equal(b.nodes.length, 72)
  assert.equal(b.links.length, 1)
  assert.equal(b.timeline.frames[0].pcts, undefined)
  assert.equal(b.timeline.frames[0].top10Pct, 1)
  assert.equal(b.recentFlows, undefined)
  assert.equal(b.summary.top10Pct, 38, 'figures pass through unchanged')
})

test('a restart starts from the saved copy, without waiting or reading first', async () => {
  H.setHeroForTest({ read: async () => map(80) })
  H.readHero()
  await H.heroSettled()
  await until(() => fs.existsSync(saved()))
  let reads = 0
  H.setHeroForTest({ restore: true, read: async () => (reads++, map(80)) })
  assert.equal(H.readHero().state, 'ok')
  assert.equal(reads, 0, 'a fresh copy needs no read')
})

test('falls through to the next example when one cannot be read or is too small', async () => {
  fs.rmSync(saved(), { force: true })
  const asked = []
  H.setHeroForTest({
    read: async (chain, token) => {
      asked.push(token)
      if (token === 'AAPL') return { state: 'unavailable', reason: 'no' }
      return map(token === 'NVDA' ? 3 : 20, token)
    },
  })
  H.readHero()
  await H.heroSettled()
  assert.deepEqual(asked.slice(0, 2), ['AAPL', 'NVDA'])
  assert.equal(H.readHero().pick.chain, 'gully')
})

test('a small real map beats an empty hero; a failed refresh never replaces a good copy', async () => {
  fs.rmSync(saved(), { force: true })
  H.setHeroForTest({ read: async () => map(3) })
  H.readHero()
  await H.heroSettled()
  assert.equal(H.readHero().nodes.length, 3)

  H.setHeroForTest({ read: async () => map(80) })
  H.readHero()
  await H.heroSettled()
  const good = H.readHero()
  await until(() => fs.existsSync(saved()) && fs.readFileSync(saved(), 'utf8').includes(good.savedAt))
  const realNow = Date.now
  Date.now = () => realNow() + 16 * 60_000
  try {
    H.setHeroForTest({ restore: true, read: async () => { throw new Error('upstream down') } })
    assert.equal(H.readHero().savedAt, good.savedAt, 'answered from the copy while the refresh fails')
    await H.heroSettled()
    assert.equal(H.readHero().savedAt, good.savedAt)
  } finally {
    Date.now = realNow
  }
})
