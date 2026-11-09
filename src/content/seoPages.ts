/* The title and description of every indexed page on gullylabs.xyz, in one place. The browser's <Seo> reads them from
   here, and scripts/build-page-content.mjs writes the same strings into server/data/page-content.json for the server
   (server/seo.mjs), so what a crawler is served and what the page sets after it loads are one text.

   Rules, checked on every page by scripts/test-seo-audit.mjs: the full title (with " · Gully Labs") is at most 60
   characters, the description is 120 to 160, and no two pages share either.
   This file imports nothing at runtime: the build script loads it on its own. */

export interface SeoEntry {
  /** Without the " · Gully Labs" suffix (the home page's is the whole title after "Gully Labs · "). */
  title: string
  description: string
}

export const TITLE_MAX = 60
export const DESC_MIN = 120
export const DESC_MAX = 160
const SUFFIX = ' · Gully Labs'

/** The whole <title> of a main-site page. */
export const fullTitle = (path: string, title: string) => (path === '/' ? `Gully Labs · ${title}` : `${title}${SUFFIX}`)

export const SEO_PAGES: Record<string, SeoEntry> = {
  '/': {
    title: 'Launch a token, a launchpad or a DEX',
    description: 'Gully Labs builds Gully Core: launch tokens, launchpads and DEXes on your chain, with Gully ID, Gully Pay, Gully RPC and live status for every product.',
  },
  '/products': {
    title: 'Products',
    description: 'Every Gully Labs product on one page, each with live charts: Gully ID, Gully Pay, Gully Chain, Gully RPC, HolderMaps, Gully Security and the Peddle family.',
  },
  '/tracker': {
    title: 'Stock token tracker: price vs fair price',
    description: 'Every tokenised stock on Robinhood Chain, BNB Chain and Solana against its fair price, with the gap, pool depth and feed time, read live.',
  },
  '/pricing': {
    title: 'Pricing: tracker API and Gully Analytics',
    description: "Plans for the Gully Labs tracker API and Gully Analytics, paid in USDC, USDT or the chain's own coin on Base, Ethereum, BNB Chain and Arbitrum, with no custody.",
  },
  '/status': {
    title: 'Status',
    description: 'Live status of Gully Labs: the API, tracker freshness per chain, the Telegram bot, Gully Pay, Gully AI and the scan engine, with 24 h uptime and incidents.',
  },
  '/widget': {
    title: 'Tracker widget',
    description: 'Embed the Gully Labs stock token tracker on any page with one script tag: a live ticker, a one-stock badge or a table of the widest gaps.',
  },
  '/services': {
    title: 'Services: Web3 development',
    description: 'Gully Labs builds for other teams: L2/L3 chain launch, smart contracts, security reviews, apps, payments, RPC, token launches, AI and Unity games.',
  },
  '/analytics': {
    title: 'Gully Analytics: web analytics with wallets',
    description: 'Privacy-friendly analytics for dapps: page views plus wallet connects, chains and transactions, in one visit to wallet to transaction funnel.',
  },
  '/ask': {
    title: 'Gully AI: ask about Gully Labs',
    description: 'Ask Gully AI about Gully Labs: its products, the tracker and API, plans and docs. Every answer cites its sources and quotes live figures where they matter.',
  },
  '/legal/merchant-terms': {
    title: 'Gully Pay merchant terms',
    description: 'The terms for running a Gully Pay store: a transaction fee only, non-custodial payments to your own wallets, weekly statements and the pause policy.',
  },
  '/legal/scan-terms': {
    title: 'AI Security Scan terms',
    description: 'The AI Security Scan terms: what an automated scan is and is not, free scans and prices, re-run credits, how long code is kept and liability limits.',
  },
  '/terms': {
    title: 'Terms of Service',
    description: 'The terms for using Gully Labs: the site, the app, the API and widgets, Gully AI, Gully Score and the Telegram bot. Self-custody, information not advice.',
  },
  '/privacy': {
    title: 'Privacy Policy',
    description: 'What Gully Labs collects across the site, the app, Gully Analytics, Gully AI and the Telegram bot, why, who else sees it and how long it is kept.',
  },
  '/legal': {
    title: 'Legal: Terms and Privacy',
    description: 'The Terms of Service and Privacy Policy of every Gully Labs product in one place: Gully Labs, HolderMaps, Gully Chain, kre8.fun, Gully Pay and more.',
  },
  '/links': {
    title: 'Links',
    description: 'Every Gully Labs link in one place: the site, the app, the stock tracker, Gully AI, Gully Analytics, Gully Pay, the docs, the Telegram bot and news.',
  },
  '/score': {
    title: 'Gully Score: transparent contract scores',
    description: 'The Gully Score rates a contract 0 to 100 from public evidence only: verified code, control, upgrades, delays, locks and holders. Nobody can pay for it.',
  },
  '/ecosystem': {
    title: 'Ecosystem: projects and integrations',
    description: 'Every Gully Labs project with its own live numbers, the third-party services the code integrates with, and the launchpads on the Holder Map.',
  },
  '/partners': {
    title: 'Partners: Holder Map, SDK and webhooks',
    description: 'What launchpads, wallets, explorers and chains get from Gully Labs: the embeddable Holder Map, the Gully Score badge, the SDK and launch webhooks.',
  },
  '/gully-id': {
    title: 'Gully ID: the Gully Labs sign-in service',
    description: 'Gully ID (gullyid.xyz) is the sign-in and wallet service built and run by Gully Labs: one passkey for every Gully app, never a seed phrase or a key.',
  },
  '/about': {
    title: 'About',
    description: 'Gully Labs is a blockchain development company that designs, builds and releases Web3 products under its own name, and builds for other teams too.',
  },
}

