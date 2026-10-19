type Num = number | null

/** A chart with nothing to draw collapses to this height. */
export const GHOST_H = 90

export const dayLabel = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
export const sum = (a: Num[] | null | undefined) => (a ? a.reduce<number>((x, y) => x + (y ?? 0), 0) : null)
export const known = (a: Num[]) => a.some((v) => v !== null)
export const fmtInt = (n: number) => n.toLocaleString('en-US')
export const fmtUsd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })

