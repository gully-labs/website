import { AppWindow, BellRing, Bot, Boxes, ChartCandlestick, ChartNoAxesCombined, CircleDollarSign, CreditCard, Gamepad2, Gauge, HardDrive, History, KeyRound, LayoutDashboard, Network, ScanSearch, Send, Server, Settings, ShieldCheck, Users, Wrench, type LucideIcon } from 'lucide-react'
import type { ProductKey } from '../../../console/ui'

/* The Gully Labs App's pages (app.gullylabs.xyz). Owner, 2026-11-08: "clean up the dashboard and have only the
   services gullylabs offers on the app / the other projects are on the web".

   SIDEBAR       the ten pages the sidebar lists, each with a Lucide icon: Overview, Activity, Chains, IPFS, Analytics,
                 Services, Keys, Billing, Team, Settings. Nothing else is listed there: every one is a service Gully
                 Labs itself sells or runs from this account (Create a chain, Gully IPFS, Gully Analytics, development
                 services, the Gully Labs API, billing through Gully Pay). The other Gully products live in their own
                 apps and on gullylabs.xyz/products (PRODUCTS_URL, one link in the sidebar footer).
   REMOVED_TABS  pages this app used to have and does not any more: the Products launcher and the HolderMaps / Gully
                 Security tools (Tracker, Alerts, Gully Score, Widgets, Telegram). Their hashes keep working: the app
                 leaves for the page on the web where the feature lives now (redirectFor), so no old link dies.
   HANDOFF_TABS  the products on their own domains. Their hashes (#chain, #pay, #rpc, #holders, #security, #studio)
                 keep working the same way. The old hashes of the Gully Chain features that moved (#chains/launch,
                 #chain-kit, #deepcore) go to Gully Chain's app too; #ipfs is this app's own page now.
   AI_TAB        #ai (the old Gully AI page): the app opens Gully AI as the floating assistant drawer instead.

   server/hosts.mjs APP_TABS lists every id here plus Dashboard.tsx TABS (scripts/test-hosts.mjs checks they agree);
   scripts/test-hub-nav.mjs checks the sidebar list and the redirects. */

export type SidebarTab = 'overview' | 'activity' | 'chains' | 'ipfs' | 'analytics' | 'services' | 'keys' | 'billing' | 'team' | 'settings'

/** The ten sidebar pages, in order. The ids as one string (HUB_NAV_IDS) is written into the DOM, so a live check can
    read the list from the served bundle. */
export const SIDEBAR: { id: SidebarTab; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'activity', label: 'Activity', icon: History },
  { id: 'chains', label: 'Chains', icon: Network },
  { id: 'ipfs', label: 'IPFS', icon: HardDrive },
  { id: 'analytics', label: 'Analytics', icon: ChartNoAxesCombined },
  { id: 'services', label: 'Services', icon: Wrench },
  { id: 'keys', label: 'Keys', icon: KeyRound },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'settings', label: 'Settings', icon: Settings },
]
export const HUB_NAV_IDS = 'overview,activity,chains,ipfs,analytics,services,keys,billing,team,settings'

/** The phone tab bar (under 860px): four pages and "More". */
export const TAB_BAR_IDS: SidebarTab[] = ['overview', 'activity', 'analytics', 'billing']

/** Every Gully product, on the web. The one link to the other products this app keeps (the sidebar footer). */
export const PRODUCTS_URL = 'https://gullylabs.xyz/products'

/** The old Gully AI page id: the floating assistant opens instead (Dashboard.tsx). */
export const AI_TAB = { id: 'ai', label: 'Gully AI', icon: Bot } as const

/** The pages that left this app, and where each hash goes now. `of` names the product the feature belongs to;
    `where` says what the destination is, for the report and the tests:
      page      the feature's own page on the web (gullylabs.xyz keeps the public Tracker, Gully Score and widget
                builder; the products list is gullylabs.xyz/products)
      home      the product's home, because the feature has no page of its own on the web yet (gap alerts and the
                Telegram bot are HolderMaps features; their management UI moves there with HolderMaps' own app). */
