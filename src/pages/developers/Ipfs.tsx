import { Globe, HardDrive, Pin, Wrench } from 'lucide-react'
import { useMemo } from 'react'
import { axisTooltip, C, linePreset, areaPreset, tipHtml } from '../../components/charts/chartPresets'
import { EChart } from '../../components/charts/EChart'
import { NF } from '../../components/charts/number-formats'
import { GhostCurves } from './charts'
import { ExtLink } from './ExtLink'
import { usePoll } from './poll'
import { ErrorLine, Skeleton } from './parts'
import { ServiceHeader, type Status, type Tile } from './services/ServiceHeader'
import { docsPage } from './services/links'
import { RefreshChip } from './ui'
import { BLUE, mono, panel, panelTitle, pillGold, pillLine, rise } from './styles'

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

/** The node's last hour: repo size (area) and the gateway's round trip (line), one point a minute. */
function NodeHour({ s, onRetry }: { s: Stats; onRetry: () => void }) {
  const pts = s.history.filter((h) => h.repoBytes !== null || h.ms !== null)
  const option = useMemo(() => {
    const labels = pts.map((h) => time(h.t))
    return {
      grid: { left: 48, right: 44, top: 12, bottom: 24 },
      xAxis: { type: 'category', boundaryGap: false, data: labels, axisLabel: { hideOverlap: true } },
      yAxis: [
        { type: 'value', name: 'GB', nameTextStyle: { padding: [0, 0, 0, -20] }, splitNumber: 3, axisLabel: { formatter: (v: number) => v.toFixed(2) } },
        { type: 'value', name: 'ms', splitNumber: 3, splitLine: { show: false }, axisLabel: { formatter: (v: number) => `${Math.round(v)}` } },
      ],
      tooltip: axisTooltip((ps: { dataIndex: number; seriesName: string; value: number | null; color: string }[]) => {
        const i = ps[0]?.dataIndex ?? -1
        return i < 0 ? '' : tipHtml({ title: labels[i], rows: ps.map((p) => ({ name: p.seriesName, value: p.value === null ? '—' : p.seriesName === 'repo size' ? `${(p.value as number).toFixed(3)} GB` : `${Math.round(p.value as number)} ms`, color: p.color })) })
      }, 'cross'),
      series: [
        { id: 'repo', name: 'repo size', yAxisIndex: 0, ...areaPreset({ color: C.gold, fill: 0.22 }), data: pts.map((h) => (h.repoBytes === null ? null : Number(gb(h.repoBytes).toFixed(4)))) },
        { id: 'ms', name: 'gateway round trip', yAxisIndex: 1, ...linePreset({ color: BLUE }), data: pts.map((h) => h.ms) },
      ],
    }
  }, [pts])
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
    <div className="flex flex-col gap-2" data-testid="ipfs-chart">
      <EChart option={option} height={170} label={`The node over the last ${pts.length} minutes: repo size in GB and the gateway's round trip in milliseconds, one point a minute.`} />
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 font-mono text-[11px] text-muted" aria-label="Legend">
        <li className="flex items-center gap-[6px]">
          <span className="size-[9px] rounded-[2px]" style={{ background: C.gold }} aria-hidden /> repo size (GB)
        </li>
        <li className="flex items-center gap-[6px]">
          <span className="size-[9px] rounded-[2px]" style={{ background: BLUE }} aria-hidden /> gateway round trip (ms)
        </li>
      </ul>
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
