// Cross-encoder rerank of the top candidates through the ops/ai-sidecar service. Flag ASK_RERANK=1 (default off).
// Never throws: any failure or timeout returns the input order unchanged. Latency budget: ASK_RERANK_MS (default 400).
export const rerankOn = () => process.env.ASK_RERANK === '1' && /^https?:\/\//.test(String(process.env.ASK_LOCAL_EMBED_URL ?? ''))

/** items: [{ chunk, ...}] in fused order; returns the same items re-ordered, plus ms and whether it applied. */
export async function rerankItems(query, items, { textOf = (it) => `${it.chunk.title ?? ''} ${it.chunk.section ?? ''}\n${it.chunk.text}`, top = 20 } = {}) {
  if (!rerankOn() || items.length < 2) return { items, applied: false, ms: 0 }
  const head = items.slice(0, top)
  const t0 = Date.now()
  try {
    const r = await fetch(`${String(process.env.ASK_LOCAL_EMBED_URL).replace(/\/+$/, '')}/v1/rerank`, { method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.ASK_LOCAL_EMBED_TOKEN ? { authorization: `Bearer ${process.env.ASK_LOCAL_EMBED_TOKEN}` } : {}) }, body: JSON.stringify({ query, documents: head.map((it) => textOf(it).slice(0, 1800)) }), redirect: 'manual', signal: AbortSignal.timeout(Number(process.env.ASK_RERANK_MS) || 400) })
    const j = await r.json().catch(() => null)
    if (!r.ok || !Array.isArray(j?.results) || j.results.length !== head.length) return { items, applied: false, ms: Date.now() - t0 }
    return { items: [...j.results.map((x) => head[x.index]), ...items.slice(top)], applied: true, ms: Date.now() - t0 }
  } catch {
    return { items, applied: false, ms: Date.now() - t0 }
  }
}
