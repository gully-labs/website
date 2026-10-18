import { useMemo, useRef, useState } from 'react'
import type { EChartsType } from 'echarts/core'
import { EChart } from '../charts/EChart'
import type { ChartEvent } from '../charts/chart-utils'
import { AnimatedNumber } from '../charts/AnimatedNumber'
import { NF, type NumberFormat } from '../charts/number-formats'
import { axisTooltip, barsPreset, C, CHART_H, itemTooltip, PALETTE, ringPreset, tipHtml } from '../charts/chartPresets'
import { ChainLogo } from './StockLogo'
import { CHAIN_NAME, DOWN, fmtCompactUsd, fmtGap, fmtPrice, UP, type TrackerRow } from '../../lib/tracker'

const trusted = (rows: TrackerRow[]) => rows.filter((r) => r.gapPct !== null && r.status !== 'thin')
const median = (v: number[]) => {
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const idOf = (r: TrackerRow) => `${r.chain}:${r.ticker}`

/* How far stock tokens sit from fair: a histogram in quarter-percent bins, the outer bins catching
   everything beyond. Bars rise from the baseline and move to their new counts on every refresh;
   hover (or arrow keys) for a bin's count and its tickers. */
export function GapHistogram({ rows }: { rows: TrackerRow[] }) {
  const t = trusted(rows)
  const edges = [-Infinity, -1.5, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.5, Infinity]
  const bins = edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1]
    const items = t.filter((r) => (r.gapPct ?? 0) >= lo && (r.gapPct ?? 0) < hi)
    const label = lo === -Infinity ? `<${hi}` : hi === Infinity ? `≥+${lo}` : `${lo > 0 ? '+' : ''}${lo}`
    const range = lo === -Infinity ? `below ${hi}%` : hi === Infinity ? `+${lo}% and above` : `${lo > 0 ? '+' : ''}${lo}% to ${hi > 0 ? '+' : ''}${hi}%`
    return { lo, hi, items, label, range }
  })
  const key = bins.map((b) => b.items.map((r) => r.ticker).join(',')).join('|')
  const binColour = (b: (typeof bins)[number]) => (b.lo >= -0.25 && b.hi <= 0.25 ? C.muted : b.lo >= 0 ? UP : DOWN)
  const option = useMemo(
    () => ({
      grid: { left: 4, right: 4, top: 10, bottom: 4, containLabel: true },
      xAxis: { type: 'category', data: bins.map((b) => b.label), axisLabel: { fontSize: 11, interval: 0, hideOverlap: true }, axisLine: { lineStyle: { color: '#2c3540' } } },
      yAxis: { type: 'value', minInterval: 1, splitNumber: 3, axisLabel: { fontSize: 11 } },
      tooltip: axisTooltip((ps: ChartEvent[]) => {
        const b = bins[ps[0]?.dataIndex]
        if (!b) return ''
        return tipHtml({ title: b.range, rows: [{ name: 'stocks', value: String(b.items.length), color: binColour(b) }], note: b.items.map((r) => r.ticker).join(' ') || undefined })
      }, 'shadow'),
      series: [
        {
          id: 'bins',
          ...barsPreset({ stagger: 40 }),
          barCategoryGap: '18%',
          data: bins.map((b) => ({ value: b.items.length, itemStyle: { color: binColour(b), borderRadius: [3, 3, 0, 0] } })),
        },
      ],
    }),
    // `key` holds every bin's members
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  if (!t.length) return <p className="m-0 py-6 font-mono text-[12px] text-faint">No trusted pools to plot yet.</p>
  return (
    <div className="flex flex-col gap-1">
      <EChart option={option} height={CHART_H.sm} steps={{ count: bins.length }} label={`Gap distribution, stocks per band: ${bins.map((b) => `${b.range} ${b.items.length}`).join(', ')}. Arrow keys step through bands.`} />
      <div className="flex justify-between pl-6 font-mono text-[11px] text-faint" aria-hidden>
        <span>below fair</span>
        <span>gap %</span>
        <span>above fair</span>
      </div>
    </div>
  )
}

/* Pool depth against gap: does a thin pool drift further? x is liquidity on a log scale, y the gap,
   bubble area the 24h volume (smaller bubbles drawn on top so none hides another). Bubbles pop in
   and glide to new positions on refresh; hover to lift one out, drag or pinch to zoom, click to open
   its history. */
