/* The polling core behind useLiveSeries (pure: timers and the visibility source are injected, so
   scripts/test-chart-kit.mjs runs it in Node with fake ones). It fetches on a fixed cadence, pauses
   while the tab is hidden, fetches once straight away when the tab comes back if the data is older than
   one interval, never overlaps two requests, and ignores a reply that arrives after stop(). */

export interface PollerEnv {
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (id: unknown) => void
  now: () => number
  /** True while the tab is hidden. */
  hidden: () => boolean
}

export interface PollerOpts<T> {
  fetcher: (signal: AbortSignal) => Promise<T>
  intervalMs: number
  onData: (data: T, at: number) => void
  onError?: (e: unknown) => void
  /** Fetch once on start (default true). */
  immediate?: boolean
  env: PollerEnv
}

export function createPoller<T>({ fetcher, intervalMs, onData, onError, immediate = true, env }: PollerOpts<T>) {
  let timer: unknown = null
  let stopped = true
  let inflight: AbortController | null = null
  let last: number | null = null

  const clear = () => {
    if (timer !== null) env.clearTimeout(timer)
    timer = null
  }
  const schedule = (delay = intervalMs) => {
    clear()
    if (stopped || env.hidden()) return
    timer = env.setTimeout(() => void run(), delay)
  }
  async function run() {
    clear()
    if (stopped || env.hidden() || inflight) return
    const ctl = (inflight = new AbortController())
    try {
      const data = await fetcher(ctl.signal)
      if (!stopped && inflight === ctl) {
        last = env.now()
        onData(data, last)
      }
    } catch (e) {
      if (!stopped && !ctl.signal.aborted) onError?.(e)
    } finally {
      if (inflight === ctl) {
        inflight = null
        schedule()
      }
    }
  }
  return {
    start() {
      if (!stopped) return
      stopped = false
      if (immediate && !env.hidden()) void run()
      else schedule()
    },
    stop() {
      stopped = true
      clear()
      inflight?.abort()
      inflight = null
    },
    /** Call on visibilitychange. Hidden: the timer stops. Visible: refresh now if the data is stale. */
    visibility() {
      if (stopped) return
      if (env.hidden()) return clear()
      if (inflight) return
      if (last === null || env.now() - last >= intervalMs) void run()
      else schedule(intervalMs - (env.now() - last))
    },
    /** Fetch now, outside the cadence (a manual refresh). */
    refresh() {
      if (!stopped) void run()
    },
    get running() {
      return !stopped
    },
  }
}
