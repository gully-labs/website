// Gully Pay ledger and plan checkout, with no custody: the buyer sends a coin or a stablecoin on one of
// the chains in payments.mjs straight to the treasury wallet (GULLY_TREASURY_ADDRESS) and gives us the
// transaction hash. We read it from public nodes and, when it holds up, the plan runs PERIOD_DAYS from
// now (or from the end of the same plan when it is still running). General invoices (invoices.mjs) use
// the same quotes and the same checks.
//
// A quote fixes, for 20 minutes, the exact amount to send in one asset:
//   stablecoin: the USD amount plus a unique tag of 0.000001 to 0.009999;
//   native coin: USD / the Chainlink price at quote time, rounded up, plus a unique tail in the 9th
//   decimal places. The price source (feed, round id, answer, updatedAt) is kept on the quote. A stale
//   feed (older than two hours) gives no quote.
//
// A payment counts when ALL of these hold (payments.mjs reads the chain):
//   - the receipt and the transaction agree, its status is 1 and it is on the quote's chain;
//   - it paid the treasury in the quote's asset: a Transfer log of that token, or for a native coin
//     `to` = treasury and `value` > 0;
//   - plan: from the signed-in wallet, at least the USD price (stablecoin) or the quoted amount
//     (native coin); from any other wallet, exactly the quoted amount;
//     invoice: exactly the quoted amount (nobody is signed in on a pay page);
//   - when matched by amount, or paid in a native coin, it was mined after the quote was made and no
//     later than QUOTE_GRACE_MS after it ran out (a native price is only good while its quote is);
//   - chainId:hash was never used before, on any chain;
//   - it has the chain's confirmations (Ethereum 6, Base 10, Arbitrum 10, BNB Chain 15); fewer answers
//     202, try again shortly.
//
// Stored in DATA_DIR/billing.json: { payments, quotes, invoices, links }. The running plan lives on the account
// (developers.json) as account.plan = { id, since, expiresAt, source: 'payment' | 'admin' }. Records
// written before multi-chain payments (USDC on Base only, "intents") are migrated on load.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './http.mjs'
import { assetById, ASSET_IDS, blockTime, CHAINS, confirmationsFor, DEFAULT_ASSET, fmtUnits, fmtUsd, MAX_TAG, paymentUri, quoteAmount, readFeed, readPayment, txUrl } from './payments.mjs'
import { PAID_PLAN_IDS, PERIOD_MS, planOf, PLANS, treasury } from './plans.mjs'
import { getAccount, randomToken, saveDevelopers } from './store.mjs'
import { isSolanaAsset, solanaPayUrl, solanaTreasury } from './solana-pay.mjs'
import { isSolanaSignature, newReference } from './solana.mjs'

/** The treasury a payment in this asset goes to: GULLY_SOLANA_TREASURY on Solana, else the EVM treasury. */
const treasuryFor = (asset) => (isSolanaAsset(asset) ? solanaTreasury() : treasury())

const FILE = path.join(DATA_DIR, 'billing.json')
export const QUOTE_TTL_MS = 20 * 60_000
/** A transaction sent just before a quote ran out may be mined a little after. */
export const QUOTE_GRACE_MS = 10 * 60_000
/** Quotes stay readable this long after they run out, so a late "check payment" still finds them. */
const QUOTE_RETAIN_MS = 7 * 86_400_000
/** Mined up to this long before the quote was made still counts (clock skew between us and the chain). */
const CLOCK_SKEW_MS = 120_000

let db
try {
  db = JSON.parse(fs.readFileSync(FILE, 'utf8'))
} catch {
  db = {}
}
db.payments ??= []
db.quotes ??= []
db.invoices ??= []
// Gully Pay links (paylinks.mjs): reusable pages that each make an invoice per payer.
db.links ??= []
// Migration from USDC-on-Base only: payments gain chain and asset; open "intents" become quotes and
// keep the expiry they were given.
for (const p of db.payments) {
  p.kind ??= 'plan'
  p.chainId ??= 8453
  p.assetId ??= DEFAULT_ASSET
  p.symbol ??= 'USDC'
  p.decimals ??= 6
  if (p.usdCents == null && p.plan && PLANS[p.plan]) p.usdCents = String(Math.round(PLANS[p.plan].priceUsdc * 100))
}
if (Array.isArray(db.intents)) {
  for (const i of db.intents) {
    if (i.paidAt || !PLANS[i.plan] || db.quotes.some((q) => q.id === i.id)) continue
    const cents = BigInt(Math.round(PLANS[i.plan].priceUsdc * 100))
    db.quotes.push({ id: i.id, kind: 'plan', address: i.address, plan: i.plan, invoiceId: null, assetId: DEFAULT_ASSET, chainId: 8453, symbol: 'USDC', decimals: 6, usdCents: String(cents), tag: i.tag, amountRaw: i.amountRaw, minRaw: String(cents * 10_000n), treasury: i.treasury, price: null, createdAt: i.createdAt, expiresAt: i.expiresAt, paidAt: null })
  }
  delete db.intents
}

