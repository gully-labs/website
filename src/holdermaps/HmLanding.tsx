/* holdermaps.xyz/: HolderMaps' front door (redesign 2026-10-26). Every figure is read live from the Holder Map's own
   APIs, nothing is typed in:
     GET /api/holders/top?limit=20        maps opened today (ticker, "most scanned" bars, the spotlight token)
     GET /api/holders/<chain>/<token>?peek=1   the spotlight map (peek: reading it here never counts as a scan)
     GET /api/holders/launches            new launches as they are checked (every 30 s)
     GET /api/holders/sources             which chains have maps today
     GET /api/status (LiveProvider)       each holder source's last 24 h
   A source that cannot be read says so; an empty day says so (with the mascot), never a zero.
   The gullylabs.xyz /holders page keeps its own layout (src/pages/HoldersLanding.tsx). */
import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router'
import { ArrowRight, ArrowUpRight, BookOpen, Code2, Flame, KeyRound, Layers, Map as MapIcon, Plug, Radar, ScanSearch, Search, Sparkles, type LucideProps } from 'lucide-react'
import type { ComponentType } from 'react'
import { Seo } from '../components/Seo'
import { ChainLogo } from '../components/logos/ChainLogo'
import { useLiveSeries } from '../components/charts/useLiveSeries'
import { Count, Spark, Stepper, type Step } from '../console/ui'
import { useLive } from '../console/live'
import { consoleToast } from '../console/toast'
import type { CheckedLaunches, HolderMap, HolderSources, TopScanned } from '../lib/holders'
import { holderHref } from '../site-host'
import { Feed } from '../pages/HoldersLanding'
import { useNow, usePoll, type Poll } from './hooks'
import { Bars, BubbleField, Donut, Gauge, NotReadable } from './charts'
import { CHAIN_NAMES, fmtInt, fmtPct, HM_C, supplySplit } from './insights'
import { HmSearch } from './HmSearch'
import { Mascot } from './Mascot'
import './hm.css'
import './hm-app.css'

type Icon = ComponentType<LucideProps>
const HOUR = 3_600_000
const DOCS = 'https://docs.gullylabs.xyz'

