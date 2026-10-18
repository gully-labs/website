// Gully Security: the ONE place the product UI talks to the scan engine (server/security/index.mjs, part 1).
// security-routes.mjs calls only these functions, so an engine API change lands here.
//
//   startScan          createScan({ workspace, input, limits })  (input in the engine's shape, bytes included)
//   checkInput         the engine's own validateInput, run before a scan is invoiced, so nobody pays for a
//                      scan the engine would refuse
//   readScan/Report    getScan / getReport / getReportHtml
//   stopScan           cancelScan(id) -> { ok, scan }
//   watchScan          onProgress events (polling as a safety net)
//   status             engineStatus(): AI configured? static-tools worker reachable? queue
//   startEngine        startSecurity(), from server.mjs startLoops() (never in standby)

import * as engine from './security/index.mjs'
import { validateInput } from './security/inputs.mjs'

export { renderReportHtml } from './security/index.mjs'

/** The engine's input check. Throws its ScanInputError ({ code, status, message }). */
export const checkInput = (input) => validateInput(input)

/** Queues a scan. Resolves the engine's ScanRecord (with duplicate: true for an active scan of the same target). */
export async function startScan({ workspace, input, limits }) {
  return engine.createScan({ workspace, input, limits })
}

export const readScan = (id) => (id ? engine.getScan(id) : null)
export const readReport = (id) => (id ? engine.getReport(id) : null)
export const readReportHtml = (id) => (id ? engine.getReportHtml(id) : null)
export const stopScan = (id) => engine.cancelScan(id)

let statusCache = { at: 0, value: null }
/** engineStatus(), cached for 30 s (it asks the worker for its health). */
export async function status() {
  if (statusCache.value && Date.now() - statusCache.at < 30_000) return statusCache.value
  const value = await engine.engineStatus()
  statusCache = { at: Date.now(), value }
  return value
}
/** Test hook: forget the cached engine status. */
export const resetStatusCacheForTest = () => (statusCache = { at: 0, value: null })

/* Housekeeping (from startLoops, never in standby): the 180-day scan and report prune once a day, and the unpaid
   upload sweep (security-routes.mjs: an upload left unpaid for 24 h is deleted) every hour. Timers are unref'd. */
export const PRUNE_EVERY_MS = 86_400_000
export const SWEEP_EVERY_MS = 3_600_000
let housekeeping = null

/** One housekeeping pass: prune old scans, delete uploads left unpaid for 24 h. Returns what it removed. */
export async function housekeepNow({ now = Date.now(), prune = true, sweep = true } = {}) {
  const out = { pruned: [], uploadsDeleted: [] }
  if (prune) {
    try {
      out.pruned = engine.pruneScans({ now })
    } catch (e) {
      console.error('security prune:', e?.message ?? e)
    }
  }
  if (sweep) {
    try {
      // Loaded lazily: security-routes.mjs imports this file.
      const routes = await import('./security-routes.mjs')
      out.uploadsDeleted = routes.sweepUnpaidUploads({ now })
    } catch (e) {
      console.error('security upload sweep:', e?.message ?? e)
    }
  }
  return out
}

export function startEngine() {
  engine.startSecurity()
  if (housekeeping) return
  housekeepNow({ prune: false }).catch(() => undefined)
  housekeeping = [
    setInterval(() => housekeepNow({ sweep: false }).catch(() => undefined), PRUNE_EVERY_MS),
    setInterval(() => housekeepNow({ prune: false }).catch(() => undefined), SWEEP_EVERY_MS),
  ]
  for (const t of housekeeping) t.unref?.()
}

/** Tests: the housekeeping timers' periods (empty before startEngine). */
export const housekeepingForTest = () => (housekeeping ? [PRUNE_EVERY_MS, SWEEP_EVERY_MS] : [])

/** Calls cb(scanRecord) whenever scan `id` changes; polls every `pollMs` as a safety net. Returns stop(). */
export function watchScan(id, cb, { pollMs = 2_000 } = {}) {
  let stopped = false
  let last = ''
  const emit = () => {
    if (stopped) return
    const s = engine.getScan(id)
    if (!s) return
    const key = `${s.status}|${s.progress}|${s.message}|${s.updatedAt}`
    if (key === last) return
    last = key
    cb(s)
  }
  const off = engine.onProgress((ev) => ev.id === id && emit())
  emit()
  const timer = setInterval(emit, pollMs)
  timer.unref?.()
  return () => {
    stopped = true
    clearInterval(timer)
    off()
  }
}
