import { Ban, Clock, Loader2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { Seo } from '../../components/Seo'
import { btnOutline, eyebrow } from '../../components/ui'
import { Checkout, PaidPanel, type Phase } from './Checkout'
import { fmtDay, useInvoice, type Invoice } from './invoice'

/* /pay/<invoiceId>: the hosted checkout of a Gully Pay invoice, made by an admin or by a pay link
   (/pay/l/<link>). Anyone holding the link can pay it, from a wallet or by pasting a transaction hash.
   The id is unguessable and the page is never indexed. Everything shown comes from GET /api/pay/:id. */

const rise = (i: number) => ({ animation: `gl-rise .5s ${i * 0.07}s ease both` })

type Pill = { text: string; cls: string }
function pillFor(invoice: Invoice, phase: Phase): Pill {
  if (invoice.status === 'paid') return { text: 'Paid', cls: 'bg-success-bg text-green border-success-line' }
  if (invoice.status === 'expired') return { text: 'Expired', cls: 'bg-grid text-muted border-line-strong' }
  if (invoice.status === 'cancelled') return { text: 'Cancelled', cls: 'bg-grid text-muted border-line-strong' }
  if (!invoice.checkout.enabled) return { text: 'Checkout closed', cls: 'bg-grid text-muted border-line-strong' }
  if (phase === 'confirming') return { text: 'Confirming', cls: 'bg-[rgba(232,192,96,.15)] text-gold border-gold-line' }
  return { text: 'Awaiting payment', cls: 'bg-grid text-ink-2 border-line-strong' }
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <section className="relative overflow-hidden px-page pt-[56px] pb-24 max-[600px]:pt-8">
      <div aria-hidden className="pointer-events-none absolute -top-40 right-[-10%] size-[620px] animate-glow rounded-full bg-[radial-gradient(circle,rgba(232,192,96,.10),transparent_62%)]" />
      <div className="relative mx-auto flex max-w-[1120px] flex-col gap-6" aria-live="polite">
        {children}
      </div>
    </section>
  )
}

export function Notice({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <p className="m-0 flex items-start gap-3 rounded-input border border-line-strong bg-bg px-4 py-4 text-[15px] leading-[1.6] text-ink-2" role="status">
      {icon}
      <span>{children}</span>
    </p>
  )
}

export function Missing({ what, text }: { what: string; text: string }) {
  return (
    <div className="flex flex-col gap-4">
      <span className={eyebrow}>GULLY PAY</span>
      <h1 className="m-0 font-display text-[clamp(40px,9vw,72px)] leading-[.9] font-extrabold uppercase">No such {what}</h1>
      <p className="m-0 max-w-[620px] text-[17px] leading-[1.6] text-muted">{text}</p>
    </div>
  )
}

export function PayPage() {
  const { id } = useParams()
  const [state, retry, set] = useInvoice(id)

  return (
    <>
      <Seo title={state.k === 'ok' ? `Invoice ${state.invoice.number}` : 'Invoice'} description="Pay a Gully Labs invoice in ETH, BNB, USDC or USDT, straight to the Gully Labs treasury." />
      <Shell>
        {state.k === 'loading' && (
          <p className="m-0 inline-flex items-center gap-3 font-mono text-[13px] text-faint">
            <Loader2 size={16} className="animate-spin" aria-hidden /> Reading the invoice…
          </p>
        )}
        {state.k === 'missing' && <Missing what="invoice" text="This link does not match an invoice. Check that it was copied whole, or write to hello@gullylabs.xyz." />}
        {state.k === 'error' && (
          <div className="flex flex-wrap items-center gap-4 rounded-card border border-[#5a2a24] bg-[rgba(255,138,122,.06)] px-6 py-5 text-[15px] text-error" role="alert">
            The invoice could not be read: {state.message}
            <button type="button" onClick={retry} className={`${btnOutline} min-h-11 px-5 text-[14px]`}>
              Try again
            </button>
          </div>
        )}
        {state.k === 'ok' && <InvoiceView invoice={state.invoice} onPaid={set} />}
      </Shell>
    </>
  )
}

