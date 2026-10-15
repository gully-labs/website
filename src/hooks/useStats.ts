import { useEffect, useState } from 'react'
import { fetchStats, type Stats } from '../lib/stats'

export type StatsState = { k: 'loading' } | { k: 'error' } | { k: 'ok'; data: Stats }

let shared: Promise<Stats> | null = null
const FRESH_MS = 60_000
let sharedAt = 0

function load(): Promise<Stats> {
  if (shared && Date.now() - sharedAt < FRESH_MS) return shared
  sharedAt = Date.now()
  shared = fetchStats()
  shared.catch(() => {
    shared = null
  })
  return shared
}

/** One read shared by every surface on the page, refreshed every minute. On a failed refresh the last good read stays. */
export function useStats(): StatsState {
  const [state, setState] = useState<StatsState>({ k: 'loading' })
  useEffect(() => {
    let alive = true
    const tick = () =>
      load().then(
        (data) => alive && setState({ k: 'ok', data }),
        () => alive && setState((s) => (s.k === 'ok' ? s : { k: 'error' })),
      )
    tick()
    const id = setInterval(tick, FRESH_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  return state
}
