/* holdermaps.xyz/: HolderMaps' front door, Gully Terminal redesign (2026-10-27). One screen and a half at 1440 px:
     the live ticker      today's most scanned maps (GET /api/holders/top)
     the hero             the question, the search with its chain picker and stepper, the chains; beside it a
                          chart-led panel (launches checked per hour, Gully Chain transactions per hour, maps per
                          day) and four stat tiles with sparklines
     Live (tabs)          map of the moment, most scanned, new launches, holder sources
     Chains + Build       the coverage table (Gully Chain 485590 first) and the embed/widget stepper
   Every figure is read live from HolderMaps' own APIs, nothing is typed in:
     GET /api/holders/top?limit=20            maps opened today (ticker, tiles, most scanned, the spotlight token)
     GET /api/holders/<chain>/<token>?peek=1  the spotlight map (peek: reading it here never counts as a scan)
     GET /api/holders/launches                launches as they are checked (every 30 s)
     GET /api/holders/sources                 which chains have maps
     GET /api/hub/products                    maps per day, Gully Chain per hour
     GET /api/status (LiveProvider)           each holder source's last 24 h
   A source that cannot be read says so; an empty day says so (with the mascot), never a zero. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Flame, Layers, Link2, Map as MapIcon, Plug, Radar } from 'lucide-react'
import { Seo } from '../components/Seo'
import { ChainLogo } from '../components/logos/ChainLogo'
import { useLiveSeries } from '../components/charts/useLiveSeries'
import { Spark } from '../console/ui'
import { useLive } from '../console/live'
import { consoleToast } from '../console/toast'
import type { CheckedLaunches, HolderMap, HolderSources, TopScanned } from '../lib/holders'
import { holderHref } from '../site-host'
import { Feed } from '../pages/HoldersLanding'
import { Dot, HBars, Kpi, TChart, useHubProducts, type ChartTab } from '../terminal/kit'
import { useNow, usePoll, type Poll } from './hooks'
import { BubbleField, Donut, Gauge, NotReadable } from './charts'
import { CHAIN_NAMES, fmtInt, fmtPct, PICK_CHAINS, supplySplit } from './insights'
import { HmSearch } from './HmSearch'
import { HmTabs } from './HmKit'
import { HmIntegrate } from './HmIntegrate'
import { Mascot } from './Mascot'
import { Tape } from './HmTape'
import '../terminal/terminal.css'
import './hm.css'
import './hm-app.css'

const HOUR = 3_600_000
const Y = '#FFD52E'
const hh = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export function HmLanding() {
  const now = useNow()
  const feed = usePoll<CheckedLaunches>('/api/holders/launches', 30_000)
  const top = usePoll<TopScanned>('/api/holders/top?limit=20', 60_000)
  const sources = usePoll<HolderSources>('/api/holders/sources', 0)
  const items = top.k === 'ok' ? top.data.items : null
  const [tab, setTab] = useState('spot')
  useNewScanToast(items)
  const live = sources.k === 'ok' ? sources.data.chains.filter((c) => c.any !== 'none' || c.launches).length : null
  return (
    <div className="gt hmt hm-landing">
      <Seo title="Who really holds a token? Holder bubble maps" description="Map any token’s holders on Gully Chain, Robinhood Chain, BNB Chain, Base, HyperEVM or Solana: top wallets, linked clusters and launch health, read live." />
      <Tape items={items} state={top.k} />

      <section id="map" className="hmt-hero" aria-labelledby="hm-h1">
        <div className="hm-wrap">
          <div className="hmt-copy">
            <span className="hmt-lbl">
              <i className="hm-dot" aria-hidden /> Live on {live ?? '…'} chains · free, no sign-up
            </span>
            <div className="hmt-title">
              <h1 id="hm-h1" className="hmt-h1">
                Who <em>really</em> holds it?
              </h1>
              <Mascot pose="map" width={112} className="hmt-masc" />
            </div>
            <p className="hmt-lede">Paste any token. HolderMaps draws its biggest wallets as bubbles, joins the ones that trade with each other, and tells you how concentrated it is, in seconds.</p>
            <HmSearch />
            <ChainChips s={sources} />
          </div>
          <HeroSide feed={feed.k === 'ok' ? feed.data : null} feedState={feed.k} items={items} now={now} />
        </div>
      </section>

      <section id="live" className="hmt-sec" aria-labelledby="hm-live">
        <div className="hm-wrap">
          <div className="hmt-sh">
            <div>
              <span className="gt-k">
                <b>01</b> / Live
              </span>
              <h2 id="hm-live">Today on HolderMaps</h2>
            </div>
            <Dot s={top.k === 'ok' ? 'up' : top.k === 'error' ? 'down' : 'reading'} label={top.k === 'ok' ? `read ${hh(now)}` : undefined} />
          </div>
          <HmTabs
            label="Live on HolderMaps"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'spot', label: 'Map of the moment', icon: MapIcon, content: <Spotlight key={items?.[0] ? `${items[0].chain}:${items[0].token}` : 'none'} item={items?.[0] ?? null} state={top.k} /> },
              { id: 'top', label: 'Most scanned', icon: Flame, content: <TopScans s={top} /> },
              { id: 'launches', label: 'New launches', icon: Radar, content: <Feed s={feed} now={now} /> },
              { id: 'sources', label: 'Holder sources', icon: Layers, content: <SourceHealth /> },
            ]}
          />
        </div>
      </section>

      <section className="hmt-sec" aria-label="Chains and integrations">
        <div className="hm-wrap hmt-grid2">
          <section id="chains" className="gt-panel" aria-labelledby="hm-chains">
            <header>
              <span className="gt-k" id="hm-chains">
                <Link2 className="hm-ic" aria-hidden /> 02 / Every chain we map
              </span>
              <Dot s={sources.k === 'ok' ? 'up' : sources.k === 'error' ? 'down' : 'reading'} label={sources.k === 'ok' ? `${live} live` : undefined} />
            </header>
            <Chains s={sources} />
          </section>
          <section id="build" className="gt-panel" aria-labelledby="hm-build">
            <header>
              <span className="gt-k" id="hm-build">
                <Plug className="hm-ic" aria-hidden /> 03 / Put a live map on your site
              </span>
            </header>
            <div className="hmt-card">
              <HmIntegrate chain={items?.[0]?.chain ?? null} token={items?.[0]?.token ?? null} symbol={items?.[0]?.symbol ?? null} />
            </div>
          </section>
        </div>
      </section>
    </div>
  )
}

/** A toast when a token enters today's most-scanned list (a real event: someone opened its map). */
function useNewScanToast(items: TopScanned['items'] | null) {
  const known = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!items) return
    const keys = new Set(items.map((x) => `${x.chain}:${x.token}`))
    if (known.current) {
      const fresh = items.find((x) => !known.current?.has(`${x.chain}:${x.token}`))
      if (fresh) consoleToast({ title: 'Newly mapped', text: `${fresh.symbol ?? 'A token'} on ${CHAIN_NAMES[fresh.chain] ?? fresh.chain} was just opened.`, icon: 'activity' })
    }
    known.current = keys
  }, [items])
}

