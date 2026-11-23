// Gully AI model gateway: one call shape for every text-model provider, routing by task, per-route fallbacks,
// per-provider metrics and a kill switch. Flag-off by default: nothing in ask.mjs imports this yet (ASK_GATEWAY=1
// wiring is a separate, coordinated change); today it is used by the evals and the other server/ai modules.
//
// Request shape (provider-neutral, a subset of Anthropic's): { system, messages:[{role,content:string}], maxTokens, temperature, json }
// Response shape: { text, usage:{input,output,cacheRead,cacheWrite}, model, provider, stop, fellBack }
//
// Config is env only (keys live in admin Integrations, write-only; no price is hard-coded):
//   AI_GATEWAY=off                kill switch: every call throws GatewayOff (callers fall back to their old path)
//   AI_PROVIDERS=anthropic,openai_compat   enabled providers (default: anthropic)
//   AI_ROUTES={"classify":["openai_compat","anthropic"]}   JSON; task -> provider order
//   ANTHROPIC_API_KEY, ANTHROPIC_API_URL, AI_MODEL_<TASK>_ANTHROPIC (model per task and provider)
//   AI_OPENAI_URL (base of an OpenAI-compatible server: vLLM, llama.cpp, Ollama, ends in /v1), AI_OPENAI_KEY (optional)
//   AI_MODEL_<TASK>_OPENAI_COMPAT
//   AI_COST_JSON={"anthropic":{"in":x,"out":y}}   USD per 1M tokens, owner-entered, optional (cost tile only)
// Tasks: answer, tools, classify, rewrite, moderate, summarize.

export class GatewayOff extends Error {}
export class GatewayError extends Error {
  constructor(msg, { status = 0, retryable = true } = {}) {
    super(msg)
    this.status = status
    this.retryable = retryable
  }
}

export const TASKS = ['answer', 'tools', 'classify', 'rewrite', 'moderate', 'summarize']
// Cheap tasks try a self-hosted open model first when one is configured, then Claude; answers and tool use stay on Claude.
const DEFAULT_ROUTES = { answer: ['anthropic'], tools: ['anthropic'], classify: ['openai_compat', 'anthropic'], rewrite: ['openai_compat', 'anthropic'], moderate: ['openai_compat', 'anthropic'], summarize: ['openai_compat', 'anthropic'] }
const envJson = (name, fallback) => {
  try {
    const v = JSON.parse(process.env[name] ?? '')
    return v && typeof v === 'object' ? v : fallback
  } catch {
    return fallback
  }
}
const modelFor = (task, provider) => String(process.env[`AI_MODEL_${task.toUpperCase()}_${provider.toUpperCase()}`] ?? '').trim() || null

/* ------------------------------------------------------------ providers --- */

const timeout = (ms) => AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS) || ms)

