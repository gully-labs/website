// Paid tiers of the tracker API: the ONE place their limits and prices live.
//
// OWNER-EDITABLE: the prices (US dollars per PERIOD_DAYS; the field keeps its old name priceUsdc) and
// the limits below (`monitors`: contracts Gully Security monitoring watches per workspace, sec-monitor.mjs). Nothing else in the code or the
// pages types a price or a limit; the pricing page, the dashboard, the docs and the enforcement in
// access.mjs, alerts.mjs and the history endpoint all read this object (the browser via GET /api/plans).
//
// Payment is any asset in payments.mjs (ETH, BNB, POL, AVAX, USDC or USDT on Base, Ethereum, BNB Chain,
// Arbitrum, OP Mainnet, Polygon or Avalanche, each only while the Safe treasury is deployed there), sent
// straight to the treasury wallet in GULLY_TREASURY_ADDRESS (we never hold anyone's funds). With that
// variable unset, checkout is off and every page says plans cannot be bought yet: there is no fallback
// address, ever.

import { guardRecipient } from './pay-guard.mjs'
import { confirmationsFor, FEE_PROXIES, feeSplitOn, publicAssets, publicChains } from './payments.mjs'
import { solanaTreasury } from './solana-pay.mjs'
import { getAccount } from './store.mjs'

export const PLANS = {
  free: { id: 'free', name: 'Free', priceUsdc: 0, perMin: 600, alerts: 1, historyDays: 7, maxKeys: 5, monitors: 1 },
  pro: { id: 'pro', name: 'Pro', priceUsdc: 49, perMin: 3_000, alerts: 10, historyDays: 90, maxKeys: 5, monitors: 10 },
  business: { id: 'business', name: 'Business', priceUsdc: 199, perMin: 10_000, alerts: 100, historyDays: 365, maxKeys: 5, monitors: 50 },
}

/* ------------------------------------------------------ Gully Analytics --- */

// OWNER-EDITABLE: Gully Analytics plans (self-serve sign-up in the developer portal, enforced by the
// proxy in analytics.mjs). `sites` is how many websites an account may track; `eventsPerMonth` is how
// many tracker calls (page views and custom events, counted per UTC calendar month across all of the
// account's sites) are accepted before the proxy refuses more. THE PRICES ARE PLACEHOLDERS until the
// owner sets them. Pages read all of this through GET /api/plans (field `analytics`); nothing is typed
// into a page.
export const ANALYTICS_PLANS = {
  trial: { id: 'trial', name: 'Free trial', priceUsdc: 0, sites: 1, eventsPerMonth: 10_000 },
  starter: { id: 'starter', name: 'Starter', priceUsdc: 19, sites: 3, eventsPerMonth: 100_000 },
  growth: { id: 'growth', name: 'Growth', priceUsdc: 79, sites: 10, eventsPerMonth: 1_000_000 },
}
/** Length of the free trial, once per wallet. */
export const ANALYTICS_TRIAL_DAYS = 14
/** After a trial or plan lapses, events are refused but the dashboard stays readable this long; then the admin may delete the account. */
export const ANALYTICS_GRACE_DAYS = 30
export const ANALYTICS_PAID_IDS = Object.values(ANALYTICS_PLANS)
  .filter((p) => p.priceUsdc > 0)
  .map((p) => p.id)

/* ------------------------------------------------------- Gully Security --- */

// OWNER-EDITABLE: Gully Security (server/security-routes.mjs, the app's Security tab and /security read this
// through GET /api/plans, field `security`; nothing is typed into a page). Three tiers, named honestly:
//   scan    "AI Security Scan": self-serve and automated. `freePerMonth` scans per UTC calendar month by the
//           workspace's API plan (PLANS ids); each scan beyond that is invoiced at `priceUsd` (Gully Pay).
//           THE PRICE AND THE QUOTAS ARE PLACEHOLDERS until the owner sets them.
//   review  "Security Review": people read the code; quoted per project after a request (no list price).
//   audit   "Audit": the premium tier, not offered yet (`available: false`); requests are still taken.
export const SECURITY = {
  scan: { id: 'scan', name: 'AI Security Scan', priceUsd: 99, freePerMonth: { free: 1, pro: 3, business: 10 }, maxActive: 2, maxUploadBytes: 2_000_000 },
  review: { id: 'review', name: 'Security Review', quoted: true, available: true },
  audit: { id: 'audit', name: 'Audit', quoted: true, available: false },
}

/* --------------------------------------------------------- Holder Map --- */

