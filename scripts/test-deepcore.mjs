// DeepCore pools in the tracker's on-chain re-pricing (server/tracker.mjs). Offline by default; DEEPCORE_LIVE=1 also reads a real DeepCore pool on
// Robinhood Chain through the same call the tracker makes and checks it against DeepCore's API.
// Run: npm run test:deepcore   (live: DEEPCORE_LIVE=1 npm run test:deepcore)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEEPCORE_CL_POOL_MANAGER, isDeepcorePool, onchainPriceCall } from '../server/tracker.mjs'

const STATE_VIEW = '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b'
const robinhood = { stateView: STATE_VIEW, deepcoreCl: DEEPCORE_CL_POOL_MANAGER }
const bsc = { stateView: null, deepcoreCl: DEEPCORE_CL_POOL_MANAGER }
// A real DeepCore CL pool on Robinhood Chain (WETH / DTC), from api.deepcore.fun/v1/chains/4663/pools.
const DC_POOL = '0xb506bfaaa4c59b41de3de2167e797e29ee76ac13fc746504a69f8a9f45d11411'
const V3_PAIR = '0x62AB521f71431f78ac374CdbadC6cda3c8916b6C'

test('DeepCore pools are recognised by venue name or pool manager', () => {
  assert.equal(isDeepcorePool({ dex: 'deepcore' }), true)
  assert.equal(isDeepcorePool({ dex: 'DeepCore' }), true)
  assert.equal(isDeepcorePool({ dex: 'deep-core' }), true)
  assert.equal(isDeepcorePool({ dex: 'uniswap', poolManager: DEEPCORE_CL_POOL_MANAGER.toLowerCase() }), true)
  assert.equal(isDeepcorePool({ dex: 'uniswap' }), false)
  assert.equal(isDeepcorePool(null), false)
})

test('a DeepCore pool id is read through DeepCore CLPoolManager, never Uniswap StateView', () => {
  const call = onchainPriceCall(robinhood, { pair: DC_POOL, dex: 'deepcore' })
  assert.deepEqual(call, { to: DEEPCORE_CL_POOL_MANAGER, data: '0xc815641c' + DC_POOL.slice(2) })
  // BNB Chain has no StateView, but DeepCore runs there too.
  assert.equal(onchainPriceCall(bsc, { pair: DC_POOL, dex: 'deepcore' })?.to, DEEPCORE_CL_POOL_MANAGER)
})

test('other 32-byte ids stay Uniswap v4 and 20-byte pairs stay v3', () => {
  assert.equal(onchainPriceCall(robinhood, { pair: DC_POOL, dex: 'uniswap' })?.to, STATE_VIEW)
  assert.equal(onchainPriceCall(bsc, { pair: DC_POOL, dex: 'uniswap' }), null)
  assert.deepEqual(onchainPriceCall(robinhood, { pair: V3_PAIR, dex: 'uniswap' }), { to: V3_PAIR, data: '0x3850c7bd' })
  assert.equal(onchainPriceCall(robinhood, { dex: 'deepcore' }), null)
})

test('live: the tracker call returns the sqrtPrice DeepCore reports for its pool', { skip: process.env.DEEPCORE_LIVE !== '1' }, async () => {
  const call = onchainPriceCall(robinhood, { pair: DC_POOL, dex: 'deepcore' })
  const rpc = await fetch('https://rpc.mainnet.chain.robinhood.com', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [call, 'latest'] }),
    signal: AbortSignal.timeout(20_000),
  }).then((r) => r.json())
  const sqrt = BigInt('0x' + rpc.result.slice(2, 66))
  assert.ok(sqrt > 0n, 'CLPoolManager answered a zero price')
  const api = await fetch('https://api.deepcore.fun/v1/chains/4663/pools', { signal: AbortSignal.timeout(20_000) }).then((r) => r.json())
  const pool = api.data.items.find((x) => x.poolId.toLowerCase() === DC_POOL)
  assert.ok(pool, 'pool not in the DeepCore API')
  assert.equal(pool.poolManager.toLowerCase(), DEEPCORE_CL_POOL_MANAGER.toLowerCase())
  // The pool can trade between the two reads; allow 1% on the price (0.5% on its square root).
  const ratio = Number(sqrt) / Number(BigInt(pool.state.sqrtPriceX96))
  assert.ok(Math.abs(ratio - 1) < 0.005, `on-chain ${sqrt} vs API ${pool.state.sqrtPriceX96}`)
  // The same id through Uniswap's StateView reads nothing: the misread this guards against.
  const v4 = await fetch('https://rpc.mainnet.chain.robinhood.com', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: STATE_VIEW, data: call.data }, 'latest'] }),
    signal: AbortSignal.timeout(20_000),
  }).then((r) => r.json())
  assert.equal(BigInt('0x' + v4.result.slice(2, 66)), 0n)
})
