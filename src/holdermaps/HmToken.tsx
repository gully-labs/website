/* holdermaps.xyz/<chain>/<token>: one token's map, Gully Terminal redesign (2026-10-27). A chart-led header (the
   question, the summary line and six stat tiles with sparklines from the map's own replay frames), then the
   interactive bubble map (the shared HolderMap: replay, live transfers, wallet panel, list view), then tabs that keep
   the page near 1.5 screens: Read the map (top-10 gauge, who holds the supply, Lorenz curve and Gini, share by rank,
   linked clusters, a compact bubble field), Over time, Top holders, Deep check (the $9 purchase stepper, billed
   through Gully Pay) and Embed (the embed/widget/badge/API stepper). Every figure is the map's own
   (GET /api/holders/:chain/:token, re-read every five minutes); the mascot carries the loading, empty and error
   states. The gullylabs.xyz /holders page keeps its own layout (src/pages/HoldersPage.tsx). */
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowUpRight, ChevronRight, Gauge as GaugeIcon, LineChart, ListOrdered, Map as MapIcon, Plug, RefreshCw, ScanSearch } from 'lucide-react'
import { Seo } from '../components/Seo'
import { HolderMap } from '../components/holders/HolderMap'
import { ChainLogo } from '../components/logos/ChainLogo'
import { consoleToast } from '../console/toast'
import { useHolderMap, type HolderMapOk } from '../lib/holders'
import { ageText } from '../lib/tracker'
import { Dot, Kpi } from '../terminal/kit'
import { Bars, BubbleField, Donut, Gauge, Lorenz, NotReadable, Trend } from './charts'
import { CHAIN_NAMES, clusterRows, fmtInt, fmtPct, HM_C, isInfraNode, lorenz, rankBands, supplySplit, timelineSeries } from './insights'
import { HmLoading, HmState } from './HmStates'
import { useNow } from './hooks'
import { HmSearch } from './HmSearch'
import { HmTabs } from './HmKit'
import { HmDeepCheck } from './HmDeepCheck'
import { HmIntegrate } from './HmIntegrate'
import '../terminal/terminal.css'
import './hm.css'
import './hm-app.css'

const Y = '#FFD52E'

