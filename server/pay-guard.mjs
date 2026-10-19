// The one server-side check every Gully Pay payment instruction passes before it leaves the server: quotes (plan,
// product, invoice, pay link and merchant), their EIP-681 / Solana Pay URIs (the QR codes), split call data, the
// treasury shown on plan, invoice and pay-link checkouts, and the per-chain recipients on a merchant's pay page.
// (public/pay-button.js carries no address or amount: it only opens /pay/… pages, whose data comes through here.)
//
// The rules live in fee-proxy-guard.mjs, shared with the browser's wallet path:
//   (a) no plain-transfer recipient is ever a fee proxy (any chain) or the zero address;
//   (b) a split calls the proxy only through transferFromWithReferenceAndFee, value 0, an allowed token, `to` = the
//       quote's recipient, `feeAddress` = GULLY_TREASURY_ADDRESS, 0 < fee < amount, approve(proxy, amount + fee);
//   (c) a token is USDC or USDT on its chain.
// A violation is logged (console.error, "pay-guard: …") and throws PaymentGuardError (status 500); server.mjs turns
// it into a 500 and nothing is emitted.

import { assetViolations, parsePaymentUri, recipientViolations, SOLANA_LEDGER_CHAIN_ID, splitViolations } from './fee-proxy-guard.mjs'
import { assetById, fmtUnits } from './payments.mjs'

export class PaymentGuardError extends Error {
  constructor(where, violations) {
    super(`Payment instructions refused by the fee-proxy guard (${where}): ${violations.join('; ')}`)
    this.name = 'PaymentGuardError'
    this.status = 500
    this.where = where
    this.violations = violations
  }
}

/** The public message for a refused instruction (no addresses, nothing internal). */
export const GUARD_PUBLIC_ERROR = 'This payment could not be prepared safely, so no payment details were given. Nothing was charged. Please contact team@gullylabs.xyz.'

const refusals = [] // the last 20, newest last: { at, where, violations } (the admin panel shows them)
/** Refusals of the last `maxAgeMs` (default 24 h), newest first. */
export const recentRefusals = (maxAgeMs = 86_400_000) => [...refusals].reverse().filter((r) => Date.now() - Date.parse(r.at) < maxAgeMs)

/** Logs and throws when there is any violation; otherwise returns nothing. */
export function refuse(where, violations) {
  if (!violations.length) return
  const e = new PaymentGuardError(where, violations)
  console.error(`pay-guard: ${e.message}`)
  refusals.push({ at: new Date().toISOString(), where, violations: [...violations] })
  if (refusals.length > 20) refusals.shift()
  throw e
}

/** For admin views only: runs `fn`, and on a refusal returns `fallback(error)` so the admin panel still loads. */
export function guardOr(fn, fallback) {
  try {
    return fn()
  } catch (e) {
    if (e instanceof PaymentGuardError) return fallback(e)
    throw e
  }
}
/** The checkout shown in admin views when the guard refused it. */
export const refusedCheckout = (e) => ({ enabled: false, treasury: null, reason: `Refused by the fee-proxy guard: ${e.violations.join('; ')}` })

/** GULLY_TREASURY_ADDRESS, lowercase, or null (the same rule as plans.treasury()). */
const envTreasury = () => {
  const t = String(process.env.GULLY_TREASURY_ADDRESS ?? '').trim()
  return /^0x[0-9a-fA-F]{40}$/.test(t) && !/^0x0{40}$/.test(t) ? t.toLowerCase() : null
}

/** Rule (a) for one address about to be shown as where to send money. Returns it unchanged. */
export function guardRecipient(address, where, { chainId = null } = {}) {
  if (address == null) return address
  refuse(where, recipientViolations(address, { chainId, label: 'recipient' }))
  return address
}

/** The violations of a quote view (billing.quoteView's output), all three rules. */
export function quoteViolations(view) {
  const out = []
  const a = assetById(view?.asset?.id)
  if (!a) return ['the quote names an unknown asset']
  const same = view.asset.chainId === a.chainId && view.chainId === a.chainId && view.asset.kind === a.kind && view.asset.symbol === a.symbol && (view.asset.address ?? null) === (a.address ?? null) && (view.token ?? null) === (a.address ?? null)
  if (!same) out.push('the quote asset does not match the asset list')
  out.push(...assetViolations(a))
  out.push(...recipientViolations(view.treasury, { chainId: a.chainId, label: 'quote recipient' }))
  const raw = (() => {
    try {
      return BigInt(view.amountRaw)
    } catch {
      return 0n
    }
  })()
  if (raw <= 0n) out.push('the quote amount is not positive')
  // The QR / wallet link must say exactly what the quote says.
  const u = parsePaymentUri(view.uri)
  if (!u) out.push('the payment link is not one this server builds')
  else {
    out.push(...recipientViolations(u.to, { chainId: a.chainId, label: 'payment link recipient' }))
    if (u.chainId !== a.chainId) out.push('the payment link is for another chain')
    if (a.chainId === SOLANA_LEDGER_CHAIN_ID) {
      if (u.to !== view.treasury) out.push('the payment link pays someone other than the quote recipient')
      if ((u.token ?? null) !== (a.kind === 'token' ? a.address : null)) out.push('the payment link names another token')
      if (u.amount !== fmtUnits(view.amountRaw, a.decimals)) out.push('the payment link asks for another amount')
    } else {
      if (u.to !== String(view.treasury).toLowerCase()) out.push('the payment link pays someone other than the quote recipient')
      if ((u.token ?? null) !== (a.kind === 'token' ? a.address : null)) out.push('the payment link names another token')
      if (u.amount !== String(view.amountRaw)) out.push('the payment link asks for another amount')
    }
  }
  if (view.split != null) {
    if (a.kind !== 'token') out.push('a split on a native coin')
    else out.push(...splitViolations(view.split, { chainId: a.chainId, token: a.address, total: view.amountRaw, to: view.treasury, feeTo: envTreasury() }))
  }
  return out
}

/** Checks a quote view and returns it, or logs and throws PaymentGuardError. */
export function guardQuoteView(view, where = 'quote') {
  refuse(`${where} ${view?.id ?? ''}`.trim(), quoteViolations(view))
  return view
}
