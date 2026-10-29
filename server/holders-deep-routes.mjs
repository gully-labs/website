// Holder Map "Deep check", the paid investigation of one (chain, token): sold through Gully Pay, computed by
// holders-deep.mjs. Same pattern as Gully Security's paid scans (security-routes.mjs): a free quota by plan, else
// one Gully Pay invoice per check, the check starts the moment the invoice is paid, an unpaid one is cancelled
// when its invoice expires. Payment only buys the computation: nothing a buyer does or pays changes a result.
//
// PRICES AND LIMITS live in plans.mjs (HOLDER_DEEP, field `holderDeep` of GET /api/plans):
//   $9 per token; plans with a free allowance (Pro, Business: 3 a month); 20% off with a PAID Gully Security scan.
//
// ------------------------------------------------------------------------------------------------ API --------
// All JSON. A POST needs the header `X-Requested-With: gully` (CSRF guard). Signing in (the app's SIWE session
// cookie) is optional: it unlocks the plan's free checks and the scan bundle; anyone may pay for a check.
//
//   GET  /api/holders/deep
//     -> 200 { offer: HOLDER_DEEP, checkout: { enabled }, coverage: { <chain>: Coverage }, signedIn: boolean,
//              quota: Quota | null }
//        Coverage = { chain, funding|clusters|deployer|trading: { state: 'available'|'limited'|'unavailable', reason } }
//        Quota    = { plan: { id, name }, freePerMonth, used, left, resetsAt, active, maxActive }
//
//   POST /api/holders/deep   { chain, token, bundleWithScan?: { scanId: 'sec_…' }, expect?: { priceUsd } }
//     `chain`: holder-map chain key or id (robinhood, bsc, base, hyperevm, solana). `token`: address or a tracked ticker.
//     `bundleWithScan`: the id of a PAID Gully Security scan of the same contract in the signed-in workspace
//     (chains base and bsc); it takes 20% off once per scan.
//     Without `expect`: a QUOTE, nothing is stored or charged.
//       -> 200 { quote: { chain, token, priceUsd, listPriceUsd, free, bundle: { applied, discountPct, scanId } | null,
//                         bundleNote, quota: Quota | null, coverage: Coverage, budgets, checkout: { enabled } } }
//     With `expect: { priceUsd }` (the price the buyer confirmed; a number, 0 when free):
//       -> 201 { check }              a free-quota check, queued
//       -> 202 { check, payment }     an invoice to pay; the check starts once paid
//       -> 200 { check, duplicate }   the same token is already queued/running/awaiting payment for this buyer
//       -> 409 { code: 'price-changed', quote }   the price is not the confirmed one (quota used up meanwhile…)
//       -> 400 invalid input · 401/403 bundle without a sign-in or for another workspace's scan · 402 checkout off
//          (no treasury) · 422 { code: 'nothing-available' } no part can run on that chain · 429 limits
//
//   GET  /api/holders/deep/:id       -> 200 { check }, or 404. `id` is `hd_…`, unguessable, and is the shareable
//                                       report id: anyone with it may read the check and its report. Poll while
//                                       status is queued or running (progress moves).
//   POST /api/holders/deep/:id/cancel   before payment: cancels the invoice; a queued free check: drops it.
//                                       -> 200 { check } · 409 when it is paid, running or finished.
//
// REFUNDS (owner decision): a PAID check that ends 'failed' gives its buyer one credit for a free re-run (never an
// on-chain refund; they can also write to team@gullylabs.xyz). Credits are counted per buyer (the workspace, else
// the address the buyer paid from) and are spent before the price: a quote or check made with a credit is free and
// `quote.credit` / `check.credit` say so. A re-run bought with a credit that itself fails gives the credit back.
//   Quota gains `credits` (this buyer's unspent credits); GET /api/holders/deep also returns `credits`.
//   check.credit = { usedForThis: boolean, earned: boolean, contact: 'team@gullylabs.xyz' } | null
//
// Check = {
//   id, status: 'awaiting_payment' | 'queued' | 'running' | 'done' | 'partial' | 'failed' | 'cancelled',
//   chain: { key, id, name }, token, free, priceUsd, listPriceUsd, bundled: boolean,
//   payment: { invoiceId, status, usd, payUrl: '/pay/inv_…', expiresAt } | null,
//   progress: { pct, message } | null, createdAt, startedAt, completedAt, cancelReason, error,
//   url: '/holders/deep/<id>'  (the page that will show the report; the UI owns it),
//   report: Report | null      (finished checks only: done, partial, failed)
// }
// Report = {
//   version: 1, chain, token: { address, symbol, name, url }, generatedAt,
//   status: 'done' | 'partial' | 'failed', partial: { reasons: [{ code, text }] } | null,
//   budget: { limits: { rpcCalls, logSpans, explorerCalls, ms, holders, hops }, used: { rpcCalls, logSpans, explorerCalls, ms } },
//   base: { mapState, kind, note, sources?, holders? },
//   sections: {
//     trading:  { state, method: 'launch-forensics' | 'inferred-from-transfers', source, confidence,
//                 launchBlock?, firstLiquidityBlock?, firstTradeBlock, window: { blocks }, pool?, snipers: { count, pctOfSupply, wallets },
//                 bundled: { count, pctOfSupply, … }, bundles?: [{ block, wallets, count }], reason? },
//     funding:  { state, reason, wallets, hopsMax, sources: [string],
//                 traces: [{ address, role: 'holder'|'deployer', rank, pctOfSupply,
//                            hops: [{ hop, from, fromLabel, to, kind: 'native'|'token', block, tx, at, source, confidence }],
//                            origin: { type: 'exchange'|'labelled'|'wallet'|'buy'|'cycle'|'unknown', address?, label?, note?, reason? } }],
//                 sharedFunders: [{ address, label, labelled, exchange, wallets, hops, confidence, note }] },
//     clusters: { state, reason, direct: { clusters }, sharedFunder: { clusters }, combined: [{ id, wallets, count,
//                 pctOfSupply, basis: 'direct-transfers'|'shared-funder'|'direct-transfers+shared-funder', confidence }] },
//     deployer: { state, reason, address, source, tokens: [{ chain, address, symbol, outcome, source, confidence }],
//                 chains: [{ chain, name, state, reason, created, tokens }], launchpad: { state, total?, graduated?, reason? } },
//   },
//   findings: [{ id, section, text, confidence: 'high'|'medium'|'low', source }],   every one has both
//   unavailable: [{ section, what, reason }],                                       what could not be read, and why
//   notes: [string],
// }
// A section's state is 'ok' | 'partial' | 'unavailable' | 'skipped'. 'partial' / 'skipped' come with the budget or
// source reason. status 'partial' always lists its reasons in `partial.reasons`.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { adminCancelInvoice, adminInvoice, createInvoiceRecord, invoicePaidHooks } from './invoices.mjs'
import { ASSET_IDS } from './payments.mjs'
import { clientIp, DATA_DIR, json, readJson } from './http.mjs'
import { HOLDER_DEEP, holderDeepPriceCents, planOf, treasury } from './plans.mjs'
import { randomToken } from './store.mjs'
import { findJob as findScanJob } from './security-store.mjs'
import { anyCoverage, coverage, liveDeps, runDeepCheck } from './holders-deep.mjs'
import { chainKeyOf, findStock, HOLDER_CHAINS } from './holders.mjs'
import { isSolanaAddress } from './solana.mjs'

