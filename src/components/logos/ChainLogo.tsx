import { Logo } from './Logo'
import { chainMark, type LogoSize } from './registry'

/** A chain's official mark, round, by key ("base", "bsc", "robinhood"…) or display name ("BNB Chain").
    Decorative when the chain's name is already written next to it. */
export function ChainLogo({ chain, size = 20, decorative = false, className = '' }: { chain: string; size?: LogoSize; decorative?: boolean; className?: string }) {
  const m = chainMark(chain)
  const name = m?.name ?? chain
  return <Logo mark={m} glyph="chain" size={size} shape="round" alt={decorative ? '' : name} title={name} className={className} />
}
