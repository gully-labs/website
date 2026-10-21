import { FileText, Gauge, List, Plus, Radar, RotateCcw, ScanSearch, ShieldCheck, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { axisTooltip, barsPreset, C, PALETTE, tipHtml } from '../../../components/charts/chartPresets'
import { GhostChart } from '../../../components/charts/GhostChart'
import { EChart } from '../../../components/charts/EChart'
import { ReviewRequestForm } from '../../../components/security/ReviewRequestForm'
import { fmtWhen, isActive, KIND_LABEL, SEV_COLOR, SEV_LABEL, SEVERITIES, type ScanView, type SecurityOverview, type Severity } from '../../../components/security/types'
import { DOCS_URL, isLocalHost, SITE_URL } from '../../../site-host'
import { Empty, ErrorLine, Skeleton } from '../parts'
import { Can } from '../RoleGate'
import { mono, panel, pillGold } from '../styles'
import { Monitors } from './Monitors'
import { NewScan } from './NewScan'
import { usePlans } from '../../../lib/plans'
import { ScanDetail, StatusChip, TargetMark } from './ScanDetail'
import { useSubTab } from '../subtab'
import { InfoTip, SubPanel, SubTabs } from '../ui'
import { subFromSection, useOverview, useScans, type SecuritySub } from './useSecurity'
import { ExtLink } from '../ExtLink'
import { ServiceHeader, type Status, type Tile } from '../services/ServiceHeader'

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
const SUB_IDS: readonly SecuritySub[] = SUBS.map((x) => x.id)
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
            <span className="font-mono text-[11px] text-faint max-[700px]:hidden">{s.credit?.usedForThis ? 'credit' : s.free ? 'free' : `$${s.priceUsd}`}</span>
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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line px-4 py-3 text-[13px] text-muted" data-testid="monitor-limits">
      <span className="font-mono text-[11px] tracking-[1px] text-faint">CONTRACTS WATCHED BY PLAN</span>
      {plans.k === 'loading' && <span className="text-faint">reading…</span>}
      {plans.k === 'error' && <span className="text-error">unreadable right now</span>}
      {list.map((p) => (
        <span key={p.id}>
          <b className="text-ink">{p.monitors}</b> on {p.name}
        </span>
      ))}
      <a href="#score" className="ml-auto inline-flex min-h-11 items-center gap-2 text-gold underline-offset-4 hover:underline">
        <Gauge size={14} aria-hidden /> Gully Score
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
      {(q.credits ?? 0) > 0 && (
        <span className="inline-flex items-center gap-1 text-gold">
          · <RotateCcw size={12} aria-hidden /> {q.credits} credit{q.credits === 1 ? '' : 's'}
        </span>
      )}
    </span>
  )
}

/** How the workspace paid for its scans, per month (6 months): free quota, re-run credit or paid. Real counts. */
function ScansPerMonth({ scans }: { scans: ScanView[] }) {
  const [now] = useState(() => new Date())
  const option = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1)).toISOString().slice(0, 7))
    // An unpaid scan that was cancelled cost nothing: it is not drawn.
    const counted = scans.filter((s) => s.status !== 'cancelled' || s.free || !!s.credit?.usedForThis || s.payment?.status === 'paid')
    const by = (pred: (s: ScanView) => boolean) => months.map((m) => counted.filter((s) => s.createdAt.slice(0, 7) === m && pred(s)).length)
    const series = [
      { id: 'free', name: 'Free quota', color: C.green, data: by((s) => s.free) },
      { id: 'credit', name: 'Re-run credit', color: C.gold, data: by((s) => !!s.credit?.usedForThis) },
      { id: 'paid', name: 'Paid', color: PALETTE[0], data: by((s) => !s.free && !s.credit?.usedForThis) },
    ]
    const label = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
    return {
      grid: { left: 24, right: 8, top: 8, bottom: 22 },
      xAxis: { type: 'category', data: months.map(label), axisLabel: { color: C.faint, fontSize: 11 }, axisTick: { show: false }, axisLine: { lineStyle: { color: C.line } } },
      yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.faint, fontSize: 11 } },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const i = ps[0]?.dataIndex ?? 0
        return tipHtml({ title: label(months[i]), rows: series.map((x) => ({ name: x.name, value: String(x.data[i]), color: x.color })) })
      }, 'shadow'),
      series: series.map((x) => ({ id: x.id, name: x.name, ...barsPreset({ focus: 'series' }), stack: 'all', barWidth: '45%', itemStyle: { color: x.color, borderRadius: 2 }, data: x.data })),
    }
  }, [scans, now])
  return <EChart option={option} height={110} label={`Scans per month by how they were paid, over 6 months: ${scans.length} scans in all.`} steps={{ count: 6 }} />
}

