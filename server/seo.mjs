// Per-page head tags for crawlers and link previews. The app is client-rendered, so without this
// every URL on every host served index.html's one title, and every page (docs included) named the
// homepage as its canonical address, which tells search engines to drop it as a duplicate.
// The <Seo> component keeps matching titles in the browser; keep the two in step.

import fs from 'node:fs'
import { APP_HOST, APP_URL, isAppHost, isLegacyDevelopersHost } from './hosts.mjs'

const SITE = 'https://gullylabs.xyz'
const DOCS = 'https://docs.gullylabs.xyz'
const APP = APP_URL

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
  '/tracker': ['Stock token tracker: tokenised stocks vs fair price · Gully Labs', 'Live: every tokenised stock on Robinhood Chain, BNB Chain and Solana against its fair price (Chainlink, or for some Solana xStocks the issuer’s quote), with the gap, pool depth and feed time.'],
  '/pricing': ['Pricing: tracker API and Gully Analytics plans · Gully Labs', 'Plans for the Gully Labs tracker API and for Gully Analytics, paid in USDC, USDT or the chain\'s own coin on Base, Ethereum, BNB Chain, Arbitrum, OP Mainnet, Polygon or Avalanche, with no custody.'],
  '/widget': ['Tracker widget · Gully Labs', 'Embed the Gully Labs stock token tracker on any page: a live ticker, a one-stock badge or a table of the widest gaps.'],
  '/services': ['Services · Gully Labs', 'Smart contracts, dApps, chain infrastructure and security testing from the team behind the Gully Labs projects.'],
  '/analytics': ['Gully Analytics: web analytics that see the wallet · Gully Labs', 'Privacy-friendly analytics for dapps: page views plus wallet connects, chains and transactions, with a visit to wallet to transaction funnel. Start a free trial with your wallet.'],
  '/chain-kit': ['Chain Kit: a branded block explorer for your chain · Gully Labs', 'A branded Blockscout block explorer for your EVM chain, deployed and operated by Gully Labs.'],
  '/ask': ['Gully AI · Gully Labs', 'Gully AI answers questions about Gully Labs, the stock token tracker, its API, plans and products. Answers come from the docs and the site, with sources.'],
  '/legal/merchant-terms': ['Gully Pay merchant terms · Gully Labs', 'The terms for running a Gully Pay store: a transaction fee only, non-custodial payments to your own wallets, weekly statements and the pause policy.'],
  '/about': ['About · Gully Labs', 'Gully Labs is a blockchain development company that designs, builds and releases Web3 projects under its own name.'],
}
for (const [slug, [name, text]] of Object.entries(PROJECTS)) MAIN[`/projects/${slug}`] = [`${name} · Gully Labs`, text]

// One page per tracked stock token, from the same tables the tracker reads (server/data next to this file).
const CHAIN_NAMES = { robinhood: 'Robinhood Chain', bsc: 'BNB Chain', solana: 'Solana' }
for (const key of Object.keys(CHAIN_NAMES)) {
  let stocks = []
  try {
    stocks = JSON.parse(fs.readFileSync(new URL(`./data/${key}-stocks.json`, import.meta.url), 'utf8')).stocks
  } catch {
    /* no table: no pages for this chain */
  }
  for (const s of stocks)
    MAIN[`/tracker/${key}/${s.ticker}`] = [
      `${s.ticker} token price vs fair value (${CHAIN_NAMES[key]}) · Gully Labs`,
      `${s.name} (${s.ticker}) token on ${CHAIN_NAMES[key]}: its price in its deepest pool against its ${key === 'solana' ? 'Chainlink (or issuer)' : 'Chainlink'} fair price, the gap, pool depth and history, read live.`,
    ]
}

