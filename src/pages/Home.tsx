import { lazy } from 'react'
import { Link } from 'react-router'
import { DemoSection, type DemoSectionProps } from '../components/landing/DemoSection'
import { HeroLedger } from '../components/landing/HeroLedger'
import { h2, PORTAL, PORTAL_ALERTS } from '../components/landing/links'
import { Kicker, LandingPricing, OpenStrip, ProductIndex, ServicesBlock } from '../components/landing/Sections'
import { ProjectRows } from '../components/ProjectRows'
import { Seo } from '../components/Seo'
import { ShareStrip } from '../components/Share'
import { btnGold, btnOutline } from '../components/ui'
import { comingSoon, projects } from '../content/projects'
import { useStats } from '../hooks/useStats'
import { ANALYTICS_SIGNUP, usePlans } from '../lib/plans'

/* The showroom landing: the ledger of every venue up top, an index of everything we ship, the projects
   table, then one section per product with a live demo of it, pricing, services and the open-source
   strip. Each demo is its own chunk, fetched only as its section nears the viewport (DemoSection). */

const TrackerDemo = lazy(() => import('../components/demos/TrackerDemo'))
const AlertsDemo = lazy(() => import('../components/demos/AlertsDemo'))
const AnalyticsDemo = lazy(() => import('../components/demos/AnalyticsDemo'))
const ChainKitDemo = lazy(() => import('../components/demos/ChainKitDemo'))
const ApiDemo = lazy(() => import('../components/demos/ApiDemo'))
const WidgetDemo = lazy(() => import('../components/demos/WidgetDemo'))
const PayDemo = lazy(() => import('../components/demos/PayDemo'))

const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven']
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

