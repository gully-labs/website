// Per-page head tags for crawlers and link previews. The app is client-rendered, so without this
// every URL on every host served index.html's one title, and every page (docs included) named the
// homepage as its canonical address, which tells search engines to drop it as a duplicate.
// The <Seo> component keeps matching titles in the browser; keep the two in step.

const SITE = 'https://gullylabs.xyz'
const DOCS = 'https://docs.gullylabs.xyz'
const DEV = 'https://developers.gullylabs.xyz'

// Project copy, restated from src/content/projects.ts (the server cannot import TypeScript).
const PROJECTS = {
  'cartel-family': ['Cartel Family', 'We trade as one. Live markets, automated strategies and shared trades across chains.'],
  deepcore: ['DeepCore', 'Launch on one core. Tokens, Launchpads, DEXes and stock markets on one shared, hardened core, on four chains.'],
  peddleswap: ['PeddleSwap', 'Swap. Lock. Launch. Swap tokens, earn fees from liquidity, lock tokens or LP and bridge networks.'],
  peddles: ['Peddles', 'Launch, trade and play. Memecoins paired to tokenised stocks; holders are paid in that stock.'],
  peddlequest: ['PeddleQuest', 'Quest on-chain, earn the proof.'],
}

const MAIN = {
  '/': ['Gully Labs · Web3 projects and blockchain development', 'Every project Gully Labs ships reports its own volume, value locked and fees. This page reads each one live and adds them up.'],
  '/tracker': ['Stock token tracker: tokenised stocks vs fair price · Gully Labs', 'Live: every tokenised stock on Robinhood Chain and BNB Chain against its Chainlink fair price, with the gap, pool depth and feed time.'],
  '/widget': ['Tracker widget · Gully Labs', 'Embed the Gully Labs stock token tracker on any page: a live ticker, a one-stock badge or a table of the widest gaps.'],
  '/services': ['Services · Gully Labs', 'Smart contracts, dApps, chain infrastructure and security audits from the team behind the Gully Labs projects.'],
  '/about': ['About · Gully Labs', 'Gully Labs is a blockchain development company that designs, builds and releases Web3 projects under its own name.'],
}
for (const [slug, [name, text]] of Object.entries(PROJECTS)) MAIN[`/projects/${slug}`] = [`${name} · Gully Labs`, text]

const DOCS_PAGES = {
  '/': ['Gully Labs docs', 'How the Gully Labs stock token tracker works, its public API, the embeddable widget and API keys.'],
  '/methodology': ['Methodology · Gully Labs docs', 'How fair prices, onchain prices, gaps and staleness are read and computed for every tokenised stock.'],
  '/api': ['API reference · Gully Labs docs', 'The public tracker API: endpoints, fields, rate limits and errors. Free to call with no key.'],
  '/widget': ['Widget guide · Gully Labs docs', 'Embed the live tracker with one script tag: ticker, badge and table, with every option.'],
  '/api-keys': ['API keys · Gully Labs docs', 'How to request, claim and use a Gully Labs API key for a higher rate limit.'],
  '/changelog': ['Changelog · Gully Labs docs', 'What changed in the Gully Labs tracker, API and widget, and when.'],
}

const ORG = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Gully Labs',
  url: SITE,
  logo: `${SITE}/favicon.png`,
  sameAs: ['https://x.com/Gully_Labs', 'https://github.com/gully-labs'],
}
const TRACKER_LD = {
  '@context': 'https://schema.org',
  '@type': 'Dataset',
  name: 'Tokenised stock prices vs fair price',
  description: MAIN['/tracker'][1],
  url: `${SITE}/tracker`,
  creator: { '@type': 'Organization', name: 'Gully Labs', url: SITE },
  isAccessibleForFree: true,
  distribution: [{ '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${SITE}/api/tracker` }],
}

/** Head tags for one request. `found: false` means no page owns the path (served as a 404). */
export function pageMeta(host, pathname) {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/'
  if (host.startsWith('docs.')) {
    const m = DOCS_PAGES[p]
    if (m) return { title: m[0], description: m[1], canonical: DOCS + (p === '/' ? '/' : p), found: true }
    return { title: 'Not found · Gully Labs docs', description: DOCS_PAGES['/'][1], canonical: null, found: false }
  }
  if (host.startsWith('developers.'))
    return { title: 'Developer portal · Gully Labs', description: 'Request and manage Gully Labs API keys and see your usage of the tracker API.', canonical: `${DEV}/`, found: true }
  if (host.startsWith('admin.')) return { title: 'Admin · Gully Labs', description: 'Private.', canonical: null, found: true, noindex: true }
  const m = MAIN[p]
  // Paths the app still routes (/admin locally, /docs in development) are not 404s but are not pages either.
  if (!m) return { title: 'Not found · Gully Labs', description: MAIN['/'][1], canonical: null, found: false }
  return { title: m[0], description: m[1], canonical: SITE + (p === '/' ? '/' : p), found: true, ld: p === '/' ? ORG : p === '/tracker' ? TRACKER_LD : null }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Rewrites index.html's head for one page. */
export function renderHead(source, meta) {
  let html = source
  const swap = (re, tag) => {
    html = re.test(html) ? html.replace(re, tag) : html.replace('</head>', `    ${tag}\n  </head>`)
  }
  swap(/<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>`)
  swap(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(meta.description)}" />`)
  swap(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${esc(meta.title)}" />`)
  swap(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${esc(meta.description)}" />`)
  if (meta.canonical) {
    swap(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${esc(meta.canonical)}" />`)
    swap(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${esc(meta.canonical)}" />`)
  } else {
    html = html.replace(/\s*<link rel="canonical"[^>]*>/, '').replace(/\s*<meta property="og:url"[^>]*>/, '')
  }
  if (!meta.found || meta.noindex) swap(/<meta name="robots"[^>]*>/, '<meta name="robots" content="noindex" />')
  if (meta.ld) html = html.replace('</head>', `    <script type="application/ld+json">${JSON.stringify(meta.ld).replace(/</g, '\\u003c')}</script>\n  </head>`)
  return html
}

/** robots.txt per host. */
export function robotsFor(host) {
  if (host.startsWith('admin.')) return 'User-agent: *\nDisallow: /\n'
  const base = host.startsWith('docs.') ? DOCS : host.startsWith('developers.') ? DEV : SITE
  return `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`
}

/** sitemap.xml per host: each host lists only its own pages, as the protocol requires. */
export function sitemapFor(host) {
  const today = new Date().toISOString().slice(0, 10)
  let urls
  if (host.startsWith('docs.')) urls = Object.keys(DOCS_PAGES).map((p) => [DOCS + (p === '/' ? '/' : p), p === '/' ? '1.0' : '0.7', 'weekly'])
  else if (host.startsWith('developers.')) urls = [[`${DEV}/`, '0.6', 'monthly']]
  else
    urls = Object.keys(MAIN).map((p) => [
      SITE + (p === '/' ? '/' : p),
      p === '/' ? '1.0' : p === '/tracker' ? '0.9' : p.startsWith('/projects/') ? '0.8' : '0.7',
      p === '/tracker' ? 'hourly' : p === '/' || p.startsWith('/projects/') ? 'daily' : 'monthly',
    ])
  const rows = urls.map(([u, pr, f]) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`
}
