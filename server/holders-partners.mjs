// Holder Map for launchpads and partners: a pre-build trigger in, a signed risk flag out, and the badge.
//
// INBOUND  POST /api/partners/launch   Authorization: Bearer gl_live_…  (a Gully Labs API key; its wallet is the workspace)
//   { chain, token, txHash? }   or the envelope { type: 'launch.created', data: { chain, token, txHash? } }
//   - the token must exist on the chain (EVM: contract code at the address; Solana: the mint account), else 404
//   - per key: 30 launch.created a minute and 1,000 a day (429 + Retry-After), on top of the key's plan limit
//   - the same token is queued once per workspace per 24 h (answer 200 { duplicate: true } with the first job)
//   - answer 202 { id, state: 'queued', chain, token }; the Holder Map is then built read-only through the
//     exported builder (holders.mjs readHolderMap, tier 'free', no IP budget: our own limits apply instead)
//
// OUTBOUND  launch.flagged   (only when the pre-built map shows risk signals; a clean map sends nothing)
//   Registered per workspace: POST /api/developer/partners/webhook { url, deployerPct? } -> { endpoint, secret (whsec_…, shown once) }
//   Body: { id: 'evt_…', type: 'launch.flagged', createdAt, data: { chain, token: { address, symbol, name }, txHash,
//           health: { score, level } | null, signals: [{ id, severity, fact, value, source }], page, builtAt } }
//   Signals are facts read from the map's own launch forensics, each with its source; nothing here depends on the
//   workspace's plan, key or any payment, and nobody can buy a different result.
//     bundled          2 or more wallets bought in the first block of trading and hold >= 5% together
//     snipers          3 or more wallets bought in the first blocks of trading
//     deployer-share   the deployer holds >= the threshold (default 10%, 1..50 per workspace)
//     deployer-selling the deployer sold to the pool in the latest transfers the map read
//
// Signing, retries and verification are Gully Pay's (pay-webhooks.mjs / alerts.mjs postWebhook), so a partner
// verifies both the same way:
//   X-Gully-Timestamp: <unix seconds>
//   X-Gully-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
// URL rules are alerts.mjs's guard: https only, no credentials, public addresses only, pinned, 5 s, no redirects.
// Delivery: first attempt at once; a failure is retried after 1, 5, 10, 20 and 30 minutes (six attempts), then
// marked failed. The event id stays the same across retries. webhook.test is never retried.
//
// Log: GET /api/developer/partners/deliveries (per workspace). Storage: DATA_DIR/holders-partners.json.
//
// BADGE  GET /api/holders/:chain/:token/badge.svg: a small kit pill from CACHED map data only. It never builds;
// an unknown, unmapped or not-yet-cached token gets the neutral "HOLDER MAP" pill, never a made-up score.
//
// Integrator hook (holders.mjs): none is required, the builder is the existing export readHolderMap. Optional:
// call notifyMapBuilt(map) after a map is cached so a map built by someone else also flags registered launches.
//
// Env (tests): GULLY_PARTNER_WEBHOOK_DELAYS_MS (five delays, ms), GULLY_PARTNER_TICK_MS (queue timer; 0 = off)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkWebhookForm, postWebhook, resolvePublic } from './alerts.mjs'
import { bearer, DATA_DIR, json, readJson } from './http.mjs'
import { apiAccess } from './access.mjs'
import crypto from 'node:crypto'
import { findKey, randomToken } from './store.mjs'
import { HOLDER_MAP, planOf } from './plans.mjs'
import { recordEvent } from './activity.mjs'
import { holderMapsPrimary, holderPageUrl } from './hosts.mjs'

const FILE = path.join(DATA_DIR, 'holders-partners.json')
const SITE = (process.env.GULLY_SITE_URL ?? 'https://gullylabs.xyz').replace(/\/+$/, '')
/** A token's Holder Map page: holdermaps.xyz once it is primary (hosts.mjs), else this site's /holders page. */
const holderPage = (chain, token) => (holderMapsPrimary() ? holderPageUrl(chain, token) : `${SITE}/holders/${chain}/${token}`)
const USER_AGENT = 'GullyLabs-HolderMap/1 (+https://docs.gullylabs.xyz/holder-map)'
export const MAX_ATTEMPTS = 6
const DEFAULT_DELAYS = [60_000, 5 * 60_000, 10 * 60_000, 20 * 60_000, 30 * 60_000]
export const PER_KEY_PER_MIN = 30
export const PER_KEY_PER_DAY = 1_000
const DEDUPE_MS = 24 * 3_600_000
const KEEP_DELIVERIES = 500
const KEEP_LAUNCHES = 1_000
const MAX_QUEUED_PER_WS = 100
const BUILD_RETRIES = 5
const BUILD_RETRY_MS = 30_000
export const THRESHOLDS = { bundledPct: 5, bundledWallets: 2, snipers: 3, deployerPct: 10 }

