// The projects Gully Labs has shipped. Every figure shown beside them is read live from the
// project's own API (server/stats.mjs, keyed by `key`); nothing numeric is written here.

export interface Project {
  slug: string
  /** Key in the /api/stats document. */
  key: string
  name: string
  tag: string
  status: 'Live' | 'Beta'
  tagline: string
  description: string
  logo: string
  /** Tile background, matched to the logo's own background. */
  bg: string
  accent: string
  fit: 'cover' | 'contain'
  /** Logo padding in the large tile and detail panel. */
  pad: string
  /** Logo padding in the small "Built by this team" cards. */
  padSm: string
  url: string
  /** The project's own X handle and Telegram link, for the share controls; absent when it has none. */
  x?: string
  telegram?: string
  chains: string[]
  built: string[]
}

export const projects: Project[] = [
  {
    slug: 'deepcore',
    key: 'deepcore',
    name: 'DeepCore',
    tag: 'DeFi infrastructure',
    status: 'Live',
    tagline: 'Launch on one core',
    description: 'A launchpad, hosted Launchpads and DEXes, and a best-price router on one shared liquidity core, at the same addresses on four chains.',
    logo: '/assets/deepcore.webp',
    bg: '#061729',
    accent: '#2ee6c5',
    fit: 'contain',
    pad: '56px 96px',
    padSm: '28px 40px',
    url: 'https://deepcore.fun/',
    chains: ['Base', 'BNB Chain', 'HyperEVM', 'Robinhood'],
    built: [
      'Launchpad: token, pool and liquidity locked forever in one transaction, with a decaying anti-snipe fee',
      'Hosted Launchpads and DEXes on the core, opened in one transaction; the site earns a share of its fees',
      'Router: best price across DeepCore pools and the major DEXes on each chain',
      'Locks, vesting, airdrops, team splits, multisend, limit orders and DCA',
      'Coming soon: custom domains, a buy bot and market-hours stock pools',
    ],
  },
  {
    slug: 'peddleswap',
    key: 'peddleswap',
    name: 'PeddleSwap',
    tag: 'DEX',
    status: 'Live',
    tagline: 'Swap. Lock. Launch.',
    description: 'Swap tokens, earn fees from liquidity, lock tokens or LP and bridge networks.',
    logo: '/assets/peddleswap.webp',
    bg: '#15181b',
    accent: '#b8f03c',
    fit: 'contain',
    pad: '64px 64px',
    padSm: '36px 28px',
    url: 'https://peddleswap.xyz/',
    telegram: 'https://t.me/PeddleSwap',
    chains: ['Robinhood', 'Base', 'Arc'],
    built: ['AMM and router contracts', 'Swap, liquidity and locker interface', 'Analytics and indexing'],
  },
  {
    slug: 'peddles',
    key: 'peddles',
    name: 'Peddles',
    tag: 'Launchpad',
    status: 'Live',
    tagline: 'Launch, trade and play',
    description: 'Memecoins paired to tokenised stocks. Holders are paid in that stock.',
    logo: '/assets/peddles.webp',
    bg: '#1c1f22',
    accent: '#27b6ff',
    fit: 'cover',
    pad: '0px',
    padSm: '0px',
    url: 'https://peddles.xyz/',
    x: '@PeddlesX',
    telegram: 'https://t.me/peddlesnews',
    chains: ['Base', 'Robinhood', 'BNB Chain', 'Arc'],
    built: ['Stock-paired launch contracts and holder rewards', 'Terminal, perps and trade bot', 'Arcade: a game for every coin'],
  },
  {
    slug: 'peddlequest',
    key: 'peddlequest',
    name: 'PeddleQuest',
    tag: 'Quest to earn',
    status: 'Live',
    tagline: 'Quest on-chain, earn the proof',
    description: 'Verified quests on four chains. XP, soulbound badges, reward pools escrowed first.',
    logo: '/assets/peddlequest.webp',
    bg: '#0a101c',
    accent: '#ffd60a',
    fit: 'contain',
    pad: '40px 72px',
    padSm: '24px 28px',
    url: 'https://peddlequest.xyz/',
    x: '@Ox_Forged',
    telegram: 'https://t.me/PeddleQuestBot',
    chains: ['Base', 'Robinhood', 'BNB Chain', 'Arc'],
    built: ['On-chain quest verification and escrow', 'XP, crates and soulbound badges', 'Quest wizard and sybil rules for projects'],
  },
  {
    slug: 'gullychain',
    key: 'gullychain',
    name: 'Gully Chain',
    tag: 'L3 chain',
    status: 'Beta',
    tagline: 'Our own chain, with a launchpad built in',
    description: 'Gully Labs’ L3 testnet: the Gully Launchpad (bonding curve, graduation into a locked Gully Swap pool), .gully names and glUSD. Figures are in test ETH and read from our own indexer.',
    logo: '/brand/gully-mark-512.png',
    bg: '#0f0f10',
    accent: '#d9b563',
    fit: 'contain',
    pad: '40px 96px',
    padSm: '20px 40px',
    url: 'https://gullychain.xyz/',
    chains: ['Gully Chain Testnet'],
    built: ['Gully Launchpad: bonding curve, graduation into a Gully Swap pool with the LP locked in GullyLPLocker', 'Gully Swap (Uniswap v3) and the GullySwapRouter', '.gully names, glUSD and bridged USDC, served through Gully RPC and indexed by our own indexer'],
  },
]

/** Slots for projects still in development. */
export const comingSoon = [projectNumber(projects.length)]

export const TOTAL_SLOTS = projectNumber(projects.length + comingSoon.length - 1)

export function projectNumber(index: number) {
  return String(index + 1).padStart(2, '0')
}
