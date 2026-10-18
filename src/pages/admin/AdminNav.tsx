import { useEffect, useState } from 'react'
import { ADMIN_SECTIONS } from './adminSections'

export function AdminNav() {
  const [active, setActive] = useState(ADMIN_SECTIONS[0].id)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const seen = new Map<string, boolean>()
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting)
        const first = ADMIN_SECTIONS.find((s) => seen.get(s.id))
        if (first) setActive(first.id)
      },
      { rootMargin: '-200px 0px -55% 0px' },
    )
    // Sections mount as the data arrives: look again until they all exist.
    let tries = 0
    const attach = () => {
      let missing = 0
      for (const s of ADMIN_SECTIONS) {
        const el = document.getElementById(s.id)
        if (el && !seen.has(s.id)) {
          seen.set(s.id, false)
          io.observe(el)
        } else if (!el) missing++
      }
      if (missing && tries++ < 20) timer = window.setTimeout(attach, 750)
    }
    let timer = window.setTimeout(attach, 0)
    return () => {
      clearTimeout(timer)
      io.disconnect()
    }
  }, [])

  // Keep the active chip visible in the sideways-scrolling row. Only the row scrolls (never the page:
  // scrollIntoView would move the page too and fight whoever is scrolling it).
  useEffect(() => {
    const chip = document.getElementById(`adm-nav-${active}`)
    const row = chip?.closest('ul')
    if (!chip || !row) return
    const c = chip.getBoundingClientRect()
    const r = row.getBoundingClientRect()
    if (c.left < r.left) row.scrollLeft -= r.left - c.left + 8
    else if (c.right > r.right) row.scrollLeft += c.right - r.right + 8
  }, [active])

  return (
    <nav aria-label="Admin sections" className="w-full max-w-full min-w-0 basis-full">
      <ul className="m-0 flex list-none gap-2 overflow-x-auto p-0 pb-1 [scrollbar-width:thin]">
        {ADMIN_SECTIONS.map(({ id, label, icon: Icon }) => {
          const on = id === active
          return (
            <li key={id} className="shrink-0">
              <a
                id={`adm-nav-${id}`}
                href={`#${id}`}
                aria-current={on ? 'true' : undefined}
                onClick={() => setActive(id)}
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
