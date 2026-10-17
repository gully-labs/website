import { ArrowUpRight, CheckCircle2, Receipt, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { QuotePay } from '../../components/pay/QuotePay'
import { btnGold, btnOutline } from '../../components/ui'
import { isLocalHost, SITE_URL } from '../../site-host'
import { api, fmtDate, shortAddress, type Account, type BillingView, type Offer, type Payment, type Plan, type Quote } from './api'
import { Empty, ErrorLine, Skeleton } from './parts'
import { card, cardTitle, rise, sub } from './styles'

/* Plan & billing: the plan in force, the plans on offer (from the server; no price is typed here),
   checkout in ETH, BNB, USDC or USDT on Base, Ethereum, BNB Chain or Arbitrum straight to the treasury
   wallet (Gully Pay, components/pay), and the wallet's payment history. */

const PRICING_URL = isLocalHost() ? '/pricing' : `${SITE_URL}/pricing`

function Limits({ p }: { p: Plan }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px] text-muted">
      <li>
        <b className="font-medium text-ink">{p.perMin.toLocaleString('en-US')}</b> requests a minute per key
      </li>
      <li>
        <b className="font-medium text-ink">{p.alerts}</b> gap alert{p.alerts === 1 ? '' : 's'}
      </li>
      <li>
        <b className="font-medium text-ink">{p.historyDays}</b> days of gap history
      </li>
      <li>Up to {p.maxKeys} keys</li>
    </ul>
  )
}

