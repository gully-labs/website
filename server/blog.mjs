// blog.gullylabs.xyz: a reverse proxy to the self-hosted Ghost container (gully-blog on the
// gully_default network). Cloudflare sends every request on the zone to this server, so the blog
// is reached through here rather than through a port of its own.
//
// Ghost's first-run setup (creating the owner account) is open to whoever reaches it first. Until
// the owner has done it, the setup call is refused unless the browser carries a cookie that only a
// visit to /__blog-setup?token=<BLOG_SETUP_TOKEN> sets. The token lives in the box's .env only.

import http from 'node:http'
import crypto from 'node:crypto'

const UPSTREAM = new URL(process.env.BLOG_UPSTREAM ?? 'http://gully-blog:2368')
const SETUP_COOKIE = 'gully_blog_setup'

const same = (a, b) => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}
const cookie = (req, name) =>
  String(req.headers.cookie ?? '')
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === name)?.[1]

export function handleBlog(req, res, url) {
  const token = process.env.BLOG_SETUP_TOKEN ?? ''

  if (url.pathname === '/__blog-setup') {
    if (token.length < 24 || !same(url.searchParams.get('token') ?? '', token)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('Wrong or missing setup token.')
    }
    res.writeHead(302, {
      Location: '/ghost/#/setup',
      'Set-Cookie': `${SETUP_COOKIE}=${token}; Path=/ghost; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`,
      'Cache-Control': 'no-store',
    })
    return res.end()
  }

  if (url.pathname.startsWith('/ghost/api/admin/authentication/setup') && req.method !== 'GET') {
    if (token.length < 24 || !same(cookie(req, SETUP_COOKIE) ?? '', token)) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ errors: [{ message: 'Blog setup is locked. Open the setup link from the server first.' }] }))
    }
  }

  const headers = { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-host': req.headers.host ?? '', 'x-forwarded-for': String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? '') }
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
    res.end('<!doctype html><title>Gully Labs blog</title><body style="background:#0b0e13;color:#a6b0bd;font:16px system-ui;padding:48px">The blog is starting or unavailable. Try again in a minute. <a style="color:#e8c060" href="https://gullylabs.xyz/">Back to Gully Labs</a></body>')
  })
  req.pipe(upstream)
}