function delays() {
  const env = String(process.env.GULLY_PARTNER_WEBHOOK_DELAYS_MS ?? '').trim()
  const list = env ? env.split(',').map(Number).filter((n) => Number.isFinite(n) && n >= 0) : []
  return list.length === MAX_ATTEMPTS - 1 ? list : DEFAULT_DELAYS
}

let db
try {
  db = JSON.parse(fs.readFileSync(FILE, 'utf8'))
} catch {
  db = {}
}
db.webhooks ??= {} // workspace -> { url, secret, deployerPct, createdAt, rotatedAt }
db.launches ??= [] // { id, ws, keyId, chain, token, txHash, state, tries, nextAt, createdAt, finishedAt, result }
db.embed ??= {} // workspace -> { salt, createdAt, rotatedAt }
db.embedSecret ??= crypto.randomBytes(32).toString('hex') // signs embed keys (HOLDER_EMBED_SECRET overrides)
db.deliveries ??= [] // { id, ws, eventId, type, test, launchId, url, body, state, attempts, nextAt, createdAt, finishedAt }

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(db))
    fs.renameSync(FILE + '.tmp', FILE)
  } catch (e) {
    console.error('holders partners save:', e?.message ?? e)
  }
}

const lower = (a) => String(a ?? '').toLowerCase()
const keyOfToken = (chain, token) => `${chain}:${chain === 'solana' ? token : lower(token)}`

/* ----------------------------------------------------------- upstream hooks --- */

let builder = null
let existsFn = null
/** Test hook: replaces the map builder ((chainKey, token) -> map) and/or the on-chain existence check ((chainKey, token) -> true|false|null). */
export function setPartnerHooksForTest({ build, exists } = {}) {
  builder = build ?? null
  existsFn = exists ?? null
}

async function buildMap(chain, token) {
  if (builder) return builder(chain, token)
  const { readHolderMap } = await import('./holders.mjs')
  return readHolderMap(chain, token, { ip: null, tier: 'free' })
}

