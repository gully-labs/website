import { createContext, useContext } from 'react'
import { DOCS_URL, isDocsHost } from '../site-host'

/** Every docs page, in sidebar order. `slug` is the relative route path ('' is the index). */
export const DOC_PAGES = [
  { slug: '', title: 'Overview', group: 'Start' },
  { slug: 'methodology', title: 'Tracker methodology', group: 'Start' },
  { slug: 'api', title: 'API reference', group: 'Build' },
  { slug: 'widget', title: 'Widget guide', group: 'Build' },
  { slug: 'api-keys', title: 'API keys', group: 'Build' },
  { slug: 'plans-alerts', title: 'Plans & alerts', group: 'Build' },
  { slug: 'sdk', title: 'SDK', group: 'Build' },
  { slug: 'analytics', title: 'Gully Analytics', group: 'Products' },
  { slug: 'changelog', title: 'Changelog', group: 'More' },
] as const

export type DocSlug = (typeof DOC_PAGES)[number]['slug']

export const SITE = 'https://gullylabs.xyz'

/** The docs' own base path: '/' on docs.gullylabs.xyz, '/docs' when mounted under the main host. */
export const DocsBase = createContext('/')

export function useDocHref(slug: DocSlug, hash?: string): string {
  const base = useContext(DocsBase).replace(/\/+$/, '')
  return `${base}${slug ? `/${slug}` : ''}${hash ? `#${hash}` : ''}` || '/'
}

/** Where the docs read the live API from: the main host, unless the docs run on the main host itself. */
export const apiOrigin = () => (isDocsHost() ? SITE : '')

/** Canonical address of a docs page. */
export const canonical = (slug: DocSlug) => `${DOCS_URL}${slug ? `/${slug}` : '/'}`
