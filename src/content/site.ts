import { FlaskConical, Info, Layers, type LucideIcon } from 'lucide-react'

// TODO: replace with the real social profiles.
export const socialLinks = [
  { label: 'X', href: 'https://x.com' },
  { label: 'GitHub', href: 'https://github.com' },
  { label: 'Discord', href: 'https://discord.com' },
] as const

export type SocialLabel = (typeof socialLinks)[number]['label']

export const navItems: { label: string; to: string; match: string; icon: LucideIcon }[] = [
  { label: 'Projects', to: '/#projects', match: '/projects', icon: FlaskConical },
  { label: 'Services', to: '/services', match: '/services', icon: Layers },
  { label: 'About', to: '/about', match: '/about', icon: Info },
]