const FILE = () => path.join(process.env.DATA_DIR ?? DATA_DIR, 'holders-deep.json')
const REPORTS = () => path.join(process.env.DATA_DIR ?? DATA_DIR, 'holders-deep')
const INVOICE_TTL_MS = 24 * 3_600_000
const ID_RE = /^hd_[A-Za-z0-9_-]{16}$/
const ACTIVE = ['awaiting_payment', 'queued', 'running']
const FINISHED = ['done', 'partial', 'failed']
const MAX_ATTEMPTS = 3
/** Holder chain key -> Gully Security scan chain key (a bundle needs a scan of the same contract on the same chain). */
const SCAN_CHAIN = { base: 'base', bsc: 'bnb' }
const USER_ROLES = ['owner', 'admin', 'developer']

/* ------------------------------------------------------------------ store --- */

let db = null
function load() {
  if (db) return db
  try {
    db = JSON.parse(fs.readFileSync(FILE(), 'utf8'))
  } catch {
    db = null
  }
  if (!db || typeof db !== 'object' || Array.isArray(db)) db = {}
  db.jobs = Array.isArray(db.jobs) ? db.jobs : []
  if (!db.credits || typeof db.credits !== 'object' || Array.isArray(db.credits)) db.credits = {}
  // A restart interrupts a running check: it runs again (the invoice is paid, the computation is the product).
  for (const j of db.jobs) if (j.state === 'running') Object.assign(j, { state: 'queued', status: 'queued' })
  return db
}
const jobs = () => load().jobs
function save() {
  try {
    fs.mkdirSync(path.dirname(FILE()), { recursive: true })
    fs.writeFileSync(FILE() + '.tmp', JSON.stringify(load()))
    fs.renameSync(FILE() + '.tmp', FILE())
  } catch (e) {
    console.error('holders-deep store: save failed:', e?.message ?? e)
  }
}
const reportFile = (id) => path.join(REPORTS(), `${id}.json`)
function writeReport(id, report) {
  fs.mkdirSync(REPORTS(), { recursive: true })
  fs.writeFileSync(reportFile(id) + '.tmp', JSON.stringify(report))
  fs.renameSync(reportFile(id) + '.tmp', reportFile(id))
}
function readReport(id) {
  try {
    return JSON.parse(fs.readFileSync(reportFile(id), 'utf8'))
  } catch {
    return null
  }
}
const findJob = (id) => (ID_RE.test(String(id ?? '')) ? (jobs().find((j) => j.id === id) ?? null) : null)

