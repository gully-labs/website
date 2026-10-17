import { ArrowUpRight, CheckCircle2, Receipt } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { isLocalHost, SITE_URL } from '../../site-host'
import { api, daysLeft, fmtDate, shortAddress, type Account, type BillingView, type Payment, type Plan, type PlanId, type Quote } from './api'
import { Empty, ErrorLine, Skeleton } from './parts'
import { PayFlow } from './PayFlow'
import { mono, panel, panelTitle, pillGold, pillLine, rise } from './styles'

/* Billing: the plan in force, the plans on offer (from the server; no price is typed here), Gully Pay
   checkout (chain and asset chips, a 20-minute quote, pay from the connected wallet or check a hash)
   straight to the treasury wallet, and the wallet's payment history. With no treasury configured the
   server says checkout is closed and the plans show as "Not on sale yet". */

const PRICING_URL = isLocalHost() ? '/pricing' : `${SITE_URL}/pricing`
const fmt = (n: number) => n.toLocaleString('en-US')

/** Where a checkout should start: set by the Overview's pay strip. */
export type CheckoutIntent = { plan: PlanId; asset: string | null } | null

function Limits({ p }: { p: Plan }) {
  return (
    <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
      {[
        ['Calls / min per key', fmt(p.perMin)],
        ['Keys', String(p.maxKeys)],
        ['Gap alerts', String(p.alerts)],
        ['History', `${p.historyDays} days`],
      ].map(([k, v]) => (
        <div key={k} className="flex flex-col">
          <dt className="text-[11px] text-dim">{k}</dt>
          <dd className="m-0 font-mono text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function PlanCheckout({ plan, view, initialAsset, autoQuote, onPaid, onCancel }: { plan: Plan; view: BillingView; initialAsset: string | null; autoQuote: boolean; onPaid: () => void; onCancel: () => void }) {
  const [done, setDone] = useState<Payment | null>(null)
  const cur = view.plan
  const offer = view.offer
  const switching = cur.expiresAt && cur.id !== plan.id

  if (done)
    return (
      <section className={`${panel} border-success-line`} style={rise(0)}>
        <div className="flex items-start gap-3">
          <CheckCircle2 size={22} className="mt-[2px] shrink-0 text-green" aria-hidden />
          <div className="flex flex-col gap-1">
            <h2 className={panelTitle}>Payment confirmed</h2>
            <span className="text-[14px] text-muted">
              {done.amount} {done.symbol} received on {done.chain}. {plan.name} runs until {fmtDate(done.expiresAt)}. Your keys have the new limit now.
            </span>
            {done.txUrl && (
              <a href={done.txUrl} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center gap-1 font-mono text-[12px] text-ink-2 hover:text-gold">
                {shortAddress(done.txHash)} <ArrowUpRight size={12} aria-hidden />
              </a>
            )}
          </div>
        </div>
        <div>
          <button type="button" onClick={onCancel} className={pillLine}>
            Done
          </button>
        </div>
      </section>
    )

  return (
    <section className={`${panel} border-gold-line`} style={rise(0)} aria-labelledby="pay-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-[2px]">
          <h2 id="pay-title" className={panelTitle}>
            {cur.id === plan.id ? `Extend ${plan.name} by ${offer.periodDays} days` : `${plan.name} · ${offer.periodDays} days`}
          </h2>
          <span className={mono}>
            {plan.priceUsdc} USD · quotes last 20 minutes · paying again adds {offer.periodDays} days
          </span>
        </div>
        <button type="button" onClick={onCancel} className="inline-flex min-h-11 items-center rounded-full px-3 font-mono text-[12px] text-muted hover:text-ink">
          Back to plans
        </button>
      </div>
      {switching && (
        <p className="m-0 rounded-[10px] border border-gold-line bg-[rgba(232,192,96,.06)] px-4 py-3 text-[14px] text-ink-2">
          You are on {cur.name} until {fmtDate(cur.expiresAt)}. A different plan starts today; the days left on {cur.name} are not carried over.
        </p>
      )}
      <PayFlow
        offer={offer}
        usd={plan.priceUsdc}
        label={`${plan.name}, ${offer.periodDays} days`}
        initialAsset={initialAsset}
        autoQuote={autoQuote}
        getQuote={(asset) => api<{ intent: Quote }>('/api/developer/checkout', { method: 'POST', body: { plan: plan.id, asset } }).then((r) => (r.ok ? { ...r, data: { quote: r.data.intent } } : r))}
        verify={(q, txHash) => api('/api/developer/checkout/verify', { method: 'POST', body: { plan: plan.id, quoteId: q.id, txHash } })}
        onPaid={(data) => {
          setDone((data as { payment: Payment }).payment)
          onPaid()
        }}
      />
    </section>
  )
}

export function Billing({ account, reload, intent, onIntentDone }: { account: Account; reload: () => Promise<void>; intent: CheckoutIntent; onIntentDone: () => void }) {
  const [view, setView] = useState<BillingView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [buying, setBuying] = useState<{ plan: Plan; asset: string | null; auto: boolean } | null>(null)

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
  const left = daysLeft(cur.expiresAt)
  // Arriving from the Overview's "Pay on …": that plan's checkout, quoted at once in the chosen asset.
  const intentPlan = intent && offer.checkout.enabled ? offer.plans.find((x) => x.id === intent.plan) : undefined
  const active = buying ?? (intent && intentPlan ? { plan: intentPlan, asset: intent.asset, auto: true } : null)

  return (
    <div className="flex flex-col gap-[14px]">
      <section className={panel} style={rise(0)} aria-labelledby="plan-title">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex max-w-[560px] min-w-0 flex-col gap-2">
            <span className="flex items-center gap-2 text-[12px] text-dim">
              <span className="size-2 rounded-full" style={{ background: cur.id === 'free' ? '#6c7888' : '#e8c060' }} aria-hidden /> Current plan
            </span>
            <h2 id="plan-title" className="m-0 font-display text-[40px] leading-none font-bold uppercase">
              <span className={cur.id === 'free' ? 'text-ink' : 'text-gold'}>{cur.name}</span>
              {left !== null && <span className="ml-3 font-mono text-[13px] font-normal text-muted normal-case">{left === 0 ? 'ends today' : `${left} day${left === 1 ? '' : 's'} left`}</span>}
            </h2>
            <span className="text-[14px] leading-[1.55] text-muted">
              {cur.expiresAt ? (
                <>
                  Runs until <b className="font-medium text-ink">{fmtDate(cur.expiresAt)}</b> ({cur.source === 'admin' ? 'granted by Gully Labs' : 'paid'}). It does not renew by itself: pay again to extend it, or let it lapse to return to Free.
                </>
              ) : (
                <>Free for as long as you like. No card, no email.</>
              )}
            </span>
          </div>
          <div className="min-w-[240px] flex-[0_1_320px]">
            <Limits p={cur} />
          </div>
        </div>
      </section>

      {active ? (
        <PlanCheckout
          key={`${active.plan.id}:${active.asset}`}
          plan={active.plan}
          view={view}
          initialAsset={active.asset}
          autoQuote={active.auto}
          onPaid={onPaid}
          onCancel={() => {
            setBuying(null)
            onIntentDone()
            load()
          }}
        />
      ) : (
        <section className={panel} style={rise(1)} aria-labelledby="plans-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-[2px]">
              <h2 id="plans-title" className={panelTitle}>
                Plans
              </h2>
              <span className={mono}>
                Priced in USD · paid in {[...new Set(offer.assets.map((a) => a.symbol))].join(', ')} on {offer.chains.map((c) => c.name).join(', ')} · {offer.periodDays} days per payment · nothing to cancel
              </span>
            </div>
            <a href={PRICING_URL} className="inline-flex min-h-11 items-center gap-1 font-mono text-[12px] text-muted hover:text-gold">
              Pricing page and FAQ <ArrowUpRight size={12} aria-hidden />
            </a>
          </div>
          {!offer.checkout.enabled && (
            <p className="m-0 rounded-[10px] border border-line-strong bg-surface-deep px-4 py-3 text-[14px] text-ink-2" role="status">
              {offer.checkout.reason} The limits below are what each plan will include.
            </p>
          )}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-3">
            {paid.map((p) => {
              const isCur = cur.id === p.id
              return (
                <div key={p.id} className={`flex flex-col gap-4 rounded-[12px] border bg-surface-deep p-4 ${isCur ? 'border-gold-line' : 'border-line'}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex items-center gap-2 text-[15px] font-semibold">
                      {p.name}
                      {isCur && <span className="rounded-full border border-gold-line px-2 font-mono text-[10px] text-gold">CURRENT</span>}
                    </span>
                    <span className="font-display text-[30px] leading-none font-bold">
                      {p.priceUsdc} <span className="font-mono text-[11px] font-normal text-faint">USD / {offer.periodDays} days</span>
                    </span>
                  </div>
                  <Limits p={p} />
                  <button type="button" disabled={!offer.checkout.enabled} onClick={() => setBuying({ plan: p, asset: null, auto: false })} className={isCur ? pillLine : pillGold}>
                    {!offer.checkout.enabled ? 'Not on sale yet' : isCur ? `Extend ${p.name} by ${offer.periodDays} days` : `Choose ${p.name}`}
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className={panel} style={rise(2)} aria-labelledby="payments-title">
        <div className="flex flex-col gap-[2px]">
          <h2 id="payments-title" className={panelTitle}>
            Payments
          </h2>
          <span className={mono}>Every payment this wallet has made for a plan</span>
        </div>
        {!view.payments.length ? (
          <Empty icon={<Receipt size={26} className="text-gold" aria-hidden />} title="No payments yet">
            Payments you make for a plan appear here with their transaction on the chain’s explorer.
          </Empty>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
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
                          {p.usd} USD at {Number(p.price.answer).toLocaleString('en-US', { maximumFractionDigits: 2 })}
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