/** true = exists, false = does not, null = could not be checked right now. */
async function tokenExists(chain, token) {
  if (existsFn) return existsFn(chain, token)
  try {
    if (chain === 'solana') {
      const { solanaRpc } = await import('./solana.mjs')
      const r = await solanaRpc('getAccountInfo', [token, { encoding: 'base64' }])
      return !!r?.value
    }
    const { readCode } = await import('./holders.mjs')
    const m = await readCode(chain, [lower(token)])
    return m.has(lower(token)) ? m.get(lower(token)) : null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ signals --- */

/** The risk signals of a built map. Pure; a map with no launch forensics has none. */
export function signalsOf(map, { deployerPct = THRESHOLDS.deployerPct } = {}) {
  if (map?.state !== 'ok' || !map.forensics) return []
  const f = map.forensics
  const page = holderPage(map.chain.key, map.token.address)
  const source = { name: 'Gully Labs Holder Map', url: page, data: 'DeepCore launch history and token transfers' }
  const out = []
  const pct = (n) => (n === null || n === undefined ? '?' : `${Number(n).toFixed(n >= 10 ? 0 : 1)}%`)
  if (f.bundled?.wallets >= THRESHOLDS.bundledWallets && f.bundled.pct >= THRESHOLDS.bundledPct) {
    out.push({ id: 'bundled', severity: 'high', fact: `${f.bundled.wallets} wallets bought together in the first block of trading and hold ${pct(f.bundled.pct)} now.`, value: { wallets: f.bundled.wallets, pct: f.bundled.pct }, source })
  }
  if (f.snipers?.wallets >= THRESHOLDS.snipers) {
    out.push({ id: 'snipers', severity: 'medium', fact: `${f.snipers.wallets} wallets bought in the first ${f.snipers.blocks} blocks of trading and hold ${pct(f.snipers.pct)} now.`, value: { wallets: f.snipers.wallets, pct: f.snipers.pct, blocks: f.snipers.blocks }, source })
  }
  if (typeof f.deployerPct === 'number' && f.deployerPct >= deployerPct) {
    out.push({ id: 'deployer-share', severity: f.deployerPct >= 20 ? 'high' : 'medium', fact: `The deployer holds ${pct(f.deployerPct)} of the supply (threshold ${deployerPct}%).`, value: { pct: f.deployerPct, threshold: deployerPct }, source })
  }
  const dep = f.deployer ? lower(f.deployer) : null
  const sells = dep ? (map.recentFlows ?? []).filter((x) => x.side === 'sell' && lower(x.from) === dep) : []
  if (sells.length) {
    const total = sells.reduce((s, x) => s + (Number(x.pct) || 0), 0)
    out.push({ id: 'deployer-selling', severity: 'high', fact: `The deployer sold to the pool ${sells.length === 1 ? 'once' : `${sells.length} times`} in the latest transfers read (${pct(Math.round(total * 100) / 100)} of supply).`, value: { sells: sells.length, pct: Math.round(total * 100) / 100, txs: sells.map((x) => x.tx).filter(Boolean).slice(0, 5) }, source })
  }
  return out
}

/* ----------------------------------------------------------------- webhooks --- */

export const newSecret = () => `whsec_${randomToken(24)}`
export const endpointView = (w) => (w ? { url: w.url, deployerPct: w.deployerPct, createdAt: w.createdAt, rotatedAt: w.rotatedAt ?? null } : null)

/** Sets (url) or clears (null) a workspace's endpoint. The secret is returned once. */
export async function setWebhook(ws, raw, { deployerPct } = {}) {
  if (raw === null || raw === '') {
    delete db.webhooks[ws]
    save()
    return { ok: true, endpoint: null, secret: null }
  }
  const form = checkWebhookForm(raw)
  if (!form.ok) return { ok: false, status: 400, error: form.error }
  const target = await resolvePublic(form.url)
  if (!target.ok) return { ok: false, status: 400, error: target.error }
  let dp = THRESHOLDS.deployerPct
  if (deployerPct !== undefined && deployerPct !== null) {
    dp = Number(deployerPct)
    if (!Number.isFinite(dp) || dp < 1 || dp > 50) return { ok: false, status: 400, error: 'deployerPct must be a number from 1 to 50.' }
  }
  db.webhooks[ws] = { url: form.url.toString(), secret: newSecret(), deployerPct: dp, createdAt: new Date().toISOString(), rotatedAt: null }
  save()
  return { ok: true, endpoint: endpointView(db.webhooks[ws]), secret: db.webhooks[ws].secret }
}

export function rotateWebhookSecret(ws) {
  const w = db.webhooks[ws]
  if (!w) return { ok: false, status: 409, error: 'No webhook is registered for this workspace.' }
  w.secret = newSecret()
  w.rotatedAt = new Date().toISOString()
  save()
  return { ok: true, endpoint: endpointView(w), secret: w.secret }
}

/* ----------------------------------------------------------------- delivery --- */

const inFlight = new Set()

function prune() {
  if (db.deliveries.length > KEEP_DELIVERIES) {
    const done = db.deliveries.filter((d) => d.state !== 'pending')
    const drop = new Set(done.slice(0, Math.max(0, db.deliveries.length - KEEP_DELIVERIES)).map((d) => d.id))
    db.deliveries = db.deliveries.filter((d) => !drop.has(d.id))
  }
  if (db.launches.length > KEEP_LAUNCHES) {
    const done = db.launches.filter((l) => l.state !== 'queued' && l.state !== 'building')
    const drop = new Set(done.slice(0, db.launches.length - KEEP_LAUNCHES).map((l) => l.id))
    db.launches = db.launches.filter((l) => !drop.has(l.id))
  }
}

function enqueueDelivery(ws, event, launchId) {
  const w = db.webhooks[ws]
  if (!w) return null
  const now = new Date().toISOString()
  const d = { id: `phd_${randomToken(9)}`, ws, eventId: event.id, type: event.type, test: false, launchId, url: w.url, body: JSON.stringify(event), state: 'pending', attempts: [], nextAt: now, createdAt: now, finishedAt: null }
  db.deliveries.push(d)
  prune()
  save()
  kickDeliveries()
  return d
}

async function attempt(d) {
  const w = db.webhooks[d.ws]
  const at = new Date().toISOString()
  const t0 = Date.now()
  const r = w ? await postWebhook(w.url, w.secret, d.body, { userAgent: USER_AGENT }) : { status: null, ok: false, error: 'the webhook was removed' }
  d.attempts.push({ at, status: r.status, ok: r.ok, error: r.error ?? null, ms: Date.now() - t0 })
  if (w) d.url = w.url
  if (r.ok) {
    d.state = 'delivered'
    d.finishedAt = new Date().toISOString()
    d.nextAt = null
  } else if (!w || d.attempts.length >= MAX_ATTEMPTS) {
    d.state = 'failed'
    d.finishedAt = new Date().toISOString()
    d.nextAt = null
  } else {
    d.nextAt = new Date(Date.now() + delays()[d.attempts.length - 1]).toISOString()
  }
}

/** Sends every delivery that is due. Exported as the test hook; the timer calls it too. */
export async function processDeliveries(now = Date.now()) {
  const due = db.deliveries.filter((d) => d.state === 'pending' && !inFlight.has(d.id) && Date.parse(d.nextAt) <= now)
  if (!due.length) return 0
  for (const d of due) inFlight.add(d.id)
  try {
    for (let i = 0; i < due.length; i += 4) await Promise.all(due.slice(i, i + 4).map(attempt))
  } finally {
    for (const d of due) inFlight.delete(d.id)
    save()
  }
  return due.length
}

let kickingD = null
function kickDeliveries() {
  if (process.env.GULLY_PARTNER_TICK_MS === '0') return
  kickingD ??= processDeliveries()
    .catch((e) => console.error('holders partners deliveries:', e?.message ?? e))
    .finally(() => (kickingD = null))
}

/** Sends a webhook.test to the workspace's endpoint now (no retries) and logs it. */
export async function sendTest(ws) {
  const w = db.webhooks[ws]
  if (!w) return { ok: false, status: 409, error: 'No webhook is registered for this workspace.' }
  const event = { id: `evt_${randomToken(12)}`, type: 'webhook.test', createdAt: new Date().toISOString(), data: { message: 'A test event from the Gully Labs Holder Map. If you can read this and the signature checks out, the endpoint is ready.' } }
  const d = { id: `phd_${randomToken(9)}`, ws, eventId: event.id, type: event.type, test: true, launchId: null, url: w.url, body: JSON.stringify(event), state: 'pending', attempts: [], nextAt: null, createdAt: event.createdAt, finishedAt: null }
  db.deliveries.push(d)
  inFlight.add(d.id)
  try {
    const t0 = Date.now()
    const r = await postWebhook(w.url, w.secret, d.body, { userAgent: USER_AGENT })
    d.attempts.push({ at: event.createdAt, status: r.status, ok: r.ok, error: r.error ?? null, ms: Date.now() - t0 })
    d.state = r.ok ? 'delivered' : 'failed'
    d.finishedAt = new Date().toISOString()
  } finally {
    inFlight.delete(d.id)
    prune()
    save()
  }
  return { ok: true, delivery: deliveryView(d) }
}

export function deliveryView(d) {
  return { id: d.id, eventId: d.eventId, type: d.type, test: d.test, launchId: d.launchId, url: d.url, state: d.state, attempts: d.attempts.length, maxAttempts: d.test ? 1 : MAX_ATTEMPTS, last: d.attempts.at(-1) ?? null, nextAt: d.nextAt, createdAt: d.createdAt, finishedAt: d.finishedAt }
}

export const deliveriesOf = (ws, limit = 50) => db.deliveries.filter((d) => d.ws === ws).slice(-limit).reverse().map(deliveryView)

const launchView = (l) => ({ id: l.id, chain: l.chain, token: l.token, txHash: l.txHash ?? null, state: l.state, signals: l.result?.signals ?? null, health: l.result?.health ?? null, createdAt: l.createdAt, finishedAt: l.finishedAt })
export const launchesOf = (ws, limit = 20) => db.launches.filter((l) => l.ws === ws).slice(-limit).reverse().map(launchView)

/* ------------------------------------------------------------- launch jobs --- */

/** Builds the flagged event for a launch job from a built map, or null when the map has no signals. */
function flaggedEvent(job, map, signals) {
  return {
    id: `evt_${randomToken(12)}`,
    type: 'launch.flagged',
    createdAt: new Date().toISOString(),
    data: {
      chain: map.chain.key,
      token: { address: map.token.address, symbol: map.token.symbol ?? null, name: map.token.name ?? null },
      txHash: job.txHash ?? null,
      health: map.health && map.health.score !== null ? { score: map.health.score, level: map.health.level } : null,
      signals,
      page: holderPage(map.chain.key, map.token.address),
      builtAt: map.asOf ?? null,
    },
  }
}

/** Evaluates one job against a built map: records the result and queues launch.flagged when there are signals. */
function finishJob(job, map) {
  const ws = db.webhooks[job.ws]
  const signals = signalsOf(map, { deployerPct: ws?.deployerPct })
  const health = map.health && map.health.score !== null ? { score: map.health.score, level: map.health.level } : null
  job.result = { signals, health, builtAt: map.asOf ?? null }
  job.state = signals.length ? 'flagged' : 'clean'
  job.finishedAt = new Date().toISOString()
  job.nextAt = null
  if (signals.length && ws) enqueueDelivery(job.ws, flaggedEvent(job, map, signals), job.id)
}

const working = new Set()

async function runJob(job) {
  job.state = 'building'
  job.tries = (job.tries ?? 0) + 1
  let map
  try {
    map = await buildMap(job.chain, job.token)
  } catch (e) {
    map = { state: 'error', reason: String(e?.message ?? e) }
  }
  if (map?.state === 'ok') return finishJob(job, map)
  if ((map?.state === 'busy' || map?.state === 'error') && job.tries < BUILD_RETRIES) {
    job.state = 'queued'
    job.nextAt = new Date(Date.now() + BUILD_RETRY_MS).toISOString()
    return
  }
  job.state = map?.state === 'unavailable' || map?.state === 'not-found' ? 'unmapped' : 'failed'
  job.result = { signals: [], health: null, reason: map?.reason ?? null }
  job.finishedAt = new Date().toISOString()
  job.nextAt = null
}

/** Runs queued launch jobs that are due, two at a time. Test hook and timer body. */
export async function processLaunches(now = Date.now()) {
  const due = db.launches.filter((l) => l.state === 'queued' && !working.has(l.id) && Date.parse(l.nextAt) <= now)
  if (!due.length) return 0
  for (const j of due) working.add(j.id)
  try {
    for (let i = 0; i < due.length; i += 2) await Promise.all(due.slice(i, i + 2).map(runJob))
  } finally {
    for (const j of due) working.delete(j.id)
    prune()
    save()
  }
  return due.length
}

let kickingL = null
function kickLaunches() {
  if (process.env.GULLY_PARTNER_TICK_MS === '0') return
  kickingL ??= processLaunches()
    .catch((e) => console.error('holders partners launches:', e?.message ?? e))
    .finally(() => (kickingL = null))
}

/**
 * Optional hook for holders.mjs: a map was just cached by any path. Registered launches of that token that are
 * still queued are evaluated against it at once (no extra build).
 */
export function notifyMapBuilt(map) {
  if (map?.state !== 'ok' || !map.chain?.key || !map.token?.address) return 0
  const k = keyOfToken(map.chain.key, map.token.address)
  let n = 0
  for (const j of db.launches) {
    if ((j.state === 'queued') && !working.has(j.id) && keyOfToken(j.chain, j.token) === k) {
      finishJob(j, map)
      n++
    }
  }
  if (n) save()
  return n
}

const tickMs = Number(process.env.GULLY_PARTNER_TICK_MS ?? 5_000)
if (tickMs > 0) {
  setInterval(() => {
    kickLaunches()
    kickDeliveries()
  }, tickMs).unref?.()
  setTimeout(() => {
    kickLaunches()
    kickDeliveries()
  }, 3_000).unref?.()
}

/* ------------------------------------------------------------ rate limiting --- */

const keyHits = new Map() // keyId -> { minute: number[], day: number[] }
function keyAllowed(keyId, now = Date.now()) {
  const h = keyHits.get(keyId) ?? { minute: [], day: [] }
  h.minute = h.minute.filter((t) => now - t < 60_000)
  h.day = h.day.filter((t) => now - t < 86_400_000)
  keyHits.set(keyId, h)
  if (h.minute.length >= PER_KEY_PER_MIN) return { ok: false, retryAfter: Math.max(1, Math.ceil((60_000 - (now - h.minute[0])) / 1000)), scope: 'minute' }
  if (h.day.length >= PER_KEY_PER_DAY) return { ok: false, retryAfter: Math.max(1, Math.ceil((86_400_000 - (now - h.day[0])) / 1000)), scope: 'day' }
  h.minute.push(now)
  h.day.push(now)
  if (keyHits.size > 5_000) keyHits.clear()
  return { ok: true }
}

/* ------------------------------------------------------------- inbound route --- */

const EVM_TX = /^0x[0-9a-fA-F]{64}$/
const SOL_SIG = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/

/** POST /api/partners/launch. Returns true when answered. */
export async function handlePartnerLaunch(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }, { Allow: 'POST' }), true
  if (!bearer(req)) return json(res, 401, { error: 'Send your Gully Labs API key as Authorization: Bearer gl_live_…' }), true
  const access = apiAccess(req)
  if (!access.ok) return json(res, access.status, { error: access.error }, access.retryAfter ? { 'Retry-After': String(access.retryAfter) } : {}), true
  const key = findKey(bearer(req))
  if (!key?.owner) return json(res, 403, { error: 'This key is not tied to a workspace. Create a key in the dashboard at https://app.gullylabs.xyz.' }), true
  const lim = keyAllowed(key.id)
  if (!lim.ok) return json(res, 429, { error: `Rate limit reached for launch.created on this key (${lim.scope === 'minute' ? `${PER_KEY_PER_MIN} a minute` : `${PER_KEY_PER_DAY} a day`}).` }, { 'Retry-After': String(lim.retryAfter) }), true
  const raw = await readJson(req, 4_000)
  const body = raw?.data && typeof raw.data === 'object' ? raw.data : raw
  if (!body || typeof body !== 'object') return json(res, 400, { error: 'Send JSON: { "chain", "token", "txHash"? }.' }), true
  if (raw?.type && raw.type !== 'launch.created') return json(res, 400, { error: 'Only launch.created is accepted here.' }), true
  const { chainKeyOf, HOLDER_CHAINS } = await import('./holders.mjs')
  const chain = chainKeyOf(body.chain)
  if (!chain) return json(res, 400, { error: `Unknown chain. The Holder Map runs on ${Object.keys(HOLDER_CHAINS).join(', ')}.` }), true
  const token = String(body.token ?? '').trim()
  if (chain === 'solana' ? !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token) : !/^0x[0-9a-fA-F]{40}$/.test(token)) return json(res, 400, { error: 'token must be the token contract address (a mint on Solana).' }), true
  const txHash = body.txHash === undefined || body.txHash === null ? null : String(body.txHash).trim()
  if (txHash !== null && !(chain === 'solana' ? SOL_SIG.test(txHash) : EVM_TX.test(txHash))) return json(res, 400, { error: 'txHash is not a valid transaction hash for this chain.' }), true
  const ws = key.owner
  const k = keyOfToken(chain, token)
  const dup = db.launches.find((l) => l.ws === ws && keyOfToken(l.chain, l.token) === k && Date.now() - Date.parse(l.createdAt) < DEDUPE_MS)
  if (dup) return json(res, 200, { ok: true, duplicate: true, ...launchView(dup) }), true
  if (db.launches.filter((l) => l.ws === ws && (l.state === 'queued' || l.state === 'building')).length >= MAX_QUEUED_PER_WS) return json(res, 429, { error: 'Too many launches are waiting to be mapped for this workspace. Try again in a few minutes.' }, { 'Retry-After': '60' }), true
  const exists = await tokenExists(chain, chain === 'solana' ? token : lower(token))
  if (exists === null) return json(res, 503, { error: `${HOLDER_CHAINS[chain].name} could not be read just now to check the token. Try again shortly.` }, { 'Retry-After': '30' }), true
  if (!exists) return json(res, 404, { error: `No token contract found at that address on ${HOLDER_CHAINS[chain].name}.` }), true
  const now = new Date().toISOString()
  const job = { id: `pl_${randomToken(9)}`, ws, keyId: key.id, chain, token: chain === 'solana' ? token : lower(token), txHash, state: 'queued', tries: 0, nextAt: now, createdAt: now, finishedAt: null, result: null }
  db.launches.push(job)
  prune()
  save()
  try {
    recordEvent(ws, { actor: key.owner, action: 'holders.launch.queued', target: job.token, detail: chain })
  } catch {
    /* best effort */
  }
  kickLaunches()
  return json(res, 202, { ok: true, duplicate: false, ...launchView(job) }), true
}

