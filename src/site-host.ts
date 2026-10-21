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