export function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(db))
  fs.renameSync(FILE + '.tmp', FILE)
}

/** The ledger itself, for invoices.mjs. */
export const ledger = () => db

function pruneQuotes() {
  const now = Date.now()
  const before = db.quotes.length
  db.quotes = db.quotes.filter((q) => !q.paidAt && Date.parse(q.expiresAt) + QUOTE_RETAIN_MS > now)
  return before !== db.quotes.length
}

const usedKey = (chainId, hash) => `${chainId}:${hash}`
/** Whether chainId:hash already paid for anything. */
export const hashUsed = (chainId, hash) => db.payments.some((p) => usedKey(p.chainId, p.txHash) === usedKey(chainId, hash))

/* --------------------------------------------------------------- views --- */

const assetBrief = (a) => ({ id: a.id, chainId: a.chainId, chain: CHAINS[a.chainId].name, symbol: a.symbol, kind: a.kind, address: a.address, decimals: a.decimals })

export function quoteView(q) {
  const a = assetById(q.assetId)
  return {
    id: q.id,
    kind: q.kind,
    plan: q.plan ?? null,
    invoiceId: q.invoiceId ?? null,
    asset: assetBrief(a),
    usd: fmtUsd(q.usdCents),
    amount: fmtUnits(q.amountRaw, a.decimals),
    amountRaw: q.amountRaw,
    minAmount: fmtUnits(q.minRaw, a.decimals),
    treasury: q.treasury,
    chainId: a.chainId,
    token: a.address,
    // EIP-681 wallet link (Solana Pay transfer request on Solana) for the exact amount (the pay page's QR).
    // Built here, the one source of truth.
    uri: isSolanaAsset(a) ? solanaPayUrl({ asset: a, recipient: q.treasury, amountRaw: q.amountRaw, reference: q.reference, message: q.plan && PLANS[q.plan] ? `Gully Labs ${PLANS[q.plan].name}` : 'Gully Pay' }) : paymentUri(a, q.treasury, q.amountRaw),
    /** Solana Pay: the quote's unique reference key, which finds its payment on chain. */
    reference: q.reference ?? null,
    confirmations: confirmationsFor(a.chainId),
    // Kept for pages built before multi-chain payments.
    priceUsdc: q.plan && PLANS[q.plan] ? PLANS[q.plan].priceUsdc : null,
    price: q.price ? { feed: q.price.feed, description: q.price.description, roundId: q.price.roundId, answer: fmtUnits(q.price.answer, q.price.decimals), updatedAt: q.price.updatedAt } : null,
    createdAt: q.createdAt,
    expiresAt: q.expiresAt,
  }
}

export function paymentView(p) {
  const a = assetById(p.assetId)
  return {
    id: p.id ?? null,
    kind: p.kind,
    txHash: p.txHash,
    chainId: p.chainId,
    chain: CHAINS[p.chainId]?.name ?? String(p.chainId),
    asset: p.assetId,
    symbol: p.symbol,
    amount: fmtUnits(p.amountRaw, p.decimals ?? a?.decimals ?? 6),
    usd: p.usdCents != null ? fmtUsd(p.usdCents) : null,
    from: p.from,
    to: p.to ?? null,
    blockNumber: p.blockNumber,
    at: p.at,
    txUrl: CHAINS[p.chainId] ? txUrl(p.chainId, p.txHash) : null,
    price: p.price ? { description: p.price.description, answer: fmtUnits(p.price.answer, p.price.decimals), updatedAt: p.price.updatedAt, roundId: p.price.roundId, feed: p.price.feed } : null,
    plan: p.plan ?? null,
    periodStart: p.periodStart ?? null,
    expiresAt: p.expiresAt ?? null,
    invoiceId: p.invoiceId ?? null,
  }
}

/* -------------------------------------------------------------- quotes --- */

