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

/* HolderMaps (added 2026-10-24): the Holder Map on its own domain. Same bundle, same server; the host decides.
   holdermaps.xyz            the Holder Map app at the root, with short paths:
                               /                     the Holder Map home (the main site's /holders)
                               /<chain>/<token>      one token's map      (/holders/<chain>/<token>)
                               /deep/<id>            a Deep check report  (/holders/deep/<id>)
                             plus the /api/* the pages call (same origin), static files and the head files
                             (robots.txt, sitemap.xml, manifest). /holders/... there 301s to the short path;
                             any other page 301s to the same path on gullylabs.xyz.
   www.holdermaps.xyz        301 to holdermaps.xyz, path and query kept.
   The main site keeps /holders/* working. HOLDERMAPS_PRIMARY=1 (set it once holdermaps.xyz resolves to this
   server) makes holdermaps.xyz the Holder Map's home everywhere: gullylabs.xyz/holders* answers 301 there and the
   links the server writes (alerts, Telegram, Gully AI, partners, share cards) name holdermaps.xyz. The API
   (/api/holders/*), the embed (/embed/holders/*), widget.js and the badges stay where they are: the SDK and
   integrators' snippets call those, and they never move. */
export const HOLDERMAPS_HOST = 'holdermaps.xyz'
export const HOLDERMAPS_URL = `https://${HOLDERMAPS_HOST}`
export const HOLDER_CHAIN_KEYS = ['robinhood', 'bsc', 'base', 'hyperevm', 'solana', 'gully']

/** holdermaps.xyz and www.holdermaps.xyz. */
export const isHolderMapsHost = (host) => /^(www\.)?holdermaps\.xyz$/.test(String(host ?? '').split(':')[0].toLowerCase())
/** HOLDERMAPS_PRIMARY: holdermaps.xyz is the Holder Map's canonical home (read per call, so tests can flip it). */
export const holderMapsPrimary = () => /^(1|true|on|yes)$/i.test(String(process.env.HOLDERMAPS_PRIMARY ?? ''))

const HOLDER_TOKEN = '[A-Za-z0-9]{1,64}'
const HOLDER_CHAINS_RE = HOLDER_CHAIN_KEYS.join('|')
const INTERNAL_HOLDER = new RegExp(`^/holders(?:/deep/(hd_[A-Za-z0-9_-]{1,64})|/(${HOLDER_CHAINS_RE})/(${HOLDER_TOKEN}))?/?$`)
const SHORT_HOLDER = new RegExp(`^(?:/|/deep/(hd_[A-Za-z0-9_-]{1,64})|/(${HOLDER_CHAINS_RE})/(${HOLDER_TOKEN}))/?$`)

/** The holdermaps.xyz path for a main-site Holder Map path (/holders, /holders/<chain>/<token>, /holders/deep/<id>),
    or null when the path is not a Holder Map page. */
export function holderShortPath(pathname) {
  const m = INTERNAL_HOLDER.exec(pathname)
  if (!m) return null
  return m[1] ? `/deep/${m[1]}` : m[2] ? `/${m[2]}/${m[3]}` : '/'
}

/** The main-site path for a holdermaps.xyz page path, or null when it is not one of its pages. */
export function holderInternalPath(pathname) {
  const m = SHORT_HOLDER.exec(pathname)
  if (!m) return null
  return m[1] ? `/holders/deep/${m[1]}` : m[2] ? `/holders/${m[2]}/${m[3]}` : '/holders'
}

/** The public address of a token's Holder Map, for links the server writes (holdermaps.xyz once it is primary). */
export function holderPageUrl(chain, token) {
  const c = encodeURIComponent(chain)
  const t = encodeURIComponent(token)
  return holderMapsPrimary() ? `${HOLDERMAPS_URL}/${c}/${t}` : `${MAIN_URL}/holders/${c}/${t}`
}
/** The Holder Map's home page, for links the server writes. */
export const holderHomeUrl = () => (holderMapsPrimary() ? `${HOLDERMAPS_URL}/` : `${MAIN_URL}/holders`)

/**
 * Where a request on holdermaps.xyz goes: { kind: 'allow' }, { kind: 'deny' } (JSON 404) or
 * { kind: 'redirect', location } (301). Static files and every /api/ path the main host serves (minus the
 * session-only dashboard, admin and Telegram routes) answer here, so the pages call their API on the same origin.
 */
export function holderMapsRoute(host, pathname, search = '') {
  const h = String(host ?? '').split(':')[0].toLowerCase()
  if (h.startsWith('www.')) return { kind: 'redirect', location: `https://${h.slice(4)}${pathname}${search}` }
  if (pathname === '/healthz' || pathname === '/robots.txt' || pathname === '/sitemap.xml') return { kind: 'allow' }
  if (pathname.startsWith('/api/')) return API_DENIED.test(pathname) ? { kind: 'deny' } : { kind: 'allow' }
  if (pathname.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(pathname)) return { kind: 'allow' }
  if (holderInternalPath(pathname)) return { kind: 'allow' }
  // The old long form on this host: the short path.
  const short = holderShortPath(pathname)
  if (short) return { kind: 'redirect', location: `${short}${search}` }
  return { kind: 'redirect', location: `${MAIN_URL}${pathname}${search}` }
}

