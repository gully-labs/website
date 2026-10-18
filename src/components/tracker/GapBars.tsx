import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { EChartsType } from 'echarts/core'
import { EChart } from '../charts/EChart'
import type { ChartEvent } from '../charts/chart-utils'
import { axisTooltip, barsPreset, tipHtml } from '../charts/chartPresets'
import { ChainLogo, StockLogo } from './StockLogo'
import { CHAIN_SHORT, DOWN, fmtGap, fmtPrice, UP, type TrackerRow } from '../../lib/tracker'

// px per stock: the label column and the chart's category bands share it exactly. On a phone each
// row is a 44 px tap target, so fewer rows show before "show all".
const ROW_WIDE = 24
const ROW_TOUCH = 44
const TOUCH = '(max-width: 859px)'
function useTouchRows() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(TOUCH)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(TOUCH).matches,
    () => false,
  )
}
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
  const touch = useTouchRows()
  const ROW = touch ? ROW_TOUCH : ROW_WIDE
  const TOP_N = touch ? 10 : 16
  const withGap = rows.filter((r) => r.gapPct !== null)

  // The widest gaps first so the chart stays compact; "show all" lists every stock.
  const shown = all ? withGap : [...withGap].sort((a, b) => Math.abs(b.gapPct ?? 0) - Math.abs(a.gapPct ?? 0)).slice(0, TOP_N)
  // One order for both the label column and the chart's categories (gap descending, ties by id), so
  // row i of the labels is always band i of the chart. On a refresh each band's bar grows or shrinks
  // to its new value. (ECharts' realtimeSort was tried: its order drifted from the labels.)
  const byId = [...shown].sort((a, b) => (b.gapPct ?? 0) - (a.gapPct ?? 0) || (id(a) < id(b) ? -1 : 1))
  const ranked = byId
  const key = byId.map((r) => `${id(r)}=${r.gapPct}:${r.status}`).join('|') + `|${selected}|${inLinePct}|${ROW}`

  const option = useMemo(() => {
    if (!byId.length) return null
    const raw = Math.max(...byId.map((r) => Math.abs(r.gapPct ?? 0)))
    const extent = Math.max(3, Math.ceil(raw * 1.3))
    return {
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
        splitLine: { lineStyle: { color: '#1c2531' } },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: byId.map(id),
        axisLabel: { show: false },
        axisLine: { lineStyle: { color: '#2a3542' } },
        animationDuration: 300,
        animationDurationUpdate: SORT_MS,
      },
      tooltip: axisTooltip((ps: ChartEvent[]) => {
        const r = byId[ps[0]?.dataIndex]
        if (!r) return ''
        const c = (r.gapPct ?? 0) >= 0 ? UP : DOWN
        return tipHtml({
          title: `${r.ticker}${multi ? ` · ${CHAIN_SHORT[r.chain] ?? r.chain}` : ''}`,
          rows: [
            { name: 'gap', value: fmtGap(r.gapPct), color: c, valueColor: c },
            { name: 'onchain', value: fmtPrice(r.onchain) },
            { name: 'fair', value: fmtPrice(r.fair) },
          ],
          note: r.status === 'thin' ? 'thin pool, not trusted' : undefined,
        })
      }, 'shadow'),
      series: [
        {
          id: 'gap',
          ...barsPreset({ horizontal: true, radius: 2, stagger: 25 }),
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
                borderColor: sel ? '#d9b563' : c,
                borderWidth: thin || sel ? 1.5 : 0,
                borderType: thin ? 'dashed' : 'solid',
                borderRadius: 2,
              },
              label: { show: true, position: g >= 0 ? 'right' : 'left', distance: 6, color: c, fontSize: 11, formatter: () => fmtGap(r.gapPct) },
            }
          }),
          markArea: { silent: true, itemStyle: { color: 'rgba(217,181,99,.06)' }, label: { show: false }, data: [[{ xAxis: -inLinePct }, { xAxis: inLinePct }]] },
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
                  className={`flex h-full w-full min-w-0 items-center justify-end gap-[6px] rounded-btn bg-transparent p-0 pr-1 font-mono text-[12px] transition-colors ${hover === rid ? 'bg-surface-hover' : ''} ${sel ? 'text-gold' : 'text-ink-2'}`}
                >
                  <StockLogo row={r} size={16} chainBadge={false} active={sel} />
                  <span className="truncate">{r.ticker}</span>
                  {multi && <ChainLogo chain={r.chain} size={10} named />}
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
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 inline-flex min-h-11 items-center self-start bg-transparent p-0 font-mono text-[12px] text-gold hover:text-gold-hover">
          {all ? `Show the ${TOP_N} widest` : `Show all ${withGap.length}`}
        </button>
      )}
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-faint">
        <span className="inline-flex items-center gap-2">
          <i className="inline-block size-[10px] rounded-bar" style={{ background: UP }} /> above fair price
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="inline-block size-[10px] rounded-bar" style={{ background: DOWN }} /> below fair price
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="inline-block size-[10px] rounded-bar border border-dashed border-muted" /> thin pool, not trusted
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="inline-block h-[10px] w-4 bg-[rgba(217,181,99,.18)]" /> ±{inLinePct}% in line
        </span>
      </div>
    </div>
  )
}
