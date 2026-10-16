import { useMemo, useRef, useState } from 'react'
import type { EChartsType } from 'echarts/core'
import { EChart } from '../charts/EChart'
import { esc, type ChartEvent } from '../charts/chart-utils'
import { ChainLogo, StockLogo } from './StockLogo'
import { DOWN, fmtGap, fmtPrice, UP, type TrackerRow } from '../../lib/tracker'

const ROW = 24 // px per stock: the label column and the chart's category bands share it exactly
const TOP = 22 // px above the first row, for the axis labels
const BOTTOM = 4
const SORT_MS = 650 // update animation length
const id = (r: TrackerRow) => `${r.chain}:${r.ticker}`

/* Every token's gap as a bar from a centre axis: right of centre trades above its fair price, left
   below. The ±in-line band is shaded so noise reads as noise; thin pools are drawn hollow because
   their price is not trustworthy. Bars grow from the axis, and on every refresh they grow or shrink
   to their new gap. Click a bar or a name to open its history. */
export function GapBars({ rows, inLinePct, selected, onSelect }: { rows: TrackerRow[]; inLinePct: number; selected: string | null; onSelect: (id: string) => void }) {
  const [hover, setHover] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const chart = useRef<EChartsType | null>(null)
  const multi = new Set(rows.map((r) => r.chain)).size > 1
  const TOP_N = 16
  const withGap = rows.filter((r) => r.gapPct !== null)

  // The widest gaps first so the chart stays compact; "show all" lists every stock.
  const shown = all ? withGap : [...withGap].sort((a, b) => Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0)).slice(0, TOP_N)
  // One order for both the label column and the chart's categories (gap descending, ties by id), so
  // row i of the labels is always band i of the chart. On a refresh each band's bar grows or shrinks
  // to its new value. (ECharts' realtimeSort was tried: its order drifted from the labels.)
  const byId = [...shown].sort((a, b) => (b.gapPct ?? 0) - (a.gapPct ?? 0) || (id(a) < id(b) ? -1 : 1))
  const ranked = byId
  const key = byId.map((r) => `${id(r)}=${r.gapPct}:${r.status}`).join('|') + `|${selected}|${inLinePct}`

  const option = useMemo(() => {
    if (!byId.length) return null
    const raw = Math.max(...byId.map((r) => Math.abs(r.gapPct ?? 0)))
    const extent = Math.max(3, Math.ceil(raw * 1.3))
    return {
      animationDuration: 800,
      animationEasing: 'cubicOut',
      animationDurationUpdate: SORT_MS,
      animationEasingUpdate: 'cubicInOut',
      // Side room so the value label of the widest bar is never clipped.
      grid: { left: 46, right: 46, top: TOP, bottom: BOTTOM, containLabel: false },
      xAxis: {
        type: 'value',
        position: 'top',
        min: -extent,
        max: extent,
        interval: extent / 2,
        axisLabel: { margin: 6, formatter: (v: number) => `${v > 0 ? '+' : ''}${Number.isInteger(v) ? v : v.toFixed(1)}%` },
        splitLine: { lineStyle: { color: '#1a2029' } },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: byId.map(id),
        axisLabel: { show: false },
        axisLine: { lineStyle: { color: '#2c3540' } },
        animationDuration: 300,
        animationDurationUpdate: SORT_MS,
      },
      tooltip: {
        trigger: 'item',
        confine: true,
        formatter: (p: ChartEvent) => {
          const r = byId[p.dataIndex]
          if (!r) return ''
          const c = (r.gapPct ?? 0) >= 0 ? UP : DOWN
          return `<div><b style="color:#e8c060;font-weight:500">${esc(r.ticker)}</b>${r.status === 'thin' ? ' <span style="color:#6c7888">· thin pool</span>' : ''}</div><div>gap <b style="color:${c};font-weight:500">${fmtGap(r.gapPct)}</b></div><div style="color:#a6b0bd">onchain ${fmtPrice(r.onchain)} · fair ${fmtPrice(r.fair)}</div>`
        },
      },
      series: [
        {
          id: 'gap',
          type: 'bar',
          barWidth: 14,
          cursor: 'pointer',
          data: byId.map((r) => {
            const g = r.gapPct ?? 0
            const c = g >= 0 ? UP : DOWN
            const thin = r.status === 'thin'
            const sel = id(r) === selected
            return {
              value: g,
              itemStyle: {
                color: thin ? 'rgba(0,0,0,0)' : c,
                borderColor: sel ? '#e8c060' : c,
                borderWidth: thin || sel ? 1.5 : 0,
                borderType: thin ? 'dashed' : 'solid',
                borderRadius: 2,
              },
              label: { show: true, position: g >= 0 ? 'right' : 'left', distance: 6, color: c, fontSize: 11, formatter: () => fmtGap(r.gapPct) },
            }
          }),
          emphasis: { focus: 'self', itemStyle: { shadowBlur: 10, shadowColor: 'rgba(232,192,96,.35)' } },
          blur: { itemStyle: { opacity: 0.4 }, label: { opacity: 0.5 } },
          markArea: { silent: true, itemStyle: { color: 'rgba(232,192,96,.06)' }, label: { show: false }, data: [[{ xAxis: -inLinePct }, { xAxis: inLinePct }]] },
        },
      ],
    }
    // `key` captures everything the option reads from rows and selection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!option) return <p className="m-0 py-6 font-mono text-[12px] text-faint">No token has both a feed and a pool to compare yet.</p>

  const point = (rid: string | null, on: boolean) => {
    const i = byId.findIndex((r) => id(r) === rid)
    if (i >= 0) chart.current?.dispatchAction({ type: on ? 'highlight' : 'downplay', seriesIndex: 0, dataIndex: i })
  }
  const height = TOP + ranked.length * ROW + BOTTOM

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[104px_1fr] gap-2">
        <ul className="m-0 flex list-none flex-col p-0" style={{ paddingTop: TOP }} aria-label="Gap to fair price, by token">
          {ranked.map((r) => {
            const rid = id(r)
            const sel = selected === rid
            return (
              <li key={rid} style={{ height: ROW }}>
                <button
                  type="button"
                  onClick={() => onSelect(rid)}
                  onMouseEnter={() => (setHover(rid), point(rid, true))}
                  onMouseLeave={() => (setHover(null), point(rid, false))}
                  onFocus={() => (setHover(rid), point(rid, true))}
                  onBlur={() => (setHover(null), point(rid, false))}
                  aria-pressed={sel}
                  aria-label={`${r.ticker} ${fmtGap(r.gapPct)}, onchain ${fmtPrice(r.onchain)}, fair ${fmtPrice(r.fair)}${r.status === 'thin' ? ', thin pool' : ''}`}
                  className={`flex h-full w-full min-w-0 items-center justify-end gap-[6px] rounded-[4px] bg-transparent p-0 pr-1 font-mono text-[12px] transition-colors ${hover === rid ? 'bg-surface-hover' : ''} ${sel ? 'text-gold' : 'text-ink-2'}`}
                >
                  <StockLogo row={r} size={16} chainBadge={false} active={sel} />
                  <span className="truncate">{r.ticker}</span>
                  {multi && <ChainLogo chain={r.chain} size={10} />}
                </button>
              </li>
            )
          })}
        </ul>
        <EChart
          option={option}
          height={height}
          label={`Gap to fair price for ${ranked.length} tokens, widest premium first: ${ranked
            .slice(0, 5)
            .map((r) => `${r.ticker} ${fmtGap(r.gapPct)}`)
            .join(', ')}${ranked.length > 5 ? ', and more' : ''}.`}
          onChart={(c) => (chart.current = c)}
          onEvents={{
            click: (p) => byId[p.dataIndex] && onSelect(id(byId[p.dataIndex])),
            mouseover: (p) => byId[p.dataIndex] && setHover(id(byId[p.dataIndex])),
            mouseout: () => setHover(null),
          }}
        />
      </div>
      {withGap.length > TOP_N && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 self-start bg-transparent p-0 font-mono text-[12px] text-gold hover:text-gold-hover">
          {all ? `Show the ${TOP_N} widest` : `Show all ${withGap.length}`}
        </button>
      )}
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-faint">
        <span className="inline-flex items-center gap-2">
          <i className="inline-block size-[10px] rounded-[2px]" style={{ background: UP }} /> above fair price
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="inline-block size-[10px] rounded-[2px]" style={{ background: DOWN }} /> below fair price
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="inline-block size-[10px] rounded-[2px] border border-dashed border-muted" /> thin pool, not trusted
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="inline-block h-[10px] w-4 bg-[rgba(232,192,96,.18)]" /> ±{inLinePct}% in line
        </span>
      </div>
    </div>
  )
}
