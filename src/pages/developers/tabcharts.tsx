import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { areaPreset, axisTooltip, C, linePreset, tipHtml } from '../../components/charts/chartPresets'
import { EChart } from '../../components/charts/EChart'
import { api, type Account, type AnalyticsAccount, type AnalyticsSeries, type GapAlert, type Payment, type Usage } from './api'
import { GhostCurves } from './charts'
import { useAlertsView } from './helpers'
import { ErrorLine, Skeleton } from './parts'
import { BLUE, chip, LIMITED_COLOR, mono, panel, panelTitle, rise } from './styles'
import { AlertTimeline, LiveMarker, QuotaRing, StackedDays, type DayStack } from './vcharts'

/* One compact, live, animated chart for each workspace tab (Keys, Alerts, Analytics, Billing), on the
   shared ECharts kit. Every figure is the server's own for THIS workspace; a tab with nothing counted yet
   shows the ghosted "will draw here" curves (charts.tsx), never a flat zero line or an empty box.
     KeysTraffic       GET /api/developer/usage?range=7d (the Keys tab's own read): ok, errors and 429s a day
     AlertFires        each alert's delivery log: deliveries a day over 30 days, then the per-alert timeline
     AnalyticsTraffic  GET /api/developer/analytics/series?range=7d|30d: page views and visitors a day
     PlanUsage         keys and alerts in use against the plan, and what the workspace has paid in USD */

const fmt = (n: number) => n.toLocaleString('en-US')
const OK = '#74c27b'
const ERR = '#f2704a'

/** The last `n` local days as empty stacks, oldest first, with a lookup by day. */
function emptyDays(n: number) {
  const days: DayStack[] = []
  const index = new Map<string, DayStack>()
  const today = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    const row = { label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), values: {} as Record<string, number> }
    index.set(d.toDateString(), row)
    days.push(row)
  }
  const add = (at: string | number, kind: string, by = 1) => {
    const row = index.get(new Date(at).toDateString())
    if (row) row.values[kind] = (row.values[kind] ?? 0) + by
  }
  return { days, add }
}

/** The legend under a stacked chart: a swatch and a name per kind, with the kind's total. */
function Legend({ kinds }: { kinds: { id: string; name: string; color: string; total?: number }[] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 font-mono text-[11px] text-muted" aria-label="Legend">
      {kinds.map((k) => (
        <li key={k.id} className="flex items-center gap-[6px]">
          <span className="size-[9px] rounded-[2px]" style={{ background: k.color }} aria-hidden />
          {k.name}
          {typeof k.total === 'number' && <span className="text-faint">{fmt(k.total)}</span>}
        </li>
      ))}
    </ul>
  )
}

/* ----------------------------------------------------------------- Keys --- */

type Week = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; usage: Usage }

/** Requests a day over the last 7 days, stacked by answer: ok, errors (4xx and 5xx), rate-limited (429). */
export function KeysTraffic({ week, hasKeys }: { week: Week; hasKeys: boolean }) {
  const built = useMemo(() => {
    if (week.state !== 'ok') return null
    const { days, add } = emptyDays(7)
    let total = 0
    for (const p of week.usage.points) {
      const limited = p.limited ?? 0
      add(p.t, 'ok', p.total - p.errors)
      add(p.t, 'err', Math.max(0, p.errors - limited))
      add(p.t, 'lim', limited)
      total += p.total
    }
    const sum = (k: string) => days.reduce((a, d) => a + (d.values[k] ?? 0), 0)
    return { days, total, kinds: [{ id: 'ok', name: 'ok', color: OK, total: sum('ok') }, { id: 'err', name: 'errors (4xx, 5xx)', color: ERR, total: sum('err') }, { id: 'lim', name: 'rate-limited (429)', color: LIMITED_COLOR, total: sum('lim') }] }
  }, [week])
  return (
    <div className="flex flex-col gap-2" data-testid="keys-traffic">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink">Requests · 7 days</span>
        <span className={mono}>{built ? `${fmt(built.total)} with your keys · per day, by answer` : 'with your keys · per day, by answer'}</span>
      </div>
      {week.state === 'loading' ? (
        <Skeleton h={110} />
      ) : week.state === 'error' ? (
        <LiveMarker text={`Usage could not be read right now: ${week.message}`} height={110} />
      ) : !built || !built.total ? (
        <GhostCurves height={120} title="Your traffic will draw here">
          <span className="max-w-[460px] text-[13px] text-muted">{hasKeys ? 'No calls with your keys in the last 7 days. Each call charts here by day: ok, errors and rate-limited answers.' : 'Create a key and its calls chart here by day: ok, errors and rate-limited answers.'}</span>
        </GhostCurves>
      ) : (
        <>
          <StackedDays days={built.days} kinds={built.kinds} height={110} label={`Requests per day over 7 days: ${fmt(built.total)} in all, ${fmt(built.kinds[0].total)} ok, ${fmt(built.kinds[1].total)} errors, ${fmt(built.kinds[2].total)} rate-limited.`} />
          <Legend kinds={built.kinds} />
        </>
      )}
    </div>
  )
}

