// Unit tests for server/ask-health.mjs (stored provider health + the free startup probe). No server, no network.
//   node --test scripts/test-ask-health.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { KEY_ERROR, probeProvider, readHealth, writeHealth } from '../server/ask-health.mjs'

test('store: round trip, missing and broken files, long errors cut', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-health-'))
  const f = path.join(dir, 'sub', 'ask-health.json')
  assert.equal(readHealth(f), null)
  assert.equal(writeHealth(f, { ok: false, lastError: 'x'.repeat(500), since: '2026-11-23T22:24:43.621Z', failingN: 3, failingSince: '2026-11-23T22:00:00.000Z' }, '2026-11-23T22:25:00.000Z'), true)
  const d = readHealth(f)
  assert.deepEqual({ ...d, lastError: d.lastError.length }, { ok: false, lastError: 200, since: '2026-11-23T22:24:43.621Z', failingN: 3, failingSince: '2026-11-23T22:00:00.000Z', at: '2026-11-23T22:25:00.000Z' })
  fs.writeFileSync(f, '{broken')
  assert.equal(readHealth(f), null)
  fs.writeFileSync(f, JSON.stringify({ ok: 'yes' }))
  assert.equal(readHealth(f), null)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('probe: one GET with the key, no body; 200 ok, 401/403 unavailable, anything else unknown', async () => {
  const seen = []
  const f = (status) => async (u, o) => (seen.push({ u, o }), { status })
  assert.equal(await probeProvider({ base: 'https://api.example', key: 'k'.repeat(24), fetchImpl: f(200) }), 'ok')
  assert.equal(seen[0].u, 'https://api.example/v1/models?limit=1')
  assert.equal(seen[0].o.method, 'GET')
  assert.equal(seen[0].o.body, undefined)
  assert.equal(seen[0].o.headers['x-api-key'], 'k'.repeat(24))
  assert.equal(await probeProvider({ base: 'b', key: 'k', fetchImpl: f(401) }), 'unavailable')
  assert.equal(await probeProvider({ base: 'b', key: 'k', fetchImpl: f(403) }), 'unavailable')
  for (const s of [429, 500, 529, 404]) assert.equal(await probeProvider({ base: 'b', key: 'k', fetchImpl: f(s) }), 'unknown')
  const down = async () => {
    throw new Error('down')
  }
  assert.equal(await probeProvider({ base: 'b', key: 'k', fetchImpl: down }), 'unknown')
  assert.equal(await probeProvider({ base: 'b', key: null, fetchImpl: f(200) }), 'unknown')
})

test('a key problem is told apart from a billing problem', () => {
  assert.ok(KEY_ERROR.test('invalid x-api-key'))
  assert.ok(KEY_ERROR.test('startup probe: the provider refused the key'))
  assert.ok(!KEY_ERROR.test('Your credit balance is too low to access the Anthropic API.'))
})