/* ----------------------------------------------------- workspace (signed-in) --- */

/** /api/developer/partners*, with the session context from developer.mjs. Returns true when answered. */
export async function handlePartnerRoutes(req, res, url, ctx) {
  const p = url.pathname
  const post = req.method === 'POST'
  const { workspace: ws } = ctx
  const ev = (action, detail = null) => {
    try {
      recordEvent(ws, { actor: ctx.user, action, target: null, detail })
    } catch {
      /* best effort */
    }
  }
  if (p === '/api/developer/partners' && !post) {
    return json(res, 200, { webhook: endpointView(db.webhooks[ws]), thresholds: THRESHOLDS, rate: { perKeyPerMin: PER_KEY_PER_MIN, perKeyPerDay: PER_KEY_PER_DAY }, launches: launchesOf(ws), deliveries: deliveriesOf(ws, 10) }), true
  }
  if (p === '/api/developer/partners/deliveries' && !post) return json(res, 200, { deliveries: deliveriesOf(ws, Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50))) }), true
  if (p === '/api/developer/partners/embed-key') {
    const allowed = embedAllowed(ws)
    return json(res, 200, { embedKey: embedKeyOf(ws), whiteLabel: allowed, plan: planOf(ws).id, note: allowed ? 'Your plan hides the Gully Labs mark on embeds that carry this key.' : 'The key works as a normal embed; the white-label option needs a plan that includes it.' }), true
  }
  if (p === '/api/developer/partners/embed-key/rotate' && post) {
    ev('holders.embedkey.rotated')
    return json(res, 200, { embedKey: embedKeyOf(ws, { rotate: true }), whiteLabel: embedAllowed(ws), plan: planOf(ws).id }), true
  }
  if (!post) return json(res, 404, { error: 'not found' }), true
  if (p === '/api/developer/partners/webhook') {
    const body = await readJson(req, 2_000)
    if (!body || !('url' in body)) return json(res, 400, { error: 'Send { "url": "https://…" } (or null to remove it).' }), true
    const r = await setWebhook(ws, body.url, { deployerPct: body.deployerPct })
    if (!r.ok) return json(res, r.status, { error: r.error }), true
    ev(r.endpoint ? 'holders.webhook.set' : 'holders.webhook.removed')
    return json(res, 200, { endpoint: r.endpoint, secret: r.secret }), true
  }
  if (p === '/api/developer/partners/webhook/rotate') {
    const r = rotateWebhookSecret(ws)
    if (!r.ok) return json(res, r.status, { error: r.error }), true
    ev('holders.webhook.rotated')
    return json(res, 200, { endpoint: r.endpoint, secret: r.secret }), true
  }
  if (p === '/api/developer/partners/test') {
    const r = await sendTest(ws)
    if (!r.ok) return json(res, r.status, { error: r.error }), true
    return json(res, 200, { delivery: r.delivery }), true
  }
  return json(res, 404, { error: 'not found' }), true
}

