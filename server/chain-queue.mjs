// Create a chain: what the Chain Kit queue (gully-ops l3/chainkit/queue, container gully-chainkit-queue on the gully
// box) says about an order, and which parts of automatic setup are switched on. chain-orders.mjs puts both on the page.
//
//   queueStatusOf(orderId)  GET <CHAINKIT_QUEUE_URL>/internal/chainkit/orders/<orderId> over the box's docker network
//                           (default http://gully-chainkit-queue:8080; the route is never reachable through Cloudflare).
//                           Answers { reachable, found, state, label, waitingOn, trial, position, nextCheckAt,
//                           teardownAt, updatedAt }; cached 20 s per order, 2.5 s timeout, never throws.
//   automationStatus()      { servers, billingNotices, renewals }: true when the server-creation keys, the Gully Pay
//                           webhook's signing key (both in the admin Integrations folder; only whether the files exist
//                           is read, never their content) and the renewal store are set. Booleans only.

import fs from 'node:fs'
import path from 'node:path'
import { integrationsDir } from './admin-integrations.mjs'
import { subscriptionsReady } from './chain-subscriptions.mjs'

const TIMEOUT_MS = 2_500
const TTL_MS = 20_000
const STATES = ['queued', 'held', 'running', 'waiting', 'failed', 'done', 'refused', 'teardown-scheduled', 'tearing-down', 'torn-down']
const WAITING_ON = ['automatic', 'gully', 'trial-slot']
const SERVER_KEYS = ['OVH_APPLICATION_KEY', 'OVH_APPLICATION_SECRET', 'OVH_CONSUMER_KEY', 'OVH_PROJECT_ID']
const NOTICE_KEY = 'GULLYPAY_CHAINKIT_WEBHOOK_SECRET'

let fetchImpl = (...a) => fetch(...a)
/** Tests: the fetch used to read the queue. */
export const setChainQueueFetchForTest = (f) => {
  fetchImpl = f ?? ((...a) => fetch(...a))
  cache.clear()
}
const cache = new Map()
const queueUrl = () => String(process.env.CHAINKIT_QUEUE_URL || 'http://gully-chainkit-queue:8080').replace(/\/+$/, '')

const iso = (v) => (typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null)
// Plain text only: the queue writes these labels for buyers; anything else (a URL, markup, a path) is dropped.
const label = (v) => (typeof v === 'string' && v.length <= 400 && !/[<>]|https?:|\/srv\/|[A-Z]{2,}_[A-Z_]{2,}/.test(v) ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() : null)

/** The queue's answer, reduced to the fields the page shows. null when it is not one. */
export function readQueueStatus(b) {
  if (!b || typeof b !== 'object') return null
  if (b.found === false) return { reachable: true, found: false }
  if (b.found !== true || !STATES.includes(b.state)) return null
  return {
    reachable: true,
    found: true,
    state: b.state,
    label: label(b.label) ?? 'In the provisioning queue.',
    waitingOn: WAITING_ON.includes(b.waitingOn) ? b.waitingOn : null,
    trial: b.trial === true,
    position: Number.isInteger(b.position) && b.position > 0 && b.position < 10_000 ? b.position : null,
    nextCheckAt: iso(b.nextCheckAt),
    teardownAt: iso(b.teardownAt),
    updatedAt: iso(b.updatedAt),
  }
}

/** Never throws. */
export async function queueStatusOf(orderId, now = Date.now()) {
  const hit = cache.get(orderId)
  if (hit && now - hit.at < TTL_MS) return hit.v
  let v
  try {
    const r = await fetchImpl(`${queueUrl()}/internal/chainkit/orders/${encodeURIComponent(orderId)}`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } })
    v = r.ok ? (readQueueStatus(await r.json()) ?? { reachable: false }) : { reachable: false }
  } catch {
    v = { reachable: false }
  }
  cache.set(orderId, { at: now, v })
  if (cache.size > 2000) cache.delete(cache.keys().next().value)
  return v
}

const present = (name) => {
  try {
    return fs.statSync(path.join(integrationsDir(), name)).size > 0
  } catch {
    return false
  }
}

/** Which parts of automatic setup are switched on. Booleans only; never a value. */
export const automationStatus = (cfg) => ({ servers: SERVER_KEYS.every(present), billingNotices: present(NOTICE_KEY), renewals: subscriptionsReady(cfg) })
