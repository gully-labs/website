// Gully Pay plan subscriptions for Create a chain (gull-pay PR #89). A testnet chain is free for 30 days, then $199 a month,
// billed by Gully Pay on the chain orders' own store. This file only talks to Gully Pay; chain-orders.mjs decides when.
//
//   POST <apiUrl>/v1/subscriptions/<storeId>              { plan, reference, customerEmail?, metadata? }
//        201 { subscription, created: true } · 200 { subscription, created: false } the same reference again (idempotent)
//   POST <apiUrl>/v1/subscriptions/<storeId>/<id>/cancel  { reason? }  -> 200 { subscription } (terminal, idempotent)
// Auth: the store API key as `Authorization: Bearer rk_...` (the same credential as hosted checkout). The key is read on
// the server only and never reaches a browser. `subscription.payUrl` is Gully Pay's public pay link for the customer.
//
// apiUrl is gullyPayConfig().apiUrl (GULLYPAY_API_URL, default https://gullypay.xyz/api), so tests point it at a stub.

export const CHAIN_PLAN = 'gully-chain-testnet'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIMEOUT_MS = 8_000

let fetchImpl = (...a) => fetch(...a)
/** Tests: the fetch used for Gully Pay subscription calls. */
export const setChainSubscriptionFetchForTest = (f) => (fetchImpl = f ?? ((...a) => fetch(...a)))

/** Subscriptions can be created: the chain store's id and its API key are set. */
export const subscriptionsReady = (cfg) => UUID.test(String(cfg?.storeId ?? '')) && String(cfg?.apiKey ?? '').length > 8

/** A pay link we can show: https, or http on localhost for the tests. */
function payLink(v) {
  if (typeof v !== 'string' || v.length > 500) return null
  try {
    const u = new URL(v)
    if (u.username || u.password) return null
    if (u.protocol === 'https:') return u.href
    return u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname) ? u.href : null
  } catch {
    return null
  }
}
const iso = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null)
const text = (v, n = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null)
export const SUB_STATUSES = ['trialing', 'active', 'past_due', 'cancelled']

/** The fields of a Gully Pay subscription object we keep. null when it is not one. */
export function readSubscription(s) {
  if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !UUID.test(s.id)) return null
  return {
    id: s.id,
    plan: text(s.plan, 64),
    status: SUB_STATUSES.includes(s.status) ? s.status : 'unknown',
    reference: text(s.reference, 200),
    payUrl: payLink(s.payUrl),
    trialEndsAt: iso(s.trialEndsAt),
    currentPeriodStart: iso(s.currentPeriodStart),
    currentPeriodEnd: iso(s.currentPeriodEnd),
    dueSince: iso(s.dueSince),
    graceEndsAt: iso(s.graceEndsAt),
    cancelledAt: iso(s.cancelledAt),
    cancelReason: text(s.cancelReason, 200),
    amount: Number.isInteger(s.amount) ? s.amount : null,
    currency: text(s.currency, 8),
    interval: text(s.interval, 16),
  }
}

const err = (code, message, status = null) => Object.assign(new Error(message), { code, status })

async function call(cfg, method, path, body) {
  if (!subscriptionsReady(cfg)) throw err('not-configured', 'Gully Pay subscriptions are not configured.')
  let r
  try {
    r = await fetchImpl(`${cfg.apiUrl}/v1/subscriptions/${cfg.storeId}${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}`, 'user-agent': 'gully-labs-chains/1' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    throw err('unreachable', `Gully Pay did not answer (${String(e?.name ?? 'error')}).`)
  }
  let data = null
  try {
    data = await r.json()
  } catch {
    /* not JSON */
  }
  if (!r.ok) throw err(`http-${r.status}`, `Gully Pay answered ${r.status}${typeof data?.message === 'string' ? `: ${data.message.slice(0, 160)}` : ''}.`, r.status)
  const sub = readSubscription(data?.subscription)
  if (!sub) throw err('bad-answer', 'Gully Pay answered without a subscription.')
  return { subscription: sub, created: data?.created === true }
}

/** Creates (or, for a reference already used on this store, returns) the plan subscription. Throws { code, message }. */
export const createPlanSubscription = (cfg, { reference, customerEmail, metadata }) => call(cfg, 'POST', '', { plan: CHAIN_PLAN, reference, ...(customerEmail ? { customerEmail } : {}), ...(metadata ? { metadata } : {}) })

/** Cancels it now. Gully Pay answers 200 for one already cancelled. Throws { code, message }. */
export const cancelPlanSubscription = (cfg, id, reason) => call(cfg, 'POST', `/${encodeURIComponent(id)}/cancel`, reason ? { reason: String(reason).slice(0, 200) } : {})