/** Test hook: forget the in-memory store so the next call re-reads DATA_DIR. */
export function resetDeepForTest() {
  db = null
  hits.clear()
  running.clear()
}

/* ------------------------------------------------------------ rate limits --- */

const hits = new Map()
function allow(bucket, who, max, ms) {
  const k = `${bucket}:${who}`
  const now = Date.now()
  const list = (hits.get(k) ?? []).filter((t) => now - t < ms)
  if (list.length >= max) return hits.set(k, list), false
  list.push(now)
  hits.set(k, list)
  return true
}
setInterval(() => {
  const now = Date.now()
  for (const [k, list] of hits) if (!list.some((t) => now - t < 86_400_000)) hits.delete(k)
}, 600_000).unref?.()

/* ----------------------------------------------------------- the engine hook --- */

let engine = { run: runDeepCheck, deps: null, limits: HOLDER_DEEP.budgets }
/** Test hook: the upstreams and budgets the engine runs with (null: the live ones). */
export function setDeepEngineForTest({ deps = null, limits = HOLDER_DEEP.budgets, run = runDeepCheck } = {}) {
  engine = { run, deps, limits }
}
const depsNow = () => engine.deps ?? liveDeps()

/* --------------------------------------------------------------- credits --- */

const CONTACT = 'team@gullylabs.xyz'
/** Free re-runs a buyer holds after paid checks failed. */
export const creditsOf = (owner) => Math.max(0, Number(load().credits[owner]) || 0)
function addCredit(owner, n) {
  const next = creditsOf(owner) + n
  if (next > 0) load().credits[owner] = next
  else delete load().credits[owner]
}
/** Test hooks: grant or read credits directly. */
export const addCreditForTest = (owner, n) => addCredit(owner, n)
export const creditsForTest = () => ({ ...load().credits })
/** A check just ended 'failed': a paid one earns its buyer a credit (once); a credit-run that failed gives it back. */
function settleFailure(job) {
  if (job.status !== 'failed') return
  if (!job.free && Number(job.priceCents) > 0 && !job.creditEarned) {
    job.creditEarned = true
    addCredit(job.owner, 1)
  } else if (job.creditUsed && !job.creditEarned) {
    job.creditEarned = true
    addCredit(job.owner, 1)
  }
}

/* ---------------------------------------------------------------- quotas --- */

const monthStart = (now = new Date()) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
const nextMonth = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()
const usd = (cents) => Number(cents) / 100

/** The workspace's free checks this month (a check that failed or was cancelled does not count). */
export function deepQuotaOf(workspace) {
  const plan = planOf(workspace)
  const perMonth = HOLDER_DEEP.freePerMonth[plan.id] ?? 0
  const from = monthStart()
  const mine = jobs().filter((j) => j.workspace === workspace)
  const used = mine.filter((j) => j.free && !j.creditUsed && !['failed', 'cancelled'].includes(j.status) && Date.parse(j.createdAt) >= from).length
  return { plan: { id: plan.id, name: plan.name }, freePerMonth: perMonth, used, left: Math.max(0, perMonth - used), resetsAt: nextMonth(), active: mine.filter((j) => ACTIVE.includes(j.status)).length, maxActive: HOLDER_DEEP.maxActive }
}