const noTreasury = { ok: false, status: 503, error: 'Payments cannot be taken yet: no treasury wallet is configured.' }
const noSolanaTreasury = { ok: false, status: 503, error: 'Payments on Solana cannot be taken yet: no Solana treasury wallet is configured. Choose another chain.' }

/**
 * A new quote in one asset for a USD amount. Its amount differs from every other open quote in that
 * asset, so a transfer of exactly that amount names its quote.
 */
export async function createQuote({ kind, assetId, usdCents, address = null, plan = null, invoiceId = null }) {
  if (!treasury()) return noTreasury
  const asset = assetById(String(assetId ?? ''))
  if (!asset) return { ok: false, status: 400, error: `Choose an asset: ${ASSET_IDS.join(', ')}.` }
  const t = treasuryFor(asset)
  if (!t) return noSolanaTreasury
  let price = null
  if (asset.kind === 'native') {
    const f = await readFeed(asset.chainId)
    if (!f.ok) return f
    price = f.price
  }
  pruneQuotes()
  const now = Date.now()
  const open = db.quotes.filter((q) => q.assetId === asset.id && !q.paidAt && Date.parse(q.expiresAt) + QUOTE_GRACE_MS > now)
  const tags = new Set(open.map((q) => q.tag))
  const amounts = new Set(open.map((q) => q.amountRaw))
  let pick = null
  for (let i = 0; i < 400 && !pick; i++) {
    const tag = 1 + crypto.randomInt(MAX_TAG)
    if (tags.has(tag)) continue
    const amt = quoteAmount(asset, BigInt(usdCents), tag, price)
    if (!amounts.has(String(amt.amount))) pick = { tag, ...amt }
  }
  if (!pick) return { ok: false, status: 503, error: 'Too many open quotes in this asset right now. Try another asset or try again in a few minutes.' }
  const q = {
    id: 'q_' + randomToken(12),
    kind,
    address,
    plan,
    invoiceId,
    assetId: asset.id,
    chainId: asset.chainId,
    symbol: asset.symbol,
    decimals: asset.decimals,
    usdCents: String(usdCents),
    tag: pick.tag,
    amountRaw: String(pick.amount),
    // From the signed-in wallet a stablecoin needs the USD amount; a native coin the quoted amount.
    minRaw: String(asset.kind === 'native' ? pick.amount : pick.base),
    treasury: t,
    ...(isSolanaAsset(asset) ? { reference: newReference() } : {}),
    price,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + QUOTE_TTL_MS).toISOString(),
    paidAt: null,
  }
  db.quotes.push(q)
  save()
  return { ok: true, quote: q }
}

export const findQuote = (id) => db.quotes.find((q) => q.id === id) ?? null

/* --------------------------------------------------------- verification --- */

const verifying = new Set()

/**
 * The shared check of a transaction against a quote (or, for the legacy plan flow, against a price in
 * USDC on Base with no quote). `signer` is the signed-in wallet, or null on a public pay page.
 * When everything holds, `run({ match, read, asset })` records the payment and its answer is returned;
 * otherwise resolves to { ok: false, status, error, pending?, confirmations?, needed? }.
 */
