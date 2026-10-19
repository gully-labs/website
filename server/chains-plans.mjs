// Gully Chains: the ONE place the offer's prices, services and waitlist choices live.
//
// OWNER-EDITABLE: every price below. Nothing about Gully Chains is live yet (a testnet is coming), so the /chains
// page, its waitlist form and the admin card all read this object through GET /api/chains/plans; no price,
// service or choice is typed into a page. A price of `null` is shown as "TBA" until the owner sets it.
//
// Prices before launch may change (`note`).

/** Where each service stands: included in the managed price, an add-on, or not built yet. */
export const SERVICES = [
  { id: 'chainkit', name: 'Chain Kit explorer, bridge and faucet', kind: 'included', status: 'testnet', body: 'A branded block explorer, the Gully Bridge to and from Arbitrum, and a faucet for your testnet.' },
  { id: 'insight', name: 'Gully Analytics, Holder Map and Security monitors', kind: 'included', status: 'testnet', body: 'Wallet-aware analytics, holder maps and contract monitors, pointed at your chain.' },
  { id: 'aa', name: 'Account abstraction', kind: 'included', status: 'with-testnet', body: 'An ERC-4337 bundler and EntryPoint, with EIP-7702-ready smart accounts.' },
  { id: 'paymaster', name: 'Sponsored gas paymaster', kind: 'addon', status: 'with-testnet', body: 'Let your users transact without holding gas. Billed by usage.' },
  { id: 'usdc-gas', name: 'Pay gas in USDC', kind: 'addon', status: 'planned', body: 'Users pay fees in USDC instead of the chain token.' },
  { id: 'pay', name: 'Gully Pay on your chain', kind: 'addon', status: 'testnet', body: 'Non-custodial checkout and pay links on your chain.' },
  { id: 'hyperlane', name: 'Hyperlane setup', kind: 'addon', status: 'testnet', body: 'Cross-chain messaging between your chain and others. A one-time setup.' },
  { id: 'deepcore', name: 'DeepCore launchpad on day one', kind: 'addon', status: 'planned', body: 'DeepCore, the Gully Labs launchpad, on your chain from the start, with a revenue share on launch fees.' },
]

/** The stack, in order, as the page draws it. */
export const STACK = [
  { id: 'orbit', name: 'Arbitrum Orbit (Nitro)', role: 'The chain itself' },
  { id: 'settle', name: 'Settlement to Arbitrum', role: 'Where it settles' },
  { id: 'hyperlane', name: 'Hyperlane interop', role: 'Messages to other chains' },
  { id: 'explorer', name: 'Chain Kit explorer', role: 'Blocks and transactions' },
  { id: 'bridge', name: 'Gully Bridge', role: 'Move assets in and out' },
  { id: 'faucet', name: 'Faucet', role: 'Test funds' },
  { id: 'rpc', name: 'RPC', role: 'Endpoints for your apps' },
]

export const CHAINS = {
  // Free for `freeDays`, then `monthlyUsd` a month. null: not set yet, shown as "TBA".
  testnet: { id: 'testnet', name: 'Testnet', freeDays: 30, monthlyUsd: null },
  // From `fromUsdPerMonth` a month, plus `sequencerProfitPct` per cent of the sequencer's profit; data availability at cost.
  mainnet: { id: 'mainnet', name: 'Managed mainnet', fromUsdPerMonth: 3500, sequencerProfitPct: 5, daAtCost: true },
  // `usd`: null is "TBA"; `model` says how it is billed.
  addons: [
    { id: 'paymaster', name: 'Sponsored gas paymaster', model: 'usage-billed', usd: null, status: 'with-testnet' },
    { id: 'usdc-gas', name: 'Pay gas in USDC', model: 'monthly', usd: null, status: 'planned' },
    { id: 'pay', name: 'Gully Pay on your chain', model: 'transaction fee', usd: null, status: 'testnet' },
    { id: 'hyperlane', name: 'Hyperlane setup', model: 'one-time', usd: null, status: 'testnet' },
    { id: 'deepcore', name: 'DeepCore launchpad', model: 'revenue share on launch fees', usd: null, status: 'planned' },
  ],
  note: 'Prices before launch may change.',
}

/** The waitlist form's choices: [value, label]. The server accepts only these values. */
export const WAITLIST_CHOICES = {
  useCase: [['defi', 'DeFi'], ['gaming', 'Gaming'], ['payments', 'Payments'], ['rwa', 'Tokenised assets'], ['social', 'Social or consumer'], ['launchpad', 'Launchpad or memecoins'], ['other', 'Something else']],
  scale: [['small', 'Under 10 TPS or 10k users'], ['medium', '10 to 100 TPS or up to 1M users'], ['large', 'Over 100 TPS or 1M users'], ['unknown', 'Not sure yet']],
  gasToken: [['eth', 'ETH'], ['own', 'Our own token'], ['undecided', 'Undecided']],
  da: [['rollup', 'Rollup'], ['anytrust', 'AnyTrust'], ['undecided', 'Undecided']],
}

/** What GET /api/chains/plans answers. Nothing here is a secret. */
export function publicChains() {
  return { live: false, stage: 'waitlist', services: SERVICES, stack: STACK, ...CHAINS, choices: WAITLIST_CHOICES }
}
