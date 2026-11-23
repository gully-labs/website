import { useCallback, useEffect, useState } from 'react'
import { Download, FlaskConical, LoaderCircle, Play } from 'lucide-react'
import { TZ } from '../../lib/time'
import { MiniBars } from '../../components/charts/MiniBars'
import { toastError, toastSuccess } from '../../components/ui/toast'
import { chip, ctl } from './ui'
import { ArrowMark } from './newTab'

/* The Gully AI knowledge console (admin): what it knows by product (a coverage matrix with every source and its
   last-updated date), the queues of questions that got no answer and answers rated down with a one-click docs
   backlog export, index versions with what each rebuild added, removed and changed, capacity and cost tiles with the
   daily cap, and the fixed eval set (run it, read the history). All of it reads /api/admin/ask/* with the admin token
   and is mounted by AskStudio. Plain words; a value that is not known shows as "not set" or a dash, never as zero. */

const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6'
const h2 = 'm-0 font-display text-[22px] font-bold uppercase'
const small = 'font-mono text-[12px] text-faint'
const label = 'font-mono text-[11px] tracking-[1px] text-faint'
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }) : '—')

function useAdminJson<T>(path: string, token: string, everyMs = 60_000) {
  const [data, setData] = useState<T | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(async () => {
    const r = await fetch(path, { headers: { authorization: `Bearer ${token}` } }).catch(() => null)
    const d = r ? await r.json().catch(() => null) : null
    if (r?.ok && d) {
      setData(d as T)
      setErr(null)
    } else setErr(d?.error ?? 'Could not be read.')
  }, [path, token])
  useEffect(() => {
    let alive = true
    const tick = () => alive && load()
    tick()
    const id = everyMs ? setInterval(tick, everyMs) : undefined
    return () => {
      alive = false
      if (id) clearInterval(id)
    }
  }, [load, everyMs])
  return { data, err, reload: load }
}

const STATUS_TONE: Record<string, string> = { Covered: 'border-green text-green', Thin: 'border-gold text-gold', Missing: 'border-error text-error' }

/* ------------------------------------------------------------- knowledge --- */

interface Page {
  url: string
  title: string
  source: string
  passages: number
  words: number
  updatedAt: string | null
}
interface Product {
  id: string
  name: string
  page: string
  passages: number
  words: number
  lastIndexedAt: string | null
  status: 'Covered' | 'Thin' | 'Missing'
  sources: string[]
  pages: Page[]
}
interface Knowledge {
  products: Product[]
  general: Product
  totals: { passages: number; words: number; pages: number; covered: number; thin: number; missing: number }
  remote: { key: string; label: string; ok: boolean; chunks: number; lastGoodAt: string | null; error: string | null; rejected: number }[]
  updatedAt: string | null
  retrieval: string
}
interface Versions {
  versions: { at: string; reason: string; counts: { added: number; removed: number; changed: number; total: number }; added: { title: string; url: string }[]; removed: { title: string; url: string }[]; changed: { title: string; url: string }[] }[]
}

