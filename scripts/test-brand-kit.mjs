// The Gully Labs parent kit is vendored byte for byte (brand/gully-labs-kit-2026-11, locked in its .sha256 file), and
// the SVGs the site serves are those bytes. Any changed, missing or extra file fails (npm run test:brand-kit).
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KIT = path.join(ROOT, 'brand/gully-labs-kit-2026-11')
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const lock = new Map(fs.readFileSync(`${KIT}.sha256`, 'utf8').trim().split('\n').map((l) => [l.slice(66).trim(), l.slice(0, 64)]))
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))

test('every kit file matches the lock, and the kit has no file the lock does not list', () => {
  assert.equal(lock.size, 55)
  for (const [rel, want] of lock) assert.equal(sha(path.join(KIT, rel)), want, rel)
  assert.deepEqual(walk(KIT).map((f) => path.relative(KIT, f).split(path.sep).join('/')).sort(), [...lock.keys()].sort())
})

test('every SVG under public/brand/kit is a kit file, byte for byte', () => {
  const byHash = new Set(lock.values())
  const svgs = fs.readdirSync(path.join(ROOT, 'public/brand/kit')).filter((f) => f.endsWith('.svg'))
  assert.ok(svgs.length >= 14)
  for (const f of svgs) assert.ok(byHash.has(sha(path.join(ROOT, 'public/brand/kit', f))), f)
})
