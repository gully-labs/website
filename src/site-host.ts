/** The docs site is the same bundle served on docs.gullylabs.xyz; the host decides which app renders. */
export const DOCS_HOST = 'docs.gullylabs.xyz'
export const DOCS_URL = `https://${DOCS_HOST}`
export const isDocsHost = () => typeof window !== 'undefined' && window.location.hostname.startsWith('docs.')
