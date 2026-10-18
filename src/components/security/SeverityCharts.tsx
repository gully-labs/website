import { useMemo } from 'react'
import { AnimatedNumber } from '../charts/AnimatedNumber'
import { barsPreset, C, itemTooltip, ringPreset, tipHtml } from '../charts/chartPresets'
import { EChart } from '../charts/EChart'
import { SEV_COLOR, SEV_LABEL, SEVERITIES, type Counts, type Severity } from './types'

/* A report's findings by severity: a donut (sweeps in, hover lifts a slice, the total in the middle) and
   horizontal bars (grow in, one per severity, tooltips). Both come from the report's own findings; a
   report with none says so instead of drawing empty marks. Clicking a slice or a bar picks that severity
   in the findings filter (`onPick`). */

export function SeverityCharts({ counts, onPick, compact = false }: { counts: Counts; onPick?: (s: Severity) => void; compact?: boolean }) {
  const total = SEVERITIES.reduce((a, s) => a + (counts[s] ?? 0), 0)
  const ring = useMemo(
    () => ({
      tooltip: itemTooltip((p: { name: string; value: number; color: string; percent: number }) => tipHtml({ title: 'Findings', rows: [{ name: p.name, value: `${p.value} (${Math.round(p.percent)}%)`, color: p.color }] })),
      series: [
        {
          id: 'sev',
          ...ringPreset({ radius: ['62%', '90%'] }),
          data: SEVERITIES.filter((s) => counts[s] > 0).map((s) => ({ name: SEV_LABEL[s], value: counts[s], sev: s, itemStyle: { color: SEV_COLOR[s] } })),
        },
      ],
    }),
    [counts],
  )
  const bars = useMemo(
    () => ({
      grid: { left: 64, right: 28, top: 4, bottom: 4 },
      xAxis: { type: 'value', show: false, max: Math.max(1, ...SEVERITIES.map((s) => counts[s])) },
      yAxis: { type: 'category', inverse: true, data: SEVERITIES.map((s) => SEV_LABEL[s]), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: C.muted, fontSize: 11 } },
      tooltip: itemTooltip((p: { name: string; value: number; color: string }) => tipHtml({ rows: [{ name: p.name, value: String(p.value), color: p.color }] })),
      series: [
        {
          id: 'bars',
          ...barsPreset({ horizontal: true, stagger: 60 }),
          barWidth: 10,
          showBackground: true,
          backgroundStyle: { color: C.grid, borderRadius: 3 },
          label: { show: true, position: 'right', color: C.ink2, fontSize: 11, fontFamily: 'IBM Plex Mono' },
          data: SEVERITIES.map((s) => ({ value: counts[s], sev: s, itemStyle: { color: SEV_COLOR[s] } })),
        },
      ],
    }),
    [counts],
  )
  const pick = (p: { data?: { sev?: Severity } }) => p.data?.sev && onPick?.(p.data.sev)
  const summary = SEVERITIES.map((s) => `${counts[s]} ${SEV_LABEL[s].toLowerCase()}`).join(', ')
  if (!total)
    return (
      <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-input border border-dashed border-line-strong px-4 text-center" data-testid="no-findings">
        <span aria-hidden className="size-3 rounded-full bg-green" style={{ animation: 'gl-live-pulse 2.4s ease-out infinite' }} />
        <span className="text-[14px] text-ink-2">No findings reported.</span>
        <span className="text-[12px] text-faint">An automated scan can miss issues; this is not a clean bill of health.</span>
      </div>
    )
  return (
    <div className={`grid items-center gap-4 ${compact ? 'grid-cols-[120px_1fr]' : 'grid-cols-[150px_1fr]'} max-[480px]:grid-cols-[110px_1fr]`} data-testid="severity-charts">
      <EChart option={ring} height={compact ? 120 : 150} label={`Findings by severity: ${summary}.`} skeleton="ring" onEvents={{ click: pick }}>
        <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <AnimatedNumber value={total} countUp className="font-display text-[30px] leading-none font-bold" />
          <span className="font-mono text-[11px] text-faint">findings</span>
        </span>
      </EChart>
      <EChart option={bars} height={compact ? 120 : 150} label={`Findings per severity: ${summary}.`} onEvents={{ click: pick }} steps={{ count: SEVERITIES.length }} />
    </div>
  )
}
