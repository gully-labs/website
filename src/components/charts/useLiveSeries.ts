import { useCallback, useEffect, useRef, useState } from 'react'
import { createPoller } from './livePoller'

/* The page-side half of live mode. Poll a fetcher on the cadence the page states ("refreshes every 30 s")
   and hand the result to a chart: EChart, MiniSpark and MiniBars tween to the new values, so there is no
   re-draw. The timer pauses while the tab is hidden and refreshes at once when it returns if the data is
   older than one interval. The last good value stays on screen when a poll fails (`error` is set). */

export interface LiveSeries<T> {
  /** The latest reply, or `initial` / undefined before the first one. */
  data: T | undefined
  /** True until the first reply or error. */
  loading: boolean
  /** The last poll's error, cleared by the next good reply. */
  error: unknown
  /** When the data was fetched (ms since epoch), for an "updated 12 s ago" label. */
  updatedAt: number | null
  /** Fetch now, outside the cadence. */
  refresh: () => void
}

export interface LiveSeriesOpts<T> {
  initial?: T
  /** false pauses polling (a closed panel, a tab not selected). Default true. */
  enabled?: boolean
}

const env = {
  setTimeout: (fn: () => void, ms: number) => window.setTimeout(fn, ms),
  clearTimeout: (id: unknown) => window.clearTimeout(id as number),
  now: () => Date.now(),
  hidden: () => document.visibilityState === 'hidden',
}

export function useLiveSeries<T>(fetcher: (signal: AbortSignal) => Promise<T>, intervalMs: number, { initial, enabled = true }: LiveSeriesOpts<T> = {}): LiveSeries<T> {
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: unknown; updatedAt: number | null }>({ data: initial, loading: true, error: null, updatedAt: null })
  const latest = useRef(fetcher)
  const poller = useRef<ReturnType<typeof createPoller<T>> | null>(null)
  useEffect(() => {
    latest.current = fetcher
  })
  useEffect(() => {
    if (!enabled) return
    const p = createPoller<T>({
      fetcher: (s) => latest.current(s),
      intervalMs,
      env,
      onData: (data, at) => setState({ data, loading: false, error: null, updatedAt: at }),
      onError: (error) => setState((s) => ({ ...s, loading: false, error })),
    })
    poller.current = p
    const onVis = () => p.visibility()
    document.addEventListener('visibilitychange', onVis)
    p.start()
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      p.stop()
      poller.current = null
    }
  }, [intervalMs, enabled])
  const refresh = useCallback(() => poller.current?.refresh(), [])
  return { ...state, refresh }
}
