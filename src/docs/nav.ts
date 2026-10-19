import { createContext, useContext } from 'react'
import { DOCS_URL, isDocsHost } from '../site-host'

/** Every docs page, in sidebar order. `slug` is the relative route path ('' is the index). */
export const DOC_PAGES = [
  { slug: '', title: 'Overview', group: 'Start' },
  { slug: 'methodology', title: 'Tracker methodology', group: 'Start' },
  { slug: 'api', title: 'API reference', group: 'Build' },
  { slug: 'widget', title: 'Widget guide', group: 'Build' },
  { slug: 'api-keys', title: 'API keys', group: 'Build' },
  { slug: 'plans-alerts', title: 'Plans & alerts', group: 'Build' },
  { slug: 'sdk', title: 'SDK', group: 'Build' },
  { slug: 'teams', title: 'Teams & workspaces', group: 'Build' },
  { slug: 'holder-map', title: 'Holder Map', group: 'Products' },
  { slug: 'holder-map-integrate', title: 'Integrate the Holder Map', group: 'Products' },
  { slug: 'analytics', title: 'Gully Analytics', group: 'Products' },
  { slug: 'gully-pay', title: 'Gully Pay', group: 'Products' },
  { slug: 'gully-pay-merchants', title: 'Gully Pay for merchants', group: 'Products' },
  { slug: 'gully-security', title: 'Gully Security', group: 'Products' },
  { slug: 'gully-score', title: 'Gully Score', group: 'Products' },
  { slug: 'gully-ai', title: 'Gully AI', group: 'Products' },
  { slug: 'telegram', title: 'Telegram bot', group: 'Products' },
  { slug: 'telegram-mini-app', title: 'Telegram Mini App', group: 'Products' },
  { slug: 'news-gate', title: 'News channel gate', group: 'Products' },
  { slug: 'stock-pages', title: 'Stock pages', group: 'Products' },
  { slug: 'swaps', title: 'Swaps', group: 'Products' },
  { slug: 'solana', title: 'Solana', group: 'Products' },
  { slug: 'solana-pay', title: 'Solana Pay', group: 'Products' },
  { slug: 'chain-kit', title: 'Chain Kit', group: 'Products' },
  { slug: 'status', title: 'Status', group: 'More' },
  { slug: 'roadmap', title: 'Roadmap', group: 'More' },
  { slug: 'roadmap-l3', title: 'Roadmap: Gully L3', group: 'More' },
  { slug: 'changelog', title: 'Changelog', group: 'More' },
] as const

export type DocSlug = (typeof DOC_PAGES)[number]['slug']

/** Extra words the sidebar search matches besides each page's title (lower case). */
export const DOC_KEYWORDS: Partial<Record<DocSlug, string[]>> = {
  '': ['home', 'start', 'tracker', 'quick start', 'chains'],
  methodology: ['fair price', 'chainlink', 'gap', 'premium', 'discount', 'pool', 'status'],
  api: ['endpoint', 'json', 'rest', 'tracker', 'history', 'holders', 'curl', 'errors'],
  widget: ['embed', 'ticker', 'badge', 'table', 'html', 'script'],
  'api-keys': ['key', 'token', 'bearer', 'rate limit', 'auth'],
  'plans-alerts': ['pricing', 'price', 'plan', 'alert', 'webhook', 'telegram', 'checkout'],
  sdk: ['typescript', 'javascript', 'npm', 'client', 'library'],
  teams: ['workspace', 'members', 'roles', 'invite'],
  'holder-map': ['holders', 'clusters', 'bubbles', 'whales', 'deepcore', 'health score'],
  'holder-map-integrate': ['launchpad', 'embed', 'iframe', 'bubblemaps', 'partner', 'integration', 'card', 'og image'],
  analytics: ['umami', 'web3', 'wallets', 'funnel', 'events'],
  'gully-pay': ['payments', 'checkout', 'usdc', 'usdt', 'eth', 'bnb', 'crypto', 'invoice'],
  'gully-pay-merchants': ['store', 'merchant', 'pay link', 'webhook', 'fees', 'invoice'],
  'gully-security': ['scan', 'audit', 'contract', 'monitor', 'vulnerability'],
  'gully-score': ['score', 'rating', 'token score'],
  'gully-ai': ['ask', 'assistant', 'chat', 'ai', 'claude', 'citations', 'search', 'cmd k'],
  telegram: ['bot', 'gullylabsbot', 'mini app', 'alerts', 'mute', 'news channel', 'commands', 'groups'],
  'telegram-mini-app': ['mini app', 'webapp', 'initdata', 'tma', 'api/tg', 'gullylabsbot', 'theme', 'holders'],
  'news-gate': ['gullylabsnews', 'news channel', 'follow', 'join', 'gate', 'mute', 'membership'],
  'stock-pages': ['stock page', 'ticker', 'tracker', 'gap', 'pool', 'badge', 'contracts', 'liquidity'],
  swaps: ['swap', 'trade', 'buy', 'sell', 'li.fi', 'lifi', 'jupiter', 'geo', 'fees'],
  solana: ['sol', 'xstocks', 'spl', 'solana pay', 'jupiter', 'backed'],
  'solana-pay': ['qr', 'reference', 'sol', 'usdc', 'usdt', 'transfer request', 'spl token', 'finalized', 'wallet'],
  'chain-kit': ['explorer', 'blockscout', 'rollup', 'block explorer', 'chain'],
  status: ['uptime', 'incidents', 'health', 'outage', 'down', 'monitoring'],
  roadmap: ['plans', 'upcoming', 'future'],
  'roadmap-l3': ['l3', 'gully chain', 'rollup', 'devnet'],
  changelog: ['changes', 'release', 'updates', 'new'],
}

export const SITE = 'https://gullylabs.xyz'

/** The docs' own base path: '/' on docs.gullylabs.xyz, '/docs' when mounted under the main host. */
export const DocsBase = createContext('/')

export function useDocHref(slug: DocSlug, hash?: string): string {
  const base = useContext(DocsBase).replace(/\/+$/, '')
  return `${base}${slug ? `/${slug}` : ''}${hash ? `#${hash}` : ''}` || '/'
}

/** Where the docs read the live API from: the main host, unless the docs run on the main host itself. */
export const apiOrigin = () => (isDocsHost() ? SITE : '')

/** Canonical address of a docs page. */
export const canonical = (slug: DocSlug) => `${DOCS_URL}${slug ? `/${slug}` : '/'}`
