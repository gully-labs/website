import { DEVELOPERS_URL, isLocalHost } from '../../site-host'

/* Where the landing's calls to action go. On localhost the developer portal is a path of this site. */
export const PORTAL = isLocalHost() ? '/developers' : DEVELOPERS_URL
export const PORTAL_ALERTS = isLocalHost() ? '/developers#alerts' : `${DEVELOPERS_URL}/#alerts`
export const PORTAL_BILLING = isLocalHost() ? '/developers#billing' : `${DEVELOPERS_URL}/#billing`
export const BLOG_URL = 'https://blog.gullylabs.xyz'

/** A landing section's title: the shared H2 step (components/ui.tsx). */
export { h2 } from '../ui'
