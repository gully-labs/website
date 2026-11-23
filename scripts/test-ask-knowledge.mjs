// Unit tests for the Gully AI hardening modules: public-text guard, product knowledge (coverage, versions), docs sites,
// capacity helpers (gate, cap alerts, ops view, cost), the eval runner. No server, no network.
//
//   node --test scripts/test-ask-knowledge.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { findLeak, guardChunks } from '../server/ask-public-guard.mjs'
import { COVERED_MIN, PRODUCTS, VersionStore, diffSnapshots, knowledgeView, productOf, publicView, statusOf } from '../server/ask-knowledge.mjs'
import { DOC_SITES, docSource, htmlToSections, pageUrls } from '../server/ask-docs-sites.mjs'
import { CapAlerter, Gate, capLevel, costOf, opsView, percentile, pricesFromEnv } from '../server/ask-ops.mjs'
import { EVAL_SET, EvalHistory, inventedNumbers, runEval } from '../server/ask-eval.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const chunk = (o) => ({ id: Math.random().toString(36).slice(2), source: 'Docs', title: 'T', url: 'https://docs.gullylabs.xyz/x', section: null, text: 'some words here', updatedAt: '2026-11-01T00:00:00.000Z', ...o })

test('public-text guard: refuses internal data, lets public docs through', () => {
  const bad = {
    'box address': 'ssh into 57.120.0.1 to read it',
    'server path': 'the files live in /srv/gully-web/data',
    'admin console': 'sign in at admin.swoopads.xyz first',
    'secret or key': 'use sk-ant-api03-abcdefghijkl',
    'env assignment': 'ANTHROPIC_API_KEY=AbCdEf0123456789AbCdEf0123456789',
    'internal host name': 'run it on gully-l3 under the lock',
    'ssh command': 'ssh deploy@host',
    'private repo': 'see https://github.com/gully-labs/gully-ops/pull/9',
    'internal note': 'Owner decision pending on the price',
    'stack trace': 'at run (/app/server.mjs:10:5)',
  }
  for (const [reason, text] of Object.entries(bad)) assert.equal(findLeak(text), reason, text)
  for (const ok of ['Add one script line to your page.', 'Set ANTHROPIC_API_KEY=<your key> in the environment.', 'Docs live at https://docs.swoopads.xyz/tag/', 'RPC at https://rpc.gullyrpc.xyz/gullychain/evm/485590', 'Version 1.2.3.4 of the schema']) assert.equal(findLeak(ok), null, ok)
  const { kept, rejected } = guardChunks([chunk({ text: 'fine public text' }), chunk({ url: 'https://x/y', text: 'on /srv/tmp/job.sh we run it' })])
  assert.equal(kept.length, 1)
  assert.deepEqual(rejected.map((r) => r.reason), ['server path'])
})

test('public-text guard: the committed index and the corpus build are clean', () => {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/data/ask-index.json'), 'utf8'))
  const { rejected } = guardChunks(d.chunks)
  assert.deepEqual(rejected, [])
})

test('docs sites: fixed hosts, same-host https pages only, chrome stripped', () => {
  assert.ok(DOC_SITES.length >= 7)
  for (const s of DOC_SITES) assert.match(s.host, /^[a-z0-9.-]+\.(xyz|fun)$/)
  const site = { host: 'docs.swoopads.xyz' }
  const sitemap = '<urlset><url><loc>https://docs.swoopads.xyz/tag/</loc></url><url><loc>https://evil.example/x</loc></url><url><loc>http://docs.swoopads.xyz/plain</loc></url><url><loc>https://docs.swoopads.xyz/assets/a.js</loc></url><url><loc>https://docs.swoopads.xyz/api/key</loc></url></urlset>'
  assert.deepEqual(pageUrls(site, sitemap, 'https://docs.swoopads.xyz'), ['https://docs.swoopads.xyz/tag/'])
  assert.deepEqual(pageUrls(site, '<a href="/payouts/">p</a><a href="https://other.dev/">o</a><a href="#top">t</a>', 'https://docs.swoopads.xyz'), ['https://docs.swoopads.xyz/payouts/'])
  const h = htmlToSections('<html><title>Tag | Swoop Ads</title><body><nav>Menu Menu</nav><main><h1>Install the tag</h1><p>Add one script line to your page and a sponsor unit appears in it.</p><script>evil()</script></main><footer>Footer</footer></body></html>')
  assert.equal(h.title, 'Tag')
  assert.equal(h.sections[0].heading, 'Install the tag')
  assert.ok(!JSON.stringify(h).match(/Menu|evil|Footer/))
})

