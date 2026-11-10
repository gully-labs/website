import { Globe, HardDrive, KeyRound, Pin, Trash2, Upload } from 'lucide-react'
import { useMemo, useRef, useState, type DragEvent } from 'react'
import { LiveChart, type LivePoint } from '../../components/live/GlLive'
import { toastError, toastSuccess } from '../../components/ui/toast'
import { CodeBlock } from '../../docs/CodeBlock'
import { api } from './api'
import { GhostCurves } from './charts'
import { CopyButton } from './Dialog'
import { ExtLink } from './ExtLink'
import { usePoll } from './poll'
import { ErrorLine, Skeleton } from './parts'
import { useWrite } from './portal'
import { ServiceHeader, type Status, type Tile } from './services/ServiceHeader'
import { docsPage } from './services/links'
import { RefreshChip } from './ui'
import { input, mono, panel, panelTitle, pillGold, pillLine, pillSm, rise } from './styles'

/* Gully IPFS (app.gullylabs.xyz/#ipfs): this account's own pins and usage, never the node's internals (those are on
   the status page). Upload a file here (added and pinned at once), see every pin with its status and copies, unpin,
   and make a key with the ipfs:pin scope for the IPFS Pinning Service API. Every figure is GET /api/developer/ipfs
   (server/ipfs-pins.mjs) for the active workspace. */

export interface IpfsPin {
  id: string
  cid: string
  name: string | null
  status: 'queued' | 'pinning' | 'pinned' | 'failed'
  created: string
  bytes: number | null
  reason: string | null
  source: 'api' | 'upload' | 'car'
  review: 'queued' | 'ok' | 'removed' | null
  copies: number
}
export interface IpfsAccount {
  plan: { id: string; name: string; storageBytes: number; maxFileBytes: number; maxPins: number; copies: number }
  usage: { pins: number; bytes: number; uploadsThisMonth: number }
  pins: IpfsPin[]
  days: { day: string; bytes: number }[]
  replica: { inSync: boolean }
  api: { base: string; scope: string }
}