/* --------------------------------------------------------------- Alerts --- */

const FIRE_KINDS = [
  { id: 'ok', name: 'delivered', color: OK },
  { id: 'fail', name: 'failed', color: LIMITED_COLOR },
  { id: 'test', name: 'test', color: C.dim },
]

/** Deliveries a day over the last 30 days (all alerts), then each alert's own timeline. */
export function AlertFires({ alerts, nameOf }: { alerts: GapAlert[]; nameOf: (a: GapAlert) => string }) {
  const built = useMemo(() => {
    const { days, add } = emptyDays(30)
    let n = 0
    const seen = new Set<string>()
    for (const a of alerts)
      for (const d of a.deliveries) {
        if (seen.has(d.id)) continue
        seen.add(d.id)
        add(d.at, d.test ? 'test' : d.ok ? 'ok' : 'fail')
        n++
      }
    const sum = (k: string) => days.reduce((a, d) => a + (d.values[k] ?? 0), 0)
    return { days, n, kinds: FIRE_KINDS.map((k) => ({ ...k, total: sum(k.id) })) }
  }, [alerts])
  if (!alerts.some((a) => a.deliveries.length))
    return (
      <GhostCurves height={170} title="Alert firings will draw here" colors={[BLUE, OK]}>
        <span className="max-w-[460px] text-[13px] text-muted">When an alert fires, every delivery lands here by day and then by alert: green delivered, red failed, hollow test.</span>
      </GhostCurves>
    )
  return (
    <div className="flex flex-col gap-3" data-testid="alert-fires">
      <StackedDays days={built.days} kinds={built.kinds} height={120} label={`Deliveries per day over 30 days: ${fmt(built.n)} in all, ${fmt(built.kinds[0].total)} delivered, ${fmt(built.kinds[1].total)} failed, ${fmt(built.kinds[2].total)} tests.`} />
      <Legend kinds={built.kinds} />
      <AlertTimeline alerts={alerts} nameOf={nameOf} />
    </div>
  )
}

/* ------------------------------------------------------------ Analytics --- */

type SeriesRange = '7d' | '30d'
type SeriesLoad = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; data: AnalyticsSeries }

function RangeToggle({ value, onChange }: { value: SeriesRange; onChange: (r: SeriesRange) => void }) {
  const opts: SeriesRange[] = ['7d', '30d']
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = opts[(opts.indexOf(value) + 1) % opts.length]
    onChange(next)
    ;(e.currentTarget.querySelector(`[data-v="${next}"]`) as HTMLElement | null)?.focus()
  }
  return (
    <div role="radiogroup" aria-label="Range" onKeyDown={onKey} className="flex gap-[2px] rounded-full border border-line p-[3px]">
      {opts.map((o) => (
        <button key={o} data-v={o} type="button" role="radio" aria-checked={value === o} tabIndex={value === o ? 0 : -1} onClick={() => onChange(o)} className={`${chip(value === o, true)} min-h-[30px] border-0 px-3 text-[11px] max-[600px]:min-h-11`}>
          {o}
        </button>
      ))}
    </div>
  )
}

