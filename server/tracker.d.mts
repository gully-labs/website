/** Types for tracker.mjs. The document shape is `Tracker` in src/lib/tracker.ts. */
export function readTracker(): Promise<unknown>
export function readHistory(chain: string, ticker: string): [number, number, number, number][]
export function readMovers(window?: string): Promise<import('./movers.mjs').MoversFull>
export function readHistoryDays(chain: string, ticker: string, days: number): [number, number, number, number][]
export function startTrackerLoop(): unknown
export function onSnapshot(fn: (rows: unknown[], at: number) => unknown): () => boolean
export function recordSnapshotForTest(rows: unknown[], at?: number): void
export function trackedStocks(): { chain: string; ticker: string; name: string }[]
export function sessionOpen(session: string, at?: Date): boolean
export const MIN_LIQUIDITY_USD: number
export const IN_LINE_PCT: number
export const FLAG_PCT: number
export function trackerHealth(): unknown
export const DEEPCORE_CL_POOL_MANAGER: string
export function isDeepcorePool(p: { dex?: string | null; poolManager?: string | null } | null | undefined): boolean
export function onchainPriceCall(chain: { stateView: string | null; deepcoreCl?: string | null }, p: { pair?: string | null; dex?: string | null; poolManager?: string | null } | null | undefined): { to: string; data: string } | null
