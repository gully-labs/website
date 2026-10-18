// One-click sign-in to Gully Analytics from the developer portal ("Open Gully Analytics").
//
//   POST /api/developer/analytics/sso   (portal session + CSRF header; role developer or above, via the
//        gate in developer.mjs: the 'analytics' write category)  -> 201 { url, expiresAt }
//   GET  analytics.gullylabs.xyz/sso?code=…   (analytics.mjs) exchanges the code here, server side, and
//        answers a tiny page that stores the Umami token where Umami's client reads it
//        (localStorage 'umami.auth', JSON-encoded: src/lib/constants.ts AUTH_TOKEN, src/lib/storage.ts)
//        and moves on to /dashboard.
//
// Security:
// - The code is 32 random bytes (base64url), lives 60 seconds, works once, and only its SHA-256 is kept
//   (in memory: a restart simply voids open codes). A wrong or reused code answers the same page.
// - It is bound loosely to the browser that asked for it: the same User-Agent, and the same /24 (IPv4) or
//   /48 (IPv6) network. A dual-stack browser may reach the two hosts over different IP families, so a
//   family change alone is not refused.
// - Rate limits: 10 codes per wallet per 10 minutes; 20 failed exchanges per IP per 10 minutes.
// - The token is minted for the workspace's Umami user (umami.mjs mintUserToken) without reading,
//   exposing or changing its password, and expires after SSO_SESSION_SEC. The Umami user is looked up
//   first, so a deleted account cannot be signed in to.
// - The token never appears in a URL or a log; the exchange page is no-store, no-referrer, and its one
//   inline script runs under a per-response CSP nonce.

import crypto from 'node:crypto'
import { wordmarkSvg } from './brand.mjs'
import { clientIp, json } from './http.mjs'
import { getUser, mintUserToken, ssoConfigured, SSO_SESSION_SEC } from './umami.mjs'

export const SSO_CODE_TTL_MS = 60_000
const codes = new Map() // sha256(code) -> { address, umamiUserId, uaHash, net, expiresAt, actor }
const hits = new Map()

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex')
const publicOrigin = () => String(process.env.ANALYTICS_PUBLIC_ORIGIN ?? 'https://analytics.gullylabs.xyz').replace(/\/+$/, '')
const portalUrl = () => String(process.env.PORTAL_PUBLIC_URL ?? 'https://app.gullylabs.xyz/#analytics')

function allow(bucket, who, max, ms) {
  const k = `${bucket}:${who}`
  const now = Date.now()
  const list = (hits.get(k) ?? []).filter((t) => now - t < ms)
  if (list.length >= max) {
    hits.set(k, list)
    return false
  }
  list.push(now)
  hits.set(k, list)
  return true
}

setInterval(() => {
  const now = Date.now()
  for (const [k, c] of codes) if (c.expiresAt <= now) codes.delete(k)
  for (const [k, list] of hits) if (!list.some((t) => now - t < 600_000)) hits.delete(k)
}, 30_000).unref?.()

/** The caller's network, loosely: IPv4 /24 or IPv6 /48, with its family. */
export function netOf(ip) {
  const s = String(ip).replace(/^::ffff:/, '')
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return { family: 4, prefix: s.split('.').slice(0, 3).join('.') }
  if (s.includes(':')) {
    const parts = s.split('::')[0].split(':')
    return { family: 6, prefix: parts.slice(0, 3).join(':').toLowerCase() }
  }
  return { family: 0, prefix: s }
}

const sameNet = (a, b) => a.family !== b.family || a.prefix === b.prefix

/** POST /api/developer/analytics/sso for the workspace account `acc` (analytics-accounts.mjs). */
export async function issueSso(req, res, acc, statusOf) {
  const actor = req.gully?.user ?? acc.address
  if (!ssoConfigured()) return json(res, 503, { error: 'One-click sign-in is not switched on on this server. Sign in with your Gully Analytics password instead.', code: 'sso-off' }), true
  if (statusOf(acc).deletable) return json(res, 410, { error: 'This Gully Analytics account has lapsed past its grace period.' }), true
  if (!allow('sso-issue', actor, 10, 600_000)) return json(res, 429, { error: 'Too many sign-in links in the last ten minutes. Try again shortly.' }), true
  const u = await getUser(acc.umamiUserId)
  if (!u.ok) return json(res, u.status === 404 ? 410 : u.status, { error: u.status === 404 ? 'The Gully Analytics user for this workspace no longer exists. Write to hello@gullylabs.xyz.' : u.error }), true
  const code = crypto.randomBytes(32).toString('base64url')
  const expiresAt = Date.now() + SSO_CODE_TTL_MS
  codes.set(sha256(code), { address: acc.address, umamiUserId: acc.umamiUserId, role: u.data?.role === 'view-only' ? 'view-only' : 'user', uaHash: sha256(req.headers['user-agent'] ?? ''), net: netOf(clientIp(req)), expiresAt, actor })
  return json(res, 201, { url: `${publicOrigin()}/sso?code=${code}`, expiresAt: new Date(expiresAt).toISOString(), sessionHours: SSO_SESSION_SEC / 3600 }), true
}

