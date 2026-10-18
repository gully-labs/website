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
