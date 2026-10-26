import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight } from 'lucide-react'
import { isExternalHref } from '../lib/externalLinks'

/** The one link to use for anything that might leave this origin (owner rule 2026-10-26, src/lib/externalLinks.ts):
    a path or same-origin URL is a router Link in the same tab; another origin (other Gully domains included) opens in
    a new tab with rel="noopener noreferrer", a small ↗ (unless `arrow={false}`) and "(opens in a new tab)" for screen
    readers. installExternalLinks() covers any plain <a> that does not use this. */
export function SmartLink({ href, children, arrow = true, arrowSize = 13, className, ...rest }: { href: string; children: ReactNode; arrow?: boolean; arrowSize?: number } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'rel' | 'children'>) {
  if (!isExternalHref(href)) {
    const same = /^https?:\/\//i.test(href) ? new URL(href) : null
    const to = same ? same.pathname + same.search + same.hash : href
    if (/^(mailto|tel):/i.test(href) || to.startsWith('#'))
      return (
        <a href={href} className={className} {...rest}>
          {children}
        </a>
      )
    return (
      <Link to={to} className={className} {...rest}>
        {children}
      </Link>
    )
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} {...rest}>
      {children}
      {arrow && <ArrowUpRight size={arrowSize} className="shrink-0" aria-hidden />}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}
