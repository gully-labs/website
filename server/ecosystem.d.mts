import type { IncomingMessage, ServerResponse } from 'node:http'

/** See ecosystem.mjs. Resolves to false when the path is not an ecosystem route. */
export function handleEcosystem(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean>
