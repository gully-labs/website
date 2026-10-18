import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { EChart } from '../../components/charts/EChart'
import { itemTooltip, PALETTE, ringPreset, tipHtml } from '../../components/charts/chartPresets'
import { ChainLogo } from '../../components/logos/ChainLogo'
import { Seo } from '../../components/Seo'
import { payApi, type PayAsset } from '../pay/api'
import { Checkout, PaidPanel, type Phase } from '../pay/Checkout'
import { accentOf, linkItems, pills, storeName, type Brand, type Viewer } from '../pay/brand'
import { CheckoutFrame, PayPanel } from '../pay/CheckoutFrame'
import type { Invoice } from '../pay/invoice'
import { fmtDay } from '../pay/invoice'
import { LinkCharts, LinkForm } from '../pay/LinkPage'
import { OrderSummary } from '../pay/OrderSummary'
import { Cancelled, Expired, LinkClosed, LoadFailed, Missing, Paused, Reading, Unavailable } from '../pay/PayStates'
import { Receipt } from '../pay/Receipt'

/* A merchant store's hosted checkout (Gully Pay for merchants, server/merchants.mjs):
     /pay/m/<invoiceId>           one invoice (made by the store, or by one of its links for one payer)
     /pay/m/<invoiceId>/receipt   its printable receipt once paid
     /pay/m/l/<linkId>            a reusable link: makes an invoice per payer, then hands over to /pay/m/<id>
   The standalone checkout frame carries the store's logo, name and accent; the payment goes straight to
   the STORE's wallet on the chosen chain (the shared Checkout, pointed at /api/pay/m/i/<id>). A paused or
   unconfigured store says so and starts no payment; a signed-in member of the store sees what to fix.
   Everything shown is the server's. */

export type { Brand }

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

const seo = (brand: Brand | null) => <Seo title={brand ? `Pay ${storeName(brand)}` : 'Pay'} bare noindex description="Pay with crypto, wallet to wallet, through Gully Pay." />

/* ------------------------------------------------------------- invoice --- */

type InvState = { k: 'loading' } | { k: 'missing' } | { k: 'error'; message: string } | { k: 'ok'; invoice: StoreInvoice; viewer: Viewer | null }

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
    <div className="flex items-center gap-4">
      <EChart option={option} height={120} skeleton="ring" label={`Invoice total ${invoice.usd} USD across ${invoice.items.length} lines`} className="max-w-[120px]">
        <span className="pointer-events-none absolute inset-0 grid place-items-center font-mono text-[11px] text-faint">{invoice.items.length} lines</span>
      </EChart>
      <span className="text-[13px] leading-[1.5] text-muted">Each line's share of the total. Hover a segment for its amount.</span>
    </div>
  )
}

export function MerchantInvoicePage() {
  const { id } = useParams()
  const [state, setState] = useState<InvState>({ k: 'loading' })
  const load = useCallback(() => {
    const read: Promise<InvState> = !id
      ? Promise.resolve({ k: 'missing' })
      : payApi<{ invoice: StoreInvoice; viewer: Viewer | null }>(`/api/pay/m/i/${encodeURIComponent(id)}`).then((r): InvState => (r.ok ? { k: 'ok', invoice: r.data.invoice, viewer: r.data.viewer ?? null } : r.status === 404 ? { k: 'missing' } : { k: 'error', message: r.error }))
    read.then(setState)
  }, [id])
  useEffect(() => {
    load()
  }, [load])
  return (
    <>
      {seo(state.k === 'ok' ? state.invoice.merchant : null)}
      {state.k === 'loading' && <Reading what="invoice" />}
      {state.k === 'missing' && <Missing what="invoice" text="This link does not match an invoice. Check that it was copied whole, or ask the store that sent it." />}
      {state.k === 'error' && <LoadFailed what="invoice" message={state.message} retry={load} />}
      {state.k === 'ok' && <StoreInvoiceView invoice={state.invoice} viewer={state.viewer} onPaid={(i) => setState({ k: 'ok', invoice: i as unknown as StoreInvoice, viewer: state.viewer })} />}
    </>
  )
}

