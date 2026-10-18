import { ScanSearch } from 'lucide-react'
import { LaunchHolders } from '../../../components/holders/LaunchHolders'
import { isLocalHost } from '../../../site-host'
import { panel } from '../styles'
import { docsPage, sitePage } from './links'
import { ServiceHeader, type Status } from './ServiceHeader'
import { useLaunches } from './useDeepcore'

/* Holder Map, in the app: who holds a DeepCore launch or a stock token (bundled buys, the deployer, connected
   wallets, a replay). The maps themselves are public pages (/holders/<chain>/<token>, a new tab from here);
   this page lists the latest launches with their maps, live from the launch poller, and Cluster Watch alerts
   are set in the Alerts tab. */

export default function HoldersView() {
  const dc = useLaunches()
  const d = dc.k === 'ok' ? dc.data : null
  const pending = dc.k === 'error' ? 'unreadable' : '…'
  const now = d?.asOf ? Date.parse(d.asOf) : 0
  const day = d ? d.launches.filter((l) => now - Date.parse(l.createdAt) < 86_400_000) : []
  const status: Status = d ? (d.state === 'ok' ? { tone: 'live', text: 'live launches' } : { tone: 'down', text: d.state }) : dc.k === 'error' ? { tone: 'down', text: 'launches unreadable' } : { tone: 'checking', text: 'reading…' }
  return (
    <>
      <ServiceHeader
        icon={ScanSearch}
        title="Holder Map"
        desc="Who holds a DeepCore launch or a stock token: bundled buys, the deployer, connected wallets and a replay. Cluster Watch alerts arrive in the Alerts tab."
        status={status}
        docs={docsPage('holder-map')}
        page={{ href: sitePage('/holders') }}
        tiles={[
          { label: 'LAUNCHES LISTED', value: d?.launches.length, unknown: pending, note: 'newest first' },
          { label: 'LAUNCHED · 24H', value: d ? day.length : null, unknown: pending, note: 'by the poller’s last read' },
          { label: 'CHAINS', value: d?.chains.length, unknown: pending, note: d ? d.chains.map((c) => c.name).join(', ') : 'watched' },
        ]}
      />
      <section className={panel} aria-label="Latest launches with their Holder Maps" data-testid="holders-launches">
        <LaunchHolders external={!isLocalHost()} limit={8} />
      </section>
    </>
  )
}
