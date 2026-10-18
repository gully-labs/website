import { useMemo } from 'react'
import { AnimatedNumber } from '../charts/AnimatedNumber'
import { axisTooltip, barsPreset, C, tipHtml } from '../charts/chartPresets'
import { EChart } from '../charts/EChart'
import { usePublic } from '../../pages/security/shared'
import type { SecurityStats } from './types'

/** Scans run on Gully Security per day (30 days), from GET /api/security/stats. Real counts only. */
export function LiveScans() {
  const [s, retry] = usePublic<SecurityStats>('/api/security/stats', 60_000)
  const data = s.k === 'ok' ? s.data : null
  const option = useMemo(() => {
    const days = data?.days ?? []
    return {
      grid: { left: 4, right: 4, top: 6, bottom: 4 },
      xAxis: { type: 'category', show: false, data: days.map((d) => d.day) },
      yAxis: { type: 'value', show: false, minInterval: 1 },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const d = days[ps[0]?.dataIndex ?? 0]
        return d ? tipHtml({ title: d.day, rows: [{ name: 'started', value: String(d.started), color: C.gold }, { name: 'finished', value: String(d.done), color: C.green }, { name: 'failed', value: String(d.failed), color: C.error }] }) : ''
      }, 'shadow'),
      series: [{ id: 'started', ...barsPreset(), barWidth: '60%', itemStyle: { color: C.gold, borderRadius: [2, 2, 0, 0] }, data: days.map((d) => d.started) }],
    }
  }, [data])
  const total = data?.totals.started ?? 0
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-5" aria-live="polite" data-testid="live-scans">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] tracking-[1px] text-faint">SCANS RUN ON GULLY SECURITY</span>
        <span className="inline-flex items-center gap-[6px] font-mono text-[11px] text-green">
          <span aria-hidden className="size-[6px] animate-[gl-blink_1.6s_ease-in-out_infinite] rounded-full bg-green motion-reduce:animate-none" /> live
        </span>
      </div>
      {s.k === 'error' ? (
        <p className="m-0 text-[13px] text-error">
          The counter is unreadable right now.{' '}
          <button type="button" onClick={retry} className="underline underline-offset-4">
            Retry
          </button>
        </p>
      ) : total > 0 ? (
        <>
          <span className="flex items-baseline gap-3">
            <AnimatedNumber value={total} countUp className="font-display text-[56px] leading-none font-extrabold text-gold" />
            <span className="text-[13px] text-muted">
              {data?.totals.done ?? 0} finished · {data?.totals.published ?? 0} published
            </span>
          </span>
          <EChart option={option} height={70} label={`Scans started per day over 30 days: ${total} in all.`} steps={{ count: 30 }} />
        </>
      ) : (
        <div className="flex min-h-[110px] flex-col items-start justify-center gap-2">
          <span className="relative flex size-4">
            <span aria-hidden className="absolute inset-0 rounded-full border border-gold" style={{ animation: 'gl-live-pulse 2.4s ease-out infinite' }} />
            <span aria-hidden className="m-auto size-2 rounded-full bg-gold" />
          </span>
          <span className="text-[14px] text-ink-2">{s.k === 'loading' ? 'Reading the counter…' : 'No scans have run yet. The counter starts with the first one; we do not round it up.'}</span>
        </div>
      )}
    </div>
  )
}