/* ------------------------------------------------------------------ views --- */

function paymentView(job) {
  if (!job.invoiceId) return null
  const inv = adminInvoice(job.invoiceId)
  return { invoiceId: job.invoiceId, status: inv?.status ?? 'unknown', usd: usd(job.priceCents), payUrl: `/pay/${job.invoiceId}`, expiresAt: inv?.expiresAt ?? null }
}

function view(job, { full = false } = {}) {
  const finished = FINISHED.includes(job.status)
  return {
    id: job.id,
    status: job.status,
    chain: job.chain,
    token: job.token,
    free: !!job.free,
    priceUsd: usd(job.priceCents),
    listPriceUsd: HOLDER_DEEP.priceUsd,
    bundled: !!job.bundleScanId,
    payment: paymentView(job),
    progress: job.status === 'running' || job.status === 'queued' ? (job.progress ?? null) : null,
    createdAt: job.createdAt,
    startedAt: job.startedAt ?? null,
    completedAt: job.completedAt ?? null,
    cancelReason: job.cancelReason ?? null,
    error: job.status === 'failed' ? (job.error ?? null) : null,
    credit: job.creditEarned || job.creditUsed ? { usedForThis: !!job.creditUsed, earned: !!job.creditEarned, contact: CONTACT } : null,
    url: `/holders/deep/${job.id}`,
    ...(full ? { report: finished ? readReport(job.id) : null } : {}),
  }
}

/* --------------------------------------------------------------- running --- */

const running = new Set()

/** Starts queued checks while fewer than HOLDER_DEEP.maxRunning run. */
function pump() {
  for (const job of jobs()) {
    if (running.size >= HOLDER_DEEP.maxRunning) return
    if (job.state === 'queued' && !running.has(job.id)) void runJob(job)
  }
}

async function runJob(job) {
  running.add(job.id)
  job.state = 'running'
  job.status = 'running'
  job.startedAt ??= new Date().toISOString()
  job.attempts = (job.attempts ?? 0) + 1
  job.progress = { pct: 1, message: 'Starting' }
  save()
  try {
    const report = await engine.run({ chain: job.chain.key, token: job.token, deps: depsNow(), limits: engine.limits, onProgress: (p) => (job.progress = p) })
    if (report.status === 'failed' && !report.error) throw new Error('empty report')
    writeReport(job.id, report)
    job.state = 'finished'
    job.status = report.status
    job.error = report.status === 'failed' ? report.error : null
    job.completedAt = new Date().toISOString()
    delete job.progress
    settleFailure(job)
  } catch (e) {
    console.error(`holders-deep ${job.id}:`, e?.message ?? e)
    if (job.attempts < MAX_ATTEMPTS) Object.assign(job, { state: 'queued', status: 'queued' })
    else Object.assign(job, { state: 'finished', status: 'failed', error: 'The check could not be completed. Write to team@gullylabs.xyz with this check id.', completedAt: new Date().toISOString() })
    settleFailure(job)
  } finally {
    running.delete(job.id)
    save()
    setTimeout(pump, job.state === 'queued' ? Number(process.env.HOLDER_DEEP_RETRY_MS) || 5_000 : 0).unref?.()
  }
}

/** Marks a paid job runnable. */
function queue(job) {
  if (job.state !== 'awaiting_payment') return
  job.state = 'queued'
  job.status = 'queued'
  job.paidAt = new Date().toISOString()
  save()
  pump()
}

function reconcile(job) {
  if (job.state === 'awaiting_payment' && job.invoiceId && adminInvoice(job.invoiceId)?.status === 'paid') queue(job)
}

// The moment a check's invoice is paid, the check starts.
invoicePaidHooks.push((inv) => {
  const job = jobs().find((j) => j.invoiceId === inv.id)
  if (job) reconcile(job)
})

/**
 * Cancels the unpaid checks whose invoice expired or was cancelled (and any still open after the invoice window),
 * starts the paid ones, and drops cancelled checks after 30 days. Returns the ids it cancelled.
 */
