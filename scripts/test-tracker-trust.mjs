// The tracker's trust rules (server/tracker.mjs): which pool is chosen, and when a gap is believed.
// Offline: synthetic DexScreener pairs and pools, no network.
// Run: npm run test:tracker-trust
//
// The case behind it (2026-10-17): META on Robinhood Chain showed "−29.45% · discount". DexScreener's
// batch endpoint answers one pair per token, and for META it picked a Metric pool (an oracle-quoted
// venue whose contract has no slot0, so it cannot be re-read on chain) at a misprinted $498.46, while
// every swap in that pool settled at $706.8–708.7 and a $3.2M Uniswap v4 pool was trading at fair.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assessRow, bestPool, IMPLAUSIBLE_PCT, MIN_LIQUIDITY_USD, onchainReadable, TRUST_LIQUIDITY_USD } from '../server/tracker.mjs'

const META = '0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35'
const USDG = { address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', symbol: 'USDG' }
const base = { address: META, symbol: 'META' }
const pair = (o) => ({ baseToken: base, quoteToken: USDG, priceUsd: '707.0', priceNative: '707.0', liquidity: { usd: 100_000 }, volume: { h24: 1_000 }, labels: [], url: 'https://dexscreener.com/x', ...o })
const metric = pair({ dexId: 'metric', pairAddress: '0x90CABdA18279BBB3D935989aF807b08B0e8CeC61', priceUsd: '498.46', liquidity: { usd: 269_113 }, volume: { h24: 3_854_799 } })
const v4 = pair({ dexId: 'uniswap', labels: ['v4'], pairAddress: '0x5875d407a42965b0e768c8925cea290e06fa50603ef34fc99eb92a1050e6ae36', priceUsd: '707.94', liquidity: { usd: 3_170_234 } })
const v3 = pair({ dexId: 'uniswap', labels: ['v3'], pairAddress: '0x107a7Cb40d8665360ba10E59471Af06150A50922', priceUsd: '707.65', liquidity: { usd: 262_006 } })
const meme = { ...pair({ dexId: 'uniswap', labels: ['v4'], pairAddress: '0x40a433930370f6cdf0a78debc2c6dd599c23bd428c0d67dd8b5373e4f101557f', priceUsd: '0.00002', liquidity: { usd: 507_673 } }), baseToken: { address: '0x1111111111111111111111111111111111111111', symbol: 'musebook' }, quoteToken: base }

test('which pools can be re-read on chain', () => {
  assert.equal(onchainReadable({ pair: metric.pairAddress, dex: 'metric', labels: [] }), false, 'Metric has no slot0')
  assert.equal(onchainReadable({ pair: '0x858A5FBeEb2DbDb5aFC83183789E2c722F79558c', dex: 'uniswap', labels: ['v2'] }), false, 'a v2 pair has no slot0')
  assert.equal(onchainReadable({ pair: v3.pairAddress, dex: 'uniswap', labels: ['v3'] }), true)
  assert.equal(onchainReadable({ pair: v4.pairAddress, dex: 'uniswap', labels: ['v4'] }), true, 'a 32-byte id goes to StateView')
  assert.equal(onchainReadable({ pair: '0x13f4EA83D0bd40E75C8222255bc855a974568Dd4', dex: 'pancakeswap-v3', labels: [] }), true, 'GeckoTerminal names the version in the dex id')
  assert.equal(onchainReadable({ pair: '0xb506bfaaa4c59b41de3de2167e797e29ee76ac13fc746504a69f8a9f45d11411', dex: 'deepcore' }), true)
})

test('the batch answer alone (Metric only) still picks Metric: there is nothing else to pick', () => {
  const p = bestPool(META, [metric])
  assert.equal(p.dex, 'metric')
  assert.equal(p.readable, false)
  assert.equal(p.priced, 'api')
})

test('with every pair of the token, the deep on-chain-readable pool wins over Metric', () => {
  const p = bestPool(META, [metric, v3, v4, meme])
  assert.equal(p.pair, v4.pairAddress)
  assert.equal(p.price, 707.94)
  assert.equal(p.pools, 4, 'the meme pool quoting META counts as a pool (META on the quote side)')
})

test('a readable pool deep enough to count beats a deeper pool that cannot be re-read', () => {
  const p = bestPool(META, [metric, v3])
  assert.equal(p.pair, v3.pairAddress, '$262k v3 over $269k Metric')
})

test('a readable pool too thin to count does not displace a deeper unreadable one', () => {
  const tiny = pair({ dexId: 'uniswap', labels: ['v3'], pairAddress: '0x79218D7af86A312db676f9bF088db2881fc112C8', liquidity: { usd: MIN_LIQUIDITY_USD - 1 } })
  assert.equal(bestPool(META, [metric, tiny]).dex, 'metric')
})

test('duplicate pairs (batch + token-pairs) are counted once', () => {
  assert.equal(bestPool(META, [v4, v4, metric]).pools, 2)
})

const FAIR = 706.52
const pool = (o) => ({ price: 707, liquidityUsd: 3_000_000, priced: 'chain', pricedAt: Date.now(), dex: 'uniswap', ...o })

test('the META case: a 29% gap from an API reading of a pool that cannot be re-read is unverified, not a discount', () => {
  const now = Date.parse('2026-10-17T18:52:33Z')
  const v = assessRow({ fair: FAIR, pool: { price: 498.46, liquidityUsd: 269_113, priced: 'api', pricedAt: Date.parse('2026-10-17T18:11:36Z'), dex: 'metric', source: 'DexScreener' }, now })
  assert.equal(v.status, 'unverified')
  assert.equal(v.gapPct, null, 'the gap is withheld')
  assert.ok(Math.abs(v.rawGapPct - -29.45) < 0.01, `raw gap kept: ${v.rawGapPct}`)
  assert.equal(v.trusted, false)
  assert.match(v.untrustedReason, /29\.4% gap is implausible/)
  assert.match(v.untrustedReason, /DexScreener’s reading from 41 min ago/)
  assert.match(v.untrustedReason, /metric contract cannot be re-read/)
  assert.match(v.untrustedReason, /\$269,113, under the \$1,000,000/)
})

test('the META row after the fix: the v4 pool read on chain is in line and trusted', () => {
  const v = assessRow({ fair: FAIR, pool: pool({ price: 707.94 }) })
  assert.equal(v.status, 'in-line')
  assert.equal(v.trusted, true)
  assert.equal(v.untrustedReason, null)
})

test('an implausible gap on a shallow pool read on chain is unverified (liquidity reason only)', () => {
  const v = assessRow({ fair: 100, pool: pool({ price: 80, liquidityUsd: 50_000 }) })
  assert.equal(v.status, 'unverified')
  assert.doesNotMatch(v.untrustedReason, /could not be confirmed on chain/)
  assert.match(v.untrustedReason, /\$50,000, under the \$1,000,000/)
})

test('an implausible gap on a deep pool read on chain stands: it is shown as a real discount', () => {
  const v = assessRow({ fair: 100, pool: pool({ price: 80, liquidityUsd: TRUST_LIQUIDITY_USD }) })
  assert.equal(v.status, 'discount')
  assert.equal(v.gapPct, -20)
  assert.equal(v.trusted, true)
})

test('just under the implausible line is a normal flag, even from an API reading', () => {
  const v = assessRow({ fair: 100, pool: pool({ price: 100 * (1 + (IMPLAUSIBLE_PCT - 0.1) / 100), priced: 'api', liquidityUsd: 20_000 }) })
  assert.equal(v.status, 'premium')
})

test('a price ratio that looks like a decimals slip is unverified whatever the pool', () => {
  for (const price of [FAIR * 1e12, FAIR / 1e6, FAIR * 10, FAIR / 10]) {
    const v = assessRow({ fair: FAIR, pool: pool({ price, liquidityUsd: 50_000_000 }) })
    assert.equal(v.status, 'unverified', String(price))
    assert.match(v.untrustedReason, /units or decimals error/)
    assert.equal(v.gapPct, null)
  }
})

test('thin pools stay "thin" (shown, never flagged) and say why', () => {
  const v = assessRow({ fair: 100, pool: pool({ price: 130, liquidityUsd: 2_000 }) })
  assert.equal(v.status, 'thin')
  assert.equal(v.gapPct, 30)
  assert.equal(v.trusted, false)
  assert.match(v.untrustedReason, /\$2,000, under the \$10,000/)
})

test('unreadable stays unreadable, never zero', () => {
  assert.deepEqual(assessRow({ fair: null, pool: pool({}) }).gapPct, null)
  assert.equal(assessRow({ fair: null, pool: pool({}) }).status, 'feed-unreadable')
  assert.equal(assessRow({ fair: 100, pool: { error: 'HTTP 429' } }).status, 'pool-unreadable')
  assert.equal(assessRow({ fair: 100, pool: null }).status, 'no-pool')
})

test('the ordinary statuses are unchanged', () => {
  assert.equal(assessRow({ fair: 100, pool: pool({ price: 100.5 }) }).status, 'in-line')
  assert.equal(assessRow({ fair: 100, pool: pool({ price: 101.5 }) }).status, 'drifting')
  assert.equal(assessRow({ fair: 100, pool: pool({ price: 97 }) }).status, 'discount')
  assert.equal(assessRow({ fair: 100, pool: pool({ price: 103 }) }).status, 'premium')
})
