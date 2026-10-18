import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { byChain } from '../../components/pay/assets'
import type { PayAsset } from '../developers/api'
import { siteOrigin } from '../pay/api'
import { embedSnippet } from '../pay/embed'
import type { Invoice } from '../pay/invoice'
import { adminCall } from './payAdmin'
import { copyWithToast, flash } from '../../components/ui/toast'
import { ArrowMark } from './newTab'

/* Admin: Gully Pay links (reusable /pay/l/<id> pages that make an invoice per payer), their payments,
   the "Pay with crypto" embed, and merchant webhooks (per link, per invoice, and a global default) with
   their delivery logs. Everything is /api/admin/paylinks and /api/admin/pay-webhooks behind ADMIN_TOKEN.
   A webhook's signing secret is shown once, when it is set or rotated. */

export interface Endpoint {
  url: string
  createdAt: string | null
  rotatedAt: string | null
}

export interface Delivery {
  id: string
  eventId: string
  type: string
  test: boolean
  target: 'link' | 'invoice' | 'default'
  url: string
  invoiceId: string | null
  state: 'pending' | 'delivered' | 'failed'
  attempts: number
  maxAttempts: number
  last: { at: string; status: number | null; ok: boolean; error: string | null; ms: number } | null
  nextAt: string | null
  createdAt: string
  redeliveryOf: string | null
}

interface AdminLink {
  id: string
  title: string
  description: string | null
  amount: { type: 'fixed'; usd: string; usdCents: string } | { type: 'open'; min: string; max: string; minCents: string; maxCents: string }
  assets: PayAsset[]
  state: 'active' | 'inactive' | 'expired' | 'used-up'
  active: boolean
  expiresAt: string | null
  maxUses: number | null
  paidUses: number
  lastPaidAt: string | null
  webhook: Endpoint | null
  createdAt: string
  updatedAt: string
  path: string
  stats: { invoices: number; paid: number; open: number; paidUsd: string }
}

type AdminInvoice = Invoice & { path: string; webhook: Endpoint | null }

const card = 'flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-6 max-[600px]:p-4'
const h2 = 'm-0 font-display text-[22px] font-bold uppercase'
const small = 'font-mono text-[12px] text-faint'
const field = 'h-10 rounded-input border border-line-strong bg-bg px-3 text-[14px] text-ink outline-none focus:border-gold'
export const btn = 'inline-flex min-h-11 items-center rounded-btn border border-line-strong px-3 text-[13px] text-ink-2 hover:border-gold disabled:opacity-50'
const gold = 'h-10 rounded-btn bg-gold px-4 text-[14px] font-semibold text-bg hover:bg-gold-hover disabled:opacity-50'
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—')
const STATE_CLS: Record<string, string> = { active: 'text-green', inactive: 'text-faint', expired: 'text-faint', 'used-up': 'text-gold', open: 'text-gold', paid: 'text-green', cancelled: 'text-faint', pending: 'text-gold', delivered: 'text-green', failed: 'text-error' }

/** A secret shown once, with a copy button. */
export function SecretOnce({ secret, onDone }: { secret: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-2 rounded-input border border-gold-line bg-[rgba(217,181,99,.06)] p-3" role="alert">
      <span className="text-[13px] text-ink-2">Webhook signing secret. It is shown this once: store it with the receiving app now.</span>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 rounded-input border border-line bg-bg px-3 py-2 font-mono text-[13px] break-all text-gold">{secret}</code>
        <button type="button" className={btn} onClick={() => copyWithToast(secret, 'Signing secret').then((ok) => ok && setCopied(true))}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className={btn} onClick={onDone}>
          I saved it
        </button>
      </div>
    </div>
  )
}

/** The embed snippet for a link or an invoice, with copy. */
export function EmbedBox({ path }: { path: string }) {
  const code = embedSnippet(siteOrigin(), path)
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] text-faint">Paste on any site. The link opens the checkout in a new tab; with the script it opens in a popup. The checkout cannot be framed.</span>
      <pre className="m-0 max-h-40 overflow-auto rounded-input border border-line bg-bg p-3 font-mono text-[12px] whitespace-pre-wrap break-all text-ink-2">{code}</pre>
      <div>
        <button type="button" className={btn} onClick={() => copyWithToast(code, 'Snippet').then((ok) => ok && setCopied(true))}>
          {copied ? 'Copied' : 'Copy snippet'}
        </button>
      </div>
    </div>
  )
}

