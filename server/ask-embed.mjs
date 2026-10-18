// Gully AI: the semantic half of hybrid retrieval. Chunks and questions are embedded with Voyage AI's hosted
// embeddings API (the embeddings provider Anthropic recommends; plain fetch, no SDK, no local model), and
// ask.mjs fuses the nearest chunks with BM25 (ask-index.mjs rrf()).
//
// Why hosted and not local: the box has no GPU, little memory and a dependency-free server. A WASM model
// (e.g. a MiniLM through onnxruntime-web) means a 20-90 MB runtime + weights in the image and in RAM, and
// slower cold starts, for a corpus of a few hundred chunks. voyage-3.5-lite at 512 dimensions costs cents a
// month here and keeps the server dependency-free.
//
// Chunks are embedded at runtime, not at build time: the key lives only in the server's env (never in the
// image build), and the remote corpus (READMEs, DeepCore docs, blog) changes between builds anyway. Vectors
// are cached by a hash of (model, text) in DATA_DIR/ask-embeddings.json, so a restart or an unchanged
// rebuild embeds nothing. A changed chunk is re-embedded on the next sync.
//
// Degrades cleanly: with no key, ASK_EMBED=off, an API error or a timeout, embedQuery() resolves null and
// retrieval is BM25 + query expansion only. After an error the API is left alone for a minute (no added
// latency on every question while it is down).
//
// Env
//   VOYAGE_API_KEY     enables embeddings (https://dash.voyageai.com). Unset: BM25-only.
//   ASK_EMBED_MODEL    default voyage-3.5-lite
//   ASK_EMBED_DIM      default 512 (256, 512, 1024 or 2048)
//   ASK_EMBED_URL      API base, tests (default https://api.voyageai.com)
//   ASK_EMBED=off      never embed, even with a key

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './http.mjs'

const FILE = () => path.join(process.env.DATA_DIR ?? DATA_DIR, 'ask-embeddings.json')
const BATCH = 96
const QUERY_TIMEOUT_MS = 2_500
const DOC_TIMEOUT_MS = 30_000
const BACKOFF_MS = 60_000
const QUERY_CACHE = 200

const key = () => {
  const k = String(process.env.VOYAGE_API_KEY ?? '').trim()
  return k.length >= 16 ? k : null
}
export const embedModel = () => String(process.env.ASK_EMBED_MODEL ?? '').trim() || 'voyage-3.5-lite'
const embedDim = () => {
  const n = Number(process.env.ASK_EMBED_DIM)
  return [256, 512, 1024, 2048].includes(n) ? n : 512
}
export const embedConfigured = () => !!key() && process.env.ASK_EMBED !== 'off'
function base() {
  const raw = String(process.env.ASK_EMBED_URL ?? '').trim()
  try {
    if (raw) {
      const u = new URL(raw)
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin + u.pathname.replace(/\/+$/, '')
    }
  } catch {
    /* default */
  }
  return 'https://api.voyageai.com'
}

/** The text a chunk is embedded as: where it sits, then what it says. */
export const embedText = (c) => `${c.title ?? ''}${c.section ? ` — ${c.section}` : ''}\n${c.text}`
const hashOf = (text) => crypto.createHash('sha1').update(`${embedModel()}|${embedDim()}|${text}`).digest('hex').slice(0, 20)

/* ---------------------------------------------------------------- store --- */

let store = null // { model, dim, vectors: Map<hash, Float32Array> }
function load() {
  if (store && store.model === embedModel() && store.dim === embedDim()) return store
  store = { model: embedModel(), dim: embedDim(), vectors: new Map() }
  try {
    const d = JSON.parse(fs.readFileSync(FILE(), 'utf8'))
    if (d?.model === store.model && d?.dim === store.dim && d.vectors && typeof d.vectors === 'object')
      for (const [h, b64] of Object.entries(d.vectors)) {
        const buf = Buffer.from(String(b64), 'base64')
        if (buf.length === store.dim * 4) store.vectors.set(h, new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)))
      }
  } catch {
    /* none yet */
  }
  return store
}
function save(keep) {
  const s = load()
  const vectors = {}
  for (const h of keep) {
    const v = s.vectors.get(h)
    if (v) vectors[h] = Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64')
  }
  try {
    fs.mkdirSync(path.dirname(FILE()), { recursive: true })
    fs.writeFileSync(FILE() + '.tmp', JSON.stringify({ model: s.model, dim: s.dim, savedAt: new Date().toISOString(), vectors }))
    fs.renameSync(FILE() + '.tmp', FILE())
  } catch (e) {
    console.error('ask embeddings save:', e?.message ?? e)
  }
}

