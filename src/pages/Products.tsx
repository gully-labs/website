import { ArrowUpRight, Boxes, ChartNoAxesCombined, Cpu, Eye, Fingerprint, GitBranch, Layers, Link2, Palette, Rocket, ServerCog, ShieldCheck, Wallet, type LucideIcon } from 'lucide-react'
import { AnalyticsPlanCards } from '../components/AnalyticsPlans'
import { ANALYTICS_SIGNUP, usePlans } from '../lib/plans'
import { useContact } from '../components/ContactContext'
import { Seo } from '../components/Seo'
import { btnGold, btnOutline, eyebrow } from '../components/ui'
import { AnalyticsExample, ChainKitExample } from '../components/charts/ProductExamples'

/* Product pages for the two open-source-based products. Copy states what exists today; nothing
   numeric about customers or usage is claimed. The "What it draws" charts are illustrations with
   example data, badged EXAMPLE DATA on screen and in their accessible labels. */

const rise = (i: number) => ({ animation: `gl-rise .55s ${i * 0.07}s ease both` })

type Feature = { icon: LucideIcon; title: string; body: string }
type Product = {
  seo: { title: string; description: string }
  eyebrow: string
  title: [string, string]
  lead: string
  status: string
  cta: string
  ctaType: 'Infrastructure' | 'dApp / frontend' | 'Other'
  /** When set, the main button links here instead of opening the contact form. */
  ctaHref?: string
  /** Shows the plans read from GET /api/plans. */
  pricing?: boolean
  source: { label: string; href: string }
  features: Feature[]
  how: { title: string; body: string }[]
  code?: string
  licence: string
  /** An interactive illustration of what the product draws (example data, labelled as such). */
  figure?: { title: string; body: string; node: React.ReactNode }
}

const ANALYTICS: Product = {
  seo: {
    title: 'Gully Analytics',
    description: 'Privacy-friendly web analytics for dapps: page views plus wallet connects, chains and transactions, with a visit to wallet to transaction funnel.',
  },
  eyebrow: 'PRODUCT · GULLY ANALYTICS',
  title: ['Analytics that see', 'the wallet'],
  lead: 'Page views alone don’t tell a dapp what worked. Gully Analytics adds what happens next: which visits connected a wallet, on which chain, with which wallet app, and which went on to send a transaction.',
  status: 'Free trial',
  cta: 'Start free trial',
  ctaType: 'dApp / frontend',
  ctaHref: ANALYTICS_SIGNUP,
  pricing: true,
  source: { label: 'gully-labs/umami', href: 'https://github.com/gully-labs/umami/tree/gully/analytics' },
  features: [
    { icon: Wallet, title: 'Wallet connects', body: 'Detected through EIP-6963 and window.ethereum, by observing the wallet, never by prompting it.' },
    { icon: Link2, title: 'Chains and switches', body: 'Every connect, chain switch and transaction carries its chain, named for Ethereum, Base, BNB Chain, Robinhood Chain, Arc and more.' },
    { icon: ChartNoAxesCombined, title: 'Visit → wallet → transaction', body: 'A funnel from session to connected wallet to sent transaction, plus top pages by connects and wallet apps used.' },
    { icon: Fingerprint, title: 'Addresses hashed by default', body: 'Unique wallets are counted from a one-way hash of the address. Full addresses or none are one attribute away.' },
    { icon: Eye, title: 'Everything Umami does', body: 'Page views, referrers, countries, devices, events and goals, cookie-free, on a dashboard you own.' },
    { icon: ShieldCheck, title: 'Opt-in, small, open', body: 'Web3 tracking turns on with one attribute; the whole script stays a few kilobytes. The source is public.' },
  ],
  how: [
    { title: 'Sign in and add your site', body: 'Connect a wallet in the app dashboard, start the free trial and add your domain.' },
    { title: 'Add the script', body: 'One tag on your dapp, with data-web3="true".' },
    { title: 'Use your dapp as usual', body: 'Connects, chain switches and transactions are recorded as they happen.' },
    { title: 'Read the Web3 tab', body: 'Wallets, connect rate, transactions, chains and the funnel for any date range.' },
  ],
  code: '<script defer src="https://analytics.gullylabs.xyz/script.js"\n  data-website-id="YOUR-SITE-ID" data-web3="true"></script>',
  licence: 'Built on Umami, MIT licensed. Our changes are MIT too.',
  figure: { title: 'What the Web3 tab draws', body: 'The charts below use made-up example figures to show the views; your dashboard draws your own site.', node: <AnalyticsExample /> },
}

