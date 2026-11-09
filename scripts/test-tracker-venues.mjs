// The tracker's on-chain re-pricing (server/tracker.mjs) tells a PancakeSwap-Infinity-style CL pool (32-byte id, read through
// its CLPoolManager.getSlot0) apart from a Uniswap v4 pool (same id shape, read through StateView). The CL pool manager at
// DEEPCORE_CL_POOL_MANAGER is the public contract some stock tokens trade on; reading it is an on-chain read of a DEX venue,
// not a call to any partner API (the DeepCore data integrations were retired on 2026-11-08; this test makes no network call).
// Run: npm run test:tracker-venues
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEEPCORE_CL_POOL_MANAGER, isDeepcorePool, onchainPriceCall } from '../server/tracker.mjs'

const STATE_VIEW = '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b'
const robinhood = { stateView: STATE_VIEW, deepcoreCl: DEEPCORE_CL_POOL_MANAGER }
const bsc = { stateView: null, deepcoreCl: DEEPCORE_CL_POOL_MANAGER }
// A real CL pool id on Robinhood Chain (WETH / DTC), 32 bytes.
const DC_POOL = '0xb506bfaaa4c59b41de3de2167e797e29ee76ac13fc746504a69f8a9f45d11411'
const V3_PAIR = '0x62AB521f71431f78ac374CdbadC6cda3c8916b6C'

test('CL pools of that venue are recognised by venue name or pool manager', () => {
  assert.equal(isDeepcorePool({ dex: 'deepcore' }), true)
  assert.equal(isDeepcorePool({ dex: 'DeepCore' }), true)
  assert.equal(isDeepcorePool({ dex: 'deep-core' }), true)
  assert.equal(isDeepcorePool({ dex: 'uniswap', poolManager: DEEPCORE_CL_POOL_MANAGER.toLowerCase() }), true)
  assert.equal(isDeepcorePool({ dex: 'uniswap' }), false)
  assert.equal(isDeepcorePool(null), false)
})

test('such a pool id is read through its CLPoolManager, never Uniswap StateView', () => {
  const call = onchainPriceCall(robinhood, { pair: DC_POOL, dex: 'deepcore' })
  assert.deepEqual(call, { to: DEEPCORE_CL_POOL_MANAGER, data: '0xc815641c' + DC_POOL.slice(2) })
  // BNB Chain has no StateView, but the CL pool manager is deployed there too.
  assert.equal(onchainPriceCall(bsc, { pair: DC_POOL, dex: 'deepcore' })?.to, DEEPCORE_CL_POOL_MANAGER)
})

test('other 32-byte ids stay Uniswap v4 and 20-byte pairs stay v3', () => {
  assert.equal(onchainPriceCall(robinhood, { pair: DC_POOL, dex: 'uniswap' })?.to, STATE_VIEW)
  assert.equal(onchainPriceCall(bsc, { pair: DC_POOL, dex: 'uniswap' }), null)
  assert.deepEqual(onchainPriceCall(robinhood, { pair: V3_PAIR, dex: 'uniswap' }), { to: V3_PAIR, data: '0x3850c7bd' })
  assert.equal(onchainPriceCall(robinhood, { dex: 'deepcore' }), null)
})
