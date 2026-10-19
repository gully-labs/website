import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Check, Clock, Layers, Plus, Rocket, Send, Sparkles, Timer } from 'lucide-react'
import { Seo } from '../components/Seo'
import { ChartBox } from '../components/charts/ChartSkeleton'
import { NewTabMark } from '../components/LayoutLinks'
import { newTab } from '../components/LayoutNav'
import { ChainLogo } from '../components/logos/ChainLogo'
import { IntegrationLogo } from '../components/logos/IntegrationLogo'
import { VenueLogo } from '../components/logos/VenueLogo'
import { BlinkDot, btnGold, btnOutline, eyebrow, h2, h3, h4 } from '../components/ui'
import { track } from '../lib/track'
import { APP_URL, DOCS_URL, isLocalHost } from '../site-host'
import { Diagram } from './chains/Diagram'
import { Estimator } from './chains/Estimator'
import { FeeLive } from './chains/FeeLive'
import { Momentum } from './chains/Momentum'
import { Talk } from './chains/Talk'
import { STATUS_LABEL, usd0, useChains, type ChainsConfig } from './chains/useChains'
import { Waitlist } from './chains/Waitlist'

/* Gully Chains: your own Arbitrum Orbit chain, launched and run by Gully Labs. NOTHING IS LIVE: a testnet is coming and
   this page takes a waitlist, so no sentence here says a chain is running. The offer (prices, services, form choices)
   is read from GET /api/chains/plans (server/chains-plans.mjs); no price or service is typed into this file. */

const rise = (i: number) => ({ animation: `gl-rise .55s ${i * 0.07}s ease both` })
const pill = 'rounded-full border px-3 py-[3px] font-mono text-[11px] tracking-[1px]'

function Section({ id, label, title, children }: { id: string; label: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 border-t border-line px-page py-7 max-[600px]:py-6">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className={eyebrow}>{label}</span>
        <h2 id={`${id}-title`} className={h3}>
          {title}
        </h2>
      </div>
      {children}
    </section>
  )
}

/* The marks the offer is built with, as a row of small tiles (each is a real logo file). */
function Built() {
  const items: [ReactNode, string][] = [
    [<ChainLogo key="a" chain="arbitrum" size={24} decorative />, 'Arbitrum'],
    [<IntegrationLogo key="h" id="hyperlane" name="Hyperlane" size={24} decorative />, 'Hyperlane'],
    [<IntegrationLogo key="b" id="blockscout" name="Blockscout" size={24} decorative />, 'Blockscout'],
    [<IntegrationLogo key="s" id="safe" name="Safe" size={24} decorative />, 'Safe'],
    [<IntegrationLogo key="w" id="walletconnect" name="WalletConnect" size={24} decorative />, 'WalletConnect'],
    [<VenueLogo key="d" venue="deepcore" name="DeepCore" size={24} decorative />, 'DeepCore'],
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1" style={rise(4)} data-testid="chains-built-with">
      <span className="font-mono text-[11px] tracking-[1px] text-faint">BUILT WITH</span>
      {items.map(([mark, name]) => (
        <span key={name} className="inline-flex items-center gap-2 text-[13px] text-muted">
          {mark}
          {name}
        </span>
      ))}
    </div>
  )
}

/* ---------- Pricing: both prices and the add-ons in one card; the estimator beside it ---------- */

