import { track } from '../../lib/track'
import { AlertTriangle, BellRing, Check, ChevronDown, ExternalLink, History, Link2Off, Pause, Play, Plus, RotateCw, Send, Trash2, Users } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { DOCS_URL } from '../../site-host'
import { toastSuccess } from '../../components/ui/toast'
import { ago, api, GAP_DIRECTIONS, type AlertsView, type GapAlert, type GapDirection, type TelegramInfo, type TelegramLink } from './api'
import { alertName, alertRule, alertState, CHAIN_NAMES, useAlertActions, useAlertsView, type Secret } from './helpers'
import { CopyButton, Dialog } from './Dialog'
import { useWrite } from './portal'
import { Can } from './RoleGate'
import { AlertFires } from './tabcharts'
import { ErrorLine, Skeleton } from './parts'
import { GhostCurves } from './charts'
import { InfoTip, KpiRow, KpiTile, RefreshChip, Stepper, SubPanel, SubTabs, Unknown } from './ui'
import { useSubTab } from './subtab'
import { AnimatedNumber } from '../../components/charts/AnimatedNumber'
import { ExtLink } from './ExtLink'
import { input, mono, panel, panelTitle, pillGold, pillLine, rise } from './styles'

/* Gap alerts: create, test, pause and delete alerts, and read each one's delivery log. Limits come
   from the plan (server); Telegram appears only when the server has a bot configured, and delivers to
   the chat linked with Connect Telegram (a one-time t.me link; no chat ids to paste). The Telegram card,
   the channel chips and the load/act helpers are shared with the Overview. */

const select = `${input} pr-8`

/** The gap threshold's side, as a segmented control (radio group): ▲ Premium, ▼ Discount, ↕ Both. */
function DirectionControl({ value, onChange, pct }: { value: GapDirection; onChange: (d: GapDirection) => void; pct: string }) {
  const n = Number(pct) > 0 ? Number(pct) : 'X'
  return (
    <div className="flex flex-col gap-2 text-[14px] text-ink-2">
      <span id="alert-direction">Direction</span>
      <div role="radiogroup" aria-labelledby="alert-direction" className="grid grid-cols-3 gap-1 rounded-input border border-line bg-bg p-1">
        {GAP_DIRECTIONS.map((d) => (
          <button
            key={d.id}
            type="button"
            role="radio"
            aria-checked={value === d.id}
            onClick={() => onChange(d.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
              e.preventDefault()
              const i = GAP_DIRECTIONS.findIndex((x) => x.id === value)
              const next = GAP_DIRECTIONS[(i + (e.key === 'ArrowRight' ? 1 : GAP_DIRECTIONS.length - 1)) % GAP_DIRECTIONS.length]
              onChange(next.id)
              ;(e.currentTarget.parentElement?.querySelectorAll('button')[GAP_DIRECTIONS.indexOf(next)] as HTMLButtonElement | undefined)?.focus()
            }}
            tabIndex={value === d.id ? 0 : -1}
            className={`min-h-11 rounded-btn px-2 font-mono text-[12px] transition-colors ${value === d.id ? 'bg-gold text-bg' : 'bg-transparent text-muted hover:text-ink'}`}
          >
            {d.label}
          </button>
        ))}
      </div>
      <span className="text-[12px] leading-[1.5] text-faint">
        {value === 'above' ? `Fires on a premium: on chain at least ${n}% above fair (gap ≥ +${n}%).` : value === 'below' ? `Fires on a discount: on chain at least ${n}% below fair (gap ≤ −${n}%).` : `Fires either way, above or below fair (|gap| ≥ ${n}%).`}
      </span>
    </div>
  )
}
const fieldLabel = 'flex flex-col gap-2 text-[14px] text-ink-2'
/** A compact row action (36px on desktop, 44px touch targets on narrow screens). */
const rowBtn = 'inline-flex min-h-9 items-center gap-[6px] rounded-full border border-line-strong px-3 text-[12px] text-ink-2 transition-colors hover:border-gold hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 max-[859px]:min-h-11'
const TG_BLUE = '#5aa9e6'

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
          style={{ borderColor: broken ? '#5a2a24' : on ? TG_BLUE : '#2a3542', color: broken ? '#ff8a7a' : on ? '#5aa9e6' : '#8a94a1', opacity: disabled && !on ? 0.6 : 1 }}
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

