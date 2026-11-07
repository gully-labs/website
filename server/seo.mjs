// Per-page head tags for crawlers and link previews. The app is client-rendered, so without this
// every URL on every host served index.html's one title, and every page (docs included) named the
// homepage as its canonical address, which tells search engines to drop it as a duplicate.
// gullylabs.xyz's own pages take their title, description and body from server/data/page-content.json, which
// scripts/build-page-content.mjs writes from the files the browser draws each page from (src/content/seoPages.ts is
// the table <Seo> reads too), so the served HTML and the page cannot drift. Each indexed page is served with one h1,
// its copy, headings and links, the header and footer links, and JSON-LD of its own type.

import fs from 'node:fs'
import { APP_HOST, APP_URL, holderInternalPath, holderMapsPrimary, holderShortPath, HOLDERMAPS_URL, isApiHost, isAppHost, isEmbedHost, isHolderMapsHost, isPayHost, isSecurityHost, movedDocsUrl, movedPageUrl, PAY_URL, securityInternalPath, securityPrimary, securityShortPath, SECURITY_URL } from './hosts.mjs'
import { published, publishedJobs } from './security-store.mjs'
import { headBrand, PRODUCT_BRANDS } from './product-brand.mjs'
import { scorePageMeta, scoreSitemapPaths } from './gully-score.mjs'
import { publicChains } from './payments.mjs'
// Guarded: holders.mjs exports holdersAvailable(chain, kind), read at call time (env keys), so stock pages come back
// on their own once a chain's key is set. Without it every stock chain counts as unavailable (DeepCore launches only).
import * as holdersModule from './holders.mjs'
import { topScans } from './holders-intel.mjs'

const SITE = 'https://gullylabs.xyz'
const DOCS = 'https://docs.gullylabs.xyz'
const APP = APP_URL

/** What the build wrote for every indexed gullylabs.xyz page (scripts/build-page-content.mjs). */
const CONTENT = JSON.parse(fs.readFileSync(new URL('./data/page-content.json', import.meta.url), 'utf8'))
/** When that file was built: the lastmod of the pages whose content only changes with a release. */
const BUILT_ON = (() => {
  try {
    return fs.statSync(new URL('./data/page-content.json', import.meta.url)).mtime.toISOString().slice(0, 10)
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
})()

/** The Gully Labs share image, derived from the 2026-11 kit's X banner (public/brand/kit), absolute. */
const KIT_OG = 'https://gullylabs.xyz/brand/kit/og-default-1200x630.png'
/** The landing's own share image ("Constellation", 2026-10-27): the eight products around the Gully Labs mark. */
const HUB_OG = KIT_OG
/** The landing's product list for crawlers (src/pages/hub/hubData.ts HUB_PRODUCTS in story order, then PEDDLE_FAMILY). */
const HUB_LD = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'Gully Labs products',
  itemListElement: CONTENT.hub.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, url })),
}
/* Titles and descriptions. gullylabs.xyz's own pages (the home page, /products and one page per product, the Peddle
   projects, the tracker and one page per stock token, pricing, status, legal, …) come from the build; the Holder Map
   and Gully Security pages below are served on holdermaps.xyz and gullysecurity.xyz under those brands' names. */
const MAIN = {
  ...Object.fromEntries(Object.entries(CONTENT.meta).map(([p, m]) => [p, [...m]])),
  '/security': ['Gully Security: AI Security Scan and Security Review · Gully Labs', 'Scan a deployed contract or a repository with the automated AI Security Scan, or ask people to review your code. What each tier checks, what it cannot, and the price.'],
  '/security/reports': ['Published security scan reports · Gully Labs', 'AI Security Scan reports their owners chose to publish: the findings, the tools that ran and the limits of an automated scan.'],
  '/security/sample': ['Sample AI Security Scan report · Gully Labs', 'What an AI Security Scan report looks like, on a fictional contract: findings by severity with file and line, a draft proof of concept, the tools that ran and the limits. A sample, not a scan of real code.'],
  '/holders': ['Holder Map: who really holds a token · Gully Labs', 'See who holds any token: the biggest wallets, the ones that trade with each other, bundled launch buys, the deployer’s record and a health score you can check part by part. Tokenised stocks follow chain by chain.'],
}

const PUBLISHER = { '@type': 'Organization', name: 'Gully Labs', url: SITE }
/** A breadcrumb trail: [[name, url | null], …], the page itself last. */
const crumbsLd = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, ...(item ? { item } : {}) })) })
/** A page of this site, as schema.org sees it (WebPage, AboutPage, CollectionPage). */
const webPageLd = (type, url, name, description) => ({ '@context': 'https://schema.org', '@type': type, name, url, description, inLanguage: 'en', isPartOf: { '@type': 'WebSite', name: 'Gully Labs', url: `${SITE}/` }, publisher: PUBLISHER })
const HOME_CRUMB = ['Gully Labs', `${SITE}/`]

/** A product page: its share image (its kit's card, a file under public/brand/web/og) and its JSON-LD: the product as
    software (or the chain as a Product), its breadcrumb and the questions the page answers. */
function productExtras(p) {
  const m = /^\/products\/([a-z-]+)$/.exec(p)
  const d = m && CONTENT.product[m[1]]
  if (!d) return null
  const url = `${SITE}${p}`
  const image = `${SITE}${d.og}`
  const description = MAIN[p][1]
  const ld =
    d.category === 'BlockchainNetwork'
      ? { '@context': 'https://schema.org', '@type': 'Product', name: d.name, description, url, image, brand: { '@type': 'Brand', name: 'Gully Labs' } }
      : { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: d.name, description, url, image, applicationCategory: d.category, operatingSystem: 'Web', sameAs: d.url, publisher: PUBLISHER }
  const faq = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: d.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }
  return { image, ld: [ld, crumbsLd([HOME_CRUMB, ['Products', `${SITE}/products`], [d.name, url]]), faq] }
}
/** The services, as schema.org Services offered by Gully Labs (the /services page). */
const SERVICES_LD = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'Gully Labs services',
  itemListElement: CONTENT.services.map(([name, description], i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'Service', name, description, provider: PUBLISHER, areaServed: 'Worldwide' } })),
}

// One Holder Map page per tracked stock token (pageMeta answers these paths itself; listed in the sitemap only while
// that chain has holder data). The stock pages themselves (/tracker/<chain>/<ticker>) are in CONTENT.meta.
const HOLDER_PAGES = {}
for (const [key, c] of Object.entries(CONTENT.stocks)) for (const [ticker] of c.rows) HOLDER_PAGES[`/holders/${key}/${ticker}`] = key

