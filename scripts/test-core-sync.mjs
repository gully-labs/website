// Gully Core sync gate (owner, 2026-11-09: one manifest drives every surface; a surface that disagrees fails its build).
//   1. the committed manifest copy reads the same as the LIVE manifest (https://gullycore.xyz/manifest.json): chains, states,
//      features, links, fee. Offline (no answer after three tries) this is a failure unless SYNC_OFFLINE=1.
//   2. src/content/gullyCore.generated.ts is exactly what the committed copy generates
//   3. the typed words agree with the reading: product catalog (where it is live, the Multisig chains and address),
//      the feature catalog's Gully Core entries (status and every live mainnet named), the hub's Multisig surface
//   4. nothing hard-codes a Core chain list or the old Multisig host any more
// npm run test:core-sync
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { derive, generatedTs } from '../server/gully-core-derive.mjs'
import { committed, drift, fetchManifest } from './sync-gully-core.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Node strips the types itself (as scripts/build-page-content.mjs does), so relative imports inside the catalogs resolve.
const loadTs = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)
const { copy, reading, generated } = committed()

test('the committed manifest copy reads the same as the live manifest', async () => {
  let live
  try {
    live = await fetchManifest()
  } catch (e) {
    if (process.env.SYNC_OFFLINE === '1') return console.log(`  note: live manifest not read (${e.message}); SYNC_OFFLINE=1, skipped`)
    throw e
  }
  const lines = drift(reading, derive(live))
  assert.deepEqual(lines, [], 'run node scripts/sync-gully-core.mjs, the build scripts, and commit:\n  ' + lines.join('\n  '))
})

test('the generated client view is what the committed copy generates', () => {
  assert.equal(generated, generatedTs(reading), 'run node scripts/sync-gully-core.mjs')
  assert.ok(generated.length < 20_000, 'the client view stays small')
})

test('the reading is sane: live mainnets first, every chain has a mark this site serves, Multisig chains flagged', () => {
  assert.ok(reading.chains.length >= 6)
  assert.equal(reading.chains[0].status, 'live')
  assert.ok(reading.liveMainnets.length >= 1 && reading.testnets.length >= 1)
  for (const c of reading.chains) assert.ok(c.logo && (c.logo.startsWith('http') || fs.existsSync(path.join(ROOT, 'public', c.logo))), `${c.key}: ${c.logo}`)
  assert.ok(reading.multisigChains.length >= 2)
  assert.match(reading.multisigUrl, /^https:\/\/gullymultisig\.xyz$/)
  assert.equal(reading.builderFeePct, 0.3)
  assert.ok(copy.chains.some((c) => c.chainId === 99901 && c.rpc === 'https://rpc.elysium.kinetiq.xyz'), 'Elysium reads from Kinetiq’s RPC only (owner, 2026-11-09)')
})

test('the product catalog says where Gully Core and Gully Multisig run, from the reading', async () => {
  const C = await loadTs('src/terminal/catalog.ts')
  const core = C.productBySlug('gully-core')
  const faq = C.productFaq(core).find(([q]) => q === 'Where is it live?')[1]
  assert.ok(faq.startsWith(reading.whereLive), faq)
  for (const n of reading.liveMainnets) assert.ok(faq.includes(n) && core.runs.includes(n), n)
  assert.match(C.pricingNote(core), /0\.3% of every trade/)
  const safe = C.productBySlug('safe')
  assert.equal(safe.url, reading.multisigUrl)
  for (const n of reading.multisigChains) assert.ok(safe.line.includes(n) && safe.runs.includes(n), `Multisig on ${n}`)
  assert.ok(!/free on testnet/i.test(C.pricingNote(safe)))
})

test('the feature catalog agrees with the manifest on Gully Core (status per entry, every live mainnet named)', async () => {
  const { features } = await loadTs('src/content/features.ts')
  const status = Object.fromEntries(reading.features.map((f) => [f.id, f.status]))
  // website feature id -> the manifest features it describes
  const MAP = {
    'deepcore-launchpad': ['launch'],
    'deepcore-hosted-pads': ['launchpad', 'dex', 'stocks'],
    'deepcore-router': ['router'],
    'deepcore-locks-airdrops-splits': ['locks', 'splits'],
    'deepcore-limit-orders-dca': ['terminal'],
    'deepcore-dev-tools': ['sdk', 'cli'],
  }
  for (const [id, ids] of Object.entries(MAP)) {
    const f = features.find((x) => x.id === id)
    assert.ok(f, id)
    const want = ids.map((x) => status[x])
    assert.ok(want.every(Boolean), `${id}: manifest features ${ids}`)
    const expect = want.includes('live') ? 'live' : want.includes('testnet') ? 'testnet' : 'planned'
    assert.equal(f.status, expect, `${id}: manifest says ${want.join('/')} -> ${expect}`)
    if (expect === 'live') for (const n of reading.liveMainnets) assert.ok(f.facts.some((t) => t.includes(n)), `${id} names ${n}`)
  }
  const chains = features.find((x) => x.id === 'deepcore-four-chains')
  assert.equal(chains.status, reading.liveMainnets.length ? 'live' : 'testnet')
  for (const n of reading.liveMainnets) assert.ok(chains.facts.some((t) => t.includes(n)) && chains.summary.includes(n), `four-chains names ${n}`)
  const msig = features.find((x) => x.id === 'gully-safe-multisig')
  assert.equal(msig.url, reading.multisigUrl)
  for (const n of reading.multisigChains) assert.ok(msig.summary.includes(n.replace(/ testnet$/, '')), `Multisig summary names ${n}`)
  for (const f of features.filter((x) => x.product === 'Gully Core')) assert.ok(!f.facts.some((t) => /nothing is on any mainnet/i.test(t)), `${f.id}: stale "nothing on any mainnet"`)
})

test('the hub monitors Gully Multisig at the manifest address, and the landing news names the live mainnets', async () => {
  const { SURFACES } = await import('../server/hub.mjs')
  assert.equal(SURFACES.find((s) => s.key === 'safe').url, reading.multisigUrl)
  const H = await loadTs('src/pages/hub/hubData.ts')
  const news = H.NEWS.map((n) => n.t).join('\n')
  for (const n of reading.liveMainnets) assert.ok(news.includes(n), `news names ${n}`)
})

test('no hard-coded Core chain list and no old Multisig host is left in the site', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'server/data/core-chains.json')), 'server/data/core-chains.json is gone')
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]))
  const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'server')).filter((f) => !f.includes(`${path.sep}data${path.sep}`))].filter((f) => /\.(ts|tsx|mjs|json)$/.test(f))
  const bad = files.filter((f) => /multisig\.gullychain\.xyz|core-chains\.json/.test(fs.readFileSync(f, 'utf8')) && !/features\.ts$/.test(f))
  assert.deepEqual(bad.map((f) => path.relative(ROOT, f)), [], 'files still naming the old Multisig host or the removed chain file')
})
