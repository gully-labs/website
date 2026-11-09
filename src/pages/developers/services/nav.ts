import { ArrowLeftRight, ChartNoAxesColumn, Droplets, Download, Layers, LineChart, Lock, Rocket, Share2, Vault, Wallet, AppWindow, BellRing, Bot, Boxes, ChartCandlestick, ChartNoAxesCombined, CircleDollarSign, CreditCard, Gamepad2, Gauge, HardDrive, History, KeyRound, LayoutDashboard, Network, ScanSearch, Send, Server, Settings, ShieldCheck, Users, type LucideIcon } from 'lucide-react'
import type { ProductKey } from '../../../console/ui'

/* The Gully Labs App's pages (app.gullylabs.xyz), slimmed on the owner's word (2026-11-03: "all services don't need
   to be in the gullylabs dashboard").

   SIDEBAR      the seven pages the sidebar lists, each with a Lucide icon: Overview, Activity, Products, Keys,
                Billing, Team, Settings. Nothing else is listed there.
   TOOL_TABS    HolderMaps / Gully Security features that stay in this app without a sidebar entry: the Tracker, Gully
                Score, Widgets, Telegram, Alerts and Analytics. They are reached from the Tools section of Products
                (and still by hash: #tracker, #score, #widgets, #telegram, #alerts, #analytics).
   HANDOFF_TABS the products on their own domains. Their hashes (#chain, #pay, #rpc, #ipfs, #holders, #security,
                #studio) keep working: the app leaves for the product's own app (redirectFor). The old hashes of the
                features that moved (#chains, #chains/launch, #chain-kit, #deepcore) go to Gully Chain's app too.
   AI_TAB       #ai (the old Gully AI page): the app opens Gully AI as the floating assistant drawer instead.

   server/hosts.mjs APP_TABS lists every id here plus Dashboard.tsx TABS (scripts/test-hosts.mjs checks they agree);
   scripts/test-hub-nav.mjs checks the sidebar list and the redirects. */

export type SidebarTab = 'overview' | 'activity' | 'products' | 'keys' | 'billing' | 'team' | 'settings'

/** The seven sidebar pages, in order. The ids as one string (HUB_NAV_IDS) is written into the DOM, so a live check can
    read the list from the served bundle. */
export const SIDEBAR: { id: SidebarTab; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'activity', label: 'Activity', icon: History },
  { id: 'products', label: 'Products', icon: Boxes },
  { id: 'keys', label: 'Keys', icon: KeyRound },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'settings', label: 'Settings', icon: Settings },
]
export const HUB_NAV_IDS = 'overview,activity,products,keys,billing,team,settings'

/** The Gully Core app. Its routes are the real features behind the sidebar's Trade, Build and Manage groups and the
    home page's Create tiles (gully-core-app apps/web/src/routes/dapp/data/shell.ts). */
export const CORE_APP = 'https://app.gullycore.xyz'
export type AppLink = { label: string; href: string; icon: LucideIcon }
export const APP_GROUPS: { title: string; links: AppLink[] }[] = [
  {
    title: 'Trade',
    links: [
      { label: 'Swap', href: `${CORE_APP}/swap`, icon: ArrowLeftRight },
      { label: 'Markets', href: '#tracker', icon: LineChart },
      { label: 'Launches', href: `${CORE_APP}/launch/v2`, icon: Rocket },
      { label: 'Pools', href: `${CORE_APP}/pool`, icon: Droplets },
      { label: 'Hook pools', href: `${CORE_APP}/marketplace`, icon: Layers },
    ],
  },
  {
    title: 'Build',
    links: [
      { label: 'Launch a token', href: `${CORE_APP}/launch/v2/new`, icon: Rocket },
      { label: 'Launchpad', href: `${CORE_APP}/pads/new`, icon: Layers },
      { label: 'DEX', href: `${CORE_APP}/dexes/new?kind=dex`, icon: ArrowLeftRight },
      { label: 'Stock market', href: `${CORE_APP}/pads/new?kind=stocks`, icon: ChartNoAxesColumn },
      { label: 'Vault', href: `${CORE_APP}/vaults/new`, icon: Vault },
      { label: 'Create a chain', href: '/create-chain', icon: Network },
    ],
  },
  {
    title: 'Manage',
    links: [
      { label: 'Locks', href: `${CORE_APP}/locks`, icon: Lock },
      { label: 'Distribute', href: `${CORE_APP}/distribute`, icon: Share2 },
      { label: 'Claim', href: `${CORE_APP}/claim`, icon: Download },
      { label: 'Portfolio', href: `${CORE_APP}/portfolio`, icon: Wallet },
    ],
  },
]
/** The home page's six Create tiles. */
export const CREATE_TILES: AppLink[] = [...APP_GROUPS[1].links, { label: 'Lock', href: `${CORE_APP}/locks/new`, icon: Lock }]

