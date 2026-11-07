import type { KitTheme } from './kit.generated'

/* The Gully Labs full logo: the 2026-11 kit's logotype (`kit/logo/logotype-reversed.svg` on navy, `logotype-color.svg`
   on light, 533 x 97), byte-identical in public/brand/kit/. `variant` is kept for old call sites: the kit has one
   logotype. `height` keeps its old meaning; the logotype is drawn at 45% of it so old call sites keep their width. */
export function Lockup({ height = 64, theme = 'dark', className = '', label = 'Gully Labs', decorative = false }: { variant?: 'horizontal' | 'stacked'; height?: number; theme?: KitTheme; className?: string; label?: string; decorative?: boolean }) {
  const h = Math.round(height * 0.45 * 100) / 100
  const width = Math.round(((h * 533) / 97) * 100) / 100
  return (
    <img
      src={theme === 'light' ? '/brand/kit/logotype-color.svg' : '/brand/kit/logotype-reversed.svg'}
      width={width}
      height={h}
      alt={decorative ? '' : label}
      aria-hidden={decorative ? true : undefined}
      decoding="async"
      draggable={false}
      data-brand="kit"
      className={`block shrink-0 ${className}`}
      style={{ width, height: h }}
    />
  )
}
