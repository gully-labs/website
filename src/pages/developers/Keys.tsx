import { track } from '../../lib/track'
import { Activity, AlertTriangle, AppWindow, BookOpen, Check, Clock, Code2, Gauge, KeyRound, Link2, MoreHorizontal, Pencil, Plus, RefreshCw, RotateCw, Send, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { CodeBlock } from '../../docs/CodeBlock'
import { widgetSnippet } from '../../lib/widgetEmbed'
import { DOCS_URL, isLocalHost, SITE_URL } from '../../site-host'
import { ago, api, fmtDate, type Account, type ApiKey, type RecentRequest, type Usage } from './api'
import { usePoll } from './poll'
import { useSubTab } from './subtab'
import { InfoTip, KpiRow, KpiTile, RefreshChip, Stepper, SubPanel, SubTabs, Unknown } from './ui'
import { Can } from './RoleGate'
import { useWrite } from './portal'
import { KeySpark } from './vcharts'
import { GhostSpark } from './charts'
import { KeysTraffic } from './tabcharts'
import { CopyButton, Dialog } from './Dialog'
import { toastSuccess } from '../../components/ui/toast'
import { Empty, ErrorLine, Skeleton } from './parts'
import { ExtLink } from './ExtLink'
import { chip, input, mono, panel, panelTitle, pillDanger, pillGold, pillLine, pillSm, rise } from './styles'
import { keyColors } from './helpers'
import { ServiceHeader } from './services/ServiceHeader'
import { docsPage } from './services/links'
import { group } from './usage'
import { StatusPill as KitPill } from '../../components/ui/StatusPill'

/* The Keys tab: a two-step setup stepper (create a key, make a first call), then sub-tabs that show one
   section at a time (#keys/keys, #keys/requests, #keys/quickstart, #keys/widget, remembered): live keys
   with a KPI row and their 7-day traffic, create / rename / rotate / revoke (the secret is shown once),
   linking a legacy key; the last 50 requests; a quickstart; the no-key widget. Every figure comes from
   /api/developer/account, /usage?range=7d and /requests, polled with backoff (a failed refresh keeps the
   last good data and shows a retry chip). */

const WIDGET_URL = isLocalHost() ? '/widget' : `${SITE_URL}/widget`
const API_ORIGIN = 'https://gullylabs.xyz'
const fmt = (n: number) => n.toLocaleString('en-US')

function KeyMenu({ k, onRename, onRotate, onRevoke }: { k: ApiKey; onRename: () => void; onRotate: () => void; onRevoke: () => void }) {
  const [open, setOpen] = useState(false)
  // Placed with fixed coordinates from the button (portalled to <body>: the table scrolls sideways and its rows animate, which
  // would clip or re-anchor it), and upwards when the row sits near the bottom of the window; it follows the button on scroll.
  const [pos, setPos] = useState<{ right: number; top?: number; bottom?: number }>({ right: 0 })
  const ref = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const place = () => {
    const r = ref.current?.getBoundingClientRect()
    if (r) setPos(window.innerHeight - r.bottom < 180 ? { right: window.innerWidth - r.right, bottom: window.innerHeight - r.top + 4 } : { right: window.innerWidth - r.right, top: r.bottom + 4 })
  }
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const follow = () => {
      const r = ref.current?.getBoundingClientRect()
      if (r) setPos(window.innerHeight - r.bottom < 180 ? { right: window.innerWidth - r.right, bottom: window.innerHeight - r.top + 4 } : { right: window.innerWidth - r.right, top: r.bottom + 4 })
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    window.addEventListener('scroll', follow, { passive: true })
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('scroll', follow)
    }
  }, [open])
  const item = 'flex min-h-11 w-full items-center gap-3 rounded-[8px] px-3 text-left text-[14px] text-ink-2 hover:bg-surface-hover hover:text-ink'
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={`Actions for ${k.name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => {
          place()
          setOpen((o) => !o)
        }} className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-hover hover:text-ink">
        <MoreHorizontal size={18} aria-hidden />
      </button>
      {open &&
        createPortal(
        <div ref={menu} role="menu" style={{ position: 'fixed', ...pos }} className={`z-40 flex w-[190px] animate-[gl-rise_.18s_ease_both] flex-col rounded-[10px] border border-line-strong bg-surface-deep p-1 shadow-[0_12px_32px_rgba(0,0,0,.5)]`}>
          <button role="menuitem" type="button" className={item} onClick={() => (setOpen(false), onRename())}>
            <Pencil size={15} aria-hidden /> Rename
          </button>
          <button role="menuitem" type="button" className={item} onClick={() => (setOpen(false), onRotate())}>
            <RotateCw size={15} aria-hidden /> Rotate secret
          </button>
          <button role="menuitem" type="button" className={`${item} !text-error`} onClick={() => (setOpen(false), onRevoke())}>
            <Trash2 size={15} aria-hidden /> Revoke
          </button>
        </div>,
          document.body,
        )}
    </div>
  )
}

type KeyDialog = { kind: 'create' } | { kind: 'rename'; key: ApiKey } | { kind: 'rotate'; key: ApiKey } | { kind: 'revoke'; key: ApiKey } | { kind: 'secret'; key: ApiKey; secret: string; rotated: boolean } | { kind: 'link' } | null

type Week = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; usage: Usage }

/** GET /usage?range=7d every minute, as the shape the traffic chart takes (last good data kept). */
function useWeek() {
  const p = usePoll<Usage>('/api/developer/usage?range=7d', 60_000)
  const week: Week = p.data ? { state: 'ok', usage: p.data } : p.error || p.timedOut ? { state: 'error', message: p.error ?? 'no answer in time' } : { state: 'loading' }
  return { week, refreshErr: p.data ? p.error : null, reload: p.reload }
}

function KeysPanel({ account, reload, creating, onCreateDone }: { account: Account; reload: () => Promise<void>; creating: boolean; onCreateDone: () => void }) {
  const [dialogState, setDialog] = useState<KeyDialog>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showRevoked, setShowRevoked] = useState(false)
  const { week, refreshErr, reload: reloadWeek } = useWeek()
  const live = account.keys.filter((k) => !k.revokedAt)
  const revoked = account.keys.filter((k) => k.revokedAt)
  const full = live.length >= account.limits.maxKeys

  // "Create a key" from the Overview lands here with the dialog open.
  const canKeys = useWrite('keys', 'create keys').ok
  const dialog: KeyDialog = dialogState ?? (creating && !full && canKeys ? { kind: 'create' } : null)

  const perKey = useMemo(() => {
    if (week.state !== 'ok') return null
    const g = group(week.usage)
    const out: Record<string, { total: number; spark: number[]; labels: string[] }> = {}
    const labels = g.map((b) => new Date(b.t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }))
    for (const k of account.keys) out[k.id] = { total: g.reduce((a, b) => a + (b.keys[k.id] ?? 0), 0), spark: g.map((b) => b.keys[k.id] ?? 0), labels }
    return out
  }, [week, account.keys])

  const close = useCallback(() => {
    setDialog(null)
    setErr(null)
    setBusy(false)
    onCreateDone()
  }, [onCreateDone])

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
    if (dialog.kind === 'create')
      act('/api/developer/keys', { name }, (d) => {
        track('key-created')
        toastSuccess('Key created', { detail: `${d.key.name}: copy its secret now, it is shown once.` })
        setDialog({ kind: 'secret', key: d.key, secret: d.secret ?? '', rotated: false })
      })
    else if (dialog.kind === 'rename')
      act(`/api/developer/keys/${dialog.key.id}/rename`, { name }, (d) => {
        toastSuccess('Key renamed', { detail: d.key.name })
        close()
      })
  }

  const colors = keyColors(account.keys)
  const colorOf = (k: ApiKey) => colors[k.id]
  const th = 'py-2 pr-3 text-left font-mono text-[11px] font-medium tracking-[1px] text-faint'

  return (
    <>
    <KeyKpis account={account} week={week} />
    <section className={`${panel} gap-2`} style={rise(0)} aria-labelledby="keys-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id="keys-title" className={panelTitle}>
            API keys
          </h2>
          <RefreshChip error={refreshErr} onRetry={reloadWeek} />
        </div>
        <Can cat="keys" what="create keys">
          <button
            type="button"
            disabled={full}
            title={full ? 'Revoke a key to create another' : undefined}
            onClick={() => {
              setName('')
              setDialog({ kind: 'create' })
            }}
            className={`${pillGold} min-h-11`}
          >
            <Plus size={16} aria-hidden /> Create key
          </button>
        </Can>
      </div>
      {full && <p className="m-0 text-[13px] text-muted">All {account.limits.maxKeys} keys are in use. Revoke one to create another.</p>}

      <KeysTraffic week={week} hasKeys={live.length > 0} />

      {!live.length ? (
        <Empty
          icon={<KeyRound size={26} className="text-gold" aria-hidden />}
          title="No live keys"
          action={
            <Can cat="keys" what="create keys">
              <button type="button" disabled={full} onClick={() => (setName(''), setDialog({ kind: 'create' }))} className={pillGold}>
                <Plus size={16} aria-hidden /> Create your first key
              </button>
            </Can>
          }
        >
          Create one and it works immediately: {fmt(account.limits.keyPerMin)} requests a minute instead of {fmt(account.limits.anonymousPerMin)}. The full key is shown once; we keep only a hash of it.
        </Empty>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[760px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>NAME</th>
                <th className={th}>KEY</th>
                <th className={th}>CREATED</th>
                <th className={th}>LAST USED</th>
                <th className={th}>REQUESTS · 7D</th>
                <th className={th}>LIMIT</th>
                <th className="py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {live.map((k, i) => (
                <tr key={k.id} className="border-b border-line last:border-b-0" style={rise(i)}>
                  <td className="py-3 pr-3">
                    <span className="flex items-center gap-2 font-medium">
                      <i className="inline-block size-[10px] shrink-0 rounded-[3px]" style={{ background: colorOf(k) }} aria-hidden />
                      {k.name}
                    </span>
                  </td>
                  <td className="py-3 pr-3">
                    <code className="rounded-[6px] bg-surface-deep px-2 py-1 font-mono text-[12.5px] text-ink-2">{k.prefix}…</code>
                  </td>
                  <td className="py-3 pr-3 font-mono text-[12px] text-muted">
                    {fmtDate(k.createdAt)}
                    {k.rotatedAt && <span className="block text-faint">rotated {ago(k.rotatedAt)}</span>}
                  </td>
                  <td className="py-3 pr-3 font-mono text-[12px] text-muted" title={k.lastUsed ? new Date(k.lastUsed).toLocaleString() : 'No request with this key yet'}>
                    {k.lastUsed ? ago(k.lastUsed) : 'not used yet'}
                  </td>
                  <td className="py-3 pr-3">
                    {perKey ? (
                      <span className="flex items-center gap-3 font-mono text-[12px] text-ink-2" data-testid="key-spark">
                        {perKey[k.id]?.total ? <KeySpark values={perKey[k.id]?.spark ?? []} labels={perKey[k.id]?.labels} color={colorOf(k)} label={`${k.name}: ${fmt(perKey[k.id]?.total ?? 0)} requests in 7 days`} /> : <GhostSpark color={colorOf(k)} w={96} />}
                        {fmt(perKey[k.id]?.total ?? 0)}
                      </span>
                    ) : week.state === 'error' ? (
                      <span className="font-mono text-[12px] text-error" title={week.message}>
                        unreadable
                      </span>
                    ) : (
                      <Skeleton h={18} w={96} />
                    )}
                  </td>
                  <td className="py-3 pr-3 font-mono text-[12px] text-muted">{fmt(k.limit)}/min</td>
                  <td className="py-3 text-right">
                    <Can cat="keys" what="change keys" hide>
                      <KeyMenu
                        k={k}
                        onRename={() => {
                          setName(k.name)
                          setDialog({ kind: 'rename', key: k })
                        }}
                        onRotate={() => setDialog({ kind: 'rotate', key: k })}
                        onRevoke={() => setDialog({ kind: 'revoke', key: k })}
                      />
                    </Can>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2">
        <InfoTip summary={<>Send a key as <code className="font-mono text-ink-2">Authorization: Bearer gl_live_…</code> from your server.</>}>
          Never put a key in browser code: anyone can read it there. The full key is shown once when it is created or rotated; we keep only a hash of it. The no-key widget reads the public API itself.
        </InfoTip>
        <Can cat="keys" what="link keys" hide>
          <button type="button" onClick={() => setDialog({ kind: 'link' })} className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 font-mono text-[12px] text-muted hover:text-ink">
            <Link2 size={14} aria-hidden /> Have a key from the old request form? Link it
          </button>
        </Can>

      </div>

      {revoked.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <button type="button" onClick={() => setShowRevoked((s) => !s)} aria-expanded={showRevoked} className="inline-flex min-h-11 items-center justify-between gap-3 text-left text-[14px] text-muted hover:text-ink">
            <span>Revoked keys ({revoked.length})</span>
            <span className="font-mono text-[12px] text-faint">{showRevoked ? 'Hide' : 'Show'}</span>
          </button>
          {showRevoked && (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {revoked.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line px-3 py-2 opacity-70">
                  <span className="text-[14px]">
                    {k.name} <code className="ml-2 font-mono text-[12px] text-faint">{k.prefix}…</code>
                  </span>
                  <span className="font-mono text-[12px] text-faint">revoked {fmtDate(k.revokedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
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
            <button type="button" onClick={close} className={pillLine}>
              Cancel
            </button>
            <button type="submit" disabled={busy || !name.trim()} className={pillGold}>
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
              <button type="button" onClick={close} className={pillLine}>
                Cancel
              </button>
              {dialog.kind === 'rotate' ? (
                <button type="button" disabled={busy} onClick={() =>
                    act(`/api/developer/keys/${dialog.key.id}/rotate`, {}, (d) => {
                      toastSuccess('Secret rotated', { detail: `${d.key.name}: the old secret stopped working.` })
                      setDialog({ kind: 'secret', key: d.key, secret: d.secret ?? '', rotated: true })
                    })
                  } className={pillGold}>
                  {busy ? 'Rotating…' : 'Rotate'}
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() =>
                    act(`/api/developer/keys/${dialog.key.id}/revoke`, {}, (d) => {
                      toastSuccess('Key revoked', { detail: `${d.key.name} no longer works.` })
                      close()
                    })
                  } className={pillDanger}>
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
            <p className="m-0 flex items-start gap-3 rounded-[10px] border border-gold-line bg-[rgba(217,181,99,.06)] px-4 py-3 text-[14px] leading-[1.55] text-ink-2">
              <AlertTriangle size={18} className="mt-[2px] shrink-0 text-gold" aria-hidden />
              Copy it now. This is the only time the full key is shown: we store only a hash, so it cannot be shown again. Lost it? Rotate the key.
            </p>
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[11px] tracking-[1px] text-faint">{dialog.key.name.toUpperCase()}</span>
              <div className="flex items-center gap-2 rounded-[10px] border border-gold-line bg-bg py-1 pr-1 pl-3">
                <code className="min-w-0 flex-1 font-mono text-[13px] break-all text-gold" data-testid="new-secret">
                  {dialog.secret}
                </code>
                <CopyButton text={dialog.secret} what="Key" />
              </div>
            </div>
            <div className="flex justify-end">
              <button type="button" data-autofocus onClick={close} className={pillGold}>
                <Check size={16} aria-hidden /> I have saved it
              </button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <LinkDialog open={dialog?.kind === 'link'} onClose={close} reload={reload} />
    </section>
    </>
  )
}

/** Live keys, requests in 7 days, the last call and the per-key limit, in one row. Unknown figures are a dash. */
function KeyKpis({ account, week }: { account: Account; week: Week }) {
  const live = account.keys.filter((k) => !k.revokedAt)
  const total = week.state === 'ok' ? week.usage.points.reduce((a, p) => a + p.total, 0) : null
  const last = account.keys.map((k) => k.lastUsed ?? '').sort().at(-1) || null
  return (
    <KpiRow label="Keys summary">
      <KpiTile i={0} label="Live keys" icon={<KeyRound size={13} aria-hidden />} note={`of ${account.limits.maxKeys} allowed`}>
        {live.length ? <AnimatedNumber value={live.length} countUp /> : <span className="font-mono text-[13px] font-normal text-faint">none yet</span>}
      </KpiTile>
      <KpiTile i={1} label="Requests · 7 days" icon={<Activity size={13} aria-hidden />} note="with your keys">
        {total === null ? week.state === 'error' ? <Unknown /> : <span className="font-mono text-[13px] font-normal text-faint">…</span> : total ? <AnimatedNumber value={total} countUp /> : <span className="font-mono text-[13px] font-normal text-faint">none yet</span>}
      </KpiTile>
      <KpiTile i={2} label="Last call" icon={<Clock size={13} aria-hidden />} note={last ? new Date(last).toLocaleString() : 'no call with a key yet'}>
        {last ? <span className="text-[20px]">{ago(last)}</span> : <span className="font-mono text-[13px] font-normal text-faint">not yet</span>}
      </KpiTile>
      <KpiTile i={3} label="Limit per key" icon={<Gauge size={13} aria-hidden />} note={`${fmt(account.limits.anonymousPerMin)}/min without a key`}>
        <AnimatedNumber value={account.limits.keyPerMin} countUp suffix="/min" />
      </KpiTile>
    </KpiRow>
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
          toastSuccess('Key linked', { detail: 'It is now managed from this wallet.' })
          setKey('')
          onClose()
        }}
      >
        <p className="m-0 text-[14px] leading-[1.6] text-muted">Keys issued through the old request form keep working. Link one to this wallet to manage it and see its usage here. The key is sent once to check it and is not stored in your browser.</p>
        <input className={`${input} font-mono`} value={key} onChange={(e) => setKey(e.target.value)} placeholder="gl_live_…" autoComplete="off" spellCheck={false} required aria-label="API key" />
        {err && <ErrorLine>{err}</ErrorLine>}
        <div className="flex justify-end">
          <button type="submit" disabled={busy || !key.trim().startsWith('gl_live_')} className={pillGold}>
            {busy ? 'Linking…' : 'Link key'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- requests --- */

function statusTone(s: number) {
  if (s === 429) return 'border-error-line text-error'
  if (s >= 500) return 'border-error-line text-error'
  if (s >= 400) return 'border-gold-line text-gold'
  return 'border-success-line text-green'
}

function Requests({ account }: { account: Account }) {
  const p = usePoll<{ requests: RecentRequest[] }>('/api/developer/requests', 15_000)
  const rows = p.data?.requests ?? null
  const err = rows ? null : (p.error ?? (p.timedOut ? 'no answer in time' : null))
  const [busy, setBusy] = useState(false)
  const load = () => {
    setBusy(true)
    p.reload().then(() => setBusy(false))
  }
  const colors = keyColors(account.keys)
  const colorOfId = (id: string) => colors[id] ?? '#8a94a1'
  return (
    <section id="requests" className={`${panel} scroll-mt-24`} style={rise(1)} aria-labelledby="req-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-[2px]">
          <h2 id="req-title" className={panelTitle}>
            Recent requests
          </h2>
          <span className={mono}>The last 50 made with your keys · refreshes every 15 seconds</span>
        </div>
        <RefreshChip error={rows ? p.error : null} onRetry={load} className="ml-auto" />
        <button type="button" onClick={load} disabled={busy} className={pillSm}>
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} aria-hidden /> Refresh
        </button>
      </div>
      {err ? (
        <ErrorLine onRetry={load}>Requests could not be read: {err}</ErrorLine>
      ) : !rows ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} h={34} />
          ))}
        </div>
      ) : !rows.length ? (
        <Empty icon={<Activity size={26} className="text-gold" aria-hidden />} title="No requests yet" action={<ExtLink href={`${DOCS_URL}/api`} className={pillSm}>Make a first call: API docs</ExtLink>}>
          Calls made with your keys appear here within seconds. Answers served from the edge cache are not listed.
        </Empty>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[620px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
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
                  <td className="py-[10px] pr-3 whitespace-nowrap text-muted">
                    <span className="inline-flex items-center gap-2">
                      <i className="inline-block size-[8px] rounded-[2px]" style={{ background: colorOfId(r.keyId) }} aria-hidden />
                      {r.key?.name ?? '—'}
                    </span>
                  </td>
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

/* -------------------------------------------------------------- quickstart --- */

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

function Quickstart({ account }: { account: Account }) {
  const [lang, setLang] = useState<Lang>('curl')
  const first = account.keys.find((k) => !k.revokedAt)
  const placeholder = first ? `${first.prefix}…` : 'gl_live_YOUR_KEY'
  const endpoints = [
    { title: 'Every tracked stock', path: '/api/tracker', note: 'Fair price, on-chain price and the gap for every tokenised stock, all chains.' },
    { title: 'Price history', path: '/api/tracker/history?chain=robinhood&ticker=NVDA', note: 'The recorded gap series for one stock on one chain.' },
  ]
  const langs: { v: Lang; l: string }[] = [
    { v: 'curl', l: 'cURL' },
    { v: 'js', l: 'JavaScript' },
    { v: 'python', l: 'Python' },
  ]
  return (
    <section id="quickstart" className={`${panel} scroll-mt-24`} style={rise(2)} aria-labelledby="qs-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-[2px]">
          <h2 id="qs-title" className={panelTitle}>
            Quickstart
          </h2>
          <span className={mono}>Two endpoints, one header. JSON over HTTPS.</span>
        </div>
        <div role="radiogroup" aria-label="Language" className="flex gap-[2px] rounded-full border border-line p-[3px]">
          {langs.map((o) => (
            <button key={o.v} type="button" role="radio" aria-checked={lang === o.v} onClick={() => setLang(o.v)} className={`${chip(lang === o.v, true)} min-h-11 border-0 max-[480px]:min-h-11`}>
              {o.l}
            </button>
          ))}
        </div>
      </div>
      <p className="m-0 text-[14px] leading-[1.6] text-muted">
        {first ? (
          <>
            Your key <code className="font-mono text-[12.5px] text-gold">{first.prefix}…</code> is ready. Replace it below with the full key, ideally from an environment variable.
          </>
        ) : (
          <>Create a key above, then replace the placeholder below with it.</>
        )}{' '}
        Read <code className="font-mono text-[12.5px] text-ink-2">X-RateLimit-Remaining</code>; past the limit you get 429 with Retry-After.
      </p>
      {endpoints.map((e) => (
        <div key={e.path} className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <KitPill tone="ok">GET</KitPill>
            <code className="font-mono text-[13px] break-all text-ink">{e.path}</code>
            <span className="text-[13px] text-faint">{e.note}</span>
          </div>
          <CodeBlock code={snippet(lang, e.path, placeholder)} lang={lang === 'curl' ? 'bash' : lang === 'js' ? 'js' : 'text'} caption={lang === 'python' ? 'Python' : undefined} />
        </div>
      ))}
      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <ExtLink href={`${DOCS_URL}/api`} className={pillSm}>
          <BookOpen size={15} aria-hidden /> API reference
        </ExtLink>
        <ExtLink href={`${DOCS_URL}/api-keys`} className={pillSm}>
          <KeyRound size={15} aria-hidden /> Keys and limits
        </ExtLink>
      </div>
    </section>
  )
}

function WidgetPanel() {
  return (
    <section id="widget" className={`${panel} scroll-mt-24`} style={rise(3)} aria-labelledby="widget-title">
      <div className="flex flex-col gap-[2px]">
        <h2 id="widget-title" className={panelTitle}>
          No key needed: the widget
        </h2>
        <span className={mono}>The widget reads the public API itself; do not put a key in it.</span>
      </div>
      <p className="m-0 max-w-[680px] text-[14px] leading-[1.6] text-muted">Drop live fair-price data into any page with two lines of HTML. Pick the layout, chain and theme in the builder, then paste the snippet.</p>
      <CodeBlock code={widgetSnippet({ type: 'ticker', chain: 'robinhood', theme: 'dark', limit: 8 })} lang="html" caption="HTML · ticker, Robinhood Chain" />
      <div className="flex flex-wrap gap-2">
        <ExtLink href={WIDGET_URL} className={pillGold}>
          <AppWindow size={16} aria-hidden /> Open the widget builder
        </ExtLink>
        <ExtLink href={`${DOCS_URL}/widget`} className={pillSm}>
          <BookOpen size={15} aria-hidden /> Widget guide
        </ExtLink>
      </div>
    </section>
  )
}

const KEY_SUBS = ['keys', 'requests', 'quickstart', 'widget'] as const
type KeySub = (typeof KEY_SUBS)[number]

export function KeysTab({ account, reload, creating, onCreateDone, section }: { account: Account; reload: () => Promise<void>; creating: boolean; onCreateDone: () => void; section: string | null }) {
  const [sub, setSub] = useSubTab<KeySub>('keys', KEY_SUBS, 'keys')
  // Old deep links (#requests, #quickstart, #widget) open their sub-tab.
  useEffect(() => {
    if (section && (KEY_SUBS as readonly string[]).includes(section)) setSub(section as KeySub)
  }, [section, setSub])
  // "Create a key" from the Overview: the dialog lives on the Keys sub-tab.
  useEffect(() => {
    if (creating) setSub('keys')
  }, [creating, setSub])
  const [askCreate, setAskCreate] = useState(false)
  const createDone = useCallback(() => {
    setAskCreate(false)
    onCreateDone()
  }, [onCreateDone])
  const live = account.keys.filter((k) => !k.revokedAt)
  const called = account.keys.some((k) => !!k.lastUsed)
  const first = live[0]
  return (
    <div className="flex flex-col gap-2">
      <ServiceHeader icon={KeyRound} title="API keys" desc="Keys for the Tracker API, how much each one is used, and the quickstart to make a first call." status={{ tone: live.length ? 'live' : 'idle', text: live.length ? `${live.length} live key${live.length === 1 ? '' : 's'}` : 'no key yet' }} docs={docsPage('api-keys')} />
      <Stepper
        title="Set up the API"
        testId="keys-stepper"
        steps={[
          { id: 'create', label: 'Create a key', icon: <KeyRound size={13} aria-hidden />, done: account.keys.length > 0 },
          { id: 'call', label: 'Make a first call', icon: <Send size={13} aria-hidden />, done: called },
        ]}
      >
        {(step) =>
          step === 'create' ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-[1_1_260px] text-[13px] text-muted">
                A key works the moment it exists: {fmt(account.limits.keyPerMin)} requests a minute instead of {fmt(account.limits.anonymousPerMin)}.
              </span>
              <Can cat="keys" what="create keys">
                <button
                  type="button"
                  disabled={live.length >= account.limits.maxKeys}
                  onClick={() => {
                    setSub('keys')
                    setAskCreate(true)
                  }}
                  className={`${pillGold} min-h-11`}
                >
                  <Plus size={16} aria-hidden /> Create key
                </button>
              </Can>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-[1_1_320px] truncate rounded-[8px] bg-surface-deep px-3 py-2 font-mono text-[12px] text-ink-2">
                curl -H &quot;Authorization: Bearer {first ? `${first.prefix}…` : 'gl_live_…'}&quot; {API_ORIGIN}/api/tracker
              </code>
              <button type="button" onClick={() => setSub('quickstart')} className={`${pillSm} min-h-11`}>
                <Code2 size={14} aria-hidden /> Quickstart
              </button>
              <span className="w-full font-mono text-[11px] text-faint">Done as soon as the server sees a request with one of your keys.</span>
            </div>
          )
        }
      </Stepper>
      <SubTabs
        label="Keys sections"
        idBase="keys"
        value={sub}
        onChange={setSub}
        items={[
          { id: 'keys', label: 'Keys', icon: <KeyRound size={15} aria-hidden />, count: live.length },
          { id: 'requests', label: 'Requests', icon: <Activity size={15} aria-hidden /> },
          { id: 'quickstart', label: 'Quickstart', icon: <Code2 size={15} aria-hidden /> },
          { id: 'widget', label: 'Widget', icon: <AppWindow size={15} aria-hidden /> },
        ]}
      />
      <SubPanel idBase="keys" value={sub}>
        {sub === 'keys' && <KeysPanel account={account} reload={reload} creating={creating || askCreate} onCreateDone={createDone} />}
        {sub === 'requests' && <Requests account={account} />}
        {sub === 'quickstart' && <Quickstart account={account} />}
        {sub === 'widget' && <WidgetPanel />}
      </SubPanel>
    </div>
  )
}