function VersionList({ title, items }: { title: string; items: { title: string; url: string }[] }) {
  if (!items.length) return null
  return (
    <div className="flex flex-col gap-1">
      <span className={label}>{title.toUpperCase()}</span>
      <ul className="m-0 flex max-h-[180px] list-none flex-col gap-1 overflow-y-auto p-0 text-[13px]">
        {items.slice(0, 60).map((x) => (
          <li key={x.url + x.title} className="truncate text-ink-2">
            {x.title}
            <span className={`ml-2 ${small}`}>{x.url.replace(/^https:\/\//, '')}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function KnowledgeConsole({ token }: { token: string }) {
  const k = useAdminJson<Knowledge>('/api/admin/ask/knowledge', token, 120_000)
  const v = useAdminJson<Versions>('/api/admin/ask/versions', token, 120_000)
  const [open, setOpen] = useState<string | null>(null)
  const kd = k.data
  const max = Math.max(1, ...(kd?.products.map((p) => p.passages) ?? [1]))
  return (
    <section className={card} aria-labelledby="ask-know-title" data-testid="ask-knowledge">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ask-know-title" className={h2}>
          What Gully AI knows
        </h2>
        <span className={small}>{kd ? `${kd.totals.passages.toLocaleString('en-GB')} passages · ${kd.totals.pages} pages · ${kd.retrieval} search · index ${when(kd.updatedAt)}` : (k.err ?? 'Reading…')}</span>
      </div>
      {kd && (
        <>
          <p className={`m-0 ${small}`}>
            Coverage by product: Covered is 8 or more passages, Thin is 1 to 7, Missing is none. {kd.totals.covered} covered · {kd.totals.thin} thin · {kd.totals.missing} missing.
          </p>
          <ul className="m-0 flex list-none flex-col divide-y divide-line overflow-hidden rounded-input border border-line p-0" data-testid="ask-coverage">
            {[...kd.products, kd.general].map((p) => (
              <li key={p.id} className="flex flex-col">
                <button type="button" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id} className="grid min-h-11 grid-cols-[minmax(0,1.2fr)_90px_minmax(80px,1fr)_100px] items-center gap-3 px-3 py-2 text-left text-[13px] hover:bg-bg max-[699px]:grid-cols-[minmax(0,1fr)_80px_90px]">
                  <span className="min-w-0 truncate text-ink">{p.name}</span>
                  <span className={`inline-flex w-fit rounded-full border px-2 py-[1px] font-mono text-[11px] ${p.id === 'general' ? 'border-line-strong text-faint' : STATUS_TONE[p.status]}`}>{p.id === 'general' ? 'other' : p.status}</span>
                  <span className="flex items-center gap-2 max-[699px]:hidden" aria-hidden>
                    <span className="h-[8px] flex-1 rounded-full bg-line">
                      <span className="block h-full rounded-full bg-gold" style={{ width: `${(p.passages / max) * 100}%` }} />
                    </span>
                    <span className={small}>{p.passages}</span>
                  </span>
                  <span className={`text-right ${small}`}>{day(p.lastIndexedAt)}</span>
                </button>
                {open === p.id && (
                  <div className="flex flex-col gap-2 border-t border-line bg-bg px-3 py-3">
                    <span className={small}>
                      {p.passages} passages, {p.words.toLocaleString('en-GB')} words · sources: {p.sources.join(', ') || 'none'}
                      {p.id !== 'general' && (
                        <>
                          {' '}
                          · public page{' '}
                          <a href={p.page} target="_blank" rel="noopener noreferrer" className="text-gold">
                            {p.page.replace(/^https:\/\//, '')}
                            <ArrowMark />
                          </a>
                        </>
                      )}
                    </span>
                    {p.pages.length ? (
                      <ul className="m-0 flex max-h-[260px] list-none flex-col gap-1 overflow-y-auto p-0 text-[13px]">
                        {p.pages.slice(0, 80).map((g) => (
                          <li key={g.url} className="flex flex-wrap items-baseline gap-x-3 text-ink-2">
                            <a href={g.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate hover:text-gold">
                              {g.title}
                              <ArrowMark />
                            </a>
                            <span className={small}>
                              {g.source} · {g.passages} passages · {g.words} words · updated {day(g.updatedAt)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="m-0 text-[13px] text-muted">Nothing indexed for this product yet. Its public docs need to exist and be listed as a source.</p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          {kd.remote.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className={label}>REMOTE SOURCES (REFRESHED EVERY 6 HOURS)</span>
              <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-2 p-0">
                {kd.remote.map((s) => (
                  <li key={s.key} className="flex flex-col gap-1 rounded-input border border-line px-3 py-2 text-[13px]">
                    <span className="flex items-center gap-2 text-ink">
                      <span aria-hidden className={`size-[7px] rounded-full ${s.ok ? 'bg-green' : 'bg-error'}`} />
                      {s.label}
                    </span>
                    <span className={small}>
                      {s.ok ? `${s.chunks} passages · read ${when(s.lastGoodAt)}` : `failed (${s.error}) · keeping ${s.chunks}`}
                      {s.rejected ? ` · ${s.rejected} refused by the public-text guard` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <div className="flex flex-col gap-3 border-t border-line pt-4" data-testid="ask-versions">
        <span className={label}>INDEX VERSIONS · WHAT EACH REBUILD CHANGED</span>
        {!v.data ? (
          <p className={`m-0 ${small}`}>{v.err ?? 'Reading…'}</p>
        ) : !v.data.versions.length ? (
          <p className="m-0 text-[14px] text-muted">No version recorded yet.</p>
        ) : (
          <>
            <MiniBars
              bars={[...v.data.versions]
                .reverse()
                .slice(-10)
                .map((x) => ({ label: when(x.at), value: x.counts.added + x.counts.removed + x.counts.changed }))}
              orientation="rows"
              label="Passages added, removed or changed per rebuild"
            />
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {v.data.versions.slice(0, 6).map((x) => (
                <li key={x.at} className="flex flex-col gap-2 rounded-[10px] border border-line px-4 py-3">
                  <span className="text-[14px] text-ink">
                    {when(x.at)} · {x.reason === 'baseline' ? 'first recorded index' : x.reason}
                  </span>
                  <span className={small}>
                    {x.counts.added} added · {x.counts.removed} removed · {x.counts.changed} changed · {x.counts.total} in total
                  </span>
                  <VersionList title="Added" items={x.added} />
                  <VersionList title="Removed" items={x.removed} />
                  <VersionList title="Changed" items={x.changed} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- queues --- */

interface Queues {
  days: number
  unanswered: { question: string; asked: number; lastAt: string; nearest: string[] }[]
  thumbsDown: { id: string; at: string; question: string; channel: string; answer: string | null; sources: string[] }[]
  totals: { questions: number; unanswered: number; thumbsDown: number }
}

export function QueuesCard({ token }: { token: string }) {
  const q = useAdminJson<Queues>('/api/admin/ask/queues?days=30', token)
  const [busy, setBusy] = useState(false)
  const exportBacklog = async () => {
    setBusy(true)
    const r = await fetch('/api/admin/ask/backlog?days=30', { headers: { authorization: `Bearer ${token}` } }).catch(() => null)
    setBusy(false)
    if (!r?.ok) return toastError('The backlog could not be exported.')
    const blob = new Blob([await r.text()], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'gully-ai-docs-backlog.md'
    a.click()
    URL.revokeObjectURL(a.href)
    toastSuccess('Docs backlog exported')
  }
  const d = q.data
  return (
    <section className={card} aria-labelledby="ask-queues-title" data-testid="ask-queues">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="ask-queues-title" className={h2}>
            Docs backlog
          </h2>
          <span className={small}>Last 30 days: questions Gully AI said it did not know, and answers rated down, with what it said and cited.</span>
        </div>
        <button type="button" onClick={exportBacklog} disabled={busy} className={ctl}>
          {busy ? <LoaderCircle size={15} aria-hidden className="animate-spin" /> : <Download size={15} aria-hidden />} Add to docs backlog (export .md)
        </button>
      </div>
      {!d ? (
        <p className={`m-0 ${small}`}>{q.err ?? 'Reading…'}</p>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 max-[1099px]:grid-cols-1">
          <div className="flex flex-col gap-2">
            <span className={label}>DID NOT KNOW · {d.unanswered.length}</span>
            {!d.unanswered.length ? (
              <p className="m-0 text-[14px] text-muted">Nothing unanswered.</p>
            ) : (
              <ul className="m-0 flex max-h-[360px] list-none flex-col gap-2 overflow-y-auto p-0">
                {d.unanswered.map((g) => (
                  <li key={g.question} className="flex flex-col gap-1 rounded-[10px] border border-line px-3 py-2">
                    <span className="text-[14px] text-ink">{g.question}</span>
                    <span className={small}>
                      asked {g.asked} · last {when(g.lastAt)}
                      {g.nearest.length ? ` · nearest ${g.nearest.map((u) => u.replace(/^https:\/\//, '')).join(', ')}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <span className={label}>RATED DOWN · {d.thumbsDown.length}</span>
            {!d.thumbsDown.length ? (
              <p className="m-0 text-[14px] text-muted">No thumbs down.</p>
            ) : (
              <ul className="m-0 flex max-h-[360px] list-none flex-col gap-2 overflow-y-auto p-0">
                {d.thumbsDown.map((f) => (
                  <li key={f.id} className="flex flex-col gap-1 rounded-[10px] border border-line px-3 py-2">
                    <span className="text-[14px] text-ink">{f.question}</span>
                    {f.answer ? <span className="text-[13px] text-ink-2">{f.answer.slice(0, 280)}</span> : <span className={small}>answer text was not kept for this one</span>}
                    <span className={small}>
                      {when(f.at)} · {f.channel}
                      {f.sources.length ? ` · sources ${f.sources.map((u) => u.replace(/^https:\/\//, '')).join(', ')}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------ capacity --- */

interface Ops {
  days: number
  cap: number
  usedToday: number
  capPct: number | null
  capLevel: null | 'warn' | 'full'
  answers: number
  errors: number
  errorRate: number | null
  degraded: number
  latencyMs: { p50: number | null; p95: number | null; n: number }
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  priced: boolean
  costUsd: number | null
  perDay: { date: string; answers: number; errors: number; degraded: number; p95: number | null }[]
  provider: 'ok' | 'unavailable'
  queue: { active: number; queued: number; max: number; queueMax: number }
  fallbackModel: string | null
  model: string
}

const secs = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`)

export function CapacityCard({ token }: { token: string }) {
  const o = useAdminJson<Ops>('/api/admin/ask/ops?days=30', token, 30_000)
  const d = o.data
  const tile = (k: string, v: string, note?: string, tone?: string) => (
    <div className="flex min-w-0 flex-col gap-1 bg-surface px-5 py-4">
      <span className={label}>{k}</span>
      <span className={`font-display text-[26px] leading-none font-extrabold ${tone ?? ''}`}>{v}</span>
      {note && <span className="truncate text-[12px] text-muted">{note}</span>}
    </div>
  )
  const tone = d?.capLevel === 'full' ? 'text-error' : d?.capLevel === 'warn' ? 'text-gold' : ''
  return (
    <section className={card} aria-labelledby="ask-cap-title" data-testid="ask-capacity">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ask-cap-title" className={h2}>
          Capacity and cost
        </h2>
        <span className={small}>{d ? `${d.model}${d.fallbackModel ? ` · fallback ${d.fallbackModel}` : ''} · provider ${d.provider} · ${d.queue.active}/${d.queue.max} in flight, ${d.queue.queued} waiting` : (o.err ?? 'Reading…')}</span>
      </div>
      {d && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-px overflow-hidden rounded-card border border-line bg-line">
            {tile('CAP USED TODAY', d.capPct === null ? '—' : `${d.capPct}%`, `${d.usedToday.toLocaleString('en-GB')} of ${d.cap.toLocaleString('en-GB')} answers`, tone)}
            {tile('ANSWERS', d.answers.toLocaleString('en-GB'), `last ${d.days} days · ${d.degraded} docs-only`)}
            {tile('LATENCY P50 / P95', `${secs(d.latencyMs.p50)} / ${secs(d.latencyMs.p95)}`, `${d.latencyMs.n} answers measured`)}
            {tile('ERROR RATE', d.errorRate === null ? '—' : `${(d.errorRate * 100).toFixed(1)}%`, `${d.errors} failed`)}
            {tile('TOKENS', `${Math.round((d.tokens.input + d.tokens.output) / 1000)}k`, `${Math.round(d.tokens.cacheRead / 1000)}k read from cache`)}
            {tile('ESTIMATED COST', d.costUsd === null ? 'not set' : `$${d.costUsd.toFixed(2)}`, d.priced ? `last ${d.days} days, from the prices you set` : 'set the price per million tokens in the server settings')}
          </div>
          <div className="flex flex-col gap-1">
            <span className={label}>DAILY CAP</span>
            <div className="h-[12px] overflow-hidden rounded-full bg-line" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, d.capPct ?? 0)} aria-label="Share of the daily cap used">
              <div className={`h-full rounded-full transition-[width] duration-700 ${d.capLevel === 'full' ? 'bg-error' : d.capLevel === 'warn' ? 'bg-gold' : 'bg-green'}`} style={{ width: `${Math.min(100, d.capPct ?? 0)}%` }} />
            </div>
            <span className={small}>Alerts go to the operators’ Telegram chat and the status page at 80% and again at 100%. At 100% answers fall back to docs passages until midnight (Los Angeles).</span>
          </div>
          <MiniBars bars={d.perDay.slice(-14).map((x) => ({ label: x.date.slice(5), value: x.answers }))} orientation="columns" label="Answers per day" height={90} />
        </>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ eval --- */

interface EvalRun {
  at: string
  layer: 'retrieval' | 'answer'
  total: number
  passed: number
  failed: number
  skipped: number
  results?: { id: string; question: string; status: 'pass' | 'fail' | 'skipped'; checks: { name: string; pass: boolean; detail: string }[]; note?: string }[]
}
interface EvalView {
  history: (Omit<EvalRun, 'results'> & { failedIds: string[] })[]
  last: EvalRun | null
  set: { id: string; question: string; checks: string[]; needs: string | null }[]
}

export function EvalCard({ token }: { token: string }) {
  const ev = useAdminJson<EvalView>('/api/admin/ask/eval', token, 0)
  const [busy, setBusy] = useState<string | null>(null)
  const [run, setRun] = useState<EvalRun | null>(null)
  const go = async (layer: 'retrieval' | 'answer') => {
    setBusy(layer)
    const r = await fetch('/api/admin/ask/eval', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ layer }) }).catch(() => null)
    const d = r ? await r.json().catch(() => null) : null
    setBusy(null)
    if (!r?.ok) return toastError(d?.error ?? 'The eval could not run.')
    setRun(d as EvalRun)
    ;(d.failed ? toastError : toastSuccess)(`Eval: ${d.passed} passed, ${d.failed} failed, ${d.skipped} skipped`)
    ev.reload()
  }
  const shown = run ?? ev.data?.last ?? null
  return (
    <section className={card} aria-labelledby="ask-eval-title" data-testid="ask-eval">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="ask-eval-title" className={h2}>
            Evaluation set
          </h2>
          <span className={small}>{ev.data ? `${ev.data.set.length} fixed questions: must cite the right page, must say "I don't know", must not invent a number. Also runs in CI.` : (ev.err ?? 'Reading…')}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => go('retrieval')} disabled={!!busy} className={ctl}>
            {busy === 'retrieval' ? <LoaderCircle size={15} aria-hidden className="animate-spin" /> : <FlaskConical size={15} aria-hidden />} Run retrieval check (free)
          </button>
          <button type="button" onClick={() => go('answer')} disabled={!!busy} className={ctl} title="Asks the model every case: spends answers from today's cap">
            {busy === 'answer' ? <LoaderCircle size={15} aria-hidden className="animate-spin" /> : <Play size={15} aria-hidden />} Run answers (uses the cap)
          </button>
        </div>
      </div>
      {ev.data && ev.data.history.length > 0 && (
        <MiniBars bars={[...ev.data.history].reverse().slice(-12).map((h) => ({ label: `${when(h.at)} ${h.layer}`, value: h.total ? Math.round((h.passed / Math.max(1, h.total - h.skipped)) * 100) : 0 }))} orientation="columns" label="Share of cases passed per run, %" height={80} />
      )}
      {shown?.results && (
        <div className="flex flex-col gap-2">
          <span className={label}>
            LAST RUN · {when(shown.at)} · {shown.layer} · {shown.passed} passed · {shown.failed} failed · {shown.skipped} skipped
          </span>
          <ul className="m-0 flex max-h-[360px] list-none flex-col divide-y divide-line overflow-y-auto rounded-input border border-line p-0">
            {shown.results.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 px-3 py-2 text-[13px]">
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <span className={`w-[58px] font-mono text-[11px] ${r.status === 'pass' ? 'text-green' : r.status === 'fail' ? 'text-error' : 'text-faint'}`}>{r.status}</span>
                  <span className="min-w-0 flex-1 text-ink-2">{r.question}</span>
                </span>
                {r.status === 'fail' &&
                  r.checks
                    .filter((c) => !c.pass)
                    .map((c) => (
                      <span key={c.name} className={`pl-[70px] ${small}`}>
                        {c.name}: {c.detail}
                      </span>
                    ))}
                {r.status === 'skipped' && r.note && <span className={`pl-[70px] ${small}`}>{r.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {ev.data && ev.data.history.length > 0 && (
        <details className="text-[13px] text-ink-2">
          <summary className={`cursor-pointer ${chip(false)} w-fit`}>History ({ev.data.history.length} runs)</summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
            {ev.data.history.map((h) => (
              <li key={h.at} className={small}>
                {when(h.at)} · {h.layer} · {h.passed}/{h.total - h.skipped} passed{h.failedIds.length ? ` · failed: ${h.failedIds.join(', ')}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
