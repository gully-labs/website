import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpRight, Loader2 } from 'lucide-react'
import { ANALYTICS_SIGNUP, type PlansState } from '../../lib/plans'
import { useContact } from '../ContactContext'
import { h2, PORTAL_BILLING } from './links'

/* Pricing on the landing: one switch (Tracker API / Gully Analytics / Chain Kit & services) and that
   product's plans as cards, crossfading on a switch. The API and Analytics prices are read from
   GET /api/plans (server/plans.mjs is the one source); Chain Kit and services are quoted. The payment
   line under the cards says which coins and chains are accepted, from the same read. */

type Product = 'api' | 'analytics' | 'services'
type Card = { name: string; price: string; per?: string; feats: string[] }

const n = (v: number) => v.toLocaleString('en-US')
const listOr = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}` : (xs[0] ?? ''))
const ease = [0.2, 0.8, 0.2, 1] as const

const PRODUCTS: { id: Product; label: string }[] = [
  { id: 'api', label: 'Tracker API' },
  { id: 'analytics', label: 'Gully Analytics' },
  { id: 'services', label: 'Chain Kit & services' },
]

export function PricingSwitch({ plans }: { plans: PlansState }) {
  const { openContact } = useContact()
  const [product, setProduct] = useState<Product>('api')
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({})
  const offer = plans.k === 'ok' ? plans.offer : null

  let cards: Card[] | null = null
  if (product === 'services')
    cards = [
      { name: 'Chain Kit', price: 'Quoted', feats: ['Branded Blockscout explorer', 'Your domain, colours and token list', 'Hosted and run by us'] },
      { name: 'Build', price: 'Quoted', feats: ['Smart contracts', 'dApps and frontends', 'Chain infrastructure'] },
      { name: 'Audit', price: 'Quoted', feats: ['Code review', 'Fuzzing and invariant tests', 'Post-launch monitoring'] },
    ]
  else if (offer && product === 'api')
    cards = offer.plans.map((p) => ({
      name: p.name,
      price: `$${n(p.priceUsdc)}`,
      per: p.priceUsdc ? `per ${offer.periodDays} days` : undefined,
      feats: [`${n(p.perMin)} calls a minute`, `${p.alerts} alert${p.alerts === 1 ? '' : 's'}`, `${p.historyDays} days of history`, `${p.maxKeys} key${p.maxKeys === 1 ? '' : 's'}`],
    }))
  else if (offer && product === 'analytics')
    cards = offer.analytics.plans.map((p) => ({
      name: p.priceUsdc ? p.name : 'Trial',
      price: p.priceUsdc ? `$${n(p.priceUsdc)}` : 'Free',
      per: p.priceUsdc ? `per ${offer.analytics.periodDays} days` : `${offer.analytics.trialDays} days`,
      feats: [`${p.sites} website${p.sites === 1 ? '' : 's'}`, `${n(p.eventsPerMonth)} events a month`, 'Wallet, chain and transaction events'],
    }))

  const cta =
    product === 'api' ? (
      <a href={PORTAL_BILLING} className={ctaCls}>
        Get a key <ArrowUpRight aria-hidden size={14} />
      </a>
    ) : product === 'analytics' ? (
      <a href={ANALYTICS_SIGNUP} className={ctaCls}>
        Start the free trial <ArrowUpRight aria-hidden size={14} />
      </a>
    ) : (
      <button type="button" onClick={() => openContact()} className={ctaCls}>
        Talk to us <ArrowUpRight aria-hidden size={14} />
      </button>
    )

  const onKey = (e: React.KeyboardEvent) => {
    const i = PRODUCTS.findIndex((p) => p.id === product)
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: PRODUCTS.length - 1 }[e.key]
    if (next === undefined) return
    e.preventDefault()
    const id = PRODUCTS[(next + PRODUCTS.length) % PRODUCTS.length].id
    setProduct(id)
    tabs.current[id]?.focus()
  }

  // Native coins first (ETH, BNB), then the stablecoins.
  const assets = offer ? [...new Set([...offer.assets].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'native' ? -1 : 1)).map((a) => a.symbol))] : []

  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 border-t border-line">
      <div className="flex flex-col gap-5 px-page py-12 max-[599px]:py-9">
        <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-80px' }} transition={{ duration: 0.45, ease }} className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[11px] tracking-[1.5px] text-gold">PRICING</span>
            <h2 id="pricing-title" className={h2}>
              Every plan, one switch
            </h2>
          </div>
          <Link to="/pricing" className="inline-flex min-h-11 items-center text-[14px] font-medium text-gold hover:text-gold-hover">
            Plans in detail →
          </Link>
        </motion.div>
        <div role="tablist" aria-label="Product" onKeyDown={onKey} className="flex w-fit max-w-full gap-[2px] overflow-x-auto rounded-[10px] border border-line p-[3px] [scrollbar-width:none]">
          {PRODUCTS.map((p) => {
            const on = p.id === product
            return (
              <button
                key={p.id}
                ref={(el) => {
                  tabs.current[p.id] = el
                }}
                id={`price-tab-${p.id}`}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls="price-panel"
                tabIndex={on ? 0 : -1}
                onClick={() => setProduct(p.id)}
                className={`relative min-h-11 flex-none rounded-[7px] bg-transparent px-4 text-[13px] font-semibold whitespace-nowrap transition-colors duration-200 max-[459px]:px-3 max-[459px]:text-[12px] ${on ? 'text-bg' : 'text-muted hover:text-ink'}`}
              >
                {on && <motion.span layoutId="price-tab" aria-hidden className="absolute inset-0 rounded-[7px] bg-gold" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                <span className="relative">{p.label}</span>
              </button>
            )
          })}
        </div>
        <div id="price-panel" role="tabpanel" aria-labelledby={`price-tab-${product}`} aria-live="polite" className="min-h-[200px]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={product + (cards ? 'ok' : plans.k)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              {cards ? (
                <ul tabIndex={0} aria-label="Plans" className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3 p-0 max-[599px]:-mx-page max-[599px]:flex max-[599px]:snap-x max-[599px]:snap-mandatory max-[599px]:overflow-x-auto max-[599px]:px-page max-[599px]:pb-1 max-[599px]:[scrollbar-width:none]">
                  {cards.map((c, i) => (
                    <motion.li
                      key={c.name}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: i * 0.05, ease }}
                      className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-4 transition-[border-color,background-color,transform] max-[599px]:w-[78%] max-[599px]:flex-none max-[599px]:snap-start duration-200 hover:-translate-y-[2px] hover:border-gold-line hover:bg-surface-hover"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <b className="font-display text-[22px] font-bold uppercase">{c.name}</b>
                        {c.per && <span className="font-mono text-[11px] text-dim">{c.per}</span>}
                      </div>
                      <span className="font-display text-[34px] leading-none font-extrabold text-gold">{c.price}</span>
                      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] text-muted">
                        {c.feats.map((f) => (
                          <li key={f} className="flex gap-2">
                            <span aria-hidden className="text-gold">·</span>
                            {f}
                          </li>
                        ))}
                      </ul>
                    </motion.li>
                  ))}
                </ul>
              ) : (
                <div className="flex min-h-[200px] items-center justify-center rounded-card border border-line bg-surface px-4 font-mono text-[12px] text-faint">
                  {plans.k === 'error' ? (
                    <span className="text-error">The plans could not be read: {plans.message}</span>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 aria-hidden size={14} className="animate-spin" /> Reading the plans…
                    </span>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 max-w-[760px] font-mono text-[12px] leading-[1.6] text-dim">
            {offer ? (
              <>
                Paid in {listOr(assets)} on {listOr(offer.chains.map((c) => c.name))}, straight from your wallet to ours: no custody. Nothing renews by itself.
                {!offer.checkout.enabled && <span className="text-ink-2"> {offer.checkout.reason}</span>}
              </>
            ) : (
              'Paid in crypto from your own wallet, straight to ours. Nothing renews by itself.'
            )}
          </p>
          {cta}
        </div>
      </div>
    </section>
  )
}

const ctaCls = 'inline-flex min-h-11 items-center gap-2 rounded-btn border border-gold-line bg-transparent px-4 text-[14px] font-semibold text-gold transition-colors hover:border-gold hover:text-gold-hover'
