/* What the Gully Labs app offers (app.gullylabs.xyz), as the landing tells it. Owner, 2026-11-20: "i want gullylabs
   landing to only promote what's in the dapp and move all projects to a projects page".

   The app's sidebar (src/pages/developers/services/nav.ts SIDEBAR) lists ten pages. Seven are services or tools a
   customer uses: Chains, IPFS, Analytics, Services (development), Keys, Billing and Team; Overview, Activity and
   Settings are the account around them. The landing promotes those seven as six cards (Billing and Team share one).
   Every other Gully product is a project and lives on /projects.

   Plain data with no imports: server/landing.mjs reads it through server/data/page-content.json (written by
   scripts/build-page-content.mjs), and scripts/test-landing.mjs checks that it matches the app's sidebar. */

export interface AppService {
  key: 'chains' | 'ipfs' | 'analytics' | 'services' | 'keys' | 'billing'
  /** The sidebar pages this card covers (services/nav.ts ids). */
  pages: string[]
  label: string
  icon: string
  title: string
  body: string
  steps: [string, string, string]
  cta: string
  /** The page of the app, or of this site, the button opens. */
  href: string
  /** Docs page, when there is one. */
  docs?: string
  /** The probes (server/hub.mjs SURFACES keys) whose response time and uptime the card's chart draws. */
  probes: string[]
  /** What the chart draws: the probes' response time, the newest chain blocks, or the plans' prices in USD. */
  chart: 'latency' | 'blocks' | 'plans'
  /** What the chart is, in words. */
  caption: string
}

export const APP_URL = 'https://app.gullylabs.xyz'

export const APP_SERVICES: AppService[] = [
  {
    key: 'chains',
    pages: ['chains'],
    label: 'Chains',
    icon: 'boxes',
    title: 'Your own chain',
    body: 'Order an Arbitrum Orbit L2 or L3 on the stack Gully Chain runs: explorer, bridge, faucet and RPC included. A person at Gully Labs sets it up, and you follow every order in the app.',
    steps: ['Tell us what you need', 'We set up the chain', 'Follow the order and go live'],
    cta: 'Order a chain',
    href: `${APP_URL}/create-chain`,
    probes: ['rpc-public', 'indexer'],
    chart: 'blocks',
    caption: 'Newest blocks on Gully Chain testnet, the chain we run on this stack',
  },
  {
    key: 'ipfs',
    pages: ['ipfs'],
    label: 'IPFS',
    icon: 'hard-drive',
    title: 'Gully IPFS',
    body: 'Pin files to IPFS with your own keys, upload from the app and serve them at ipfs.gullylabs.xyz. Every pin is held on two nodes on different servers, and you see only your own pins and usage. Early access.',
    steps: ['Create a key', 'Pin or upload a file', 'Share the gateway link'],
    cta: 'Pin a file',
    href: `${APP_URL}/#ipfs`,
    docs: 'https://docs.gullylabs.xyz/ipfs',
    probes: ['ipfs'],
    chart: 'latency',
    caption: 'Gully IPFS gateway response time',
  },
  {
    key: 'analytics',
    pages: ['analytics'],
    label: 'Analytics',
    icon: 'chart-line',
    title: 'Gully Analytics',
    body: 'Cookie-free analytics for your sites: page views plus wallet connects, chains and transactions, in one visit to wallet to transaction funnel. One script tag with data-web3.',
    steps: ['Add a website', 'Install the snippet', 'Read the funnel'],
    cta: 'Track a site',
    href: `${APP_URL}/#analytics`,
    docs: 'https://docs.gullylabs.xyz/analytics',
    probes: ['analytics'],
    chart: 'latency',
    caption: 'Gully Analytics response time',
  },
  {
    key: 'services',
    pages: ['services'],
    label: 'Development',
    icon: 'hammer',
    title: 'Development services',
    body: 'Chains, contracts, apps, payments, infrastructure, AI and games, built by the team that runs its own chain, payments, RPC and security products in production. Request a build or a quote from the app.',
    steps: ['Describe the project', 'Get a quote', 'We build and ship it'],
    cta: 'Request a build',
    href: `${APP_URL}/#services`,
    probes: ['gully-id', 'pay', 'rpc-site', 'security', 'holders', 'studio'],
    chart: 'latency',
    caption: 'Response time across the services we built and run, average of those answering',
  },
  {
    key: 'keys',
    pages: ['keys'],
    label: 'API keys',
    icon: 'key-round',
    title: 'Gully Labs API keys',
    body: 'Keys for the Gully Labs API, how much each one is used, and a quickstart to make your first call. Free to start, with Pro and Business plans when you need more.',
    steps: ['Create a key', 'Make a first call', 'Watch usage per key'],
    cta: 'Create a key',
    href: `${APP_URL}/#keys`,
    docs: 'https://docs.gullylabs.xyz/api-keys',
    probes: ['api'],
    chart: 'latency',
    caption: 'Gully Labs API response time',
  },
  {
    key: 'billing',
    pages: ['billing', 'team'],
    label: 'Billing and team',
    icon: 'users',
    title: 'Billing and team',
    body: 'Pay for a plan in the coin you choose, straight to the Gully Labs treasury, with a receipt for every payment. Invite teammates to the workspace and see who did what.',
    steps: ['Pick a plan', 'Pay in the coin you hold', 'Invite your team'],
    cta: 'See plans',
    href: `${APP_URL}/#billing`,
    probes: [],
    chart: 'plans',
    caption: 'Gully Labs API plans, price per 30 days in USD',
  },
]

/** The sidebar pages the landing leaves to the account around the services. */
export const ACCOUNT_PAGES = ['overview', 'activity', 'settings']
