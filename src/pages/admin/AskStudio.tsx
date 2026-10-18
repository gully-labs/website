import { Check, Copy, LoaderCircle, RotateCcw, Wand2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { copyWithToast } from '../../components/ui/toast'
import { MiniBars } from '../../components/ask/AskCards'

/* Gully Ask in the admin dashboard: the content studio (drafts from the docs and live data, never
   posted anywhere), the ask log (what people ask, and how often Ask had no answer), and the
   "Unanswered / low-rated questions" card (GET /api/admin/ask/gaps: the docs to write next).
   Mounted by AdminPage with the admin token; talks to /api/admin/ask/* only. */

const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6'
const h2 = 'm-0 font-display text-[22px] font-bold uppercase'
const small = 'font-mono text-[12px] text-faint'
const field = 'min-h-11 rounded-input border border-line-strong bg-bg px-3 text-[14px] text-ink outline-none focus:border-gold'

const KINDS = [
  { id: 'blog_post', label: 'Blog post' },
  { id: 'x_thread', label: 'X thread' },
  { id: 'changelog', label: 'Changelog' },
  { id: 'stock_explainer', label: 'Stock explainer' },
  { id: 'release_note', label: 'Release note' },
] as const
type Kind = (typeof KINDS)[number]['id']

interface Draft {
  markdown: string
  sources: { n: number; title: string; url: string; source: string; cited: boolean }[]
  usedTools: string[]
  model: string
  warnings: string[]
}

interface AskLog {
  days: number
  status: { configured: boolean; model: string; draftModel: string; indexSize: number; updatedAt: string | null; dailyLimit: number; usedToday: number; localChunks: number; remote: { key: string; label: string; ok: boolean; chunks: number; lastGoodAt: string | null; error: string | null }[] }
  totals: { questions: number; errors: number; unanswered: number; unansweredRate: number | null; drafts: number; avgLatencyMs: number | null; tokens: { input: number; output: number; cacheRead: number } }
  perDay: { date: string; count: number; unanswered: number; errors: number; web: number; telegram: number }[]
  top: { question: string; count: number; unanswered: number }[]
  recent: { at: string; channel: string; question: string; answered: boolean; error: string | null; citations: number; usedTools: string[]; latencyMs: number | null; model: string | null }[]
}

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function Studio({ token, configured }: { token: string; configured: boolean }) {
  const [kind, setKind] = useState<Kind>('blog_post')
  const [topic, setTopic] = useState('')
  const [notes, setNotes] = useState('')
  const [ticker, setTicker] = useState('')
  const [chain, setChain] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [copied, setCopied] = useState(false)

  const generate = async () => {
    if (!topic.trim() || busy) return
    setBusy(true)
    setErr(null)
    setCopied(false)
    const r = await fetch('/api/admin/ask/draft', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ kind, topic: topic.trim(), notes: notes.trim() || undefined, ...(kind === 'stock_explainer' ? { ticker: ticker.trim(), chain: chain || undefined } : {}) }),
    }).catch(() => null)
    const d = r ? await r.json().catch(() => null) : null
    setBusy(false)
    if (!r?.ok) return setErr(d?.error ?? 'The server could not be reached.')
    setDraft(d as Draft)
  }

  return (
    <section className={card} aria-labelledby="ask-studio-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ask-studio-title" className={h2}>
          Content studio
        </h2>
        <span className={small}>drafts from the docs, the site and live data · never posted anywhere</span>
      </div>
      {!configured && <p className="m-0 rounded-input border border-gold-line px-4 py-3 text-[13px] text-gold">Ask is not configured: set ANTHROPIC_API_KEY on the server to write drafts.</p>}
      <form
        className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 max-[899px]:grid-cols-1"
        onSubmit={(e) => {
          e.preventDefault()
          generate()
        }}
      >
        <fieldset className="col-span-full m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 font-mono text-[11px] tracking-[1px] text-faint">KIND</legend>
          <div className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <label key={k.id} className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-[14px] transition-colors ${kind === k.id ? 'border-gold bg-[rgba(232,192,96,.1)] text-gold' : 'border-line-strong text-ink-2 hover:border-line-hover'}`}>
                <input type="radio" name="ask-kind" value={k.id} checked={kind === k.id} onChange={() => setKind(k.id)} className="sr-only" />
                {k.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-2 text-[13px] text-ink-2">
          Topic
          <input value={topic} maxLength={300} onChange={(e) => setTopic(e.target.value)} placeholder="Telegram gap alerts are live" className={field} />
        </label>
        {kind === 'stock_explainer' ? (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-2 text-[13px] text-ink-2">
              Ticker
              <input value={ticker} maxLength={8} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="NVDA" className={`${field} font-mono`} />
            </label>
            <label className="flex flex-col gap-2 text-[13px] text-ink-2">
              Chain
              <select value={chain} onChange={(e) => setChain(e.target.value)} className={field}>
                <option value="">Both</option>
                <option value="robinhood">Robinhood Chain</option>
                <option value="bsc">BNB Chain</option>
              </select>
            </label>
          </div>
        ) : (
          <span className="max-[899px]:hidden" />
        )}
        <label className="col-span-full flex flex-col gap-2 text-[13px] text-ink-2">
          Notes (optional: angle, audience, facts to include)
          <textarea value={notes} maxLength={3000} rows={3} onChange={(e) => setNotes(e.target.value)} className={`${field} py-2 leading-[1.5]`} />
        </label>
        <div className="col-span-full flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy || !topic.trim() || !configured} className="inline-flex min-h-11 items-center gap-2 rounded-btn bg-gold px-5 text-[15px] font-semibold text-bg transition-colors hover:bg-gold-hover disabled:opacity-40">
            {busy ? <LoaderCircle size={16} aria-hidden className="animate-spin" /> : <Wand2 size={16} aria-hidden />}
            {busy ? 'Writing…' : 'Generate'}
          </button>
          {err && (
            <p role="alert" className="m-0 text-[14px] text-error">
              {err}
            </p>
          )}
        </div>
      </form>

      {draft && (
        <div className="flex flex-col gap-4 border-t border-line pt-5" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className={small}>
              {draft.model}
              {draft.usedTools.length ? ` · live data: ${draft.usedTools.join(', ')}` : ''}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={async () => {
                  if (!(await copyWithToast(draft.markdown, 'Markdown'))) return
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
                className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-line-strong px-4 text-[14px] text-ink hover:border-gold"
              >
                {copied ? <Check size={15} aria-hidden className="text-green" /> : <Copy size={15} aria-hidden />}
                {copied ? 'Copied' : 'Copy markdown'}
              </button>
              <button type="button" onClick={generate} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-line-strong px-4 text-[14px] text-ink hover:border-gold disabled:opacity-40">
                <RotateCcw size={15} aria-hidden /> Regenerate
              </button>
            </div>
          </div>
          {draft.warnings.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1 rounded-input border border-gold-line px-4 py-3 text-[13px] text-gold">
              {draft.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <pre className="m-0 max-h-[520px] overflow-auto rounded-input border border-line bg-bg p-4 font-mono text-[13px] leading-[1.6] whitespace-pre-wrap text-ink-2">{draft.markdown}</pre>
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[11px] tracking-[1px] text-faint">SOURCES RETRIEVED</span>
            <ol className="m-0 flex list-none flex-col gap-1 p-0">
              {draft.sources.map((s) => (
                <li key={s.n} className="flex items-baseline gap-2 text-[13px]">
                  <span className={`font-mono ${s.cited ? 'text-gold' : 'text-faint'}`}>[{s.n}]</span>
                  <a href={s.url} target="_blank" rel="noopener" className="truncate text-ink-2 hover:text-gold">
                    {s.title}
                  </a>
                  <span className={small}>
                    {s.source}
                    {s.cited ? ' · cited' : ''}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </section>
  )
}

function Log({ log }: { log: AskLog }) {
  const t = log.totals
  const max = Math.max(1, ...log.perDay.map((d) => d.count))
  const tile = (k: string, v: string, note?: string) => (
    <div className="flex min-w-0 flex-col gap-1 bg-surface px-5 py-4">
      <span className="font-mono text-[10px] tracking-[1px] text-faint">{k}</span>
      <span className="font-display text-[28px] leading-none font-extrabold">{v}</span>
      {note && <span className="truncate text-[12px] text-muted">{note}</span>}
    </div>
  )
  return (
    <section className={card} aria-labelledby="ask-log-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ask-log-title" className={h2}>
          Ask log
        </h2>
        <span className={small}>
          last {log.days} days · {log.status.configured ? `${log.status.model}` : 'not configured'} · index {log.status.indexSize} chunks
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,160px),1fr))] gap-px overflow-hidden rounded-card border border-line bg-line">
        {tile('QUESTIONS', t.questions.toLocaleString('en-GB'), `${t.errors} failed`)}
        {tile("DON'T KNOW", t.unansweredRate === null ? '—' : `${Math.round(t.unansweredRate * 100)}%`, `${t.unanswered} unanswered`)}
        {tile('TODAY', `${log.status.usedToday}`, `of ${log.status.dailyLimit.toLocaleString('en-GB')} daily cap`)}
        {tile('DRAFTS', String(t.drafts))}
        {tile('LATENCY', t.avgLatencyMs === null ? '—' : `${(t.avgLatencyMs / 1000).toFixed(1)}s`, 'average answer')}
        {tile('TOKENS', `${Math.round((t.tokens.input + t.tokens.output) / 1000)}k`, `${Math.round(t.tokens.cacheRead / 1000)}k read from cache`)}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 max-[1099px]:grid-cols-1">
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] tracking-[1px] text-faint">PER DAY</span>
          {!log.perDay.length ? (
            <p className="m-0 text-[14px] text-muted">No questions yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {log.perDay.slice(0, 14).map((d) => (
                <li key={d.date} className="grid grid-cols-[86px_minmax(0,1fr)_88px] items-center gap-3 font-mono text-[12px] text-ink-2">
                  <span>{d.date.slice(5)}</span>
                  <span className="h-[10px] rounded-full bg-line">
                    <span className="block h-full rounded-full bg-gold" style={{ width: `${(d.count / max) * 100}%` }} />
                  </span>
                  <span className="text-right">
                    {d.count}
                    {d.unanswered ? <span className="text-faint"> · {d.unanswered} ?</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] tracking-[1px] text-faint">TOP QUESTIONS</span>
          {!log.top.length ? (
            <p className="m-0 text-[14px] text-muted">Nothing asked yet.</p>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-1 p-0">
              {log.top.slice(0, 10).map((q) => (
                <li key={q.question} className="flex items-baseline justify-between gap-3 text-[13px] text-ink-2">
                  <span className="min-w-0 truncate">{q.question}</span>
                  <span className={small}>
                    ×{q.count}
                    {q.unanswered ? ` · ${q.unanswered} unanswered` : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      {log.recent.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] tracking-[1px] text-faint">RECENT</span>
          <ul className="m-0 flex max-h-[360px] list-none flex-col divide-y divide-line overflow-y-auto rounded-input border border-line p-0">
            {log.recent.map((r) => (
              <li key={r.at + r.question} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
                <span className={small}>{when(r.at)}</span>
                <span className="min-w-0 flex-1 text-ink-2">{r.question}</span>
                <span className={`font-mono text-[11px] ${r.error ? 'text-error' : r.answered ? 'text-green' : 'text-gold'}`}>{r.error ? 'error' : r.answered ? `${r.citations} sources` : "didn't know"}</span>
                <span className={small}>
                  {r.channel}
                  {r.latencyMs !== null ? ` · ${(r.latencyMs / 1000).toFixed(1)}s` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {log.status.remote.length > 0 && (
        <p className={`m-0 ${small}`}>
          Remote sources:{' '}
          {log.status.remote.map((s) => `${s.key} ${s.ok ? `${s.chunks}` : `failed (${s.error}), keeping ${s.chunks}`}`).join(' · ')}
        </p>
      )}
    </section>
  )
}

interface Gaps {
  days: number
  items: { question: string; asked: number; unanswered: number; errors: number; down: number; up: number; lastAt: string | null; cited: string[] }[]
  totals: { questions: number; unanswered: number; ratedUp: number; ratedDown: number }
}

/** Questions Gully AI could not answer or people rated down, worst first: which docs to write. */
function GapsCard({ token }: { token: string }) {
  const [g, setG] = useState<Gaps | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const load = async () => {
      const r = await fetch('/api/admin/ask/gaps?days=30', { headers: { authorization: `Bearer ${token}` } }).catch(() => null)
      const d = r ? await r.json().catch(() => null) : null
      if (!alive) return
      if (r?.ok && d) {
        setG(d as Gaps)
        setErr(null)
      } else setErr(d?.error ?? 'Could not be read.')
    }
    load()
    const id = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [token])
  return (
    <section className={card} aria-labelledby="ask-gaps-title" data-testid="ask-gaps">
      <div className="flex flex-col gap-1">
        <h2 id="ask-gaps-title" className={h2}>
          Unanswered / low-rated questions
        </h2>
        <span className={small}>Last 30 days, top 20: the docs to write next. Live from the ask log and the thumbs.</span>
      </div>
      {!g ? (
        <p className={`m-0 ${small}`}>{err ?? 'Reading…'}</p>
      ) : (
        <>
          <p className={`m-0 ${small}`}>
            {g.totals.questions} questions · {g.totals.unanswered} without an answer · {g.totals.ratedUp} rated up · {g.totals.ratedDown} rated down
          </p>
          {g.items.length ? (
            <>
              <MiniBars bars={g.items.slice(0, 8).map((x) => ({ label: x.question, value: x.unanswered + x.down }))} unit="" label="Unanswered + thumbs down, per question" />
              <ol className="m-0 flex list-none flex-col gap-2 p-0">
                {g.items.map((x) => (
                  <li key={x.question} className="flex flex-col gap-1 rounded-[10px] border border-line px-4 py-3">
                    <span className="text-[14px] text-ink">{x.question}</span>
                    <span className={small}>
                      asked {x.asked} · no answer {x.unanswered} · rated down {x.down} · up {x.up}
                      {x.errors ? ` · errors ${x.errors}` : ''}
                      {x.lastAt ? ` · last ${new Date(x.lastAt).toLocaleString()}` : ''}
                      {x.cited.length ? ` · cited ${x.cited.map((u) => u.replace(/^https:\/\//, '')).join(', ')}` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className={`m-0 inline-flex items-center gap-2 ${small}`}>
              <span aria-hidden className="size-[7px] rounded-full bg-green" style={{ animation: 'gl-live-pulse 2s ease-in-out infinite' }} />
              Nothing unanswered or rated down in the last 30 days.
            </p>
          )}
        </>
      )}
    </section>
  )
}

/** The whole Ask section of the admin dashboard. */
export function AskStudio({ token }: { token: string }) {
  const [log, setLog] = useState<AskLog | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(async () => {
    const r = await fetch('/api/admin/ask/log?days=30', { headers: { authorization: `Bearer ${token}` } }).catch(() => null)
    const d = r ? await r.json().catch(() => null) : null
    if (r?.ok && d) {
      setLog(d as AskLog)
      setErr(null)
    } else setErr(d?.error ?? 'The ask log could not be read.')
  }, [token])
  useEffect(() => {
    let alive = true
    const tick = () => alive && load()
    tick()
    const id = setInterval(tick, 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [load])
  return (
    <>
      <Studio token={token} configured={log?.status.configured ?? true} />
      <GapsCard token={token} />
      {log ? <Log log={log} /> : <p className={`m-0 ${small}`}>{err ?? 'Reading the ask log…'}</p>}
    </>
  )
}
