import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Check, Clock, Layers, Plus, Rocket, Send, Sparkles, Timer } from 'lucide-react'
import { Seo } from '../components/Seo'
import { ChartBox } from '../components/charts/ChartSkeleton'
import { useReducedMotion } from '../components/charts/chart-utils'
import { NewTabMark } from '../components/LayoutLinks'
import { newTab } from '../components/LayoutNav'
import { BlinkDot, btnGold, btnOutline, eyebrow, h1, h2, h4 } from '../components/ui'
import { track } from '../lib/track'
import { DOCS_URL } from '../site-host'
import { Estimator } from './chains/Estimator'
import { STATUS_LABEL, usd0, useChains, type ChainsConfig, type ChainsService } from './chains/useChains'
import { Waitlist } from './chains/Waitlist'

/* Gully Chains: your own Arbitrum Orbit chain, launched and run by Gully Labs. NOTHING IS LIVE: a testnet is coming and
   this page takes a waitlist, so no sentence here says a chain is running. The offer (prices, services, form choices)
   is read from GET /api/chains/plans (server/chains-plans.mjs); no price or service is typed into this file. */

const rise = (i: number) => ({ animation: `gl-rise .55s ${i * 0.07}s ease both` })
const pill = 'rounded-full border px-3 py-[3px] font-mono text-[11px] tracking-[1px]'

function Section({ id, label, title, children }: { id: string; label: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-line px-page py-16 max-[600px]:py-12">
      <div className="mb-8 flex flex-col gap-3">
        <span className={eyebrow}>{label}</span>
        <h2 id={`${id}-title`} className={h2}>
          {title}
        </h2>
      </div>
      {children}
    </section>
  )
}

/* ---------- Stack: the layers, one at a time; it steps by itself until a visitor picks one ---------- */

function Stack({ cfg }: { cfg: ChainsConfig }) {
  const [i, setI] = useState(0)
  const [manual, setManual] = useState(false)
  const reduced = useReducedMotion()
  const n = cfg.stack.length
  useEffect(() => {
    if (manual || reduced) return
    const id = setInterval(() => setI((x) => (x + 1) % n), 2600)
    return () => clearInterval(id)
  }, [manual, reduced, n])
  const cur = cfg.stack[i]
  return (
    <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-6 max-[860px]:grid-cols-1">
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {cfg.stack.map((s, k) => (
          <li key={s.id}>
            <button
              type="button"
              aria-pressed={k === i}
              onClick={() => (setManual(true), setI(k))}
              className={`flex min-h-12 w-full items-center gap-3 rounded-btn border px-4 text-left text-[15px] transition-[border-color,background-color,transform] duration-200 ${k === i ? 'translate-x-1 border-gold bg-[rgba(217,181,99,.08)] text-ink' : 'border-line-strong bg-surface text-ink-2 hover:border-line-hover'}`}
            >
              <span className={`flex size-7 flex-none items-center justify-center rounded-full border font-mono text-[12px] ${k === i ? 'border-gold text-gold' : 'border-line-strong text-faint'}`}>{k + 1}</span>
              <span className="min-w-0 flex-1">{s.name}</span>
              {k === i && <BlinkDot color="gold" />}
            </button>
          </li>
        ))}
      </ol>
      <div className="flex flex-col justify-center gap-3 rounded-card border border-line bg-surface p-7 max-[600px]:p-5" aria-live="polite">
        <span className="font-mono text-[12px] tracking-[1px] text-faint">
          LAYER {i + 1} OF {n}
        </span>
        <h3 className={h4}>{cur.name}</h3>
        <p className="m-0 text-[15px] leading-[1.6] text-muted">{cur.role}.</p>
        <div className="h-1 overflow-hidden rounded-full bg-line" aria-hidden>
          <div className="h-full rounded-full bg-gold transition-[width] duration-500" style={{ width: `${((i + 1) / n) * 100}%` }} />
        </div>
      </div>
    </div>
  )
}

/* ---------- Services ---------- */

type Filter = 'all' | 'included' | 'addon'

