// Gully Security, the product UI's API (part 2 of the audit platform; the scan engine is part 1, the
// monitoring and Gully Score part 3). Three tiers, named honestly everywhere:
//   AI Security Scan  self-serve, automated (this file + the engine)       priced in plans.mjs SECURITY.scan
//   Security Review   people read the code, quoted per project               request form below
//   Audit             premium, not offered yet                               request form below
// Nothing here says or implies that Gully Labs has audited anything.
//
// Signed-in (the developer gate in developer.mjs: session, workspace, role; every POST needs a role with the
// 'security' write category: developer, admin or owner, workspaces.mjs):
//   GET  /api/developer/security                  quota left this month, the offer, chains, engine state, checkout
//   GET  /api/developer/security/scans            the workspace's scans, newest first
//   POST /api/developer/security/scans            { input, upload?: { name, data (base64) }, expect: { priceUsd } }
//                                                 -> 201 { scan } started (free quota) | 202 { scan, payment } an
//                                                 invoice to pay (Gully Pay, invoices.mjs); the scan starts once paid
//   GET  /api/developer/security/scans/:id        one scan, with its report once done
//   GET  /api/developer/security/scans/:id/events Server-Sent Events: `scan` (the view) on every change, ends when done
//   GET  /api/developer/security/scans/:id/report.html  the engine's print-ready HTML report (Export PDF)
//   POST /api/developer/security/scans/:id/cancel  before payment: cancels the invoice; running: asks the engine
//   POST /api/developer/security/scans/:id/publish { published, indexable? }  owner or admin only; done scans only.
//                                                 A snapshot of the report (without draft PoCs) goes public at
//                                                 /security/reports/<id>; noindex unless `indexable`.
// Public:
//   GET  /api/security/reports                    published reports, newest first
//   GET  /api/security/reports/:id                one published report (404 unless published)
//   GET  /api/security/reports/:id/report.html    its print-ready HTML (the engine's render of the public snapshot)
//   GET  /api/security/stats                      real counts of scans run, per day for 30 days (the /security counter)
//   GET  /api/security/engine                     what can run right now: the AI review and the static tools,
//                                                 each online or offline as last checked (never assumed), and the
//                                                 queue (the checkout and /security poll it)
//   GET  /api/security/sample                     the SAMPLE report on a fictional contract (security/sample.mjs)
//   GET  /api/security/sample/report.html         its print-ready HTML, marked "Sample"
//   POST /api/security/review-requests            { tier: 'review'|'audit', name, email, project, scope, … } -> 201
//                                                 stored, listed in the admin enquiries and Security card, and sent
//                                                 to TELEGRAM_ADMIN_CHAT_ID when set
// Admin (admin.mjs, behind ADMIN_TOKEN):
//   GET  /api/admin/security                      queue, scans per day, failures, review requests
//   POST /api/admin/security/reviews/:id          { status, note? }
//   POST /api/admin/security/scans/:id/unpublish  takes a public report down
//
// Quotas: SECURITY.scan.freePerMonth[plan] free scans per UTC month per workspace (a scan that failed does not
// count), at most SECURITY.scan.maxActive running at once. Payment: one Gully Pay invoice per paid scan.
// Re-run credits (the same rule as the Holder Map Deep check): a PAID scan that ends 'failed' gives its workspace
// one credit for a free re-run, never a refund; credits are spent before the price, after the free quota. A scan
// started with a credit that fails gives the credit back. The terms page (/legal/scan-terms) says the same.
// Every engine call goes through security-engine.mjs; the input's shapes through security-contract.mjs.

import fs from 'node:fs'
import path from 'node:path'
import { adminCancelInvoice, adminInvoice, createInvoiceRecord, invoicePaidHooks } from './invoices.mjs'
import { ACTIVE_STATUSES, checkUploadName, MODE_LABELS, normaliseInput, SCAN_CHAINS, scopeLabel, SEVERITIES, TERMINAL_STATUSES, toEngineInput } from './security-contract.mjs'
import { checkInput, readReport, readScan, renderReportHtml, startScan, status as engineStatus, stopScan, watchScan } from './security-engine.mjs'
import { addCredits, creditsOf, findJob, isJobId, jobs, published, publishedJobs, reviews, save } from './security-store.mjs'
import { sampleReport } from './security/sample.mjs'
import { badgeHeaders, badgeStyleFrom, renderBadge } from './badges.mjs'
import { clientIp, DATA_DIR, json, readJson } from './http.mjs'
import { ASSET_IDS } from './payments.mjs'
import { planOf, SECURITY, treasury } from './plans.mjs'
import { addEnquiry, randomToken } from './store.mjs'
import { notifyIntake } from './intake-notify.mjs'

const UPLOADS = path.join(DATA_DIR, 'security-uploads')
const INVOICE_TTL_MS = 7 * 86_400_000
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}$/
/** Every stored review request, oldest first (the daily digest counts them). */
export const securityReviewRows = () => reviews()

export const REVIEW_STATUSES = ['new', 'contacted', 'quoted', 'won', 'declined', 'closed']
const ADMIN_ROLES = ['owner', 'admin']

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

/** Test hook: forget every rate-limit hit. */
export const resetSecurityLimitsForTest = () => hits.clear()

/* ---------------------------------------------------------------- quotas --- */

const monthStart = (now = new Date()) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
const nextMonth = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()
const usd = (cents) => Number(cents) / 100