const DOCS_PAGES = {
  '/': ['Gully Labs docs', 'How the Gully Labs stock token tracker works, its public API, the embeddable widget and API keys.'],
  '/methodology': ['Methodology · Gully Labs docs', 'How fair prices, onchain prices, gaps and staleness are read and computed for every tokenised stock.'],
  '/api': ['API reference · Gully Labs docs', 'The public tracker API: endpoints, fields, rate limits and errors. Free to call with no key.'],
  '/widget': ['Widget guide · Gully Labs docs', 'Embed the live tracker with one script tag: ticker, badge and table, with every option.'],
  '/api-keys': ['API keys · Gully Labs docs', 'How to get a free Gully Labs API key instantly by signing in with a wallet, and use it for a higher rate limit.'],
  '/analytics': ['Gully Analytics · Gully Labs docs', 'Gully Analytics: sign up with a wallet, install the tracker, Web3 events, address privacy modes, plans and what happens at the quota or when a plan lapses.'],
  '/plans-alerts': ['Plans & alerts · Gully Labs docs', 'Paid API plans paid in ETH, BNB, USDC or USDT on four chains, gap alerts by webhook or Telegram, the webhook payload and how to verify its signature.'],
  '/gully-pay': ['Gully Pay · Gully Labs docs', 'Gully Pay: invoices and reusable pay links in ETH, BNB, USDC or USDT, wallet QR codes, the Pay with crypto button, and signed merchant webhooks with how to verify them.'],
  '/gully-pay-merchants': ['Gully Pay for merchants · Gully Labs docs', 'Run your own non-custodial crypto checkout: wallets per chain, pay links and invoices, signed webhooks, a transaction fee only, weekly statements and the pause policy.'],
  '/teams': ['Teams & workspaces · Gully Labs docs', 'Workspaces in the developer portal: roles and what each may change, invites by wallet or link, the activity log, and CSV exports of usage and payments.'],
  '/sdk': ['SDK · Gully Labs docs', 'A typed TypeScript client for the tracker API, and the embeddable widget with a React component.'],
  '/roadmap': ['Roadmap · Gully Labs docs', 'What Gully Labs plans to build next, with an honest status for each track: the Gully L3, and Audits & Security (AI security scans, security reviews, smart-contract and code audits, Gully Score and monitoring). All planned; nothing is offered yet.'],
  '/roadmap-l3': ['Roadmap: Gully L3 · Gully Labs docs', 'The plan for the Gully L3: an Arbitrum chain settling to Arbitrum One with Chain Kit, Gully Pay and Hyperlane as its interop layer. Status: spec written, devnet prepared, nothing running.'],
  '/changelog': ['Changelog · Gully Labs docs', 'What changed in the Gully Labs tracker, API and widget, and when.'],
}

const ORG = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Gully Labs',
  url: SITE,
  logo: `${SITE}/brand/gully-mark-512.png`,
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

export const APP_TITLE = 'Gully Labs App · keys, alerts, analytics, payments'
const APP_DESCRIPTION = 'Sign in with your wallet to create Gully Labs API keys instantly, set gap and launch alerts, run Gully Analytics, and pay for plans and invoices in crypto, with your team in one workspace.'
const isLocal = (host) => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)