const GATEWAY = 'https://ipfs.gullylabs.xyz'
const MB = 1024 ** 2
const size = (b: number | null) => (b == null ? '—' : b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= MB ? `${(b / MB).toFixed(1)} MB` : b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`)
const shortCid = (c: string) => `${c.slice(0, 10)}…${c.slice(-6)}`
const TONE: Record<IpfsPin['status'], string> = { pinned: 'text-up', queued: 'text-muted', pinning: 'text-gold', failed: 'text-down' }

function Usage({ a }: { a: IpfsAccount }) {
  const pts = useMemo(() => a.days.map((d) => [Date.parse(`${d.day}T12:00:00Z`), Number((d.bytes / MB).toFixed(3))] as LivePoint), [a.days])
  if (pts.length < 2)
    return (
      <GhostCurves height={170} title="Your storage will draw here">
        <span className="max-w-[460px] text-[13px] text-muted">{a.usage.pins ? 'One point a day: the chart starts with your second day of pins.' : 'This account has no pins yet. Upload a file or pin a CID and your stored size draws here, one point a day.'}</span>
      </GhostCurves>
    )
  return <LiveChart kind="area" title="Stored" unit="MB" height={170} series={pts} empty="No usage recorded yet." label={`Your stored size in MB over the last ${pts.length} days.`} />
}

function UploadArea({ a, onDone }: { a: IpfsAccount; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const can = useWrite('ipfs', 'upload to Gully IPFS').ok
  const send = async (f: File) => {
    setErr(null)
    if (f.size > a.plan.maxFileBytes) return setErr(`${f.name} is ${size(f.size)}: files up to ${size(a.plan.maxFileBytes)} on the ${a.plan.name} plan.`)
    if (a.usage.bytes + f.size > a.plan.storageBytes) return setErr(`Not enough room: ${size(a.plan.storageBytes - a.usage.bytes)} left of ${size(a.plan.storageBytes)}. Remove a pin first.`)
    setBusy(f.name)
    try {
      const car = /\.car$/i.test(f.name)
      const r = await fetch(`/api/developer/ipfs/upload?name=${encodeURIComponent(f.name)}`, { method: 'POST', credentials: 'same-origin', headers: { 'x-requested-with': 'gully', 'content-type': car ? 'application/vnd.ipld.car' : 'application/octet-stream' }, body: f })
      const d = (await r.json().catch(() => null)) as { pin?: { cid: string }; error?: { details?: string; reason?: string } | string } | null
      if (!r.ok) {
        const m = typeof d?.error === 'string' ? d.error : (d?.error?.details ?? d?.error?.reason ?? `The server answered ${r.status}.`)
        setErr(m)
        toastError('Upload failed', { detail: m })
      } else {
        toastSuccess('Pinned', { detail: `${f.name} · ${shortCid(d?.pin?.cid ?? '')}` })
        onDone()
      }
    } catch {
      setErr('The upload did not reach the server. Try again.')
    } finally {
      setBusy(null)
      if (ref.current) ref.current.value = ''
    }
  }
  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f && can && !busy) void send(f)
  }
  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={`flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed p-4 text-center ${over ? 'border-gold bg-surface-deep' : 'border-line-strong'}`}
        data-testid="ipfs-upload"
      >
        <Upload size={20} className="text-gold" aria-hidden />
        <span className="text-[14px] text-ink-2">{busy ? `Uploading ${busy}…` : 'Drop a file here, or choose one'}</span>
        <span className="text-[12px] text-faint">
          Up to {size(a.plan.maxFileBytes)} a file · a .car file is imported as a DAG · images and video are reviewed under the content policy
        </span>
        <label className={`${pillGold} min-h-11 ${!can || busy ? 'pointer-events-none opacity-60' : 'cursor-pointer'}`}>
          <input ref={ref} type="file" className="sr-only" disabled={!can || !!busy} onChange={(e) => e.target.files?.[0] && void send(e.target.files[0])} data-testid="ipfs-file" />
          <Upload size={15} aria-hidden /> Choose a file
        </label>
      </div>
      {err && <ErrorLine>{err}</ErrorLine>}
    </div>
  )
}

function PinsList({ a, onDone }: { a: IpfsAccount; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const can = useWrite('ipfs', 'unpin').ok
  const unpin = async (p: IpfsPin) => {
    setBusy(p.id)
    const r = await api(`/api/developer/ipfs/pins/${p.id}/delete`, { method: 'POST' })
    setBusy(null)
    if (!r.ok) return toastError('Unpin failed', { detail: r.error })
    toastSuccess('Unpinned', { detail: p.name ?? shortCid(p.cid) })
    onDone()
  }
  if (!a.pins.length) return <p className="m-0 text-[14px] text-muted" data-testid="ipfs-pins-empty">No pins yet. Upload a file above, or pin a CID with the API.</p>
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="ipfs-pins-list">
      {a.pins.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line px-3 py-2" data-pin={p.cid}>
          <span className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-[14px] font-medium text-ink">{p.name ?? 'Unnamed'}</span>
            <span className="flex flex-wrap items-center gap-2 font-mono text-[12px] text-faint">
              {p.status === 'pinned' ? (
                <ExtLink href={`${GATEWAY}/ipfs/${p.cid}`} className="underline decoration-dotted">
                  {shortCid(p.cid)}
                </ExtLink>
              ) : (
                shortCid(p.cid)
              )}
              <CopyButton text={p.cid} label="Copy CID" what="CID" />
              <span>{size(p.bytes)}</span>
              <span className={TONE[p.status]} data-status={p.status}>
                {p.status}
              </span>
              {p.status === 'pinned' && <span>{p.copies === 2 ? '2 copies' : '1 copy, second syncing'}</span>}
              {p.review === 'queued' && <span>in review</span>}
            </span>
            {p.reason && <span className="text-[12px] text-down">{p.reason}</span>}
          </span>
          <button type="button" className={`${pillSm} ${pillLine}`} onClick={() => void unpin(p)} disabled={!can || busy === p.id} aria-label={`Unpin ${p.name ?? p.cid}`}>
            <Trash2 size={14} aria-hidden /> {busy === p.id ? 'Unpinning…' : 'Unpin'}
          </button>
        </li>
      ))}
    </ul>
  )
}

function ApiPanel({ a }: { a: IpfsAccount }) {
  const [name, setName] = useState('IPFS pinning')
  const [secret, setSecret] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const can = useWrite('keys', 'create keys').ok
  const create = async () => {
    setBusy(true)
    setErr(null)
    const r = await api<{ secret: string }>('/api/developer/keys', { method: 'POST', body: { name, scopes: [a.api.scope] } })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    setSecret(r.data.secret)
    toastSuccess('Pinning key created', { detail: 'Copy its secret now, it is shown once.' })
  }
  const k = secret ?? '<your key>'
  const cmd = `ipfs pin remote service add gully ${a.api.base} ${k}\nipfs pin remote add --service=gully --name=my-file <CID>`
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[14px] leading-[1.55] text-muted">
        The standard IPFS Pinning Service API: any tool that speaks it (Kubo&apos;s <span className={mono}>ipfs pin remote</span>, IPFS Desktop) works with a key that has the <span className={mono}>{a.api.scope}</span> scope.
      </p>
      {secret ? (
        <div className="flex flex-col gap-2" data-testid="ipfs-key-secret">
          <span className="text-[13px] text-ink-2">Your new key (shown once):</span>
          <code className="break-all rounded-[8px] bg-surface-deep px-3 py-2 font-mono text-[12.5px]">{secret}</code>
          <CopyButton text={secret} label="Copy key" what="Key" />
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-[13px] text-ink-2">
            Key name
            <input className={input} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="button" className={`${pillGold} min-h-11`} onClick={() => void create()} disabled={!can || busy || !name.trim()} data-testid="ipfs-create-key">
            <KeyRound size={15} aria-hidden /> {busy ? 'Creating…' : 'Create a pinning key'}
          </button>
        </div>
      )}
      {err && <ErrorLine>{err}</ErrorLine>}
      <CodeBlock code={cmd} lang="bash" />
    </div>
  )
}

export function IpfsTab() {
  const poll = usePoll<IpfsAccount>('/api/developer/ipfs', 15_000)
  const a = poll.data
  const err = a ? null : (poll.error ?? (poll.timedOut ? 'no answer in time' : null))
  const status: Status = !a ? (err ? { tone: 'down', text: 'unreadable' } : { tone: 'checking', text: 'reading' }) : { tone: 'live', text: `${a.plan.name} plan` }
  const tiles: Tile[] = [
    { label: 'YOUR PINS', value: a?.usage.pins ?? null, unknown: 'reading…', note: a ? `of ${a.plan.maxPins} on your plan` : 'pins held for this account' },
    { label: 'STORAGE USED', value: a ? Number((a.usage.bytes / MB).toFixed(1)) : null, format: { minimumFractionDigits: 1, maximumFractionDigits: 1 }, suffix: ' MB', unknown: 'reading…', note: a ? `of ${size(a.plan.storageBytes)}` : 'by your pins' },
    { label: 'UPLOADS', value: a?.usage.uploadsThisMonth ?? null, unknown: 'reading…', note: 'files and CARs this month' },
    { label: 'COPIES PER PIN', value: a ? (a.replica.inSync ? 2 : 1) : null, unknown: 'reading…', note: a?.replica.inSync ? 'two nodes on two servers' : 'second copy syncing' },
  ]
  return (
    <div className="flex flex-col gap-2" data-testid="ipfs-page">
      <ServiceHeader icon={HardDrive} title="Gully IPFS" eyebrow="Run by Gully Labs" desc="Pin files to IPFS with your own keys, upload from here, and serve them at ipfs.gullylabs.xyz. You see only your own pins and usage." status={status} tiles={tiles} docs={docsPage('ipfs')} page={{ href: 'https://status.gullylabs.xyz', label: 'Status' }}>
        <RefreshChip error={a ? poll.error : null} onRetry={() => void poll.reload()} />
      </ServiceHeader>
      {err && !a ? (
        <ErrorLine onRetry={() => void poll.reload()}>Your pins could not be read: {err}</ErrorLine>
      ) : (
        <div className="flex flex-wrap items-stretch gap-2">
          <section aria-labelledby="ipfs-up" className={`${panel} flex-[999_1_520px] gap-3`} style={rise(1)}>
            <h2 id="ipfs-up" className={panelTitle}>
              Upload
            </h2>
            {!a ? <Skeleton h={120} /> : <UploadArea a={a} onDone={() => void poll.reload()} />}
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className={panelTitle}>Your usage</h2>
              <span className={mono}>this account</span>
            </div>
            {!a ? <Skeleton h={170} /> : <Usage a={a} />}
          </section>
          <section aria-labelledby="ipfs-pins" className={`${panel} flex-[1_1_360px] gap-3`} style={rise(2)} data-testid="ipfs-your-pins">
            <div className="flex items-center gap-2">
              <Pin size={16} className="text-gold" aria-hidden />
              <h2 id="ipfs-pins" className={panelTitle}>
                Your pins
              </h2>
            </div>
            {!a ? <Skeleton h={160} /> : <PinsList a={a} onDone={() => void poll.reload()} />}
            <ExtLink href={`${GATEWAY}/ipfs/bafyaabakaieac`} className={`${pillLine} min-h-11 self-start`}>
              <Globe size={15} aria-hidden /> Try the gateway
            </ExtLink>
          </section>
          <section aria-labelledby="ipfs-api" className={`${panel} flex-[999_1_520px] gap-3`} style={rise(3)} data-testid="ipfs-api">
            <h2 id="ipfs-api" className={panelTitle}>
              Pinning Service API
            </h2>
            {!a ? <Skeleton h={120} /> : <ApiPanel a={a} />}
          </section>
        </div>
      )}
    </div>
  )
}
