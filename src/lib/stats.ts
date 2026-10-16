/* The /api/stats document (server/stats.mjs), typed, plus the formatting every surface
   shares. A figure is a number or `null` (not published / not measurable); a venue is
   `ok` or `error`. Nothing here invents a value for a missing one. */
import { projects } from '../content/projects'

export interface Point {
  t: number
  v: number
}

export interface VenueOk {
  key: string
  state: 'ok'
  volumeAllUsd: number | null
  /** When the venue's all-time count starts (ISO), so "all-time" is never read as "since genesis". */
  volumeAllSince: string | null
  volume30dUsd?: number | null
  volume24hUsd: number | null
  tvlUsd: number | null
  fees24hUsd: number | null
  feesAllUsd?: number | null
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

export type Figure = 'volumeAllUsd' | 'volume24hUsd' | 'tvlUsd' | 'fees24hUsd' | 'feesAllUsd'

export interface Stats {
  generatedAt: string
  totals: {
    volumeAllUsd: number | null
    volume24hUsd: number | null
    tvlUsd: number | null
    fees24hUsd: number | null
    feesAllUsd: number | null
    covers: Record<Figure, string[]>
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

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/** A venue's display name from its stats key. */
export const nameOf = (key: string) => projects.find((p) => p.key === key)?.name ?? key

/** The host part of a source URL, for provenance lines. */
export const sourceHost = (url: string) => url.replace(/^https:\/\//, '').split(' ')[0].replace(/\/$/, '')

export interface Metric {
  label: string
  value: string
  /** `null` figure: the venue does not publish it. */
  missing?: boolean
}

/** The two figures a project page leads with, chosen per venue by what it publishes. */
export function metricsOf(v: Venue | undefined): [Metric, Metric] {
  if (!v) return [{ label: 'READING', value: '…' }, { label: '', value: '' }]
  if (v.state === 'error') return [{ label: 'STATUS', value: 'Unreadable', missing: true }, { label: 'SOURCE', value: 'its own API' }]
  const usd = (label: string, n: number | null | undefined): Metric => ({ label, value: fmtUsd(n), missing: n === null || n === undefined })
  switch (v.key) {
    case 'cartel-family':
      return [usd('VOLUME ALL-TIME', v.volumeAllUsd), usd('VOLUME 24H', v.volume24hUsd)]
    case 'peddles':
      return [usd('VOLUME ALL-TIME', v.volumeAllUsd), usd('FEES ALL-TIME', v.feesAllUsd)]
    case 'peddlequest':
      return [usd('ESCROWED (TVL)', v.tvlUsd), usd('FEES ALL-TIME', v.feesAllUsd)]
    default:
      return [usd('TVL', v.tvlUsd), usd('VOLUME ALL-TIME', v.volumeAllUsd)]
  }
}