export function HmTokenPage() {
  const { chain = '', token = '' } = useParams()
  const load = useHolderMap(chain, token)
  const m = load.k === 'ok' ? load.data : null
  const symbol = m && 'token' in m ? (m.token?.symbol ?? null) : null
  const chainName = CHAIN_NAMES[chain] ?? chain
  const title = `Who holds ${symbol ? `$${symbol}` : 'this token'} on ${chainName}`
  const comingSoon = m?.state === 'unavailable' && !!m.comingSoon
  const description =
    m?.state === 'ok'
      ? `${m.summary.line} ${m.forensics?.riskLine ?? ''}`.trim().slice(0, 300)
      : comingSoon
        ? `Token maps for ${chainName} are coming soon. DeepCore launches and tokens on the other chains already have live maps on HolderMaps.`
        : `Who holds ${symbol ?? 'this token'} on ${chainName}: the biggest wallets as bubbles, the ones that trade with each other, and how concentrated it is, read live.`
  const ok = m?.state === 'ok' ? m : null
  useRefreshToast(ok)

  return (
    <div className="gt hmt hm-token">
      <Seo title={title} description={description} />
      <div className="hm-wrap">
        <nav aria-label="Breadcrumb" className="hmt-crumbs">
          <Link to="/">HolderMaps</Link>
          <ChevronRight aria-hidden className="hm-ic sm" />
          <span className="chain">
            <ChainLogo chain={chain} size={14} decorative /> {chain === 'gully' ? 'Gully Chain · 485590' : chainName}
          </span>
          <ChevronRight aria-hidden className="hm-ic sm" />
          <span aria-current="page" className="tok">
            {symbol ?? `${token.slice(0, 6)}…${token.slice(-4)}`}
          </span>
          {ok && (ok.kind === 'token' || ok.kind === 'launch' || ok.kind === 'deepcore-launch') && ok.token.url && (
            <a className="ext" href={ok.token.url} target="_blank" rel="noopener noreferrer">
              Explorer <ArrowUpRight aria-hidden className="hm-ic sm" />
              <span className="hm-sr"> (opens in a new tab)</span>
            </a>
          )}
        </nav>

        {load.k === 'loading' ? (
          <div className="hmt-sec">
            <h1 className="hm-sr">{title}</h1>
            <HmLoading />
          </div>
        ) : load.k === 'error' ? (
          <div className="hmt-sec">
            <h1 className="hm-sr">{title}</h1>
            <HmState pose="hologram" eyebrow="NO ANSWER" title="The map did not answer" text="HolderMaps could not be reached just now. Nothing is wrong with the token; try again in a moment." testId="hm-error">
              <button type="button" className="hm-btn" onClick={() => window.location.reload()}>
                <RefreshCw aria-hidden className="hm-ic" /> Try again
              </button>
              <Link className="hm-btn ghost" to="/">
                Map another token
              </Link>
            </HmState>
          </div>
        ) : m && m.state !== 'ok' ? (
          <div className="hmt-sec">
            <h1 className="hm-sr">{title}</h1>
            {m.state === 'unavailable' && typeof m.progress === 'number' ? (
              <HmLoading progress={m.progress} label="Reading this token’s history" />
            ) : m.state === 'not-found' ? (
              <HmState pose="point" eyebrow="NOT A TOKEN" title="Nothing to map at this address" text={<>{m.reason} Paste a token address or a ticker and HolderMaps checks every chain it covers at once.</>} testId="hm-not-found">
                <HmSearch compact />
              </HmState>
            ) : comingSoon ? (
              <HmState pose="backpack" eyebrow="COMING SOON" title={`Maps on ${m.chain?.name ?? chainName} are on the way`} text={`Holder data for ${m.chain?.name ?? chainName} is not wired up yet. Tokens on the other chains already have live maps.`} testId="hm-coming-soon">
                <Link className="hm-btn" to="/#live">
                  See live maps
                </Link>
              </HmState>
            ) : (
              <HmState pose="hologram" eyebrow={m.state === 'busy' ? 'BUSY' : 'CANNOT READ'} title={m.state === 'busy' ? 'HolderMaps is busy' : 'This token cannot be mapped right now'} text={m.reason} testId="hm-error">
                <button type="button" className="hm-btn" onClick={() => window.location.reload()}>
                  <RefreshCw aria-hidden className="hm-ic" /> Try again
                </button>
                <Link className="hm-btn ghost" to="/">
                  Map another token
                </Link>
              </HmState>
            )}
          </div>
        ) : ok ? (
          <Loaded m={ok} chain={chain} token={token} symbol={symbol} title={title} />
        ) : null}
      </div>
    </div>
  )
}

function Loaded({ m, chain, token, symbol, title }: { m: HolderMapOk; chain: string; token: string; symbol: string | null; title: string }) {
  const now = useNow(30_000)
  const [tab, setTab] = useState('read')
  const tl = timelineSeries(m)
  const lz = lorenz(m)
  const clusters = clusterRows(m)
  const linked = clusters.reduce((a, c) => a + c.wallets, 0)
  const tabsRef = useRef<HTMLDivElement>(null)
  const openTab = (id: string) => {
    setTab(id)
    requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const sym = symbol ? `$${symbol}` : 'this token'
  return (
    <>
      <header className="hmt-tokhead">
        <div>
          <span className="hmt-lbl">
            <i className="hm-dot" aria-hidden /> Live · {m.asOf ? ageText(m.asOf, now) : 'just now'} · {m.coverage?.level === 'top' ? 'top holders' : 'full history'}
          </span>
          {/* The shared HolderMap below carries the page's h1. */}
          <h2>
            Who holds <em>{sym}</em> on {chain === 'gully' ? 'Gully Chain' : m.chain.name}
          </h2>
          <p className="sum">{m.summary.line}</p>
        </div>
        <div className="hmt-acts">
          <button type="button" className="hm-btn" onClick={() => openTab('deep')}>
            <GaugeIcon aria-hidden className="hm-ic" /> Deep check
          </button>
          <button type="button" className="hm-btn ghost" onClick={() => openTab('embed')}>
            <Plug aria-hidden className="hm-ic" /> Embed
          </button>
        </div>
      </header>
      <div className="gt-kpis k6">
        <Kpi label="Holders" value={m.holders.count} spark={tl.holders ?? undefined} color={Y} sub={m.holders.count === null ? 'not readable' : tl.holders ? 'over the replay' : 'live count'} />
        <Kpi label="On the map" value={m.nodes.length} sub="biggest wallets" />
        <Kpi label="Top 10 hold" value={m.summary.top10Pct} fmt={fmtPct} spark={tl.top10 ?? undefined} color={Y} sub={m.holders.sharesOf === 'total supply' ? 'of total supply' : 'of listed holders'} />
        <Kpi label="Gini" value={lz ? lz.gini : null} fmt={(v) => v.toFixed(2)} sub={lz ? `${lz.n} wallets · 0 even, 1 one holder` : 'fewer than 3 shares'} />
        <Kpi label="Linked wallets" value={linked} sub={`${clusters.length} cluster${clusters.length === 1 ? '' : 's'}`} />
        <Kpi label="Status" text={<Dot s="up" label="live" />} sub={m.asOf ? `read ${ageText(m.asOf, now)}` : 'just read'} />
      </div>
      <div className="hmt-mapwrap">
        <HolderMap chain={chain} token={token} page />
      </div>
      <div className="hmt-sec" ref={tabsRef} style={{ scrollMarginTop: 72 }}>
        <h2 className="hm-sr">{title}: read the map</h2>
        <HmTabs
          label="About this map"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'read', label: 'Read the map', icon: MapIcon, content: <Insights m={m} /> },
            { id: 'time', label: 'Over time', icon: LineChart, content: <OverTime m={m} /> },
            { id: 'holders', label: 'Top holders', icon: ListOrdered, content: <HolderTable m={m} /> },
            { id: 'deep', label: 'Deep check', icon: GaugeIcon, content: <HmDeepCheck key={`${m.chain.key}:${m.token.address}`} chain={m.chain.key} token={m.token.address} symbol={symbol} /> },
            { id: 'embed', label: 'Embed', icon: Plug, content: <HmIntegrate chain={m.chain.key} token={m.token.address} symbol={symbol} /> },
          ]}
        />
        <p className="hmt-fine" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <ScanSearch aria-hidden className="hm-ic sm" /> Every share is read from the chain; a figure that cannot be read says so, never zero. Information only, not advice.
        </p>
      </div>
    </>
  )
}

