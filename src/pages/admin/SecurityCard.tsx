import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { axisTooltip, barsPreset, C, tipHtml } from '../../components/charts/chartPresets'
import { GhostChart } from '../../components/charts/GhostChart'
import { EChart } from '../../components/charts/EChart'
import { STATUS_LABEL, type JobStatus } from '../../components/security/types'
import { toastError, toastSuccess } from '../../components/ui/toast'
import { adminCall } from './payAdmin'

/* Admin: Gully Security (GET /api/admin/security, server/security-routes.mjs). Tiles, scans per day (30 days,
   stacked started / finished / failed, real counts), the queue (awaiting payment and running), recent
   failures, and the inbox of Security Review / Audit requests with a status and a note per request. New
   requests also land in the Enquiries list and, when TELEGRAM_ADMIN_CHAT_ID is set, the operators' chat. */

interface Job {
  id: string
  status: JobStatus
  title: string
  workspace: string
  createdAt: string
  free: boolean
  priceUsd: number
  payment: { status: string } | null
  startError: string | null
  published: boolean
}
interface Review {
  id: string
  tier: 'review' | 'audit'
  name: string
  email: string
  project: string
  company: string | null
  scope: string
  repo: string | null
  chain: string | null
  address: string | null
  timeline: string | null
  status: string
  note: string | null
  createdAt: string
  source: string
}
interface View {
  engine: { installed: boolean; ai: boolean; worker: boolean; workerReason: string | null; queue: { running: string | null; queued: number } | null }
  totals: { started: number; done: number; failed: number; published: number; jobs: number; awaitingPayment: number }
  days: { day: string; started: number; done: number; failed: number }[]
  queue: Job[]
  failures: Job[]
  reviews: Review[]
  reviewStatuses: string[]
}

const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'
const h2 = 'm-0 font-display text-[22px] font-bold uppercase'
const small = 'font-mono text-[12px] text-faint'
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—')

function Tile({ k, v, note, tone }: { k: string; v: number; note: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-1 bg-surface px-4 py-3">
      <span className="font-mono text-[11px] tracking-[1px] text-faint">{k}</span>
      <AnimatedNumber value={v} className="font-display text-[28px] leading-none font-bold" style={tone ? { color: tone } : undefined} />
      <span className="text-[12px] text-muted">{note}</span>
    </div>
  )
}

