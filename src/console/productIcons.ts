/* One Lucide icon per Gully product, for every menu that lists the products (the header's Menu sheet, the footer's
   product lists). Record<Slug, …> so a new product in terminal/catalog.ts does not compile until it has an icon. */
import { ArrowLeftRight, Boxes, Copy, CreditCard, FingerprintPattern, Gamepad2, Gift, HardDrive, Map as MapIcon, Play, Radar, Rocket, Server, ShieldCheck, Sparkles, Trophy, Users, Vault, type LucideIcon } from 'lucide-react'
import type { Slug } from '../terminal/catalog'

export const PRODUCT_ICON: Record<Slug, LucideIcon> = {
  'gully-id': FingerprintPattern,
  chain: Boxes,
  street: Play,
  bridge: ArrowLeftRight,
  safe: Vault,
  'gully-sentry': Radar,
  pay: CreditCard,
  rpc: Server,
  holders: MapIcon,
  security: ShieldCheck,
  ai: Sparkles,
  studio: Gamepad2,
  ipfs: HardDrive,
  quests: Trophy,
  offerwall: Gift,
  'gully-social': Users,
  'copy-trading': Copy,
  'gully-core': Rocket,
}