async function checkTx({ quote, asset, txHash, signer, minRaw, label, run }) {
  if (!treasury()) return noTreasury
  const t = treasuryFor(asset)
  if (!t) return noSolanaTreasury
  if (isSolanaAsset(asset) !== isSolanaSignature(txHash)) return isSolanaAsset(asset) ? { ok: false, status: 400, error: 'This quote is on Solana: give the transaction signature (base58, 87 or 88 characters), not a 0x hash.' } : badHash
  if (quote && quote.treasury !== t) return { ok: false, status: 409, error: 'This quote was made for an earlier treasury address. Start a new one.' }
  if (hashUsed(asset.chainId, txHash)) return { ok: false, status: 409, error: 'This transaction has already been used for a payment.' }
  const key = usedKey(asset.chainId, txHash)
  if (verifying.has(key)) return { ok: false, status: 409, error: 'This transaction is being checked already.' }
  verifying.add(key)
  try {
    const read = await readPayment(asset, txHash, t, { reference: quote?.reference ?? null })
    if (!read.ok) return read
    const min = BigInt(minRaw)
    const exact = quote ? BigInt(quote.amountRaw) : null
    const enough = read.credits.filter((x) => x.value >= min)
    if (!enough.length) {
      const best = read.credits.reduce((a, x) => (x.value > a ? x.value : a), 0n)
      return { ok: false, status: 422, error: `This transaction paid ${fmtUnits(best, asset.decimals)} ${asset.symbol}; ${label} costs ${fmtUnits(min, asset.decimals)} ${asset.symbol}. Nothing was applied; write to hello@gullylabs.xyz with the hash to settle the difference.` }
    }
    const match = (signer ? enough.find((x) => x.from === signer) : undefined) ?? (exact != null ? enough.find((x) => x.value === exact) : undefined)
    if (!match) {
      if (!signer) return { ok: false, status: 422, error: `This transaction paid ${fmtUnits(enough[0].value, asset.decimals)} ${asset.symbol}, not the exact amount of this quote (${fmtUnits(exact, asset.decimals)} ${asset.symbol}), so it cannot be matched to it. Write to hello@gullylabs.xyz with the hash.` }
      return { ok: false, status: 422, error: quote ? `This payment came from another wallet and is not the exact checkout amount (${fmtUnits(exact, asset.decimals)} ${asset.symbol}), so it cannot be matched to you. Write to hello@gullylabs.xyz with the hash.` : 'This payment came from another wallet. Start a checkout first: it gives an exact amount that ties a payment from any wallet to you.' }
    }
    // Matched by amount, or priced by a feed: it must fall inside the quote's life.
    if (quote && (asset.kind === 'native' || match.from !== signer)) {
      let minedAt = read.minedAt ?? null
      try {
        minedAt ??= await blockTime(asset.chainId, read.blockHex)
      } catch (e) {
        return { ok: false, status: 502, error: `${CHAINS[asset.chainId].name} could not be read just now (${String(e?.message ?? e)}). Try again in a minute.` }
      }
      if (minedAt == null) return { ok: false, status: 502, error: `${CHAINS[asset.chainId].name}'s node did not give the block time. Try again in a minute.` }
      if (minedAt < Date.parse(quote.createdAt) - CLOCK_SKEW_MS) return { ok: false, status: 422, error: 'This payment was made before your checkout was opened, so it cannot be matched to you. Write to hello@gullylabs.xyz with the hash.' }
      if (minedAt > Date.parse(quote.expiresAt) + QUOTE_GRACE_MS) return { ok: false, status: 422, error: `This payment was mined after its quote ran out (${quote.expiresAt}), so the quoted ${asset.kind === 'native' ? 'price' : 'amount'} no longer holds. Write to hello@gullylabs.xyz with the hash.` }
    }
    if (read.confirmations < read.needed) return { ok: false, status: 202, pending: true, confirmations: read.confirmations, needed: read.needed, error: `Waiting for confirmations: ${read.confirmations} of ${read.needed}.` }
    if (hashUsed(asset.chainId, txHash)) return { ok: false, status: 409, error: 'This transaction has already been used for a payment.' }
    return await run({ match, read, asset })
  } finally {
    verifying.delete(key)
  }
}

/** Records a checked payment and marks its quote paid. */
export function recordPayment(fields, quote) {
  const payment = { id: randomToken(9), at: new Date().toISOString(), to: quote?.treasury ?? treasury(), ...fields }
  db.payments.push(payment)
  if (quote) quote.paidAt = payment.at
  pruneQuotes()
  save()
  return payment
}

/** An EVM hash is lower-cased; a Solana signature (base58) is case-sensitive and kept as given. */
export const normHash = (v) => {
  const s = String(v ?? '').trim()
  return isSolanaSignature(s) ? s : s.toLowerCase()
}
export const isHash = (h) => /^0x[0-9a-f]{64}$/.test(h) || isSolanaSignature(h)
export const badHash = { ok: false, status: 400, error: 'That is not a transaction hash (0x followed by 64 hex characters) or a Solana signature.' }

/** Checks an invoice payment (invoices.mjs owns the invoice rules): exact quoted amount only. */
export function checkInvoiceTx({ quote, txHash, run }) {
  const asset = assetById(quote.assetId)
  return checkTx({ quote, asset, txHash, signer: null, minRaw: quote.amountRaw, label: 'this invoice', run })
}

/* ------------------------------------------------------------- plans --- */

const planError = () => ({ ok: false, status: 400, error: `Choose a paid plan: ${PAID_PLAN_IDS.join(' or ')}.` })
const planCents = (planId) => BigInt(Math.round(PLANS[planId].priceUsdc * 100))

/**
 * The checkout of a wallet for a plan in one asset (USDC on Base when none is named). An open quote
 * with five minutes or more left comes back; otherwise a new one is made.
 */
