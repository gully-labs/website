// Paid tiers of the tracker API: the ONE place their limits and prices live.
//
// OWNER-EDITABLE: the prices (USDC per PERIOD_DAYS) and limits below. Nothing else in the code or the
// pages types a price or a limit; the pricing page, the dashboard, the docs and the enforcement in
// access.mjs, alerts.mjs and the history endpoint all read this object (the browser via GET /api/plans).
//
// Payment is USDC on Base, sent straight to the treasury wallet in GULLY_TREASURY_ADDRESS (we never
// hold anyone's funds). With that variable unset, checkout is off and every page says plans cannot be
// bought yet: there is no fallback address, ever.

import { getAccount } from './store.mjs'

export const PLANS = {
  free: { id: 'free', name: 'Free', priceUsdc: 0, perMin: 600, alerts: 1, historyDays: 7, maxKeys: 5 },
  pro: { id: 'pro', name: 'Pro', priceUsdc: 49, perMin: 3_000, alerts: 10, historyDays: 90, maxKeys: 5 },
  business: { id: 'business', name: 'Business', priceUsdc: 199, perMin: 10_000, alerts: 100, historyDays: 365, maxKeys: 5 },
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

export const BASE_CHAIN_ID = 8453
export const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
export const USDC_DECIMALS = 6
/** Blocks on top of the payment's block before it counts (Base makes a block every two seconds). */
export const MIN_CONFIRMATIONS = Math.max(1, Number(process.env.GULLY_MIN_CONFIRMATIONS) || 10)

/** The treasury wallet that receives payments, lower-cased, or null when unset or malformed. */
export function treasury() {
  const t = String(process.env.GULLY_TREASURY_ADDRESS ?? '').trim()
  return /^0x[0-9a-fA-F]{40}$/.test(t) && !/^0x0{40}$/.test(t) ? t.toLowerCase() : null
}

/** Base RPC endpoints, tried in order. GULLY_BASE_RPC (comma-separated) replaces them, for tests. */
export function baseRpcs() {
  const env = String(process.env.GULLY_BASE_RPC ?? '').trim()
  return env ? env.split(',').map((s) => s.trim()).filter(Boolean) : ['https://mainnet.base.org', 'https://base-rpc.publicnode.com']
}

/** A price in USDC as raw units (6 decimals). */
export const usdcRaw = (usdc) => BigInt(Math.round(usdc * 10 ** USDC_DECIMALS))

/** Raw USDC units as a decimal string, e.g. 49000123n -> "49.000123". */
export function fmtUsdc(raw) {
  const r = BigInt(raw)
  const whole = r / 10n ** BigInt(USDC_DECIMALS)
  const frac = (r % 10n ** BigInt(USDC_DECIMALS)).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : String(whole)
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
export function publicPlans() {
  const t = treasury()
  return {
    currency: 'USDC',
    chain: { id: BASE_CHAIN_ID, name: 'Base' },
    token: { address: USDC_BASE, symbol: 'USDC', decimals: USDC_DECIMALS },
    periodDays: PERIOD_DAYS,
    anonymous: ANONYMOUS,
    plans: Object.values(PLANS),
    checkout: t ? { enabled: true, treasury: t, minConfirmations: MIN_CONFIRMATIONS } : { enabled: false, treasury: null, reason: 'Paid plans cannot be bought yet: no treasury wallet is configured.' },
  }
}
