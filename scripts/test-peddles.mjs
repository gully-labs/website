// Tests of the on-chain Peddles reader (server/peddles.mjs) and how /api/stats uses it (stats.mjs peddlesFrom):
// pool discovery from PeddlesFeeHook, Swap decoding on the PoolManager, USD pricing (stablecoin, Chainlink-priced
// ETH, and an asset with no feed counted as unpriced, never $0), fees, value locked from positions, resuming from a
// saved cursor without double counting, the DefiLlama fallback while the scan is incomplete, and the divergence
// footnote. No network: the RPC is a stub function that answers from an in-memory chain.
//
//   node --test scripts/test-peddles.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.PEDDLES_LOOP = 'off'
process.env.PEDDLES_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'peddles-test-'))

const P = await import('../server/peddles.mjs')
const { peddlesFrom } = await import('../server/stats.mjs')

const base = P.CHAINS.find((c) => c.id === 8453)
const chain = { ...base, fromBlock: 1000, confirmations: 0, span: 100 }
const lc = (a) => a.toLowerCase()
const w = (n) => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0')
const t32 = (a) => '0x' + lc(a).replace(/^0x/, '').padStart(64, '0')
const hex = (n) => '0x' + Number(n).toString(16)

const WETH = '0x4200000000000000000000000000000000000006'
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const ODD = '0x00000000000000000000000000000000000000AA' // a quote with no price feed
const TOKEN_HI = '0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF' // launched tokens sort above their quote
const ETH_USD = 3000
const T0 = 1_790_000_000 // block 0's timestamp; 2 s blocks
const timeOf = (n) => T0 + n * 2

const POOL_A = '0x' + 'a1'.repeat(32) // WETH-quoted
const POOL_B = '0x' + 'b2'.repeat(32) // USDC-quoted
const POOL_C = '0x' + 'c3'.repeat(32) // quoted in an asset with no feed

function makeChain() {
  const logs = []
  let idx = 0
  const add = (n, address, topics, words) => logs.push({ address: lc(address), topics, data: '0x' + words.map(w).join(''), blockNumber: hex(n), logIndex: hex(idx++) })
  const registered = (n, id, quote) => add(n, chain.feeHook, [P.EV.PoolRegistered, id, t32(TOKEN_HI), t32(quote)], [0xc0ffee, 100, 0, 0])
  // sqrt price 1.0 (token and quote at par in raw units)
  const init = (n, id, quote) => add(n, chain.poolManager, [P.EV.Initialize, id, t32(quote), t32(TOKEN_HI)], [0, 60, 0, 2n ** 96n, 0])
  const liquidity = (n, id, L) => add(n, chain.poolManager, [P.EV.ModifyLiquidity, id, t32('0x01')], [-600, 600, L, 0])
  const swap = (n, id, quoteRaw) => add(n, chain.poolManager, [P.EV.Swap, id, t32('0x02')], [quoteRaw, -quoteRaw, 2n ** 96n, 1, 0, 3000])
  return { logs, add, registered, init, liquidity, swap }
}

function makeRpc(world, { head = 1400, feedAt = {}, archive = true } = {}) {
  const calls = { getLogs: 0, call: 0 }
  const rpc = async (_c, method, params) => {
    if (method === 'eth_blockNumber') return hex(head)
    if (method === 'eth_getBlockByNumber') return { timestamp: hex(timeOf(Number(BigInt(params[0])))) }
    if (method === 'eth_call') {
      calls.call++
      const { to } = params[0]
      if (lc(to) !== lc(chain.feeds.eth)) throw new Error('execution reverted')
      if (params[1] !== 'latest' && !archive) throw new Error('missing trie node')
      const price = BigInt(Math.round((feedAt[params[1]] ?? ETH_USD) * 1e8))
      return '0x' + [1, price, 0, T0, 1].map(w).join('')
    }
    if (method === 'eth_getLogs') {
      calls.getLogs++
      const q = params[0]
      const from = Number(BigInt(q.fromBlock))
      const to = Number(BigInt(q.toBlock))
      const addrs = [q.address].flat().map(lc)
      return world.logs.filter((l) => {
        const n = Number(BigInt(l.blockNumber))
        if (n < from || n > to || !addrs.includes(l.address)) return false
        const tf = q.topics ?? []
        return tf.every((f, i) => f === null || f === undefined || [f].flat().includes(l.topics[i]))
      })
    }
    throw new Error(`unexpected ${method}`)
  }
  return { rpc, calls }
}

