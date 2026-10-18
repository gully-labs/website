import { useMemo, useState } from 'react'
import { projects } from '../content/projects'
import { fmtDay, fmtUsd, nameOf, type Point, type Venue } from '../lib/stats'
import { EChart } from './charts/EChart'
import type { ChartEvent } from './charts/chart-utils'
import { tooFewPoints } from './charts/chartData'
import { areaPreset, axisTooltip, CHART_H, livePoint, tipHtml } from './charts/chartPresets'
import { GhostChart } from './charts/GhostChart'

/* Charts drawn from live reads only. Lines draw on with a pulsing dot on the newest day, bars grow
   from the baseline; each is interactive (hover crosshair with exact values, keyboard stepping)
   and has a table twin. Under prefers-reduced-motion the motion is gentle (index.css policy). */

const accentOf = (key: string) => projects.find((p) => p.key === key)?.accent ?? '#d9b563'

function Tip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-input border border-line-strong bg-surface-deep px-[10px] py-2 font-mono text-[12px] whitespace-nowrap text-ink"
      style={{ left: x, top: y - 10, transform: 'translate(-50%, -100%)' }}
    >
      {children}
    </div>
  )
}

/** Fewer than two days: the kit's ghosted chart at the real chart's height, never a flat line. */
export function EmptySeries({ n, height = CHART_H.lg }: { n: number; height?: number }) {
  return <GhostChart height={height} testId="chart-empty" badge="NOT ENOUGH DATA YET" label={`${n} day${n === 1 ? '' : 's'} of data — not enough for a series yet.`} />
}

/** Daily totals as an area line, last N days: the line draws on, the area fades up, and a refresh
    glides it to the new values. Crosshair tooltip with the exact figure; arrow keys step days. */
export function DailyLine({ series, label, color = '#d9b563' }: { series: Point[]; label: string; color?: string }) {
  const key = `${color}|${label}|${series.map((p) => `${p.t}=${p.v}`).join(',')}`
  const option = useMemo(
    () => ({
      grid: { left: 0, right: 14, top: 12, bottom: 0, containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: series.map((p) => fmtDay(p.t)), axisLabel: { hideOverlap: true }, axisLine: { lineStyle: { color: '#2a3542' } } },
      yAxis: { type: 'value', splitNumber: 3, axisLabel: { formatter: (v: number) => fmtUsd(v).replace(/\.00$/, '') } },
      tooltip: axisTooltip((ps: ChartEvent[]) => {
        const p = series[ps[0]?.dataIndex]
        return p ? tipHtml({ title: fmtDay(p.t), rows: [{ name: label, value: fmtUsd(p.v), color }] }) : ''
      }),
      series: [
        { id: 'daily', ...areaPreset({ color, width: 2.5, smooth: 0.25, fill: 0.35 }), data: series.map((p) => p.v), emphasis: { disabled: true } },
        livePoint(series.length ? [fmtDay(series[series.length - 1].t), series[series.length - 1].v] : null, color),
      ],
    }),
    // `key` holds the colour, the label and every point
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  if (tooFewPoints(series.map((p) => p.v))) return <EmptySeries n={series.filter((p) => Number.isFinite(p.v)).length} />
  return <EChart option={option} height={CHART_H.lg} skeleton="line" steps={{ count: series.length }} label={`${label}: ${series.map((p) => `${fmtDay(p.t)} ${fmtUsd(p.v)}`).join(', ')}. Arrow keys step through days.`} />
}

/** One bar per venue, from a picked figure; a venue without it says so instead of drawing zero. */
export function VenueBars({ venues, pick }: { venues: Venue[]; pick: (v: Venue) => number | null }) {
  const [hover, setHover] = useState<string | null>(null)
  const rows = projects.map((p) => {
    const v = venues.find((x) => x.key === p.key)
    const value = v && v.state === 'ok' ? pick(v) : null
    return { key: p.key, value, state: v?.state ?? 'error' }
  })
  const max = Math.max(...rows.map((r) => r.value ?? 0), 1e-9)
  return (
    <div className="relative flex h-[260px] items-stretch gap-[18px]">
      {rows.map((r, i) => (
        <div
          key={r.key}
          className="relative flex min-w-0 flex-1 flex-col gap-2"
          onMouseEnter={() => setHover(r.key)}
          onMouseLeave={() => setHover(null)}
          tabIndex={0}
          onFocus={() => setHover(r.key)}
          onBlur={() => setHover(null)}
          aria-label={`${nameOf(r.key)} ${r.value === null ? (r.state === 'error' ? 'could not be read' : 'not published') : fmtUsd(r.value)}`}
        >
          <div className="relative flex flex-1 items-end border-b border-line-strong">
            {r.value !== null ? (
              <div
                className="w-full rounded-t-bar"
                style={{
                  height: `${Math.max(2, (r.value / max) * 100)}%`,
                  background: accentOf(r.key),
                  transformOrigin: 'bottom',
                  animation: `gl-grow .7s ${i * 0.07}s cubic-bezier(.2,.8,.2,1) both`,
                }}
              />
            ) : (
              <span className="absolute inset-x-0 bottom-2 text-center font-mono text-[11px] text-faint">{r.state === 'error' ? 'unreadable' : 'not published'}</span>
            )}
          </div>
          <span className="font-mono text-[14px] text-ink">{r.value === null ? '—' : fmtUsd(r.value)}</span>
          <span className="truncate font-mono text-[11px] text-faint">{nameOf(r.key)}</span>
          {hover === r.key && (
            <Tip x={0} y={0}>
              <span className="absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap">
                {nameOf(r.key)} · {r.value === null ? (r.state === 'error' ? 'could not be read' : 'not published') : fmtUsd(r.value)}
              </span>
            </Tip>
          )}
        </div>
      ))}
    </div>
  )
}

/** The accessible twin of every chart. */
export function DataTable<T>({ rows, cols }: { rows: T[]; cols: { label: string; cell: (r: T) => React.ReactNode }[] }) {
  return (
    <div className="max-h-[260px] overflow-auto">
      <table className="w-full border-collapse font-mono text-[13px]">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.label} className="border-b border-line px-[10px] py-2 text-left text-[11px] font-medium tracking-[1px] text-faint">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c.label} className="border-b border-line px-[10px] py-2 text-ink-2">
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 rounded-input border border-line bg-bg p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-btn px-[14px] py-2 font-mono text-[12px] transition-colors ${value === o.id ? 'bg-gold text-bg' : 'bg-transparent text-muted hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
