// analytics.gullylabs.xyz: a reverse proxy to Gully Analytics (our Umami fork, container
// gully-analytics on the gully_default network). Cloudflare sends every request on the zone to this
// server, so the analytics app is reached through here, like the blog.
//
// Tracker calls are the one thing looked at on the way: POST /api/send ({ type, payload: { website } })
// and POST /api/batch (an array of those, Umami 3.4 src/app/api/batch/route.ts). Their JSON body (at most
// 64 KB) is read, and events for a self-serve website whose account has lapsed, is over its monthly quota
// or is beyond its plan's website count are answered 402 here without reaching Umami
// (analytics-accounts.mjs decides, from memory). Accepted events are counted per website per month.
// Websites not created through self-serve, like the Gully Labs site itself, are never blocked.
// Everything else streams through untouched.

import http from 'node:http'
import { admitEvents, recordEvents } from './analytics-accounts.mjs'

const UPSTREAM = new URL(process.env.ANALYTICS_UPSTREAM ?? 'http://gully-analytics:3000')
const MAX_EVENT_BODY = 64 * 1024

function forwardHeaders(req) {
  return {
    ...req.headers,
    'x-forwarded-proto': 'https',
    'x-forwarded-host': req.headers.host ?? '',
    // Umami reads the visitor's address for country and unique-visitor counts.
    'x-forwarded-for': String(req.headers['cf-connecting-ip'] ?? req.socket.remoteAddress ?? ''),
  }
}

function unavailable(res) {
  if (res.headersSent) return res.destroy()
  res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '30' })
  res.end('<!doctype html><title>Gully Analytics</title><body style="background:#0b0e13;color:#a6b0bd;font:16px system-ui;padding:48px">Gully Analytics is starting or unavailable. Try again in a minute. <a style="color:#e8c060" href="https://gullylabs.xyz/">Back to Gully Labs</a></body>')
}

/** Sends one request upstream; `body` is a Buffer (already read) or null to stream `req`. */
function forward(req, res, body, onStatus) {
  const headers = forwardHeaders(req)
  if (body) {
    headers['content-length'] = String(body.length)
    delete headers['transfer-encoding']
  }
  const upstream = http.request({ hostname: UPSTREAM.hostname, port: UPSTREAM.port || 80, path: req.url, method: req.method, headers, timeout: 60_000 }, (up) => {
    onStatus?.(up.statusCode ?? 502)
    res.writeHead(up.statusCode ?? 502, up.headers)
    up.pipe(res)
  })
  upstream.on('timeout', () => upstream.destroy(new Error('timeout')))
  upstream.on('error', () => unavailable(res))
  if (body) upstream.end(body)
  else req.pipe(upstream)
}

// The tracker reads `disabled` from any answer and stops sending for the rest of the page view.
function refuse(req, res, block) {
  const origin = req.headers.origin
  res.writeHead(402, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': origin ? String(origin) : '*',
    ...(origin ? { 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' } : {}),
  })
  res.end(JSON.stringify({ error: { message: block.message, code: block.code, status: 402 }, disabled: true }))
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    let over = false
    req.on('data', (c) => {
      if (over) return
      size += c.length
      if (size > MAX_EVENT_BODY) {
        over = true
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks)))
    req.on('error', () => resolve(null))
  })
}

async function handleEvents(req, res, batch) {
  const body = await readBody(req)
  if (!body) {
    res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    return res.end(JSON.stringify({ error: { message: 'Tracker calls are limited to 64 KB.', code: 'payload-too-large', status: 413 } }))
  }
  let parsed
  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch {
    return forward(req, res, body) // Umami answers malformed bodies itself.
  }
  const items = batch ? (Array.isArray(parsed) ? parsed : null) : [parsed]
  if (!items) return forward(req, res, body)
  const ids = items.map((it) => (typeof it?.payload?.website === 'string' ? it.payload.website.toLowerCase() : null))
  const verdicts = admitEvents(ids)
  const keep = items.filter((_, i) => verdicts[i].ok)
  if (!keep.length) return refuse(req, res, verdicts.find((v) => !v.ok).block)
  const counts = new Map()
  ids.forEach((id, i) => id && verdicts[i].ok && counts.set(id, (counts.get(id) ?? 0) + 1))
  const out = keep.length === items.length ? body : Buffer.from(JSON.stringify(keep))
  forward(req, res, out, (status) => status < 400 && recordEvents(counts))
}

export function handleAnalytics(req, res) {
  const path = String(req.url ?? '/').replace(/\?.*$/, '')
  if (req.method === 'POST' && (path === '/api/send' || path === '/api/batch')) return handleEvents(req, res, path === '/api/batch')
  forward(req, res, null)
}