const fresh = () => P.emptyChainState(chain)
const scanAll = async (st, rpc, opts = {}) => {
  const price = P.makePricer(chain, rpc, { now: () => (timeOf(1400) + 60) * 1000 })
  return P.scanChain(st, chain, { rpc, price, budget: 10_000, now: () => (timeOf(1400) + 60) * 1000, ...opts })
}

test('pools are discovered from the fee hook only, never from a look-alike event elsewhere', async () => {
  const world = makeChain()
  world.registered(1010, POOL_A, WETH)
  world.registered(1020, POOL_B, USDC)
  // The same event from a contract that is not PeddlesFeeHook must not register a pool.
  world.add(1030, chain.feeForwarder, [P.EV.PoolRegistered, POOL_C, t32(TOKEN_HI), t32(USDC)], [1, 1, 0, 0])
  const st = fresh()
  const { rpc } = makeRpc(world)
  await scanAll(st, rpc)
  assert.deepEqual(Object.keys(st.pools).sort(), [POOL_A, POOL_B].sort())
  assert.equal(st.pools[POOL_A].quote, lc(WETH))
  assert.equal(st.pools[POOL_A].quoteIs0, true)
  const s = P.chainSummary(st, chain, timeOf(1400))
  assert.equal(s.launches, 2)
})

test('swaps decode on the quote side, are priced in USD, and an unpriced quote is counted, not zero', async () => {
  const world = makeChain()
  world.registered(1010, POOL_A, WETH)
  world.registered(1011, POOL_B, USDC)
  world.registered(1012, POOL_C, ODD)
  world.swap(1100, POOL_A, -(5n * 10n ** 17n)) // 0.5 ETH paid in
  world.swap(1101, POOL_B, 250_000_000n) // 250 USDC out
  world.swap(1102, POOL_C, 10n ** 18n) // no feed for this quote
  world.swap(1103, '0x' + 'dd'.repeat(32), 10n ** 18n) // not a Peddles pool: ignored (filtered by id)
  const st = fresh()
  const { rpc } = makeRpc(world)
  await scanAll(st, rpc)
  const s = P.chainSummary(st, chain, timeOf(1400))
  assert.equal(s.swaps, 3)
  assert.equal(s.unpricedSwaps, 1)
  assert.equal(Math.round(s.volumeAllUsd * 100) / 100, 0.5 * ETH_USD + 250)
  assert.ok(s.daily.length >= 1)
})

test('historic swaps are priced at their own block; a node without that state falls back to latest and says so', async () => {
  const world = makeChain()
  world.registered(1010, POOL_A, WETH)
  world.swap(1100, POOL_A, 10n ** 18n)
  const now = () => (timeOf(1100) + 10 * 86400) * 1000 // ten days later: a backfill
  const a = makeRpc(world, { feedAt: { [hex(1100)]: 2500 } })
  const st1 = fresh()
  await P.scanChain(st1, chain, { rpc: a.rpc, price: P.makePricer(chain, a.rpc, { now }), budget: 1000, now })
  assert.equal(Math.round(P.chainSummary(st1, chain, now() / 1000).volumeAllUsd), 2500)
  assert.equal(st1.latestPriced, 0)
  const b = makeRpc(world, { archive: false })
  const st2 = fresh()
  await P.scanChain(st2, chain, { rpc: b.rpc, price: P.makePricer(chain, b.rpc, { now }), budget: 1000, now })
  assert.equal(Math.round(P.chainSummary(st2, chain, now() / 1000).volumeAllUsd), ETH_USD)
  assert.equal(st2.latestPriced, 1)
})