/** A toast when a re-read brings a newer map (a real event: the server re-read the chain). */
function useRefreshToast(m: HolderMapOk | null) {
  const seen = useRef<string | null>(null)
  useEffect(() => {
    if (!m) return
    const k = `${m.chain.key}:${m.token.address}`
    const prev = seen.current
    seen.current = `${k}@${m.asOf}`
    if (prev && prev.startsWith(`${k}@`) && prev !== seen.current) consoleToast({ title: 'Map refreshed', text: `${m.token.symbol ?? 'This token'}: holders re-read from ${m.chain.name}.`, icon: 'check' })
  }, [m])
}

function Card({ title, sub, children, id }: { title: string; sub?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section className="gt-panel" aria-labelledby={id}>
      <header>
        <h3 className="gt-k" id={id}>
          {title}
        </h3>
      </header>
      <div className="hmt-card">
        {sub && <p>{sub}</p>}
        {children}
      </div>
    </section>
  )
}

function Insights({ m }: { m: HolderMapOk }) {
  const split = supplySplit(m)
  const bands = rankBands(m)
  const lz = lorenz(m)
  const clusters = clusterRows(m)
  const scope = m.holders.sharesOf === 'total supply' ? 'of the total supply' : 'of what the listed holders hold'
  return (
    <div className="hmt-grid">
      <Card title="Top 10 hold" sub={`The ten biggest wallets, ${scope}.`} id="hm-c-top10">
        <Gauge value={m.summary.top10Pct} label="Top 10 holders' share" caption={m.summary.line} />
      </Card>
      <Card title="Who holds the supply" sub={split?.ofSupply ? 'Pools and venues, linked wallets, the other big wallets, and everyone else.' : 'Split of what the listed holders hold.'} id="hm-c-split">
        {split ? <Donut segments={split.segments} total={split.ofSupply ? 100 : split.segments.reduce((a, s) => a + s.value, 0)} centre={{ k: 'tap a part', v: `${fmtInt(split.listed)}` }} label="Who holds the supply" /> : <NotReadable text="No shares readable for this token" />}
      </Card>
      <Card title="How even is it" sub="The Lorenz curve of the wallets on the map: the further it bows, the fewer wallets hold most of it." id="hm-c-lorenz">
        {lz ? <Lorenz points={lz.points} gini={lz.gini} n={lz.n} /> : <NotReadable text="Fewer than three holders with a share: no curve to draw" />}
      </Card>
      <Card title="Share by rank" sub={`How much each rank band holds, ${scope}.`} id="hm-c-rank">
        {bands ? <Bars rows={bands.map((b, i) => ({ id: String(i), label: b.label, value: b.value, color: i === 0 ? HM_C.yellow : i === 1 ? HM_C.lo : HM_C.white, aria: `${b.label}: ${fmtPct(b.value)}` }))} /> : <NotReadable text="No shares readable for this token" />}
      </Card>
      <Card title="Linked clusters" sub="Wallets that sent the token to each other: often one holder behind many wallets." id="hm-c-clusters">
        {clusters.length ? (
          <Bars
            rows={clusters.map((c) => ({
              id: c.id,
              label: (
                <>
                  {c.label}
                  {c.deployer && <em className="hm-tag">deployer</em>}
                </>
              ),
              value: c.value,
              sub: `${c.wallets} wallets`,
              color: c.deployer ? HM_C.lo : HM_C.yellow,
              aria: `${c.label}: ${c.wallets} wallets, ${c.value === null ? 'share not readable' : fmtPct(c.value)}${c.deployer ? ', includes the deployer' : ''}`,
            }))}
          />
        ) : (
          <NotReadable text="No linked wallets among the top holders: none of them sent this token to each other" />
        )}
      </Card>
      <Card title="Bubble field" sub="The biggest holders, sized by share. Yellow ones are linked." id="hm-c-field">
        <BubbleField m={m} max={30} height={240} />
      </Card>
    </div>
  )
}