export const anthropicProvider = {
  name: 'anthropic',
  configured: () => String(process.env.ANTHROPIC_API_KEY ?? '').trim().length >= 16,
  caching: true,
  async call(req, model) {
    const base = String(process.env.ANTHROPIC_API_URL ?? 'https://api.anthropic.com').replace(/\/+$/, '')
    const body = {
      model,
      max_tokens: req.maxTokens ?? 1024,
      // cache_control on the system prompt: the provider reuses it across calls (prompt caching).
      system: req.system ? [{ type: 'text', text: req.system, ...(req.cache !== false ? { cache_control: { type: 'ephemeral' } } : {}) }] : undefined,
      messages: req.messages,
      ...(req.temperature != null ? { temperature: req.temperature } : {}),
    }
    const r = await fetch(`${base}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body), redirect: 'manual', signal: timeout(30_000) })
    const j = await r.json().catch(() => null)
    if (!r.ok || !Array.isArray(j?.content)) throw new GatewayError(`anthropic HTTP ${r.status}`, { status: r.status, retryable: r.status >= 500 || r.status === 429 || r.status === 408 })
    const u = j.usage ?? {}
    return { text: j.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim(), usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 }, stop: j.stop_reason }
  },
}

// OpenAI-compatible chat completions: vLLM, llama.cpp server, Ollama (/v1). Those servers reuse prompt prefixes
// on their own, so there is nothing to send for caching (`caching: false`).
export const openaiCompatProvider = {
  name: 'openai_compat',
  configured: () => /^https?:\/\//.test(String(process.env.AI_OPENAI_URL ?? '')),
  caching: false,
  async call(req, model) {
    const base = String(process.env.AI_OPENAI_URL).replace(/\/+$/, '')
    const messages = [...(req.system ? [{ role: 'system', content: req.system }] : []), ...req.messages]
    const headers = { 'content-type': 'application/json', ...(process.env.AI_OPENAI_KEY ? { authorization: `Bearer ${process.env.AI_OPENAI_KEY}` } : {}) }
    const r = await fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model, messages, max_tokens: req.maxTokens ?? 512, temperature: req.temperature ?? 0, ...(req.json ? { response_format: { type: 'json_object' } } : {}) }), redirect: 'manual', signal: timeout(20_000) })
    const j = await r.json().catch(() => null)
    const text = j?.choices?.[0]?.message?.content
    if (!r.ok || typeof text !== 'string') throw new GatewayError(`openai_compat HTTP ${r.status}`, { status: r.status, retryable: r.status >= 500 || r.status === 429 })
    return { text: text.trim(), usage: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0, cacheRead: 0, cacheWrite: 0 }, stop: j.choices[0].finish_reason }
  },
}

/** Tests and evals: scripted provider. `script(req, task)` returns text or throws; records every call. */
export function fakeProvider(script = () => 'ok', name = 'fake') {
  const calls = []
  return {
    name,
    calls,
    configured: () => true,
    caching: false,
    async call(req, model, task) {
      calls.push({ req, model, task })
      const out = await script(req, task)
      const text = typeof out === 'string' ? out : String(out?.text ?? '')
      return { text, usage: { input: Math.ceil(JSON.stringify(req).length / 4), output: Math.ceil(text.length / 4), cacheRead: 0, cacheWrite: 0 }, stop: 'end_turn' }
    },
  }
}

/* ------------------------------------------------------------- gateway --- */

export function makeGateway({ providers = [anthropicProvider, openaiCompatProvider], now = Date.now } = {}) {
  const byName = new Map(providers.map((p) => [p.name, p]))
  const metrics = new Map()
  const breaker = new Map() // provider -> { fails, openUntil }
  const stat = (n) => {
    if (!metrics.has(n)) metrics.set(n, { calls: 0, errors: 0, ms: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, lastError: null, lastErrorAt: null })
    return metrics.get(n)
  }
  const enabled = () => String(process.env.AI_PROVIDERS ?? 'anthropic').split(',').map((s) => s.trim()).filter(Boolean)
  const routeFor = (task) => {
    const r = envJson('AI_ROUTES', {})[task]
    return (Array.isArray(r) && r.length ? r : DEFAULT_ROUTES[task] ?? ['anthropic']).filter((n) => enabled().includes(n) && byName.has(n))
  }
  const killed = () => String(process.env.AI_GATEWAY ?? '').toLowerCase() === 'off'

  /** run(task, req): tries the task's configured providers in order; a failed one falls through to the next. */
  async function run(task, req) {
    if (killed()) throw new GatewayOff('gateway is switched off')
    if (!TASKS.includes(task)) throw new GatewayError(`unknown task ${task}`, { retryable: false })
    const order = routeFor(task).filter((n) => byName.get(n).configured())
    if (!order.length) throw new GatewayError(`no configured provider for ${task}`, { retryable: false })
    let last
    let tried = 0
    for (const name of order) {
      const b = breaker.get(name)
      if (b && b.openUntil > now()) continue // circuit open: skip without waiting
      const p = byName.get(name)
      // The model per task/provider comes from env; Claude defaults to the model Gully AI answers with today.
      const model = modelFor(task, name) ?? (name === 'anthropic' ? 'claude-haiku-5-5' : 'default')
      const s = stat(name)
      const t0 = now()
      tried++
      try {
        const out = await p.call(req, model, task)
        s.calls++
        s.ms += now() - t0
        s.input += out.usage.input
        s.output += out.usage.output
        s.cacheRead += out.usage.cacheRead
        s.cacheWrite += out.usage.cacheWrite
        breaker.delete(name)
        return { ...out, model, provider: name, fellBack: tried > 1 }
      } catch (e) {
        s.calls++
        s.errors++
        s.ms += now() - t0
        s.lastError = String(e?.message ?? e).slice(0, 160)
        s.lastErrorAt = new Date(now()).toISOString()
        last = e
        const f = (breaker.get(name)?.fails ?? 0) + 1
        breaker.set(name, { fails: f, openUntil: f >= 5 ? now() + 5 * 60_000 : 0 }) // 5 failures in a row: paused 5 minutes
      }
    }
    throw last ?? new GatewayError(`every provider for ${task} is paused`)
  }

  /** Per-provider numbers for the admin cost/latency tiles. Cost only when the owner entered rates. */
  function snapshot() {
    const rates = envJson('AI_COST_JSON', {})
    return [...byName.keys()].map((name) => {
      const s = stat(name)
      const r = rates[name]
      return { provider: name, configured: byName.get(name).configured(), enabled: enabled().includes(name), ...s, avgMs: s.calls ? Math.round(s.ms / s.calls) : null, costUsd: r ? +((s.input * (r.in ?? 0) + s.output * (r.out ?? 0)) / 1e6).toFixed(4) : null, breakerOpen: (breaker.get(name)?.openUntil ?? 0) > now() }
    })
  }
  return { run, snapshot, routeFor, killed, reset: () => (metrics.clear(), breaker.clear()) }
}

export const gateway = makeGateway()

/** A JSON answer from a cheap task; data is null when the model did not return valid JSON. */
export async function runJson(gw, task, req) {
  const out = await gw.run(task, { ...req, json: true })
  const m = out.text.match(/\{[\s\S]*\}/)
  try {
    return { ...out, data: m ? JSON.parse(m[0]) : null }
  } catch {
    return { ...out, data: null }
  }
}
