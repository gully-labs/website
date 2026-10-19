import { Activity, ArrowLeftRight, BellRing, BookOpen, Boxes, Building2, ChartNoAxesCombined, CircleDollarSign, Code2, Globe, Handshake, FileJson, FlaskConical, HeartPulse, History, Info, KeyRound, LayoutGrid, Layers, Mail, Network, Newspaper, Package, Puzzle, ScanSearch, ShieldCheck, Sparkles, Tag, type LucideIcon } from 'lucide-react'
import { APP_URL, DOCS_URL } from '../site-host'
import { scoreNavEntry } from '../pages/score/nav'

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
  // The bot is a product, the channel is the community: listed separately (CLAUDE.md, Telegram rule).
  { label: 'TelegramBot', href: 'https://t.me/GullyLabsBot', name: '@GullyLabsBot on Telegram' },
] as const

export type SocialLabel = (typeof socialLinks)[number]['label']

/* ------------------------------------------------------------------ navigation --- */

/** One entry in the header menus, the mobile sheet and the footer. Exactly one destination:
    `to` (an in-app route or /#section), `href` (another host), or `action: 'contact'` (the contact form).
    `localTo` replaces `href` on localhost, where the app dashboard is served under /app. */
export type NavEntry = {
  label: string
  desc: string
  icon: LucideIcon
  badge?: string
  /** Paths that light this entry (and its group) up as the current section. */
  match?: string[]
  /** Another app or site (the app, analytics, GitHub, blog, docs): opens in a new tab, marked with ↗.
      Owner rule (2026-10-18): every link to another host does, app.gullylabs.xyz included. */
  newTab?: boolean
} & ({ to: string; href?: never; action?: never } | { href: string; localTo?: string; to?: never; action?: never } | { action: 'contact'; to?: never; href?: never })

export type NavGroup = { id: 'products' | 'developers' | 'company'; label: string; icon: LucideIcon; items: NavEntry[] }

const devPortal: NavEntry = { label: 'App dashboard', desc: 'Every product: keys, alerts, tracker, Pay, AI', href: APP_URL, localTo: '/app', icon: KeyRound, match: ['/app', '/developers'], newTab: true }
const analyticsApp: NavEntry = { label: 'Gully Analytics', desc: 'Open the analytics app', href: 'https://analytics.gullylabs.xyz', icon: ChartNoAxesCombined, newTab: true }

export const productsNav: NavGroup = {
  id: 'products',
  label: 'Products',
  icon: LayoutGrid,
  items: [
    { label: 'Stock tracker', desc: 'Stock tokens against their fair price', to: '/tracker', icon: Activity, match: ['/tracker'] },
    { label: 'Holder Map', desc: 'Who really holds a token, checked live', to: '/holders', icon: ScanSearch, match: ['/holders'], badge: 'New' },
    { label: 'Swap', desc: 'Swap any stock token from its page', to: '/tracker/robinhood/NVDA#swap', icon: ArrowLeftRight },
    { label: 'Alerts', desc: 'Gap alerts by Telegram or webhook', to: '/#alerts', icon: BellRing },
    { label: 'Gully Analytics', desc: 'Web analytics that see the wallet', to: '/analytics', icon: ChartNoAxesCombined, match: ['/analytics'] },
    { label: 'Chain Kit', desc: 'Branded block explorers', to: '/chain-kit', icon: Boxes, match: ['/chain-kit'] },
    { label: 'Gully Security', desc: 'AI Security Scan and code reviews', to: '/security', icon: ShieldCheck, match: ['/security'] },
    scoreNavEntry,
    { label: 'Gully Chains', desc: 'Your own Arbitrum chain, run by us', to: '/chains', icon: Network, match: ['/chains'], badge: 'Waitlist' },
    { label: 'Gully Pay', desc: 'Crypto billing and pay links', to: '/#pay', icon: CircleDollarSign },
    { label: 'All products', desc: 'Try each one live on the home page', to: '/#products', icon: LayoutGrid },
  ],
}

export const developersNav: NavGroup = {
  id: 'developers',
  label: 'App & API',
  icon: Code2,
  items: [
    // Gully AI is the plain header link beside this menu (navLinks), so it is not listed twice in the header.
    devPortal,
    { label: 'Docs', desc: 'Guides for every product', href: DOCS_URL, icon: BookOpen, newTab: true },
    { label: 'API docs', desc: 'Free REST API reference', href: `${DOCS_URL}/api`, icon: FileJson, newTab: true },
    { label: 'SDK', desc: 'TypeScript client, MIT', href: 'https://github.com/gully-labs/sdk', icon: Package, newTab: true },
    { label: 'Widget', desc: 'One script tag, live prices', to: '/widget', icon: Puzzle, match: ['/widget'] },
    { label: 'Changelog', desc: 'What shipped, and when', href: `${DOCS_URL}/changelog`, icon: History, newTab: true },
    { label: 'Status', desc: 'Live status and uptime of every service', to: '/status', icon: HeartPulse, match: ['/status'] },
  ],
}

export const companyNav: NavGroup = {
  id: 'company',
  label: 'Company',
  icon: Building2,
  items: [
    { label: 'Services', desc: 'Contracts to launch, built with you', to: '/services', icon: Layers, match: ['/services'] },
    { label: 'About', desc: 'Who we are and how we work', to: '/about', icon: Info, match: ['/about'] },
    { label: 'Ecosystem', desc: 'Our projects, live, and what we integrate with', to: '/ecosystem', icon: Globe, match: ['/ecosystem'] },
    { label: 'Partners', desc: 'Holder Map, SDK and webhooks for launchpads, wallets and chains', to: '/partners', icon: Handshake, match: ['/partners'] },
    { label: 'Blog', desc: 'Releases and write-ups', href: 'https://blog.gullylabs.xyz', icon: Newspaper, newTab: true },
    { label: 'Contact', desc: 'Start a project with us', action: 'contact', icon: Mail },
  ],
}

export const navGroups: NavGroup[] = [productsNav, developersNav, companyNav]

/** Plain header links, between the App & API and Company menus. */
export const navLinks: NavEntry[] = [
  { label: 'Projects', desc: 'The venues we run', to: '/#projects', icon: FlaskConical, match: ['/projects'] },
  { label: 'Pricing', desc: 'API, alerts and analytics plans', to: '/pricing', icon: Tag, match: ['/pricing'] },
  { label: 'Gully AI', desc: 'Ask anything about Gully Labs, with sources (⌘K)', to: '/ask', icon: Sparkles, match: ['/ask'] },
]

/** The "Launch app" split button: the main part opens the tracker, its menu lists the apps. */
export const launchApp = {
  to: '/tracker',
  items: [
    { label: 'Stock tracker', desc: 'Live stock token gaps', to: '/tracker', icon: Activity },
    { label: 'Holder Map', desc: 'Who holds a launch or a stock token', to: '/holders', icon: ScanSearch },
    { label: 'Gully AI', desc: 'Ask about any product', to: '/ask', icon: Sparkles },
    devPortal,
    analyticsApp,
  ] satisfies NavEntry[],
}