function ChainChips({ s }: { s: Poll<HolderSources> }) {
  if (s.k === 'error') return <p className="hm-note">Which chains have maps could not be read just now.</p>
  if (s.k !== 'ok')
    return (
      <ul className="hm-chainchips" aria-hidden>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li key={i} className="skel" />
        ))}
      </ul>
    )
  const WORDS = { full: 'full history', top: 'top holders', none: 'launches only' } as const
  const chains = [...s.data.chains].sort((a, b) => PICK_CHAINS.indexOf(a.chain as never) - PICK_CHAINS.indexOf(b.chain as never))
  return (
    <ul className="hm-chainchips" aria-label="Where maps work today" data-holder-sources>
      {chains.map((c) => (
        <li key={c.chain} className={`${c.any === 'none' && !c.launches ? 'off' : ''} ${c.chain === 'gully' ? 'own' : ''}`}>
          <ChainLogo chain={c.chain} size={14} decorative />
          <span>{c.chain === 'gully' ? 'Gully Chain' : c.name}</span>
          <em>{c.any === 'none' && !c.launches ? 'soon' : WORDS[c.any]}</em>
        </li>
      ))}
    </ul>
  )
}

/** The hero's right side: a live chart (three views) over four stat tiles with sparklines. */
function HeroSide({ feed, feedState, items, now }: { feed: CheckedLaunches | null; feedState: 'loading' | 'error' | 'ok'; items: TopScanned['items'] | null; now: number }) {
  const { status } = useLive()
  const hub = useHubProducts()
  const src = (status?.components ?? []).filter((c) => c.group === 'holders' && c.state !== 'off')
  const known = src.filter((c) => c.uptime24h != null)
  const up = known.length ? Math.round(Math.min(...known.map((c) => c.uptime24h as number)) * 1000) / 10 : null
  const upLine = (src[0]?.history ?? []).map((_, i) => {
    const vals = src.map((c) => c.history[i]?.up).filter((v): v is number => typeof v === 'number')
    return vals.length ? Math.round(Math.min(...vals) * 1000) / 10 : null
  })
  const end = Math.floor(now / HOUR) * HOUR
  const hours = Array.from({ length: 24 }, (_, i) => end - (23 - i) * HOUR)
  const perHour = feed ? hours.map((h) => feed.launches.filter((l) => { const t = Date.parse(l.createdAt); return t >= h && t < h + HOUR }).length) : []
  const scans = items ? items.reduce((a, b) => a + b.scans, 0) : null
  const chainH = hub.data?.chain?.hourly ?? []
  const daily = hub.data?.holders?.daily ?? []
  const hubState = hub.state === 'ok' ? 'ok' : hub.state === 'error' ? 'offline' : 'loading'
  const tabs: ChartTab[] = [
    {
      id: 'launches',
      label: 'Launches',
      title: 'Launches checked per hour, last 24 h',
      series: [{ name: 'Launches', color: Y, values: perHour }],
      labels: hours.map(hh),
      fmt: (v) => fmtInt(v ?? 0),
      integer: true,
      state: feedState === 'ok' ? 'ok' : feedState === 'error' ? 'offline' : 'loading',
      empty: 'the launch feed could not be read · retrying every 30 s',
      head: feed ? fmtInt(feed.launches.length) : '—',
      sub: 'launches in the live feed · per hour, last 24 h',
    },
    {
      id: 'gully',
      label: 'Gully Chain',
      title: 'Gully Chain Testnet (485590) transactions per hour',
      series: [{ name: 'Transactions', color: Y, values: chainH.map((r) => r.txs) }],
      labels: chainH.map((r) => hh(r.t * 1000)),
      fmt: (v) => fmtInt(v ?? 0),
      integer: true,
      state: hubState === 'ok' ? (hub.data?.chain ? 'ok' : 'offline') : hubState,
      empty: 'Gully Chain could not be read · retrying every minute',
      head: hub.data?.chain ? fmtInt(chainH.reduce((a, r) => a + r.txs, 0)) : '—',
      sub: 'transactions on chain 485590 · every token on it maps here',
    },
    {
      id: 'daily',
      label: 'Maps / day',
      title: 'HolderMaps maps opened per day',
      series: [{ name: 'Maps', color: Y, values: daily.map((d) => d.maps) }],
      labels: daily.map((d) => d.day.slice(5)),
      fmt: (v) => fmtInt(v ?? 0),
      integer: true,
      state: hubState === 'ok' ? (hub.data?.holders ? 'ok' : 'offline') : hubState,
      empty: daily.length < 2 ? 'one day recorded so far · the line starts tomorrow' : undefined,
      head: hub.data?.holders ? fmtInt(hub.data.holders.today) : '—',
      sub: 'maps opened today (UTC)',
    },
  ]
  return (
    <div className="hmt-side">
      <TChart label={<><Radar className="hm-ic" aria-hidden /> Live · holder activity</>} tabs={tabs} height={150} right={<Dot s={feedState === 'ok' ? 'up' : feedState === 'error' ? 'down' : 'reading'} label="" />} />
      <div className="gt-kpis k4">
        <Kpi label="Maps today" value={scans} spark={items ? items.slice(0, 12).map((x) => x.scans) : []} color={Y} sub={items ? `${items.length} tokens · top first` : 'reading'} />
        <Kpi label="Tokens mapped" value={hub.data?.holders?.tokens ?? (items ? items.length : null)} spark={(hub.data?.holders?.byChain ?? []).map((c) => c.maps)} color={Y} sub={hub.data?.holders ? `${hub.data.holders.byChain.length} chains today` : 'reading'} />
        <Kpi label="Launches · 24 h" value={feed ? perHour.reduce((a, b) => a + b, 0) : null} spark={perHour.slice(-12)} color={Y} sub={feed ? 'per hour, last 12 h' : 'reading the feed'} />
        <Kpi label="Sources · 24 h" value={up} fmt={(v) => `${v}%`} spark={upLine} color={Y} sub={src.length ? `weakest of ${src.length}` : 'reading status'} />
      </div>
    </div>
  )
}

