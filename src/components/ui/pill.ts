/* Class strings for the kit's status pill (StatusPill.tsx), for elements that cannot be a StatusPill. */

export type PillTone = 'ok' | 'live' | 'warn' | 'error' | 'up' | 'down' | 'neutral' | 'off'

const TONES: Record<PillTone, string> = {
  ok: 'text-green bg-green/10 border-green/30',
  live: 'text-green bg-green/10 border-green/30',
  warn: 'text-gold bg-gold/10 border-gold/30',
  error: 'text-error bg-error/10 border-error/30',
  up: 'text-chart-teal bg-chart-teal/10 border-chart-teal/30',
  down: 'text-chart-orange bg-chart-orange/10 border-chart-orange/30',
  neutral: 'text-muted bg-muted/10 border-muted/25',
  off: 'text-faint bg-transparent border-line-strong',
}

/** Class string for the pill, for an element that cannot be a StatusPill (a <td>, a link's child). */
export const pillClass = (tone: PillTone = 'neutral') => `inline-flex h-[22px] shrink-0 items-center gap-[6px] rounded-full border px-2 font-mono text-[11px] leading-none whitespace-nowrap ${TONES[tone]}`
