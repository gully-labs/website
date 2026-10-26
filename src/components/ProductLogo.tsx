/* One logo slot for every Gully product (landing cards, /products, app hand-off cards).

   Every file is a byte-exact copy from its product's kit in Desktop\GULLY LABS GRAPHICS (public/brand/products/).
   Each logo gets its own display height so the "Gully"/"Holder" cap heights match (16 px at desktop, measured on
   the kit files at 4x against guide lines); widths follow each file's intrinsic ratio, so nothing is stretched,
   and every source is at least 2x its display size (or SVG), so nothing is upscaled. The slot has a fixed
   height and the logo sits left aligned and vertically centred in it; below 640 px everything scales by 0.875.

   Known kit gaps (owner to supply, not hand-cut here):
   - HolderMaps has no transparent logo: HolderMaps_Logo.png is the only master and has a dark backdrop.
   - Gully Studio's kit has no logo without the "WEB3 GAMING STUDIO & AD NETWORK" tagline. */
export type KitLogoKey = 'chain' | 'pay' | 'rpc' | 'holders' | 'security' | 'studio'
/** 'ipfs' is Gully IPFS, a Gully Labs service with no kit of its own: the Gully Labs mark plus its name, set in the
    kit's Poppins 700 so its cap height matches the other logos (16 px at desktop). */
export type ProductLogoKey = KitLogoKey | 'ipfs'

interface LogoFile {
  name: string
  src: string
  src2x?: string
  /** Intrinsic size of `src` (or the SVG viewBox), for the ratio and the width/height attributes. */
  w: number
  h: number
  /** Display height in CSS px at desktop size: tuned per file so cap heights match. */
  display: number
}

export const PRODUCT_LOGOS: Record<KitLogoKey, LogoFile> = {
  chain: { name: 'Gully Chain', src: '/brand/products/gullychain-lockup-transparent.png', src2x: '/brand/products/gullychain-lockup-transparent-2x.png', w: 1556, h: 300, display: 31 },
  pay: { name: 'Gully Pay', src: '/brand/products/gullypay-logo-ondark.svg', w: 895.23, h: 230.4, display: 34 },
  rpc: { name: 'Gully RPC', src: '/brand/products/gullyrpc-logo-transparent.png', w: 860, h: 247, display: 39 },
  holders: { name: 'HolderMaps', src: '/brand/products/HolderMaps_Logo.png', w: 1435, h: 265, display: 30 },
  security: { name: 'Gully Security', src: '/brand/products/gullysecurity-logo-primary.svg', w: 627, h: 104, display: 31 },
  studio: { name: 'Gully Studio', src: '/brand/products/gullystudio-logo-transparent.png', w: 2070, h: 593, display: 50 },
}

/** The slot's fixed height in CSS px at desktop size (Studio's taller lockup overflows it evenly, by design). */
export const PRODUCT_LOGO_SLOT = 40
/** The widest logo at desktop size (Gully Security, 31 x 6.03). In a slot narrower than this, every logo shrinks by
    the same factor (container query units), so cap heights stay matched across cards and nothing is cropped. */
const WIDEST = Math.max(...Object.values(PRODUCT_LOGOS).map((f) => (f.display * f.w) / f.h))

export function ProductLogo({ product, scale = 1, className = '', decorative = false }: { product: ProductLogoKey; scale?: number; className?: string; decorative?: boolean }) {
  if (product === 'ipfs') return <MarkLogo label="Gully IPFS" scale={scale} className={className} decorative={decorative} />
  const f = PRODUCT_LOGOS[product]
  const h = Math.round(f.display * scale * 100) / 100
  const w = Math.round(((h * f.w) / f.h) * 100) / 100
  return (
    <span
      className={`flex min-w-0 items-center justify-start max-[640px]:[--pl:0.875] ${className}`}
      style={{ height: `calc(${PRODUCT_LOGO_SLOT * scale}px * var(--pl, 1))`, containerType: 'inline-size' }}
      data-product-logo={product}
    >
      <img
        src={f.src}
        srcSet={f.src2x ? `${f.src} 1x, ${f.src2x} 2x` : undefined}
        width={w}
        height={h}
        alt={decorative ? '' : f.name}
        decoding="async"
        draggable={false}
        className="block max-w-none shrink-0"
        style={{ width: `min(calc(${w}px * var(--pl, 1)), ${Math.round(((w / scale) / WIDEST) * 100000) / 1000}cqw)`, height: 'auto', aspectRatio: `${f.w} / ${f.h}`, maxWidth: 'none' }}
      />
    </span>
  )
}

/** A Gully Labs service without a kit: the Gully Labs mark (kit file, 343 x 372 source, shown at 26 px) and its name. */
export function MarkLogo({ label, scale = 1, className = '', decorative = false }: { label: string; scale?: number; className?: string; decorative?: boolean }) {
  const h = Math.round(26 * scale * 100) / 100
  return (
    <span
      className={`flex min-w-0 items-center justify-start gap-[0.4em] max-[640px]:[--pl:0.875] ${className}`}
      style={{ height: `calc(${PRODUCT_LOGO_SLOT * scale}px * var(--pl, 1))`, fontSize: `calc(${22.5 * scale}px * var(--pl, 1))` }}
      data-product-logo="ipfs"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
    >
      <img src="/brand/icon/gully-labs-icon.png" width={Math.round(h * 343 / 372)} height={h} alt="" decoding="async" draggable={false} className="block shrink-0" style={{ height: `calc(${h}px * var(--pl, 1))`, width: 'auto' }} />
      <span aria-hidden className="font-[Poppins,system-ui,sans-serif] leading-none font-bold tracking-[-.02em] whitespace-nowrap text-white">
        {label}
      </span>
    </span>
  )
}