function JobRows({ jobs, empty }: { jobs: Job[]; empty: string }) {
  if (!jobs.length) return <p className="m-0 text-[13px] text-muted">{empty}</p>
  return (
    <ul className="m-0 flex list-none flex-col p-0 font-mono text-[12px]">
      {jobs.map((j) => (
        <li key={j.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line py-2 last:border-b-0">
          <span className={j.status === 'failed' ? 'text-error' : j.status === 'awaiting_payment' ? 'text-gold' : 'text-ink-2'}>{STATUS_LABEL[j.status] ?? j.status}</span>
          <span className="min-w-0 flex-1 truncate text-ink" title={j.title}>
            {j.title}
          </span>
          <span className="text-faint" title={j.workspace}>
            {short(j.workspace)}
          </span>
          <span className="text-faint">{j.free ? 'free' : `$${j.priceUsd}${j.payment ? ` · ${j.payment.status}` : ''}`}</span>
          <span className="text-faint">{when(j.createdAt)}</span>
          {j.startError && <span className="w-full text-error">{j.startError}</span>}
        </li>
      ))}
    </ul>
  )
}

export function SecurityCard({ token }: { token: string }) {
  const [data, setData] = useState<View | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const load = useCallback(() => {
    adminCall<View>(token, '/api/admin/security').then((r) => (r.ok ? (setData(r.data), setErr(null)) : setErr(r.error)))
  }, [token])
  useEffect(() => {
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])
  const update = async (id: string, body: { status?: string; note?: string }) => {
    const r = await adminCall(token, `/api/admin/security/reviews/${id}`, body)
    if (r.ok) {
      toastSuccess('Request updated')
      load()
    } else toastError(r.error)
  }
  const option = useMemo(() => {
    const days = data?.days ?? []
    const series = [
      { id: 'started', name: 'Started', color: C.gold, key: 'started' as const },
      { id: 'done', name: 'Finished', color: C.green, key: 'done' as const },
      { id: 'failed', name: 'Failed', color: C.error, key: 'failed' as const },
    ]
    return {
      grid: { left: 28, right: 8, top: 12, bottom: 22 },
      legend: { show: false },
      xAxis: { type: 'category', data: days.map((d) => d.day.slice(5)), axisLabel: { color: C.faint, fontSize: 11, interval: 6 }, axisTick: { show: false }, axisLine: { lineStyle: { color: C.line } } },
      yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.faint, fontSize: 11 } },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const d = days[ps[0]?.dataIndex ?? 0]
        return d ? tipHtml({ title: d.day, rows: series.map((s) => ({ name: s.name, value: String(d[s.key]), color: s.color })) }) : ''
      }, 'shadow'),
      series: series.map((s) => ({ id: s.id, name: s.name, ...barsPreset({ focus: 'series' }), barGap: '10%', itemStyle: { color: s.color, borderRadius: [2, 2, 0, 0] }, data: days.map((d) => d[s.key]) })),
    }
  }, [data])
  const fresh = data?.reviews.filter((r) => r.status === 'new').length ?? 0

  return (
    <section className={card} aria-labelledby="admin-security" data-testid="admin-security">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="admin-security" className={h2}>
          Security
        </h2>
        <span className={small}>{data ? `AI ${data.engine.ai ? 'on' : 'off (ANTHROPIC_API_KEY)'} · static tools ${data.engine.worker ? 'on' : 'off'} · engine queue ${data.engine.queue?.queued ?? 0}${data.engine.queue?.running ? ' + 1 running' : ''} · ${data.totals.jobs} scans asked for · ${data.totals.published} published` : 'Gully Security'}</span>
      </div>
      {data && !data.engine.worker && (
        <p className="m-0 rounded-input border border-gold-line px-3 py-2 text-[13px] text-ink-2" data-testid="worker-note">
          Scans are <b>AI review only</b> until the static-tools worker (gully-scanner, ops/scanner) runs. It is owner-run and not started (disk). Reports say so in their label and list the static tools as not run.
          {data.engine.workerReason ? <span className="ml-1 font-mono text-[11px] text-faint">({data.engine.workerReason})</span> : null}
        </p>
      )}
      {err && <p className="m-0 font-mono text-[12px] text-error">{err}</p>}
      {!data && !err && <span className={small}>Loading…</span>}
      {data && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-px overflow-hidden rounded-card border border-line bg-line">
            <Tile k="QUEUE" v={data.queue.length} note="running or waiting" tone={data.queue.length ? C.gold : undefined} />
            <Tile k="AWAITING PAYMENT" v={data.totals.awaitingPayment} note="invoiced, not paid" />
            <Tile k="FINISHED" v={data.totals.done} note={`of ${data.totals.started} started`} />
            <Tile k="FAILED" v={data.totals.failed} note="engine failures" tone={data.totals.failed ? C.error : undefined} />
            <Tile k="REVIEW REQUESTS" v={fresh} note={`new of ${data.reviews.length}`} tone={fresh ? C.gold : undefined} />
          </div>
          <div className="flex flex-col gap-2">
            <span className={small}>scans per day, last 30 days · started / finished / failed</span>
            {data.days.some((d) => d.started || d.done || d.failed) ? (
              <EChart option={option} height={150} label={`Scans per day over 30 days: ${data.totals.started} started, ${data.totals.done} finished, ${data.totals.failed} failed.`} steps={{ count: data.days.length }} />
            ) : (
              <GhostChart variant="bars" height={150} label="Scans per day draw here once a scan has run" colors={[C.gold, C.green]} />
            )}
          </div>
          <div className="grid grid-cols-2 gap-5 max-[1099px]:grid-cols-1">
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="m-0 text-[14px] font-semibold">Queue</h3>
              <JobRows jobs={data.queue} empty="Nothing running or waiting for payment." />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="m-0 text-[14px] font-semibold">Recent failures</h3>
              <JobRows jobs={data.failures} empty="No failed scans." />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="m-0 text-[14px] font-semibold">Review requests</h3>
            {!data.reviews.length ? (
              <p className="m-0 text-[13px] text-muted">No review or audit request yet. They come from the form on /security and from the app.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="review-inbox">
                {data.reviews.slice(0, 50).map((r) => (
                  <li key={r.id} className="flex flex-col gap-2 rounded-input border border-line px-3 py-3 text-[13px]">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className={`font-mono text-[11px] uppercase ${r.tier === 'audit' ? 'text-gold' : 'text-ink-2'}`}>{r.tier === 'audit' ? 'Audit' : 'Security Review'}</span>
                      <b className="text-ink">{r.project}</b>
                      <span className="text-muted">
                        {r.name}
                        {r.company ? `, ${r.company}` : ''} ·{' '}
                        <a href={`mailto:${r.email}`} className="text-gold underline-offset-4 hover:underline">
                          {r.email}
                        </a>
                      </span>
                      <span className={`${small} ml-auto`}>
                        {when(r.createdAt)} · {r.source}
                      </span>
                    </div>
                    <p className="m-0 whitespace-pre-wrap text-ink-2">{r.scope}</p>
                    {(r.repo || r.address || r.timeline) && (
                      <span className="font-mono text-[11px] text-faint">
                        {[r.repo, r.address && `${r.address}${r.chain ? ` on ${r.chain}` : ''}`, r.timeline].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-2 text-[12px] text-dim">
                        Status
                        <select value={r.status} onChange={(e) => update(r.id, { status: e.target.value })} className="h-9 rounded-input border border-line-strong bg-bg px-2 text-[13px] text-ink">
                          {data.reviewStatuses.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </label>
                      <input value={notes[r.id] ?? r.note ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} placeholder="Note (internal)" maxLength={2000} className="h-9 min-w-[160px] flex-1 rounded-input border border-line-strong bg-bg px-2 text-[13px] text-ink" />
                      <button type="button" onClick={() => update(r.id, { note: notes[r.id] ?? r.note ?? '' })} className="rounded-btn border border-line-strong px-3 py-[6px] text-[13px] text-ink-2 hover:border-gold hover:text-ink">
                        Save note
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  )
}