test('fees: swap and opening fees from the hook, launch fees and Terminal fees in native ETH', async () => {
  const world = makeChain()
  world.registered(1010, POOL_B, USDC)
  world.add(1050, chain.feeHook, [P.EV.FeeAccrued, POOL_B, t32(USDC)], [1_000_000, 2_000_000, 3_000_000, 0]) // $6
  world.add(1051, chain.feeHook, [P.EV.SniperFeeAccrued, POOL_B, t32(USDC)], [4_000_000, 0, 0, 1]) // $4
  world.add(1052, chain.launchFeeCollectors[1], [P.EV.LaunchFeePaid, t32('0x05')], [10n ** 15n]) // 0.001 ETH = $3
  world.add(1053, chain.feeForwarder, [P.EV.FeeCollected, t32('0x06'), t32(WETH), t32('0x07')], [2n * 10n ** 15n, 100]) // $6
  world.add(1054, chain.feeHook, [P.EV.CreatorSwept, POOL_B, t32('0x08')], [5_000_000]) // $5 paid to creators
  world.add(1055, chain.feeHook, [P.EV.HoldersSwept, POOL_B, t32('0x09')], [1_500_000]) // $1.50 to holders
  // The same LaunchFeePaid from an address that is not a documented collector is not a fee.
  world.add(1056, chain.poolManager, [P.EV.LaunchFeePaid, t32('0x05')], [10n ** 18n])
  const st = fresh()
  const { rpc } = makeRpc(world)
  await scanAll(st, rpc)
  const s = P.chainSummary(st, chain, timeOf(1400))
  const r2 = (x) => Math.round(x * 100) / 100
  assert.equal(r2(s.feesBy.swap), 6)
  assert.equal(r2(s.feesBy.opening), 4)
  assert.equal(r2(s.feesBy.launch), 3)
  assert.equal(r2(s.feesBy.terminal), 6)
  assert.equal(r2(s.feesAllUsd), 19)
  assert.equal(r2(s.creatorsPaidUsd), 5)
  assert.equal(r2(s.holdersPaidUsd), 1.5)
})

test('value locked: positions rebuilt from ModifyLiquidity at the pool price, both legs in USD', async () => {
  const world = makeChain()
  world.registered(1010, POOL_B, USDC)
  world.init(1010, POOL_B, USDC)
  const L = 10n ** 12n
  world.liquidity(1011, POOL_B, L)
  world.liquidity(1012, POOL_B, L) // added twice
  world.add(1013, chain.poolManager, [P.EV.ModifyLiquidity, POOL_B, t32('0x01')], [-600, 600, -L, 0]) // and removed once
  const st = fresh()
  const { rpc } = makeRpc(world)
  await scanAll(st, rpc)
  assert.equal(st.pools[POOL_B].ranges['-600:600'], L.toString())
  const tvl = await P.chainTvl(st, chain, P.makePricer(chain, rpc))
  const { amount0, amount1 } = P.positionAmounts(L, -600, 600, 2n ** 96n)
  // USDC is currency0 (it sorts below the token); at price 1.0 the token leg is worth its raw amount in USDC units.
  const expected = (amount0 + amount1) / 1e6
  assert.ok(Math.abs(tvl.usd - expected) < 1e-6, `${tvl.usd} vs ${expected}`)
  assert.ok(Math.abs(tvl.quoteUsd - amount0 / 1e6) < 1e-6)
  assert.equal(tvl.unpriced, 0)
})

test('a saved cursor resumes where it stopped, with nothing counted twice', async () => {
  const world = makeChain()
  world.registered(1010, POOL_B, USDC)
  for (let n = 1050; n < 1400; n += 25) world.swap(n, POOL_B, 1_000_000n) // $1 each
  const whole = fresh()
  const one = makeRpc(world)
  await scanAll(whole, one.rpc)
  const total = P.chainSummary(whole, chain, timeOf(1400)).volumeAllUsd

  const file = path.join(process.env.PEDDLES_STATE_DIR, 'resume.json')
  const s1 = { v: 1, chains: { 8453: fresh() } }
  const two = makeRpc(world)
  // A small budget stops part way; the state is saved and loaded back as a restart would.
  const r1 = await scanAll(s1.chains[8453], two.rpc, { budget: 5 })
  assert.equal(r1.caughtUp, false)
  const stoppedAt = s1.chains[8453].cursor
  assert.ok(stoppedAt > chain.fromBlock && stoppedAt < 1400)
  P.saveState(s1, file)
  const s2 = P.loadState(file)
  assert.equal(s2.chains[8453].cursor, stoppedAt)
  let r
  do r = await scanAll(s2.chains[8453], two.rpc, { budget: 5 })
  while (!r.caughtUp)
  const resumed = P.chainSummary(s2.chains[8453], chain, timeOf(1400))
  assert.equal(resumed.volumeAllUsd, total)
  assert.equal(resumed.swaps, 14)
})