/** A stock token page's body: the page's fixed copy (src/content/stockCopy.ts) filled in for this token, its contract
    addresses from the tracker's own table, and the other tokens on its chain. Live figures are drawn by the page. */
function stockBody(chainKey, ticker) {
  const c = CONTENT.stocks[chainKey]
  const row = c?.rows.find((r) => r[0] === ticker)
  if (!row) return null
  const [, , token, feed] = row
  const K = CONTENT.stockCopy
  const fill = (t) => t.replace(/\{(\w+)\}/g, (_, k) => ({ ticker, chain: c.name })[k] ?? '')
  const elsewhere = Object.entries(CONTENT.stocks).filter(([k, x]) => k !== chainKey && x.rows.some((r) => r[0] === ticker)).map(([k, x]) => [`/tracker/${k}/${ticker}`, `${ticker} on ${x.name}`])
  const sec = (h, o) => ({ h, level: 2, p: [], list: [], links: [], qa: [], ...o })
  return {
    // The page's own headline: the ticker and the company's name.
    h1: `${ticker} ${row[1]}`,
    crumbs: [['/tracker', pageHeading(MAIN['/tracker'][0])]],
    sections: [
      sec(K.headings.contracts, { list: [`${K.labels.token}: ${token}`, ...(feed ? [`${K.labels.feed}: ${feed}`] : [])] }),
      sec(fill(K.headings.swaps), { qa: K.faq.map((f) => [f.q, fill(f.a)]) }),
      sec(fill(K.headings.more), { links: [...c.rows.filter((r) => r[0] !== ticker).map((r) => [`/tracker/${chainKey}/${r[0]}`, r[0]]), ...elsewhere] }),
      sec(null, { p: [K.disclaimer] }),
    ],
  }
}

/** The Holder Map pages worth listing: the most-scanned maps of the day (holders-intel's cached scan counts), at most
    200, valid tokens only (a real address for the chain, or a tracked ticker), and no stock map on a chain without
    holder data (the archive-RPC rule). Never throws: no scans, no section. */
export function topHolderPaths(max = 200) {
  const out = []
  try {
    for (const it of topScans(Math.min(200, max) * 2).items) {
      const ok = it.chain === 'solana' ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(it.token) : /^0x[0-9a-fA-F]{40}$/.test(it.token)
      const p = `/holders/${it.chain}/${it.token}`
      const stock = HOLDER_PAGES[`/holders/${it.chain}/${String(it.token).toUpperCase()}`] !== undefined
      if (!CHAIN_NAMES_ALL[it.chain] || !(ok || stock) || (stock && !holdersAvailableFor(it.chain)) || HOLDER_PAGES[p] !== undefined || out.includes(p)) continue
      out.push(p)
      if (out.length >= max) break
    }
  } catch {
    /* no scan data yet */
  }
  return out
}

/** A token's ticker for a Holder Map page's title: a ticker in the URL, else the cached map's or the scan list's symbol. */
function holderSymbol(chain, token) {
  if (!/^0x/.test(token) && token.length <= 12) return token.toUpperCase()
  try {
    const sym = holdersModule.peekHolderMap?.(chain, token)?.token?.symbol ?? topScans(200).items.find((i) => i.chain === chain && i.token.toLowerCase() === token.toLowerCase())?.symbol
    return typeof sym === 'string' && /^[\w.\-$]{1,24}$/.test(sym) ? sym.replace(/^\$/, '').toUpperCase() : null
  } catch {
    return null
  }
}

const CHAIN_NAMES_ALL = { robinhood: 'Robinhood Chain', bsc: 'BNB Chain', base: 'Base', hyperevm: 'HyperEVM', solana: 'Solana', gully: 'Gully Chain Testnet' }

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

