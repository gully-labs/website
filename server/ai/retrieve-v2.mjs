// Retrieval fusion v2 for Gully AI (flag ASK_RETRIEVE=v2; default stays the v1 path in ask.mjs retrieve()).
// A pure function over candidate lists, so the same code runs in the eval/tuner (scripts/ai-eval/tune-retrieve.mjs)
// and, once the hardening lane has merged, inside ask.mjs. v1 weakness measured on the 103-question set:
// the coverage re-rank (+0.35 covered, +0.15 title, source prior) dominates the fused rank and pulls good
// vector hits down, so hybrid scored below plain vector search. v2 weights the vector list higher, applies
// coverage only as a small tie-breaker, and keeps the source prior tiny.
import { rrf, capPerPage, tokenize } from '../ask-index.mjs'

export const DEFAULTS = { wBm25: 0.5, wExpanded: 0.6, wVector: 8, coverage: 0.04, head: 0.02, prior: 0.03, pool: 20, minCosine: 0.2 }
const SOURCE_PRIOR = { Docs: 1, Legal: 1, Features: 1, Site: 0.5, 'Ops notes': -0.5, 'Gully Pay contracts': -0.5, 'Telegram bot': -1, 'Telegram Mini App': -1.5 }
export const v2On = () => String(process.env.ASK_RETRIEVE ?? '') === 'v2'

/**
 * lists: { bm25: [{chunk}], expanded?: [{chunk}], vector?: [{chunk, score}] } best first.
 * Returns [{ chunk, score }] best first (uncapped; call capPerPage after).
 */
export function fuseV2(question, lists, opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  const L = [{ name: 'bm25', items: lists.bm25 ?? [], weight: o.wBm25 }]
  if (lists.expanded?.length) L.push({ name: 'expanded', items: lists.expanded, weight: o.wExpanded })
  if (lists.vector?.length) L.push({ name: 'vector', items: lists.vector.filter((r) => r.score >= o.minCosine), weight: o.wVector })
  const fused = rrf(L).slice(0, o.pool)
  if (!fused.length) return fused
  const q = [...new Set(tokenize(question))]
  const top = fused[0].score || 1
  return fused
    .map((r) => {
      let bonus = 0
      if (q.length && (o.coverage || o.head)) {
        const body = new Set(tokenize(r.chunk.text))
        const head = new Set(tokenize(`${r.chunk.title ?? ''} ${r.chunk.section ?? ''}`))
        bonus = o.coverage * (q.filter((t) => body.has(t) || head.has(t)).length / q.length) + o.head * (q.filter((t) => head.has(t)).length / q.length)
      }
      return { ...r, score: r.score / top + bonus + o.prior * (SOURCE_PRIOR[r.chunk.source] ?? 0) }
    })
    .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
}

export { capPerPage }
