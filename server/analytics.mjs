// analytics.gullylabs.xyz: a reverse proxy to Gully Analytics (our Umami fork, container
// gully-analytics on the gully_default network). Cloudflare sends every request on the zone to this
// server, so the analytics app is reached through here, like the blog.

import http from 'node:http'

const UPSTREAM = new URL(process.env.ANALYTICS_UPSTREAM ?? 'http://gully-analytics:3000')

export function handleAnalytics(req, res) {
  const headers = {
    ...req.headers,
    'x-forwarded-proto': 'https',
    'x-forwarded-host': req.headers.host ?? '',
    // Umami reads the visitor's address for country and unique-visitor counts.
    'x-forwarded-for': String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? ''),
  }
  const upstream = http.request(
    { hostname: UPSTREAM.hostname, port: UPSTREAM.port || 80, path: req.url, method: req.method, headers, timeout: 60_000 },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    },
  )
  upstream.on('timeout', () => upstream.destroy(new Error('timeout')))
  upstream.on('error', () => {
    if (res.headersSent) return res.destroy()
    res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '30' })
    res.end('<!doctype html><title>Gully Analytics</title><body style="background:#0b0e13;color:#a6b0bd;font:16px system-ui;padding:48px">Gully Analytics is starting or unavailable. Try again in a minute. <a style="color:#e8c060" href="https://gullylabs.xyz/">Back to Gully Labs</a></body>')
  })
  req.pipe(upstream)
}