export function HmLanding() {
  const now = useNow()
  const feed = usePoll<CheckedLaunches>('/api/holders/launches', 30_000)
  const top = usePoll<TopScanned>('/api/holders/top?limit=20', 60_000)
  const sources = usePoll<HolderSources>('/api/holders/sources', 0)
  const items = top.k === 'ok' ? top.data.items : null
  useNewScanToast(items)
  return (
    <div className="hm-page hm-landing">
      <Seo title="Who really holds a token? Holder bubble maps" description="Map any token’s holders on Gully Chain, Robinhood Chain, BNB Chain, Base, HyperEVM or Solana: top wallets, linked clusters and launch health, read live." />

      {/* 1. Hero: the question, the search, the chains; the mascot reading its map beside the live figures. */}
      <section id="map" className="hm-hero2" aria-labelledby="hm-h1">
        <div className="hm-hero-copy">
          <span className="hm-eyebrow">
            <i className="hm-dot" aria-hidden /> LIVE ON {sources.k === 'ok' ? sources.data.chains.filter((c) => c.any !== 'none' || c.launches).length : '…'} CHAINS · FREE, NO SIGN-UP
          </span>
          <h1 id="hm-h1" className="hm-h1">
            Who <em>really</em> holds it?
          </h1>
          <p className="hm-lead">Paste any token. HolderMaps draws its biggest wallets as bubbles, joins the ones that trade with each other, and tells you how concentrated it is, in seconds.</p>
          <HmSearch />
          <ChainChips s={sources} />
        </div>
        <HeroStage feed={feed.k === 'ok' ? feed.data : null} items={items} now={now} />
      </section>

      {/* 2. Recently mapped: today's scans as a moving strip. */}
      <Strip items={items} state={top.k} />

      {/* 3. Map of the moment: the most scanned token's live map and charts. */}
      <Spotlight key={items?.[0] ? `${items[0].chain}:${items[0].token}` : 'none'} item={items?.[0] ?? null} state={top.k} />

      {/* 4. Live activity. */}
      <div className="hm-grid hm-grid-live">
        <section id="top" className="hm-card" aria-labelledby="hm-top">
          <header>
            <h2 id="hm-top" className="h3">
              <Flame aria-hidden className="hm-ic" /> Most scanned today
            </h2>
            <p>Unique visitors who opened each map today (UTC).</p>
          </header>
          <TopScans s={top} />
        </section>
        <section id="launches" className="hm-card" aria-labelledby="hm-feed">
          <header>
            <h2 id="hm-feed" className="h3">
              <Radar aria-hidden className="hm-ic" /> New launches, checked
            </h2>
            <p>DeepCore launches with a health score as each check finishes.</p>
          </header>
          <Feed s={feed} now={now} />
        </section>
        <section className="hm-card" aria-labelledby="hm-src">
          <header>
            <h2 id="hm-src" className="h3">
              <Layers aria-hidden className="hm-ic" /> Holder sources · 24 h
            </h2>
            <p>Each chain’s holder source, checked every minute.</p>
          </header>
          <SourceHealth />
        </section>
      </div>

      {/* 5. Chains. */}
      <Chains s={sources} />

      {/* 6. How it works. */}
      <section className="hm-how" aria-labelledby="hm-how">
        <div className="hm-how-art" aria-hidden>
          <Mascot pose="laptop" width={220} />
        </div>
        <div className="hm-how-body">
          <span className="hm-eyebrow">HOW IT WORKS</span>
          <h2 id="hm-how" className="h2">
            Three steps from address to answer
          </h2>
          <Stepper steps={HOW} cta={<Link className="hm-btn" to="/#map">Map a token</Link>} />
        </div>
      </section>

      {/* 7. How to read a map. */}
      <section aria-labelledby="hm-read" className="hm-read">
        <h2 id="hm-read" className="h2">
          How to read a map
        </h2>
        <div className="hm-read-grid">
          {READ.map(([t, d, I], i) => (
            <div key={t as string} className="hm-card hm-read-card" style={{ ['--d' as string]: `${i * 80}ms` }}>
              <span className="hm-read-ic" aria-hidden>
                {(() => {
                  const C = I as Icon
                  return <C className="hm-ic" />
                })()}
              </span>
              <h3>{t as string}</h3>
              <p>{d as string}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 8. Build with it. */}
      <section className="hm-build" aria-labelledby="hm-build">
        <div className="hm-build-body">
          <span className="hm-eyebrow">FOR BUILDERS</span>
          <h2 id="hm-build" className="h2">
            Put a live map on your site
          </h2>
          <p>Embed any token’s map with one line, read holders and clusters from the API with a Gully Labs key, or add the HolderMaps badge to your launch page.</p>
          <div className="hm-build-links">
            <a className="hm-btn" href={`${DOCS}/holder-map-integrate`} target="_blank" rel="noopener noreferrer">
              <Plug aria-hidden className="hm-ic" /> Embed a map <ArrowUpRight aria-hidden className="hm-ic sm" />
              <span className="hm-sr"> (opens in a new tab)</span>
            </a>
            <a className="hm-btn ghost" href={`${DOCS}/api#holders`} target="_blank" rel="noopener noreferrer">
              <Code2 aria-hidden className="hm-ic" /> API <ArrowUpRight aria-hidden className="hm-ic sm" />
              <span className="hm-sr"> (opens in a new tab)</span>
            </a>
            <a className="hm-btn ghost" href={`${DOCS}/holder-map`} target="_blank" rel="noopener noreferrer">
              <BookOpen aria-hidden className="hm-ic" /> Docs <ArrowUpRight aria-hidden className="hm-ic sm" />
              <span className="hm-sr"> (opens in a new tab)</span>
            </a>
          </div>
        </div>
        <div className="hm-build-art" aria-hidden>
          <Mascot pose="backpack" width={200} />
        </div>
      </section>
    </div>
  )
}

const HOW: Step[] = [
  { icon: Search, title: 'Paste a token', body: <>Any token address on Gully Chain, Robinhood Chain, BNB Chain, Base, HyperEVM or Solana, or a ticker. <b>Every chain is checked at once.</b></> },
  { icon: ScanSearch, title: 'We read the chain', body: <>The biggest holders, who sent tokens to whom, pools, locks and burns, and for launches the first blocks of trading. <b>Read live, nothing estimated.</b></> },
  { icon: MapIcon, title: 'Read the map', body: <>Bubbles sized by share, linked wallets in yellow, concentration charts, a replay since launch and live transfers. <b>Share it with one link.</b></> },
]
const READ: [string, string, Icon][] = [
  ['Bubbles', 'One wallet each, sized by its share. Grey ones are pools, locks, burn addresses and exchanges, not people.', MapIcon],
  ['Yellow clusters', 'Wallets that sent the token to each other. A big cluster is often one holder behind many wallets.', Sparkles],
  ['Health score', 'For launches: liquidity lock, bundled buys, snipers, the deployer’s share and record, the top 10.', KeyRound],
  ['Live and replay', 'Watch transfers as they happen, or replay how holdings spread since launch.', Radar],
]

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
  return (
    <ul className="hm-chainchips" aria-label="Where maps work today" data-holder-sources>
      {s.data.chains.map((c) => (
        <li key={c.chain} className={c.any === 'none' && !c.launches ? 'off' : ''}>
          <ChainLogo chain={c.chain} size={16} decorative />
          <span>{c.chain === 'gully' ? 'Gully Chain' : c.name}</span>
          <em>{c.any === 'none' && !c.launches ? 'soon' : WORDS[c.any]}</em>
        </li>
      ))}
    </ul>
  )
}

/** The hero stage: the mascot reading its map, three live figures with their lines. */
function HeroStage({ feed, items, now }: { feed: CheckedLaunches | null; items: TopScanned['items'] | null; now: number }) {
  const { status } = useLive()
  const src = (status?.components ?? []).filter((c) => c.group === 'holders' && c.state !== 'off')
  const known = src.filter((c) => c.uptime24h != null)
  const up = known.length ? Math.round(Math.min(...known.map((c) => c.uptime24h as number)) * 1000) / 10 : null
  const upLine = (src[0]?.history ?? []).map((_, i) => {
    const vals = src.map((c) => c.history[i]?.up).filter((v): v is number => typeof v === 'number')
    return vals.length ? Math.round(Math.min(...vals) * 1000) / 10 : null
  })
  const end = Math.floor(now / HOUR) * HOUR
  const perHour = feed ? Array.from({ length: 12 }, (_, i) => end - (11 - i) * HOUR).map((h) => feed.launches.filter((l) => { const t = Date.parse(l.createdAt); return t >= h && t < h + HOUR }).length) : []
  const scans = items ? items.reduce((a, b) => a + b.scans, 0) : null
  return (
    <div className="hm-stage2" aria-label="HolderMaps, live">
      <div className="hm-stage-art" aria-hidden>
        <span className="hm-orbit" />
        <span className="hm-orbit o2" />
        <span className="hm-orbit o3" />
        <Mascot pose="map" width={300} />
      </div>
      <div className="hm-stage-figs">
        <div className="hm-fig2">
          <span className="k">Maps opened today</span>
          <Count className="v num" value={scans} />
          <Spark values={items ? items.slice(0, 12).map((x) => x.scans) : []} color="#FFE03A" />
          <span className="s">{items ? (items.length ? `${items.length} tokens · most scanned first` : 'No maps opened yet today') : 'reading today’s scans'}</span>
        </div>
        <div className="hm-fig2">
          <span className="k">Launches in the feed</span>
          <Count className="v num" value={feed ? feed.launches.length : null} />
          <Spark values={perHour} color="#FFD52E" />
          <span className="s">{feed ? 'per hour, last 12 h' : 'reading the launch feed'}</span>
        </div>
        <div className="hm-fig2">
          <span className="k">Holder sources · 24 h</span>
          <Count className="v num" value={up} fmt={(v) => `${v}%`} />
          <Spark values={upLine} color="#FDB813" />
          <span className="s">{src.length ? `weakest of ${src.length} sources, read every minute` : 'reading status'}</span>
        </div>
      </div>
    </div>
  )
}

/** Recently mapped: today's most scanned tokens as a moving strip (still and scrollable under reduced motion). */
function Strip({ items, state }: { items: TopScanned['items'] | null; state: 'loading' | 'error' | 'ok' }) {
  if (state === 'error') return <div className="hm-strip empty">Today’s scans could not be read just now.</div>
  if (!items) return <div className="hm-strip skel" aria-hidden />
  if (!items.length)
    return (
      <div className="hm-strip empty" data-testid="hm-strip-empty">
        <span className="hm-dot" aria-hidden /> No maps opened yet today. Paste a token above and yours is the first.
      </div>
    )
  const row = (dup: boolean) => (
    <ul className="hm-strip-row" aria-hidden={dup || undefined}>
      {items.map((x) => (
        <li key={`${x.chain}:${x.token}`}>
          <Link to={holderHref(x.path)} tabIndex={dup ? -1 : undefined}>
            <ChainLogo chain={x.chain} size={16} decorative />
            <b>{x.symbol ?? `${x.token.slice(0, 6)}…`}</b>
            <span>{CHAIN_NAMES[x.chain] ?? x.chain}</span>
            <em className="num">{fmtInt(x.scans)} {x.scans === 1 ? 'scan' : 'scans'}</em>
          </Link>
        </li>
      ))}
    </ul>
  )
  return (
    <section className="hm-strip" aria-label="Recently mapped today">
      <span className="hm-strip-k">
        <i className="hm-dot" aria-hidden /> RECENTLY MAPPED
      </span>
      <div className={`hm-strip-track ${items.length < 4 ? 'few' : ''}`}>
        {row(false)}
        {items.length >= 4 && row(true)}
      </div>
    </section>
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
  const head = (
    <div className="hm-sec-head">
      <div>
        <span className="hm-eyebrow">
          <i className="hm-dot" aria-hidden /> MAP OF THE MOMENT
        </span>
        <h2 className="h2">{item ? <>Most scanned today: {item.symbol ? `$${item.symbol}` : 'a token'} on {CHAIN_NAMES[item.chain] ?? item.chain}</> : 'Today’s most scanned map'}</h2>
      </div>
      {item && (
        <Link className="hm-btn ghost" to={holderHref(item.path)}>
          Open the full map <ArrowRight aria-hidden className="hm-ic sm" />
        </Link>
      )}
    </div>
  )
  if (state === 'ok' && !item)
    return (
      <section className="hm-spot" aria-label="Map of the moment">
        {head}
        <div className="hm-spot-empty" data-testid="hm-spot-empty">
          <Mascot pose="point" width={130} />
          <div>
            <h3>No map opened yet today</h3>
            <p>The day’s most scanned token appears here with its live bubble map and charts. Paste a token above to start the day.</p>
            <Link className="hm-btn" to="/#map">
              Paste a token
            </Link>
          </div>
        </div>
      </section>
    )
  return (
    <section className="hm-spot" aria-label="Map of the moment">
      {head}
      <div className="hm-spot-grid">
        <div className="hm-card hm-spot-map">
          {m ? <BubbleField m={m} max={36} height={320} /> : error || state === 'error' || (data && data.state !== 'ok') ? <NotReadable text={data && data.state !== 'ok' ? data.reason : 'This map could not be read just now; it retries every five minutes.'} height={320} /> : <div className="hm-field-skel" role="status" aria-label="Reading the map" />}
        </div>
        <div className="hm-card">
          <header>
            <h3>Top 10 hold</h3>
          </header>
          {m ? <Gauge value={m.summary.top10Pct} label="Top 10 holders' share" caption={m.summary.line} /> : <div className="hm-gauge-skel" aria-hidden />}
        </div>
        <div className="hm-card">
          <header>
            <h3>Who holds the supply</h3>
          </header>
          {m && split ? (
            <Donut segments={split.segments} total={split.ofSupply ? 100 : split.segments.reduce((a, s) => a + s.value, 0)} centre={{ k: 'wallets on the map', v: fmtInt(split.listed) }} label="Who holds the supply" />
          ) : m ? (
            <NotReadable text="No shares readable for this token" />
          ) : (
            <div className="hm-gauge-skel" aria-hidden />
          )}
        </div>
      </div>
    </section>
  )
}

function TopScans({ s }: { s: Poll<TopScanned> }) {
  if (s.k === 'loading') return <div className="hm-list-skel" role="status" aria-label="Reading the most scanned maps" />
  if (s.k === 'error') return <NotReadable text="Today’s scans could not be read just now; retrying every minute." />
  const items = s.data.items
  if (!items.length)
    return (
      <div className="hm-mini-empty" data-testid="most-scanned-empty">
        <Mascot pose="point" width={80} />
        <p>No maps opened yet today. Search one above and it ranks here.</p>
      </div>
    )
  return (
    <>
      <Bars
        fmt={(v) => `${fmtInt(v)}`}
        rows={items.slice(0, 8).map((x, i) => ({
          id: `${x.chain}:${x.token}`,
          label: (
            <Link to={holderHref(x.path)} className="hm-bar-link">
              <ChainLogo chain={x.chain} size={16} decorative /> {x.symbol ?? `${x.token.slice(0, 6)}…`}
            </Link>
          ),
          value: x.scans,
          color: i === 0 ? HM_C.yellow : HM_C.hi,
          aria: `${x.symbol ?? 'Token'} on ${CHAIN_NAMES[x.chain] ?? x.chain}: ${x.scans} scans today`,
        }))}
      />
      <p className="hm-note" data-top-scanned>
        {items.length} tokens mapped today · {fmtPct((items[0].scans / Math.max(1, items.reduce((a, b) => a + b.scans, 0))) * 100)} of scans went to the top one
      </p>
    </>
  )
}

/** Each chain's holder source over the last 24 h (GET /api/status, group "holders"). */
function SourceHealth() {
  const { status } = useLive()
  if (!status) return <div className="hm-list-skel" role="status" aria-label="Reading status" />
  const src = status.components.filter((c) => c.group === 'holders')
  if (!src.length) return <NotReadable text="No holder sources in the status feed" />
  return (
    <ul className="hm-src">
      {src.map((c) => (
        <li key={c.id} className={c.state}>
          <span className="n">{c.name.replace(/^Holder Map: /, '')}</span>
          <span className="v num">{c.state === 'off' ? 'not set up' : c.uptime24h == null ? 'not readable' : `${Math.round(c.uptime24h * 1000) / 10}%`}</span>
          <span className="sp">{c.state === 'off' ? null : <Spark values={c.history.map((h) => (typeof h.up === 'number' ? Math.round(h.up * 1000) / 10 : null))} color="#FFD52E" h={22} />}</span>
        </li>
      ))}
    </ul>
  )
}

function Chains({ s }: { s: Poll<HolderSources> }) {
  return (
    <section className="hm-chains" aria-labelledby="hm-chains-h">
      <div className="hm-sec-head">
        <div>
          <span className="hm-eyebrow">COVERAGE</span>
          <h2 id="hm-chains-h" className="h2">
            Every chain we map
          </h2>
        </div>
      </div>
      {s.k === 'ok' ? (
        <ul className="hm-chain-grid">
          {s.data.chains.map((c, i) => (
            <li key={c.chain} className={`hm-card hm-chain ${c.chain === 'gully' ? 'own' : ''}`} style={{ ['--d' as string]: `${i * 70}ms` }}>
              <ChainLogo chain={c.chain} size={32} decorative />
              <h3>{c.name}</h3>
              <ul>
                <li className={c.any !== 'none' ? 'y' : ''}>{c.any === 'full' ? 'Any token, full history' : c.any === 'top' ? 'Any token, top holders' : 'Any token: coming soon'}</li>
                <li className={c.launches ? 'y' : ''}>{c.launches ? 'Launch checks live' : 'No launch checks'}</li>
                <li className={c.stocks ? 'y' : ''}>{c.stocks ? 'Stock tokens mapped' : 'No stock tokens'}</li>
              </ul>
              {c.chain === 'gully' && <p className="own-note">Gully Labs’ own L3 · chain 485590, read from our own archive node.</p>}
            </li>
          ))}
        </ul>
      ) : s.k === 'error' ? (
        <NotReadable text="The chain list could not be read just now." />
      ) : (
        <div className="hm-list-skel" role="status" aria-label="Reading chains" />
      )}
    </section>
  )
}
