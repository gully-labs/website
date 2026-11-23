// Gully AI: capacity, cost and alert helpers (importable on their own; ask.mjs wires them in).
//
//   opsView(entries, { cap, usedToday, prices, days })  answers/day, tokens, estimated cost (only when the owner has set
//                                  a price per token), p50/p95 latency, error and degraded rates, cap usage %
//   pricesFromEnv(env)             ASK_PRICE_INPUT_PER_MTOK / _OUTPUT_ / _CACHE_READ_ / _CACHE_WRITE_ : USD per million
//                                  tokens. Never hard-coded: with no price set the cost is null ("not set").
//   capLevel(used, cap)            null | 'warn' (>= 80 %) | 'full' (>= 100 %)
//   CapAlerter                     fires each level once per day through a `send(text)` function
//   Gate                           a small concurrency limiter with a short queue (provider calls)
//   percentile(sorted, p)

export const percentile = (values, p) => {
  const a = values.filter((v) => Number.isFinite(v)).sort((x, y) => x - y)
  if (!a.length) return null
  const i = Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1))
  return a[i]
}

const num = (v) => {
  const n = Number(String(v ?? '').trim())
  return Number.isFinite(n) && n > 0 ? n : null
}
/** Prices in USD per million tokens from the environment; any missing one is null. */
export function pricesFromEnv(env = process.env) {
  return { input: num(env.ASK_PRICE_INPUT_PER_MTOK), output: num(env.ASK_PRICE_OUTPUT_PER_MTOK), cacheRead: num(env.ASK_PRICE_CACHE_READ_PER_MTOK), cacheWrite: num(env.ASK_PRICE_CACHE_WRITE_PER_MTOK) }
}

/** Estimated USD for a token total, or null when input or output has no price. Cache prices default to the input price. */
export function costOf(tokens, prices) {
  if (!tokens || !prices?.input || !prices?.output) return null
  const per = (n, p) => ((n ?? 0) / 1_000_000) * p
  return per(tokens.input, prices.input) + per(tokens.output, prices.output) + per(tokens.cacheRead, prices.cacheRead ?? prices.input) + per(tokens.cacheWrite, prices.cacheWrite ?? prices.input)
}

export const capLevel = (used, cap) => (cap > 0 && used >= cap ? 'full' : cap > 0 && used >= cap * 0.8 ? 'warn' : null)

/** Everything the admin tiles need from the log entries (drafts included in tokens and cost, not in latency). */
export function opsView(entries, { cap = 2000, usedToday = 0, prices = pricesFromEnv(), days = 30, day = (iso) => iso.slice(0, 10) } = {}) {
  const asks = entries.filter((e) => e.channel !== 'draft')
  const sum = (list) => list.reduce((a, e) => ({ input: a.input + (e.tokens?.input ?? 0), output: a.output + (e.tokens?.output ?? 0), cacheRead: a.cacheRead + (e.tokens?.cacheRead ?? 0), cacheWrite: a.cacheWrite + (e.tokens?.cacheWrite ?? 0) }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  const perDay = new Map()
  for (const e of entries) {
    const d = day(e.at)
    const x = perDay.get(d) ?? { date: d, answers: 0, errors: 0, degraded: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, latencies: [] }
    if (e.channel !== 'draft') {
      x.answers++
      if (e.error) x.errors++
      if (e.degraded) x.degraded++
      if (!e.error && Number.isFinite(e.latencyMs)) x.latencies.push(e.latencyMs)
    }
    for (const k of Object.keys(x.tokens)) x.tokens[k] += e.tokens?.[k] ?? 0
    perDay.set(d, x)
  }
  const ok = asks.filter((e) => !e.error && !e.degraded)
  const lat = ok.map((e) => e.latencyMs)
  const errors = asks.filter((e) => e.error).length
  const total = sum(entries)
  return {
    days,
    cap,
    usedToday,
    capPct: cap > 0 ? Math.round((usedToday / cap) * 1000) / 10 : null,
    capLevel: capLevel(usedToday, cap),
    answers: asks.length,
    errors,
    errorRate: asks.length ? Math.round((errors / asks.length) * 1000) / 1000 : null,
    degraded: asks.filter((e) => e.degraded).length,
    latencyMs: { p50: percentile(lat, 50), p95: percentile(lat, 95), n: lat.length },
    tokens: total,
    priced: !!(prices.input && prices.output),
    costUsd: costOf(total, prices),
    perDay: [...perDay.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(({ latencies, ...d }) => ({ ...d, p95: percentile(latencies, 95), costUsd: costOf(d.tokens, prices) })),
  }
}

/** Sends one message per level per key (a UTC day), so 80 % and 100 % each alert once. */
export class CapAlerter {
  constructor(send) {
    this.send = send
    this.fired = new Set()
  }
  check(used, cap, today) {
    const level = capLevel(used, cap)
    if (!level) return null
    const key = `${today}:${level}`
    // 100 % also covers 80 %.
    if (this.fired.has(key)) return null
    this.fired.add(key)
    if (level === 'full') this.fired.add(`${today}:warn`)
    for (const k of this.fired) if (!k.startsWith(today)) this.fired.delete(k)
    const text = level === 'full' ? `Gully AI hit its daily cap (${used} of ${cap} answers). It now answers with docs passages only until the day turns over.` : `Gully AI has used ${used} of its ${cap} daily answers (80 %).`
    Promise.resolve(this.send(text)).catch(() => {})
    return { level, text }
  }
}

/**
 * A concurrency gate: at most `max` run at once, at most `queue` wait, a waiter gives up after `waitMs`.
 * run(fn) rejects with { busy: true } when the queue is full or the wait ran out.
 */
export class Gate {
  constructor({ max = 6, queue = 24, waitMs = 20_000 } = {}) {
    Object.assign(this, { max, queueMax: queue, waitMs, active: 0, waiting: [] })
  }
  stats() {
    return { active: this.active, queued: this.waiting.length, max: this.max, queueMax: this.queueMax }
  }
  async run(fn) {
    if (this.active >= this.max) {
      if (this.waiting.length >= this.queueMax) throw Object.assign(new Error('busy'), { busy: true })
      await new Promise((resolve, reject) => {
        const w = { resolve }
        w.timer = setTimeout(() => {
          this.waiting = this.waiting.filter((x) => x !== w)
          reject(Object.assign(new Error('busy'), { busy: true }))
        }, this.waitMs)
        w.timer.unref?.()
        this.waiting.push(w)
      })
    } else this.active++
    try {
      return await fn()
    } finally {
      const next = this.waiting.shift()
      if (next) {
        clearTimeout(next.timer)
        next.resolve() // the slot passes straight to the waiter
      } else this.active--
    }
  }
}
