/** Types for movers.mjs. The client-side shape is `Movers` in src/lib/tracker.ts. */
export type MoverWindow = '1h' | '24h'
export interface MoversFull {
  window: MoverWindow
  byGap: unknown[]
  byPrice: unknown[]
  [k: string]: unknown
}
export const MOVER_WINDOWS: Record<MoverWindow, number>
export const MOVER_TOLERANCE: Record<MoverWindow, number>
export const LATEST_MAX_AGE_S: number
export function computeMovers(o: { rows: unknown[]; historyOf: (chain: string, ticker: string) => [number, number, number, number][]; window?: string; now?: number }): MoversFull
export function shapeMovers(full: MoversFull, o?: { limit?: number; chain?: string | null; ticker?: string | null }): Record<string, unknown>
