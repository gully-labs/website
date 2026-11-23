import { useEffect, useState } from 'react'
import { dateTimePT } from '../lib/time'
import { Details } from './DocPage'

/* "What Gully AI knows" (docs.gullylabs.xyz/gully-ai#knows, and linked from /ask): read live from GET /api/ask/knowledge
   on the host the docs are served from. Sources by product with their pages and last-updated dates, which model
   providers see what, how long the log is kept and how to ask for a deletion. Plain text only; nothing here is typed in
   by hand except the sentence around it. A read that failed says so, it never shows an empty list as if nothing was known. */

interface Knowledge {
  products: { id: string; name: string; status: 'Covered' | 'Thin' | 'Missing'; passages: number; lastIndexedAt: string | null; pages: { title: string; url: string; updatedAt: string | null }[]; moreSources: number }[]
  general: { name: string; passages: number; lastIndexedAt: string | null }
  totals: { passages: number; pages: number }
  updatedAt: string | null
  retrieval: 'hybrid' | 'bm25'
  owned: boolean
  note: string
  providers: { name: string; purpose: string; model: string | null; active: boolean; sends: string }[]
  retention: { logDays: number; logHolds: string; ratingsHold: string; rawIp: boolean }
  deletion: { how: string; url: string }
  limits: { question: number; perVisitorPerMin: number; perVisitorPerDay: number; perChatPerMin: number; perChatPerDay: number; perDayService: number }
}

const chip: Record<string, string> = { Covered: 'border-green text-green', Thin: 'border-gold text-gold', Missing: 'border-error text-error' }

function useKnowledge() {
  const [d, setD] = useState<Knowledge | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    fetch('/api/ask/knowledge', { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => alive && setD(j as Knowledge))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [])
  return { d, failed }
}

const day = (iso: string | null) => (iso ? dateTimePT(iso).split(',')[0] : 'not recorded')

/** The sources, grouped by product. */
export function AskKnowledgeSources() {
  const { d, failed } = useKnowledge()
  if (failed) return <p className="m-0 text-[14px] text-muted">The list of sources could not be read just now. Try again in a minute.</p>
  if (!d) return <p className="m-0 font-mono text-[12px] text-faint">Reading what Gully AI knows…</p>
  return (
    <div className="flex flex-col gap-3" data-testid="ask-knowledge-public">
      <p className="m-0 font-mono text-[12px] text-faint">
        {d.totals.passages.toLocaleString('en-US')} passages from {d.totals.pages} public pages · {d.retrieval === 'hybrid' ? 'keyword and semantic search' : 'keyword search'} · index updated {day(d.updatedAt)}
      </p>
      {d.products.map((p) => (
        <Details key={p.id} summary={`${p.name}: ${p.status.toLowerCase()} · ${p.passages} passages · updated ${day(p.lastIndexedAt)}`}>
          {p.pages.length ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px]">
              {p.pages.map((g) => (
                <li key={g.url} className="flex flex-wrap items-baseline gap-x-3">
                  <a href={g.url} target="_blank" rel="noopener noreferrer" className="text-gold hover:underline">
                    {g.title}
                  </a>
                  <span className="font-mono text-[11px] text-faint">updated {day(g.updatedAt)}</span>
                </li>
              ))}
              {p.moreSources > 0 && <li className="font-mono text-[11px] text-faint">and {p.moreSources} more pages</li>}
            </ul>
          ) : (
            <p className={`m-0 rounded-input border px-3 py-2 text-[14px] ${chip[p.status]}`}>Gully AI has no public pages for {p.name} yet, so it will say it does not know rather than guess.</p>
          )}
        </Details>
      ))}
      <p className="m-0 font-mono text-[12px] text-faint">
        Company, services and roadmap pages: {d.general.passages} more passages, updated {day(d.general.lastIndexedAt)}.
      </p>
    </div>
  )
}

/** Which providers see what, retention, deletion and the data flow. */
export function AskDataFlow() {
  const { d, failed } = useKnowledge()
  if (failed) return <p className="m-0 text-[14px] text-muted">The data-flow details could not be read just now. The privacy policy at gullylabs.xyz/privacy has the same facts.</p>
  if (!d) return <p className="m-0 font-mono text-[12px] text-faint">Reading…</p>
  const steps: { t: string; s: string; out?: boolean }[] = [
    { t: 'You', s: 'type a question' },
    { t: 'Gully Labs server', s: 'checks the limits and finds the matching passages of our public docs' },
    ...d.providers.filter((p) => p.active).map((p) => ({ t: p.name, s: p.purpose, out: true })),
    { t: 'Answer', s: 'with its sources, and a log line without your IP' },
  ]
  return (
    <div className="flex flex-col gap-4" data-testid="ask-dataflow">
      <p className="m-0 text-[15px] leading-[1.6] text-ink-2">{d.note}</p>
      <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,170px),1fr))] gap-3 p-0" aria-label="Where your question goes">
        {steps.map((s, i) => (
          <li key={s.t} className={`relative flex flex-col gap-1 rounded-card border px-3 py-3 ${s.out ? 'border-gold-line' : 'border-line'} bg-card-token`}>
            <span className="font-mono text-[11px] tracking-[1px] text-faint">
              {i + 1}
              {s.out ? ' · LEAVES OUR SERVERS' : ''}
            </span>
            <span className="text-[14px] font-semibold text-ink">{s.t}</span>
            <span className="text-[13px] leading-[1.5] text-muted">{s.s}</span>
          </li>
        ))}
      </ol>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {d.providers.map((p) => (
          <li key={p.name} className="flex flex-col gap-1 text-[14px] leading-[1.6] text-ink-2">
            <span>
              <strong className="text-ink">{p.name}</strong>
              {p.model ? ` (${p.model})` : ''} {p.active ? '' : ' (switched off on this server)'}: {p.purpose}.
            </span>
            <span className="text-muted">Receives: {p.sends}</span>
          </li>
        ))}
      </ul>
      <p className="m-0 text-[14px] leading-[1.6] text-ink-2">
        <strong className="text-ink">What we keep, for {d.retention.logDays} days:</strong> {d.retention.logHolds}. Ratings: {d.retention.ratingsHold}. No raw IP address is stored.
      </p>
      <p className="m-0 text-[14px] leading-[1.6] text-ink-2">
        <strong className="text-ink">Delete a question:</strong> {d.deletion.how}
      </p>
      <p className="m-0 font-mono text-[12px] text-faint">
        Limits now: {d.limits.question} characters a question · {d.limits.perVisitorPerMin} a minute and {d.limits.perVisitorPerDay} a day per visitor · {d.limits.perChatPerMin} a minute and {d.limits.perChatPerDay} a day per Telegram chat · {d.limits.perDayService.toLocaleString('en-US')} written answers a day in total; past that, the closest docs passages are shown instead.
      </p>
    </div>
  )
}
