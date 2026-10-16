import { motion } from 'motion/react'
import { Activity, AlertTriangle, AppWindow, ArrowUpRight, BookOpen, Check, KeyRound, LayoutDashboard, LogOut, MoreHorizontal, Pencil, Plus, RefreshCw, RotateCw, Terminal, Trash2, Wallet } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { btnGold, btnOutline } from '../../components/ui'
import { CodeBlock } from '../../docs/CodeBlock'
import { widgetSnippet } from '../../lib/widgetEmbed'
import { DOCS_URL, isLocalHost, SITE_URL } from '../../site-host'
import { ago, api, fmtDate, shortAddress, type Account, type ApiKey, type Range, type RecentRequest, type Usage } from './api'
import { CopyButton, Dialog } from './Dialog'
import { UsageChart } from './UsageChart'

/* The signed-in developer dashboard: overview (usage), API keys, quickstart, recent requests, widget.
   Every figure is read from /api/developer/*; loading, empty and error states are distinct. */

export type Tab = 'overview' | 'keys' | 'quickstart' | 'requests' | 'widget'

const TABS: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'keys', label: 'API keys', icon: KeyRound },
  { id: 'quickstart', label: 'Quickstart', icon: Terminal },
  { id: 'requests', label: 'Requests', icon: Activity },
  { id: 'widget', label: 'Widget', icon: AppWindow },
]

const card = 'flex min-w-0 flex-col gap-5 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'
const cardTitle = 'm-0 font-display text-[24px] leading-none font-bold uppercase'
const sub = 'font-mono text-[11px] tracking-[.5px] text-faint'
const input = 'h-11 w-full rounded-input border border-line-strong bg-bg px-3 text-[15px] text-ink outline-none transition-colors focus:border-gold'
const iconBtn = 'inline-flex min-h-10 items-center gap-2 rounded-btn border border-line-strong px-3 text-[13px] text-ink-2 transition-colors hover:border-gold hover:text-ink disabled:opacity-50'
const rise = (i: number) => ({ animation: `gl-rise .45s ${i * 0.05}s ease both` })
const WIDGET_URL = isLocalHost() ? '/widget' : `${SITE_URL}/widget`
const API_ORIGIN = 'https://gullylabs.xyz'

function useTab(): [Tab, (t: Tab) => void] {
  const read = (): Tab => {
    const h = window.location.hash.slice(1) as Tab
    return TABS.some((t) => t.id === h) ? h : 'overview'
  }
  const [tab, setTab] = useState<Tab>(read)
  useEffect(() => {
    const on = () => setTab(read())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return [
    tab,
    (t: Tab) => {
      history.replaceState(null, '', t === 'overview' ? window.location.pathname + window.location.search : `#${t}`)
      setTab(t)
    },
  ]
}

function ErrorLine({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-input border border-[#5a2a24] bg-[rgba(255,138,122,.06)] px-4 py-3 text-[14px] text-error" role="alert">
      <AlertTriangle size={16} aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-mono text-[12px] text-ink-2 underline underline-offset-4 hover:text-ink">
          Retry
        </button>
      )}
    </div>
  )
}

function Skeleton({ h = 20, w = '100%' }: { h?: number; w?: number | string }) {
  return <span aria-hidden className="block animate-shimmer rounded-[4px] bg-[linear-gradient(90deg,#131820_0%,#1a2029_50%,#131820_100%)] bg-[length:200%_100%]" style={{ height: h, width: w }} />
}

/* ------------------------------------------------------------------ overview --- */

function Kpi({ label, value, note, tone, loading }: { label: string; value: string; note: ReactNode; tone?: string; loading?: boolean }) {
  return (
    <div className="group relative flex min-w-0 flex-col gap-[6px] overflow-hidden bg-surface px-5 py-4">
      <span className="font-mono text-[10px] tracking-[1px] text-faint">{label}</span>
      {loading ? <Skeleton h={30} w="60%" /> : <span className="font-display text-[34px] leading-none font-extrabold" style={{ color: tone }}>{value}</span>}
      <span className="truncate text-[12px] text-muted">{note}</span>
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] origin-left scale-x-0 bg-gold transition-transform duration-300 group-hover:scale-x-100" />
    </div>
  )
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="relative inline-flex rounded-btn border border-line-strong bg-surface-deep p-[3px]">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={`relative min-h-9 min-w-[52px] rounded-[3px] px-3 font-mono text-[12px] transition-colors ${value === o.v ? 'text-bg' : 'text-muted hover:text-ink'}`}
        >
          {value === o.v && <motion.span layoutId={`seg-${label}`} className="absolute inset-0 rounded-[3px] bg-gold" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          <span className="relative">{o.l}</span>
        </button>
      ))}
    </div>
  )
}

