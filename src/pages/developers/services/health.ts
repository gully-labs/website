import { useEffect, useSyncExternalStore } from 'react'
import { isStatusBody, type StatusBody } from '../../../lib/status'
import { isLocalHost, SITE_URL } from '../../../site-host'

/* This browser's round trips to GET /healthz, shared by everything in the app that shows API health (the
   sidebar/header Status button, the Overview's market band, the Status dialog), so the app pings once per
   period instead of once per widget. The fastest period any open widget asks for wins; pings pause while
   the tab is hidden. The last 60 checks are kept for this session. */

export type Ping = { t: number; ms: number | null }

let pings: Ping[] = []
const listeners = new Set<() => void>()
const wants = new Map<symbol, number>()
let timer = 0
let period = 0

function ping() {
  if (document.visibilityState === 'hidden') return
  const t0 = performance.now()
  fetch('/healthz', { cache: 'no-store' })
    .then((r) => (r.ok ? Math.round(performance.now() - t0) : null))
    .catch(() => null)
    .then((ms) => {
      pings = [...pings, { t: Date.now(), ms }].slice(-60)
      listeners.forEach((l) => l())
    })
}

function reschedule() {
  const next = wants.size ? Math.min(...wants.values()) : 0
  if (next === period) return
  window.clearInterval(timer)
  period = next
  if (next) timer = window.setInterval(ping, next)
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** The shared pings, read at least every `everyMs` while the caller is mounted. */
export function useHealthPings(everyMs: number): Ping[] {
  useEffect(() => {
    const me = Symbol('health')
    const first = wants.size === 0 && pings.length === 0
    wants.set(me, everyMs)
    reschedule()
    if (first || Date.now() - (pings.at(-1)?.t ?? 0) > everyMs) ping()
    const vis = () => document.visibilityState === 'visible' && ping()
    document.addEventListener('visibilitychange', vis)
    return () => {
      wants.delete(me)
      reschedule()
      document.removeEventListener('visibilitychange', vis)
    }
  }, [everyMs])
  return useSyncExternalStore(subscribe, () => pings, () => pings)
}

export type Health = 'checking' | 'up' | 'down'

export const healthOf = (p: Ping[]): Health => (!p.length ? 'checking' : p[p.length - 1].ms === null ? 'down' : 'up')

/* ------------------------------------------------------------ public status --- */

/* The public status (GET /api/status on gullylabs.xyz, server/status.mjs; public and CORS), shared by the
   header's Status button and the Status dialog, so the app reads it once per period however many widgets
   show it. Locally (development, e2e) the same server answers it same-origin. */

/** The public status page, opened from the Status dialog. */
export const STATUS_PAGE = `${SITE_URL}/status`
const statusApi = () => (isLocalHost() ? '/api/status' : `${SITE_URL}/api/status`)

export type AppStatus = { body: StatusBody | null; error: string | null; reads: number; at: number | null }

let status: AppStatus = { body: null, error: null, reads: 0, at: null }
const sListeners = new Set<() => void>()
const sWants = new Map<symbol, number>()
let sTimer = 0
let sPeriod = 0

function readStatus() {
  if (document.visibilityState === 'hidden') return
  fetch(statusApi(), { cache: 'no-store', headers: { accept: 'application/json' } })
    .then(async (r) => {
      const j: unknown = r.ok ? await r.json() : null
      return isStatusBody(j) ? { body: j, error: null } : { body: null, error: r.ok ? 'The status answer could not be read.' : `The status could not be read (HTTP ${r.status}).` }
    })
    .catch(() => ({ body: null, error: 'The status could not be reached.' }))
    .then(({ body, error }) => {
      // A failed read keeps the last good body (marked with the error), never blanks it.
      status = { body: body ?? status.body, error, reads: status.reads + 1, at: Date.now() }
      sListeners.forEach((l) => l())
    })
}

function sReschedule() {
  const next = sWants.size ? Math.min(...sWants.values()) : 0
  if (next === sPeriod) return
  window.clearInterval(sTimer)
  sPeriod = next
  if (next) sTimer = window.setInterval(readStatus, next)
}

const sSubscribe = (l: () => void) => {
  sListeners.add(l)
  return () => sListeners.delete(l)
}

/** The shared public status, read at least every `everyMs` while the caller is mounted. */
export function useAppStatus(everyMs: number): AppStatus {
  useEffect(() => {
    const me = Symbol('status')
    sWants.set(me, everyMs)
    sReschedule()
    if (status.at === null || Date.now() - status.at > everyMs) readStatus()
    const vis = () => document.visibilityState === 'visible' && status.at !== null && Date.now() - status.at > everyMs && readStatus()
    document.addEventListener('visibilitychange', vis)
    return () => {
      sWants.delete(me)
      sReschedule()
      document.removeEventListener('visibilitychange', vis)
    }
  }, [everyMs])
  return useSyncExternalStore(sSubscribe, () => status, () => status)
}

/** The header button's state from the public status: the API component ("platform" group) when known. */
export function healthOfStatus(s: AppStatus): Health {
  if (!s.body) return s.error ? 'down' : 'checking'
  const api = s.body.components.find((c) => c.id === 'api') ?? s.body.components.find((c) => c.group === 'platform')
  if (!api || api.state === 'unknown' || api.state === 'off') return s.error ? 'down' : 'checking'
  return api.state === 'down' ? 'down' : 'up'
}
