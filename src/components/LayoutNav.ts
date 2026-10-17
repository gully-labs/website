import type { NavEntry, NavGroup } from '../content/site'

/* Rules shared by the header, the mobile sheet, the footer and the layout. */

/** True when the current page belongs to this entry (path prefix match, or the exact /#hash). */
export function entryActive(e: NavEntry, pathname: string, hash: string) {
  if (e.match?.some((m) => pathname === m || pathname.startsWith(`${m}/`))) return true
  return !!e.to && e.to.startsWith('/#') && pathname === '/' && hash === e.to.slice(1)
}

export const groupActive = (g: NavGroup, pathname: string, hash: string) => g.items.some((e) => entryActive(e, pathname, hash))

/** 'smooth', or 'instant' when the visitor asked for reduced motion. */
export function scrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
}

/** Props for an <a> that opens another app or site in a new tab (pair it with <NewTabMark/>). */
export const newTab = { target: '_blank', rel: 'noopener noreferrer' } as const
