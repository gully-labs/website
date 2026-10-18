import { track } from '../../../lib/track'
import { Ban, FileText, Link2, Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { toastError, toastSuccess } from '../../../components/ui/toast'
import { api } from '../api'
import { chip, input, mono, pillGold, pillLine, pillSm } from '../styles'
import { fmtDay, type MerchantInvoice, type MerchantLink, type MerchantView } from './api'
import { AssetChips, Confirm, Field, Section, ShareBox, StatusPill } from './parts'
import { EmptyLine } from '../parts'

/* Pay links (fixed or open amount) and invoices (line items, due date, customer). Each has its checkout
   URL, a QR and the "Pay with crypto" button snippet. */

const liveChains = (v: MerchantView) => new Set(v.wallets.filter((w) => w.enabled && w.status === 'ok').map((w) => w.chainId))
const defaultAssets = (v: MerchantView) => {
  const live = liveChains(v)
  const on = v.assets.filter((a) => live.has(a.chainId)).map((a) => a.id)
  return on.length ? on : v.assets.map((a) => a.id)
}

/** `?paylink=<usd>` with #merchant (Gully AI's "Create a pay link for $25"): the amount the New link form
    opens with ('' for no amount), read once and taken off the address. The user still saves the link. */
function paylinkFromUrl(): string | null {
  if (!/^#merchant(\/|$)/.test(window.location.hash)) return null
  const q = new URLSearchParams(window.location.search)
  if (!q.has('paylink')) return null
  const v = q.get('paylink') ?? ''
  q.delete('paylink')
  history.replaceState(null, '', window.location.pathname + (q.size ? `?${q}` : '') + window.location.hash)
  return /^\d{1,7}(\.\d{1,2})?$/.test(v) ? v : ''
}

/** Create a pay link (the Links tab and step 3 of the setup stepper). */
export function NewLink({ view, onDone, bare = false, initialAmount = '' }: { view: MerchantView; onDone: () => void; bare?: boolean; initialAmount?: string }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<'fixed' | 'open'>('fixed')
  const [amount, setAmount] = useState(initialAmount)
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [assets, setAssets] = useState<string[]>(() => defaultAssets(view))
  const [expires, setExpires] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const live = useMemo(() => liveChains(view), [view])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const r = await api<{ link: MerchantLink }>('/api/developer/merchant/links', {
      method: 'POST',
      body: { title, description, amount: kind === 'fixed' ? { type: 'fixed', usd: amount } : { type: 'open', min, max }, assets, expiresAt: expires ? new Date(expires).toISOString() : null, maxUses: maxUses || null },
    })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    toastSuccess('Pay link created', { detail: r.data.link.title })
    track('merchant-link-created')
    onDone()
  }

  return (
    <form onSubmit={submit} className={`flex animate-[gl-rise_.25s_ease_both] flex-col gap-3 ${bare ? '' : 'rounded-[12px] border border-line bg-bg p-3'}`} data-testid="new-link-form">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Title">
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required placeholder="Bag of beans, 1 kg" />
        </Field>
        <Field label="Description (optional)">
          <input className={input} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-2" role="radiogroup" aria-label="Amount">
          <button type="button" role="radio" aria-checked={kind === 'fixed'} className={chip(kind === 'fixed')} onClick={() => setKind('fixed')}>
            Fixed amount
          </button>
          <button type="button" role="radio" aria-checked={kind === 'open'} className={chip(kind === 'open')} onClick={() => setKind('open')}>
            Payer chooses
          </button>
        </div>
        {kind === 'fixed' ? (
          <Field label="USD">
            <input className={`${input} w-[140px]`} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required placeholder="49.00" />
          </Field>
        ) : (
          <>
            <Field label="Min USD">
              <input className={`${input} w-[120px]`} value={min} onChange={(e) => setMin(e.target.value)} inputMode="decimal" required />
            </Field>
            <Field label="Max USD">
              <input className={`${input} w-[120px]`} value={max} onChange={(e) => setMax(e.target.value)} inputMode="decimal" required />
            </Field>
          </>
        )}
        <Field label="Expires (optional)">
          <input className={`${input} w-[220px]`} type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
        <Field label="Max uses (optional)">
          <input className={`${input} w-[120px]`} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} inputMode="numeric" />
        </Field>
      </div>
      <AssetChips assets={view.assets} value={assets} onChange={setAssets} live={live} />
      {err && (
        <p className="m-0 text-[13px] text-error" role="alert">
          {err}
        </p>
      )}
      <button type="submit" disabled={busy || !assets.length} className={`${pillGold} self-start`}>
        {busy && <Loader2 size={15} className="animate-spin" aria-hidden />} Create link
      </button>
    </form>
  )
}

