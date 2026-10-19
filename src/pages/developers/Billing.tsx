import { track } from '../../lib/track'
import { BookOpen, CheckCircle2, CreditCard, Download, FileText, History, LayoutDashboard, Receipt, Store, Users } from 'lucide-react'
import { usePortal, useWrite } from './portal'
import { Can } from './RoleGate'
import { ChainLogo } from '../../components/logos/ChainLogo'
import { TokenLogo } from '../../components/logos/TokenLogo'
import { StackedDays } from './vcharts'
import { GhostCurves } from './charts'
import { PlanUsage } from './tabcharts'
import { useCallback, useEffect, useState } from 'react'
import { usePoll } from './poll'
import { useSubTab } from './subtab'
import { InfoTip, RefreshChip, SubPanel, SubTabs, Unknown } from './ui'
import { ExtLink } from './ExtLink'
import { DOCS_URL, isLocalHost, SITE_URL } from '../../site-host'
import { ServiceHeader } from './services/ServiceHeader'
import { docsPage } from './services/links'
import { api, daysLeft, fmtDate, shortAddress, type Account, type BillingView, type Payment, type Plan, type PlanId, type Quote, usdOf } from './api'
import { ErrorLine, Skeleton } from './parts'
import { PayFlow } from './PayFlow'
import { mono, panel, panelTitle, pillGold, pillLine, pillSm, rise } from './styles'
import { StatusPill as KitPill } from '../../components/ui/StatusPill'

/* Billing, as sub-tabs that show one section at a time (#billing/plan, #billing/plans, #billing/history,
   remembered): the plan in force with its usage rings and the payments chart (and the CSV exports); the
   plans on offer (from the server; no price is typed here) with Gully Pay checkout (chain and asset chips,
   a 20-minute quote, pay from the connected wallet or check a hash) straight to the treasury wallet, and a
   pointer to the self-serve Merchant tab; and the payment history table. With no treasury configured the
   server says checkout is closed and the plans show as "Not on sale yet". A payment whose USD value is
   unknown is never counted as $0: totals add the known ones and say "partial". */

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
              <ExtLink href={done.txUrl} className="inline-flex min-h-11 items-center gap-1 font-mono text-[12px] text-ink-2 hover:text-gold">
                {shortAddress(done.txHash)}
              </ExtLink>
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
        <p className="m-0 rounded-[10px] border border-gold-line bg-[rgba(217,181,99,.06)] px-4 py-3 text-[14px] text-ink-2">
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
        trackAs={{ kind: 'plan', plan: plan.id }}
        onPaid={(data) => {
          track('plan-upgraded', { plan: plan.id })
          setDone((data as { payment: Payment }).payment)
          onPaid()
        }}
      />
    </section>
  )
}

const BILLING_SUBS = ['plan', 'plans', 'history'] as const
type BillingSub = (typeof BILLING_SUBS)[number]

/** A payment's USD value, or null when the server did not record one (never read as 0). */

