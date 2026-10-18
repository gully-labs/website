// Per-page head tags for crawlers and link previews. The app is client-rendered, so without this
// every URL on every host served index.html's one title, and every page (docs included) named the
// homepage as its canonical address, which tells search engines to drop it as a duplicate.
// The <Seo> component keeps matching titles in the browser; keep the two in step.

import fs from 'node:fs'
import { APP_HOST, APP_URL, isAppHost } from './hosts.mjs'
import { published, publishedJobs } from './security-store.mjs'
import { scorePageMeta, scoreSitemapPaths } from './gully-score.mjs'
import { publicChains } from './payments.mjs'
// Guarded: holders.mjs exports holdersAvailable(chain, kind), read at call time (env keys), so stock pages come back
// on their own once a chain's key is set. Without it every stock chain counts as unavailable (DeepCore launches only).
import * as holdersModule from './holders.mjs'

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
  // The chain list is filled in per request from what checkout offers now (pricingDescription below).
  '/pricing': ['Pricing: tracker API and Gully Analytics plans · Gully Labs', 'Plans for the Gully Labs tracker API and for Gully Analytics, paid in USDC, USDT or the chain\'s own coin from your own wallet, with no custody.'],
  '/status': ['Status · Gully Labs', 'Live status of Gully Labs: the API, tracker freshness per chain, the DeepCore poller, the Telegram bot, Gully Pay RPCs, Gully AI, the security scan engine, monitors and Holder Map sources, with 24 h uptime and incidents.'],
  '/widget': ['Tracker widget · Gully Labs', 'Embed the Gully Labs stock token tracker on any page: a live ticker, a one-stock badge or a table of the widest gaps.'],
  '/services': ['Services · Gully Labs', 'Smart contracts, dApps, chain infrastructure and security testing from the team behind the Gully Labs projects.'],
  '/analytics': ['Gully Analytics: web analytics that see the wallet · Gully Labs', 'Privacy-friendly analytics for dapps: page views plus wallet connects, chains and transactions, with a visit to wallet to transaction funnel. Start a free trial with your wallet.'],
  '/security': ['Gully Security: AI Security Scan and Security Review · Gully Labs', 'Scan a deployed contract or a repository with the automated AI Security Scan, or ask people to review your code. What each tier checks, what it cannot, and the price.'],
  '/security/reports': ['Published security scan reports · Gully Labs', 'AI Security Scan reports their owners chose to publish: the findings, the tools that ran and the limits of an automated scan.'],
  '/chain-kit': ['Chain Kit: a branded block explorer for your chain · Gully Labs', 'A branded Blockscout block explorer for your EVM chain, deployed and operated by Gully Labs.'],
  '/holders': ['Holder Map: who really holds a token · Gully Labs', 'See who holds any DeepCore launch: the biggest wallets, the ones that trade with each other, bundled launch buys, the deployer’s record and a health score you can check part by part. Tokenised stocks follow chain by chain.'],
  '/ask': ['Gully AI · Gully Labs', 'Gully AI answers questions about Gully Labs, the stock token tracker, its API, plans and products. Answers come from the docs and the site, with sources.'],
  '/legal/merchant-terms': ['Gully Pay merchant terms · Gully Labs', 'The terms for running a Gully Pay store: a transaction fee only, non-custodial payments to your own wallets, weekly statements and the pause policy.'],
  '/legal/privacy': ['Privacy policy · Gully Labs', 'What Gully Labs collects across the site, the app, Gully Analytics, Gully AI, the Telegram bot and Gully Pay, why, who else sees it and how long it is kept.'],
  '/links': ['Links · Gully Labs', 'Every Gully Labs link in one place: the site, the app, the stock tracker, Gully AI, Gully Analytics, Gully Pay, Chain Kit, docs, the Telegram bot and the news channel.'],
  '/score': ['Gully Score: transparent contract scores · Gully Labs', 'The Gully Score rates a contract 0 to 100 from public evidence only: verified code, who controls it, upgrades, delays, recent privileged changes, locks and holders. Nobody can pay to change a score.'],
  '/about': ['About · Gully Labs', 'Gully Labs is a blockchain development company that designs, builds and releases Web3 projects under its own name.'],
}
for (const [slug, [name, text]] of Object.entries(PROJECTS)) MAIN[`/projects/${slug}`] = [`${name} · Gully Labs`, text]

