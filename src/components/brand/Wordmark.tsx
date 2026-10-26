import type { KitTheme } from './kit.generated'

/* The Gully Labs compact nav logo from the brand kit: the flask icon (`icon/gully-labs-icon.png`, 343 x 372)
   beside the horizontal wordmark (`logo/gully-labs-wordmark-horizontal.png`, 1171 x 116; `-on-light` for light
   backgrounds), laid out as the kit's integration prompt shows (icon 30 x 33, gap 10, wordmark 170 x 17).
   `height` is the icon's height in CSS px; everything else follows the kit's ratios. Files are byte-exact kit
   copies in public/brand/, never redrawn. Marked data-brand="kit". */
export function Wordmark({ height = 28, theme = 'dark', className = '', label = 'Gully Labs', decorative = false }: { height?: number; theme?: KitTheme; className?: string; label?: string; decorative?: boolean }) {
  const iconW = Math.round(((height * 343) / 372) * 100) / 100
  const wmH = Math.round(((height * 17) / 33) * 100) / 100
  const wmW = Math.round(((wmH * 1171) / 116) * 100) / 100
  const gap = Math.round(((height * 10) / 33) * 100) / 100
  const wm = theme === 'light' ? '/brand/logo/gully-labs-wordmark-horizontal-on-light.png' : '/brand/logo/gully-labs-wordmark-horizontal.png'
  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      data-brand="kit"
      className={`inline-flex shrink-0 items-center ${className}`}
      style={{ gap, height }}
    >
      <img src="/brand/icon/gully-labs-icon.png" width={iconW} height={height} alt="" decoding="async" draggable={false} className="block shrink-0" style={{ width: iconW, height }} />
      <img src={wm} width={wmW} height={wmH} alt="" decoding="async" draggable={false} className="block shrink-0" style={{ width: wmW, height: wmH }} />
    </span>
  )
}
