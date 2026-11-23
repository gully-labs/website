// Query rewriting (flag ASK_REWRITE=1): turns a follow-up like "and the limit?" plus the last turns into one
// standalone search query, on the gateway's cheap route. Never throws: on any failure it returns the original
// question, so retrieval is unchanged. The rewrite is used only for retrieval; the answer still gets the real question.
import { runJson } from './gateway.mjs'

const SYSTEM = 'Rewrite the last user message as one standalone search query for a documentation index, using the earlier turns only to resolve references like "it" or "that one". Keep product names, numbers and code identifiers exactly. Do not answer. Reply as JSON: {"query":"..."}'
export const rewriteOn = () => process.env.ASK_REWRITE === '1'

export async function rewriteQuery(gw, question, history = []) {
  if (!rewriteOn() || !history.length) return { query: question, rewritten: false }
  const turns = history.slice(-4).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '').slice(0, 600) }))
  try {
    const out = await runJson(gw, 'rewrite', { system: SYSTEM, messages: [...turns, { role: 'user', content: question }], maxTokens: 120, temperature: 0 })
    const q = String(out.data?.query ?? '').trim()
    if (q.length >= 3 && q.length <= 300) return { query: q, rewritten: q !== question, provider: out.provider }
  } catch {
    /* fall through */
  }
  return { query: question, rewritten: false }
}
