// Gully Pay for merchants: the fee arithmetic, kept apart so it can be read (and changed) in one place.
//
// OWNER-EDITABLE through env, read on every use (so a restart is enough to change them):
//   GULLY_PAY_MERCHANT_FEE_BPS   the transaction fee in basis points (default 50 = 0.5%), 0 to 1000
//   GULLY_PAY_MERCHANT_FREE_USD  each workspace's lifetime volume that is fee-free (default 5000), 0 to 10,000,000
// The rest of the policy is fixed here: a statement is issued only for $1 or more (smaller balances roll
// into the next week), a reminder goes out on day 5, and checkout pauses 7 days after issue.
//
// Accrual is exact: a payment's fee is kept in micro-dollars (1e-6 USD) as an integer. With the payment
// at C cents, of which F cents still fall inside the free allowance:
//   feeable cents = C - F           fee micro-USD = feeable cents x bps
// (C cents = C x 10,000 micro-USD, times bps / 10,000.) A payment that straddles the allowance pays only on
// the part above it. A statement rounds the sum of its fees to the nearest cent, half up, once.

export const DEFAULT_FEE_BPS = 50
export const DEFAULT_FREE_USD = 5000
/** A statement is issued only for at least this much (cents). */
export const MIN_STATEMENT_CENTS = 100n
/** Checkout pauses this many days after a statement is issued, while it is unpaid. */
export const PAUSE_AFTER_DAYS = 7
/** The reminder goes out this many days after issue. */
export const WARN_DAY = 5

function intEnv(name, def, min, max) {
  const raw = process.env[name]
  if (raw == null || String(raw).trim() === '') return def
  const n = Number(raw)
  return Number.isInteger(n) && n >= min && n <= max ? n : def
}

/** The fee in force: { bps, freeCents (BigInt) }. */
export function feeConfig() {
  return { bps: intEnv('GULLY_PAY_MERCHANT_FEE_BPS', DEFAULT_FEE_BPS, 0, 1000), freeCents: BigInt(intEnv('GULLY_PAY_MERCHANT_FREE_USD', DEFAULT_FREE_USD, 0, 10_000_000)) * 100n }
}

/**
 * The fee on one confirmed payment of `cents`, after `priorCents` of the workspace's earlier lifetime
 * volume. All BigInt. Returns { bps, freeCents, feeableCents, feeMicros }.
 */
export function accrue({ priorCents, cents }, cfg = feeConfig()) {
  const prior = BigInt(priorCents)
  const c = BigInt(cents)
  const freeLeft = prior >= cfg.freeCents ? 0n : cfg.freeCents - prior
  const free = c < freeLeft ? c : freeLeft
  const feeable = c - free
  return { bps: cfg.bps, freeCents: free, feeableCents: feeable, feeMicros: feeable * BigInt(cfg.bps) }
}

/** Micro-dollars to cents, rounded half up. */
export const centsOfMicros = (micros) => (BigInt(micros) + 5_000n) / 10_000n

/** Unix ms of the Monday 00:00 UTC that starts the week holding `now`. */
export function weekStart(now = Date.now()) {
  const d = new Date(now)
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const sinceMonday = (d.getUTCDay() + 6) % 7
  return midnight - sinceMonday * 86_400_000
}
