import type { LucideIcon } from 'lucide-react'
import { Activity, Bell, Boxes, Building2, ChartColumn, CircleDollarSign, ClipboardList, CreditCard, HardDrive, HeartPulse, Inbox, KeyRound, LayoutDashboard, Send, Shield, Sparkles, Users, Wallet } from 'lucide-react'

/* The admin page's section nav: one chip per section, with its icon. It sits in the sticky header, scrolls
   sideways on a phone, and marks the section in view (aria-current). Each section is a wrapper with the
   id below and a scroll margin so its heading clears the header. */

export const ADMIN_SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'health', label: 'Health', icon: HeartPulse },
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'revenue', label: 'Revenue', icon: CircleDollarSign },
  { id: 'traffic', label: 'Traffic', icon: Activity },
  { id: 'developers', label: 'Developers', icon: Users },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'workspaces', label: 'Workspaces', icon: Building2 },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'telegram', label: 'Telegram', icon: Send },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'pay', label: 'Gully Pay', icon: Wallet },
  { id: 'analytics', label: 'Analytics', icon: ChartColumn },
  { id: 'chainorders', label: 'Chain orders', icon: ClipboardList },
  { id: 'ipfs', label: 'IPFS review', icon: HardDrive },
  { id: 'chainkit', label: 'Chain Kit', icon: Boxes },
  { id: 'integrations', label: 'Integrations', icon: KeyRound },
  { id: 'inbox', label: 'Enquiries', icon: Inbox },
  { id: 'ai', label: 'Gully AI', icon: Sparkles },
]

/** The wrapper class every section uses, so a jump lands below the sticky header. */
export const sectionCls = 'flex min-w-0 scroll-mt-[190px] flex-col gap-5 max-[860px]:scroll-mt-[230px]'