function ServiceCard({ s, i }: { s: ChainsService; i: number }) {
  const status = STATUS_LABEL[s.status]
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 transition-[border-color,transform] duration-200 hover:-translate-y-1 hover:border-gold" style={rise(i)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${pill} ${s.kind === 'included' ? 'border-gold-line text-gold' : 'border-line-strong text-ink-2'}`}>{s.kind === 'included' ? 'INCLUDED' : 'ADD-ON'}</span>
        {status && <span className={`${pill} border-line-strong text-faint`}>{status.toUpperCase()}</span>}
      </div>
      <h3 className="m-0 text-[17px] leading-[1.25] font-semibold">{s.name}</h3>
      <p className="m-0 text-[14px] leading-[1.55] text-muted">{s.body}</p>
    </div>
  )
}

function Services({ cfg }: { cfg: ChainsConfig }) {
  const [filter, setFilter] = useState<Filter>('all')
  const list = cfg.services.filter((s) => filter === 'all' || s.kind === filter)
  const opts: [Filter, string][] = [['all', `All (${cfg.services.length})`], ['included', 'Included'], ['addon', 'Add-ons']]
  return (
    <div className="flex flex-col gap-5">
      <div role="radiogroup" aria-label="Show services" className="flex flex-wrap gap-2">
        {opts.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={filter === v} onClick={() => setFilter(v)} className={`inline-flex min-h-11 items-center rounded-full border px-4 text-[14px] transition-colors ${filter === v ? 'border-gold bg-[rgba(217,181,99,.1)] text-gold' : 'border-line-strong text-ink-2 hover:border-line-hover'}`}>
            {l}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4">
        {list.map((s, i) => (
          <ServiceCard key={s.id} s={s} i={i} />
        ))}
      </div>
    </div>
  )
}

/* ---------- Pricing ---------- */

function Pricing({ cfg }: { cfg: ChainsConfig }) {
  const { testnet, mainnet } = cfg
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-4">
        <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-7 max-[600px]:p-5" data-testid="price-testnet">
          <span className="flex items-center gap-2 font-mono text-[12px] tracking-[1px] text-gold">
            <Timer aria-hidden size={14} /> TESTNET
          </span>
          <p className="m-0 font-display text-[40px] leading-none font-extrabold uppercase">Free for {testnet.freeDays} days</p>
          <p className="m-0 text-[15px] leading-[1.6] text-muted">
            Then a small monthly fee: <b className="text-ink">{usd0(testnet.monthlyUsd)}</b>
            {testnet.monthlyUsd === null ? ' (to be announced)' : ' a month'}.
          </p>
        </div>
        <div className="flex flex-col gap-3 rounded-card border border-gold-line bg-surface p-7 max-[600px]:p-5" data-testid="price-mainnet">
          <span className="flex items-center gap-2 font-mono text-[12px] tracking-[1px] text-gold">
            <Layers aria-hidden size={14} /> MANAGED MAINNET
          </span>
          <p className="m-0 font-display text-[40px] leading-none font-extrabold uppercase">
            From {usd0(mainnet.fromUsdPerMonth)}
            <span className="text-[18px] text-muted normal-case"> a month</span>
          </p>
          <p className="m-0 text-[15px] leading-[1.6] text-muted">
            Plus <b className="text-ink">{mainnet.sequencerProfitPct}%</b> of sequencer profit{mainnet.daAtCost ? '. Data availability is billed at cost.' : '.'}
          </p>
        </div>
      </div>
      <Estimator cfg={cfg} />
      <div className="rounded-card border border-line bg-surface p-6 max-[600px]:p-4">
        <h3 className={`${h4} mb-3`}>Add-ons</h3>
        <ul className="m-0 flex list-none flex-col p-0">
          {cfg.addons.map((a) => (
            <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-3 last:border-b-0 last:pb-0">
              <span className="text-[15px]">
                {a.name}
                {STATUS_LABEL[a.status] && <span className="ml-2 font-mono text-[11px] text-faint">{STATUS_LABEL[a.status]?.toUpperCase()}</span>}
              </span>
              <span className="font-mono text-[13px] text-muted">
                {usd0(a.usd)} · {a.model}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="m-0 flex items-center gap-2 font-mono text-[12px] text-faint">
        <Clock aria-hidden size={14} /> {cfg.note}
      </p>
    </div>
  )
}

/* ---------- Process ---------- */

const STEPS = [
  { t: 'Join the waitlist', d: 'Tell us what you are building. We reply to every project.', now: true },
  { t: 'Get a testnet chain', d: 'We launch it for you, with the explorer, bridge and faucet.', now: false },
  { t: 'Go to mainnet', d: 'When you are ready, we run it as a managed chain.', now: false },
]

function Process() {
  return (
    <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4 p-0">
      {STEPS.map((s, i) => (
        <li key={s.t} className={`relative flex flex-col gap-3 rounded-card border bg-surface p-6 ${s.now ? 'border-gold' : 'border-line'}`} style={rise(i)}>
          <span className="flex items-center gap-3">
            <span className={`flex size-9 items-center justify-center rounded-full border font-mono text-[14px] ${s.now ? 'border-gold bg-gold text-bg' : 'border-line-strong text-faint'}`}>{i + 1}</span>
            {s.now && (
              <span className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[1px] text-gold">
                <BlinkDot color="gold" /> YOU ARE HERE
              </span>
            )}
          </span>
          <h3 className={h4}>{s.t}</h3>
          <p className="m-0 text-[14px] leading-[1.55] text-muted">{s.d}</p>
        </li>
      ))}
    </ol>
  )
}

/* ---------- FAQ ---------- */

function faq(cfg: ChainsConfig): { q: string; a: string }[] {
  return [
    { q: 'What is Arbitrum Orbit?', a: 'Orbit is the way to launch your own chain on Arbitrum technology (Nitro). Your chain has its own gas token, its own rules and its own block space, and settles to Arbitrum.' },
    { q: 'What is the difference between testnet and mainnet?', a: `A testnet is a practice chain with no real value: you build and test your app on it. We offer it free for ${cfg.testnet.freeDays} days. Mainnet is the real chain with real assets. Nothing is running yet; the testnet comes first.` },
    { q: 'Who runs the sequencer?', a: 'On managed mainnet, Gully Labs runs the sequencer and the rest of the chain infrastructure for you. You keep the chain and its configuration.' },
    { q: 'How do fees work?', a: `Testnet is free for ${cfg.testnet.freeDays} days. Managed mainnet has a monthly fee plus ${cfg.mainnet.sequencerProfitPct}% of sequencer profit, and data availability is billed at cost. Add-ons are listed under pricing. ${cfg.note}` },
    { q: 'What is audited?', a: 'The core of the stack is open-source Arbitrum and Hyperlane software. Any custom paymaster contracts we write get an independent audit before mainnet. Nothing is audited yet, because nothing is live.' },
    { q: 'Can I choose my gas token and data availability?', a: 'Yes: tell us on the waitlist. Gas can be ETH or your own token, and data availability can be Rollup or AnyTrust. Paying gas in USDC is planned.' },
  ]
}

function Faq({ cfg }: { cfg: ChainsConfig }) {
  return (
    <div className="flex max-w-[860px] flex-col gap-2">
      {faq(cfg).map((f) => (
        <details key={f.q} className="group rounded-card border border-line bg-surface open:border-line-hover">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 text-[16px] font-semibold [&::-webkit-details-marker]:hidden">
            {f.q}
            <Plus aria-hidden size={18} className="flex-none text-gold transition-transform duration-200 group-open:rotate-45" />
          </summary>
          <p className="m-0 px-5 pb-5 text-[15px] leading-[1.65] text-muted">{f.a}</p>
        </details>
      ))}
    </div>
  )
}

/* ---------- Page ---------- */

export function Chains() {
  const [state, retry] = useChains()
  // Arriving on /chains#waitlist (from Chain Kit): scroll to the form once the offer has loaded.
  const loaded = state.k === 'ok'
  useEffect(() => {
    if (loaded && location.hash === '#waitlist') document.getElementById('waitlist')?.scrollIntoView({ block: 'start' })
  }, [loaded])
  const goForm = () => {
    track('cta-click', { cta: 'chains-join-waitlist', page: '/chains' })
    document.getElementById('waitlist')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <>
      <Seo title="Gully Chains: your own Arbitrum chain" description="Your own Arbitrum Orbit chain, launched and run by Gully Labs, with an explorer, bridge, faucet, account abstraction and monitoring. A testnet is coming: join the waitlist." />
      <section className="relative overflow-hidden px-page pt-[72px] pb-16 max-[600px]:pt-10">
        <div aria-hidden className="pointer-events-none absolute -top-40 right-[-10%] size-[620px] animate-glow rounded-full bg-[radial-gradient(circle,rgba(217,181,99,.14),transparent_62%)]" />
        <div className="relative flex max-w-[900px] flex-col gap-6">
          <span className="flex flex-wrap items-center gap-3" style={rise(0)}>
            <span className={eyebrow}>PRODUCT · GULLY CHAINS</span>
            <span className={`${pill} border-gold-line text-gold`}>WAITLIST · TESTNET COMING</span>
          </span>
          <h1 className={h1} style={rise(1)}>
            Your own Arbitrum chain, <span className="text-gold">run by Gully Labs</span>
          </h1>
          <p className="m-0 max-w-[700px] text-[18px] leading-[1.6] text-muted" style={rise(2)}>
            We launch and operate an Arbitrum Orbit chain for your project, with the explorer, bridge, faucet and monitoring built in. A testnet is coming. Join the waitlist to be among the first.
          </p>
          <div className="flex flex-wrap gap-3" style={rise(3)}>
            <button type="button" onClick={goForm} className={`${btnGold} inline-flex min-h-12 items-center gap-2 px-[26px] text-[16px]`}>
              <Rocket aria-hidden size={18} strokeWidth={1.75} /> Join the waitlist
            </button>
            <Link to="/chain-kit" onClick={() => track('cta-click', { cta: 'chains-chain-kit', page: '/chains' })} className={`${btnOutline} inline-flex min-h-12 items-center gap-2 px-[26px] text-[16px]`}>
              Chain Kit explorer <ArrowRight aria-hidden size={16} />
            </Link>
          </div>
        </div>
      </section>

      {state.k === 'loading' && (
        <section className="border-t border-line px-page py-16" aria-label="Loading the offer">
          <ChartBox height={320} state="loading" variant="bars" />
        </section>
      )}
      {state.k === 'error' && (
        <section className="border-t border-line px-page py-16">
          <ChartBox height={200} state="error" message="The offer could not be loaded." onRetry={retry} />
        </section>
      )}
      {state.k === 'ok' && (
        <>
          <Section id="stack" label="THE STACK" title="Built on proven parts">
            <Stack cfg={state.cfg} />
          </Section>
          <Section id="services" label="BUILT-IN SERVICES" title="What comes with your chain">
            <Services cfg={state.cfg} />
          </Section>
          <Section id="pricing" label="PRICING" title="Simple, before launch">
            <Pricing cfg={state.cfg} />
          </Section>
          <Section id="process" label="HOW IT WORKS" title="Three steps">
            <Process />
          </Section>
          <Section id="waitlist" label="WAITLIST" title="Join the waitlist">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
              <p className="m-0 flex max-w-[720px] items-start gap-3 text-[15px] leading-[1.6] text-muted">
                <Sparkles aria-hidden size={18} className="mt-[3px] flex-none text-gold" />
                No chain is running yet. Tell us about your project and we will write when the testnet opens.
              </p>
              <Waitlist cfg={state.cfg} />
            </div>
          </Section>
          <Section id="faq" label="FAQ" title="Questions">
            <Faq cfg={state.cfg} />
          </Section>
        </>
      )}

      <section className="border-t border-line px-page py-12">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-[15px]">
          <Link to="/chain-kit" className="inline-flex min-h-11 items-center gap-2 text-gold hover:text-gold-hover">
            <Check aria-hidden size={15} /> Chain Kit: the explorer, waitlist <ArrowRight aria-hidden size={15} />
          </Link>
          <a href={`${DOCS_URL}/chain-kit`} {...newTab} className="inline-flex min-h-11 items-center gap-2 text-gold hover:text-gold-hover">
            <Send aria-hidden size={15} /> Read the docs <NewTabMark size={14} className="flex-none" />
          </a>
        </div>
      </section>
    </>
  )
}
