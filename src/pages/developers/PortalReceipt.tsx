import { ArrowLeft, Printer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Wordmark } from '../../components/Wordmark'
import { ChainLogo } from '../../components/logos/ChainLogo'
import { api, type BillingView, type Payment } from './api'
import { fmtDateTime, usePortal } from './portal'

/* A printable receipt for one plan payment (#receipt=<chainId>:<txHash>), in the style of the Gully Pay
   receipt (src/pages/pay/Receipt.tsx): black on white, one page, no console chrome when printed. The
   payment comes from GET /api/developer/billing (verified on chain by the server); the "billed to"
   block is the active workspace and its company details (Settings → Company). */

function Row({ k, v, mono = false, href }: { k: string; v: string; mono?: boolean; href?: string | null }) {
  return (
    <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-4 border-b border-[#d9dde3] py-[10px] last:border-b-0 max-[600px]:grid-cols-1 max-[600px]:gap-1 print:break-inside-avoid">
      <dt className="font-mono text-[11px] tracking-[1px] text-[#5c6878]">{k}</dt>
      <dd className={`m-0 break-all text-[#0b0e13] ${mono ? 'font-mono text-[13px]' : 'text-[15px]'}`}>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-[#9aa4b2] underline-offset-2 print:no-underline">
            {v}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          v
        )}
      </dd>
    </div>
  )
}

type State = { k: 'loading' } | { k: 'missing' } | { k: 'error'; message: string } | { k: 'ok'; p: Payment }

export function PortalReceipt({ id, onBack }: { id: string; onBack: () => void }) {
  const { me } = usePortal()
  const [s, setS] = useState<State>({ k: 'loading' })
  useEffect(() => {
    let alive = true
    const [chain, tx] = id.split(':')
    api<BillingView>('/api/developer/billing').then((r) => {
      if (!alive) return
      if (!r.ok) return setS({ k: 'error', message: r.error })
      const p = r.data.payments.find((x) => String(x.chainId) === chain && x.txHash.toLowerCase() === (tx ?? '').toLowerCase())
      setS(p ? { k: 'ok', p } : { k: 'missing' })
    })
    return () => {
      alive = false
    }
  }, [id])
  useEffect(() => {
    const t = document.title
    document.title = 'Receipt · Gully Labs'
    return () => {
      document.title = t
    }
  }, [])

  const c = me?.company
  return (
    <div className="min-h-screen bg-[#fff] px-4 py-10 text-[#0b0e13] print:min-h-0 print:p-0" data-testid="portal-receipt">
      <div className="mx-auto flex max-w-[760px] flex-col gap-8">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2 font-mono text-[13px] text-[#3a4452] hover:underline">
            <ArrowLeft size={14} aria-hidden /> Back to billing
          </button>
          {s.k === 'ok' && (
            <button type="button" onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-[#0b0e13] px-4 text-[14px] font-semibold hover:bg-[#0b0e13] hover:text-[#fff]">
              <Printer size={15} aria-hidden /> Print or save as PDF
            </button>
          )}
        </div>
        {s.k === 'loading' && <p className="m-0 font-mono text-[13px] text-[#5c6878]">Reading the receipt…</p>}
        {s.k === 'missing' && <p className="m-0 text-[16px]">No payment of this workspace matches this receipt.</p>}
        {s.k === 'error' && <p className="m-0 text-[16px]">The receipt could not be read: {s.message}</p>}
        {s.k === 'ok' && (
          <article className="flex flex-col gap-7 rounded-card border border-[#d9dde3] p-8 max-[600px]:p-5 print:rounded-none print:border-0 print:p-0">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-col gap-2">
                <Wordmark size={26} />
                <span className="font-mono text-[12px] text-[#5c6878]">gullylabs.xyz · hello@gullylabs.xyz</span>
              </div>
              <div className="flex flex-col items-end gap-1 text-right max-[600px]:items-start max-[600px]:text-left">
                <h1 className="m-0 font-display text-[34px] leading-none font-extrabold uppercase">Receipt</h1>
                <span className="font-mono text-[12px] text-[#5c6878]">{s.p.id ?? s.p.txHash.slice(0, 18)}</span>
              </div>
            </header>
            <div className="grid grid-cols-2 gap-6 max-[600px]:grid-cols-1">
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[11px] tracking-[1px] text-[#5c6878]">BILLED TO</span>
                <span className="text-[16px] font-semibold">{c?.name ?? me?.active.name ?? 'Workspace'}</span>
                {c?.address && <span className="text-[14px] whitespace-pre-line text-[#3a4452]">{c.address}</span>}
                {c?.taxId && <span className="font-mono text-[13px] text-[#3a4452]">Tax ID {c.taxId}</span>}
                <span className="font-mono text-[12px] break-all text-[#5c6878]">workspace {me?.active.name} · owner {me?.active.owner}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-mono text-[11px] tracking-[1px] text-[#5c6878]">FROM</span>
                <span className="text-[16px] font-semibold">Gully Labs</span>
                <span className="inline-flex items-center gap-2 text-[13px] text-[#3a4452]">
                  <ChainLogo chain={s.p.chain} size={16} decorative /> paid on {s.p.chain}
                </span>
                <span className="text-[14px] text-[#3a4452]">Developer API plans</span>
              </div>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-4 border-y border-[#0b0e13] py-5">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-mono text-[11px] tracking-[1px] text-[#5c6878]">FOR</span>
                <span className="text-[20px] font-semibold break-words capitalize">{s.p.plan ?? s.p.kind} plan</span>
                <span className="text-[14px] text-[#3a4452]">
                  {fmtDateTime(s.p.periodStart)} – {fmtDateTime(s.p.expiresAt)}
                </span>
              </div>
              <div className="flex flex-col items-end gap-1 max-[600px]:items-start">
                <span className="rounded-full border-2 border-[#1d7a36] px-3 py-[2px] font-mono text-[12px] font-semibold tracking-[1px] text-[#1d7a36]">PAID IN FULL</span>
                <span className="font-display text-[36px] leading-none font-extrabold">{s.p.usd ? `${s.p.usd} USD` : `${s.p.amount} ${s.p.symbol}`}</span>
              </div>
            </div>
            <dl className="m-0 flex flex-col">
              <Row k="PAID" v={`${s.p.amount} ${s.p.symbol} on ${s.p.chain} (chain ${s.p.chainId})`} />
              {s.p.price && <Row k="PRICE USED" v={`1 ${s.p.symbol} = ${s.p.price.answer} USD (Chainlink ${s.p.price.description}, round ${s.p.price.roundId})`} />}
              <Row k="CONFIRMED" v={fmtDateTime(s.p.at)} />
              <Row k="FROM WALLET" v={s.p.from} mono />
              <Row k="TO (TREASURY)" v={s.p.to ?? '—'} mono />
              <Row k="TRANSACTION" v={s.p.txHash} mono href={s.p.txUrl} />
              <Row k="BLOCK" v={String(s.p.blockNumber)} mono />
            </dl>
            <p className="m-0 text-[12px] leading-[1.6] text-[#5c6878]">This receipt records a payment checked on chain by Gully Labs: the transaction succeeded, paid the Gully Labs treasury the amount quoted for this plan, and had the chain’s required confirmations. Anyone can check it on the chain’s explorer with the transaction hash above. It is not a tax invoice.</p>
          </article>
        )}
      </div>
    </div>
  )
}
