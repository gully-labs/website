import { isLocalHost, PAY_URL, SITE_URL } from '../../../site-host'
import type { PayAsset, Payment } from '../api'

/* Types for the Merchant tab: GET /api/developer/merchant and /stats (server/merchants.mjs). Every
   figure is the server's; nothing is priced or summed in the browser. */

export type WalletKind = 'eoa' | 'eoa-7702' | 'contract' | 'undeployed'

export interface MerchantWallet {
  chainId: number
  chain: string
  chainKey: string | null
  address: string
  declared: 'eoa' | 'contract'
  kind: WalletKind
  enabled: boolean
  status: 'ok' | 'not-deployed'
  checkedAt: string
  explorerUrl: string | null
}

export type LinkAmount = { type: 'fixed'; usd: string; usdCents: string } | { type: 'open'; min: string; max: string; minCents: string; maxCents: string }

export interface Checkout {
  enabled: boolean
  treasury: null
  paused?: boolean
  reason?: string
}

export interface MerchantLink {
  id: string
  title: string
  description: string | null
  amount: LinkAmount
  assets: PayAsset[]
  state: 'active' | 'inactive' | 'expired' | 'used-up'
  stateText: string | null
  expiresAt: string | null
  active: boolean
  maxUses: number | null
  paidUses: number
  lastPaidAt: string | null
  views: number
  path: string
  createdAt: string
  stats: { checkouts: number; paid: number; paidUsd: string }
  checkout: Checkout
}

export interface MerchantInvoice {
  id: string
  number: string
  title: string
  note: string | null
  items: { description: string; quantity: number; unitUsd: string; totalUsd: string }[]
  customer: { name: string | null; email?: string | null } | null
  usd: string
  usdCents: string
  status: 'open' | 'paid' | 'expired' | 'cancelled'
  overdue: boolean
  dueAt: string | null
  createdAt: string
  expiresAt: string
  paidAt: string | null
  cancelledAt: string | null
  payment: Payment | null
  views: number
  path: string
}

export interface Statement {
  id: string
  number: string
  periodStart: string
  periodEnd: string
  usd: string
  usdCents: string
  volumeUsd: number
  payments: number
  invoiceId: string
  payPath: string
  issuedAt: string
  dueAt: string
  paidAt: string | null
  state: 'open' | 'overdue' | 'paid' | 'waived'
}

export interface Fees {
  bps: number
  ratePct: number
  freeUsd: number
  lifetimeUsd: number
  freeLeftUsd: number
  accruedUsd: number
  /** Taken at payment time through Request Network's fee contract (wallet payments in a stablecoin). */
  collectedUsd: number
  collectedPayments: number
  /** On weekly statements (any state). */
  billedUsd: number
  unbilledUsd: number
  outstandingUsd: number
  paidUsd: number
  minStatementUsd: number
  pauseAfterDays: number
  nextStatementAt: string
  paused: boolean
  pausedSince: string | null
  statements: Statement[]
}

export interface Delivery {
  id: string
  eventId: string
  type: string
  test: boolean
  url: string
  state: 'pending' | 'delivered' | 'failed'
  attempts: number
  maxAttempts: number
  last: { at: string; status: number | null; ok: boolean; error: string | null; ms: number } | null
  createdAt: string
  invoiceId: string | null
  redeliveryOf: string | null
}

export interface MerchantView {
  role: string
  can: { manage: boolean; links: boolean; webhooks: boolean }
  nonCustodial: string
  terms: { version: string; path: string; accepted: { version: string; acceptedAt: string; acceptedBy: string } | null; current: boolean }
  profile: { name: string | null; displayName: string; logoUrl: string | null; logoSource: string | null; accent: string | null; supportEmail: string | null; website: string | null }
  wallets: MerchantWallet[]
  ready: boolean
  /** feeSplit: on this chain the Gully Pay fee is collected inside each stablecoin payment; otherwise it is invoiced weekly. */
  chains: { id: number; name: string; key: string; explorer: string; feeProxy: boolean; feeSplit: boolean }[]
  assets: PayAsset[]
  links: MerchantLink[]
  invoices: MerchantInvoice[]
  payments: (Payment & { invoiceNumber: string | null; linkId: string | null; feeUsd: number; feeCollectedUsd: number })[]
  webhook: { url: string; createdAt: string | null; rotatedAt: string | null } | null
  deliveries: Delivery[]
  fees: Fees
  checkoutOpen: boolean
}

export interface MerchantStats {
  range: '30d' | '90d' | '365d'
  days: number
  dates: string[]
  byChain: { name: string; data: number[] }[]
  byAsset: { name: string; data: number[] }[]
  count: number[]
  totals: { payments: number; volumeUsd: number; avgTicketUsd: number | null; opened: number; paid: number; conversion: number | null }
  topLinks: { id: string; title: string; views: number; checkouts: number; paid: number; volumeUsd: number }[]
  updatedAt: string
}

/** Where payers open checkouts: this host locally, pay.gullylabs.xyz everywhere else (never the portal host). */
export const payOrigin = () => (isLocalHost() ? window.location.origin : PAY_URL)
/** The main site (the merchant terms and other site pages live there, not on the pay host). */
export const siteOrigin = () => (isLocalHost() ? window.location.origin : SITE_URL)

export const usd = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }))

export const KIND_TEXT: Record<WalletKind, string> = {
  eoa: 'Wallet (EOA)',
  'eoa-7702': 'Wallet (EOA, EIP-7702 delegated)',
  contract: 'Contract (Safe or smart account), deployed',
  undeployed: 'Contract NOT deployed on this chain',
}

export const fmtWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—')
export const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')
