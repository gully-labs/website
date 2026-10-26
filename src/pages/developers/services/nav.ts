import { AppWindow, Bot, ChartCandlestick, CircleDollarSign, Gamepad2, Gauge, HardDrive, Network, ScanSearch, Send, Server, ShieldCheck, type LucideIcon } from 'lucide-react'
import type { ProductKey } from '../../../console/ui'

/* The app's service pages (each a lazy chunk, ServiceView.tsx) and the sidebar's groups.

   Service pages are deep-linkable by hash like the other pages: #tracker, #ai, #score, #widgets, #telegram.

   Products on their own domains (2026-10-26): Gully Chain, Gully Pay, Gully RPC, HolderMaps, Gully Security and Gully
   Studio are no longer full features of this app. Each has a page here that hands off to its domain (console/Handoff.tsx):
   #chain, #pay, #rpc, #holders, #security (once SECURITY_PRIMARY says gullysecurity.xyz is its home), #studio. The
   old hashes of the features that moved (#chains, #chains/launch, #chain-kit, #deepcore) open the Gully Chain hand-off
   (Dashboard.tsx LEGACY). The sidebar groups every page id the dashboard knows; an id that is not listed here (a page
   added later) goes in the last group, so nothing ever disappears. */

export type ServiceTab = 'tracker' | 'ai' | 'score' | 'widgets' | 'telegram'

export const SERVICE_TABS: { id: ServiceTab; label: string; icon: LucideIcon }[] = [
  { id: 'tracker', label: 'Tracker', icon: ChartCandlestick },
  { id: 'ai', label: 'Gully AI', icon: Bot },
  { id: 'score', label: 'Gully Score', icon: Gauge },
  { id: 'widgets', label: 'Widgets', icon: AppWindow },
  { id: 'telegram', label: 'Telegram', icon: Send },
]

export const isServiceTab = (id: string): id is ServiceTab => SERVICE_TABS.some((s) => s.id === id)

/** The hand-off pages, one per product on its own domain. */
export type HandoffTab = 'chain' | 'pay' | 'rpc' | 'ipfs' | 'holders' | 'security' | 'studio'
export const HANDOFF_TABS: { id: HandoffTab; label: string; icon: LucideIcon; product: ProductKey }[] = [
  { id: 'chain', label: 'Gully Chain', icon: Network, product: 'chain' },
  { id: 'pay', label: 'Gully Pay', icon: CircleDollarSign, product: 'pay' },
  { id: 'rpc', label: 'Gully RPC', icon: Server, product: 'rpc' },
  { id: 'ipfs', label: 'Gully IPFS', icon: HardDrive, product: 'ipfs' },
  { id: 'holders', label: 'HolderMaps', icon: ScanSearch, product: 'holders' },
  { id: 'security', label: 'Gully Security', icon: ShieldCheck, product: 'security' },
  { id: 'studio', label: 'Gully Studio', icon: Gamepad2, product: 'studio' },
]
export const isHandoffTab = (id: string): id is HandoffTab => HANDOFF_TABS.some((s) => s.id === id)

export const NAV_GROUPS: { label: string; ids: string[] }[] = [
  { label: 'Workspace', ids: ['overview', 'activity', 'team', 'settings'] },
  { label: 'Services', ids: ['products', 'tracker', 'ai', 'score', 'widgets', 'telegram'] },
  { label: 'Tools', ids: ['keys', 'alerts', 'analytics'] },
  { label: 'Gully products', ids: ['chain', 'pay', 'rpc', 'ipfs', 'holders', 'security', 'studio'] },
  { label: 'Account', ids: ['billing'] },
]

/** Items in sidebar order, each tagged with its group; ids no group lists go in the last group. */
export function grouped<T extends { id: string }>(items: T[]): (T & { group: string })[] {
  const order = NAV_GROUPS.flatMap((g) => g.ids.map((id) => ({ id, group: g.label })))
  const known = order.flatMap((o) => {
    const it = items.find((i) => i.id === o.id)
    return it ? [{ ...it, group: o.group }] : []
  })
  const last = NAV_GROUPS[NAV_GROUPS.length - 1].label
  return [...known, ...items.filter((i) => !order.some((o) => o.id === i.id)).map((i) => ({ ...i, group: last }))]
}