/* Gully Security (added 2026-10-24): the Security product on its own domain, the same way as holdermaps.xyz above.
   gullysecurity.xyz          the Security pages at the root, with short paths:
                                /                    the Security home        (the main site's /security)
                                /reports             published scan reports   (/security/reports)
                                /reports/<id>        one published report     (/security/reports/<id>; noindex unless
                                                                               its owner opted in)
                                /sample              the sample report        (/security/sample)
                                /terms               the AI Security Scan terms (/legal/scan-terms; /security/terms)
                              plus the /api/* the pages call (same origin), static files and the head files (robots.txt,
                              sitemap.xml, manifest). /security/... there 301s to the short path; any other page 301s
                              to the same path on gullylabs.xyz. Monitoring has no page of its own: it is a section of
                              the home (/#monitoring) and the monitors themselves live in the app.
   www.gullysecurity.xyz      301 to gullysecurity.xyz, path and query kept.
   The main site keeps /security/* working. SECURITY_PRIMARY=1 (set it once gullysecurity.xyz resolves to this server)
   makes gullysecurity.xyz Security's home everywhere: gullylabs.xyz/security* (GET/HEAD) answers 301 there and the
   links the server writes (Telegram, Gully AI, Gully Score, badges, the reports API) name gullysecurity.xyz. The API
   (/api/security/*, /api/developer/security/*, the review form's POST), the report badges, Gully Pay invoices for paid
   scans (/pay/<id> on pay.gullylabs.xyz) and the scan engine never move: the app, the SDK and other sites call them. */
export const SECURITY_HOST = 'gullysecurity.xyz'
export const SECURITY_URL = `https://${SECURITY_HOST}`

/** gullysecurity.xyz and www.gullysecurity.xyz. */
export const isSecurityHost = (host) => /^(www\.)?gullysecurity\.xyz$/.test(String(host ?? '').split(':')[0].toLowerCase())
/** SECURITY_PRIMARY: gullysecurity.xyz is Gully Security's canonical home (read per call, so tests can flip it). */
export const securityPrimary = () => /^(1|true|on|yes)$/i.test(String(process.env.SECURITY_PRIMARY ?? ''))

const REPORT_ID = 'sec_[A-Za-z0-9_-]{1,64}'
const INTERNAL_SECURITY = new RegExp(`^/security(?:/(reports)(?:/(${REPORT_ID}))?|/(sample)|/(terms))?/?$`)
const SHORT_SECURITY = new RegExp(`^(?:/|/(reports)(?:/(${REPORT_ID}))?|/(sample)|/(terms))/?$`)

/** The gullysecurity.xyz path for a main-site Security path (/security, /security/reports[/<id>], /security/sample,
    /security/terms), or null when the path is not a Security page. */
export function securityShortPath(pathname) {
  const m = INTERNAL_SECURITY.exec(pathname)
  if (!m) return null
  return m[2] ? `/reports/${m[2]}` : m[1] ? '/reports' : m[3] ? '/sample' : m[4] ? '/terms' : '/'
}

/** The main-site path for a gullysecurity.xyz page path, or null when it is not one of its pages. /terms is the scan
    terms page, which lives with the other legal pages on the main site. */
export function securityInternalPath(pathname) {
  const m = SHORT_SECURITY.exec(pathname)
  if (!m) return null
  return m[2] ? `/security/reports/${m[2]}` : m[1] ? '/security/reports' : m[3] ? '/security/sample' : m[4] ? '/legal/scan-terms' : '/security'
}

/** The public address of a main-site Security path (/security..., hash kept), for links the server writes:
    gullysecurity.xyz once it is primary, else gullylabs.xyz. */
export function securityUrl(path = '/security') {
  const at = path.search(/[?#]/)
  const [p, rest] = at < 0 ? [path, ''] : [path.slice(0, at), path.slice(at)]
  const short = securityPrimary() ? securityShortPath(p) : null
  return short ? `${SECURITY_URL}${short}${rest}` : `${MAIN_URL}${path}`
}
/** A published report's public page. */
export const securityReportUrl = (id) => securityUrl(`/security/reports/${encodeURIComponent(id)}`)

/**
 * Where a request on gullysecurity.xyz goes: { kind: 'allow' }, { kind: 'deny' } (JSON 404) or
 * { kind: 'redirect', location } (301). Static files and every /api/ path the main host serves (minus the
 * session-only dashboard, admin and Telegram routes) answer here, so the pages call their API on the same origin.
 */
export function securityRoute(host, pathname, search = '') {
  const h = String(host ?? '').split(':')[0].toLowerCase()
  if (h.startsWith('www.')) return { kind: 'redirect', location: `https://${h.slice(4)}${pathname}${search}` }
  if (pathname === '/healthz' || pathname === '/robots.txt' || pathname === '/sitemap.xml') return { kind: 'allow' }
  if (pathname.startsWith('/api/')) return API_DENIED.test(pathname) ? { kind: 'deny' } : { kind: 'allow' }
  if (pathname.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(pathname)) return { kind: 'allow' }
  if (securityInternalPath(pathname)) return { kind: 'allow' }
  // The old long form on this host: the short path.
  const short = securityShortPath(pathname)
  if (short) return { kind: 'redirect', location: `${short}${search}` }
  return { kind: 'redirect', location: `${MAIN_URL}${pathname}${search}` }
}
/** An absolute gullylabs.xyz address as the server should write it now: a Security page moves to gullysecurity.xyz once
    it is primary (Gully AI's indexed sources name gullylabs.xyz/security...); anything else is returned unchanged. */
export function currentPageUrl(url) {
  const s = String(url ?? '')
  if (!securityPrimary() || !s.startsWith(`${MAIN_URL}/security`)) return s
  const rest = s.slice(MAIN_URL.length)
  const at = rest.search(/[?#]/)
  return securityShortPath(at < 0 ? rest : rest.slice(0, at)) ? securityUrl(rest) : s
}