/** Free scans left this month, re-run credits and what the next scan costs (GET /api/developer/security quota). */
function Credits({ ov, scans }: { ov: SecurityOverview; scans: ScanView[] | null }) {
  const q = ov.quota
  const credits = q.credits ?? 0
  const next = q.left > 0 ? 'Free' : credits > 0 ? 'Credit' : `$${ov.offer.scan.priceUsd}`
  const resets = new Date(q.resetsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const stat = 'flex min-w-0 flex-col gap-1 rounded-input border border-line px-3 py-2'
  return (
    <section className={panel} aria-label="Scan credits" data-testid="scan-credits">
      <div className="grid grid-cols-4 gap-2 max-[800px]:grid-cols-2">
        <div className={stat}>
          <span className="font-mono text-[11px] tracking-[1px] text-faint">FREE THIS MONTH</span>
          <span className="flex items-baseline gap-2">
            <b className="font-display text-[24px] leading-none text-ink" data-testid="credits-free">
              {q.left}
            </b>
            <span className="text-[12px] text-muted">of {q.freePerMonth}</span>
          </span>
          <span className="flex gap-[3px]" aria-hidden>
            {Array.from({ length: Math.min(q.freePerMonth, 10) }, (_, i) => (
              <i key={i} className={`h-[5px] flex-1 origin-left rounded-full ${i < q.left ? 'bg-green' : 'bg-line-strong'}`} style={{ animation: `gl-grow-x .5s ${i * 0.06}s cubic-bezier(.2,.8,.2,1) both` }} />
            ))}
          </span>
        </div>
        <div className={stat}>
          <span className="font-mono text-[11px] tracking-[1px] text-faint">RE-RUN CREDITS</span>
          <b className={`font-display text-[24px] leading-none ${credits ? 'text-gold' : 'text-ink'}`} data-testid="credits-rerun">
            {credits}
          </b>
          <span className="text-[12px] text-muted">{credits ? 'used before any price' : 'a failed paid scan earns one'}</span>
        </div>
        <div className={stat}>
          <span className="font-mono text-[11px] tracking-[1px] text-faint">NEXT SCAN</span>
          <b className="font-display text-[24px] leading-none text-ink" data-testid="credits-next">
            {next}
          </b>
          <span className="text-[12px] text-muted">{q.plan.name} plan</span>
        </div>
        <div className={stat}>
          <span className="font-mono text-[11px] tracking-[1px] text-faint">RESETS</span>
          <b className="font-display text-[24px] leading-none text-ink">{resets}</b>
          <span className="text-[12px] text-muted">{q.used} used this month</span>
        </div>
      </div>
      {scans === null ? <Skeleton h={110} /> : scans.length ? <ScansPerMonth scans={scans} /> : <GhostChart variant="bars" height={110} label="How you paid for scans will draw here, per month" />}
      <span className="text-[12px] text-faint">
        Scans are not refunded: a paid scan that fails gives a re-run credit instead.{' '}
        <ExtLink href={site('/legal/scan-terms#s5')} arrow={false} className="inline-flex min-h-11 items-center text-gold underline-offset-4 hover:underline">
          Scan terms
        </ExtLink>
      </span>
    </section>
  )
}

export function SecurityTab({ section }: { section: string | null }) {
  // The app's shared sub-tabs (sticky, icons, #security/<sub> deep links, the last one remembered); the old
  // #security-new / -reports / -monitors / -review hashes (Dashboard LEGACY) still open theirs.
  const [sub, setSubTab] = useSubTab<SecuritySub>('security', SUB_IDS, subFromSection(section))
  const setSub = setSubTab as (f: SecuritySub | ((s: SecuritySub) => SecuritySub)) => void
  useEffect(() => {
    if (section) setSubTab(subFromSection(section))
  }, [section, setSubTab])
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
  }, [reloadOv, setSub])
  const open = useCallback((id: string) => {
    setSubTab(sub === 'reports' ? 'reports' : 'scans')
    setOpenId(id)
    reloadOv()
  }, [reloadOv, setSubTab, sub])

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
  // The engine's state as the shared header's status pill; the tooltip names the static tools.
  const engine: Status = o.engine.worker ? { tone: 'live', text: 'Static tools + AI review' } : o.engine.ai ? { tone: 'idle', text: 'AI review only' } : { tone: 'down', text: 'Scanning unavailable' }
  const known = list.k === 'ok'
  const sum = (keys: readonly Severity[]) => done.reduce((n, s) => n + keys.reduce((m, k) => m + (s.counts?.[k] ?? 0), 0), 0)
  const tiles: Tile[] = [
    { label: 'SCANS', value: known ? scans.length : null, unknown: 'reading…', note: known ? `${scans.filter((s) => isActive(s.status)).length} running` : undefined },
    { label: 'REPORTS', value: known ? done.length : null, unknown: 'reading…', note: known ? `${done.filter((s) => s.published).length} published` : undefined },
    { label: 'FINDINGS', value: known ? sum(SEVERITIES) : null, unknown: 'reading…', note: 'across finished scans' },
    { label: 'CRITICAL + HIGH', value: known ? sum(['critical', 'high']) : null, unknown: 'reading…', tone: known && sum(['critical', 'high']) > 0 ? C.error : undefined, note: 'worth a look first' },
  ]

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-2" data-testid="security-tab">
      <div className="print:hidden">
        <ServiceHeader
          icon={ShieldCheck}
          eyebrow="GULLY SECURITY"
          title={o.offer.scan.name}
          status={engine}
          docs={`${DOCS_URL}/gully-security`}
          page={{ href: site('/security') }}
          tiles={sub === 'new' || sub === 'review' ? undefined : tiles}
        >
          <QuotaPill ov={o} />
        </ServiceHeader>
        <InfoTip summary="Automated scans of contracts and code. A scan is not an audit." className="mt-2">
          Automated scans of contracts and code: findings with locations, draft proofs of concept and the tools that ran. A scan is not an audit; for people reading your code, request a Security Review.{' '}
          <ExtLink href={site('/security')} arrow={false} className="text-gold underline-offset-4 hover:underline">
            What each tier covers ↗
          </ExtLink>
        </InfoTip>
      </div>
      <SubTabs
        label="Security sections"
        idBase="sec"
        value={sub}
        onChange={pick}
        items={SUBS.map((x) => ({ ...x, dot: x.id === 'scans' && scans.some((y) => isActive(y.status)) }))}
      />

      <SubPanel idBase="sec" value={sub}>
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
          <>
          <Credits ov={o} scans={list.k === 'ok' ? scans : null} />
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
                {scans.length > 0 ? <ScansPerDay scans={scans} /> : <GhostChart variant="bars" height={120} label="Your scans will draw here, per day" />}
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
          </>
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
      </SubPanel>
    </div>
  )
}