export async function openIntent(address, planId, assetId = DEFAULT_ASSET) {
  const t = treasury()
  if (!t) return noTreasury
  if (!PAID_PLAN_IDS.includes(planId)) return planError()
  const id = String(assetId || DEFAULT_ASSET)
  if (!assetById(id)) return { ok: false, status: 400, error: `Choose an asset: ${ASSET_IDS.join(', ')}.` }
  if (pruneQuotes()) save()
  const live = db.quotes.find((q) => q.kind === 'plan' && q.address === address && q.plan === planId && q.assetId === id && q.treasury === treasuryFor(assetById(id)) && !q.paidAt && Date.parse(q.expiresAt) - Date.now() > 5 * 60_000)
  if (live) return { ok: true, intent: quoteView(live) }
  const r = await createQuote({ kind: 'plan', assetId: id, usdCents: planCents(planId), address, plan: planId })
  return r.ok ? { ok: true, intent: quoteView(r.quote) } : r
}

/** Applies a plan to an account: extends the same running plan, else starts now. */
function applyPlan(account, planId, source, periodMs = PERIOD_MS) {
  const now = Date.now()
  const cur = account.plan
  const running = cur && cur.id === planId && Date.parse(cur.expiresAt) > now
  const start = running ? Date.parse(cur.expiresAt) : now
  account.plan = { id: planId, since: running ? cur.since : new Date(now).toISOString(), expiresAt: new Date(start + periodMs).toISOString(), source }
  saveDevelopers()
  return { periodStart: new Date(start).toISOString(), expiresAt: account.plan.expiresAt }
}

/**
 * Checks a payment transaction for a wallet's plan. With `quoteId` it is checked against that quote
 * (any asset); without one, against the wallet's latest USDC-on-Base checkout for the plan, as before
 * multi-chain payments. Resolves to
 *   { ok: true, payment, plan }               the plan is applied
 *   { ok: false, status: 202, pending: true, confirmations, needed, error }
 *   { ok: false, status: 4xx/5xx, error }
 */
export async function verifyPayment(address, planIdIn, txHashIn, quoteId = null) {
  if (!treasury()) return noTreasury
  let planId = String(planIdIn ?? '')
  const txHash = normHash(txHashIn)
  let quote = null
  if (quoteId) {
    quote = findQuote(String(quoteId))
    if (!quote || quote.kind !== 'plan' || quote.address !== address) return { ok: false, status: 404, error: 'No such checkout for this wallet. Start a new one.' }
    if (quote.paidAt) return { ok: false, status: 409, error: 'This checkout has been paid already.' }
    planId = quote.plan
  }
  if (!PAID_PLAN_IDS.includes(planId)) return planError()
  if (!isHash(txHash)) return badHash
  if (!quote) quote = [...db.quotes].reverse().find((q) => q.kind === 'plan' && q.address === address && q.plan === planId && q.assetId === DEFAULT_ASSET && !q.paidAt) ?? null
  const asset = assetById(quote?.assetId ?? DEFAULT_ASSET)
  const minRaw = quote ? quote.minRaw : String(planCents(planId) * 10n ** BigInt(asset.decimals - 2))
  return checkTx({
    quote,
    asset,
    txHash,
    signer: address,
    minRaw,
    label: PLANS[planId].name,
    run: async ({ match, read }) => {
      const account = getAccount(address)
      if (!account) return { ok: false, status: 404, error: 'No such account.' }
      const period = applyPlan(account, planId, 'payment')
      const payment = recordPayment({ kind: 'plan', txHash, chainId: asset.chainId, assetId: asset.id, symbol: asset.symbol, decimals: asset.decimals, amountRaw: String(match.value), usdCents: quote?.usdCents ?? String(planCents(planId)), price: quote?.price ?? null, quoteId: quote?.id ?? null, address, plan: planId, from: match.from, blockNumber: read.blockNumber, ...period }, quote)
      return { ok: true, payment: paymentView(payment), plan: planOf(address) }
    },
  })
}

/* ------------------------------------------------- other products' plans --- */

// Another product sold per wallet (Gully Analytics, analytics-accounts.mjs) uses the same quotes and the
// same checks under its own `kind`; the product applies the plan itself in `apply`. Payments of another
// kind never show in the tracker API's billing view.