function StatusSplit({ t }: { t: Usage['rangeTotals'] }) {
  const parts = [
    { k: '2xx', v: t.ok, c: '#6fcf6a' },
    { k: '4xx', v: t.client, c: '#e8c060' },
    { k: '429', v: t.limited, c: '#f4d98c' },
    { k: '5xx', v: t.server, c: '#ff8a7a' },
  ]
  if (!t.total) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-[6px] overflow-hidden rounded-full bg-line" aria-hidden>
        {parts.map((p) => (p.v ? <span key={p.k} style={{ width: `${(p.v / t.total) * 100}%`, background: p.c, transformOrigin: 'left', animation: 'gl-grow-x .7s cubic-bezier(.2,.8,.2,1) both' }} /> : null))}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-faint">
        {parts.map((p) => (
          <span key={p.k} className="inline-flex items-center gap-2">
            <i className="inline-block size-[8px] rounded-[2px]" style={{ background: p.c }} />
            {p.k} <b className="font-medium text-ink-2">{p.v.toLocaleString('en-US')}</b>
          </span>
        ))}
      </div>
    </div>
  )
}

function Overview({ account, goKeys }: { account: Account; goKeys: () => void }) {
  const [range, setRange] = useState<Range>('24h')
  const [keyFilter, setKeyFilter] = useState<string>('all')
  const [usage, setUsage] = useState<Usage | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = useCallback(
    (r: Range) =>
      api<Usage>(`/api/developer/usage?range=${r}`).then((res) => {
        if (res.ok) {
          setUsage(res.data)
          setErr(null)
        } else setErr(res.error)
      }),
    [],
  )
  useEffect(() => {
    load(range)
    const id = setInterval(() => load(range), 60_000)
    return () => clearInterval(id)
  }, [range, load])
  const loading = !!usage && usage.range !== range

  const live = account.keys.filter((k) => !k.revokedAt)
  const names = useMemo(() => Object.fromEntries((usage?.keys ?? account.keys).map((k) => [k.id, k.name])), [usage, account.keys])
  const w = usage?.last7d
  const errRate = w && w.total ? ((w.client + w.limited + w.server) / w.total) * 100 : null
  const first = !usage

  return (
    <div className="flex flex-col gap-5">
      {!live.length && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-gold-line bg-[linear-gradient(120deg,rgba(232,192,96,.10),rgba(232,192,96,.02))] px-6 py-5" style={rise(0)}>
          <div className="flex flex-col gap-1">
            <span className="font-display text-[22px] leading-none font-bold uppercase">Create your first key</span>
            <span className="text-[14px] text-muted">It works the moment it is created: {account.limits.keyPerMin} requests a minute instead of {account.limits.anonymousPerMin}.</span>
          </div>
          <button type="button" onClick={goKeys} className={`${btnGold} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
            <Plus size={16} aria-hidden /> Create a key
          </button>
        </div>
      )}

      <dl className="m-0 grid grid-cols-4 gap-px overflow-hidden rounded-card border border-line bg-line max-[1100px]:grid-cols-2" style={rise(1)}>
        <Kpi label="REQUESTS TODAY" loading={first && !err} value={usage ? usage.today.total.toLocaleString('en-US') : '—'} note="since 00:00 UTC" />
        <Kpi label="LAST 7 DAYS" loading={first && !err} value={usage ? usage.last7d.total.toLocaleString('en-US') : '—'} note={usage ? `${usage.last7d.limited.toLocaleString('en-US')} rate-limited` : 'all keys'} />
        <Kpi
          label="ERROR RATE · 7D"
          loading={first && !err}
          value={errRate === null ? '—' : `${errRate < 10 ? errRate.toFixed(1) : Math.round(errRate)}%`}
          note={errRate === null ? 'no requests yet' : '4xx, 429 and 5xx answers'}
          tone={errRate !== null && errRate >= 5 ? '#ff8a7a' : undefined}
        />
        <Kpi label="CURRENT LIMIT" value={`${account.limits.keyPerMin}/min`} note={`per key · ${account.limits.anonymousPerMin}/min without one`} />
      </dl>

      <section className={card} style={rise(2)}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-[6px]">
            <h2 className={cardTitle}>Requests</h2>
            <span className={sub}>
              {usage ? `${usage.rangeTotals.total.toLocaleString('en-US')} in the last ${range === '24h' ? '24 hours' : range === '7d' ? '7 days' : '30 days'} · per ${usage.bucket}` : 'reading usage…'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {account.keys.length > 1 && (
              <label className="relative">
                <span className="sr-only">Key</span>
                <select value={keyFilter} onChange={(e) => setKeyFilter(e.target.value)} className="h-[42px] max-w-[200px] rounded-btn border border-line-strong bg-surface-deep pr-8 pl-3 font-mono text-[12px] text-ink-2 outline-none focus:border-gold">
                  <option value="all">All keys</option>
                  {account.keys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                      {k.revokedAt ? ' (revoked)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Segmented
              label="Range"
              value={range}
              onChange={setRange}
              options={[
                { v: '24h', l: '24H' },
                { v: '7d', l: '7D' },
                { v: '30d', l: '30D' },
              ]}
            />
          </div>
        </div>
        {err ? (
          <ErrorLine onRetry={() => load(range)}>Usage could not be read: {err}</ErrorLine>
        ) : !usage ? (
          <div className="flex h-[260px] flex-col justify-end gap-3">
            <Skeleton h={200} />
            <Skeleton h={12} w="40%" />
          </div>
        ) : (
          <div className={`transition-opacity ${loading ? 'opacity-60' : ''}`}>
            <UsageChart points={usage.points} bucket={usage.bucket} keyNames={names} keyFilter={keyFilter === 'all' ? null : keyFilter} />
          </div>
        )}
        {usage && <StatusSplit t={usage.rangeTotals} />}
        <p className="m-0 border-t border-line pt-4 text-[13px] leading-[1.6] text-faint">
          Counts requests made with your keys that reached our servers{usage?.countingSince ? `, recorded hourly since ${fmtDate(usage.countingSince)}` : ''}. Answers served from Cloudflare&apos;s edge cache never reach us and are not counted. Hours are in your time zone; days are UTC.
        </p>
      </section>
    </div>
  )
}

/* ---------------------------------------------------------------------- keys --- */

function KeyMenu({ k, onRename, onRotate, onRevoke }: { k: ApiKey; onRename: () => void; onRotate: () => void; onRevoke: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  const item = 'flex min-h-10 w-full items-center gap-3 rounded-[4px] px-3 text-left text-[14px] text-ink-2 hover:bg-surface-hover hover:text-ink'
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={`Actions for ${k.name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="inline-flex size-10 items-center justify-center rounded-btn text-muted hover:bg-surface-hover hover:text-ink">
        <MoreHorizontal size={18} aria-hidden />
      </button>
      {open && (
        <motion.div role="menu" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="absolute top-11 right-0 z-20 flex w-[180px] flex-col rounded-input border border-line-strong bg-surface-deep p-1 shadow-[0_12px_32px_rgba(0,0,0,.5)]">
          <button role="menuitem" type="button" className={item} onClick={() => (setOpen(false), onRename())}>
            <Pencil size={15} aria-hidden /> Rename
          </button>
          <button role="menuitem" type="button" className={item} onClick={() => (setOpen(false), onRotate())}>
            <RotateCw size={15} aria-hidden /> Rotate secret
          </button>
          <button role="menuitem" type="button" className={`${item} !text-error`} onClick={() => (setOpen(false), onRevoke())}>
            <Trash2 size={15} aria-hidden /> Revoke
          </button>
        </motion.div>
      )}
    </div>
  )
}

type KeyDialog = { kind: 'create' } | { kind: 'rename'; key: ApiKey } | { kind: 'rotate'; key: ApiKey } | { kind: 'revoke'; key: ApiKey } | { kind: 'secret'; key: ApiKey; secret: string; rotated: boolean } | { kind: 'link' } | null

function Keys({ account, reload }: { account: Account; reload: () => Promise<void> }) {
  const [dialog, setDialog] = useState<KeyDialog>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showRevoked, setShowRevoked] = useState(false)
  const live = account.keys.filter((k) => !k.revokedAt)
  const revoked = account.keys.filter((k) => k.revokedAt)
  const full = live.length >= account.limits.maxKeys
  const close = useCallback(() => {
    setDialog(null)
    setErr(null)
    setBusy(false)
  }, [])

  const act = async (path: string, body: unknown, then: (d: { key: ApiKey; secret?: string }) => void) => {
    setBusy(true)
    setErr(null)
    const r = await api<{ key: ApiKey; secret?: string }>(path, { method: 'POST', body })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    await reload()
    then(r.data)
  }

  const submitName = (e: FormEvent) => {
    e.preventDefault()
    if (!dialog) return
    if (dialog.kind === 'create') act('/api/developer/keys', { name }, (d) => setDialog({ kind: 'secret', key: d.key, secret: d.secret ?? '', rotated: false }))
    else if (dialog.kind === 'rename') act(`/api/developer/keys/${dialog.key.id}/rename`, { name }, close)
  }

  return (
    <div className="flex flex-col gap-5">
      <section className={card} style={rise(0)}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-[6px]">
            <h2 className={cardTitle}>API keys</h2>
            <span className={sub}>
              {live.length} of {account.limits.maxKeys} live keys · {account.limits.keyPerMin} requests a minute each
            </span>
          </div>
          <button
            type="button"
            disabled={full}
            title={full ? 'Revoke a key to create another' : undefined}
            onClick={() => {
              setName('')
              setDialog({ kind: 'create' })
            }}
            className={`${btnGold} inline-flex min-h-11 items-center gap-2 px-5 text-[15px] disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <Plus size={16} aria-hidden /> Create key
          </button>
        </div>

        {!live.length ? (
          <div className="flex flex-col items-center gap-3 rounded-input border border-dashed border-line-strong px-6 py-10 text-center">
            <KeyRound size={28} className="text-gold" aria-hidden />
            <span className="font-display text-[22px] font-bold uppercase">No live keys</span>
            <span className="max-w-[420px] text-[14px] text-muted">Create one and it works immediately. The full key is shown once; we keep only a hash of it.</span>
          </div>
        ) : (
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="w-full min-w-[640px] border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[10.5px] tracking-[1px] text-faint">
                  <th className="py-2 pr-3 font-medium">NAME</th>
                  <th className="py-2 pr-3 font-medium">KEY</th>
                  <th className="py-2 pr-3 font-medium">CREATED</th>
                  <th className="py-2 pr-3 font-medium">LAST USED</th>
                  <th className="py-2 pr-3 font-medium">LIMIT</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {live.map((k, i) => (
                  <tr key={k.id} className="border-b border-line last:border-b-0" style={rise(i)}>
                    <td className="py-3 pr-3">
                      <span className="flex items-center gap-2 font-medium">
                        <i className="inline-block size-[7px] rounded-full bg-green" aria-hidden />
                        {k.name}
                      </span>
                    </td>
                    <td className="py-3 pr-3">
                      <code className="rounded-[4px] bg-surface-deep px-2 py-1 font-mono text-[12.5px] text-ink-2">{k.prefix}…</code>
                    </td>
                    <td className="py-3 pr-3 font-mono text-[12px] text-muted" title={k.rotatedAt ? `rotated ${fmtDate(k.rotatedAt)}` : undefined}>
                      {fmtDate(k.createdAt)}
                      {k.rotatedAt && <span className="block text-faint">rotated {ago(k.rotatedAt)}</span>}
                    </td>
                    <td className="py-3 pr-3 font-mono text-[12px] text-muted" title={k.lastUsed ?? undefined}>
                      {ago(k.lastUsed)}
                    </td>
                    <td className="py-3 pr-3 font-mono text-[12px] text-muted">{k.limit}/min</td>
                    <td className="py-3 text-right">
                      <KeyMenu
                        k={k}
                        onRename={() => {
                          setName(k.name)
                          setDialog({ kind: 'rename', key: k })
                        }}
                        onRotate={() => setDialog({ kind: 'rotate', key: k })}
                        onRevoke={() => setDialog({ kind: 'revoke', key: k })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <span className="text-[13px] text-faint">Send a key as <code className="font-mono text-ink-2">Authorization: Bearer gl_live_…</code> from your server, never from browser code.</span>
          <button type="button" onClick={() => setDialog({ kind: 'link' })} className="font-mono text-[12px] text-muted underline-offset-4 hover:text-ink hover:underline">
            Have a key from the old request form? Link it
          </button>
        </div>
      </section>

      {revoked.length > 0 && (
        <section className={card} style={rise(1)}>
          <button type="button" onClick={() => setShowRevoked((s) => !s)} aria-expanded={showRevoked} className="flex items-center justify-between gap-3 text-left">
            <span className="font-display text-[18px] font-bold text-muted uppercase">Revoked keys ({revoked.length})</span>
            <span className="font-mono text-[12px] text-faint">{showRevoked ? 'Hide' : 'Show'}</span>
          </button>
          {showRevoked && (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {revoked.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-input border border-line px-3 py-2 opacity-70">
                  <span className="text-[14px]">
                    {k.name} <code className="ml-2 font-mono text-[12px] text-faint">{k.prefix}…</code>
                  </span>
                  <span className="font-mono text-[12px] text-faint">revoked {fmtDate(k.revokedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Dialog open={dialog?.kind === 'create' || dialog?.kind === 'rename'} onClose={close} title={dialog?.kind === 'rename' ? 'Rename key' : 'Create a key'}>
        <form className="flex flex-col gap-4" onSubmit={submitName}>
          <label className="flex flex-col gap-2 text-[14px] text-ink-2">
            Name
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required placeholder="e.g. Production backend" />
            <span className="text-[12px] text-faint">Only for you, to tell keys apart. Up to 40 characters.</span>
          </label>
          {err && <ErrorLine>{err}</ErrorLine>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className={`${btnOutline} min-h-11 px-5 text-[15px]`}>
              Cancel
            </button>
            <button type="submit" disabled={busy || !name.trim()} className={`${btnGold} min-h-11 px-5 text-[15px] disabled:opacity-50`}>
              {busy ? 'Saving…' : dialog?.kind === 'rename' ? 'Save' : 'Create key'}
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog open={dialog?.kind === 'rotate' || dialog?.kind === 'revoke'} onClose={close} title={dialog?.kind === 'rotate' ? 'Rotate secret' : 'Revoke key'}>
        {dialog?.kind === 'rotate' || dialog?.kind === 'revoke' ? (
          <div className="flex flex-col gap-4">
            <p className="m-0 text-[15px] leading-[1.6] text-muted">
              {dialog.kind === 'rotate' ? (
                <>
                  <b className="text-ink">{dialog.key.name}</b> gets a new secret and <b className="text-ink">{dialog.key.prefix}…</b> stops working immediately. Its name and usage history stay.
                </>
              ) : (
                <>
                  <b className="text-ink">{dialog.key.name}</b> (<code className="font-mono text-[13px]">{dialog.key.prefix}…</code>) stops working immediately. This cannot be undone.
                </>
              )}
            </p>
            {err && <ErrorLine>{err}</ErrorLine>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} className={`${btnOutline} min-h-11 px-5 text-[15px]`}>
                Cancel
              </button>
              {dialog.kind === 'rotate' ? (
                <button type="button" disabled={busy} onClick={() => act(`/api/developer/keys/${dialog.key.id}/rotate`, {}, (d) => setDialog({ kind: 'secret', key: d.key, secret: d.secret ?? '', rotated: true }))} className={`${btnGold} min-h-11 px-5 text-[15px] disabled:opacity-50`}>
                  {busy ? 'Rotating…' : 'Rotate'}
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => act(`/api/developer/keys/${dialog.key.id}/revoke`, {}, close)} className="min-h-11 rounded-btn bg-error px-5 text-[15px] font-semibold text-bg transition-opacity hover:opacity-90 disabled:opacity-50">
                  {busy ? 'Revoking…' : 'Revoke key'}
                </button>
              )}
            </div>
          </div>
        ) : null}
      </Dialog>

      <Dialog open={dialog?.kind === 'secret'} onClose={close} title={dialog?.kind === 'secret' && dialog.rotated ? 'Your new secret' : 'Your new key'} dismissable={false}>
        {dialog?.kind === 'secret' ? (
          <div className="flex flex-col gap-4">
            <p className="m-0 flex items-start gap-3 rounded-input border border-gold-line bg-[rgba(232,192,96,.06)] px-4 py-3 text-[14px] leading-[1.55] text-ink-2">
              <AlertTriangle size={18} className="mt-[2px] shrink-0 text-gold" aria-hidden />
              Copy it now. This is the only time the full key is shown: we store only a hash, so it cannot be shown again. Lost it? Rotate the key.
            </p>
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[11px] tracking-[1px] text-faint">{dialog.key.name.toUpperCase()}</span>
              <div className="flex items-center gap-2 rounded-input border border-gold-line bg-bg py-1 pr-1 pl-3">
                <code className="min-w-0 flex-1 font-mono text-[13px] break-all text-gold" data-testid="new-secret">
                  {dialog.secret}
                </code>
                <CopyButton text={dialog.secret} />
              </div>
            </div>
            <div className="flex justify-end">
              <button type="button" data-autofocus onClick={close} className={`${btnGold} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
                <Check size={16} aria-hidden /> I have saved it
              </button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <LinkDialog open={dialog?.kind === 'link'} onClose={close} reload={reload} />
    </div>
  )
}

function LinkDialog({ open, onClose, reload }: { open: boolean; onClose: () => void; reload: () => Promise<void> }) {
  const [key, setKey] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open={open}
      onClose={() => {
        setKey('')
        setErr(null)
        onClose()
      }}
      title="Link an existing key"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          const r = await api('/api/developer/keys/link', { method: 'POST', body: { key: key.trim() } })
          setBusy(false)
          if (!r.ok) return setErr(r.error)
          await reload()
          setKey('')
          onClose()
        }}
      >
        <p className="m-0 text-[14px] leading-[1.6] text-muted">Keys issued through the old request form keep working. Link one to this wallet to manage it and see its usage here. The key is sent once to check it and is not stored in your browser.</p>
        <input className={`${input} font-mono`} value={key} onChange={(e) => setKey(e.target.value)} placeholder="gl_live_…" autoComplete="off" spellCheck={false} required />
        {err && <ErrorLine>{err}</ErrorLine>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy || !key.trim().startsWith('gl_live_')} className={`${btnGold} min-h-11 px-5 text-[15px] disabled:opacity-50`}>
            {busy ? 'Linking…' : 'Link key'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- quickstart --- */

type Lang = 'curl' | 'js' | 'python'

function snippet(lang: Lang, path: string, key: string): string {
  const url = `${API_ORIGIN}${path}`
  if (lang === 'curl') return `curl -i "${url}" \\\n  -H "Authorization: Bearer ${key}"`
  if (lang === 'js')
    return `// Node 18+ or any server runtime with fetch. Never ship a key in browser code.
const res = await fetch('${url}', {
  headers: { Authorization: 'Bearer ${key}' },
})
if (!res.ok) throw new Error(\`Gully API answered \${res.status}\`)
console.log('remaining this minute:', res.headers.get('X-RateLimit-Remaining'))
const data = await res.json()`
  return `import requests

res = requests.get(
    "${url}",
    headers={"Authorization": "Bearer ${key}"},
    timeout=10,
)
res.raise_for_status()
print("remaining this minute:", res.headers.get("X-RateLimit-Remaining"))
data = res.json()`
}

function Quickstart({ account, goKeys }: { account: Account; goKeys: () => void }) {
  const [lang, setLang] = useState<Lang>('curl')
  const first = account.keys.find((k) => !k.revokedAt)
  const placeholder = first ? `${first.prefix}…` : 'gl_live_YOUR_KEY'
  const endpoints = [
    { title: 'Every tracked stock', path: '/api/tracker', note: 'Fair price, on-chain price and the gap for every tokenised stock, all chains.' },
    { title: 'Price history', path: '/api/tracker/history?chain=robinhood&ticker=NVDA', note: 'The recorded gap series for one stock on one chain.' },
  ]
  return (
    <div className="flex flex-col gap-5">
      <section className={card} style={rise(0)}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-[6px]">
            <h2 className={cardTitle}>Quickstart</h2>
            <span className={sub}>Two endpoints, one header. JSON over HTTPS.</span>
          </div>
          <Segmented
            label="Language"
            value={lang}
            onChange={setLang}
            options={[
              { v: 'curl', l: 'cURL' },
              { v: 'js', l: 'JavaScript' },
              { v: 'python', l: 'Python' },
            ]}
          />
        </div>
        <ol className="m-0 grid list-none grid-cols-3 gap-3 p-0 max-[900px]:grid-cols-1">
          {[
            first ? <>Your key <code className="font-mono text-[12.5px] text-gold">{first.prefix}…</code> is ready.</> : <>Create a key in <button type="button" onClick={goKeys} className="text-gold underline-offset-4 hover:underline">API keys</button>.</>,
            <>Replace <code className="font-mono text-[12.5px] text-ink-2">{placeholder}</code> below with your full key, ideally from an environment variable.</>,
            <>Read <code className="font-mono text-[12.5px] text-ink-2">X-RateLimit-Remaining</code>; past the limit you get 429 with Retry-After.</>,
          ].map((c, i) => (
            <li key={i} className="flex gap-3 rounded-input border border-line bg-surface-deep px-4 py-3 text-[14px] leading-[1.55] text-muted">
              <span className="font-display text-[22px] leading-none font-extrabold text-gold">{i + 1}</span>
              <span>{c}</span>
            </li>
          ))}
        </ol>
        {endpoints.map((e) => (
          <div key={e.path} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="rounded-[4px] border border-success-line bg-success-bg px-2 py-[2px] font-mono text-[11px] text-green">GET</span>
              <code className="font-mono text-[13px] break-all text-ink">{e.path}</code>
              <span className="text-[13px] text-faint">{e.note}</span>
            </div>
            <CodeBlock code={snippet(lang, e.path, placeholder)} lang={lang === 'curl' ? 'bash' : lang === 'js' ? 'js' : 'text'} caption={lang === 'python' ? 'Python' : undefined} />
          </div>
        ))}
        <div className="flex flex-wrap gap-3 border-t border-line pt-4">
          <a href={`${DOCS_URL}/api`} className={`${btnOutline} inline-flex min-h-11 items-center gap-2 px-4 text-[14px]`}>
            <BookOpen size={16} aria-hidden /> API reference <ArrowUpRight size={14} aria-hidden />
          </a>
          <a href={`${DOCS_URL}/api-keys`} className={`${btnOutline} inline-flex min-h-11 items-center gap-2 px-4 text-[14px]`}>
            <KeyRound size={16} aria-hidden /> Keys and limits <ArrowUpRight size={14} aria-hidden />
          </a>
        </div>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ requests --- */

function statusTone(s: number) {
  if (s === 429) return 'border-gold-line text-gold-hover'
  if (s >= 500) return 'border-[#5a2a24] text-error'
  if (s >= 400) return 'border-gold-line text-gold'
  return 'border-success-line text-green'
}

function Requests() {
  const [rows, setRows] = useState<RecentRequest[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fetchRows = useCallback(
    () =>
      api<{ requests: RecentRequest[] }>('/api/developer/requests').then((r) => {
        if (r.ok) {
          setRows(r.data.requests)
          setErr(null)
        } else setErr(r.error)
      }),
    [],
  )
  const load = () => {
    setBusy(true)
    fetchRows().then(() => setBusy(false))
  }
  useEffect(() => {
    fetchRows()
    const id = setInterval(fetchRows, 15_000)
    return () => clearInterval(id)
  }, [fetchRows])
  return (
    <section className={card} style={rise(0)}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-[6px]">
          <h2 className={cardTitle}>Recent requests</h2>
          <span className={sub}>The last 50 requests made with your keys · refreshes every 15 seconds</span>
        </div>
        <button type="button" onClick={load} disabled={busy} className={iconBtn}>
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} aria-hidden /> Refresh
        </button>
      </div>
      {err ? (
        <ErrorLine onRetry={load}>Requests could not be read: {err}</ErrorLine>
      ) : !rows ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} h={36} />
          ))}
        </div>
      ) : !rows.length ? (
        <div className="flex flex-col items-center gap-2 rounded-input border border-dashed border-line-strong px-6 py-10 text-center">
          <Activity size={26} className="text-gold" aria-hidden />
          <span className="font-display text-[20px] font-bold uppercase">No requests yet</span>
          <span className="max-w-[420px] text-[14px] text-muted">Calls made with your keys appear here within seconds. Answers served from the edge cache are not listed.</span>
        </div>
      ) : (
        <div className="-mx-2 overflow-x-auto px-2">
          <table className="w-full min-w-[620px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10.5px] tracking-[1px] text-faint">
                <th className="py-2 pr-3 font-medium">TIME</th>
                <th className="py-2 pr-3 font-medium">REQUEST</th>
                <th className="py-2 pr-3 font-medium">KEY</th>
                <th className="py-2 pr-3 font-medium">STATUS</th>
                <th className="py-2 text-right font-medium">LATENCY</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {rows.map((r, i) => (
                <tr key={`${r.at}-${i}`} className="border-b border-line last:border-b-0 hover:bg-surface-hover">
                  <td className="py-[10px] pr-3 whitespace-nowrap text-muted" title={new Date(r.at).toLocaleString()}>
                    {new Date(r.at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                    <span className="ml-2 text-faint">{ago(r.at)}</span>
                  </td>
                  <td className="max-w-[340px] truncate py-[10px] pr-3 text-ink-2" title={r.path}>
                    <span className="mr-2 text-faint">{r.method}</span>
                    {r.path}
                  </td>
                  <td className="py-[10px] pr-3 whitespace-nowrap text-muted">{r.key?.name ?? '—'}</td>
                  <td className="py-[10px] pr-3">
                    <span className={`rounded-full border px-2 py-[1px] text-[11.5px] ${statusTone(r.status)}`}>{r.status}</span>
                  </td>
                  <td className="py-[10px] text-right whitespace-nowrap text-muted">{r.ms} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/* -------------------------------------------------------------------- widget --- */

function WidgetPanel() {
  return (
    <section className={card} style={rise(0)}>
      <div className="flex flex-col gap-[6px]">
        <h2 className={cardTitle}>Embed the widget</h2>
        <span className={sub}>No key and no backend: the widget reads the public API itself.</span>
      </div>
      <p className="m-0 max-w-[640px] text-[15px] leading-[1.6] text-muted">Drop live fair-price data into any page with two lines of HTML. Pick the layout, chain and theme in the builder, then paste the snippet. Do not put an API key in it; it does not read one.</p>
      <CodeBlock code={widgetSnippet({ type: 'ticker', chain: 'robinhood', theme: 'dark', limit: 8 })} lang="html" caption="HTML · ticker, Robinhood Chain" />
      <div className="flex flex-wrap gap-3">
        <a href={WIDGET_URL} className={`${btnGold} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
          <AppWindow size={16} aria-hidden /> Open the widget builder
        </a>
        <a href={`${DOCS_URL}/widget`} className={`${btnOutline} inline-flex min-h-11 items-center gap-2 px-4 text-[14px]`}>
          <BookOpen size={16} aria-hidden /> Widget guide <ArrowUpRight size={14} aria-hidden />
        </a>
      </div>
    </section>
  )
}

/* --------------------------------------------------------------------- shell --- */

export function Dashboard({ account, reload, onSignOut }: { account: Account; reload: () => Promise<void>; onSignOut: () => void }) {
  const [tab, setTab] = useTab()
  const goKeys = () => setTab('keys')
  return (
    <section className="flex flex-col gap-6 px-page pt-10 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-4" style={rise(0)}>
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[13px] tracking-[1.5px] text-gold">DEVELOPER DASHBOARD</span>
          <h1 className="m-0 font-display text-[clamp(36px,4.4cqw,56px)] leading-[.92] font-extrabold uppercase">Tracker API</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex min-h-11 items-center gap-3 rounded-btn border border-line-strong bg-surface px-3" title={account.address}>
            <span aria-hidden className="size-[22px] rounded-full" style={{ background: `conic-gradient(from ${parseInt(account.address.slice(2, 6), 16) % 360}deg, #e8c060, #6fcf6a, #2c3540, #e8c060)` }} />
            <span className="flex flex-col leading-tight">
              <span className="font-mono text-[13px] text-ink">{shortAddress(account.address)}</span>
              <span className="font-mono text-[10px] text-faint">signed in with wallet</span>
            </span>
            <CopyButton text={account.address} label="Copy" className="!min-h-8 border-none !px-2 text-[11px]" />
          </span>
          <button type="button" onClick={onSignOut} className={`${btnOutline} inline-flex min-h-11 items-center gap-2 px-4 text-[14px]`}>
            <LogOut size={15} aria-hidden /> Sign out
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[220px_minmax(0,1fr)] items-start gap-6 max-[960px]:grid-cols-1">
        <nav aria-label="Dashboard" className="sticky top-24 flex flex-col gap-1 max-[960px]:static max-[960px]:-mx-1 max-[960px]:flex-row max-[960px]:overflow-x-auto max-[960px]:px-1 max-[960px]:pb-1">
          {TABS.map((t) => {
            const Icon = t.icon
            const on = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={on ? 'page' : undefined}
                className={`relative flex min-h-11 shrink-0 items-center gap-3 rounded-btn px-3 text-left text-[15px] transition-colors ${on ? 'text-ink' : 'text-muted hover:bg-surface hover:text-ink'}`}
              >
                {on && <motion.span layoutId="dev-nav" className="absolute inset-0 rounded-btn border border-line-strong bg-surface" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                {on && <motion.span layoutId="dev-nav-bar" className="absolute top-2 bottom-2 left-0 w-[2px] rounded-full bg-gold max-[960px]:top-auto max-[960px]:right-3 max-[960px]:bottom-0 max-[960px]:left-3 max-[960px]:h-[2px] max-[960px]:w-auto" />}
                <Icon size={17} className={`relative ${on ? 'text-gold' : ''}`} aria-hidden />
                <span className="relative whitespace-nowrap">{t.label}</span>
                {t.id === 'keys' && (
                  <span className="relative ml-auto rounded-full bg-surface-deep px-2 font-mono text-[11px] text-faint max-[960px]:ml-1">{account.keys.filter((k) => !k.revokedAt).length}</span>
                )}
              </button>
            )
          })}
          <a href={`${DOCS_URL}/api`} className="flex min-h-11 shrink-0 items-center gap-3 rounded-btn px-3 text-[15px] whitespace-nowrap text-muted hover:bg-surface hover:text-ink">
            <BookOpen size={17} aria-hidden /> Docs <ArrowUpRight size={13} className="ml-auto" aria-hidden />
          </a>
          <div className="mt-4 flex flex-col gap-2 rounded-input border border-line bg-surface-deep p-4 max-[960px]:hidden">
            <span className="flex items-center gap-2 font-mono text-[10.5px] tracking-[1px] text-faint">
              <Wallet size={13} aria-hidden /> FREE TIER
            </span>
            <span className="text-[13px] leading-[1.5] text-muted">
              {account.limits.keyPerMin} req/min per key, up to {account.limits.maxKeys} keys. No card, no email.
            </span>
          </div>
        </nav>

        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="min-w-0">
          {tab === 'overview' && <Overview account={account} goKeys={goKeys} />}
          {tab === 'keys' && <Keys account={account} reload={reload} />}
          {tab === 'quickstart' && <Quickstart account={account} goKeys={goKeys} />}
          {tab === 'requests' && <Requests />}
          {tab === 'widget' && <WidgetPanel />}
        </motion.div>
      </div>
    </section>
  )
}
