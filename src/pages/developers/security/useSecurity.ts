import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScanView, SecurityOverview } from '../../../components/security/types'
import { isFinal } from '../../../components/security/types'
import { api } from '../api'

/* Data hooks for the app's Security tab (server/security-routes.mjs). */

export type SecuritySub = 'scans' | 'new' | 'reports' | 'monitors' | 'review'

/** The sub-tab a deep link opens (#security-new, #security-reports, #security-monitors, #security-review; Dashboard LEGACY). */
export const subFromSection = (section: string | null): SecuritySub => (section === 'security-new' ? 'new' : section === 'security-reports' ? 'reports' : section === 'security-monitors' ? 'monitors' : section === 'security-review' ? 'review' : 'scans')

export type Load<T> = { k: 'loading' } | { k: 'error'; message: string } | { k: 'ok'; data: T }

function useGet<T>(path: string, every: number): [Load<T>, () => void] {
  const [s, set] = useState<Load<T>>({ k: 'loading' })
  const alive = useRef(true)
  const load = useCallback(() => {
    api<T>(path).then((r) => alive.current && set((prev) => (r.ok ? { k: 'ok', data: r.data } : prev.k === 'ok' ? prev : { k: 'error', message: r.error })))
  }, [path])
  useEffect(() => {
    alive.current = true
    load()
    const id = every ? setInterval(() => document.visibilityState !== 'hidden' && load(), every) : 0
    return () => {
      alive.current = false
      if (id) clearInterval(id)
    }
  }, [load, every])
  return [s, load]
}

/** Quota, offer, chains, engine and checkout state. */
export const useOverview = () => useGet<SecurityOverview>('/api/developer/security', 30_000)

/** The workspace's scans, refreshed every 8 s while the tab is visible (running scans move on their own). */
export const useScans = () => useGet<{ scans: ScanView[] }>('/api/developer/security/scans', 8_000)

/**
 * One scan, live: the first read by GET, then Server-Sent Events (`scan` events) until it finishes. If the
 * stream cannot be opened or drops, it falls back to polling every 2 s.
 */
export function useScan(id: string | null): [Load<ScanView>, (v: ScanView) => void, () => void] {
  const [s, set] = useState<Load<ScanView>>({ k: 'loading' })
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!id) return
    let alive = true
    let es: EventSource | null = null
    let poll: ReturnType<typeof setInterval> | null = null
    const apply = (v: ScanView) => alive && set({ k: 'ok', data: v })
    const read = () =>
      api<{ scan: ScanView }>(`/api/developer/security/scans/${id}`).then((r) => {
        if (!alive) return
        if (r.ok) apply(r.data.scan)
        else set((prev) => (prev.k === 'ok' ? prev : { k: 'error', message: r.error }))
        if (r.ok && isFinal(r.data.scan.status) && poll) clearInterval(poll)
      })
    const startPolling = () => {
      if (!poll) poll = setInterval(read, 2_000)
    }
    read().then(() => {
      if (!alive) return
      if (typeof EventSource === 'undefined') return startPolling()
      es = new EventSource(`/api/developer/security/scans/${id}/events`)
      es.addEventListener('scan', (e) => {
        try {
          const v = JSON.parse((e as MessageEvent).data) as ScanView
          apply(v)
          if (isFinal(v.status)) es?.close()
        } catch {
          /* a malformed event: the next one or the poll corrects it */
        }
      })
      es.onerror = () => {
        es?.close()
        es = null
        startPolling()
      }
    })
    return () => {
      alive = false
      es?.close()
      if (poll) clearInterval(poll)
    }
  }, [id, n])
  const replace = useCallback((v: ScanView) => set({ k: 'ok', data: v }), [])
  const reload = useCallback(() => setN((x) => x + 1), [])
  return [s, replace, reload]
}

/** Reads a File as base64 (no data: prefix). */
export function fileToBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('The file could not be read.'))
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.readAsDataURL(f)
  })
}
