import { ChartLine, FlaskConical, Info, Layers, type LucideIcon } from 'lucide-react'

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
  { label: 'Services', to: '/services', match: '/services', icon: Layers },
  { label: 'About', to: '/about', match: '/about', icon: Info },
]
