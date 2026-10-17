import { Logo } from './Logo'
import { tokenMark, type LogoSize } from './registry'

/** A token's official mark (ETH, BNB, USDC, USDT), round. Decorative when the symbol is written next to it. */
export function TokenLogo({ symbol, size = 20, decorative = false, className = '' }: { symbol: string; size?: LogoSize; decorative?: boolean; className?: string }) {
  const m = tokenMark(symbol)
  return <Logo mark={m} label={symbol} size={size} shape="round" alt={decorative ? '' : symbol} title={m?.name} className={className} />
}
