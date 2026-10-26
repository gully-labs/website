/* Product brands that are not Gully Labs: HolderMaps (holdermaps.xyz) and Gully AI (/ask, the ⌘K panel, the docs
   page, the app's AI view). Every file is from scripts/product-brand-assets.py (icons, share images, downscaled logos and mascots,
   composed from the kit files only); the server half is server/product-brand.mjs. Keep the two in step.

   Palettes are sampled from each kit logo (the script prints the samples). The rest are tints between those samples,
   not new hues. The CSS side is in src/index.css under [data-product-brand]: the page tokens (--color-*) and the
   console tokens (--gl-*) are redefined in that scope, so every component inside follows without changes.

   HolderMaps (HolderMaps_Logo.png, 1435 x 265):
     background #10100E   the logo's backdrop, median of its left edge (where the globe sits)
     accent     #FED629   "Maps", median of its gold letter pixels
     accent 2   #FDC21F   the deeper gold in the same letters (their lower half)
     ink        #F4F4F4   "Holder", median of its white letter pixels
   Gully AI (GullyAI Neon Robot Logo.png, 2172 x 724):
     background #000406   the logo's backdrop
     accent     #00F5F3   "AI", median of its cyan letter pixels
     accent 2   #00E3FC   the G mark's blue-cyan
     ink        #FFFFFF   "Gully"
   Font: both logos letter in a heavy geometric sans; Poppins (already the stack's font) is kept for both. */

export type ProductBrandKey = 'holdermaps' | 'gullyai'

export interface ProductBrand {
  name: string
  background: string
  accent: string
  /** The logo, downscaled and feathered into `background` (720 x n; 360 x n for 1x). */
  logo: { src: string; src2x: string; w: number; h: number }
  mark: string
  og: string
  /** A kit mascot, downscaled to 2x its display size. */
  mascot: { src: string; w: number; h: number }
}

export const PRODUCT_BRANDS: Record<ProductBrandKey, ProductBrand> = {
  holdermaps: {
    name: 'HolderMaps',
    background: '#10100E',
    accent: '#FED629',
    logo: { src: '/brand/holdermaps/logo-360w.png', src2x: '/brand/holdermaps/logo-720w.png', w: 720, h: 133 },
    mark: '/brand/holdermaps/app-icon-192.png',
    og: '/brand/holdermaps/og-1200x630.png',
    mascot: { src: '/brand/holdermaps/mascot-300w.png', w: 300, h: 415 },
  },
  gullyai: {
    name: 'Gully AI',
    background: '#000406',
    accent: '#00F5F3',
    logo: { src: '/brand/gullyai/logo-360w.png', src2x: '/brand/gullyai/logo-720w.png', w: 720, h: 240 },
    mark: '/brand/gullyai/app-icon-192.png',
    og: '/brand/gullyai/og-1200x630.png',
    mascot: { src: '/brand/gullyai/mascot-192w.png', w: 192, h: 189 },
  },
}

/** Marks the whole document as one product's (holdermaps.xyz): every token in the page follows its palette. */
export function applyDocumentBrand(key: ProductBrandKey | null) {
  if (typeof document === 'undefined' || !key) return
  document.documentElement.dataset.productBrand = key
}
