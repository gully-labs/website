import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { CircleDashed, Radar, Search } from 'lucide-react'
import { Seo } from '../components/Seo'
import { ChainLogo } from '../components/logos/ChainLogo'
import { useLiveSeries } from '../components/charts/useLiveSeries'
import { EChart } from '../components/charts/EChart'
import { axisTooltip, barsPreset, itemTooltip, tipHtml } from '../components/charts/chartPresets'
import { ChartSkeleton } from '../components/charts/ChartSkeleton'
import { ScoreRing } from '../components/holders/parts'
import { K } from '../components/holders/theme'
import type { MapPreview } from '../components/holders/MiniMap'
import { eyebrow } from '../components/ui'
import { type CheckedLaunch, type CheckedLaunches, type HolderSources, type ResolveChecked, type TopScanned } from '../lib/holders'
import { useHolderSearch } from '../lib/holderResolve'
import { ageText } from '../lib/tracker'

/* /holders: the Holder Map's front door. A search for any token: an address on Robinhood Chain, BNB Chain, Base,
   HyperEVM or Solana (every supported chain is checked at once), a DeepCore launch or a tracked stock ticker
   (GET /api/holders/resolve), the newest DeepCore launches as they are checked (GET /api/holders/launches,
   every 30 s), the maps people opened most today (GET /api/holders/top) and how to read a map. Every
   figure is read live; a launch still being checked says so. */

const LEVEL_COLOUR = { good: K.gold, mixed: K.pale, poor: K.warn } as const
/** Each checked launch's map in miniature (its own small chunk, drawn only while on screen). */
const MiniMap = lazy(() => import('../components/holders/MiniMap'))
const HOUR = 3_600_000
const MAX_HOURS = 12
const STATES: { id: CheckedLaunch['state']; label: string; colour: () => string }[] = [
  { id: 'checked', label: 'Checked', colour: () => K.gold },
  { id: 'checking', label: 'Being checked', colour: () => K.pale },
  { id: 'unavailable', label: 'No holder data yet', colour: () => K.dim },
]

/** Launches in the feed per hour, by check state, over the hours the feed fully covers (at most 12):
    from the hour of its oldest launch to now, so an hour with no bar truly had no launch in the feed. */
function recencyOf(list: CheckedLaunch[], now: number) {
  const times = list.map((l) => Date.parse(l.createdAt)).filter((t) => Number.isFinite(t))
  if (!times.length) return null
  const end = Math.floor(now / HOUR) * HOUR
  const start = Math.max(Math.floor(Math.min(...times) / HOUR) * HOUR, end - (MAX_HOURS - 1) * HOUR)
  const hours: number[] = []
  for (let h = start; h <= end; h += HOUR) hours.push(h)
  const counts = STATES.map((st) => hours.map((h) => list.filter((l) => l.state === st.id && Date.parse(l.createdAt) >= h && Date.parse(l.createdAt) < h + HOUR).length))
  return { hours, counts, labels: hours.map((h) => new Date(h).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) }
}

function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/** A JSON read refreshed every `ms` (0 = once an hour); a failed refresh keeps the last good answer. */
function usePoll<T>(path: string, ms: number) {
  const { data, error } = useLiveSeries<T>(
    (signal) =>
      fetch(path, { headers: { accept: 'application/json' }, signal }).then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json() as Promise<T>
      }),
    ms || HOUR,
  )
  const s: { k: 'loading' } | { k: 'error' } | { k: 'ok'; data: T } = data !== undefined ? { k: 'ok', data } : error ? { k: 'error' } : { k: 'loading' }
  return s
}

