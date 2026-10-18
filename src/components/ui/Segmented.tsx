import { segBtn, segGroup } from './seg'

/* The kit's one segmented control (design audit X4): a 6 px-radius frame with 4 px buttons inside,
   44 px tall (the tap-target minimum), mono 12 px, the chosen option filled gold. Built on the class
   strings in seg.ts, so hand-rolled controls that already use segGroup/segBtn look the same.
   Buttons carry aria-pressed; the group is labelled. Use it for a view or range switch (7D/30D/90D,
   Volume/Fees); for page sections use tabs. */

export interface SegOption<T extends string> {
  id: T
  label: string
  /** Shown as the button's tooltip and accessible description. */
  hint?: string
  disabled?: boolean
}

export function Segmented<T extends string>({ value, options, onChange, label, className = '' }: { value: T; options: readonly SegOption<T>[]; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <div role="group" aria-label={label} className={`${segGroup} ${className}`} data-segmented="">
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} disabled={o.disabled} title={o.hint} onClick={() => onChange(o.id)} className={`${segBtn(value === o.id)} disabled:cursor-not-allowed disabled:opacity-50`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
