// Crypto checkout for the paid plans, with no custody: the buyer sends USDC on Base straight to the
// treasury wallet (GULLY_TREASURY_ADDRESS) and gives us the transaction hash. We read the receipt
// from a public Base RPC and, when it holds up, the plan runs PERIOD_DAYS from now (or from the end of
// the same plan when it is still running).
//
// A payment counts when ALL of these hold:
//   - the receipt exists and its status is 1;
//   - it has a Transfer log emitted by the USDC contract to the treasury for at least the plan's price;
//   - the transfer came FROM the signed-in wallet, or its amount is exactly the amount of this wallet's
//     open checkout for that plan (each checkout adds a unique sub-cent tag, so a payment sent from any
//     other wallet still names its buyer; without that, anyone watching the treasury could claim
//     someone else's payment);
//   - the transaction hash was never used before;
//   - it has at least MIN_CONFIRMATIONS blocks on top (fewer answers 202: try again shortly).
//
// Stored in DATA_DIR/billing.json: { payments: [...], intents: [...] }. The running plan lives on the
// account (developers.json) as account.plan = { id, since, expiresAt, source: 'payment' | 'admin' }.

import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './http.mjs'
import { baseRpcs, fmtUsdc, MIN_CONFIRMATIONS, PAID_PLAN_IDS, PERIOD_MS, planOf, PLANS, treasury, USDC_BASE, usdcRaw } from './plans.mjs'
import { getAccount, randomToken, saveDevelopers } from './store.mjs'

const FILE = path.join(DATA_DIR, 'billing.json')
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const INTENT_TTL_MS = 7 * 86_400_000
const MAX_TAG = 9_999 // up to 0.009999 USDC on top of the price

let db
try {
  db = JSON.parse(fs.readFileSync(FILE, 'utf8'))
} catch {
  db = {}
}
db.payments ??= []
db.intents ??= []

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(db))
  fs.renameSync(FILE + '.tmp', FILE)
}

const pruneIntents = () => {
  const now = Date.now()
  db.intents = db.intents.filter((i) => Date.parse(i.expiresAt) > now && !i.paidAt)
}

const intentView = (i) => ({ id: i.id, plan: i.plan, amount: fmtUsdc(i.amountRaw), amountRaw: i.amountRaw, priceUsdc: PLANS[i.plan].priceUsdc, treasury: i.treasury, token: USDC_BASE, chainId: 8453, createdAt: i.createdAt, expiresAt: i.expiresAt })

const paymentView = (p) => ({ txHash: p.txHash, plan: p.plan, amount: fmtUsdc(p.amountRaw), from: p.from, blockNumber: p.blockNumber, at: p.at, periodStart: p.periodStart, expiresAt: p.expiresAt })

/**
 * The open checkout of a wallet for a plan, created when there is none. Its amount is the price plus
 * a sub-cent tag no other open checkout for that plan carries.
 */
export function openIntent(address, planId) {
  const t = treasury()
  if (!t) return { ok: false, status: 503, error: 'Paid plans cannot be bought yet: no treasury wallet is configured.' }
  if (!PAID_PLAN_IDS.includes(planId)) return { ok: false, status: 400, error: `Choose a paid plan: ${PAID_PLAN_IDS.join(' or ')}.` }
  pruneIntents()
  let i = db.intents.find((x) => x.address === address && x.plan === planId && x.treasury === t)
  if (!i) {
    const taken = new Set(db.intents.filter((x) => x.plan === planId).map((x) => x.tag))
    if (taken.size >= MAX_TAG) return { ok: false, status: 503, error: 'Too many open checkouts right now. Try again later.' }
    let tag
    do {
      tag = 1 + Math.floor(Math.random() * MAX_TAG)
    } while (taken.has(tag))
    const now = Date.now()
    i = { id: randomToken(9), address, plan: planId, tag, amountRaw: String(usdcRaw(PLANS[planId].priceUsdc) + BigInt(tag)), treasury: t, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + INTENT_TTL_MS).toISOString(), paidAt: null }
    db.intents.push(i)
    save()
  }
  return { ok: true, intent: intentView(i) }
}

/* -------------------------------------------------------------------- rpc --- */

async function rpc(method, params) {
  let last
  for (const url of baseRpcs()) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(10_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const j = await res.json()
      if (j.error) throw new Error(j.error.message ?? 'RPC error')
      return j.result
    } catch (e) {
      last = e
    }
  }
  throw last ?? new Error('no RPC configured')
}

const topicAddress = (topic) => (typeof topic === 'string' && topic.length === 66 ? '0x' + topic.slice(26).toLowerCase() : null)

/* ------------------------------------------------------------- verifying --- */

const verifying = new Set()

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
 * Checks a payment transaction for a wallet and plan. Resolves to
 *   { ok: true, payment, plan }               the plan is applied
 *   { ok: false, status: 202, pending: true, confirmations, needed, error }
 *   { ok: false, status: 4xx/5xx, error }
 */
