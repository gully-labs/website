import type { KitTheme } from './kit.generated'

/* The Gully Labs compact nav logo: the 2026-11 kit's logotype (`kit/logo/logotype-reversed.svg` on navy,
   `logotype-color.svg` on light, 533 x 97), byte-identical in public/brand/kit/, never redrawn or typed.
   `height` is its height in CSS px. Marked data-brand="kit". */
export function Wordmark({ height = 28, theme = 'dark', className = '', label = 'Gully Labs', decorative = false }: { height?: number; theme?: KitTheme; className?: string; label?: string; decorative?: boolean }) {
  const width = Math.round(((height * 533) / 97) * 100) / 100
  return (
    <img
      src={theme === 'light' ? '/brand/kit/logotype-color.svg' : '/brand/kit/logotype-reversed.svg'}
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
