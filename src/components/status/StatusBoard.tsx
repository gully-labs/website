import { Activity, Bot, Boxes, CircleCheck, CircleDollarSign, Network, ScanSearch, ShieldCheck, Sparkles, TriangleAlert, type LucideIcon } from 'lucide-react'
import { useMemo } from 'react'
import { AnimatedNumber } from '../charts/AnimatedNumber'
import { EChart } from '../charts/EChart'
import { axisTooltip, barsPreset, C, CHART_H, itemTooltip, linePreset, PALETTE, ringPreset, tipHtml } from '../charts/chartPresets'
import { OVERALL_WORDS, STATE_WORDS, STATUS_GROUPS, useStatus, type StatusBody, type StatusComponent, type StatusGroup, type StatusIncident, type StatusState } from '../../lib/status'

/* The live status board (GET /api/status): the overall state with a ring of component states, then every
   component by group with its state, plain-words detail, 24 h uptime and a bar per 30 minutes, the Gully Pay
   RPC latency over the day, and the incident history. Used by /status and (compact) by the docs' Status page. */

const STATE_COLOR: Record<StatusState, string> = { up: C.green, degraded: C.gold, down: C.error, off: C.faint, unknown: C.axis }
const GROUP_ICON: Record<StatusGroup, LucideIcon> = { platform: Activity, tracker: Network, deepcore: Boxes, telegram: Bot, payments: CircleDollarSign, ai: Sparkles, security: ShieldCheck, holders: ScanSearch }

const hhmm = (iso: string) => `${new Date(iso).toISOString().slice(11, 16)} UTC`
const pct = (v: number) => `${(Math.round(v * 10000) / 100).toFixed(2)}%`
const when = (iso: string) => new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
function duration(a: string, b: string | null) {
  const ms = (b ? Date.parse(b) : Date.now()) - Date.parse(a)
  if (ms < 90_000) return `${Math.max(1, Math.round(ms / 1000))} s`
  if (ms < 5_400_000) return `${Math.round(ms / 60_000)} min`
  return `${Math.round(ms / 360_000) / 10} h`
}
const bucketColor = (up: number | null) => (up === null ? C.lineStrong : up >= 0.99 ? C.green : up >= 0.5 ? C.gold : C.error)

export function StateDot({ state, size = 8 }: { state: StatusState; size?: number }) {
  const live = state === 'up'
  return <span aria-hidden className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: STATE_COLOR[state], animation: live ? 'gl-blink 1.6s ease-in-out infinite' : undefined }} />
}

/** One bar per 30 minutes over the last 24 h, coloured by the share of checks that were up. */
function UptimeBars({ c, height = 30 }: { c: StatusComponent; height?: number }) {
  const option = useMemo(
    () => ({
      grid: { left: 0, right: 0, top: 2, bottom: 2 },
      xAxis: { type: 'category', show: false, data: c.history.map((b) => b.t) },
      yAxis: { type: 'value', show: false, min: 0, max: 1 },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const b = c.history[ps[0]?.dataIndex ?? -1]
        if (!b) return ''
        return tipHtml({ title: `${c.name} · from ${hhmm(b.t)}`, rows: [{ name: 'uptime', value: b.up === null ? 'not checked' : pct(b.up), color: bucketColor(b.up) }, ...(b.ms !== null ? [{ name: 'mean latency', value: `${b.ms} ms` }] : [])] })
      }, 'shadow'),
      series: [{ id: 'up', ...barsPreset({ stagger: 8, radius: 2 }), barCategoryGap: '22%', data: c.history.map((b) => ({ value: 1, itemStyle: { color: bucketColor(b.up), opacity: b.up === null ? 0.5 : 1 } })) }],
    }),
    [c],
  )
  return <EChart option={option} height={height} label={`${c.name}: uptime per 30 minutes over the last 24 hours`} skeleton="bars" steps={{ count: c.history.length }} />
}

function ComponentRow({ c, compact }: { c: StatusComponent; compact: boolean }) {
  return (
    <li className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StateDot state={c.state} />
        <span className="min-w-0 flex-1 text-[15px] text-ink">{c.name}</span>
        <span className="font-mono text-[12px]" style={{ color: STATE_COLOR[c.state] }}>
          {STATE_WORDS[c.state]}
        </span>
        <span className="w-[86px] text-right font-mono text-[12px] text-ink-2 max-[480px]:w-auto">
          {c.uptime24h !== null ? <AnimatedNumber value={Math.round(c.uptime24h * 10000) / 100} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} suffix="%" /> : <span className="text-faint">no uptime</span>}
        </span>
      </div>
      {!compact && <p className="m-0 pl-5 text-[13px] leading-[1.5] text-muted">{c.detail}</p>}
      <div className="pl-5">
        <UptimeBars c={c} height={compact ? 22 : 30} />
      </div>
    </li>
  )
}

