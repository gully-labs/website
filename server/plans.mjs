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

// Prices (owner rule 2026-11-25): 10-20% below the closest competitor, monthly and yearly each; the competitor pages,
// dates and math are in gully-protocol design/pricing-2026-11-25/PRICES.md. `priceUsdcYear` is shown on the pages
// with "yearly billing opens soon": checkout sells PERIOD_DAYS periods only until yearly billing is built.
export const PLANS = {
  free: { id: 'free', name: 'Free', priceUsdc: 0, priceUsdcYear: 0, perMin: 600, alerts: 1, historyDays: 7, maxKeys: 5, monitors: 1 },
  pro: { id: 'pro', name: 'Pro', priceUsdc: 30, priceUsdcYear: 296, perMin: 3_000, alerts: 10, historyDays: 90, maxKeys: 5, monitors: 10 },
  business: { id: 'business', name: 'Business', priceUsdc: 110, priceUsdcYear: 1_052, perMin: 10_000, alerts: 100, historyDays: 365, maxKeys: 5, monitors: 50 },
}

/* ---------------------------------------------------------- Gully IPFS --- */

// OWNER-EDITABLE: Gully IPFS pinning plans (ipfs-pins.mjs enforces them; the hub and docs read them through GET /api/plans,
// field `ipfs`). The free tier is "Early access" and is the single source for every page: IPFS_FREE_STORAGE_GB (default 1),
// IPFS_FREE_MAX_FILE_MB (100), IPFS_FREE_MAX_PINS (500), IPFS_FREE_TRANSFER_GB (monthly upload cap, default 5), all server env.
// Paid tiers are plumbing only and OFF: the owner and counsel set no price. A tier exists only when IPFS_PAID_PLANS_JSON
// lists it, e.g. [{"id":"pro","name":"Pro","priceUsdPerGbMonth":0.05,"storageGb":100,"maxFileMb":1024,"maxPins":10000,
// "transferGb":500,"egressGb":500}], and checkout opens only with IPFS_PAID_ENABLED=1 as well (and Gully Pay set up).
// A paid month costs priceUsdPerGbMonth x storageGb and is bought through Gully Pay checkout (ipfs-billing in ipfs-pins.mjs).
const envNum = (k, d) => (Number.isFinite(Number(process.env[k])) && Number(process.env[k]) > 0 ? Number(process.env[k]) : d)
export function ipfsPlans() {
  return {
    free: { id: 'free', name: 'Early access', priceUsdPerGbMonth: null, storageBytes: Math.round(envNum('IPFS_FREE_STORAGE_GB', 1) * 1024 ** 3), maxFileBytes: Math.round(envNum('IPFS_FREE_MAX_FILE_MB', 100) * 1024 ** 2), maxPins: envNum('IPFS_FREE_MAX_PINS', 500), copies: 2, transferBytesMonth: Math.round(envNum('IPFS_FREE_TRANSFER_GB', 10) * 1024 ** 3), egressBytesMonth: null },
  }
}
/** Paid tiers from IPFS_PAID_PLANS_JSON, validated; a malformed entry or a missing price is dropped (never a default price). */
export function ipfsPaidPlans() {
  let raw
  try {
    raw = JSON.parse(process.env.IPFS_PAID_PLANS_JSON || '[]')
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null)
  const out = []
  for (const p of raw.slice(0, 8)) {
    const price = num(p?.priceUsdPerGbMonth)
    const gb = num(p?.storageGb)
    if (!/^[a-z0-9-]{2,24}$/.test(String(p?.id ?? '')) || p.id === 'free' || price == null || gb == null || out.some((x) => x.id === p.id)) continue
    out.push({
      id: p.id,
      name: String(p.name ?? p.id).slice(0, 40),
      priceUsdPerGbMonth: price,
      monthlyCents: Math.round(price * gb * 100),
      storageBytes: Math.round(gb * 1024 ** 3),
      maxFileBytes: Math.round((num(p.maxFileMb) ?? 100) * 1024 ** 2),
      maxPins: num(p.maxPins) ?? 5000,
      copies: 2,
      transferBytesMonth: num(p.transferGb) == null ? null : Math.round(num(p.transferGb) * 1024 ** 3),
      egressBytesMonth: num(p.egressGb) == null ? null : Math.round(num(p.egressGb) * 1024 ** 3),
    })
  }
  return out
}
/** Paid tiers can be bought: the flag is on and at least one priced tier exists. Gully Pay readiness is checked at checkout. */
export const ipfsPaidEnabled = () => process.env.IPFS_PAID_ENABLED === '1' && ipfsPaidPlans().length > 0
let ipfsSubResolver = null
/** ipfs-pins.mjs registers how to find an owner's paid tier (a paid month still running), so plans.mjs holds no state. */
export const setIpfsSubResolver = (f) => (ipfsSubResolver = f)
/** The IPFS limits in force for an account: its paid tier while a paid month runs and the flag is on, else early access. */
export function ipfsPlanOf(owner) {
  if (owner && ipfsPaidEnabled() && ipfsSubResolver) {
    const id = ipfsSubResolver(owner)
    const p = id && ipfsPaidPlans().find((x) => x.id === id)
    if (p) return p
  }
  return ipfsPlans().free
}
export const ipfsPaidState = () => ({ enabled: ipfsPaidEnabled(), plans: ipfsPaidPlans(), reason: ipfsPaidEnabled() ? null : 'Plans and prices are not set yet.' })

