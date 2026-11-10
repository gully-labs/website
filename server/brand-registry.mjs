// The product brand registry on the server: src/data/productBrands.ts, carried in server/data/page-content.json
// (`brands`, written by scripts/build-page-content.mjs). Every product mark the server draws comes from here, and
// GET /api/brands gives the same table to any other site (absolute URLs, the kit source and SHA-256 of each file).
import fs from 'node:fs'

export const BRANDS = JSON.parse(fs.readFileSync(new URL('./data/page-content.json', import.meta.url), 'utf8')).brands

/** The registry with absolute URLs on `origin`, for other sites. */
export function brandsJson(origin = 'https://gullylabs.xyz') {
  const abs = (f) => (f && typeof f === 'object' && typeof f.src === 'string' ? { ...f, url: origin + f.src, ...(f.src2x ? { src2x: abs(f.src2x) } : {}) } : f)
  const out = {}
  for (const [k, b] of Object.entries(BRANDS)) {
    out[k] = { ...b, icon: abs(b.icon), ...(b.logo ? { logo: abs(b.logo) } : {}), ...(b.extra ? { extra: Object.fromEntries(Object.entries(b.extra).map(([n, f]) => [n, abs(f)])) } : {}) }
  }
  return { version: 1, source: 'https://github.com/gully-labs/website/blob/main/src/data/productBrands.ts', brands: out }
}
