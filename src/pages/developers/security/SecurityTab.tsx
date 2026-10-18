import { ArrowUpRight, BookOpen, FileText, Gauge, List, Plus, Radar, ScanSearch, ShieldCheck, Users } from 'lucide-react'
import { useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { axisTooltip, barsPreset, C, tipHtml } from '../../../components/charts/chartPresets'
import { EChart } from '../../../components/charts/EChart'
import { ReviewRequestForm } from '../../../components/security/ReviewRequestForm'
import { fmtWhen, isActive, KIND_LABEL, SEV_COLOR, SEV_LABEL, SEVERITIES, type ScanView, type SecurityOverview } from '../../../components/security/types'
import { DOCS_URL, isLocalHost, SITE_URL } from '../../../site-host'
import { Empty, ErrorLine, Skeleton } from '../parts'
import { Can } from '../RoleGate'
import { mono, panel, pillGold, pillSm } from '../styles'
import { Monitors } from './Monitors'
import { NewScan } from './NewScan'
import { usePlans } from '../../../lib/plans'
import { ScanDetail, StatusChip, TargetMark } from './ScanDetail'
import { subFromSection, useOverview, useScans, type SecuritySub } from './useSecurity'

/* The app's Security page (#security): Gully Security for the active workspace.
   Sub-tabs (a real tablist, arrow keys move between them): Scans (every scan with its live status and a
   chart of the workspace's scans per day), New scan (the stepper), Reports (finished scans, published or
   not), Request a review (a human Security Review or, later, an Audit). Opening a scan shows ScanDetail in
   place. Deep links: #security, #security-new, #security-reports, #security-review (Dashboard LEGACY). */

const SUBS: { id: SecuritySub; label: string; icon: ReactNode }[] = [
  { id: 'scans', label: 'Scans', icon: <List size={15} aria-hidden /> },
  { id: 'new', label: 'New scan', icon: <Plus size={15} aria-hidden /> },
  { id: 'reports', label: 'Reports', icon: <FileText size={15} aria-hidden /> },
  // Gully Security monitoring (part 3, Monitors.tsx; its API is /api/developer/monitors*).
  { id: 'monitors', label: 'Monitors', icon: <Radar size={15} aria-hidden /> },
  { id: 'review', label: 'Request a review', icon: <Users size={15} aria-hidden /> },
]
const site = (path: string) => (isLocalHost() ? path : `${SITE_URL}${path}`)


/** The workspace's scans per day (14 days), stacked by outcome; real counts from the list. */
function ScansPerDay({ scans }: { scans: ScanView[] }) {
  const [now] = useState(() => Date.now())
  const option = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, i) => new Date(now - (13 - i) * 86_400_000).toISOString().slice(0, 10))
    const by = (pred: (s: ScanView) => boolean) => days.map((d) => scans.filter((s) => s.createdAt.slice(0, 10) === d && pred(s)).length)
    const series = [
      { id: 'done', name: 'Done', color: C.green, data: by((s) => s.status === 'done') },
      { id: 'running', name: 'Running or waiting', color: C.gold, data: by((s) => isActive(s.status) || s.status === 'awaiting_payment') },
      { id: 'failed', name: 'Failed or cancelled', color: C.error, data: by((s) => s.status === 'failed' || s.status === 'cancelled' || s.status === 'unknown') },
    ]
    return {
      grid: { left: 24, right: 8, top: 8, bottom: 22 },
      xAxis: { type: 'category', data: days.map((d) => d.slice(5)), axisLabel: { color: C.faint, fontSize: 11, interval: 3 }, axisTick: { show: false }, axisLine: { lineStyle: { color: C.line } } },
      yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.faint, fontSize: 11 } },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const i = ps[0]?.dataIndex ?? 0
        return tipHtml({ title: days[i], rows: series.map((s) => ({ name: s.name, value: String(s.data[i]), color: s.color })) })
      }, 'shadow'),
      series: series.map((s) => ({ id: s.id, name: s.name, ...barsPreset({ focus: 'series' }), stack: 'all', barWidth: '55%', itemStyle: { color: s.color, borderRadius: 2 }, data: s.data })),
    }
  }, [scans, now])
  return <EChart option={option} height={120} label={`Scans per day in this workspace over 14 days: ${scans.length} in all.`} steps={{ count: 14 }} />
}

