// TODO: every metric, member/holder count and sparkline series below is sample
// data. Wire them to a real source (e.g. DefiLlama or our own indexer).

export interface Metric {
  label: string
  value: string
}

export interface Project {
  slug: string
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
  metrics: [Metric, Metric]
  /** Nine monthly data points for the sparkline and activity chart. */
  series: number[]
  built: string[]
}

export const projects: Project[] = [
  {
    slug: 'cartel-family',
    name: 'Cartel Family',
    tag: 'Trading community',
    status: 'Live',
    tagline: 'We trade as one',
    description: 'A members-first trading collective with shared tools and signals.',
    logo: '/assets/cartel-family.png',
    bg: '#12151c',
    accent: '#b8926a',
    fit: 'cover',
    pad: '0px',
    padSm: '0px',
    url: 'https://cartel.family/',
    metrics: [
      { label: 'VOLUME 30D', value: '$412.8M' },
      { label: 'MEMBERS', value: '8,240' },
    ],
    series: [3, 4, 3.6, 5, 5.4, 6.2, 5.8, 7.1, 8],
    built: ['Member portal and wallet sign-in', 'Shared trading dashboards', 'Token-gated community channels'],
  },
  {
    slug: 'latch-protocol',
    name: 'Latch Protocol',
    tag: 'DeFi infrastructure',
    status: 'Live',
    tagline: 'Hooks for a bigger ecosystem',
    description: 'Composable hooks that let protocols plug into shared liquidity.',
    logo: '/assets/latch.png',
    bg: '#0e1624',
    accent: '#2e8cff',
    fit: 'contain',
    pad: '56px 80px',
    padSm: '28px 40px',
    url: 'https://latches.fun/',
    metrics: [
      { label: 'TVL', value: '$96.3M' },
      { label: 'HOOKS LIVE', value: '27' },
    ],
    series: [2, 2.4, 3.1, 3, 3.8, 4.4, 4.2, 5.3, 6],
    built: ['Hook contracts and SDK', 'Liquidity routing layer', 'Security review and audit'],
  },
  {
    slug: 'peddles',
    name: 'Peddles',
    tag: 'Community & culture',
    status: 'Live',
    tagline: 'Ride the curve', // TODO: placeholder tagline
    description: 'The home of the Peddles otter and its on-chain community.',
    logo: '/assets/peddles.png',
    bg: '#1c1f22',
    accent: '#27b6ff',
    fit: 'cover',
    pad: '0px',
    padSm: '0px',
    url: 'https://peddles.xyz/',
    metrics: [
      { label: 'HOLDERS', value: '14,902' },
      { label: 'VOLUME 30D', value: '$38.5M' },
    ],
    series: [5, 4.2, 4.8, 6, 5.5, 6.8, 7.4, 7, 8.2],
    built: ['Collection and mint site', 'Holder rewards programme', 'Mascot and brand system'],
  },
  {
    slug: 'peddleswap',
    name: 'PeddleSwap',
    tag: 'DEX',
    status: 'Beta',
    tagline: 'Swap at speed', // TODO: placeholder tagline
    description: 'A fast, low-fee exchange for swapping tokens and providing liquidity.',
    logo: '/assets/peddleswap.png',
    bg: '#15181b',
    accent: '#b8f03c',
    fit: 'contain',
    pad: '64px 64px',
    padSm: '36px 28px',
    url: 'https://peddleswap.xyz/',
    metrics: [
      { label: 'TVL', value: '$88.3M' },
      { label: 'VOLUME 24H', value: '$6.1M' },
    ],
    series: [1, 1.8, 1.6, 2.6, 3.4, 3.1, 4.2, 4.9, 5.6],
    built: ['AMM and router contracts', 'Swap and liquidity interface', 'Analytics and indexing'],
  },
]

/** Slots for projects still in development. */
export const comingSoon = ['05', '06']

export const TOTAL_SLOTS = '06'

export function projectNumber(index: number) {
  return String(index + 1).padStart(2, '0')
}