const DOCS_PAGES = {
  '/': ['Gully Labs docs', 'Docs for Gully Labs: the stock token tracker on Robinhood Chain, BNB Chain and Solana, its public API, the widget and API keys, plus the Holder Map, Gully Score, Gully AI, the Telegram bot, swaps and status. Gully Chain, Gully Pay, Gully RPC and Gully Security have their own docs on their own domains.'],
  '/methodology': ['Methodology · Gully Labs docs', 'How fair prices, onchain prices, gaps and staleness are read and computed for every tokenised stock.'],
  '/api': ['API reference · Gully Labs docs', 'The public tracker API: endpoints, fields, rate limits and errors. Free to call with no key.'],
  '/widget': ['Widget guide · Gully Labs docs', 'Embed the live tracker with one script tag: ticker, badge and table, with every option.'],
  '/api-keys': ['API keys · Gully Labs docs', 'How to get a free Gully Labs API key instantly by signing in with a wallet, and use it for a higher rate limit.'],
  '/analytics': ['Gully Analytics · Gully Labs docs', 'Gully Analytics: sign up with a wallet, install the tracker, Web3 events, address privacy modes, plans and what happens at the quota or when a plan lapses.'],
  '/plans-alerts': ['Plans & alerts · Gully Labs docs', 'Paid API plans paid in USDC, USDT or the chain’s own coin on the chains where the treasury is deployed, gap alerts by webhook or Telegram, the webhook payload and how to verify its signature.'],
  '/gully-pay': ['Gully Pay · Gully Labs docs', 'Gully Pay: invoices and reusable pay links in ETH, BNB, USDC or USDT, wallet QR codes, the Pay with crypto button, and signed merchant webhooks with how to verify them.'],
  '/gully-pay-merchants': ['Gully Pay for merchants · Gully Labs docs', 'Run your own non-custodial crypto checkout: wallets per chain, pay links and invoices, signed webhooks, a transaction fee only, weekly statements and the pause policy.'],
  '/gully-security': ['Gully Security · Gully Labs docs', 'Gully Security: the AI Security Scan (inputs, steps, quotas and payment), reading a report, publishing it, and requesting a human Security Review.'],
  '/badges': ['Badges · Gully Labs docs', 'The Gully Labs badges: Gully Score, Holder Map, Gully Security and Built by Gully Labs, in three sizes and two themes, with HTML and Markdown snippets to copy.'],
  '/teams': ['Teams & workspaces · Gully Labs docs', 'Workspaces in the app dashboard: roles and what each may change, invites by wallet or link, the activity log, and CSV exports of usage and payments.'],
  '/sdk': ['SDK · Gully Labs docs', 'A typed TypeScript client for the tracker API, and the embeddable widget with a React component.'],
  '/roadmap': ['Roadmap · Gully Labs docs', 'What Gully Labs is building, with an honest status for each track. Gully Security’s AI Security Scan, Gully Score and monitors are live; Security Reviews are quoted on request; audits are not offered. The Gully L3 is planned.'],
  '/roadmap-l3': ['Roadmap: Gully L3 · Gully Labs docs', 'The plan for the Gully L3: an Arbitrum chain settling to Arbitrum One with Chain Kit, Gully Pay and Hyperlane as its interop layer. Status: spec written, devnet prepared, nothing running.'],
  '/holder-map': ['Holder Map · Gully Labs docs', 'How the Holder Map works: data sources per chain, clusters and hidden links, the launch health score part by part, live mode, alerts, the API and the honesty rules.'],
  '/holder-map-integrate': ['Integrate the Holder Map · Gully Labs docs', 'Put the Holder Map on a launchpad or any site: the one-tag embed, the framed page, the public JSON API and share card, and how to get a launchpad listed.'],
  '/gully-score': ['Gully Score methodology · Gully Labs docs', 'How the Gully Score is worked out: every component, its weight and source, what happens when data is missing, the badge and widget, and why nobody can pay to change a score.'],
  '/gully-ai': ['Gully AI · Gully Labs docs', 'How Gully AI answers questions about Gully Labs: its sources and citations, the live tools it reads, where it runs (site, ⌘K, docs, app, Telegram), its limits and what it logs.'],
  '/telegram': ['Telegram bot and Mini App · Gully Labs docs', 'The @GullyLabsBot Telegram bot and its Mini App: commands, menus, gap and launch alerts with Mute, connecting a chat from the app, the @GullyLabsNews channel requirement, groups and announcements.'],
  '/chain-kit': ['Chain Kit · Gully Labs docs', 'Chain Kit: a branded block explorer for your EVM chain, built on our own Gully Explorer and operated by Gully Labs. What is planned, how to join the waitlist, and its status.'],
  '/swaps': ['Swaps · Gully Labs docs', 'How swaps work on Gully Labs stock pages: LI.FI on Robinhood Chain and BNB Chain, Jupiter on Solana, the region check (GET /api/geo), the Jupiter proxy, fees, and why your wallet signs everything.'],
  '/solana': ['Solana · Gully Labs docs', 'Gully Labs on Solana: xStocks in the tracker, fair prices from Chainlink or the issuer’s quote, the Holder Map on Solana, Solana Pay in Gully Pay, and Jupiter swaps on stock pages.'],
  '/contracts': ['Contracts · Gully Labs docs', 'Every on-chain address Gully Labs uses, per chain: the treasury Safe, the fee address, the third-party Request Network fee proxy and our projects’ contracts, each with its explorer link, Sourcify status and the file it is quoted from. Also at /.well-known/contracts.json.'],
  '/ipfs': ['Gully IPFS · Gully Labs docs', 'Gully IPFS: our Kubo node and read-only gateway at ipfs.gullylabs.xyz. It serves only Gully-pinned content: token art, metadata, NFT art and .gully sites.'],
  '/status': ['Status · Gully Labs docs', 'The Gully Labs status page and GET /api/status: what each check means, how 24-hour uptime is computed, how incidents open and close, and the JSON shape.'],
  '/telegram-mini-app': ['Telegram Mini App · Gully Labs docs', 'The Gully Labs Telegram Mini App at gullylabs.xyz/tg: how it opens, its screens, how each request is signed with Telegram’s initData, the /api/tg routes, rate limits and errors.'],
  '/news-gate': ['News gate · Gully Labs docs', 'Why the Gully Labs Telegram bot and Mini App ask you to follow @GullyLabsNews, how membership is checked and cached, and everything that stays open without it: alerts, Mute, pausing, deleting and unlinking.'],
  '/stock-pages': ['Stock pages · Gully Labs docs', 'What each tracked stock token’s page on gullylabs.xyz/tracker shows: price against fair price, the gap and its change, pool depth and history, contracts, swap, alerts, the Holder Map and an embeddable badge.'],
  '/solana-pay': ['Solana Pay · Gully Labs docs', 'How Gully Pay takes SOL, USDC and USDT on Solana: the Solana Pay transfer request and its reference key, paying by QR, wallet or pasted signature, when a payment counts, the find endpoint and the refusals.'],
  '/changelog': ['Changelog · Gully Labs docs', 'What changed in the Gully Labs tracker, API and widget, and when.'],
}