/* ------------------------------------------------------------ white-label embed --- */

// A signed EMBED KEY lets a workspace's embedded Holder Map (widget.js data-embed-key, or ?key= on /embed/holders)
// show no Gully Labs mark and take a theme, when the workspace's plan has HOLDER_MAP whiteLabel (plans.mjs).
//   Key:   gle_<workspace>.<HMAC-SHA256 of workspace+salt, 24 hex>. It is public by design (it sits in page source)
//          and unlocks only this one cosmetic option, never the API; the real API key is never put in a page.
//   Mint:  GET/POST /api/developer/partners/embed-key (the workspace session), POST .../embed-key/rotate.
//   Check: GET /api/holders/embed-config?key=…&theme=light|dark&accent=%23c9a24a, public, no-store. The EMBED PAGE
//          asks this on every load; the plan is read live, so a downgrade or a rotated key ends the white label at
//          once. The answer is { whiteLabel: boolean, theme: { mode, accent } | null }. No client-side flag is read.
const ACCENT_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const embedSecret = () => process.env.HOLDER_EMBED_SECRET || db.embedSecret
const embedSig = (ws, salt) => crypto.createHmac('sha256', embedSecret()).update(`holder-embed:${lower(ws)}:${salt}`).digest('hex').slice(0, 24)
export const embedAllowed = (ws) => HOLDER_MAP.tiers[planOf(ws).id]?.whiteLabel === true

