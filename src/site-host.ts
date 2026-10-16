/* One bundle, three hosts: the host decides which app renders.
   gullylabs.xyz        the site
   docs.gullylabs.xyz   the docs (also /docs on the main host in development)
   admin.gullylabs.xyz  the admin dashboard (also /admin on localhost in development) */
export const DOCS_HOST = 'docs.gullylabs.xyz'
export const DOCS_URL = `https://${DOCS_HOST}`
export const ADMIN_HOST = 'admin.gullylabs.xyz'
export const ADMIN_URL = `https://${ADMIN_HOST}`

const host = () => (typeof window !== 'undefined' ? window.location.hostname : '')
export const isDocsHost = () => host().startsWith('docs.')
export const isAdminHost = () => host().startsWith('admin.')
/** localhost and 127.0.0.1: development, where every app is also reachable by path. */
export const isLocalHost = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host())