const ORG = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Gully Labs',
  url: SITE,
  logo: `${SITE}/brand/kit/icon/icon-512.png`,
  sameAs: ['https://x.com/Gully_Labs', 'https://github.com/gully-labs', 'https://t.me/GullyLabsNews', 'https://t.me/GullyLabsBot', 'https://www.youtube.com/@Gully_Labs', 'https://www.tiktok.com/@gully_labs', 'https://www.facebook.com/gullylabsllc', 'https://medium.com/@labsgully'],
}
/** The site itself, for search engines' site name. */
const WEBSITE_LD = { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Gully Labs', url: `${SITE}/`, description: MAIN['/'][1], inLanguage: 'en', publisher: PUBLISHER }
/** The product as software: the web app and its public API, free to start (plans are listed on /pricing). */
const APP_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Gully Labs',
  url: SITE,
  image: `${SITE}/brand/kit/icon/icon-512.png`,
  applicationCategory: 'FinanceApplication',
  operatingSystem: 'Web',
  description: MAIN['/'][1],
  publisher: { '@type': 'Organization', name: 'Gully Labs', url: SITE },
  sameAs: ORG.sameAs,
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

/** Pay pages are noindex, but name their own host as canonical (links are shared on pay.gullylabs.xyz). */
const payCanonical = (host, p) => (isLocal(host) ? null : `${PAY_URL}${p}`)

/* The legal pages (2026-11-03): each is a WebPage published by Gully Labs LLC (src/pages/legal), and every indexed page on
   gullylabs.xyz and holdermaps.xyz carries the Terms / Privacy / Legal links in its pre-render too (shellBody), so a
   crawler (and a plain curl) finds them before scripts run. */
export const LEGAL_PATHS = ['/terms', '/privacy', '/legal', '/legal/merchant-terms', '/legal/scan-terms']
const LEGAL_PUBLISHER = { '@type': 'Organization', name: 'Gully Labs LLC', url: SITE, logo: `${SITE}/brand/kit/icon/icon-512.png` }
/** A legal page's JSON-LD: the page itself, published by Gully Labs LLC, last reviewed on the date it shows. */
export function legalLd(url, name, description, site = { name: 'Gully Labs', url: `${SITE}/` }) {
  return { '@context': 'https://schema.org', '@type': 'WebPage', name, url, description, inLanguage: 'en', dateModified: '2026-11-03', isPartOf: { '@type': 'WebSite', ...site }, publisher: LEGAL_PUBLISHER }
}
/** gullylabs.xyz/legal for crawlers: every product's Terms and Privacy Policy (src/pages/legal/LegalIndex.tsx LEGAL_INDEX). */
export const LEGAL_INDEX_LINKS = [
  ['/terms', 'Gully Labs Terms of Service'],
  ['/privacy', 'Gully Labs Privacy Policy'],
  ['/legal/merchant-terms', 'Gully Labs merchant terms'],
  ['/legal/scan-terms', 'Gully Labs security scan terms'],
  ...[['HolderMaps', 'holdermaps.xyz'], ['Gully Chain', 'gullychain.xyz'], ['kre8.fun', 'kre8.fun'], ['Gully Pay', 'gullypay.xyz'], ['Gully ID', 'gullyid.xyz'], ['Gully RPC', 'gullyrpc.xyz'], ['Gully AI', 'gullyai.xyz'], ['Gully Security', 'gullysecurity.xyz'], ['Gully Studio', 'gullystudio.xyz']].flatMap(([n, d]) => [
    [`https://${d}/terms`, `${n} Terms of Service`],
    [`https://${d}/privacy`, `${n} Privacy Policy`],
  ]),
  ['https://kre8.fun/content-policy', 'kre8.fun Content Policy'],
  ['https://kre8.fun/copyright', 'kre8.fun Copyright'],
]
/** The pre-render's legal links (shellBody): this site's Terms and Privacy Policy, and the index of every product's. */
const SHELL_LEGAL = { main: [['/terms', 'Terms'], ['/privacy', 'Privacy'], ['/legal', 'Legal']], holdermaps: [['/terms', 'Terms'], ['/privacy', 'Privacy'], ['https://gullylabs.xyz/legal', 'Legal']] }

/* holdermaps.xyz (hosts.mjs): the Holder Map's own domain. Its pages are the main site's Holder Map pages under short
   paths, named HolderMaps, with holdermaps.xyz canonicals. */
const HOLDERMAPS_HOME = ['Who really holds a token? Holder bubble maps · HolderMaps', 'Map any token’s holders on Gully Chain, Robinhood Chain, BNB Chain, Base, HyperEVM or Solana: top wallets, linked clusters and launch health, read live.']
/** A main-site Holder Map title, named for holdermaps.xyz. */
export const holderMapsTitle = (t) => String(t).replace(/ · Holder Map · Gully Labs$/, ' · HolderMaps').replace(/ · Gully Labs$/, ' · HolderMaps')

/** A main-site canonical moved to a product domain: kept when it already names that domain, else its short path there
    (null when the path has no short form, never "https://<domain>null"). */
function toShort(canonical, origin, shortPath) {
  if (!canonical) return null
  if (canonical === origin || canonical.startsWith(`${origin}/`)) return canonical
  const short = shortPath(new URL(canonical).pathname)
  return short ? origin + short : null
}

/** HolderMaps' own head (its brand kit, public/brand/holdermaps; server/product-brand.mjs): site name, theme colour,
    icons and share images. */
const HM = PRODUCT_BRANDS.holdermaps
export const HOLDERMAPS_BRAND = headBrand('holdermaps', { origin: HOLDERMAPS_URL })
const HM_OG = `${HOLDERMAPS_URL}${HM.og}`
const HM_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'HolderMaps',
  url: `${HOLDERMAPS_URL}/`,
  image: `${HOLDERMAPS_URL}${HM.dir}/${HM.icons[512]}`,
  applicationCategory: 'FinanceApplication',
  operatingSystem: 'Web',
  description: HOLDERMAPS_HOME[1],
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  publisher: { '@type': 'Organization', name: 'Gully Labs', url: 'https://gullylabs.xyz' },
}
/** Gully AI's share image and theme colour (its kit) on its pages on gullylabs.xyz and the docs; the site's tab icon and
    site name stay Gully Labs'. */
const GULLYAI_OG = `${SITE}${PRODUCT_BRANDS.gullyai.og}`
const GULLYAI_BRAND = headBrand('gullyai', { icons: false, siteName: false })

const HM_LEGAL = {
  '/terms': ['Terms of Service · HolderMaps', 'The terms for using HolderMaps: free holder bubble maps for any token, the paid Deep check, where the data comes from, why labels can be wrong, and why none of it is financial advice.'],
  '/privacy': ['Privacy Policy · HolderMaps', 'What HolderMaps collects (very little: no account, no cookies), what is sent to the blockchain data providers, how long Deep checks are kept, and your rights.'],
}

function holderMapsMeta(p) {
  if (HM_LEGAL[p]) {
    const [title, description] = HM_LEGAL[p]
    const canonical = `${HOLDERMAPS_URL}${p}`
    return { title, description, canonical, found: true, image: HM_OG, brand: HOLDERMAPS_BRAND, legal: 'holdermaps', ld: legalLd(canonical, title.replace(/ · HolderMaps$/, ''), description, { name: 'HolderMaps', url: `${HOLDERMAPS_URL}/` }) }
  }
  const internal = holderInternalPath(p)
  if (!internal) return { title: 'Not found · HolderMaps', description: HOLDERMAPS_HOME[1], canonical: null, found: false, image: HM_OG, brand: HOLDERMAPS_BRAND }
  const m = pageMeta('gullylabs.xyz', internal)
  // The home page links the most-scanned maps, so crawlers find token pages from the HTML as well as the sitemap.
  if (internal === '/holders') return { ...m, title: HOLDERMAPS_HOME[0], description: HOLDERMAPS_HOME[1], canonical: `${HOLDERMAPS_URL}/`, ld: HM_LD, image: HM_OG, brand: HOLDERMAPS_BRAND, links: topHolderPaths(30).map((hp) => [holderShortPath(hp), `${CHAIN_NAMES_ALL[hp.split('/')[2]] ?? hp.split('/')[2]}: ${holderSymbol(hp.split('/')[2], hp.split('/')[3]) ?? hp.split('/')[3].slice(0, 10)}`]) }
  // Every page on holdermaps.xyz shares HolderMaps' own kit image (owner rule 2026-10-26: og:image is the product's own
  // kit OG). The per-token bubble card (/api/holders/<chain>/<token>/card.png, now in the HolderMaps kit too) stays
  // the share image of the gullylabs.xyz/holders pages.
  const description = String(m.description).replace(/ on Gully Labs\.$/, ' on HolderMaps.')
  // pageMeta names holdermaps.xyz itself once HOLDERMAPS_PRIMARY is set; otherwise its gullylabs.xyz path is shortened.
  // (Shortening an already-short path gave "https://holdermaps.xyznull" on every token page, 2026-10-27.)
  const canonical = toShort(m.canonical, HOLDERMAPS_URL, holderShortPath)
  return { ...m, title: holderMapsTitle(m.title), description, canonical, image: HM_OG, brand: HOLDERMAPS_BRAND, ld: canonical ? holderMapsTokenLd(p, canonical, holderMapsTitle(m.title), description) : null }
}

