import { AlertTriangle, BellRing, Check, ChevronDown, ExternalLink, Link2Off, Pause, Play, Plus, RotateCw, Send, Trash2, Users } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { DOCS_URL } from '../../site-host'
import { toastSuccess } from '../../components/ui/toast'
import { ago, api, type AlertsView, type GapAlert, type TelegramInfo, type TelegramLink } from './api'
import { alertName, alertRule, alertState, CHAIN_NAMES, useAlertActions, useAlertsView, type Secret } from './helpers'
import { CopyButton, Dialog } from './Dialog'
import { useWrite } from './portal'
import { Can } from './RoleGate'
import { AlertTimeline } from './vcharts'
import { Empty, ErrorLine, Skeleton } from './parts'
import { ExtLink } from './ExtLink'
import { input, mono, panel, panelTitle, pillGold, pillLine, pillSm, rise } from './styles'

/* Gap alerts: create, test, pause and delete alerts, and read each one's delivery log. Limits come
   from the plan (server); Telegram appears only when the server has a bot configured, and delivers to
   the chat linked with Connect Telegram (a one-time t.me link; no chat ids to paste). The Telegram card,
   the channel chips and the load/act helpers are shared with the Overview. */

const select = `${input} pr-8`
const fieldLabel = 'flex flex-col gap-2 text-[14px] text-ink-2'
const TG_BLUE = '#2aa3df'

/**
 * The per-alert channel chips. Telegram is a toggle (aria-pressed): on when the alert sends there; it
 * can be turned on only once a chat is linked, and off only while a webhook is left to deliver.
 * Webhook is a status chip.
 */
export function ChannelChips({ a, telegram, act, busy }: { a: GapAlert; telegram: TelegramInfo; act: (a: GapAlert, op: string, body?: unknown) => void; busy: string | null }) {
  const on = !!a.telegram
  const w = useWrite('alerts', 'change alerts')
  const canOn = telegram.enabled && !!telegram.linked
  const canOff = !!a.webhook
  const disabled = !!busy || !w.ok || (on ? !canOff : !canOn)
  const why = !w.ok ? (w.why ?? '') : on ? (canOff ? 'Stop sending this alert to Telegram' : 'Telegram is this alert’s only channel') : canOn ? 'Also send this alert to Telegram' : telegram.enabled ? 'Connect Telegram first' : 'Telegram is not configured on this server'
  const broken = on && !a.telegram?.linked
  return (
    <span className="flex flex-wrap items-center gap-[6px]">
      {telegram.enabled || on ? (
        <button
          type="button"
          aria-pressed={on}
          disabled={disabled}
          title={why}
          aria-label={`Telegram for ${alertName(a)}: ${on ? 'on' : 'off'}. ${why}`}
          onClick={() => act(a, 'telegram', { on: !on })}
          className="inline-flex min-h-11 items-center gap-[6px] rounded-full border px-3 text-[12px] transition-colors disabled:cursor-not-allowed max-[480px]:px-[10px]"
          style={{ borderColor: broken ? '#5a2a24' : on ? TG_BLUE : '#2c3540', color: broken ? '#ff8a7a' : on ? '#7cc8ef' : '#6c7888', opacity: disabled && !on ? 0.6 : 1 }}
        >
          {on && <Check size={12} aria-hidden />}
          Telegram{broken ? ': no chat' : ''}
        </button>
      ) : null}
      <span className={`inline-flex min-h-[30px] items-center rounded-full border px-3 text-[12px] ${a.webhook ? 'border-line-strong text-muted' : 'border-line text-faint line-through'}`} title={a.webhook?.url ?? 'No webhook'}>
        Webhook
      </span>
    </span>
  )
}