export function sweepDeep({ now = Date.now() } = {}) {
  const done = []
  for (const job of jobs()) {
    if (job.state !== 'awaiting_payment') continue
    const inv = job.invoiceId ? adminInvoice(job.invoiceId) : null
    if (inv?.status === 'paid') {
      queue(job)
      continue
    }
    const dead = !inv || inv.status === 'expired' || inv.status === 'cancelled' || now - Date.parse(job.createdAt) >= INVOICE_TTL_MS + 3_600_000
    if (!dead) continue
    if (inv && inv.status === 'open') {
      try {
        adminCancelInvoice(job.invoiceId)
      } catch {
        /* already closed */
      }
    }
    Object.assign(job, { state: 'cancelled', status: 'cancelled', cancelledAt: new Date(now).toISOString(), cancelReason: 'unpaid-expired' })
    done.push(job.id)
  }
  const keep = jobs().filter((j) => j.status !== 'cancelled' || now - Date.parse(j.cancelledAt ?? j.createdAt) < 30 * 86_400_000)
  if (keep.length !== jobs().length) jobs().splice(0, jobs().length, ...keep)
  if (done.length) save()
  pump()
  return done
}
setInterval(() => {
  try {
    sweepDeep()
  } catch (e) {
    console.error('holders-deep sweep:', e?.message ?? e)
  }
}, 30_000).unref?.()

/* ----------------------------------------------------------------- input --- */

function readTarget(body) {
  const chainKey = chainKeyOf(body?.chain)
  if (!chainKey) return { ok: false, error: `Unknown chain. A Deep check runs on ${Object.keys(HOLDER_CHAINS).join(', ')}.` }
  let token = String(body?.token ?? '').trim()
  const stock = findStock(chainKey, token)
  if (stock) token = stock.token
  if (chainKey === 'solana' ? !isSolanaAddress(token) : !/^0x[0-9a-fA-F]{40}$/.test(token) || /^0x0{40}$/.test(token)) return { ok: false, error: 'Give a token address (or the ticker of a tracked token).' }
  return { ok: true, chainKey, token: chainKey === 'solana' ? token : token.toLowerCase() }
}

/** Who is asking: the signed-in workspace when its role may use the plan, else null. Read-only. */
async function whoIs(req) {
  try {
    const ctx = (await import('./developer.mjs')).sessionContext(req)
    return ctx ? { ...ctx, usable: USER_ROLES.includes(ctx.role) } : null
  } catch {
    return null
  }
}

/** Validates a bundle request against the real scan: paid, same workspace, same contract and chain, unused. */
function checkBundle(raw, { chainKey, token, ctx }) {
  const scanId = typeof raw === 'string' ? raw : raw?.scanId
  if (!ctx?.usable) return { ok: false, status: 401, code: 'sign-in-required', error: 'Sign in to the app to bundle a Deep check with a Gully Security scan.' }
  const scan = findScanJob(scanId)
  if (!scan || scan.workspace !== ctx.workspace) return { ok: false, status: 403, code: 'scan-not-yours', error: 'That scan is not in your workspace.' }
  if (!SCAN_CHAIN[chainKey]) return { ok: false, status: 400, code: 'bundle-chain', error: 'The scan bundle is available on Base and BNB Chain.' }
  if (scan.input?.kind !== 'address' || scan.input.address !== token || scan.input.chain !== SCAN_CHAIN[chainKey]) return { ok: false, status: 400, code: 'scan-mismatch', error: 'The scan must be a scan of this same contract address on this chain.' }
  if (scan.free || !scan.invoiceId || adminInvoice(scan.invoiceId)?.status !== 'paid' || scan.state === 'cancelled') return { ok: false, status: 400, code: 'scan-not-paid', error: 'The discount applies to a Gully Security scan you paid for; a scan from the free quota does not qualify.' }
  if (jobs().some((j) => j.bundleScanId === scan.id && j.status !== 'cancelled' && j.status !== 'failed')) return { ok: false, status: 409, code: 'scan-used', error: 'This scan already gave its discount to a Deep check.' }
  return { ok: true, scanId: scan.id }
}

/** The price and the quota decision for a request (pure given the store). */
function decide({ ctx, bundle, owner }) {
  const quota = ctx?.usable ? deepQuotaOf(ctx.workspace) : null
  const credits = creditsOf(owner)
  // Credits first (a failed paid check's free re-run), then the plan's free checks, then the price.
  const viaCredit = credits > 0
  const free = viaCredit || (!!quota && quota.left > 0)
  const cents = free ? 0 : holderDeepPriceCents(!!bundle)
  return { quota: quota && { ...quota, credits }, credits, viaCredit, free, cents, priceUsd: usd(cents) }
}
const ownerOf = (req, ctx) => (ctx?.usable ? ctx.workspace : 'ip:' + crypto.createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 16))

