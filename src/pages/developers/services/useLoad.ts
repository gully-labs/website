import { useEffect, useState } from 'react'
import { api } from '../api'

export type Load<T> = { k: 'loading' } | { k: 'error'; message: string } | { k: 'ok'; data: T }

/** GET `path` now and every `everyMs` (a minute by default); a failed re-read keeps the last good answer. */
export function useLoad<T>(path: string, everyMs = 60_000): Load<T> {
  const [s, setS] = useState<Load<T>>({ k: 'loading' })
  useEffect(() => {
    let alive = true
    const go = () => api<T>(path).then((r) => alive && setS((prev) => (r.ok ? { k: 'ok', data: r.data } : prev.k === 'ok' ? prev : { k: 'error', message: r.error })))
    go()
    const id = setInterval(go, everyMs)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [path, everyMs])
  return s
}
