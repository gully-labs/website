import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, CircleHelp, LayoutGrid, Play, Send, Zap } from 'lucide-react'
import { Seo } from '../components/Seo'
import { bars, C, fmtPct, fmtTime, fmtUsd, lineChart, type LineChart } from '../console/charts'
import { productFigures } from '../console/figures'
import { coversOf, NAMES, summed, totalOf, useLive, venueSeries, type Metric } from '../console/live'
import { Arrow, Btn, BUILD_STEPS, Count, ic, PRODUCTS, ProductCard, SectionHead, Stepper, Ticker, Tile, TrustBand } from '../console/ui'
import { APP_URL } from '../site-host'

/* The landing, Direction A "Lab console" (owner pick, 2026-10-25): hero copy beside the live network chart
   card (value locked / volume / fees by venue, Gully Chain txs per block, live ticker), five stat tiles,
   six product cards, the three-step stepper and the trust band. Every figure is read live. */

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
    if (!chart.current) chart.current = lineChart(plot.current, { series: vs.series, labels: vs.labels, title: TITLES[metric], stacked: true, unit: 'USD', legendEl: legend.current, tableEl: tbl.current })
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
          <Count as="b" value={chain?.head} />
          <span>{live.chainState === 'error' ? 'RPC could not be read' : avg ? `${blocks.reduce((a, b) => a + b.txs, 0)} tx in 40 blocks · ~${Math.round(avg)} s/block` : 'reading testnet RPC…'}</span>
        </div>
      </div>
      <Ticker />
    </div>
  )
}

function StatTiles() {
  const { stats, chain, status } = useLive()
  const ok = stats ? stats.venues.filter((v) => v.state === 'ok') : []
  const api = status?.components.find((c) => c.id === 'api')
  const blocks = chain?.blocks ?? []
  return (
    <div className="stats">
      <Tile label="Value locked" value={stats?.totals.tvlUsd} fmt={fmtUsd} spark={stats ? summed(stats, 'tvl') : []} color={C.s[0]} sub={stats ? `${coversOf(stats, 'tvl').length} venues · 30-day line` : 'across our venues'} />
      <Tile label="Volume · all-time" value={stats?.totals.volumeAllUsd} fmt={fmtUsd} spark={stats ? summed(stats, 'volume') : []} color={C.s[1]} sub={stats ? coversOf(stats, 'volume').map((k) => NAMES[k] ?? k).join(', ') || 'no venue publishes it' : 'venues that publish it'} />
      <Tile label="Fees · all-time" value={stats?.totals.feesAllUsd} fmt={fmtUsd} spark={stats ? summed(stats, 'fees') : []} color={C.s[2]} sub="USD, venue APIs + DefiLlama" />
      <Tile label="Gully Chain blocks" value={chain?.head} spark={blocks.map((b) => b.txs)} color={C.cyan} sub={chain ? `testnet · chain 485590 · ${blocks[blocks.length - 1]?.txs ?? 0} tx in the newest block` : 'testnet · chain 485590'} />
      <Tile
        label="Public API uptime · 24h"
        value={api ? Math.round((api.uptime24h ?? 0) * 1000) / 10 : null}
        fmt={fmtPct}
        small={stats ? `${ok.length} of ${stats.venues.length} venues ok` : undefined}
        spark={api ? api.history.map((h) => h.up) : []}
        color={C.s[3]}
        sub={api && status ? `${api.history.length} checks · overall ${status.overall} · status page` : 'reading status API…'}
      />
    </div>
  )
}

export function Home() {
  const live = useLive()
  const figs = productFigures(live)
  return (
    <div className="lcp">
      <Seo title="You Think It, We Ship It." description="Gully Labs builds and runs Web3 products: Gully Chain, Gully Pay, Gully RPC, HolderMaps, Gully Security and Gully Studio. Every figure on this page is read live." />
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
              One lab, six live products: an L3 chain, crypto payments, RPC infrastructure, holder maps, security scans and games. <b>Every number on this page is read live</b> from our own APIs and the Gully Chain testnet.
            </p>
            <div className="what card" role="note">
              {ic(CircleHelp)}
              <p>
                <b>New here?</b> Gully makes building and paying on chain simple: pick a product, get a key, ship. Three steps, no jargon.
              </p>
            </div>
            <div className="ctas">
              <a className="btn pri" href="#build">
                {ic(Play)}Start here
                <Arrow />
              </a>
              <a className="btn sec" href="#products">
                {ic(LayoutGrid)}See the products
              </a>
              <Btn kind="ter" icon={Send} href="https://t.me/GullyLabsBot?start=contact">
                Talk to us
              </Btn>
            </div>
          </div>
          <NetworkCard />
        </div>
      </section>

      <section className="statsec" aria-label="Live figures">
        <div className="wrap">
          <StatTiles />
        </div>
      </section>

      <section id="products" aria-labelledby="products-h">
        <div className="wrap">
          <SectionHead label="Products" title="Six products, one lab" id="products-h">
            Each card shows one live figure from the product itself. Open any of them to use it today.
          </SectionHead>
          <div className="prods">
            {PRODUCTS.map((p) => (
              <ProductCard key={p.key} p={p} f={figs[p.key]} />
            ))}
          </div>
        </div>
      </section>

      <section id="build" aria-labelledby="build-h">
        <div className="wrap">
          <SectionHead label="Build with Gully" title="Three steps, no jargon" id="build-h">
            Builders and first-timers take the same road. Each step is one page in the app.
          </SectionHead>
          <Stepper
            steps={BUILD_STEPS}
            cta={
              <Btn size="sm" icon={Zap} href={APP_URL} arrow>
                Open the app
              </Btn>
            }
          />
        </div>
      </section>

      <section style={{ paddingTop: 0 }} aria-label="Trust">
        <TrustBand />
      </section>
    </div>
  )
}