function OverTime({ m }: { m: HolderMapOk }) {
  const tl = timelineSeries(m)
  return (
    <div className="hmt-grid2">
      <Card title="Holders over time" sub={tl.basis ?? 'From the map’s replay frames.'} id="hm-c-holders">
        {tl.holders ? <Trend values={tl.holders} labels={tl.labels} fmt={fmtInt} label="Holder count over time" /> : <NotReadable text="No holder-count history recorded for this token yet" height={140} />}
      </Card>
      <Card title="Top 10 share over time" sub="Concentration at each replay frame." id="hm-c-top10t">
        {tl.top10 ? <Trend values={tl.top10} labels={tl.labels} fmt={fmtPct} label="Top 10 share over time" color={HM_C.lo} /> : <NotReadable text="No concentration history recorded for this token yet" height={140} />}
      </Card>
    </div>
  )
}

/** The biggest holders as a table: rank, wallet (explorer link), what it is, share bar, balance. */
function HolderTable({ m }: { m: HolderMapOk }) {
  const rows = m.nodes.slice(0, 25)
  const top = Math.max(0.0001, ...rows.map((n) => n.pct ?? 0))
  return (
    <section className="gt-panel hm-table" aria-labelledby="hm-holders">
      <header>
        <h3 className="gt-k" id="hm-holders">
          Top {rows.length} of {m.holders.count === null ? 'an unreadable number of' : fmtInt(m.holders.count)} holders
        </h3>
        <span className="hmt-fine">wallet links open the chain’s explorer</span>
      </header>
      <div className="hm-table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Wallet</th>
              <th scope="col">What it is</th>
              <th scope="col" className="r">
                Share
              </th>
              <th scope="col" className="r hm-hide-s">
                Balance
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n, i) => (
              <tr key={n.id} style={{ ['--d' as string]: `${Math.min(i, 20) * 30}ms` }}>
                <td className="num">{n.rank}</td>
                <td>
                  <a href={n.url} target="_blank" rel="noopener noreferrer" className="hm-addr">
                    {n.short}
                    <span className="hm-sr"> (opens in a new tab)</span>
                  </a>
                </td>
                <td>
                  <span className="hm-what">
                    {n.label?.name ?? (n.contract ? 'Contract' : 'Wallet')}
                    {n.cluster && !isInfraNode(n) && <em className="hm-tag">linked</em>}
                    {n.flags.includes('bundled') && <em className="hm-tag warn">bundled</em>}
                    {n.flags.includes('deployer') && <em className="hm-tag">deployer</em>}
                  </span>
                </td>
                <td className="r">
                  <span className="hm-share">
                    <span className="num">{n.pct === null ? 'not readable' : fmtPct(n.pct)}</span>
                    {n.pct !== null && (
                      <span className="bar" aria-hidden>
                        <i style={{ width: `${Math.max(2, (n.pct / top) * 100)}%` }} />
                      </span>
                    )}
                  </span>
                </td>
                <td className="r num hm-hide-s">{n.balance >= 1e9 ? `${(n.balance / 1e9).toFixed(2)}B` : n.balance >= 1e6 ? `${(n.balance / 1e6).toFixed(2)}M` : n.balance >= 1e3 ? `${(n.balance / 1e3).toFixed(1)}K` : n.balance.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
