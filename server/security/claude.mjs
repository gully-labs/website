// The Claude call used by the scan engine. Same account and settings as Gully Ask (server/ask.mjs):
// ANTHROPIC_API_KEY, ANTHROPIC_API_URL (tests), anthropic-version 2023-06-01, a raw fetch to /v1/messages
// with no SDK (the site's server has no npm dependencies at runtime). ask.mjs does not export its
// callClaude, so this mirrors it, adding structured output (JSON schema) and the server-side refusal
// fallback. The key is only ever put in the x-api-key header; it is never logged or put in a prompt.

import { config } from './config.mjs'

const apiKey = () => {
  const k = String(process.env.ANTHROPIC_API_KEY ?? '').trim()
  return k.length >= 20 ? k : null
}
export const aiConfigured = () => !!apiKey() || !!impl

function apiBase() {
  const raw = String(process.env.ANTHROPIC_API_URL ?? '').trim()
  if (!raw) return 'https://api.anthropic.com'
  try {
    const u = new URL(raw)
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin + u.pathname.replace(/\/+$/, '')
  } catch {
    /* fall through */
  }
  return 'https://api.anthropic.com'
}

export class AiError extends Error {
  constructor(message, code = 'ai-error') {
    super(message)
    this.code = code
  }
}

let impl = null
/** Test hook: (requestBody) => response JSON (Messages API shape). null restores HTTP. */
export function setClaudeForTest(fn) {
  impl = fn
}

/* The outcome of the latest AI calls, for the public engine status (security-routes.mjs GET /api/security/engine):
   a key that is set but refused (no credit, billing, a disabled key) must not show as online. Codes only, no text. */
let health = { lastOkAt: null, lastFailAt: null, lastFailCode: null }
/** { lastOkAt, lastFailAt, lastFailCode } (ISO times, the AiError code). */
export const aiHealth = () => ({ ...health })
/** Test hook: forget the outcomes. */
export const resetAiHealthForTest = () => (health = { lastOkAt: null, lastFailAt: null, lastFailCode: null })

async function post(body) {
  try {
    const j = await send(body)
    health = { ...health, lastOkAt: new Date().toISOString() }
    return j
  } catch (e) {
    health = { ...health, lastFailAt: new Date().toISOString(), lastFailCode: e?.code ?? 'ai-error' }
    throw e
  }
}

async function send(body) {
  if (impl) return impl(body)
  const key = apiKey()
  if (!key) throw new AiError('AI is not configured (ANTHROPIC_API_KEY).', 'ai-absent')
  const headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }
  if (body.fallbacks) headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'
  let last
  for (let attempt = 0; attempt < 3; attempt++) {
    let r
    try {
      r = await fetch(`${apiBase()}/v1/messages`, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(config.aiTimeoutMs()) })
    } catch (e) {
      last = new AiError(e?.name === 'TimeoutError' ? 'the AI request timed out' : 'the AI service could not be reached')
      continue
    }
    const j = await r.json().catch(() => null)
    if (r.ok && j && Array.isArray(j.content)) return j
    const type = String(j?.error?.type ?? `HTTP ${r.status}`).slice(0, 60)
    // The provider's own words go to the server log only: cut to 200 characters, the key scrubbed.
    const message = String(j?.error?.message ?? '').split(key).join('[key]').replace(/sk-ant-[A-Za-z0-9_-]+/g, '[key]').replace(/\s+/g, ' ').slice(0, 200)
    console.error(`security: Claude API ${r.status} ${type}${message ? `: ${message}` : ''}`)
    // The provider refuses our account (no credit, billing, a disabled or invalid key): no retry helps.
    if (r.status === 401 || ((r.status === 400 || r.status === 403) && /credit balance|billing|disabled|deactivated|suspended|invalid (x-)?api[- ]?key|authentication|permission/i.test(message))) throw new AiError('the AI service is unavailable right now', 'ai-unavailable')
    last = new AiError(`the AI service answered ${r.status} (${type})`, r.status === 429 || r.status === 529 ? 'ai-busy' : 'ai-error')
    if (!(r.status === 429 || r.status >= 500)) break
    await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)))
  }
  throw last
}

/**
 * One structured call. Returns { json, text, usage: { input, output, cacheRead, cacheWrite }, stop, model }.
 * `schema` (JSON Schema, additionalProperties:false everywhere) constrains the output; the result is still
 * parsed defensively.
 */
export async function callModel({ model, system, user, maxTokens, effort, schema }) {
  const body = {
    model,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: user }],
    output_config: { ...(effort ? { effort } : {}), ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
    ...(/sonnet|opus/.test(model) && String(process.env.SECURITY_AI_FALLBACKS ?? 'on') !== 'off' ? { fallbacks: 'default' } : {}),
  }
  const resp = await post(body)
  const u = resp.usage ?? {}
  const usage = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 }
  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
  let json = null
  if (schema) {
    try {
      json = JSON.parse(text)
    } catch {
      const m = /\{[\s\S]*\}/.exec(text)
      try {
        json = m ? JSON.parse(m[0]) : null
      } catch {
        json = null
      }
    }
  }
  return { json, text, usage, stop: resp.stop_reason ?? null, model: resp.model ?? model }
}
