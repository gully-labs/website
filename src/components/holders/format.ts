/** A share as people read it: 62%, 4.7%, 0.35%, <0.01%; a dash when unknown. */
export const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n >= 10 ? `${Math.round(n)}%` : n >= 1 ? `${n.toFixed(1)}%` : n > 0 ? (n < 0.01 ? '<0.01%' : `${n.toFixed(2)}%`) : '0%')
/** An address as the map keys it: EVM addresses lower-cased, Solana's (case-sensitive) as they are. */
export const norm = (a: string) => (a.startsWith('0x') ? a.toLowerCase() : a)
