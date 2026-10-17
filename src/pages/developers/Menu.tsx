import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

/* A dropdown menu for the console header (workspace switcher, wallet menu): a button with
   aria-haspopup, a role="menu" panel, the first item focused on open, arrow keys / Home / End move
   between items, Escape (or Tab) closes and returns focus to the button, a click outside closes. */

export const menuItem = 'flex min-h-11 w-full items-center gap-3 rounded-[8px] px-3 text-left text-[14px] text-ink-2 outline-offset-[-2px] hover:bg-surface-hover hover:text-ink focus-visible:bg-surface-hover'

export function Menu({ label, button, buttonClass, children, align = 'right', width = 250, testId }: { label: string; button: ReactNode; buttonClass: string; children: (close: () => void) => ReactNode; align?: 'left' | 'right'; width?: number; testId?: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', outside)
    const id = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus())
    return () => {
      document.removeEventListener('mousedown', outside)
      cancelAnimationFrame(id)
    }
  }, [open])

  // Closing asks for the focus to go back to the button; the effect below does it once the menu is gone.
  const [refocus, setRefocus] = useState(0)
  const close = (back = true) => {
    setOpen(false)
    if (back) setRefocus((n) => n + 1)
  }
  useEffect(() => {
    if (refocus) trigger.current?.focus()
  }, [refocus])

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      return close()
    }
    if (e.key === 'Tab') return close(false)
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])]
    if (!items.length) return
    const i = items.indexOf(document.activeElement as HTMLElement)
    let next = -1
    if (e.key === 'ArrowDown') next = (i + 1) % items.length
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    if (next < 0) return
    e.preventDefault()
    items[next].focus()
  }

  return (
    <div ref={box} className="relative" onKeyDown={open ? onKey : undefined}>
      <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)} className={buttonClass} data-testid={testId}>
        {button}
      </button>
      {open && (
        <div ref={panel} role="menu" aria-label={label} className={`absolute top-12 z-40 flex max-w-[calc(100vw-32px)] animate-[gl-rise_.18s_ease_both] flex-col rounded-[12px] border border-line-strong bg-surface-deep p-1 shadow-[0_12px_32px_rgba(0,0,0,.5)] ${align === 'right' ? 'right-0' : 'left-0'}`} style={{ width }}>
          {children(() => close())}
        </div>
      )}
    </div>
  )
}
