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
  chains: string[]
  built: string[]
}

export const projects: Project[] = [
  {
    slug: 'cartel-family',
    key: 'cartel-family',
    name: 'Cartel Family',
    tag: 'Social trading',
    status: 'Live',
    tagline: 'We trade as one',
    description: 'Live markets, automated strategies and shared trades across chains.',
    logo: '/assets/cartel-family.png',
    bg: '#12151c',
    accent: '#b8926a',
    fit: 'cover',
    pad: '0px',
    padSm: '0px',
    url: 'https://cartel.family/',
    chains: ['Solana', 'Multi-chain'],
    built: ['Member portal and wallet sign-in', 'Live market data and price alerts', 'Copy trading and shared trade feed'],
  },
  {
    slug: 'deepcore',
    key: 'deepcore',
    name: 'DeepCore',
    tag: 'DeFi infrastructure',
    status: 'Live',
    tagline: 'Launch on one core',
    description: 'Tokens, Launchpads, DEXes and stock markets on one shared, hardened core, on four chains.',
    logo: '/assets/deepcore.png',
    bg: '#061729',
    accent: '#2ee6c5',
    fit: 'contain',
    pad: '56px 96px',
    padSm: '28px 40px',
    url: 'https://deepcore.fun/',
    chains: ['Base', 'BNB Chain', 'HyperEVM', 'Robinhood'],
    built: ['Hook-based pool core and launch guards', 'Launchpad and DEX kits with locked liquidity', 'Cross-chain index, SDK and hosted sites'],
  },
  {
    slug: 'peddleswap',
    key: 'peddleswap',
    name: 'PeddleSwap',
    tag: 'DEX',
    status: 'Live',
    tagline: 'Swap. Lock. Launch.',
    description: 'Swap tokens, earn fees from liquidity, lock tokens or LP and bridge networks.',
    logo: '/assets/peddleswap.png',
    bg: '#15181b',
    accent: '#b8f03c',
    fit: 'contain',
    pad: '64px 64px',
    padSm: '36px 28px',
    url: 'https://peddleswap.xyz/',
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
    logo: '/assets/peddles.png',
    bg: '#1c1f22',
    accent: '#27b6ff',
    fit: 'cover',
    pad: '0px',
    padSm: '0px',
    url: 'https://peddles.xyz/',
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
    logo: '/assets/peddlequest.png',
    bg: '#0a101c',
    accent: '#ffd60a',
    fit: 'contain',
    pad: '40px 72px',
    padSm: '24px 28px',
    url: 'https://peddlequest.xyz/',
    chains: ['Base', 'Robinhood', 'BNB Chain', 'Arc'],
    built: ['On-chain quest verification and escrow', 'XP, crates and soulbound badges', 'Quest wizard and sybil rules for projects'],
  },
]

/** Slots for projects still in development. */
export const comingSoon = ['06']

export const TOTAL_SLOTS = '06'

export function projectNumber(index: number) {
  return String(index + 1).padStart(2, '0')
}
