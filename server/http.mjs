// Small HTTP helpers shared by the server modules (server.mjs, admin.mjs, developer.mjs).
// Both the production server and the Vite dev middleware pass Node's req/res, so these work in both.

export const DATA_DIR = process.env.DATA_DIR ?? process.env.TRACKER_DATA?.replace(/\/[^/]+$/, '') ?? '.data'

export function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
  res.end(JSON.stringify(body))
}

/** Reads a JSON body, capped at `max` bytes. Resolves to null on bad JSON. */
export function readJson(req, max = 20_000) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > max) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || 'null'))
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

/** The caller's IP: Cloudflare's header first (the box sits behind Cloudflare), then the socket. */
export function clientIp(req) {
  return String(req.headers['cf-connecting-ip'] ?? req.socket?.remoteAddress ?? 'unknown')
}

/** Bearer token from the Authorization header, or null. */
export function bearer(req) {
  const h = String(req.headers.authorization ?? '')
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null
}
