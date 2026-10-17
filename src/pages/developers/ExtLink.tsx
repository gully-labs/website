import { ArrowUpRight } from 'lucide-react'
import type { ReactNode } from 'react'

/** A link that leaves the console (docs, Gully Analytics, GitHub, the blog): a new tab, a ↗ marker,
    no opener, and "(opens in a new tab)" for screen readers. */
export function ExtLink({ href, children, className = '', arrow = true }: { href: string; children: ReactNode; className?: string; arrow?: boolean }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      {arrow && <ArrowUpRight size={13} className="shrink-0" aria-hidden />}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}
