import { SmartLink } from './SmartLink'

/* The "Powered by Gully Core" badge (Gully Chain brand kit v4, owner approved 2026-10-30): byte-exact kit copies in
   public/brand/badges (gully-core-powered-by-dark.*; the light set is served too, for light grounds), at the kit's
   194 x 56 ratio, linking to gullychain.xyz/gully-core/ in a new tab. Shown only where something runs on Gully Core:
   the Gully Chain and Gully Core product pages and HolderMaps of Gully Core launches. Never retype "Gully Core" next
   to it; the badge is the wordmark. The SVG is the src (outlined paths, no fonts); the PNG set is the srcset. */
const CORE_SRC = '/brand/badges/gully-core-powered-by-dark.svg'
const CORE_SRCSET = '/brand/badges/gully-core-powered-by-dark.png 1x, /brand/badges/gully-core-powered-by-dark-2x.png 2x, /brand/badges/gully-core-powered-by-dark-3x.png 3x'
/** The kit's 1x box is 194 x 56: the width follows the height proportionally (32 px high is 111 px wide). */
export const gullyCoreBadgeWidth = (height: number) => Math.round((height * 194) / 56)

export function PoweredByGullyCoreBadge({ height = 32, className = '' }: { height?: number; className?: string }) {
  return (
    <SmartLink href="https://gullychain.xyz/gully-core/" arrow={false} aria-label="Powered by Gully Core (opens in a new tab)" className={`inline-flex shrink-0 items-center self-start ${className}`} data-testid="powered-by-gully-core-badge">
      <img src={CORE_SRC} srcSet={CORE_SRCSET} width={gullyCoreBadgeWidth(height)} height={height} alt="Powered by Gully Core" loading="lazy" decoding="async" className="block w-auto" style={{ height }} />
    </SmartLink>
  )
}
