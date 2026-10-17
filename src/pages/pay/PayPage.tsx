import { ArrowUpRight, CheckCircle2, FileText, Loader2, ShieldCheck } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { QuotePay } from '../../components/pay/QuotePay'
import { Seo } from '../../components/Seo'
import { btnOutline, eyebrow } from '../../components/ui'
import { api, shortAddress, type Quote } from '../developers/api'
import { card, cardTitle, sub } from '../developers/styles'
import { fmtDay, fmtTime, useInvoice, type Invoice, type InvoiceStatus } from './invoice'

/* /pay/<invoiceId>: a Gully Pay invoice anyone holding the link can pay, from a wallet or by pasting a
   transaction hash. The id is unguessable and the page is never indexed. Everything shown comes from
   GET /api/pay/:id. */

const rise = (i: number) => ({ animation: `gl-rise .55s ${i * 0.07}s ease both` })

const STATUS: Record<InvoiceStatus, { text: string; cls: string }> = {
  open: { text: 'OPEN', cls: 'border-gold-line text-gold' },
  paid: { text: 'PAID', cls: 'border-success-line bg-success-bg text-green' },
  expired: { text: 'EXPIRED', cls: 'border-line-strong text-muted' },
  cancelled: { text: 'CANCELLED', cls: 'border-line-strong text-muted' },
}

