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
  { slug: 'badges', title: 'Badges', group: 'Build' },
  { slug: 'holder-map', title: 'Holder Map', group: 'Products' },
  { slug: 'holder-map-integrate', title: 'Integrate the Holder Map', group: 'Products' },
  { slug: 'analytics', title: 'Gully Analytics', group: 'Products' },
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
  { slug: 'ipfs', title: 'Gully IPFS', group: 'Products' },
  { slug: 'contracts', title: 'Contracts', group: 'More' },
  { slug: 'status', title: 'Status', group: 'More' },
  { slug: 'roadmap', title: 'Roadmap', group: 'More' },
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
  badges: ['badge', 'embed', 'readme', 'svg', 'markdown', 'built by', 'shield'],
  'holder-map': ['holders', 'clusters', 'bubbles', 'whales', 'launch checks', 'health score'],
  'holder-map-integrate': ['launchpad', 'embed', 'iframe', 'bubblemaps', 'partner', 'integration', 'card', 'og image'],
  analytics: ['umami', 'web3', 'wallets', 'funnel', 'events'],
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
  ipfs: ['ipfs', 'kubo', 'gateway', 'cid', 'pin', 'contenthash', 'nft', 'metadata'],
  contracts: ['address', 'addresses', 'treasury', 'safe', 'fee address', 'fee proxy', 'sourcify', 'verified', 'explorer', 'deployment'],
  status: ['uptime', 'incidents', 'health', 'outage', 'down', 'monitoring'],
  roadmap: ['plans', 'upcoming', 'future'],
  changelog: ['changes', 'release', 'updates', 'new'],
}

export const SITE = 'https://gullylabs.xyz'

/** Docs of the products on their own domains (2026-10-26): the old slugs here 301 there (server/hosts.mjs movedDocsUrl). */
export const PRODUCT_DOCS: { name: string; href: string; note: string }[] = [
  { name: 'Gully Chain', href: 'https://docs.gullychain.xyz/', note: 'The L3, Gully Core launchpad, bridging, names, account abstraction and the network details.' },
  { name: 'Gully Pay', href: 'https://gullypay.xyz/docs', note: 'x402, checkout, merchant stores, webhooks and USDC.' },
  { name: 'Gully RPC', href: 'https://gullyrpc.xyz/docs/', note: 'Endpoints, API keys, served networks and limits.' },
  { name: 'Gully Security', href: 'https://gullysecurity.xyz/', note: 'AI security scans, monitors and published reports.' },
]
export type MovedDocSlug = 'gully-pay' | 'gully-pay-merchants' | 'chain-kit' | 'roadmap-l3'
export const MOVED_DOCS: Record<MovedDocSlug, string> = {
  'gully-pay': 'https://gullypay.xyz/docs',
  'gully-pay-merchants': 'https://gullypay.xyz/docs',
  'chain-kit': 'https://docs.gullychain.xyz/',
  'roadmap-l3': 'https://docs.gullychain.xyz/network/',
}

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
