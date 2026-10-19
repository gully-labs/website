import { useMemo } from 'react'
import { EChart } from '../../components/charts/EChart'
import type { ChartEvent } from '../../components/charts/chart-utils'
import { axisTooltip, barsPreset, C, linePreset, tipHtml } from '../../components/charts/chartPresets'
import { GhostChart } from '../../components/charts/GhostChart'
import { dayLabel, fmtInt, fmtUsd, GHOST_H } from './chartFmt'
import type { DaySeries } from '../../components/charts/DayBars'

/* Admin's one daily chart: stacked bars (and optional lines) on ECharts, so it is live (glides to new
   data, grows in) and shares one tooltip, with "not tracked yet" for null days. Under 2 real days it is
   a GhostChart collapsed to 90 px instead of a blank axis box (design audit N3/N32). */

type Num = number | null


export interface Line {
  name: string
  data: Num[]
  color: string
  kind?: 'bar' | 'line'
  /** Line on a second (right) axis, e.g. a rate or dollars next to counts. */
  right?: boolean
}

/** Daily stacked bars (and optional lines) sharing one tooltip, with "not tracked yet" for null days. */
export function Daily({ days, lines, height = 200, fmt = fmtInt, fmtRight, label, empty }: { days: string[]; lines: Line[]; height?: number; fmt?: (n: number) => string; fmtRight?: (n: number) => string; label: string; empty?: string }) {
  /* Real points: days where some series has a value above zero. Under 2 there is no shape to draw. */
  const points = days.filter((_, i) => lines.some((l) => (l.data[i] ?? 0) > 0)).length
  const hasRight = lines.some((l) => l.right)
  const key = JSON.stringify([days, lines.map((l) => [l.name, l.data, l.kind, l.right])])
  const option = useMemo(
    () => ({
      grid: { left: 4, right: hasRight ? 8 : 4, top: 14, bottom: 4, containLabel: true },
      legend: lines.length > 1 ? { show: false } : undefined,
      xAxis: { type: 'category', data: days.map(dayLabel), axisTick: { show: false }, axisLine: { lineStyle: { color: C.lineStrong } }, axisLabel: { color: C.axis, fontSize: 11, hideOverlap: true } },
      yAxis: [
        { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: C.grid } }, axisLabel: { color: C.axis, fontSize: 11, formatter: (v: number) => (fmt === fmtUsd ? `$${v}` : String(v)) } },
        ...(hasRight ? [{ type: 'value', splitLine: { show: false }, axisLabel: { color: C.axis, fontSize: 11, formatter: (v: number) => (fmtRight ? fmtRight(v) : String(v)) } }] : []),
      ],
      tooltip: axisTooltip((ps: ChartEvent[]) => {
        const i = ps[0]?.dataIndex ?? -1
        if (i < 0) return ''
        return tipHtml({
          title: dayLabel(days[i]),
          rows: lines.map((l) => {
            const v = l.data[i]
            return { name: l.name, value: v === null || v === undefined ? 'not tracked yet' : l.right && fmtRight ? fmtRight(v) : fmt(v), color: l.color }
          }),
        })
      }, 'shadow'),
      series: lines.map((l, j) =>
        l.kind === 'line'
          ? { id: `s${j}`, name: l.name, ...linePreset({ color: l.color, width: 2 }), showSymbol: true, symbolSize: 5, connectNulls: false, yAxisIndex: l.right ? 1 : 0, data: l.data }
          : { id: `s${j}`, name: l.name, ...barsPreset({ stagger: 18, focus: 'series' }), stack: 'all', barMaxWidth: 22, itemStyle: { color: l.color, borderRadius: j === lines.filter((x) => x.kind !== 'line').length - 1 ? [3, 3, 0, 0] : 0 }, data: l.data },
      ),
    }),
    // `key` holds the days and every series' values
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  if (points < 2) return <GhostChart label={empty ?? 'This chart will draw here'} height={GHOST_H} variant={lines.some((l) => l.kind !== 'line') ? 'bars' : 'line'} testId="admin-ghost" />
  return (
    <>
      <EChart option={option} height={height} steps={{ count: days.length }} label={`${label}. Arrow keys step through the days.`} />
      {lines.length > 1 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {lines.map((l) => (
            <span key={l.name} className="inline-flex items-center gap-2 font-mono text-[11px] text-muted">
              <i className={`inline-block ${l.kind === 'line' ? 'h-[2px] w-3' : 'size-[9px] rounded-[2px]'}`} style={{ background: l.color }} />
              {l.name}
            </span>
          ))}
        </div>
      )}
    </>
  )
}


/** Daily stacked bars from `{ day, ...counts }` rows (the shape the server's usage days come in), live. */
export function LiveDayBars({ days, series, height = 160, unit, empty }: { days: ({ day: string } & Record<string, number | string>)[]; series: DaySeries[]; height?: number; unit: string; empty?: string }) {
  return (
    <Daily
      days={days.map((d) => d.day)}
      lines={series.map((s) => ({ name: s.label, color: s.color, data: days.map((d) => Number(d[s.key] ?? 0)) }))}
      height={height}
      label={`${unit} per day`}
      empty={empty ?? `${unit[0].toUpperCase()}${unit.slice(1)} will draw here`}
    />
  )
}