const bundleView = (bundle) => ({ applied: !!bundle, discountPct: HOLDER_DEEP.bundleScanDiscountPct, scanId: bundle?.scanId ?? null })

function quoteOf({ chainKey, token, symbol = null, ctx, bundle, d }) {
  return {
    chain: { key: chainKey, id: HOLDER_CHAINS[chainKey].id, name: HOLDER_CHAINS[chainKey].name },
    token,
    priceUsd: d.priceUsd,
    listPriceUsd: HOLDER_DEEP.priceUsd,
    free: d.free,
    bundle: bundleView(bundle),
    bundleNote: d.free ? 'Free checks come first; the scan discount applies only to a check you pay for.' : null,
    credit: { available: d.credits, used: d.viaCredit },
    quota: d.quota,
    coverage: coverage(chainKey, { deps: engine.deps }),
    budgets: HOLDER_DEEP.budgets,
    checkout: { enabled: !!treasury() },
    signedIn: !!ctx,
    symbol,
  }
}

/* ---------------------------------------------------------------- create --- */

async function create(req, res) {
  const ip = clientIp(req)
  if (!allow('quote', ip, 300, 3_600_000)) return json(res, 429, { error: 'Too many requests from this address. Try again later.' }), true
  const body = await readJson(req, 4_000)
  if (!body) return json(res, 400, { error: 'Send the request as JSON.' }), true
  const t = readTarget(body)
  if (!t.ok) return json(res, 400, { error: t.error }), true
  const { chainKey, token } = t
  const cov = coverage(chainKey, { deps: engine.deps })
  if (!anyCoverage(cov)) return json(res, 422, { error: `A Deep check cannot run on ${HOLDER_CHAINS[chainKey].name} yet: none of its parts has a data source here. Nothing was charged.`, code: 'nothing-available', coverage: cov }), true
  const ctx = await whoIs(req)
  let bundle = null
  if (body.bundleWithScan) {
    const b = checkBundle(body.bundleWithScan, { chainKey, token, ctx })
    if (!b.ok) return json(res, b.status, { error: b.error, code: b.code }), true
    bundle = b
  }
  const owner = ownerOf(req, ctx)
  const d = decide({ ctx, bundle, owner })
  const quote = quoteOf({ chainKey, token, ctx, bundle: d.free ? null : bundle, d })
  if (!body.expect) return json(res, 200, { quote }), true
  if (!allow('create', ip, 30, 3_600_000)) return json(res, 429, { error: 'Too many checks asked for from this address in the last hour. Try again later.' }), true

  // The same token already in progress for this buyer: that check, not a second charge.
  const same = jobs().find((j) => j.owner === owner && j.chain.key === chainKey && j.token === token && ACTIVE.includes(j.status))
  if (same) return json(res, 200, { check: view(same), payment: paymentView(same), duplicate: true }), true
  if (Number(body.expect.priceUsd) !== d.priceUsd) return json(res, 409, { error: d.priceUsd ? `This check costs $${d.priceUsd}. Confirm again.` : 'This check is free after all. Confirm again.', code: 'price-changed', quote }), true
  if (!d.free && !treasury()) return json(res, 402, { error: 'Checks cannot be bought yet: no treasury wallet is configured. Nothing was charged.', code: 'checkout-off' }), true
  if (ctx?.usable && d.quota.active >= d.quota.maxActive) return json(res, 429, { error: `${d.quota.active} checks are already running or waiting in this workspace. Wait for one to finish.`, code: 'too-many-active' }), true
  if (!ctx?.usable && jobs().filter((j) => j.owner === owner && ACTIVE.includes(j.status)).length >= HOLDER_DEEP.maxActive) return json(res, 429, { error: 'Several checks from this address are already waiting. Wait for one to finish.', code: 'too-many-active' }), true

  const now = new Date().toISOString()
  const job = {
    id: 'hd_' + randomToken(12),
    owner,
    workspace: ctx?.usable ? ctx.workspace : null,
    createdBy: ctx?.user ?? null,
    createdAt: now,
    chain: { key: chainKey, id: HOLDER_CHAINS[chainKey].id, name: HOLDER_CHAINS[chainKey].name },
    token,
    free: d.free,
    creditUsed: d.viaCredit,
    priceCents: String(d.cents),
    bundleScanId: !d.free && bundle ? bundle.scanId : null,
    invoiceId: null,
    state: d.free ? 'queued' : 'awaiting_payment',
    status: d.free ? 'queued' : 'awaiting_payment',
    attempts: 0,
  }
  if (!d.free) {
    const inv = createInvoiceRecord({ title: `${HOLDER_DEEP.name}: ${token.slice(0, 6)}…${token.slice(-4)} on ${job.chain.name}`, note: `Holder Map Deep check ${job.id}. The check starts as soon as this invoice is paid. Payment buys the computation only.`, usdCents: BigInt(job.priceCents), assets: ASSET_IDS, ttlMs: INVOICE_TTL_MS })
    job.invoiceId = inv.id
  }
  if (d.viaCredit) addCredit(owner, -1)
  jobs().push(job)
  save()
  if (!d.free) return json(res, 202, { check: view(job), payment: paymentView(job) }), true
  pump()
  return json(res, 201, { check: view(job) }), true
}

