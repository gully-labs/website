import { AlertTriangle, BellOff, BellRing, Check, ChevronDown, ExternalLink, Link2Off, Pause, Play, Plus, RotateCw, Send, Trash2, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { btnGold, btnOutline } from '../../components/ui'
import { DOCS_URL } from '../../site-host'
import { ago, api, conditionText, type AlertsView, type GapAlert, type TelegramInfo, type TelegramLink } from './api'
import { CopyButton, Dialog } from './Dialog'
import { Empty, ErrorLine, Skeleton } from './parts'
import { card, cardTitle, iconBtn, input, rise, sub } from './styles'

/* Gap alerts: create, test, pause and delete alerts, and read each one's delivery log. Limits come
   from the plan (server); Telegram appears only when the server has a bot configured, and delivers to
   the chat linked with Connect Telegram (a one-time t.me link; no chat ids to paste). */

const select = `${input} pr-8`
const label = 'flex flex-col gap-2 text-[14px] text-ink-2'
const CHAIN_NAMES: Record<string, string> = { robinhood: 'Robinhood Chain', bsc: 'BNB Chain' }

type Secret = { title: string; secret: string } | null

function statusTone(ok: boolean) {
  return ok ? 'border-success-line text-green' : 'border-[#5a2a24] text-error'
}

function CreateDialog({ open, onClose, view, onCreated }: { open: boolean; onClose: () => void; view: AlertsView; onCreated: (secret: string | null) => void }) {
  const [name, setName] = useState('')
  const [target, setTarget] = useState('any')
  const [kind, setKind] = useState<'gap' | 'premium' | 'discount' | 'either'>('gap')
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
    const [chain, ticker] = target === 'any' ? [undefined, undefined] : target.split(':')
    const condition = kind === 'gap' ? { type: 'gap', pct: Number(pct) } : { type: 'status', status: kind }
    setBusy(true)
    const r = await api<{ secret: string | null }>('/api/developer/alerts', { method: 'POST', body: { name: name.trim(), chain, ticker, condition, webhookUrl: webhook.trim() || undefined, telegram: toTelegram || undefined } })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    setName('')
    setWebhook('')
    setToTelegram(false)
    onCreated(r.data.secret)
  }

  return (
    <Dialog open={open} onClose={onClose} title="New gap alert">
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <label className={label}>
          Name <span className="text-[12px] text-faint">optional</span>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. NVDA wide gap" />
        </label>
        <label className={label}>
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
        <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3 max-[480px]:grid-cols-1">
          <label className={label}>
            When
            <select className={select} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="gap">The gap is at least…</option>
              <option value="premium">It turns premium</option>
              <option value="discount">It turns discount</option>
              <option value="either">It turns premium or discount</option>
            </select>
          </label>
          {kind === 'gap' && (
            <label className={label}>
              Percent
              <input className={input} type="number" min={0.1} max={100} step={0.1} value={pct} onChange={(e) => setPct(e.target.value)} required />
            </label>
          )}
        </div>
        <span className="-mt-2 text-[12px] leading-[1.5] text-faint">
          Either way, above or below fair. Premium and discount are the tracker&apos;s own flags (a gap of {view.limits.flagPct}% or more in a pool deep enough to count).
        </span>
        <label className={label}>
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
          <p className="m-0 text-[12px] text-faint">To get alerts in Telegram, close this and press Connect Telegram first.</p>
        ) : (
          <p className="m-0 text-[12px] text-faint">Telegram delivery is not configured on this server; webhooks work.</p>
        )}
        {err && <ErrorLine>{err}</ErrorLine>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={`${btnOutline} min-h-11 px-5 text-[15px]`}>
            Cancel
          </button>
          <button type="submit" disabled={busy || (!webhook.trim() && !toTelegram)} className={`${btnGold} min-h-11 px-5 text-[15px] disabled:opacity-50`}>
            {busy ? 'Creating…' : 'Create alert'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function AlertRow({ a, i, act, busy, telegram }: { a: GapAlert; i: number; act: (a: GapAlert, op: string, body?: unknown) => void; busy: string | null; telegram: TelegramInfo }) {
  const [open, setOpen] = useState(false)
  const state = !a.coveredByPlan ? { t: 'Not in your plan', c: 'text-error' } : !a.enabled ? { t: 'Paused', c: 'text-faint' } : a.mutedUntil ? { t: `Muted from Telegram until ${new Date(a.mutedUntil).toLocaleString()}`, c: 'text-faint' } : a.waitingToReArm.length ? { t: 'Fired · waits to re-arm', c: 'text-gold' } : { t: 'Watching', c: 'text-green' }
  const mine = (op: string) => busy === `${a.id}:${op}`
  return (
    <li className="flex flex-col gap-3 rounded-input border border-line bg-surface-deep p-4" style={rise(i)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
            {a.name || (a.ticker ? `${a.ticker} alert` : 'Any-stock alert')}
            <span className={`font-mono text-[11px] ${state.c}`}>{state.t}</span>
          </span>
          <span className="text-[14px] text-muted">
            {a.ticker ? `${a.ticker} on ${CHAIN_NAMES[a.chain ?? ''] ?? a.chain}` : 'Any stock'} · {conditionText(a.condition)}
          </span>
          <span className="font-mono text-[11.5px] break-all text-faint">
            {a.webhook && <>webhook {a.webhook.url}</>}
            {a.webhook && a.telegram && ' · '}
            {a.telegram && (a.telegram.linked ? <>Telegram {a.telegram.chatTitle ?? 'chat'}</> : <span className="text-error">Telegram: no chat linked</span>)}
            {' · '}last fired {ago(a.lastFiredAt)}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={iconBtn} disabled={!!busy} onClick={() => act(a, 'test')}>
            <Send size={14} aria-hidden /> {mine('test') ? 'Sending…' : 'Test'}
          </button>
          {a.mutedUntil && a.enabled ? (
            <button type="button" className={iconBtn} disabled={!!busy} onClick={() => act(a, 'resume')}>
              <BellRing size={14} aria-hidden /> Unmute
            </button>
          ) : (
            <button type="button" className={iconBtn} disabled={!!busy} onClick={() => act(a, a.enabled ? 'pause' : 'resume')}>
              {a.enabled ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />} {a.enabled ? 'Pause' : 'Resume'}
            </button>
          )}
          {telegram.enabled && telegram.linked && !a.telegram && (
            <button type="button" className={iconBtn} disabled={!!busy} onClick={() => act(a, 'telegram', { on: true })}>
              <Send size={14} aria-hidden /> Add Telegram
            </button>
          )}
          {a.telegram && a.webhook && (
            <button type="button" className={iconBtn} disabled={!!busy} onClick={() => act(a, 'telegram', { on: false })}>
              <BellOff size={14} aria-hidden /> Stop Telegram
            </button>
          )}
          {a.webhook && (
            <button type="button" className={iconBtn} disabled={!!busy} onClick={() => act(a, 'rotate')}>
              <RotateCw size={14} aria-hidden /> New secret
            </button>
          )}
          <button type="button" className={`${iconBtn} hover:!border-error hover:!text-error`} disabled={!!busy} onClick={() => act(a, 'delete')}>
            <Trash2 size={14} aria-hidden /> Delete
          </button>
        </div>
      </div>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-2 self-start font-mono text-[12px] text-muted hover:text-ink">
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden /> Deliveries ({a.deliveries.length})
      </button>
      {open &&
        (!a.deliveries.length ? (
          <p className="m-0 text-[13px] text-faint">Nothing sent yet. Use Test to check your endpoint.</p>
        ) : (
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[10.5px] tracking-[1px] text-faint">
                  <th className="py-2 pr-3 font-medium">TIME</th>
                  <th className="py-2 pr-3 font-medium">KIND</th>
                  <th className="py-2 pr-3 font-medium">CHANNEL</th>
                  <th className="py-2 pr-3 font-medium">RESULT</th>
                  <th className="py-2 text-right font-medium">LATENCY</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {a.deliveries.map((d, k) => (
                  <tr key={`${d.id}-${d.channel}-${k}`} className="border-b border-line last:border-b-0">
                    <td className="py-2 pr-3 whitespace-nowrap text-muted" title={new Date(d.at).toLocaleString()}>
                      {ago(d.at)}
                    </td>
                    <td className="py-2 pr-3 text-ink-2">{d.test ? 'test' : d.events.map((e) => e.split(':')[1]).join(', ')}</td>
                    <td className="py-2 pr-3 text-muted">{d.channel}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded-full border px-2 py-[1px] text-[11px] ${statusTone(d.ok)}`} title={d.error ?? undefined}>
                        {d.status ?? 'no answer'}
                      </span>
                      {d.error && <span className="ml-2 text-faint">{d.error}</span>}
                    </td>
                    <td className="py-2 text-right text-muted">{d.ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </li>
  )
}

/* Telegram: not configured / connect (one-time deep link) / connected (chat name, unlink). */
function TelegramCard({ info, reload }: { info: TelegramInfo; reload: () => Promise<unknown> }) {
  const [link, setLink] = useState<TelegramLink | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const live = !!link && !info.linked && Date.parse(link.expiresAt) > now

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
    reload()
  }

  return (
    <section className={card} style={rise(0)} aria-labelledby="tg-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-[6px]">
          <h2 id="tg-title" className={`${cardTitle} flex items-center gap-3`}>
            <Send size={20} className="text-gold" aria-hidden /> Telegram
          </h2>
          <span className={sub}>
            {!info.enabled ? 'not configured on this server' : info.linked ? 'connected' : 'not connected'}
            {info.enabled && info.bot ? ` · @${info.bot}` : ''}
          </span>
        </div>
        {info.enabled && !info.linked && (
          <button type="button" onClick={connect} disabled={busy} className={`${link ? btnOutline : btnGold} inline-flex min-h-11 items-center gap-2 px-5 text-[15px] disabled:opacity-50`}>
            <Send size={16} aria-hidden /> {busy ? 'Making a link…' : link ? 'New link' : 'Connect Telegram'}
          </button>
        )}
        {info.linked && (
          <button type="button" onClick={unlink} disabled={busy} className={`${iconBtn} hover:!border-error hover:!text-error`}>
            <Link2Off size={14} aria-hidden /> Unlink
          </button>
        )}
      </div>

      {!info.enabled && (
        <p className="m-0 text-[14px] leading-[1.6] text-muted">
          Telegram delivery is not available here: no bot is configured on this server. Webhook alerts work; Telegram appears in this tab once the bot is set up.
        </p>
      )}

      {info.enabled && info.linked && (
        <div className="flex flex-col gap-2 rounded-input border border-success-line bg-surface-deep px-4 py-3">
          <span className="flex flex-wrap items-center gap-2 text-[15px] text-ink">
            <Check size={16} className="text-green" aria-hidden /> {info.linked.chatTitle}
            <span className="font-mono text-[11px] text-faint">
              {info.linked.chatType === 'private' ? 'private chat' : 'group'} · linked {ago(info.linked.linkedAt)}
            </span>
          </span>
          <span className="text-[13px] leading-[1.55] text-muted">
            Tick Telegram on an alert to have it sent here, with Open and Mute 24h buttons. In the chat, /alerts lists your alerts, /gap NVDA and /top read the tracker, and /stop unlinks.
          </span>
        </div>
      )}

      {info.enabled && !info.linked && !link && (
        <p className="m-0 text-[14px] leading-[1.6] text-muted">
          Get alerts in a Telegram chat. Connect opens the bot with a one-time code that links the chat to this wallet: no chat id to copy. The bot also answers /gap NVDA and /top for anyone.
        </p>
      )}

      {info.enabled && !info.linked && link && (
        <div className="flex flex-col gap-3 rounded-input border border-gold-line bg-[rgba(232,192,96,.06)] px-4 py-4">
          {live ? (
            <>
              <span className="text-[14px] leading-[1.55] text-ink-2">Open the bot and press Start. The link works once, for ten minutes; this card updates when the chat is linked.</span>
              <div className="flex flex-wrap gap-2">
                <a href={link.link} target="_blank" rel="noopener noreferrer" className={`${btnGold} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
                  <ExternalLink size={16} aria-hidden /> Open {info.bot ? `@${info.bot}` : 'the bot'}
                </a>
                <a href={link.groupLink} target="_blank" rel="noopener noreferrer" className={`${btnOutline} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
                  <Users size={16} aria-hidden /> Add to a group
                </a>
              </div>
              <span className="font-mono text-[11.5px] text-faint">Expires {new Date(link.expiresAt).toLocaleTimeString()}. In a group, only the person who links it can unlink it.</span>
            </>
          ) : (
            <span className="text-[14px] text-muted">That link has expired. Press New link for another.</span>
          )}
        </div>
      )}
      {err && <ErrorLine>{err}</ErrorLine>}
    </section>
  )
}

export function Alerts({ goBilling }: { goBilling: () => void }) {
  const [view, setView] = useState<AlertsView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [secret, setSecret] = useState<Secret>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actErr, setActErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(
    () =>
      api<AlertsView>('/api/developer/alerts').then((r) => {
        if (r.ok) {
          setView(r.data)
          setErr(null)
        } else setErr(r.error)
      }),
    [],
  )
  useEffect(() => {
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load])

  const act = async (a: GapAlert, op: string, body?: unknown) => {
    if (op === 'delete' && !window.confirm(`Delete ${a.name || 'this alert'}? Its delivery log goes with it.`)) return
    setBusy(`${a.id}:${op}`)
    setActErr(null)
    setNote(null)
    const r = await api<{ secret?: string; results?: { channel: string; ok: boolean; status: number | null; error: string | null }[] }>(`/api/developer/alerts/${a.id}/${op}`, { method: 'POST', body })
    setBusy(null)
    if (!r.ok) return setActErr(r.error)
    if (op === 'rotate' && r.data.secret) setSecret({ title: 'New signing secret', secret: r.data.secret })
    if (op === 'test' && r.data.results) setNote(r.data.results.map((x) => `${x.channel}: ${x.ok ? `delivered (${x.status})` : `failed (${x.error ?? x.status})`}`).join(' · '))
    load()
  }

  if (err) return <ErrorLine onRetry={load}>Alerts could not be read: {err}</ErrorLine>
  if (!view)
    return (
      <div className="flex flex-col gap-3">
        <Skeleton h={120} />
        <Skeleton h={80} />
      </div>
    )

  const full = view.limits.used >= view.limits.max
  return (
    <div className="flex flex-col gap-5">
      <TelegramCard info={view.telegram} reload={load} />
      <section className={card} style={rise(0)}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-[6px]">
            <h2 className={cardTitle}>Gap alerts</h2>
            <span className={sub}>
              {view.limits.used} of {view.limits.max} on {view.limits.planName} · checked every five minutes · at most one delivery per alert every {view.limits.cooldownMinutes} minutes
            </span>
          </div>
          <button type="button" disabled={full} onClick={() => setCreating(true)} title={full ? 'Your plan’s alerts are all in use' : undefined} className={`${btnGold} inline-flex min-h-11 items-center gap-2 px-5 text-[15px] disabled:cursor-not-allowed disabled:opacity-50`}>
            <Plus size={16} aria-hidden /> New alert
          </button>
        </div>
        {full && (
          <p className="m-0 text-[14px] text-muted">
            Every alert your plan includes is in use.{' '}
            <button type="button" onClick={goBilling} className="text-gold underline-offset-4 hover:underline">
              See plans
            </button>{' '}
            for more, or delete one.
          </p>
        )}
        {actErr && <ErrorLine>{actErr}</ErrorLine>}
        {note && (
          <p className="m-0 font-mono text-[12px] text-ink-2" role="status">
            Test: {note}
          </p>
        )}
        {!view.alerts.length ? (
          <Empty icon={<BellRing size={26} className="text-gold" aria-hidden />} title="No alerts yet">
            Get a webhook{view.telegram.enabled ? ' or a Telegram message' : ''} when a stock token&apos;s gap to its fair price crosses your line. An alert fires when its condition becomes true and re-arms once it is false again.
          </Empty>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {view.alerts.map((a, i) => (
              <AlertRow key={a.id} a={a} i={i} act={act} busy={busy} telegram={view.telegram} />
            ))}
          </ul>
        )}
        <p className="m-0 border-t border-line pt-4 text-[13px] leading-[1.6] text-faint">
          Alerts look only at stocks the tracker would flag: a readable feed and pool, a pool deep enough to count, and an open feed session. Webhook payloads and how to check the signature:{' '}
          <a href={`${DOCS_URL}/plans-alerts`} className="text-ink-2 underline-offset-4 hover:underline">
            Plans &amp; alerts docs
          </a>
          .
        </p>
      </section>

      <CreateDialog
        open={creating}
        onClose={() => setCreating(false)}
        view={view}
        onCreated={(s) => {
          setCreating(false)
          if (s) setSecret({ title: 'Your signing secret', secret: s })
          load()
        }}
      />

      <Dialog open={!!secret} onClose={() => setSecret(null)} title={secret?.title ?? ''} dismissable={false}>
        {secret ? (
          <div className="flex flex-col gap-4">
            <p className="m-0 flex items-start gap-3 rounded-input border border-gold-line bg-[rgba(232,192,96,.06)] px-4 py-3 text-[14px] leading-[1.55] text-ink-2">
              <AlertTriangle size={18} className="mt-[2px] shrink-0 text-gold" aria-hidden />
              Copy it now; it is not shown again. Check the X-Gully-Signature header of every delivery with it. Lost it? Make a new one.
            </p>
            <div className="flex items-center gap-2 rounded-input border border-gold-line bg-bg py-1 pr-1 pl-3">
              <code className="min-w-0 flex-1 font-mono text-[13px] break-all text-gold">{secret.secret}</code>
              <CopyButton text={secret.secret} />
            </div>
            <div className="flex justify-end">
              <button type="button" data-autofocus onClick={() => setSecret(null)} className={`${btnGold} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
                <Check size={16} aria-hidden /> I have saved it
              </button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  )
}
