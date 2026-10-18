/* Gully AI client: GET /api/ask/status and POST /api/ask (server-sent events when the browser can read a
   stream, plain JSON otherwise). Same origin on every host, so the CSP's connect-src 'self' is enough. */

export interface AskStatus {
  configured: boolean
  model: string
  indexSize: number
  updatedAt: string | null
  /** 'hybrid' when semantic search is on, 'bm25' for keyword search with expansion. */
  retrieval?: 'hybrid' | 'bm25'
  /** 'unavailable' while the AI provider refuses our account (billing or key): answers fail until it is fixed. */
  provider?: 'ok' | 'unavailable'
  since?: string | null
}

/** A live read the answer cites as [L1], [L2]…: the endpoint (or app page) and when it was read. */
export interface LiveCite {
  n: string
  tool: string
  label: string
  url: string
  asOf: string | null
}

export interface CardStat {
  label: string
  value: string
  tone?: 'up' | 'down' | 'ok' | 'warn'
}

/** A compact live card built by the server from a tool result (never from the model's words). */
export interface AskCard {
  tool: string
  cite: string
  kind: string
  title: string
  subtitle?: string | null
  asOf: string | null
  source: { label: string; url: string } | null
  stats: CardStat[]
  chart: { type: 'spark'; points: number[]; unit: string; label: string } | { type: 'bars'; bars: { label: string; value: number | null }[]; unit: string; label: string } | null
  link?: { label: string; url: string } | null
  note?: string
}

/** A one-tap follow-up: a link, or a link to a pre-filled form the user still has to confirm. */
export interface AskAction {
  kind: 'link' | 'prefill'
  label: string
  url: string
  note?: string
}

export interface Citation {
  n: number
  title: string
  url: string
  source: string
}

export interface AskAnswer {
  id?: string
  answer: string
  citations: Citation[]
  live?: LiveCite[]
  cards?: AskCard[]
  actions?: AskAction[]
  usedTools: string[]
  model: string
  signedIn?: boolean
}

export interface Turn {
  role: 'user' | 'assistant'
  content: string
}

let statusPromise: Promise<AskStatus | null> | null = null

/** The status, read once per page load. Null when it could not be read. */
export function askStatus(): Promise<AskStatus | null> {
  statusPromise ??= fetch('/api/ask/status', { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? (r.json() as Promise<AskStatus>) : null))
    .catch(() => null)
  return statusPromise
}

export class AskFailure extends Error {
  status: number
  /** 'provider-unavailable' when Gully AI as a whole is down (not this question): no retry helps. */
  code: string | null
  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Asks one question. `onStage` hears progress ('searching', 'thinking', 'tool:get_plans', 'writing'). */
export async function postAsk(question: string, history: Turn[], onStage: (stage: string) => void, signal?: AbortSignal): Promise<AskAnswer> {
  const r = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'gully', accept: 'text/event-stream' },
    body: JSON.stringify({ question, history }),
    signal,
  }).catch(() => null)
  if (!r) throw new AskFailure('The server could not be reached. Check your connection and try again.', 0)
  const type = r.headers.get('content-type') ?? ''
  if (!type.includes('text/event-stream')) {
    const d = await r.json().catch(() => null)
    if (!r.ok) throw new AskFailure(d?.error ?? `Something went wrong (${r.status}).`, r.status, typeof d?.code === 'string' ? d.code : null)
    return d as AskAnswer
  }
  const reader = r.body?.getReader()
  if (!reader) throw new AskFailure('The answer could not be read.', 0)
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i)
      buf = buf.slice(i + 2)
      const event = block.match(/^event: (.+)$/m)?.[1]
      const data = block.match(/^data: (.+)$/m)?.[1]
      if (!event || !data) continue
      let d: unknown
      try {
        d = JSON.parse(data)
      } catch {
        continue
      }
      if (event === 'status') onStage(String((d as { stage?: string }).stage ?? ''))
      else if (event === 'answer') return d as AskAnswer
      else if (event === 'error') {
        const e = d as { error?: string; status?: number; code?: string }
        throw new AskFailure(String(e.error ?? 'The answer could not be written.'), Number(e.status ?? 502), typeof e.code === 'string' ? e.code : null)
      }
    }
  }
  throw new AskFailure('The answer was cut off. Try again.', 0)
}

/** Rates one answer (thumbs up or down). Resolves true when the server stored it. */
export async function postFeedback(id: string, rating: 'up' | 'down'): Promise<boolean> {
  const r = await fetch('/api/ask/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'gully' },
    body: JSON.stringify({ id, rating }),
  }).catch(() => null)
  return !!r?.ok
}
