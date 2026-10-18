import { ArrowUpRight } from 'lucide-react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'

/** A link that leaves the app (the site, docs, blog, explorers, Telegram, a pay page): a new tab, a ↗
    marker, no opener or referrer, and "(opens in a new tab)" for screen readers. Owner rule: every link
    to another host opens in a new tab. `arrow={false}` for icon-only buttons that show ↗ in a tooltip. */
export function ExtLink({ href, children, className = '', arrow = true, arrowSize = 13, ...rest }: { href: string; children: ReactNode; className?: string; arrow?: boolean; arrowSize?: number } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'rel' | 'children' | 'className'>) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} {...rest}>
      {children}
      {arrow && <ArrowUpRight size={arrowSize} className="shrink-0" aria-hidden />}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}
