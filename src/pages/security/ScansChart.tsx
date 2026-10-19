import { useMemo } from 'react'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { axisTooltip, barsPreset, C, tipHtml } from '../../components/charts/chartPresets'
import { EChart } from '../../components/charts/EChart'
import { GhostChart } from '../../components/charts/GhostChart'
import { useLiveSeries } from '../../components/charts/useLiveSeries'
import type { SecurityStats } from '../../components/security/types'

/* The public scans counter with its 30-day chart (GET /api/security/stats, refreshed every 60 s). Real counts
   only: with no scan yet the chart is the kit's ghost, never invented numbers. */

export function ScansChart() {
  const { data, error, loading, refresh } = useLiveSeries<SecurityStats>(
    (signal) =>
      fetch('/api/security/stats', { signal }).then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json() as Promise<SecurityStats>
      }),
    60_000,
  )
  const days = useMemo(() => data?.days ?? [], [data])
  const option = useMemo(
    () => ({
      grid: { left: 4, right: 4, top: 6, bottom: 4 },
      xAxis: { type: 'category', show: false, data: days.map((d) => d.day) },
      yAxis: { type: 'value', show: false, minInterval: 1 },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const d = days[ps[0]?.dataIndex ?? 0]
        return d ? tipHtml({ title: d.day, rows: [{ name: 'started', value: String(d.started), color: C.gold }, { name: 'finished', value: String(d.done), color: C.green }, { name: 'failed', value: String(d.failed), color: C.error }] }) : ''
      }, 'shadow'),
      series: [{ id: 'started', ...barsPreset(), barWidth: '60%', itemStyle: { color: C.gold, borderRadius: [2, 2, 0, 0] }, data: days.map((d) => d.started) }],
    }),
    [days],
  )
  const total = data?.totals.started ?? 0
  return (
    <div className="card card-pad flex min-w-0 flex-col gap-3" aria-live="polite" data-testid="live-scans">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] tracking-[1px] text-faint">SCANS RUN ON GULLY SECURITY · 30 DAYS</span>
        <span className="inline-flex items-center gap-[6px] font-mono text-[11px] text-green">
          <span aria-hidden className="size-[6px] animate-[gl-blink_1.6s_ease-in-out_infinite] rounded-full bg-green motion-reduce:animate-none" /> live
        </span>
      </div>
      <span className="flex items-baseline gap-3">
        <AnimatedNumber value={total} countUp className="font-display text-[48px] leading-none font-extrabold text-gold" />
        <span className="text-[13px] text-muted">{total > 0 ? `${data?.totals.done ?? 0} finished · ${data?.totals.published ?? 0} published` : loading ? 'Reading the counter…' : 'scans so far; the counter starts with the first one'}</span>
      </span>
      {total > 0 ? (
        <EChart option={option} height={110} label={`Scans started per day over 30 days: ${total} in all.`} steps={{ count: Math.max(1, days.length) }} />
      ) : (
        <GhostChart variant="bars" height={110} framed={false} label={error ? 'The counter could not be read' : loading ? 'Reading the counter' : 'Scans will draw here once the first one runs'}>
          {error ? (
            <button type="button" onClick={refresh} className="underline underline-offset-4">
              Retry
            </button>
          ) : null}
        </GhostChart>
      )}
    </div>
  )
}
