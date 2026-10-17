import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { useWrite, type WriteCategory } from './portal'

/**
 * A write action the current role may not be allowed to take. Allowed: the child as it is. Not
 * allowed: hidden (`hide`), or shown disabled inside a focusable wrapper whose tooltip says why
 * ("Your role (viewer) can't create keys."), so the reason is readable by mouse, keyboard and screen
 * readers. The server refuses the write anyway (403 forbidden-role).
 */
export function Can({ cat, what, hide = false, children, block = false }: { cat: WriteCategory; what: string; hide?: boolean; children: ReactNode; block?: boolean }) {
  const w = useWrite(cat, what)
  if (w.ok) return <>{children}</>
  if (hide) return null
  const child = isValidElement(children) ? cloneElement(children as ReactElement<Record<string, unknown>>, { disabled: true, 'aria-disabled': true, tabIndex: -1, title: undefined }) : children
  return (
    <span tabIndex={0} title={w.why} aria-label={w.why} data-role-locked={cat} className={`${block ? 'flex' : 'inline-flex'} cursor-not-allowed rounded-full [&>*]:pointer-events-none`}>
      {child}
    </span>
  )
}
