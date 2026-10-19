import { ScanSearch } from 'lucide-react'
import { useMemo, useState } from 'react'
import { HolderMapMini } from '../../../components/holders/HolderMapMini'
import { GhostChart } from '../../../components/charts/GhostChart'
import { ChainLogo } from '../../../components/logos/ChainLogo'
import { TokenLogo } from '../../../components/logos/TokenLogo'
import { holdersPagePath } from '../../../lib/holders'
import { ageText } from '../../../lib/tracker'
import { isLocalHost } from '../../../site-host'
import { Skeleton } from '../parts'
import { panel } from '../styles'
import { StackedDays } from '../vcharts'
import { docsPage, sitePage } from './links'
import { Section, ServiceHeader, type Status } from './ServiceHeader'
import { deepcoreColor, useLaunches, type Launches } from './useDeepcore'

/* Holder Map, in the app: who holds a DeepCore launch or a stock token (bundled buys, the deployer, connected
   wallets, a replay). The maps themselves are public pages (/holders/<chain>/<token>, a new tab from here);
   this page charts and lists the latest launches with their maps, live from the launch poller, and holder
   alerts are set in the Alerts tab. */

const CHAIN_KEY: Record<number, string> = { 4663: 'robinhood', 56: 'bsc', 8453: 'base', 999: 'hyperevm' }

/** The latest launches with a link to each Holder Map: token logo, the whole symbol (never cut to "D…"), chain logo and age. */
function HolderLaunches({ launches, asOf, stale }: { launches: Launches['launches'] | null; asOf: string | null; stale: boolean }) {
  const [now] = useState(() => Date.now())
  const external = !isLocalHost()
  if (!launches) return <Skeleton h={200} />
  return (
    <div className="flex flex-col gap-2" data-launch-holders>
      <span className="flex items-center gap-2 font-mono text-[11px] tracking-[1px] text-faint">
        <span className="relative inline-flex size-2.5 flex-none" aria-hidden>
          <span className="absolute inset-0 animate-[gl-live-pulse_2s_ease-out_infinite] rounded-full bg-gold" />
          <span className="relative size-2.5 rounded-full bg-gold" />
        </span>
        LIVE FROM DEEPCORE · {stale ? `LAST READ ${ageText(asOf, now).toUpperCase()}` : `${launches.length} LATEST`}
      </span>
      {!launches.length && <GhostChart height={120} variant="bars" label="Launches will list here" badge={false} />}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {launches.map((l) => {
          const key = l.chainKey ?? CHAIN_KEY[l.chainId]
          const path = key ? holdersPagePath(key, l.token) : null
          const sym = l.symbol ?? `${l.token.slice(0, 6)}…${l.token.slice(-4)}`
          const locked = l.legs.some((g) => g.locked === true)
          const body = (
            <>
              <TokenLogo symbol={sym} chain={key} address={l.token} size={24} decorative />
              <b className="shrink-0 font-display text-[15px] font-semibold text-ink" title={sym}>{sym}</b>
              <span className="flex min-w-0 flex-1 items-center gap-1 truncate font-mono text-[11px] text-faint">
                <ChainLogo chain={key ?? l.chainName} size={12} decorative />
                <span className="truncate max-[420px]:hidden">{l.chainName}</span>
              </span>
              <span className="flex-none font-mono text-[11px] text-faint">{locked ? '🔒 ' : ''}{ageText(l.createdAt, now)}</span>
              <span className="flex-none font-mono text-[12px] text-gold">Who holds it {external ? '↗' : '→'}</span>
            </>
          )
          const cls = 'flex min-h-11 items-center gap-3 rounded-[8px] border border-line px-3 text-[14px] transition-colors hover:border-gold'
          return (
            <li key={`${l.chainId}:${l.token}`}>
              {path ? (
                <a href={external ? `https://gullylabs.xyz${path}` : path} target="_blank" rel="noopener noreferrer" className={cls}>
                  {body}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                <span className={cls}>{body}</span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function HoldersView() {
  const dc = useLaunches()
  const d = dc.k === 'ok' ? dc.data : null
  const pending = dc.k === 'error' ? 'unreadable' : '…'
  const newest = d?.launches.length ? [...d.launches].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] : null
  const now = d?.asOf ? Date.parse(d.asOf) : 0
  const day = d ? d.launches.filter((l) => now - Date.parse(l.createdAt) < 86_400_000) : []
  // Launches with a Holder Map per day (the poller's list spans at most 14 days), stacked by chain.
  const kinds = useMemo(() => (d ? [...new Map(d.launches.map((l) => [l.chainId, l.chainName])).entries()].map(([id, name]) => ({ id: String(id), name, color: deepcoreColor(id) })) : []), [d])
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
  const status: Status = d ? (d.state === 'ok' ? { tone: 'live', text: 'live launches' } : { tone: 'down', text: d.state }) : dc.k === 'error' ? { tone: 'down', text: 'launches unreadable' } : { tone: 'checking', text: 'reading…' }
  return (
    <>
      <ServiceHeader
        icon={ScanSearch}
        title="Holder Map"
        desc="Who holds a DeepCore launch or a stock token: bundled buys, the deployer, connected wallets and a replay. Holder alerts arrive in the Alerts tab."
        status={status}
        docs={docsPage('holder-map')}
        page={{ href: sitePage('/holders') }}
        tiles={[
          { label: 'LAUNCHES LISTED', value: d?.launches.length, unknown: pending, note: 'newest first' },
          { label: 'LAUNCHED · 24H', value: d ? day.length : null, unknown: pending, note: 'by the poller’s last read' },
          { label: 'CHAINS', value: d?.chains.length, unknown: pending, note: d ? d.chains.map((c) => c.name).join(', ') : 'watched' },
        ]}
      />
      {/* Chart and list side by side at desktop widths, so the page stays inside the 900 px budget. */}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-4 max-[1100px]:grid-cols-1">
      <div className="flex min-w-0 flex-col gap-4">
      <Section title="Launches with a Holder Map" sub="per day, by chain · live from the launch poller, every minute">
        {!d ? (
          dc.k === 'error' ? <GhostChart height={150} variant="bars" label="Launches unreadable right now: retrying every minute" badge={false} /> : <Skeleton h={150} />
        ) : perDay.length ? (
          <StackedDays height={150} days={perDay} kinds={kinds} label={`Launches with a Holder Map per day over ${perDay.length} days: ${d.launches.length} in total.`} />
        ) : (
          <GhostChart height={150} variant="bars" label="Launches will draw here as the poller sees them" />
        )}
      </Section>
      {newest?.chainKey && (
        <Section title={`Newest map${newest.symbol ? `: ${newest.symbol}` : ''}`} sub="the animated mini map of the latest launch · live">
          <HolderMapMini chain={newest.chainKey} token={newest.token} external={!isLocalHost()} />
        </Section>
      )}
      </div>
      <section className={panel} aria-label="Latest launches with their Holder Maps" data-testid="holders-launches">
        <HolderLaunches launches={d?.launches.slice(0, 8) ?? null} asOf={d?.asOf ?? null} stale={d?.state !== 'ok'} />
      </section>
      </div>
    </>
  )
}
