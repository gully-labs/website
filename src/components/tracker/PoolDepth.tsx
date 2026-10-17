import { useMemo } from 'react'
import { EChart } from '../charts/EChart'
import type { ChartEvent } from '../charts/chart-utils'
import { AnimatedNumber } from '../charts/AnimatedNumber'
import { NF } from '../charts/number-formats'
import { axisTooltip, barsPreset, C, tipHtml } from '../charts/chartPresets'
import { fmtCompactUsd, type TrackerPool } from '../../lib/tracker'

/* Pool depth for one stock token: how much of its liquidity and of its 24h volume sits in the
   deepest pool (the one its price is read from) against all its other pools, as two share bars.
   The bars grow in and glide on every refresh; hover or arrow keys give the dollar figures. A token
   without a pool says so. Every figure is the tracker's own read (DexScreener / GeckoTerminal). */

const ROWS = ['Liquidity', 'Volume 24h']

export function PoolDepth({ pool, ticker }: { pool: TrackerPool | null; ticker: string }) {
  const parts = pool
    ? [
        { main: pool.liquidityUsd, total: Math.max(pool.totalLiquidityUsd, pool.liquidityUsd) },
        { main: pool.volume24hUsd, total: Math.max(pool.totalVolume24hUsd, pool.volume24hUsd) },
      ]
    : []
  const key = parts.map((p) => `${p.main}/${p.total}`).join('|')
  const share = (main: number, total: number) => (total > 0 ? (main / total) * 100 : 0)
  const option = useMemo(
    () => ({
      grid: { left: 0, right: 0, top: 4, bottom: 4 },
      xAxis: { type: 'value', show: false, min: 0, max: 100 },
      yAxis: { type: 'category', show: false, inverse: true, data: ROWS },
      tooltip: axisTooltip((ps: ChartEvent[]) => {
        const i = ps[0]?.dataIndex ?? -1
        const p = parts[i]
        if (!p) return ''
        return tipHtml({
          title: `${ROWS[i]} · ${ticker}`,
          rows: [
            { name: 'deepest pool', value: fmtCompactUsd(p.main), color: C.gold },
            { name: 'other pools', value: fmtCompactUsd(p.total - p.main), color: C.lineHover },
            { name: 'all pools', value: fmtCompactUsd(p.total) },
          ],
        })
      }, 'shadow'),
      series: [
        {
          id: 'main',
          name: 'deepest pool',
          ...barsPreset({ horizontal: true, radius: [4, 0, 0, 4], stagger: 90, focus: 'series' }),
          stack: 'depth',
          barWidth: 14,
          itemStyle: { color: C.gold, borderRadius: [4, 0, 0, 4] },
          data: parts.map((p) => share(p.main, p.total)),
        },
        {
          id: 'rest',
          name: 'other pools',
          ...barsPreset({ horizontal: true, radius: [0, 4, 4, 0], stagger: 90, focus: 'series' }),
          stack: 'depth',
          barWidth: 14,
          itemStyle: { color: C.lineHover, borderRadius: [0, 4, 4, 0] },
          data: parts.map((p) => (p.total > 0 ? 100 - share(p.main, p.total) : 0)),
        },
      ],
    }),
    // `key` holds every figure the chart reads
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, ticker],
  )
  if (!pool) return <p className="m-0 font-mono text-[12px] text-faint">No pool found for {ticker}, so there is no depth to show.</p>
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        {parts.map((p, i) => (
          <div key={ROWS[i]} className="flex min-w-0 flex-col gap-1">
            <span className="font-mono text-[11px] tracking-[1px] text-faint">{ROWS[i].toUpperCase()}</span>
            <AnimatedNumber className="font-display text-[24px] leading-none font-bold text-ink" value={p.main} format={NF.compactUsd} countUp />
            <span className="text-[12px] text-dim">
              {p.total > 0 ? `${share(p.main, p.total).toFixed(0)}% of ${fmtCompactUsd(p.total)}` : 'none across its pools'}
            </span>
          </div>
        ))}
      </div>
      <EChart
        option={option}
        height={52}
        steps={{ count: ROWS.length }}
        label={`${ticker} pool depth: the deepest pool holds ${parts.map((p, i) => `${share(p.main, p.total).toFixed(0)}% of ${ROWS[i].toLowerCase()} (${fmtCompactUsd(p.main)} of ${fmtCompactUsd(p.total)})`).join(' and ')}, across ${pool.pools} pool${pool.pools === 1 ? '' : 's'}.`}
      />
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-faint">
        <span className="inline-flex items-center gap-2">
          <i className="size-[9px] rounded-[2px] bg-gold" /> deepest pool · {pool.dex} {ticker}/{pool.against}
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="size-[9px] rounded-[2px] bg-line-hover" /> {Math.max(0, pool.pools - 1)} other pool{pool.pools - 1 === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  )
}