/** The service pages that are their own lazy chunk (ServiceView.tsx). */
export type ServiceTab = 'tracker' | 'score' | 'widgets' | 'telegram'
export const SERVICE_TABS: { id: ServiceTab; label: string; icon: LucideIcon }[] = [
  { id: 'tracker', label: 'Tracker', icon: ChartCandlestick },
  { id: 'score', label: 'Gully Score', icon: Gauge },
  { id: 'widgets', label: 'Widgets', icon: AppWindow },
  { id: 'telegram', label: 'Telegram', icon: Send },
]
export const isServiceTab = (id: string): id is ServiceTab => SERVICE_TABS.some((s) => s.id === id)

/** Every tool the Products page lists (the service pages plus Alerts and Analytics, which are Dashboard.tsx pages),
    with the product each belongs to and one line. */
export type ToolTab = ServiceTab | 'alerts' | 'analytics'
export const TOOL_TABS: { id: ToolTab; label: string; icon: LucideIcon; of: 'HolderMaps' | 'Gully Security' | 'Gully Labs'; line: string }[] = [
  { id: 'tracker', label: 'Tracker', icon: ChartCandlestick, of: 'HolderMaps', line: 'Tokenised stocks against their Chainlink fair price, every five minutes.' },
  { id: 'alerts', label: 'Alerts', icon: BellRing, of: 'HolderMaps', line: 'A webhook or Telegram message when a gap crosses your line or a token launches.' },
  { id: 'score', label: 'Gully Score', icon: Gauge, of: 'Gully Security', line: 'How a contract is controlled and has behaved, 0 to 100, from public evidence.' },
  { id: 'widgets', label: 'Widgets', icon: AppWindow, of: 'HolderMaps', line: 'Live fair prices and holder maps on any page with two lines of HTML.' },
  { id: 'telegram', label: 'Telegram', icon: Send, of: 'HolderMaps', line: 'The bot, your linked chat and the alerts it delivers.' },
  { id: 'analytics', label: 'Analytics', icon: ChartNoAxesCombined, of: 'Gully Labs', line: 'Web3-aware website analytics, one script tag, no cookies.' },
]

/** The old Gully AI page id: the floating assistant opens instead (Dashboard.tsx). */
export const AI_TAB = { id: 'ai', label: 'Gully AI', icon: Bot } as const

/** The products on their own domains, each with the app the hub opens for it. */
export type HandoffTab = 'chain' | 'pay' | 'rpc' | 'ipfs' | 'holders' | 'security' | 'studio'
export const HANDOFF_TABS: { id: HandoffTab; label: string; icon: LucideIcon; product: ProductKey; href: string }[] = [
  { id: 'chain', label: 'Gully Chain', icon: Network, product: 'chain', href: 'https://kre8.fun' },
  { id: 'pay', label: 'Gully Pay', icon: CircleDollarSign, product: 'pay', href: 'https://gullypay.xyz' },
  { id: 'rpc', label: 'Gully RPC', icon: Server, product: 'rpc', href: 'https://app.gullyrpc.xyz' },
  { id: 'ipfs', label: 'Gully IPFS', icon: HardDrive, product: 'ipfs', href: 'https://docs.gullylabs.xyz/ipfs' },
  { id: 'holders', label: 'HolderMaps', icon: ScanSearch, product: 'holders', href: 'https://holdermaps.xyz' },
  { id: 'security', label: 'Gully Security', icon: ShieldCheck, product: 'security', href: 'https://gullysecurity.xyz' },
  { id: 'studio', label: 'Gully Studio', icon: Gamepad2, product: 'studio', href: 'https://gullystudio.xyz' },
]
export const isHandoffTab = (id: string): id is HandoffTab => HANDOFF_TABS.some((s) => s.id === id)

/** Old hashes of the Gully Chain features that moved to gullychain.xyz / kre8.fun. */
export const LEGACY_CHAIN_HASHES = ['chains', 'chains/launch', 'chain-kit', 'deepcore'] as const

/** Where a product hash sends the app: the product's own app, or null when the hash is a page of this app. The
    Gully ID session is the product's own (one sign-in at id.gullychain.xyz), so the plain address is enough. */
export function redirectFor(hash: string): string | null {
  const id = hash.replace(/^#/, '').split('/')[0]
  if ((LEGACY_CHAIN_HASHES as readonly string[]).includes(hash.replace(/^#/, ''))) return HANDOFF_TABS[0].href
  return HANDOFF_TABS.find((h) => h.id === id)?.href ?? null
}
