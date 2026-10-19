import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { Seo } from '../../components/Seo'
import { Checkout, PaidPanel, type Phase } from './Checkout'
import { GULLY_BRAND, pills } from './brand'
import { CheckoutFrame, PayPanel } from './CheckoutFrame'
import { fmtDay, useInvoice, type Invoice } from './invoice'
import { OrderSummary } from './OrderSummary'
import { Cancelled, Expired, LoadFailed, Missing, Reading, Unavailable } from './PayStates'

/* /pay/<invoiceId>: the standalone checkout of a Gully Pay invoice, made by an admin or by a pay link
   (/pay/l/<link>). Anyone holding the link can pay it, from a wallet or by pasting a transaction hash.
   The id is unguessable and the page is never indexed. Everything shown comes from GET /api/pay/:id. */

const SEO = <Seo title="Pay Gully Labs" bare noindex description="Pay a Gully Labs invoice in ETH, BNB, USDC or USDT, straight to the Gully Labs treasury." />

export function PayPage() {
  const { id } = useParams()
  const [state, retry, set] = useInvoice(id)
  return (
    <>
      {SEO}
      {state.k === 'loading' && <Reading what="invoice" />}
      {state.k === 'missing' && <Missing what="invoice" text="This link does not match an invoice. Check that it was copied whole, or write to team@gullylabs.xyz." />}
      {state.k === 'error' && <LoadFailed what="invoice" message={state.message} retry={retry} />}
      {state.k === 'ok' && <InvoiceView invoice={state.invoice} onPaid={set} />}
    </>
  )
}

function InvoiceView({ invoice, onPaid }: { invoice: Invoice; onPaid: (i: Invoice) => void }) {
  const [params] = useSearchParams()
  const [phase, setPhase] = useState<Phase>('choose')
  const open = invoice.status === 'open'
  const live = open && invoice.checkout.enabled
  const pill = invoice.status === 'paid' ? pills.paid : invoice.status === 'expired' ? pills.expired : invoice.status === 'cancelled' ? pills.cancelled : !invoice.checkout.enabled ? pills.closed : phase === 'confirming' ? pills.confirming : pills.waiting
  const payBy = invoice.linkId ? new Date(invoice.expiresAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : fmtDay(invoice.expiresAt)

  return (
    <CheckoutFrame
      brand={GULLY_BRAND}
      bar={live && phase !== 'paid'}
      summary={
        <OrderSummary
          brand={GULLY_BRAND}
          eyebrow={invoice.linkId ? 'Gully Pay' : `Invoice ${invoice.number}`}
          title={invoice.title}
          items={[{ description: invoice.title, quantity: 1, unitUsd: invoice.usd, totalUsd: invoice.usd }]}
          total={invoice.usd}
          description={invoice.note}
          meta={[
            ['NUMBER', invoice.number],
            ['ISSUED', fmtDay(invoice.createdAt)],
            [invoice.status === 'expired' ? 'EXPIRED' : 'PAY BY', payBy],
          ]}
        />
      }
    >
      <PayPanel title="Pay Gully Labs" sub={`${window.location.host}/pay/${invoice.id}`} pill={pill}>
        {invoice.status === 'paid' && <PaidPanel invoice={invoice} />}
        {invoice.status === 'expired' && <Expired when={fmtDay(invoice.expiresAt)} brand={GULLY_BRAND} fromLink={!!invoice.linkId} />}
        {invoice.status === 'cancelled' && <Cancelled when={fmtDay(invoice.cancelledAt)} brand={GULLY_BRAND} />}
        {open && !invoice.checkout.enabled && <Unavailable brand={GULLY_BRAND} reason={invoice.checkout.reason} />}
        {live && <Checkout invoice={invoice} initialAsset={params.get('asset')} onPaid={onPaid} onPhase={setPhase} />}
      </PayPanel>
    </CheckoutFrame>
  )
}