export function Billing({ account, reload, intent, onIntentDone }: { account: Account; reload: () => Promise<void>; intent: CheckoutIntent; onIntentDone: () => void }) {
  const poll = usePoll<BillingView>('/api/developer/billing', 0)
  const view = poll.data
  const err = view ? null : (poll.error ?? (poll.timedOut ? 'no answer in time' : null))
  const load = poll.reload
  const [buying, setBuying] = useState<{ plan: Plan; asset: string | null; auto: boolean } | null>(null)
  const [sub, setSub] = useSubTab<BillingSub>('billing', BILLING_SUBS, 'plan')
  const { me, user } = usePortal()
  const canPay = useWrite('billing', 'pay for plans').ok

  // Arriving from the Overview's "Pay on …" opens the plans.
  useEffect(() => {
    if (intent) setSub('plans')
  }, [intent, setSub])

  const onPaid = useCallback(() => {
    void load()
    void reload()
  }, [load, reload])

  if (err) return <ErrorLine onRetry={load}>Billing could not be read: {err}</ErrorLine>
  if (!view)
    return (
      <div className="flex flex-col gap-2">
        <Skeleton h={44} />
        <Skeleton h={140} />
        <Skeleton h={200} />
      </div>
    )

  const cur = view.plan
  const offer = view.offer
  const paid = offer.plans.filter((p) => p.priceUsdc > 0)
  const left = daysLeft(cur.expiresAt)
  // Arriving from the Overview's "Pay on …": that plan's checkout, quoted at once in the chosen asset.
  const intentPlan = intent && offer.checkout.enabled && canPay ? offer.plans.find((x) => x.id === intent.plan) : undefined
  const active = buying ?? (intent && intentPlan ? { plan: intentPlan, asset: intent.asset, auto: true } : null)
  const known = view.payments.filter((p) => usdOf(p) !== null)

  return (
    <div className="flex flex-col gap-2">
      <ServiceHeader icon={CreditCard} title="Billing" desc="Your plan and what it includes, how to pay for it, and every payment to Gully Labs." status={{ tone: cur.id === 'free' ? 'idle' : 'live', text: `${cur.name} plan` }} docs={docsPage('gully-pay')} />
      <SubTabs
        label="Billing sections"
        idBase="billing"
        value={sub}
        onChange={setSub}
        items={[
          { id: 'plan', label: 'Plan & usage', icon: <LayoutDashboard size={15} aria-hidden /> },
          { id: 'plans', label: 'Plans & checkout', icon: <CreditCard size={15} aria-hidden />, dot: !!active },
          { id: 'history', label: 'Payment history', icon: <History size={15} aria-hidden />, count: view.payments.length },
        ]}
      />
      <SubPanel idBase="billing" value={sub}>
        {sub === 'plan' && (
          <>
            <section className={`${panel} gap-2`} style={rise(0)} aria-labelledby="plan-title">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex max-w-[560px] min-w-0 flex-col gap-1">
                  <span className="flex items-center gap-2 text-[12px] text-dim">
                    <span className="size-2 rounded-full" style={{ background: cur.id === 'free' ? '#8a94a1' : '#d9b563' }} aria-hidden /> Current plan
                    <RefreshChip error={poll.error} onRetry={load} />
                  </span>
                  <h2 id="plan-title" className="m-0 font-display text-[30px] leading-none font-bold uppercase">
                    <span className={cur.id === 'free' ? 'text-ink' : 'text-gold'}>{cur.name}</span>
                    {left !== null && <span className="ml-3 font-mono text-[13px] font-normal text-muted normal-case">{left === 0 ? 'ends today' : `${left} day${left === 1 ? '' : 's'} left`}</span>}
                  </h2>
                  <InfoTip summary={cur.expiresAt ? <>Runs until <b className="font-medium text-ink">{fmtDate(cur.expiresAt)}</b> ({cur.source === 'admin' ? 'granted by Gully Labs' : 'paid'}) · does not renew by itself</> : 'Free for as long as you like. No card, no email.'}>
                    {cur.expiresAt ? 'Pay again to extend it by another period, or let it lapse to return to Free; your keys keep working at the Free limit.' : 'Free includes keys, usage charts and the request log at the Free limits. Upgrade from Plans & checkout when you need more.'}
                  </InfoTip>
                </div>
                <div className="min-w-[240px] flex-[0_1_320px]">
                  <Limits p={cur} />
                </div>
              </div>
              <PlanUsage account={account} payments={view.payments} />
              <div className="flex items-center gap-2 border-t border-line pt-2" data-testid="workspace-pays">
                <Users size={14} className="shrink-0 text-gold" aria-hidden />
                <InfoTip summary={<><b className="font-semibold text-ink-2">This workspace pays</b> · {me ? me.active.name : 'the workspace'}</>}>
                  The plan belongs to {me ? <b className="font-semibold">{me.active.name}</b> : 'the workspace'} and covers every member&apos;s keys and alerts. {canPay ? 'Payments can come from any wallet; the receipt names the workspace and its company details.' : 'Owners, admins and billing members can pay or extend it.'}
                </InfoTip>
              </div>
            </section>

            <section className={`${panel} gap-2`} style={rise(1)} aria-labelledby="payments-title">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-col gap-[2px]">
                  <h2 id="payments-title" className={panelTitle}>
                    Payments
                  </h2>
                  <span className={mono}>
                    {view.payments.length
                      ? `${view.payments.length} payment${view.payments.length === 1 ? '' : 's'} · USD at the time${known.length < view.payments.length ? ` · partial: ${view.payments.length - known.length} without a USD value` : ''}`
                      : 'every payment made for this workspace’s plan'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2" data-testid="csv-exports">
                  <a href="/api/developer/export/payments.csv" download className={`${pillSm} min-h-11`}>
                    <Download size={14} aria-hidden /> Payments CSV
                  </a>
                  <span className="flex items-center gap-1 rounded-full border border-line px-1">
                    <span className="pl-2 font-mono text-[11px] text-faint">Usage CSV</span>
                    {(['24h', '7d', '30d'] as const).map((r) => (
                      <a key={r} href={`/api/developer/export/usage.csv?range=${r}`} download className="inline-flex min-h-11 min-w-9 items-center justify-center rounded-full px-2 font-mono text-[12px] text-ink-2 hover:text-gold max-[600px]:min-h-11 max-[600px]:min-w-11" aria-label={`Download usage CSV, last ${r}`}>
                        {r}
                      </a>
                    ))}
                  </span>
                </div>
              </div>
              {known.length ? (
                <div data-testid="payments-chart">
                  <StackedDays
                    height={130}
                    label={`Payments over time: ${known.length} payments with a USD value${known.length < view.payments.length ? ' (partial)' : ''}.`}
                    kinds={[...new Set(known.map((p) => p.plan ?? p.kind))].map((k, i) => ({ id: String(k), name: `${k} (USD)`, color: ['#d9b563', '#5aa9e6', '#74c27b', '#c98bdb'][i % 4] }))}
                    days={[...known].sort((a, b) => a.at.localeCompare(b.at)).map((p) => ({ label: fmtDate(p.at), values: { [String(p.plan ?? p.kind)]: Math.round((usdOf(p) ?? 0) * 100) / 100 } }))}
                  />
                </div>
              ) : view.payments.length ? (
                <p className="m-0 text-[13px] text-muted">
                  The USD value of {view.payments.length === 1 ? 'this payment' : 'these payments'} is <Unknown /> (not recorded), so there is nothing to chart. See Payment history.
                </p>
              ) : (
                <GhostCurves height={130} title="Your payments will draw here">
                  <Receipt size={20} className="text-gold" aria-hidden />
                  <span className="max-w-[460px] text-[13px] text-muted">Payments you make for a plan chart here by date and amount.</span>
                  <button type="button" onClick={() => setSub('plans')} className={`${pillSm} min-h-11`}>
                    <CreditCard size={14} aria-hidden /> See the plans
                  </button>
                </GhostCurves>
              )}
            </section>
          </>
        )}

        {sub === 'plans' && (
          <>
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
                  void load()
                }}
              />
            ) : (
              <section className={`${panel} gap-2`} style={rise(0)} aria-labelledby="plans-title">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-[2px]">
                    <h2 id="plans-title" className={panelTitle}>
                      Plans
                    </h2>
                    <span className={mono}>
                      Priced in USD · paid in {[...new Set(offer.assets.map((a) => a.symbol))].join(', ')} on {offer.chains.length} chains · {offer.periodDays} days per payment · nothing to cancel
                    </span>
                  </div>
                  <ExtLink href={PRICING_URL} className="inline-flex min-h-11 items-center gap-1 font-mono text-[12px] text-muted hover:text-gold">
                    Pricing page and FAQ
                  </ExtLink>
                </div>
                {!offer.checkout.enabled && (
                  <p className="m-0 rounded-[10px] border border-line-strong bg-surface-deep px-3 py-2 text-[13px] text-ink-2" role="status">
                    {offer.checkout.reason} The limits below are what each plan will include.
                  </p>
                )}
                <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-2">
                  {paid.map((p) => {
                    const isCur = cur.id === p.id
                    return (
                      <div key={p.id} className={`flex flex-col gap-3 rounded-[12px] border bg-surface-deep p-3 ${isCur ? 'border-gold-line' : 'border-line'}`}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="flex items-center gap-2 text-[15px] font-semibold">
                            {p.name}
                            {isCur && <KitPill tone="warn">CURRENT</KitPill>}
                          </span>
                          <span className="font-display text-[26px] leading-none font-bold">
                            {p.priceUsdc} <span className="font-mono text-[11px] font-normal text-faint">USD / {offer.periodDays} days</span>
                          </span>
                        </div>
                        <Limits p={p} />
                        <Can cat="billing" what="pay for plans" block>
                          <button type="button" disabled={!offer.checkout.enabled} onClick={() => setBuying({ plan: p, asset: null, auto: false })} className={`${isCur ? pillLine : pillGold} min-h-10 relative after:absolute after:inset-x-0 after:-inset-y-[2px] w-full`} data-checkout={p.id}>
                            {!offer.checkout.enabled ? 'Not on sale yet' : isCur ? `Extend ${p.name} by ${offer.periodDays} days` : `Choose ${p.name}`}
                          </button>
                        </Can>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}
            <SelfServePay />
          </>
        )}

        {sub === 'history' && (
          <section className={`${panel} gap-2`} style={rise(0)} aria-labelledby="history-title">
            <div className="flex flex-col gap-[2px]">
              <h2 id="history-title" className={panelTitle}>
                Payment history
              </h2>
              <span className={mono}>Every payment made for this workspace&apos;s plan, with its transaction and receipt · CSV on Plan &amp; usage</span>
            </div>
            {!view.payments.length ? (
              <GhostCurves height={120} title="Your payments will be listed here">
                <button type="button" onClick={() => setSub('plans')} className={`${pillSm} min-h-11`}>
                  <CreditCard size={14} aria-hidden /> See the plans
                </button>
              </GhostCurves>
            ) : (
              <div className="-mx-4 overflow-x-auto px-4">
                <table className="w-full min-w-[720px] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left font-mono text-[11px] tracking-[1px] text-faint">
                      <th className="py-2 pr-3 font-medium">DATE</th>
                      <th className="py-2 pr-3 font-medium">PLAN</th>
                      <th className="py-2 pr-3 font-medium">AMOUNT</th>
                      <th className="py-2 pr-3 font-medium">CHAIN</th>
                      <th className="py-2 pr-3 font-medium">FROM</th>
                      <th className="py-2 pr-3 font-medium">PERIOD</th>
                      <th className="py-2 pr-3 text-right font-medium">TRANSACTION</th>
                      <th className="py-2 text-right font-medium">RECEIPT</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {view.payments.map((p) => (
                      <tr key={`${p.chainId}:${p.txHash}`} className="border-b border-line last:border-b-0">
                        <td className="py-2 pr-3 text-muted">{fmtDate(p.at)}</td>
                        <td className="py-2 pr-3 text-ink uppercase">{p.plan}</td>
                        <td className="py-2 pr-3 text-ink-2">
                          <TokenLogo symbol={p.symbol} size={14} decorative className="mr-1 align-[-2px]" />
                          {p.amount} {p.symbol}
                          <span className="block text-[11px] text-faint">{usdOf(p) !== null ? `${p.usd} USD${p.price ? ` at ${Number(p.price.answer).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : ''}` : <>USD <Unknown /></>}</span>
                        </td>
                        <td className="py-2 pr-3 text-muted">
                          <span className="inline-flex items-center gap-[6px]">
                            <ChainLogo chain={p.chain} size={14} decorative /> {p.chain}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-muted">{p.from === user ? 'your wallet' : p.from === account.address ? 'owner wallet' : shortAddress(p.from)}</td>
                        <td className="py-2 pr-3 text-muted">
                          {fmtDate(p.periodStart)} – {fmtDate(p.expiresAt)}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {p.txUrl ? (
                            <ExtLink href={p.txUrl} className="inline-flex min-h-11 items-center gap-1 text-ink-2 hover:text-gold">
                              {shortAddress(p.txHash)}
                              <span className="sr-only"> on the explorer</span>
                            </ExtLink>
                          ) : (
                            <span className="text-ink-2">{shortAddress(p.txHash)}</span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          <a href={`#receipt=${p.chainId}:${p.txHash}`} className="inline-flex min-h-11 items-center gap-1 text-ink-2 hover:text-gold">
                            <FileText size={13} aria-hidden /> Receipt
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </SubPanel>
    </div>
  )
}

/** Merchants are self-serve: pay links, invoices, a checkout and webhooks from the Merchant tab. */
function SelfServePay() {
  return (
    <section className={`${panel} flex-row flex-wrap items-center gap-2 p-3`} style={rise(2)} aria-labelledby="pay-self">
      <Store size={18} className="shrink-0 text-gold" aria-hidden />
      <span className="flex min-w-0 flex-[1_1_320px] flex-col gap-[2px]">
        <h2 id="pay-self" className="m-0 text-[14px] font-semibold text-ink">
          Take crypto payments yourself
        </h2>
        <span className="text-[13px] text-muted">Pay links, invoices, a hosted checkout and signed webhooks: set up your store in the Merchant tab, self-serve.</span>
      </span>
      <a href="#merchant" className={`${pillGold} min-h-11`}>
        <Store size={15} aria-hidden /> Open Merchant
      </a>
      <ExtLink href={`${DOCS_URL}/gully-pay`} className={`${pillSm} min-h-11`}>
        <BookOpen size={14} aria-hidden /> How it works
      </ExtLink>
    </section>
  )
}
