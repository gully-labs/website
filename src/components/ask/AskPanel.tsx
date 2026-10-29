import { ArrowUpRight, Clock, CornerDownLeft, LoaderCircle, RotateCcw, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react'
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AskFailure, askStatus, postAsk, postFeedback, type AskAnswer, type AskStatus, type Citation, type LiveCite, type Turn } from './askApi'
import { Actions, LiveCard } from './AskCards'
import { HolderMapHit } from './HolderMapHit'
import { asOfLabel } from './askFormat'
import { newTab } from '../LayoutNav'
import { toastError } from '../ui/toast'
import { isLocalHost, SITE_URL } from '../../site-host'
import { track } from '../../lib/track'

/* Gully AI: a question box with answers drawn from the docs, the site and live tools. Each answer cites its
   sources ([1] doc sections, [L1] live reads with their time), shows live cards with a mini chart for the
   figures it read, offers one-tap next steps (deep links and pre-filled forms), and can be rated.
   Used by the /ask page (variant "page"), the docs' and the app's Gully AI side panel / sheet (variant
   "panel"). In the app the session cookie goes along, so "is my store paused?" reads your own workspace.
   Lazy-loaded everywhere: neither the landing nor the docs pages pay for it until it is opened. */

const MAX = 500
const STARTERS = ['How much do you charge?', 'What chains can I pay on?', 'Is my store paused?', 'What is the L3?', 'Do you track me?', 'How do Telegram gap alerts work?']

const STAGE: Record<string, string> = {
  searching: 'Searching the docs and the site…',
  thinking: 'Reading the sources…',
  writing: 'Writing the answer…',
  'tool:get_plans': 'Reading the live plans…',
  'tool:get_stock': 'Reading the tracker…',
  'tool:get_top_gaps': 'Reading the tracker…',
  'tool:get_ledger': 'Reading the live ledger…',
  'tool:get_alert_channels': 'Checking the alert channels…',
  'tool:get_pay_chains': 'Reading the Gully Pay config…',
  'tool:get_holders': 'Reading the Holder Map…',
  'tool:search_docs': 'Searching again…',
  'tool:get_my_store': 'Reading your store…',
  'tool:get_my_usage': 'Reading your API usage…',
  'tool:get_my_alerts': 'Reading your alerts…',
  'tool:get_status': 'Checking the live status…',
  'tool:get_pay_gas': 'Reading gas costs…',
  'tool:get_security_offer': 'Reading the Gully Security offer…',
  'tool:get_gully_score': 'Reading the Gully Score…',
  'tool:get_published_reports': 'Reading published reports…',
}
const TOOL_LABEL: Record<string, string> = { get_plans: 'plans', get_stock: 'tracker', get_top_gaps: 'tracker', get_ledger: 'ledger', get_alert_channels: 'alert channels', get_pay_chains: 'Gully Pay config', get_holders: 'Holder Map', search_docs: 'a second search', get_my_store: 'your store', get_my_usage: 'your usage', get_my_alerts: 'your alerts', get_status: 'status', get_pay_gas: 'gas costs', get_security_offer: 'Gully Security', get_gully_score: 'Gully Score', get_published_reports: 'published reports' }

/** Where Gully AI was used, for the ask-asked event: the app, the docs side panel, the /ask page, the home console. */
function askSurface(variant: 'page' | 'panel'): string {
  const host = window.location.host
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (/^app\./.test(host) || path.startsWith('/developers')) return 'app'
  if (variant === 'panel') return /^docs\./.test(host) || path.startsWith('/docs') ? 'docs-panel' : 'panel'
  if (path === '/ask') return 'ask-page'
  if (path === '/') return 'home'
  return 'page'
}

type Exchange = { id: number; q: string; a: AskAnswer | null; error: string | null; rating?: 'up' | 'down' | null; down?: boolean }

const PROVIDER_DOWN = "Gully AI is unavailable right now. We're on it — try again later."

/** The host this page is on: a link to it opens in place; any other host (the docs, the app, GitHub) opens in a new tab. */
const isOwnHost = (u: string) => {
  try {
    return new URL(u, window.location.href).host === window.location.host
  } catch {
    return false
  }
}
/** Our own sites: only these URLs in an answer become links (anything else stays plain text). */
const GULLY_URL = /^https:\/\/([\w-]+\.)?gullylabs\.xyz(\/|$)/
/** Another host's link opens in a new tab; this host's open in place. */
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
    answer: a.answer.replace(/\[(\d{1,2})\]/g, (_m, n) => (to.has(Number(n)) ? `[${to.get(Number(n))}]` : '')),
    citations: a.citations.map((c) => ({ ...c, n: to.get(c.n)! })).sort((x, y) => x.n - y.n),
  }
}

