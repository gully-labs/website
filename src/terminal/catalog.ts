/* Landing v3 catalog (2026-10-26): every Gully Labs product (one page each at /products/<slug>) and every service we
   sell to other teams. Copy only: no figure is typed in here, every number on the pages is read live.
   server/seo.mjs restates each product's title and description (PRODUCT_PAGES) for crawlers; keep the two in step. */

export type Group = 'chain' | 'labs'
export type Slug = 'gully-id' | 'chain' | 'street' | 'bridge' | 'safe' | 'pay' | 'rpc' | 'holders' | 'security' | 'ai' | 'studio' | 'ipfs' | 'quests' | 'deepcore'

/** A logo straight from a product's kit (web copies in public/brand/web/logos or the kit SVG), or, for a product with
    no kit of its own, the Gully Chain (or Gully Labs) kit mark with the product's name beside it. */
export type LogoDef =
  | { kind: 'kit'; webp?: string; src: string; w: number; h: number; display: number }
  | { kind: 'mark'; mark: 'chain' | 'labs'; label: string }

export interface Feature {
  t: string
  d: string
}
export interface ProductDef {
  slug: Slug
  name: string
  group: Group
  /** One line, the hero's promise. */
  line: string
  /** Shorter, for the logo wall. */
  short: string
  logo: LogoDef
  url: string
  urlLabel: string
  docs?: string
  /** The /api/hub surfaces that make up its live state. */
  hub: string[]
  /** Kit OG image (public/brand/web/og). */
  og: string
  category: string
  features: Feature[]
  how: [string, string][]
  faq: [string, string][]
  /** Where its prices live: read live from /api/plans ('security' | 'holders'), quoted per project, or free. */
  pricing: 'security' | 'holders' | 'free-testnet' | 'on-site' | 'quoted'
}

const LOGO = {
  chain: { kind: 'kit', webp: '/brand/web/logos/gullychain-logo.webp', src: '/brand/web/logos/gullychain-logo.png', w: 415, h: 80, display: 32 },
  pay: { kind: 'kit', src: '/brand/products/gullypay-logo-ondark.svg', w: 895.23, h: 230.4, display: 34 },
  rpc: { kind: 'kit', webp: '/brand/web/logos/gullyrpc-logo.webp', src: '/brand/web/logos/gullyrpc-logo.png', w: 279, h: 80, display: 38 },
  holders: { kind: 'kit', webp: '/brand/web/logos/holdermaps-logo.webp', src: '/brand/web/logos/holdermaps-logo.png', w: 388, h: 80, display: 34 },
  security: { kind: 'kit', src: '/brand/products/gullysecurity-logo-primary.svg', w: 627, h: 104, display: 30 },
  ai: { kind: 'kit', webp: '/brand/web/logos/gullyai-logo.webp', src: '/brand/web/logos/gullyai-logo.png', w: 267, h: 96, display: 40 },
  studio: { kind: 'kit', webp: '/brand/web/logos/gullystudio-logo.webp', src: '/brand/web/logos/gullystudio-logo.png', w: 419, h: 120, display: 44 },
} satisfies Record<string, LogoDef>

const STREET = 'https://app.gullychain.xyz'

