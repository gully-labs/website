import { BellRing, Lock, LockOpen, Rocket } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { NF } from '../../../components/charts/number-formats'
import { useStats } from '../../../hooks/useStats'
import type { VenueOk } from '../../../lib/stats'
import { ago } from '../api'
import { ExtLink } from '../ExtLink'
import { ErrorLine, Skeleton } from '../parts'
import { chip, pillSm } from '../styles'
import { KeySpark, LiveMarker, StackedDays } from '../vcharts'
import { sitePage, type ServiceCtx } from './links'
import { Section, ServiceHeader, type Status } from './ServiceHeader'

/* DeepCore launches, in the app: the newest launches on every DeepCore chain from the server's launch
   poller (GET /api/deepcore/launches, the same cache the launch alerts and the Telegram bot read; read
   here every minute), charted per day and chain, with DeepCore's own figures from the live ledger
   (GET /api/stats). A list the poller could not refresh is labelled stale; one it never read is
   unreadable, never empty. */

type Launch = { key: string; chainId: number; chainName: string; token: string; symbol: string | null; createdAt: string; legs: { quote: string | null; locked: boolean | null }[]; links: { token: string; swap: string } }
type Launches = { state: 'ok' | 'stale' | 'unreadable'; launches: Launch[]; asOf: string | null; chains: { chainId: number; name: string; status: 'ok' | 'unreadable'; total: number | null }[]; error: string | null; pollSeconds: number }

const CHAIN_COLORS: Record<number, string> = { 4663: '#e8c060', 56: '#f3ba2f', 8453: '#6aa6ff', 999: '#4fd1c5' }
const colorOf = (id: number) => CHAIN_COLORS[id] ?? '#a6b0bd'

