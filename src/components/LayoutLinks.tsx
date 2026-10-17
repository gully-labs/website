import type { HTMLAttributes, MouseEvent, ReactNode, Ref } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight } from 'lucide-react'
import type { NavEntry } from '../content/site'
import { isLocalHost } from '../site-host'
import { useContact } from './ContactContext'
import { newTab } from './LayoutNav'

/* Shared by the header menus, the mobile sheet and the footer: one way to render a nav entry. */

/** The mark on a link that opens another app in a new tab: a small ↗ and, for screen readers, the words. */
export function NewTabMark({ size = 13, className = 'flex-none text-faint' }: { size?: number; className?: string }) {
  return (
    <>
      <ArrowUpRight aria-hidden size={size} className={className} />
      <span className="sr-only"> (opens in a new tab)</span>
    </>
  )
}

type EntryProps = { e: NavEntry; onPick?: () => void; current?: boolean; children: ReactNode } & Omit<HTMLAttributes<HTMLElement>, 'children'> & { ref?: Ref<HTMLElement> }

/**
 * Renders an entry as a router Link, a plain link to another host, or the button that opens the
 * contact form. `onPick` runs after any of them (used to close a menu or the mobile sheet). Other
 * props (Radix's asChild handlers, a ref) pass through.
 */
export function EntryLink({ e, onPick, current, children, onClick, ref, ...rest }: EntryProps) {
  const { openContact } = useContact()
  const click = (ev: MouseEvent<HTMLElement>) => {
    onClick?.(ev)
    onPick?.()
  }
  if (e.action === 'contact')
    return (
      <button
        type="button"
        ref={ref as Ref<HTMLButtonElement>}
        {...rest}
        onClick={(ev) => {
          click(ev)
          openContact()
        }}
      >
        {children}
      </button>
    )
  const local = e.href && e.localTo && isLocalHost() ? e.localTo : null
  const to = e.to ?? local
  if (to)
    return (
      <Link to={to} ref={ref as Ref<HTMLAnchorElement>} aria-current={current ? 'page' : undefined} {...rest} onClick={click}>
        {children}
      </Link>
    )
  return (
    <a href={e.href} ref={ref as Ref<HTMLAnchorElement>} {...(e.newTab ? newTab : {})} {...rest} onClick={click}>
      {children}
    </a>
  )
}
