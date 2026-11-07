// Gully Chains: the ONE place the offer's prices, services and waitlist choices live.
//
// OWNER-EDITABLE: every price below. Nothing about Gully Chains is live yet (a testnet is coming), so the /chains
// page, its waitlist form and the admin card all read this object through GET /api/chains/plans; no price,
// service or choice is typed into a page. A price of `null` is shown as "TBA" until the owner sets it.
//
// Prices before launch may change (`note`).

/** Where each service stands: included in the managed price, an add-on, or not built yet. */
export const SERVICES = [
  { id: 'chainkit', name: 'Chain Kit explorer, bridge and faucet', kind: 'included', status: 'planned', body: 'A branded block explorer, the Gully Bridge to and from Arbitrum, and a faucet for your testnet. The explorer is planned: join the waitlist.' },
  { id: 'insight', name: 'Gully Analytics, Holder Map and Security monitors', kind: 'included', status: 'testnet', body: 'Wallet-aware analytics, holder maps and contract monitors, pointed at your chain.' },
  { id: 'aa', name: 'Account abstraction', kind: 'included', status: 'with-testnet', body: 'An ERC-4337 bundler and EntryPoint, with EIP-7702-ready smart accounts.' },
  { id: 'paymaster', name: 'Sponsored gas paymaster', kind: 'addon', status: 'with-testnet', body: 'Let your users transact without holding gas. Billed by usage.' },
  { id: 'usdc-gas', name: 'Pay gas in USDC', kind: 'addon', status: 'planned', body: 'Users pay fees in USDC instead of the chain token.' },
  { id: 'pay', name: 'Gully Pay on your chain', kind: 'addon', status: 'testnet', body: 'Non-custodial checkout and pay links on your chain.' },
  { id: 'hyperlane', name: 'Hyperlane setup', kind: 'addon', status: 'testnet', body: 'Cross-chain messaging between your chain and others. A one-time setup.' },
  { id: 'gully-core', name: 'Gully Core launchpad on day one', kind: 'addon', status: 'planned', body: 'Gully Core, the launchpad and DEX core of Gully Chain, on your chain from the start, with a revenue share on launch fees.' },
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
  testnet: { id: 'testnet', name: 'Testnet', freeDays: 30, monthlyUsd: 212.5 },
  // From `fromUsdPerMonth` a month, plus `sequencerProfitPct` per cent of the sequencer's profit; data availability at cost.
  mainnet: { id: 'mainnet', name: 'Managed mainnet', fromUsdPerMonth: 4250, sequencerProfitPct: 4.25, daAtCost: true },
  // `usd`: null is "TBA"; `model` says how it is billed.
  addons: [
    { id: 'paymaster', name: 'Sponsored gas paymaster', model: 'usage-billed', usd: null, status: 'with-testnet' },
    { id: 'usdc-gas', name: 'Pay gas in USDC', model: 'monthly', usd: null, status: 'planned' },
    { id: 'pay', name: 'Gully Pay on your chain', model: 'transaction fee', usd: null, status: 'testnet' },
    { id: 'hyperlane', name: 'Hyperlane setup', model: 'one-time', usd: null, status: 'testnet' },
    { id: 'gully-core', name: 'Gully Core launchpad', model: 'revenue share on launch fees', usd: null, status: 'planned' },
  ],
  note: 'Prices before launch may change.',
}

/* ---------------------------------------------------------- Create a chain: the order flow's prices --- */

// OWNER TO CONFIRM: the mainnet base below has no public source. Mainnet orders stay shut until MAINNET_PRICE_CONFIRMED is
// on (chain-orders.mjs), even with MAINNET_ORDERS on, so no customer can be charged an unconfirmed price.
//
// HOW THE NUMBERS WERE SET (owner, Nov 2026: "competitive pricing 15% cheaper"). Read 2026-11-07. Internal: never sent to
// a page, and no page compares us with anyone, because a comparison needs a source and the base fee below has none.
//   - conduit.xyz/pricing, Trial Testnet "$250 per month"                     -> ours $212.50 a month after the free days
//   - conduit.xyz/pricing, Growth "Contact for pricing + 5% sequencer profit" -> ours 4.25% of sequencer profit
//   - Conduit's old Growth base ($60,000 a year, our Oct 2026 note) is NOT published any more. $4,250 a month is that
//     note less 15%: the owner's target, unsourced, until he confirms it.
//   - caldera.xyz/pricing is a 404, and caldera.xyz shows no price or pricing link: no Caldera benchmark.
//   - alchemy.com/rollups shows no plan or price (sales only). AltLayer and Gelato: no public rollup price found.
export const PRICE_BENCHMARKS = {
  checkedAt: '2026-11-07',
  discountPct: 15,
  ownerToConfirm: 'mainnet base $4,250 per month: Conduit no longer publishes the Growth base',
  sources: [
    { name: 'Conduit Trial Testnet', url: 'https://www.conduit.xyz/pricing', published: '$250 per month', ours: '$212.50 per month' },
    { name: 'Conduit Growth share', url: 'https://www.conduit.xyz/pricing', published: '5% sequencer profit', ours: '4.25% sequencer profit' },
    { name: 'Conduit Growth base', url: 'https://www.conduit.xyz/pricing', published: null, ours: '$4,250 per month (owner target, unsourced)' },
    { name: 'Caldera', url: 'https://caldera.xyz', published: null, ours: null },
    { name: 'Alchemy Rollups', url: 'https://www.alchemy.com/rollups', published: null, ours: null },
  ],
}

