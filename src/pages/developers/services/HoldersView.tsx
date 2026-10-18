import { ScanSearch } from 'lucide-react'
import { useMemo } from 'react'
import { HolderMapMini } from '../../../components/holders/HolderMapMini'
import { LaunchHolders } from '../../../components/holders/LaunchHolders'
import { isLocalHost } from '../../../site-host'
import { Skeleton } from '../parts'
import { panel } from '../styles'
import { EmptyChart, StackedDays } from '../vcharts'
import { docsPage, sitePage } from './links'
import { Section, ServiceHeader, type Status } from './ServiceHeader'
import { deepcoreColor, useLaunches } from './useDeepcore'

/* Holder Map, in the app: who holds a DeepCore launch or a stock token (bundled buys, the deployer, connected
   wallets, a replay). The maps themselves are public pages (/holders/<chain>/<token>, a new tab from here);
   this page charts and lists the latest launches with their maps, live from the launch poller, and holder
   alerts are set in the Alerts tab. */

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
      <Section title="Launches with a Holder Map" sub="per day, by chain · live from the launch poller, every minute">
        {!d ? (
          dc.k === 'error' ? <EmptyChart height={150} title="Launches unreadable right now: retrying every minute" /> : <Skeleton h={150} />
        ) : perDay.length ? (
          <StackedDays height={150} days={perDay} kinds={kinds} label={`Launches with a Holder Map per day over ${perDay.length} days: ${d.launches.length} in total.`} />
        ) : (
          <EmptyChart height={150} title="No launch yet: each one charts here as the poller sees it" />
        )}
      </Section>
      <section className={panel} aria-label="Latest launches with their Holder Maps" data-testid="holders-launches">
        <LaunchHolders external={!isLocalHost()} limit={8} />
      </section>
      {newest?.chainKey && (
        <Section title={`Newest map${newest.symbol ? `: ${newest.symbol}` : ''}`} sub="the animated mini map of the latest launch · live" className="col-span-full">
          <HolderMapMini chain={newest.chainKey} token={newest.token} external={!isLocalHost()} />
        </Section>
      )}
      </div>
    </>
  )
}
