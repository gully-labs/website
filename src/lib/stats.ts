/* The /api/stats document (server/stats.mjs), typed, plus the formatting every surface
   shares. A figure is a number or `null` (not published / not measurable); a venue is
   `ok` or `error`. Nothing here invents a value for a missing one. */

export interface Point {
  t: number
  v: number
}

export interface VenueOk {
  key: string
  state: 'ok'
  volume24hUsd: number | null
  volumeAllUsd?: number | null
  tvlUsd: number | null
  fees24hUsd: number | null
  feesNative?: { symbol: string; amount: number } | null
  daily: Point[]
  counts: Record<string, number | null | undefined>
  notes: string[]
  source: { url: string; readAt: string }
}

export interface VenueError {
  key: string
  state: 'error'
  error: string
}

export type Venue = VenueOk | VenueError

export interface Stats {
  generatedAt: string
  totals: {
    volume24hUsd: number | null
    tvlUsd: number | null
    fees24hUsd: number | null
    covers: { volume24hUsd: string[]; tvlUsd: string[]; fees24hUsd: string[] }
    unread: string[]
  }
  daily: Point[]
  venues: Venue[]
}

export async function fetchStats(): Promise<Stats> {
  const res = await fetch('/api/stats', { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`stats ${res.status}`)
  return (await res.json()) as Stats
}

export function fmtUsd(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  const a = Math.abs(v)
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `$${(v / 1e3).toFixed(1)}K`
  if (a >= 1e3) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export const fmtTime = (iso: string) =>
  `${new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' })} UTC`

export const fmtDay = (t: number) => new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** The host part of a source URL, for provenance lines. */
export const sourceHost = (url: string) => url.replace(/^https:\/\//, '').split(' ')[0].replace(/\/$/, '')

export interface Metric {
  label: string
  value: string
  /** `null` figure: the venue does not publish it. */
  missing?: boolean
}

/** The two figures a project tile shows for a venue, chosen per venue by what it publishes. */
export function metricsOf(v: Venue | undefined): [Metric, Metric] {
  if (!v) return [{ label: 'READING', value: '…' }, { label: '', value: '' }]
  if (v.state === 'error') return [{ label: 'STATUS', value: 'Unreadable', missing: true }, { label: 'SOURCE', value: 'its own API' }]
  const usd = (label: string, n: number | null | undefined): Metric => ({ label, value: fmtUsd(n), missing: n === null || n === undefined })
  switch (v.key) {
    case 'cartel-family':
      return [usd('VOLUME 24H', v.volume24hUsd), usd('VOLUME ALL-TIME', v.volumeAllUsd)]
    case 'peddles':
      return [
        usd('TVL', v.tvlUsd),
        v.feesNative
          ? { label: 'CREATOR FEES 24H', value: `${v.feesNative.amount.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${v.feesNative.symbol}` }
          : { label: 'CREATOR FEES 24H', value: '—', missing: true },
      ]
    case 'peddlequest':
      return [{ label: 'MODEL', value: 'Quest to earn' }, { label: 'CHAINS', value: '4' }]
    default:
      return [usd('TVL', v.tvlUsd), usd('VOLUME 24H', v.volume24hUsd)]
  }
}
