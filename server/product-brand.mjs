// Product brands that are not Gully Labs, for the head tags the server writes (seo.mjs renderHead), the web app
// manifest (pwa.mjs) and the root icon files a browser asks for on its own (/favicon.ico and friends).
//
//   HolderMaps   holdermaps.xyz      kit: Desktop/GULLY LABS GRAPHICS/HolderMaps (HolderMaps_Logo.png + mascots)
//   Gully AI     /ask, docs /gully-ai kit: Desktop/GULLY LABS GRAPHICS/GullyAI ("GullyAI Neon Robot Logo.png" + mascots)
//
// Every file under public/brand/holdermaps and public/brand/gullyai comes from scripts/product-brand-assets.py,
// which composes the icons, share images and downscaled logos from the kit files only (nothing redrawn).
// Colours: sampled from each kit logo (the same script prints them). Keep in step with src/brand/products.ts.

export const PRODUCT_BRANDS = {
  holdermaps: {
    name: 'HolderMaps',
    // The logo's own backdrop (median of its left edge), so the logo sits on it with no visible box.
    background: '#10100E',
    // "Maps" in the logo.
    accent: '#FED629',
    dir: '/brand/holdermaps',
    og: '/brand/holdermaps/og-1200x630.png',
    ogAlt: 'HolderMaps logo and the HolderMaps mascot reading a map: who really holds a token?',
  },
  gullyai: {
    name: 'Gully AI',
    background: '#000406',
    // "AI" in the logo.
    accent: '#00F5F3',
    dir: '/brand/gullyai',
    og: '/brand/gullyai/og-1200x630.png',
    ogAlt: 'Gully AI logo and the Gully AI robot: ask anything about Gully Labs.',
  },
}

/** The root icon paths a browser or crawler may ask for directly, mapped to a brand's own files. */
const ROOT_ICONS = {
  '/favicon.ico': 'favicon.ico',
  '/favicon.png': 'app-icon-512.png',
  '/favicon-16.png': 'favicon-16.png',
  '/favicon-32.png': 'favicon-32.png',
  '/apple-touch-icon.png': 'app-icon-180.png',
  '/apple-touch-icon-precomposed.png': 'app-icon-180.png',
  '/icon-192.png': 'app-icon-192.png',
  '/icon-512.png': 'app-icon-512.png',
  '/icon-maskable-512.png': 'maskable-512.png',
}

/** On a product's own host, the brand file to serve for a root icon path (or null: the default file). */
export function brandRootIcon(brandKey, pathname) {
  const b = PRODUCT_BRANDS[brandKey]
  const f = b && ROOT_ICONS[pathname]
  return f ? `${b.dir}/${f}` : null
}

/** The web app manifest's icons for a brand. */
export function brandManifestIcons(brandKey) {
  const d = PRODUCT_BRANDS[brandKey].dir
  return [
    { src: `${d}/app-icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `${d}/app-icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: `${d}/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ]
}

/**
 * index.html's head, rebranded: theme colour, favicons, apple-touch icon, og:site_name and the share image's alt
 * text. `icons: false` keeps the host's own favicons (Gully AI pages on gullylabs.xyz stay in the site's tab icon;
 * only the colour and share image are Gully AI's).
 */
export function applyBrandHead(html, brandKey, { icons = true, siteName = true } = {}) {
  const b = PRODUCT_BRANDS[brandKey]
  if (!b) return html
  let out = html.replace(/<meta name="theme-color"[^>]*>/, `<meta name="theme-color" content="${b.background}" />`)
  if (icons) {
    out = out
      .replace(/<!-- Icons:[^>]*-->/, `<!-- Icons: the ${b.name} kit (public${b.dir}, scripts/product-brand-assets.py). -->`)
      .replace(/(<link rel="icon"[^>]*sizes="(\d+)x\2"[^>]*href=")[^"]*(")/g, (_, a, s, z) => `${a}${b.dir}/favicon-${s}.png${z}`)
      .replace(/(<link rel="apple-touch-icon"[^>]*href=")[^"]*(")/, `$1${b.dir}/app-icon-180.png$2`)
  }
  if (siteName) out = out.replace(/<meta property="og:site_name"[^>]*>/, `<meta property="og:site_name" content="${b.name}" />`)
  out = out.replace(/<meta property="og:image:alt"[^>]*>/, `<meta property="og:image:alt" content="${b.ogAlt.replace(/"/g, '&quot;')}" />`)
  return out
}