test('docs sites: a source reads its pages, the guard drops a leaking page, a dead site reports its error', async () => {
  const site = { key: 'docs:t', label: 'T docs', source: 'T docs', host: 'docs.example.xyz', start: ['/'] }
  const pages = {
    'https://docs.example.xyz/sitemap.xml': '<loc>https://docs.example.xyz/a/</loc><loc>https://docs.example.xyz/b/</loc>',
    'https://docs.example.xyz/a/': '<title>A</title><main><h1>Alpha</h1><p>Alpha explains how the sponsor unit is drawn on a page and what it does when it has nothing to show.</p></main>',
    'https://docs.example.xyz/b/': '<title>B</title><main><h1>Beta</h1><p>Run it on gully-l3 as the deploy user with the lock held, then check the box at /srv/tmp/x for the result.</p></main>',
  }
  const f = async (u) => (u in pages ? { ok: true, status: 200, text: async () => pages[u] } : { ok: false, status: 404, text: async () => '' })
  const chunks = await docSource(site, async (fi, u) => {
    const r = await fi(u)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.text()
  }).load(f)
  assert.equal(chunks.length, 2)
  const { kept, rejected } = guardChunks(chunks)
  assert.deepEqual(kept.map((c) => c.url), ['https://docs.example.xyz/a/'])
  assert.equal(rejected.length, 1)
  await assert.rejects(
    docSource(site, async (fi, u) => {
      const r = await fi(u)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.text()
    }).load(async () => ({ ok: false, status: 503, text: async () => '' })),
    /503/,
  )
})

test('knowledge: products by what the page says, coverage Covered / Thin / Missing, totals', () => {
  assert.equal(statusOf(0), 'Missing')
  assert.equal(statusOf(1), 'Thin')
  assert.equal(statusOf(COVERED_MIN), 'Covered')
  assert.equal(productOf(chunk({ url: 'https://docs.swoopads.xyz/tag/' })), 'swoop')
  assert.equal(productOf(chunk({ url: 'https://docs.kre8.fun/coins', title: 'Coins' })), 'kre8')
  assert.equal(productOf(chunk({ url: 'https://docs.gullylabs.xyz/holder-map' })), 'holder-map')
  assert.equal(productOf(chunk({ url: 'https://docs.gullylabs.xyz/ipfs#pins' })), 'ipfs')
  assert.equal(productOf(chunk({ url: 'https://gullylabs.xyz/about', title: 'About us' })), 'general')
  assert.ok(PRODUCTS.every((p) => p.id && p.name && p.re && p.page))
  const chunks = [...Array(COVERED_MIN)].map((_, i) => chunk({ url: `https://docs.gullycore.xyz/p${i % 2}`, updatedAt: `2026-11-0${(i % 9) + 1}T00:00:00.000Z` })), one = chunk({ url: 'https://docs.swoopads.xyz/tag/', text: 'a b c' }), other = chunk({ url: 'https://gullylabs.xyz/about', title: 'About' })
  const v = knowledgeView({ chunks: [...chunks, one, other], remote: { sources: { 'docs:x': { label: 'X', ok: false, error: 'HTTP 503', lastGoodAt: null, rejected: 2, chunks: [] } } } })
  const by = Object.fromEntries(v.products.map((p) => [p.id, p]))
  assert.equal(by['gully-core'].status, 'Covered')
  assert.equal(by['gully-core'].pages.length, 2)
  assert.equal(by['gully-core'].lastIndexedAt, '2026-11-08T00:00:00.000Z')
  assert.equal(by.swoop.status, 'Thin')
  assert.equal(by.kre8.status, 'Missing')
  assert.equal(v.general.passages, 1)
  assert.equal(v.totals.passages, chunks.length + 2)
  assert.equal(v.totals.missing, v.products.filter((p) => p.status === 'Missing').length)
  assert.deepEqual(v.remote[0], { key: 'docs:x', label: 'X', ok: false, chunks: 0, lastGoodAt: null, error: 'HTTP 503', rejected: 2 })
  const pub = publicView(v)
  assert.ok(!JSON.stringify(pub).match(/HTTP 503|rejected|lastGoodAt/))
  assert.ok(pub.products.find((p) => p.id === 'swoop').pages[0].url)
})