/** Page views and visitors a day for the account's websites, from Gully Analytics, with a 7d / 30d toggle. */
export function AnalyticsTraffic({ account }: { account: AnalyticsAccount }) {
  const [range, setRange] = useState<SeriesRange>('7d')
  const [s, setS] = useState<SeriesLoad>({ state: 'loading' })
  const siteKey = account.sites.map((x) => x.id).join()
  useEffect(() => {
    if (!siteKey) return
    let alive = true
    api<AnalyticsSeries>(`/api/developer/analytics/series?range=${range}`).then((r) => alive && setS(r.ok ? { state: 'ok', data: r.data } : { state: 'error', message: r.error }))
    return () => {
      alive = false
    }
  }, [siteKey, range])

  const data = s.state === 'ok' ? s.data : null
  const stale = !!data && data.range !== range
  const readable = data ? data.sites.some((x) => x.ok) : false
  const pv = data ? data.days.reduce((a, d) => a + d.pageviews, 0) : null
  const vis = data ? data.days.reduce((a, d) => a + d.visitors, 0) : null
  const option = useMemo(() => {
    if (!data) return null
    const labels = data.days.map((d) => new Date(d.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }))
    return {
      grid: { left: 40, right: 10, top: 12, bottom: 24 },
      xAxis: { type: 'category', boundaryGap: false, data: labels, axisLabel: { hideOverlap: true } },
      yAxis: { type: 'value', minInterval: 1, splitNumber: 3 },
      tooltip: axisTooltip((ps: { dataIndex: number; seriesName: string; value: number; color: string }[]) => {
        const i = ps[0]?.dataIndex ?? -1
        return i < 0 ? '' : tipHtml({ title: `${labels[i]} (UTC)`, rows: ps.map((p) => ({ name: p.seriesName, value: fmt(p.value), color: p.color })) })
      }, 'cross'),
      series: [
        { id: 'pv', name: 'page views', ...areaPreset({ color: C.gold, fill: 0.28 }), data: data.days.map((d) => d.pageviews) },
        { id: 'vis', name: 'visitors', ...linePreset({ color: BLUE }), data: data.days.map((d) => d.visitors) },
      ],
    }
  }, [data])

  return (
    <section className={panel} style={rise(1)} aria-labelledby="ga-traffic" data-testid="analytics-traffic">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex flex-col gap-[2px]">
          <h2 id="ga-traffic" className={panelTitle}>
            Traffic
          </h2>
          <span className={mono}>page views and visitors a day, all your websites · from Gully Analytics · UTC days</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {pv !== null && readable && (
            <span className="flex items-baseline gap-3 font-mono text-[11px] text-faint">
              <span>
                <AnimatedNumber value={pv} className="font-display text-[20px] leading-none font-bold text-gold" countUp /> views
              </span>
              <span>
                <AnimatedNumber value={vis} className="font-display text-[20px] leading-none font-bold" style={{ color: BLUE }} countUp /> visitors
              </span>
            </span>
          )}
          <RangeToggle value={range} onChange={setRange} />
        </div>
      </div>
      {!account.sites.length ? (
        <GhostCurves height={150} title="Your page views and visitors will draw here">
          <span className="max-w-[460px] text-[13px] text-muted">Add a website below. Once it records, each day charts here, read live from Gully Analytics.</span>
        </GhostCurves>
      ) : s.state === 'loading' ? (
        <Skeleton h={160} />
      ) : s.state === 'error' ? (
        <ErrorLine>Traffic could not be read: {s.message}</ErrorLine>
      ) : !readable ? (
        <LiveMarker text={`Gully Analytics did not answer for your website${account.sites.length === 1 ? '' : 's'}: ${data?.sites.find((x) => !x.ok)?.error ?? 'unreadable'}`} height={160} />
      ) : !pv && !vis ? (
        <GhostCurves height={150} title="Your page views and visitors will draw here">
          <span className="max-w-[460px] text-[13px] text-muted">Nothing recorded in the last {range === '7d' ? '7' : '30'} days. Put the script tag on your site and each day charts here within the hour.</span>
        </GhostCurves>
      ) : (
        <div className={`flex flex-col gap-2 transition-opacity ${stale ? 'opacity-60' : ''}`} aria-busy={stale}>
          <EChart option={option!} height={160} skeleton="line" label={`Page views and visitors per day over the last ${range === '7d' ? '7' : '30'} days: ${fmt(pv ?? 0)} views, ${fmt(vis ?? 0)} visitors.`} />
          <Legend kinds={[{ id: 'pv', name: 'page views', color: C.gold, total: pv ?? undefined }, { id: 'vis', name: 'visitors', color: BLUE, total: vis ?? undefined }]} />
        </div>
      )}
    </section>
  )
}