// One page per tracked stock token, from the same tables the tracker reads (server/data next to this file).
const HOLDER_PAGES = {}
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
      `${s.ticker} token price vs fair price (${CHAIN_NAMES[key]}) · Gully Labs`,
      `${s.name} (${s.ticker}) token on ${CHAIN_NAMES[key]}: its price in its deepest pool against its ${key === 'solana' ? 'Chainlink (or issuer)' : 'Chainlink'} fair price, the gap, pool depth and history, read live.`,
    ]
  // Its Holder Map (pageMeta answers these paths itself; listed for the sitemap only while that chain has holder data).
  for (const s of stocks) HOLDER_PAGES[`/holders/${key}/${s.ticker}`] = key
}

/** Whether the Holder Map has data for a stock chain right now (false until holders.mjs says so). */
export function holdersAvailableFor(chainKey) {
  try {
    return typeof holdersModule.holdersAvailable === 'function' ? !!holdersModule.holdersAvailable(chainKey, 'stock') : false
  } catch {
    return false
  }
}

/** "Base, Ethereum, BNB Chain, Arbitrum and Solana": the chains checkout offers now (Solana Pay included). */
export function pricingChains() {
  let names = []
  try {
    names = publicChains().filter((c) => !c.testnet).map((c) => c.name)
  } catch {
    /* unreadable: the fallback sentence below */
  }
  if (!names.length) return null
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
}

function pricingDescription() {
  const list = pricingChains()
  return `Plans for the Gully Labs tracker API and for Gully Analytics, paid in USDC, USDT or the chain's own coin ${list ? `on ${list} today; more chains as the treasury is deployed` : 'on the chains the treasury is deployed on'}, with no custody.`
}