/** Sends a finished delivery's event again (same event id, a new attempt series) and says how it went. */
async function redeliverOne(token: string, d: Delivery): Promise<boolean> {
  const r = await adminCall<{ delivery: Delivery }>(token, `/api/admin/pay-webhooks/deliveries/${d.id}/redeliver`, {})
  if (!r.ok) {
    flash({ ok: false, text: r.error })
    return false
  }
  const n = r.data.delivery
  flash(n.state === 'delivered' ? { ok: true, text: `${d.type} redelivered (${n.last?.status}, ${n.last?.ms} ms), event ${d.eventId}.` } : { ok: false, text: `Redelivery failed: ${n.last?.error ?? n.last?.status}. It retries on the usual schedule.` })
  return true
}

/** A delivery log table. With a token, finished deliveries (not test events) get a Redeliver button. */
export function DeliveryLog({ rows, token, onChange }: { rows: Delivery[]; token?: string; onChange?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  if (!rows.length) return <p className="m-0 text-[13px] text-muted">No deliveries yet.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
            <th className="py-2 pr-3 font-medium">EVENT</th>
            <th className="py-2 pr-3 font-medium">STATE</th>
            <th className="py-2 pr-3 font-medium">TRIES</th>
            <th className="py-2 pr-3 font-medium">LAST ANSWER</th>
            <th className="py-2 pr-3 font-medium">TO</th>
            <th className="py-2 pr-3 font-medium">WHEN</th>
            {token && <th className="py-2 font-medium"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id} className="border-b border-line font-mono last:border-b-0">
              <td className="py-2 pr-3 text-ink-2" title={`event ${d.eventId}`}>
                {d.type}
                {d.redeliveryOf ? <span className="block text-[11px] text-faint">redelivery · same event</span> : null}
              </td>
              <td className={`py-2 pr-3 uppercase ${STATE_CLS[d.state]}`}>
                {d.state}
                {d.state === 'pending' && d.nextAt ? <span className="text-faint normal-case"> · next {when(d.nextAt)}</span> : null}
              </td>
              <td className="py-2 pr-3 text-faint">
                {d.attempts}/{d.maxAttempts}
              </td>
              <td className="max-w-[260px] truncate py-2 pr-3 text-faint" title={d.last?.error ?? ''}>
                {d.last ? (d.last.ok ? `${d.last.status} · ${d.last.ms} ms` : (d.last.error ?? String(d.last.status))) : '—'}
              </td>
              <td className="max-w-[220px] truncate py-2 pr-3 text-faint" title={d.url}>
                {d.target} · {d.url}
              </td>
              <td className="py-2 pr-3 whitespace-nowrap text-faint">{when(d.createdAt)}</td>
              {token && (
                <td className="py-1 text-right">
                  {!d.test && d.state !== 'pending' && (
                    <button
                      type="button"
                      className={`${btn} min-h-8 px-2 text-[12px] ${d.state === 'failed' ? 'border-gold-line text-gold' : ''}`}
                      disabled={busy !== null}
                      title={`Send event ${d.eventId} again as a new delivery`}
                      onClick={async () => {
                        setBusy(d.id)
                        await redeliverOne(token, d)
                        setBusy(null)
                        onChange?.()
                      }}
                    >
                      {busy === d.id ? 'Sending…' : 'Redeliver'}
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------ the form --- */

interface Draft {
  title: string
  description: string
  type: 'fixed' | 'open'
  usd: string
  min: string
  max: string
  assets: string[]
  expiresAt: string
  maxUses: string
  webhookUrl: string
}

const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function draftOf(l: AdminLink | null, assets: PayAsset[]): Draft {
  if (!l) return { title: '', description: '', type: 'fixed', usd: '', min: '', max: '', assets: assets.map((a) => a.id), expiresAt: '', maxUses: '', webhookUrl: '' }
  return {
    title: l.title,
    description: l.description ?? '',
    type: l.amount.type,
    usd: l.amount.type === 'fixed' ? l.amount.usd.replace(/,/g, '') : '',
    min: l.amount.type === 'open' ? l.amount.min.replace(/,/g, '') : '',
    max: l.amount.type === 'open' ? l.amount.max.replace(/,/g, '') : '',
    assets: l.assets.map((a) => a.id),
    expiresAt: toLocalInput(l.expiresAt),
    maxUses: l.maxUses == null ? '' : String(l.maxUses),
    webhookUrl: l.webhook?.url ?? '',
  }
}

function bodyOf(d: Draft) {
  return {
    title: d.title,
    description: d.description,
    amount: d.type === 'fixed' ? { type: 'fixed', usd: d.usd.trim() } : { type: 'open', min: d.min.trim(), max: d.max.trim() },
    assets: d.assets,
    expiresAt: d.expiresAt ? new Date(d.expiresAt).toISOString() : null,
    maxUses: d.maxUses.trim() ? Number(d.maxUses) : null,
    webhookUrl: d.webhookUrl.trim() || null,
  }
}

function Label({ text, children, className = '' }: { text: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-[12px] text-faint ${className}`}>
      {text}
      {children}
    </label>
  )
}

function LinkForm({ initial, assets, submitLabel, onSubmit, onCancel }: { initial: Draft; assets: PayAsset[]; submitLabel: string; onSubmit: (d: Draft) => Promise<string | null>; onCancel?: () => void }) {
  const [d, setD] = useState(initial)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof Draft, v: string | string[]) => setD((x) => ({ ...x, [k]: v }))
  const toggle = (id: string) => set('assets', d.assets.includes(id) ? d.assets.filter((x) => x !== id) : [...d.assets, id])
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setErr(await onSubmit(d))
        setBusy(false)
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <Label text="Title (shown to the payer)" className="min-w-[min(100%,320px)] flex-[2]">
          <input className={field} value={d.title} onChange={(e) => set('title', e.target.value)} maxLength={120} required placeholder="Chain Kit setup" />
        </Label>
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0 text-[12px] text-faint">
          <legend className="mb-1">Amount</legend>
          <div className="flex h-10 overflow-hidden rounded-input border border-line-strong">
            {(['fixed', 'open'] as const).map((t) => (
              <button key={t} type="button" aria-pressed={d.type === t} onClick={() => set('type', t)} className={`px-3 text-[13px] ${d.type === t ? 'bg-gold text-bg' : 'text-ink-2 hover:text-ink'}`}>
                {t === 'fixed' ? 'Fixed' : 'Payer chooses'}
              </button>
            ))}
          </div>
        </fieldset>
        {d.type === 'fixed' ? (
          <Label text="USD" className="w-[130px]">
            <input className={`${field} font-mono`} value={d.usd} onChange={(e) => set('usd', e.target.value)} required inputMode="decimal" pattern="[0-9]{1,9}([.][0-9]{1,2})?" placeholder="1500" />
          </Label>
        ) : (
          <>
            <Label text="Min USD" className="w-[110px]">
              <input className={`${field} font-mono`} value={d.min} onChange={(e) => set('min', e.target.value)} required inputMode="decimal" pattern="[0-9]{1,9}([.][0-9]{1,2})?" placeholder="5" />
            </Label>
            <Label text="Max USD" className="w-[110px]">
              <input className={`${field} font-mono`} value={d.max} onChange={(e) => set('max', e.target.value)} required inputMode="decimal" pattern="[0-9]{1,9}([.][0-9]{1,2})?" placeholder="500" />
            </Label>
          </>
        )}
      </div>
      <Label text="Description (optional; shown on the link, the checkout and the receipt)">
        <textarea className={`${field} h-auto min-h-[56px] py-2`} value={d.description} onChange={(e) => set('description', e.target.value)} maxLength={1000} />
      </Label>
      <div className="flex flex-wrap items-end gap-2">
        <Label text="Expires (optional)" className="w-[220px]">
          <input className={`${field} font-mono`} type="datetime-local" value={d.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} />
        </Label>
        <Label text="Max paid uses (optional)" className="w-[160px]">
          <input className={`${field} font-mono`} type="number" min={1} max={1000000} value={d.maxUses} onChange={(e) => set('maxUses', e.target.value)} placeholder="no limit" />
        </Label>
        <Label text="Webhook URL (optional, https)" className="min-w-[min(100%,300px)] flex-1">
          <input className={`${field} font-mono`} type="url" value={d.webhookUrl} onChange={(e) => set('webhookUrl', e.target.value)} placeholder="https://example.com/hooks/gully" />
        </Label>
      </div>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-[12px] text-faint">Accepted assets</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {byChain(assets).map((g) => (
            <div key={g.chainId} className="flex flex-wrap items-center gap-2 font-mono text-[12px]">
              <span className="text-muted">{g.chain}</span>
              {g.assets.map((a) => (
                <label key={a.id} className={`inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-btn border px-2 ${d.assets.includes(a.id) ? 'border-gold text-gold' : 'border-line-strong text-ink-2'}`}>
                  <input type="checkbox" className="accent-gold" checked={d.assets.includes(a.id)} onChange={() => toggle(a.id)} />
                  {a.symbol}
                </label>
              ))}
            </div>
          ))}
        </div>
      </fieldset>
      {err && <p className="m-0 font-mono text-[12px] text-error">{err}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !d.assets.length} className={gold}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className={btn} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}

/* ---------------------------------------------------------- one link --- */

function LinkDetail({ token, link, reload, onSecret }: { token: string; link: AdminLink; reload: () => void; onSecret: (s: string) => void }) {
  const [data, setData] = useState<{ invoices: AdminInvoice[]; deliveries: Delivery[] } | null>(null)
  const setMsg = flash
  const load = useCallback(() => {
    adminCall<{ invoices: AdminInvoice[]; deliveries: Delivery[] }>(token, `/api/admin/paylinks/${link.id}`).then((r) => r.ok && setData(r.data))
  }, [token, link.id])
  useEffect(() => {
    load()
  }, [load, link.updatedAt, link.paidUses])
  const run = async (path: string, done: string) => {
    const r = await adminCall<{ secret?: string; delivery?: Delivery }>(token, path, {})
    if (!r.ok) return setMsg({ ok: false, text: r.error })
    if (r.data.secret) onSecret(r.data.secret)
    if (r.data.delivery) setMsg({ ok: r.data.delivery.state === 'delivered', text: r.data.delivery.state === 'delivered' ? `Webhook test delivered (${r.data.delivery.last?.status}, ${r.data.delivery.last?.ms} ms).` : `Webhook test failed: ${r.data.delivery.last?.error ?? r.data.delivery.last?.status}` })
    else setMsg({ ok: true, text: done })
    load()
    reload()
  }
  return (
    <div className="flex flex-col gap-4 rounded-input border border-line bg-bg p-4">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[11px] tracking-[1px] text-faint">EMBED</span>
        <EmbedBox path={link.path} />
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[11px] tracking-[1px] text-faint">WEBHOOK</span>
        {link.webhook ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 font-mono text-[12px] break-all text-ink-2">{link.webhook.url}</code>
            <span className={small}>{link.webhook.rotatedAt ? `secret rotated ${when(link.webhook.rotatedAt)}` : `set ${when(link.webhook.createdAt)}`}</span>
            <button type="button" className={btn} onClick={() => run(`/api/admin/paylinks/${link.id}/test`, 'Test sent.')}>
              Send test event
            </button>
            <button type="button" className={btn} onClick={() => window.confirm('Rotate the signing secret? The old one stops working at once.') && run(`/api/admin/paylinks/${link.id}/rotate`, 'Secret rotated.')}>
              Rotate secret
            </button>
          </div>
        ) : (
          <span className="text-[13px] text-muted">No webhook on this link{' '}(events go to the default endpoint, if one is set). Add one with Edit.</span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[11px] tracking-[1px] text-faint">PAYMENTS · {link.stats.paid} paid of {link.stats.invoices} checkouts</span>
        {!data ? (
          <span className={small}>Loading…</span>
        ) : !data.invoices.length ? (
          <p className="m-0 text-[13px] text-muted">No checkout started yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <tbody>
                {data.invoices.slice(0, 50).map((i) => (
                  <tr key={i.id} className="border-b border-line font-mono last:border-b-0">
                    <td className="py-2 pr-3 text-faint">{i.number}</td>
                    <td className="py-2 pr-3">{i.usd} USD</td>
                    <td className={`py-2 pr-3 uppercase ${STATE_CLS[i.status]}`}>{i.status}</td>
                    <td className="py-2 pr-3">
                      {i.payment ? (
                        <a href={i.payment.txUrl ?? undefined} target="_blank" rel="noopener noreferrer" className="text-ink-2 hover:text-gold">
                          {i.payment.amount} {i.payment.symbol} · {i.payment.chain} · from {i.payment.from.slice(0, 8)}…
                          <ArrowMark />
                        </a>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="py-2 whitespace-nowrap text-faint">{when(i.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-mono text-[11px] tracking-[1px] text-faint">WEBHOOK DELIVERIES</span>
        {data && <DeliveryLog rows={data.deliveries} token={token} onChange={load} />}
      </div>
    </div>
  )
}

/* ------------------------------------------------------- the section --- */

export function PayLinks({ token }: { token: string }) {
  const [data, setData] = useState<{ links: AdminLink[]; assets: PayAsset[]; defaultWebhook: Endpoint | null; webhooks: { pending: number; failed: number } } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const setMsg = flash

  const load = useCallback(() => {
    adminCall<NonNullable<typeof data>>(token, '/api/admin/paylinks').then((r) => (r.ok ? (setData(r.data), setErr(null)) : setErr(r.error)))
  }, [token])
  useEffect(() => {
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])

  const copy = (path: string) => {
    const url = `${siteOrigin()}${path}`
    copyWithToast(url, 'Link')
  }
  const act = async (path: string, done: string) => {
    const r = await adminCall(token, path, {})
    setMsg(r.ok ? { ok: true, text: done } : { ok: false, text: r.error })
    load()
  }

  return (
    <section className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={h2}>Pay links</h2>
        <span className={small}>Gully Pay · one reusable link, one invoice per payer{data ? ` · webhooks ${data.webhooks.pending} pending, ${data.webhooks.failed} failed` : ''}</span>
      </div>
      {err && <p className="m-0 font-mono text-[12px] text-error">{err}</p>}
      {secret && <SecretOnce secret={secret} onDone={() => setSecret(null)} />}

      {data &&
        (creating ? (
          <LinkForm
            initial={draftOf(null, data.assets)}
            assets={data.assets}
            submitLabel="Create link"
            onCancel={() => setCreating(false)}
            onSubmit={async (d) => {
              const r = await adminCall<{ link: AdminLink; secret: string | null }>(token, '/api/admin/paylinks', bodyOf(d))
              if (!r.ok) return r.error
              if (r.data.secret) setSecret(r.data.secret)
              setMsg({ ok: true, text: `Link created: ${siteOrigin()}${r.data.link.path}` })
              setCreating(false)
              setOpen(r.data.link.id)
              load()
              return null
            }}
          />
        ) : (
          <div>
            <button type="button" className={gold} onClick={() => setCreating(true)}>
              New pay link
            </button>
          </div>
        ))}

      {data && !data.links.length && <p className="m-0 text-[14px] text-muted">No pay links yet.</p>}
      {data && data.links.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {data.links.map((l) => (
            <li key={l.id} className="flex flex-col gap-3 rounded-input border border-line px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <b className="text-[15px] font-semibold text-ink">{l.title}</b>
                    <span className={`font-mono text-[11px] uppercase ${STATE_CLS[l.state]}`}>{l.state}</span>
                  </span>
                  <span className="font-mono text-[12px] text-faint">
                    {l.amount.type === 'fixed' ? `${l.amount.usd} USD` : `${l.amount.min}–${l.amount.max} USD, payer chooses`} · {l.paidUses}
                    {l.maxUses != null ? `/${l.maxUses}` : ''} paid · {l.stats.paidUsd} USD in · {l.assets.length} assets{l.expiresAt ? ` · expires ${when(l.expiresAt)}` : ''}
                    {l.webhook ? ' · webhook' : ''}
                  </span>
                </div>
                <span className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => copy(l.path)} className={btn}>
                    Copy link
                  </button>
                  <a href={`${siteOrigin()}${l.path}`} target="_blank" rel="noopener noreferrer" className={btn}>
                    Open
                    <ArrowMark />
                  </a>
                  <button type="button" onClick={() => setOpen(open === l.id ? null : l.id)} className={btn} aria-expanded={open === l.id}>
                    {open === l.id ? 'Hide details' : 'Payments & embed'}
                  </button>
                  <button type="button" onClick={() => setEditing(editing === l.id ? null : l.id)} className={btn}>
                    Edit
                  </button>
                  {l.active ? (
                    <button type="button" onClick={() => window.confirm(`Deactivate “${l.title}”? Its link stops taking new payments.`) && act(`/api/admin/paylinks/${l.id}/deactivate`, `“${l.title}” deactivated.`)} className={`${btn} hover:border-error hover:text-error`}>
                      Deactivate
                    </button>
                  ) : (
                    <button type="button" onClick={() => act(`/api/admin/paylinks/${l.id}/activate`, `“${l.title}” active again.`)} className={btn}>
                      Activate
                    </button>
                  )}
                </span>
              </div>
              {editing === l.id && (
                <LinkForm
                  initial={draftOf(l, data.assets)}
                  assets={data.assets}
                  submitLabel="Save"
                  onCancel={() => setEditing(null)}
                  onSubmit={async (d) => {
                    const r = await adminCall<{ link: AdminLink; secret: string | null }>(token, `/api/admin/paylinks/${l.id}`, bodyOf(d))
                    if (!r.ok) return r.error
                    if (r.data.secret) setSecret(r.data.secret)
                    setMsg({ ok: true, text: `“${r.data.link.title}” saved.` })
                    setEditing(null)
                    load()
                    return null
                  }}
                />
              )}
              {open === l.id && <LinkDetail token={token} link={l} reload={load} onSecret={setSecret} />}
            </li>
          ))}
        </ul>
      )}

      {data && <DefaultWebhook token={token} current={data.defaultWebhook} reload={load} onSecret={setSecret} />}
    </section>
  )
}

/** The global default endpoint: events of invoices with no endpoint of their own or of their link. */
function DefaultWebhook({ token, current, reload, onSecret }: { token: string; current: Endpoint | null; reload: () => void; onSecret: (s: string) => void }) {
  const [url, setUrl] = useState('')
  const setMsg = flash
  const [log, setLog] = useState<Delivery[] | null>(null)
  const [showLog, setShowLog] = useState(false)
  const call = async (path: string, body: unknown, done: string) => {
    const r = await adminCall<{ secret?: string | null; delivery?: Delivery }>(token, path, body)
    if (!r.ok) return setMsg({ ok: false, text: r.error })
    if (r.data.secret) onSecret(r.data.secret)
    setMsg(r.data.delivery ? { ok: r.data.delivery.state === 'delivered', text: r.data.delivery.state === 'delivered' ? `Webhook test delivered (${r.data.delivery.last?.status}).` : `Webhook test failed: ${r.data.delivery.last?.error ?? r.data.delivery.last?.status}` } : { ok: true, text: done })
    setUrl('')
    reload()
  }
  const loadLog = () => adminCall<{ deliveries: Delivery[] }>(token, '/api/admin/pay-webhooks').then((r) => r.ok && setLog(r.data.deliveries))
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] tracking-[1px] text-faint">DEFAULT WEBHOOK</span>
        <span className={small}>for invoices with no webhook of their own or of their link · events invoice.paid, invoice.expired, invoice.cancelled</span>
      </div>
      {current ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 font-mono text-[12px] break-all text-ink-2">{current.url}</code>
          <button type="button" className={btn} onClick={() => call('/api/admin/pay-webhooks/default/test', {}, 'Test sent.')}>
            Send test event
          </button>
          <button type="button" className={btn} onClick={() => window.confirm('Rotate the default signing secret?') && call('/api/admin/pay-webhooks/default/rotate', {}, 'Secret rotated.')}>
            Rotate secret
          </button>
          <button type="button" className={`${btn} hover:border-error hover:text-error`} onClick={() => window.confirm('Remove the default webhook?') && call('/api/admin/pay-webhooks/default', { url: null }, 'Default webhook removed.')}>
            Remove
          </button>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            call('/api/admin/pay-webhooks/default', { url }, 'Default webhook set.')
          }}
        >
          <input className={`${field} min-w-[min(100%,320px)] flex-1 font-mono`} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/gully" required aria-label="Default webhook URL" />
          <button type="submit" className={gold}>
            Set default
          </button>
        </form>
      )}
      <div>
        <button
          type="button"
          className={btn}
          onClick={() => {
            setShowLog(!showLog)
            if (!showLog) loadLog()
          }}
        >
          {showLog ? 'Hide all deliveries' : 'All deliveries'}
        </button>
      </div>
      {showLog && (log ? <DeliveryLog rows={log} token={token} onChange={loadLog} /> : <span className={small}>Loading…</span>)}
    </div>
  )
}
