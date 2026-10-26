// Product brands that are not Gully Labs, for the head tags the server writes (seo.mjs renderHead, via each page's
// `brand`), the web app manifest (pwa.mjs) and the root icon files a browser asks for on its own (/favicon.ico and
// friends).
//
//   HolderMaps   holdermaps.xyz       kit: Desktop/GULLY LABS GRAPHICS/HolderMaps/brand-kit, copied byte-exact to
//                                     public/brand/holdermaps (favicon.ico packs the kit's 16/32/48 PNGs unchanged)
//   Gully AI     /ask, docs /gully-ai kit: Desktop/GULLY LABS GRAPHICS/GullyAI, composed by scripts/product-brand-assets.py
//
// Keep in step with src/brand/products.ts.

export const PRODUCT_BRANDS = {
  holdermaps: {
    name: 'HolderMaps',
    // Kit tokens (brand-kit CLAUDE_INTEGRATION_PROMPT.md section 6): ink is the page and browser chrome colour.
    background: '#0A0A0A',
    accent: '#FFD52E',
    dir: '/brand/holdermaps',
    icons: { 16: 'icon-16.png', 32: 'icon-32.png', 48: 'icon-48.png', 180: 'icon-180.png', 192: 'icon-192.png', 512: 'icon-512.png' },
    og: '/brand/holdermaps/og-image-1200x630.png',
    twitter: '/brand/holdermaps/twitter-card-1200x600.png',
    ogAlt: 'HolderMaps',
  },
  gullyai: {
    name: 'Gully AI',
    background: '#000406',
    // "AI" in the logo.
    accent: '#00F5F3',
    dir: '/brand/gullyai',
    icons: { 16: 'favicon-16.png', 32: 'favicon-32.png', 48: 'favicon-48.png', 180: 'app-icon-180.png', 192: 'app-icon-192.png', 512: 'app-icon-512.png' },
    og: '/brand/gullyai/og-1200x630.png',
    twitter: null,
    ogAlt: 'Gully AI logo and the Gully AI robot: ask anything about Gully Labs.',
  },
}

const icon = (b, size) => `${b.dir}/${b.icons[size]}`

/** The root icon paths a browser or crawler may ask for directly, mapped to a brand's own files. */
const ROOT_ICONS = {
  '/favicon.ico': () => 'favicon.ico',
  '/favicon.png': (b) => b.icons[512],
  '/favicon-16.png': (b) => b.icons[16],
  '/favicon-32.png': (b) => b.icons[32],
  '/apple-touch-icon.png': (b) => b.icons[180],
  '/apple-touch-icon-precomposed.png': (b) => b.icons[180],
  '/icon-192.png': (b) => b.icons[192],
  '/icon-512.png': (b) => b.icons[512],
}

/** On a product's own host, the brand file to serve for a root icon path (or null: the default file). */
export function brandRootIcon(brandKey, pathname) {
  const b = PRODUCT_BRANDS[brandKey]
  const f = b && ROOT_ICONS[pathname]?.(b)
  return f ? `${b.dir}/${f}` : null
}

/** The web app manifest's icons for a brand (the kit's own sizes; the HolderMaps kit ships no maskable icon). */
export function brandManifestIcons(brandKey) {
  const b = PRODUCT_BRANDS[brandKey]
  return [
    { src: icon(b, 192), sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: icon(b, 512), sizes: '512x512', type: 'image/png', purpose: 'any' },
  ]
}

/**
 * A page's `brand` for seo.mjs renderHead: site name, theme colour, icons, share image alt text and Twitter image.
 * `icons: false` / `siteName: false` keep the host's own (Gully AI pages on gullylabs.xyz keep the site's tab icon and
 * site name; only the colour and share image are Gully AI's).
 */
export function headBrand(brandKey, { origin = '', icons = true, siteName = true } = {}) {
  const b = PRODUCT_BRANDS[brandKey]
  return {
    siteName: siteName ? b.name : null,
    themeColor: b.background,
    icons: icons ? { 16: icon(b, 16), 32: icon(b, 32), 48: icon(b, 48), 180: icon(b, 180) } : null,
    ogAlt: b.ogAlt,
    twitterImage: b.twitter && origin ? origin + b.twitter : null,
  }
}
