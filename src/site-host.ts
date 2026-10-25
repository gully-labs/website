/* One bundle, several hosts: the host decides which app renders.
   gullylabs.xyz             the site
   docs.gullylabs.xyz        the docs (also /docs on the main host in development)
   admin.gullylabs.xyz       the admin dashboard (also /admin on localhost in development)
   app.gullylabs.xyz         the Gully Labs App, the app dashboard: keys, alerts, analytics, payments and
                             every service (also /app, and the old /developers path, on localhost). */
export const DOCS_HOST = 'docs.gullylabs.xyz'
export const DOCS_URL = `https://${DOCS_HOST}`
export const ADMIN_HOST = 'admin.gullylabs.xyz'
export const ADMIN_URL = `https://${ADMIN_HOST}`
export const APP_HOST = 'app.gullylabs.xyz'
export const APP_URL = `https://${APP_HOST}`
export const SITE_URL = 'https://gullylabs.xyz'
/* Service hosts, same bundle and server (server/hosts.mjs holds the routing):
   pay.gullylabs.xyz     Gully Pay checkout, invoices, pay links, merchant pages, receipts (/pay/*)
   api.gullylabs.xyz     the public API, the same /api/* paths as the main host (which keeps serving them)
   embed.gullylabs.xyz   widget.js, the Holder Map iframe (/embed/*) and badges (widget.js on the main host still works)
   status.gullylabs.xyz  a separate status service on another server; the site's /status page links to it */
export const PAY_HOST = 'pay.gullylabs.xyz'
export const PAY_URL = `https://${PAY_HOST}`
export const API_HOST = 'api.gullylabs.xyz'
export const API_URL = `https://${API_HOST}`
export const EMBED_HOST = 'embed.gullylabs.xyz'
export const EMBED_URL = `https://${EMBED_HOST}`
export const STATUS_HOST = 'status.gullylabs.xyz'
export const STATUS_URL = `https://${STATUS_HOST}`

const host = () => (typeof window !== 'undefined' ? window.location.hostname : '')
export const isDocsHost = () => host().startsWith('docs.')
export const isPayHost = () => host().startsWith('pay.')
export const isEmbedHost = () => host().startsWith('embed.')
export const isAdminHost = () => host().startsWith('admin.')
/** The app's host: app.*. */
export const isAppHost = () => host().startsWith('app.')
/** localhost and 127.0.0.1: development, where every app is also reachable by path. */
export const isLocalHost = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host())

/** A Gully Pay page for a /pay/... path: the pay host in production, this origin in development. */
export const payHref = (path: string) => (isLocalHost() ? path : `${PAY_URL}${path}`)

/* HolderMaps: the Holder Map on its own domain (server/hosts.mjs holds the routing and the same path rules).
   holdermaps.xyz/                   the Holder Map home   (/holders on the main site)
   holdermaps.xyz/<chain>/<token>    one token's map       (/holders/<chain>/<token>)
   holdermaps.xyz/deep/<id>          a Deep check report   (/holders/deep/<id>)
   Every other page belongs to the main site. Until the server says holdermaps.xyz is the Holder Map's home
   (a <meta name="holdermaps-primary"> tag, from HOLDERMAPS_PRIMARY), the main site keeps its /holders pages. */
export const HOLDERMAPS_HOST = 'holdermaps.xyz'
export const HOLDERMAPS_URL = `https://${HOLDERMAPS_HOST}`
export const isHolderMapsHost = () => /^(www\.)?holdermaps\.xyz$/.test(host())
/** holdermaps.xyz is the Holder Map's canonical home: on that host, or when the server marked the page so. */
export const holderMapsPrimary = () => isHolderMapsHost() || (typeof document !== 'undefined' && !!document.querySelector('meta[name="holdermaps-primary"]'))

const HOLDER_CHAIN_RE = '(robinhood|bsc|base|hyperevm|solana)'
const INTERNAL_HOLDER = new RegExp(`^/holders(?:/deep/(hd_[A-Za-z0-9_-]{1,64})|/${HOLDER_CHAIN_RE}/([A-Za-z0-9]{1,64}))?/?$`)
const SHORT_HOLDER = new RegExp(`^(?:/|/deep/(hd_[A-Za-z0-9_-]{1,64})|/${HOLDER_CHAIN_RE}/([A-Za-z0-9]{1,64}))/?$`)

