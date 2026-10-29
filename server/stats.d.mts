/** Types for stats.mjs, the cross-venue aggregator. The document shape is `Stats` in src/lib/stats.ts. */
export interface StatsDocument {
  generatedAt: string
  totals: {
    volumeAllUsd: number | null
    volume24hUsd: number | null
    tvlUsd: number | null
    fees24hUsd: number | null
    feesAllUsd: number | null
    covers: { volumeAllUsd: string[]; volume24hUsd: string[]; tvlUsd: string[]; fees24hUsd: string[]; feesAllUsd: string[] }
    unread: string[]
  }
  daily: { t: number; v: number }[]
  lastActivity: string | null
  venues: unknown[]
}
export const VENUES: { key: string; read: () => Promise<unknown> }[]
export function readStats(): Promise<StatsDocument>
export function resetStatsForTest(o?: { documentOnly?: boolean }): void
export interface SeriesSource {
  name: string
  url: string | null
  fallback: boolean
}
export function buildSeries(spec: Record<string, unknown>): Promise<{
  series: { volume: { t: number; v: number }[]; fees: { t: number; v: number }[]; tvl: { t: number; v: number }[] }
  sources: { volume: SeriesSource | null; fees: SeriesSource | null; tvl: SeriesSource | null }
  lastActivity: string | null
  notes: string[]
  llama: Record<string, unknown>
}>
