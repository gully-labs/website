import { useCallback, useEffect, useState } from 'react'
import { tgApi } from './sdk'

/* Data hooks for the Mini App. Each read is stored with the key it belongs to, so a new key reads as
   loading without a synchronous setState inside an effect; a failed refresh keeps the last good read. */

export type ApiLoad<T> = { k: 'loading' } | { k: 'error'; status: number; error: string; body: Record<string, unknown> | null } | { k: 'ok'; data: T }

/** GET one /api/tg/* path (null: nothing to read), refreshed every `refreshMs` when given. */
export function useTgApi<T>(initData: string, path: string | null, refreshMs = 0): { load: ApiLoad<T>; reload: () => void } {
  const [state, setState] = useState<{ key: string | null; load: ApiLoad<T> }>({ key: null, load: { k: 'loading' } })
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (!path) return
    let alive = true
    const tick = () =>
      tgApi<T>(initData, path).then((r) => {
        if (!alive) return
        setState((s) => {
          if (r.ok) return { key: path, load: { k: 'ok', data: r.data } }
          // A failed refresh keeps the last good read for the same path.
          if (s.key === path && s.load.k === 'ok' && r.status === 0) return s
          return { key: path, load: { k: 'error', status: r.status, error: r.error, body: r.body } }
        })
      })
    tick()
    const id = refreshMs ? setInterval(tick, refreshMs) : null
    return () => {
      alive = false
      if (id) clearInterval(id)
    }
  }, [initData, path, refreshMs, nonce])
  // Reads again now; the last good answer stays on screen until the new one arrives.
  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { load: state.key === path ? state.load : { k: 'loading' }, reload }
}

/** The current time, ticking every `ms` (render code must not read the clock itself). */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}
