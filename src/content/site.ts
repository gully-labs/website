import { Activity, BellRing, BookOpen, Boxes, ChartNoAxesCombined, ChartLine, Code2, FileJson, FlaskConical, Info, KeyRound, Layers, Newspaper, Puzzle, Tag, type LucideIcon } from 'lucide-react'

export const SITE_URL = 'https://gullylabs.xyz'

/* The handle every "Follow" and "Post" on the site points at (owner, 2026-10-15). Change it
   here and every share button, the footer and the share card follow. */
export const SHARE = {
  handle: '@Gully_Labs',
  hashtags: ['#GullyLabs', '#Web3'],
} as const

export const socialLinks = [
  { label: 'X', href: 'https://x.com/Gully_Labs' },
  { label: 'GitHub', href: 'https://github.com/gully-labs' },
  { label: 'Telegram', href: 'https://t.me/peddlesnews' },
] as const

export type SocialLabel = (typeof socialLinks)[number]['label']

export const navItems: { label: string; to: string; match: string; icon: LucideIcon }[] = [
  { label: 'Ledger', to: '/#ledger', match: '/#ledger', icon: ChartLine },
  { label: 'Projects', to: '/#projects', match: '/projects', icon: FlaskConical },
  { label: 'Tracker', to: '/tracker', match: '/tracker', icon: Activity },
  { label: 'Services', to: '/services', match: '/services', icon: Layers },
  { label: 'About', to: '/about', match: '/about', icon: Info },
]

/** The header's site menu: every section of the landing, each also matching its own page. Deliberately
    short labels: with labels the bar must still fit on one line from 1320 px (Header.tsx). */
export const headerNav: { label: string; to: string; match: string; icon: LucideIcon }[] = [
  { label: 'Projects', to: '/#projects', match: '/projects', icon: FlaskConical },
  { label: 'Tracker', to: '/#tracker', match: '/tracker', icon: Activity },
  { label: 'Alerts', to: '/#alerts', match: '/#alerts', icon: BellRing },
  { label: 'Analytics', to: '/#analytics', match: '/analytics', icon: ChartNoAxesCombined },
  { label: 'Chain Kit', to: '/#chainkit', match: '/chain-kit', icon: Boxes },
  { label: 'API', to: '/#api', match: '/#api', icon: FileJson },
  { label: 'Widget', to: '/#widget', match: '/widget', icon: Puzzle },
  { label: 'Pricing', to: '/#pricing', match: '/pricing', icon: Tag },
  { label: 'Services', to: '/#services', match: '/services', icon: Layers },
]

/** The developer surfaces. Docs is its own host; /developers moves to developers.gullylabs.xyz. */
export const devLinks: ({ label: string; icon: LucideIcon } & ({ href: string } | { to: string }))[] = [
  { label: 'Docs', href: 'https://docs.gullylabs.xyz', icon: BookOpen },
  { label: 'Widget', to: '/widget', icon: Puzzle },
  { label: 'Developer portal', to: '/developers', icon: KeyRound },
]

/** Products built on open source, in the footer. */
export const productLinks: { label: string; to: string; icon: LucideIcon }[] = [
  { label: 'Gully Analytics', to: '/analytics', icon: ChartNoAxesCombined },
  { label: 'Chain Kit', to: '/chain-kit', icon: Boxes },
  { label: 'API pricing', to: '/pricing', icon: Tag },
]

/** Header entries for developers, after the site sections. */
export const headerDevItems: { label: string; icon: LucideIcon; href?: string; to?: string; match?: string }[] = [
  { label: 'Developers', to: '/developers', match: '/developers', icon: Code2 },
  { label: 'Docs', href: 'https://docs.gullylabs.xyz', icon: BookOpen },
  { label: 'Blog', href: 'https://blog.gullylabs.xyz', icon: Newspaper },
]
