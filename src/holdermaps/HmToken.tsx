/* holdermaps.xyz/<chain>/<token>: one token's map, in the HolderMaps kit. The interactive bubble map (the shared
   HolderMap: replay, live transfers, wallet panel, list view) comes first; below it "Read the map": the top-10 gauge,
   who holds the supply, the Lorenz curve and Gini of the listed holders, share by rank, linked clusters, holder count
   and concentration over time (where the map has a timeline), and the top-holder table. Every figure is the map's
   own (GET /api/holders/:chain/:token, re-read every five minutes); the mascot carries the loading, empty and
   error states. The gullylabs.xyz /holders page keeps its own layout (src/pages/HoldersPage.tsx). */
import { useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowUpRight, ChevronRight, RefreshCw } from 'lucide-react'
import { Seo } from '../components/Seo'
import { HolderMap } from '../components/holders/HolderMap'
import { DeepCheckCard } from '../components/holders/DeepCheck'
import { BadgeBlock } from '../components/holders/BadgeBlock'
import { ChainLogo } from '../components/logos/ChainLogo'
import { consoleToast } from '../console/toast'
import { useHolderMap, type HolderMapOk } from '../lib/holders'
import { ageText } from '../lib/tracker'
import { Bars, BubbleField, Donut, Gauge, Lorenz, NotReadable, Trend } from './charts'
import { CHAIN_NAMES, clusterRows, fmtInt, fmtPct, HM_C, isInfraNode, lorenz, rankBands, supplySplit, timelineSeries } from './insights'
import { HmLoading, HmState } from './HmStates'
import { useNow } from './hooks'
import { HmSearch } from './HmSearch'
import './hm.css'
import './hm-app.css'


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
    <div className="hm-page hm-token">
      <Seo title={title} description={description} />
      <nav aria-label="Breadcrumb" className="hm-crumbs">
        <Link to="/">HolderMaps</Link>
        <ChevronRight aria-hidden className="hm-ic sm" />
        <span className="hm-crumb-chain">
          <ChainLogo chain={chain} size={16} decorative /> {chainName}
        </span>
        <ChevronRight aria-hidden className="hm-ic sm" />
        <span aria-current="page" className="hm-crumb-tok">
          {symbol ?? `${token.slice(0, 6)}…${token.slice(-4)}`}
        </span>
        {ok && (ok.kind === 'token' || ok.kind === 'launch' || ok.kind === 'deepcore-launch') && ok.token.url && (
          <a className="hm-crumb-ext" href={ok.token.url} target="_blank" rel="noopener noreferrer">
            Explorer <ArrowUpRight aria-hidden className="hm-ic sm" />
            <span className="hm-sr"> (opens in a new tab)</span>
          </a>
        )}
      </nav>

      {load.k === 'loading' ? (
        <>
          <h1 className="hm-sr">{title}</h1>
          <HmLoading />
        </>
      ) : load.k === 'error' ? (
        <>
          <h1 className="hm-sr">{title}</h1>
          <HmState pose="hologram" eyebrow="NO ANSWER" title="The map did not answer" text="HolderMaps could not be reached just now. Nothing is wrong with the token; try again in a moment." testId="hm-error">
            <button type="button" className="hm-btn" onClick={() => window.location.reload()}>
              <RefreshCw aria-hidden className="hm-ic" /> Try again
            </button>
            <Link className="hm-btn ghost" to="/">
              Map another token
            </Link>
          </HmState>
        </>
      ) : m && m.state !== 'ok' ? (
        <>
          <h1 className="hm-sr">{title}</h1>
          {m.state === 'unavailable' && typeof m.progress === 'number' ? (
            <HmLoading progress={m.progress} label="Reading this token’s history" />
          ) : m.state === 'not-found' ? (
            <HmState pose="point" eyebrow="NOT A TOKEN" title="Nothing to map at this address" text={<>{m.reason} Paste a token address or a ticker and HolderMaps checks every chain it covers at once.</>} testId="hm-not-found">
              <HmSearch compact />
            </HmState>
          ) : comingSoon ? (
            <HmState pose="backpack" eyebrow="COMING SOON" title={`Maps on ${m.chain?.name ?? chainName} are on the way`} text={`Holder data for ${m.chain?.name ?? chainName} is not wired up yet. Tokens on the other chains already have live maps.`} testId="hm-coming-soon">
              <Link className="hm-btn" to="/#top">
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
        </>
      ) : ok ? (
        <>
          <div className="hm-mapwrap">
            <HolderMap chain={chain} token={token} page />
          </div>
          <Insights m={ok} />
          <HolderTable m={ok} />
          <DeepCheckCard key={`${ok.chain.key}:${ok.token.address}`} chain={ok.chain.key} token={ok.token.address} symbol={symbol} />
          <BadgeBlock chain={ok.chain.key} token={ok.token.address} />
        </>
      ) : null}
    </div>
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

function Card({ title, sub, children, wide = false, id }: { title: string; sub?: React.ReactNode; children: React.ReactNode; wide?: boolean; id?: string }) {
  return (
    <section className={`hm-card ${wide ? 'wide' : ''}`} aria-labelledby={id}>
      <header>
        <h3 id={id}>{title}</h3>
        {sub && <p>{sub}</p>}
      </header>
      {children}
    </section>
  )
}

function Insights({ m }: { m: HolderMapOk }) {
  const now = useNow(30_000)
  const split = supplySplit(m)
  const bands = rankBands(m)
  const lz = lorenz(m)
  const clusters = clusterRows(m)
  const tl = timelineSeries(m)
  const listed = m.nodes.length
  const scope = m.holders.sharesOf === 'total supply' ? 'of the total supply' : 'of what the listed holders hold'
  return (
    <section className="hm-insights" aria-labelledby="hm-read">
      <div className="hm-sec-head">
        <div>
          <span className="hm-eyebrow">
            <i className="hm-dot" aria-hidden /> LIVE · {m.asOf ? ageText(m.asOf, now).toUpperCase() : 'JUST NOW'}
          </span>
          <h2 id="hm-read" className="h2">
            Read the map
          </h2>
        </div>
        <ul className="hm-chips" aria-label="About this map">
          <li>
            <b className="num">{m.holders.count === null ? 'not readable' : fmtInt(m.holders.count)}</b> holders
          </li>
          <li>
            <b className="num">{fmtInt(listed)}</b> on the map
          </li>
          <li>{m.coverage?.level === 'top' ? 'Top holders only' : 'Full history'}</li>
          <li>Shares {scope}</li>
        </ul>
      </div>
      <div className="hm-grid">
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
          {bands ? <Bars rows={bands.map((b, i) => ({ id: String(i), label: b.label, value: b.value, color: i === 0 ? HM_C.yellow : i === 1 ? HM_C.hi : HM_C.white, aria: `${b.label}: ${fmtPct(b.value)}` }))} /> : <NotReadable text="No shares readable for this token" />}
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
        <Card title="Bubble map" sub="The biggest holders, sized by share. Yellow ones are linked." id="hm-c-field">
          <BubbleField m={m} max={30} height={240} />
        </Card>
      </div>
      <div className="hm-grid hm-grid-2">
        <Card title="Holders over time" sub={tl.basis ?? 'From the map’s replay frames.'} id="hm-c-holders">
          {tl.holders ? <Trend values={tl.holders} labels={tl.labels} fmt={fmtInt} label="Holder count over time" /> : <NotReadable text="No holder-count history recorded for this token yet" height={140} />}
        </Card>
        <Card title="Top 10 share over time" sub="Concentration at each replay frame." id="hm-c-top10t">
          {tl.top10 ? <Trend values={tl.top10} labels={tl.labels} fmt={fmtPct} label="Top 10 share over time" color={HM_C.hi} /> : <NotReadable text="No concentration history recorded for this token yet" height={140} />}
        </Card>
      </div>
    </section>
  )
}

/** The biggest holders as a table: rank, wallet (explorer link), what it is, share bar, balance. */
function HolderTable({ m }: { m: HolderMapOk }) {
  const rows = m.nodes.slice(0, 25)
  const top = Math.max(0.0001, ...rows.map((n) => n.pct ?? 0))
  return (
    <section className="hm-card wide hm-table" aria-labelledby="hm-holders">
      <header>
        <h3 id="hm-holders">Top holders</h3>
        <p>
          The {rows.length} biggest of {m.holders.count === null ? 'an unreadable number of' : fmtInt(m.holders.count)} holders. Wallet links open the chain’s explorer.
        </p>
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