export function HoldersLanding() {
  const now = useNow()
  const feed = usePoll<CheckedLaunches>('/api/holders/launches', 30_000)
  const top = usePoll<TopScanned>('/api/holders/top?limit=20', 60_000)
  const sources = usePoll<HolderSources>('/api/holders/sources', 0)
  return (
    <div className="flex flex-col gap-10 px-page pt-10 pb-24">
      <Seo
        title="Holder Map: who really holds a token"
        description="See who holds any token on Robinhood Chain, BNB Chain, Base, HyperEVM or Solana: the biggest wallets and the ones that trade with each other. DeepCore launches also get bundled-buy checks, the deployer’s record and a health score you can check part by part."
      />
      <section className="flex flex-col gap-4">
        <span className={eyebrow}>HOLDER MAP · GULLY LABS</span>
        <h1 className="heading-1">Who really holds it?</h1>
        <p className="m-0 max-w-[720px] text-[18px] leading-[1.6] text-muted">
          Paste any token address, on any chain we cover, or a ticker. See the biggest wallets as bubbles and the ones that trade with each other in gold. New DeepCore launches also get a plain check: bundled buys, snipers, the deployer’s share and record.
        </p>
        <SearchBox />
        <Sources s={sources} />
      </section>

      <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] items-start gap-5 max-[959px]:grid-cols-1">
        <section aria-labelledby="hl-feed" className="card card-pad flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="hl-feed" className="heading-4 text-ink">
              New launches, checked
            </h2>
            <span className="flex items-center gap-2 font-mono text-[11px] tracking-[1px] text-dim">
              <span className="relative inline-flex size-2.5" aria-hidden>
                <span className="absolute inset-0 animate-[gl-live-pulse_2s_ease-out_infinite] rounded-full bg-gold" />
                <span className="relative size-2.5 rounded-full bg-gold" />
              </span>
              LIVE
              {feed.k === 'ok' && feed.data.asOf ? ` · ${ageText(feed.data.asOf, now).toUpperCase()}` : ''}
            </span>
          </div>
          <Feed s={feed} now={now} />
        </section>

        <section aria-labelledby="hl-top" className="card card-pad flex min-w-0 flex-col gap-4">
          <h2 id="hl-top" className="heading-4">
            Most scanned today
          </h2>
          <TopList s={top} />
        </section>
      </div>

      <section aria-labelledby="hl-how" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-4">
        <h2 id="hl-how" className="sr-only">
          How to read a Holder Map
        </h2>
        {[
          ['Bubbles', 'One wallet each, sized by its share. Grey ones are pools, locks, burn addresses and exchanges, not people.'],
          ['Gold clusters', 'Wallets that sent the token to each other. A big cluster is often one holder behind many wallets.'],
          ['Health score', 'For launches: liquidity lock, bundled buys, snipers, the deployer’s share and record, the top 10. Tap a part to see its wallets.'],
          ['Live and replay', 'Watch transfers as they happen, or replay how holdings spread since launch.'],
        ].map(([t, d]) => (
          <div key={t} className="card card-pad flex flex-col gap-2">
            <h3 className="heading-4">{t}</h3>
            <p className="m-0 text-[14px] leading-[1.6] text-muted">{d}</p>
          </div>
        ))}
      </section>
    </div>
  )
}

/** Where maps work today, read from GET /api/holders/sources (no figures typed in). */
function Sources({ s }: { s: ReturnType<typeof usePoll<HolderSources>> }) {
  if (s.k !== 'ok') return null
  const launches = s.data.chains.filter((c) => c.launches).map((c) => c.name)
  const WORDS = { full: 'any token · full history', top: 'any token · top holders', none: 'any token' } as const
  const live = s.data.chains.filter((c) => c.any !== 'none')
  const soon = s.data.chains.filter((c) => c.any === 'none')
  return (
    <ul className="m-0 flex max-w-[760px] list-none flex-wrap items-center gap-2 p-0 font-mono text-[12px]" aria-label="Where Holder Maps work today" data-holder-sources>
      <li className="inline-flex min-h-9 items-center gap-2 rounded-full border border-gold/40 px-3 text-ink">
        <Radar aria-hidden size={14} className="text-gold" /> DeepCore launches · live on {launches.join(', ')}
      </li>
      {live.map((c) => (
        <li key={c.chain} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-gold/40 px-3 text-ink">
          <ChainLogo chain={c.chain} size={16} decorative />
          {c.name} · {WORDS[c.any]}
        </li>
      ))}
      {soon.length > 0 && (
        <li className="inline-flex min-h-9 items-center gap-2 rounded-full border border-line px-3 text-muted">
          <CircleDashed aria-hidden size={14} className="animate-[spin_6s_linear_infinite] text-faint motion-reduce:animate-none" />
          <span className="inline-flex -space-x-1">
            {soon.map((c) => (
              <ChainLogo key={c.chain} chain={c.chain} size={16} />
            ))}
          </span>
          {soon.map((c) => c.name).join(', ')} · coming soon
        </li>
      )}
    </ul>
  )
}