const DOCS_PAGES = {
  '/': ['Gully Labs docs', 'Docs for Gully Labs: the stock token tracker on Robinhood Chain, BNB Chain and Solana, its public API, the widget and API keys, plus Gully Pay, the Holder Map, Gully AI, the Telegram bot, swaps and status.'],
  '/methodology': ['Methodology · Gully Labs docs', 'How fair prices, onchain prices, gaps and staleness are read and computed for every tokenised stock.'],
  '/api': ['API reference · Gully Labs docs', 'The public tracker API: endpoints, fields, rate limits and errors. Free to call with no key.'],
  '/widget': ['Widget guide · Gully Labs docs', 'Embed the live tracker with one script tag: ticker, badge and table, with every option.'],
  '/api-keys': ['API keys · Gully Labs docs', 'How to get a free Gully Labs API key instantly by signing in with a wallet, and use it for a higher rate limit.'],
  '/analytics': ['Gully Analytics · Gully Labs docs', 'Gully Analytics: sign up with a wallet, install the tracker, Web3 events, address privacy modes, plans and what happens at the quota or when a plan lapses.'],
  '/plans-alerts': ['Plans & alerts · Gully Labs docs', 'Paid API plans paid in USDC, USDT or the chain’s own coin on the chains where the treasury is deployed, gap alerts by webhook or Telegram, the webhook payload and how to verify its signature.'],
  '/gully-pay': ['Gully Pay · Gully Labs docs', 'Gully Pay: invoices and reusable pay links in ETH, BNB, USDC or USDT, wallet QR codes, the Pay with crypto button, and signed merchant webhooks with how to verify them.'],
  '/gully-pay-merchants': ['Gully Pay for merchants · Gully Labs docs', 'Run your own non-custodial crypto checkout: wallets per chain, pay links and invoices, signed webhooks, a transaction fee only, weekly statements and the pause policy.'],
  '/gully-security': ['Gully Security · Gully Labs docs', 'Gully Security: the AI Security Scan (inputs, steps, quotas and payment), reading a report, publishing it, and requesting a human Security Review.'],
  '/teams': ['Teams & workspaces · Gully Labs docs', 'Workspaces in the app dashboard: roles and what each may change, invites by wallet or link, the activity log, and CSV exports of usage and payments.'],
  '/sdk': ['SDK · Gully Labs docs', 'A typed TypeScript client for the tracker API, and the embeddable widget with a React component.'],
  '/roadmap': ['Roadmap · Gully Labs docs', 'What Gully Labs is building, with an honest status for each track. Gully Security’s AI Security Scan, Gully Score and monitors are live; Security Reviews are quoted on request; audits are not offered. The Gully L3 is planned.'],
  '/roadmap-l3': ['Roadmap: Gully L3 · Gully Labs docs', 'The plan for the Gully L3: an Arbitrum chain settling to Arbitrum One with Chain Kit, Gully Pay and Hyperlane as its interop layer. Status: spec written, devnet prepared, nothing running.'],
  '/holder-map': ['Holder Map · Gully Labs docs', 'How the Holder Map works: data sources per chain, clusters and hidden links, the launch health score part by part, live mode, alerts, the API and the honesty rules.'],
  '/gully-score': ['Gully Score methodology · Gully Labs docs', 'How the Gully Score is worked out: every component, its weight and source, what happens when data is missing, the badge and widget, and why nobody can pay to change a score.'],
  '/gully-ai': ['Gully AI · Gully Labs docs', 'How Gully AI answers questions about Gully Labs: its sources and citations, the live tools it reads, where it runs (site, ⌘K, docs, app, Telegram), its limits and what it logs.'],
  '/telegram': ['Telegram bot and Mini App · Gully Labs docs', 'The @GullyLabsBot Telegram bot and its Mini App: commands, menus, gap and launch alerts with Mute, connecting a chat from the app, the @GullyLabsNews channel requirement, groups and announcements.'],
  '/chain-kit': ['Chain Kit · Gully Labs docs', 'Chain Kit: a branded Blockscout block explorer for your EVM chain, deployed and operated by Gully Labs. What is included, how to request one from the app, and its status.'],
  '/swaps': ['Swaps · Gully Labs docs', 'How swaps work on Gully Labs stock pages: LI.FI on Robinhood Chain and BNB Chain, Jupiter on Solana, the region check (GET /api/geo), the Jupiter proxy, fees, and why your wallet signs everything.'],
  '/solana': ['Solana · Gully Labs docs', 'Gully Labs on Solana: xStocks in the tracker, fair prices from Chainlink or the issuer’s quote, the Holder Map on Solana, Solana Pay in Gully Pay, and Jupiter swaps on stock pages.'],
  '/status': ['Status · Gully Labs docs', 'The Gully Labs status page and GET /api/status: what each check means, how 24-hour uptime is computed, how incidents open and close, and the JSON shape.'],
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
  // The Gully Labs App.
  if (isAppHost(host))
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
  // Holder Maps (holders.mjs): a page per DeepCore launch or tracked stock token; the share image is the map's own card.
  const hm = p.match(/^\/(embed\/)?holders\/(robinhood|bsc|base|hyperevm|solana)\/([A-Za-z0-9]{1,64})$/)
  if (hm) {
    const chainName = { robinhood: 'Robinhood Chain', bsc: 'BNB Chain', base: 'Base', hyperevm: 'HyperEVM', solana: 'Solana' }[hm[2]]
    const what = /^0x/.test(hm[3]) || hm[3].length > 12 ? 'this token' : hm[3].toUpperCase()
    return {
      title: `Holder Map: ${what} on ${chainName} · Gully Labs`,
      description: `Who holds ${what} on ${chainName}: the biggest wallets, the ones that trade with each other, launch checks and a replay of how holdings changed, read live.`,
      canonical: hm[1] ? null : `${SITE}/holders/${hm[2]}/${hm[3]}`,
      found: true,
      // A stock token's map on a chain without holder data would be an empty page: kept out of the index.
      noindex: !!hm[1] || (HOLDER_PAGES[`/holders/${hm[2]}/${hm[3].toUpperCase()}`] !== undefined && !holdersAvailableFor(hm[2])),
      image: `${SITE}/api/holders/${hm[2]}/${hm[3]}/card.png`,
    }
  }
  // A published scan report: a real page while it is published, indexed only when its owner opted in.
  const sr = p.match(/^\/security\/reports\/(sec_[\w-]{16})$/)
  if (sr) {
    const j = published(sr[1])
    if (!j) return { title: 'Report not found · Gully Labs', description: MAIN['/security/reports'][1], canonical: null, found: false }
    return { title: `Security scan report: ${reportTitle(j)} · Gully Labs`, description: 'An AI Security Scan report published by its owner: findings by severity, the tools that ran and the limits of an automated scan. Not an audit.', canonical: `${SITE}${p}`, found: true, noindex: !j.indexable, image: `${SITE}/social/og-security.png` }
  }
  // Gully Score pages (gully-score.mjs): one per contract; listed ones are indexed, the rest are noindex.
  const sm = scorePageMeta(p)
  if (sm) return sm.found ? { title: sm.title, description: sm.description, canonical: sm.canonical, found: true, noindex: sm.noindex, image: `${SITE}/social/og-score.png` } : { title: 'Not found · Gully Labs', description: MAIN['/'][1], canonical: null, found: false }
  const m = MAIN[p]
  // Paths the app still routes (/admin locally, /docs in development) are not 404s but are not pages either.
  if (!m) return { title: 'Not found · Gully Labs', description: MAIN['/'][1], canonical: null, found: false }
  const og = p === '/' || p.startsWith('/legal/') ? 'home' : p === '/ask' ? 'ask' : p.startsWith('/security') ? 'security' : p.startsWith('/projects/') ? `project-${p.slice(10)}` : p.slice(1)
  return { title: m[0], description: p === '/pricing' ? pricingDescription() : m[1], canonical: SITE + (p === '/' ? '/' : p), found: true, image: `${SITE}/social/og-${og}.png`, ld: p === '/' ? ORG : p === '/tracker' ? TRACKER_LD : null }
}