function embedKeyOf(ws, { rotate = false } = {}) {
  let e = db.embed[ws]
  if (!e || rotate) {
    e = db.embed[ws] = { salt: randomToken(6), createdAt: e?.createdAt ?? new Date().toISOString(), rotatedAt: e ? new Date().toISOString() : null }
    save()
  }
  return `gle_${lower(ws)}.${embedSig(ws, e.salt)}`
}

/** Sanitises a requested theme: mode light|dark (default dark), accent only as #rgb or #rrggbb (else null). */
export function safeTheme(mode, accent) {
  return { mode: mode === 'light' ? 'light' : 'dark', accent: typeof accent === 'string' && ACCENT_RE.test(accent) ? accent.toLowerCase() : null }
}

/** What an embed with this key may show: { whiteLabel, theme }. Anything wrong with the key gives the normal embed. */
export function embedConfig({ key, theme, accent } = {}) {
  const none = { whiteLabel: false, theme: null }
  const m = typeof key === 'string' ? key.match(/^gle_(0x[0-9a-f]{40})\.([0-9a-f]{24})$/) : null
  if (!m) return none
  const e = db.embed[m[1]]
  if (!e) return none
  const want = Buffer.from(embedSig(m[1], e.salt))
  const got = Buffer.from(m[2])
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return none
  if (!embedAllowed(m[1])) return none
  return { whiteLabel: true, theme: safeTheme(theme, accent) }
}

