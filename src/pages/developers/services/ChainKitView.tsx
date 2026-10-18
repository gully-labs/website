import { Boxes } from 'lucide-react'
import { ChainKitExample } from '../../../components/charts/ProductExamples'
import { ChainCompare } from '../../../components/tracker/MoreCharts'
import { ChainLogo } from '../../../components/tracker/StockLogo'
import { useTracker } from '../../../lib/tracker'
import { Skeleton } from '../parts'
import { ChainKitCard } from '../Products'
import { docsPage, sitePage } from './links'
import { Section, ServiceHeader, type Status } from './ServiceHeader'

/* Chain Kit, in the app: a branded Blockscout explorer for your chain, run by Gully Labs. The live
   figures are the chains Gully's own indexer reads right now (GET /api/tracker: chains, tokens indexed,
   feeds answering, pools read), charted chain against chain; the explorer request is the Products
   page's Chain Kit card (one form, one place). What an explorer draws is shown with example data,
   badged as such. */

export default function ChainKitView() {
  const st = useTracker()
  const data = st.k === 'ok' ? st.data : null
  const pending = st.k === 'error' ? 'unreadable' : '…'
  const feeds = data ? data.rows.filter((r) => r.fair !== null).length : null
  const pools = data ? data.rows.filter((r) => r.onchain !== null).length : null
  const status: Status = data ? { tone: 'live', text: `${data.chains.length} chains indexed live` } : st.k === 'error' ? { tone: 'down', text: 'unreadable' } : { tone: 'checking', text: 'reading…' }
  return (
    <>
      <ServiceHeader
        icon={Boxes}
        title="Chain Kit"
        desc="A Blockscout block explorer for your EVM chain, in your brand, deployed and operated by Gully Labs."
        status={status}
        docs={docsPage()}
        page={{ href: sitePage('/chain-kit') }}
        tiles={[
          { label: 'CHAINS READ LIVE', value: data?.chains.length, unknown: pending, note: data ? data.chains.map((c) => c.name).join(', ') : 'by our indexer' },
          { label: 'TOKENS INDEXED', value: data?.rows.length, unknown: pending, note: 'stock tokens' },
          { label: 'FEEDS ANSWERING', value: feeds, unknown: pending, note: 'fair price read' },
          { label: 'POOLS READ', value: pools, unknown: pending, note: 'on-chain price read' },
        ]}
      />

      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start gap-4 max-[1100px]:grid-cols-1">
        <Section
          title="What our indexer reads now"
          sub="chain against chain · live from /api/tracker, every minute"
          aside={
            data ? (
              <span className="flex flex-wrap gap-2">
                {data.chains.map((c) => (
                  <span key={c.key} className="inline-flex items-center gap-1 font-mono text-[11px] text-ink-2">
                    <ChainLogo chain={c.key} size={12} /> {c.sessionOpen ? 'open' : 'closed'}
                  </span>
                ))}
              </span>
            ) : null
          }
        >
          {data ? <ChainCompare rows={data.rows} chains={data.chains} /> : <Skeleton h={240} />}
        </Section>
        <ChainKitCard />
      </div>

      <Section title="Charts on day one" sub="what a Chain Kit explorer draws for your chain">
        <ChainKitExample />
      </Section>
    </>
  )
}