export function LinksSection({ view, reload }: { view: MerchantView; reload: () => void }) {
  const [prefill] = useState(paylinkFromUrl)
  const [creating, setCreating] = useState(() => prefill !== null && view.can.links)
  useEffect(() => {
    if (prefill !== null) document.getElementById('m-links')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [prefill])
  const toggle = async (l: MerchantLink) => {
    const r = await api(`/api/developer/merchant/links/${l.id}`, { method: 'POST', body: { active: !l.active } })
    if (!r.ok) return toastError('Not changed', { detail: r.error })
    reload()
  }
  return (
    <Section
      id="m-links"
      title="Pay links"
      sub="Reusable checkouts: every payer gets their own invoice."
      info="Fixed or open amount, the assets you choose, an optional expiry and use limit. Each link has its checkout URL, a QR code and a “Pay with crypto” button snippet for your site."
      action={
        view.can.links && (
          <button type="button" className={pillLine} onClick={() => setCreating((c) => !c)} aria-expanded={creating}>
            <Plus size={15} aria-hidden /> New link
          </button>
        )
      }
    >
      {creating && (
        <NewLink
          view={view}
          initialAmount={prefill ?? ''}
          onDone={() => {
            setCreating(false)
            reload()
          }}
        />
      )}
      {view.links.length === 0 && !creating && <EmptyLine icon={<Link2 size={14} aria-hidden />}>No pay link yet. Each link you create lists here with its views, checkouts and payments.</EmptyLine>}
      <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 xl:grid-cols-2">
        {view.links.map((l) => (
          <li key={l.id} className="flex min-w-0 flex-col gap-2 rounded-[12px] border border-line bg-bg p-3 transition-colors hover:border-line-strong">
            <div className="flex flex-wrap items-center gap-3">
              <b className="min-w-0 flex-1 truncate text-[15px] text-ink">{l.title}</b>
              <span className="font-mono text-[13px] text-gold">{l.amount.type === 'fixed' ? `$${l.amount.usd}` : `$${l.amount.min} – $${l.amount.max}`}</span>
              <StatusPill state={l.state} />
              {view.can.links && (
                <button type="button" className={pillSm} onClick={() => toggle(l)}>
                  {l.active ? 'Switch off' : 'Switch on'}
                </button>
              )}
            </div>
            <span className={mono}>
              {l.views} view{l.views === 1 ? '' : 's'} · {l.stats.checkouts} checkout{l.stats.checkouts === 1 ? '' : 's'} · {l.paidUses} paid (${l.stats.paidUsd}){l.maxUses != null ? ` of ${l.maxUses} uses` : ''}
              {l.expiresAt ? ` · expires ${fmtDay(l.expiresAt)}` : ''}
            </span>
            <ShareBox path={l.path} label={l.title} />
          </li>
        ))}
      </ul>
    </Section>
  )
}

type Item = { description: string; quantity: string; unitUsd: string }

function NewInvoice({ view, onDone }: { view: MerchantView; onDone: () => void }) {
  const [items, setItems] = useState<Item[]>([{ description: '', quantity: '1', unitUsd: '' }])
  const [due, setDue] = useState(() => new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10))
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [number, setNumber] = useState('')
  const [assets, setAssets] = useState<string[]>(() => defaultAssets(view))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const live = useMemo(() => liveChains(view), [view])
  const set = (i: number, k: keyof Item, v: string) => setItems(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const r = await api<{ invoice: MerchantInvoice }>('/api/developer/merchant/invoices', { method: 'POST', body: { items, dueDate: due, customer: { name, email }, notes, number: number || undefined, assets } })
    setBusy(false)
    if (!r.ok) return setErr(r.error)
    toastSuccess(`Invoice ${r.data.invoice.number} created`, { detail: `$${r.data.invoice.usd}` })
    onDone()
  }

  return (
    <form onSubmit={submit} className="flex animate-[gl-rise_.25s_ease_both] flex-col gap-3 rounded-[12px] border border-line bg-bg p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Customer name">
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Customer email">
          <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Due date">
          <input className={input} type="date" value={due} onChange={(e) => setDue(e.target.value)} required />
        </Field>
        <Field label="Number (optional)">
          <input className={input} value={number} onChange={(e) => setNumber(e.target.value)} maxLength={32} placeholder="INV-0001" />
        </Field>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[12px] text-dim">Line items</span>
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_72px_110px_44px] gap-2 max-[520px]:grid-cols-[minmax(0,1fr)_60px_90px_44px]">
            <input className={input} value={it.description} onChange={(e) => set(i, 'description', e.target.value)} placeholder="Description" aria-label={`Line ${i + 1} description`} required maxLength={120} />
            <input className={input} value={it.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} inputMode="numeric" aria-label={`Line ${i + 1} quantity`} />
            <input className={input} value={it.unitUsd} onChange={(e) => set(i, 'unitUsd', e.target.value)} inputMode="decimal" placeholder="USD" aria-label={`Line ${i + 1} unit price in USD`} required />
            <button type="button" className={pillSm} disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`}>
              <Trash2 size={14} aria-hidden />
            </button>
          </div>
        ))}
        <button type="button" className={`${pillSm} self-start`} onClick={() => setItems([...items, { description: '', quantity: '1', unitUsd: '' }])}>
          <Plus size={14} aria-hidden /> Add line
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Field label="Notes (shown on the invoice)">
          <textarea className={`${input} h-[68px] py-2`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
        </Field>
        <div className="flex min-w-0 flex-col gap-[6px]">
          <span className="text-[12px] text-dim">Assets accepted</span>
          <AssetChips assets={view.assets} value={assets} onChange={setAssets} live={live} />
        </div>
      </div>
      {err && (
        <p className="m-0 text-[13px] text-error" role="alert">
          {err}
        </p>
      )}
      <button type="submit" disabled={busy || !assets.length} className={`${pillGold} self-start`}>
        {busy && <Loader2 size={15} className="animate-spin" aria-hidden />} Create invoice
      </button>
    </form>
  )
}

export function InvoicesSection({ view, reload }: { view: MerchantView; reload: () => void }) {
  const [creating, setCreating] = useState(false)
  const [cancelling, setCancelling] = useState<MerchantInvoice | null>(null)
  const [busy, setBusy] = useState(false)
  const cancel = async (i: MerchantInvoice) => {
    setBusy(true)
    const r = await api(`/api/developer/merchant/invoices/${i.id}/cancel`, { method: 'POST' })
    setBusy(false)
    if (!r.ok) return toastError('Not cancelled', { detail: r.error })
    setCancelling(null)
    toastSuccess(`Invoice ${i.number} cancelled`)
    reload()
  }
  return (
    <Section
      id="m-invoices"
      title="Invoices"
      sub="One payer, line items and a due date."
      info="Payable after the due date for 30 days (marked overdue), then it expires. Each open invoice has its checkout URL, a QR code and a button snippet."
      action={
        view.can.manage && (
          <button type="button" className={pillLine} onClick={() => setCreating((c) => !c)} aria-expanded={creating}>
            <Plus size={15} aria-hidden /> New invoice
          </button>
        )
      }
    >
      {creating && (
        <NewInvoice
          view={view}
          onDone={() => {
            setCreating(false)
            reload()
          }}
        />
      )}
      {view.invoices.length === 0 && !creating && <EmptyLine icon={<FileText size={14} aria-hidden />}>No invoice yet. Invoices you send list here with their state.</EmptyLine>}
      <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 xl:grid-cols-2">
        {view.invoices.map((i) => (
          <li key={i.id} className="flex min-w-0 flex-col gap-2 rounded-[12px] border border-line bg-bg p-3 transition-colors hover:border-line-strong">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-[12px] text-faint">{i.number}</span>
              <b className="min-w-0 flex-1 truncate text-[15px] text-ink">{i.title}</b>
              <span className="font-mono text-[13px] text-gold">${i.usd}</span>
              <StatusPill state={i.overdue ? 'overdue' : i.status} />
              {view.can.manage && i.status === 'open' && (
                <button type="button" className={pillSm} onClick={() => setCancelling(i)} data-testid="invoice-cancel">
                  <Ban size={14} aria-hidden /> Cancel
                </button>
              )}
            </div>
            <span className={mono}>
              {i.customer?.name || i.customer?.email ? `${[i.customer.name, i.customer.email].filter(Boolean).join(' · ')} · ` : ''}due {fmtDay(i.dueAt)} · {i.items.length} line{i.items.length === 1 ? '' : 's'} · {i.views} view{i.views === 1 ? '' : 's'}
              {i.payment ? ` · paid ${i.payment.amount} ${i.payment.symbol} on ${i.payment.chain}` : ''}
            </span>
            {i.status === 'open' && <ShareBox path={i.path} label={`invoice ${i.number}`} />}
          </li>
        ))}
      </ul>
      <Confirm open={!!cancelling} title={`Cancel invoice ${cancelling?.number ?? ''}?`} confirm="Cancel invoice" busy={busy} onConfirm={() => cancelling && cancel(cancelling)} onClose={() => setCancelling(null)}>
        Its checkout stops taking payments at once and the payer sees it as cancelled{view.webhook ? '; your webhook gets invoice.cancelled' : ''}. This cannot be undone: make a new invoice to bill again.
      </Confirm>
    </Section>
  )
}