/** The workspace's free scans this month and what one more costs. */
export function quotaOf(workspace) {
  const plan = planOf(workspace)
  const perMonth = SECURITY.scan.freePerMonth[plan.id] ?? 0
  const from = monthStart()
  const used = jobs().filter((j) => j.workspace === workspace && j.free && (j.state === 'starting' || j.state === 'started') && j.status !== 'failed' && Date.parse(j.createdAt) >= from).length
  const left = Math.max(0, perMonth - used)
  const active = jobs().filter((j) => j.workspace === workspace && (j.state === 'starting' || (j.state === 'started' && ACTIVE_STATUSES.includes(j.status)))).length
  const credits = creditsOf(workspace)
  return { plan: { id: plan.id, name: plan.name }, freePerMonth: perMonth, used, left, credits, resetsAt: nextMonth(), nextPriceUsd: left > 0 || credits > 0 ? 0 : SECURITY.scan.priceUsd, active, maxActive: SECURITY.scan.maxActive }
}

/** A scan just ended 'failed': a paid one earns its workspace a re-run credit (once); a credit run gives it back. */
function settleFailure(job) {
  if (job.status !== 'failed' || job.creditEarned) return false
  if ((!job.free && Number(job.priceCents) > 0) || job.creditUsed) {
    job.creditEarned = true
    addCredits(job.workspace, 1)
    return true
  }
  return false
}

/* ----------------------------------------------------------------- views --- */

const countsOf = (report) => Object.fromEntries(SEVERITIES.map((s) => [s, (report?.findings ?? []).filter((f) => f.severity === s).length]))

/** Copies what the engine says into the job's mirror (status, completion, counts, mode). Saves when it changed. */
function mirror(job, scan) {
  if (!scan) return
  let changed = false
  const set = (k, v) => {
    if (v !== undefined && v !== null && JSON.stringify(job[k]) !== JSON.stringify(v)) {
      job[k] = v
      changed = true
    }
  }
  if (scan.status && scan.status !== job.status) set('statusAt', new Date().toISOString())
  set('status', scan.status)
  if (TERMINAL_STATUSES.includes(scan.status)) set('completedAt', job.completedAt ?? scan.finishedAt ?? scan.updatedAt ?? new Date().toISOString())
  if (scan.status === 'done') {
    set('counts', scan.counts)
    set('mode', scan.mode)
  }
  if (settleFailure(job)) changed = true
  if (changed) save()
}

/** The engine's error code as a sentence (failed scans). */
const FAILURE = {
  'nothing-to-scan': 'There was nothing to scan: no source files in scope.',
  'scope-too-large': 'The code in scope is larger than a scan covers. Scan a smaller part, or ask for a Security Review.',
  'repo-not-found': 'The repository was not found on GitHub.',
  'repo-private': 'The repository is private. Only public repositories can be scanned.',
  'commit-not-found': 'That commit or branch was not found in the repository.',
  'too-large': 'The code is larger than the scanner accepts.',
  'explorers-unavailable': 'The block explorers could not be reached to read the contract source. Try again later.',
  'engine-unavailable': 'Scanning was not available (no AI and no static tools). Try again later.',
  timeout: 'The scan took too long and was stopped.',
  'too-many-attempts': 'The scan was interrupted too many times.',
}
const failureText = (scan) => (scan?.error ? (FAILURE[scan.error.code] ?? `The scan failed: ${scan.error.message}`) : null)

function paymentView(job) {
  if (!job.invoiceId) return null
  const inv = adminInvoice(job.invoiceId)
  return { invoiceId: job.invoiceId, status: inv?.status ?? 'unknown', usd: usd(job.priceCents), payUrl: `/pay/${job.invoiceId}`, expiresAt: inv?.expiresAt ?? null }
}

/** What the app shows for one scan. `scan` is the engine's record (null when not started or unreadable). */
function jobView(job, scan, { full = false } = {}) {
  const status = job.state === 'awaiting_payment' ? 'awaiting_payment' : job.state === 'cancelled' && !job.scanId ? 'cancelled' : job.state === 'starting' ? 'queued' : (scan?.status ?? job.status ?? 'unknown')
  return {
    id: job.id,
    status,
    title: scopeLabel(job.input, job.upload),
    input: job.input,
    upload: job.upload ?? null,
    free: !!job.free,
    priceUsd: usd(job.priceCents ?? '0'),
    credit: job.creditUsed || job.creditEarned ? { usedForThis: !!job.creditUsed, earned: !!job.creditEarned } : null,
    payment: paymentView(job),
    progress: scan && typeof scan.progress === 'number' ? { pct: Math.round(scan.progress * 100), message: scan.message ?? '' } : null,
    mode: scan?.mode ?? job.mode ?? null,
    label: (scan?.mode ?? job.mode) ? MODE_LABELS[scan?.mode ?? job.mode] : null,
    duplicate: !!job.duplicate,
    createdAt: job.createdAt,
    startedAt: job.startedAt ?? null,
    updatedAt: scan?.updatedAt ?? job.statusAt ?? job.createdAt,
    completedAt: job.completedAt ?? null,
    counts: job.counts ?? null,
    published: !!job.published,
    publishedAt: job.publishedAt ?? null,
    indexable: !!job.indexable,
    publicUrl: job.published ? `/security/reports/${job.id}` : null,
    startError: job.state === 'awaiting_payment' && job.startError ? job.startError : null,
    cancelReason: job.cancelReason ?? null,
    uploadDeletedAt: job.uploadDeletedAt ?? null,
    history: job.history ?? [],
    ...(full ? { report: status === 'done' ? readReport(job.scanId) : null, failure: status === 'failed' ? failureText(scan) : null } : {}),
  }
}

