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

/**
 * An upstream error, safe to send to a browser. RPC and fetch errors carry the upstream URL (viem prints
 * "URL: https://host/<api key>"), hosts, IPs and file paths; none of that leaves the server. The full error is
 * logged here instead. Leak sweep 2026-11-02.
 */
export function publicError(err, fallback = 'An upstream data source is unavailable right now. Try again shortly.') {
  const raw = String(err?.shortMessage ?? err?.message ?? err ?? '')
  console.error('[upstream]', raw.slice(0, 2000))
  const first = raw.split('\n')[0].trim()
  // Only a short, plain sentence passes: no URL or scheme, no IP, no path, no host:port, no long token, no errno.
  const unsafe =
    /[a-z][a-z0-9+.-]*:\/\//i.test(first) ||
    /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(first) ||
    /(?:^|[^\w.])\/[\w.@-]+\/[\w.@-]+/.test(first) ||
    /\b[\w-]+\.[a-z]{2,}:\d+\b/i.test(first) ||
    /[0-9a-f]{1,4}::?[0-9a-f]{1,4}:[0-9a-f]{1,4}/i.test(first) ||
    /[A-Za-z0-9_-]{32,}/.test(first) ||
    /\b(?:ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|EHOSTUNREACH)\b/.test(first) ||
    /[@\\]/.test(first)
  return first && first.length <= 160 && !unsafe ? first : fallback
}

/** Bearer token from the Authorization header, or null. */
export function bearer(req) {
  const h = String(req.headers.authorization ?? '')
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null
}