function Overall({ data }: { data: StatusBody }) {
  const counts = useMemo(() => {
    const m = new Map<StatusState, number>()
    for (const c of data.components) m.set(c.state, (m.get(c.state) ?? 0) + 1)
    return (['up', 'degraded', 'down', 'off', 'unknown'] as StatusState[]).filter((s) => m.get(s)).map((s) => ({ s, n: m.get(s) as number }))
  }, [data])
  const option = useMemo(
    () => ({
      tooltip: itemTooltip((p: { name: string; value: number; color: string }) => tipHtml({ title: 'components', rows: [{ name: p.name, value: String(p.value), color: p.color }] })),
      series: [{ id: 'states', ...ringPreset(), data: counts.map(({ s, n }) => ({ name: STATE_WORDS[s], value: n, itemStyle: { color: STATE_COLOR[s] } })) }],
    }),
    [counts],
  )
  const color = data.overall === 'operational' ? C.green : data.overall === 'degraded' ? C.gold : C.error
  const Icon = data.overall === 'operational' ? CircleCheck : TriangleAlert
  return (
    <div className="flex flex-wrap items-center gap-6 rounded-card border border-line bg-surface p-6 max-[600px]:p-4">
      <div className="size-[112px] shrink-0">
        <EChart option={option} height={112} label="Components by state right now" skeleton="ring" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="inline-flex items-center gap-2 font-display text-[32px] leading-none font-bold uppercase" style={{ color }} role="status">
          <Icon aria-hidden size={26} strokeWidth={2} /> {OVERALL_WORDS[data.overall]}
        </span>
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 font-mono text-[12px] text-ink-2">
          {counts.map(({ s, n }) => (
            <li key={s} className="inline-flex items-center gap-2">
              <StateDot state={s} /> {STATE_WORDS[s].toLowerCase()} <b className="font-medium text-ink">{n}</b>
            </li>
          ))}
        </ul>
        <span className="font-mono text-[11px] text-faint">
          Checked every {data.intervalSeconds} s by the server · last {data.components[0]?.checkedAt ? hhmm(data.components[0].checkedAt) : 'not yet'}
          {data.since ? ` · history since ${when(data.since)}` : ''}
        </span>
      </div>
    </div>
  )
}