/** Brings the mirror of the workspace's unfinished scans up to date (quota and the running limit read it). */
async function syncWorkspace(workspace) {
  for (const j of jobs()) if (j.workspace === workspace && j.state === 'started' && !TERMINAL_STATUSES.includes(j.status)) mirror(j, await readScan(j.scanId))
}

/** Reads the engine for a job (and retries starting a paid one), then its view. */
async function viewOf(job, opts) {
  await reconcile(job)
  const scan = job.scanId ? await readScan(job.scanId) : null
  mirror(job, scan)
  return jobView(job, scan, opts)
}

/* ---------------------------------------------------------- starting scans --- */

const starting = new Set()

function uploadPath(job) {
  return path.join(UPLOADS, `${job.id}.bin`)
}

/** The engine's refusal (ScanInputError { code, status }) in plain words, with the HTTP status to answer. */
export function engineRefusal(e) {
  const status = [400, 413, 429, 503].includes(Number(e?.status)) ? Number(e.status) : 503
  const msg = String(e?.message ?? e).replace(/\.$/, '')
  const error = status === 400 ? `The scan engine cannot take this input: ${msg}.` : status === 413 ? `The upload is too large for the scan engine: ${msg}.` : status === 429 ? `Scan limit reached: ${msg}. Try again later.` : `Scanning is not available right now: ${msg}.`
  return { status, code: e?.code ?? 'engine-error', error }
}

/** The plan's limits passed to the engine (the running cap; the engine keeps its own daily cap too). */
const limitsFor = () => ({ maxQueued: SECURITY.scan.maxActive })

/** Starts the engine's scan for a job (free, or paid). Resolves true when it started. */
async function startJob(job) {
  if (job.scanId || starting.has(job.id)) return !!job.scanId
  starting.add(job.id)
  try {
    let upload = null
    if (job.input.kind === 'upload') upload = { name: job.upload?.name ?? 'upload.zip', bytes: fs.readFileSync(uploadPath(job)) }
    const scan = await startScan({ workspace: job.workspace, input: toEngineInput(job.input, upload), limits: limitsFor() })
    if (!scan?.id) throw new Error('The scan engine returned no scan.')
    job.scanId = scan.id
    if (scan.duplicate) job.duplicate = true
    job.state = 'started'
    job.startedAt = new Date().toISOString()
    job.status = scan.status ?? 'queued'
    job.statusAt = job.startedAt
    delete job.startError
    delete job.startErrorCode
    delete job.startErrorStatus
    save()
    if (upload) fs.rm(uploadPath(job), { force: true }, () => {})
    return true
  } catch (e) {
    const r = engineRefusal(e)
    job.startError = r.error
    job.startErrorCode = r.code
    job.startErrorStatus = r.status
    save()
    console.error(`security: scan ${job.id} could not start: ${r.code}`)
    return false
  } finally {
    starting.delete(job.id)
  }
}

/** How long an unpaid scan's uploaded code is kept. */
export const UNPAID_UPLOAD_MS = 24 * 3_600_000

/**
 * Deletes the uploaded code of scans left unpaid for 24 hours, cancels their invoice (the scan could no longer
 * run) and records it in the scan's history. Run every hour by security-engine.mjs housekeeping. Returns job ids.
 */
export function sweepUnpaidUploads({ now = Date.now() } = {}) {
  const done = []
  for (const job of jobs()) {
    if (job.state !== 'awaiting_payment' || !job.upload || now - Date.parse(job.createdAt) < UNPAID_UPLOAD_MS) continue
    if (job.invoiceId && adminInvoice(job.invoiceId)?.status === 'paid') continue // paid: reconcile starts it
    fs.rmSync(uploadPath(job), { force: true })
    if (job.invoiceId) {
      try {
        adminCancelInvoice(job.invoiceId)
      } catch {
        /* already closed */
      }
    }
    const at = new Date(now).toISOString()
    job.state = 'cancelled'
    job.status = 'cancelled'
    job.cancelledAt = at
    job.cancelReason = 'unpaid-24h'
    job.uploadDeletedAt = at
    job.history = [...(job.history ?? []), { at, event: 'upload-deleted', text: 'Uploaded code deleted: the scan was unpaid for 24 hours.' }]
    done.push(job.id)
  }
  if (done.length) save()
  return done
}

/** A paid job whose invoice is paid but whose scan has not started (a restart, an engine hiccup): start it. */
async function reconcile(job) {
  if (job.state !== 'awaiting_payment' || !job.invoiceId) return
  if (adminInvoice(job.invoiceId)?.status === 'paid') await startJob(job)
}

// The moment a scan's invoice is paid, its scan starts.
invoicePaidHooks.push((inv) => {
  const job = jobs().find((j) => j.invoiceId === inv.id)
  if (job && job.state === 'awaiting_payment') startJob(job)
})

// Keeps the mirror (the public counter, the admin queue) current for scans still running, and retries
// paid scans that could not start. Cheap: only jobs that are not finished are read.
setInterval(async () => {
  for (const j of jobs()) {
    try {
      if (j.state === 'awaiting_payment') await reconcile(j)
      else if (j.state === 'started' && !TERMINAL_STATUSES.includes(j.status)) mirror(j, await readScan(j.scanId))
    } catch (e) {
      console.error('security sync:', e?.message ?? e)
    }
  }
}, 15_000).unref?.()

/* ---------------------------------------------------------------- create --- */