function MiniCounts({ s }: { s: ScanView }) {
  if (!s.counts) return <span className="font-mono text-[11px] text-faint">{s.status === 'done' ? 'no counts' : '—'}</span>
  const total = SEVERITIES.reduce((a, k) => a + (s.counts?.[k] ?? 0), 0)
  if (!total) return <span className="font-mono text-[11px] text-green">no findings</span>
  return (
    <span className="flex h-[8px] w-[120px] overflow-hidden rounded-full bg-line" title={SEVERITIES.map((k) => `${s.counts?.[k]} ${SEV_LABEL[k].toLowerCase()}`).join(', ')}>
      {SEVERITIES.map((k, i) => (s.counts?.[k] ? <span key={k} style={{ width: `${((s.counts?.[k] ?? 0) / total) * 100}%`, background: SEV_COLOR[k], transformOrigin: 'left', animation: `gl-grow-x .6s ${i * 0.06}s cubic-bezier(.2,.8,.2,1) both` }} /> : null))}
    </span>
  )
}

function ScanRows({ scans, open, empty }: { scans: ScanView[]; open: (id: string) => void; empty: ReactNode }) {
  if (!scans.length) return <>{empty}</>
  return (
    <ul className="m-0 flex list-none flex-col p-0" aria-label="Scans" data-testid="scan-list">
      {scans.map((s, i) => (
        <li key={s.id} className="border-b border-line last:border-b-0" style={{ animation: `gl-rise .35s ${Math.min(i, 10) * 0.03}s ease both` }}>
          <button type="button" onClick={() => open(s.id)} className="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-1 py-2 text-left hover:bg-surface-hover max-[700px]:grid-cols-[minmax(0,1fr)_auto]" data-scan-row={s.id}>
            <span className="flex min-w-0 items-center gap-2">
              <TargetMark scan={s} size={16} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-mono text-[13px] text-ink">{s.title}</span>
                <span className="font-mono text-[11px] text-faint">
                  {KIND_LABEL[s.input.kind]} · {fmtWhen(s.createdAt)}
                  {s.published ? ' · published' : ''}
                </span>
              </span>
            </span>
            <span className="max-[700px]:hidden">
              <MiniCounts s={s} />
            </span>
            <span className="font-mono text-[11px] text-faint max-[700px]:hidden">{s.free ? 'free' : `$${s.priceUsd}`}</span>
            <StatusChip s={s.status} />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Contracts each plan may monitor (server/plans.mjs PLANS[].monitors, via GET /api/plans), and the Gully Score. */
function MonitorLimits() {
  const [plans] = usePlans()
  const list = plans.k === 'ok' ? plans.offer.plans.filter((p) => typeof p.monitors === 'number') : []
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[14px] border border-line px-4 py-3 text-[13px] text-muted" data-testid="monitor-limits">
      <span className="font-mono text-[11px] tracking-[1px] text-faint">CONTRACTS WATCHED BY PLAN</span>
      {plans.k === 'loading' && <span className="text-faint">reading…</span>}
      {plans.k === 'error' && <span className="text-error">unreadable right now</span>}
      {list.map((p) => (
        <span key={p.id}>
          <b className="text-ink">{p.monitors}</b> on {p.name}
        </span>
      ))}
      <a href={site('/score')} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex min-h-11 items-center gap-2 text-gold underline-offset-4 hover:underline">
        <Gauge size={14} aria-hidden /> Gully Score <ArrowUpRight size={13} aria-hidden />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </div>
  )
}

function QuotaPill({ ov }: { ov: SecurityOverview }) {
  const q = ov.quota
  return (
    <span className="inline-flex min-h-[30px] items-center gap-2 rounded-full border border-line px-[10px] text-[13px] whitespace-nowrap" data-testid="quota">
      <span className="flex gap-[3px]" aria-hidden>
        {Array.from({ length: Math.min(q.freePerMonth, 10) }, (_, i) => (
          <i key={i} className={`size-[7px] rounded-full ${i < q.left ? 'bg-gold' : 'bg-line-strong'}`} style={{ transition: 'background .4s' }} />
        ))}
      </span>
      {q.left} of {q.freePerMonth} free scan{q.freePerMonth === 1 ? '' : 's'} left
    </span>
  )
}

export function SecurityTab({ section }: { section: string | null }) {
  const [sub, setSub] = useState<SecuritySub>(() => subFromSection(section))
  const [openId, setOpenId] = useState<string | null>(null)
  // Picking New scan again starts a fresh stepper.
  const [fresh, setFresh] = useState(0)
  const [ov, reloadOv] = useOverview()
  const [list, reloadList] = useScans()
  const pick = useCallback((t: SecuritySub) => {
    setSub(t)
    setOpenId(null)
    if (t === 'new') setFresh((n) => n + 1)
    // Free scans left and the price change as scans run: re-read them whenever a sub-tab opens.
    reloadOv()
    history.replaceState(null, '', `#${t === 'scans' ? 'security' : `security-${t}`}`)
  }, [reloadOv])
  const open = useCallback((id: string) => {
    setSub((s) => (s === 'reports' ? 'reports' : 'scans'))
    setOpenId(id)
    reloadOv()
  }, [reloadOv])
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const i = SUBS.findIndex((s) => s.id === sub)
    const next = SUBS[(i + (e.key === 'ArrowRight' ? 1 : -1) + SUBS.length) % SUBS.length]
    pick(next.id)
    document.getElementById(`sec-tab-${next.id}`)?.focus()
  }

  if (ov.k === 'loading')
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton h={96} />
        <Skeleton h={280} />
      </div>
    )
  if (ov.k === 'error') return <ErrorLine onRetry={reloadOv}>Gully Security could not be read: {ov.message}</ErrorLine>
  const o = ov.data
  const scans = list.k === 'ok' ? list.data.scans : []
  const done = scans.filter((s) => s.status === 'done')

  return (
    <div className="flex flex-col gap-4" data-testid="security-tab">
      <header className={`${panel} print:hidden`}>
        <div className="flex flex-wrap items-center gap-3">
          <ShieldCheck size={26} className="text-gold" aria-hidden />
          <div className="flex min-w-0 flex-[1_1_220px] flex-col">
            <span className="font-mono text-[11px] tracking-[1px] text-faint">GULLY SECURITY</span>
            <h1 className="m-0 text-[20px] font-semibold text-ink">{o.offer.scan.name}</h1>
          </div>
          <QuotaPill ov={o} />
          <span className={`inline-flex min-h-[30px] items-center gap-2 rounded-full border px-[10px] text-[13px] ${o.engine.worker ? 'border-success-line text-green' : o.engine.ai ? 'border-gold-line text-gold' : 'border-line-strong text-faint'}`} data-testid="engine-state" title={o.engine.worker ? `Static tools: ${o.engine.tools.join(', ')}` : 'The static-analysis worker is not running on this server yet'}>
            <span aria-hidden className={`size-2 rounded-full ${o.engine.worker || o.engine.ai ? 'animate-[gl-blink_1.6s_ease-in-out_infinite] motion-reduce:animate-none' : ''} ${o.engine.worker ? 'bg-green' : o.engine.ai ? 'bg-gold' : 'bg-faint'}`} />
            {o.engine.worker ? 'Static tools + AI review' : o.engine.ai ? 'AI review only' : 'Scanning unavailable'}
          </span>
          <a href={`${DOCS_URL}/gully-security`} target="_blank" rel="noopener noreferrer" className={pillSm}>
            <BookOpen size={14} aria-hidden /> Docs <ArrowUpRight size={13} aria-hidden />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
        <p className="m-0 text-[13px] leading-[1.55] text-muted">
          Automated scans of contracts and code: findings with locations, draft proofs of concept and the tools that ran. A scan is not an audit; for people reading your code, request a Security Review.{' '}
          <a href={site('/security')} target="_blank" rel="noopener noreferrer" className="text-gold underline-offset-4 hover:underline">
            What each tier covers<span className="sr-only"> (opens in a new tab)</span> ↗
          </a>
        </p>
        <div role="tablist" aria-label="Security sections" onKeyDown={onKey} className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
          {SUBS.map((s) => (
            <button key={s.id} id={`sec-tab-${s.id}`} type="button" role="tab" aria-selected={sub === s.id} aria-controls={`sec-panel-${s.id}`} tabIndex={sub === s.id ? 0 : -1} onClick={() => pick(s.id)} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 text-[13px] transition-colors ${sub === s.id ? 'bg-surface-hover text-ink' : 'text-dim hover:bg-surface-hover hover:text-ink'}`}>
              <span className={sub === s.id ? 'text-gold' : ''}>{s.icon}</span>
              {s.label}
              {s.id === 'scans' && scans.some((x) => isActive(x.status)) && <span aria-label="a scan is running" className="size-[6px] animate-[gl-blink_1.4s_ease-in-out_infinite] rounded-full bg-gold motion-reduce:animate-none" />}
            </button>
          ))}
        </div>
      </header>

      <div id={`sec-panel-${sub}`} role="tabpanel" aria-labelledby={`sec-tab-${sub}`} className="flex flex-col gap-4">
        {openId ? (
          <ScanDetail
            id={openId}
            canPublish={o.canPublish}
            backLabel={sub === 'reports' ? 'All reports' : 'All scans'}
            onBack={() => {
              setOpenId(null)
              reloadList()
            }}
          />
        ) : sub === 'scans' ? (
          <section className={panel} aria-label="Scans">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="m-0 text-[15px] font-semibold">Scans</h2>
              <span className={mono}>{list.k === 'ok' ? `${scans.length} in this workspace · live` : 'reading…'}</span>
            </div>
            {list.k === 'error' && <ErrorLine onRetry={reloadList}>The scans could not be read: {list.message}</ErrorLine>}
            {list.k === 'loading' ? (
              <Skeleton h={160} />
            ) : (
              <>
                {scans.length > 0 && <ScansPerDay scans={scans} />}
                <ScanRows
                  scans={scans.slice(0, 50)}
                  open={open}
                  empty={
                    <Empty
                      icon={<ScanSearch size={22} className="text-gold" aria-hidden />}
                      title="No scans yet"
                      action={
                        <Can cat="security" what="start scans">
                          <button type="button" onClick={() => pick('new')} className={pillGold}>
                            <Plus size={15} aria-hidden /> New scan
                          </button>
                        </Can>
                      }
                    >
                      Scan a deployed contract, a GitHub repository or an upload. {o.quota.left > 0 ? `You have ${o.quota.left} free this month.` : ''}
                    </Empty>
                  }
                />
              </>
            )}
          </section>
        ) : sub === 'new' ? (
          <NewScan key={fresh} ov={o} onOpen={open} />
        ) : sub === 'reports' ? (
          <section className={panel} aria-label="Reports">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="m-0 text-[15px] font-semibold">Reports</h2>
              <span className={mono}>
                {done.length} finished · {done.filter((s) => s.published).length} published
              </span>
            </div>
            <ScanRows scans={done} open={open} empty={<Empty icon={<FileText size={22} className="text-gold" aria-hidden />} title="No reports yet">A report appears here when a scan finishes. Owners and admins can publish one at a stable public link.</Empty>} />
          </section>
        ) : sub === 'monitors' ? (
          <>
            <MonitorLimits />
            <Monitors />
          </>
        ) : (
          <section className={panel} aria-label="Request a review">
            <h2 className="m-0 text-[15px] font-semibold">Request a Security Review</h2>
            <p className="m-0 text-[13px] leading-[1.55] text-muted">People on our team read your code and write up what they find, quoted per project. Tell us what to look at; we reply by email. Nothing is booked or charged here.</p>
            <ReviewRequestForm source="app" chains={o.chains} auditAvailable={o.offer.audit.available} />
          </section>
        )}
      </div>
    </div>
  )
}