function CreateDialog({ open, onClose, view, onCreated }: { open: boolean; onClose: () => void; view: AlertsView; onCreated: (secret: string | null) => void }) {
  const [name, setName] = useState('')
  const [target, setTarget] = useState('any')
  const [kind, setKind] = useState<'gap' | 'premium' | 'discount' | 'either' | 'deepcore'>('gap')
  // DeepCore launch alerts, offered when the server lists that kind (with its chains).
  const launchKind = view.kinds?.find((k) => k.id === 'deepcore-launch')
  const [dcChain, setDcChain] = useState('')
  const [pct, setPct] = useState(String(view.limits.flagPct))
  const [webhook, setWebhook] = useState('')
  const [toTelegram, setToTelegram] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const byChain = useMemo(() => {
    const m: Record<string, AlertsView['stocks']> = {}
    for (const s of view.stocks) (m[s.chain] ??= []).push(s)
    return m
  }, [view.stocks])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    const [chain, ticker] = target === 'any' || kind === 'deepcore' ? [undefined, undefined] : target.split(':')
    const condition = kind === 'deepcore' ? { type: 'deepcore-launch', chainId: dcChain ? Number(dcChain) : null } : kind === 'gap' ? { type: 'gap', pct: Number(pct) } : { type: 'status', status: kind }
    setBusy(true)
    const r = await api<{ secret: string | null }>('/api/developer/alerts', { method: 'POST', body: { name: name.trim(), chain, ticker, condition, webhookUrl: webhook.trim() || undefined, telegram: toTelegram || undefined } })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    setName('')
    setWebhook('')
    setToTelegram(false)
    toastSuccess('Alert created', { detail: name.trim() || (kind === 'deepcore' ? 'DeepCore launch alert' : ticker ? `${ticker} alert` : 'Any-stock alert') })
    onCreated(r.data.secret)
  }

  return (
    <Dialog open={open} onClose={onClose} title="New gap alert">
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <label className={fieldLabel}>
          <span>
            Name <span className="text-[12px] text-faint">optional</span>
          </span>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. NVDA wide gap" />
        </label>
        {kind === 'deepcore' && launchKind ? (
          <label className={fieldLabel}>
            Chain
            <select className={select} value={dcChain} onChange={(e) => setDcChain(e.target.value)}>
              <option value="">Every chain DeepCore runs on</option>
              {(launchKind.chains ?? []).map((c) => (
                <option key={c.chainId} value={String(c.chainId)}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
        <label className={fieldLabel}>
          Stock
          <select className={select} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="any">Any stock the tracker follows</option>
            {Object.entries(byChain).map(([chain, stocks]) => (
              <optgroup key={chain} label={CHAIN_NAMES[chain] ?? chain}>
                {stocks.map((s) => (
                  <option key={`${chain}:${s.ticker}`} value={`${chain}:${s.ticker}`}>
                    {s.ticker} · {s.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3 max-[480px]:grid-cols-1">
          <label className={fieldLabel}>
            When
            <select className={select} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="gap">The gap is at least…</option>
              <option value="premium">It turns premium</option>
              <option value="discount">It turns discount</option>
              <option value="either">It turns premium or discount</option>
              {launchKind && <option value="deepcore">A new token launches on DeepCore</option>}
            </select>
          </label>
          {kind === 'gap' && (
            <label className={fieldLabel}>
              Percent
              <input className={input} type="number" min={0.1} max={100} step={0.1} value={pct} onChange={(e) => setPct(e.target.value)} required />
            </label>
          )}
        </div>
        <span className="-mt-2 text-[12px] leading-[1.5] text-faint">
          {kind === 'deepcore'
            ? `Once per new launch read from DeepCore's public API (checked every minute or two); launches within ${launchKind?.cooldownMinutes ?? 5} minutes of the last delivery go out together. Counts as one of your plan's alerts.`
            : <>Either way, above or below fair. Premium and discount are the tracker&apos;s own flags (a gap of {view.limits.flagPct}% or more in a pool deep enough to count).</>}
        </span>
        <label className={fieldLabel}>
          Webhook URL
          <input className={`${input} font-mono text-[13px]`} type="url" value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://example.com/hooks/gully" spellCheck={false} />
          <span className="text-[12px] text-faint">https only, on a public address. We POST signed JSON; the signing secret is shown once.</span>
        </label>
        {view.telegram.enabled && view.telegram.linked ? (
          <label className="flex min-h-11 items-center gap-3 text-[14px] text-ink-2">
            <input type="checkbox" className="size-4 accent-[#E8C060]" checked={toTelegram} onChange={(e) => setToTelegram(e.target.checked)} />
            <span>
              Also send to Telegram <span className="text-faint">({view.telegram.linked.chatTitle})</span>
            </span>
          </label>
        ) : view.telegram.enabled ? (
          <p className="m-0 text-[12px] text-faint">To get alerts in Telegram, close this and press Connect on the Telegram card first.</p>
        ) : (
          <p className="m-0 text-[12px] text-faint">Telegram delivery is not configured on this server; webhooks work.</p>
        )}
        {err && <ErrorLine>{err}</ErrorLine>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={pillLine}>
            Cancel
          </button>
          <button type="submit" disabled={busy || (!webhook.trim() && !toTelegram)} className={pillGold}>
            {busy ? 'Creating…' : 'Create alert'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function AlertRow({ a, i, act, busy, telegram }: { a: GapAlert; i: number; act: (a: GapAlert, op: string, body?: unknown) => void; busy: string | null; telegram: TelegramInfo }) {
  const [open, setOpen] = useState(false)
  const st = alertState(a)
  const mine = (op: string) => busy === `${a.id}:${op}`
  const canEdit = useWrite('alerts', 'change alerts').ok
  return (
    <li className="flex flex-col gap-3 border-t border-line pt-3" style={rise(i)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex min-w-0 flex-[1_1_200px] flex-col">
          <b className="font-semibold">{alertName(a)}</b>
          <span className="font-mono text-[11px] text-faint">{alertRule(a)}</span>
        </span>
        <ChannelChips a={a} telegram={telegram} act={act} busy={busy} />
        <span className="font-mono text-[11px]" style={{ color: st.c }}>
          {st.t}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
        <>
        <button type="button" className={pillSm} disabled={!!busy} onClick={() => act(a, 'test')}>
          <Send size={14} aria-hidden /> {mine('test') ? 'Sending…' : 'Test'}
        </button>
        {a.mutedUntil && a.enabled ? (
          <button type="button" className={pillSm} disabled={!!busy} onClick={() => act(a, 'resume')}>
            <BellRing size={14} aria-hidden /> Unmute
          </button>
        ) : (
          <button type="button" className={pillSm} disabled={!!busy} onClick={() => act(a, a.enabled ? 'pause' : 'resume')}>
            {a.enabled ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />} {a.enabled ? 'Pause' : 'Resume'}
          </button>
        )}
        {a.webhook && (
          <button type="button" className={pillSm} disabled={!!busy} onClick={() => act(a, 'rotate')}>
            <RotateCw size={14} aria-hidden /> New webhook secret
          </button>
        )}
        <button type="button" className={`${pillSm} hover:!border-error hover:!text-error`} disabled={!!busy} onClick={() => act(a, 'delete')}>
          <Trash2 size={14} aria-hidden /> Delete
        </button>
        </>
        )}
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-full px-2 font-mono text-[12px] text-muted hover:text-ink">
          <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden /> Delivery log ({a.deliveries.length})
        </button>
      </div>
      {a.webhook && <span className="font-mono text-[11px] break-all text-faint">webhook {a.webhook.url}</span>}
      {open &&
        (!a.deliveries.length ? (
          <p className="m-0 text-[13px] text-faint">Nothing sent yet. Use Test to check your endpoint.</p>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-line">
            <div className="bg-surface-deep px-3 py-2 font-mono text-[10px] tracking-[1px] text-faint">DELIVERY LOG · LAST {a.deliveries.length}</div>
            <table className="w-full min-w-[560px] border-collapse font-mono text-[12px]">
              <thead className="sr-only">
                <tr>
                  <th>Time</th>
                  <th>Result</th>
                  <th>What</th>
                  <th>Channel</th>
                  <th>Latency</th>
                </tr>
              </thead>
              <tbody>
                {a.deliveries.map((d, k) => (
                  <tr key={`${d.id}-${d.channel}-${k}`} className="border-t border-line">
                    <td className="px-3 py-2 whitespace-nowrap text-dim" title={new Date(d.at).toLocaleString()}>
                      {ago(d.at)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: d.ok ? '#6fcf6a' : '#ff8a7a' }} title={d.error ?? undefined}>
                      {d.status ?? 'no answer'}
                    </td>
                    <td className="max-w-[260px] truncate px-3 py-2 text-ink-2">
                      {d.test ? 'test' : d.events.map((e) => e.split(':')[1]).join(', ')}
                      {d.error && <span className="ml-2 text-faint">{d.error}</span>}
                    </td>
                    <td className="px-3 py-2 text-dim">{d.channel}</td>
                    <td className="px-3 py-2 text-right text-dim">{d.ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </li>
  )
}

/* Telegram: not configured / connect (one-time deep link, polled) / connected (chat name, unlink). */
export function TelegramCard({ info, reload, compact = false }: { info: TelegramInfo; reload: () => Promise<unknown>; compact?: boolean }) {
  const [link, setLink] = useState<TelegramLink | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const live = !!link && !info.linked && Date.parse(link.expiresAt) > now

  // The card turns to Connected by itself (polled below); say so once when a link we opened lands.
  const linkedAt = info.enabled ? (info.linked?.linkedAt ?? null) : null
  const chatTitle = info.linked?.chatTitle
  const waiting = !!link
  useEffect(() => {
    if (linkedAt && waiting) toastSuccess('Telegram linked', { detail: chatTitle, id: `telegram:${linkedAt}` })
  }, [linkedAt, waiting, chatTitle])

  // While a link is open, look for the chat every five seconds so the card turns to Connected by itself.
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => {
      setNow(Date.now())
      reload()
    }, 5_000)
    return () => clearInterval(id)
  }, [live, reload])

  const connect = async () => {
    setBusy(true)
    setErr(null)
    const r = await api<TelegramLink>('/api/developer/telegram/connect', { method: 'POST' })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    setNow(Date.now())
    setLink(r.data)
  }
  const unlink = async () => {
    if (!window.confirm('Unlink this Telegram chat? Alerts set to Telegram stop arriving there until you connect again.')) return
    setBusy(true)
    setErr(null)
    const r = await api('/api/developer/telegram/unlink', { method: 'POST' })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    setLink(null)
    toastSuccess('Telegram unlinked', { detail: 'Alerts set to Telegram stop arriving there.' })
    reload()
  }

  const chat = info.enabled ? info.linked : null
  const title = !info.enabled ? 'Telegram not available' : chat ? 'Telegram connected' : live ? 'Waiting for the bot…' : 'Connect Telegram'
  const subline = !info.enabled
    ? 'No bot is configured on this server. Webhook alerts work.'
    : chat
      ? `${chat.chatTitle} · ${chat.chatType === 'private' ? 'private chat' : 'group'} · linked ${ago(chat.linkedAt)}${info.bot ? ` · @${info.bot}` : ''}`
      : link && !live
        ? 'That link has expired. Make a new one.'
        : link
          ? `Open the bot and press Start. The link works once, until ${new Date(link.expiresAt).toLocaleTimeString()}.`
          : 'One-time code, no chat id to copy. Works in groups.'

  return (
    <div className="flex flex-col gap-3 rounded-[12px] border p-3" style={{ background: chat ? '#16301a' : '#0d1116', borderColor: chat ? '#2f5a33' : live ? '#5a4a22' : '#1d232c' }}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full" style={{ background: info.enabled ? TG_BLUE : '#2c3540' }}>
          <Send size={17} color="#fff" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-[1_1_160px] flex-col">
          <b className="font-semibold">{title}</b>
          <span className="text-[12px] text-muted">{subline}</span>
        </span>
        {info.enabled && !chat && (
          <Can cat="telegram" what="connect Telegram">
            <button type="button" onClick={connect} disabled={busy} className={live ? pillLine : pillGold}>
              {busy ? 'Making a link…' : link ? 'New link' : 'Connect'}
            </button>
          </Can>
        )}
        {chat && (
          <Can cat="telegram" what="unlink Telegram" hide>
            <button type="button" onClick={unlink} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-grid px-4 text-[13px] font-semibold text-ink hover:text-error disabled:opacity-50">
              <Link2Off size={14} aria-hidden /> Unlink
            </button>
          </Can>
        )}
      </div>
      {link && live && (
        <div className="flex flex-wrap gap-2">
          <a href={link.link} target="_blank" rel="noopener noreferrer" className={pillGold}>
            <ExternalLink size={15} aria-hidden /> Open {info.bot ? `@${info.bot}` : 'the bot'}
          </a>
          <a href={link.groupLink} target="_blank" rel="noopener noreferrer" className={pillLine}>
            <Users size={15} aria-hidden /> Add to a group
          </a>
        </div>
      )}
      {!compact && chat && <span className="text-[12px] leading-[1.55] text-muted">Tick Telegram on an alert to have it sent here, with Open and Mute 24h buttons. In the chat, /alerts lists your alerts, /gap NVDA and /top read the tracker, and /stop unlinks.</span>}
      {!compact && info.enabled && !chat && !link && <span className="text-[12px] leading-[1.55] text-muted">Connect opens the bot with a one-time code that links the chat to this wallet. The bot also answers /gap NVDA and /top for anyone. In a group, only the person who links it can unlink it.</span>}
      {err && <ErrorLine>{err}</ErrorLine>}
    </div>
  )
}

export function SecretDialog({ secret, onClose }: { secret: Secret; onClose: () => void }) {
  return (
    <Dialog open={!!secret} onClose={onClose} title={secret?.title ?? ''} dismissable={false}>
      {secret ? (
        <div className="flex flex-col gap-4">
          <p className="m-0 flex items-start gap-3 rounded-[10px] border border-gold-line bg-[rgba(232,192,96,.06)] px-4 py-3 text-[14px] leading-[1.55] text-ink-2">
            <AlertTriangle size={18} className="mt-[2px] shrink-0 text-gold" aria-hidden />
            Copy it now; it is not shown again. Check the X-Gully-Signature header of every delivery with it. Lost it? Make a new one.
          </p>
          <div className="flex items-center gap-2 rounded-[10px] border border-gold-line bg-bg py-1 pr-1 pl-3">
            <code className="min-w-0 flex-1 font-mono text-[13px] break-all text-gold">{secret.secret}</code>
            <CopyButton text={secret.secret} what="Signing secret" />
          </div>
          <div className="flex justify-end">
            <button type="button" data-autofocus onClick={onClose} className={pillGold}>
              <Check size={16} aria-hidden /> I have saved it
            </button>
          </div>
        </div>
      ) : null}
    </Dialog>
  )
}

export function Alerts({ goBilling, creating, onCreateDone }: { goBilling: () => void; creating: boolean; onCreateDone: () => void }) {
  const { view, err, load } = useAlertsView()
  const { act, busy, secret, setSecret } = useAlertActions(load)
  const [opened, setOpen] = useState(false)

  // "+ New alert" on the Overview lands here with the dialog open (once the plan's room is known).
  const full = !!view && view.limits.used >= view.limits.max
  const canCreate = useWrite('alerts', 'create alerts').ok
  const open = opened || (creating && !!view && !full && canCreate)
  const closeCreate = () => {
    setOpen(false)
    onCreateDone()
  }

  if (err) return <ErrorLine onRetry={load}>Alerts could not be read: {err}</ErrorLine>
  if (!view)
    return (
      <div className="flex flex-col gap-3">
        <Skeleton h={90} />
        <Skeleton h={160} />
      </div>
    )

  return (
    <div className="flex flex-col gap-[14px]">
      <section className={panel} style={rise(0)} aria-labelledby="alerts-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-[2px]">
            <h2 id="alerts-title" className={panelTitle}>
              Gap alerts
            </h2>
            <span className={mono}>
              {view.limits.used} of {view.limits.max} on {view.limits.planName} · checked every five minutes · at most one delivery per alert every {view.limits.cooldownMinutes} minutes
            </span>
          </div>
          <Can cat="alerts" what="create alerts">
            <button type="button" disabled={full} onClick={() => setOpen(true)} title={full ? 'Your plan’s alerts are all in use' : undefined} className={pillLine}>
              <Plus size={16} aria-hidden /> New alert
            </button>
          </Can>
        </div>
        <TelegramCard info={view.telegram} reload={load} />
        {full && (
          <p className="m-0 text-[14px] text-muted">
            Every alert your plan includes is in use.{' '}
            <button type="button" onClick={goBilling} className="min-h-11 text-gold underline-offset-4 hover:underline">
              See plans
            </button>{' '}
            for more, or delete one.
          </p>
        )}
        {!view.alerts.length ? (
          <Empty
            icon={<BellRing size={26} className="text-gold" aria-hidden />}
            title="No alerts yet"
            action={
              <Can cat="alerts" what="create alerts">
                <button type="button" disabled={full} onClick={() => setOpen(true)} className={pillGold}>
                  <Plus size={16} aria-hidden /> Create your first alert
                </button>
              </Can>
            }
          >
            Get a webhook{view.telegram.enabled ? ' or a Telegram message' : ''} when a stock token&apos;s gap to its fair price crosses your line. An alert fires when its condition becomes true and re-arms once it is false again.
          </Empty>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {view.alerts.map((a, i) => (
              <AlertRow key={a.id} a={a} i={i} act={act} busy={busy} telegram={view.telegram} />
            ))}
          </ul>
        )}
        <p className="m-0 border-t border-line pt-3 text-[12px] leading-[1.6] text-faint">
          Alerts look only at stocks the tracker would flag: a readable feed and pool, a pool deep enough to count, and an open feed session. Webhook payloads and how to check the signature:{' '}
          <ExtLink href={`${DOCS_URL}/plans-alerts`} className="inline-flex items-center gap-1 text-ink-2 underline-offset-4 hover:underline">
            Plans &amp; alerts docs
          </ExtLink>
          .
        </p>
      </section>

      <section className={panel} style={rise(1)} aria-labelledby="fired-title" data-testid="alert-timeline">
        <div className="flex flex-col gap-[2px]">
          <h2 id="fired-title" className={panelTitle}>
            Fired alerts
          </h2>
          <span className={mono}>From each alert&apos;s delivery log (its latest deliveries) · green delivered, red failed, hollow test</span>
        </div>
        <AlertTimeline alerts={view.alerts} nameOf={alertName} />
      </section>

      <CreateDialog

        open={open}
        onClose={closeCreate}
        view={view}
        onCreated={(s) => {
          closeCreate()
          if (s) setSecret({ title: 'Your signing secret', secret: s })
          load()
        }}
      />
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </div>
  )
}