function PlanCheckout({ plan, offer, current, onPaid, onCancel }: { plan: Plan; offer: Offer; current: BillingView['plan']; onPaid: () => void; onCancel: () => void }) {
  const [done, setDone] = useState<Payment | null>(null)
  const switching = current.expiresAt && current.id !== plan.id

  if (done)
    return (
      <section className={`${card} border-success-line`} style={rise(0)}>
        <div className="flex items-start gap-3">
          <CheckCircle2 size={22} className="mt-[2px] shrink-0 text-green" aria-hidden />
          <div className="flex flex-col gap-1">
            <h2 className={cardTitle}>Payment confirmed</h2>
            <span className="text-[15px] text-muted">
              {done.amount} {done.symbol} received on {done.chain}. {plan.name} runs until {fmtDate(done.expiresAt)}. Your keys have the new limit now.
            </span>
            {done.txUrl && (
              <a href={done.txUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-mono text-[12px] text-ink-2 hover:text-gold">
                {shortAddress(done.txHash)} <ArrowUpRight size={12} aria-hidden />
              </a>
            )}
          </div>
        </div>
        <div>
          <button type="button" onClick={onCancel} className={`${btnOutline} min-h-11 px-5 text-[15px]`}>
            Done
          </button>
        </div>
      </section>
    )

  return (
    <section className={`${card} border-gold-line`} style={rise(0)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-[6px]">
          <h2 className={cardTitle}>Pay for {plan.name}</h2>
          <span className={sub}>
            {plan.priceUsdc} USD for {offer.periodDays} days · quotes last 20 minutes
          </span>
        </div>
        <button type="button" onClick={onCancel} className="min-h-10 font-mono text-[12px] text-muted underline-offset-4 hover:text-ink hover:underline">
          Back to plans
        </button>
      </div>
      {switching && <p className="m-0 rounded-input border border-gold-line bg-[rgba(232,192,96,.06)] px-4 py-3 text-[14px] text-ink-2">You are on {current.name} until {fmtDate(current.expiresAt)}. A different plan starts today; the days left on {current.name} are not carried over.</p>}
      <QuotePay
        assets={offer.assets}
        label={`${plan.name}, ${offer.periodDays} days`}
        match="wallet"
        initialAsset="base-usdc"
        getQuote={(asset) => api<{ intent: Quote }>('/api/developer/checkout', { method: 'POST', body: { plan: plan.id, asset } }).then((r) => (r.ok ? { ...r, data: { quote: r.data.intent } } : r))}
        verify={(q, txHash) => api('/api/developer/checkout/verify', { method: 'POST', body: { plan: plan.id, quoteId: q.id, txHash } })}
        onPaid={(data) => {
          setDone((data as { payment: Payment }).payment)
          onPaid()
        }}
      />
      <p className="m-0 flex items-start gap-2 border-t border-line pt-4 text-[13px] leading-[1.6] text-faint">
        <ShieldCheck size={15} className="mt-[2px] shrink-0 text-gold" aria-hidden />
        The transfer goes straight to the Gully Labs treasury wallet, the same address on every chain; we never hold your funds or a card. The server reads it from a public node of that chain before the plan starts, and each transaction counts once.
      </p>
    </section>
  )
}

export function Billing({ account, reload }: { account: Account; reload: () => Promise<void> }) {
  const [view, setView] = useState<BillingView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [buying, setBuying] = useState<Plan | null>(null)

  const load = useCallback(
    () =>
      api<BillingView>('/api/developer/billing').then((r) => {
        if (r.ok) {
          setView(r.data)
          setErr(null)
        } else setErr(r.error)
      }),
    [],
  )
  useEffect(() => {
    load()
  }, [load])

  const onPaid = useCallback(() => {
    load()
    reload()
  }, [load, reload])

  if (err) return <ErrorLine onRetry={load}>Billing could not be read: {err}</ErrorLine>
  if (!view)
    return (
      <div className="flex flex-col gap-3">
        <Skeleton h={140} />
        <Skeleton h={220} />
      </div>
    )

  const cur = view.plan
  const offer = view.offer
  const paid = offer.plans.filter((p) => p.priceUsdc > 0)

  return (
    <div className="flex flex-col gap-5">
      <section className={card} style={rise(0)}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-[6px]">
            <span className={sub}>CURRENT PLAN</span>
            <h2 className="m-0 font-display text-[40px] leading-none font-extrabold uppercase">
              <span className={cur.id === 'free' ? 'text-ink' : 'text-gold'}>{cur.name}</span>
            </h2>
            <span className="text-[14px] text-muted">
              {cur.expiresAt ? (
                <>
                  Runs until <b className="font-medium text-ink">{fmtDate(cur.expiresAt)}</b> ({cur.source === 'admin' ? 'granted by Gully Labs' : 'paid'}). It does not renew by itself: pay again to extend it, or let it lapse to return to Free.
                </>
              ) : (
                <>Free for as long as you like. No card, no email.</>
              )}
            </span>
          </div>
          <Limits p={cur} />
        </div>
      </section>

      {buying ? (
        <PlanCheckout
          key={buying.id}
          plan={buying}
          offer={offer}
          current={cur}
          onPaid={onPaid}
          onCancel={() => {
            setBuying(null)
            load()
          }}
        />
      ) : (
        <section className={card} style={rise(1)}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-[6px]">
              <h2 className={cardTitle}>Plans</h2>
              <span className={sub}>
                Priced in USD · paid in ETH, BNB, USDC or USDT on {offer.chains.map((c) => c.name).join(', ')} · {offer.periodDays} days per payment · no subscription to cancel
              </span>
            </div>
            <a href={PRICING_URL} className="inline-flex min-h-10 items-center gap-1 font-mono text-[12px] text-muted hover:text-gold">
              Pricing page and FAQ <ArrowUpRight size={12} aria-hidden />
            </a>
          </div>
          {!offer.checkout.enabled && (
            <p className="m-0 rounded-input border border-line-strong bg-surface-deep px-4 py-3 text-[14px] text-ink-2" role="status">
              {offer.checkout.reason} The limits below are what each plan will include.
            </p>
          )}
          <div className="grid grid-cols-2 gap-4 max-[760px]:grid-cols-1">
            {paid.map((p) => {
              const isCur = cur.id === p.id
              return (
                <div key={p.id} className={`flex flex-col gap-4 rounded-card border bg-surface-deep p-5 ${isCur ? 'border-gold-line' : 'border-line'}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-display text-[26px] leading-none font-bold uppercase">{p.name}</span>
                    <span className="font-display text-[30px] leading-none font-extrabold text-gold">
                      {p.priceUsdc} <span className="font-mono text-[12px] font-normal text-faint">USD / {offer.periodDays} days</span>
                    </span>
                  </div>
                  <Limits p={p} />
                  <button
                    type="button"
                    disabled={!offer.checkout.enabled}
                    onClick={() => setBuying(p)}
                    className={`${isCur ? btnOutline : btnGold} inline-flex min-h-11 items-center justify-center gap-2 px-5 text-[15px] disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {!offer.checkout.enabled ? 'Not on sale yet' : isCur ? `Extend ${p.name} by ${offer.periodDays} days` : `Choose ${p.name}`}
                  </button>
                </div>
              )
            })}
          </div>
          <p className="m-0 flex items-start gap-2 border-t border-line pt-4 text-[13px] leading-[1.6] text-faint">
            <ShieldCheck size={15} className="mt-[2px] shrink-0 text-gold" aria-hidden />
            You send the coin or stablecoin straight to the Gully Labs treasury wallet; we never hold your funds or a card. The server checks the transfer on its chain before the plan starts, and each transaction counts once.
          </p>
        </section>
      )}

      <section className={card} style={rise(2)}>
        <div className="flex flex-col gap-[6px]">
          <h2 className={cardTitle}>Payments</h2>
          <span className={sub}>Every payment this wallet has made for a plan</span>
        </div>
        {!view.payments.length ? (
          <Empty icon={<Receipt size={26} className="text-gold" aria-hidden />} title="No payments yet">
            Payments you make for a plan appear here with their transaction on the chain’s explorer.
          </Empty>
        ) : (
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[10.5px] tracking-[1px] text-faint">
                  <th className="py-2 pr-3 font-medium">DATE</th>
                  <th className="py-2 pr-3 font-medium">PLAN</th>
                  <th className="py-2 pr-3 font-medium">AMOUNT</th>
                  <th className="py-2 pr-3 font-medium">CHAIN</th>
                  <th className="py-2 pr-3 font-medium">FROM</th>
                  <th className="py-2 pr-3 font-medium">PERIOD</th>
                  <th className="py-2 text-right font-medium">TRANSACTION</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {view.payments.map((p) => (
                  <tr key={`${p.chainId}:${p.txHash}`} className="border-b border-line last:border-b-0">
                    <td className="py-[10px] pr-3 text-muted">{fmtDate(p.at)}</td>
                    <td className="py-[10px] pr-3 text-ink uppercase">{p.plan}</td>
                    <td className="py-[10px] pr-3 text-ink-2">
                      {p.amount} {p.symbol}
                      {p.price && p.usd && (
                        <span className="block text-[11px] text-faint">
                          {p.usd} USD at {p.price.answer}
                        </span>
                      )}
                    </td>
                    <td className="py-[10px] pr-3 text-muted">{p.chain}</td>
                    <td className="py-[10px] pr-3 text-muted">{p.from === account.address ? 'this wallet' : shortAddress(p.from)}</td>
                    <td className="py-[10px] pr-3 text-muted">
                      {fmtDate(p.periodStart)} – {fmtDate(p.expiresAt)}
                    </td>
                    <td className="py-[10px] text-right">
                      {p.txUrl ? (
                        <a href={p.txUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-ink-2 hover:text-gold">
                          {shortAddress(p.txHash)} <ArrowUpRight size={12} aria-hidden />
                        </a>
                      ) : (
                        <span className="text-ink-2">{shortAddress(p.txHash)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
