/* A live chart card in the lab-console language: header label + tabs, big number, animated SVG chart with
   legend and a data table toggle, optional ticker. Used by the product pages, /products and the 404. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Activity } from 'lucide-react'
import { bars, lineChart, type LineChart, type Series } from './charts'
import { ic, Ticker } from './ui'

export interface ChartTab {
  id: string
  label: string
  title: string
  series: Series[]
  labels: string[]
  fmt?: (v: number | null) => string
  stacked?: boolean
  head: ReactNode
  sub: ReactNode
}

export function ChartCard({ label, tabs, ticker = true, height = 200, children }: { label: string; tabs: ChartTab[]; ticker?: boolean; height?: number; children?: ReactNode }) {
  const [cur, setCur] = useState(0)
  const [table, setTable] = useState(false)
  const plot = useRef<HTMLDivElement>(null)
  const legend = useRef<HTMLDivElement>(null)
  const tbl = useRef<HTMLDivElement>(null)
  const chart = useRef<LineChart | null>(null)
  const tab = tabs[Math.min(cur, tabs.length - 1)]
  const key = JSON.stringify([tab.id, tab.series, tab.labels])
  useEffect(() => {
    if (!plot.current) return
    const real = tab.series.some((s) => s.values.filter((v) => v != null).length >= 2)
    if (!real) {
      chart.current?.destroy()
      chart.current = null
      plot.current.innerHTML = `<div class="empty-chart"><span class="pulse-dot"></span>waiting for enough live points…</div>`
      if (legend.current) legend.current.innerHTML = ''
      return
    }
    if (!chart.current) chart.current = lineChart(plot.current, { series: tab.series, labels: tab.labels, title: tab.title, fmt: tab.fmt, stacked: tab.stacked, height, legendEl: legend.current, tableEl: tbl.current })
    else chart.current.update(tab.series, tab.labels, tab.title)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(
    () => () => {
      chart.current?.destroy()
      chart.current = null
    },
    [],
  )
  return (
    <div className="wall card rise">
      <div className="ch">
        <span className="lab cy">
          {ic(Activity)}
          {label}
        </span>
        <div className="r">
          {tabs.length > 1 &&
            tabs.map((t, i) => (
              <button key={t.id} type="button" className="tbtn" aria-pressed={i === cur} onClick={() => setCur(i)}>
                {t.label}
              </button>
            ))}
          <button type="button" className="tbtn" aria-pressed={table} onClick={() => setTable(!table)}>
            Table
          </button>
        </div>
      </div>
      <div className="hn">
        <b className="num">{tab.head}</b>
        <span>{tab.sub}</span>
      </div>
      <div className="plot" ref={plot} hidden={table} />
      <div className="legend" ref={legend} hidden={table} />
      <div className="dtwrap" ref={tbl} hidden={!table} />
      {children}
      {ticker && <Ticker />}
    </div>
  )
}

/** The Gully Chain txs-per-block strip (slides left on each new block), as a card row. */
export function BlockBars({ blocks, meta }: { blocks: { number: number; txs: number }[]; meta: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const key = JSON.stringify(blocks.map((b) => [b.number, b.txs]))
  useEffect(() => {
    if (!blocks.length) return
    bars(ref.current, blocks.map((b) => b.txs), { keys: blocks.map((b) => b.number), labels: blocks.map((b) => `block ${b.number}`), title: 'Transactions per block' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return (
    <div className="chainrow">
      <div className="bars" ref={ref} />
      <div className="meta">{meta}</div>
    </div>
  )
}
