/* The pure side of the home ledger chart (components/landing/LedgerChart.tsx): which days a window
   holds, what each venue read on each day, which metric to open on, and when the honest answer is
   "nothing in this window". No React and no value invented: a day a venue has no reading for is
   `null`, never zero, and value locked (a stock, not a flow) carries a venue's last reading forward
   across a gap of at most STALE_DAYS, which is how a daily source that lags a day still draws today. */
import type { Metric, Point, VenueOk } from './stats'

export const DAY = 86400
export const STALE_DAYS = 3
export const METRICS: Metric[] = ['tvl', 'volume', 'fees']
export const METRIC_LABEL: Record<Metric, string> = { tvl: 'Value locked', volume: 'Volume', fees: 'Fees' }
export type Range = 7 | 30

/** A venue's daily points for a metric: the new `series`, or the older `daily` for volume. */
export function pointsOf(v: VenueOk, m: Metric): Point[] {
  return v.series?.[m] ?? (m === 'volume' ? v.daily : [])
}

/** The `range` consecutive UTC days ending at the newest point of any venue; [] when nobody has a point. */
export function windowDays(venues: VenueOk[], m: Metric, range: number): number[] {
  let end = -Infinity
  for (const v of venues) {
    const pts = pointsOf(v, m)
    if (pts.length) end = Math.max(end, pts[pts.length - 1].t)
  }
  if (!Number.isFinite(end)) return []
  return Array.from({ length: range }, (_, i) => end - (range - 1 - i) * DAY)
}

/** What the venue read on day `t`; null when it has no reading (tvl: carried from the last one within STALE_DAYS). */
export function valueOn(v: VenueOk, m: Metric, t: number): number | null {
  const pts = pointsOf(v, m)
  const hit = pts.find((p) => p.t === t)
  if (hit) return hit.v
  if (m !== 'tvl') return null
  let prior: Point | null = null
  for (const p of pts) if (p.t < t) prior = p
  return prior && t - prior.t <= STALE_DAYS * DAY ? prior.v : null
}

/** True when any venue has a non-zero reading on any of `days`. */
export function hasData(venues: VenueOk[], m: Metric, days: number[]): boolean {
  return venues.some((v) => days.some((t) => (valueOn(v, m, t) ?? 0) > 0))
}

/** The metric to open on: volume when trades happened in the window, else value locked, else fees. */
export function autoMetric(venues: VenueOk[], range: number): Metric {
  for (const m of ['volume', 'tvl', 'fees'] as Metric[]) if (hasData(venues, m, windowDays(venues, m, range))) return m
  return 'tvl'
}

/** Seconds of the newest non-zero day of a metric across `venues` (volume prefers the server's `lastActivity`); null if none. */
export function lastActive(venues: VenueOk[], m: Metric): number | null {
  let best: number | null = null
  for (const v of venues) {
    const pts = pointsOf(v, m)
    for (let i = pts.length - 1; i >= 0; i--)
      if (pts[i].v > 0) {
        best = Math.max(best ?? 0, pts[i].t)
        break
      }
    if (m === 'volume' && v.lastActivity) best = Math.max(best ?? 0, Math.floor(Date.parse(v.lastActivity) / 1000))
  }
  return best
}

/** The line under an empty chart. Honest about what is missing and when it last was not. */
export function emptyLine(m: Metric, daysCount: number, last: number | null, fmtDay: (t: number) => string): string {
  const what = m === 'volume' ? 'trades' : m === 'fees' ? 'fees' : 'value locked'
  const lastWhat = m === 'volume' ? 'last trade' : m === 'fees' ? 'last fees' : 'last reading above zero'
  return `No ${what} in the last ${daysCount} days · ${last === null ? `${lastWhat} not on record` : `${lastWhat} ${fmtDay(last)}`}`
}

/** The points for a sparkline: the metric asked for when it has any activity, else the first metric that does
    (volume, value locked, fees), else the asked-for series as it is. Returns the metric used with the points. */
export function sparkPoints(v: VenueOk, want: Metric): { metric: Metric; points: Point[] } {
  const active = (m: Metric) => pointsOf(v, m).slice(-30).some((p) => p.v > 0)
  const metric = active(want) ? want : (['volume', 'tvl', 'fees'] as Metric[]).find(active) ?? want
  return { metric, points: pointsOf(v, metric) }
}
