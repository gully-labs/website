import { useMemo, useState } from 'react'
import { projects } from '../../content/projects'
import type { StatsState } from '../../hooks/useStats'
import { fmtDate, fmtUsd, type VenueOk } from '../../lib/stats'
import { VenueLogo } from '../logos/VenueLogo'
import { C } from './chartPresets'
import { segBtn, segGroup } from '../ui'
import { esc, type ChartEvent } from './chart-utils'
import { ChartBox } from './ChartSkeleton'
import { EChart } from './EChart'

/* Live charts of the venues Gully Labs built, from GET /api/stats (useStats): their figures side by
   side, and how long each has been measured. Nothing is typed in; a venue that publishes no figure
   is listed as "not tracked yet", never drawn as zero. */

type Metric = 'tvlUsd' | 'volumeAllUsd' | 'feesAllUsd'
const METRICS: { id: Metric; label: string }[] = [
  { id: 'tvlUsd', label: 'Value locked' },
  { id: 'volumeAllUsd', label: 'Volume, all-time' },
  { id: 'feesAllUsd', label: 'Fees, all-time' },
]
const ROW = 40
const okVenues = (st: StatsState): VenueOk[] => (st.k === 'ok' ? st.data.venues.filter((v): v is VenueOk => v.state === 'ok') : [])

