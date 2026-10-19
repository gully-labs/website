// The app host, in one place for the server (src/site-host.ts holds the same names for the browser).
//
//   app.gullylabs.xyz         the Gully Labs App (the app dashboard: keys, alerts, analytics, payments,
//                             and every service: tracker, Gully Pay, Chain Kit, Gully AI, DeepCore, widgets).
//
// The dashboard's old host (developers.*) was retired on 2026-10-17: its DNS record is gone and nothing
// here routes it any more. The main site's /app and /developers paths still answer 301 to the app.

export const APP_HOST = 'app.gullylabs.xyz'
export const APP_URL = `https://${APP_HOST}`

/** app.* (the dashboard). */
export const isAppHost = (host) => host.startsWith('app.')
/** Production hosts whose SIWE domain the dashboard accepts. */
export const SIGN_IN_HOSTS = [APP_HOST]

/* Public service hosts (added 2026-10-19). One bundle and one server answer all of them; the host decides what
   is served (hostPolicy below, applied in handleRequest in server.mjs).
   pay.gullylabs.xyz         Gully Pay checkout, invoices, pay links, merchant pages and receipts (/pay/*).
   api.gullylabs.xyz         the public API (/api/*), path-compatible with the main host: clients change the host only.
   embed.gullylabs.xyz       widget.js, the Holder Map iframe (/embed/*) and the badges.
   status.gullylabs.xyz      a SEPARATE status service on another server; this server only links to it. */
export const PAY_HOST = 'pay.gullylabs.xyz'
export const PAY_URL = `https://${PAY_HOST}`
export const API_HOST = 'api.gullylabs.xyz'
export const API_URL = `https://${API_HOST}`
export const EMBED_HOST = 'embed.gullylabs.xyz'
export const EMBED_URL = `https://${EMBED_HOST}`
export const STATUS_HOST = 'status.gullylabs.xyz'
export const STATUS_URL = `https://${STATUS_HOST}`
export const MAIN_URL = 'https://gullylabs.xyz'

export const isPayHost = (host) => host.startsWith('pay.')
export const isApiHost = (host) => host.startsWith('api.')
export const isEmbedHost = (host) => host.startsWith('embed.')

/** Where the links the server writes (emails, webhooks, Telegram, statements) send payers. GULLY_PAY_URL overrides. */
export const payBase = () => String(process.env.GULLY_PAY_URL ?? PAY_URL).replace(/\/+$/, '')
/** A full Gully Pay URL for a /pay/... path. */
export const payUrl = (path) => `${payBase()}${path}`

// What each service host answers. Anything else on pay. and embed. goes to the main site (301 for GET/HEAD, JSON 404
// for an /api/ path); on api. anything outside /api/ is a JSON 404. Static files (a path with an extension, and
// /assets/) are served on every host.
const PAY_PAGES = /^\/pay\//
const PAY_APIS = /^\/api\/(pay\/|solana\/|logo(\/|$)|geo$)/
const EMBED_PAGES = /^\/(embed\/|badges\/|score\/[^/]+\/[^/]+\/badge\.svg$)/
const EMBED_APIS = /^\/api\/(holders\/|logo(\/|$)|score\/|tracker(\/|$)|plans$)/
// The session-only dashboard, admin, Telegram and webhook endpoints are not part of the public API host.
const API_DENIED = /^\/api\/(admin|developer|tg|telegram)(\/|$)/

/** The host's policy for one request path: 'allow', 'redirect' (to the main site) or 'deny' (JSON 404). */
export function hostPolicy(host, pathname) {
  if (pathname === '/healthz' || pathname === '/robots.txt') return 'allow'
  const file = pathname.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(pathname)
  const other = file ? 'allow' : pathname.startsWith('/api/') ? 'deny' : 'redirect'
  if (isPayHost(host)) return PAY_PAGES.test(pathname) || PAY_APIS.test(pathname) ? 'allow' : other
  if (isEmbedHost(host)) return EMBED_PAGES.test(pathname) || EMBED_APIS.test(pathname) ? 'allow' : other
  if (isApiHost(host)) return pathname.startsWith('/api/') && !API_DENIED.test(pathname) ? 'allow' : 'deny'
  return 'allow'
}
