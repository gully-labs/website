// Retrieval eval for Gully AI: recall@5, MRR, latency and memory of open CPU embedding models (and an optional
// cross-encoder reranker) against the committed index and scripts/ai-eval/retrieval-questions.tsv.
//
//   cd ops/ai-sidecar && npm i            (transformers.js, ONNX; weights download to ops/ai-sidecar/models, not git)
//   node scripts/ai-eval/embed-eval.mjs --models "Xenova/bge-small-en-v1.5|cls|Represent this sentence for searching relevant passages: |" \
//        --rerank Xenova/bge-reranker-base --out design-report.json
// --models: ';'-separated "id|pooling|queryPrefix|docPrefix". Default: a few MIT/Apache models.
// Gold is the passage's url (anchor level); "page" columns count a hit on the same page. The hybrid column is
// BM25 + expanded BM25 + vectors fused by the same rrf()/rerank()/capPerPage() as server/ask.mjs retrieve().
// Voyage is not run here (no key on the laptop); pass --voyage to include it when VOYAGE_API_KEY is set.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { makeIndex, expandQuery, rrf, rerank, capPerPage, cosine } from '../../server/ask-index.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? '1' : all[i + 1]]] : a), []))
const tf = await import(pathToFileURL(path.join(root, 'ops', 'ai-sidecar', 'node_modules', '@huggingface', 'transformers', 'dist', 'transformers.node.mjs')).href)
tf.env.cacheDir = path.join(root, 'ops', 'ai-sidecar', 'models')

const doc = JSON.parse(fs.readFileSync(path.join(root, 'server', 'data', 'ask-index.json'), 'utf8'))
const chunks = doc.chunks
const index = makeIndex(chunks)
const embedText = (c) => `${c.title ?? ''}${c.section ? ` — ${c.section}` : ''}\n${c.text}`
const qs = fs.readFileSync(path.join(root, 'scripts', 'ai-eval', 'retrieval-questions.tsv'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
  const [gold, q] = l.split('\t')
  const url = gold.startsWith('http') ? gold : `https://docs.gullylabs.xyz/${gold}`
  return { q, url, page: url.split('#')[0] }
})
const missing = qs.filter((x) => !chunks.some((c) => c.url === x.url))
if (missing.length) console.error(`gold url not in index (${missing.length}), excluded:`, missing.map((m) => m.url.replace('https://docs.gullylabs.xyz/', '')).join(' '))
const Q = qs.filter((x) => chunks.some((c) => c.url === x.url))

const stats = (ranked) => {
  // ranked: array (per question) of result lists [{chunk}]
  let r5 = 0, p5 = 0, mrr = 0
  ranked.forEach((list, i) => {
    const g = Q[i]
    const pos = list.findIndex((r) => r.chunk.url === g.url)
    const ppos = list.findIndex((r) => r.chunk.url.split('#')[0] === g.page)
    if (pos >= 0 && pos < 5) r5++
    if (ppos >= 0 && ppos < 5) p5++
    if (pos >= 0) mrr += 1 / (pos + 1)
  })
  const n = ranked.length
  return { recall5: +(r5 / n).toFixed(3), pageRecall5: +(p5 / n).toFixed(3), mrr: +(mrr / n).toFixed(3) }
}
const bm25Only = (q) => index.search(q, { k: 30, perUrl: Infinity })
const hybridPipe = (q, near) => {
  const lists = [{ name: 'bm25', items: bm25Only(q) }]
  const ex = expandQuery(q)
  if (ex) lists.push({ name: 'expanded', items: index.search(ex, { k: 30, perUrl: Infinity }), weight: 0.8 })
  if (near) lists.push({ name: 'vector', items: near.slice(0, 30).filter((r) => r.score >= 0.2) })
  return rerank(q, rrf(lists).slice(0, 20))
}
const out = { date: new Date().toISOString(), questions: Q.length, chunks: chunks.length, rows: [] }
const base = stats(Q.map((x) => capPerPage(hybridPipe(x.q, null), { k: 5, perUrl: 2 })))
out.rows.push({ name: 'BM25 + synonyms (current fallback)', ...base })
console.log(out.rows[0])