/* -------------------------------------------------------------- Billing --- */

/** What the plan is used for right now (keys and alerts against their limits) and what was paid, in USD. */
export function PlanUsage({ account, payments }: { account: Account; payments: Payment[] }) {
  const alerts = useAlertsView()
  const liveKeys = account.keys.filter((k) => !k.revokedAt).length
  const alertMax = alerts.view?.limits.max ?? account.plan.alerts
  const alertUsed = alerts.view?.limits.used ?? null
  // Only payments with a recorded USD value count; an unknown one is never a $0 (the total says "partial").
  const values = payments.map((p) => (p.usd === null || p.usd === undefined || p.usd === '' ? NaN : Number(p.usd)))
  const known = values.filter((v) => Number.isFinite(v))
  const spent = known.reduce((a, v) => a + v, 0)
  const partial = known.length < payments.length
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-2 border-t border-line pt-2" data-testid="plan-usage">
      <div className="flex items-center gap-3">
        <QuotaRing size={76} quota={account.limits.maxKeys} caption="keys" slices={[{ name: 'live keys', value: liveKeys, color: C.gold }]} />
        <span className="flex flex-col gap-[2px]">
          <span className="font-mono text-[11px] tracking-[1px] text-faint">KEYS</span>
          <span className="font-display text-[22px] leading-none font-bold">
            {liveKeys ? <AnimatedNumber value={liveKeys} countUp /> : <span className="font-mono text-[13px] font-normal text-faint">none yet</span>} <span className="font-mono text-[11px] font-normal text-faint">of {account.limits.maxKeys}</span>
          </span>
        </span>
      </div>
      <div className="flex items-center gap-3">
        <QuotaRing size={76} quota={alertMax} caption="alerts" slices={[{ name: 'alerts', value: alertUsed ?? 0, color: BLUE }]} />
        <span className="flex flex-col gap-[2px]">
          <span className="font-mono text-[11px] tracking-[1px] text-faint">ALERTS</span>
          <span className="font-display text-[22px] leading-none font-bold">
            {alertUsed === null ? alerts.err ? <span className="text-faint" title="not available right now" aria-label="not available right now" data-unknown>—</span> : <span className="font-mono text-[13px] font-normal text-faint">…</span> : alertUsed ? <AnimatedNumber value={alertUsed} countUp /> : <span className="font-mono text-[13px] font-normal text-faint">none yet</span>}{' '}
            <span className="font-mono text-[11px] font-normal text-faint">of {alertMax}</span>
          </span>
        </span>
      </div>
      <div className="flex flex-col justify-center gap-[2px]">
        <span className="font-mono text-[11px] tracking-[1px] text-faint">PAID · ALL TIME</span>
        <span className="font-display text-[22px] leading-none font-bold">
          {known.length ? <AnimatedNumber value={spent} prefix="$" format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} countUp /> : payments.length ? <span className="text-faint" title="not available right now" aria-label="not available right now" data-unknown>—</span> : <span className="font-mono text-[13px] font-normal text-faint">nothing yet</span>}
        </span>
        <span className="font-mono text-[11px] text-faint">{payments.length ? `${payments.length} payment${payments.length === 1 ? '' : 's'}, in USD at the time${partial ? ` · partial: ${payments.length - known.length} without a USD value` : ''}` : 'Free costs nothing'}</span>
      </div>
    </div>
  )
}