export type RemovedTab = 'products' | 'tracker' | 'alerts' | 'score' | 'widgets' | 'telegram'
export const REMOVED_TABS: { id: RemovedTab; label: string; icon: LucideIcon; of: 'Gully Labs' | 'HolderMaps' | 'Gully Security'; href: string; where: 'page' | 'home' }[] = [
  { id: 'products', label: 'Products', icon: Boxes, of: 'Gully Labs', href: PRODUCTS_URL, where: 'page' },
  { id: 'tracker', label: 'Tracker', icon: ChartCandlestick, of: 'HolderMaps', href: 'https://gullylabs.xyz/tracker', where: 'page' },
  { id: 'alerts', label: 'Alerts', icon: BellRing, of: 'HolderMaps', href: 'https://holdermaps.xyz/', where: 'home' },
  { id: 'score', label: 'Gully Score', icon: Gauge, of: 'Gully Security', href: 'https://gullylabs.xyz/score', where: 'page' },
  { id: 'widgets', label: 'Widgets', icon: AppWindow, of: 'HolderMaps', href: 'https://gullylabs.xyz/widget', where: 'page' },
  { id: 'telegram', label: 'Telegram', icon: Send, of: 'HolderMaps', href: 'https://holdermaps.xyz/', where: 'home' },
]
export const isRemovedTab = (id: string): id is RemovedTab => REMOVED_TABS.some((s) => s.id === id)

/** The products on their own domains, each with the app the hub opens for it. */
export type HandoffTab = 'chain' | 'pay' | 'rpc' | 'holders' | 'security' | 'studio'
export const HANDOFF_TABS: { id: HandoffTab; label: string; icon: LucideIcon; product: ProductKey; href: string }[] = [
  { id: 'chain', label: 'Gully Chain', icon: Network, product: 'chain', href: 'https://kre8.fun' },
  { id: 'pay', label: 'Gully Pay', icon: CircleDollarSign, product: 'pay', href: 'https://gullypay.xyz' },
  { id: 'rpc', label: 'Gully RPC', icon: Server, product: 'rpc', href: 'https://app.gullyrpc.xyz' },
  { id: 'holders', label: 'HolderMaps', icon: ScanSearch, product: 'holders', href: 'https://holdermaps.xyz' },
  { id: 'security', label: 'Gully Security', icon: ShieldCheck, product: 'security', href: 'https://gullysecurity.xyz' },
  { id: 'studio', label: 'Gully Studio', icon: Gamepad2, product: 'studio', href: 'https://gullystudio.xyz' },
]
export const isHandoffTab = (id: string): id is HandoffTab => HANDOFF_TABS.some((s) => s.id === id)

/** Old hashes of the Gully Chain features that moved to gullychain.xyz / kre8.fun. (#chains alone is this app's
    Chains page: your chain orders.) */
export const LEGACY_CHAIN_HASHES = ['chains/launch', 'chain-kit', 'deepcore'] as const

/** One label and icon for every hash that leaves the app (the Leaving line in Dashboard.tsx). */
export function leavingFor(id: string): { label: string; href: string; icon: LucideIcon } | null {
  const r = REMOVED_TABS.find((x) => x.id === id)
  if (r) return r
  const h = HANDOFF_TABS.find((x) => x.id === id)
  return h ?? null
}

/** Where a hash sends the app: the product's own app or the page on the web, or null when the hash is a page of
    this app. The Gully ID session is the product's own (one sign-in at gullyid.xyz), so the plain address is enough. */
export function redirectFor(hash: string): string | null {
  const bare = hash.replace(/^#/, '')
  const id = bare.split('/')[0]
  if ((LEGACY_CHAIN_HASHES as readonly string[]).includes(bare)) return HANDOFF_TABS[0].href
  return REMOVED_TABS.find((r) => r.id === id)?.href ?? HANDOFF_TABS.find((h) => h.id === id)?.href ?? null
}
