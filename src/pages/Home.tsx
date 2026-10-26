import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, LayoutGrid, Send, Zap } from 'lucide-react'
import { Seo } from '../components/Seo'
import { bars, fmtTime, fmtUsd, lineChart, type LineChart } from '../console/charts'
import { chainHead, coversOf, totalOf, useLive, venueSeries, type Metric } from '../console/live'
import { Btn, Count, ic, SectionHead, Ticker, TrustBand } from '../console/ui'
import { HubBoard, LaunchGrid, WhatsNew } from '../console/Launcher'
import { APP_URL } from '../site-host'

/* The landing, Direction A "Lab console" (owner pick, 2026-10-25), compact refresh (2026-10-26): one hero (copy beside
   the live network chart card: value locked / volume / fees by venue, Gully Chain txs per block, live ticker), one
   compact card per product with its live state, the live board beside what is new, and the trust band. Every figure
   is read live (GET /api/stats, /api/hub and the Gully Chain RPC). */

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

export function Home() {
  return (
    <div className="lcp">
      <Seo
        title="You Think It, We Ship It."
        description="Gully Labs builds and runs Web3 products, all on Gully Chain: Gully Street (social, multi-wallet, copy trading, Quests), Gully Bridge, Gully Safe, Gully Pay (x402), Gully RPC, HolderMaps, Gully Security, Gully AI, Gully Studio and Gully IPFS. Every figure on this page is read live."
      />
      <section className="hero" id="network">
        <div className="wrap">
          <div className="copy rise">
            <span className="lab cy">Gully Labs · Web3 product studio</span>
            <h1>
              You Think It,
              <br />
              <span className="grad">We Ship It.</span>
            </h1>
            <p className="promise">
              An L3 chain and the products around it: payments, RPC, bridge, multisig, holder maps, security, AI and games. <b>Every number here is read live.</b>
            </p>
            <div className="heroctas">
              <Btn icon={Zap} href={APP_URL} arrow>
                Open the app
              </Btn>
              <a className="btn sec" href="#products">
                {ic(LayoutGrid)}Products
              </a>
              <Btn kind="ter" icon={Send} href="https://t.me/GullyLabsBot?start=contact">
                Talk to us
              </Btn>
            </div>
          </div>
          <NetworkCard />
        </div>
      </section>

      <section id="products" aria-labelledby="products-h">
        <div className="wrap">
          <SectionHead label="Products" title="Everything we run, live" id="products-h">
            One card per product, each with its live state. Every one supports Gully Chain.
          </SectionHead>
          <LaunchGrid />
        </div>
      </section>

      <section id="live" aria-labelledby="live-h">
        <div className="wrap">
          <SectionHead label="Live today" title="The board and what is new" id="live-h" />
          <div className="newsgrid">
            <HubBoard />
            <WhatsNew />
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }} aria-label="Trust">
        <TrustBand mascot={false} />
      </section>
    </div>
  )
}
