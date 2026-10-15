/** Types for stats.mjs, the cross-venue aggregator. The document shape is `Stats` in src/lib/stats.ts. */
export interface StatsDocument {
  generatedAt: string
  totals: {
    volumeAllUsd: number | null
    volume24hUsd: number | null
    tvlUsd: number | null
    fees24hUsd: number | null
    covers: { volumeAllUsd: string[]; volume24hUsd: string[]; tvlUsd: string[]; fees24hUsd: string[] }
    unread: string[]
  }
  daily: { t: number; v: number }[]
  venues: unknown[]
}
export const VENUES: { key: string; read: () => Promise<unknown> }[]
export function readStats(): Promise<StatsDocument>
