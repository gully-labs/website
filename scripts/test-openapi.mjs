// The public OpenAPI document of the Gully AI API stays in step with the code and stays fit to publish.
// Run: node --test scripts/test-openapi.mjs   (no dependencies; regenerate with node scripts/gen-openapi.mjs)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DOCS, EXCLUDED, buildGullyAi, publicPrefixRoutes, routeSourceFiles, routeMethod, askLimits, corsOpenPaths, rateLimitHeaders, errorAnswers, publicHost, explainOnByDefault } from './gen-openapi.mjs'
import { checkPublicSpec, stableJson, isPlaceholderHex } from './openapi-safety.mjs'

const FILE = 'openapi/gully-ai.json'
const HOSTS = ['gullylabs.xyz']
const text = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const committed = () => JSON.parse(text(FILE))
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']
const operations = (spec) => Object.entries(spec.paths).flatMap(([p, item]) => Object.entries(item).filter(([m]) => METHODS.includes(m)).map(([m, op]) => ({ path: p, method: m, op })))

test(`${FILE} is what the generator writes (run node scripts/gen-openapi.mjs)`, () => {
  assert.deepEqual(Object.keys(DOCS), [FILE])
  assert.equal(text(FILE), stableJson(buildGullyAi()))
})

test(`${FILE} is fit to publish`, () => {
  assert.equal(publicHost(), HOSTS[0])
  assert.deepEqual(checkPublicSpec(committed(), { hosts: HOSTS }), [])
  assert.deepEqual(committed().servers.map((s) => s.url), ['https://gullylabs.xyz'])
})

test('every public route in the code is in the spec with its method, and nothing else', () => {
  const spec = buildGullyAi()
  const fromCode = publicPrefixRoutes()
  assert.ok(fromCode.includes('/api/ask') && fromCode.includes('/api/ask/status') && fromCode.includes('/api/ask/knowledge') && fromCode.includes('/api/ai/explain-tx'))
  assert.deepEqual(Object.keys(spec.paths).sort(), fromCode.filter((r) => !EXCLUDED[r]))
  for (const [r, why] of Object.entries(EXCLUDED)) assert.ok(typeof why === 'string' && why.length > 10, `${r} needs a reason`)
  const ask = text('server/ask.mjs')
  const explain = text('server/ai/explain-tx.mjs')
  for (const { path, method } of operations(spec)) assert.equal(method, routeMethod(path, path.startsWith('/api/ai/') ? explain : ask), `${path} method`)
  assert.ok(routeSourceFiles().includes('server/server.mjs') && routeSourceFiles().length > 50)
})

test('a new route under a public prefix fails the generator until it is documented or excluded', () => {
  const more = publicPrefixRoutes(["if (url.pathname === '/api/ask/brandnew') x()", 'if (p === "/api/ai/other") y()', "p.startsWith('/api/ask/embed/')", "if (p === '/api/admin/ask/log') z()", "fetch('/api/asking')"])
  assert.deepEqual(more, ['/api/ai/other', '/api/ask/brandnew', '/api/ask/embed/'])
  assert.throws(() => buildGullyAi({ routes: [...publicPrefixRoutes(), '/api/ask/brandnew'].sort() }), /\/api\/ask\/brandnew is in the code but is neither documented nor on EXCLUDED/)
  assert.throws(() => buildGullyAi({ routes: publicPrefixRoutes().filter((r) => r !== '/api/ask/feedback') }), /documented but no longer in the code/)
  // a handler that starts answering another method is drift too
  const flipped = text('server/ask.mjs').replace("if (p !== '/api/ask') return false\n  if (req.method !== 'POST')", "if (p !== '/api/ask') return false\n  if (req.method !== 'GET')")
  assert.throws(() => buildGullyAi({ askSrc: flipped }), /\/api\/ask now answers GET/)
})

test('nothing under /api/admin, and no admin wording, is in the spec', () => {
  const spec = committed()
  for (const p of Object.keys(spec.paths)) assert.ok(/^\/api\/(ask|ai)(\/|$)/.test(p) && !p.includes('admin'), p)
  const all = text(FILE)
  assert.ok(!/\/api\/admin/.test(all))
  assert.ok(!/\badmin\b/i.test(all), 'the word admin')
  assert.ok(text('server/ask.mjs').includes("'/api/admin/ask/log'"), 'the admin routes still exist in the code, so the check above means something')
})

