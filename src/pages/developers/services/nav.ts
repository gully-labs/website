import { AppWindow, Blocks, Bot, ChartCandlestick, CircleDollarSign, Rocket, ScanSearch, Send, type LucideIcon } from 'lucide-react'

/* The app's service pages (each a lazy chunk, ServiceView.tsx) and the sidebar's groups.

   Service pages are deep-linkable by hash like the other pages: #tracker, #pay, #chain-kit, #ai,
   #deepcore, #holders, #widgets, #telegram. Security (security/SecurityTab.tsx) sits under Services too. The sidebar groups every page id the dashboard knows; an id that is
   not listed here (a page added later) goes in the last group, so nothing ever disappears. 'merchant'
   is listed under Services right after Gully Pay for the Merchants page (feat/pay-merchants): it shows
   there as soon as Dashboard.tsx has that tab, and is skipped until then. */

export type ServiceTab = 'tracker' | 'pay' | 'chain-kit' | 'ai' | 'deepcore' | 'holders' | 'widgets' | 'telegram'

export const SERVICE_TABS: { id: ServiceTab; label: string; icon: LucideIcon }[] = [
  { id: 'tracker', label: 'Tracker', icon: ChartCandlestick },
  { id: 'pay', label: 'Gully Pay', icon: CircleDollarSign },
  { id: 'chain-kit', label: 'Chain Kit', icon: Blocks },
  { id: 'ai', label: 'Gully AI', icon: Bot },
  { id: 'deepcore', label: 'DeepCore launches', icon: Rocket },
  { id: 'holders', label: 'Holder Map', icon: ScanSearch },
  { id: 'widgets', label: 'Widgets', icon: AppWindow },
  { id: 'telegram', label: 'Telegram', icon: Send },
]

export const isServiceTab = (id: string): id is ServiceTab => SERVICE_TABS.some((s) => s.id === id)

export const NAV_GROUPS: { label: string; ids: string[] }[] = [
  { label: 'Workspace', ids: ['overview', 'activity', 'team', 'settings'] },
  { label: 'Services', ids: ['products', 'tracker', 'pay', 'merchant', 'security', 'chain-kit', 'ai', 'deepcore', 'holders', 'widgets', 'telegram'] },
  { label: 'Developer', ids: ['keys', 'alerts', 'analytics'] },
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
