import { useLiveSeries } from '../components/charts/useLiveSeries'
import { apiOrigin } from './nav'

/**
 * One public API read, re-read on the cadence the page states. Same shape the docs pages used with a one-shot
 * fetch: null while the first read is out, 'error' when no read has ever worked, else the last good body
 * (a failed poll keeps the last good one on screen).
 */
export function useApi<T>(path: string, everyMs = 60_000): T | null | 'error' {
  const { data, loading } = useLiveSeries<T>(
    (signal) =>
      fetch(`${apiOrigin()}${path}`, { signal, headers: { accept: 'application/json' } }).then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(String(r.status))))),
    everyMs,
  )
  if (data !== undefined) return data
  return loading ? null : 'error'
}