export async function verifyPayment(address, planId, txHashIn) {
  const t = treasury()
  if (!t) return { ok: false, status: 503, error: 'Paid plans cannot be bought yet: no treasury wallet is configured.' }
  if (!PAID_PLAN_IDS.includes(planId)) return { ok: false, status: 400, error: `Choose a paid plan: ${PAID_PLAN_IDS.join(' or ')}.` }
  const txHash = String(txHashIn ?? '').trim().toLowerCase()
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) return { ok: false, status: 400, error: 'That is not a transaction hash (0x followed by 64 hex characters).' }
  if (db.payments.some((p) => p.txHash === txHash)) return { ok: false, status: 409, error: 'This transaction has already been used for a plan.' }
  if (verifying.has(txHash)) return { ok: false, status: 409, error: 'This transaction is being checked already.' }
  verifying.add(txHash)
  try {
    let receipt
    let head
    try {
      ;[receipt, head] = await Promise.all([rpc('eth_getTransactionReceipt', [txHash]), rpc('eth_blockNumber', [])])
    } catch (e) {
      return { ok: false, status: 502, error: `Base could not be read just now (${String(e?.message ?? e)}). Try again in a minute.` }
    }
    if (!receipt) return { ok: false, status: 202, pending: true, confirmations: 0, needed: MIN_CONFIRMATIONS, error: 'Base does not know this transaction yet. If you just sent it, wait a few seconds and check again.' }
    if (receipt.status !== '0x1') return { ok: false, status: 422, error: 'This transaction failed on chain, so nothing was paid.' }

    const price = usdcRaw(PLANS[planId].priceUsdc)
    const transfers = (receipt.logs ?? [])
      .filter((l) => Array.isArray(l.topics) && l.topics[0]?.toLowerCase() === TRANSFER_TOPIC && l.topics.length === 3)
      .map((l) => ({ token: String(l.address ?? '').toLowerCase(), from: topicAddress(l.topics[1]), to: topicAddress(l.topics[2]), value: /^0x[0-9a-fA-F]+$/.test(l.data ?? '') ? BigInt(l.data) : 0n }))
    const usdcToTreasury = transfers.filter((x) => x.token === USDC_BASE && x.to === t)
    if (!usdcToTreasury.length) {
      if (transfers.some((x) => x.to === t)) return { ok: false, status: 422, error: 'This transaction sent a token other than USDC on Base to the treasury. Only USDC (0x8335…2913) counts.' }
      if (transfers.some((x) => x.token === USDC_BASE)) return { ok: false, status: 422, error: 'This transaction sent USDC, but not to the Gully Labs treasury address.' }
      return { ok: false, status: 422, error: 'This transaction has no USDC transfer to the Gully Labs treasury.' }
    }
    const enough = usdcToTreasury.filter((x) => x.value >= price)
    if (!enough.length) return { ok: false, status: 422, error: `This transaction paid ${fmtUsdc(usdcToTreasury.reduce((a, x) => (x.value > a ? x.value : a), 0n))} USDC; ${PLANS[planId].name} costs ${fmtUsdc(price)} USDC.` }

    pruneIntents()
    const intent = db.intents.find((i) => i.address === address && i.plan === planId && i.treasury === t)
    const match = enough.find((x) => x.from === address) ?? (intent ? enough.find((x) => x.value === BigInt(intent.amountRaw)) : undefined)
    if (!match) return { ok: false, status: 422, error: intent ? `This payment came from another wallet and is not the exact checkout amount (${fmtUsdc(intent.amountRaw)} USDC), so it cannot be matched to you. Write to hello@gullylabs.xyz with the hash.` : 'This payment came from another wallet. Start a checkout first: it gives an exact amount that ties a payment from any wallet to you.' }

    const blockNumber = Number(BigInt(receipt.blockNumber))
    if (match.from !== address) {
      // Matched by amount only: the payment must postdate the checkout, so a tag reused after an old
      // checkout lapsed can never claim a transfer someone made for the earlier one.
      let block
      try {
        block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false])
      } catch (e) {
        return { ok: false, status: 502, error: `Base could not be read just now (${String(e?.message ?? e)}). Try again in a minute.` }
      }
      const minedAt = block?.timestamp ? Number(BigInt(block.timestamp)) * 1000 : 0
      if (minedAt < Date.parse(intent.createdAt) - 120_000) return { ok: false, status: 422, error: 'This payment was made before your checkout was opened, so it cannot be matched to you. Write to hello@gullylabs.xyz with the hash.' }
    }
    const confirmations = Number(BigInt(head)) - blockNumber + 1
    if (confirmations < MIN_CONFIRMATIONS) return { ok: false, status: 202, pending: true, confirmations: Math.max(0, confirmations), needed: MIN_CONFIRMATIONS, error: `Waiting for confirmations: ${Math.max(0, confirmations)} of ${MIN_CONFIRMATIONS}.` }

    const account = getAccount(address)
    if (!account) return { ok: false, status: 404, error: 'No such account.' }
    if (db.payments.some((p) => p.txHash === txHash)) return { ok: false, status: 409, error: 'This transaction has already been used for a plan.' }
    const period = applyPlan(account, planId, 'payment')
    const payment = { id: randomToken(9), txHash, address, plan: planId, amountRaw: String(match.value), from: match.from, blockNumber, at: new Date().toISOString(), ...period }
    db.payments.push(payment)
    if (intent) intent.paidAt = payment.at // the checkout for this plan is done either way
    pruneIntents()
    save()
    return { ok: true, payment: paymentView(payment), plan: planOf(address) }
  } finally {
    verifying.delete(txHash)
  }
}

/* ---------------------------------------------------------------- views --- */

/** The billing view of a wallet for its dashboard. */
export function billingOf(address) {
  pruneIntents()
  return {
    plan: planOf(address),
    payments: db.payments.filter((p) => p.address === address).reverse().map(paymentView),
    intents: db.intents.filter((i) => i.address === address).map(intentView),
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

/** Admin: every payment, newest first. */
export const allPayments = () => [...db.payments].reverse().map((p) => ({ ...paymentView(p), address: p.address }))
