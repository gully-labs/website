import { ArrowLeft, Printer } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useParams } from 'react-router'
import { Wordmark } from '../../components/Wordmark'
import { fmtDay, fmtTime, useInvoice } from './invoice'

/* /pay/<invoiceId>/receipt: a plain, printable receipt for a paid invoice. It has no site chrome and
   prints black on white; every line comes from GET /api/pay/:id (the payment as verified on chain). */

function Row({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[170px_minmax(0,1fr)] gap-4 border-b border-[#d9dde3] py-3 last:border-b-0 max-[600px]:grid-cols-1 max-[600px]:gap-1">
      <dt className="font-mono text-[11px] tracking-[1px] text-[#5c6878]">{k}</dt>
      <dd className={`m-0 break-all text-[#0b0e13] ${mono ? 'font-mono text-[13px]' : 'text-[15px]'}`}>{v}</dd>
    </div>
  )
}

export function Receipt() {
  const { id } = useParams()
  const [state] = useInvoice(id)

  useEffect(() => {
    document.title = 'Receipt · Gully Labs'
  }, [])

  const inv = state.k === 'ok' ? state.invoice : null
  const p = inv?.payment ?? null

  return (
    <div className="min-h-screen bg-[#fff] px-4 py-10 text-[#0b0e13] print:p-0">
      <div className="mx-auto flex max-w-[760px] flex-col gap-8">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link to={`/pay/${id}`} className="inline-flex min-h-11 items-center gap-2 font-mono text-[13px] text-[#3a4452] hover:underline">
            <ArrowLeft size={14} aria-hidden /> Back to the invoice
          </Link>
          {p && (
            <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-[#0b0e13] px-4 text-[14px] font-semibold hover:bg-[#0b0e13] hover:text-[#fff]">
              <Printer size={15} aria-hidden /> Print or save as PDF
            </button>
          )}
        </div>

        {state.k === 'loading' && <p className="m-0 font-mono text-[13px] text-[#5c6878]">Reading the receipt…</p>}
        {(state.k === 'missing' || state.k === 'error') && <p className="m-0 text-[16px]">{state.k === 'missing' ? 'No such invoice.' : `The receipt could not be read: ${state.message}`}</p>}
        {inv && !p && <p className="m-0 text-[16px]">Invoice {inv.number} is {inv.status}; a receipt exists once it is paid.</p>}

        {inv && p && (
          <article className="flex flex-col gap-8 rounded-card border border-[#d9dde3] p-8 max-[600px]:p-5 print:border-0 print:p-0">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-col gap-2">
                <Wordmark size={26} />
                <span className="font-mono text-[12px] text-[#5c6878]">gullylabs.xyz · hello@gullylabs.xyz</span>
              </div>
              <div className="flex flex-col items-end gap-1 text-right max-[600px]:items-start max-[600px]:text-left">
                <h1 className="m-0 font-display text-[34px] leading-none font-extrabold uppercase">Receipt</h1>
                <span className="font-mono text-[12px] text-[#5c6878]">for invoice {inv.number}</span>
              </div>
            </header>

            <div className="flex flex-col gap-1">
              <span className="font-mono text-[11px] tracking-[1px] text-[#5c6878]">FOR</span>
              <span className="text-[20px] font-semibold">{inv.title}</span>
              {inv.note && <span className="text-[14px] whitespace-pre-line text-[#3a4452]">{inv.note}</span>}
            </div>

            <dl className="m-0 flex flex-col">
              <Row k="AMOUNT DUE" v={`${inv.usd} USD`} />
              <Row k="PAID" v={`${p.amount} ${p.symbol} on ${p.chain}`} />
              {p.price && <Row k="PRICE USED" v={`1 ${p.symbol} = ${p.price.answer} USD (Chainlink ${p.price.description}, round ${p.price.roundId}, updated ${fmtTime(p.price.updatedAt)})`} />}
              <Row k="CONFIRMED" v={fmtTime(inv.paidAt)} />
              <Row k="ISSUED" v={fmtDay(inv.createdAt)} />
              <Row k="FROM WALLET" v={p.from} mono />
              <Row k="TO (TREASURY)" v={p.to ?? '—'} mono />
              <Row k="TRANSACTION" v={p.txHash} mono />
              {p.txUrl && <Row k="EXPLORER" v={p.txUrl} mono />}
              <Row k="BLOCK" v={String(p.blockNumber)} mono />
            </dl>

            <p className="m-0 text-[12px] leading-[1.6] text-[#5c6878]">This receipt records a payment checked on chain by Gully Labs: the transaction succeeded, paid the Gully Labs treasury exactly the amount quoted for this invoice, and had the chain’s required confirmations. It is not a tax invoice.</p>
          </article>
        )}
      </div>
    </div>
  )
}
