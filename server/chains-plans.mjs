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
  { id: 'gully-core', name: 'Gully Core launchpad on day one', kind: 'addon', status: 'planned', body: 'Gully Core, the launchpad and DEX core of Gully Chain, on your chain from the start: 0.30% of every trade, no monthly fee.' },
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
    { id: 'gully-core', name: 'Gully Core launchpad', model: '0.30% of every trade', usd: null, status: 'planned' },
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
//   - Also read 2026-11-08, no price shown: caldera.xyz/pricing and alchemy.com/rollups/pricing answer 404; gelato.cloud/rollups
//     names no amount. Third-party only (AWS Marketplace listing for Caldera: $500 a month per rollup pod, not a plan price).
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

/* ------------------------------------------------- Create a chain: the standard bundle (OWNER-EDITABLE) --- */

// The ONE list of what a chain gets. The page, the quote and the order all read it; nothing is typed into a page.
//   delivery  'team': our team sets it up by hand · 'automatic': the provisioning pipeline does it. All 'team' today; the
//             provisioning lane flips an item to 'automatic' as its automation lands.
//   status    'available': can be ordered · 'planned': shown, not orderable yet.
//   testnetOnly: not offered on mainnet. fee / billing: how an add-on is paid for (no add-on has a monthly price today).
export const BUNDLE = {
  included: [
    { id: 'explorer', name: 'Block explorer', icon: 'search', body: 'Your own branded explorer.', delivery: 'team', status: 'available' },
    { id: 'bridge', name: 'Bridge to the parent chain', icon: 'bridge', body: 'Move assets to and from the chain you settle to.', delivery: 'team', status: 'available' },
    { id: 'faucet', name: 'Faucet', icon: 'droplets', body: 'Test funds for your builders.', delivery: 'team', status: 'available', testnetOnly: true },
    { id: 'rpc', name: 'Gully RPC endpoint', icon: 'server', body: 'Public and keyed RPC endpoints on Gully RPC.', delivery: 'team', status: 'available' },
    { id: 'verify', name: 'Contract verification', icon: 'badge-check', body: 'Verify contract source on your explorer.', delivery: 'team', status: 'available' },
    { id: 'monitoring', name: 'Status monitoring', icon: 'activity', body: 'Uptime, sequencer and batch checks on a status page.', delivery: 'team', status: 'available' },
    { id: 'multisig', name: 'Gully Multisig for the chain owner role', icon: 'shield', body: 'The chain owner role held by a multisig you control.', delivery: 'team', status: 'available' },
    { id: 'aa', name: 'Account abstraction (ERC-4337 bundler)', icon: 'wallet', body: 'A bundler and EntryPoint for smart accounts.', delivery: 'team', status: 'available' },
  ],
  addons: [
    { id: 'gully-core', name: 'Gully Core', icon: 'layers', body: 'Launchpad and DEX contracts on your chain.', fee: '0.30% of every trade', billing: 'No monthly fee', delivery: 'team', status: 'available' },
    { id: 'paymaster', name: 'Sponsored-gas paymaster', icon: 'fuel', body: 'Let your users transact without holding gas.', fee: null, billing: 'Billed by usage', delivery: 'team', status: 'available' },
    { id: 'pay', name: 'Gully Pay on your chain', icon: 'credit-card', body: 'Non-custodial checkout and pay links on your chain.', fee: null, billing: 'Priced with you', delivery: 'team', status: 'available' },
    { id: 'hyperlane', name: 'Hyperlane cross-chain messaging', icon: 'shuffle', body: 'Messages between your chain and others.', fee: null, billing: 'One-time setup', delivery: 'team', status: 'available' },
    { id: 'usdc-gas', name: 'Pay gas in USDC', icon: 'coins', body: 'Users pay fees in USDC instead of the chain token.', fee: null, billing: 'Planned', delivery: 'team', status: 'planned' },
  ],
}

/** Business days our team takes to set up a testnet chain once the request is in. Shown on the page and the order. */
export const SETUP_BUSINESS_DAYS = 3

/** OWNER FLAG: the after-trial testnet price (CHAINS.testnet.monthlyUsd) is confirmed. Off (default): no page shows it. */
export const priceConfirmed = (env = process.env) => ['on', 'true', '1', 'yes'].includes(String(env.PRICE_CONFIRMED ?? '').trim().toLowerCase())
export const UNCONFIRMED_PRICE_NOTE = 'Price set before your trial ends; you are never charged without a checkout you start.'

const includedFor = (tier) => BUNDLE.included.filter((x) => tier === 'testnet' || !x.testnetOnly)
const bundleItem = (id) => BUNDLE.included.find((x) => x.id === id) ?? BUNDLE.addons.find((x) => x.id === id) ?? null

