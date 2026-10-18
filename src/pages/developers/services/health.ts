import { useEffect, useSyncExternalStore } from 'react'

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