export const PRODUCTS: ProductDef[] = [
  {
    slug: 'gully-id',
    name: 'Gully ID',
    group: 'labs',
    line: 'Passwordless sign-in for any app: passkeys, wallets and email over OpenID Connect, with per-app consent.',
    short: 'Passwordless sign-in for any app.',
    logo: { kind: 'mark', mark: 'labs', label: 'Gully ID' },
    url: 'https://gullyid.xyz',
    urlLabel: 'gullyid.xyz',
    docs: 'https://gullyid.xyz/developers',
    hub: ['gully-id'],
    og: '/brand/web/og/gully-labs.jpg',
    category: 'SecurityApplication',
    features: [
      { t: 'Passkeys, wallets and email', d: 'Sign in with a passkey, a wallet (SIWE) or an email code. No passwords.' },
      { t: 'Standard OpenID Connect', d: 'Any app or website adds it like any OIDC provider, or with the Sign in with Gully SDK.' },
      { t: 'Per-app consent', d: 'People choose what each app receives; recovery is slow and visible.' },
      { t: 'Developer console', d: 'Register apps, set redirect URIs and see sign-ins at gullyid.xyz/developers/console.' },
    ],
    how: [
      ['Register your app', 'Create it in the developer console and copy the client ID.'],
      ['Add the button', 'Use the SDK or any OIDC library with gullyid.xyz as the issuer.'],
      ['Read the claims', 'Get the person’s ID and only what they agreed to share.'],
    ],
    faq: [
      ['Is it free?', 'Free up to 1,000 monthly active users; larger plans are billed through Gully Pay.'],
      ['Which Gully products use it?', 'The Gully Chain faucet requires it today. Sign in with Gully is built into Gully Pay and Gully RPC and switches on there next.'],
      ['Google and X sign-in?', 'Coming: the provider keys are pending.'],
    ],
    pricing: 'on-site',
  },
  {
    slug: 'chain',
    name: 'Gully Chain',
    group: 'chain',
    line: 'An Arbitrum Orbit L3 for launches and trading, with DeepCore built in as its launchpad.',
    short: 'L3 on Arbitrum. Testnet 485590 live.',
    logo: LOGO.chain,
    url: 'https://gullychain.xyz',
    urlLabel: 'gullychain.xyz',
    docs: 'https://docs.gullychain.xyz',
    hub: ['chain-site', 'rpc-public', 'explorer', 'faucet', 'indexer', 'docs', 'devportal'],
    og: '/brand/web/og/gully-chain.jpg',
    category: 'BlockchainNetwork',
    features: [
      { t: 'Arbitrum Orbit L3', d: 'Settles to Arbitrum. Chain id 485590 on testnet, with its own explorer, faucet and indexer.' },
      { t: 'DeepCore built in', d: 'The launchpad is part of the chain: a token and its pool in one step, graduation to Gully Swap.' },
      { t: 'Served by Gully RPC', d: 'A free public RPC, plus keyed access at rpc.gullyrpc.xyz/<project>/evm/485590.' },
      { t: 'Two bridges', d: 'The canonical Arbitrum bridge and a Hyperlane fast lane (gETH) in Gully Bridge.' },
      { t: 'Names and quests', d: '.gully names, on-chain Quests with ETH reward pools and the Arcade, all in Gully Street.' },
      { t: 'Open data', d: 'Tokens, trades, names and quests as JSON from the indexer; every figure here comes from it.' },
    ],
    how: [
      ['Add the network', 'Chain 485590 with the public RPC or your Gully RPC key, and the explorer.'],
      ['Get test ETH', 'The faucet, or bridge from Arbitrum Sepolia through Gully Bridge.'],
      ['Launch or build', 'Launch a token on DeepCore, or deploy your contracts with the developer portal.'],
    ],
    faq: [
      ['Is Gully Chain on mainnet?', 'Not yet. The testnet (chain 485590) is live; mainnet follows the testnet programme.'],
      ['Can you launch a chain like this for us?', 'Yes. Chain launch is one of our services: the same Orbit stack, explorer, bridge and RPC, run by us.'],
      ['Where do I get an RPC key?', 'From Gully RPC. The public endpoint stays free and rate-limited.'],
    ],
    pricing: 'free-testnet',
  },
  {
    slug: 'street',
    name: 'Gully Street',
    group: 'chain',
    line: 'The Gully Chain app: a social feed, five wallets per passkey, copy trading, Quests and the launchpad.',
    short: 'Social trading app on Gully Chain.',
    logo: { kind: 'mark', mark: 'chain', label: 'Gully Street' },
    url: STREET,
    urlLabel: 'app.gullychain.xyz',
    docs: 'https://docs.gullychain.xyz',
    hub: ['street', 'social', 'copy'],
    og: '/brand/web/og/gully-chain.jpg',
    category: 'FinanceApplication',
    features: [
      { t: 'Social feed', d: 'Launches, trades and swaps on Gully Chain as they happen, from the indexer.' },
      { t: 'Passkey wallets', d: 'Up to five wallets behind one passkey: no seed phrase to write down.' },
      { t: 'Copy trading', d: 'Follow a wallet and mirror its trades with your own limits.' },
      { t: 'Launchpad and swap', d: 'DeepCore launches and Gully Swap in the same app.' },
      { t: 'Quests and Arcade', d: 'On-chain quests with ETH rewards, and games scored on chain.' },
      { t: '.gully names', d: 'A readable name for your wallet, shown across the feed.' },
    ],
    how: [
      ['Sign in with a passkey', 'Your wallets are created for you, on Gully Chain testnet.'],
      ['Fund a wallet', 'Faucet or bridge, then trade, launch or follow.'],
      ['Earn on Quests', 'Complete quests to claim from their ETH reward pools.'],
    ],
    faq: [
      ['Is Gully Street custodial?', 'No. Your passkey controls your wallets.'],
      ['Which network does it use?', 'Gully Chain testnet, chain 485590.'],
    ],
    pricing: 'free-testnet',
  },
  {
    slug: 'bridge',
    name: 'Gully Bridge',
    group: 'chain',
    line: 'Move ETH between Arbitrum Sepolia and Gully Chain: a Hyperlane fast lane (gETH) and the canonical bridge.',
    short: 'Fast lane (gETH) plus canonical.',
    logo: { kind: 'mark', mark: 'chain', label: 'Gully Bridge' },
    url: 'https://testnet-bridge.gullychain.xyz',
    urlLabel: 'testnet-bridge.gullychain.xyz',
    docs: 'https://docs.gullychain.xyz',
    hub: ['bridge'],
    og: '/brand/web/og/gully-chain.jpg',
    category: 'FinanceApplication',
    features: [
      { t: 'Fast lane', d: 'Hyperlane warp route: ETH locked on Arbitrum Sepolia mints gETH on Gully Chain in about a minute.' },
      { t: 'Canonical lane', d: 'The Arbitrum Orbit bridge for native ETH, with its standard withdrawal window.' },
      { t: 'Fully backed', d: 'Every gETH is backed by ETH held by the route on Arbitrum Sepolia; both figures are on this page.' },
      { t: 'Our own relayer', d: 'Messages are relayed and validated by Gully-run Hyperlane agents.' },
    ],
    how: [
      ['Pick a lane', 'Fast (gETH) for speed, Canonical for native ETH.'],
      ['Sign once', 'Your wallet sends the deposit on the source chain.'],
      ['Receive', 'gETH or ETH arrives in the same wallet on the other side.'],
    ],
    faq: [
      ['What is gETH?', 'Gully Bridged ETH: an ERC-20 on Gully Chain, minted 1:1 against ETH locked on Arbitrum Sepolia.'],
      ['Is this mainnet?', 'No. Both lanes run on testnets today.'],
    ],
    pricing: 'free-testnet',
  },
  {
    slug: 'safe',
    name: 'Gully Safe',
    group: 'chain',
    line: 'Multisig wallets on Gully Chain, for treasuries and teams.',
    short: 'Multisig wallets on Gully Chain.',
    logo: { kind: 'mark', mark: 'chain', label: 'Gully Safe' },
    url: 'https://safe.gullychain.xyz',
    urlLabel: 'safe.gullychain.xyz',
    docs: 'https://docs.gullychain.xyz',
    hub: ['safe'],
    og: '/brand/web/og/gully-chain.jpg',
    category: 'FinanceApplication',
    features: [
      { t: 'M-of-N signing', d: 'Any number of owners and a threshold you choose.' },
      { t: 'Team treasuries', d: 'Hold launch proceeds and protocol fees under shared control.' },
      { t: 'On Gully Chain', d: 'Deployed on chain 485590 alongside the rest of the stack.' },
    ],
    how: [
      ['Create a Safe', 'Add owners and set the threshold.'],
      ['Fund it', 'Send ETH or tokens to the Safe address.'],
      ['Propose and sign', 'Owners sign until the threshold is met, then it executes.'],
    ],
    faq: [['Is Gully Safe live?', 'It is being deployed. This page shows its real state, checked every minute.']],
    pricing: 'free-testnet',
  },
  {
    slug: 'pay',
    name: 'Gully Pay',
    group: 'labs',
    line: 'x402 payments, hosted checkout and a merchant OS, settled on chain to your own wallet.',
    short: 'x402 payments and checkout.',
    logo: LOGO.pay,
    url: 'https://gullypay.xyz',
    urlLabel: 'gullypay.xyz',
    docs: 'https://gullypay.xyz/docs',
    hub: ['pay', 'x402', 'pay-admin'],
    og: '/brand/web/og/gully-pay.jpg',
    category: 'FinanceApplication',
    features: [
      { t: 'x402 facilitator', d: 'Pay-per-request for APIs and agents, Gully Chain among its networks.' },
      { t: 'Hosted checkout', d: 'Pay links and invoices; payments go straight to the merchant wallet.' },
      { t: 'Merchant OS', d: 'Stores, webhooks per step (paid, confirmed, settled) and receipts.' },
      { t: 'Gateway for every Gully product', d: 'Every Gully product bills through Gully Pay.' },
    ],
    how: [
      ['Open a store', 'Sign up and name your store; payouts go to your own wallet.'],
      ['Share a link or add x402', 'A pay link per order, or x402 in front of an API.'],
      ['Get the webhook', 'One signed webhook per step, with receipts.'],
    ],
    faq: [
      ['How many payments has Gully Pay processed?', 'None yet. Sign-up is open; this page shows the live networks and uptime instead of volume.'],
      ['Is it custodial?', 'No. Funds settle to the merchant wallet.'],
    ],
    pricing: 'on-site',
  },
  {
    slug: 'rpc',
    name: 'Gully RPC',
    group: 'labs',
    line: 'One key for every network: the node control plane and RPC gateway behind every Gully chain.',
    short: 'RPC gateway, one key for every chain.',
    logo: LOGO.rpc,
    url: 'https://gullyrpc.xyz',
    urlLabel: 'gullyrpc.xyz',
    docs: 'https://gullyrpc.xyz/docs/',
    hub: ['rpc-site', 'rpc-app', 'rpc-gateway'],
    og: '/brand/web/og/gully-rpc.jpg',
    category: 'DeveloperApplication',
    features: [
      { t: 'One URL shape', d: 'rpc.gullyrpc.xyz/<project>/evm/<chainId> for every network we serve.' },
      { t: 'Gully Chain first', d: 'Every Gully node is served through Gully RPC, testnet included.' },
      { t: 'Usage per project', d: 'Requests, errors and latency per key, in the portal.' },
      { t: 'Billed through Gully Pay', d: 'Plans paid on chain; no cards on file.' },
    ],
    how: [
      ['Get a key', 'Create a project in the Gully RPC app.'],
      ['Swap the URL', 'Use your project URL in viem, ethers or wagmi.'],
      ['Watch usage', 'Requests, errors and latency per project.'],
    ],
    faq: [['Which networks are served?', 'The live list is on this page, read from the gateway itself.']],
    pricing: 'on-site',
  },
  {
    slug: 'holders',
    name: 'HolderMaps',
    group: 'labs',
    line: 'Who really holds a token: bubble maps, wallet clusters and deep checks, Gully Chain tokens included.',
    short: 'Holder bubble maps and deep checks.',
    logo: LOGO.holders,
    url: 'https://holdermaps.xyz',
    urlLabel: 'holdermaps.xyz',
    docs: 'https://docs.gullylabs.xyz/holder-map',
    hub: ['holders'],
    og: '/brand/web/og/holdermaps.jpg',
    category: 'FinanceApplication',
    features: [
      { t: 'Bubble maps', d: 'The biggest wallets as bubbles; links are shared funding and transfers.' },
      { t: 'Launch health', d: 'Bundled buys, snipers, the deployer’s record and liquidity, scored part by part.' },
      { t: 'Deep check', d: 'Funding trace and shared-funder clusters in one report.' },
      { t: 'Embed and API', d: 'A one-tag embed for launchpads and a public JSON API.' },
    ],
    how: [
      ['Paste a token', 'Any contract on a supported chain, Gully Chain included.'],
      ['Read the map', 'Clusters, insiders and the launch checks.'],
      ['Go deeper', 'Run a Deep check or set cluster alerts.'],
    ],
    faq: [['Which chains?', 'Gully Chain, Robinhood Chain, BNB Chain, Base, HyperEVM and Solana.']],
    pricing: 'holders',
  },
  {
    slug: 'security',
    name: 'Gully Security',
    group: 'labs',
    line: 'AI security scans, contract monitors and the Gully Score for any contract, Gully Chain contracts included.',
    short: 'AI scans, monitors and the Gully Score.',
    logo: LOGO.security,
    url: 'https://gullysecurity.xyz',
    urlLabel: 'gullysecurity.xyz',
    docs: 'https://docs.gullylabs.xyz/gully-security',
    hub: ['security'],
    og: '/brand/web/og/gully-security.jpg',
    category: 'SecurityApplication',
    features: [
      { t: 'AI Security Scan', d: 'A deployed contract or a repository, scanned with findings by severity, file and line.' },
      { t: 'Security Review', d: 'People read your code; quoted per project.' },
      { t: 'Monitors', d: 'Alerts on risky changes by Telegram or webhook.' },
      { t: 'Gully Score', d: 'A public 0–100 score from evidence only. Nobody can pay to change it.' },
    ],
    how: [
      ['Scan it', 'Paste an address or upload code.'],
      ['Read the report', 'Findings, the tools that ran and the limits of an automated scan.'],
      ['Monitor it', 'Turn on monitors, publish the report if you choose.'],
    ],
    faq: [['Is a scan an audit?', 'No. An automated scan is not an audit; Security Reviews are done by people and quoted per project.']],
    pricing: 'security',
  },
  {
    slug: 'ai',
    name: 'Gully AI',
    group: 'labs',
    line: 'Answers about Gully with sources and live figures; the Gully AI API opens when its GPU box is up.',
    short: 'Cited answers; API coming.',
    logo: LOGO.ai,
    url: 'https://gullyai.xyz',
    urlLabel: 'gullyai.xyz',
    docs: 'https://gullyai.xyz/docs/',
    hub: ['gullyai', 'ai-api'],
    og: '/brand/web/og/gully-ai.jpg',
    category: 'DeveloperApplication',
    features: [
      { t: 'Cited answers', d: 'Every answer names its sources and quotes live figures where they matter.' },
      { t: 'Everywhere', d: 'On the site, in the docs, in the app and in Telegram.' },
      { t: 'API (coming)', d: 'Shown as coming until the gateway answers; never as down.' },
    ],
    how: [
      ['Ask', 'Ask about any Gully product, plan or doc.'],
      ['Check the sources', 'Each answer links what it read.'],
      ['Build on it', 'The API opens with the GPU box.'],
    ],
    faq: [['Can you add AI to our product?', 'Yes. AI integration is one of our services.']],
    pricing: 'on-site',
  },
  {
    slug: 'studio',
    name: 'Gully Studio',
    group: 'labs',
    line: 'Our game studio: Unity 3D titles on Gully Chain with the Gully Game SDK, paid through Gully Pay.',
    short: 'Unity 3D games on Gully Chain.',
    logo: LOGO.studio,
    url: 'https://gullystudio.xyz',
    urlLabel: 'gullystudio.xyz',
    docs: 'https://docs.gullystudio.xyz',
    hub: ['studio', 'studio-dev', 'studio-docs'],
    og: '/brand/web/og/gully-studio.jpg',
    category: 'GameApplication',
    features: [
      { t: 'Unity 3D', d: 'Games built in Unity with the Gully Game SDK for wallets and items.' },
      { t: 'Scores on chain', d: 'Seasons and scores on the GullyArcade contract on Gully Chain.' },
      { t: 'Gully Pay inside', d: 'In-game purchases settle through Gully Pay.' },
    ],
    how: [
      ['Build in Unity', 'The Gully Game SDK for wallets, items and scores.'],
      ['Ship on Gully Chain', 'Items and scores on chain 485590.'],
      ['Sell with Gully Pay', 'Purchases settled on chain.'],
    ],
    faq: [['Do you build games for others?', 'Yes. Game development is one of our services.']],
    pricing: 'quoted',
  },
  {
    slug: 'ipfs',
    name: 'Gully IPFS',
    group: 'labs',
    line: 'Our IPFS node and read-only gateway for Gully content: token art, metadata, NFT art and .gully sites.',
    short: 'Pinned content and a gateway.',
    logo: { kind: 'mark', mark: 'labs', label: 'Gully IPFS' },
    url: 'https://docs.gullylabs.xyz/ipfs',
    urlLabel: 'docs.gullylabs.xyz/ipfs',
    docs: 'https://docs.gullylabs.xyz/ipfs',
    hub: ['ipfs'],
    og: '/brand/web/og/gully-labs.jpg',
    category: 'DeveloperApplication',
    features: [
      { t: 'Pinned for good', d: 'Token images, metadata and NFT art pinned on our own Kubo node.' },
      { t: 'Read-only gateway', d: 'ipfs.gullylabs.xyz/ipfs/<CID> serves only what we pin.' },
      { t: '.gully sites', d: 'Point a .gully name’s contenthash at a CID.' },
    ],
    how: [
      ['We pin it', 'Gully content only.'],
      ['Link the CID', 'Our gateway or any IPFS gateway.'],
      ['Name it', 'A .gully name for a site on IPFS.'],
    ],
    faq: [['Can I pin my own files?', 'Not as a public service: the gateway serves Gully content only.']],
    pricing: 'quoted',
  },
  {
    slug: 'quests',
    name: 'Gully Quests',
    group: 'chain',
    line: 'On-chain quests on Gully Chain: tasks verified by contract, rewards paid from ETH pools.',
    short: 'On-chain quests with ETH pools.',
    logo: { kind: 'mark', mark: 'chain', label: 'Gully Quests' },
    url: `${STREET}/quests`,
    urlLabel: 'app.gullychain.xyz/quests',
    docs: 'https://docs.gullychain.xyz',
    hub: ['street', 'indexer'],
    og: '/brand/web/og/gully-chain.jpg',
    category: 'GameApplication',
    features: [
      { t: 'Verified on chain', d: 'Names, holdings, launchpad trades, swaps, bridging, arcade scores and referrals.' },
      { t: 'ETH reward pools', d: 'Each quest is funded up front; claims pay from its pool.' },
      { t: 'Open registry', d: 'Anyone can read the QuestRegistry; the indexer serves stats and completions.' },
    ],
    how: [
      ['Pick a quest', 'In Gully Street’s Quests tab.'],
      ['Do it on chain', 'The verifier checks your wallet.'],
      ['Claim', 'The reward is paid from the quest’s pool.'],
    ],
    faq: [['Can we run quests for our launch?', 'Yes. Token launch and growth campaigns are one of our services.']],
    pricing: 'free-testnet',
  },
  {
    slug: 'deepcore',
    name: 'DeepCore launchpad',
    group: 'chain',
    line: 'Gully Chain’s built-in launchpad: a token and its pool in one step, graduating to Gully Swap.',
    short: 'Built-in launchpad on Gully Chain.',
    logo: { kind: 'mark', mark: 'chain', label: 'DeepCore launchpad' },
    url: `${STREET}/launch`,
    urlLabel: 'app.gullychain.xyz/launch',
    docs: 'https://docs.gullychain.xyz',
    hub: ['street', 'indexer'],
    og: '/brand/web/og/gully-chain.jpg',
    category: 'FinanceApplication',
    features: [
      { t: 'One-step launch', d: 'Token, bonding curve and pool in a single transaction.' },
      { t: 'Graduation', d: 'Completed curves graduate to a Gully Swap pool.' },
      { t: 'Checked by HolderMaps', d: 'Every launch can be mapped and health-checked.' },
    ],
    how: [
      ['Launch', 'Name, ticker and image in Gully Street.'],
      ['Trade the curve', 'Buys and sells on the bonding curve.'],
      ['Graduate', 'Liquidity moves to Gully Swap.'],
    ],
    faq: [['Is this the same DeepCore as deepcore.fun?', 'DeepCore runs on several chains; on Gully Chain it is the built-in launchpad. Its cross-chain figures are below.']],
    pricing: 'free-testnet',
  },
]

