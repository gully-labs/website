/** Types for gas.mjs (GET /api/pay/gas). The answer's shape is typed in src/pages/developers/api.ts. */
import type { IncomingMessage, ServerResponse } from 'node:http'
export const GAS: { approve: bigint; pay: bigint; transfer: bigint }
export const CACHE_MS: number
export function readGas(opts?: { fresh?: boolean }): Promise<unknown>
export function clearGasCacheForTest(): void
export function handleGas(req: IncomingMessage, res: ServerResponse): Promise<void>
