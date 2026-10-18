// Gully Security scan engine: the internal API parts 2 and 3 call.
//
//   import { createScan, getScan, listScans, cancelScan, getReport, getReportHtml, scanEvents,
//            engineStatus, startSecurity } from './security/index.mjs'
//
// The queue is persisted in DATA_DIR/security/scans.json (atomic writes), one folder per scan holds the
// upload, the stage checkpoints and the report. Concurrency is 1. On start, a scan that was running when
// the process stopped goes back to the queue and resumes from its last checkpoint (at most
// SECURITY_MAX_ATTEMPTS times). Per-workspace limits: SECURITY_SCANS_PER_DAY and SECURITY_MAX_QUEUED,
// or stricter ones passed by the caller (plans).

import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.mjs'
import { aiConfigured } from './claude.mjs'
import { ScanInputError, sameTarget, validateInput } from './inputs.mjs'
import { runPipeline } from './pipeline.mjs'
import { TERMINAL_STATUSES } from './schema.mjs'
import { workerHealth } from './tools.mjs'

export { ScanInputError } from './inputs.mjs'
export { validateReport, REPORT_JSON_SCHEMA, SCHEMA_VERSION, MODE_LABELS, DISCLAIMER } from './schema.mjs'
export { renderReportHtml, REPORT_CSS } from './report.mjs'

/**
 * Progress events. Every change emits 'update' (ScanEvent); also 'queued', 'progress', 'done',
 * 'failed', 'cancelled' with the same payload. 'done' also carries { counts, mode }.
 */
export const scanEvents = new EventEmitter()
scanEvents.setMaxListeners(50)

let db = null // { scans: [record + internals] }
let running = null // id of the running scan
let pumping = false
let stopped = false
const cancelFlags = new Set()

const file = () => path.join(config.dataDir(), 'scans.json')
const scanDir = (id) => path.join(config.dataDir(), 'scans', id)

function load() {
  if (db) return db
  try {
    db = JSON.parse(fs.readFileSync(file(), 'utf8'))
    if (!Array.isArray(db?.scans)) db = { scans: [] }
  } catch {
    db = { scans: [] }
  }
  return db
}
function save() {
  fs.mkdirSync(config.dataDir(), { recursive: true })
  fs.writeFileSync(file() + '.tmp', JSON.stringify(db))
  fs.renameSync(file() + '.tmp', file())
}

const PUBLIC = ['id', 'workspace', 'kind', 'input', 'status', 'progress', 'message', 'createdAt', 'updatedAt', 'startedAt', 'finishedAt', 'attempts', 'error', 'cost', 'mode', 'label', 'counts', 'reportReady']
const view = (s) => (s ? Object.fromEntries(PUBLIC.map((k) => [k, s[k] ?? null])) : null)

function emit(s, extra = {}) {
  const ev = { id: s.id, workspace: s.workspace, status: s.status, progress: s.progress, message: s.message, ...extra }
  scanEvents.emit('update', ev)
  const name = s.status === 'queued' ? 'queued' : TERMINAL_STATUSES.includes(s.status) ? (s.status === 'done' ? 'done' : s.status) : 'progress'
  scanEvents.emit(name, ev)
}

function update(s, patch, extra) {
  Object.assign(s, patch, { updatedAt: new Date().toISOString() })
  save()
  emit(s, extra)
}

const WS_RE = /^[A-Za-z0-9:._@-]{1,200}$/

/**
 * Queues a scan. Returns the ScanRecord (an existing active scan of the same target in the same
 * workspace is returned instead of a duplicate, with duplicate: true). Throws ScanInputError
 * (code, status) on bad input or a limit.
 * limits: { scansPerDay, maxQueued, maxCostUsd, maxNsloc } override the defaults (from the plan).
 */