function Pricing({ cfg }: { cfg: ChainsConfig }) {
  const { testnet, mainnet } = cfg
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4 max-[1000px]:grid-cols-1">
      <div className="flex min-w-0 flex-col gap-4 rounded-card border border-line bg-card-token p-5 max-[600px]:p-4" data-testid="chains-pricing">
        <div className="grid grid-cols-2 gap-3 max-[600px]:grid-cols-1">
          <div className="flex flex-col gap-2 rounded-btn border border-line bg-surface-deep p-4" data-testid="price-testnet">
            <span className="flex items-center gap-2 font-mono text-[11px] tracking-[1px] text-gold">
              <Timer aria-hidden size={14} /> TESTNET
            </span>
            <p className="m-0 font-display text-[28px] leading-none font-extrabold uppercase">Free for {testnet.freeDays} days</p>
            <p className="m-0 text-[13px] leading-[1.5] text-muted">
              Then <b className="text-ink">{usd0(testnet.monthlyUsd)}</b>
              {testnet.monthlyUsd === null ? ' (to be announced)' : ' a month'}.
            </p>
          </div>
          <div className="flex flex-col gap-2 rounded-btn border border-gold-line bg-surface-deep p-4" data-testid="price-mainnet">
            <span className="flex items-center gap-2 font-mono text-[11px] tracking-[1px] text-gold">
              <Layers aria-hidden size={14} /> MANAGED MAINNET
            </span>
            <p className="m-0 font-display text-[28px] leading-none font-extrabold uppercase">
              From {usd0(mainnet.fromUsdPerMonth)}
              <span className="text-[14px] text-muted normal-case"> a month</span>
            </p>
            <p className="m-0 text-[13px] leading-[1.5] text-muted">
              Plus <b className="text-ink">{mainnet.sequencerProfitPct}%</b> of sequencer profit{mainnet.daAtCost ? '; data availability at cost.' : '.'}
            </p>
          </div>
        </div>
        <div>
          <h3 className={`${h4} mb-2 !text-[15px]`}>Add-ons</h3>
          <ul className="m-0 grid list-none grid-cols-2 gap-x-5 gap-y-1 p-0 max-[600px]:grid-cols-1">
            {cfg.addons.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3 border-b border-line py-[6px] text-[13px]">
                <span className="min-w-0">
                  {a.name}
                  {STATUS_LABEL[a.status] && <span className="ml-2 font-mono text-[11px] text-faint">{STATUS_LABEL[a.status]?.toUpperCase()}</span>}
                </span>
                <span className="flex-none font-mono text-[12px] text-muted">
                  {usd0(a.usd)} · {a.model}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="m-0 mt-auto flex items-center gap-2 font-mono text-[11px] text-faint">
          <Clock aria-hidden size={13} /> {cfg.note}
        </p>
      </div>
      <Estimator cfg={cfg} />
    </div>
  )
}

/* ---------- Process: a slim stepper ---------- */

const STEPS = [
  { t: 'Join the waitlist', d: 'We reply to every project.', now: true },
  { t: 'Get a testnet chain', d: 'Explorer, bridge and faucet included.', now: false },
  { t: 'Go to mainnet', d: 'We run it as a managed chain.', now: false },
]

function Process() {
  return (
    <ol className="m-0 grid list-none grid-cols-3 gap-3 border-t border-line px-page py-5 max-[800px]:grid-cols-1" data-testid="chains-steps">
      {STEPS.map((s, i) => (
        <li key={s.t} className="flex items-center gap-3" style={rise(i)}>
          <span className={`flex size-8 flex-none items-center justify-center rounded-full border font-mono text-[13px] ${s.now ? 'border-gold bg-gold text-bg' : 'border-line-strong text-faint'}`}>{i + 1}</span>
          <span className="flex min-w-0 flex-col">
            <b className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
              {s.t}
              {s.now && (
                <span className="inline-flex items-center gap-1 font-mono text-[11px] tracking-[1px] text-gold">
                  <BlinkDot color="gold" /> YOU ARE HERE
                </span>
              )}
            </b>
            <span className="text-[13px] text-muted">{s.d}</span>
          </span>
          {i < STEPS.length - 1 && <span aria-hidden className="ml-auto h-px min-w-6 flex-1 bg-line-strong max-[800px]:hidden" />}
        </li>
      ))}
    </ol>
  )
}

/* ---------- FAQ ---------- */

function faq(cfg: ChainsConfig): { q: string; a: string }[] {
  return [
    { q: 'What is Arbitrum Orbit?', a: 'Orbit launches your own chain on Arbitrum technology (Nitro): its own gas token, rules and block space, settling to Arbitrum.' },
    { q: 'Testnet or mainnet?', a: `A testnet is a practice chain with no real value, free for ${cfg.testnet.freeDays} days. Mainnet carries real assets. Nothing is running yet.` },
    { q: 'Who runs the sequencer?', a: 'On managed mainnet, Gully Labs runs the sequencer and the rest of the infrastructure. You keep the chain and its configuration.' },
    { q: 'How do fees work?', a: `Managed mainnet is a monthly fee plus ${cfg.mainnet.sequencerProfitPct}% of sequencer profit, with data availability at cost. ${cfg.note}` },
    { q: 'What is audited?', a: 'The core is open-source Arbitrum and Hyperlane software. Custom paymaster contracts get an independent audit before mainnet. Nothing is audited yet, because nothing is live.' },
    { q: 'Gas token and data availability?', a: 'Tell us on the waitlist. Gas can be ETH or your own token; data availability can be Rollup or AnyTrust. Paying gas in USDC is planned.' },
  ]
}