/** Spends a code. Returns { ok, token } or { ok: false, reason }. */
export function exchangeSso(req, code) {
  const ip = clientIp(req)
  const fail = (reason) => {
    allow('sso-fail', ip, 1e9, 600_000) // counted below
    return { ok: false, reason }
  }
  const failures = (hits.get(`sso-fail:${ip}`) ?? []).filter((t) => Date.now() - t < 600_000).length
  if (failures >= 20) return { ok: false, reason: 'limited' }
  if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) return fail('invalid')
  const key = sha256(code)
  const c = codes.get(key)
  if (!c) return fail('invalid')
  codes.delete(key) // single use, whatever happens next
  if (c.expiresAt <= Date.now()) return fail('expired')
  if (c.uaHash !== sha256(req.headers['user-agent'] ?? '') || !sameNet(c.net, netOf(ip))) return fail('browser')
  return { ok: true, token: mintUserToken(c.umamiUserId, c.role), address: c.address, actor: c.actor }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The branded shell shared by the proxy's own pages (the SSO exchange and the login interstitial). */
export function brandPage({ title, body, nonce = null, script = '', status = 200 }) {
  const csp = [
    "default-src 'none'",
    `script-src ${nonce ? `'nonce-${nonce}'` : "'none'"}`,
    "style-src 'unsafe-inline'",
    "img-src 'self' https://gullylabs.xyz data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title>
<style>
:root{color-scheme:dark;--bg:#0d141c;--surface:#151d28;--line:#1f2935;--ink:#f4f2ec;--muted:#aeb5be;--gold:#d9b563}
*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 "Hanken Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px 16px}
.card{width:100%;max-width:440px;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:32px 28px}
.brand{display:flex;align-items:center;gap:10px;font:500 12px/1 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);text-decoration:none;min-height:44px}
.brand svg{display:block;height:22px;width:auto}.eyebrow{font:500 12px/1.4 "IBM Plex Mono",ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 0 6px}
h1{font:800 34px/1.05 "Barlow Condensed",system-ui,sans-serif;text-transform:uppercase;margin:0 0 10px}p{color:var(--muted);margin:0 0 18px}
.btn{display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:999px;font-weight:600;text-decoration:none;margin-top:12px;padding:0 20px;text-align:center}
.primary{background:var(--gold);color:#0d141c}.ghost{border:1px solid var(--line);color:var(--ink)}
.btn:focus-visible,a:focus-visible{outline:2px solid var(--gold);outline-offset:3px}
.links{margin-top:22px;border-top:1px solid var(--line);padding-top:14px;display:grid;gap:2px}.links a{color:var(--muted);text-decoration:none;min-height:44px;display:flex;align-items:center}.links a b{color:var(--gold);font-weight:600;margin-left:6px}
.spin{width:28px;height:28px;border-radius:50%;border:3px solid var(--line);border-top-color:var(--gold);animation:s .8s linear infinite;margin:8px 0 18px}@keyframes s{to{transform:rotate(1turn)}}
@media (prefers-reduced-motion:reduce){.spin{animation-duration:2.4s}}
</style></head><body><main class="card">${body}</main>${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`
  return {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': csp,
      'X-Robots-Tag': 'noindex',
    },
    html,
  }
}

// The brand kit's wordmark (server/brand.mjs, inline SVG: the kit's outlined paths, so no font or image request).
const BRAND = `<a class="brand" href="https://gullylabs.xyz/">${wordmarkSvg({ height: 22, theme: 'dark', id: 'sso' })}<span>Analytics</span></a>`

/** GET /sso?code=… on the analytics host. */
export function ssoPage(req, url) {
  const r = exchangeSso(req, url.searchParams.get('code'))
  if (!r.ok) {
    const why = r.reason === 'limited' ? 'Too many sign-in attempts from this network. Wait ten minutes, then open Gully Analytics from the developer portal again.' : r.reason === 'browser' ? 'This sign-in link was made for another browser. Open Gully Analytics from the developer portal in this browser.' : 'This sign-in link has expired or was already used. Links work once, for 60 seconds.'
    return brandPage({
      title: 'Sign-in link expired · Gully Analytics',
      status: r.reason === 'limited' ? 429 : 410,
      body: `${BRAND}<p class="eyebrow">One-click sign-in</p><h1>Link expired</h1><p>${esc(why)}</p><a class="btn primary" href="${esc(portalUrl())}">Open the developer portal</a><a class="btn ghost" href="/login?form=password">Sign in with a password</a>`,
    })
  }
  const nonce = crypto.randomBytes(16).toString('base64')
  // The token goes into Umami's own storage slot, JSON-encoded as its setItem does, then the code leaves
  // the address bar and history before the dashboard loads.
  const script = `try{localStorage.setItem('umami.auth',${JSON.stringify(JSON.stringify(r.token)).replace(/</g, '\\u003c')})}catch(e){}history.replaceState(null,'','/sso');location.replace('/dashboard')`
  return brandPage({
    title: 'Signing in · Gully Analytics',
    nonce,
    script,
    body: `${BRAND}<p class="eyebrow">One-click sign-in</p><h1>Signing you in</h1><div class="spin" role="status" aria-label="Signing in"></div><p>Opening your dashboard…</p><noscript><p>Gully Analytics needs JavaScript.</p></noscript>`,
  })
}

/** GET /login on the analytics host (document navigations only): the branded way in. */
export function loginInterstitial(trialDays) {
  const portal = esc(portalUrl())
  return brandPage({
    title: 'Sign in · Gully Analytics',
    body: `${BRAND}<p class="eyebrow">Gully Analytics</p><h1>Sign in</h1><p>Your dashboard opens straight from the developer portal, signed in with your wallet. No password needed.</p>
<a class="btn primary" href="${portal}">Sign in from the developer portal</a>
<a class="btn ghost" href="/login?form=password">Sign in with username and password</a>
<nav class="links" aria-label="Account help"><a href="${portal}">Forgot password?<b>Reset it in the portal</b></a><a href="${portal}">No account?<b>Start the ${esc(trialDays)}-day free trial</b></a></nav>`,
  })
}

/** Tests only. */
export const ssoCodeCountForTest = () => codes.size