function StoreInvoiceView({ invoice, viewer, onPaid }: { invoice: StoreInvoice; viewer: Viewer | null; onPaid: (i: Invoice) => void }) {
  const [params] = useSearchParams()
  const [phase, setPhase] = useState<Phase>('choose')
  const brand = invoice.merchant
  const accent = accentOf(brand)
  const open = invoice.status === 'open'
  const live = open && invoice.checkout.enabled
  const pill = invoice.status === 'paid' ? pills.paid : invoice.status === 'expired' ? pills.expired : invoice.status === 'cancelled' ? pills.cancelled : invoice.checkout.paused ? pills.paused : !invoice.checkout.enabled ? pills.closed : phase === 'confirming' ? pills.confirming : invoice.overdue ? pills.overdue : pills.waiting
  const chains = Object.keys(invoice.recipients)
  const meta: [string, ReactNode][] = []
  if (invoice.customer) meta.push(['BILLED TO', invoice.customer.name])
  meta.push(['ISSUED', fmtDay(invoice.createdAt)])
  if (invoice.dueAt) meta.push(['DUE', <span className={invoice.overdue ? 'text-error' : undefined}>{fmtDay(invoice.dueAt)}</span>])
  if (chains.length > 0 && open)
    meta.push([
      'PAID TO',
      <span className="flex flex-col gap-1">
        {chains.map((c) => {
          const a = invoice.assets.find((x) => String(x.chainId) === c)
          return (
            <span key={c} className="inline-flex min-w-0 items-center gap-2 break-all">
              <ChainLogo chain={a?.chainKey ?? c} size={14} decorative /> {invoice.recipients[c]}
            </span>
          )
        })}
      </span>,
    ])

  return (
    <CheckoutFrame
      brand={brand}
      bar={live && phase !== 'paid'}
      summary={
        <OrderSummary brand={brand} eyebrow={invoice.linkId ? 'Payment' : `Invoice ${invoice.number}`} title={invoice.title} items={invoice.items} total={invoice.usd} description={invoice.note} meta={meta}>
          {invoice.items.length > 1 && <ItemsRing invoice={invoice} accent={accent.color} />}
        </OrderSummary>
      }
    >
      <PayPanel title={`Pay ${storeName(brand)}`} sub={`${window.location.host}/pay/m/${invoice.id}`} pill={pill}>
        {invoice.status === 'paid' && <PaidPanel invoice={invoice as unknown as Invoice} brand={brand} receiptPath={`/pay/m/${invoice.id}/receipt`} />}
        {invoice.status === 'expired' && <Expired when={fmtDay(invoice.expiresAt)} brand={brand} fromLink={!!invoice.linkId} />}
        {invoice.status === 'cancelled' && <Cancelled when={fmtDay(invoice.cancelledAt)} brand={brand} />}
        {open && invoice.checkout.paused && <Paused brand={brand} viewer={viewer} />}
        {open && !invoice.checkout.enabled && !invoice.checkout.paused && <Unavailable brand={brand} reason={invoice.checkout.reason} viewer={viewer} />}
        {live && <Checkout invoice={invoice as unknown as Invoice} initialAsset={params.get('asset')} onPaid={onPaid} onPhase={setPhase} api={`/api/pay/m/i/${invoice.id}`} brand={brand} />}
      </PayPanel>
    </CheckoutFrame>
  )
}

/** /pay/m/<id>/receipt: the store invoice's printable receipt. */
export function MerchantReceiptPage() {
  return <Receipt api="/api/pay/m/i" back={(id) => `/pay/m/${id}`} />
}

/* ---------------------------------------------------------------- link --- */

type LinkState = { k: 'loading' } | { k: 'missing' } | { k: 'error'; message: string } | { k: 'ok'; link: StoreLink; viewer: Viewer | null }

export function MerchantLinkPage() {
  const { id } = useParams()
  const [state, setState] = useState<LinkState>({ k: 'loading' })
  const load = useCallback(() => {
    const read: Promise<LinkState> = !id
      ? Promise.resolve({ k: 'missing' })
      : payApi<{ link: StoreLink; viewer: Viewer | null }>(`/api/pay/m/l/${encodeURIComponent(id)}`).then((r): LinkState => (r.ok ? { k: 'ok', link: r.data.link, viewer: r.data.viewer ?? null } : r.status === 404 ? { k: 'missing' } : { k: 'error', message: r.error }))
    read.then(setState)
  }, [id])
  useEffect(() => {
    load()
  }, [load])
  return (
    <>
      {seo(state.k === 'ok' ? state.link.merchant : null)}
      {state.k === 'loading' && <Reading what="payment link" />}
      {state.k === 'missing' && <Missing what="payment link" text="This address does not match a payment link. Check that it was copied whole, or ask the store for a new one." />}
      {state.k === 'error' && <LoadFailed what="payment link" message={state.message} retry={load} />}
      {state.k === 'ok' && <StoreLinkView link={state.link} viewer={state.viewer} />}
    </>
  )
}

function StoreLinkView({ link, viewer }: { link: StoreLink; viewer: Viewer | null }) {
  const brand = link.merchant
  const live = link.state === 'active' && link.checkout.enabled
  const pill = link.checkout.paused ? pills.paused : link.state !== 'active' || !link.checkout.enabled ? pills.closed : pills.link
  return (
    <CheckoutFrame
      brand={brand}
      bar={live}
      summary={
        <OrderSummary brand={brand} eyebrow={`Pay ${storeName(brand)}`} title={link.title} items={linkItems(link)} total={link.amount.type === 'fixed' ? link.amount.usd : null} description={link.description}>
          {link.assets.length > 0 && <LinkCharts assets={link.assets} />}
        </OrderSummary>
      }
    >
      <PayPanel title={`Pay ${storeName(brand)}`} sub={`${window.location.host}/pay/m/l/${link.id}`} pill={pill} label="Start a payment">
        {link.state !== 'active' && <LinkClosed state={link.state} text={link.stateText} brand={brand} viewer={viewer} />}
        {link.state === 'active' && link.checkout.paused && <Paused brand={brand} viewer={viewer} />}
        {link.state === 'active' && !link.checkout.enabled && !link.checkout.paused && <Unavailable brand={brand} reason={link.checkout.reason} viewer={viewer} />}
        {live && <LinkForm link={link} api={`/api/pay/m/l/${link.id}/invoice`} brand={brand} showFee />}
      </PayPanel>
    </CheckoutFrame>
  )
}
