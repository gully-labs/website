import { ArrowUpRight, Check, Globe, Loader2, Wallet } from 'lucide-react'
import { ANALYTICS_SIGNUP, type PlansState } from '../lib/plans'
import { btnGold, btnOutline } from './ui'

/* Gully Analytics plans, shared by the /analytics product page and /pricing. Every price and limit is read
   from GET /api/plans (server/plans.mjs, ANALYTICS_PLANS); nothing numeric is typed here. */

const fmt = (v: number) => v.toLocaleString('en-US')

export function AnalyticsPlanCards({ state, retry, delay = 0 }: { state: PlansState; retry: () => void; delay?: number }) {
  const rise = (i: number) => ({ animation: `gl-rise .55s ${(delay + i) * 0.07}s ease both` })
  if (state.k === 'loading')
    return (
      <p className="m-0 inline-flex items-center gap-3 font-mono text-[13px] text-faint">
        <Loader2 size={16} className="animate-spin" aria-hidden /> Reading the plans…
      </p>
    )
  if (state.k === 'error')
    return (
      <div className="flex flex-wrap items-center gap-4 rounded-card border border-[#5a2a24] bg-[rgba(255,138,122,.06)] px-6 py-5 text-[15px] text-error" role="alert">
        The plans could not be read: {state.message}
        <button type="button" onClick={retry} className={`${btnOutline} min-h-11 px-5 text-[14px]`}>
          Try again
        </button>
      </div>
    )
  const { offer } = state
  const a = offer.analytics
  return (
    <div className="flex flex-col gap-5">
      {!offer.checkout.enabled && (
        <p className="m-0 rounded-input border border-line-strong bg-surface px-5 py-4 text-[15px] text-ink-2" role="status">
          {offer.checkout.reason} The free trial does not need a payment.
        </p>
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-4">
        {a.plans.map((p, i) => {
          const trial = p.priceUsdc === 0
          const featured = p.id === 'starter'
          return (
            <div key={p.id} className={`relative flex flex-col gap-6 overflow-hidden rounded-card border bg-surface p-7 ${featured ? 'border-gold-line' : 'border-line'}`} style={rise(i)}>
              {featured && <span aria-hidden className="pointer-events-none absolute inset-0 animate-shimmer bg-[linear-gradient(110deg,transparent_30%,rgba(232,192,96,.06)_50%,transparent_70%)] bg-[length:200%_100%]" />}
              <div className="relative flex flex-col gap-2">
                <span className="font-mono text-[12px] tracking-[1.5px] text-faint">{p.name.toUpperCase()}</span>
                <span className="flex items-baseline gap-2">
                  <span className={`font-display text-[64px] leading-[.9] font-extrabold ${featured ? 'text-gold' : 'text-ink'}`}>{p.priceUsdc}</span>
                  <span className="font-mono text-[13px] text-muted">{trial ? `free for ${a.trialDays} days, once per wallet` : `USD / ${a.periodDays} days`}</span>
                </span>
              </div>
              <ul className="relative m-0 flex list-none flex-col gap-3 p-0 text-[15px] text-ink-2">
                <li className="flex items-start gap-3">
                  <Globe size={17} className="mt-[3px] shrink-0 text-gold" aria-hidden /> {p.sites} website{p.sites === 1 ? '' : 's'}
                </li>
                <li className="flex items-start gap-3">
                  <Check size={17} className="mt-[3px] shrink-0 text-gold" aria-hidden /> {fmt(p.eventsPerMonth)} events a month
                </li>
                <li className="flex items-start gap-3">
                  <Wallet size={17} className="mt-[3px] shrink-0 text-gold" aria-hidden /> Web3 tracking and the Web3 dashboard
                </li>
              </ul>
              <a href={ANALYTICS_SIGNUP} className={`${trial || featured ? btnGold : btnOutline} relative mt-auto inline-flex min-h-12 items-center justify-center gap-2 px-6 text-[16px]`}>
                {trial ? 'Start free trial' : offer.checkout.enabled ? `Get ${p.name}` : 'Open the dashboard'} <ArrowUpRight size={16} aria-hidden />
              </a>
            </div>
          )
        })}
      </div>
      <p className="m-0 font-mono text-[12px] leading-[1.7] text-faint">
        Events are every call the tracker makes (page views, custom and Web3 events), across your websites, per calendar month (UTC). At the limit new events are not recorded until the month turns or you upgrade. When a plan ends, recording stops and the dashboard stays readable for {a.graceDays} days. Paid in ETH, BNB, USDC or USDT, straight to the Gully Labs treasury.
      </p>
    </div>
  )
}
