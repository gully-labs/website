import type { Format } from '@number-flow/react'

/** NumberFlow's format: Intl options with notation limited to standard or compact. */
export type NumberFormat = Format

/** Formats for AnimatedNumber, matching the site's formatters (src/lib/tracker.ts, src/lib/stats.ts). */
export const NF = {
  int: { maximumFractionDigits: 0 } satisfies Format,
  usd: { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 } satisfies Format,
  usd4: { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 } satisfies Format,
  compactUsd: { style: 'currency', currency: 'USD', notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 2 } satisfies Format,
  /** A signed percent figure such as a gap (pass the suffix '%'). */
  signed2: { signDisplay: 'exceptZero', minimumFractionDigits: 2, maximumFractionDigits: 2 } satisfies Format,
  fixed2: { minimumFractionDigits: 2, maximumFractionDigits: 2 } satisfies Format,
}