test('versions: a baseline, then what a rebuild added, removed and changed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-ver-'))
  const store = new VersionStore(path.join(dir, 'v.json'))
  const a = chunk({ id: 'a', text: 'alpha text' }), b = chunk({ id: 'b', text: 'beta text' }), c = chunk({ id: 'c', text: 'gamma text' })
  assert.equal(store.record([a, b], '2026-11-01T00:00:00Z').reason, 'baseline')
  assert.equal(store.record([a, b], '2026-11-01T01:00:00Z'), null, 'no change, no version')
  const v = store.record([a, { ...b, text: 'beta text changed' }, c], '2026-11-02T00:00:00Z')
  assert.deepEqual(v.counts, { added: 1, removed: 0, changed: 1, total: 3 })
  const v2 = store.record([c], '2026-11-03T00:00:00Z')
  assert.deepEqual(v2.counts, { added: 0, removed: 2, changed: 0, total: 1 })
  assert.equal(store.read().versions.length, 3)
  assert.deepEqual(diffSnapshots({}, [a]).counts, { added: 1, removed: 0, changed: 0, total: 1 })
  fs.rmSync(dir, { recursive: true, force: true })
})

test('ops: percentiles, cost only with the owner price, cap levels and one alert per level per day', async () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3)
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10)
  assert.equal(percentile([], 50), null)
  assert.deepEqual(pricesFromEnv({}), { input: null, output: null, cacheRead: null, cacheWrite: null })
  assert.equal(costOf({ input: 1e6, output: 1e6 }, pricesFromEnv({})), null)
  const prices = pricesFromEnv({ ASK_PRICE_INPUT_PER_MTOK: '1', ASK_PRICE_OUTPUT_PER_MTOK: '5' })
  assert.equal(costOf({ input: 2e6, output: 1e6, cacheRead: 1e6 }, prices), 2 + 5 + 1)
  assert.equal(capLevel(79, 100), null)
  assert.equal(capLevel(80, 100), 'warn')
  assert.equal(capLevel(100, 100), 'full')
  const sent = []
  const al = new CapAlerter(async (t) => sent.push(t))
  assert.equal(al.check(10, 100, 'd1'), null)
  assert.equal(al.check(80, 100, 'd1').level, 'warn')
  assert.equal(al.check(81, 100, 'd1'), null)
  assert.equal(al.check(100, 100, 'd1').level, 'full')
  assert.equal(al.check(101, 100, 'd1'), null)
  assert.equal(al.check(80, 100, 'd2').level, 'warn', 'a new day alerts again')
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(sent.length, 3)
  const entries = [
    { at: '2026-11-20T10:00:00Z', channel: 'web', latencyMs: 1000, tokens: { input: 1e6, output: 0 } },
    { at: '2026-11-20T11:00:00Z', channel: 'web', latencyMs: 3000, tokens: { input: 0, output: 1e6 } },
    { at: '2026-11-21T11:00:00Z', channel: 'web', error: 'x', tokens: null },
    { at: '2026-11-21T12:00:00Z', channel: 'web', degraded: 'cap', tokens: null },
    { at: '2026-11-21T12:00:00Z', channel: 'draft', tokens: { input: 1e6, output: 0 } },
  ]
  const v = opsView(entries, { cap: 10, usedToday: 8, prices })
  assert.equal(v.answers, 4)
  assert.equal(v.errors, 1)
  assert.equal(v.degraded, 1)
  assert.equal(v.errorRate, 0.25)
  assert.deepEqual(v.latencyMs, { p50: 1000, p95: 3000, n: 2 })
  assert.equal(v.capPct, 80)
  assert.equal(v.capLevel, 'warn')
  assert.equal(v.costUsd, 1 + 5 + 1)
  assert.equal(v.perDay.length, 2)
  assert.equal(opsView(entries, { cap: 10, usedToday: 0, prices: pricesFromEnv({}) }).costUsd, null)
})

