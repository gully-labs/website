/* HolderMaps' Gully Terminal pieces (2026-10-27): tabs that keep a page near 1.5 screens, and the stepper every
   multi-step flow uses (the search, the Deep check purchase, the embed/widget setup). */
import { useEffect, useId, useRef, type ComponentType, type ReactNode } from 'react'
import { Check, type LucideProps } from 'lucide-react'

type Icon = ComponentType<LucideProps>

export interface HmTab {
  id: string
  label: string
  icon: Icon
  content: ReactNode
}

/** A tab list (arrow keys move, #<id> in the address opens that tab) over one panel. */
export function HmTabs({ tabs, value, onChange, label }: { tabs: HmTab[]; value: string; onChange: (id: string) => void; label: string }) {
  const uid = useId().replace(/:/g, '')
  const list = useRef<HTMLDivElement>(null)
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
    e.preventDefault()
    const i = tabs.findIndex((t) => t.id === cur.id)
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
    onChange(n.id)
    list.current?.querySelector<HTMLButtonElement>(`[data-tab="${n.id}"]`)?.focus()
  }
  return (
    <div>
      <div className="hmt-tabs" role="tablist" aria-label={label} ref={list} onKeyDown={onKey}>
        {tabs.map((t) => {
          const I = t.icon
          const on = t.id === cur.id
          return (
            <button key={t.id} type="button" role="tab" id={`${uid}-t-${t.id}`} data-tab={t.id} aria-selected={on} aria-controls={`${uid}-p-${t.id}`} tabIndex={on ? 0 : -1} className="hmt-tab" onClick={() => onChange(t.id)}>
              <I className="hm-ic" aria-hidden />
              {t.label}
            </button>
          )
        })}
      </div>
      <div className="hmt-tabpanel" role="tabpanel" id={`${uid}-p-${cur.id}`} aria-labelledby={`${uid}-t-${cur.id}`} key={cur.id}>
        {cur.content}
      </div>
    </div>
  )
}

export interface HmStep {
  t: string
  d: string
  icon?: Icon
}

/** A horizontal stepper: steps before `at` are done, `at` is running, the rest are waiting. */
export function HmSteps({ steps, at, label }: { steps: HmStep[]; at: number; label: string }) {
  return (
    <ol className="hmt-steps" aria-label={label} style={{ ['--n' as string]: steps.length }}>
      {steps.map((st, i) => {
        const state = i < at ? 'done' : i === at ? 'on' : ''
        const I = state === 'done' ? Check : st.icon
        return (
          <li key={st.t} className={state} aria-current={i === at ? 'step' : undefined}>
            <span className="n" aria-hidden>
              {I ? <I className="hm-ic" /> : String(i + 1).padStart(2, '0')}
            </span>
            <span className="t">{st.t}</span>
            <span className="d">{st.d}</span>
            <span className="bar" aria-hidden>
              <i />
            </span>
            <span className="hm-sr">{state === 'done' ? ' (done)' : state === 'on' ? ' (current step)' : ''}</span>
          </li>
        )
      })}
    </ol>
  )
}
