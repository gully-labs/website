import { useEffect, useMemo, useRef, useState } from 'react'
import type { EChartsType } from 'echarts/core'
import { EChart } from '../charts/EChart'
import type { ChartEvent } from '../charts/chart-utils'
import { ChartBox } from '../charts/ChartSkeleton'
import { axisTooltip, C, linePreset, livePoint, tipHtml } from '../charts/chartPresets'
import { DOWN, fmtGap, fmtPrice, UP, useHistory, type HistoryPoint } from '../../lib/tracker'

type Range = '24h' | '7d'
type Mode = 'gap' | 'price'

const HEIGHT = 280
const pad2 = (n: number) => String(n).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const hhmm = (ms: number) => {
  const d = new Date(ms)
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
}
const day = (ms: number) => {
  const d = new Date(ms)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}
/** The smallest round extent that holds `v`, so the axis ticks land on round numbers. */
const niceExtent = (v: number) => [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 40, 50, 75, 100, 150, 200].find((n) => n >= v) ?? Math.ceil(v / 100) * 100
const coarse = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

/* A run of readings, broken where the recorder missed more than a few snapshots. Each break gets a
   null (so the line does not invent a path through it), a faint dashed bridge between the two real
   readings either side, and a shaded "no readings" span. No point is ever made up. */
function withBreaks(pts: HistoryPoint[]) {
  const dts = pts
    .slice(1)
    .map((p, i) => p[0] - pts[i][0])
    .sort((a, b) => a - b)
  const typical = dts.length ? dts[Math.floor(dts.length / 2)] : 300
  const limit = Math.max(typical * 3, 900)
  const rows: (HistoryPoint | null)[] = []
  const holes: [HistoryPoint, HistoryPoint][] = []
  pts.forEach((p, i) => {
    const prev = pts[i - 1]
    if (prev && p[0] - prev[0] > limit) {
      rows.push(null)
      holes.push([prev, p])
    }
    rows.push(p)
  })
  return { rows, holes }
}

/* One token's history, recorded by this site every five minutes: the gap over time, or the two
   prices side by side. Crosshair tooltip with exact values, arrow keys step through readings,
   drag (or the slider on 7d) to zoom. Switching stock, mode or range animates the line to its new
   shape; a short history says how short instead of drawing. */
export function GapHistory(props: { chain: string; ticker: string; inLinePct: number }) {
  // Retry remounts the view, which reads the history afresh.
  const [attempt, setAttempt] = useState(0)
  return <GapHistoryView key={attempt} {...props} onRetry={() => setAttempt((a) => a + 1)} />
}

