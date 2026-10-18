import type { IncomingMessage, ServerResponse } from 'node:http'

/** See holders.mjs. Resolves to false when the path is not a Holder Map route. */
export function handleHolders(req: IncomingMessage, res: ServerResponse, url: URL, access?: { plan?: string } | null): Promise<boolean>
