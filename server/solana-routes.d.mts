import type { IncomingMessage, ServerResponse } from 'node:http'

/** See solana-routes.mjs. Resolves to false when the path is not a Solana route. */
export function handleSolana(req: IncomingMessage, res: ServerResponse, url: URL, geo: { allowed: boolean; reason: string }): Promise<boolean>
