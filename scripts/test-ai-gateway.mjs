// Tests for server/ai/* (gateway, rewrite, memory, rerank client, embed provider) with fake providers and local
// stub servers. No network, no keys.   node scripts/test-ai-gateway.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { makeGateway, fakeProvider, GatewayOff, GatewayError, runJson, openaiCompatProvider } from '../server/ai/gateway.mjs'
import { rewriteQuery } from '../server/ai/rewrite.mjs'
import * as memory from '../server/ai/memory.mjs'
import { rerankItems } from '../server/ai/rerank-client.mjs'
import { overlap } from '../server/ai/embed-provider.mjs'

let n = 0
const ok = (name) => console.log(`ok ${++n} ${name}`)
const env = (o) => Object.assign(process.env, o)

// routing + fallback + metrics
{
  const cheap = fakeProvider(() => { throw new GatewayError('boom', { status: 503 }) }, 'openai_compat')
  const claude = fakeProvider((r, t) => `claude:${t}`, 'anthropic')
  const gw = makeGateway({ providers: [claude, cheap] })
  env({ AI_PROVIDERS: 'anthropic,openai_compat' })
  delete process.env.AI_GATEWAY
  const a = await gw.run('classify', { messages: [{ role: 'user', content: 'x' }] })
  assert.equal(a.provider, 'anthropic'); assert.equal(a.fellBack, true); assert.equal(cheap.calls.length, 1)
  const b = await gw.run('answer', { messages: [{ role: 'user', content: 'x' }] })
  assert.equal(b.provider, 'anthropic'); assert.equal(b.fellBack, false); assert.equal(cheap.calls.length, 1) // answers never touch the cheap route
  const snap = gw.snapshot()
  assert.equal(snap.find((s) => s.provider === 'openai_compat').errors, 1)
  assert.equal(snap.find((s) => s.provider === 'anthropic').calls, 2)
  ok('routes cheap tasks to the open model first, falls back to Claude, answers stay on Claude, metrics count')
}
// custom routes + circuit breaker
{
  let t = 0
  const bad = fakeProvider(() => { throw new Error('down') }, 'openai_compat')
  const good = fakeProvider(() => 'fine', 'anthropic')
  const gw = makeGateway({ providers: [good, bad], now: () => t })
  env({ AI_PROVIDERS: 'anthropic,openai_compat', AI_ROUTES: JSON.stringify({ moderate: ['openai_compat', 'anthropic'] }) })
  for (let i = 0; i < 6; i++) await gw.run('moderate', { messages: [] })
  assert.equal(bad.calls.length, 5, 'breaker opens after 5 failures')
  t += 6 * 60_000
  await gw.run('moderate', { messages: [] })
  assert.equal(bad.calls.length, 6, 'tried again after the pause')
  delete process.env.AI_ROUTES
  ok('circuit breaker pauses a failing provider for 5 minutes')
}
// kill switch + unconfigured
{
  const gw = makeGateway({ providers: [fakeProvider(() => 'x', 'anthropic')] })
  env({ AI_GATEWAY: 'off' })
  await assert.rejects(gw.run('answer', { messages: [] }), GatewayOff)
  delete process.env.AI_GATEWAY
  env({ AI_PROVIDERS: 'openai_compat' })
  await assert.rejects(gw.run('answer', { messages: [] }), /no configured provider/)
  env({ AI_PROVIDERS: 'anthropic' })
  ok('kill switch and missing provider fail loudly')
}
// cost only from owner rates
{
  const gw = makeGateway({ providers: [fakeProvider(() => 'abcd', 'anthropic')] })
  await gw.run('answer', { messages: [{ role: 'user', content: 'hi' }] })
  assert.equal(gw.snapshot()[0].costUsd, null)
  env({ AI_COST_JSON: JSON.stringify({ anthropic: { in: 1000000, out: 2000000 } }) })
  assert.ok(gw.snapshot()[0].costUsd > 0)
  delete process.env.AI_COST_JSON
  ok('no cost without owner-entered rates')
}
// openai-compatible provider against a stub
{
  let seen
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { seen = JSON.parse(b); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '{"query":"api rate limit"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3 } })) }) }).listen(0)
  env({ AI_OPENAI_URL: `http://127.0.0.1:${srv.address().port}/v1`, AI_PROVIDERS: 'openai_compat,anthropic', AI_MODEL_REWRITE_OPENAI_COMPAT: 'qwen-small', ASK_REWRITE: '1', ANTHROPIC_API_KEY: '' })
  const gw = makeGateway({ providers: [openaiCompatProvider] })
  const r = await rewriteQuery(gw, 'and the limit?', [{ role: 'user', content: 'tell me about the API' }, { role: 'assistant', content: 'It has a tracker endpoint.' }])
  assert.equal(r.query, 'api rate limit'); assert.equal(seen.model, 'qwen-small'); assert.equal(seen.messages[0].role, 'system')
  const solo = await rewriteQuery(gw, 'standalone question', [])
  assert.equal(solo.rewritten, false)
  // provider down: the question comes back unchanged
  srv.close()
  const f = await rewriteQuery(gw, 'and the limit?', [{ role: 'user', content: 'a' }])
  assert.equal(f.query, 'and the limit?')
  delete process.env.ASK_REWRITE
  ok('OpenAI-compatible provider + query rewrite (and unchanged on failure)')
}
// runJson
{
  const gw = makeGateway({ providers: [fakeProvider(() => 'sure: {"a":1}', 'anthropic')] })
  env({ AI_PROVIDERS: 'anthropic' })
  assert.equal((await runJson(gw, 'classify', { messages: [] })).data.a, 1)
  ok('runJson extracts the object')
}
// memory: opt-in, hashed, retention, forget
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-mem-'))
  env({ DATA_DIR: dir, ASK_MEMORY: '1', ASK_MEMORY_DAYS: '14' })
  const k = memory.memKey('ws1', '0xABCDEF0000000000000000000000000000000001')
  assert.equal(memory.addNote(k, 'uses Base'), false, 'no note before opt-in')
  memory.setEnabled(k, true)
  const t0 = Date.now()
  assert.equal(memory.addNote(k, 'uses Base', t0), true)
  assert.deepEqual(memory.getMemory(k, t0 + 1000).notes, ['uses Base'])
  assert.deepEqual(memory.getMemory(k, t0 + 15 * 86_400_000).notes, [], 'expired')
  assert.ok(!fs.readFileSync(path.join(dir, 'ask-memory.json'), 'utf8').toLowerCase().includes('abcdef'), 'raw wallet never stored')
  assert.match(memory.memoryPrompt(k), /uses Base/)
  memory.forget(k)
  assert.equal(memory.getMemory(k).enabled, false)
  process.env.ASK_MEMORY = '0'
  assert.equal(memory.setEnabled(k, true), false, 'flag off = inert')
  ok('memory is opt-in, hashed, expiring, deletable, flag-gated')
}
// rerank client against a stub
{
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { const j = JSON.parse(b); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ results: j.documents.map((_, i) => ({ index: i, score: i })).reverse() })) }) }).listen(0)
  env({ ASK_RERANK: '1', ASK_LOCAL_EMBED_URL: `http://127.0.0.1:${srv.address().port}` })
  const items = ['a', 'b', 'c'].map((t) => ({ chunk: { title: t, text: t } }))
  const r = await rerankItems('q', items)
  assert.equal(r.applied, true); assert.deepEqual(r.items.map((x) => x.chunk.title), ['c', 'b', 'a'])
  srv.close()
  const down = await rerankItems('q', items)
  assert.equal(down.applied, false); assert.equal(down.items, items)
  delete process.env.ASK_RERANK
  assert.equal((await rerankItems('q', items)).applied, false)
  ok('reranker re-orders, and never breaks retrieval when down or off')
}
assert.equal(overlap(['a', 'b'], ['b', 'c']), 1 / 3)
ok('shadow overlap metric')
console.log(`\nall ${n} passed`)