/** A token map's JSON-LD on holdermaps.xyz: the page itself and its breadcrumb (HolderMaps > chain > token). */
function holderMapsTokenLd(p, url, title, description) {
  const [, chain] = p.split('/')
  const name = title.replace(/ · HolderMaps$/, '')
  return [
    { '@context': 'https://schema.org', '@type': 'WebPage', name, url, description, isPartOf: { '@type': 'WebSite', name: 'HolderMaps', url: `${HOLDERMAPS_URL}/` }, publisher: { '@type': 'Organization', name: 'Gully Labs', url: 'https://gullylabs.xyz' } },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'HolderMaps', item: `${HOLDERMAPS_URL}/` },
        { '@type': 'ListItem', position: 2, name: CHAIN_NAMES_ALL[chain] ?? chain },
        { '@type': 'ListItem', position: 3, name, item: url },
      ],
    },
  ]
}

/* gullysecurity.xyz (hosts.mjs): Gully Security's own domain. Its pages are the main site's Security pages under short
   paths, named Gully Security, with gullysecurity.xyz canonicals. /terms is the scan terms page, whose canonical stays
   with the other legal pages on gullylabs.xyz. A report stays noindex unless its owner opted in. */
export const SECURITY_HOME_TITLE = 'AI Security Scan and Security Review · Gully Security'
/** A main-site Security title, named for gullysecurity.xyz. */
export const securityTitle = (t) => String(t).replace(/ · Gully Labs$/, ' · Gully Security')

function securityMeta(p) {
  const internal = securityInternalPath(p)
  if (!internal) return { title: 'Not found · Gully Security', description: MAIN['/security'][1], canonical: null, found: false }
  const m = pageMeta('gullylabs.xyz', internal)
  if (internal === '/security') return { ...m, title: SECURITY_HOME_TITLE, canonical: `${SECURITY_URL}/` }
  if (internal === '/legal/scan-terms') return { ...m, title: securityTitle(m.title), image: `${SITE}/social/og-security.png` }
  return { ...m, title: securityTitle(m.title), canonical: toShort(m.canonical, SECURITY_URL, securityShortPath) }
}

/** Head tags for one request. `found: false` means no page owns the path (served as a 404). On gullylabs.xyz and
    holdermaps.xyz every page's pre-render also carries the footer's Terms / Privacy / Legal links (shellLegal). */
export function pageMeta(host, pathname) {
  const m = pageMetaFor(host, pathname)
  const h = String(host ?? '').split(':')[0].toLowerCase()
  const kind = isHolderMapsHost(h) ? 'holdermaps' : h === 'gullylabs.xyz' || isLocal(h) ? 'main' : null
  // gullylabs.xyz pages are served with the site's header and footer links too (CONTENT.nav), like the page draws them.
  return kind ? { ...m, shellLegal: SHELL_LEGAL[kind], ...(kind === 'main' ? { shellNav: pathname === '/' ? 'home' : 'page' } : {}) } : m
}

