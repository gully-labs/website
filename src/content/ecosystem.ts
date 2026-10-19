// What the /ecosystem and /partners pages say about third parties and what partners get. Every entry here
// is confirmed in shipped code (the `where` field names the file that proves it); anything that is only a
// plan is not listed (Hyperlane appears only in the Gully L3 spec, which is not shipped, so it is left out).
// No figure lives here: numbers on those pages come from /api/stats and /api/holders/*.

import { DOCS_URL } from '../site-host'

export type IntegrationKind = 'Data' | 'Swaps & payments' | 'Security' | 'Wallets & infra'

export interface Integration {
  name: string
  kind: IntegrationKind
  /** What Gully Labs uses it for, in a sentence. */
  use: string
  /** Where the code is. */
  where: string
  href: string
}

export const integrations: Integration[] = [
  { name: 'Chainlink', kind: 'Data', use: 'Fair prices for every tokenised stock, read on chain with latestRoundData().', where: 'server/tracker.mjs', href: 'https://chain.link/' },
  { name: 'DefiLlama', kind: 'Data', use: 'All-time and fee figures for Peddles, PeddleQuest and DeepCore where a venue has no dollar figure of its own.', where: 'server/stats.mjs', href: 'https://defillama.com/' },
  { name: 'DexScreener', kind: 'Data', use: 'On-chain price and pool depth of each stock token in its deepest pool.', where: 'server/tracker.mjs', href: 'https://dexscreener.com/' },
  { name: 'GeckoTerminal', kind: 'Data', use: 'The second pool-price source, used when DexScreener refuses.', where: 'server/tracker.mjs', href: 'https://www.geckoterminal.com/' },
  { name: 'CoinGecko', kind: 'Data', use: 'Token logos, by contract address.', where: 'server/token-logos.mjs', href: 'https://www.coingecko.com/' },
  { name: 'Blockscout', kind: 'Data', use: 'Top holders and address name tags for the Holder Map, and the explorer Chain Kit deploys.', where: 'server/holders.mjs', href: 'https://www.blockscout.com/' },
  { name: 'Moralis', kind: 'Data', use: 'Top holders and the latest transfers for tokens on BNB Chain.', where: 'server/holders.mjs', href: 'https://moralis.com/' },
  { name: 'LI.FI', kind: 'Swaps & payments', use: 'Swaps and bridging on the stock pages (Robinhood Chain and BNB Chain).', where: 'src/components/swap/SwapWidget.tsx', href: 'https://li.fi/' },
  { name: 'Jupiter', kind: 'Swaps & payments', use: 'Swaps on Solana stock pages, through our own proxy.', where: 'server/jupiter.mjs', href: 'https://jup.ag/' },
  { name: 'Request Network', kind: 'Swaps & payments', use: 'Its ERC20FeeProxy contract pays a merchant and the Gully Pay fee in one transaction.', where: 'server/payments.mjs', href: 'https://request.network/' },
  { name: 'Safe', kind: 'Swaps & payments', use: 'One-click deployment of the treasury Safe at the same address on each chain.', where: 'server/safe-deploy.mjs', href: 'https://safe.global/' },
  { name: 'Sourcify and Etherscan', kind: 'Security', use: 'Verified source for the contract an AI Security Scan reads.', where: 'server/security/chains.mjs', href: 'https://sourcify.dev/' },
  { name: 'Slither, Aderyn and Semgrep', kind: 'Security', use: 'The static-analysis tools the AI Security Scan runs.', where: 'server/security/tools.mjs', href: 'https://github.com/crytic/slither' },
  { name: 'dRPC', kind: 'Wallets & infra', use: 'The primary RPC for the chains we read, with public nodes behind it.', where: 'server/payments.mjs', href: 'https://drpc.org/' },
  { name: 'RainbowKit and WalletConnect', kind: 'Wallets & infra', use: 'Wallet connection in the app, the swap and Gully Pay.', where: 'src/pages/developers/walletConfig.ts', href: 'https://www.rainbowkit.com/' },
  { name: 'Umami', kind: 'Wallets & infra', use: 'The open-source engine under Gully Analytics (our fork).', where: 'server/analytics.mjs', href: 'https://umami.is/' },
]

export const integrationKinds: IntegrationKind[] = ['Data', 'Swaps & payments', 'Security', 'Wallets & infra']

export type Audience = 'launchpads' | 'wallets' | 'explorers' | 'chains'

export const audiences: { id: Audience; label: string; blurb: string }[] = [
  { id: 'launchpads', label: 'Launchpads', blurb: 'Show buyers who holds a new token, and get alerted to every launch.' },
  { id: 'wallets', label: 'Wallets', blurb: 'Put a token’s holder map and health score next to the swap or the token page.' },
  { id: 'explorers', label: 'Explorers', blurb: 'Link or embed the map on the token page, and read holders over the API.' },
  { id: 'chains', label: 'Chains', blurb: 'A branded explorer, payments and holder maps for your chain’s tokens.' },
]

export interface Benefit {
  id: string
  title: string
  text: string
  /** The honest state of it today. */
  status: 'Live' | 'On request' | 'Not live yet'
  docs?: { label: string; href: string }
  /** Which audiences it matters most to, in order of importance. */
  for: Audience[]
}

const DOCS = DOCS_URL

