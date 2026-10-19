import { useCallback, useEffect, type KeyboardEvent } from 'react'
import { ADMIN_SECTIONS } from './adminSections'

/* The admin page shows one section at a time. The section is the URL hash (/admin#pay), so a deep link,
   the back button and a reload all land on the same section. Keyboard: Left and Right on the chip row
   (Home and End too) move between sections; "[" and "]" do the same from anywhere outside a field. */

import { ADMIN_SECTION_IDS as IDS } from './useAdminSection'

export function AdminNav({ section, go }: { section: string; go: (id: string) => void }) {
  const step = useCallback(
    (by: number, focus = false) => {
      const next = IDS[(IDS.indexOf(section) + by + IDS.length) % IDS.length]
      go(next)
      if (focus) requestAnimationFrame(() => document.getElementById(`adm-nav-${next}`)?.focus())
    },
    [section, go],
  )

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if (e.key === ']') step(1)
      else if (e.key === '[') step(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step])

  // Keep the active chip visible in the sideways-scrolling row. Only the row scrolls (never the page).
  useEffect(() => {
    const chip = document.getElementById(`adm-nav-${section}`)
    const row = chip?.closest('ul')
    if (!chip || !row) return
    const c = chip.getBoundingClientRect()
    const r = row.getBoundingClientRect()
    if (c.left < r.left) row.scrollLeft -= r.left - c.left + 8
    else if (c.right > r.right) row.scrollLeft += c.right - r.right + 8
  }, [section])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') step(1, true)
    else if (e.key === 'ArrowLeft') step(-1, true)
    else if (e.key === 'Home') go(IDS[0])
    else if (e.key === 'End') go(IDS[IDS.length - 1])
    else return
    e.preventDefault()
  }

  return (
    <nav aria-label="Admin sections" className="w-full max-w-full min-w-0 basis-full" onKeyDown={onKeyDown}>
      <ul className="m-0 flex list-none gap-2 overflow-x-auto p-0 pb-1 [scrollbar-width:thin]">
        {ADMIN_SECTIONS.map(({ id, label, icon: Icon }) => {
          const on = id === section
          return (
            <li key={id} className="shrink-0">
              <a
                id={`adm-nav-${id}`}
                href={`#${id}`}
                aria-current={on ? 'true' : undefined}
                onClick={(e) => {
                  e.preventDefault()
                  go(id)
                }}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 font-mono text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-gold ${on ? 'border-gold bg-surface-hover text-gold' : 'border-line-strong text-ink-2 hover:border-gold hover:text-ink'}`}
              >
                <Icon size={15} aria-hidden />
                {label}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
