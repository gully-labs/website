import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity } from 'lucide-react'
import { bars, fmtTime, fmtUsd, lineChart, type LineChart } from './charts'
import { chainHead, coversOf, totalOf, useLive, venueSeries, type Metric } from './live'
import { Count, ic, Ticker } from './ui'

/* The live network chart card (value locked / volume / fees by venue, Gully Chain txs per block, live ticker), from the
   lab-console landing; the 404 page keeps it. Every figure is read live (GET /api/stats and the Gully Chain RPC). */

const TITLES: Record<Metric, string> = { tvl: 'Value locked by venue, 30 days', volume: 'Daily volume by venue, 30 days', fees: 'Daily fees by venue, 30 days' }

export function NetworkCard() {
  const live = useLive()
  const { stats, chain } = live
  const [metric, setMetric] = useState<Metric>('tvl')
  const [table, setTable] = useState(false)
  const plot = useRef<HTMLDivElement>(null)
  const legend = useRef<HTMLDivElement>(null)
  const tbl = useRef<HTMLDivElement>(null)
  const chart = useRef<LineChart | null>(null)
  const barsRef = useRef<HTMLDivElement>(null)
  const vs = useMemo(() => (stats ? venueSeries(stats, metric, 30) : null), [stats, metric])

  useEffect(() => {
    if (!vs || !plot.current) return
    if (!chart.current) chart.current = lineChart(plot.current, { series: vs.series, labels: vs.labels, title: TITLES[metric], height: 180, stacked: true, unit: 'USD', legendEl: legend.current, tableEl: tbl.current })
    else chart.current.update(vs.series, vs.labels, TITLES[metric])
  }, [vs, metric])
  useEffect(
    () => () => {
      chart.current?.destroy()
      chart.current = null
    },
    [],
  )

  useEffect(() => {
    if (!chain) return
    bars(barsRef.current, chain.blocks.map((b) => b.txs), { keys: chain.blocks.map((b) => b.number), labels: chain.blocks.map((b) => `block ${b.number}`), title: 'Transactions per block, last 40 blocks' })
  }, [chain])

  const blocks = chain?.blocks ?? []
  const gaps = blocks.slice(1).map((b, i) => b.time - blocks[i].time)
  const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null
  const sub = stats
    ? `${metric === 'tvl' ? 'value locked now' : metric === 'volume' ? 'volume, all-time' : 'fees, all-time'} · ${coversOf(stats, metric).length} of ${stats.venues.length} venues · read ${fmtTime(stats.generatedAt)}`
    : live.statsState === 'error'
      ? 'venue APIs could not be read'
      : 'reading venue APIs…'
  const tabs: [Metric, string][] = [
    ['tvl', 'Value locked'],
    ['volume', 'Volume'],
    ['fees', 'Fees'],
  ]
  return (
    <div className="wall card rise" style={{ animationDelay: '.08s' }}>
      <div className="ch">
        <span className="lab cy">
          {ic(Activity)}Gully network · live
        </span>
        <div className="r">
          {tabs.map(([m, l]) => (
            <button key={m} type="button" className="tbtn" aria-pressed={metric === m} onClick={() => setMetric(m)}>
              {l}
            </button>
          ))}
          <button type="button" className="tbtn" aria-pressed={table} onClick={() => setTable(!table)}>
            Table
          </button>
        </div>
      </div>
      <div className="hn">
        <Count as="b" value={stats ? totalOf(stats, metric) : null} fmt={fmtUsd} />
        <span>{sub}</span>
      </div>
      <div className="plot" ref={plot} hidden={table} />
      <div className="legend" ref={legend} hidden={table} />
      <div className="dtwrap" ref={tbl} hidden={!table} />
      <div className="chainrow">
        <div className="bars" ref={barsRef} />
        <div className="meta">
          <span className="lab">Gully Chain · txs / block</span>
          <Count as="b" value={chainHead(live)} />
          <span>{live.chainState === 'error' ? (live.hub?.chain ? 'RPC could not be read · head from the indexer' : 'RPC could not be read') : avg ? `${blocks.reduce((a, b) => a + b.txs, 0)} tx in 40 blocks · ~${Math.round(avg)} s/block` : 'reading testnet RPC…'}</span>
        </div>
      </div>
      <Ticker />
    </div>
  )
}