function Faq({ cfg }: { cfg: ChainsConfig }) {
  return (
    <div className="grid grid-cols-2 items-start gap-2 max-[800px]:grid-cols-1">
      {faq(cfg).map((f) => (
        <details key={f.q} className="group rounded-card border border-line bg-surface open:border-line-hover">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 px-4 py-2 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
            {f.q}
            <Plus aria-hidden size={16} className="flex-none text-gold transition-transform duration-200 group-open:rotate-45" />
          </summary>
          <p className="m-0 px-4 pb-4 text-[14px] leading-[1.6] text-muted">{f.a}</p>
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
      <section className="relative overflow-hidden px-page pt-8 pb-6 max-[600px]:pt-6">
        <div aria-hidden className="pointer-events-none absolute -top-40 right-[-10%] size-[560px] animate-glow rounded-full bg-[radial-gradient(circle,rgba(217,181,99,.14),transparent_62%)]" />
        <div className="relative grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] items-start gap-x-10 gap-y-6 max-[1000px]:grid-cols-1">
          <div className="flex flex-col gap-4">
            <span className="flex flex-wrap items-center gap-3" style={rise(0)}>
              <span className={eyebrow}>PRODUCT · GULLY CHAINS</span>
              <span className={`${pill} border-gold-line text-gold`}>WAITLIST · TESTNET COMING</span>
            </span>
            <h1 className={h2} style={rise(1)}>
              Your own Arbitrum chain, <span className="text-gold">run by Gully Labs</span>
            </h1>
            <p className="m-0 max-w-[640px] text-[16px] leading-[1.6] text-muted" style={rise(2)}>
              We launch and operate an Arbitrum Orbit chain for your project, with the explorer, bridge, faucet and monitoring built in. A testnet is coming. Join the waitlist to be among the first.
            </p>
            <div className="flex flex-wrap gap-3" style={rise(3)}>
              <button type="button" onClick={goForm} className={`${btnGold} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
                <Rocket aria-hidden size={16} strokeWidth={1.75} /> Join the waitlist
              </button>
              <Link to="/chain-kit" onClick={() => track('cta-click', { cta: 'chains-chain-kit', page: '/chains' })} className={`${btnOutline} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}>
                Chain Kit explorer <ArrowRight aria-hidden size={15} />
              </Link>
              <a
                href={isLocalHost() ? '/app#chains/launch' : `${APP_URL}/#chains/launch`}
                {...newTab}
                onClick={() => track('cta-click', { cta: 'chains-launch-yourself', page: '/chains' })}
                data-testid="launch-yourself"
                className={`${btnOutline} inline-flex min-h-11 items-center gap-2 px-5 text-[15px]`}
              >
                Launch a testnet chain yourself <NewTabMark size={14} className="flex-none" />
              </a>
            </div>
            <Built />
          </div>
          <div style={rise(2)}>
            <Talk where="hero" />
          </div>
        </div>
      </section>

      {state.k === 'loading' && (
        <section className="border-t border-line px-page py-10" aria-label="Loading the offer">
          <ChartBox height={320} state="loading" variant="bars" />
        </section>
      )}
      {state.k === 'error' && (
        <section className="border-t border-line px-page py-10">
          <ChartBox height={200} state="error" message="The offer could not be loaded." onRetry={retry} />
        </section>
      )}
      {state.k === 'ok' && (
        <>
          <Section id="stack" label="YOUR CHAIN" title="Built on proven parts, with services included">
            <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-4 max-[1000px]:grid-cols-1">
              <Diagram cfg={state.cfg} />
              <FeeLive />
            </div>
          </Section>
          <Section id="pricing" label="PRICING" title="Simple, before launch">
            <Pricing cfg={state.cfg} />
          </Section>
          <Process />
          <Section id="waitlist" label="WAITLIST" title="Join the waitlist">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] items-start gap-4 max-[1000px]:grid-cols-1">
              <div className="flex flex-col gap-4">
                <p className="m-0 flex items-start gap-3 text-[14px] leading-[1.6] text-muted">
                  <Sparkles aria-hidden size={18} className="mt-[2px] flex-none text-gold" />
                  No chain is running yet. Tell us about your project and we will write when the testnet opens.
                </p>
                <Momentum />
                <Talk where="form" />
              </div>
              <Waitlist cfg={state.cfg} />
            </div>
          </Section>
          <Section id="faq" label="FAQ" title="Questions">
            <Faq cfg={state.cfg} />
          </Section>
        </>
      )}

      <section className="border-t border-line px-page py-5">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-1 text-[14px]">
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
