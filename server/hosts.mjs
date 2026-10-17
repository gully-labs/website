// The app host, in one place for the server (src/site-host.ts holds the same names for the browser).
//
//   app.gullylabs.xyz         the Gully Labs App (developer dashboard: keys, alerts, analytics, payments)
//   developers.gullylabs.xyz  its old name: pages answer 301 to the app with the same path and query.
//
// Deprecated, transition period (from 2026-10-17): the old host still serves /api/* (a 301 on a POST
// breaks clients), its own session cookie and SIWE for its own domain, so tabs left open there keep
// working. Remove LEGACY_DEVELOPERS_HOST once its traffic has gone.

export const APP_HOST = 'app.gullylabs.xyz'
export const APP_URL = `https://${APP_HOST}`
export const LEGACY_DEVELOPERS_HOST = 'developers.gullylabs.xyz'

/** app.* (the dashboard). */
export const isAppHost = (host) => host.startsWith('app.')
/** developers.* (the old name, redirected). */
export const isLegacyDevelopersHost = (host) => host.startsWith('developers.')
/** Production hosts whose SIWE domain the dashboard accepts. */
export const SIGN_IN_HOSTS = [APP_HOST, LEGACY_DEVELOPERS_HOST]
