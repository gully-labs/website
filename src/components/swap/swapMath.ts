/* Swap maths for the Solana stock swap card (same rules as the Gully Street / Gully Wallet swap kits): percentage
   of a balance with a fee reserve for SOL, price-impact levels (warn 1 %, high 5 %, blocked 15 % unless expert
   mode), slippage parsing and the main button state. Pure, no React: tested by scripts/test-swap-math.mjs
   (node strips the types). Amounts in raw integer units (bigint) so nothing is rounded through floats. */

export const PCTS = [25, 50, 75, 100] as const
/** SOL kept back by Max for network fees and the rent of a new token account: 0.01 SOL */
export const SOL_RESERVE = 10_000_000n
export const IMPACT_WARN = 1
export const IMPACT_HIGH = 5
export const IMPACT_BLOCK = 15
export const SLIPPAGE_PRESETS = [10, 50, 100] as const
export const AUTO_SLIPPAGE_BPS = 50
export const MAX_SLIPPAGE_BPS = 500

/** pct % of a raw balance, floored; `reserve` is kept back (Max is balance − reserve). Never negative. */
export function pctAmount(balance: bigint, pct: number, reserve = 0n): bigint {
  if (balance <= 0n || !(pct > 0)) return 0n
  const spendable = balance > reserve ? balance - reserve : 0n
  if (pct >= 100) return spendable
  const v = (balance * BigInt(Math.round(pct * 100))) / 10_000n
  return v > spendable ? spendable : v
}

/** raw units → exact decimal text for an input ('' for zero) */
export function toInput(v: bigint, decimals: number): string {
  if (v <= 0n) return ''
  const s = v.toString().padStart(decimals + 1, '0')
  const i = s.slice(0, s.length - decimals)
  const f = decimals ? s.slice(s.length - decimals).replace(/0+$/, '') : ''
  return f ? `${i}.${f}` : i
}

/** decimal text → raw units, or null (empty, zero, too many decimals) */
export function toRaw(text: string, decimals: number): bigint | null {
  const s = text.trim()
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null
  const [i, f = ''] = s.split('.')
  if (f.length > decimals) return null
  const v = BigInt((i || '0') + f.padEnd(decimals, '0'))
  return v > 0n ? v : null
}

export type ImpactLevel = 'unknown' | 'low' | 'warn' | 'high' | 'blocked'
export function impactLevel(pct: number | null | undefined): ImpactLevel {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return 'unknown'
  if (pct >= IMPACT_BLOCK) return 'blocked'
  if (pct >= IMPACT_HIGH) return 'high'
  if (pct >= IMPACT_WARN) return 'warn'
  return 'low'
}
export const impactBlocks = (pct: number | null | undefined, expert: boolean) => !expert && impactLevel(pct) === 'blocked'

/** "0.3" / "2.5%" → bps, null unless in (0, 5 %] (the quote proxy's cap) */
export function parseSlippage(text: string): number | null {
  const s = text.trim().replace(/%$/, '').trim()
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null
  const n = Number(s)
  if (!(n > 0) || n > MAX_SLIPPAGE_BPS / 100) return null
  return Math.max(1, Math.round(n * 100))
}
export const slippageWarning = (bps: number): 'low' | 'high' | null => (bps < 5 ? 'low' : bps > 300 ? 'high' : null)

export interface CtaIn {
  connected: boolean
  hasAmount: boolean
  insufficient: boolean
  symbolIn: string
  quote: 'idle' | 'loading' | 'ok' | 'error'
  impactPct: number | null
  expert: boolean
  busy: boolean
  side: 'buy' | 'sell'
}
/** The main button, in the order the problems are worth fixing. */
export function swapCta(c: CtaIn): { label: string; disabled: boolean; action: 'connect' | 'review' | 'swap' | 'none'; tone?: 'danger' | 'warn' } {
  if (!c.connected) return { label: 'Connect a wallet', disabled: false, action: 'connect' }
  if (c.busy) return { label: 'Confirm in your wallet…', disabled: true, action: 'none' }
  if (!c.hasAmount) return { label: 'Enter an amount', disabled: true, action: 'none' }
  if (c.insufficient) return { label: `Insufficient ${c.symbolIn} balance`, disabled: true, action: 'none', tone: 'danger' }
  if (c.quote !== 'ok') return { label: c.quote === 'error' ? 'No quote, try again' : 'Fetching best price…', disabled: true, action: 'none' }
  if (impactBlocks(c.impactPct, c.expert)) return { label: 'Price impact too high', disabled: true, action: 'none', tone: 'danger' }
  const lvl = impactLevel(c.impactPct)
  const verb = c.side === 'buy' ? 'buy' : 'sell'
  if (c.expert) return { label: lvl === 'high' || lvl === 'blocked' ? `${verb[0].toUpperCase()}${verb.slice(1)} anyway` : `${verb[0].toUpperCase()}${verb.slice(1)}`, disabled: false, action: 'swap', tone: lvl === 'high' || lvl === 'blocked' ? 'danger' : undefined }
  return { label: lvl === 'high' ? `Review ${verb} (high price impact)` : `Review ${verb}`, disabled: false, action: 'review', tone: lvl === 'high' ? 'warn' : undefined }
}
