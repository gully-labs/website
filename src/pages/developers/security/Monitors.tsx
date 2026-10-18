import { Activity, Gauge, Pause, Play, Plus, Radar, RotateCw, Send, ShieldAlert, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { barsPreset, axisTooltip, C, tipHtml } from '../../../components/charts/chartPresets'
import { EChart } from '../../../components/charts/EChart'
import { toastSuccess } from '../../../components/ui/toast'
import { DOCS_URL, isLocalHost } from '../../../site-host'
import { ago, api } from '../api'
import { CopyButton, Dialog } from '../Dialog'
import { ExtLink } from '../ExtLink'
import { Empty, ErrorLine, Skeleton } from '../parts'
import { useWrite } from '../portal'
import { input, label, mono, panel, panelTitle, pillGold, pillLine, pillSm, rise } from '../styles'

/* Gully Security monitoring in the app: the contracts this workspace watches (server/sec-monitor.mjs), what was
   seen on each, and the deliveries. Mounted by the Security tab (part 2) as its "Monitors" sub-tab. Limits come
   from the plan (GET /api/developer/monitors); every figure here is read from that answer. */

export interface MonitorEvent {
  kind: string
  key: string
  text: string
  at: string
  txHash: string | null
  link: string
  blockNumber: number | null
  privileged: boolean
}
export interface Monitor {
  id: string
  name: string | null
  chainId: number
  chain: string
  chainKey: string | null
  address: string
  explorer: string
  score: string
  thresholds: { pct: number; native: string | null }
  webhook: { url: string } | null
  telegram: boolean
  publicScore: boolean
  enabled: boolean
  coveredByPlan: boolean
  createdAt: string
  lastCheckedAt: string | null
  lastError: string | null
  control: { owner: string | null; implementation: string | null; admin: string | null; safe: { address: string; threshold: number; owners: number } | null; paused: boolean | null } | null
  events: MonitorEvent[]
  deliveries: { id: string; at: string; test: boolean; channel: string; ok: boolean; status: number | null; error: string | null; ms: number; events: number }[]
}
export interface MonitorsView {
  monitors: Monitor[]
  limits: { plan: string; planName: string; max: number; used: number }
  chains: { id: number; key: string; name: string }[]
  telegram: { enabled: boolean; linked: boolean }
  load: { loopSeconds: number; perChainPerMin: number; perContractPerMin: number; chains: number; contracts: number; totalPerMin: number }
  loopSeconds: number
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const fieldLabel = 'flex flex-col gap-2 text-[14px] text-ink-2'

/** Events seen across every monitor, per day for the last 14 days: privileged changes and outflows. */
function EventDays({ monitors, now }: { monitors: Monitor[]; now: number }) {
  const option = useMemo(() => {
    const days = [...Array(14)].map((_, i) => new Date(now - (13 - i) * 86_400_000).toISOString().slice(0, 10))
    const count = (priv: boolean) => days.map((d) => monitors.reduce((n, m) => n + m.events.filter((e) => e.at.slice(0, 10) === d && e.privileged === priv).length, 0))
    const a = count(true)
    const b = count(false)
    return {
      grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
      legend: { top: 0, right: 0, data: ['Privileged changes', 'Outflows'] },
      tooltip: axisTooltip((ps: { dataIndex: number }[]) => tipHtml({ title: days[ps[0].dataIndex], rows: [{ name: 'Privileged changes', value: String(a[ps[0].dataIndex]), color: C.gold }, { name: 'Outflows', value: String(b[ps[0].dataIndex]), color: '#5aa9e6' }] }), 'shadow'),
      xAxis: { type: 'category', data: days.map((d) => d.slice(5)) },
      yAxis: { type: 'value', minInterval: 1 },
      series: [
        { ...barsPreset({ focus: 'series' }), id: 'priv', name: 'Privileged changes', stack: 'e', color: C.gold, data: a, barMaxWidth: 18 },
        { ...barsPreset({ focus: 'series' }), id: 'out', name: 'Outflows', stack: 'e', color: '#5aa9e6', data: b, barMaxWidth: 18 },
      ],
    }
  }, [monitors, now])
  const total = monitors.reduce((n, m) => n + m.events.length, 0)
  return <EChart option={option} height={180} label={`Events seen on watched contracts, last 14 days: ${total} in all`} steps={{ count: 14 }} skeleton="bars" />
}

function AddDialog({ open, onClose, view, onAdded }: { open: boolean; onClose: () => void; view: MonitorsView; onAdded: (secret: string | null) => void }) {
  const [chain, setChain] = useState(view.chains[0]?.key ?? 'base')
  const [address, setAddress] = useState('')
  const [name, setName] = useState('')
  const [pct, setPct] = useState('10')
  const [native, setNative] = useState('')
  const [webhook, setWebhook] = useState('')
  const [tg, setTg] = useState(view.telegram.enabled && view.telegram.linked)
  const [listed, setListed] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const coin = { bnb: 'BNB', polygon: 'POL', avalanche: 'AVAX' }[chain] ?? 'ETH'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    const r = await api<{ secret: string | null }>('/api/developer/monitors', { method: 'POST', body: { chain, address: address.trim(), name: name.trim(), pct: Number(pct), native: native.trim() || undefined, webhookUrl: webhook.trim() || undefined, telegram: tg || undefined, publicScore: listed } })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    toastSuccess('Now watching', { detail: name.trim() || short(address.trim()) })
    setAddress('')
    setName('')
    setWebhook('')
    onAdded(r.data.secret)
  }

  return (
    <Dialog open={open} onClose={onClose} title="Watch a contract">
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <div className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-3 max-[480px]:grid-cols-1">
          <label className={fieldLabel}>
            Chain
            <select className={input} value={chain} onChange={(e) => setChain(e.target.value)}>
              {view.chains.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldLabel}>
            Contract address
            <input className={`${input} font-mono text-[13px]`} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" required />
          </label>
        </div>
        <label className={fieldLabel}>
          <span>
            Name <span className="text-[12px] text-faint">optional, shown in alerts</span>
          </span>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Treasury vault" />
        </label>
        <div className="grid grid-cols-2 gap-3 max-[480px]:grid-cols-1">
          <label className={fieldLabel}>
            Outflow alert at
            <span className="flex items-center gap-2">
              <input className={input} type="number" min={1} max={100} step="0.1" value={pct} onChange={(e) => setPct(e.target.value)} />
              <span className="text-faint">% of its balance</span>
            </span>
          </label>
          <label className={fieldLabel}>
            <span>
              Or {coin} amount <span className="text-[12px] text-faint">optional</span>
            </span>
            <input className={input} inputMode="decimal" value={native} onChange={(e) => setNative(e.target.value)} placeholder={`e.g. 5 ${coin}`} />
          </label>
        </div>
        <label className={fieldLabel}>
          <span>
            Webhook URL <span className="text-[12px] text-faint">signed like every Gully alert</span>
          </span>
          <input className={input} value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://…" inputMode="url" />
        </label>
        {view.telegram.enabled && (
          <label className="flex min-h-11 items-center gap-3 text-[14px] text-ink-2">
            <input type="checkbox" checked={tg} disabled={!view.telegram.linked} onChange={(e) => setTg(e.target.checked)} className="size-4 accent-[#e8c060]" />
            Telegram {view.telegram.linked ? '' : <span className="text-faint">(connect Telegram in Alerts first)</span>}
          </label>
        )}
        <label className="flex min-h-11 items-center gap-3 text-[14px] text-ink-2">
          <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} className="size-4 accent-[#e8c060]" />
          List its Gully Score publicly on /score (the score itself is the same either way)
        </label>
        {err && <ErrorLine>{err}</ErrorLine>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={pillLine} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={pillGold} disabled={busy}>
            <Radar aria-hidden size={16} /> {busy ? 'Reading the contract…' : 'Start watching'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function MonitorCard({ m, act, busy, i }: { m: Monitor; act: (m: Monitor, op: string) => void; busy: string | null; i: number }) {
  const w = useWrite('alerts', 'change monitors')
  const state = !m.coveredByPlan ? 'Not in your plan' : !m.enabled ? 'Paused' : m.lastError ? m.lastError : m.lastCheckedAt ? `Checked ${ago(m.lastCheckedAt)}` : 'Starting'
  const live = m.enabled && m.coveredByPlan && !m.lastError
  return (
    <li className={`${panel} gap-4`} style={rise(i)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className={panelTitle}>{m.name || short(m.address)}</span>
          <span className={mono}>
            {m.chain} · {short(m.address)} · outflows at {m.thresholds.pct}%{m.thresholds.native ? ` or ${m.thresholds.native}` : ''}
          </span>
          <span className="flex items-center gap-2 text-[12px] text-dim">
            <span aria-hidden className={`size-2 rounded-full ${live ? 'bg-green' : 'bg-line-hover'}`} style={live ? { animation: 'gl-live-pulse 2.6s ease-out infinite' } : undefined} />
            {state}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExtLink href={isLocalHost() ? m.score : `https://gullylabs.xyz${m.score}`} className={pillSm}>
            <Gauge aria-hidden size={14} /> Score
          </ExtLink>
          <button type="button" className={pillSm} disabled={!!busy || !w.ok} title={w.why} onClick={() => act(m, 'test')}>
            <Send aria-hidden size={14} /> Test
          </button>
          <button type="button" className={pillSm} disabled={!!busy || !w.ok} title={w.why} onClick={() => act(m, m.enabled ? 'pause' : 'resume')}>
            {m.enabled ? <Pause aria-hidden size={14} /> : <Play aria-hidden size={14} />} {m.enabled ? 'Pause' : 'Resume'}
          </button>
          {m.webhook && (
            <button type="button" className={pillSm} disabled={!!busy || !w.ok} title={w.why} onClick={() => act(m, 'rotate')}>
              <RotateCw aria-hidden size={14} /> New secret
            </button>
          )}
          <button type="button" className={pillSm} disabled={!!busy || !w.ok} title={w.why} onClick={() => act(m, 'delete')} aria-label={`Stop watching ${m.name || m.address}`}>
            <Trash2 aria-hidden size={14} />
          </button>
        </div>
      </div>
      {m.control && (
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,160px),1fr))] gap-3 text-[13px]">
          <div>
            <dt className={label}>Owner</dt>
            <dd className="m-0 font-mono text-ink-2">{m.control.owner ? short(m.control.owner) : 'none found'}</dd>
          </div>
          <div>
            <dt className={label}>Upgradeable</dt>
            <dd className="m-0 font-mono text-ink-2">{m.control.implementation ? `yes, code at ${short(m.control.implementation)}` : 'no'}</dd>
          </div>
          <div>
            <dt className={label}>Safe</dt>
            <dd className="m-0 font-mono text-ink-2">{m.control.safe ? `${m.control.safe.threshold} of ${m.control.safe.owners}` : 'not a Safe'}</dd>
          </div>
          <div>
            <dt className={label}>Delivers to</dt>
            <dd className="m-0 text-ink-2">{[m.telegram && 'Telegram', m.webhook && 'Webhook'].filter(Boolean).join(' + ')}</dd>
          </div>
        </dl>
      )}
      <div className="flex flex-col gap-2">
        <span className={label}>Seen on it</span>
        {m.events.length === 0 ? (
          <span className="text-[13px] text-faint">Nothing yet. Owner, admin, role, upgrade, pause, Safe signer changes and large outflows show here and are sent to you.</span>
        ) : (
          <ul className="m-0 flex max-h-[220px] list-none flex-col gap-2 overflow-y-auto p-0">
            {m.events.slice(0, 20).map((e) => (
              <li key={e.key} className="flex flex-col gap-[2px] text-[13px]">
                <span className="text-ink-2">{e.text.replace(/ · https?:\/\/\S+$/, '')}</span>
                <span className="flex items-center gap-3 font-mono text-[11px] text-faint">
                  {ago(e.at)}
                  <ExtLink href={e.link} className="inline-flex items-center gap-1 text-gold">
                    {e.txHash ? 'Transaction' : 'Contract'}
                  </ExtLink>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {m.deliveries.length > 0 && (
        <span className={mono}>
          Last delivery {ago(m.deliveries[0].at)}: {m.deliveries[0].channel} {m.deliveries[0].ok ? 'delivered' : `failed (${m.deliveries[0].error ?? m.deliveries[0].status})`}
        </span>
      )}
    </li>
  )
}

/** The Monitors sub-tab of the app's Security tab. */
export function Monitors() {
  const [view, setView] = useState<MonitorsView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const w = useWrite('alerts', 'add monitors')

  const [readAt, setReadAt] = useState(0)
  const [nonce, setNonce] = useState(0)
  const load = useCallback(() => setNonce((n) => n + 1), [])
  useEffect(() => {
    let alive = true
    const read = () =>
      api<MonitorsView>('/api/developer/monitors').then((r) => {
        if (!alive) return
        if (r.ok) {
          setView(r.data)
          setReadAt(Date.now())
          setErr(null)
        } else setErr(r.error)
      })
    void read()
    const t = setInterval(() => void read(), 30_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [nonce])

  const act = async (m: Monitor, op: string) => {
    if (op === 'delete' && !window.confirm(`Stop watching ${m.name || m.address}?`)) return
    setBusy(m.id)
    const r = await api<{ secret?: string; results?: { channel: string; ok: boolean; error: string | null }[] }>(`/api/developer/monitors/${m.id}/${op}`, { method: 'POST' })
    setBusy(null)
    if (!r.ok) return setErr(r.error)
    if (op === 'rotate' && r.data.secret) setSecret(r.data.secret)
    if (op === 'test') toastSuccess('Test sent', { detail: (r.data.results ?? []).map((x) => `${x.channel}: ${x.ok ? 'delivered' : (x.error ?? 'failed')}`).join(' · ') || 'No channel' })
    load()
  }

  if (!view && !err)
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton h={88} />
        <Skeleton h={180} />
      </div>
    )

  return (
    <section className="flex flex-col gap-4" aria-labelledby="monitors-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="monitors-title" className={`${panelTitle} flex items-center gap-2 text-[18px]`}>
            <ShieldAlert aria-hidden size={18} className="text-gold" /> Monitors
          </h2>
          {view && (
            <span className={mono}>
              {view.limits.used} of {view.limits.max} contract{view.limits.max === 1 ? '' : 's'} on {view.limits.planName} · read every {view.loopSeconds} s
            </span>
          )}
        </div>
        <button type="button" className={pillGold} onClick={() => setOpen(true)} disabled={!view || !w.ok || view.limits.used >= view.limits.max} title={!w.ok ? w.why : view && view.limits.used >= view.limits.max ? 'Your plan’s limit is reached: remove one or upgrade.' : undefined}>
          <Plus aria-hidden size={16} /> Watch a contract
        </button>
      </div>
      {err && <ErrorLine onRetry={() => load()}>{err}</ErrorLine>}
      {secret && (
        <div className={`${panel} border-gold-line`} role="status">
          <span className={panelTitle}>Webhook secret (shown once)</span>
          <code className="font-mono text-[13px] break-all text-gold">{secret}</code>
          <span className="flex flex-wrap gap-2">
            <CopyButton text={secret} what="Secret" />
            <button type="button" className={pillSm} onClick={() => setSecret(null)}>
              I saved it
            </button>
          </span>
        </div>
      )}
      {view && (
        <div className={panel}>
          <span className={`${panelTitle} flex items-center gap-2`}>
            <Activity aria-hidden size={16} className="text-gold" /> Last 14 days
          </span>
          <EventDays monitors={view.monitors} now={readAt} />
        </div>
      )}
      {view && view.monitors.length === 0 ? (
        <Empty icon={<Radar aria-hidden size={22} className="text-gold" />} title="Nothing watched yet" action={w.ok ? <button type="button" className={pillGold} onClick={() => setOpen(true)}>
              <Plus aria-hidden size={16} /> Watch a contract
            </button> : undefined}>
          Add a contract and Gully Security reads it every minute: owner, admin and role changes, upgrades, pauses, Safe signer changes and large outflows, sent to Telegram or your webhook in plain words.
        </Empty>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {view?.monitors.map((m, i) => (
            <MonitorCard key={m.id} m={m} act={act} busy={busy} i={i} />
          ))}
        </ul>
      )}
      <span className="text-[12px] text-faint">
        Payload, signature and every event kind: <ExtLink href={`${DOCS_URL}/gully-score#monitoring`} className="inline-flex items-center gap-1 text-gold">the docs</ExtLink>
      </span>
      {view && <AddDialog open={open} onClose={() => setOpen(false)} view={view} onAdded={(s) => (setOpen(false), setSecret(s), load())} />}
    </section>
  )
}