function readUpload(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Attach the code to scan: a .zip of Solidity files or a single .sol file.' }
  const name = String(raw.name ?? '').trim()
  if (!checkUploadName(name)) return { ok: false, error: 'The file must be a .zip of Solidity files or a single .sol file, with a plain name.' }
  if (typeof raw.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw.data)) return { ok: false, error: 'The file could not be read. Pick it again.' }
  const bytes = Buffer.from(raw.data, 'base64')
  if (!bytes.length) return { ok: false, error: 'The file is empty.' }
  if (bytes.length > SECURITY.scan.maxUploadBytes) return { ok: false, status: 413, error: `The file is larger than ${Math.round(SECURITY.scan.maxUploadBytes / 1_000_000)} MB. Scan the repository instead.` }
  return { ok: true, name, bytes }
}

async function createJob(req, res, ctx) {
  const { workspace, user } = ctx
  if (!allow('create', workspace, 20, 3_600_000)) return json(res, 429, { error: 'Too many scans asked for in the last hour. Try again later.' }), true
  const body = await readJson(req, Math.ceil(SECURITY.scan.maxUploadBytes * 1.4) + 4_000)
  if (!body) return json(res, 400, { error: 'Send the scan as JSON.' }), true
  const n = normaliseInput(body.input)
  if (!n.ok) return json(res, 400, { error: n.error }), true
  let upload = null
  if (n.input.kind === 'upload') {
    upload = readUpload(body.upload)
    if (!upload.ok) return json(res, upload.status ?? 400, { error: upload.error }), true
    n.input.filename = upload.name
  }
  // The engine checks the input itself before anything is charged or queued.
  try {
    checkInput(toEngineInput(n.input, upload ? { name: upload.name, bytes: upload.bytes } : null))
  } catch (e) {
    const r = engineRefusal(e)
    return json(res, r.status, { error: r.error, code: r.code }), true
  }
  // Anything but a contract address needs the AI or the static-tools worker (an unverified address still gets
  // its bytecode notes).
  const es = await engineStatus()
  if (n.input.kind !== 'address' && !es.ai && !es.worker?.reachable) return json(res, 503, { error: 'Scans of code cannot run right now: neither the AI review nor the static-tools worker is available on this server. Nothing was charged.', code: 'engine-unavailable' }), true
  await syncWorkspace(workspace)
  // The same target already scanning in this workspace: that scan, not a second one.
  const same = jobs().find((j) => j.workspace === workspace && JSON.stringify(j.input) === JSON.stringify(n.input) && (j.state === 'starting' || j.state === 'awaiting_payment' || (j.state === 'started' && ACTIVE_STATUSES.includes(j.status))))
  if (same) return json(res, 200, { scan: { ...(await viewOf(same, { full: true })), duplicate: true }, payment: paymentView(same) }), true
  const q = quotaOf(workspace)
  if (q.active >= q.maxActive) return json(res, 429, { error: `${q.active} scan${q.active === 1 ? ' is' : 's are'} already running in this workspace. Wait for one to finish.`, code: 'too-many-active' }), true
  const free = q.left > 0
  // After the free quota, a re-run credit (a paid scan that failed earlier) pays for this one.
  const viaCredit = !free && q.credits > 0
  const priceUsd = free || viaCredit ? 0 : SECURITY.scan.priceUsd
  // The price the person confirmed must still be the price: a quota used up meanwhile is not a silent charge.
  if (body.expect && Number(body.expect.priceUsd) !== priceUsd) return json(res, 409, { error: priceUsd ? `Your free scans for this month are used up meanwhile: this scan costs $${priceUsd}. Confirm again.` : 'This scan is free after all. Confirm again.', code: 'price-changed', quota: q }), true
  if (!free && !viaCredit && !treasury()) return json(res, 402, { error: 'Scans beyond the free quota cannot be bought yet: no treasury wallet is configured. Nothing was charged.', code: 'checkout-off' }), true

  const now = new Date().toISOString()
  const job = { id: 'sec_' + randomToken(12), workspace, createdBy: user, createdAt: now, input: n.input, upload: upload ? { name: upload.name, size: upload.bytes.length } : null, free, priceCents: String(priceUsd * 100), invoiceId: null, state: free || viaCredit ? 'starting' : 'awaiting_payment', scanId: null, status: null, published: false, indexable: false, ...(viaCredit ? { creditUsed: true } : {}) }
  if (viaCredit) addCredits(workspace, -1)
  if (upload) {
    fs.mkdirSync(UPLOADS, { recursive: true })
    fs.writeFileSync(uploadPath(job), upload.bytes)
  }
  if (!free && !viaCredit) {
    const inv = createInvoiceRecord({ title: `${SECURITY.scan.name}: ${scopeLabel(job.input, job.upload)}`, note: `Gully Security scan ${job.id}. The scan starts as soon as this invoice is paid.`, usdCents: BigInt(job.priceCents), assets: ASSET_IDS, ttlMs: INVOICE_TTL_MS })
    job.invoiceId = inv.id
  }
  jobs().push(job)
  save()
  if (!free && !viaCredit) return json(res, 202, { scan: jobView(job, null), payment: paymentView(job) }), true
  const ok = await startJob(job)
  if (!ok) {
    // A free (or credit) scan that could not start is dropped, so it uses neither the quota nor the credit.
    jobs().splice(jobs().indexOf(job), 1)
    if (viaCredit) addCredits(workspace, 1)
    save()
    fs.rm(uploadPath(job), { force: true }, () => {})
    return json(res, job.startErrorStatus ?? 503, { error: `${job.startError} Nothing was used from your ${viaCredit ? 're-run credits' : 'quota'}.`, code: job.startErrorCode }), true
  }
  return json(res, 201, { scan: await viewOf(job, { full: true }) }), true
}

