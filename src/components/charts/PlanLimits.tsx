import { useMemo, useState } from 'react'
import { EChart } from './EChart'
import type { ChartEvent } from './chart-utils'
import { axisTooltip, barsPreset, C, tipHtml } from './chartPresets'

/* The tracker API plans side by side, from GET /api/plans (the same read as the plan cards): one
   bar per tier for the chosen limit. Switching the limit glides each bar to its new length; hover or
   arrow keys give the exact figure. Nothing here is typed in. */

export interface LimitTier {
  name: string
  perMin: number
  historyDays: number
  /** null for "no key", which has no alerts. */
  alerts: number | null
  maxKeys: number | null
}

const METRICS = [
  { id: 'perMin', label: 'Requests a minute', unit: 'requests / min' },
  { id: 'historyDays', label: 'Gap history', unit: 'days' },
  { id: 'alerts', label: 'Gap alerts', unit: 'alerts' },
] as const
type Metric = (typeof METRICS)[number]['id']

const fmt = (n: number) => n.toLocaleString('en-US')

export function PlanLimits({ tiers }: { tiers: LimitTier[] }) {
  const [metric, setMetric] = useState<Metric>('perMin')
  const m = METRICS.find((x) => x.id === metric)!
  const val = (t: LimitTier) => t[metric] ?? 0
  const key = `${metric}|${tiers.map((t) => `${t.name}:${t.perMin}:${t.historyDays}:${t.alerts}`).join(',')}`
  const option = useMemo(
    () => ({
      grid: { left: 4, right: 76, top: 4, bottom: 4, containLabel: true },
      xAxis: { type: 'value', show: false, max: Math.max(1, ...tiers.map(val)) },
      yAxis: { type: 'category', inverse: true, data: tiers.map((t) => t.name), axisLabel: { color: C.ink2, fontSize: 12 }, axisLine: { show: false } },
      tooltip: axisTooltip((ps: ChartEvent[]) => {
        const t = tiers[ps[0]?.dataIndex]
        if (!t) return ''
        return tipHtml({
          title: t.name,
          rows: [
            { name: 'requests / min', value: fmt(t.perMin), color: metric === 'perMin' ? C.gold : undefined },
            { name: 'history', value: `${t.historyDays} days`, color: metric === 'historyDays' ? C.gold : undefined },
            { name: 'alerts', value: t.alerts === null ? 'none' : fmt(t.alerts), color: metric === 'alerts' ? C.gold : undefined },
            ...(t.maxKeys !== null ? [{ name: 'keys', value: fmt(t.maxKeys) }] : []),
          ],
        })
      }, 'shadow'),
      series: [
        {
          id: 'limit',
          ...barsPreset({ horizontal: true, stagger: 80 }),
          barWidth: 18,
          showBackground: true,
          backgroundStyle: { color: C.line, borderRadius: 4 },
          label: { show: true, position: 'right', color: C.ink2, fontSize: 12, formatter: (p: ChartEvent) => fmt(p.value) },
          // One hue stepping up with the tier (design review P2-26): the bigger the plan, the stronger the gold.
          data: tiers.map((t, i) => ({ value: val(t), itemStyle: { color: i === 0 ? C.lineHover : `rgba(232,192,96,${(0.35 + (0.65 * i) / Math.max(1, tiers.length - 1)).toFixed(2)})`, borderRadius: 4 } })),
        },
      ],
    }),
    // `key` holds the metric and every tier's figures
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  if (!tiers.length) return null
  return (
    <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-col gap-1">
          <span className="font-display text-[20px] leading-none font-bold uppercase">Compare the limits</span>
          <span className="font-mono text-[11px] text-faint">{m.unit} per tier, read from the plans</span>
        </span>
        <span role="group" aria-label="Limit" className="flex flex-wrap gap-1 rounded-input border border-line bg-bg p-1">
          {METRICS.map((x) => (
            <button
              key={x.id}
              type="button"
              aria-pressed={metric === x.id}
              onClick={() => setMetric(x.id)}
              className={`min-h-11 rounded-btn px-3 font-mono text-[12px] transition-colors ${metric === x.id ? 'bg-gold text-bg' : 'bg-transparent text-muted hover:text-ink'}`}
            >
              {x.label}
            </button>
          ))}
        </span>
      </div>
      <EChart
        option={option}
        height={Math.max(120, tiers.length * 40)}
        steps={{ count: tiers.length }}
        label={`${m.label} per tier: ${tiers.map((t) => `${t.name} ${t[metric] === null ? 'none' : fmt(val(t))}`).join(', ')}. Arrow keys step through the tiers.`}
      />
    </div>
  )
}
