import { APP_URL, isLocalHost } from '../../site-host'
import type { PayLink } from './api'

/* What the standalone checkout knows about who is being paid, and the small helpers its pages share
   (kept out of the component files so fast refresh stays whole). */

export interface Brand {
  name: string
  /** False until the merchant sets a store name (the server then still fills `name` with a fallback). */
  named: boolean
  /** The owner's short address, shown as a chip when the store has no name. */
  ownerShort: string
  logoUrl: string | null
  accent: string | null
  supportEmail: string | null
  website: string | null
  /** Our own invoices and pay links: the kit lockup instead of a store logo. */
  gully?: boolean
}

export const GULLY_BRAND: Brand = { name: 'Gully Labs', named: true, ownerShort: '', logoUrl: null, accent: null, supportEmail: 'hello@gullylabs.xyz', website: 'https://gullylabs.xyz', gully: true }

/** The store as the page names it: its name, or "Store" until the merchant sets one. */
export const storeName = (b: Brand) => (b.named ? b.name : 'Store')

/** What the server adds for a signed-in member of the store: the role and what to fix in the Merchant tab. */
export interface Viewer {
  role: string
  fixes: { id: string; text: string }[]
}

/** The Merchant tab in the app, at the section to fix (locally the app lives at /developers). */
export const merchantTabUrl = (section?: string) => `${isLocalHost() ? '/developers' : `${APP_URL}/`}#${section ? `merchant/${section}` : 'merchant'}`

/* ------------------------------------------------------------ accent --- */

const BG = [13, 20, 28] // #0d141c
const INK = [244, 242, 236] // #f4f2ec
const GOLD = '#d9b563'

const lum = ([r, g, b]: number[]) => {
  const f = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrast = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

export interface Accent {
  /** The colour for rules, eyebrows and the top border: at least 3:1 against the page, else the kit gold. */
  color: string
  /** The primary button fill and the text on it: at least 4.5:1 between them, else gold on ink. */
  fill: string
  onFill: string
  /** True when the merchant's own colour is in use (false: it failed contrast and gold stands in). */
  own: boolean
}

/** The store's accent where it keeps WCAG contrast against the page; the kit gold where it would not. */
export function accentOf(b: Brand | null | undefined): Accent {
  const hex = b?.accent && /^#[0-9a-f]{6}$/i.test(b.accent) ? b.accent.toLowerCase() : null
  const fallback: Accent = { color: GOLD, fill: GOLD, onFill: '#0d141c', own: false }
  if (!hex || b?.gully) return fallback
  const c = rgb(hex)
  if (contrast(c, BG) < 3) return fallback
  const onFill = contrast(c, BG) >= contrast(c, INK) ? '#0d141c' : '#f4f2ec'
  const fillOk = Math.max(contrast(c, BG), contrast(c, INK)) >= 4.5
  return { color: hex, fill: fillOk ? hex : GOLD, onFill: fillOk ? onFill : '#0d141c', own: true }
}

/* ------------------------------------------------------------- pills --- */

export const pills = {
  waiting: { text: 'Awaiting payment', cls: 'border-line-strong text-ink-2' },
  confirming: { text: 'Confirming', cls: 'border-gold-line bg-[rgba(217,181,99,.12)] text-gold' },
  paid: { text: 'Paid', cls: 'border-success-line bg-success-bg text-green' },
  expired: { text: 'Expired', cls: 'border-line-strong text-muted' },
  cancelled: { text: 'Cancelled', cls: 'border-line-strong text-muted' },
  closed: { text: 'Unavailable', cls: 'border-line-strong text-muted' },
  paused: { text: 'Paused', cls: 'border-[#5a2a24] text-error' },
  overdue: { text: 'Overdue', cls: 'border-[#5a2a24] text-error' },
  link: { text: 'Pay link', cls: 'border-gold-line bg-[rgba(217,181,99,.12)] text-gold' },
} as const

/** A pay link as one order line: its title, once, at its price (or its range when the payer chooses). */
export function linkItems(link: Pick<PayLink, 'title' | 'amount'>) {
  const usd = link.amount.type === 'fixed' ? link.amount.usd : `${link.amount.min} – ${link.amount.max}`
  return [{ description: link.title, quantity: 1, unitUsd: usd, totalUsd: usd }]
}