/** Head tags for one request. `found: false` means no page owns the path (served as a 404). */
export function pageMeta(host, pathname) {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/'
  // Development on localhost: the app also routes the portal, the admin and the docs (under /docs) there.
  if (isLocal(host)) {
    if (p === '/developers' || p === '/app') return { ...pageMeta(APP_HOST, '/'), canonical: null, noindex: true }
    if (p === '/admin' || p.startsWith('/admin/')) return pageMeta('admin.gullylabs.xyz', '/')
    if (p === '/docs' || p.startsWith('/docs/')) {
      const m = pageMeta('docs.gullylabs.xyz', p.slice(5) || '/')
      return { ...m, canonical: null, noindex: true }
    }
  }
  if (host.startsWith('docs.')) {
    const m = DOCS_PAGES[p]
    if (m) return { title: m[0], description: m[1], canonical: DOCS + (p === '/' ? '/' : p), found: true, image: `${SITE}/social/og-docs.png` }
    return { title: 'Not found · Gully Labs docs', description: DOCS_PAGES['/'][1], canonical: null, found: false }
  }
  // The Gully Labs App (its old developers host only answers 301s for pages, but names the app if asked).
  if (isAppHost(host) || isLegacyDevelopersHost(host))
    return { title: APP_TITLE, description: APP_DESCRIPTION, canonical: `${APP}/`, found: true, image: `${SITE}/social/og-developers.png` }
  // The admin app is one page at the root of its host; any other path is not a page.
  if (host.startsWith('admin.')) return { title: p === '/' ? 'Admin · Gully Labs' : 'Not found · Gully Labs', description: 'Private.', canonical: null, found: p === '/', noindex: true }
  // Gully Pay invoices and receipts: real pages for whoever holds the link, never indexed.
  // The standalone checkout (src/pages/pay): the browser retitles it "Pay <store>" once the store is known.
  if (/^\/pay\/inv_[\w-]{22}(\/receipt)?$/.test(p)) return { title: p.endsWith('/receipt') ? 'Receipt · Gully Pay' : 'Pay Gully Labs · Gully Pay', description: 'Pay a Gully Labs invoice in ETH, BNB, USDC or USDT, straight to the Gully Labs treasury.', canonical: null, found: true, noindex: true }
  if (/^\/pay\/l\/pl_[\w-]{16}$/.test(p)) return { title: 'Pay Gully Labs · Gully Pay', description: 'Pay with crypto in ETH, BNB, USDC or USDT, wallet to wallet, through Gully Pay.', canonical: null, found: true, noindex: true }
  // Gully Pay merchant checkouts and receipts (merchants.mjs): real pages for whoever holds the link, never indexed.
  if (/^\/pay\/m\/(mi_[\w-]{22}(\/receipt)?|l\/ml_[\w-]{16})$/.test(p)) return { title: p.endsWith('/receipt') ? 'Receipt · Gully Pay' : 'Pay · Gully Pay', description: 'Pay with crypto, wallet to wallet, through Gully Pay.', canonical: null, found: true, noindex: true }
  // The Telegram Mini App: a real page, but only inside Telegram; never indexed.
  if (p === '/tg') return { title: 'Gully Labs · Telegram app', description: 'The Gully Labs tracker, DeepCore launches and your gap alerts, inside Telegram.', canonical: null, found: true, noindex: true }
  const m = MAIN[p]
  // Paths the app still routes (/admin locally, /docs in development) are not 404s but are not pages either.
  if (!m) return { title: 'Not found · Gully Labs', description: MAIN['/'][1], canonical: null, found: false }
  const og = p === '/' ? 'home' : p === '/ask' ? 'ask' : p.startsWith('/projects/') ? `project-${p.slice(10)}` : p.startsWith('/legal/') ? 'home' : p.slice(1)
  return { title: m[0], description: m[1], canonical: SITE + (p === '/' ? '/' : p), found: true, image: `${SITE}/social/og-${og}.png`, ld: p === '/' ? ORG : p === '/tracker' ? TRACKER_LD : null }
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
  if (meta.image) {
    swap(/<meta property="og:image" [^>]*>/, `<meta property="og:image" content="${esc(meta.image)}" />`)
    swap(/<meta name="twitter:image"[^>]*>/, `<meta name="twitter:image" content="${esc(meta.image)}" />`)
  }
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
  // The old developers host names the app's sitemap: it has none of its own any more.
  const base = host.startsWith('docs.') ? DOCS : isAppHost(host) || isLegacyDevelopersHost(host) ? APP : SITE
  return `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`
}

/** sitemap.xml per host: each host lists only its own pages, as the protocol requires. null: the host has
    none (the old developers host, whose pages all moved to the app). */
export function sitemapFor(host) {
  if (isLegacyDevelopersHost(host)) return null
  const today = new Date().toISOString().slice(0, 10)
  let urls
  if (host.startsWith('docs.')) urls = Object.keys(DOCS_PAGES).map((p) => [DOCS + (p === '/' ? '/' : p), p === '/' ? '1.0' : '0.7', 'weekly'])
  else if (isAppHost(host)) urls = [[`${APP}/`, '0.6', 'monthly']]
  else
    urls = Object.keys(MAIN).map((p) => [
      SITE + (p === '/' ? '/' : p),
      p === '/' ? '1.0' : p === '/tracker' ? '0.9' : p.startsWith('/projects/') ? '0.8' : '0.7',
      p === '/tracker' ? 'hourly' : p.startsWith('/tracker/') ? 'daily' : p === '/' || p.startsWith('/projects/') ? 'daily' : 'monthly',
    ])
  const rows = urls.map(([u, pr, f]) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`
}