function GapHistoryView({ chain, ticker, inLinePct, onRetry }: { chain: string; ticker: string; inLinePct: number; onRetry: () => void }) {
  const st = useHistory(chain, ticker)
  const [range, setRange] = useState<Range>('24h')
  const [mode, setMode] = useState<Mode>('gap')
  const chart = useRef<EChartsType | null>(null)

  const all = useMemo(() => (st.k === 'ok' ? st.data : []), [st])
  // The window ends at the newest reading, not the wall clock: rendering stays pure, and a paused
  // tracker still shows its last day rather than an empty one.
  const pts = useMemo(() => {
    const newest = all.length ? all[all.length - 1][0] : 0
    const since = newest - (range === '24h' ? 86400 : 7 * 86400)
    return all.filter((p) => p[0] >= since)
  }, [all, range])
  const { rows, holes } = useMemo(() => withBreaks(pts), [pts])

  // A new stock or range starts fully zoomed out; a refresh keeps the user's zoom.
  useEffect(() => {
    chart.current?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 })
  }, [chain, ticker, range])

  const option = useMemo(() => {
    if (pts.length < 2) return null
    const ms = (p: HistoryPoint) => p[0] * 1000
    const line = (k: 1 | 2 | 3) => rows.map((p) => (p ? [ms(p), p[k]] : [null, null]))
    const bridge = (k: 1 | 2 | 3) => holes.flatMap(([a, b], i) => [...(i ? [[null, null]] : []), [ms(a), a[k]], [ms(b), b[k]]])
    const bridgeStyle = { type: 'line', silent: true, symbol: 'none', smooth: false, lineStyle: { width: 1, type: [1, 4], color: '#5c6878' }, tooltip: { show: false }, z: 1 }
    const holeArea = {
      silent: true,
      itemStyle: { color: 'rgba(166,176,189,.05)' },
      label: { show: true, position: 'insideTop', color: '#5c6878', fontSize: 11, formatter: 'no readings' },
      data: holes.map(([a, b]) => [{ xAxis: ms(a) }, { xAxis: ms(b) }]),
    }
    const newest = rows[rows.length - 1]

    let series: object[]
    let yAxis: object
    let visualMap: object[] = []
    if (mode === 'gap') {
      const ext = niceExtent(Math.max(inLinePct * 1.5, ...pts.map((p) => Math.abs(p[1]))) * 1.1)
      yAxis = {
        type: 'value',
        min: -ext,
        max: ext,
        interval: ext / 2,
        axisLabel: { formatter: (v: number) => `${v > 0 ? '+' : ''}${Number.isInteger(v) ? v : v.toFixed(2).replace(/0$/, '')}%` },
        axisPointer: { label: { formatter: (p: ChartEvent) => fmtGap(p.value) } },
      }
      // Above fair is teal, below is vermilion, split exactly at zero (bounded pieces: open-ended ones
      // leave ECharts with no gradient stops on a line).
      visualMap = [{ type: 'piecewise', show: false, seriesIndex: 0, dimension: 1, pieces: [{ gte: 0, lte: 1e6, color: UP }, { gte: -1e6, lt: 0, color: DOWN }] }]
      series = [
        {
          id: 'gap',
          name: 'gap',
          ...linePreset({ smooth: 0.15 }),
          data: line(1),
          connectNulls: false,
          areaStyle: { opacity: 0.14, origin: 0 },
          emphasis: { disabled: true },
          z: 3,
          markArea: {
            silent: true,
            itemStyle: { color: 'rgba(232,192,96,.07)' },
            label: { show: true, position: 'insideTopLeft', color: 'rgba(232,192,96,.65)', fontSize: 11, formatter: `±${inLinePct}% in line` },
            data: [[{ yAxis: -inLinePct }, { yAxis: inLinePct }]],
          },
          markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: '#3a4452', width: 1, type: 'solid' }, data: [{ yAxis: 0 }], animation: false },
        },
        { id: 'gap-bridge', ...bridgeStyle, data: bridge(1), markArea: holeArea },
        livePoint(newest ? [ms(newest), newest[1]] : null, newest && newest[1] < 0 ? DOWN : UP),
      ]
    } else {
      // min/max/interval are cleared explicitly: the y axis merges across modes, and the gap mode's
      // fixed extent would otherwise stay.
      yAxis = { type: 'value', scale: true, min: null, max: null, interval: null, splitNumber: 4, axisLabel: { formatter: (v: number) => fmtPrice(v).replace(/\.00$/, '') }, axisPointer: { label: { formatter: (p: ChartEvent) => fmtPrice(p.value) } } }
      series = [
        { id: 'onchain', name: 'onchain', ...linePreset({ color: C.gold, smooth: 0 }), data: line(2), connectNulls: false, z: 3 },
        { id: 'fair', name: 'fair (Chainlink)', ...linePreset({ color: C.muted, width: 1.5, smooth: 0, dashed: true }), symbolSize: 7, data: line(3), connectNulls: false, z: 2 },
        { id: 'onchain-bridge', ...bridgeStyle, data: bridge(2), markArea: holeArea },
        { id: 'fair-bridge', ...bridgeStyle, data: bridge(3) },
        livePoint(newest ? [ms(newest), newest[2]] : null, C.gold),
      ]
    }

    const slider = range === '7d'
    const touch = coarse()
    return {
      grid: { left: 4, right: 12, top: mode === 'price' ? 30 : 12, bottom: slider ? 58 : 8, containLabel: true },
      legend: mode === 'price' ? { show: true, top: 0, right: 8, data: ['onchain', 'fair (Chainlink)'] } : { show: false },
      xAxis: {
        type: 'time',
        min: ms(pts[0]),
        max: ms(pts[pts.length - 1]),
        splitNumber: 4,
        // Times when the readings span under two days (whatever the range), dates beyond that.
        axisLabel: { hideOverlap: true, formatter: (v: number) => (pts[pts.length - 1][0] - pts[0][0] < 2 * 86400 ? hhmm(v) : day(v)) },
        axisPointer: { label: { formatter: (p: ChartEvent) => `${day(p.value)} ${hhmm(p.value)}` } },
      },
      yAxis,
      visualMap,
      tooltip: axisTooltip((ps: ChartEvent[]) => {
        const main = ps.find((p) => p.seriesId === 'gap' || p.seriesId === 'onchain')
        const p = main ? rows[main.dataIndex] : null
        if (!p) return ''
        const c = p[1] >= 0 ? UP : DOWN
        return tipHtml({
          title: `${day(p[0] * 1000)} · ${hhmm(p[0] * 1000)} UTC`,
          rows: [
            { name: 'gap', value: fmtGap(p[1]), valueColor: c },
            { name: 'onchain', value: fmtPrice(p[2]), color: C.gold },
            { name: 'fair', value: fmtPrice(p[3]), color: C.muted },
          ],
        })
      }, 'cross'),
      dataZoom: [
        ...(touch ? [] : [{ id: 'zin', type: 'inside', xAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: 'shift', moveOnMouseWheel: false, moveOnMouseMove: true }]),
        ...(slider ? [{ id: 'zslide', type: 'slider', xAxisIndex: 0, filterMode: 'none', height: 22, bottom: 6, showDetail: false }] : []),
      ],
      series,
    }
  }, [pts, rows, holes, mode, range, inLinePct])

  const seg = (on: boolean) => `rounded-btn px-3 py-[6px] font-mono text-[12px] transition-colors ${on ? 'bg-gold text-bg' : 'bg-transparent text-muted hover:text-ink'}`
  const controls = (
    <div className="flex flex-wrap gap-2">
      <div role="group" aria-label="Show" className="flex gap-1 rounded-input border border-line bg-bg p-1">
        <button type="button" aria-pressed={mode === 'gap'} onClick={() => setMode('gap')} className={seg(mode === 'gap')}>
          Gap
        </button>
        <button type="button" aria-pressed={mode === 'price'} onClick={() => setMode('price')} className={seg(mode === 'price')}>
          Prices
        </button>
      </div>
      <div role="group" aria-label="Range" className="flex gap-1 rounded-input border border-line bg-bg p-1">
        {(['24h', '7d'] as Range[]).map((r) => (
          <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)} className={seg(range === r)}>
            {r}
          </button>
        ))}
      </div>
    </div>
  )

  const note = (text: React.ReactNode, error = false) => (
    <div className="flex items-center" style={{ minHeight: HEIGHT }}>
      <p className={`m-0 font-mono text-[12px] leading-[1.6] ${error ? 'text-error' : 'text-faint'}`}>{text}</p>
    </div>
  )

  // While the next stock's history loads, the last chart stays up (dimmed, labelled as loading), so
  // the line animates from one stock to the next instead of blinking out.
  const [kept, setKept] = useState(option)
  if (option && option !== kept) setKept(option)

  let body: React.ReactNode
  if (st.k === 'loading' && kept)
    body = (
      <EChart option={kept} height={HEIGHT} renderer="canvas" replaceMerge={['series', 'dataZoom', 'visualMap']} onChart={(c) => (chart.current = c)} label={`Reading ${ticker}'s history`} className="[&>div:first-child]:opacity-30">
        <p className="pointer-events-none absolute inset-0 m-0 flex items-center justify-center font-mono text-[12px] text-ink-2">Reading {ticker}'s history…</p>
      </EChart>
    )
  else if (st.k === 'loading') body = <ChartBox height={HEIGHT} state="loading" variant="line" />
  else if (st.k === 'error') body = <ChartBox height={HEIGHT} state="error" message={`Couldn't load ${ticker}'s history.`} onRetry={onRetry} />
  else if (!option)
    body = note(`${pts.length} reading${pts.length === 1 ? '' : 's'} in this range — not enough for a series. The tracker records every token every five minutes, so a line appears after two readings.`)
  else {
    const last = pts[pts.length - 1]
    body = (
      <EChart
        option={option}
        height={HEIGHT}
        renderer="canvas"
        replaceMerge={['series', 'dataZoom', 'visualMap']}
        steps={{ count: rows.length }}
        onChart={(c) => (chart.current = c)}
        label={`${ticker} ${mode === 'gap' ? 'gap to fair price' : 'onchain and fair price'}, last ${range}: ${pts.length} readings${holes.length ? `, ${holes.length} stretch${holes.length === 1 ? '' : 'es'} without readings` : ''}. Latest gap ${fmtGap(last[1])}, onchain ${fmtPrice(last[2])}, fair ${fmtPrice(last[3])}. Arrow keys step through readings.`}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[12px] text-faint">{mode === 'gap' ? `Gap, last ${range} · five-minute snapshots` : `Onchain against fair (Chainlink), last ${range}`}</span>
        {controls}
      </div>
      {body}
      {option && range === '7d' && <span className="-mt-2 font-mono text-[11px] text-faint">drag the slider{coarse() ? '' : ' or the chart, shift + scroll'} to zoom</span>}
    </div>
  )
}
