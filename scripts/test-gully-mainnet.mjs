// Gully Chain mainnet (48559) is config, testnet (485590) stays the default (server/gully-mainnet.mjs, payments.mjs,
// holders.mjs). Offline: each case imports the modules in a child process with its own env, nothing is fetched.
// Run: npm run test:gully-mainnet
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { gullyMainnetConfig, GULLY_MAINNET_ID } from '../server/gully-mainnet.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-mainnet-'))
const USDC = '0x' + 'a1'.repeat(20)
const FEED = '0x' + 'b2'.repeat(20)
const BASE_ENV = { PATH: process.env.PATH, HOME: tmp, DATA_DIR: tmp, TRACKER_DATA: path.join(tmp, 'tracker.json'), TRACKER_LOOP: 'off', DEEPCORE_LOOP: 'off', HOLDER_ALERTS_LOOP: 'off', GULLY_TREASURY_CHECK_MS: '0' }

const probe = `
const P = await import('./server/payments.mjs')
const H = await import('./server/holders.mjs')
const T = await import('./server/treasury-chains.mjs')
const out = {
  read: Object.keys(P.READ_CHAINS).map(Number),
  pay: Object.keys(P.CHAINS).map(Number),
  list: P.CHAIN_LIST.map((c) => c.id),
  assets: P.ASSETS.filter((a) => a.chainId === 48559 || a.chainId === 485590).map((a) => a.id),
  info48559: P.chainInfo(48559),
  info485590: P.chainInfo(485590)?.name ?? null,
  holderKeys: Object.keys(H.HOLDER_CHAINS),
  holderMain: H.HOLDER_CHAINS['gully-mainnet'] ?? null,
  key48559: H.chainKeyOf(48559),
  key485590: H.chainKeyOf(485590),
  rpcs48559: P.rpcsFor(48559),
}
T.recordTreasuryCode(8453, '0x6080')
out.offered = P.publicChains().map((c) => c.id)
console.log(JSON.stringify(out))
`
const run = (env) => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { cwd: root, env: { ...BASE_ENV, ...env }, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout.trim().split('\n').pop())
}

test('gullyMainnetConfig: off without an RPC, off for a testnet RPC, payments only with USDC and a feed', () => {
  assert.equal(GULLY_MAINNET_ID, 48559)
  assert.equal(gullyMainnetConfig({}), null)
  assert.equal(gullyMainnetConfig({ GULLY_RPC_48559: ' , ' }), null)
  const warn = console.warn
  console.warn = () => {}
  try {
    assert.equal(gullyMainnetConfig({ GULLY_RPC_48559: 'https://testnet-rpc.gullychain.xyz' }), null)
    assert.equal(gullyMainnetConfig({ GULLY_RPC_48559: 'https://rpc.a.test,https://arb-sepolia.b.test' }), null)
  } finally { console.warn = warn }
  const r = gullyMainnetConfig({ GULLY_RPC_48559: 'https://rpc.gullychain.xyz, https://rpc2.test' })
  assert.deepEqual(r.rpcs, ['https://rpc.gullychain.xyz', 'https://rpc2.test'])
  assert.equal(r.testnet, false)
  assert.equal(r.explorer, 'https://explorer.gullychain.xyz')
  assert.equal(r.usdc, null)
  assert.equal(r.payments, false)
  assert.equal(gullyMainnetConfig({ GULLY_RPC_48559: 'https://r.test', GULLY_MAINNET_USDC: USDC }).payments, false)
  assert.equal(gullyMainnetConfig({ GULLY_RPC_48559: 'https://r.test', GULLY_MAINNET_USDC: 'nope', GULLY_MAINNET_ETH_USD_FEED: FEED }).payments, false)
  const p = gullyMainnetConfig({ GULLY_RPC_48559: 'https://r.test', GULLY_MAINNET_USDC: USDC.toUpperCase().replace('0X', '0x'), GULLY_MAINNET_ETH_USD_FEED: FEED, GULLY_MAINNET_EXPLORER: 'https://x.test/' })
  assert.equal(p.payments, true)
  assert.equal(p.usdc, USDC)
  assert.equal(p.explorer, 'https://x.test')
})

test('default env: no 48559 anywhere, Gully Chain Testnet exactly as before', () => {
  const o = run({})
  assert.ok(!o.read.includes(48559) && !o.pay.includes(48559) && !o.list.includes(48559))
  assert.equal(o.info48559, null)
  assert.ok(o.read.includes(485590))
  assert.equal(o.info485590, 'Gully Chain Testnet')
  assert.ok(!o.holderKeys.includes('gully-mainnet'))
  assert.equal(o.key48559, null)
  assert.equal(o.key485590, 'gully')
  assert.deepEqual(o.assets, [])
})

test('GULLY_RPC_48559 alone: a read-only chain and a Holder Map chain, never a payment chain', () => {
  const o = run({ GULLY_RPC_48559: 'https://rpc.main.test' })
  assert.ok(o.read.includes(48559) && o.read.includes(485590))
  assert.ok(!o.pay.includes(48559) && !o.list.includes(48559) && !o.offered.includes(48559))
  assert.equal(o.info48559.name, 'Gully Chain')
  assert.equal(o.info48559.testnet, false)
  assert.equal(o.info48559.readOnly, true)
  assert.deepEqual(o.rpcs48559, ['https://rpc.main.test'])
  assert.equal(o.holderMain.id, 48559)
  assert.equal(o.holderMain.holders, 'own-rpc')
  assert.ok(!o.holderMain.testnet)
  assert.equal(o.key48559, 'gully-mainnet')
  assert.equal(o.key485590, 'gully')
  assert.deepEqual(o.assets, [])
})

test('with USDC and an ETH / USD feed: a payment chain, still gated by the treasury deployment', () => {
  const env = { GULLY_RPC_48559: 'https://rpc.main.test', GULLY_MAINNET_USDC: USDC, GULLY_MAINNET_ETH_USD_FEED: FEED }
  const o = run(env)
  assert.ok(o.pay.includes(48559) && o.list.includes(48559))
  assert.ok(!o.read.includes(48559))
  assert.deepEqual(o.assets, ['gully-mainnet-usdc', 'gully-mainnet-eth'])
  assert.equal(o.info48559.feed.address, FEED)
  // a Safe treasury with code only on Base: 48559 is not offered until the Safe is deployed there
  const c = run({ ...env, GULLY_TREASURY_KIND: 'contract' })
  assert.ok(c.offered.includes(8453))
  assert.ok(!c.offered.includes(48559))
})

test('a testnet RPC under GULLY_RPC_48559 keeps mainnet off', () => {
  const o = run({ GULLY_RPC_48559: 'https://testnet-rpc.gullychain.xyz', GULLY_MAINNET_USDC: USDC, GULLY_MAINNET_ETH_USD_FEED: FEED })
  assert.ok(!o.read.includes(48559) && !o.pay.includes(48559) && !o.holderKeys.includes('gully-mainnet'))
})
