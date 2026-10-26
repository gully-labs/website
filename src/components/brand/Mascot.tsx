/* The Gully Labs mark from the brand kit (Desktop\GULLY LABS GRAPHICS\Gully Labs\brand-kit, copied byte-exact
   to public/brand/): the flask icon, `icon/gully-labs-icon.png` (343 x 372, transparent). It is drawn at its
   intrinsic 0.922:1 ratio inside a `size` x `size` box, never cropped or recoloured. The retired frog mascot
   (gully-mark-*.png, the mascot bust) is no longer used anywhere. `variant` is kept for old call sites:
   both variants render the kit icon. */
const ICON = { src: '/brand/icon/gully-labs-icon.png', width: 343, height: 372 }

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