const specs = String(args.models ?? 'Xenova/bge-small-en-v1.5|cls|Represent this sentence for searching relevant passages: |;Xenova/e5-small-v2|mean|query: |passage: ;Xenova/gte-small|mean||;Xenova/all-MiniLM-L6-v2|mean||').split(';').map((s) => s.split('|'))
let reranker = null
if (args.rerank) {
  const tok = await tf.AutoTokenizer.from_pretrained(args.rerank)
  const model = await tf.AutoModelForSequenceClassification.from_pretrained(args.rerank, { dtype: 'q8' })
  reranker = async (q, docs) => {
    const s = []
    for (let i = 0; i < docs.length; i += 8) {
      const part = docs.slice(i, i + 8)
      const { logits } = await model(tok(new Array(part.length).fill(q), { text_pair: part, padding: true, truncation: true, max_length: Number(args.rerankLen) || 512 }))
      for (let r = 0; r < part.length; r++) s.push(logits.data[r * (logits.dims[1] ?? 1)])
    }
    return s
  }
}

for (const [id, pooling = 'mean', qp = '', dp = ''] of specs) {
  const t0 = Date.now()
  const ext = await tf.pipeline('feature-extraction', id, { dtype: 'q8' })
  const loadMs = Date.now() - t0
  const enc = async (texts) => {
    const r = []
    for (let i = 0; i < texts.length; i += 16) {
      const t = await ext(texts.slice(i, i + 16), { pooling, normalize: true })
      const d = t.dims[1]
      for (let k = 0; k < t.dims[0]; k++) r.push(Float32Array.from(t.data.slice(k * d, (k + 1) * d)))
    }
    return r
  }
  const t1 = Date.now()
  const dv = await enc(chunks.map((c) => dp + embedText(c).slice(0, 1800)))
  const indexMs = Date.now() - t1
  const qlat = []
  const qv = []
  for (const x of Q) {
    const a = Date.now()
    qv.push((await enc([qp + x.q]))[0])
    qlat.push(Date.now() - a)
  }
  const nearOf = (v) => chunks.map((c, i) => ({ chunk: c, score: cosine(v, dv[i]) })).sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
  const vecOnly = stats(qv.map((v) => nearOf(v).slice(0, 5)))
  const hybrid = stats(qv.map((v, i) => capPerPage(hybridPipe(Q[i].q, nearOf(v)), { k: 5, perUrl: 2 })))
  const row = { name: id, dim: dv[0].length, loadMs, indexAllChunksMs: indexMs, queryMsP50: qlat.sort((a, b) => a - b)[Math.floor(qlat.length / 2)], queryMsP95: qlat[Math.floor(qlat.length * 0.95)], rssMB: Math.round(process.memoryUsage().rss / 1048576), vectorOnly: vecOnly, hybrid }
  if (reranker) {
    const ranked = []
    const lat = []
    for (let i = 0; i < Q.length; i++) {
      const top = hybridPipe(Q[i].q, nearOf(qv[i])).slice(0, Number(args.rerankN) || 20)
      const a = Date.now()
      const sc = await reranker(Q[i].q, top.map((r) => embedText(r.chunk).slice(0, 1800)))
      lat.push(Date.now() - a)
      ranked.push(capPerPage(top.map((r, k) => ({ ...r, ce: sc[k] })).sort((x, y) => y.ce - x.ce), { k: 5, perUrl: 2 }))
    }
    row.hybridPlusRerank = { ...stats(ranked), rerank20MsP50: lat.sort((a, b) => a - b)[Math.floor(lat.length / 2)], model: args.rerank }
  }
  out.rows.push(row)
  console.log(JSON.stringify(row))
  await ext.dispose?.()
}
if (args.out) fs.writeFileSync(args.out, JSON.stringify(out, null, 2))