/* -------------------------------------------------------------------- badge --- */

let markDataUri = null
function mark() {
  if (markDataUri !== null) return markDataUri
  try {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'brand', 'kit', 'mark-64.png')
    markDataUri = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`
  } catch {
    markDataUri = ''
  }
  return markDataUri
}
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** What the badge says for a cached map (or none): { text, tone: 'gold' | 'red' | 'neutral', title }. Pure. */
export function badgeFacts(map) {
  if (map?.state !== 'ok') return { text: null, tone: 'neutral', title: 'Holder Map: no cached map for this token yet' }
  const score = map.health?.score ?? null
  if (typeof score === 'number') return { text: `Health ${score}`, tone: score >= 50 ? 'gold' : 'red', title: `Holder Map launch health ${score} out of 100: ${map.health.verdict}` }
  const b = map.forensics?.bundled?.wallets ?? 0
  if (b >= 2) return { text: `${b} bundled`, tone: 'red', title: `Holder Map: ${b} wallets bought together in the first block of trading` }
  return { text: null, tone: 'neutral', title: 'Holder Map: map available, no launch health for this token' }
}

/** The pill: kit mark, "HOLDER MAP" and the value segment. 24 px high; width follows the text. */
export function badgeSvg(map, href) {
  const f = badgeFacts(map)
  const label = 'HOLDER MAP'
  const labelW = 6 + 16 + 6 + Math.round(label.length * 7.4) + 8
  const valW = f.text ? Math.round(f.text.length * 6.9) + 16 : 0
  const w = labelW + valW
  const col = f.tone === 'red' ? '#E5574B' : '#D9B563'
  const m = mark()
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="24" viewBox="0 0 ${w} 24" role="img" aria-label="${xmlEsc(f.title)}">
<title>${xmlEsc(f.title)}</title>
<a xlink:href="${xmlEsc(href)}" href="${xmlEsc(href)}" target="_blank" rel="noopener noreferrer">
<rect x=".5" y=".5" width="${w - 1}" height="23" rx="12" fill="#0D141C" stroke="#2A3542"/>
${m ? `<image x="6" y="4" width="16" height="16" href="${m}" xlink:href="${m}"/>` : ''}
<text x="28" y="16" fill="#F4F2EC" font-family="'Barlow Condensed','Arial Narrow',Arial,sans-serif" font-weight="700" font-size="12" letter-spacing=".6">${label}</text>
${f.text ? `<rect x="${labelW}" y="3" width="${valW - 4}" height="18" rx="9" fill="#151D28" stroke="${col}" stroke-opacity=".5"/>
<text x="${labelW + (valW - 4) / 2}" y="16" text-anchor="middle" fill="${col}" font-family="'IBM Plex Mono','JetBrains Mono',Menlo,monospace" font-weight="700" font-size="11">${xmlEsc(f.text)}</text>` : ''}
</a>
</svg>`
}