/** A report's subject in a title: the contract or the repository. */
function reportTitle(j) {
  const i = j.input ?? {}
  if (i.kind === 'address') return `${i.address.slice(0, 6)}…${i.address.slice(-4)} on ${i.chain}`
  if (i.repo) return i.repo
  return 'uploaded code'
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
  const base = host.startsWith('docs.') ? DOCS : isAppHost(host) ? APP : SITE
  return `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`
}

/** sitemap.xml per host: each host lists only its own pages, as the protocol requires. */
export function sitemapFor(host) {
  // The admin host has no public pages (robots.txt disallows everything there).
  if (host.startsWith('admin.')) return null
  const today = new Date().toISOString().slice(0, 10)
  let urls
  if (host.startsWith('docs.')) urls = Object.keys(DOCS_PAGES).map((p) => [DOCS + (p === '/' ? '/' : p), p === '/' ? '1.0' : '0.7', 'weekly'])
  else if (isAppHost(host)) urls = [[`${APP}/`, '0.6', 'monthly']]
  else
    urls = [...Object.keys(MAIN), ...Object.entries(HOLDER_PAGES).filter(([, chain]) => holdersAvailableFor(chain)).map(([p]) => p), ...publishedJobs().filter((j) => j.indexable).map((j) => `/security/reports/${j.id}`)].map((p) => [
      SITE + (p === '/' ? '/' : p),
      p === '/' ? '1.0' : p === '/tracker' ? '0.9' : p.startsWith('/projects/') ? '0.8' : '0.7',
      p === '/tracker' ? 'hourly' : p.startsWith('/tracker/') ? 'daily' : p === '/' || p === '/score' || p.startsWith('/projects/') ? 'daily' : 'monthly',
    ])
  // Listed Gully Score pages (a watched contract that allows listing, or one with a published report).
  if (!host.startsWith('docs.') && !isAppHost(host)) for (const p of scoreSitemapPaths()) urls.push([SITE + p, '0.5', 'daily'])
  const rows = urls.map(([u, pr, f]) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`
}
