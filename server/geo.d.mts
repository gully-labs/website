import type { IncomingMessage } from 'node:http'

/** See geo.mjs. */
export const SWAP_BLOCKED: Set<string>
export function geoFor(req: IncomingMessage, isLocal: boolean): { country: string | null; allowed: boolean; reason: 'ok' | 'blocked' | 'unknown' | 'local' }