export function createScan({ workspace, input, limits = {}, upload = null } = {}) {
  load()
  // Also accepted: the bytes passed beside the input, as { name, bytes } (part 2's shape).
  if (upload && input && typeof input === 'object' && input.data === undefined) input = { ...input, filename: input.filename ?? upload.name, data: upload.bytes ?? upload.data }
  const ws = String(workspace ?? '').trim()
  if (!WS_RE.test(ws)) throw new ScanInputError('bad-workspace', 'workspace is required')
  const v = validateInput(input)
  if (v.kind !== 'address' && !aiConfigured() && !config.scannerUrl()) throw new ScanInputError('engine-unavailable', 'scanning is not available right now (no AI and no static-analysis worker configured)', 503)
  const mine = db.scans.filter((s) => s.workspace === ws)
  const active = mine.filter((s) => !TERMINAL_STATUSES.includes(s.status))
  const dup = active.find((s) => s.kind === v.kind && sameTarget(s.input, v.public))
  if (dup) return { ...view(dup), duplicate: true }
  const perDay = limits.scansPerDay ?? config.scansPerDay()
  if (mine.filter((s) => Date.now() - Date.parse(s.createdAt) < 86_400_000).length >= perDay) throw new ScanInputError('rate-limited', `this workspace has used its ${perDay} scans for the last 24 hours`, 429)
  const maxQ = limits.maxQueued ?? config.maxQueuedPerWorkspace()
  if (active.length >= maxQ) throw new ScanInputError('too-many-queued', `this workspace already has ${active.length} scan(s) waiting or running`, 429)
  const now = new Date().toISOString()
  const id = `scn_${crypto.randomBytes(12).toString('base64url')}`
  const s = {
    id,
    workspace: ws,
    kind: v.kind,
    input: v.public,
    status: 'queued',
    progress: 0,
    message: 'Waiting in the queue',
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    attempts: 0,
    error: null,
    cost: { usd: 0, inputTokens: 0, outputTokens: 0 },
    mode: null,
    label: null,
    counts: null,
    reportReady: false,
    limits: { maxCostUsd: limits.maxCostUsd ?? null, maxNsloc: limits.maxNsloc ?? null },
  }
  fs.mkdirSync(scanDir(id), { recursive: true })
  if (v.private?.data) fs.writeFileSync(path.join(scanDir(id), 'input.bin'), v.private.data)
  db.scans.push(s)
  save()
  emit(s)
  setImmediate(pump)
  return view(s)
}

/** A scan record, or null. Pass workspace to enforce ownership. */
export function getScan(id, { workspace } = {}) {
  load()
  const s = db.scans.find((x) => x.id === id)
  if (!s || (workspace !== undefined && s.workspace !== workspace)) return null
  return view(s)
}

/** Scans of a workspace, newest first. */
export function listScans(workspace, { limit = 50, status } = {}) {
  load()
  if (workspace && typeof workspace === 'object') {
    limit = workspace.limit ?? limit
    status = workspace.status ?? status
    workspace = workspace.workspace
  }
  return db.scans
    .filter((s) => s.workspace === workspace && (!status || s.status === status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(1, Math.min(500, limit)))
    .map(view)
}

/** The report JSON of a finished scan, or null. */
export function getReport(id, { workspace } = {}) {
  const s = getScan(id, { workspace })
  if (!s?.reportReady) return null
  try {
    return JSON.parse(fs.readFileSync(path.join(scanDir(id), 'report.json'), 'utf8'))
  } catch {
    return null
  }
}

/** The static HTML render of a finished scan, or null. */
export function getReportHtml(id, { workspace } = {}) {
  const s = getScan(id, { workspace })
  if (!s?.reportReady) return null
  try {
    return fs.readFileSync(path.join(scanDir(id), 'report.html'), 'utf8')
  } catch {
    return null
  }
}

/** Cancels a queued or running scan. Returns { ok, scan } (scan is null when not found). */
export function cancelScan(id, { workspace } = {}) {
  load()
  const s = db.scans.find((x) => x.id === id && (workspace === undefined || x.workspace === workspace))
  if (!s) return { ok: false, scan: null }
  if (TERMINAL_STATUSES.includes(s.status)) return { ok: false, scan: view(s) }
  if (running === id) {
    cancelFlags.add(id)
    update(s, { message: 'Cancelling…' })
  } else update(s, { status: 'cancelled', message: 'Cancelled', finishedAt: new Date().toISOString() })
  return { ok: true, scan: view(s) }
}

/** What can run right now (for the UI and the health check). */
export async function engineStatus() {
  const worker = await workerHealth()
  return { ai: aiConfigured(), worker: { reachable: worker.ok, tools: worker.tools, reason: worker.reason }, explorers: { etherscanKey: !!config.etherscanKey() }, queue: queueStats() }
}

export function queueStats() {
  load()
  return { running, queued: db.scans.filter((s) => s.status === 'queued').length }
}

/* ------------------------------------------------------------------ runner --- */

async function pump() {
  if (pumping || stopped) return
  pumping = true
  try {
    for (;;) {
      if (stopped) break
      const next = load().scans.filter((s) => s.status === 'queued').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
      if (!next) break
      await runOne(next)
    }
  } finally {
    pumping = false
  }
}

async function runOne(s) {
  running = s.id
  cancelFlags.delete(s.id)
  update(s, { status: 'fetching', attempts: s.attempts + 1, startedAt: s.startedAt ?? new Date().toISOString(), message: 'Starting', error: null })
  const ctx = {
    limits: s.limits ?? {},
    isCancelled: () => cancelFlags.has(s.id),
    progress: (fraction, message, status) => update(s, { progress: Math.max(s.progress, Math.min(0.99, fraction)), message, ...(status ? { status } : {}) }),
  }
  let timer
  try {
    const report = await Promise.race([
      runPipeline(s, scanDir(s.id), ctx),
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(Object.assign(new Error('the scan took too long and was stopped'), { code: 'timeout' })), config.scanTimeoutMs())
      }),
    ])
    update(s, { status: 'done', progress: 1, message: 'Report ready', finishedAt: new Date().toISOString(), mode: report.mode, label: report.label, counts: report.summary.counts, reportReady: true, cost: { usd: report.ai.costUsd, inputTokens: report.ai.inputTokens, outputTokens: report.ai.outputTokens } }, { counts: report.summary.counts, mode: report.mode })
  } catch (e) {
    if (e?.code === 'cancelled' || cancelFlags.has(s.id)) update(s, { status: 'cancelled', message: 'Cancelled', finishedAt: new Date().toISOString() })
    else {
      if (!e?.code) console.error('security: scan crashed:', e?.stack ?? e)
      update(s, { status: 'failed', message: 'Scan failed', finishedAt: new Date().toISOString(), error: { code: String(e?.code ?? 'internal'), message: e?.code ? String(e.message).slice(0, 300) : 'internal error' } })
    }
  } finally {
    clearTimeout(timer)
    cancelFlags.delete(s.id)
    running = null
  }
}

