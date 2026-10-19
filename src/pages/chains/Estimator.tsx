import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { EChart } from '../../components/charts/EChart'
import { areaPreset, axisTooltip, C, CHART_H, livePoint, tipHtml } from '../../components/charts/chartPresets'
import { NF } from '../../components/charts/number-formats'
import { useReducedMotion } from '../../components/charts/chart-utils'
import { useInView } from '../../components/charts/useMiniChart'
import type { ChainsConfig } from './useChains'

/* Managed mainnet fee against sequencer profit: the monthly base plus the profit share, both read from the config.
   An illustration of the formula, not a quote: data availability is billed at cost on top and is not drawn.
   Until a visitor touches the slider it sweeps by itself, so the marker and the figure move. */

const MAX = 200_000
const STEP = 10_000
const usd0 = { ...NF.usd, minimumFractionDigits: 0, maximumFractionDigits: 0 }
const SWEEP = [30_000, 60_000, 90_000, 120_000, 90_000, 60_000]

export function Estimator({ cfg }: { cfg: ChainsConfig }) {
  const { fromUsdPerMonth: base, sequencerProfitPct: pct } = cfg.mainnet
  const [profit, setProfit] = useState(SWEEP[0])
  const [manual, setManual] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const inView = useInView(box)
  const reduced = useReducedMotion()
  useEffect(() => {
    if (manual || !inView || reduced) return
    let k = 0
    const t = setInterval(() => setProfit(SWEEP[++k % SWEEP.length]), 2200)
    return () => clearInterval(t)
  }, [manual, inView, reduced])
  const fee = (p: number) => base + (p * pct) / 100
  const xs = useMemo(() => Array.from({ length: MAX / STEP + 1 }, (_, i) => i * STEP), [])
  const option = useMemo(
    () => ({
      grid: { left: 4, right: 12, top: 12, bottom: 4, containLabel: true },
      xAxis: { type: 'category', data: xs.map((x) => `$${x / 1000}k`), boundaryGap: false, axisLabel: { interval: 3 } },
      yAxis: { type: 'value', min: 0, axisLabel: { formatter: (v: number) => `$${v / 1000}k` } },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const p = xs[ps[0]?.dataIndex ?? 0]
        return tipHtml({ title: `Sequencer profit ${new Intl.NumberFormat('en-US', usd0).format(p)} a month`, rows: [{ name: 'Gully Labs fee', value: new Intl.NumberFormat('en-US', usd0).format(fee(p)), color: C.gold }] })
      }),
      series: [{ id: 'fee', ...areaPreset({ color: C.gold }), data: xs.map(fee) }, livePoint([`$${profit / 1000}k`, fee(profit)])],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [xs, profit, base, pct],
  )
  return (
    <div ref={box} className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-card-token p-5 max-[600px]:p-4" data-testid="chains-estimator">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-display text-[20px] leading-none font-bold uppercase">Managed mainnet, by sequencer profit</span>
        <span className="rounded-full border border-line-strong px-2 py-[2px] font-mono text-[11px] tracking-[1px] text-faint">ESTIMATE · NOT A QUOTE</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-6 gap-y-1 max-[600px]:grid-cols-1">
        <label className="flex flex-col gap-1">
          <span className="flex flex-wrap items-baseline justify-between gap-2 font-mono text-[11px] tracking-[1px] text-dim">
            <span>MONTHLY SEQUENCER PROFIT</span>
            <b className="font-medium text-ink">
              <AnimatedNumber value={profit} format={usd0} />
            </b>
          </span>
          <input
            type="range"
            min={0}
            max={MAX}
            step={STEP}
            value={profit}
            onChange={(e) => (setManual(true), setProfit(Number(e.target.value)))}
            aria-label="Monthly sequencer profit in US dollars"
            className="h-9 w-full cursor-pointer accent-gold"
          />
        </label>
        <p className="m-0 flex flex-wrap items-baseline gap-2 text-[14px] text-muted">
          <span>Fee about</span>
          <b className="font-display text-[28px] leading-none text-gold">
            <AnimatedNumber value={fee(profit)} format={usd0} />
          </b>
          <span>a month</span>
        </p>
      </div>
      <EChart option={option} height={CHART_H.sm} label={`Line chart: the monthly fee rises from ${new Intl.NumberFormat('en-US', usd0).format(base)} at no profit by ${pct} per cent of sequencer profit. Use the slider to move the marker.`} skeleton="line" />
      <p className="m-0 font-mono text-[11px] text-faint">Plus data availability at cost. {cfg.note}</p>
    </div>
  )
}