/* -------------------------------------------------------- public snapshot --- */

/** What a published report shows: the engine's report without the draft PoC code (its status stays) and
    without the workspace. Stored on the job when it is published, so the public page never needs the engine. */
function snapshotOf(report) {
  const r = structuredClone(report)
  delete r.workspace
  r.findings = (r.findings ?? []).map((f) => (f.poc ? { ...f, poc: { ...f.poc, code: '', note: 'Kept private by the owner of the code.' } } : f))
  return r
}

const publicView = (job) => ({ id: job.id, title: scopeLabel(job.input, job.upload), input: job.input, upload: job.upload ? { name: job.upload.name } : null, completedAt: job.completedAt ?? null, publishedAt: job.publishedAt, indexable: !!job.indexable, counts: job.counts ?? job.snapshot?.summary?.counts ?? null, mode: job.snapshot?.mode ?? job.mode ?? null, label: job.snapshot?.label ?? null, url: `/security/reports/${job.id}` })

/** Sends a report as a standalone, print-ready page (the engine's render; kit tokens; no scripts). */
function sendHtml(res, html, { noindex = true } = {}) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...(noindex ? { 'X-Robots-Tag': 'noindex' } : {}) })
  res.end(html)
  return true
}

/* ------------------------------------------------------------ signed in --- */

/** /api/developer/security*, called by developer.mjs's gate with ctx = { user, workspace, role, … }. */
export async function handleSecurity(req, res, url, ctx) {
  const p = url.pathname.slice('/api/developer/security'.length)
  const post = req.method === 'POST'
  const { workspace } = ctx

  if (p === '' || p === '/') {
    if (post) return json(res, 405, { error: 'GET only' }), true
    await syncWorkspace(workspace)
    const es = await engineStatus()
    const pe = publicEngine(es)
    return json(res, 200, { quota: quotaOf(workspace), offer: SECURITY, chains: SCAN_CHAINS, engine: { installed: true, ai: pe.engines[0].status === 'online', worker: !!es.worker?.reachable, tools: pe.engines[1].tools, queue: es.queue ?? null, state: pe.state, text: pe.text }, checkout: { enabled: !!treasury() }, role: ctx.role, canPublish: ADMIN_ROLES.includes(ctx.role) }), true
  }

  if (p === '/scans') {
    if (post) return createJob(req, res, ctx)
    const mine = jobs().filter((j) => j.workspace === workspace).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100)
    const out = []
    for (const j of mine) out.push(await viewOf(j))
    return json(res, 200, { scans: out }), true
  }

  const m = p.match(/^\/scans\/([^/]+)(?:\/(events|cancel|publish|report\.html))?$/)
  if (!m) return json(res, 404, { error: 'not found' }), true
  const job = findJob(m[1])
  if (!job || job.workspace !== workspace) return json(res, 404, { error: 'No such scan in this workspace.' }), true

  if (!m[2]) {
    if (post) return json(res, 405, { error: 'GET only' }), true
    return json(res, 200, { scan: await viewOf(job, { full: true }) }), true
  }

  if (m[2] === 'report.html') {
    if (post) return json(res, 405, { error: 'GET only' }), true
    const report = job.scanId ? readReport(job.scanId) : null
    if (!report) return json(res, 404, { error: 'This scan has no report yet.' }), true
    return sendHtml(res, renderReportHtml(report, { standalone: true }))
  }

  if (m[2] === 'events') {
    if (post) return json(res, 405, { error: 'GET only' }), true
    if (!allow('sse', workspace, 120, 3_600_000)) return json(res, 429, { error: 'Too many live views opened. Reload the page later.' }), true
    return streamJob(req, res, job), true
  }

  if (!post) return json(res, 405, { error: 'POST only' }), true

  if (m[2] === 'cancel') {
    if (!allow('cancel', workspace, 60, 3_600_000)) return json(res, 429, { error: 'Too many requests. Try again later.' }), true
    if (job.state === 'awaiting_payment') {
      if (adminInvoice(job.invoiceId)?.status === 'paid') {
        await startJob(job)
        return json(res, 409, { error: 'This scan is paid for already; it is starting. Cancel it once it runs.' }), true
      }
      adminCancelInvoice(job.invoiceId)
      job.state = 'cancelled'
      job.cancelledAt = new Date().toISOString()
      job.status = 'cancelled'
      save()
      fs.rm(uploadPath(job), { force: true }, () => {})
      return json(res, 200, { scan: jobView(job, null, { full: true }) }), true
    }
    const scan = job.scanId ? await readScan(job.scanId) : null
    mirror(job, scan)
    if (!scan || !ACTIVE_STATUSES.includes(scan.status)) return json(res, 409, { error: `This scan has ${scan?.status === 'done' ? 'finished' : scan ? `already ${scan.status === 'failed' ? 'failed' : 'stopped'}` : 'no running engine job'}; there is nothing to cancel.` }), true
    const r = stopScan(job.scanId)
    if (!r.ok) return json(res, 409, { error: 'The engine could not cancel the scan: it has already finished.' }), true
    job.cancelledAt = new Date().toISOString()
    mirror(job, r.scan)
    return json(res, 200, { scan: await viewOf(job, { full: true }) }), true
  }

  // publish
  if (!ADMIN_ROLES.includes(ctx.role)) return json(res, 403, { error: `Your role (${ctx.role}) can't publish reports. Ask the workspace owner or an admin.`, code: 'forbidden-role' }), true
  if (!allow('publish', workspace, 60, 3_600_000)) return json(res, 429, { error: 'Too many changes. Try again later.' }), true
  const body = await readJson(req, 1_000)
  if (typeof body?.published !== 'boolean') return json(res, 400, { error: 'Say whether the report is published: { published: true | false }.' }), true
  if (body.published) {
    const scan = job.scanId ? await readScan(job.scanId) : null
    mirror(job, scan)
    const report = scan?.status === 'done' ? readReport(job.scanId) : null
    if (!report) return json(res, 409, { error: 'Only a finished scan with a report can be published.' }), true
    job.snapshot = snapshotOf(report)
    job.counts = report.summary?.counts ?? countsOf(report)
    job.published = true
    job.publishedAt = new Date().toISOString()
    job.publishedBy = ctx.user
    job.indexable = body.indexable === true
  } else {
    job.published = false
    job.indexable = false
    job.unpublishedAt = new Date().toISOString()
  }
  save()
  return json(res, 200, { scan: await viewOf(job, { full: true }) }), true
}

