import type { ReactNode } from 'react'
import { Wordmark } from '../../components/brand'
import { BadgeFooterRow } from '../../components/PoweredByBadge'
import { usd, type Quote } from './chainApi'

/* The frame and the money panel the wizard and the order page share. Numbers are IBM Plex Mono. */

export function ChainShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <a href="/" aria-label="Gully Labs App" className="inline-flex min-h-11 items-center">
          <Wordmark height={24} />
        </a>
      </header>
      <main className="mx-auto flex w-full max-w-[980px] flex-1 flex-col gap-4 px-4 py-5">{children}</main>
      <footer className="px-4 py-4">
        <BadgeFooterRow />
      </footer>
    </div>
  )
}

/** Six months of what the chain would cost. Real figures from the quote; the bars ease when a choice changes them. */
function CostBars({ quote }: { quote: Quote }) {
  const months = Array.from({ length: 6 }, (_, i) => (i * 30 < quote.freeDays ? 0 : quote.monthlyUsd))
  const top = Math.max(...months, 1)
  return (
    <figure className="m-0 flex flex-col gap-1" aria-label="Cost per month for the first six months">
      <div className="flex h-12 items-end gap-1" data-testid="cost-bars">
        {months.map((m, i) => (
          <div key={i} className="flex h-full flex-1 items-end rounded-bar bg-line">
            <div className="w-full rounded-bar bg-gold transition-[height] duration-500 ease-out" style={{ height: `${Math.max(m ? (m / top) * 100 : 0, 4)}%` }} />
          </div>
        ))}
      </div>
      <figcaption className="flex justify-between font-mono text-[11px] text-faint">
        <span>Month 1</span>
        <span>Month 6</span>
      </figcaption>
    </figure>
  )
}

/** The live price summary: every figure is the server's own quote. */
export function PriceSummary({ quote }: { quote: Quote | null }) {
  return (
    <aside className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4" aria-label="Price summary" data-testid="price-summary">
      <h2 className="m-0 text-[15px] font-semibold text-ink">Price</h2>
      {!quote ? (
        <p className="m-0 font-mono text-[12px] text-faint">Working it out…</p>
      ) : (
        <>
          <p className="m-0 font-mono text-[22px] leading-tight font-medium text-ink" data-testid="price-headline">
            {quote.headline}
          </p>
          <p className="m-0 text-[13px] text-muted">{quote.after}</p>
          <CostBars quote={quote} />
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
            {quote.addons.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3">
                <span className="text-muted">{a.name}</span>
                <span className="text-right font-mono text-[12px] text-ink-2">{a.fee ?? (a.usd === null ? 'Priced with you' : a.usd === 0 ? 'Included' : `$${a.usd}/mo`)}</span>
              </li>
            ))}
          </ul>
          <p className="m-0 flex items-baseline justify-between gap-3 border-t border-line pt-3 text-[13px]">
            <span className="text-muted">{quote.testCharge ? 'Test payment today' : 'Due today'}</span>
            <span className="font-mono text-[15px] text-ink" data-testid="due-today">
              {usd(quote.dueCents)}
            </span>
          </p>
          {quote.testCharge && <p className="m-0 text-[12px] leading-[1.4] text-faint">Paid in testnet USDC.e, which has no value. No real money moves.</p>}
        </>
      )}
    </aside>
  )
}
