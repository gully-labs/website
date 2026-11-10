import { Globe, HardDrive, Pin, Upload } from 'lucide-react'
import { GhostCurves } from './charts'
import { ExtLink } from './ExtLink'
import { ServiceHeader, type Status, type Tile } from './services/ServiceHeader'
import { docsPage } from './services/links'
import { mono, panel, panelTitle, pillLine, rise } from './styles'

/* Gully IPFS (app.gullylabs.xyz/#ipfs): the account's own view. It shows only this account's pins and usage, never the
   node's internals (repo size, storage limit, the node's pin count): those are on the status page. Pinning from the
   hub is coming soon (the Pinning Service API with hub keys); until it is live this account holds no pins, so every
   figure here is honestly zero and the page says why. */

const STATUS_PAGE = 'https://status.gullylabs.xyz'
const GATEWAY = 'https://ipfs.gullylabs.xyz'

export function IpfsTab() {
  const status: Status = { tone: 'idle', text: 'pinning coming soon' }
  const tiles: Tile[] = [
    { label: 'YOUR PINS', value: 0, note: 'pins held for this account' },
    { label: 'STORAGE USED', value: 0, suffix: ' MB', note: 'by your pins' },
    { label: 'UPLOADS', value: 0, note: 'files and CARs this month' },
    { label: 'COPIES PER PIN', value: null, unknown: 'coming soon', note: 'two nodes on two servers' },
  ]
  return (
    <div className="flex flex-col gap-2" data-testid="ipfs-page">
      <ServiceHeader icon={HardDrive} title="Gully IPFS" eyebrow="Run by Gully Labs" desc="Pin files to IPFS with your own keys, upload from here, and serve them at ipfs.gullylabs.xyz. You see only your own pins and usage." status={status} tiles={tiles} docs={docsPage('ipfs')} page={{ href: STATUS_PAGE, label: 'Status' }} />
      <div className="flex flex-wrap items-stretch gap-2">
        <section aria-labelledby="ipfs-usage" className={`${panel} flex-[999_1_520px]`} style={rise(1)}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="ipfs-usage" className={panelTitle}>
              Your usage
            </h2>
            <span className={mono}>this account</span>
          </div>
          <GhostCurves height={170} title="Your storage will draw here">
            <span className="max-w-[460px] text-[13px] text-muted">This account has no pins yet. Once pinning opens, your stored size and uploads draw here, one point a day.</span>
          </GhostCurves>
        </section>
        <section aria-labelledby="ipfs-pins" className={`${panel} flex-[1_1_320px] gap-3`} style={rise(2)} data-testid="ipfs-your-pins">
          <div className="flex items-center gap-2">
            <Pin size={16} className="text-gold" aria-hidden />
            <h2 id="ipfs-pins" className={panelTitle}>
              Your pins
            </h2>
          </div>
          <p className="m-0 text-[14px] leading-[1.55] text-muted">
            Pinning is coming soon: an upload area here, and the standard IPFS Pinning Service API with keys from the Keys page, so <span className={mono}>ipfs pin remote</span> works as it does with any pinning service. Node health is on the status page.
          </p>
          <div className="flex flex-wrap gap-2">
            <span className={`${pillLine} min-h-11 cursor-default opacity-70`} aria-disabled="true" data-testid="ipfs-upload-soon">
              <Upload size={15} aria-hidden /> Upload: coming soon
            </span>
            <ExtLink href={`${GATEWAY}/ipfs/bafyaabakaieac`} className={`${pillLine} min-h-11`}>
              <Globe size={15} aria-hidden /> Try the gateway
            </ExtLink>
          </div>
        </section>
      </div>
    </div>
  )
}
