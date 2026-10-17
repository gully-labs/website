import { ArrowUpRight, CornerDownLeft, LoaderCircle, RotateCcw, Sparkles } from 'lucide-react'
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AskFailure, askStatus, postAsk, type AskAnswer, type AskStatus, type Citation, type Turn } from './askApi'
import { toastError } from '../ui/toast'

/* Gully AI: a question box with answers drawn from the docs and the site, each with numbered sources.
   Used by the /ask page (variant "page") and the docs' Gully AI side panel / sheet (variant "panel").
   Lazy-loaded everywhere: neither the landing nor the docs pages pay for it until it is opened. */

const MAX = 500
const STARTERS = ['How do Telegram gap alerts work?', 'What do the paid API plans include?', 'How is the fair price of a stock token read?', 'What is Chain Kit?', 'Do I need an API key?']

const STAGE: Record<string, string> = {
  searching: 'Searching the docs and the site…',
  thinking: 'Reading the sources…',
  writing: 'Writing the answer…',
  'tool:get_plans': 'Reading the live plans…',
  'tool:get_stock': 'Reading the tracker…',
  'tool:get_top_gaps': 'Reading the tracker…',
  'tool:get_ledger': 'Reading the live ledger…',
  'tool:get_alert_channels': 'Checking the alert channels…',
}
const TOOL_LABEL: Record<string, string> = { get_plans: 'plans', get_stock: 'tracker', get_top_gaps: 'tracker', get_ledger: 'ledger', get_alert_channels: 'alert channels' }

type Exchange = { id: number; q: string; a: AskAnswer | null; error: string | null }

const isOwnHost = (u: string) => /^https:\/\/([\w-]+\.)?gullylabs\.xyz(\/|$)/.test(u)
/** Another site's link opens in a new tab; our own hosts open in place. */
const linkProps = (u: string) => (isOwnHost(u) ? {} : { target: '_blank', rel: 'noopener noreferrer' })

/** Numbers the sources 1..n in the order the answer first cites them (sources it never cites follow),
    and rewrites the [n] markers to match, so the markers read in order and the list has no gaps. */
function renumber(a: AskAnswer): AskAnswer {
  const order: number[] = []
  for (const m of a.answer.matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(m[1])
    if (a.citations.some((c) => c.n === n) && !order.includes(n)) order.push(n)
  }
  for (const c of a.citations) if (!order.includes(c.n)) order.push(c.n)
  const to = new Map(order.map((n, i) => [n, i + 1]))
  return {
    ...a,
    answer: a.answer.replace(/\[(\d{1,2})\]/g, (all, n) => (to.has(Number(n)) ? `[${to.get(Number(n))}]` : '')),
    citations: a.citations.map((c) => ({ ...c, n: to.get(c.n)! })).sort((x, y) => x.n - y.n),
  }
}