function Paid({ invoice }: { invoice: Invoice }) {
  const p = invoice.payment
  return (
    <section className={`${card} border-success-line`}>
      <div className="flex items-start gap-3">
        <CheckCircle2 size={22} className="mt-[2px] shrink-0 text-green" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className={cardTitle}>Paid</h2>
          <span className="text-[15px] text-muted">{p ? `${p.amount} ${p.symbol} on ${p.chain}, confirmed ${fmtTime(invoice.paidAt)}.` : `Paid ${fmtTime(invoice.paidAt)}.`}</span>
          {p?.txUrl && (
            <a href={p.txUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-mono text-[12px] break-all text-ink-2 hover:text-gold">
              Transaction {shortAddress(p.txHash)} <ArrowUpRight size={12} aria-hidden />
            </a>
          )}
        </div>
      </div>
      <div>
        <Link to={`/pay/${invoice.id}/receipt`} className={`${btnOutline} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
          <FileText size={16} aria-hidden /> Receipt
        </Link>
      </div>
    </section>
  )
}

export function PayPage() {
  const { id } = useParams()
  const [state, retry, set] = useInvoice(id)

  return (
    <>
      <Seo title={state.k === 'ok' ? `Invoice ${state.invoice.number}` : 'Invoice'} description="Pay a Gully Labs invoice in ETH, BNB, USDC or USDT, straight to the Gully Labs treasury." />
      <section className="relative overflow-hidden px-page pt-[72px] pb-24">
        <div aria-hidden className="pointer-events-none absolute -top-40 right-[-10%] size-[620px] animate-glow rounded-full bg-[radial-gradient(circle,rgba(232,192,96,.12),transparent_62%)]" />
        <div className="relative mx-auto flex max-w-[960px] flex-col gap-6" aria-live="polite">
          {state.k === 'loading' && (
            <p className="m-0 inline-flex items-center gap-3 font-mono text-[13px] text-faint">
              <Loader2 size={16} className="animate-spin" aria-hidden /> Reading the invoice…
            </p>
          )}
          {state.k === 'missing' && (
            <div className="flex flex-col gap-4">
              <span className={eyebrow}>GULLY PAY</span>
              <h1 className="m-0 font-display text-[clamp(44px,5.5cqw,72px)] leading-[.9] font-extrabold uppercase">No such invoice</h1>
              <p className="m-0 max-w-[620px] text-[17px] leading-[1.6] text-muted">This link does not match an invoice. Check that it was copied whole, or write to hello@gullylabs.xyz.</p>
            </div>
          )}
          {state.k === 'error' && (
            <div className="flex flex-wrap items-center gap-4 rounded-card border border-[#5a2a24] bg-[rgba(255,138,122,.06)] px-6 py-5 text-[15px] text-error" role="alert">
              The invoice could not be read: {state.message}
              <button type="button" onClick={retry} className={`${btnOutline} min-h-11 px-5 text-[14px]`}>
                Try again
              </button>
            </div>
          )}
          {state.k === 'ok' && <InvoiceView invoice={state.invoice} onPaid={set} />}
        </div>
      </section>
    </>
  )
}

function InvoiceView({ invoice, onPaid }: { invoice: Invoice; onPaid: (i: Invoice) => void }) {
  const s = STATUS[invoice.status]
  return (
    <>
      <div className="flex flex-col gap-4" style={rise(0)}>
        <div className="flex flex-wrap items-center gap-3">
          <span className={eyebrow}>INVOICE {invoice.number}</span>
          <span className={`rounded-full border px-3 py-[3px] font-mono text-[11px] tracking-[1px] ${s.cls}`}>{s.text}</span>
        </div>
        <h1 className="m-0 font-display text-[clamp(40px,5cqw,68px)] leading-[.92] font-extrabold break-words uppercase">{invoice.title}</h1>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <span className="font-display text-[clamp(44px,5cqw,64px)] leading-none font-extrabold text-gold">
            {invoice.usd} <span className="font-mono text-[14px] font-normal text-faint">USD</span>
          </span>
          <dl className="m-0 grid grid-cols-[auto_auto] gap-x-4 gap-y-1 font-mono text-[12px]">
            <dt className="text-faint">ISSUED</dt>
            <dd className="m-0 text-ink-2">{fmtDay(invoice.createdAt)}</dd>
            <dt className="text-faint">{invoice.status === 'expired' ? 'EXPIRED' : 'DUE BY'}</dt>
            <dd className="m-0 text-ink-2">{fmtDay(invoice.expiresAt)}</dd>
          </dl>
        </div>
        {invoice.note && <p className="m-0 max-w-[720px] text-[16px] leading-[1.6] whitespace-pre-line text-muted">{invoice.note}</p>}
      </div>

      <div style={rise(1)}>
        {invoice.status === 'paid' && <Paid invoice={invoice} />}
        {invoice.status === 'expired' && <p className="m-0 rounded-card border border-line-strong bg-surface px-6 py-5 text-[15px] text-ink-2">This invoice expired on {fmtDay(invoice.expiresAt)} without a payment. Ask Gully Labs for a new one at hello@gullylabs.xyz. If you paid it in time, write with the transaction hash.</p>}
        {invoice.status === 'cancelled' && <p className="m-0 rounded-card border border-line-strong bg-surface px-6 py-5 text-[15px] text-ink-2">This invoice was cancelled on {fmtDay(invoice.cancelledAt)} and cannot be paid. Write to hello@gullylabs.xyz if you think this is a mistake.</p>}
        {invoice.status === 'open' &&
          (!invoice.checkout.enabled ? (
            <p className="m-0 rounded-card border border-line-strong bg-surface px-6 py-5 text-[15px] text-ink-2" role="status">
              {invoice.checkout.reason}
            </p>
          ) : (
            <section className={card}>
              <div className="flex flex-col gap-[6px]">
                <h2 className={cardTitle}>Pay this invoice</h2>
                <span className={sub}>Choose a chain and asset · the quote holds for 20 minutes · no account needed</span>
              </div>
              <QuotePay
                assets={invoice.assets}
                label={invoice.number}
                match="exact"
                initialAsset={invoice.assets.length === 1 ? invoice.assets[0].id : null}
                getQuote={(asset) => api<{ quote: Quote }>(`/api/pay/${invoice.id}/quote`, { method: 'POST', body: { asset } })}
                verify={(q, txHash) => api(`/api/pay/${invoice.id}/verify`, { method: 'POST', body: { quoteId: q.id, txHash } })}
                onPaid={(data) => onPaid((data as { invoice: Invoice }).invoice)}
              />
              <p className="m-0 flex items-start gap-2 border-t border-line pt-4 text-[13px] leading-[1.6] text-faint">
                <ShieldCheck size={15} className="mt-[2px] shrink-0 text-gold" aria-hidden />
                Your transfer goes straight to the Gully Labs treasury wallet; nobody holds it in between. The server reads it from a public node of its chain and marks this invoice paid once it has enough confirmations. Each transaction counts once.
              </p>
            </section>
          ))}
      </div>
    </>
  )
}