export const productBySlug = (s: string | undefined) => PRODUCTS.find((p) => p.slug === s) ?? null

/* ---------------------------------------------------------------- services ---- */
export type ServiceKey = 'chain' | 'contracts' | 'security' | 'apps' | 'payments' | 'infra' | 'launch' | 'ai' | 'games'
export interface ServiceDef {
  key: ServiceKey
  title: string
  desc: string
  deliverables: string[]
  timeline: string
  /** Our own product that proves it. */
  proof: Slug
}
export const SERVICES: ServiceDef[] = [
  { key: 'chain', title: 'L2/L3 chain launch', desc: 'Your own Arbitrum Orbit rollup, run by us: the stack behind Gully Chain.', deliverables: ['Orbit L2/L3 deployment', 'Explorer, faucet, indexer', 'Canonical + Hyperlane bridge', 'RPC through Gully RPC', 'Monitoring and status'], timeline: 'Testnet in 2–4 weeks · mainnet 6–10 weeks', proof: 'chain' },
  { key: 'contracts', title: 'Smart contract development', desc: 'Tokens, launchpads, DEX pools, vaults and registries, written and tested for production.', deliverables: ['Solidity + Foundry test suites', 'Gas report', 'Deployment scripts and verification', 'Internal security review'], timeline: '2–8 weeks', proof: 'quests' },
  { key: 'security', title: 'Security reviews and monitoring', desc: 'AI scans, human reviews and live monitors from Gully Security.', deliverables: ['AI Security Scan report', 'Manual Security Review', 'Monitors with Telegram/webhook alerts', 'Gully Score page'], timeline: 'Scan same day · review 1–3 weeks', proof: 'security' },
  { key: 'apps', title: 'dApp, web and mobile development', desc: 'Front ends, wallets and apps like Gully Street: passkeys, feeds, trading.', deliverables: ['React / Next.js web app', 'iOS and Android apps', 'Passkey and wallet sign-in', 'Indexer and API'], timeline: '4–12 weeks', proof: 'street' },
  { key: 'payments', title: 'Payments integration', desc: 'Crypto checkout and x402 pay-per-request with Gully Pay.', deliverables: ['Hosted checkout or pay links', 'x402 for APIs and agents', 'Signed webhooks', 'Settlement to your wallets'], timeline: '1–3 weeks', proof: 'pay' },
  { key: 'infra', title: 'RPC and infrastructure', desc: 'Nodes, gateways and observability with Gully RPC.', deliverables: ['Dedicated or shared nodes', 'RPC gateway with keys', 'Usage metering', 'Status page and alerts'], timeline: '1–4 weeks', proof: 'rpc' },
  { key: 'launch', title: 'Token launch, quests and growth', desc: 'Launch on DeepCore, map the holders, and grow with on-chain Quests.', deliverables: ['Launch plan and contracts', 'DeepCore launch', 'Quests campaign with reward pools', 'HolderMaps health checks'], timeline: '1–4 weeks', proof: 'deepcore' },
  { key: 'ai', title: 'AI integration', desc: 'Assistants that cite their sources and read live on-chain data, like Gully AI.', deliverables: ['Retrieval over your docs', 'Live data tools', 'Chat on web and Telegram', 'Evaluation and logs'], timeline: '2–6 weeks', proof: 'ai' },
  { key: 'games', title: 'Game development', desc: 'Unity 3D games with on-chain items and scores, from Gully Studio.', deliverables: ['Unity 3D game', 'Gully Game SDK integration', 'On-chain scores and items', 'In-game payments'], timeline: '8–24 weeks', proof: 'studio' },
]

export const BUDGETS = ['Under $10k', '$10k–$25k', '$25k–$50k', '$50k–$100k', '$100k+', 'Not sure yet']