/* ------------------------------------------------------ Gully Analytics --- */

// OWNER-EDITABLE: Gully Analytics plans (self-serve sign-up in the app dashboard, enforced by the
// proxy in analytics.mjs). `sites` is how many websites an account may track; `eventsPerMonth` is how
// many tracker calls (page views and custom events, counted per UTC calendar month across all of the
// account's sites) are accepted before the proxy refuses more. Prices 2026-11-25: 15% below Umami Cloud (Pro $20, 1M events,
// 20 sites; Business $200, 10M events), yearly = 10 x monthly (Umami shows no yearly price; Plausible: 2 months free). Pages read all of this through GET /api/plans (field `analytics`); nothing is typed
// into a page.
export const ANALYTICS_PLANS = {
  trial: { id: 'trial', name: 'Free trial', priceUsdc: 0, priceUsdcYear: 0, sites: 1, eventsPerMonth: 100_000 },
  starter: { id: 'starter', name: 'Starter', priceUsdc: 17, priceUsdcYear: 170, sites: 20, eventsPerMonth: 1_000_000 },
  growth: { id: 'growth', name: 'Growth', priceUsdc: 170, priceUsdcYear: 1_700, sites: 100, eventsPerMonth: 10_000_000 },
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
  scan: { id: 'scan', name: 'AI Security Scan', priceUsd: 85, freePerMonth: { free: 1, pro: 3, business: 10 }, maxActive: 2, maxUploadBytes: 2_000_000 },
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
//   whiteLabel  the embedded map without the "Powered by Gully Labs" credit (live: signed embed key, see holders-partners.mjs)
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

/* ----------------------------------------------- Holder Map: Deep check --- */

// OWNER-EDITABLE: the paid Holder Map "Deep check" (holders-deep.mjs computes it, holders-deep-routes.mjs sells
// it through Gully Pay; pages read this through GET /api/plans, field `holderDeep`). One check is one
// (chain, token). Payment only buys the computation: it never changes what a check finds.
//   priceUsd             per token, in whole US dollars
//   freePerMonth         free checks per UTC calendar month by the workspace's API plan (PLANS ids)
//   bundleScanDiscountPct  percent off when bought together with a PAID Gully Security scan of the same
//                        contract (SECURITY.scan): the scan must be paid for, in the same workspace, and
//                        a scan discounts one check only
//   maxActive            checks one workspace may have running or queued at once
//   maxRunning           checks running at once on the server (they share the RPCs)
//   budgets              the hard limits of one check; one that reaches a limit finishes "partial"
//                        with the reason. rpcCalls: JSON-RPC calls; logSpans: log reads (an eth_getLogs
//                        session); explorerCalls: explorer/API reads (Blockscout); ms: wall time; holders: unlabelled holders whose
//                        funding is traced; hops: funder hops followed per holder
export const HOLDER_DEEP = {
  id: 'holder-deep',
  name: 'Holder Map Deep check',
  priceUsd: 9,
  freePerMonth: { free: 0, pro: 3, business: 3 },
  bundleScanDiscountPct: 20,
  maxActive: 3,
  maxRunning: 2,
  budgets: { rpcCalls: 150, logSpans: 12, explorerCalls: 60, ms: 120_000, holders: 12, hops: 3 },
}
/** The price in cents of one Deep check, with the Security-scan bundle discount when `bundled`. */
export const holderDeepPriceCents = (bundled = false) => Math.round(HOLDER_DEEP.priceUsd * 100 * (bundled ? 1 - HOLDER_DEEP.bundleScanDiscountPct / 100 : 1))

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
    ipfs: { plans: Object.values(ipfsPlans()), paid: ipfsPaidState() },
    holderDeep: HOLDER_DEEP,
    // A treasury that is a fee proxy is never shown (pay-guard.mjs: logged, PaymentGuardError, 500).
    checkout: t ? { enabled: true, treasury: guardRecipient(t, 'plans checkout'), solanaTreasury: solanaTreasury() } : { enabled: false, treasury: null, solanaTreasury: null, reason: 'Paid plans cannot be bought yet: no treasury wallet is configured.' },
  }
}