/* ------------------------------------------------------------------ API --- */

const state = { lastError: null, lastErrorAt: 0, lastSyncAt: null, total: 0, ready: 0, syncing: false }
const backingOff = () => state.lastErrorAt && Date.now() - state.lastErrorAt < BACKOFF_MS

async function embed(inputs, inputType, timeoutMs) {
  const r = await fetch(`${base()}/v1/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key()}` },
    body: JSON.stringify({ input: inputs, model: embedModel(), input_type: inputType, output_dimension: embedDim() }),
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok || !Array.isArray(j?.data)) throw new Error(`embeddings HTTP ${r.status}`)
  const out = new Array(inputs.length).fill(null)
  for (const d of j.data) {
    if (Number.isInteger(d?.index) && Array.isArray(d.embedding) && d.embedding.length === embedDim()) out[d.index] = Float32Array.from(d.embedding)
  }
  if (out.some((v) => !v)) throw new Error('embeddings: a vector is missing or the wrong size')
  return out
}
const fail = (e) => {
  state.lastError = String(e?.message ?? e).slice(0, 160)
  state.lastErrorAt = Date.now()
}

const chunkHash = new WeakMap() // chunk object -> its hash (chunks are immutable once indexed)
/** The cached vector of a chunk, or null. */
export function vectorFor(chunk) {
  if (!embedConfigured()) return null
  const s = load()
  let h = chunkHash.get(chunk)
  if (!h || h.model !== s.model || h.dim !== s.dim) chunkHash.set(chunk, (h = { model: s.model, dim: s.dim, h: hashOf(embedText(chunk)) }))
  return s.vectors.get(h.h) ?? null
}

let pending = null
let running = null
/**
 * Embeds every chunk that has no cached vector, in batches, then drops vectors of chunks that are gone.
 * Calls overlapping a running sync are folded into one more run with the latest chunks. Never throws.
 */
export function syncEmbeddings(chunks) {
  if (!embedConfigured()) return Promise.resolve(embedStatus())
  pending = chunks
  if (running) return running
  running = (async () => {
    // Yield first: with every vector cached the loop below never awaits, and the `running = null` at its end
    // would run before this assignment, leaving `running` stuck on a settled promise (every later sync ignored).
    await null
    while (pending) {
      const list = pending
      pending = null
      state.syncing = true
      const s = load()
      const want = list.map((c) => ({ h: hashOf(embedText(c)), text: embedText(c) }))
      const todo = [...new Map(want.filter((w) => !s.vectors.has(w.h)).map((w) => [w.h, w])).values()]
      try {
        for (let i = 0; i < todo.length; i += BATCH) {
          const part = todo.slice(i, i + BATCH)
          const vecs = await embed(
            part.map((w) => w.text.slice(0, 8_000)),
            'document',
            DOC_TIMEOUT_MS,
          )
          part.forEach((w, j) => s.vectors.set(w.h, vecs[j]))
        }
        state.lastError = null
        state.lastErrorAt = 0
      } catch (e) {
        fail(e)
        console.error(`ask embeddings: ${state.lastError} (BM25 keeps answering)`)
      }
      save(new Set(want.map((w) => w.h)))
      state.total = want.length
      state.ready = want.filter((w) => s.vectors.has(w.h)).length
      state.lastSyncAt = new Date().toISOString()
      state.syncing = false
    }
    running = null
    return embedStatus()
  })()
  return running
}

const queryCache = new Map()
/** The question's vector, or null (no key, backing off after an error, timeout). Never throws. */
export async function embedQuery(q) {
  if (!embedConfigured() || backingOff()) return null
  const k = String(q).slice(0, 2_000)
  if (queryCache.has(k)) return queryCache.get(k)
  try {
    const [v] = await embed([k], 'query', QUERY_TIMEOUT_MS)
    queryCache.set(k, v)
    if (queryCache.size > QUERY_CACHE) queryCache.delete(queryCache.keys().next().value)
    return v
  } catch (e) {
    fail(e)
    return null
  }
}

/** For the admin view and /api/ask/status. */
export const embedStatus = () => ({ configured: embedConfigured(), model: embedConfigured() ? embedModel() : null, dim: embedConfigured() ? embedDim() : null, ready: state.ready, total: state.total, syncing: state.syncing, lastSyncAt: state.lastSyncAt, lastError: state.lastError })

/** Test hook: forget the in-memory store, the query cache and the error backoff. */
export function resetEmbeddingsForTest() {
  store = null
  queryCache.clear()
  Object.assign(state, { lastError: null, lastErrorAt: 0, lastSyncAt: null, total: 0, ready: 0, syncing: false })
}