test('gate: runs up to max at once, queues the rest, refuses when the queue is full or the wait runs out', async () => {
  const g = new Gate({ max: 2, queue: 1, waitMs: 60 })
  let running = 0
  let peak = 0
  const job = (ms) => () => (running++, (peak = Math.max(peak, running)), new Promise((r) => setTimeout(() => (running--, r(ms)), ms)))
  const all = await Promise.allSettled([g.run(job(30)), g.run(job(30)), g.run(job(30)), g.run(job(30))])
  assert.equal(peak, 2)
  assert.deepEqual(all.map((x) => x.status), ['fulfilled', 'fulfilled', 'fulfilled', 'rejected'])
  assert.equal(all[3].reason.busy, true)
  const slow = new Gate({ max: 1, queue: 5, waitMs: 20 })
  const p1 = slow.run(job(100))
  await assert.rejects(slow.run(job(1)), (e) => e.busy)
  await p1
  assert.deepEqual(slow.stats(), { active: 0, queued: 0, max: 1, queueMax: 5 })
})

test('eval: numbers not in the sources are caught; the runner checks retrieval and answers; the history keeps 50', async () => {
  assert.deepEqual(inventedNumbers('It costs $19 a month [1] and 2,000 answers.', 'Pro is $19 a month. The cap is 2,000 a day.'), [])
  assert.deepEqual(inventedNumbers('It has 99.9% uptime and 12 chains.', 'It runs on a few chains.'), ['99.9%', '12'])
  assert.deepEqual(inventedNumbers('See [2] and step 3.', ''), [])
  assert.ok(EVAL_SET.length >= 20 && EVAL_SET.every((c) => c.id && c.q && c.checks.length))
  const cases = [
    { id: 'a', q: 'about a', checks: ['cite', 'nonumber'], url: /\/a$/ },
    { id: 'b', q: 'about b', checks: ['cite'], needs: 'remote', url: /swoopads/ },
    { id: 'u', q: 'unknowable', checks: ['unknown'] },
  ]
  const retrieveFn = async (q) => ({ results: [{ chunk: { url: q === 'about a' ? 'https://x/a' : 'https://x/z' } }] })
  const r1 = await runEval({ cases, retrieveFn, hasPages: () => false })
  assert.deepEqual(r1.results.map((r) => r.status), ['pass', 'skipped', 'skipped'])
  assert.equal(r1.layer, 'retrieval')
  const answerFn = async (q) => (q === 'unknowable' ? { answer: 'It costs 42 dollars.', answered: true, citations: [], sourceText: '' } : { answer: 'A is 7 [1].', answered: true, citations: [{ url: 'https://x/a' }], sourceText: 'a is 7' })
  const r2 = await runEval({ cases, retrieveFn, answerFn, hasPages: () => true })
  assert.deepEqual(r2.results.map((r) => r.status), ['pass', 'fail', 'fail'])
  assert.equal(r2.layer, 'answer')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-eval-'))
  const h = new EvalHistory(path.join(dir, 'h.jsonl'))
  for (let i = 0; i < 55; i++) h.add({ at: String(i), n: i })
  assert.equal(h.list().length, 50)
  assert.equal(h.list()[0].n, 54)
  fs.rmSync(dir, { recursive: true, force: true })
})
