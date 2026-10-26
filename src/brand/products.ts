/* Product brands that are not Gully Labs: HolderMaps (holdermaps.xyz) and Gully AI (/ask, the ⌘K panel, the docs
   page, the app's AI view). The server half is server/product-brand.mjs. Keep the two in step.

   HolderMaps: its brand kit (Desktop/GULLY LABS GRAPHICS/HolderMaps/brand-kit), files copied byte-exact to
   public/brand/holdermaps. Tokens (kit CLAUDE_INTEGRATION_PROMPT.md section 6): ink #0A0A0A, carbon #161616,
   yellow #FFD52E, gradient #FFE03A -> #FDB813, white. Its page palette is src/holdermaps/hm.css (.hm on the layout).
   Gully AI (GullyAI Neon Robot Logo.png, 2172 x 724), composed by scripts/product-brand-assets.py from the kit files
   only, palette sampled from the logo (CSS side: src/index.css [data-product-brand='gullyai']):
     background #000406   the logo's backdrop
     accent     #00F5F3   "AI", median of its cyan letter pixels
     accent 2   #00E3FC   the G mark's blue-cyan
     ink        #FFFFFF   "Gully"
   Font: Poppins for both (the stack's font, and the HolderMaps kit's). */

export type ProductBrandKey = 'holdermaps' | 'gullyai'

export interface ProductBrand {
  name: string
  background: string
  accent: string
  /** The logo lockup for a dark page (1x and 2x files; w x h is the 2x file's size). */
  logo: { src: string; src2x: string; w: number; h: number }
  mark: string
  og: string
  /** A kit mascot. */
  mascot: { src: string; w: number; h: number }
}

export const PRODUCT_BRANDS: Record<ProductBrandKey, ProductBrand> = {
  holdermaps: {
    name: 'HolderMaps',
    background: '#0A0A0A',
    accent: '#FFD52E',
    logo: { src: '/brand/holdermaps/holdermaps-logo-on-dark-sm.png', src2x: '/brand/holdermaps/holdermaps-logo-on-dark.png', w: 1486, h: 306 },
    mark: '/brand/holdermaps/icon-192.png',
    og: '/brand/holdermaps/og-image-1200x630.png',
    mascot: { src: '/brand/holdermaps/mascot-map.png', w: 340, h: 470 },
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

/** Marks the whole document as one product's (holdermaps.xyz): the page behind the layout takes its background. */
export function applyDocumentBrand(key: ProductBrandKey | null) {
  if (typeof document === 'undefined' || !key) return
  document.documentElement.dataset.productBrand = key
}