/** Inline text: **bold**, [n] citation links and gullylabs.xyz URLs. Everything else is plain text. */
function inline(text: string, cites: Citation[], key: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|\[(\d{1,2})\]|(https:\/\/[^\s)\]]+[^\s)\].,;:!?])/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${key}-${i++}`
    if (m[1]) out.push(<strong key={k} className="font-semibold text-ink">{m[1]}</strong>)
    else if (m[2]) {
      const c = cites.find((x) => x.n === Number(m![2]))
      out.push(
        c ? (
          <a key={k} href={c.url} {...linkProps(c.url)} title={c.title} className="mx-[1px] inline-flex min-w-[20px] items-center justify-center rounded-[4px] border border-gold-line px-[4px] align-[2px] font-mono text-[11px] leading-[16px] text-gold no-underline hover:bg-gold hover:text-bg">
            {c.n}
          </a>
        ) : null,
      )
    } else if (m[3]) {
      out.push(
        isOwnHost(m[3]) ? (
          <a key={k} href={m[3]} className="break-all text-gold underline decoration-gold-line underline-offset-2">
            {m[3].replace(/^https:\/\//, '')}
          </a>
        ) : (
          m[3]
        ),
      )
    }
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** The answer as paragraphs and bullet lists. */
function AnswerText({ text, cites }: { text: string; cites: Citation[] }) {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim())
  return (
    <div className="flex flex-col gap-3 text-[15px] leading-[1.65] text-ink-2">
      {blocks.map((b, bi) => {
        const lines = b.split('\n').filter((l) => l.trim())
        if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l)))
          return (
            <ul key={bi} className="m-0 flex list-disc flex-col gap-1 pl-5 marker:text-gold">
              {lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), cites, `${bi}-${li}`)}</li>
              ))}
            </ul>
          )
        return (
          <p key={bi} className="m-0">
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {inline(l, cites, `${bi}-${li}`)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}

function Sources({ cites }: { cites: Citation[] }) {
  if (!cites.length) return null
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[11px] tracking-[1px] text-faint">SOURCES</span>
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {cites.map((c) => (
          <li key={c.n}>
            <a href={c.url} {...linkProps(c.url)} className="group flex min-h-11 items-center gap-3 rounded-btn border border-line px-3 py-2 text-ink no-underline transition-colors hover:border-gold-line hover:bg-surface-hover">
              <span className="grid size-6 shrink-0 place-items-center rounded-[5px] border border-gold-line font-mono text-[11px] text-gold">{c.n}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14px]">{c.title}</span>
                <span className="truncate font-mono text-[11px] text-faint">
                  {c.source} · {c.url.replace(/^https:\/\//, '')}
                </span>
              </span>
              <ArrowUpRight size={14} aria-hidden className="shrink-0 text-faint group-hover:text-gold" />
              {!isOwnHost(c.url) && <span className="sr-only"> (opens in a new tab)</span>}
            </a>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function AskPanel({ variant = 'page', autoFocus = false }: { variant?: 'page' | 'panel'; autoFocus?: boolean }) {
  const [status, setStatus] = useState<AskStatus | null | 'loading'>('loading')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState('')
  const [log, setLog] = useState<Exchange[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const ids = useId()
  const nextId = useRef(1)

  useEffect(() => {
    let alive = true
    askStatus().then((s) => alive && setStatus(s))
    return () => {
      alive = false
      abortRef.current?.abort()
    }
  }, [])
  useEffect(() => {
    if (autoFocus && status && status !== 'loading' && status.configured) inputRef.current?.focus()
  }, [autoFocus, status])

  const submit = async (question: string) => {
    const text = question.replace(/\s+/g, ' ').trim()
    if (!text || busy || text.length > MAX) return
    const history: Turn[] = log
      .filter((e) => e.a)
      .slice(-2)
      .flatMap((e) => [
        { role: 'user' as const, content: e.q },
        { role: 'assistant' as const, content: e.a!.answer },
      ])
    const id = nextId.current++
    setLog((l) => [...l, { id, q: text, a: null, error: null }])
    setQ('')
    setBusy(true)
    setStage('searching')
    abortRef.current = new AbortController()
    try {
      const a = await postAsk(text, history, setStage, abortRef.current.signal)
      const shown = renumber(a)
      setLog((l) => l.map((e) => (e.id === id ? { ...e, a: shown } : e)))
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      const msg = e instanceof AskFailure ? e.message : 'Something went wrong. Try again.'
      setLog((l) => l.map((x) => (x.id === id ? { ...x, error: msg } : x)))
      // The error also shows under the question with Try again; the toast is what screen readers hear
      // (the answer log only announces additions) and what you see if you scrolled away.
      toastError('Gully AI could not answer', { detail: msg, id: 'ask:error' })
    } finally {
      setBusy(false)
      setStage('')
      // Keep the keyboard in the box for a follow-up; bring the new answer into view.
      requestAnimationFrame(() => {
        lastRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        inputRef.current?.focus()
      })
    }
  }

  if (status === 'loading')
    return (
      <div role="status" aria-label="Loading Gully AI" className="flex flex-col gap-3">
        <div className="h-[14px] w-[160px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-full bg-surface" />
        <div className="flex flex-wrap gap-2">
          {[220, 180, 240].map((w) => (
            <div key={w} className="h-11 animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-full bg-surface" style={{ width: w }} />
          ))}
        </div>
        <div className="h-[92px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-[12px] bg-surface" />
      </div>
    )
  if (!status || !status.configured)
    return (
      <div role="status" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-6">
        <span className="font-mono text-[11px] tracking-[1px] text-gold">GULLY AI</span>
        <p className="m-0 text-[16px] text-ink">Ask is not available yet.</p>
        <p className="m-0 text-[14px] leading-[1.6] text-muted">
          Until it is, the answers are in the <a href="https://docs.gullylabs.xyz" className="text-gold underline decoration-gold-line underline-offset-2">docs</a>, and the team is one message away through the{' '}
          <a href="https://gullylabs.xyz/services?contact=1" className="text-gold underline decoration-gold-line underline-offset-2">contact form</a>.
        </p>
      </div>
    )

  const tooLong = q.length > MAX
  const page = variant === 'page'
  return (
    <div className={`flex min-h-0 flex-col gap-5 ${page ? '' : 'h-full'}`}>
      <div className={`flex min-h-0 flex-col gap-6 ${page ? '' : 'flex-1 overflow-y-auto pr-1'}`} aria-busy={busy}>
        {!log.length && (
          <div className="flex flex-col gap-3">
            <span id={`${ids}-starters`} className="font-mono text-[11px] tracking-[1px] text-faint">
              TRY ONE OF THESE
            </span>
            <div role="group" aria-labelledby={`${ids}-starters`} className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button key={s} type="button" onClick={() => submit(s)} disabled={busy} className="min-h-11 rounded-full border border-line-strong px-4 py-2 text-left text-[14px] text-ink-2 transition-colors hover:border-gold hover:text-ink disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* One polite live region: the newest answer (or error) is announced once it is complete. */}
        <div role="log" aria-live="polite" aria-relevant="additions" aria-label="Answers" className="flex flex-col gap-6">
          {log.map((e, i) => (
            <article key={e.id} ref={i === log.length - 1 ? lastRef : undefined} aria-label={`Question: ${e.q}`} className="flex flex-col gap-3">
              <p className="m-0 self-end rounded-[12px] rounded-br-[4px] border border-line-strong bg-surface-hover px-4 py-2 text-[15px] text-ink">{e.q}</p>
              {e.a ? (
                <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
                  <AnswerText text={e.a.answer} cites={e.a.citations} />
                  {e.a.usedTools.length > 0 && <span className="font-mono text-[11px] text-faint">Live data: {[...new Set(e.a.usedTools.map((t) => TOOL_LABEL[t] ?? t))].join(', ')}</span>}
                  <Sources cites={e.a.citations} />
                </div>
              ) : e.error ? (
                <div className="flex flex-wrap items-center gap-3 rounded-card border border-error/40 px-5 py-4">
                  <p className="m-0 flex-1 text-[14px] text-error">{e.error}</p>
                  <button type="button" onClick={() => submit(e.q)} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-line-strong px-4 text-[14px] text-ink hover:border-gold disabled:opacity-50">
                    <RotateCcw size={14} aria-hidden /> Try again
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
        {busy && (
          <p role="status" className="m-0 flex items-center gap-2 font-mono text-[12px] text-muted">
            <LoaderCircle size={14} aria-hidden className="animate-spin text-gold" />
            {STAGE[stage] ?? 'Working…'}
          </p>
        )}
      </div>

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit(q)
        }}
      >
        <label htmlFor={`${ids}-q`} className="font-mono text-[11px] tracking-[1px] text-faint">
          {log.length ? 'ASK A FOLLOW-UP' : 'YOUR QUESTION'}
        </label>
        <div className={`flex items-end gap-2 rounded-[12px] border bg-surface-deep p-2 transition-colors focus-within:border-gold ${tooLong ? 'border-error' : 'border-line-strong'}`}>
          <textarea
            ref={inputRef}
            id={`${ids}-q`}
            value={q}
            rows={2}
            maxLength={MAX + 50}
            aria-describedby={`${ids}-hint`}
            aria-invalid={tooLong}
            placeholder="How do gap alerts work?"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit(q)
              }
            }}
            className="min-h-11 flex-1 resize-none bg-transparent px-2 py-[10px] text-[16px] leading-[1.4] text-ink outline-none placeholder:text-faint"
          />
          <button type="submit" disabled={busy || !q.trim() || tooLong} className="inline-flex size-11 shrink-0 items-center justify-center rounded-btn bg-gold text-bg transition-colors hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-40" aria-label="Ask">
            {busy ? <LoaderCircle size={18} aria-hidden className="animate-spin" /> : <CornerDownLeft size={18} aria-hidden />}
          </button>
        </div>
        <div id={`${ids}-hint`} className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-faint">
          <span className="inline-flex items-center gap-1">
            <Sparkles size={12} aria-hidden className="text-gold" /> Answers from the Gully Labs docs and site, with sources. Not investment advice.
          </span>
          <span className={tooLong ? 'text-error' : undefined}>
            {q.length}/{MAX}
          </span>
        </div>
      </form>
    </div>
  )
}