/* ----------------------------------------------------------------- routes --- */

/** /api/holders/deep*. Returns true when it answered. */
export async function handleHolderDeep(req, res, url) {
  const p = url.pathname.replace(/\/+$/, '')
  const post = req.method === 'POST'
  if (req.method === 'OPTIONS') return res.writeHead(204, { Allow: 'GET, POST, OPTIONS' }).end(), true
  if (post && req.headers['x-requested-with'] !== 'gully') return json(res, 403, { error: 'Cross-site request refused.' }), true

  if (p === '/api/holders/deep') {
    if (post) return create(req, res)
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'GET or POST only' }), true
    const ctx = await whoIs(req)
    const chains = Object.fromEntries(Object.keys(HOLDER_CHAINS).map((k) => [k, coverage(k, { deps: engine.deps })]))
    return json(res, 200, { offer: HOLDER_DEEP, checkout: { enabled: !!treasury() }, coverage: chains, signedIn: !!ctx, quota: ctx?.usable ? { ...deepQuotaOf(ctx.workspace), credits: creditsOf(ownerOf(req, ctx)) } : null, credits: creditsOf(ownerOf(req, ctx)), contact: CONTACT }), true
  }

  const m = p.match(/^\/api\/holders\/deep\/([^/]+?)(\/cancel)?$/)
  if (!m) return json(res, 404, { error: 'not found' }), true
  const job = findJob(m[1])
  if (!job) return json(res, 404, { error: 'No Deep check has that id.' }, { 'Access-Control-Allow-Origin': '*' }), true

  if (!m[2]) {
    if (post) return json(res, 405, { error: 'GET only' }), true
    reconcile(job)
    return json(res, 200, { check: view(job, { full: true }) }, { 'Access-Control-Allow-Origin': '*', 'X-Robots-Tag': 'noindex' }), true
  }

  if (!post) return json(res, 405, { error: 'POST only' }), true
  if (!allow('cancel', clientIp(req), 60, 3_600_000)) return json(res, 429, { error: 'Too many requests. Try again later.' }), true
  if (job.state === 'awaiting_payment') {
    if (adminInvoice(job.invoiceId)?.status === 'paid') {
      queue(job)
      return json(res, 409, { error: 'This check is paid for already; it is starting.' }), true
    }
    adminCancelInvoice(job.invoiceId)
    Object.assign(job, { state: 'cancelled', status: 'cancelled', cancelledAt: new Date().toISOString(), cancelReason: 'cancelled' })
    save()
    return json(res, 200, { check: view(job) }), true
  }
  if (job.state === 'queued' && job.free && !running.has(job.id)) {
    Object.assign(job, { state: 'cancelled', status: 'cancelled', cancelledAt: new Date().toISOString(), cancelReason: 'cancelled' })
    if (job.creditUsed) {
      job.creditUsed = false
      addCredit(job.owner, 1)
    }
    save()
    return json(res, 200, { check: view(job) }), true
  }
  return json(res, 409, { error: `This check is ${job.status}; there is nothing to cancel.` }), true
}

/** Resumes queued checks after a restart. */
export function startDeepRunner() {
  setTimeout(pump, 1_000).unref?.()
}
