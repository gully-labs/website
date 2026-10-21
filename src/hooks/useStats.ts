import { fetchStats, type Stats } from '../lib/stats'
import { useLiveSeries } from '../components/charts/useLiveSeries'

export type StatsState = { k: 'loading' } | { k: 'error' } | { k: 'ok'; data: Stats }

/** How often /api/stats is read again, and what the pages say ("refreshes every minute"). */
export const STATS_EVERY_MS = 60_000

/** /api/stats, read now and then every minute (the chart kit's useLiveSeries: paused in a hidden tab, refreshed
    at once on return, one request at a time). On a failed refresh the last good read stays on screen. */
export function useStats(): StatsState {
  const { data, loading } = useLiveSeries<Stats>((signal) => fetchStats(signal), STATS_EVERY_MS)
  return data ? { k: 'ok', data } : loading ? { k: 'loading' } : { k: 'error' }
}