/** The first candidate that fits the description range; the last one when none does (the audit test then names it). */
function fit(candidates: string[]) {
  return candidates.find((c) => c.length >= DESC_MIN && c.length <= DESC_MAX) ?? candidates[candidates.length - 1]
}
const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`)

/** A product page (/products/<slug>): its catalog line, with what the page adds. */
export function productSeo(p: { name: string; line: string }): SeoEntry {
  return {
    title: p.name,
    description: fit([
      `${p.line} Live charts on this page.`,
      `${p.line} Live charts, features, pricing and FAQ on this page.`,
      p.line,
      `${p.line} Live charts, features, how it works, pricing and FAQ for ${p.name} on this page.`,
      `${p.name}: ${p.line} Live charts, features, how it works, pricing and questions answered on this page.`,
    ]),
  }
}

/** A project page (/projects/<slug>). */
export function projectSeo(p: { name: string; tag: string; tagline: string; description: string; chains: string[] }): SeoEntry {
  const lead = `${p.name} is a Gully Labs project (${p.tag}).`
  return {
    title: p.name,
    description: fit([
      `${lead} ${sentence(p.tagline)} ${sentence(p.description)}`,
      `${lead} ${sentence(p.description)}`,
      `${lead} ${sentence(p.tagline)} ${sentence(p.description)} On ${p.chains.join(', ')}.`,
      `${lead} ${sentence(p.description)} On ${p.chains.join(', ')}, with live figures on this page.`,
    ]),
  }
}

export const STOCK_CHAIN_NAME: Record<string, string> = { robinhood: 'Robinhood Chain', bsc: 'BNB Chain', solana: 'Solana' }
/** Where a chain's fair price comes from, in a few words. */
const FAIR_SOURCE: Record<string, string> = { robinhood: 'Chainlink', bsc: 'Chainlink', solana: 'Chainlink or issuer' }

/** A tracked stock token's page (/tracker/<chain>/<ticker>). */
export function stockSeo(chain: string, ticker: string, name: string): SeoEntry {
  const on = STOCK_CHAIN_NAME[chain] ?? chain
  const src = FAIR_SOURCE[chain] ?? 'Chainlink'
  return {
    title: `${ticker} token vs fair price on ${on}`,
    description: fit([
      `${name} (${ticker}) token on ${on}: its price in its deepest pool against its ${src} fair price, the gap, pool depth and history, read live.`,
      `${name} (${ticker}) token on ${on}: its pool price against its ${src} fair price, the gap, pool depth and history, read live.`,
      `${name} (${ticker}) token on ${on}: pool price against its ${src} fair price, with the gap and pool depth, read live.`,
      `${name} (${ticker}) on ${on}: pool price against the ${src} fair price, the gap and pool depth, live.`,
      `${ticker} token on ${on}: its price in its deepest pool against its ${src} fair price, the gap, pool depth and history, read live.`,
    ]),
  }
}
