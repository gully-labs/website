import { Globe, HardDrive, Pin, Wrench } from 'lucide-react'
import { useMemo } from 'react'
import { LiveChart, type LivePoint } from '../../components/live/GlLive'
import { NF } from '../../components/charts/number-formats'
import { GhostCurves } from './charts'
import { ExtLink } from './ExtLink'
import { usePoll } from './poll'
import { ErrorLine, Skeleton } from './parts'
import { ServiceHeader, type Status, type Tile } from './services/ServiceHeader'
import { docsPage } from './services/links'
import { RefreshChip } from './ui'
import { mono, panel, panelTitle, pillGold, pillLine, rise } from './styles'

/* Gully IPFS (app.gullylabs.xyz/#ipfs): Gully Labs' own Kubo node, with a read-only gateway at ipfs.gullylabs.xyz that
   serves only what the node holds. Every figure is GET /api/ipfs/stats (server/ipfs.mjs, read from the node every
   minute, cached 60 s): pinned CIDs, repo size against the node's storage limit, whether the gateway answers and how
   fast, and the last hour as a history (one point a minute). An unread figure is null and shows as "unreadable",
   never 0. Pinning from this account is not open yet: the page says so and points at Services, it does not pretend. */

interface Stats {
  generatedAt: string
  source: string
  gateway: string
  gatewayUp: boolean | null
  gatewayMs: number | null
  pinned: number | null
  repoBytes: number | null
  storageMaxBytes: number | null
  history: { t: string; pinned: number | null; repoBytes: number | null; up: boolean; ms: number | null }[]
}

const GB = 1024 ** 3
const MB = 1024 ** 2
const gb = (b: number) => b / GB
const sizeText = (b: number | null) => (b === null ? 'unreadable' : b >= GB ? `${(b / GB).toFixed(2)} GB` : `${Math.round(b / MB)} MB`)
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

/** The node's last hour on Gully Live UI: repo size (area, GB) and the gateway's round trip (line, ms), one point a
    minute, each its own chart with one axis. Fewer than two readings: the honest ghost says why. */
function NodeHour({ s, onRetry }: { s: Stats; onRetry: () => void }) {
  const pts = s.history.filter((h) => h.repoBytes !== null || h.ms !== null)
  const repo = useMemo(() => pts.filter((h) => h.repoBytes !== null).map((h) => [Date.parse(h.t), Number(gb(h.repoBytes as number).toFixed(4))] as LivePoint), [pts])
  const ms = useMemo(() => pts.filter((h) => h.ms !== null).map((h) => [Date.parse(h.t), h.ms as number] as LivePoint), [pts])
  if (pts.length < 2)
    return (
      <GhostCurves height={170} title="The node's last hour will draw here">
        <span className="max-w-[460px] text-[13px] text-muted">The server reads the node once a minute; the chart starts as soon as it has two readings.{s.source === 'none' ? ' Right now the node cannot be reached.' : ''}</span>
        {s.source === 'none' && (
          <button type="button" onClick={onRetry} className={`${pillLine} min-h-11`}>
            Read again
          </button>
        )}
      </GhostCurves>
    )
  return (
    <div className="grid gap-3 min-[1100px]:grid-cols-2" data-testid="ipfs-chart">
      <LiveChart kind="area" title="Repo size" unit="GB" height={150} series={repo} empty="The repo size was not readable this hour." label={`Repo size in GB over the last ${repo.length} minutes, one point a minute.`} />
      <LiveChart kind="line" title="Gateway round trip" unit="ms" height={150} series={ms} empty={s.gatewayUp === false ? 'The gateway is down: no round trip to chart.' : 'No round trip was measured this hour.'} label={`The gateway's round trip in milliseconds over the last ${ms.length} minutes.`} />
    </div>
  )
}

