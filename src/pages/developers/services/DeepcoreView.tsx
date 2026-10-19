import { GhostChart } from '../../../components/charts/GhostChart'
import { ChainLogo } from '../../../components/logos/ChainLogo'
import { TokenLogo } from '../../../components/logos/TokenLogo'
import { BellRing, Lock, LockOpen, Rocket } from 'lucide-react'
import { useMemo, useState } from 'react'
import { NF } from '../../../components/charts/number-formats'
import { useStats } from '../../../hooks/useStats'
import type { VenueOk } from '../../../lib/stats'
import { ago } from '../api'
import { ExtLink } from '../ExtLink'
import { ErrorLine, Skeleton } from '../parts'
import { chip, pillSm } from '../styles'
import { KeySpark, StackedDays } from '../vcharts'
import { sitePage, type ServiceCtx } from './links'
import { Section, ServiceHeader, type Status } from './ServiceHeader'
import { deepcoreColor, useLaunches } from './useDeepcore'

/* DeepCore launches, in the app: the newest launches on every DeepCore chain from the server's launch
   poller (GET /api/deepcore/launches, the same cache the launch alerts and the Telegram bot read; read
   here every minute), charted per day and chain, with DeepCore's own figures from the live ledger
   (GET /api/stats). A list the poller could not refresh is labelled stale; one it never read is
   unreadable, never empty. */

const colorOf = deepcoreColor
/** DeepCore's chain keys by id, for a launch the server sent without one (so the logo still resolves). */
const CHAIN_KEY: Record<number, string> = { 4663: 'robinhood', 56: 'bsc', 8453: 'base', 999: 'hyperevm' }

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
    const today = new Date()
    const n = Math.min(14, Math.max(2, Math.ceil((today.getTime() - oldest) / 86_400_000) + 1))
    return Array.from({ length: n }, (_, i) => {
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (n - 1 - i))
      const values: Record<string, number> = {}
      for (const l of d.launches) if (new Date(l.createdAt).toDateString() === day.toDateString()) values[String(l.chainId)] = (values[String(l.chainId)] ?? 0) + 1
      return { label: day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), values }
    })
  }, [d])
  const kinds = useMemo(() => chains.map(([id, name]) => ({ id: String(id), name, color: colorOf(id) })), [chains])
  // The ledger may not count launches (null); the launch list does, so fall back to it (N33).
  const asOfMs = d?.asOf ? Date.parse(d.asOf) : 0
  const since24h = d && asOfMs ? d.launches.filter((l) => asOfMs - Date.parse(l.createdAt) < 86_400_000).length : null
  const launches24h = venue?.counts.launches24h ?? since24h
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
          { label: 'LAUNCHES 24H', value: launches24h, unknown: d || venue ? 'not tracked yet' : venuePend, note: 'every DeepCore chain' },
          { label: 'LATEST LISTED', value: d && d.state !== 'unreadable' ? d.launches.length : null, unknown: pend(s.k), note: d?.asOf ? `read ${ago(d.asOf)}` : 'from the poller' },
          { label: 'VOLUME 24H', value: venue?.volume24hUsd ?? null, format: NF.compactUsd, unknown: venue ? 'not tracked yet' : venuePend, note: 'DeepCore’s own API' },
          { label: 'TVL', value: venue?.tvlUsd ?? null, format: NF.compactUsd, unknown: venue ? 'not tracked yet' : venuePend, note: venue?.lockedUsd != null ? `locked ${new Intl.NumberFormat('en-US', NF.compactUsd).format(venue.lockedUsd)}` : 'value locked' },
        ]}
      />

      {s.k === 'error' && <ErrorLine>The launch list could not be read just now. It retries every minute.</ErrorLine>}
      {d?.state === 'unreadable' && <ErrorLine>DeepCore’s launch list has not been read yet{d.error ? `: ${d.error}` : ''}.</ErrorLine>}

      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-start gap-4 max-[1100px]:grid-cols-1">
        <Section title="Launches per day" sub="the latest launches, by chain">
          {!d ? <Skeleton h={180} /> : perDay.length ? <StackedDays height={180} days={perDay} kinds={kinds} label={`DeepCore launches per day by chain, ${d.launches.length} latest.`} /> : <GhostChart height={180} variant="bars" label="Launches will draw here as they land" />}
        </Section>
        <Section title="DeepCore volume" sub="daily, USD · live ledger">
          {stats.k === 'loading' ? (
            <Skeleton h={120} />
          ) : daily.length >= 2 ? (
            <KeySpark values={daily.map((p) => p.v)} labels={daily.map((p) => new Date(p.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))} color="#d9b563" width={420} height={120} label={`DeepCore daily volume over ${daily.length} days`} />
          ) : (
            <GhostChart height={120} label={venue ? 'Volume will draw here' : 'DeepCore’s figures are unreadable right now'} badge={venue ? undefined : false} />
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
                  {id !== 'all' && <ChainLogo chain={CHAIN_KEY[id as number] ?? String(name)} size={14} decorative />}
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
                  <span className="relative inline-flex shrink-0" title={l.chainName}>
                    <TokenLogo symbol={l.symbol ?? 'token'} chain={l.chainKey ?? CHAIN_KEY[l.chainId]} address={l.token} size={24} decorative />
                    <ChainLogo chain={l.chainKey ?? CHAIN_KEY[l.chainId] ?? l.chainName} size={12} decorative className="absolute -right-[3px] -bottom-[3px] ring-1 ring-surface" />
                  </span>
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
                  <ExtLink href={l.links.token} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line-strong px-[10px] text-[12px] text-ink-2 hover:border-gold hover:text-ink max-[859px]:min-h-11">
                    View<span className="sr-only"> {l.symbol ?? l.token} on DeepCore</span>
                  </ExtLink>
                </li>
              )
            })}
          </ul>
        ) : (
          <GhostChart height={110} label={d.state === 'unreadable' ? 'Unreadable: no launch list yet' : 'No launches on this chain in the latest list'} badge={false} />
        )}
      </Section>
    </>
  )
}
