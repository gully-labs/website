import type { ReactNode } from 'react'
import { SmartLink } from './SmartLink'

/* The "Powered by Gully Labs" badge (owner rule 2026-10-26, rule 4): the kit's dark PNGs (public/brand/badges, byte-exact
   copies of brand-kit/badges; the kit SVG renders blank), at the kit's own 254 x 64 ratio, 30 px high on desks and 26 px
   on phones, linking to gullylabs.xyz in a new tab. On gullylabs.xyz itself it is not shown (it IS Gully Labs). */
const SRC = '/brand/badges/powered-by-gully-labs-dark.png'
const SRCSET = `${SRC} 1x, /brand/badges/powered-by-gully-labs-dark-2x.png 2x, /brand/badges/powered-by-gully-labs-dark-3x.png 3x`

export function PoweredByBadge({ className = '' }: { className?: string }) {
  return (
    <SmartLink href="https://gullylabs.xyz/" arrow={false} aria-label="Powered by Gully Labs (opens in a new tab)" className={`inline-flex shrink-0 items-center ${className}`} data-testid="powered-by-badge">
      <img src={SRC} srcSet={SRCSET} width={119} height={30} alt="Powered by Gully Labs" decoding="async" className="block h-[30px] w-auto max-[600px]:h-[26px]" />
    </SmartLink>
  )
}

/** A footer's bottom row: the copyright on the left, the badge on the right (stacked on narrow screens). */
export function BadgeFooterRow({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-3 font-mono text-[12px] text-faint ${className}`} data-testid="footer-badge-row">
      <span>{children ?? '© 2026 Gully Labs'}</span>
      <PoweredByBadge />
    </div>
  )
}
