import { KIT } from './kit.generated'

/* The Gully Labs mascot from the brand kit, as a picture.
   - mark: the kit's square avatar composition (public/brand/gully-mark-*.png, cut down from the kit's
     640 px icon master, never upscaled), round like every platform crops it. For icon slots.
   - bust: the transparent mascot bust (1x and 2x masters) for hero and lockup-like placements.
   The browser picks the file from srcset by device pixel ratio. */
export function Mascot({ size = 32, variant = 'mark', className = '', label = 'Gully Labs mascot', decorative = false }: { size?: number; variant?: 'mark' | 'bust'; className?: string; label?: string; decorative?: boolean }) {
  if (variant === 'bust') {
    const width = size
    const height = Math.round((size * KIT.bust.height) / KIT.bust.width)
    return (
      <img
        src={KIT.bust.src}
        srcSet={`${KIT.bust.src} ${KIT.bust.width}w, ${KIT.bust.src2x} ${KIT.bust.width * 2}w`}
        sizes={`${width}px`}
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
  return (
    <img
      src="/brand/gully-mark-96.png"
      srcSet="/brand/gully-mark-96.png 96w, /brand/gully-mark-192.png 192w, /brand/gully-mark-512.png 512w"
      sizes={`${size}px`}
      width={size}
      height={size}
      alt={decorative ? '' : label}
      aria-hidden={decorative ? true : undefined}
      decoding="async"
      draggable={false}
      data-brand="kit"
      className={`block shrink-0 rounded-full object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  )
}