function CreateDialog({ open, onClose, view, onCreated, initialTarget = null, initialGap = null }: { open: boolean; onClose: () => void; view: AlertsView; onCreated: (secret: string | null) => void; initialTarget?: string | null; initialGap?: { pct: string; dir: GapDirection } | null }) {
  const [name, setName] = useState('')
  // A stock page's "Set an alert" link (?alert=<chain>:<TICKER>#alerts) opens this with that stock chosen.
  const [target, setTarget] = useState(() => (initialTarget && view.stocks.some((s) => `${s.chain}:${s.ticker}` === initialTarget) ? initialTarget : 'any'))
  // Holder Map alerts, offered when the server lists that kind; the map's "Alert me" pre-fills the token.
  const holdersKind = view.kinds?.find((k) => k.id === 'holders')
  const holdersPrefill = initialTarget?.startsWith('holders:') ? initialTarget.split(':') : null
  const [kind, setKind] = useState<'gap' | 'premium' | 'discount' | 'either' | 'deepcore' | 'holders'>(holdersPrefill && holdersKind ? 'holders' : 'gap')
  const [hChain, setHChain] = useState(holdersPrefill?.[1] ?? 'robinhood')
  const [hToken, setHToken] = useState(holdersPrefill?.[2] ?? '')
  const [hMetric, setHMetric] = useState<'cluster' | 'top10' | 'deployer'>('cluster')
  const [hAbove, setHAbove] = useState('20')
  const [hDrop, setHDrop] = useState('')
  const [hSell, setHSell] = useState('25')
  // DeepCore launch alerts, offered when the server lists that kind (with its chains).
  const launchKind = view.kinds?.find((k) => k.id === 'deepcore-launch')
  const [dcChain, setDcChain] = useState('')
  // Gully AI's "Set an alert at 2% above" (&pct=&dir= with ?alert=) opens with that gap filled in.
  const [pct, setPct] = useState(initialGap?.pct ?? String(view.limits.flagPct))
  const [direction, setDirection] = useState<GapDirection>(initialGap?.dir ?? 'both')
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
    const [chain, ticker] = target === 'any' || kind === 'deepcore' || kind === 'holders' ? [undefined, undefined] : target.split(':')
    const condition = kind === 'holders' ? { type: 'holders', chain: hChain, token: hToken.trim(), metric: hMetric, above: hAbove.trim() && hMetric !== 'deployer' ? Number(hAbove) : null, dropPts: hDrop.trim() ? Number(hDrop) : null, sellPct: hSell.trim() ? Number(hSell) : null } : kind === 'deepcore' ? { type: 'deepcore-launch', chainId: dcChain ? Number(dcChain) : null } : kind === 'gap' ? { type: 'gap', pct: Number(pct), direction } : { type: 'status', status: kind }
    setBusy(true)
    const r = await api<{ secret: string | null }>('/api/developer/alerts', { method: 'POST', body: { name: name.trim(), chain, ticker, condition, webhookUrl: webhook.trim() || undefined, telegram: toTelegram || undefined } })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    track('alert-created', { kind: kind === 'deepcore' ? 'deepcore-launch' : kind === 'holders' ? 'holders' : kind === 'gap' ? 'gap' : 'status', channel: toTelegram && webhook.trim() ? 'telegram+webhook' : toTelegram ? 'telegram' : webhook.trim() ? 'webhook' : 'app' })
    setName('')
    setWebhook('')
    setToTelegram(false)
    toastSuccess('Alert created', { detail: name.trim() || (kind === 'holders' ? 'Holder alert' : kind === 'deepcore' ? 'DeepCore launch alert' : ticker ? `${ticker} alert` : 'Any-stock alert') })
    onCreated(r.data.secret)
  }

  return (
    <Dialog open={open} onClose={onClose} title={kind === 'holders' ? 'New holder alert' : kind === 'deepcore' ? 'New DeepCore launch alert' : 'New gap alert'}>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <label className={fieldLabel}>
          <span>
            Name <span className="text-[12px] text-faint">optional</span>
          </span>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. NVDA wide gap" />
        </label>
        {kind === 'holders' && holdersKind ? (
          <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 max-[480px]:grid-cols-1">
            <label className={fieldLabel}>
              Chain
              <select className={select} value={hChain} onChange={(e) => setHChain(e.target.value)}>
                {(holdersKind.chains ?? []).map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className={fieldLabel}>
              Token
              <input className={`${input} font-mono text-[13px]`} value={hToken} onChange={(e) => setHToken(e.target.value)} placeholder="0x… address or a stock ticker" spellCheck={false} required />
            </label>
          </div>
        ) : kind === 'deepcore' && launchKind ? (
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
              {holdersKind && <option value="holders">Holders: a cluster grows or sells</option>}
            </select>
          </label>
          {kind === 'holders' && (
            <label className={fieldLabel}>
              Watch
              <select className={select} value={hMetric} onChange={(e) => setHMetric(e.target.value as 'cluster' | 'top10' | 'deployer')}>
                <option value="cluster">Largest cluster</option>
                <option value="top10">Top 10 wallets</option>
                <option value="deployer">The deployer (launches)</option>
              </select>
            </label>
          )}
          {kind === 'gap' && (
            <label className={fieldLabel}>
              Percent
              <input className={input} type="number" min={0.1} max={100} step={0.1} value={pct} onChange={(e) => setPct(e.target.value)} required />
            </label>
          )}
        </div>
        {kind === 'gap' && <DirectionControl value={direction} onChange={setDirection} pct={pct} />}
        {kind === 'holders' && (
          <div className="grid grid-cols-3 gap-3 max-[640px]:grid-cols-1">
            <label className={fieldLabel}>
              <span>
                Reaches (% of supply) <span className="text-[12px] text-faint">optional</span>
              </span>
              <input className={input} type="number" min={1} max={100} step={0.1} value={hMetric === 'deployer' ? '' : hAbove} disabled={hMetric === 'deployer'} onChange={(e) => setHAbove(e.target.value)} />
            </label>
            <label className={fieldLabel}>
              <span>
                Sells (% of its holding) <span className="text-[12px] text-faint">optional</span>
              </span>
              <input className={input} type="number" min={1} max={100} step={1} value={hSell} onChange={(e) => setHSell(e.target.value)} />
            </label>
            <label className={fieldLabel}>
              <span>
                Falls from its high (points) <span className="text-[12px] text-faint">optional</span>
              </span>
              <input className={input} type="number" min={0.1} max={100} step={0.1} value={hDrop} onChange={(e) => setHDrop(e.target.value)} />
            </label>
          </div>
        )}
        <span className="-mt-2 text-[12px] leading-[1.5] text-faint">
          {kind === 'holders'
            ? holdersKind?.available === false
              ? 'Holder alerts come with the Pro plan.'
              : `Holder alert: the token's Holder Map is re-read every ${holdersKind?.everyMinutes ?? 10} minutes. "Sells" and "falls from its high" fire when the cluster or the deployer moves tokens out. Counts as one of your plan's alerts.`
            : kind === 'deepcore'
            ? `Once per new launch read from DeepCore's public API (checked every minute or two); launches within ${launchKind?.cooldownMinutes ?? 5} minutes of the last delivery go out together. Counts as one of your plan's alerts.`
            : kind === 'gap' ? <>Only pools deep enough to flag count; the gap is the on-chain price against fair.</> : <>Premium and discount are the tracker&apos;s own flags (a gap of {view.limits.flagPct}% or more in a pool deep enough to count).</>}
        </span>
        <label className={fieldLabel}>
          Webhook URL
          <input className={`${input} font-mono text-[13px]`} type="url" value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://example.com/hooks/gully" spellCheck={false} />
          <span className="text-[12px] text-faint">https only, on a public address. We POST signed JSON; the signing secret is shown once.</span>
        </label>
        {view.telegram.enabled && view.telegram.linked ? (
          <label className="flex min-h-11 items-center gap-3 text-[14px] text-ink-2">
            <input type="checkbox" className="size-4 accent-[#d9b563]" checked={toTelegram} onChange={(e) => setToTelegram(e.target.checked)} />
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
    <li className="flex flex-col gap-2 border-t border-line py-2 first:border-t-0 first:pt-0" style={rise(i)} data-alert={a.id}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex min-w-0 flex-[1_1_200px] flex-col">
          <b className="truncate text-[14px] font-semibold">{alertName(a)}</b>
          <span className="truncate font-mono text-[11px] text-faint" title={a.webhook ? `webhook ${a.webhook.url}` : undefined}>
            {alertRule(a)}
          </span>
        </span>
        <ChannelChips a={a} telegram={telegram} act={act} busy={busy} />
        <span className="font-mono text-[11px]" style={{ color: st.c }}>
          {st.t}
        </span>
        <span className="flex flex-wrap items-center gap-1">
          {canEdit && (
            <>
              <button type="button" className={rowBtn} disabled={!!busy} onClick={() => act(a, 'test')}>
                <Send size={13} aria-hidden /> {mine('test') ? 'Sending…' : 'Test'}
              </button>
              {a.mutedUntil && a.enabled ? (
                <button type="button" className={rowBtn} disabled={!!busy} onClick={() => act(a, 'resume')}>
                  <BellRing size={13} aria-hidden /> Unmute
                </button>
              ) : (
                <button type="button" className={rowBtn} disabled={!!busy} onClick={() => act(a, a.enabled ? 'pause' : 'resume')}>
                  {a.enabled ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />} {a.enabled ? 'Pause' : 'Resume'}
                </button>
              )}
              {a.webhook && (
                <button type="button" className={rowBtn} disabled={!!busy} onClick={() => act(a, 'rotate')} title="New webhook signing secret">
                  <RotateCw size={13} aria-hidden /> New secret
                </button>
              )}
              <button type="button" className={`${rowBtn} hover:!border-error hover:!text-error`} disabled={!!busy} onClick={() => act(a, 'delete')}>
                <Trash2 size={13} aria-hidden /> Delete
              </button>
            </>
          )}
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex min-h-9 relative after:absolute after:inset-x-0 after:-inset-y-[4px] items-center gap-1 rounded-full px-2 font-mono text-[11px] text-muted hover:text-ink max-[859px]:min-h-11">
            <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden /> Log ({a.deliveries.length})
          </button>
        </span>
      </div>
      {open && a.webhook && <span className="font-mono text-[11px] break-all text-faint">webhook {a.webhook.url}</span>}
      {open &&
        (!a.deliveries.length ? (
          <p className="m-0 text-[13px] text-faint">Nothing sent yet. Use Test to check your endpoint.</p>
        ) : (
          <div className="overflow-x-auto rounded-[10px] border border-line">
            <div className="bg-surface-deep px-3 py-2 font-mono text-[11px] tracking-[1px] text-faint">DELIVERY LOG · LAST {a.deliveries.length}</div>
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
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: d.ok ? '#74c27b' : '#ff8a7a' }} title={d.error ?? undefined}>
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
export function TelegramCard({ info, reload, compact = false, from = 'alerts' }: { info: TelegramInfo; reload: () => Promise<unknown>; compact?: boolean; /** Analytics: where the connect started. */ from?: string }) {
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
    track('telegram-connect', { from })
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
    <div className="flex flex-col gap-3 rounded-[12px] border p-3" style={{ background: chat ? '#162a22' : '#111923', borderColor: chat ? '#2f6b35' : live ? '#554c34' : '#1f2935' }}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full" style={{ background: info.enabled ? TG_BLUE : '#2a3542' }}>
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
          <ExtLink href={link.link} className={pillGold}>
            <ExternalLink size={15} aria-hidden /> Open {info.bot ? `@${info.bot}` : 'the bot'}
          </ExtLink>
          <ExtLink href={link.groupLink} className={pillLine}>
            <Users size={15} aria-hidden /> Add to a group
          </ExtLink>
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
          <p className="m-0 flex items-start gap-3 rounded-[10px] border border-gold-line bg-[rgba(217,181,99,.06)] px-4 py-3 text-[14px] leading-[1.55] text-ink-2">
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

type AlertsSub = 'list' | 'deliveries' | 'telegram'
const ALERTS_SUBS: readonly AlertsSub[] = ['list', 'deliveries', 'telegram']

/** Setup as a stepper: Connect Telegram (only when the server has a bot) → Create an alert → Send a test.
    Each tick is read from the alerts view: a linked chat, an alert, a test delivery in any alert's log. */
function AlertsSetup({ view, reload, onCreate, act, busy, full }: { view: AlertsView; reload: () => Promise<unknown>; onCreate: () => void; act: (a: GapAlert, op: string, body?: unknown) => void; busy: string | null; full: boolean }) {
  const tested = view.alerts.some((a) => a.deliveries.some((d) => d.test))
  const first = view.alerts.find((a) => a.coveredByPlan) ?? view.alerts[0] ?? null
  const steps = [
    ...(view.telegram.enabled ? [{ id: 'telegram', label: 'Connect Telegram', done: !!view.telegram.linked }] : []),
    { id: 'create', label: 'Create an alert', done: view.alerts.length > 0 },
    { id: 'test', label: 'Send a test', done: tested },
  ]
  return (
    <Stepper title="Set up alerts" steps={steps} testId="alerts-stepper">
      {(id) =>
        id === 'telegram' ? (
          <TelegramCard info={view.telegram} reload={reload} compact />
        ) : id === 'create' ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-[1_1_260px] text-[13px] text-muted">A webhook{view.telegram.enabled ? ' or Telegram message' : ''} when a stock&apos;s gap crosses your line, or a DeepCore token launches.</span>
            <Can cat="alerts" what="create alerts">
              <button type="button" disabled={full} onClick={onCreate} className={pillGold}>
                <Plus size={16} aria-hidden /> Create your first alert
              </button>
            </Can>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-[1_1_260px] text-[13px] text-muted">{first ? <>Send <b className="font-semibold text-ink">{alertName(first)}</b> a test delivery to check your endpoint{first.telegram ? ' and chat' : ''}.</> : 'Create an alert first.'}</span>
            {first && (
              <Can cat="alerts" what="test alerts">
                <button type="button" disabled={!!busy} onClick={() => act(first, 'test')} className={pillGold}>
                  <Send size={15} aria-hidden /> {busy === `${first.id}:test` ? 'Sending…' : 'Send a test'}
                </button>
              </Can>
            )}
          </div>
        )
      }
    </Stepper>
  )
}

/** Alerts in use, deliveries in the logs over 30 days, the share delivered, and the Telegram chat. */
function AlertsKpis({ view }: { view: AlertsView }) {
  const [now] = useState(() => Date.now())
  const since = now - 30 * 86_400_000
  const seen = new Set<string>()
  let sent = 0
  let ok = 0
  for (const a of view.alerts)
    for (const d of a.deliveries) {
      const k = `${d.id}:${d.channel}`
      if (d.test || seen.has(k) || Date.parse(d.at) < since) continue
      seen.add(k)
      sent++
      if (d.ok) ok++
    }
  const tg = view.telegram
  return (
    <KpiRow label="Alerts at a glance">
      <KpiTile i={0} label="Alerts in use" icon={<BellRing size={13} aria-hidden />} note={`of ${view.limits.max} on ${view.limits.planName}`}>
        <AnimatedNumber value={view.limits.used} countUp />
      </KpiTile>
      <KpiTile i={1} label="Fired · 30 days" icon={<Send size={13} aria-hidden />} note="from the delivery logs">
        <AnimatedNumber value={sent} countUp />
      </KpiTile>
      <KpiTile i={2} label="Delivered" icon={<Check size={13} aria-hidden />} note={sent ? `${ok} of ${sent} answered 2xx` : 'nothing sent yet'}>
        {sent ? <AnimatedNumber value={(ok / sent) * 100} suffix="%" countUp /> : <Unknown why="No deliveries in 30 days, so there is no rate yet" />}
      </KpiTile>
      <KpiTile i={3} label="Telegram" icon={<Send size={13} aria-hidden />} note={!tg.enabled ? 'no bot on this server' : tg.linked ? tg.linked.chatTitle : 'not connected'}>
        <span className={`text-[18px] ${tg.linked ? 'text-green' : 'text-faint'}`}>{!tg.enabled ? 'off' : tg.linked ? 'linked' : 'not linked'}</span>
      </KpiTile>
    </KpiRow>
  )
}

export function Alerts({ goBilling, creating, onCreateDone, prefill = null, prefillGap = null }: { goBilling: () => void; creating: boolean; onCreateDone: () => void; prefill?: string | null; prefillGap?: { pct: string; dir: GapDirection } | null }) {
  const { view, err, refreshErr, load } = useAlertsView()
  const { act, busy, secret, setSecret } = useAlertActions(load)
  const [opened, setOpen] = useState(false)
  const [sub, setSub] = useSubTab<AlertsSub>('alerts', ALERTS_SUBS, 'list')

  // "+ New alert" on the Overview lands here with the dialog open (once the plan's room is known).
  const full = !!view && view.limits.used >= view.limits.max
  const canCreate = useWrite('alerts', 'create alerts').ok
  const open = opened || (creating && !!view && !full && canCreate)
  const closeCreate = () => {
    setOpen(false)
    onCreateDone()
  }

  // Only a tab that has never loaded shows an error in place of its content; a failed refresh keeps the
  // last good view on screen with the retry chip.
  if (err && !view) return <ErrorLine onRetry={load}>Alerts could not be read: {err}</ErrorLine>
  if (!view)
    return (
      <div className="flex flex-col gap-2">
        <Skeleton h={90} />
        <Skeleton h={160} />
      </div>
    )

  const deliveries = view.alerts.reduce((t, a) => t + a.deliveries.length, 0)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <InfoTip className="flex-1" summary={`${view.limits.used} of ${view.limits.max} alerts on ${view.limits.planName} · checked every five minutes`}>
          An alert fires when its condition becomes true and re-arms once it is false again, at most one delivery per alert every {view.limits.cooldownMinutes} minutes. Alerts look only at stocks the tracker would flag: a readable feed and pool, a pool deep enough to count, and an open feed session. Webhook payloads and how to check the signature are in the{' '}
          <ExtLink href={`${DOCS_URL}/plans-alerts`} className="text-gold underline-offset-4 hover:underline">
            Plans &amp; alerts docs
          </ExtLink>
          .
        </InfoTip>
        <RefreshChip error={refreshErr} onRetry={load} />
        <Can cat="alerts" what="create alerts">
          <button type="button" disabled={full} onClick={() => setOpen(true)} title={full ? 'Your plan’s alerts are all in use' : undefined} className={pillLine}>
            <Plus size={16} aria-hidden /> New alert
          </button>
        </Can>
      </div>
      <AlertsSetup view={view} reload={load} onCreate={() => setOpen(true)} act={act} busy={busy} full={full} />
      <AlertsKpis view={view} />
      {full && (
        <p className="m-0 text-[13px] text-muted">
          Every alert your plan includes is in use.{' '}
          <button type="button" onClick={goBilling} className="min-h-9 relative after:absolute after:inset-x-0 after:-inset-y-[4px] text-gold underline-offset-4 hover:underline">
            See plans
          </button>{' '}
          for more, or delete one.
        </p>
      )}
      <SubTabs
        label="Alerts sections"
        idBase="alerts-sub"
        value={sub}
        onChange={setSub}
        items={[
          { id: 'list', label: 'Alerts', icon: <BellRing size={15} aria-hidden />, count: view.alerts.length },
          { id: 'deliveries', label: 'Deliveries', icon: <History size={15} aria-hidden />, count: deliveries },
          { id: 'telegram', label: 'Telegram', icon: <Send size={15} aria-hidden />, dot: view.telegram.enabled && !view.telegram.linked },
        ]}
      />
      <SubPanel idBase="alerts-sub" value={sub}>
        {sub === 'list' && (
          <section className={`${panel} gap-2 p-3`} aria-labelledby="alerts-title">
            <h2 id="alerts-title" className="sr-only">
              Gap alerts
            </h2>
            {!view.alerts.length ? (
              <GhostCurves height={150} title="Your alerts will list here" colors={['#d9b563', '#74c27b']}>
                <BellRing size={20} className="text-gold" aria-hidden />
                <span className="max-w-[440px] text-[13px] text-muted">Get a webhook{view.telegram.enabled ? ' or a Telegram message' : ''} when a stock token&apos;s gap to its fair price crosses your line.</span>
              </GhostCurves>
            ) : (
              <ul className="m-0 flex list-none flex-col p-0">
                {view.alerts.map((a, i) => (
                  <AlertRow key={a.id} a={a} i={i} act={act} busy={busy} telegram={view.telegram} />
                ))}
              </ul>
            )}
          </section>
        )}
        {sub === 'deliveries' && (
          <section className={`${panel} gap-2 p-3`} aria-labelledby="fired-title" data-testid="alert-timeline">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 id="fired-title" className={panelTitle}>
                Fired alerts
              </h2>
              <span className={mono}>deliveries a day over 30 days · green delivered, red failed, hollow test</span>
            </div>
            <AlertFires alerts={view.alerts} nameOf={alertName} />
          </section>
        )}
        {sub === 'telegram' && (
          <section className={`${panel} gap-2 p-3`} aria-label="Telegram">
            <TelegramCard info={view.telegram} reload={load} />
          </section>
        )}
      </SubPanel>

      <CreateDialog
        key={prefill ?? 'any'}
        initialTarget={prefill}
        initialGap={prefillGap}
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