/** A quote for `kind`/`planId` at `usdCents`: an open one with five minutes or more left comes back. */
export async function openProductQuote({ kind, address, planId, usdCents, assetId = DEFAULT_ASSET }) {
  const t = treasury()
  if (!t) return noTreasury
  const id = String(assetId || DEFAULT_ASSET)
  if (!assetById(id)) return { ok: false, status: 400, error: `Choose an asset: ${ASSET_IDS.join(', ')}.` }
  if (pruneQuotes()) save()
  const live = db.quotes.find((q) => q.kind === kind && q.address === address && q.plan === planId && q.assetId === id && q.treasury === treasuryFor(assetById(id)) && q.usdCents === String(usdCents) && !q.paidAt && Date.parse(q.expiresAt) - Date.now() > 5 * 60_000)
  if (live) return { ok: true, intent: quoteView(live) }
  const r = await createQuote({ kind, assetId: id, usdCents: BigInt(usdCents), address, plan: planId })
  return r.ok ? { ok: true, intent: quoteView(r.quote) } : r
}

/**
 * Checks a payment against one of the wallet's `kind` quotes. When it holds, `apply(quote)` applies the
 * plan and returns { periodStart, expiresAt }, and the payment is recorded.
 */
export async function verifyProductPayment({ kind, address, quoteId, txHashIn, label, apply }) {
  if (!treasury()) return noTreasury
  const txHash = normHash(txHashIn)
  const quote = quoteId ? findQuote(String(quoteId)) : null
  if (!quote || quote.kind !== kind || quote.address !== address) return { ok: false, status: 404, error: 'No such checkout for this wallet. Start a new one.' }
  if (quote.paidAt) return { ok: false, status: 409, error: 'This checkout has been paid already.' }
  if (!isHash(txHash)) return badHash
  const asset = assetById(quote.assetId)
  return checkTx({
    quote,
    asset,
    txHash,
    signer: address,
    minRaw: quote.minRaw,
    label: label(quote),
    run: async ({ match, read }) => {
      const period = apply(quote)
      if (!period.ok) return period
      const payment = recordPayment({ kind, txHash, chainId: asset.chainId, assetId: asset.id, symbol: asset.symbol, decimals: asset.decimals, amountRaw: String(match.value), usdCents: quote.usdCents, price: quote.price ?? null, quoteId: quote.id, address, plan: quote.plan, from: match.from, blockNumber: read.blockNumber, periodStart: period.periodStart, expiresAt: period.expiresAt }, quote)
      return { ok: true, payment: paymentView(payment) }
    },
  })
}

/** A wallet's payments and open quotes of one kind. */
export function productBilling(kind, address) {
  const now = Date.now()
  return {
    payments: db.payments.filter((p) => p.kind === kind && p.address === address).reverse().map(paymentView),
    intents: db.quotes.filter((q) => q.kind === kind && q.address === address && !q.paidAt && Date.parse(q.expiresAt) > now).map(quoteView),
  }
}

/* ---------------------------------------------------------------- views --- */

/** The billing view of a wallet for its dashboard. */
export function billingOf(address) {
  const now = Date.now()
  return {
    plan: planOf(address),
    payments: db.payments.filter((p) => p.kind === 'plan' && p.address === address).reverse().map(paymentView),
    intents: db.quotes.filter((q) => q.kind === 'plan' && q.address === address && !q.paidAt && Date.parse(q.expiresAt) > now).map(quoteView),
  }
}

/* ---------------------------------------------------------------- admin --- */

/** Admin: grant a plan for `days` from now (replacing what runs), or revoke it with plan 'free'. */
export function adminSetPlan(address, planId, days = 30) {
  const account = getAccount(address)
  if (!account) return { ok: false, status: 404, error: 'No such account.' }
  if (planId === 'free') {
    account.plan = null
    saveDevelopers()
    return { ok: true, plan: planOf(address) }
  }
  if (!PAID_PLAN_IDS.includes(planId)) return { ok: false, status: 400, error: `plan must be free, ${PAID_PLAN_IDS.join(' or ')}.` }
  const d = Number(days)
  if (!Number.isInteger(d) || d < 1 || d > 3660) return { ok: false, status: 400, error: 'days must be a whole number from 1 to 3660.' }
  const now = Date.now()
  account.plan = { id: planId, since: new Date(now).toISOString(), expiresAt: new Date(now + d * 86_400_000).toISOString(), source: 'admin' }
  saveDevelopers()
  return { ok: true, plan: planOf(address) }
}

/** Admin: every payment (plans and invoices), newest first. */
export const allPayments = () => [...db.payments].reverse().map((p) => ({ ...paymentView(p), address: p.address ?? null }))
