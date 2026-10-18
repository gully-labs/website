import { Check, ChevronDown, Info, RefreshCw } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

/* Shared building blocks that keep every app page compact (owner, 2026-10-18: "make all app pages more
   compact and everything visible ... steppers and all menus need icons even sub menus"):

   - useSubTab + SubTabs: real tabs that show one section at a time. Deep-linkable as #<page>/<sub>
     (e.g. #merchant/links), the last one remembered per page, the bar sticky under the app header, every tab
     with an icon and an optional count badge.
   - Stepper: a horizontal setup stepper. Done steps get an animated check, only the current step's form is
     shown (the caller renders it as children), and once every step is done it folds into a thin progress
     bar that can be reopened.
   - InfoTip: a one-line summary with an (i) popover for the long explanation. */

const ICON = 15

/* ------------------------------------------------------------------ sub-tabs --- */

export type SubTabItem<T extends string> = { id: T; label: string; icon: ReactNode; count?: number | null; dot?: boolean }

/** Sticky tabs under the app header (56px). Arrow keys move between tabs; on a phone the row scrolls sideways
    inside itself, never the page. */
export function SubTabs<T extends string>({ items, value, onChange, label, idBase }: { items: SubTabItem<T>[]; value: T; onChange: (t: T) => void; label: string; idBase: string }) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const i = items.findIndex((t) => t.id === value)
    const n = items.length
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowLeft' ? -1 : 1) + n) % n
    onChange(items[next].id)
    ;(e.currentTarget.querySelector(`[data-sub="${items[next].id}"]`) as HTMLElement | null)?.focus()
  }
  return (
    <div className="sticky top-14 z-20 -mx-6 border-b border-line bg-[rgba(11,14,19,.92)] px-6 backdrop-blur-md max-[480px]:-mx-4 max-[480px]:px-4 print:static" data-testid="sub-tabs">
      <div role="tablist" aria-label={label} onKeyDown={onKey} className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
        {items.map((t) => {
          const on = t.id === value
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${idBase}-tab-${t.id}`}
              aria-selected={on}
              aria-controls={`${idBase}-panel`}
              tabIndex={on ? 0 : -1}
              data-sub={t.id}
              onClick={() => onChange(t.id)}
              className={`relative inline-flex min-h-11 shrink-0 items-center gap-[7px] px-3 text-[13px] font-medium whitespace-nowrap transition-colors ${on ? 'text-ink' : 'text-dim hover:text-ink'}`}
            >
              <span className={on ? 'text-gold' : ''}>{t.icon}</span>
              {t.label}
              {t.count !== undefined && t.count !== null && <span className={`rounded-full px-[6px] font-mono text-[11px] leading-[18px] ${on ? 'bg-[rgba(232,192,96,.14)] text-gold' : 'bg-surface-deep text-faint'}`}>{t.count}</span>}
              {t.dot && <span className="size-[6px] rounded-full bg-gold" aria-label="needs attention" />}
              {on && <span className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-gold" style={{ animation: 'gl-fade .2s ease both' }} aria-hidden />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** The panel a SubTabs bar controls (fades in on each switch). */
export function SubPanel({ idBase, value, children }: { idBase: string; value: string; children: ReactNode }) {
  return (
    <div key={value} id={`${idBase}-panel`} role="tabpanel" aria-labelledby={`${idBase}-tab-${value}`} className="flex min-w-0 flex-col gap-2" style={{ animation: 'gl-fade .25s ease both' }} data-sub-panel={value}>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------- stepper --- */

export type Step = { id: string; label: string; icon?: ReactNode; done: boolean; note?: string }

/** A horizontal stepper. `current` is the first step not done unless the user picked another. Children render
    the current step's form; `children(stepId)`. When every step is done it folds into a thin bar. */
export function Stepper({ title, steps, children, testId = 'stepper', foldWhenDone = true }: { title: string; steps: Step[]; children?: (id: string) => ReactNode; testId?: string; foldWhenDone?: boolean }) {
  const firstOpen = steps.find((s) => !s.done)?.id ?? null
  const [picked, setPicked] = useState<string | null>(null)
  const [unfolded, setUnfolded] = useState(false)
  const current = picked && steps.some((s) => s.id === picked) ? picked : firstOpen
  const done = steps.filter((s) => s.done).length
  const all = done === steps.length
  const id = useId()
  // A step finishing moves the stepper on (unless the user is looking at another step on purpose).
  const prevOpen = useRef(firstOpen)
  useEffect(() => {
    if (prevOpen.current !== firstOpen) setPicked(null)
    prevOpen.current = firstOpen
  }, [firstOpen])

  if (all && foldWhenDone && !unfolded)
    return (
      <section aria-label={title} className="flex min-h-9 items-center gap-3 rounded-[12px] border border-line bg-surface px-3 py-[6px]" data-testid={testId} data-folded style={{ animation: 'gl-fade .3s ease both' }}>
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-green text-bg" aria-hidden>
          <Check size={12} strokeWidth={3} />
        </span>
        <span className="text-[13px] font-medium text-ink">{title}</span>
        <span className="font-mono text-[11px] text-faint">
          {done}/{steps.length} done
        </span>
        <span className="h-[3px] min-w-[40px] flex-1 overflow-hidden rounded-full bg-surface-deep" role="progressbar" aria-label={`${title} progress`} aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done}>
          <span className="block h-full w-full origin-left rounded-full bg-green" style={{ animation: 'gl-grow-x .6s cubic-bezier(.2,.8,.2,1) both' }} />
        </span>
        <button type="button" onClick={() => setUnfolded(true)} className="inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-[12px] text-muted hover:text-ink" aria-expanded={false}>
          Steps <ChevronDown size={13} aria-hidden />
        </button>
      </section>
    )

  return (
    <section aria-labelledby={`${id}-t`} className="flex min-w-0 flex-col gap-3 rounded-[14px] border border-line bg-surface p-3" data-testid={testId} style={{ animation: 'gl-fade .3s ease both' }}>
      <div className="flex items-center gap-2">
        <h2 id={`${id}-t`} className="m-0 text-[14px] font-semibold text-ink">
          {title}
        </h2>
        <span className="font-mono text-[11px] text-faint">
          {done}/{steps.length}
        </span>
        {all && (
          <button type="button" onClick={() => setUnfolded(false)} className="ml-auto inline-flex min-h-8 items-center gap-1 rounded-full px-2 text-[12px] text-muted hover:text-ink" aria-expanded>
            Fold <ChevronDown size={13} className="rotate-180" aria-hidden />
          </button>
        )}
      </div>
      <ol className="m-0 flex list-none items-start p-0" data-testid={`${testId}-steps`}>
        {steps.map((s, i) => {
          const on = s.id === current
          return (
            <li key={s.id} className="flex min-w-0 flex-1 items-start" data-step={s.id} data-state={s.done ? 'done' : on ? 'current' : 'todo'}>
              <button type="button" onClick={() => setPicked(s.id)} aria-current={on ? 'step' : undefined} className="group flex min-w-0 flex-1 flex-col items-center gap-[6px] rounded-[10px] px-1 py-1 text-center">
                <span className="flex w-full items-center">
                  <span className={`h-[2px] flex-1 rounded-full ${i === 0 ? 'opacity-0' : steps[i - 1].done ? 'bg-gold' : 'bg-line-strong'}`} aria-hidden />
                  <span className={`relative grid size-7 shrink-0 place-items-center rounded-full border font-mono text-[12px] transition-colors ${s.done ? 'border-gold bg-gold text-bg' : on ? 'border-gold text-gold shadow-[0_0_0_4px_rgba(232,192,96,.12)]' : 'border-line-strong text-faint group-hover:border-line-hover'}`}>
                    {s.done ? <Check key="c" size={14} strokeWidth={3} style={{ animation: 'gl-check-pop .45s cubic-bezier(.2,1.4,.4,1) both' }} aria-hidden /> : (s.icon ?? i + 1)}
                  </span>
                  <span className={`h-[2px] flex-1 rounded-full ${i === steps.length - 1 ? 'opacity-0' : s.done ? 'bg-gold' : 'bg-line-strong'}`} aria-hidden />
                </span>
                <span className={`max-w-full truncate text-[12px] leading-tight ${on ? '' : 'max-[600px]:hidden'} ${on ? 'font-semibold text-ink' : s.done ? 'text-muted' : 'text-dim'}`}>
                  {s.label}
                  <span className="sr-only"> · {s.done ? 'done' : on ? 'current step' : 'to do'}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      {current && children && (
        <div key={current} className="flex min-w-0 flex-col gap-2 border-t border-line pt-3" style={{ animation: 'gl-fade .25s ease both' }} data-testid={`${testId}-body`}>
          {children(current)}
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------- info tip --- */

/** A one-line summary with an (i) button: the long explanation opens in a small popover (click, Escape closes). */
export function InfoTip({ summary, children, className = '' }: { summary: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', out)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', out)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <span ref={box} className={`relative flex min-w-0 items-center gap-1 text-[12px] text-dim ${className}`} data-testid="info-tip">
      <span className="min-w-0 truncate">{summary}</span>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={id} aria-label="More about this" className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:text-gold">
        <Info size={ICON} aria-hidden />
      </button>
      {open && (
        <span id={id} role="note" className="absolute top-full left-0 z-30 mt-1 block w-[min(420px,calc(100vw-32px))] rounded-[12px] border border-line-strong bg-surface-deep p-3 text-[12px] leading-[1.55] whitespace-normal text-ink-2 shadow-[0_12px_32px_rgba(0,0,0,.5)]" style={{ animation: 'gl-fade .15s ease both' }}>
          {children}
        </span>
      )}
    </span>
  )
}

/* ---------------------------------------------------------------- KPI strip --- */

/** One row of four small KPI tiles (two a row on a phone). Use AnimatedNumber for the values. */
export function KpiRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section aria-label={label} className="@container">
      <div className="grid grid-cols-2 gap-2 @min-[640px]:grid-cols-4">{children}</div>
    </section>
  )
}

export function KpiTile({ label, icon, children, note, i = 0 }: { label: string; icon?: ReactNode; children: ReactNode; note?: ReactNode; i?: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[12px] border border-line bg-surface px-3 py-[10px]" style={{ animation: `gl-rise .45s ${i * 0.05}s cubic-bezier(.2,.8,.2,1) both` }} data-tile={label}>
      <span className="flex items-center gap-[6px] text-[12px] text-dim">
        {icon && <span className="text-gold">{icon}</span>}
        <span className="truncate">{label}</span>
      </span>
      <span className="font-display text-[24px] leading-none font-bold text-ink">{children}</span>
      {note && <span className="truncate font-mono text-[11px] text-faint">{note}</span>}
    </div>
  )
}

/* ------------------------------------------------------------ refresh / unknown --- */

/** "couldn't refresh · retry" beside a section whose last refresh failed (its last good data stays shown). */
export function RefreshChip({ error, onRetry, className = '' }: { error: string | null; onRetry: () => void; className?: string }) {
  if (!error) return null
  return (
    <button type="button" onClick={onRetry} title={`The last refresh failed: ${error}. Retrying on its own; press to retry now.`} className={`inline-flex min-h-7 items-center gap-[6px] rounded-full border border-[rgba(255,138,122,.35)] bg-[rgba(255,138,122,.06)] px-[10px] font-mono text-[11px] text-error transition-colors hover:border-error ${className}`} data-testid="refresh-chip" style={{ animation: 'gl-fade .2s ease both' }}>
      <RefreshCw size={12} aria-hidden /> couldn&apos;t refresh · retry
    </button>
  )
}

/** The value of something we cannot read right now: a dash with a tooltip, never a 0. */
export function Unknown({ why = 'not available right now', className = '' }: { why?: string; className?: string }) {
  return (
    <span className={`text-faint ${className}`} title={why} aria-label={why} data-unknown>
      —
    </span>
  )
}
