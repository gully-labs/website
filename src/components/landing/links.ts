import { APP_URL, isLocalHost } from '../../site-host'

/* Where the landing's calls to action go. On localhost the app dashboard is a path of this site. */
export const PORTAL = isLocalHost() ? '/app' : APP_URL
export const PORTAL_ALERTS = isLocalHost() ? '/app#alerts' : `${APP_URL}/#alerts`
export const PORTAL_BILLING = isLocalHost() ? '/app#billing' : `${APP_URL}/#billing`
export const BLOG_URL = 'https://blog.gullylabs.xyz'

/** A landing section's title: the shared H2 step (components/ui.tsx). */
export { h2 } from '../ui'
