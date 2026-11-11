/* The Gully Labs mark from the 2026-11 kit (brand/gully-labs-kit-2026-11, served byte-exact from public/brand/kit), the
   reversed version: every place this draws is on a navy ground. Drawn at its own ratio, never cropped or recoloured.
   `variant` is kept for old call sites. */
import { PRODUCT_BRANDS } from '../../data/productBrands.ts'
const ICON = { src: PRODUCT_BRANDS.labs.icon.src, width: PRODUCT_BRANDS.labs.icon.w ?? 1, height: PRODUCT_BRANDS.labs.icon.h ?? 1 }

export function Mascot({ size = 32, className = '', label = 'Gully Labs', decorative = false }: { size?: number; variant?: 'mark' | 'bust'; className?: string; label?: string; decorative?: boolean }) {
  const height = size
  const width = Math.round(((size * ICON.width) / ICON.height) * 100) / 100
  return (
    <img
      src={ICON.src}
      width={width}
      height={height}
      alt={decorative ? '' : label}
      aria-hidden={decorative ? true : undefined}
      decoding="async"
      draggable={false}
      data-brand="kit"
      className={`block shrink-0 object-contain ${className}`}
      style={{ width, height }}
    />
  )
}