/** Server-Sent Events for one scan: the view now, then on every change, until it finishes (or 30 minutes). */
function streamJob(req, res, job) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  let closed = false
  let last = ''
  let unwatch = null
  const send = (view) => {
    if (closed) return
    const s = JSON.stringify(view)
    if (s === last) return
    last = s
    res.write(`event: scan\ndata: ${s}\n\n`)
    if (['done', 'failed', 'cancelled'].includes(view.status)) end()
  }
  const end = () => {
    if (closed) return
    closed = true
    clearInterval(tick)
    clearInterval(beat)
    clearTimeout(life)
    unwatch?.()
    res.end()
  }
  const refresh = async () => {
    if (closed) return
    try {
      const v = await viewOf(job, { full: true })
      send(v)
      if (job.scanId && !unwatch && !closed) unwatch = watchScan(job.scanId, (scan) => (mirror(job, scan), send(jobView(job, scan, { full: TERMINAL_STATUSES.includes(scan.status) }))))
    } catch (e) {
      console.error('security events:', e?.message ?? e)
    }
  }
  // Before payment (and as a safety net) the job is re-read every 2 s; once started the engine's events drive it.
  const tick = setInterval(refresh, 2_000)
  const beat = setInterval(() => !closed && res.write(': keep-alive\n\n'), 15_000)
  const life = setTimeout(end, 30 * 60_000)
  req.on('close', end)
  refresh()
}

/* ---------------------------------------------------------------- public --- */

function readReview(body) {
  const s = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const tier = s(body?.tier, 10)
  if (!['review', 'audit'].includes(tier)) return { ok: false, error: 'Pick what you are asking for: a Security Review or an Audit.' }
  const name = s(body?.name, 120)
  const email = s(body?.email, 254).toLowerCase()
  const project = s(body?.project, 120)
  const scope = s(body?.scope, 4_000)
  if (name.length < 2) return { ok: false, error: 'Tell us your name.' }
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'A valid email is required, so we can send the quote.' }
  if (project.length < 2) return { ok: false, error: 'Name the project.' }
  if (scope.length < 20) return { ok: false, error: 'Describe what should be reviewed in a sentence or two (at least 20 characters).' }
  const repo = s(body?.repo, 200)
  if (repo && !/^(https?:\/\/\S+|[\w.-]+\/[\w.-]+)$/.test(repo)) return { ok: false, error: 'The repository must be a URL or owner/name.' }
  const address = s(body?.address, 42)
  if (address && !/^0x[0-9a-fA-F]{40}$/.test(address)) return { ok: false, error: 'The contract address must be 0x followed by 40 hex characters.' }
  const chain = s(body?.chain, 40)
  if (chain && !SCAN_CHAINS.some((c) => c.key === chain)) return { ok: false, error: 'Pick one of the listed chains, or leave the chain empty.' }
  return { ok: true, review: { tier, name, email, project, scope, repo: repo || null, chain: chain || null, address: address ? address.toLowerCase() : null, company: s(body?.company, 120) || null, timeline: s(body?.timeline, 80) || null, budget: s(body?.budget, 80) || null } }
}

