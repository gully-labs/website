// The first Gully Chain testnet stable was retired on 2026-10-28 and withdrawn from every public surface (2026-10-30,
// restated 2026-11-24): no page, list, label, data file, index or API answer of this site names it (its vault share
// matches the same pattern). This test fails on the name anywhere in the repo's sources and data, and in the built
// site (dist/) when one is present. Quests about it are hidden by the indexer and dropped by server/hub.mjs.
//
//   npm run test:retired-stable     (no build needed; run it again after `npm run build` to cover dist/)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WITHDRAWN, readQuests } from '../server/hub.mjs'
import { guardChunks } from '../server/ask-public-guard.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIR = new Set(['node_modules', '.git', '.vite', 'coverage'])
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|zip|gz|br|pdf|onnx|bin|wasm)$/i

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(f.name)) continue
    const p = path.join(dir, f.name)
    if (f.isDirectory()) walk(p, out)
    else if (!BINARY.test(f.name)) out.push(p)
  }
  return out
}
const hitsIn = (dir) => walk(dir).filter((p) => WITHDRAWN.test(path.relative(ROOT, p)) || WITHDRAWN.test(fs.readFileSync(p, 'utf8'))).map((p) => path.relative(ROOT, p).split(path.sep).join('/'))

test('the pattern matches the name and its vault share, in any case, and nothing else here', () => {
  for (const s of [['gl', 'USD'].join(''), ['GL', 'USD'].join(''), ['gtGL', 'USD'].join(''), ['Gl', 'USDPsm'].join('')]) assert.ok(WITHDRAWN.test(s), s)
  for (const s of ['USDC.e', 'Gully USD', 'glue', 'usd']) assert.ok(!WITHDRAWN.test(s), s)
})

test('no source, data file, index or public asset names the retired stable', () => {
  const dirs = fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory() && !SKIP_DIR.has(d.name) && d.name !== 'dist').map((d) => d.name)
  const hits = dirs.flatMap((d) => hitsIn(path.join(ROOT, d)))
  for (const f of fs.readdirSync(ROOT, { withFileTypes: true })) if (f.isFile() && !BINARY.test(f.name) && WITHDRAWN.test(fs.readFileSync(path.join(ROOT, f.name), 'utf8'))) hits.push(f.name)
  assert.deepEqual(hits, [])
})

test('the built site (dist/) does not name it', { skip: fs.existsSync(path.join(ROOT, 'dist')) ? false : 'no dist/ here: run after npm run build' }, () => {
  assert.deepEqual(hitsIn(path.join(ROOT, 'dist')), [])
})

test('a quest about it never reaches the hub answer', () => {
  const title = ['Hold 0.5 gl', 'USD for 10 blocks'].join('')
  const q = readQuests({ quests: 2, recent: [{ questId: '29', account: '0x12fa4f1f2b90422da4d425fbcf4be50e80fd7a93', timestamp: '1', title }] }, { quests: [{ id: '29', title }, { id: '1', title: 'Claim your .gully name' }] })
  assert.deepEqual(q.quests.map((x) => x.id), ['1'])
  assert.deepEqual(q.recent, [])
  assert.ok(!WITHDRAWN.test(JSON.stringify(q)))
})

test('Gully AI never indexes a chunk that names it (remote docs included)', () => {
  const name = ['gl', 'USD'].join('')
  const { kept, rejected } = guardChunks([{ url: 'https://docs.example/changelog/', title: 'Changelog', section: '2026-11-01', text: `${name} is retired` }, { url: 'https://docs.example/stablecoins/', title: 'Stablecoins', section: 'USDC.e', text: 'USDC.e is the stablecoin' }])
  assert.deepEqual(kept.map((c) => c.section), ['USDC.e'])
  assert.equal(rejected[0].reason, 'retired asset')
})