const BADGE_HEADERS = { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff' }

/**
 * The data behind the badge, from CACHED map data only (never builds): { state: 'ok', health, flags, ... } or
 * { state: 'unknown' }. `health` is { score, level } or null; `flags` counts facts (bundled wallets, snipers, signals).
 */
export async function holderBadgeData(chainIn, token) {
  try {
    const { chainKeyOf, peekHolderMap } = await import('./holders.mjs')
    const chain = chainKeyOf(chainIn)
    const valid = chain && (chain === 'solana' ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token) : /^0x[0-9a-fA-F]{40}$/.test(token))
    if (!valid) return { state: 'unknown' }
    const map = peekHolderMap(chain, token)
    if (map?.state !== 'ok') return { state: 'unknown', chain, token, page: holderPage(chain, token) }
    const f = map.forensics
    return {
      state: 'ok',
      chain,
      token,
      page: holderPage(chain, token),
      symbol: map.token?.symbol ?? null,
      health: typeof map.health?.score === 'number' ? { score: map.health.score, level: map.health.level } : null,
      flags: f ? { bundledWallets: f.bundled?.wallets ?? 0, snipers: f.snipers?.wallets ?? 0, signals: signalsOf(map).map((x) => x.id) } : null,
      _map: map,
    }
  } catch {
    return { state: 'unknown' }
  }
}

/** The shared renderer (badges.mjs, another owner) when it exists, else this module's own SVG. */
async function render(data) {
  try {
    const mod = await import('./badges.mjs')
    if (typeof mod.renderBadge === 'function') {
      const { _map, ...pub } = data
      const out = await mod.renderBadge({ kind: 'holder-map', ...pub, href: data.page })
      const svg = typeof out === 'string' ? out : out?.svg
      if (typeof svg === 'string' && svg.startsWith('<svg')) return svg
    }
  } catch {
    /* no shared renderer yet: use ours */
  }
  return badgeSvg(data._map ?? null, data.page ?? `${SITE}/holders`)
}

/**
 * GET /api/holders/:chain/:token/badge.svg. Cached map data only: never builds, always an image.
 * Returns true when answered, false when the path is not the badge.
 */
export async function handleHolderBadge(req, res, url) {
  const m = url.pathname.match(/^\/api\/holders\/([a-z0-9]{2,12})\/([A-Za-z0-9]{1,64})\/badge\.svg$/)
  if (!m) return false
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'GET only' }, { Allow: 'GET, HEAD' }), true
  const data = await holderBadgeData(m[1], m[2])
  const known = data.state === 'ok' && badgeFacts(data._map).text !== null
  res.writeHead(200, { ...BADGE_HEADERS, 'Cache-Control': known ? 'public, max-age=300' : 'public, max-age=60' })
  res.end(req.method === 'HEAD' ? undefined : await render(data))
  return true
}

/** Test hooks. */
export const stateForTest = () => db
export function resetPartnersForTest() {
  db.webhooks = {}
  db.launches = []
  db.deliveries = []
  keyHits.clear()
  save()
}