export const benefits: Benefit[] = [
  { id: 'map', title: 'Holder Map embed', text: 'The bubble map of a token’s holders with clusters and the launch health score, as one script tag on your page.', status: 'Live', docs: { label: 'Holder Map docs', href: `${DOCS}/holder-map` }, for: ['launchpads', 'wallets', 'explorers', 'chains'] },
  { id: 'badge', title: 'Health badge', text: 'The Gully Score badge: an SVG with the score and the date it was read, linking to its evidence. Nobody can pay to change a score.', status: 'Live', docs: { label: 'Gully Score docs', href: `${DOCS}/gully-score` }, for: ['launchpads', 'explorers', 'wallets'] },
  { id: 'sdk', title: 'SDK', text: 'Typed TypeScript clients: @gullylabs/tracker for the API and @gullylabs/widget (with a React component) for the embeds.', status: 'Live', docs: { label: 'SDK docs', href: `${DOCS}/sdk` }, for: ['wallets', 'explorers', 'launchpads'] },
  { id: 'webhooks', title: 'Launch webhooks', text: 'A signed webhook (and optional Telegram message) for every new DeepCore launch on a chain you choose.', status: 'Live', docs: { label: 'Plans and alerts docs', href: `${DOCS}/plans-alerts` }, for: ['launchpads', 'wallets'] },
  { id: 'whitelabel', title: 'White-label', text: 'The embedded map without the “Powered by Gully Labs” credit, on the Business plan. The plan flag exists; the credit-free embed is not built yet.', status: 'Not live yet', docs: { label: 'API keys docs', href: `${DOCS}/api-keys` }, for: ['launchpads', 'wallets', 'explorers'] },
  { id: 'pay', title: 'Gully Pay', text: 'Non-custodial crypto checkout: invoices, pay links and signed webhooks, paid to your own wallets. A transaction fee only.', status: 'Live', docs: { label: 'Gully Pay docs', href: `${DOCS}/gully-pay-merchants` }, for: ['chains', 'wallets', 'launchpads'] },
  { id: 'chainkit', title: 'Chain Kit', text: 'A branded Blockscout block explorer for your EVM chain, deployed and operated by Gully Labs.', status: 'On request', docs: { label: 'Chain Kit docs', href: `${DOCS}/chain-kit` }, for: ['chains', 'explorers'] },
]

export interface Snippet {
  id: string
  label: string
  lang: 'html' | 'js' | 'bash' | 'json'
  caption: string
  code: string
}

// Copied from the docs pages (HolderMapDocs, GullyScore, Sdk, PlansAlerts, WidgetGuide, pay-button.js); change them there first.
export const snippets: Snippet[] = [
  {
    id: 'map',
    label: 'Holder Map',
    lang: 'html',
    caption: 'HTML · the map on your token page',
    code: '<div data-gully-widget="holders" data-chain="base" data-token="0x…"></div>\n<script src="https://gullylabs.xyz/widget.js" async></script>',
  },
  {
    id: 'badge',
    label: 'Health badge',
    lang: 'html',
    caption: 'HTML · the badge, and the live widget',
    code: '<a href="https://gullylabs.xyz/score/base/0x…" target="_blank" rel="noopener noreferrer">\n  <img src="https://gullylabs.xyz/score/base/0x…/badge.svg" alt="Gully Score" width="260" height="48">\n</a>\n\n<div data-gully-score data-chain="base" data-address="0x…"></div>\n<script src="https://gullylabs.xyz/widget.js" async></script>',
  },
  {
    id: 'sdk',
    label: 'SDK',
    lang: 'js',
    caption: 'JavaScript · @gullylabs/tracker',
    code: "// npm install @gullylabs/tracker @gullylabs/widget\nimport { createTrackerClient } from '@gullylabs/tracker'\n\nconst tracker = createTrackerClient({ apiKey: process.env.GULLY_API_KEY }) // key optional\nconst widest = await tracker.widestGaps(5)\n\n// React\nimport { GullyWidget } from '@gullylabs/widget/react'\n<GullyWidget type=\"badge\" ticker=\"NVDA\" chain=\"robinhood\" />",
  },
  {
    id: 'webhook',
    label: 'Launch webhook',
    lang: 'json',
    caption: 'JSON · POST /api/developer/alerts (signed in with your wallet)',
    code: '{\n  "name": "Base launches",\n  "condition": { "type": "deepcore-launch", "chainId": 8453 },\n  "webhookUrl": "https://…",\n  "telegram": true\n}',
  },
  {
    id: 'pay',
    label: 'Gully Pay',
    lang: 'html',
    caption: 'HTML · a pay link as a popup button',
    code: '<a href="https://gullylabs.xyz/pay/l/…" target="_blank" rel="noopener" data-gully-pay="popup">Pay with crypto</a>\n<script src="https://gullylabs.xyz/pay-button.js" async></script>',
  },
]

export interface Chain {
  key: string
  name: string
  solana?: boolean
}

/** Used until GET /api/ecosystem answers (the server list is the source of truth). */
export const FALLBACK_CHAINS: Chain[] = [
  { key: 'robinhood', name: 'Robinhood Chain' },
  { key: 'bsc', name: 'BNB Chain' },
  { key: 'base', name: 'Base' },
  { key: 'hyperevm', name: 'HyperEVM' },
  { key: 'solana', name: 'Solana', solana: true },
]