/** Inline text: **bold**, [n] source links, [Ln] live-read links and gullylabs.xyz URLs. Everything else is plain text. */
function inline(text: string, cites: Citation[], key: string, live: LiveCite[] = []): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|\[(\d{1,2})\]|(https:\/\/[^\s)\]]+[^\s)\].,;:!?])|\[(L\d{1,2})\]/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${key}-${i++}`
    if (m[1]) out.push(<strong key={k} className="font-semibold text-ink">{m[1]}</strong>)
    else if (m[4]) {
      const l = live.find((x) => x.n === m![4])
      const at = asOfLabel(l?.asOf)
      out.push(
        l ? (
          <a key={k} href={l.url} {...linkProps(l.url)} title={`${l.label}${at ? `, as of ${at}` : ''}`} data-testid="ask-live-cite" className="mx-[1px] inline-flex items-center justify-center gap-[3px] rounded-[4px] border border-success-line px-[4px] align-[2px] font-mono text-[11px] leading-[16px] text-green no-underline hover:bg-green hover:text-bg">
            <span aria-hidden className="size-[5px] rounded-full bg-current" />
            {at ?? 'live'}
            <span className="sr-only"> (live: {l.label})</span>
          </a>
        ) : null,
      )
    } else if (m[2]) {
      const c = cites.find((x) => x.n === Number(m![2]))
      out.push(
        c ? (
          <a key={k} href={c.url} {...linkProps(c.url)} title={c.title} className="mx-[1px] inline-flex min-w-[20px] items-center justify-center rounded-btn border border-gold-line px-[4px] align-[2px] font-mono text-[11px] leading-[16px] text-gold no-underline hover:bg-gold hover:text-bg">
            {c.n}
          </a>
        ) : null,
      )
    } else if (m[3]) {
      out.push(
        GULLY_URL.test(m[3]) ? (
          <a key={k} href={m[3]} {...linkProps(m[3])} className="break-all text-gold underline decoration-gold-line underline-offset-2">
            {m[3].replace(/^https:\/\//, '')}
            {!isOwnHost(m[3]) && <span className="sr-only"> (opens in a new tab)</span>}
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
function AnswerText({ text, cites, live }: { text: string; cites: Citation[]; live: LiveCite[] }) {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim())
  return (
    <div className="flex flex-col gap-3 text-[15px] leading-[1.65] text-ink-2">
      {blocks.map((b, bi) => {
        const lines = b.split('\n').filter((l) => l.trim())
        if (lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l)))
          return (
            <ul key={bi} className="m-0 flex list-disc flex-col gap-1 pl-5 marker:text-gold">
              {lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''), cites, `${bi}-${li}`, live)}</li>
              ))}
            </ul>
          )
        return (
          <p key={bi} className="m-0">
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {inline(l, cites, `${bi}-${li}`, live)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}

function Sources({ cites, live }: { cites: Citation[]; live: LiveCite[] }) {
  if (!cites.length && !live.length) return null
  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[11px] tracking-[1px] text-faint">SOURCES</span>
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {live.map((l) => (
          <li key={l.n}>
            <a href={l.url} {...linkProps(l.url)} className="group flex min-h-11 items-center gap-3 rounded-btn border border-line px-3 py-2 text-ink no-underline transition-colors hover:border-success-line hover:bg-surface-hover">
              <span className="grid h-6 shrink-0 place-items-center rounded-[5px] border border-success-line px-1 font-mono text-[11px] text-green">LIVE</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14px]">{l.label}</span>
                <span className="truncate font-mono text-[11px] text-faint">
                  {asOfLabel(l.asOf) ? `as of ${asOfLabel(l.asOf)} · ` : ''}
                  {l.url.replace(/^https:\/\//, '')}
                </span>
              </span>
              <ArrowUpRight size={14} aria-hidden className="shrink-0 text-faint group-hover:text-green" />
            </a>
          </li>
        ))}
        {cites.map((c) => (
          <li key={c.n}>
            <a href={c.url} {...linkProps(c.url)} className="group flex min-h-11 items-center gap-3 rounded-btn border border-line px-3 py-2 text-ink no-underline transition-colors hover:border-gold-line hover:bg-surface-hover">
              <span className="grid size-6 shrink-0 place-items-center rounded-btn border border-gold-line font-mono text-[11px] text-gold">{c.n}</span>
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
  // Gully AI as a whole is down (the provider refuses our account): a calm notice, no red card, no retry button.
  const [providerDown, setProviderDown] = useState(false)

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

  const rate = async (id: number, answerId: string | undefined, rating: 'up' | 'down') => {
    if (!answerId) return
    setLog((l) => l.map((e) => (e.id === id ? { ...e, rating } : e)))
    track('ask-rated', { rating })
    const ok = await postFeedback(answerId, rating)
    if (!ok) {
      setLog((l) => l.map((e) => (e.id === id ? { ...e, rating: null } : e)))
      toastError('The rating could not be saved', { id: 'ask:rate' })
    }
  }

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
      setProviderDown(false)
      // The surface and which live tools answered; never the question or the answer.
      track('ask-asked', { surface: askSurface(variant), tools: [...new Set(a.usedTools ?? [])].sort().join(',').slice(0, 80) || 'none' })
      setLog((l) => l.map((e) => (e.id === id ? { ...e, a: shown } : e)))
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      if (e instanceof AskFailure && e.code === 'provider-unavailable') {
        setProviderDown(true)
        setLog((l) => l.map((x) => (x.id === id ? { ...x, error: PROVIDER_DOWN, down: true } : x)))
        return
      }
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
        <div className="h-[14px] w-[160px] gl-skeleton rounded-full bg-surface" />
        <div className="flex flex-wrap gap-2">
          {[220, 180, 240].map((w) => (
            <div key={w} className="h-11 gl-skeleton rounded-full bg-surface" style={{ width: w }} />
          ))}
        </div>
        <div className="h-[92px] gl-skeleton rounded-card bg-surface" />
      </div>
    )
  if (!status || !status.configured)
    return (
      <div role="status" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
        <span className="font-mono text-[11px] tracking-[1px] text-gold">GULLY AI</span>
        <p className="m-0 text-[16px] text-ink">Gully AI is not switched on here yet.</p>
        <p className="m-0 text-[14px] leading-[1.6] text-muted">
          Until it is, the answers are in the <a href="https://docs.gullylabs.xyz" {...newTab} className="text-gold underline decoration-gold-line underline-offset-2">docs<span className="sr-only"> (opens in a new tab)</span></a>, and the team is one message away through the{' '}
          <a href="https://gullylabs.xyz/services?contact=1" {...linkProps('https://gullylabs.xyz/services?contact=1')} className="text-gold underline decoration-gold-line underline-offset-2">contact form</a>.
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
              <p className="m-0 self-end rounded-card rounded-br-btn border border-line-strong bg-surface-hover px-4 py-2 text-[15px] text-ink">{e.q}</p>
              {e.a ? (
                <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
                  <AnswerText text={e.a.answer} cites={e.a.citations} live={e.a.live ?? []} />
                  {(e.a.cards ?? []).map((c) => (
                    <LiveCard key={`${c.tool}-${c.cite}`} card={c} />
                  ))}
                  {e.a.usedTools.length > 0 && <span className="font-mono text-[11px] text-faint">Read for this answer: {[...new Set(e.a.usedTools.map((t) => TOOL_LABEL[t] ?? t))].join(', ')}</span>}
                  <Actions actions={e.a.actions ?? []} />
                  <Sources cites={e.a.citations} live={e.a.live ?? []} />
                  {e.a.id && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3" role="group" aria-label="Rate this answer">
                      <span className="font-mono text-[11px] text-faint">{e.rating ? 'Thanks: this helps us decide which docs to write.' : 'Was this useful?'}</span>
                      {(['up', 'down'] as const).map((r) => (
                        <button
                          key={r}
                          type="button"
                          aria-pressed={e.rating === r}
                          aria-label={r === 'up' ? 'Useful' : 'Not useful'}
                          data-testid={`ask-rate-${r}`}
                          onClick={() => rate(e.id, e.a?.id, r)}
                          className={`grid size-11 place-items-center rounded-btn border transition-colors ${e.rating === r ? 'border-gold bg-gold/12 text-gold' : 'border-line text-faint hover:border-line-hover hover:text-ink'}`}
                        >
                          {r === 'up' ? <ThumbsUp size={16} aria-hidden /> : <ThumbsDown size={16} aria-hidden />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : e.down ? (
                <p className="m-0 flex items-start gap-3 rounded-card border border-line bg-surface px-5 py-4 text-[14px] leading-[1.6] text-muted" data-testid="ask-unavailable">
                  <Clock size={16} aria-hidden className="mt-[3px] flex-none text-gold" />
                  {e.error}
                </p>
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

      {(providerDown || (status.provider === 'unavailable' && !log.some((x) => x.a))) && !log.some((x) => x.down) && (
        <p role="status" className="m-0 flex items-start gap-3 rounded-card border border-line bg-surface px-4 py-3 text-[14px] leading-[1.6] text-muted" data-testid="ask-unavailable">
          <Clock size={16} aria-hidden className="mt-[3px] flex-none text-gold" />
          <span>
            {PROVIDER_DOWN} The <a href="https://docs.gullylabs.xyz" {...newTab} className="text-gold underline decoration-gold-line underline-offset-2">docs<span className="sr-only"> (opens in a new tab)</span></a> have the answers meanwhile.
          </span>
        </p>
      )}
      <HolderMapHit text={q} />
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
        <div className={`flex items-end gap-2 rounded-card border bg-surface-deep p-2 transition-colors focus-within:border-gold ${tooLong ? 'border-error' : 'border-line-strong'}`}>
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
          <span className="min-w-0 flex-1 basis-[240px] leading-[1.5]">
            <Sparkles size={12} aria-hidden className="mr-1 inline align-[-1px] text-gold" /> Answers from the Gully Labs docs, site and live data, with sources. Information only, not advice. Questions are kept 90 days (<a href={isLocalHost() ? '/legal/privacy#s4' : `${SITE_URL}/legal/privacy#s4`} {...linkProps(isLocalHost() ? '/legal/privacy' : `${SITE_URL}/legal/privacy`)} className="relative underline underline-offset-2 before:absolute before:-inset-x-1 before:-inset-y-3 before:content-[''] hover:text-gold">privacy</a>).
          </span>
          <span className={tooLong ? 'text-error' : undefined}>
            {q.length}/{MAX}
          </span>
        </div>
      </form>
    </div>
  )
}