export function Home() {
  const st = useStats()
  const data = st.k === 'ok' ? st.data : null
  const [plans] = usePlans()
  const anon = plans.k === 'ok' ? plans.offer.anonymous.perMin : null
  const free = plans.k === 'ok' ? plans.offer.plans.find((p) => p.id === 'free') : undefined
  const trialDays = plans.k === 'ok' ? plans.offer.analytics.trialDays : null

  const demos: DemoSectionProps[] = [
    {
      id: 'tracker',
      n: '02',
      kicker: 'STOCK TOKEN TRACKER + SWAP',
      title: 'Is your stock token fairly priced?',
      body: 'Every tokenised stock on Robinhood Chain and BNB Chain, its deepest pool against its Chainlink fair price, every minute. A page per stock with a swap built in.',
      tags: ['2 chains', 'Every minute', 'LI.FI swap'],
      cta: { label: 'Open the tracker', to: '/tracker' },
      height: 560,
      Demo: TrackerDemo,
    },
    {
      id: 'alerts',
      n: '03',
      kicker: 'ALERTS',
      title: 'Told the minute a stock drifts',
      body: 'Set a gap rule once. Get a Telegram message with Open and Mute buttons, a signed webhook, or both.',
      tags: ['Telegram', 'Webhook', 'Mute 24h'],
      cta: { label: 'Set an alert', href: PORTAL_ALERTS },
      alt: true,
      height: 560,
      Demo: AlertsDemo,
    },
    {
      id: 'analytics',
      n: '04',
      kicker: 'GULLY ANALYTICS',
      title: 'Web analytics that see the wallet',
      body: `Page views next to wallet connects, chains and transactions, with a visit to transaction funnel. Cookie-free, built on Umami. Sign up with your wallet${trialDays ? `, ${trialDays} days free` : ', free trial'}.`,
      tags: [trialDays ? `${trialDays} days free` : 'Free trial', 'Cookie-free', 'Web3 events'],
      cta: { label: 'Start the free trial', href: ANALYTICS_SIGNUP },
      height: 600,
      Demo: AnalyticsDemo,
    },
    {
      id: 'chainkit',
      n: '05',
      kicker: 'CHAIN KIT',
      title: 'A block explorer with your name on it',
      body: 'Blockscout, branded and operated by Gully Labs: your domain, colours, token list, contract verification and API. Change the brand below and watch it update.',
      tags: ['Blockscout', 'Your brand', 'Managed'],
      cta: { label: 'Explore Chain Kit', to: '/chain-kit' },
      alt: true,
      height: 620,
      Demo: ChainKitDemo,
    },
    {
      id: 'api',
      n: '06',
      kicker: 'API + SDK',
      title: 'Build on the same data',
      body: `Every tracker row as JSON. ${anon ? `${anon} calls a minute` : 'Free calls'} with no key; sign in with your wallet for a free key${free ? ` (${free.perMin.toLocaleString('en-US')} a minute)` : ''} and higher limits on a plan. Typed TypeScript SDK, MIT.`,
      tags: ['REST · JSON', 'Wallet sign-in', '@gullylabs/tracker'],
      cta: { label: 'Get a key', href: PORTAL },
      height: 560,
      Demo: ApiDemo,
    },
    {
      id: 'widget',
      n: '07',
      kicker: 'WIDGET',
      title: 'A live ticker on any site',
      body: 'One script tag puts a ticker, a one-stock badge or a table of the widest gaps on your site. Also a React component in the SDK.',
      tags: ['Ticker', 'Badge', 'Table'],
      cta: { label: 'Build a widget', to: '/widget' },
      alt: true,
      height: 520,
      Demo: WidgetDemo,
    },
    {
      id: 'pay',
      n: '08',
      kicker: 'GULLY PAY',
      title: 'Paid in crypto, held by no one',
      body: 'Every plan is paid from your wallet straight to ours in ETH, BNB, USDC or USDT on four chains. Checked on chain, active the moment it confirms.',
      tags: ['4 chains', '4 assets', 'No custody'],
      cta: { label: 'See plans', to: '/#pricing' },
      height: 540,
      Demo: PayDemo,
    },
  ]

  return (
    <>
      <Seo
        title="Web3 projects and blockchain development"
        description="Gully Labs ships on-chain venues and the tools around them: a stock token tracker with swaps and alerts, wallet-aware analytics, branded block explorers, a free API and crypto billing. Every venue's figures are read live."
      />

      <section id="top" className="flex flex-wrap items-center gap-8 px-page pt-12 pb-8">
        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-[18px]" style={{ animation: 'gl-rise .7s cubic-bezier(.2,.8,.2,1) both' }}>
          <span className="flex items-center gap-2 font-mono text-[12px] tracking-[1.5px] text-gold">
            <span aria-hidden className="size-[7px] flex-none rounded-full bg-green" style={{ animation: 'gl-pulse-ring 1.8s infinite' }} />
            {(words[projects.length] ?? String(projects.length)).toUpperCase()} VENUES · TEN PRODUCTS · ONE LEDGER
          </span>
          <h1 className="m-0 font-display text-[clamp(54px,7cqw,96px)] leading-[.88] font-extrabold uppercase">
            Built here.
            <br />
            <span className="text-gold">Measured</span> live.
          </h1>
          <p className="m-0 max-w-[480px] text-[16px] leading-[1.5] text-muted">
            Gully Labs ships on-chain venues and the tools around them: a stock token tracker with swaps and alerts, analytics that see the wallet, branded block explorers, a free API, and crypto billing. Try every one of them below.
          </p>
          <div className="flex flex-wrap gap-[10px]">
            <Link to="/#index" className={`${btnGold} inline-flex min-h-11 items-center px-5`}>
              Try the products
            </Link>
            <Link to="/#services" className={`${btnOutline} inline-flex min-h-11 items-center px-[18px]`}>
              Work with us
            </Link>
          </div>
        </div>
        <div id="ledger" className="min-w-0 flex-[1.3_1_520px] scroll-mt-20" style={{ animation: 'gl-rise .7s .1s cubic-bezier(.2,.8,.2,1) both' }}>
          <HeroLedger data={data} state={st.k} />
        </div>
      </section>

      <ProductIndex />

      <section id="projects" aria-labelledby="projects-title" className="scroll-mt-20 border-t border-line">
        <div className="flex flex-col gap-4 px-page py-12">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <Kicker n="01" label="PROJECTS" />
              <h2 id="projects-title" className={h2}>
                Out of the lab
              </h2>
            </div>
            <p className="m-0 max-w-[420px] text-[14px] leading-[1.5] text-muted">
              {cap(words[projects.length] ?? String(projects.length))} live venues, {words[comingSoon.length] ?? comingSoon.length} in development. Every row reads its own project's API. Sort by any column.
            </p>
          </div>
          <ProjectRows data={data} state={st.k} />
        </div>
      </section>

      {demos.map((d) => (
        <DemoSection key={d.id} {...d} />
      ))}

      <LandingPricing plans={plans} />
      <ServicesBlock />
      <OpenStrip />
      <ShareStrip data={data} />
    </>
  )
}