function pageMetaFor(host, pathname) {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/'
  if (isHolderMapsHost(host)) return holderMapsMeta(p)
  if (isSecurityHost(host)) return securityMeta(p)
  // Development on localhost: the app also routes the portal, the admin and the docs (under /docs) there.
  if (isLocal(host)) {
    if (p === '/developers' || p === '/app') return { ...pageMeta(APP_HOST, '/'), canonical: null, noindex: true }
    if (p === '/admin' || p.startsWith('/admin/')) return pageMeta('admin.gullylabs.xyz', '/')
    if (p === '/create-chain' || p.startsWith('/create-chain/')) return { ...pageMeta(APP_HOST, p), canonical: null, noindex: true }
    if (p === '/docs' || p.startsWith('/docs/')) {
      const m = pageMeta('docs.gullylabs.xyz', p.slice(5) || '/')
      return { ...m, canonical: null, noindex: true }
    }
  }
  if (host.startsWith('docs.')) {
    const m = DOCS_PAGES[p]
    if (m) return { title: m[0], description: m[1], canonical: DOCS + (p === '/' ? '/' : p), found: true, image: p === '/gully-ai' ? GULLYAI_OG : `${SITE}/social/og-docs.png`, ...(p === '/gully-ai' ? { brand: GULLYAI_BRAND } : {}) }
    return { title: 'Not found · Gully Labs docs', description: DOCS_PAGES['/'][1], canonical: null, found: false }
  }
  // The Gully Labs App.
  if (isAppHost(host) && /^\/create-chain\/orders(\/|$)/.test(p)) return { title: 'Your chain order · Gully Labs', description: 'The status of your chain order.', canonical: null, noindex: true, found: true, image: `${SITE}/social/og-developers.png` }
  if (isAppHost(host) && p === '/create-chain') return { title: 'Create a chain · Gully Labs', description: 'Order your own Arbitrum Orbit chain: testnet free for 30 days, with explorer, bridge, faucet, RPC, Gully Core and Gully Multisig. A person at Gully Labs sets up each chain.', canonical: `${APP}/create-chain`, found: true, image: `${SITE}/social/og-developers.png` }
  if (isAppHost(host))
    return { title: APP_TITLE, description: APP_DESCRIPTION, canonical: `${APP}/`, found: true, image: `${SITE}/social/og-developers.png` }
  // The admin app is one page at the root of its host; any other path is not a page.
  if (host.startsWith('admin.')) return { title: p === '/' ? 'Admin · Gully Labs' : 'Not found · Gully Labs', description: 'Private.', canonical: null, found: p === '/', noindex: true }
  // Gully Pay invoices and receipts: real pages for whoever holds the link, never indexed.
  // The standalone checkout (src/pages/pay): the browser retitles it "Pay <store>" once the store is known.
  if (/^\/pay\/inv_[\w-]{22}(\/receipt)?$/.test(p)) return { title: p.endsWith('/receipt') ? 'Receipt · Gully Pay' : 'Pay Gully Labs · Gully Pay', description: 'Pay a Gully Labs invoice in ETH, BNB, USDC or USDT, straight to the Gully Labs treasury.', canonical: payCanonical(host, p), found: true, noindex: true }
  if (/^\/pay\/l\/pl_[\w-]{16}$/.test(p)) return { title: 'Pay Gully Labs · Gully Pay', description: 'Pay with crypto in ETH, BNB, USDC or USDT, wallet to wallet, through Gully Pay.', canonical: payCanonical(host, p), found: true, noindex: true }
  // Gully Pay merchant checkouts and receipts (merchants.mjs): real pages for whoever holds the link, never indexed.
  if (/^\/pay\/m\/(mi_[\w-]{22}(\/receipt)?|l\/ml_[\w-]{16})$/.test(p)) return { title: p.endsWith('/receipt') ? 'Receipt · Gully Pay' : 'Pay · Gully Pay', description: 'Pay with crypto, wallet to wallet, through Gully Pay.', canonical: payCanonical(host, p), found: true, noindex: true }
  // The Telegram Mini App: a real page, but only inside Telegram; never indexed.
  if (p === '/tg') return { title: 'Gully Labs · Telegram app', description: 'The Gully Labs tracker, DeepCore launches and your gap alerts, inside Telegram.', canonical: null, found: true, noindex: true }
  // A Holder Map Deep check's report (holders-deep-routes.mjs): a real page for whoever holds the unguessable link, never indexed.
  if (/^\/holders\/deep\/hd_[\w-]{16}$/.test(p)) return { title: 'Deep check · Holder Map · Gully Labs', description: 'A Holder Map Deep check report: funding trace, shared-funder clusters, deployer record, snipers and bundles.', canonical: null, found: true, noindex: true, image: `${SITE}/social/og-holders.png` }
  // Holder Maps (holders.mjs): a page per DeepCore launch or tracked stock token; the share image is the map's own card.
  const hm = p.match(/^\/(embed\/)?holders\/(robinhood|bsc|base|hyperevm|solana|gully)\/([A-Za-z0-9]{1,64})$/)
  if (hm) {
    const chainName = CHAIN_NAMES_ALL[hm[2]]
    const sym = holderSymbol(hm[2], hm[3])
    const what = sym ? `$${sym}` : 'this token'
    return {
      title: `Who holds ${what} on ${chainName} · Holder Map · Gully Labs`,
      description: `Who holds ${what} on ${chainName}: the biggest wallets as bubbles, the ones that trade with each other, launch checks and a replay of how holdings changed, read live on Gully Labs.`,
      canonical: hm[1] ? null : holderMapsPrimary() ? `${HOLDERMAPS_URL}/${hm[2]}/${hm[3]}` : `${SITE}/holders/${hm[2]}/${hm[3]}`,
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
    return { title: `Security scan report: ${reportTitle(j)} · Gully Labs`, description: 'An AI Security Scan report published by its owner: findings by severity, the tools that ran and the limits of an automated scan. Not an audit.', canonical: securityPrimary() ? SECURITY_URL + securityShortPath(p) : `${SITE}${p}`, found: true, noindex: !j.indexable, image: `${SITE}/social/og-security.png` }
  }
  // Gully Score pages (gully-score.mjs): one per contract; listed ones are indexed, the rest are noindex.
  const sm = scorePageMeta(p)
  if (sm) return sm.found ? { title: sm.title, description: sm.description, canonical: sm.canonical, found: true, noindex: sm.noindex, image: `${SITE}/social/og-score.png` } : { title: 'Not found · Gully Labs', description: MAIN['/'][1], canonical: null, found: false }
  const m = MAIN[p]
  // The new landing's unlinked preview (server/landing.mjs): for the owner's review, never indexed.
  if (p === '/preview/landing') return { title: MAIN['/'][0], description: MAIN['/'][1], canonical: null, found: true, noindex: true, image: `${SITE}/brand/kit/og-default-1200x630.png` }
  // Paths the app still routes (/admin locally, /docs in development) are not 404s but are not pages either.
  if (!m) return { title: 'Not found · Gully Labs', description: MAIN['/'][1], canonical: null, found: false }
  // Once gullysecurity.xyz is Security's home (SECURITY_PRIMARY), its pages name it as canonical.
  const secShort = securityPrimary() && p.startsWith('/security') ? securityShortPath(p) : null
  const prod = productExtras(p)
  const url = SITE + (p === '/' ? '/' : p)
  const name = pageHeading(m[0])
  const stock = /^\/tracker\/([a-z]+)\/([^/]+)$/.exec(p)
  const body = CONTENT.body[p] ?? (stock ? stockBody(stock[1], stock[2]) : null)
  const links = p === '/legal' ? LEGAL_INDEX_LINKS : null
  const legalPage = LEGAL_PATHS.includes(p)
  if (legalPage) return { links, body, title: m[0], description: m[1], canonical: SITE + p, found: true, image: KIT_OG, legal: 'main', ld: [legalLd(SITE + p, name, m[1]), crumbsLd(p === '/legal' ? [HOME_CRUMB, [name, url]] : [HOME_CRUMB, [pageHeading(MAIN['/legal'][0]), `${SITE}/legal`], [name, url]])] }
  const project = /^\/projects\/([a-z-]+)$/.exec(p)
  const ld = prod
    ? prod.ld
    : p === '/'
      ? [ORG, WEBSITE_LD, APP_LD, HUB_LD]
      : p === '/products'
        ? [{ '@context': 'https://schema.org', '@type': 'ItemList', name: 'Gully Labs products', itemListElement: Object.entries(CONTENT.product).map(([slug, d], i) => ({ '@type': 'ListItem', position: i + 1, name: d.name, url: `${SITE}/products/${slug}` })) }, crumbsLd([HOME_CRUMB, [name, url]])]
        : p === '/services'
          ? [ORG, SERVICES_LD, crumbsLd([HOME_CRUMB, [name, url]])]
          : p === '/tracker'
            ? [TRACKER_LD, crumbsLd([HOME_CRUMB, [name, url]])]
            : stock
              ? [webPageLd('WebPage', url, name, m[1]), crumbsLd([HOME_CRUMB, [pageHeading(MAIN['/tracker'][0]), `${SITE}/tracker`], [`${stock[2]} on ${CONTENT.stocks[stock[1]]?.name ?? stock[1]}`, url]])]
              : project && CONTENT.project[project[1]]
                ? [{ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: CONTENT.project[project[1]].name, description: m[1], url, sameAs: CONTENT.project[project[1]].url, applicationCategory: 'FinanceApplication', operatingSystem: 'Web', publisher: PUBLISHER }, crumbsLd([HOME_CRUMB, [name, url]])]
                : secShort
                  ? null
                  : [webPageLd(p === '/about' ? 'AboutPage' : p === '/links' || p === '/ecosystem' ? 'CollectionPage' : 'WebPage', url, name, m[1]), crumbsLd([HOME_CRUMB, [name, url]])]
  return {
    links, body, title: m[0], description: m[1], canonical: secShort ? SECURITY_URL + secShort : url, found: true, image: prod ? prod.image : p.startsWith('/security') ? `${SITE}/social/og-security.png` : p === '/ask' ? GULLYAI_OG : p === '/' ? HUB_OG : KIT_OG, ld, ...(p === '/ask' ? { brand: GULLYAI_BRAND } : {}) }
}

/** A report's subject in a title: the contract or the repository. */
function reportTitle(j) {
  const i = j.input ?? {}
  if (i.kind === 'address') return `${i.address.slice(0, 6)}…${i.address.slice(-4)} on ${i.chain}`
  if (i.repo) return i.repo
  return 'uploaded code'
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The page's name for its h1: its title without the " · Brand" suffix. */
const pageHeading = (title) => String(title).replace(/ · [^·]+$/, '')

/** A link in the pre-render: another site opens in a new tab, as every link on the page does (owner rule). */
function shellLink(href, text) {
  const ext = /^https?:\/\//.test(href) && !href.startsWith(`${SITE}/`) && href !== SITE
  return `<a href="${esc(href)}"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(text)}</a>`
}
const shellList = (links) => `<ul>${links.map(([href, text]) => `<li>${shellLink(href, text)}</li>`).join('')}</ul>`

/** One section of a page's body: its heading (h2 or h3, never an h1), sentences, list, questions and links. */
function shellSection(s) {
  const h = s.h ? `<h${s.level === 3 ? 3 : 2}>${esc(s.h)}</h${s.level === 3 ? 3 : 2}>` : ''
  const p = (s.p ?? []).map((t) => `<p>${esc(t)}</p>`).join('')
  const list = s.list?.length ? `<ul>${s.list.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''
  const qa = s.qa?.length ? `<dl>${s.qa.map(([q, a]) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join('')}</dl>` : ''
  const links = s.links?.length ? shellList(s.links) : ''
  return `<section>${h}${p}${list}${qa}${links}</section>`
}

/** The pre-render body, replaced by the app on its first render: the page's one h1, its description, its own copy,
    headings and links (meta.body, from page-content.json) and, on gullylabs.xyz, the header's and footer's links as
    the page draws them. A page with no body yet (other hosts) keeps the short form: h1, description, key links. */
function shellBody(meta) {
  const N = CONTENT.nav
  const body = meta.body
  const links = (meta.links ?? []).filter(([href, text]) => href && text).slice(0, 40)
  const nav = links.length ? `<nav aria-label="Pages">${shellList(links)}</nav>` : ''
  const crumbs = body?.crumbs?.length ? `<nav aria-label="Breadcrumb">${[['/', 'Gully Labs'], ...body.crumbs].map(([href, text]) => shellLink(href, text)).join(' / ')}</nav>` : ''
  const main = `<main>${crumbs}<h1>${esc(body?.h1 ?? pageHeading(meta.title))}</h1><p>${esc(meta.description)}</p>${(body?.sections ?? []).map(shellSection).join('')}${nav}</main>`
  // The Terms / Privacy / Legal links every footer carries (gullylabs.xyz and holdermaps.xyz pages; set by pageMeta).
  const legal = meta.shellLegal ? `<nav aria-label="Legal">${meta.shellLegal.map(([href, text]) => shellLink(href, text)).join(' · ')}</nav>` : ''
  const style = 'max-width:720px;margin:48px auto;padding:0 16px;font:16px/1.5 system-ui,sans-serif'
  if (!meta.shellNav) return `<div data-shell style="${style}">${main}${legal ? `<footer>${legal}</footer>` : ''}</div>`
  const home = meta.shellNav === 'home'
  const header = `<header><a href="/">Gully Labs</a><nav aria-label="Main">${shellList(home ? N.headerHome : N.header)}</nav></header>`
  const products = `<nav aria-label="Gully products">${N.products.map((g) => `<p>${esc(g.group)}</p>${shellList(g.links)}`).join('')}</nav>`
  const footer = `<footer><p>${esc(N.tagline)}</p><nav aria-label="Footer">${shellList(N.footer)}</nav>${products}${home ? '' : `<nav aria-label="Site pages">${shellList(N.more)}</nav>`}${legal}<p>${esc(N.copy)}</p></footer>`
  return `<div data-shell style="${style}">${header}${main}${footer}</div>`
}

/** The head tags of a page drawn by the server itself (server/landing.mjs). */
export function headTags(meta) {
  const t = esc(meta.title)
  const d = esc(meta.description)
  const img = esc(meta.image ?? KIT_OG)
  return `<title>${t}</title><meta name="description" content="${d}">${meta.noindex ? '<meta name="robots" content="noindex">' : ''}${meta.canonical ? `<link rel="canonical" href="${esc(meta.canonical)}"><meta property="og:url" content="${esc(meta.canonical)}">` : ''}<meta property="og:type" content="website"><meta property="og:site_name" content="Gully Labs"><meta property="og:title" content="${t}"><meta property="og:description" content="${d}"><meta property="og:image" content="${img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@Gully_Labs"><meta name="twitter:image" content="${img}"><meta name="twitter:title" content="${t}"><meta name="twitter:description" content="${d}"><meta name="theme-color" content="#0E1C38"><link rel="icon" type="image/png" sizes="32x32" href="/brand/kit/icon/icon-32.png"><link rel="apple-touch-icon" href="/brand/kit/icon/icon-180.png">${[meta.ld ?? []].flat().map((ld) => `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`).join('')}`
}

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
  // Twitter/X reads its own title and description first (the client's Seo sets the same after navigation).
  swap(/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${esc(meta.title)}" />`)
  swap(/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${esc(meta.description)}" />`)
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
  // A product with its own kit on its own domain (holdermaps.xyz): its site name, theme colour, icons and Twitter card.
  if (meta.brand) {
    const b = meta.brand
    if (b.siteName) swap(/<meta property="og:site_name"[^>]*>/, `<meta property="og:site_name" content="${esc(b.siteName)}" />`)
    swap(/<meta property="og:image:alt"[^>]*>/, `<meta property="og:image:alt" content="${esc(b.ogAlt ?? b.siteName)}" />`)
    swap(/<meta name="theme-color"[^>]*>/, `<meta name="theme-color" content="${esc(b.themeColor)}" />`)
    if (b.icons) {
      for (const size of [16, 32, 48]) swap(new RegExp(`<link rel="icon" type="image/png" sizes="${size}x${size}"[^>]*>`), `<link rel="icon" type="image/png" sizes="${size}x${size}" href="${esc(b.icons[size])}" />`)
      swap(/<link rel="apple-touch-icon"[^>]*>/, `<link rel="apple-touch-icon" sizes="180x180" href="${esc(b.icons[180])}" />`)
      // The browser's own /favicon.ico request is answered with the brand's file (server.mjs, product-brand.mjs).
      html = html.replace(/<!-- Icons:[^>]*-->/, `<!-- Icons: the ${esc(b.siteName)} brand kit, unchanged. -->`)
    }
    if (b.twitterImage && !/\/card\.png$/.test(meta.image ?? '')) swap(/<meta name="twitter:image"[^>]*>/, `<meta name="twitter:image" content="${esc(b.twitterImage)}" />`)
  }
  // What a crawler sees before scripts run: the page's own h1, its description and its key links, inside #root (React's
  // createRoot replaces it on first render, so the live page still has exactly one h1). Indexed pages only.
  if (meta.found && !meta.noindex) html = html.replace(/<div id="root"><\/div>/, `<div id="root">${shellBody(meta)}</div>`)
  for (const ld of [meta.ld ?? []].flat()) html = html.replace('</head>', `    <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n  </head>`)
  return html
}

/** robots.txt per host. */
export function robotsFor(host) {
  // The service hosts hold no pages worth indexing: checkout links, API JSON and iframes.
  if (isPayHost(host) || isApiHost(host) || isEmbedHost(host)) return 'User-agent: *\nDisallow: /\n'
  if (host.startsWith('admin.')) return 'User-agent: *\nDisallow: /\n'
  const base = host.startsWith('docs.') ? DOCS : isAppHost(host) ? APP : isHolderMapsHost(host) ? HOLDERMAPS_URL : isSecurityHost(host) ? SECURITY_URL : SITE
  return `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`
}

/** A sitemap <loc>: an absolute http(s) URL with no "null" or "undefined" left in it by a missing path. */
export function validSitemapUrl(u) {
  if (typeof u !== 'string' || /(null|undefined)(\/|$)/.test(u)) return false
  try {
    const url = new URL(u)
    return (url.protocol === 'https:' || url.protocol === 'http:') && /^[a-z0-9.-]+$/i.test(url.hostname) && !/(null|undefined)$/.test(url.hostname)
  } catch {
    return false
  }
}

/** sitemap.xml per host: each host lists only its own pages, as the protocol requires. */
export function sitemapFor(host) {
  // The admin host has no public pages (robots.txt disallows everything there).
  if (host.startsWith('admin.') || isPayHost(host) || isApiHost(host) || isEmbedHost(host)) return null
  const today = new Date().toISOString().slice(0, 10)
  let urls
  const securityPaths = () => ['/security', '/security/reports', '/security/sample', ...publishedJobs().filter((j) => j.indexable).map((j) => `/security/reports/${j.id}`)]
  const holderPaths = () => ['/holders', ...Object.entries(HOLDER_PAGES).filter(([, chain]) => holdersAvailableFor(chain)).map(([p]) => p), ...topHolderPaths()]
  if (host.startsWith('docs.')) urls = Object.keys(DOCS_PAGES).filter((p) => !movedDocsUrl(p)).map((p) => [DOCS + (p === '/' ? '/' : p), p === '/' ? '1.0' : '0.7', 'weekly'])
  else if (isAppHost(host)) urls = [[`${APP}/`, '0.6', 'monthly']]
  // holdermaps.xyz lists the Holder Map pages under their short paths.
  // A page with no short path there (a ticker the short form cannot carry, like BRK.B) is left out, not written as
  // "https://holdermaps.xyznull".
  else if (isHolderMapsHost(host)) urls = [...holderPaths().flatMap((p) => { const short = holderShortPath(p); return short ? [[HOLDERMAPS_URL + short, p === '/holders' ? '1.0' : '0.7', p === '/holders' ? 'daily' : 'monthly']] : [] }), ...Object.keys(HM_LEGAL).map((p) => [HOLDERMAPS_URL + p, '0.3', 'yearly'])]
  // gullysecurity.xyz lists the Security pages and the reports their owners let search engines index, under short paths.
  else if (isSecurityHost(host)) urls = securityPaths().filter((p) => securityShortPath(p)).map((p) => [SECURITY_URL + securityShortPath(p), p === '/security' ? '1.0' : '0.7', p === '/security' || p === '/security/reports' ? 'daily' : 'monthly'])
  else
    // Once holdermaps.xyz (or gullysecurity.xyz) is primary the main site's pages for it are redirects there, so they are not
    // listed here; nor are the pages of products that moved to their own domains (hosts.mjs movedPageUrl).
    urls = [...Object.keys(MAIN).filter((p) => !movedPageUrl(p) && !(holderMapsPrimary() && p === '/holders') && !(securityPrimary() && securityShortPath(p))), ...(holderMapsPrimary() ? [] : holderPaths().slice(1)), ...(securityPrimary() ? [] : securityPaths().filter((p) => p.startsWith('/security/reports/')))].map((p) => [
      SITE + (p === '/' ? '/' : p),
      p === '/' ? '1.0' : p === '/tracker' ? '0.9' : p.startsWith('/projects/') ? '0.8' : '0.7',
      p === '/tracker' ? 'hourly' : p.startsWith('/tracker/') ? 'daily' : p === '/' || p === '/score' || p === '/ecosystem' || p.startsWith('/projects/') ? 'daily' : 'monthly',
    ])
  // Listed Gully Score pages (a watched contract that allows listing, or one with a published report).
  if (!host.startsWith('docs.') && !isAppHost(host) && !isHolderMapsHost(host) && !isSecurityHost(host)) for (const p of scoreSitemapPaths()) urls.push([SITE + p, '0.5', 'daily'])
  // Every <loc> is a real absolute address: nothing built from a missing (null/undefined) path gets listed.
  urls = urls.filter(([u]) => validSitemapUrl(u))
  // lastmod: a page whose figures change by the hour or day (changefreq hourly or daily) changed today; a page whose
  // content only changes with a release carries the date this build's content was written.
  const rows = urls.map(([u, pr, f]) => `  <url><loc>${u}</loc><lastmod>${f === 'hourly' || f === 'daily' ? today : BUILT_ON < today ? BUILT_ON : today}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`)
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`
}
