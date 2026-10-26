/* Console tabs: long pages keep to about 1.5 screens by showing one part at a time (owner rule: minimal pages,
   longer content in tabs or steppers). A pill tablist with arrow-key support; #<id> in the address opens that tab. */
import { useEffect, useRef, type ComponentType, type ReactNode } from 'react'
import type { LucideProps } from 'lucide-react'

export interface ConsoleTab {
  id: string
  label: string
  icon?: ComponentType<LucideProps>
  content: ReactNode
}

export function ConsoleTabs({ tabs, value, onChange, label, id }: { tabs: ConsoleTab[]; value: string; onChange: (id: string) => void; label: string; id?: string }) {
  const list = useRef<HTMLDivElement>(null)
  // Open the tab named in the address (#pricing, #faq…) on arrival and on hash changes.
  useEffect(() => {
    const pick = () => {
      const h = location.hash.slice(1)
      if (h && tabs.some((t) => t.id === h)) onChange(h)
    }
    pick()
    addEventListener('hashchange', pick)
    return () => removeEventListener('hashchange', pick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const cur = tabs.find((t) => t.id === value) ?? tabs[0]
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const i = tabs.findIndex((t) => t.id === cur.id)
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    onChange(n.id)
    requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>(`[data-tab="${n.id}"]`)?.focus())
  }
  return (
    <div className="ctabs" id={id}>
      <div className="ctabs-list" role="tablist" aria-label={label} ref={list} onKeyDown={onKey}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            data-tab={t.id}
            aria-selected={t.id === cur.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={t.id === cur.id ? 0 : -1}
            className="ctab"
            onClick={() => onChange(t.id)}
          >
            {t.icon && <t.icon className="ic" aria-hidden />}
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${cur.id}`} aria-labelledby={`tab-${cur.id}`} className="ctabs-panel" key={cur.id}>
        {cur.content}
      </div>
    </div>
  )
}