const CHAIN_KIT: Product = {
  seo: {
    title: 'Chain Kit',
    description: 'A branded Blockscout block explorer for your EVM chain, deployed and operated by Gully Labs.',
  },
  eyebrow: 'PRODUCT · CHAIN KIT',
  title: ['An explorer for', 'your chain'],
  lead: 'A new chain needs a block explorer on day one. Chain Kit is Blockscout, the open-source explorer, set up for your chain, in your brand, and run by the team that builds on these chains every day.',
  status: 'Available on request',
  cta: 'Talk to us about your chain',
  ctaType: 'Infrastructure',
  source: { label: 'gully-labs/blockscout', href: 'https://github.com/gully-labs/blockscout/tree/gully/chain-kit/gully' },
  features: [
    { icon: Boxes, title: 'Full explorer', body: 'Blocks, transactions, addresses, tokens, NFTs, contract verification, APIs and charts, from Blockscout.' },
    { icon: Palette, title: 'Your brand', body: 'Your name, logos, colours and links across the explorer, configured rather than forked, so upgrades stay simple.' },
    { icon: Layers, title: 'Rollups included', body: 'Profiles for Arbitrum Nitro and Orbit chains like Robinhood Chain, and for chains like Arc with a stablecoin as gas.' },
    { icon: ServerCog, title: 'Operated for you', body: 'Provisioning, TLS, backups, upgrades and monitoring, with a runbook for every common failure.' },
    { icon: Cpu, title: 'Sized honestly', body: 'A busy rollup needs terabytes; a young chain needs far less. We size the server and the RPC to your chain before anything is promised.' },
    { icon: GitBranch, title: 'Open source', body: 'Everything we add is public and GPL-3.0 like Blockscout itself. You are never locked in.' },
  ],
  how: [
    { title: 'Tell us about your chain', body: 'Chain id, RPC, settlement layer and how much history you need.' },
    { title: 'We size and deploy', body: 'A dedicated server, your branding and the indexer, on a domain of your choice.' },
    { title: 'Launch and run', body: 'We keep it indexed, upgraded and backed up while you build the chain.' },
  ],
  licence: 'Built on Blockscout, GPL-3.0. Our deployment layer is GPL-3.0 too.',
  figure: { title: 'Charts on day one', body: 'Blockscout charts your chain from its first block. The figures below are made-up examples of what it draws.', node: <ChainKitExample /> },
}

