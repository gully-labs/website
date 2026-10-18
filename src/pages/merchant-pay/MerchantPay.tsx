import { ArrowRight, Ban, CheckCircle2, Clock, ExternalLink, Loader2, Mail, PauseCircle, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { EChart } from '../../components/charts/EChart'
import { itemTooltip, PALETTE, ringPreset, tipHtml } from '../../components/charts/chartPresets'
import { ChainLogo } from '../../components/logos/ChainLogo'
import { AssetPicker } from '../../components/pay/AssetPicker'
import { Seo } from '../../components/Seo'
import { btnOutline } from '../../components/ui'
import { payApi, type PayAsset, type Payment } from '../pay/api'
import { Checkout, type Phase } from '../pay/Checkout'
import type { Invoice } from '../pay/invoice'
import { fmtDay, fmtTime } from '../pay/invoice'
import { Missing, Notice, Shell } from '../pay/PayPage'

/* A merchant store's hosted checkout (Gully Pay for merchants, server/merchants.mjs):
     /pay/m/<invoiceId>   one invoice (made by the store, or by one of its links for one payer)
     /pay/m/l/<linkId>    a reusable link: makes an invoice per payer, then hands over to /pay/m/<id>
   The store's name, logo and accent head the page; the payment goes straight to the STORE's wallet on the
   chosen chain (the shared Checkout, pointed at /api/pay/m/i/<id>); "Powered by Gully Pay" sits at the
   foot. A paused store says so and starts no payment. Everything shown is the server's. */

export interface Brand {
  name: string
  logoUrl: string | null
  accent: string | null
  supportEmail: string | null
  website: string | null
}

interface StoreCheckout {
  enabled: boolean
  treasury: null
  paused?: boolean
  reason?: string
}

export interface StoreInvoice extends Omit<Invoice, 'checkout'> {
  items: { description: string; quantity: number; unitUsd: string; totalUsd: string }[]
  customer: { name: string } | null
  overdue: boolean
  dueAt: string | null
  recipients: Record<string, string>
  merchant: Brand
  nonCustodial: string
  checkout: StoreCheckout
}

interface StoreLink {
  id: string
  title: string
  description: string | null
  amount: { type: 'fixed'; usd: string; usdCents: string } | { type: 'open'; min: string; max: string; minCents: string; maxCents: string }
  assets: PayAsset[]
  state: 'active' | 'inactive' | 'expired' | 'used-up'
  stateText: string | null
  expiresAt: string | null
  merchant: Brand
  nonCustodial: string
  checkout: StoreCheckout
}

const ACCENT_RE = /^#[0-9a-f]{6}$/i
const accentOf = (b: Brand) => (b.accent && ACCENT_RE.test(b.accent) ? b.accent : '#e8c060')
const rise = (i: number) => ({ animation: `gl-rise .5s ${i * 0.07}s ease both` })

function StoreHead({ brand }: { brand: Brand }) {
  const accent = accentOf(brand)
  return (
    <div className="flex items-center gap-3" style={rise(0)}>
      {brand.logoUrl ? (
        <img src={brand.logoUrl} alt={`${brand.name} logo`} className="size-12 rounded-[12px] border border-line bg-surface object-contain" />
      ) : (
        <span aria-hidden className="grid size-12 place-items-center rounded-[12px] font-display text-[24px] font-extrabold text-bg" style={{ background: accent }}>
          {brand.name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <b className="truncate text-[18px] font-semibold text-ink">{brand.name}</b>
        {brand.website && (
          <a href={brand.website} target="_blank" rel="noopener nofollow" className="inline-flex items-center gap-1 truncate font-mono text-[12px] text-dim underline-offset-4 hover:text-ink hover:underline">
            {new URL(brand.website).host} <ExternalLink size={11} aria-hidden />
          </a>
        )}
      </span>
    </div>
  )
}

/** The foot of every store checkout: who to ask, the non-custodial line, Powered by Gully Pay. */
function StoreFoot({ brand, nonCustodial }: { brand: Brand; nonCustodial: string }) {
  return (
    <footer className="flex flex-col gap-3 border-t border-line pt-5" style={rise(3)}>
      <p className="m-0 flex items-start gap-2 text-[13px] leading-[1.6] text-muted">
        <ShieldCheck size={15} className="mt-[2px] shrink-0 text-gold" aria-hidden />
        <span>{nonCustodial.replace('your wallet', `${brand.name}'s wallet`)} Questions about an order or a refund go to the store.</span>
      </p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
        {brand.supportEmail && (
          <a href={`mailto:${brand.supportEmail}`} className="inline-flex min-h-11 items-center gap-2 text-ink-2 underline-offset-4 hover:text-gold hover:underline">
            <Mail size={14} aria-hidden /> {brand.supportEmail}
          </a>
        )}
        <a href="/" className="ml-auto inline-flex min-h-11 items-center gap-2 font-mono text-[11px] tracking-[1.5px] text-faint hover:text-gold">
          POWERED BY <span className="text-gold">GULLY PAY</span>
        </a>
      </div>
    </footer>
  )
}

function Loading({ what }: { what: string }) {
  return (
    <p className="m-0 inline-flex items-center gap-3 font-mono text-[13px] text-faint">
      <Loader2 size={16} className="animate-spin" aria-hidden /> Reading the {what}…
    </p>
  )
}

function Failed({ what, message, retry }: { what: string; message: string; retry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-card border border-[#5a2a24] bg-[rgba(255,138,122,.06)] px-6 py-5 text-[15px] text-error" role="alert">
      The {what} could not be read: {message}
      <button type="button" onClick={retry} className={`${btnOutline} min-h-11 px-5 text-[14px]`}>
        Try again
      </button>
    </div>
  )
}

function PausedNotice({ brand }: { brand: Brand }) {
  return (
    <Notice icon={<PauseCircle size={18} className="mt-[3px] shrink-0 text-error" aria-hidden />}>
      <b className="text-ink">This store's checkout is paused.</b> Nothing can be paid here right now. {brand.supportEmail ? `Write to ${brand.supportEmail} to pay another way.` : 'Contact the store to pay another way.'}
    </Notice>
  )
}

/* ------------------------------------------------------------- invoice --- */

type InvState = { k: 'loading' } | { k: 'missing' } | { k: 'error'; message: string } | { k: 'ok'; invoice: StoreInvoice }

/** The line items as an animated ring (hover for each line's share); the invoice's own figures. */
function ItemsRing({ invoice, accent }: { invoice: StoreInvoice; accent: string }) {
  const option = useMemo(() => {
    const num = (s: string) => Number(s.replace(/,/g, ''))
    return {
      tooltip: itemTooltip((p: { name: string; value: number; percent: number; color: string }) => tipHtml({ title: p.name, rows: [{ name: 'Amount', value: `${p.value.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`, color: p.color }, { name: 'Share', value: `${p.percent}%` }] })),
      series: [{ id: 'items', ...ringPreset({ radius: ['62%', '90%'] }), color: [accent, ...PALETTE.filter((c) => c !== accent)], data: invoice.items.map((i) => ({ name: i.quantity > 1 ? `${i.description} ×${i.quantity}` : i.description, value: num(i.totalUsd) })) }],
    }
  }, [invoice, accent])
  return (
    <EChart option={option} height={150} skeleton="ring" label={`Invoice total ${invoice.usd} USD across ${invoice.items.length} lines`} className="max-w-[150px]">
      <span className="pointer-events-none absolute inset-0 grid place-items-center font-mono text-[11px] text-faint">{invoice.items.length} lines</span>
    </EChart>
  )
}

function StorePaid({ invoice }: { invoice: StoreInvoice }) {
  const p: Payment | null = invoice.payment
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <CheckCircle2 size={26} className="mt-[2px] shrink-0 text-green" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-display text-[28px] leading-none font-bold uppercase">Payment received</span>
          <span className="text-[15px] text-muted">{p ? `${p.amount} ${p.symbol} on ${p.chain} to ${invoice.merchant.name}, confirmed ${fmtTime(invoice.paidAt)}.` : `Paid ${fmtTime(invoice.paidAt)}.`}</span>
        </div>
      </div>
      {p && (
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-input border border-line bg-bg px-4 py-3 font-mono text-[12px]">
          <dt className="text-faint">AMOUNT</dt>
          <dd className="m-0 break-all text-ink">
            {p.amount} {p.symbol} {p.usd ? <span className="text-faint">· {p.usd} USD</span> : null}
          </dd>
          <dt className="text-faint">TO</dt>
          <dd className="m-0 break-all text-ink-2">{p.to}</dd>
          <dt className="text-faint">FROM</dt>
          <dd className="m-0 break-all text-ink-2">{p.from}</dd>
          <dt className="text-faint">TX</dt>
          <dd className="m-0 break-all">
            {p.txUrl ? (
              <a href={p.txUrl} target="_blank" rel="noopener" className="text-ink-2 underline-offset-4 hover:text-gold hover:underline">
                {p.txHash}
              </a>
            ) : (
              p.txHash
            )}
          </dd>
        </dl>
      )}
    </div>
  )
}

export function MerchantInvoicePage() {
  const { id } = useParams()
  const [state, setState] = useState<InvState>({ k: 'loading' })
  const load = useCallback(() => {
    const read: Promise<InvState> = !id ? Promise.resolve({ k: 'missing' }) : payApi<{ invoice: StoreInvoice }>(`/api/pay/m/i/${encodeURIComponent(id)}`).then((r): InvState => (r.ok ? { k: 'ok', invoice: r.data.invoice } : r.status === 404 ? { k: 'missing' } : { k: 'error', message: r.error }))
    read.then(setState)
  }, [id])
  useEffect(() => {
    load()
  }, [load])
  return (
    <>
      <Seo title={state.k === 'ok' ? `${state.invoice.merchant.name}: ${state.invoice.number}` : 'Pay'} description="Pay in ETH, BNB, USDC or USDT, wallet to wallet, through Gully Pay." />
      <Shell>
        {state.k === 'loading' && <Loading what="invoice" />}
        {state.k === 'missing' && <Missing what="invoice" text="This link does not match an invoice. Check that it was copied whole, or ask the store that sent it." />}
        {state.k === 'error' && <Failed what="invoice" message={state.message} retry={load} />}
        {state.k === 'ok' && <StoreInvoiceView invoice={state.invoice} onPaid={(i) => setState({ k: 'ok', invoice: i as unknown as StoreInvoice })} />}
      </Shell>
    </>
  )
}

function StoreInvoiceView({ invoice, onPaid }: { invoice: StoreInvoice; onPaid: (i: Invoice) => void }) {
  const [params] = useSearchParams()
  const [phase, setPhase] = useState<Phase>('choose')
  const brand = invoice.merchant
  const accent = accentOf(brand)
  const pill: { text: string; cls: string } =
    invoice.status === 'paid'
      ? { text: 'Paid', cls: 'border-success-line text-green' }
      : invoice.status === 'expired'
        ? { text: 'Expired', cls: 'border-line-strong text-muted' }
        : invoice.status === 'cancelled'
          ? { text: 'Cancelled', cls: 'border-line-strong text-muted' }
          : invoice.checkout.paused
            ? { text: 'Checkout paused', cls: 'border-[#5a2a24] text-error' }
            : phase === 'confirming'
              ? { text: 'Confirming', cls: 'border-gold-line text-gold' }
              : invoice.overdue
                ? { text: 'Overdue', cls: 'border-[#5a2a24] text-error' }
                : { text: 'Awaiting payment', cls: 'border-line-strong text-ink-2' }
  const chains = Object.keys(invoice.recipients)
  return (
    <div className="flex flex-col gap-6" style={{ borderTop: `3px solid ${accent}`, paddingTop: 20 }}>
      <StoreHead brand={brand} />
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,600px)]">
        <div className="flex min-w-0 flex-col gap-4" style={rise(1)}>
          <span className="font-mono text-[13px] tracking-[1.5px]" style={{ color: accent }}>
            {invoice.linkId ? 'PAYMENT' : `INVOICE ${invoice.number}`}
          </span>
          <h1 className="m-0 font-display text-[clamp(32px,7vw,56px)] leading-[.92] font-extrabold break-words uppercase">{invoice.title}</h1>
          <span className="font-display text-[clamp(38px,9vw,56px)] leading-none font-extrabold text-ink">
            {invoice.usd} <span className="font-mono text-[14px] font-normal text-faint">USD</span>
          </span>
          {invoice.items.length > 1 && (
            <div className="flex flex-wrap items-center gap-4">
              <ItemsRing invoice={invoice} accent={accent} />
              <ul className="m-0 flex min-w-[220px] flex-1 list-none flex-col gap-1 p-0 font-mono text-[12px]">
                {invoice.items.map((i, n) => (
                  <li key={n} className="flex justify-between gap-3 border-b border-line py-1 text-ink-2 last:border-0">
                    <span className="min-w-0 truncate">
                      {i.description}
                      {i.quantity > 1 ? ` × ${i.quantity}` : ''}
                    </span>
                    <span className="text-ink">{i.totalUsd}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {invoice.note && <p className="m-0 max-w-[620px] text-[16px] leading-[1.6] whitespace-pre-line text-muted">{invoice.note}</p>}
          <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 font-mono text-[12px]">
            {invoice.customer && (
              <>
                <dt className="text-faint">BILLED TO</dt>
                <dd className="m-0 text-ink-2">{invoice.customer.name}</dd>
              </>
            )}
            <dt className="text-faint">ISSUED</dt>
            <dd className="m-0 text-ink-2">{fmtDay(invoice.createdAt)}</dd>
            {invoice.dueAt && (
              <>
                <dt className="text-faint">DUE</dt>
                <dd className={`m-0 ${invoice.overdue ? 'text-error' : 'text-ink-2'}`}>{fmtDay(invoice.dueAt)}</dd>
              </>
            )}
            {chains.length > 0 && invoice.status === 'open' && (
              <>
                <dt className="text-faint">PAID TO</dt>
                <dd className="m-0 flex flex-col gap-1 text-ink-2">
                  {chains.map((c) => {
                    const a = invoice.assets.find((x) => String(x.chainId) === c)
                    return (
                      <span key={c} className="inline-flex min-w-0 items-center gap-2 break-all">
                        <ChainLogo chain={a?.chainKey ?? c} size={14} decorative /> {invoice.recipients[c]}
                      </span>
                    )
                  })}
                </dd>
              </>
            )}
          </dl>
        </div>

        <section className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface" style={rise(2)} aria-label="Checkout">
          <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 max-[600px]:px-4">
            <span className="flex min-w-0 flex-col leading-[1.25]">
              <b className="truncate text-[15px] font-semibold">{brand.name}</b>
              <span className="truncate font-mono text-[11px] text-faint">
                {window.location.host}/pay/m/{invoice.id}
              </span>
            </span>
            <span className={`shrink-0 rounded-full border px-3 py-[3px] text-[12px] font-semibold transition-colors duration-300 ${pill.cls}`}>{pill.text}</span>
          </header>
          <div className="flex flex-col gap-5 p-5 max-[600px]:p-4">
            {invoice.status === 'paid' && <StorePaid invoice={invoice} />}
            {invoice.status === 'expired' && (
              <Notice icon={<Clock size={18} className="mt-[3px] shrink-0 text-faint" aria-hidden />}>
                This invoice expired on {fmtDay(invoice.expiresAt)} without a payment. {invoice.linkId ? 'Open the payment link again to start a new checkout.' : 'Ask the store for a new one.'}
              </Notice>
            )}
            {invoice.status === 'cancelled' && <Notice icon={<Ban size={18} className="mt-[3px] shrink-0 text-faint" aria-hidden />}>The store cancelled this invoice on {fmtDay(invoice.cancelledAt)}; it cannot be paid.</Notice>}
            {invoice.status === 'open' && invoice.checkout.paused && <PausedNotice brand={brand} />}
            {invoice.status === 'open' && !invoice.checkout.enabled && !invoice.checkout.paused && <Notice icon={<Ban size={18} className="mt-[3px] shrink-0 text-faint" aria-hidden />}>{invoice.checkout.reason}</Notice>}
            {invoice.status === 'open' && invoice.checkout.enabled && <Checkout invoice={invoice as unknown as Invoice} initialAsset={params.get('asset')} onPaid={onPaid} onPhase={setPhase} api={`/api/pay/m/i/${invoice.id}`} payee={brand.name} />}
          </div>
        </section>
      </div>
      <StoreFoot brand={brand} nonCustodial={invoice.nonCustodial} />
    </div>
  )
}

/* ---------------------------------------------------------------- link --- */

type LinkState = { k: 'loading' } | { k: 'missing' } | { k: 'error'; message: string } | { k: 'ok'; link: StoreLink }
const AMOUNT_RE = /^\d{1,9}(\.\d{1,2})?$/
const toCents = (s: string) => {
  const [a, b = ''] = s.split('.')
  return BigInt(a) * 100n + BigInt((b + '00').slice(0, 2))
}

export function MerchantLinkPage() {
  const { id } = useParams()
  const [state, setState] = useState<LinkState>({ k: 'loading' })
  const load = useCallback(() => {
    const read: Promise<LinkState> = !id ? Promise.resolve({ k: 'missing' }) : payApi<{ link: StoreLink }>(`/api/pay/m/l/${encodeURIComponent(id)}`).then((r): LinkState => (r.ok ? { k: 'ok', link: r.data.link } : r.status === 404 ? { k: 'missing' } : { k: 'error', message: r.error }))
    read.then(setState)
  }, [id])
  useEffect(() => {
    load()
  }, [load])
  return (
    <>
      <Seo title={state.k === 'ok' ? `${state.link.merchant.name}: ${state.link.title}` : 'Pay'} description="Pay in ETH, BNB, USDC or USDT, wallet to wallet, through Gully Pay." />
      <Shell>
        {state.k === 'loading' && <Loading what="payment link" />}
        {state.k === 'missing' && <Missing what="payment link" text="This address does not match a payment link. Check that it was copied whole, or ask the store for a new one." />}
        {state.k === 'error' && <Failed what="payment link" message={state.message} retry={load} />}
        {state.k === 'ok' && <StoreLinkView link={state.link} />}
      </Shell>
    </>
  )
}

function StoreLinkView({ link }: { link: StoreLink }) {
  const navigate = useNavigate()
  const [asset, setAsset] = useState<string | null>(link.assets.length === 1 ? link.assets[0].id : null)
  const [usd, setUsd] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const brand = link.merchant
  const accent = accentOf(brand)
  const open = link.amount.type === 'open' ? link.amount : null
  const live = link.state === 'active' && link.checkout.enabled
  let amountErr: string | null = null
  if (open && usd.trim()) {
    const v = usd.trim()
    if (!AMOUNT_RE.test(v)) amountErr = 'Dollars, with at most two decimals.'
    else if (toCents(v) < BigInt(open.minCents) || toCents(v) > BigInt(open.maxCents)) amountErr = `From ${open.min} to ${open.max} USD.`
  }
  const ready = !!asset && (!open || (!!usd.trim() && !amountErr))
  const go = async () => {
    if (!ready || busy) return
    setBusy(true)
    setErr(null)
    const r = await payApi<{ path: string }>(`/api/pay/m/l/${link.id}/invoice`, { method: 'POST', body: { asset, ...(open ? { usd: usd.trim() } : {}) } })
    setBusy(false)
    if (r.ok) navigate(r.data.path)
    else setErr(r.error)
  }
  let body: ReactNode
  if (link.state !== 'active') body = <Notice icon={<Ban size={18} className="mt-[3px] shrink-0 text-faint" aria-hidden />}>{link.stateText} Ask the store for a new link.</Notice>
  else if (link.checkout.paused) body = <PausedNotice brand={brand} />
  else if (!link.checkout.enabled) body = <Notice icon={<Ban size={18} className="mt-[3px] shrink-0 text-faint" aria-hidden />}>{link.checkout.reason}</Notice>
  return (
    <div className="flex flex-col gap-6" style={{ borderTop: `3px solid ${accent}`, paddingTop: 20 }}>
      <StoreHead brand={brand} />
      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,600px)]">
        <div className="flex min-w-0 flex-col gap-4" style={rise(1)}>
          <span className="font-mono text-[13px] tracking-[1.5px]" style={{ color: accent }}>
            PAY {brand.name.toUpperCase()}
          </span>
          <h1 className="m-0 font-display text-[clamp(32px,7vw,56px)] leading-[.92] font-extrabold break-words uppercase">{link.title}</h1>
          {link.amount.type === 'fixed' ? (
            <span className="font-display text-[clamp(38px,9vw,56px)] leading-none font-extrabold text-ink">
              {link.amount.usd} <span className="font-mono text-[14px] font-normal text-faint">USD</span>
            </span>
          ) : (
            <span className="font-mono text-[14px] text-ink-2">
              You choose the amount: {link.amount.min} to {link.amount.max} USD
            </span>
          )}
          {link.description && <p className="m-0 max-w-[620px] text-[16px] leading-[1.6] whitespace-pre-line text-muted">{link.description}</p>}
        </div>
        <section className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface" style={rise(2)} aria-label="Start a payment">
          <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 max-[600px]:px-4">
            <span className="flex min-w-0 flex-col leading-[1.25]">
              <b className="truncate text-[15px] font-semibold">{brand.name}</b>
              <span className="truncate font-mono text-[11px] text-faint">
                {window.location.host}/pay/m/l/{link.id}
              </span>
            </span>
            <span className={`shrink-0 rounded-full border px-3 py-[3px] text-[12px] font-semibold ${link.checkout.paused ? 'border-[#5a2a24] text-error' : live ? 'border-gold-line text-gold' : 'border-line-strong text-muted'}`}>{link.checkout.paused ? 'Checkout paused' : live ? 'Pay link' : 'Closed'}</span>
          </header>
          <div className="flex flex-col gap-5 p-5 max-[600px]:p-4">
            {body}
            {live && (
              <form
                className="flex flex-col gap-5"
                onSubmit={(e) => {
                  e.preventDefault()
                  go()
                }}
              >
                {open && (
                  <label className="flex flex-col gap-2">
                    <span className="font-mono text-[11px] tracking-[1px] text-faint">AMOUNT (USD)</span>
                    <input className="h-12 rounded-input border border-line-strong bg-bg px-3 font-display text-[26px] font-bold text-ink outline-none focus:border-gold" value={usd} onChange={(e) => setUsd(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" autoComplete="off" placeholder={open.min} aria-invalid={!!amountErr} />
                    <span className={`font-mono text-[12px] ${amountErr ? 'text-error' : 'text-faint'}`}>{amountErr ?? `From ${open.min} to ${open.max} USD.`}</span>
                  </label>
                )}
                <div className="flex flex-col gap-3">
                  <span className="font-mono text-[11px] tracking-[1px] text-faint">PAY WITH</span>
                  <AssetPicker assets={link.assets} value={asset} onChange={setAsset} disabled={busy} showFee />
                </div>
                {err && (
                  <p className="m-0 text-[14px] text-error" role="alert">
                    {err}
                  </p>
                )}
                <button type="submit" disabled={!ready || busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-btn bg-gold px-5 text-[15px] font-semibold text-bg transition-colors hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-50">
                  {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null} Continue to payment <ArrowRight size={16} aria-hidden />
                </button>
              </form>
            )}
          </div>
        </section>
      </div>
      <StoreFoot brand={brand} nonCustodial={link.nonCustodial} />
    </div>
  )
}