export function LiquidityScatter({ rows, inLinePct, onSelect }: { rows: TrackerRow[]; inLinePct: number; onSelect: (id: string) => void }) {
  const pts = rows.filter((r) => r.gapPct !== null && r.pool && r.pool.liquidityUsd > 0).sort((a, b) => b.pool!.totalVolume24hUsd - a.pool!.totalVolume24hUsd)
  const key = pts.map((r) => `${idOf(r)}=${r.gapPct}:${r.pool!.liquidityUsd}:${r.pool!.totalVolume24hUsd}:${r.status}`).join('|') + `|${inLinePct}`
  const option = useMemo(() => {
    const ext = Math.max(1.5, ...pts.map((r) => Math.abs(r.gapPct ?? 0))) * 1.15
    const vmax = Math.max(1, ...pts.map((r) => r.pool!.totalVolume24hUsd))
    const liq = pts.map((r) => r.pool!.liquidityUsd)
    const lo = 10 ** Math.floor(Math.log10(Math.max(1, Math.min(...liq))))
    const hi = 10 ** Math.ceil(Math.log10(Math.max(10, ...liq)))
    return {
      grid: { left: 4, right: 14, top: 12, bottom: 22, containLabel: true },
      xAxis: {
        type: 'log',
        logBase: 10,
        min: lo,
        max: hi === lo ? lo * 10 : hi,
        name: 'pool liquidity (log)',
        nameLocation: 'middle',
        nameGap: 22,
        axisLabel: { fontSize: 11, formatter: (v: number) => fmtCompactUsd(v).replace('.00', '').replace('.0K', 'K') },
        splitLine: { show: true, lineStyle: { color: '#1a2029' } },
        axisLine: { show: true, lineStyle: { color: '#2c3540' } },
      },
      yAxis: { type: 'value', min: -Number(ext.toFixed(1)), max: Number(ext.toFixed(1)), splitNumber: 2, axisLabel: { fontSize: 11, formatter: (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%` } },
      tooltip: itemTooltip((p: ChartEvent) => {
        const r = pts[p.dataIndex]
        if (!r) return ''
        const c = (r.gapPct ?? 0) >= 0 ? UP : DOWN
        return tipHtml({
          title: `${r.ticker} · ${CHAIN_NAME[r.chain] ?? r.chain}`,
          rows: [
            { name: 'gap', value: fmtGap(r.gapPct), color: c, valueColor: c },
            { name: 'onchain', value: fmtPrice(r.onchain) },
            { name: 'liquidity', value: fmtCompactUsd(r.pool!.liquidityUsd) },
            { name: 'volume 24h', value: fmtCompactUsd(r.pool!.totalVolume24hUsd) },
          ],
          note: r.status === 'thin' ? 'thin pool, not trusted' : 'click for its history',
        })
      }),
      dataZoom: [
        { id: 'zx', type: 'inside', xAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: 'shift', moveOnMouseWheel: false },
        { id: 'zy', type: 'inside', yAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: 'shift', moveOnMouseWheel: false },
      ],
      series: [
        {
          id: 'pools',
          type: 'scatter',
          cursor: 'pointer',
          // Area, not radius, follows volume: 6px for none, up to 30px for the busiest pool.
          data: pts.map((r) => {
            const c = (r.gapPct ?? 0) >= 0 ? UP : DOWN
            const thin = r.status === 'thin'
            return {
              value: [r.pool!.liquidityUsd, r.gapPct],
              symbolSize: 6 + Math.sqrt(r.pool!.totalVolume24hUsd / vmax) * 24,
              itemStyle: { color: thin ? 'rgba(0,0,0,0)' : `${c}66`, borderColor: c, borderWidth: 1.25, borderType: thin ? 'dashed' : 'solid' },
            }
          }),
          animationDuration: 700,
          animationEasing: 'backOut',
          animationDelay: (i: number) => Math.min(i * 18, 600),
          emphasis: { focus: 'self', scale: 1.35, label: { show: true, position: 'top', color: '#eef0f2', fontSize: 11, formatter: (p: ChartEvent) => pts[p.dataIndex]?.ticker ?? '' } },
          blur: { itemStyle: { opacity: 0.25 } },
          markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: '#3a4452', width: 1, type: 'solid' }, data: [{ yAxis: 0 }], animation: false },
          markArea: { silent: true, itemStyle: { color: 'rgba(232,192,96,.05)' }, label: { show: false }, data: [[{ yAxis: -inLinePct }, { yAxis: inLinePct }]] },
        },
      ],
    }
    // `key` holds every value the chart reads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  if (pts.length < 2) return <p className="m-0 py-6 font-mono text-[12px] text-faint">{pts.length} pool{pts.length === 1 ? '' : 's'} with a price and liquidity — not enough to plot yet.</p>
  return (
    <div className="flex flex-col gap-1">
      <EChart
        option={option}
        height={CHART_H.md}
        renderer="canvas"
        replaceMerge={['series', 'dataZoom']}
        steps={{ count: pts.length }}
        label={`Pool liquidity against gap for ${pts.length} pools. Arrow keys step through pools; the table below lists every one.`}
        onEvents={{ click: (p) => pts[p.dataIndex] && onSelect(idOf(pts[p.dataIndex])) }}
      />
      <span className="font-mono text-[11px] text-faint">bubble area = 24h volume · dashed = thin pool · shift + scroll to zoom</span>
    </div>
  )
}

/* Where the liquidity is: a ring of the deepest stock pools that sweeps in, and re-shares itself on
   refresh. Hover an arc or a legend row for its share. */
export function LiquidityRing({ rows }: { rows: TrackerRow[] }) {
  const [hover, setHover] = useState<string | null>(null)
  const chart = useRef<EChartsType | null>(null)
  const withPool = rows.filter((r) => r.pool && r.pool.totalLiquidityUsd > 0).sort((a, b) => b.pool!.totalLiquidityUsd - a.pool!.totalLiquidityUsd)
  const total = withPool.reduce((a, r) => a + r.pool!.totalLiquidityUsd, 0)
  const palette = [PALETTE[0], PALETTE[2], PALETTE[1], PALETTE[3], PALETTE[4], PALETTE[5], PALETTE[6], PALETTE[7]]
  const top = withPool.slice(0, 7).map((r, i) => ({ id: idOf(r), label: r.ticker, chain: r.chain, v: r.pool!.totalLiquidityUsd, color: palette[i] }))
  const rest = total - top.reduce((a, s) => a + s.v, 0)
  const slices = rest > 0 ? [...top, { id: 'other', label: `${withPool.length - top.length} others`, chain: '', v: rest, color: '#3a4452' }] : top
  const key = slices.map((s) => `${s.id}=${s.v}`).join('|')
  const option = useMemo(
    () => ({
      tooltip: { show: false },
      series: [
        {
          id: 'ring',
          ...ringPreset(),
          data: slices.map((s) => ({ name: s.id, value: s.v, itemStyle: { color: s.color } })),
        },
      ],
    }),
    // `key` holds every slice and value
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  if (!total) return <p className="m-0 py-6 font-mono text-[12px] text-faint">No pool liquidity to show yet.</p>
  const cur = slices.find((s) => s.id === hover)
  const point = (sid: string | null, on: boolean) => sid && chart.current?.dispatchAction({ type: on ? 'highlight' : 'downplay', seriesIndex: 0, name: sid })
  return (
    <div className="flex items-center gap-5 max-[480px]:flex-col">
      <div className="relative size-[150px] flex-none">
        <EChart
          option={option}
          height={CHART_H.sm}
          skeleton="ring"
          steps={{ count: slices.length }}
          onChart={(c) => (chart.current = c)}
          label={slices.map((s) => `${s.label} ${((s.v / total) * 100).toFixed(1)}%`).join(', ')}
          onEvents={{ mouseover: (p) => setHover(p.name), mouseout: () => setHover(null), highlight: (p) => typeof p.dataIndex === 'number' && slices[p.dataIndex] && setHover(slices[p.dataIndex].id), downplay: () => setHover(null) }}
        >
          <span aria-hidden className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            {cur ? (
              <AnimatedNumber className="font-display text-[22px] leading-none font-extrabold text-ink" value={(cur.v / total) * 100} format={NF.int} suffix="%" />
            ) : (
              <AnimatedNumber className="font-display text-[22px] leading-none font-extrabold text-ink" value={total} format={NF.compactUsd} countUp />
            )}
            <span className="mt-1 font-mono text-[11px] text-faint">{cur ? cur.label : 'in pools'}</span>
          </span>
        </EChart>
      </div>
      <ul className="m-0 flex w-full min-w-0 flex-1 list-none flex-col gap-[5px] p-0">
        {slices.map((s) => (
          <li
            key={s.id}
            onMouseEnter={() => (setHover(s.id), point(s.id, true))}
            onMouseLeave={() => (setHover(null), point(s.id, false))}
            className={`flex items-center gap-2 rounded-btn px-1 text-[13px] transition-colors ${hover === s.id ? 'bg-surface-hover' : ''}`}
          >
            <i className="size-[9px] flex-none rounded-bar" style={{ background: s.color }} />
            <span className="truncate text-ink-2">
              {s.label}
              {s.chain && <ChainLogo chain={s.chain} size={12} named className="ml-1.5 align-[-2px]" />}
            </span>
            <span className="ml-auto font-mono text-[12px] text-muted">{fmtCompactUsd(s.v)}</span>
            <span className="w-11 text-right font-mono text-[12px] text-ink-2">{((s.v / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* The two chains side by side: stocks, typical gap, liquidity and volume as paired bars, one small
   grid per metric. Each metric is scaled to its own larger value (the units differ); the figure sits
   in a column on the right, level with its bar. Bars grow in and move to new values on refresh. */
const CC_ROW = 62 // px per metric
const CC_LABEL = 22 // px for the metric's name above its bars
const CC_BARS = 28 // px for the two bars (14px band each)
export function ChainCompare({ rows, chains }: { rows: TrackerRow[]; chains: { key: string; name: string }[] }) {
  const stats = chains.map((c) => {
    const rs = rows.filter((r) => r.chain === c.key)
    return {
      ...c,
      stocks: rs.length,
      gap: median(trusted(rs).map((r) => Math.abs(r.gapPct ?? 0))),
      liquidity: rs.reduce((a, r) => a + (r.pool?.totalLiquidityUsd ?? 0), 0),
      volume: rs.reduce((a, r) => a + (r.pool?.totalVolume24hUsd ?? 0), 0),
    }
  })
  const metrics: { k: string; label: string; get: (s: (typeof stats)[number]) => number | null; fmt: (v: number) => string; nf: NumberFormat; suffix?: string; lowerBetter?: boolean }[] = [
    { k: 'stocks', label: 'Stocks tracked', get: (s) => s.stocks, fmt: (v) => String(v), nf: NF.int },
    { k: 'gap', label: 'Typical gap', get: (s) => s.gap, fmt: (v) => `${v.toFixed(2)}%`, nf: NF.fixed2, suffix: '%', lowerBetter: true },
    { k: 'liquidity', label: 'Pool liquidity', get: (s) => s.liquidity, fmt: fmtCompactUsd, nf: NF.compactUsd },
    { k: 'volume', label: 'Volume 24h', get: (s) => s.volume, fmt: fmtCompactUsd, nf: NF.compactUsd },
  ]
  const colors = ['#e8c060', '#5aa9e6']
  const table = metrics.map((m) => stats.map((s) => m.get(s)))
  const fmtCell = (j: number, i: number) => (table[j][i] === null ? '—' : metrics[j].fmt(table[j][i]!))
  const key = JSON.stringify(table) + stats.map((s) => s.name).join()
  const option = useMemo(
    () => ({
      grid: metrics.map((_, j) => ({ left: 0, right: 0, top: j * CC_ROW + CC_LABEL, height: CC_BARS })),
      xAxis: metrics.map((_, j) => ({ gridIndex: j, type: 'value', show: false, min: 0, max: 100 })),
      yAxis: metrics.map((_, j) => ({ gridIndex: j, type: 'category', inverse: true, show: false, data: stats.map((s) => s.name) })),
      tooltip: itemTooltip((p: ChartEvent) => {
        const j = p.seriesIndex
        return tipHtml({ title: metrics[j].label, rows: stats.map((s, i) => ({ name: s.name, value: fmtCell(j, i), color: colors[i] })) })
      }),
      series: metrics.map((m, j) => {
        const max = Math.max(1e-9, ...table[j].map((x) => x ?? 0))
        return {
          id: m.k,
          ...barsPreset({ horizontal: true }),
          xAxisIndex: j,
          yAxisIndex: j,
          barWidth: 10,
          showBackground: true,
          backgroundStyle: { color: '#1d232c', borderRadius: 5 },
          animationDelay: (i: number) => j * 90 + i * 50,
          data: table[j].map((v, i) => ({ value: v === null ? null : Math.max(2, (v / max) * 100), itemStyle: { color: colors[i], borderRadius: 5 } })),
        }
      }),
    }),
    // `key` holds every figure
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  return (
    <div className="flex flex-col gap-4">
      {stats.length > 1 && (
        <div className="flex gap-4 font-mono text-[11px] text-faint">
          {stats.map((s, i) => (
            <span key={s.key} className="inline-flex items-center gap-2">
              <i className="size-[9px] rounded-bar" style={{ background: colors[i] }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <div className="grid grid-cols-[1fr_72px] gap-2">
        <EChart
          option={option}
          height={metrics.length * CC_ROW - (CC_ROW - CC_LABEL - CC_BARS)}
          label={metrics.map((m, j) => `${m.label}: ${stats.map((s, i) => `${s.name} ${table[j][i] === null ? 'not available' : fmtCell(j, i)}`).join(', ')}`).join('. ')}
        >
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {metrics.map((m, j) => (
              <span key={m.k} className="absolute left-0 text-[12px] leading-4 text-muted" style={{ top: j * CC_ROW }}>
                {m.label}
                {m.lowerBetter && <span className="ml-1 font-mono text-[11px] text-faint">lower is tighter</span>}
              </span>
            ))}
          </div>
        </EChart>
        <div aria-hidden className="relative">
          {metrics.map((m, j) =>
            stats.map((s, i) => (
              <span key={`${m.k}-${s.key}`} className="absolute right-0 font-mono text-[12px] leading-[14px] text-ink-2" style={{ top: j * CC_ROW + CC_LABEL + i * (CC_BARS / 2) }}>
                {table[j][i] === null ? '—' : <AnimatedNumber value={table[j][i]} format={m.nf} suffix={m.suffix} countUp />}
              </span>
            )),
          )}
        </div>
      </div>
    </div>
  )
}

