/* Gully Ask client: GET /api/ask/status and POST /api/ask (server-sent events when the browser can read a
   stream, plain JSON otherwise). Same origin on every host, so the CSP's connect-src 'self' is enough. */

export interface AskStatus {
  configured: boolean
  model: string
  indexSize: number
  updatedAt: string | null
}

export interface Citation {
  n: number
  title: string
  url: string
  source: string
}

export interface AskAnswer {
  answer: string
  citations: Citation[]
  usedTools: string[]
  model: string
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
  constructor(message: string, status: number) {
    super(message)
    this.status = status
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
    if (!r.ok) throw new AskFailure(d?.error ?? `Something went wrong (${r.status}).`, r.status)
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
      else if (event === 'error') throw new AskFailure(String((d as { error?: string }).error ?? 'The answer could not be written.'), Number((d as { status?: number }).status ?? 502))
    }
  }
  throw new AskFailure('The answer was cut off. Try again.', 0)
}