/** Mean RPC latency per payment chain over the day, one line per chain. */
function PayLatency({ data }: { data: StatusBody }) {
  const pay = useMemo(() => data.components.filter((c) => c.group === 'payments' && c.id !== 'pay-feeproxy'), [data])
  const labels = useMemo(() => pay[0]?.history.map((b) => b.t) ?? [], [pay])
  const any = pay.some((c) => c.history.some((b) => b.ms !== null))
  const option = useMemo(
    () => ({
      grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
      legend: { top: 0, left: 0, textStyle: { color: C.muted }, type: 'scroll' },
      xAxis: { type: 'category', data: labels, axisLabel: { formatter: (v: string) => hhmm(v).slice(0, 5) }, axisTick: { show: false } },
      yAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${v} ms` }, splitLine: { lineStyle: { color: C.grid } } },
      tooltip: axisTooltip((ps: { dataIndex: number; seriesName: string; value: number | null; color: string }[]) => tipHtml({ title: labels[ps[0]?.dataIndex ?? -1] ? `from ${hhmm(labels[ps[0].dataIndex])}` : '', rows: ps.map((p) => ({ name: p.seriesName, value: p.value === null || p.value === undefined ? 'not checked' : `${p.value} ms`, color: p.color })) })),
      series: pay.map((c, i) => ({ id: c.id, name: c.name.replace('Gully Pay RPC: ', ''), ...linePreset({ color: PALETTE[i % PALETTE.length], width: 1.75 }), connectNulls: false, data: c.history.map((b) => b.ms) })),
    }),
    [pay, labels],
  )
  if (!pay.length) return null
  return (
    <div className="flex flex-col gap-2 rounded-panel border border-line bg-surface px-4 py-3">
      <span className="font-mono text-[11px] tracking-[1px] text-faint">GULLY PAY RPC LATENCY · 24 H · LIVE FROM /api/status</span>
      {any ? (
        <EChart option={option} height={CHART_H.md} label="Mean RPC latency per payment chain, every 30 minutes over the last 24 hours" skeleton="line" steps={{ count: labels.length }} />
      ) : (
        <div className="relative h-[120px] overflow-hidden rounded-input bg-surface-deep">
          <span className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(217,181,99,.12),transparent)]" style={{ animation: 'gl-scan 1.6s linear infinite' }} />
          <span className="absolute inset-0 grid place-items-center font-mono text-[12px] text-faint">collecting the first checks…</span>
        </div>
      )}
    </div>
  )
}

export function IncidentList({ incidents }: { incidents: StatusIncident[] }) {
  if (!incidents.length)
    return (
      <p className="m-0 flex items-center gap-2 rounded-panel border border-line bg-surface px-4 py-4 text-[14px] text-muted">
        <StateDot state="up" /> No incidents recorded in the history this server keeps.
      </p>
    )
  return (
    <ol className="m-0 flex list-none flex-col gap-2 p-0">
      {incidents.map((i) => (
        <li key={i.id} className="flex flex-col gap-1 rounded-panel border border-line bg-surface px-4 py-3">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StateDot state={i.endedAt ? 'up' : i.state} />
            <span className="text-[15px] text-ink">{i.name}</span>
            <span className="font-mono text-[12px]" style={{ color: i.endedAt ? C.green : STATE_COLOR[i.state] }}>
              {i.endedAt ? `Resolved after ${duration(i.startedAt, i.endedAt)}` : `${STATE_WORDS[i.state]} for ${duration(i.startedAt, null)}`}
            </span>
          </span>
          <span className="pl-5 font-mono text-[12px] text-faint">
            {when(i.startedAt)}
            {i.endedAt ? ` → ${when(i.endedAt)}` : ' → ongoing'}
          </span>
          <span className="pl-5 text-[13px] leading-[1.5] text-muted">{i.detail}</span>
        </li>
      ))}
    </ol>
  )
}

function Skeleton({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3" aria-busy={!error}>
      <div className="relative h-[140px] overflow-hidden rounded-card border border-line bg-surface">
        <span className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(217,181,99,.10),transparent)]" style={{ animation: 'gl-scan 1.6s linear infinite' }} />
        <span className="absolute inset-0 grid place-items-center px-4 text-center font-mono text-[12px] text-faint" role={error ? 'alert' : 'status'}>
          {error ?? 'Reading the live status…'}
        </span>
      </div>
      {error && (
        <button type="button" onClick={onRetry} className="inline-flex min-h-11 w-fit items-center rounded-btn border border-line-strong px-4 text-[14px] text-ink hover:border-gold">
          Try again
        </button>
      )}
    </div>
  )
}

/** The whole board. `compact` drops the detail lines, the latency chart and the incidents. */
export function StatusBoard({ compact = false }: { compact?: boolean }) {
  const { data, error, refresh } = useStatus(30_000)
  if (!data) return <Skeleton error={error} onRetry={refresh} />
  return (
    <div className="flex flex-col gap-6">
      <Overall data={data} />
      {error && <p className="m-0 font-mono text-[12px] text-error">{error} Showing the last answer.</p>}
      <div className={`grid gap-4 ${compact ? 'grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))]' : 'grid-cols-[repeat(auto-fit,minmax(min(100%,460px),1fr))]'}`}>
        {STATUS_GROUPS.map((g) => {
          const list = data.components.filter((c) => c.group === g.id)
          if (!list.length) return null
          const Icon = GROUP_ICON[g.id]
          return (
            <section key={g.id} aria-label={g.label} className="flex min-w-0 flex-col rounded-panel border border-line bg-surface-deep px-4 py-3">
              <h3 className="m-0 mb-1 inline-flex items-center gap-2 font-mono text-[12px] font-normal tracking-[1px] text-faint uppercase">
                <Icon aria-hidden size={14} strokeWidth={1.75} className="text-gold" /> {g.label}
              </h3>
              <ul className="m-0 list-none p-0">
                {list.map((c) => (
                  <ComponentRow key={c.id} c={c} compact={compact} />
                ))}
              </ul>
            </section>
          )
        })}
      </div>
      {!compact && <PayLatency data={data} />}
      {!compact && (
        <section aria-labelledby="status-incidents" className="flex flex-col gap-3">
          <h2 id="status-incidents" className="m-0 font-display text-h4 font-bold uppercase">
            Incident history
          </h2>
          <IncidentList incidents={data.incidents} />
        </section>
      )}
    </div>
  )
}