/**
 * Removes finished scans older than SECURITY_KEEP_DAYS (180 by default): the record and its folder (inputs,
 * checkpoints, report). Runs at start and once a day (security-engine.mjs startEngine). Returns the ids removed.
 */
export function pruneScans({ now = Date.now() } = {}) {
  load()
  const keep = now - config.keepDays() * 86_400_000
  const gone = []
  db.scans = db.scans.filter((s) => {
    if (TERMINAL_STATUSES.includes(s.status) && Date.parse(s.createdAt) < keep) {
      fs.rmSync(scanDir(s.id), { recursive: true, force: true })
      gone.push(s.id)
      return false
    }
    return true
  })
  if (gone.length) save()
  return gone
}

/**
 * Loads the queue, requeues scans interrupted by a restart (they resume from their checkpoints), prunes
 * scans older than SECURITY_KEEP_DAYS and starts the runner. Safe to call more than once.
 */
export function startSecurity() {
  stopped = false
  load()
  pruneScans()
  for (const s of db.scans) {
    if (TERMINAL_STATUSES.includes(s.status) || s.status === 'queued') continue
    if (s.attempts >= config.maxAttempts()) Object.assign(s, { status: 'failed', message: 'Scan failed', finishedAt: new Date().toISOString(), error: { code: 'too-many-attempts', message: 'the scan was interrupted too many times' } })
    else Object.assign(s, { status: 'queued', message: 'Resuming after a restart' })
  }
  save()
  setImmediate(pump)
}

/** Stops picking new scans (the running one finishes). Tests use it to simulate a shutdown. */
export function stopSecurity() {
  stopped = true
}

/** Test hook: forget the in-memory state (as if the process restarted). */
export function resetForTest() {
  db = null
  running = null
  pumping = false
  cancelFlags.clear()
}

/** Subscribes to every scan update; returns an unsubscribe function. */
export function onProgress(listener) {
  scanEvents.on('update', listener)
  return () => scanEvents.off('update', listener)
}
export const events = scanEvents

/** Resolves when the runner is idle (tests). */
export async function idle(timeoutMs = 30_000) {
  const t0 = Date.now()
  while (pumping || running) {
    if (Date.now() - t0 > timeoutMs) throw new Error('security: runner did not go idle')
    await new Promise((r) => setTimeout(r, 20))
  }
}