/** /api/security/*. Returns true when it answered. */
export async function handleSecurityPublic(req, res, url) {
  const p = url.pathname
  const ip = clientIp(req)

  // Preflight. The reads are open to any origin (GET, HEAD); the review form is same-origin only, so its
  // preflight grants no origin (a foreign page cannot send X-Requested-With).
  if (req.method === 'OPTIONS') {
    if (p === '/api/security/review-requests') return res.writeHead(204, { Allow: 'POST, OPTIONS' }).end(), true
    if (p === '/api/security/reports' || p === '/api/security/stats' || p === '/api/security/engine' || p === '/api/security/sample' || p.startsWith('/api/security/reports/')) {
      return res.writeHead(204, { Allow: 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Max-Age': '86400' }).end(), true
    }
    return false
  }

  if (p === '/api/security/review-requests') {
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
    if (req.headers['x-requested-with'] !== 'gully') return json(res, 403, { error: 'Cross-site request refused.' }), true
    if (!allow('review', ip, 5, 3_600_000)) return json(res, 429, { error: 'Too many requests from this address. Try again in an hour, or write to team@gullylabs.xyz.' }), true
    const body = await readJson(req, 12_000)
    // A filled honeypot is a bot: answered like a success, stored nowhere.
    if (typeof body?.website === 'string' && body.website.trim()) return json(res, 201, { request: { id: 'rr_' + randomToken(9), status: 'new' } }), true
    const r = readReview(body)
    if (!r.ok) return json(res, 400, { error: r.error }), true
    if (!allow('review-email', r.review.email, 3, 86_400_000)) return json(res, 429, { error: 'We already have requests from this email today. We will be in touch.' }), true
    let wallet = null
    try {
      wallet = (await import('./developer.mjs')).sessionAddress(req)
    } catch {
      wallet = null
    }
    const now = new Date().toISOString()
    const review = { id: 'rr_' + randomToken(9), ...r.review, status: 'new', note: null, createdAt: now, updatedAt: now, source: String(body?.source ?? '') === 'app' ? 'app' : 'site', wallet }
    reviews().push(review)
    if (reviews().length > 5_000) reviews().splice(0, reviews().length - 5_000)
    save()
    const label = review.tier === 'audit' ? 'Audit' : 'Security Review'
    // The existing admin inbox (enquiries) and the operators' Telegram chat both hear about it.
    addEnquiry({ name: review.name, email: review.email, message: `${label} request for ${review.project}${review.company ? ` (${review.company})` : ''}.\n\n${review.scope}${review.repo ? `\n\nRepository: ${review.repo}` : ''}${review.address ? `\nContract: ${review.address}${review.chain ? ` on ${review.chain}` : ''}` : ''}${review.timeline ? `\nTimeline: ${review.timeline}` : ''}`, types: [label], budget: review.budget ?? '', securityReviewId: review.id })
    void notifyIntake({
      kind: 'security',
      title: `New ${label} request: ${review.project}`,
      fields: [['From', review.name], ['Email', review.email], ['Company', review.company], ['Tier', review.tier], ['Budget', review.budget], ['Timeline', review.timeline], ['Contract', review.address && `${review.address}${review.chain ? ` on ${review.chain}` : ''}`], ['Repository', review.repo], ['Scope', review.scope]],
      contact: review.email,
    })
    return json(res, 201, { request: { id: review.id, tier: review.tier, status: review.status } }), true
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'GET only' }, { Allow: 'GET, HEAD, OPTIONS' }), true
  if (!allow('read', ip, 600, 3_600_000)) return json(res, 429, { error: 'Too many requests. Try again later.' }), true

  // Public reads: the docs host reads the counter cross-origin, like /api/plans.
  const open = { 'Cache-Control': 'public, max-age=30', 'Access-Control-Allow-Origin': '*' }
  if (p === '/api/security/reports') return json(res, 200, { reports: publishedJobs().slice(0, 200).map(publicView) }, open), true

  if (p === '/api/security/stats') return json(res, 200, statsOf(30), open), true

  // What can run right now (the engine's status is cached 30 s in security-engine.mjs).
  if (p === '/api/security/engine') return json(res, 200, publicEngine(await engineStatus()), { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }), true

  // The sample report: a fictional contract, built and validated like a real report.
  if (p === '/api/security/sample') return json(res, 200, { report: { ...sampleReport(), sample: true } }, { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' }), true
  if (p === '/api/security/sample/report.html') {
    const html = renderReportHtml(sampleReport(), { standalone: true }).replace('<h1>', `<p class="gs-badge" data-sample="true" style="margin:0 0 12px">${SAMPLE_BANNER}</p><h1>`)
    return sendHtml(res, html)
  }

  // The embeddable badge, for a published report only: "Gully Security | Scanned <date>".
  const bm = p.match(/^\/api\/security\/reports\/([^/]+)\/badge\.svg$/)
  if (bm) {
    const job = isJobId(bm[1]) ? published(bm[1]) : null
    if (!job?.snapshot) return json(res, 404, { error: 'No published report has that address. The owner may have taken it down.' }, { 'X-Robots-Tag': 'noindex', 'Access-Control-Allow-Origin': '*' }), true
    const at = new Date(job.publishedAt ?? job.completedAt ?? Date.now())
    const date = at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    res.writeHead(200, badgeHeaders(300))
    return res.end(req.method === 'HEAD' ? undefined : renderBadge({ kind: 'security', label: 'Gully Security', value: `Scanned ${date}`, title: `Gully Security: report published ${date}`, href: `https://gullylabs.xyz/security/reports/${job.id}`, ...badgeStyleFrom(url.searchParams) })), true
  }

  const m = p.match(/^\/api\/security\/reports\/([^/]+?)(\/report\.html)?$/)
  if (m) {
    const job = isJobId(m[1]) ? published(m[1]) : null
    if (!job?.snapshot) return json(res, 404, { error: 'No published report has that address. The owner may have taken it down.' }, { 'X-Robots-Tag': 'noindex', 'Access-Control-Allow-Origin': '*' }), true
    if (m[2]) return sendHtml(res, renderReportHtml(job.snapshot, { standalone: true }), { noindex: !job.indexable })
    return json(res, 200, { report: { ...job.snapshot, ...publicView(job) } }, { 'Cache-Control': 'public, max-age=30', 'Access-Control-Allow-Origin': '*', ...(job.indexable ? {} : { 'X-Robots-Tag': 'noindex' }) }), true
  }
  return false
}

/** The banner every rendering of the sample report carries. */
export const SAMPLE_BANNER = 'SAMPLE REPORT: a fictional contract written for this page. Not a scan of real code.'

/**
 * What can run right now, from engineStatus() (security/index.mjs). Each engine is 'online' only when it was
 * seen working: the AI review needs a key AND no refusal of the account (no credit, billing) since the last call
 * that worked; the static tools need the scanner worker to answer its health check. No reasons or URLs leave
 * the server. state: 'online' (both), 'partial' (one) or 'offline' (neither).
 */
export function publicEngine(es) {
  const h = es?.aiHealth ?? {}
  const refused = h.lastFailCode === 'ai-unavailable' && (!h.lastOkAt || String(h.lastOkAt) < String(h.lastFailAt))
  const ai = es?.ai && !refused ? 'online' : 'offline'
  const worker = es?.worker?.reachable ? 'online' : 'offline'
  const tools = worker === 'online' ? Object.keys(es.worker.tools ?? {}).filter((k) => es.worker.tools[k]) : []
  const state = ai === 'online' && worker === 'online' ? 'online' : ai === 'online' || worker === 'online' ? 'partial' : 'offline'
  const text =
    state === 'online'
      ? 'Static tools and the AI review run on every scan.'
      : ai === 'online'
        ? 'The AI review runs now. The static tools are offline: reports list them as not run.'
        : worker === 'online'
          ? 'The static tools run now. The AI review is offline: findings are not triaged.'
          : 'Scanning is offline right now. Code scans cannot start and a contract scan reads its bytecode only. Nothing is charged for a scan that cannot run.'
  return {
    checkedAt: new Date().toISOString(),
    state,
    text,
    engines: [
      { id: 'ai', name: 'AI review', status: ai, ...(refused ? { note: 'the AI service refused the last request' } : {}) },
      { id: 'static', name: 'Static tools', status: worker, tools },
    ],
    queue: { running: !!es?.queue?.running, queued: Number(es?.queue?.queued) || 0 },
  }
}

/** Real counts from the jobs (never invented): per UTC day for `days` days, and totals. */
function statsOf(days) {
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())
  const rows = Array.from({ length: days }, (_, i) => ({ day: new Date(today - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10), started: 0, done: 0, failed: 0 }))
  const at = (iso) => rows.find((r) => r.day === String(iso ?? '').slice(0, 10))
  let started = 0
  let done = 0
  let failed = 0
  for (const j of jobs()) {
    if (j.state !== 'started') continue
    started++
    const s = at(j.startedAt)
    if (s) s.started++
    if (j.status === 'done') {
      done++
      const d = at(j.completedAt)
      if (d) d.done++
    } else if (j.status === 'failed') {
      failed++
      const d = at(j.completedAt)
      if (d) d.failed++
    }
  }
  return { generatedAt: new Date().toISOString(), totals: { started, done, failed, published: publishedJobs().length }, days: rows }
}

/* ----------------------------------------------------------------- admin --- */

/** /api/admin/security*, after admin.mjs has checked the token. */
export async function handleSecurityAdmin(req, res, url) {
  const p = url.pathname
  if (p === '/api/admin/security') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    const all = [...jobs()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const lite = (j) => ({ ...jobView(j, null), workspace: j.workspace, createdBy: j.createdBy, status: j.state === 'awaiting_payment' ? 'awaiting_payment' : j.state === 'cancelled' && !j.scanId ? 'cancelled' : j.state === 'starting' ? 'queued' : (j.status ?? 'unknown'), startError: j.startError ?? null })
    const queue = all.filter((j) => j.state === 'awaiting_payment' || j.state === 'starting' || (j.state === 'started' && !TERMINAL_STATUSES.includes(j.status))).map(lite)
    const failures = all.filter((j) => j.status === 'failed' || (j.state === 'awaiting_payment' && j.startError)).slice(0, 25).map(lite)
    const s = statsOf(30)
    const es = await engineStatus()
    return json(res, 200, { engine: { installed: true, ai: !!es.ai, worker: !!es.worker?.reachable, workerReason: es.worker?.reachable ? null : (es.worker?.reason ?? null), queue: es.queue ?? null }, offer: SECURITY, totals: { ...s.totals, jobs: all.length, awaitingPayment: all.filter((j) => j.state === 'awaiting_payment').length }, days: s.days, queue, failures, published: publishedJobs().map(publicView), reviews: [...reviews()].reverse(), reviewStatuses: REVIEW_STATUSES }), true
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }), true
  let m = p.match(/^\/api\/admin\/security\/reviews\/(rr_[\w-]{12})$/)
  if (m) {
    const r = reviews().find((x) => x.id === m[1])
    if (!r) return json(res, 404, { error: 'No such request.' }), true
    const body = await readJson(req, 4_000)
    if (body?.status !== undefined && !REVIEW_STATUSES.includes(body.status)) return json(res, 400, { error: `status must be one of: ${REVIEW_STATUSES.join(', ')}.` }), true
    if (body?.status) r.status = body.status
    if (typeof body?.note === 'string') r.note = body.note.trim().slice(0, 2_000) || null
    r.updatedAt = new Date().toISOString()
    save()
    return json(res, 200, { review: r }), true
  }
  m = p.match(/^\/api\/admin\/security\/scans\/([^/]+)\/unpublish$/)
  if (m) {
    const job = findJob(m[1])
    if (!job) return json(res, 404, { error: 'No such scan.' }), true
    job.published = false
    job.indexable = false
    job.unpublishedAt = new Date().toISOString()
    job.unpublishedBy = 'admin'
    save()
    return json(res, 200, { ok: true }), true
  }
  return json(res, 404, { error: 'not found' }), true
}