/** Each venue's figure as a bar, switchable between value locked, volume and fees; bars glide on a switch. */
export function VenueBars({ st }: { st: StatsState }) {
  const [metric, setMetric] = useState<Metric>('tvlUsd')
  const ok = okVenues(st)
  const rows = projects
    .map((p) => ({ p, v: (ok.find((x) => x.key === p.key)?.[metric] ?? null) as number | null }))
    .sort((a, b) => (b.v ?? -1) - (a.v ?? -1))
  const drawn = rows.filter((r) => r.v !== null)
  const missing = rows.filter((r) => r.v === null)
  const key = `${metric}|${drawn.map((r) => `${r.p.key}=${r.v}`).join()}`
  const option = useMemo(
    () => ({
      grid: { left: 4, right: 70, top: 4, bottom: 4, containLabel: false },
      xAxis: { type: 'value', show: false, max: (m: { max: number }) => m.max * 1.08 || 1 },
      yAxis: { type: 'category', inverse: true, data: drawn.map((r) => r.p.key), axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false } },
      tooltip: {
        trigger: 'item',
        confine: true,
        formatter: (p: ChartEvent) => `<b>${esc(drawn[p.dataIndex]?.p.name ?? '')}</b><br/>${esc(METRICS.find((m) => m.id === metric)!.label)}: ${esc(fmtUsd(Number(p.value)))}`,
      },
      series: [
        {
          type: 'bar',
          barWidth: 18,
          showBackground: true,
          backgroundStyle: { color: C.line, borderRadius: 4 },
          label: { show: true, position: 'right', color: C.ink2, fontSize: 12, formatter: (p: ChartEvent) => (Number(p.value) > 0 && Number(p.value) < 1 ? '<$1' : fmtUsd(Number(p.value))) },
          data: drawn.map((r) => ({ value: r.v, itemStyle: { color: r.p.accent, borderRadius: 4 } })),
          animationDelay: (i: number) => i * 90,
        },
      ],
      animationDurationUpdate: 650,
      animationEasingUpdate: 'cubicInOut',
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  const height = Math.max(1, drawn.length) * ROW + 8
  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Figure" className={`${segGroup} flex-wrap`}>
        {METRICS.map((m) => (
          <button key={m.id} type="button" aria-pressed={metric === m.id} onClick={() => setMetric(m.id)} className={segBtn(metric === m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      {st.k !== 'ok' ? (
        <ChartBox height={projects.length * ROW} state={st.k} message="The venues could not be read just now. Try again in a minute." />
      ) : (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
          <ul className="m-0 flex list-none flex-col p-0 pt-1" aria-hidden>
            {drawn.map((r) => (
              <li key={r.p.key} className="flex items-center gap-2 text-[13px] text-ink-2" style={{ height: ROW }}>
                <VenueLogo venue={r.p.key} name={r.p.name} size={24} decorative />
                <span className="max-[459px]:hidden">{r.p.name}</span>
              </li>
            ))}
          </ul>
          {drawn.length ? (
            <EChart option={option} height={height} label={`${METRICS.find((m) => m.id === metric)!.label} by venue, live: ${drawn.map((r) => `${r.p.name} ${fmtUsd(r.v)}`).join(', ')}.`} steps={{ count: drawn.length }} />
          ) : (
            <p className="m-0 gl-skeleton font-mono text-[12px] text-faint">No venue publishes this figure yet.</p>
          )}
        </div>
      )}
      {missing.length > 0 && st.k === 'ok' && <p className="m-0 font-mono text-[11px] text-faint">Not tracked yet: {missing.map((r) => r.p.name).join(', ')} {missing.length === 1 ? 'does' : 'do'} not publish this figure.</p>}
    </div>
  )
}

/** How long each venue has been measured: a bar from the start of its all-time count to today. */
export function VenueTimeline({ st }: { st: StatsState }) {
  const ok = okVenues(st)
  const now = st.k === 'ok' ? Date.parse(st.data.generatedAt) : 0
  const rows = projects
    .map((p) => {
      const since = ok.find((x) => x.key === p.key)?.volumeAllSince
      return { p, t: since ? Date.parse(since) : null }
    })
    .sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity))
  const drawn = rows.filter((r): r is { p: (typeof projects)[number]; t: number } => r.t !== null && Number.isFinite(r.t))
  const missing = rows.filter((r) => r.t === null)
  const start = drawn.length ? Math.min(...drawn.map((r) => r.t)) : now
  const key = `${now}|${drawn.map((r) => `${r.p.key}=${r.t}`).join()}`
  const option = useMemo(
    () => ({
      grid: { left: 4, right: 12, top: 4, bottom: 24, containLabel: false },
      // Milliseconds since the earliest venue's start; labels add that start back as a date.
      xAxis: { type: 'value', min: 0, max: Math.max(1, now - start), splitNumber: 3, axisLabel: { color: C.faint, fontSize: 11, hideOverlap: true, formatter: (v: number) => new Date(start + v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' }) }, splitLine: { lineStyle: { color: C.grid } } },
      yAxis: { type: 'category', inverse: true, data: drawn.map((r) => r.p.key), axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false } },
      tooltip: {
        trigger: 'item',
        confine: true,
        formatter: (p: ChartEvent) => {
          const r = drawn[p.dataIndex]
          return r ? `<b>${esc(r.p.name)}</b><br/>measured since ${esc(fmtDate(new Date(r.t).toISOString()))}` : ''
        },
      },
      series: [
        { type: 'bar', stack: 't', silent: true, itemStyle: { color: 'transparent' }, data: drawn.map((r) => r.t - start), barWidth: 16, animation: false },
        { type: 'bar', stack: 't', barWidth: 16, data: drawn.map((r) => ({ value: now - r.t, itemStyle: { color: r.p.accent, borderRadius: 4 } })), animationDelay: (i: number) => i * 120 },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  if (st.k !== 'ok') return <ChartBox height={projects.length * ROW + 24} state={st.k} message="The venues could not be read just now." />
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
        <ul className="m-0 flex list-none flex-col p-0 pt-1" aria-hidden>
          {drawn.map((r) => (
            <li key={r.p.key} className="flex items-center gap-2 text-[13px] text-ink-2" style={{ height: ROW }}>
              <VenueLogo venue={r.p.key} name={r.p.name} size={24} decorative />
              <span className="max-[459px]:hidden">{r.p.name}</span>
            </li>
          ))}
        </ul>
        {drawn.length ? (
          // A value axis starting at the earliest venue: the transparent first bar offsets each venue's start.
          <EChart option={option} height={drawn.length * ROW + 32} label={`How long each venue has been measured: ${drawn.map((r) => `${r.p.name} since ${fmtDate(new Date(r.t).toISOString())}`).join(', ')}.`} steps={{ count: drawn.length, seriesIndex: 1 }} />
        ) : (
          <p className="m-0 gl-skeleton font-mono text-[12px] text-faint">Not tracked yet: no venue publishes when its count starts.</p>
        )}
      </div>
      {missing.length > 0 && <p className="m-0 font-mono text-[11px] text-faint">Not tracked yet: {missing.map((r) => r.p.name).join(', ')} {missing.length === 1 ? 'does' : 'do'} not publish when its count starts.</p>}
    </div>
  )
}
