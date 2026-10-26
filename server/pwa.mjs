// PWA: the web app manifests (one per host), the service worker's rules and its build-time generator, and the small
// pure helpers the install and update cards use. Imported by the server (manifest route), vite.config.ts (the build
// emits dist/sw.js), the browser (src/pwa) and scripts/test-pwa-unit.mjs.
//
//   gullylabs.xyz        "Gully Labs"      installs the site
//   app.gullylabs.xyz    "Gully Labs App"  installs the app dashboard
//   holdermaps.xyz       "HolderMaps"      installs the Holder Map (its own domain, server/hosts.mjs)
//   gullysecurity.xyz    "Gully Security"  installs Gully Security (its own domain, server/hosts.mjs)
//
// Caching rules (the whole service worker, in one place):
//   - Only same-origin GET requests without an Authorization header are ever looked at.
//   - NEVER touched: /api/*, /pay/*, /admin*, /tg*, /embed/*, /r/*, /og/*, /analytics*, /.well-known/*, the worker and
//     manifest themselves. Those go straight to the network, always.
//   - Hashed build files (/assets/name-<8 chars>.ext) are cache-first (their names change with their content).
//   - Page navigations are network-first; offline they fall back to the cached app shell (index.html), or the offline page.
//   (The build-time generator is in pwa-build.mjs; this file is browser-safe.)
//   - The app shell (index.html, the entry chunk, its css, its static imports, the latin fonts, the offline page, the
//     icon) is precached at install under a versioned cache; older versions' caches are deleted on activate.
/* ------------------------------------------------------------------ manifests --- */

// Kit tokens (public/brand/tokens/tokens.json): lab-night for the background and the browser chrome.
const LAB_NIGHT = '#06050D'
const ICONS = [
  { src: '/brand/icon/app-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/brand/icon/app-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/brand/icon/app-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]

export const SITE_MANIFEST = {
  id: '/',
  name: 'Gully Labs',
  short_name: 'Gully Labs',
  description: 'Gully Labs builds and releases Web3 projects: live fair-price tracker, Holder Maps, Gully Pay and more.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'any',
  background_color: LAB_NIGHT,
  theme_color: LAB_NIGHT,
  icons: ICONS,
}

export const APP_MANIFEST = {
  ...SITE_MANIFEST,
  name: 'Gully Labs App',
  short_name: 'Gully App',
  description: 'The Gully Labs App: API keys, alerts, analytics, payments and every Gully service in one dashboard.',
}

export const HOLDERMAPS_MANIFEST = {
  ...SITE_MANIFEST,
  name: 'HolderMaps',
  short_name: 'HolderMaps',
  // The HolderMaps brand kit (public/brand/holdermaps, byte-exact): ink #0A0A0A and its own app icons.
  background_color: '#0A0A0A',
  theme_color: '#0A0A0A',
  icons: [
    { src: '/brand/holdermaps/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/brand/holdermaps/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  ],
  description: 'HolderMaps by Gully Labs: who really holds a token, the biggest wallets and the ones that trade with each other, read live.',
}

export const SECURITY_MANIFEST = {
  ...SITE_MANIFEST,
  name: 'Gully Security',
  short_name: 'Gully Security',
  description: 'Gully Security by Gully Labs: the AI Security Scan of a contract or codebase, published scan reports, the Gully Score and contract monitors.',
}

/** The manifest this host serves, or null when none applies (admin, docs, blog, analytics are not installable). */
export function manifestFor(host) {
  const h = String(host || '').split(':')[0].toLowerCase()
  if (/^(admin|docs|blog|analytics)\./.test(h)) return null
  if (/^(www\.)?holdermaps\.xyz$/.test(h)) return HOLDERMAPS_MANIFEST
  if (/^(www\.)?gullysecurity\.xyz$/.test(h)) return SECURITY_MANIFEST
  return h.startsWith('app.') ? APP_MANIFEST : SITE_MANIFEST
}

/** GET /manifest.json (also /manifest.webmanifest): answers true when it handled the request. */
export function handleManifest(req, res, url, host) {
  if (url.pathname !== '/manifest.json' && url.pathname !== '/manifest.webmanifest') return false
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  const m = manifestFor(host)
  if (!m) {
    res.writeHead(404, { 'Cache-Control': 'public, max-age=3600' })
    res.end()
    return true
  }
  res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=3600', Vary: 'Host' })
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify(m))
  return true
}

/* ------------------------------------------------------------------ service worker rules --- */

/** Serialisable rules, inlined into the worker as JSON. */
export const SW_RULES = {
  // A path is never handled when it equals one of these or sits under one.
  never: ['/api', '/pay', '/admin', '/tg', '/embed', '/r', '/og', '/analytics', '/.well-known', '/healthz', '/sw.js', '/manifest.json', '/manifest.webmanifest', '/robots.txt', '/sitemap.xml'],
  // Build files named name-<8 chars>.ext (the same pattern the server gives a one-year immutable cache).
  hashed: '^/assets/.+-[\\w-]{8}\\.[a-z0-9]+$',
}

/**
 * What the worker does with a request: 'asset' (cache-first), 'navigate' (network-first, shell offline) or null (leave
 * it to the network). Self-contained (no outer references) because the worker is generated with this function's source.
 * req: { url, method, mode, origin, hasAuth }
 */
export function routeFor(rules, req) {
  if (req.method !== 'GET' || req.hasAuth) return null
  let u
  try {
    u = new URL(req.url)
  } catch {
    return null
  }
  if (u.origin !== req.origin) return null
  const p = u.pathname
  for (const base of rules.never) if (p === base || p.startsWith(base + '/')) return null
  if (new RegExp(rules.hashed).test(p)) return 'asset'
  if (req.mode === 'navigate') return 'navigate'
  return null
}

/** Pages that get no service worker registration at all: admin, Gully Pay checkouts, the Telegram Mini App, the embed. */
export function swEligible(host, pathname) {
  const h = String(host || '').split(':')[0].toLowerCase()
  if (/^(admin|docs|blog|analytics)\./.test(h)) return false
  return !/^\/(admin|pay|tg|embed)(\/|$)/.test(pathname || '/')
}

/* ------------------------------------------------------------------ install card logic --- */

export const INSTALL_DISMISS_KEY = 'gl-pwa-install-dismissed'
export const INSTALL_DISMISS_DAYS = 30

/** True when `raw` (a stored timestamp in ms) is less than 30 days old. */
export function dismissedRecently(raw, now = Date.now()) {
  const t = Number(raw)
  return Number.isFinite(t) && t > 0 && now - t < INSTALL_DISMISS_DAYS * 86_400_000
}

/** iPhone, iPad or iPod in Safari itself (other iOS browsers cannot add to the Home Screen the same way). */
export function isIosSafari(ua, platform = '', touchPoints = 0) {
  const ios = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1)
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua)
}

/**
 * Which install card to show: 'prompt' (a beforeinstallprompt event is waiting), 'ios' (Share, Add to Home Screen
 * instructions) or null. Never when installed (standalone) or dismissed in the last 30 days.
 */
export function installCardMode({ standalone, dismissedRaw, now = Date.now(), hasPrompt, ios }) {
  if (standalone || dismissedRecently(dismissedRaw, now)) return null
  if (hasPrompt) return 'prompt'
  return ios ? 'ios' : null
}
