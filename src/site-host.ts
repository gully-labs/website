/* One bundle, several hosts: the host decides which app renders.
   gullylabs.xyz             the site
   docs.gullylabs.xyz        the docs (also /docs on the main host in development)
   admin.gullylabs.xyz       the admin dashboard (also /admin on localhost in development)
   app.gullylabs.xyz         the Gully Labs App: keys, alerts, analytics, payments (also /app and
                             /developers on localhost). Its old name, developers.gullylabs.xyz, answers
                             301 to it for pages (server/hosts.mjs); this bundle still runs there too. */
export const DOCS_HOST = 'docs.gullylabs.xyz'
export const DOCS_URL = `https://${DOCS_HOST}`
export const ADMIN_HOST = 'admin.gullylabs.xyz'
export const ADMIN_URL = `https://${ADMIN_HOST}`
export const APP_HOST = 'app.gullylabs.xyz'
export const APP_URL = `https://${APP_HOST}`
/** Aliases of APP_HOST / APP_URL under the dashboard's old name: every importer now points at the app. */
export const DEVELOPERS_HOST = APP_HOST
export const DEVELOPERS_URL = APP_URL
export const SITE_URL = 'https://gullylabs.xyz'

const host = () => (typeof window !== 'undefined' ? window.location.hostname : '')
export const isDocsHost = () => host().startsWith('docs.')
export const isAdminHost = () => host().startsWith('admin.')
/** The app's host: app.*, or developers.* while that old name is retired. */
export const isAppHost = () => host().startsWith('app.') || host().startsWith('developers.')
export const isDevelopersHost = isAppHost
/** localhost and 127.0.0.1: development, where every app is also reachable by path. */
export const isLocalHost = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host())
