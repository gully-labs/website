import { useEffect, useState } from 'react'
import { APP_URL, isLocalHost } from '../../site-host'

/* Helpers shared by the public Security pages (/security, /security/reports, /security/reports/:id). */

/** The app's New scan step (another app: links to it open in a new tab). */
export const SCAN_APP_URL = isLocalHost() ? '/developers#security-new' : `${APP_URL}/#security-new`

export type Fetch<T> = { k: 'loading' } | { k: 'error'; status: number; message: string } | { k: 'ok'; data: T }

/** GET a public JSON endpoint, refreshed every `every` ms (0: once). Keeps the last good read on a failed refresh. */
export function usePublic<T>(path: string, every = 0): [Fetch<T>, () => void] {
  const [s, set] = useState<Fetch<T>>({ k: 'loading' })
  const [n, setN] = useState(0)
  useEffect(() => {
    let alive = true
    const go = () =>
      fetch(path)
        .then(async (r) => {
          const d = await r.json().catch(() => null)
          if (!alive) return
          if (r.ok) set({ k: 'ok', data: d as T })
          else set((prev) => (prev.k === 'ok' ? prev : { k: 'error', status: r.status, message: d?.error ?? `The server answered ${r.status}.` }))
        })
        .catch(() => alive && set((prev) => (prev.k === 'ok' ? prev : { k: 'error', status: 0, message: 'The server could not be reached.' })))
    go()
    const id = every ? setInterval(() => document.visibilityState !== 'hidden' && go(), every) : 0
    return () => {
      alive = false
      if (id) clearInterval(id)
    }
  }, [path, every, n])
  return [s, () => (set({ k: 'loading' }), setN((x) => x + 1))]
}
