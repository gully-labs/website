import { DEVELOPERS_URL, isLocalHost } from '../../site-host'

/* Where the landing's calls to action go. On localhost the developer portal is a path of this site. */
export const PORTAL = isLocalHost() ? '/developers' : DEVELOPERS_URL
export const PORTAL_ALERTS = isLocalHost() ? '/developers#alerts' : `${DEVELOPERS_URL}/#alerts`
export const PORTAL_BILLING = isLocalHost() ? '/developers#billing' : `${DEVELOPERS_URL}/#billing`
export const BLOG_URL = 'https://blog.gullylabs.xyz'

/** A landing section's title. */
export const h2 = 'm-0 font-display text-[40px] leading-none font-extrabold uppercase max-[599px]:text-[34px]'
