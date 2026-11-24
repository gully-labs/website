// A server/ subdirectory imported by any server/*.mjs must be copied into the image (a missing COPY crash-looped a deploy
// once: server/ai). Entry is server/server.mjs; the image copies server/*.mjs flat, then each directory by name.
//   node --test scripts/test-dockerfile-copies.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const server = path.join(here, '..', 'server')
const docker = fs.readFileSync(path.join(here, '..', 'Dockerfile'), 'utf8')

test('every server/ directory that server code imports is COPYed by the Dockerfile', () => {
  const dirs = new Set()
  for (const f of fs.readdirSync(server)) {
    if (!/\.(mjs|js)$/.test(f)) continue
    const src = fs.readFileSync(path.join(server, f), 'utf8')
    for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)['"]\.\/([\w-]+)\/[^'"]+['"]/g)) dirs.add(m[1])
  }
  assert.ok(dirs.size > 0)
  const has = (d) => docker.split(/\r?\n/).some((l) => l.trim().replace(/\s+/g, ' ') === `COPY server/${d} ./${d}`)
  const missing = [...dirs].filter((d) => !has(d))
  assert.deepEqual(missing, [], `Dockerfile lacks COPY server/<dir> ./<dir> for: ${missing.join(', ')}`)
  assert.ok(dirs.has('surfaces') && dirs.has('ai'))
})

test('files inside copied directories import siblings or ../ files only (flat runtime layout)', () => {
  for (const d of ['ai', 'surfaces']) {
    for (const f of fs.readdirSync(path.join(server, d))) {
      if (!/\.mjs$/.test(f)) continue
      const src = fs.readFileSync(path.join(server, d, f), 'utf8')
      for (const m of src.matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)) {
        assert.ok(/^\.\/[\w.-]+$/.test(m[1]) || /^\.\.\/(?:vendor\/)?[\w.-]+\.mjs$/.test(m[1]), `${d}/${f} imports ${m[1]}`)
      }
    }
  }
})
