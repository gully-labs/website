import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { Activity, ArrowDownUp, ArrowUpRight, BellRing, BookOpen, Boxes, ChartNoAxesCombined, CircleDollarSign, Code2, GitFork, Layers, LayoutGrid, Loader2, Newspaper, Puzzle, Wrench, type LucideIcon } from 'lucide-react'
import { projects } from '../../content/projects'
import { processSteps, services } from '../../content/services'
import { ANALYTICS_SIGNUP, type PlansState } from '../../lib/plans'
import { DOCS_URL } from '../../site-host'
import { BLOG_URL, h2, PORTAL_BILLING } from './links'
import { useContact } from '../ContactContext'

/* The landing's static sections, in the "showroom" layout: the product index, the Gully Chains preview,
   pricing (read from GET /api/plans), services with the four-step process, and the open-source strip. */


export function Kicker({ n, label }: { n: string; label: string }) {
  return (
    <span className="font-mono text-[11px] tracking-[1.5px] text-gold">
      {n} · {label}
    </span>
  )
}

/* ---------------------------------------------------------- product index --- */

type Tile = { name: string; sub: string; id: string; icon: LucideIcon; status: string; live: boolean }
const TILES: Tile[] = [
  { name: 'Projects ledger', sub: `${projects.length} venues, one total`, id: 'projects', icon: LayoutGrid, status: 'LIVE', live: true },
  { name: 'Stock tracker', sub: 'Stock tokens on 2 chains', id: 'tracker', icon: Activity, status: 'LIVE', live: true },
  { name: 'Swap', sub: 'On every stock page', id: 'tracker', icon: ArrowDownUp, status: 'LIVE', live: true },
  { name: 'Alerts', sub: 'Telegram + webhook', id: 'alerts', icon: BellRing, status: 'LIVE', live: true },
  { name: 'Gully Analytics', sub: 'Wallet-aware analytics', id: 'analytics', icon: ChartNoAxesCombined, status: 'FREE TRIAL', live: true },
  { name: 'Chain Kit', sub: 'Branded explorers', id: 'chainkit', icon: Boxes, status: 'ON REQUEST', live: false },
  { name: 'Gully Chains', sub: 'Orbit L3s, run by us', id: 'chains', icon: Layers, status: 'IN DEVELOPMENT', live: false },
  { name: 'API + SDK', sub: 'Free, wallet sign-in', id: 'api', icon: Code2, status: 'LIVE', live: true },
  { name: 'Widget', sub: 'One script tag', id: 'widget', icon: Puzzle, status: 'LIVE', live: true },
  { name: 'Gully Pay', sub: 'Crypto billing', id: 'pay', icon: CircleDollarSign, status: 'LIVE', live: true },
  { name: 'Services', sub: 'Contracts to launch', id: 'services', icon: Wrench, status: 'BOOKING', live: false },
]

