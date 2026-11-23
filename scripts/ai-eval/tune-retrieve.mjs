// Fast retrieval tuning from cached vectors (embed-eval.mjs --cache DIR). Compares v1 (ask.mjs retrieve()),
// plain vector search and fuseV2 variants; grid search on the odd questions, checked on the even ones (and the reverse)
// so a weight is not just fitted to this set.   node scripts/ai-eval/tune-retrieve.mjs /tmp/vcache/<model>.json
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeIndex, expandQuery, rrf, rerank, capPerPage, cosine } from '../../server/ask-index.mjs'
import { fuseV2, DEFAULTS, PER_URL_V2 } from '../../server/ai/retrieve-v2.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const cache = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const allChunks = JSON.parse(fs.readFileSync(path.join(root, 'server', 'data', 'ask-index.json'), 'utf8')).chunks
// The cache is keyed by chunk id, so an index that changed since the cache was made still lines up (chunks without a vector are left out).
const vecOf = new Map(cache.chunkIds.map((id, j) => [id, cache.dv[j]]).filter(([, v]) => v))
const chunks = allChunks.filter((c) => vecOf.has(c.id))
const index = makeIndex(chunks)
const gold = new Map(fs.readFileSync(process.argv[3] ?? path.join(root, 'scripts', 'ai-eval', 'retrieval-questions.tsv'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t')).map(([g, q]) => [q, g.startsWith('http') ? g : `https://docs.gullylabs.xyz/${g}`]))
const Q = cache.questions.map((q, i) => ({ q, url: gold.get(q), v: cache.qv[i] })).filter((x) => x.v && x.url)

const lists = Q.map((x) => {
  const near = chunks.map((c) => ({ chunk: c, score: cosine(x.v, vecOf.get(c.id)) })).sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id)).slice(0, 30)
  const ex = expandQuery(x.q)
  return { bm25: index.search(x.q, { k: 30, perUrl: Infinity }), expanded: ex ? index.search(ex, { k: 30, perUrl: Infinity }) : [], vector: near }
})
const score = (rankFn, idx) => {
  let r5 = 0, mrr = 0, p5 = 0
  for (const i of idx) {
    const list = rankFn(Q[i].q, lists[i])
    const pos = list.findIndex((r) => r.chunk.url === Q[i].url)
    if (pos >= 0 && pos < 5) r5++
    if (list.slice(0, 5).some((r) => r.chunk.url.split('#')[0] === Q[i].url.split('#')[0])) p5++
    if (pos >= 0) mrr += 1 / (pos + 1)
  }
  return { recall5: +(r5 / idx.length).toFixed(3), pageRecall5: +(p5 / idx.length).toFixed(3), mrr: +(mrr / idx.length).toFixed(3) }
}
const all = Q.map((_, i) => i)
const odd = all.filter((i) => i % 2), even = all.filter((i) => !(i % 2))
const cap = (l) => capPerPage(l, { k: 5, perUrl: 2 })
const v1 = (q, L) => cap(rerank(q, rrf([{ name: 'bm25', items: L.bm25 }, ...(L.expanded.length ? [{ name: 'expanded', items: L.expanded, weight: 0.8 }] : []), { name: 'vector', items: L.vector.filter((r) => r.score >= 0.2) }]).slice(0, 20)))
const vec = (q, L) => L.vector.slice(0, 5)
const v2 = (o) => (q, L) => capPerPage(fuseV2(q, L, o), { k: 5, perUrl: PER_URL_V2 })
console.log('model', cache.model, 'questions', Q.length, 'chunks', chunks.length, 'of', allChunks.length)
console.log('v1 current       ', JSON.stringify(score(v1, all)))
console.log('vector only      ', JSON.stringify(score(vec, all)))
console.log('v2 defaults      ', JSON.stringify(score(v2({}), all)))

const grid = []
for (const wVector of [1, 2, 2.5, 4, 8]) for (const wBm25 of [0.5, 1]) for (const wExpanded of [0, 0.6]) for (const coverage of [0, 0.08, 0.2]) for (const prior of [0, 0.01, 0.03]) grid.push({ wVector, wBm25, wExpanded, coverage, head: coverage / 2, prior })
const best = (idx) => grid.map((o) => ({ o, s: score(v2(o), idx) })).sort((a, b) => b.s.recall5 + b.s.mrr - (a.s.recall5 + a.s.mrr))[0]
const bo = best(odd), be = best(even)
console.log('tuned on odd  -> held-out even:', JSON.stringify(bo.o), 'train', JSON.stringify(bo.s), 'test', JSON.stringify(score(v2(bo.o), even)))
console.log('tuned on even -> held-out odd :', JSON.stringify(be.o), 'train', JSON.stringify(be.s), 'test', JSON.stringify(score(v2(be.o), odd)))
console.log('v1 on even', JSON.stringify(score(v1, even)), 'v1 on odd', JSON.stringify(score(v1, odd)), '| vector on even', JSON.stringify(score(vec, even)), 'odd', JSON.stringify(score(vec, odd)))
const ba = best(all)
console.log('best on all (in-sample):', JSON.stringify(ba.o), JSON.stringify(ba.s))
console.log('defaults', JSON.stringify(DEFAULTS))
