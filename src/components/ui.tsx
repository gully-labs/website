import type { ReactNode } from 'react'

/** Primary gold CTA. Size (padding, font-size) is added per use. */
export const btnGold =
  'gl-btn rounded-full bg-gold font-semibold text-bg transition-[background-color,box-shadow,transform] duration-150 hover:shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-gold)_20%,transparent)] active:scale-[.98]'

/** Secondary outline button. */
export const btnOutline =
  'gl-btn whitespace-nowrap rounded-full border border-line-strong bg-transparent font-semibold text-ink transition-[border-color,transform] duration-150 hover:border-chart-blue hover:text-ink active:scale-[.98]'

export const eyebrow = 'font-sans text-[12px] font-semibold uppercase tracking-[.08em] text-gold'

/* The heading scale (index.css --text-h1 to --text-h4): page title, section title, sub-section title,
   card title. Every page uses these, so a page's headings step down the same way everywhere. */
export const h1 = 'm-0 font-display text-h1 font-bold tracking-[-.02em]'
export const h2 = 'm-0 font-display text-h2 font-bold tracking-[-.02em]'
export const h3 = 'm-0 font-display text-h3 font-bold tracking-[-.02em]'
export const h4 = 'm-0 font-display text-h4 font-bold'

/** The one line a chart or list shows when it has nothing to draw yet. */
export const emptyNote = 'm-0 py-6 font-mono text-[12px] leading-[1.5] text-faint'

export const statusPill =
  'whitespace-nowrap rounded-full border border-line-strong px-3 py-1 font-mono text-[12px] text-ink-2'

export function SectionHeading({ label, title }: { label: string; title: ReactNode }) {
  return (
    <div className="flex flex-col gap-[14px]">
      <span className={eyebrow}>{label}</span>
      <h2 className={h2}>{title}</h2>
    </div>
  )
}

export function BlinkDot({ color }: { color: 'gold' | 'green' }) {
  return (
    <span
      aria-hidden
      className={`size-[7px] animate-blink rounded-full ${color === 'gold' ? 'bg-gold' : 'bg-green'}`}
    />
  )
}
