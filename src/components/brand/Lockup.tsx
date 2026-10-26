import type { KitTheme } from './kit.generated'

/* The Gully Labs full logo from the brand kit: flask icon, "GULLY LABS" and the tagline
   (`logo/gully-labs-logo.png` 928 x 372 with its -2x master; `-on-light` for light backgrounds), at the
   kit's exact 2.495:1 ratio. Byte-exact kit copies in public/brand/, never redrawn. The kit's minimum width
   is 140 px. `variant` is kept for old call sites: the kit has one full logo. */
export function Lockup({ height = 64, theme = 'dark', className = '', label = 'Gully Labs', decorative = false }: { variant?: 'horizontal' | 'stacked'; height?: number; theme?: KitTheme; className?: string; label?: string; decorative?: boolean }) {
  const width = Math.round(((height * 928) / 372) * 100) / 100
  const base = theme === 'light' ? '/brand/logo/gully-labs-logo-on-light' : '/brand/logo/gully-labs-logo'
  return (
    <img
      src={`${base}.png`}
      srcSet={`${base}.png 1x, ${base}-2x.png 2x`}
      width={width}
      height={height}
      alt={decorative ? '' : label}
      aria-hidden={decorative ? true : undefined}
      decoding="async"
      draggable={false}
      data-brand="kit"
      className={`block shrink-0 ${className}`}
      style={{ width, height }}
    />
  )
}