function InvoiceView({ invoice, onPaid }: { invoice: Invoice; onPaid: (i: Invoice) => void }) {
  const [params] = useSearchParams()
  const [phase, setPhase] = useState<Phase>('choose')
  const pill = pillFor(invoice, phase)
  const host = window.location.host

  return (
    <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,600px)]">
      <div className="flex min-w-0 flex-col gap-4" style={rise(0)}>
        <span className={eyebrow}>{invoice.linkId ? 'GULLY PAY' : `INVOICE ${invoice.number}`}</span>
        <h1 className="m-0 font-display text-[clamp(36px,8vw,64px)] leading-[.92] font-extrabold break-words uppercase">{invoice.title}</h1>
        <span className="font-display text-[clamp(40px,9vw,60px)] leading-none font-extrabold text-gold">
          {invoice.usd} <span className="font-mono text-[14px] font-normal text-faint">USD</span>
        </span>
        {invoice.note && <p className="m-0 max-w-[620px] text-[16px] leading-[1.6] whitespace-pre-line text-muted">{invoice.note}</p>}
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 font-mono text-[12px]">
          <dt className="text-faint">NUMBER</dt>
          <dd className="m-0 text-ink-2">{invoice.number}</dd>
          <dt className="text-faint">ISSUED</dt>
          <dd className="m-0 text-ink-2">{fmtDay(invoice.createdAt)}</dd>
          <dt className="text-faint">{invoice.status === 'expired' ? 'EXPIRED' : 'PAY BY'}</dt>
          <dd className="m-0 text-ink-2">{invoice.linkId ? new Date(invoice.expiresAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : fmtDay(invoice.expiresAt)}</dd>
        </dl>
      </div>

      <section className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface" style={rise(1)} aria-label="Checkout">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3 max-[600px]:px-4">
          <span className="flex min-w-0 flex-col leading-[1.25]">
            <b className="truncate text-[15px] font-semibold">{invoice.title}</b>
            <span className="truncate font-mono text-[11px] text-faint">
              {host}/pay/{invoice.id}
            </span>
          </span>
          <span className={`shrink-0 rounded-full border px-3 py-[3px] text-[12px] font-semibold transition-colors duration-300 ${pill.cls}`}>{pill.text}</span>
        </header>
        <div className="flex flex-col gap-5 p-5 max-[600px]:p-4">
          {invoice.status === 'paid' && <PaidPanel invoice={invoice} />}
          {invoice.status === 'expired' && (
            <Notice icon={<Clock size={18} className="mt-[3px] shrink-0 text-faint" aria-hidden />}>
              This invoice expired on {fmtDay(invoice.expiresAt)} without a payment. {invoice.linkId ? 'Open the payment link again to start a new checkout.' : 'Ask Gully Labs for a new one at hello@gullylabs.xyz.'} If you paid it in time, write to hello@gullylabs.xyz with the transaction hash.
            </Notice>
          )}
          {invoice.status === 'cancelled' && (
            <Notice icon={<Ban size={18} className="mt-[3px] shrink-0 text-faint" aria-hidden />}>
              This invoice was cancelled on {fmtDay(invoice.cancelledAt)} and cannot be paid. Write to hello@gullylabs.xyz if you think this is a mistake.
            </Notice>
          )}
          {invoice.status === 'open' && !invoice.checkout.enabled && <Notice icon={<Ban size={18} className="mt-[3px] shrink-0 text-faint" aria-hidden />}>{invoice.checkout.reason} Nothing can be sent for it here; write to hello@gullylabs.xyz.</Notice>}
          {invoice.status === 'open' && invoice.checkout.enabled && <Checkout invoice={invoice} initialAsset={params.get('asset')} onPaid={onPaid} onPhase={setPhase} />}
        </div>
      </section>
    </div>
  )
}
