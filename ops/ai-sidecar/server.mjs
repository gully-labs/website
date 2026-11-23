// Gully AI sidecar: CPU embeddings and cross-encoder reranking over HTTP (ONNX through transformers.js).
// Run it in its own memory-capped container (see Dockerfile); gully-web talks to it over the compose network.
//
//   POST /v1/embeddings  { input: string|string[], input_type?: 'query'|'document' } -> { data:[{index,embedding}], model }
//   POST /v1/rerank      { query, documents: string[], top_n? } -> { results:[{index,score}], model }
//   GET  /healthz
//
// Env: PORT (8801), EMBED_MODEL (default Xenova/bge-small-en-v1.5), RERANK_MODEL (unset = reranker off),
//      MODEL_DIR (./models), EMBED_PREFIX_QUERY / EMBED_PREFIX_DOC (per model card), EMBED_POOLING (cls|mean),
//      SIDECAR_TOKEN (optional bearer), MAX_BATCH (32).
// Licences of every model used are recorded in design/gully-ai-2026-11-23 (eval report); never commit weights.
import http from 'node:http'
import { env, pipeline, AutoTokenizer, AutoModelForSequenceClassification } from '@huggingface/transformers'

env.cacheDir = process.env.MODEL_DIR || './models'
const PORT = Number(process.env.PORT) || 8801
const EMBED_MODEL = process.env.EMBED_MODEL || 'Xenova/bge-small-en-v1.5'
const RERANK_MODEL = process.env.RERANK_MODEL || ''
const QP = process.env.EMBED_PREFIX_QUERY ?? ''
const DP = process.env.EMBED_PREFIX_DOC ?? ''
const POOLING = process.env.EMBED_POOLING || 'cls'
const MAX_BATCH = Number(process.env.MAX_BATCH) || 32
const TOKEN = process.env.SIDECAR_TOKEN || ''

let extractor
let rerankTok
let rerankModel
const ready = (async () => {
  extractor = await pipeline('feature-extraction', EMBED_MODEL, { dtype: process.env.EMBED_DTYPE || 'q8' })
  if (RERANK_MODEL) {
    rerankTok = await AutoTokenizer.from_pretrained(RERANK_MODEL)
    rerankModel = await AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, { dtype: process.env.RERANK_DTYPE || 'q8' })
  }
})()

async function embed(texts, type) {
  const prefix = type === 'query' ? QP : DP
  const out = []
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const part = texts.slice(i, i + MAX_BATCH).map((t) => prefix + String(t).slice(0, 8000))
    const t = await extractor(part, { pooling: POOLING, normalize: true })
    const dim = t.dims[1]
    for (let r = 0; r < part.length; r++) out.push(Array.from(t.data.slice(r * dim, (r + 1) * dim)))
  }
  return out
}
async function rerank(query, docs) {
  const scores = []
  for (let i = 0; i < docs.length; i += 8) {
    const part = docs.slice(i, i + 8)
    const inputs = rerankTok(new Array(part.length).fill(query), { text_pair: part, padding: true, truncation: true, max_length: 512 })
    const { logits } = await rerankModel(inputs)
    for (let r = 0; r < part.length; r++) scores.push(logits.data[r * (logits.dims[1] ?? 1)])
  }
  return scores
}

const body = (req) =>
  new Promise((res, rej) => {
    let s = ''
    req.on('data', (d) => {
      s += d
      if (s.length > 2_000_000) rej(new Error('too large'))
    })
    req.on('end', () => res(s))
  })
const send = (res, code, obj) => (res.writeHead(code, { 'content-type': 'application/json' }), res.end(JSON.stringify(obj)))

http
  .createServer(async (req, res) => {
    try {
      if (req.url === '/healthz') return send(res, 200, { ok: true, ready: !!extractor, embed: EMBED_MODEL, rerank: RERANK_MODEL || null })
      if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: 'unauthorized' })
      await ready
      const j = JSON.parse((await body(req)) || '{}')
      if (req.method === 'POST' && req.url === '/v1/embeddings') {
        const inputs = Array.isArray(j.input) ? j.input : [j.input]
        if (!inputs.length || inputs.some((x) => typeof x !== 'string')) return send(res, 400, { error: 'input must be strings' })
        const v = await embed(inputs, j.input_type === 'query' ? 'query' : 'document')
        return send(res, 200, { model: EMBED_MODEL, data: v.map((embedding, index) => ({ index, embedding })) })
      }
      if (req.method === 'POST' && req.url === '/v1/rerank') {
        if (!rerankModel) return send(res, 404, { error: 'reranker not loaded' })
        const docs = Array.isArray(j.documents) ? j.documents.map(String).slice(0, 50) : []
        const sc = await rerank(String(j.query ?? ''), docs)
        const results = sc.map((score, index) => ({ index, score })).sort((a, b) => b.score - a.score).slice(0, j.top_n || docs.length)
        return send(res, 200, { model: RERANK_MODEL, results })
      }
      send(res, 404, { error: 'not found' })
    } catch (e) {
      send(res, 500, { error: String(e?.message ?? e).slice(0, 120) })
    }
  })
  .listen(PORT, process.env.HOST || '127.0.0.1', () => console.log(`ai-sidecar on :${PORT} (${EMBED_MODEL}${RERANK_MODEL ? ` + ${RERANK_MODEL}` : ''})`))