/** One map, read without counting as a scan, re-read every five minutes. */
function usePeekMap(chain: string | null, token: string | null) {
  const { data, error } = useLiveSeries<HolderMap | null>(
    (signal) =>
      chain && token
        ? fetch(`/api/holders/${encodeURIComponent(chain)}/${encodeURIComponent(token)}?peek=1`, { headers: { accept: 'application/json' }, signal }).then((r) => r.json() as Promise<HolderMap>)
        : Promise.resolve(null),
    300_000,
    { enabled: !!(chain && token) },
  )
  return { data, error }
}

/** Map of the moment: today's most scanned token, live. */
function Spotlight({ item, state }: { item: TopScanned['items'][number] | null; state: 'loading' | 'error' | 'ok' }) {
  const { data, error } = usePeekMap(item?.chain ?? null, item?.token ?? null)
  const m = data && data.state === 'ok' ? data : null
  const split = useMemo(() => (m ? supplySplit(m) : null), [m])
  if (state === 'ok' && !item)
    return (
      <div className="hmt-empty" data-testid="hm-spot-empty">
        <Mascot pose="point" width={104} />
        <div>
          <h3>No map opened yet today</h3>
          <p>The day’s most scanned token appears here with its live bubble map and charts. Paste a token above to start the day.</p>
          <Link className="hm-btn" to="/#map">
            Paste a token
          </Link>
        </div>
      </div>
    )
  return (
    <div className="hmt-spot">
      <section className="gt-panel" aria-label="Bubble map">
        <header>
          <span className="gt-k">
            <MapIcon className="hm-ic" aria-hidden /> {item ? `${item.symbol ? `$${item.symbol}` : 'Top token'} · ${item.chain === 'gully' ? 'Gully Chain' : (CHAIN_NAMES[item.chain] ?? item.chain)}` : 'Most scanned today'}
          </span>
          {item && (
            <Link className="hm-btn ghost sm" to={holderHref(item.path)}>
              Open the full map <ArrowRight aria-hidden className="hm-ic sm" />
            </Link>
          )}
        </header>
        <div style={{ padding: 8 }}>
          {m ? <BubbleField m={m} max={36} height={280} /> : error || state === 'error' || (data && data.state !== 'ok') ? <NotReadable text={data && data.state !== 'ok' ? data.reason : 'This map could not be read just now; it retries every five minutes.'} height={280} /> : <div className="hmt-skel" style={{ height: 280 }} role="status" aria-label="Reading the map" />}
        </div>
      </section>
      <div className="hmt-spot-side">
        <section className="gt-panel" aria-label="Top 10 hold">
          <header>
            <span className="gt-k">Top 10 hold</span>
          </header>
          <div className="hmt-card">{m ? <Gauge value={m.summary.top10Pct} label="Top 10 holders' share" caption={m.summary.line} /> : <div className="hmt-skel" style={{ height: 150 }} aria-hidden />}</div>
        </section>
        <section className="gt-panel" aria-label="Who holds the supply">
          <header>
            <span className="gt-k">Who holds the supply</span>
          </header>
          <div className="hmt-card">
            {m && split ? (
              <Donut segments={split.segments} total={split.ofSupply ? 100 : split.segments.reduce((a, s) => a + s.value, 0)} centre={{ k: 'wallets on the map', v: fmtInt(split.listed) }} label="Who holds the supply" />
            ) : m ? (
              <NotReadable text="No shares readable for this token" />
            ) : (
              <div className="hmt-skel" style={{ height: 150 }} aria-hidden />
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function TopScans({ s }: { s: Poll<TopScanned> }) {
  if (s.k === 'loading') return <div className="hmt-skel" style={{ height: 220 }} role="status" aria-label="Reading the most scanned maps" />
  if (s.k === 'error') return <NotReadable text="Today’s scans could not be read just now; retrying every minute." />
  const items = s.data.items
  if (!items.length)
    return (
      <div className="hmt-empty" data-testid="most-scanned-empty">
        <Mascot pose="point" width={80} />
        <div>
          <p>No maps opened yet today. Search one above and it ranks here.</p>
        </div>
      </div>
    )
  const total = Math.max(1, items.reduce((a, b) => a + b.scans, 0))
  return (
    <div className="gt-panel">
      <header>
        <span className="gt-k">
          <Flame className="hm-ic" aria-hidden /> Unique visitors per map today (UTC)
        </span>
        <span className="gt-k">{fmtPct((items[0].scans / total) * 100)} to the top one</span>
      </header>
      <HBars
        rows={items.slice(0, 10).map((x) => ({
          label: (
            <span className="hm-bar-link">
              <ChainLogo chain={x.chain} size={14} decorative /> {x.symbol ?? `${x.token.slice(0, 6)}…`} · {x.chain === 'gully' ? 'Gully Chain' : (CHAIN_NAMES[x.chain] ?? x.chain)}
            </span>
          ),
          value: x.scans,
          href: holderHref(x.path),
        }))}
      />
      <p className="gt-note" data-top-scanned>
        {items.length} tokens mapped today · {fmtInt(total)} scans
      </p>
    </div>
  )
}

/** Each chain's holder source over the last 24 h (GET /api/status, group "holders"). */
function SourceHealth() {
  const { status } = useLive()
  if (!status) return <div className="hmt-skel" style={{ height: 220 }} role="status" aria-label="Reading status" />
  const src = status.components.filter((c) => c.group === 'holders')
  if (!src.length) return <NotReadable text="No holder sources in the status feed" />
  return (
    <div className="gt-panel">
      <header>
        <span className="gt-k">
          <Layers className="hm-ic" aria-hidden /> Each chain’s holder source, checked every minute
        </span>
      </header>
      <ul className="hm-src">
        {src.map((c) => (
          <li key={c.id} className={c.state}>
            <span className="n">{c.name.replace(/^Holder Map: /, '')}</span>
            <span className="v num">{c.state === 'off' ? 'not set up' : c.uptime24h == null ? 'not readable' : `${Math.round(c.uptime24h * 1000) / 10}%`}</span>
            <span className="sp">{c.state === 'off' ? null : <Spark values={c.history.map((h) => (typeof h.up === 'number' ? Math.round(h.up * 1000) / 10 : null))} color={Y} h={22} />}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Chains({ s }: { s: Poll<HolderSources> }) {
  if (s.k === 'error') return <NotReadable text="The chain list could not be read just now." />
  if (s.k !== 'ok') return <div className="hmt-skel" style={{ height: 240, margin: 16 }} role="status" aria-label="Reading chains" />
  const chains = [...s.data.chains].sort((a, b) => PICK_CHAINS.indexOf(a.chain as never) - PICK_CHAINS.indexOf(b.chain as never))
  const yn = (v: boolean, y: string, n: string) => <span className={v ? 'hmt-yes' : 'hmt-no'}>{v ? y : n}</span>
  return (
    <div className="hmt-scroll">
      <table className="hmt-table">
        <caption className="hm-sr">Chains HolderMaps covers and what works on each</caption>
        <thead>
          <tr>
            <th scope="col">Chain</th>
            <th scope="col">Any token</th>
            <th scope="col">Launches</th>
            <th scope="col">Stocks</th>
          </tr>
        </thead>
        <tbody>
          {chains.map((c, i) => (
            <tr key={c.chain} className={c.chain === 'gully' ? 'own' : ''} style={{ ['--d' as string]: `${i * 60}ms` }}>
              <td>
                <span className="c">
                  <ChainLogo chain={c.chain} size={16} decorative /> {c.chain === 'gully' ? 'Gully Chain' : c.name}
                  {c.chain === 'gully' && <span className="id">485590</span>}
                </span>
              </td>
              <td>{yn(c.any !== 'none', c.any === 'full' ? 'full history' : 'top holders', 'soon')}</td>
              <td>{yn(!!c.launches, 'checked live', 'none')}</td>
              <td>{yn(!!c.stocks, 'mapped', 'none')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="gt-note">Gully Chain is Gully Labs’ own L3 (testnet, chain 485590), read from our own archive node.</p>
    </div>
  )
}
