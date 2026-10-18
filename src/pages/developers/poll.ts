import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

/* Polling that never blanks a page (owner audit P0-3, 2026-10-18). A tab keeps its last good data on screen
   when a refresh fails; the failure shows as a small "couldn't refresh · retry" chip (RefreshChip in ui.tsx)
   and the read is retried on its own with backoff (5 s, 10 s, 20 s … up to 60 s) until it answers, then
   the normal period resumes. Only a page that has never loaded shows an error in place of its content.
   A first read that takes longer than `timeoutMs` ends as `timedOut`, so nothing stays a skeleton forever. */

export type Poll<T> = {
  /** The last good answer (kept through failed refreshes), or null before the first one. */
  data: T | null
  /** The last refresh's error while it is failing, else null. */
  error: string | null
  /** True when `data` is from an earlier read because the latest one failed. */
  stale: boolean
  /** True when the first read neither answered nor failed within timeoutMs. */
  timedOut: boolean
  /** Read now (resets the backoff). */
  reload: () => Promise<void>
}

export const BACKOFF_START = 5_000
export const BACKOFF_MAX = 60_000

/** GET `path` now and every `every` ms (0: once), keeping the last good data. `null` path: idle. */
export function usePoll<T>(path: string | null, every = 60_000, timeoutMs = 15_000): Poll<T> {
  const [s, set] = useState<{ path: string | null; data: T | null; error: string | null; timedOut: boolean }>({ path, data: null, error: null, timedOut: false })
  const kick = useRef<() => Promise<void>>(async () => undefined)

  useEffect(() => {
    let alive = true
    let timer = 0
    let wait = BACKOFF_START
    const read = async (): Promise<void> => {
      if (!path) return
      window.clearTimeout(timer)
      const r = await api<T>(path)
      if (!alive) return
      if (r.ok) {
        wait = BACKOFF_START
        set({ path, data: r.data, error: null, timedOut: false })
        if (every) timer = window.setTimeout(read, every)
      } else {
        set((prev) => ({ path, data: prev.path === path ? prev.data : null, error: r.error, timedOut: prev.timedOut }))
        timer = window.setTimeout(read, wait)
        wait = Math.min(wait * 2, BACKOFF_MAX)
      }
    }
    kick.current = () => {
      wait = BACKOFF_START
      return read()
    }
    void read()
    const t = timeoutMs ? window.setTimeout(() => alive && set((p) => (p.data === null && p.error === null ? { ...p, timedOut: true } : p)), timeoutMs) : 0
    return () => {
      alive = false
      window.clearTimeout(timer)
      window.clearTimeout(t)
    }
  }, [path, every, timeoutMs])

  const reload = useCallback(() => kick.current(), [])
  const data = s.path === path ? s.data : null
  return { data, error: s.path === path ? s.error : null, stale: !!data && !!s.error, timedOut: s.path === path && s.timedOut, reload }
}