export function IpfsTab({ go }: { go: (tab: 'services') => void }) {
  const poll = usePoll<Stats>('/api/ipfs/stats', 30_000)
  const s = poll.data
  const err = s ? null : (poll.error ?? (poll.timedOut ? 'no answer in time' : null))
  const status: Status = !s ? (err ? { tone: 'down', text: 'unreadable' } : { tone: 'checking', text: 'reading the node' }) : s.gatewayUp === true ? { tone: 'live', text: `gateway up${s.gatewayMs !== null ? ` · ${s.gatewayMs} ms` : ''}` } : s.gatewayUp === false ? { tone: 'down', text: 'gateway down' } : { tone: 'idle', text: 'node unreachable' }
  const tiles: Tile[] = [
    { label: 'PINNED CIDS', value: s?.pinned ?? null, unknown: s ? 'unreadable' : 'reading…', note: 'recursive pins on the node' },
    { label: 'REPO SIZE', value: s?.repoBytes === null || s?.repoBytes === undefined ? null : Number(gb(s.repoBytes).toFixed(2)), format: { minimumFractionDigits: 2, maximumFractionDigits: 2 }, suffix: ' GB', unknown: s ? 'unreadable' : 'reading…', note: s?.storageMaxBytes ? `of ${sizeText(s.storageMaxBytes)} storage` : 'what the node holds' },
    { label: 'GATEWAY', value: s?.gatewayMs ?? null, format: NF.int, suffix: ' ms', unknown: s ? (s.gatewayUp === false ? 'down' : 'unreadable') : 'reading…', note: 'round trip from the server' },
    { label: 'STORAGE USED', value: s?.repoBytes != null && s.storageMaxBytes ? Math.round((s.repoBytes / s.storageMaxBytes) * 1000) / 10 : null, format: { minimumFractionDigits: 1, maximumFractionDigits: 1 }, suffix: '%', unknown: s ? 'no limit read' : 'reading…', note: 'of the node’s limit' },
  ]
  return (
    <div className="flex flex-col gap-2" data-testid="ipfs-page">
      <ServiceHeader icon={HardDrive} title="Gully IPFS" eyebrow="Run by Gully Labs" desc="Token art, metadata and .gully sites pinned on our own node and served read-only at ipfs.gullylabs.xyz. Every figure below is read from the node itself." status={status} tiles={tiles} docs={docsPage('ipfs')} page={{ href: s?.gateway ?? 'https://ipfs.gullylabs.xyz', label: 'Gateway' }}>
        <RefreshChip error={s ? poll.error : null} onRetry={() => void poll.reload()} />
      </ServiceHeader>
      {err && !s ? (
        <ErrorLine onRetry={() => void poll.reload()}>The node could not be read: {err}</ErrorLine>
      ) : (
        <div className="flex flex-wrap items-stretch gap-2">
          <section aria-labelledby="ipfs-hour" className={`${panel} flex-[999_1_520px]`} style={rise(1)}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="ipfs-hour" className={panelTitle}>
                The node, last hour
              </h2>
              <span className={mono}>{s ? `read ${time(s.generatedAt)} · source ${s.source}` : 'reading…'}</span>
            </div>
            {!s ? <Skeleton h={170} /> : <NodeHour s={s} onRetry={() => void poll.reload()} />}
          </section>
          <section aria-labelledby="ipfs-pins" className={`${panel} flex-[1_1_320px] gap-3`} style={rise(2)} data-testid="ipfs-your-pins">
            <div className="flex items-center gap-2">
              <Pin size={16} className="text-gold" aria-hidden />
              <h2 id="ipfs-pins" className={panelTitle}>
                Your pins
              </h2>
            </div>
            <p className="m-0 text-[14px] leading-[1.55] text-muted">
              Pinning from this account is not open yet: today the node pins what Gully products publish (token art, coin metadata, .gully sites). To pin your own content or run a dedicated node, ask us under Services and we set it up with you.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => go('services')} className={`${pillGold} min-h-11`} data-testid="ipfs-ask">
                <Wrench size={15} aria-hidden /> Ask for pinning
              </button>
              <ExtLink href={`${s?.gateway ?? 'https://ipfs.gullylabs.xyz'}/ipfs/bafyaabakaieac`} className={`${pillLine} min-h-11`}>
                <Globe size={15} aria-hidden /> Try the gateway
              </ExtLink>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
