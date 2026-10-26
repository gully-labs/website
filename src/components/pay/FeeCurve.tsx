/* The Gully Pay merchant fee curve (the merchant terms page shows it): fees owed against lifetime volume, read live
   from GET /api/pay/m/config. Moved here from the Gully Pay merchant docs when those docs moved to gullypay.xyz. */
import { useMemo } from 'react'
import { useLiveSeries } from '../charts/useLiveSeries'
import { ChartBox } from '../charts/ChartSkeleton'
import { EChart } from '../charts/EChart'
import { areaPreset, axisTooltip, C, linePreset, tipHtml } from '../charts/chartPresets'
import { apiOrigin } from '../../docs/nav'
interface Config {
  feeBps: number
  feePct: number
  freeUsd: number
  minStatementUsd: number
  pauseAfterDays: number
}

/** Fee owed against lifetime volume, from the live rate and allowance (GET /api/pay/m/config). */
export function FeeCurve() {
  const { data: cfg, error, refresh } = useLiveSeries<Config>(
    (signal) => fetch(`${apiOrigin()}/api/pay/m/config`, { signal }).then((r) => (r.ok ? (r.json() as Promise<Config>) : Promise.reject(new Error(String(r.status))))),
    60_000,
  )
  const err = !cfg && !!error
  const option = useMemo(() => {
    if (!cfg) return null
    const top = Math.max(cfg.freeUsd * 4, 20_000)
    const xs = Array.from({ length: 41 }, (_, i) => Math.round((top / 40) * i))
    const fee = xs.map((v) => Math.round(Math.max(0, v - cfg.freeUsd) * cfg.feeBps) / 100 / 100)
    const eff = xs.map((v, i) => (v ? Math.round((fee[i] / v) * 10_000) / 100 : 0))
    const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
    return {
      grid: { left: 8, right: 8, top: 40, bottom: 4, containLabel: true },
      legend: { top: 0, left: 0, textStyle: { color: C.muted, fontSize: 11 }, itemWidth: 10, itemHeight: 10 },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
        const i = ps[0]?.dataIndex ?? 0
        return tipHtml({ title: `${usd(xs[i])} lifetime volume`, rows: [{ name: 'Fees in all', value: usd(fee[i]), color: C.gold }, { name: 'Effective rate', value: `${eff[i]}%`, color: '#248bff' }], note: xs[i] <= cfg.freeUsd ? 'Inside the free allowance.' : undefined })
      }),
      xAxis: { type: 'category', boundaryGap: false, data: xs.map((v) => (v >= 1000 ? `$${v / 1000}k` : `$${v}`)), axisLabel: { color: C.faint, fontSize: 11, hideOverlap: true }, axisLine: { lineStyle: { color: C.line } } },
      yAxis: [
        { type: 'value', axisLabel: { color: C.faint, fontSize: 11, formatter: (v: number) => `$${v}` }, splitLine: { lineStyle: { color: C.grid } } },
        { type: 'value', axisLabel: { color: C.faint, fontSize: 11, formatter: (v: number) => `${v}%` }, splitLine: { show: false }, max: cfg.feePct },
      ],
      series: [
        { id: 'fee', name: 'Fees in all', ...areaPreset({ color: C.gold }), data: fee, markLine: { silent: true, symbol: 'none', lineStyle: { color: C.lineHover, type: 'dashed' }, label: { color: C.faint, fontSize: 11, formatter: 'free allowance', position: 'insideEndTop' }, data: [{ xAxis: xs.findIndex((v) => v >= cfg.freeUsd) }] } },
        { id: 'eff', name: 'Effective rate', ...linePreset({ color: '#248bff', dashed: true }), yAxisIndex: 1, data: eff },
      ],
    }
  }, [cfg])
  return (
    <figure className="m-0 flex flex-col gap-2">
      {option ? <EChart option={option} height={240} label={`Fees owed against lifetime volume at ${cfg?.feePct}% after ${cfg?.freeUsd} USD free`} steps={{ count: 41 }} /> : <ChartBox height={240} variant="line" state={err ? 'error' : 'loading'} message="The live fee settings could not be read." onRetry={refresh} />}
      <figcaption className="font-mono text-[11px] text-faint">Live from the server's settings (GET /api/pay/m/config){cfg ? `: ${cfg.feePct}% after the first $${cfg.freeUsd.toLocaleString('en-US')}.` : '.'}</figcaption>
    </figure>
  )
}