/** The holdermaps.xyz path for a main-site Holder Map path, or null when it is not one. */
export function holderShortPath(path: string): string | null {
  const m = INTERNAL_HOLDER.exec(path)
  if (!m) return null
  return m[1] ? `/deep/${m[1]}` : m[2] ? `/${m[2]}/${m[3]}` : '/'
}
/** The main-site path for a holdermaps.xyz page path, or null when it is not one of its pages. */
export function holderInternalPath(path: string): string | null {
  const m = SHORT_HOLDER.exec(path)
  if (!m) return null
  return m[1] ? `/holders/deep/${m[1]}` : m[2] ? `/holders/${m[2]}/${m[3]}` : '/holders'
}

/** Where a link to a main-site Holder Map path (/holders...) points from this page: the short path on holdermaps.xyz,
    the holdermaps.xyz address once it is primary, else the path as given. Query and hash are kept. */
export function holderHref(path: string): string {
  const at = path.search(/[?#]/)
  const [p, rest] = at < 0 ? [path, ''] : [path.slice(0, at), path.slice(at)]
  const short = holderShortPath(p)
  if (!short) return path
  if (isHolderMapsHost()) return short + rest
  return holderMapsPrimary() ? HOLDERMAPS_URL + short + rest : path
}
/** The shareable address of a Holder Map path (/holders...), for copy boxes and badges. */
export function holderAbsUrl(path: string): string {
  const short = holderShortPath(path)
  return short && holderMapsPrimary() ? HOLDERMAPS_URL + short : SITE_URL + path
}
/** A main-site page's address from any host (on holdermaps.xyz the site's own pages live on gullylabs.xyz). */
export const siteHref = (path: string) => (isHolderMapsHost() || isSecurityHost() ? SITE_URL + path : path)

/* Gully Security on its own domain (server/hosts.mjs holds the routing and the same path rules).
   gullysecurity.xyz/                 the Security home        (/security on the main site)
   gullysecurity.xyz/reports          published reports        (/security/reports)
   gullysecurity.xyz/reports/<id>     one published report     (/security/reports/<id>)
   gullysecurity.xyz/sample           the sample report        (/security/sample)
   gullysecurity.xyz/terms            the scan terms           (/legal/scan-terms, also /security/terms)
   Every other page belongs to the main site. Until the server says gullysecurity.xyz is Security's home (a
   <meta name="security-primary"> tag, from SECURITY_PRIMARY), the main site keeps its /security pages. */
export const SECURITY_HOST = 'gullysecurity.xyz'
export const SECURITY_URL = `https://${SECURITY_HOST}`
export const isSecurityHost = () => /^(www\.)?gullysecurity\.xyz$/.test(host())
/** gullysecurity.xyz is Security's canonical home: on that host, or when the server marked the page so. */
export const securityPrimary = () => isSecurityHost() || (typeof document !== 'undefined' && !!document.querySelector('meta[name="security-primary"]'))

const REPORT_ID = 'sec_[A-Za-z0-9_-]{1,64}'
const INTERNAL_SECURITY = new RegExp(`^/security(?:/(reports)(?:/(${REPORT_ID}))?|/(sample)|/(terms))?/?$`)
const SHORT_SECURITY = new RegExp(`^(?:/|/(reports)(?:/(${REPORT_ID}))?|/(sample)|/(terms))/?$`)

/** The gullysecurity.xyz path for a main-site Security path, or null when it is not one. */
export function securityShortPath(path: string): string | null {
  const m = INTERNAL_SECURITY.exec(path)
  if (!m) return null
  return m[2] ? `/reports/${m[2]}` : m[1] ? '/reports' : m[3] ? '/sample' : m[4] ? '/terms' : '/'
}
/** The main-site path for a gullysecurity.xyz page path, or null when it is not one of its pages. */
export function securityInternalPath(path: string): string | null {
  const m = SHORT_SECURITY.exec(path)
  if (!m) return null
  return m[2] ? `/security/reports/${m[2]}` : m[1] ? '/security/reports' : m[3] ? '/security/sample' : m[4] ? '/legal/scan-terms' : '/security'
}

/** Where a link to a main-site Security path (/security..., or the scan terms) points from this page: the short path
    on gullysecurity.xyz, the gullysecurity.xyz address once it is primary, else the path as given. Query and hash kept. */
export function securityHref(path: string): string {
  const at = path.search(/[?#]/)
  const [p, rest] = at < 0 ? [path, ''] : [path.slice(0, at), path.slice(at)]
  if (p === '/legal/scan-terms') return isSecurityHost() ? `/terms${rest}` : path
  const short = securityShortPath(p)
  if (!short) return path
  if (isSecurityHost()) return short + rest
  return securityPrimary() ? SECURITY_URL + short + rest : path
}

