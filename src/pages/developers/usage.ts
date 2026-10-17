import type { AlertsView, Range, Usage, UsagePoint } from './api'
import type { BarColumn } from './charts'

/* Turning GET /api/developer/usage into what the console draws. Only regrouping: the 7-day range
   arrives as 168 hourly buckets and is shown as 28 six-hour bars; nothing is estimated. */

export const RANGE_LABEL: Record<Range, string> = { '24h': '24 hours', '7d': '7 days', '30d': '30 days' }

/** How many raw buckets make one bar. */
const GROUP: Record<Range, number> = { '24h': 1, '7d': 6, '30d': 1 }

export interface Grouped {
  t: string
  end: number
  total: number
  limited: number | undefined
  keys: Record<string, number>
}

export function group(usage: Usage): Grouped[] {
  const g = GROUP[usage.range] ?? 1
  const size = usage.bucket === 'day' ? 86_400_000 : 3_600_000
  const out: Grouped[] = []
  const hasLimited = usage.points.every((p) => typeof p.limited === 'number')
  for (let i = 0; i < usage.points.length; i += g) {
    const slice: UsagePoint[] = usage.points.slice(i, i + g)
    const keys: Record<string, number> = {}
    for (const p of slice) for (const [k, v] of Object.entries(p.keys)) keys[k] = (keys[k] ?? 0) + v
    out.push({
      t: slice[0].t,
      end: Date.parse(slice[slice.length - 1].t) + size,
      total: slice.reduce((a, p) => a + p.total, 0),
      limited: hasLimited ? slice.reduce((a, p) => a + (p.limited ?? 0), 0) : undefined,
      keys,
    })
  }
  return out
}

const time = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
const day = (ms: number, utc = false) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(utc ? { timeZone: 'UTC' } : {}) })

export function columns(usage: Usage, grouped: Grouped[]): BarColumn[] {
  return grouped.map((b) => {
    const start = Date.parse(b.t)
    const label = usage.bucket === 'day' ? day(start, true) : usage.range === '7d' ? day(start) : time(start)
    const long = usage.bucket === 'day' ? `${day(start, true)} (UTC day)` : usage.range === '7d' ? `${day(start)} ${time(start)}–${time(b.end)}` : `${day(start)} ${time(start)}–${time(b.end)}`
    return { label, long, values: b.keys, total: b.total, limited: b.limited }
  })
}

/** Non-test alert firings (one per delivery id, whatever the number of channels) since `from`. */
export function firings(view: AlertsView, from: number) {
  const seen = new Map<string, { at: number; telegram: boolean }>()
  for (const a of view.alerts)
    for (const d of a.deliveries) {
      if (d.test) continue
      const at = Date.parse(d.at)
      if (at < from) continue
      const k = `${a.id}:${d.id}`
      const prev = seen.get(k)
      seen.set(k, { at, telegram: (prev?.telegram ?? false) || d.channel === 'telegram' })
    }
  return [...seen.values()]
}

/** Counts events (timestamps) into the given bars. */
export function bucketize(times: number[], grouped: Grouped[]) {
  const out = grouped.map(() => 0)
  for (const t of times) {
    const i = grouped.findIndex((b) => t >= Date.parse(b.t) && t < b.end)
    if (i >= 0) out[i]++
  }
  return out
}

/** The busiest single key over one raw bucket, as an average per minute. */
export function busiestKeyRate(usage: Usage) {
  const minutes = usage.bucket === 'day' ? 1440 : 60
  let best = 0
  for (const p of usage.points) for (const v of Object.values(p.keys)) best = Math.max(best, v)
  return { perMin: best / minutes, over: usage.bucket }
}