export function ProductIndex() {
  return (
    <section id="index" aria-label="Everything we ship" className="scroll-mt-20 px-page pt-2 pb-12">
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2 p-0 max-[519px]:grid-cols-2">
        {TILES.map((f, i) => (
          <li key={f.name} className="min-w-0">
            <Link
              to={`/#${f.id}`}
              className="flex h-full min-h-11 items-start gap-3 rounded-[10px] border border-line bg-surface px-[14px] py-3 text-ink transition-[border-color,background-color,transform] duration-200 hover:-translate-y-[2px] hover:border-gold-line hover:bg-surface-hover hover:text-ink max-[519px]:flex-col max-[519px]:gap-2 max-[519px]:px-3"
              style={{ animation: `gl-rise .5s ${0.15 + i * 0.03}s ease both` }}
            >
              <span className="grid size-8 flex-none place-items-center rounded-[8px] bg-grid text-gold">
                <f.icon aria-hidden size={16} strokeWidth={2} />
              </span>
              <span className="flex min-w-0 flex-col gap-px">
                <b className="font-semibold">{f.name}</b>
                <span className="text-[12px] text-dim">{f.sub}</span>
                <span className={`mt-[2px] font-mono text-[10px] ${f.live ? 'text-green' : 'text-dim'}`}>{f.status}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ----------------------------------------------------------- gully chains --- */

/* Not live: a preview of the Orbit L3 work. The repos are public forks in the gully-labs org; nothing
   here claims a running chain. Gully Labs is not affiliated with Offchain Labs or the Arbitrum
   Foundation, so no Arbitrum marks, only our own banners. */
const CHAIN_REPOS: { repo: string; role: string; d: string }[] = [
  { repo: 'arbitrum-orbit-deployment-ui', role: 'Launch', d: 'Deploy an Orbit chain from the browser' },
  { repo: 'orbit-setup-script', role: 'Bootstrap', d: 'Bring a new chain up' },
  { repo: 'orbit-monitoring-tools', role: 'Monitor', d: 'Keep the chain healthy' },
  { repo: 'arbitrum-token-bridge', role: 'Gully Bridge', d: 'Move tokens on and off the chain' },
  { repo: 'arbitrum-token-lists', role: 'Tokens', d: 'Token lists for the bridge' },
  { repo: 'stylus-sdk-rs', role: 'Stylus SDK', d: 'Contracts in Rust' },
  { repo: 'stylus-hello-world', role: 'Stylus starter', d: 'A first Rust contract' },
]

const CHAIN_STEPS: { name: string; d: string }[] = [
  { name: 'Gully Devnet', d: 'A public test L3 on Arbitrum Sepolia, with our Chain Kit explorer, a faucet and a bridge.' },
  { name: 'Client chains', d: 'Managed Orbit L3s for clients, settling to Arbitrum One, launched and run by us.' },
  { name: 'Our own L3', d: 'A chain for the Gully venues.' },
]

const BANNERS = [
  { repo: 'arbitrum-orbit-deployment-ui', alt: 'Gully Labs banner for the Launch repository: launch a chain' },
  { repo: 'arbitrum-token-bridge', alt: 'Gully Labs banner for the Gully Bridge repository' },
]

export function ChainsSection({ n }: { n: string }) {
  const { openContact } = useContact()
  return (
    <section id="chains" aria-labelledby="chains-title" className="scroll-mt-20 border-t border-line">
      <div className="flex flex-col gap-5 px-page py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-[6px]">
            <Kicker n={n} label="GULLY CHAINS · IN DEVELOPMENT" />
            <h2 id="chains-title" className={h2}>
              Your own chain, run by us
            </h2>
            <p className="m-0 max-w-[560px] text-[14px] leading-[1.5] text-muted">
              Arbitrum Orbit L3 chains, launched and operated by Gully Labs. We have forked and branded the Orbit and Stylus tooling; first comes Gully Devnet, a public test chain. None of it is live yet.
            </p>
          </div>
          <div className="flex flex-[0_1_auto] flex-col items-start gap-2">
            <span className="flex flex-wrap gap-[6px]">
              {['Arbitrum Orbit', 'Stylus · Rust', 'Coming soon'].map((t) => (
                <span key={t} className="rounded-full border border-line-strong px-[9px] py-[3px] text-[12px] text-ink-2">
                  {t}
                </span>
              ))}
            </span>
            <button
              type="button"
              onClick={() => openContact('Infrastructure')}
              className="inline-flex min-h-11 items-center gap-2 rounded-btn border border-gold-line bg-transparent px-4 text-[14px] font-semibold text-gold transition-colors hover:border-gold hover:text-gold-hover"
            >
              Ask about a chain <ArrowUpRight aria-hidden size={15} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] items-start gap-3">
          <ol className="m-0 flex list-none flex-col gap-px overflow-hidden rounded-card border border-line bg-line p-0">
            {CHAIN_STEPS.map((s, i) => (
              <li key={s.name} className="flex items-start gap-3 bg-surface px-4 py-[14px]">
                <span className="mt-[2px] font-mono text-[12px] text-gold">{String(i + 1).padStart(2, '0')}</span>
                <span className="flex min-w-0 flex-col gap-[2px]">
                  <b className="font-semibold">
                    {s.name} <span className="ml-1 font-mono text-[10px] font-normal tracking-[1px] text-dim">{i === 0 ? 'NEXT' : 'LATER'}</span>
                  </b>
                  <span className="text-[13px] text-muted">{s.d}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-3">
            {BANNERS.map((b) => (
              <a key={b.repo} href={`https://github.com/gully-labs/${b.repo}`} target="_blank" rel="noopener" className="block overflow-hidden rounded-card border border-line transition-colors hover:border-gold-line">
                <img src={`/brand/repos/${b.repo}.svg`} alt={b.alt} width={1280} height={360} loading="lazy" decoding="async" className="block h-auto w-full" />
              </a>
            ))}
          </div>
        </div>
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-2 p-0">
          {CHAIN_REPOS.map((r) => (
            <li key={r.repo} className="min-w-0">
              <a
                href={`https://github.com/gully-labs/${r.repo}`}
                target="_blank"
                rel="noopener"
                className="flex h-full min-h-11 flex-col gap-[2px] rounded-[10px] border border-line bg-surface px-[14px] py-3 text-ink transition-[border-color,background-color] duration-200 hover:border-gold-line hover:bg-surface-hover hover:text-ink"
              >
                <span className="flex items-center justify-between gap-2 font-mono text-[11px] text-gold">
                  {r.role.toUpperCase()}
                  <GitFork aria-hidden size={13} />
                </span>
                <b className="truncate font-mono text-[12px] font-medium" title={`gully-labs/${r.repo}`}>
                  gully-labs/{r.repo}
                </b>
                <span className="text-[12px] text-dim">{r.d}</span>
              </a>
            </li>
          ))}
        </ul>
        <p className="m-0 font-mono text-[11px] leading-[1.5] text-faint">
          Forks of open-source Offchain Labs repositories. Gully Labs is not affiliated with Offchain Labs or the Arbitrum Foundation.
        </p>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- pricing --- */

type Row = { name: string; price: string; feat: string }

function PriceCol({ title, note, rows, cta, state }: { title: string; note: string; rows: Row[] | null; cta: React.ReactNode; state?: PlansState }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-card border border-line bg-surface">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-[14px]">
        <b className="font-display text-[22px] font-bold uppercase">{title}</b>
        <span className="font-mono text-[11px] text-dim">{note}</span>
      </div>
      {rows ? (
        rows.map((r) => (
          <div key={r.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-line px-4 py-3">
            <b className="font-semibold">{r.name}</b>
            <span className="font-mono text-gold">{r.price}</span>
            <span className="col-span-full text-[12px] text-dim">{r.feat}</span>
          </div>
        ))
      ) : (
        <div className="flex min-h-[200px] items-center justify-center border-b border-line px-4 font-mono text-[12px] text-faint">
          {state?.k === 'error' ? <span className="text-error">The plans could not be read: {state.message}</span> : <span className="inline-flex items-center gap-2"><Loader2 aria-hidden size={14} className="animate-spin" /> Reading the plans…</span>}
        </div>
      )}
      <div className="mt-auto">{cta}</div>
    </div>
  )
}

const ctaCls = 'flex min-h-11 items-center justify-center gap-2 text-[13px] font-semibold text-gold transition-colors hover:bg-surface-hover hover:text-gold-hover'
const n = (v: number) => v.toLocaleString('en-US')
const listOr = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}` : (xs[0] ?? ''))

export function LandingPricing({ plans }: { plans: PlansState }) {
  const { openContact } = useContact()
  const offer = plans.k === 'ok' ? plans.offer : null
  const api: Row[] | null = offer
    ? offer.plans.map((p) => ({
        name: p.name,
        price: `$${n(p.priceUsdc)}`,
        feat: `${n(p.perMin)} calls/min · ${p.alerts} alert${p.alerts === 1 ? '' : 's'} · ${p.historyDays} days history`,
      }))
    : null
  const analytics: Row[] | null = offer
    ? offer.analytics.plans.map((p) => ({
        name: p.priceUsdc ? p.name : 'Trial',
        price: p.priceUsdc ? `$${n(p.priceUsdc)}` : `${offer.analytics.trialDays} days free`,
        feat: `${p.sites} website${p.sites === 1 ? '' : 's'} · ${n(p.eventsPerMonth)} events a month`,
      }))
    : null
  // Native coins first (ETH, BNB), then the stablecoins.
  const assets = offer ? [...new Set([...offer.assets].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'native' ? -1 : 1)).map((a) => a.symbol))] : []
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 border-t border-line">
      <div className="flex flex-col gap-5 px-page py-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Kicker n="10" label="PRICING" />
            <h2 id="pricing-title" className={h2}>
              Every plan, one page
            </h2>
          </div>
          <Link to="/pricing" className="inline-flex min-h-11 items-center text-[14px] font-medium text-gold hover:text-gold-hover">
            Plans in detail →
          </Link>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-3" aria-live="polite">
          <PriceCol
            title="Tracker API"
            note={offer ? `per ${offer.periodDays} days` : 'per period'}
            rows={api}
            state={plans}
            cta={
              <a href={PORTAL_BILLING} className={ctaCls}>
                Get a key <ArrowUpRight aria-hidden size={14} />
              </a>
            }
          />
          <PriceCol
            title="Gully Analytics"
            note={offer ? `per ${offer.analytics.periodDays} days` : 'per period'}
            rows={analytics}
            state={plans}
            cta={
              <a href={ANALYTICS_SIGNUP} className={ctaCls}>
                Start the free trial <ArrowUpRight aria-hidden size={14} />
              </a>
            }
          />
          <PriceCol
            title="Chain Kit & services"
            note="quoted"
            rows={[
              { name: 'Chain Kit', price: 'Quoted', feat: 'Branded Blockscout, hosted and run by us' },
              { name: 'Build', price: 'Quoted', feat: 'Contracts, dApps, infrastructure' },
              { name: 'Audit', price: 'Quoted', feat: 'Review and hardening' },
            ]}
            cta={
              <button type="button" onClick={() => openContact()} className={`${ctaCls} w-full bg-transparent`}>
                Talk to us <ArrowUpRight aria-hidden size={14} />
              </button>
            }
          />
        </div>
        <p className="m-0 font-mono text-[12px] leading-[1.6] text-dim">
          {offer ? (
            <>
              Paid in {listOr(assets)} on {listOr(offer.chains.map((c) => c.name))}. {offer.periodDays} days per payment, nothing renews by itself. Straight from your wallet to ours: no custody.
              {!offer.checkout.enabled && <span className="text-ink-2"> {offer.checkout.reason}</span>}
            </>
          ) : (
            'Paid in crypto from your own wallet, straight to ours. Nothing renews by itself.'
          )}
        </p>
      </div>
    </section>
  )
}

/* --------------------------------------------------------------- services --- */

export function ServicesBlock() {
  const { openContact } = useContact()
  const [step, setStep] = useState(1)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(k)) return
    e.preventDefault()
    const last = processSteps.length - 1
    const next = k === 'Home' ? 0 : k === 'End' ? last : (step + (k === 'ArrowRight' ? 1 : -1) + processSteps.length) % processSteps.length
    setStep(next)
    tabs.current[next]?.focus()
  }
  const cur = processSteps[step]
  return (
    <section id="services" aria-labelledby="services-title" className="scroll-mt-20 border-t border-line bg-bg-alt">
      <div className="flex flex-col gap-5 px-page py-12">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Kicker n="11" label="SERVICES" />
            <h2 id="services-title" className={h2}>
              The same team, on your project
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/services" className="inline-flex min-h-11 items-center text-[14px] font-medium text-muted hover:text-gold">
              All services →
            </Link>
            <button type="button" onClick={() => openContact()} className="inline-flex min-h-11 items-center rounded-btn border border-gold-line bg-transparent px-[18px] font-semibold text-gold transition-colors hover:border-gold hover:text-gold-hover">
              Start a project
            </button>
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-px overflow-hidden rounded-card border border-line bg-line">
          {services.map((s) => (
            <button
              key={s.n}
              type="button"
              onClick={() => openContact(s.type)}
              className="group flex flex-col items-start gap-[6px] bg-surface p-[18px] text-left text-ink transition-colors hover:bg-surface-hover"
            >
              <span className="flex w-full items-center justify-between">
                <span className="font-mono text-[12px] text-gold">{s.n}</span>
                <s.icon aria-hidden size={18} strokeWidth={1.5} className="text-faint transition-colors group-hover:text-gold" />
              </span>
              <b className="font-display text-[22px] font-bold uppercase">{s.name}</b>
              <span className="text-[13px] text-muted">{s.description}</span>
              <span className="mt-auto pt-1 font-mono text-[11px] text-faint">
                {s.time} · <span className="text-gold">Ask about this →</span>
              </span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-stretch gap-4">
          <div role="tablist" aria-label="How we work" onKeyDown={onKey} className="grid flex-[1_1_360px] grid-cols-4 gap-[6px] max-[459px]:grid-cols-2">
            {processSteps.map((s, i) => {
              const on = i === step
              return (
                <button
                  key={s.n}
                  ref={(el) => {
                    tabs.current[i] = el
                  }}
                  id={`step-tab-${i}`}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-controls="step-panel"
                  tabIndex={on ? 0 : -1}
                  onClick={() => setStep(i)}
                  className={`flex min-h-16 flex-col items-start justify-center gap-[2px] rounded-[10px] border px-3 py-2 text-left text-ink transition-colors duration-200 ${on ? 'border-gold-line bg-grid' : 'border-line bg-surface hover:bg-surface-hover'}`}
                >
                  <span className="font-mono text-[11px] text-gold">{s.n}</span>
                  <b className="text-[13px] font-semibold">{s.name}</b>
                </button>
              )
            })}
          </div>
          <div id="step-panel" role="tabpanel" aria-labelledby={`step-tab-${step}`} className="flex flex-[1_1_320px] items-center gap-4 rounded-[10px] border border-line bg-surface px-4 py-[14px]">
            <cur.icon aria-hidden size={26} strokeWidth={1.5} className="flex-none text-gold" />
            <span key={step} className="flex flex-col gap-1" style={{ animation: 'gl-rise .35s ease both' }}>
              <b className="font-semibold">
                {cur.n} · {cur.name}
              </b>
              <span className="text-[13px] text-muted">{cur.description}</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------- open source strip --- */

const OPENS: { k: string; t: string; d: string; href: string; icon?: LucideIcon }[] = [
  { k: 'OPEN SOURCE', t: 'gully-labs/sdk', d: 'TypeScript client and React widget, MIT', href: 'https://github.com/gully-labs/sdk' },
  { k: 'OPEN SOURCE', t: 'gully-labs/umami', d: 'Gully Analytics, our Umami fork', href: 'https://github.com/gully-labs/umami/tree/gully/analytics' },
  { k: 'OPEN SOURCE', t: 'gully-labs/blockscout', d: 'Chain Kit, our Blockscout fork', href: 'https://github.com/gully-labs/blockscout/tree/gully/chain-kit/gully' },
  { k: 'READ', t: 'Docs', d: 'API reference, widget and SDK guides', href: DOCS_URL, icon: BookOpen },
  { k: 'READ', t: 'Blog', d: 'Launch notes and write-ups', href: BLOG_URL, icon: Newspaper },
]

export function OpenStrip() {
  return (
    <section id="open" aria-label="Open source, docs and blog" className="scroll-mt-20 border-t border-line">
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-3 px-page py-10">
        {OPENS.map((o) => (
          <li key={o.t} className="min-w-0">
            <a href={o.href} target="_blank" rel="noopener" className="flex h-full flex-col gap-1 rounded-[10px] border border-line bg-surface p-[14px] text-ink transition-[border-color,background-color,transform] duration-200 hover:-translate-y-[2px] hover:border-gold-line hover:bg-surface-hover hover:text-ink">
              <span className="flex items-center justify-between font-mono text-[11px] text-gold">
                {o.k}
                {o.icon ? <o.icon aria-hidden size={14} /> : <ArrowUpRight aria-hidden size={14} />}
              </span>
              <b className="font-semibold">{o.t}</b>
              <span className="text-[12px] text-dim">{o.d}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