test('limits, headers, errors and the try-it list come from the code', () => {
  const spec = committed()
  const L = askLimits()
  assert.equal(spec.components.schemas.AskRequest.properties.question.maxLength, L.maxQuestion)
  assert.deepEqual(spec['x-rate-limit'].perVisitor, { perMinute: L.perVisitorPerMinute, perDay: L.perVisitorPerDay })
  assert.equal(spec['x-rate-limit'].service.perDay, L.perDayService)
  assert.deepEqual(spec['x-rate-limit'].headers, rateLimitHeaders())
  assert.ok(spec.info.description.includes(`${L.perVisitorPerMinute} a minute, ${L.perVisitorPerDay} a day`))
  // a changed default changes the document
  assert.equal(askLimits(text('server/ask.mjs').replace('export const MAX_QUESTION = 500', 'export const MAX_QUESTION = 800')).maxQuestion, 800)
  // every error answer in the code is listed, with wording
  assert.equal(spec['x-errors'].length, errorAnswers().length)
  for (const e of spec['x-errors']) assert.ok(Number.isInteger(e.http) && e.meaning.length > 10 && (e.code === null || typeof e.code === 'string'))
  assert.ok(spec['x-errors'].some((e) => e.http === 429) && spec['x-errors'].some((e) => e.code === 'busy'))
  // try-it: only GET operations whose path allows cross-origin reads; never the POST that spends the allowance
  const ops = operations(spec)
  const cors = corsOpenPaths()
  assert.deepEqual(spec['x-try-it'].operations.sort(), ops.filter((o) => o.method === 'get' && cors.includes(o.path)).map((o) => o.op.operationId).sort())
  assert.ok(!spec['x-try-it'].operations.includes('askQuestion'))
  assert.equal(spec['x-try-it'].keyless, true)
  assert.deepEqual(corsOpenPaths("if (url.pathname === '/api/ask/status') res.setHeader('Access-Control-Allow-Origin', '*')"), ['/api/ask/status'])
})

test('Explain this transaction is marked as not switched on while the code keeps it off', () => {
  const op = committed().paths['/api/ai/explain-tx'].post
  assert.equal(explainOnByDefault(), false)
  assert.equal(op['x-status'], 'off')
  assert.match(op.summary, /not switched on yet/)
  assert.match(op.description, /Not switched on yet/)
  const on = buildGullyAi({ explainSrc: text('server/ai/explain-tx.mjs').replace("?? '0') === '1'", "?? '1') === '1'") })
  assert.equal(on.paths['/api/ai/explain-tx'].post['x-status'], undefined)
})

test('every operation is complete and the wording follows the public rules', () => {
  const spec = committed()
  assert.equal(spec.openapi, '3.1.0')
  assert.equal(spec.info.title, 'Gully AI')
  assert.equal(spec.info['x-generated-by'], 'scripts/gen-openapi.mjs')
  const refs = [...text(FILE).matchAll(/"#\/components\/schemas\/(\w+)"/g)].map((m) => m[1])
  for (const r of refs) assert.ok(spec.components.schemas[r], `schema ${r}`)
  for (const { path, method, op } of operations(spec)) {
    const where = `${method.toUpperCase()} ${path}`
    assert.ok(op.operationId && op.summary && op.description && op.tags?.length, where)
    assert.ok(spec.tags.some((t) => t.name === op.tags[0]), where)
    assert.ok(op.responses[200].content, where)
    if (method === 'post') assert.ok(op.requestBody.content['application/json'].schema && op.parameters.some((p) => p.name === 'X-Requested-With' && p.required), where)
    for (const [code, r] of Object.entries(op.responses)) for (const [type, c] of Object.entries(r.content ?? {})) assert.ok(c.schema && (c.example !== undefined || c.examples), `${where} ${code} ${type}`)
  }
  assert.ok(spec.paths['/api/ask'].post.responses[200].content['text/event-stream'].example.startsWith('event: status\n'))
  const all = text(FILE)
  assert.deepEqual(all.match(/\b(safe|safely|verified|guaranteed?|audited)\b/gi) ?? [], [], 'claim words')
  assert.deepEqual(all.match(/\b(anthropic|claude|voyage|openai)\b/gi) ?? [], [], 'vendor names')
  assert.deepEqual(all.match(/process\.env|\bflag\b|\benv\b/gi) ?? [], [], 'flag or environment wording')
  for (const m of all.match(/0x[0-9a-fA-F]{40,64}/g) ?? []) assert.ok(isPlaceholderHex(m), m)
})

test('the safety check catches what must not be published', () => {
  const bad = (edit) => {
    const s = committed()
    edit(s)
    return checkPublicSpec(s, { hosts: HOSTS })
  }
  assert.ok(bad((s) => (s.paths['/api/admin/ask/log'] = { get: { operationId: 'x', summary: 'x', responses: { 200: { description: 'x' } } } })).some((f) => f.includes('internal path')))
  assert.ok(bad((s) => s.servers.push({ url: 'http://10.0.0.5:8080' })).length >= 2)
  assert.ok(bad((s) => (s.info.description += ' set ASK_DAILY_CAP=1')).some((f) => f.includes('environment')))
  assert.ok(bad((s) => (s.info.description += ' 0x52908400098527886E0F7030069857D2E4169EE7')).some((f) => f.includes('address')))
})