function useLaunches() {
  const [s, setS] = useState<{ k: 'loading' } | { k: 'error' } | { k: 'ok'; data: Launches }>({ k: 'loading' })
  useEffect(() => {
    let alive = true
    const read = () =>
      fetch('/api/deepcore/launches', { headers: { accept: 'application/json' } })
        .then((r) => (r.ok ? (r.json() as Promise<Launches>) : Promise.reject(new Error(String(r.status)))))
        .then(
          (data) => alive && setS({ k: 'ok', data }),
          () => alive && setS((p) => (p.k === 'ok' ? p : { k: 'error' })),
        )
    read()
    const id = setInterval(read, 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  return s
}

export default function DeepcoreView({ ctx }: { ctx: ServiceCtx }) {
  const s = useLaunches()
  const stats = useStats()
  const [chain, setChain] = useState<number | 'all'>('all')
  const d = s.k === 'ok' ? s.data : null
  const venue = stats.k === 'ok' ? (stats.data.venues.find((v) => v.key === 'deepcore' && v.state === 'ok') as VenueOk | undefined) : undefined
  const list = useMemo(() => (d ? d.launches.filter((l) => chain === 'all' || l.chainId === chain) : []), [d, chain])
  const chains = useMemo(() => (d ? [...new Map(d.launches.map((l) => [l.chainId, l.chainName])).entries()] : []), [d])

  // Launches per day over the days the cached list spans (at most 14), stacked by chain.
  const perDay = useMemo(() => {
    if (!d?.launches.length) return []
    const oldest = Math.min(...d.launches.map((l) => Date.parse(l.createdAt)))
    const n = Math.min(14, Math.max(2, Math.ceil((Date.now() - oldest) / 86_400_000) + 1))
    const today = new Date()
    return Array.from({ length: n }, (_, i) => {
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (n - 1 - i))
      const values: Record<string, number> = {}
      for (const l of d.launches) if (new Date(l.createdAt).toDateString() === day.toDateString()) values[String(l.chainId)] = (values[String(l.chainId)] ?? 0) + 1
      return { label: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), values }
    })
  }, [d])
  const kinds = useMemo(() => chains.map(([id, name]) => ({ id: String(id), name, color: colorOf(id) })), [chains])
  const daily = venue?.daily.slice(-30) ?? []

  const status: Status = !d ? (s.k === 'error' ? { tone: 'down', text: 'unreadable' } : { tone: 'checking', text: 'reading…' }) : d.state === 'ok' ? { tone: 'live', text: `live · polled every ${d.pollSeconds} s` } : d.state === 'stale' ? { tone: 'idle', text: `stale · last read ${d.asOf ? ago(d.asOf) : 'never'}` } : { tone: 'down', text: 'unreadable' }
  const pend = (k: string) => (k === 'error' ? 'unreadable' : '…')
  const venuePend = stats.k === 'loading' ? '…' : 'unreadable'

  return (
    <>
      <ServiceHeader
        icon={Rocket}
        title="DeepCore launches"
        desc="New token launches on DeepCore across BNB Chain, Robinhood Chain, Base and HyperEVM, as they land."
        status={status}
        docs="https://deepcore.fun/docs"
        page={{ href: sitePage('/projects/deepcore') }}
        actions={
          <button type="button" onClick={() => ctx.go('alerts')} className={pillSm}>
            <BellRing size={14} aria-hidden /> Launch alerts
          </button>
        }
        tiles={[
          { label: 'LAUNCHES 24H', value: venue ? (venue.counts.launches24h ?? null) : null, unknown: venuePend, note: 'every DeepCore chain' },
          { label: 'LATEST LISTED', value: d && d.state !== 'unreadable' ? d.launches.length : null, unknown: pend(s.k), note: d?.asOf ? `read ${ago(d.asOf)}` : 'from the poller' },
          { label: 'VOLUME 24H', value: venue?.volume24hUsd ?? null, format: NF.compactUsd, unknown: venuePend, note: 'DeepCore’s own API' },
          { label: 'TVL', value: venue?.tvlUsd ?? null, format: NF.compactUsd, unknown: venuePend, note: venue?.lockedUsd != null ? `locked ${new Intl.NumberFormat('en-US', NF.compactUsd).format(venue.lockedUsd)}` : 'value locked' },
        ]}
      />

      {s.k === 'error' && <ErrorLine>The launch list could not be read just now. It retries every minute.</ErrorLine>}
      {d?.state === 'unreadable' && <ErrorLine>DeepCore’s launch list has not been read yet{d.error ? `: ${d.error}` : ''}.</ErrorLine>}

      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-start gap-4 max-[1100px]:grid-cols-1">
        <Section title="Launches per day" sub="the latest launches, by chain">
          {!d ? <Skeleton h={180} /> : perDay.length ? <StackedDays height={180} days={perDay} kinds={kinds} label={`DeepCore launches per day by chain, ${d.launches.length} latest.`} /> : <LiveMarker text="Watching DeepCore: launches chart here as they land" height={180} />}
        </Section>
        <Section title="DeepCore volume" sub="daily, USD · live ledger">
          {stats.k === 'loading' ? (
            <Skeleton h={120} />
          ) : daily.length >= 2 ? (
            <KeySpark values={daily.map((p) => p.v)} labels={daily.map((p) => new Date(p.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))} color="#e8c060" width={420} height={120} label={`DeepCore daily volume over ${daily.length} days`} />
          ) : (
            <LiveMarker text={venue ? 'Not enough for a series yet' : 'DeepCore’s figures are unreadable right now'} height={120} />
          )}
        </Section>
      </div>

      <Section
        title="Latest launches"
        sub={d?.asOf ? `as of ${new Date(d.asOf).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })} UTC` : 'newest first'}
        aside={
          chains.length > 1 ? (
            <div role="group" aria-label="Chain" className="flex flex-wrap gap-1">
              {[['all', 'All'] as const, ...chains].map(([id, name]) => (
                <button key={id} type="button" aria-pressed={chain === id} onClick={() => setChain(id)} className={chip(chain === id, true)}>
                  {name}
                </button>
              ))}
            </div>
          ) : null
        }
      >
        {!d ? (
          <Skeleton h={200} />
        ) : list.length ? (
          <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-2 p-0" data-testid="deepcore-launches">
            {list.slice(0, 24).map((l, i) => {
              const locked = l.legs.some((g) => g.locked === true)
              return (
                <li key={l.key} className="flex items-center gap-3 rounded-[10px] border border-line px-3 py-2" style={{ animation: `gl-rise .35s ${Math.min(i * 0.03, 0.4)}s ease both` }}>
                  <span className="size-2 shrink-0 rounded-full" style={{ background: colorOf(l.chainId) }} aria-hidden />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <b className="truncate font-display text-[15px]">{l.symbol ?? `${l.token.slice(0, 8)}…`}</b>
                    <span className="truncate font-mono text-[11px] text-faint">
                      {l.chainName} · {ago(l.createdAt)}
                      {l.legs[0]?.quote ? ` · vs ${l.legs[0].quote}` : ''}
                    </span>
                  </span>
                  <span title={locked ? 'Liquidity lock indexed' : 'No lock indexed'} className={locked ? 'text-green' : 'text-faint'}>
                    {locked ? <Lock size={14} aria-label="locked" /> : <LockOpen size={14} aria-label="no lock indexed" />}
                  </span>
                  <ExtLink href={l.links.token} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-line-strong px-[10px] text-[12px] text-ink-2 hover:border-gold hover:text-ink max-[859px]:min-h-11">
                    View<span className="sr-only"> {l.symbol ?? l.token} on DeepCore</span>
                  </ExtLink>
                </li>
              )
            })}
          </ul>
        ) : (
          <LiveMarker text={d.state === 'unreadable' ? 'Unreadable: no launch list yet' : 'No launches on this chain in the latest list'} height={80} />
        )}
      </Section>
    </>
  )
}