// OWNER-EDITABLE: Holder Map features per tracker plan (holders.mjs enforces them; pages read them via
// GET /api/plans, field `holderMap`). `gated` is the pricing switch: false (today) gives every visitor
// the Pro features; true limits anonymous and Free users to `free`. Either way the safety warnings
// (bundled buyers, the deployer's share, the liquidity lock) are never gated. HOLDER_MAP_GATED=1 in the
// environment turns the switch on without a code change.
//   holders     wallets listed (the map draws at most 120 of them)
//   replay      the time scrubber (history replay)
//   csv         the holder list as CSV (GET /api/holders/:chain/:token.csv)
//   alerts      cluster alerts (Telegram and webhook), within the plan's alert count
//   liveMinutes how long the live view keeps updating on an open map (null: as long as it is open)
//   whiteLabel  the embedded map without the "Powered by Gully Labs" credit (reserved: not built yet)
export const HOLDER_MAP = {
  gated: false,
  tiers: {
    free: { holders: 50, replay: false, csv: false, alerts: false, liveMinutes: 5, whiteLabel: false },
    pro: { holders: 500, replay: true, csv: true, alerts: true, liveMinutes: null, whiteLabel: false },
    business: { holders: 500, replay: true, csv: true, alerts: true, liveMinutes: null, whiteLabel: true },
  },
}
export const holderMapGated = () => HOLDER_MAP.gated || process.env.HOLDER_MAP_GATED === '1'
/** The Holder Map features for a plan id ('anonymous', 'free', 'pro', 'business'), after the switch. */
export function holderMapFeatures(planId) {
  const t = HOLDER_MAP.tiers
  if (!holderMapGated()) return { ...t.pro, whiteLabel: !!t[planId]?.whiteLabel, tier: 'pro', gated: false }
  const own = t[planId] ?? t.free
  return { ...own, tier: own.replay ? 'pro' : 'free', gated: true }
}

/** No key at all: per IP address. */
export const ANONYMOUS = { perMin: 60, historyDays: 7 }

/** One payment buys this many days of a plan. */
export const PERIOD_DAYS = 30
export const PERIOD_MS = PERIOD_DAYS * 86_400_000

export const PAID_PLAN_IDS = Object.values(PLANS)
  .filter((p) => p.priceUsdc > 0)
  .map((p) => p.id)

/* ------------------------------------------------------------ payment --- */

/** The treasury wallet that receives payments on every chain, lower-cased, or null when unset or malformed. */
export function treasury() {
  const t = String(process.env.GULLY_TREASURY_ADDRESS ?? '').trim()
  return /^0x[0-9a-fA-F]{40}$/.test(t) && !/^0x0{40}$/.test(t) ? t.toLowerCase() : null
}

/* ------------------------------------------------------- a wallet's plan --- */

/**
 * The plan in force for a wallet: its paid or granted plan while it runs, else Free.
 * Returns the plan's limits plus { expiresAt, source } of the subscription (null on Free).
 */
export function planOf(address) {
  const a = address ? getAccount(address) : null
  const s = a?.plan
  if (s && PLANS[s.id] && Date.parse(s.expiresAt) > Date.now()) return { ...PLANS[s.id], expiresAt: s.expiresAt, source: s.source ?? null, since: s.since ?? null }
  return { ...PLANS.free, expiresAt: null, source: null, since: null }
}

/** What GET /api/plans answers: everything a page needs to show the tiers, no secrets. */
export function publicPlans({ treasuryOverride } = {}) {
  const t = treasuryOverride === undefined ? treasury() : treasuryOverride
  const assets = publicAssets()
  return {
    currency: 'USD',
    // feeProxy: a verified Request ERC20FeeProxy exists there; feeSplit: it is usable now (treasury deployed too), so a
    // merchant fee is collected inside the payment; without it the fee is invoiced (contracts/CHOICE.md matrix).
    chains: publicChains().map((c) => ({ id: c.id, name: c.name, key: c.key, explorer: c.explorer, confirmations: confirmationsFor(c.id), feeProxy: !!FEE_PROXIES[c.id], feeSplit: feeSplitOn(c.id) })),
    assets,
    periodDays: PERIOD_DAYS,
    anonymous: ANONYMOUS,
    plans: Object.values(PLANS),
    holderMap: { gated: holderMapGated(), tiers: HOLDER_MAP.tiers },
    analytics: { plans: Object.values(ANALYTICS_PLANS), trialDays: ANALYTICS_TRIAL_DAYS, graceDays: ANALYTICS_GRACE_DAYS, periodDays: PERIOD_DAYS },
    security: SECURITY,
    // A treasury that is a fee proxy is never shown (pay-guard.mjs: logged, PaymentGuardError, 500).
    checkout: t ? { enabled: true, treasury: guardRecipient(t, 'plans checkout'), solanaTreasury: solanaTreasury() } : { enabled: false, treasury: null, solanaTreasury: null, reason: 'Paid plans cannot be bought yet: no treasury wallet is configured.' },
  }
}
