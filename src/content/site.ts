import { Activity, ArrowLeftRight, BellRing, Boxes, Building2, ChartNoAxesCombined, CircleDollarSign, Code2, FileJson, FlaskConical, History, Info, KeyRound, LayoutGrid, Layers, Mail, Network, Newspaper, Package, Puzzle, ShieldCheck, Sparkles, Tag, type LucideIcon } from 'lucide-react'
import { DEVELOPERS_URL, DOCS_URL } from '../site-host'

export const SITE_URL = 'https://gullylabs.xyz'

/* The handle every "Follow" and "Post" on the site points at (owner, 2026-10-15). Change it
   here and every share button, the footer and the share card follow. */
export const SHARE = {
  handle: '@Gully_Labs',
  hashtags: ['#GullyLabs', '#Web3'],
} as const

export const socialLinks = [
  { label: 'X', href: 'https://x.com/Gully_Labs', name: 'X' },
  { label: 'GitHub', href: 'https://github.com/gully-labs', name: 'GitHub' },
  { label: 'Telegram', href: 'https://t.me/GullyLabsNews', name: 'Gully Labs News on Telegram' },
] as const

export type SocialLabel = (typeof socialLinks)[number]['label']

/* ------------------------------------------------------------------ navigation --- */

/** One entry in the header menus, the mobile sheet and the footer. Exactly one destination:
    `to` (an in-app route or /#section), `href` (another host), or `action: 'contact'` (the contact form).
    `localTo` replaces `href` on localhost, where the developer portal is served under /developers. */
export type NavEntry = {
  label: string
  desc: string
  icon: LucideIcon
  badge?: string
  /** Paths that light this entry (and its group) up as the current section. */
  match?: string[]
  /** Another app or site (analytics, GitHub, blog, docs): opens in a new tab, marked with ↗. */
  newTab?: boolean
} & ({ to: string; href?: never; action?: never } | { href: string; localTo?: string; to?: never; action?: never } | { action: 'contact'; to?: never; href?: never })

export type NavGroup = { id: 'products' | 'developers' | 'company'; label: string; icon: LucideIcon; items: NavEntry[] }

const devPortal: NavEntry = { label: 'Developer portal', desc: 'Keys, usage, alerts and billing', href: DEVELOPERS_URL, localTo: '/developers', icon: KeyRound, match: ['/developers'] }
const analyticsApp: NavEntry = { label: 'Gully Analytics', desc: 'Open the analytics app', href: 'https://analytics.gullylabs.xyz', icon: ChartNoAxesCombined, newTab: true }

export const productsNav: NavGroup = {
  id: 'products',
  label: 'Products',
  icon: LayoutGrid,
  items: [
    { label: 'Stock tracker', desc: 'Stock tokens against their fair price', to: '/tracker', icon: Activity, match: ['/tracker'] },
    { label: 'Swap', desc: 'Swap any stock token from its page', to: '/tracker/robinhood/NVDA#swap', icon: ArrowLeftRight },
    { label: 'Alerts', desc: 'Gap alerts by Telegram or webhook', to: '/#alerts', icon: BellRing },
    { label: 'Gully Analytics', desc: 'Web analytics that see the wallet', to: '/analytics', icon: ChartNoAxesCombined, match: ['/analytics'] },
    { label: 'Chain Kit', desc: 'Branded block explorers', to: '/chain-kit', icon: Boxes, match: ['/chain-kit'] },
    { label: 'Gully Chains', desc: 'App chains, launched for you', to: '/#chains', icon: Network, badge: 'Soon' },
    { label: 'Gully Pay', desc: 'Crypto billing and pay links', to: '/#pay', icon: CircleDollarSign },
    { label: 'Security', desc: 'Contract and code audits, on the roadmap', href: `${DOCS_URL}/roadmap#security`, icon: ShieldCheck, badge: 'Coming soon', newTab: true },
    { label: 'All products', desc: 'Try each one live on the home page', to: '/#products', icon: LayoutGrid },
  ],
}

export const developersNav: NavGroup = {
  id: 'developers',
  label: 'Developers',
  icon: Code2,
  items: [
    { label: 'Gully AI', desc: 'Ask anything about Gully Labs, with sources', to: '/ask', icon: Sparkles, match: ['/ask'], badge: 'New' },
    devPortal,
    { label: 'API docs', desc: 'Free REST API reference', href: `${DOCS_URL}/api`, icon: FileJson, newTab: true },
    { label: 'SDK', desc: 'TypeScript client, MIT', href: 'https://github.com/gully-labs/sdk', icon: Package, newTab: true },
    { label: 'Widget', desc: 'One script tag, live prices', to: '/widget', icon: Puzzle, match: ['/widget'] },
    { label: 'Changelog', desc: 'What shipped, and when', href: `${DOCS_URL}/changelog`, icon: History, newTab: true },
  ],
}

export const companyNav: NavGroup = {
  id: 'company',
  label: 'Company',
  icon: Building2,
  items: [
    { label: 'Services', desc: 'Contracts to launch, built with you', to: '/services', icon: Layers, match: ['/services'] },
    { label: 'About', desc: 'Who we are and how we work', to: '/about', icon: Info, match: ['/about'] },
    { label: 'Blog', desc: 'Releases and write-ups', href: 'https://blog.gullylabs.xyz', icon: Newspaper, newTab: true },
    { label: 'Contact', desc: 'Start a project with us', action: 'contact', icon: Mail },
  ],
}

export const navGroups: NavGroup[] = [productsNav, developersNav, companyNav]

/** Plain header links, between the Developers and Company menus. */
export const navLinks: NavEntry[] = [
  { label: 'Projects', desc: 'The venues we run', to: '/#projects', icon: FlaskConical, match: ['/projects'] },
  { label: 'Pricing', desc: 'API, alerts and analytics plans', to: '/pricing', icon: Tag, match: ['/pricing'] },
]

/** The "Launch app" split button: the main part opens the tracker, its menu lists the apps. */
export const launchApp = {
  to: '/tracker',
  items: [
    { label: 'Tracker', desc: 'Live stock token gaps', to: '/tracker', icon: Activity },
    { label: 'Gully AI', desc: 'Ask about any product', to: '/ask', icon: Sparkles },
    devPortal,
    analyticsApp,
  ] satisfies NavEntry[],
}