function SearchBox() {
  const { q, s, go, change } = useHolderSearch()
  return (
    <div className="flex max-w-[760px] flex-col gap-3">
      <form role="search" onSubmit={go} className="flex items-center gap-2 rounded-card border border-line-strong bg-surface px-4 focus-within:border-gold">
        <Search size={20} aria-hidden className="flex-none text-faint" />
        <label htmlFor="hl-q" className="sr-only">
          Token address or ticker
        </label>
        <input
          id="hl-q"
          value={q}
          onChange={(e) => change(e.target.value)}
          placeholder="0x… address or $ticker (NVDA, DTC…)"
          className="min-h-14 min-w-0 flex-1 bg-transparent font-mono text-[16px] text-ink outline-none"
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" disabled={s.k === 'busy'} className="min-h-11 rounded-btn bg-gold px-5 font-semibold text-bg hover:bg-gold-hover disabled:opacity-60">
          {s.k === 'busy' ? 'Looking…' : 'Map it'}
        </button>
      </form>
      <div aria-live="polite">
        {s.k === 'none' && <NoMatch checked={s.checked} address={s.address} />}
        {s.k === 'limit' && <p className="m-0 text-[14px] text-muted">That is a lot of new addresses in a minute. Wait a moment and try again; tokens already mapped open straight away.</p>}
        {s.k === 'error' && <p className="m-0 text-[14px] text-error">The search did not answer just now. Try again.</p>}
        {s.k === 'many' && (
          <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Pick a token" data-resolve-matches>
            {s.matches.map((m) => (
              <li key={`${m.chain}:${m.token}`}>
                <Link to={m.path} className="flex min-h-11 items-center gap-3 rounded-[8px] border border-line px-3 text-[14px] hover:border-gold">
                  <span className="font-semibold text-ink">{m.symbol ?? `${m.token.slice(0, 6)}…${m.token.slice(-4)}`}</span>
                  <span className="font-mono text-[12px] text-faint">{m.chainName}</span>
                  <span className="ml-auto font-mono text-[11px] text-dim">
                    {m.kind === 'deepcore-launch' ? 'DeepCore launch' : m.kind === 'launch' ? 'Launchpad token' : m.kind === 'token' ? 'Token' : 'Stock token'}
                    {m.available === false ? ' · coming soon' : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** No dead end: what was checked and why nothing can be mapped, in plain words. */
function NoMatch({ checked, address }: { checked: ResolveChecked[]; address: boolean }) {
  if (!address)
    return (
      <p className="m-0 text-[14px] leading-[1.6] text-muted" data-no-match>
        That is not a token address or a ticker we follow. Paste a 0x… address (any ERC-20 on Robinhood Chain, BNB Chain, Base or HyperEVM), a Solana token address, or a stock ticker such as NVDA.
      </p>
    )
  return (
    <div className="flex flex-col gap-1" data-no-match>
      <p className="m-0 text-[14px] leading-[1.6] text-ink">
        No token found at that address. Checked {checked.length ? checked.map((c) => c.chainName).join(', ') : 'every supported chain'}:
      </p>
      <ul className="m-0 list-disc pl-5 text-[13px] leading-[1.6] text-muted">
        {checked.map((c) => (
          <li key={c.chain}>
            <b className="font-semibold text-ink">{c.chainName}</b>: {c.reason ?? (c.status === 'unreadable' ? 'could not be reached just now' : 'not a token')}
          </li>
        ))}
      </ul>
      {checked.some((c) => c.status === 'unreadable') && <p className="m-0 text-[13px] text-muted">A chain that could not be reached may still hold it; try again in a minute.</p>}
    </div>
  )
}

function Feed({ s, now }: { s: ReturnType<typeof usePoll<CheckedLaunches>>; now: number }) {
  const scored = useMemo(() => (s.k === 'ok' ? s.data.launches.filter((l) => l.health?.score !== null && l.health?.score !== undefined).slice(0, 12) : []), [s])
  const option = useMemo(
    () => ({
      grid: { left: 4, right: 4, top: 16, bottom: 22 },
      xAxis: {
        type: 'category',
        data: scored.map((l) => l.symbol ?? l.token.slice(0, 6)),
        axisLabel: {
          color: K.muted,
          fontSize: 11,
          interval: 0,
          rotate: scored.length > 6 ? 30 : 0,
        },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: { type: 'value', min: 0, max: 100, show: false },
      tooltip: itemTooltip((p: { dataIndex: number }) => {
        const l = scored[p.dataIndex]
        return tipHtml({
          title: `${l.symbol ?? 'Token'} · ${l.chainName}`,
          rows: [{ name: 'Health', value: `${l.health?.score} / 100` }],
          note: l.health?.verdict,
        })
      }),
      series: [
        {
          id: 'scores',
          ...barsPreset({ radius: [4, 4, 0, 0] }),
          barMaxWidth: 28,
          label: { show: true, position: 'top', color: K.bone, fontSize: 11 },
          data: scored.map((l) => ({
            value: l.health?.score,
            itemStyle: {
              color: l.health?.level ? LEVEL_COLOUR[l.health.level] : K.dim,
            },
          })),
        },
      ],
    }),
    [scored],
  )
  const recency = useMemo(() => (s.k === 'ok' ? recencyOf(s.data.launches, now) : null), [s, now])
  const recencyOption = useMemo(
    () =>
      recency
        ? {
            grid: { left: 4, right: 4, top: 12, bottom: 22 },
            xAxis: { type: 'category', data: recency.labels, axisLabel: { color: K.muted, fontSize: 11, hideOverlap: true }, axisLine: { show: false }, axisTick: { show: false } },
            yAxis: { type: 'value', minInterval: 1, show: false },
            tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
              const i = ps[0]?.dataIndex ?? -1
              if (i < 0) return ''
              return tipHtml({
                title: `${recency.labels[i]} hour`,
                rows: STATES.map((st, k) => ({ name: st.label, value: String(recency.counts[k][i]), color: st.colour() })),
                note: 'New DeepCore launches in the live feed.',
              })
            }, 'shadow'),
            series: STATES.map((st, k) => ({
              id: st.id,
              name: st.label,
              ...barsPreset({ radius: 0, focus: 'series' }),
              stack: 'launches',
              barMaxWidth: 28,
              color: st.colour(),
              data: recency.counts[k],
            })),
          }
        : {},
    [recency],
  )
  if (s.k === 'loading')
    return (
      <div role="status" aria-label="Reading the newest launches" className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[60px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-[10px]" style={{ background: K.night }} />
        ))}
      </div>
    )
  if (s.k === 'error') return <p className="m-0 text-[14px] text-muted">The launch feed could not be read just now; it retries every 30 seconds.</p>
  const list = s.data.launches
  return (
    <>
      {scored.length > 0 ? (
        <EChart option={option} height={150} label={`Health scores of the newest checked launches: ${scored.map((l) => `${l.symbol ?? 'token'} ${l.health?.score}`).join(', ')}`} skeleton="bars" />
      ) : recency ? (
        <figure className="m-0 flex flex-col gap-1">
          <EChart option={recencyOption} height={150} label={`New launches per hour in the live feed: ${recency.labels.map((h, i) => `${h} ${STATES.reduce((n, _, k) => n + recency.counts[k][i], 0)}`).join(', ')}`} skeleton="bars" />
          <figcaption className="font-mono text-[11px] text-dim">New launches per hour · scores appear as checks finish</figcaption>
        </figure>
      ) : (
        <div role="status" className="relative h-[150px]">
          <ChartSkeleton variant="bars" />
          <span className="absolute inset-0 flex items-center justify-center gap-2 font-mono text-[12px] text-muted">
            <span className="relative inline-flex size-2.5" aria-hidden>
              <span className="absolute inset-0 animate-[gl-live-pulse_2s_ease-out_infinite] rounded-full bg-gold" />
              <span className="relative size-2.5 rounded-full bg-gold" />
            </span>
            Listening for the first launch
          </span>
        </div>
      )}
      {!list.length && <p className="m-0 text-[14px] text-muted">No launches yet.</p>}
      <ul className="m-0 flex list-none flex-col gap-2 p-0" data-launch-feed>
        {list.slice(0, 12).map((l, i) => (
          <FeedRow key={`${l.chainKey}:${l.token}`} l={l} i={i} now={now} />
        ))}
      </ul>
    </>
  )
}

function FeedRow({ l, i, now }: { l: CheckedLaunch & { preview?: MapPreview | null }; i: number; now: number }) {
  const score = l.health?.score ?? null
  const preview = l.state === 'checked' && l.preview?.nodes?.length ? l.preview : null
  return (
    <li className="animate-[gl-rise_.5s_ease_both] motion-reduce:animate-[gl-fade_.3s_ease_both]" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
      <Link to={l.path} className="flex min-h-[60px] items-center gap-2.5 rounded-[10px] border border-line px-2 py-2 transition-colors hover:border-gold min-[420px]:gap-3 min-[420px]:px-3" style={{ background: K.night }}>
        {preview ? (
          <Suspense fallback={<span className="h-[56px] w-[76px] flex-none animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-[8px]" style={{ background: K.night }} />}>
            <MiniMap preview={preview} label={`Holder Map of ${l.symbol ?? 'this launch'} in miniature: ${preview.nodes.length} biggest holders and its latest transfers`} />
          </Suspense>
        ) : (
          <span aria-hidden className="h-[56px] w-[76px] flex-none animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-[8px] border border-line" style={{ background: K.night }} />
        )}
        {l.state === 'checked' ? (
          <ScoreRing score={score} level={l.health?.level ?? null} size={44} />
        ) : (
          <span className="inline-flex size-11 flex-none animate-[gl-skeleton_1.4s_ease-in-out_infinite] items-center justify-center rounded-full border border-line-strong font-mono text-[11px] text-dim">
            {l.state === 'checking' ? '…' : '—'}
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="flex items-baseline gap-2">
            <span className="truncate font-semibold text-ink">{l.symbol ?? `${l.token.slice(0, 6)}…${l.token.slice(-4)}`}</span>
            <span className="flex-none font-mono text-[11px] text-dim">
              <span className="max-[419px]:hidden">{l.chainName} · </span>
              {ageText(l.createdAt, now)}
            </span>
          </span>
          <span className="truncate text-[12px] text-muted">
            {l.state === 'checking' ? 'Checking the holders now…' : l.state === 'unavailable' ? 'Holder data is not available for this one yet.' : (l.riskLine ?? l.health?.verdict ?? '')}
          </span>
        </span>
        <span className="hidden flex-none font-mono text-[12px] text-gold min-[420px]:inline">Map →</span>
      </Link>
    </li>
  )
}

function TopList({ s }: { s: ReturnType<typeof usePoll<TopScanned>> }) {
  if (s.k === 'loading') return <div role="status" aria-label="Reading the most scanned maps" className="h-[200px] animate-[gl-skeleton_1.4s_ease-in-out_infinite] rounded-[10px] bg-surface-deep" />
  if (s.k === 'error') return <p className="m-0 text-[14px] text-muted">Could not be read just now.</p>
  const items = s.data.items
  const max = Math.max(1, ...items.map((x) => x.scans))
  if (!items.length) return <p className="m-0 text-[14px] text-muted">No maps opened yet today. Search one above.</p>
  const barOption = {
    grid: { left: 4, right: 4, top: 12, bottom: 22 },
    xAxis: { type: 'category', data: items.slice(0, 10).map((x) => x.symbol ?? x.token.slice(0, 5)), axisLabel: { color: K.muted, fontSize: 11, interval: 0, hideOverlap: true }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: 'value', minInterval: 1, show: false },
    tooltip: itemTooltip((p: { dataIndex: number }) => {
      const x = items[p.dataIndex]
      return tipHtml({ title: x.symbol ?? 'Token', rows: [{ name: 'Scans today', value: x.scans.toLocaleString('en-US') }] })
    }),
    series: [{ id: 'scans', ...barsPreset({ radius: [4, 4, 0, 0] }), barMaxWidth: 26, color: K.gold, data: items.slice(0, 10).map((x) => x.scans) }],
  }
  return (
    <>
      <EChart option={barOption} height={150} label={`Scans today of the ten most scanned maps: ${items.slice(0, 10).map((x) => `${x.symbol ?? 'token'} ${x.scans}`).join(', ')}`} skeleton="bars" />
      <ol className="m-0 flex list-none flex-col gap-1 p-0" data-top-scanned>
        {items.map((x, i) => (
          <li key={`${x.chain}:${x.token}`}>
            <Link to={x.path} className="relative flex min-h-11 items-center gap-3 overflow-hidden rounded-[8px] border border-line px-3 text-[14px] hover:border-gold">
              <span aria-hidden className="absolute inset-y-0 left-0 origin-left animate-[gl-grow-x_.8s_ease_both] bg-gold/10 motion-reduce:animate-[gl-fade_.3s_ease_both]" style={{ width: `${(x.scans / max) * 100}%`, animationDelay: `${Math.min(i, 10) * 40}ms` }} />
              <span className="relative w-5 font-mono text-[12px] text-faint">{i + 1}</span>
              <ChainLogo chain={x.chain} size={16} decorative className="relative" />
              <span className="relative font-semibold text-ink">{x.symbol ?? `${x.token.slice(0, 6)}…`}</span>
              <span className="relative font-mono text-[11px] text-dim">{x.kind === 'deepcore-launch' || x.kind === 'launch' ? 'launch' : x.kind === 'token' ? 'token' : 'stock'}</span>
              <span className="relative ml-auto font-mono text-[12px] text-muted">{x.scans.toLocaleString('en-US')} scans</span>
            </Link>
          </li>
        ))}
      </ol>
    </>
  )
}