// What a testnet order pays at checkout. A testnet chain is free for its free days, so this is not a price: it proves the
// payment path, in testnet USDC.e (no value). Default 0, because a hosted checkout can still offer real rails and the owner
// has not approved a charge: the order is recorded, nothing is charged, and Gully Pay is not called.
export function testChargeUsd(env = process.env) {
  const n = Number(env.CHAIN_TESTNET_TEST_CHARGE_USD ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Add-ons in the order flow. A number is a monthly price (0: included), null: priced with the customer. `fee`: a usage term. */
export const ORDER_ADDONS = [
  { id: 'explorer', name: 'Block explorer', icon: 'search', body: 'Your own branded explorer.', testnetUsd: 0, mainnetUsd: 0, standard: true },
  { id: 'bridge', name: 'Bridge', icon: 'bridge', body: 'Move assets to and from the parent chain.', testnetUsd: 0, mainnetUsd: 0, standard: true },
  { id: 'faucet', name: 'Faucet', icon: 'droplets', body: 'Test funds for your builders.', testnetUsd: 0, mainnetUsd: null, testnetOnly: true, standard: true },
  { id: 'rpc', name: 'Gully RPC', icon: 'server', body: 'Public and keyed RPC endpoints.', testnetUsd: 0, mainnetUsd: 0, standard: true },
  { id: 'monitoring', name: 'Monitoring', icon: 'activity', body: 'Uptime, sequencer and batch alerts.', testnetUsd: 0, mainnetUsd: 0, standard: false },
  { id: 'gully-core', name: 'Gully Core', icon: 'layers', body: 'Launchpad and DEX contracts on your chain.', testnetUsd: 0, mainnetUsd: 0, fee: '0.30% of every trade', standard: false },
  { id: 'multisig', name: 'Gully Multisig', icon: 'shield', body: 'A multisig for your chain owner role.', testnetUsd: 0, mainnetUsd: null, standard: false },
]

/** Where a chain may settle: the parents on which Nitro's licence is free. */
export const ORDER_PARENTS = {
  testnet: [{ id: 421614, name: 'Arbitrum Sepolia' }],
  mainnet: [{ id: 42161, name: 'Arbitrum One' }, { id: 42170, name: 'Arbitrum Nova' }],
}
export const NITRO_LICENCE_NOTE = 'Arbitrum Nitro is free to run only when your chain settles to Arbitrum One, Arbitrum Nova or Arbitrum Sepolia, so those are the only parents we offer.'
export const GAS_TOKENS = [{ id: 'eth', name: 'ETH' }, { id: 'custom', name: 'Your own token' }]

// Gully Pay has no subscriptions API today (a subscriptions table and a buyer's read-only list; nothing creates or
// renews one): the first month is one hosted checkout, and each later month is an invoice we send by hand.
export const BILLING = { model: 'first-month-invoice', note: 'Billed monthly by invoice. Nothing renews by itself.' }

const money = (usd) => `$${usd.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(usd) ? 0 : 2, maximumFractionDigits: 2 })}`

/**
 * The one price calculation: the page shows it, the order stores it, checkout charges it.
 * Returns null for an unknown tier or add-on. `dueCents`: what checkout charges today, in USD cents.
 */
export function quoteOrder(tier, addonIds = []) {
  if (tier !== 'testnet' && tier !== 'mainnet') return null
  const picked = []
  for (const id of new Set(addonIds)) {
    const a = ORDER_ADDONS.find((x) => x.id === id)
    if (!a || (a.testnetOnly && tier !== 'testnet')) return null
    picked.push(a)
  }
  const usdOf = (a) => (tier === 'testnet' ? a.testnetUsd : a.mainnetUsd)
  const addons = picked.map((a) => ({ id: a.id, name: a.name, usd: usdOf(a), fee: a.fee ?? null }))
  const addonMonthly = addons.reduce((n, a) => n + (a.usd ?? 0), 0)
  if (tier === 'testnet') {
    const dueCents = Math.round(testChargeUsd() * 100)
    const monthlyUsd = CHAINS.testnet.monthlyUsd + addonMonthly
    return { tier, addons, dueCents, testCharge: dueCents > 0, freeDays: CHAINS.testnet.freeDays, monthlyUsd, sequencerProfitPct: null, daAtCost: false, priceWithUs: false, headline: `Free for ${CHAINS.testnet.freeDays} days`, after: `Then ${money(monthlyUsd)} a month, invoiced` }
  }
  const monthlyUsd = CHAINS.mainnet.fromUsdPerMonth + addonMonthly
  return { tier, addons, dueCents: Math.round(monthlyUsd * 100), testCharge: false, freeDays: 0, monthlyUsd, sequencerProfitPct: CHAINS.mainnet.sequencerProfitPct, daAtCost: CHAINS.mainnet.daAtCost, priceWithUs: addons.some((a) => a.usd === null), headline: `${money(monthlyUsd)} a month`, after: `+ ${CHAINS.mainnet.sequencerProfitPct}% of sequencer profit, data availability at cost` }
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
