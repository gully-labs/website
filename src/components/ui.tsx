import type { ReactNode } from 'react'

/** Primary gold CTA. Size (padding, font-size) is added per use. */
export const btnGold =
  'rounded-btn bg-gold font-semibold text-bg transition-colors duration-150 hover:bg-gold-hover hover:text-bg'

/** Secondary outline button. */
export const btnOutline =
  'whitespace-nowrap rounded-btn border border-line-strong bg-transparent font-medium text-ink transition-colors duration-150 hover:border-gold hover:text-ink'

export const eyebrow = 'font-mono text-[13px] tracking-[1.5px] text-gold'

export const h2 = 'm-0 font-display text-[clamp(40px,4.5cqw,64px)] leading-[.95] font-extrabold uppercase'

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