function ProductPage({ p }: { p: Product }) {
  const { openContact } = useContact()
  return (
    <>
      <Seo title={p.seo.title} description={p.seo.description} />
      <section className="relative overflow-hidden px-page pt-[72px] pb-16">
        <div aria-hidden className="pointer-events-none absolute -top-40 right-[-10%] size-[620px] animate-glow rounded-full bg-[radial-gradient(circle,rgba(217,181,99,.14),transparent_62%)]" />
        <div className="relative flex max-w-[900px] flex-col gap-6">
          <span className="flex flex-wrap items-center gap-3" style={rise(0)}>
            <span className={eyebrow}>{p.eyebrow}</span>
            <span className="rounded-full border border-gold-line px-3 py-[3px] font-mono text-[11px] tracking-[1px] text-gold">{p.status.toUpperCase()}</span>
          </span>
          <h1 className="m-0 font-display text-h1 font-extrabold uppercase" style={rise(1)}>
            {p.title[0]} <span className="text-gold whitespace-nowrap">{p.title[1]}</span>
          </h1>
          <p className="m-0 max-w-[700px] text-[18px] leading-[1.6] text-muted" style={rise(2)}>
            {p.lead}
          </p>
          <div className="flex flex-wrap gap-3" style={rise(3)}>
            {p.ctaHref ? (
              <a href={p.ctaHref} className={`${btnGold} inline-flex items-center gap-2 px-[26px] py-4 text-[16px]`}>
                <Rocket aria-hidden size={18} strokeWidth={1.75} />
                {p.cta}
              </a>
            ) : (
              <button type="button" onClick={() => openContact(p.ctaType)} className={`${btnGold} inline-flex items-center gap-2 px-[26px] py-4 text-[16px]`}>
                <Rocket aria-hidden size={18} strokeWidth={1.75} />
                {p.cta}
              </button>
            )}
            <a href={p.source.href} target="_blank" rel="noopener noreferrer" className={`${btnOutline} inline-flex items-center gap-2 px-[26px] py-4 text-[16px]`}>
              <GitBranch aria-hidden size={18} strokeWidth={1.75} />
              Source: {p.source.label}
              <ArrowUpRight aria-hidden size={16} />
            <span className="sr-only"> (opens in a new tab)</span></a>
          </div>
        </div>
      </section>

      <section className="px-page pb-20">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-4">
          {p.features.map((f, i) => (
            <div key={f.title} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-7 transition-[border-color,transform] duration-200 hover:-translate-y-1 hover:border-gold" style={rise(i)}>
              <span className="flex size-11 items-center justify-center rounded-btn border border-gold-line text-gold">
                <f.icon aria-hidden size={20} strokeWidth={1.75} />
              </span>
              <h2 className="m-0 font-display text-h4 font-bold uppercase">{f.title}</h2>
              <p className="m-0 text-[15px] leading-[1.55] text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {p.figure && (
        <section className="px-page pb-20" aria-labelledby="figure-title">
          <div className="mb-8 flex flex-col gap-3">
            <span className={eyebrow}>IN THE PRODUCT</span>
            <h2 id="figure-title" className="m-0 font-display text-h2 font-extrabold uppercase">
              {p.figure.title}
            </h2>
            <p className="m-0 max-w-[680px] text-[15px] leading-[1.6] text-muted">{p.figure.body}</p>
          </div>
          {p.figure.node}
        </section>
      )}

      {p.pricing && <Plans />}

      <section className="border-t border-line bg-bg-alt px-page py-20">
        <span className={eyebrow}>HOW IT WORKS</span>
        <ol className="m-0 mt-6 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-px overflow-hidden rounded-card border border-line bg-line p-0">
          {p.how.map((h, i) => (
            <li key={h.title} className="relative flex flex-col gap-3 bg-bg-alt p-7">
              <span className="font-display text-[44px] leading-none font-extrabold text-gold">{i + 1}</span>
              <h3 className="m-0 font-display text-h4 font-bold uppercase">{h.title}</h3>
              <span className="text-[15px] leading-[1.55] text-muted">{h.body}</span>
              <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-gold" style={{ animation: `gl-grow-x .8s ${0.3 + i * 0.15}s cubic-bezier(.2,.8,.2,1) both` }} />
            </li>
          ))}
        </ol>
        {p.code && (
          <pre className="m-0 mt-8 overflow-x-auto rounded-card border border-line bg-bg p-6 font-mono text-[14px] leading-[1.6] text-ink-2">
            <code>{p.code}</code>
          </pre>
        )}
        <p className="m-0 mt-8 font-mono text-[12px] text-faint">{p.licence}</p>
      </section>
    </>
  )
}

function Plans() {
  const [state, retry] = usePlans()
  return (
    <section className="px-page pb-20" aria-labelledby="plans-title" aria-live="polite">
      <div className="mb-8 flex flex-col gap-3">
        <span className={eyebrow}>PLANS</span>
        <h2 id="plans-title" className="m-0 font-display text-h2 font-extrabold uppercase">
          Start free, <span className="text-gold">pay in crypto</span>
        </h2>
      </div>
      <AnalyticsPlanCards state={state} retry={retry} />
    </section>
  )
}

export const Analytics = () => <ProductPage p={ANALYTICS} />
export const ChainKit = () => <ProductPage p={CHAIN_KIT} />