test('a node that refuses the range makes the scan ask for smaller ranges', async () => {
  const world = makeChain()
  world.registered(1010, POOL_B, USDC)
  world.swap(1300, POOL_B, 2_000_000n)
  const { rpc: inner } = makeRpc(world)
  const rpc = async (c, m, p, o) => {
    if (m === 'eth_getLogs' && Number(BigInt(p[0].toBlock)) - Number(BigInt(p[0].fromBlock)) + 1 > 30) throw Object.assign(new Error('block range too large (max 30 blocks)'), { rangeFault: true, maxSpan: 30 })
    return inner(c, m, p, o)
  }
  const st = fresh()
  const r = await scanAll(st, rpc)
  assert.equal(r.caughtUp, true)
  assert.ok(st.span <= 30)
  assert.equal(Math.round(P.chainSummary(st, chain, timeOf(1400)).volumeAllUsd), 2)
})

const snapOf = (chains) => ({ at: new Date().toISOString(), chains, contracts: {} })
const summary = (over = {}) => ({ ...P.chainSummary(P.emptyChainState(chain), chain, 0), started: true, caughtUp: true, progress: 1, coveredUntil: new Date().toISOString(), ...over })
const llamaDex = { url: 'https://api.llama.fi/summary/dexs/peddles', totalAllTime: 6372.78, total7d: 1000, total24h: 10, daily: [{ t: 1_790_000_000 - (1_790_000_000 % 86400) - 86400, v: 111 }] }
const llamaFees = { url: 'https://api.llama.fi/summary/fees/peddles', totalAllTime: 427.72, total24h: 1 }

test('while the scan is incomplete, all-time figures and the daily history are DefiLlama’s, named as such', () => {
  const nowSec = 1_790_000_000
  const snap = snapOf([summary({ caughtUp: false, progress: 0.4, coveredUntil: null, volumeAllUsd: 50 })])
  const v = peddlesFrom({ api: { chains: [{ chainId: 4663, tvlUsd: 900, volume24hUsd: 12 }] }, feesNative: null, dex: llamaDex, fees: llamaFees, snap, nowSec })
  assert.equal(v.volumeAllUsd, 6372.78)
  assert.equal(v.feesAllUsd, 427.72)
  assert.equal(v.tvlUsd, 900)
  assert.equal(v.onchain.live, false)
  assert.ok(v.daily.some((p) => p.v === 111), 'DefiLlama’s day is in the series')
  assert.match(v.sourceNote, /DefiLlama/)
  assert.ok(v.notes.some((n) => /40% of the history scanned/.test(n)))
})

test('once every chain is caught up, ours is shown; more than 10% off DefiLlama adds a footnote, within 10% does not', () => {
  const nowSec = 1_790_000_000
  const close = peddlesFrom({ api: null, feesNative: null, dex: llamaDex, fees: llamaFees, snap: snapOf([summary({ volumeAllUsd: 6382.02, feesAllUsd: 421.98, tvlUsd: 5000 })]), nowSec })
  assert.equal(close.volumeAllUsd, 6382.02)
  assert.equal(close.tvlUsd, 5000)
  assert.equal(close.onchain.live, true)
  assert.equal(close.onchain.divergence, null)
  assert.match(close.sourceNote, /^on chain · Base/)
  const warn = console.warn
  const warned = []
  console.warn = (m) => warned.push(m)
  const far = peddlesFrom({ api: null, feesNative: null, dex: llamaDex, fees: llamaFees, snap: snapOf([summary({ volumeAllUsd: 9000, feesAllUsd: 421.98 })]), nowSec })
  console.warn = warn
  assert.equal(far.volumeAllUsd, 9000)
  assert.match(far.onchain.divergence, /more than 10%/)
  assert.ok(far.notes.includes(far.onchain.divergence))
  assert.equal(warned.length, 1, 'the divergence is logged')
})

test('divergence() and mergeDaily() edges', () => {
  assert.equal(P.divergence(105, 100), null)
  assert.equal(P.divergence(0, 100), null)
  assert.ok(Math.abs(P.divergence(80, 100).pct + 0.2) < 1e-9)
  const nowSec = 10 * 86400 + 100
  const chains = [{ caughtUp: true, coveredUntil: new Date((nowSec - 10) * 1000).toISOString(), daily: [{ t: 9 * 86400, v: 4 }] }]
  const m = P.mergeDaily(chains, [{ t: 8 * 86400, v: 7 }, { t: 9 * 86400, v: 99 }], nowSec)
  assert.deepEqual(m.daily, [{ t: 8 * 86400, v: 0 }, { t: 9 * 86400, v: 4 }, { t: 10 * 86400, v: 0 }].filter((p) => p.t >= 8 * 86400))
})