/** Where a chain may settle: the parents on which Nitro's licence is free. */
export const ORDER_PARENTS = {
  testnet: [{ id: 421614, name: 'Arbitrum Sepolia' }],
  mainnet: [{ id: 42161, name: 'Arbitrum One' }, { id: 42170, name: 'Arbitrum Nova' }],
}
export const NITRO_LICENCE_NOTE = 'Arbitrum Nitro is free to run only when your chain settles to Arbitrum One, Arbitrum Nova or Arbitrum Sepolia, so those are the only parents we offer.'
export const GAS_TOKENS = [{ id: 'eth', name: 'ETH' }, { id: 'custom', name: 'Your own token' }]

// Gully Pay has no subscriptions API today and invoicing is not wired: a charge is only ever a hosted checkout the buyer
// starts, and nothing renews by itself.
export const BILLING = { model: 'checkout-only', note: 'Nothing renews by itself: you are never charged without a checkout you start.' }

const money = (usd) => `$${usd.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(usd) ? 0 : 2, maximumFractionDigits: 2 })}`

const view = (x, tier) => ({ id: x.id, name: x.name, delivery: x.delivery, fee: x.fee ?? null, billing: x.billing ?? null, usd: x.fee || x.billing === 'No monthly fee' || bundleKind(x.id) === 'included' ? 0 : tier === 'testnet' ? 0 : null })
const bundleKind = (id) => (BUNDLE.included.some((x) => x.id === id) ? 'included' : 'addon')

/**
 * The one price calculation: the page shows it, the order stores it, checkout charges it.
 * `included`: the standard bundle for the tier (always on). `addons`: the ids picked. An id from the bundle is accepted
 * and ignored (it is always included), so an old draft still quotes. Returns null for an unknown tier, an unknown or
 * planned add-on, or a testnet-only item on mainnet. `dueCents`: what checkout charges today, in USD cents.
 */
export function quoteOrder(tier, addonIds = [], env = process.env) {
  if (tier !== 'testnet' && tier !== 'mainnet') return null
  const picked = []
  for (const id of new Set(addonIds)) {
    const inc = BUNDLE.included.find((x) => x.id === id)
    if (inc) {
      if (inc.testnetOnly && tier !== 'testnet') return null
      continue
    }
    const a = BUNDLE.addons.find((x) => x.id === id)
    if (!a || a.status !== 'available') return null
    picked.push(a)
  }
  const included = includedFor(tier).map((x) => view(x, tier))
  const addons = picked.map((a) => view(a, tier))
  const setupDays = SETUP_BUSINESS_DAYS
  if (tier === 'testnet') {
    const dueCents = Math.round(testChargeUsd(env) * 100)
    const confirmed = priceConfirmed(env) && Number.isFinite(CHAINS.testnet.monthlyUsd)
    return { tier, included, addons, dueCents, testCharge: dueCents > 0, freeDays: CHAINS.testnet.freeDays, setupDays, priceConfirmed: confirmed, monthlyUsd: confirmed ? CHAINS.testnet.monthlyUsd : null, sequencerProfitPct: null, daAtCost: false, priceWithUs: false, headline: `Free for ${CHAINS.testnet.freeDays} days`, after: confirmed ? `Then ${money(CHAINS.testnet.monthlyUsd)} a month` : UNCONFIRMED_PRICE_NOTE }
  }
  const monthlyUsd = CHAINS.mainnet.fromUsdPerMonth
  return { tier, included, addons, dueCents: Math.round(monthlyUsd * 100), testCharge: false, freeDays: 0, setupDays, priceConfirmed: true, monthlyUsd, sequencerProfitPct: CHAINS.mainnet.sequencerProfitPct, daAtCost: CHAINS.mainnet.daAtCost, priceWithUs: addons.some((a) => a.usd === null), headline: `${money(monthlyUsd)} a month`, after: `+ ${CHAINS.mainnet.sequencerProfitPct}% of sequencer profit, data availability at cost` }
}

/**
 * A stored quote as a page shows it today: an order placed before the bundle (or before the price was confirmed) never
 * shows an after-trial price that is not confirmed now, and every line carries how it is delivered.
 */
export function presentQuote(q, env = process.env) {
  if (!q) return q
  const tier = q.tier
  const inc = (q.included ?? includedFor(tier).map((x) => view(x, tier))).map((x) => ({ ...x, delivery: bundleItem(x.id)?.delivery ?? x.delivery ?? 'team' }))
  const incIds = new Set(inc.map((x) => x.id))
  const addons = (q.addons ?? []).filter((a) => !incIds.has(a.id)).map((a) => ({ ...a, billing: a.billing ?? bundleItem(a.id)?.billing ?? null, delivery: bundleItem(a.id)?.delivery ?? a.delivery ?? 'team' }))
  const out = { ...q, included: inc, addons, setupDays: q.setupDays ?? SETUP_BUSINESS_DAYS }
  if (tier === 'testnet') {
    const confirmed = priceConfirmed(env) && Number.isFinite(CHAINS.testnet.monthlyUsd)
    Object.assign(out, { priceConfirmed: confirmed, monthlyUsd: confirmed ? CHAINS.testnet.monthlyUsd : null, after: confirmed ? `Then ${money(CHAINS.testnet.monthlyUsd)} a month` : UNCONFIRMED_PRICE_NOTE })
  }
  return out
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
