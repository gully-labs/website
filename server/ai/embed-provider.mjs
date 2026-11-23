// Embedding provider switch for Gully AI (not wired into ask.mjs yet; see the eval report for the wiring plan).
//   ASK_EMBED_PROVIDER=voyage (default) | local
//   ASK_EMBED_SHADOW=1   compute BOTH providers for each query and log the overlap, but serve only the primary
//   ASK_LOCAL_EMBED_URL  base URL of the ops/ai-sidecar service (e.g. http://ai-sidecar:8801)
//   ASK_LOCAL_EMBED_TOKEN  optional bearer
// Vectors of different models are never mixed: the vector store key already includes the model (ask-embed.mjs
// hashOf), and a local index is built by syncing chunks through localEmbed().
import { embedQuery as voyageQuery } from '../ask-embed.mjs'
import { cosine } from '../ask-index.mjs'

export const providerName = () => (process.env.ASK_EMBED_PROVIDER === 'local' ? 'local' : 'voyage')
export const shadowOn = () => process.env.ASK_EMBED_SHADOW === '1'
const base = () => String(process.env.ASK_LOCAL_EMBED_URL ?? '').replace(/\/+$/, '')
export const localConfigured = () => /^https?:\/\//.test(base())

export async function localEmbed(texts, inputType = 'document', timeoutMs = 5_000) {
  const r = await fetch(`${base()}/v1/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.ASK_LOCAL_EMBED_TOKEN ? { authorization: `Bearer ${process.env.ASK_LOCAL_EMBED_TOKEN}` } : {}) }, body: JSON.stringify({ input: texts, input_type: inputType }), redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
  const j = await r.json().catch(() => null)
  if (!r.ok || !Array.isArray(j?.data)) throw new Error(`local embeddings HTTP ${r.status}`)
  const out = new Array(texts.length).fill(null)
  for (const d of j.data) out[d.index] = Float32Array.from(d.embedding)
  return out
}

let backoffUntil = 0
/** The query vector of the primary provider (null when it is down); in shadow mode also records the other's. */
export async function embedQueryVia(q, { shadowLog = () => {} } = {}) {
  const useLocal = providerName() === 'local' && localConfigured()
  const primary = useLocal
    ? (Date.now() < backoffUntil ? null : await localEmbed([q], 'query', 2_500).then((v) => v[0]).catch(() => ((backoffUntil = Date.now() + 60_000), null)))
    : await voyageQuery(q)
  if (shadowOn() && localConfigured()) {
    const other = useLocal ? await voyageQuery(q) : await localEmbed([q], 'query', 2_500).then((v) => v[0]).catch(() => null)
    shadowLog({ primary: useLocal ? 'local' : 'voyage', haveBoth: !!(primary && other), dimsDiffer: !!(primary && other && primary.length !== other.length) })
  }
  return primary
}

/** Jaccard overlap of two top-k id lists, for the shadow comparison log. */
export const overlap = (a, b) => {
  const A = new Set(a)
  const B = new Set(b)
  const inter = [...A].filter((x) => B.has(x)).length
  return A.size + B.size - inter ? inter / (A.size + B.size - inter) : 1
}
export { cosine }
