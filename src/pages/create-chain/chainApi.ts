import { api } from '../developers/api'

/* Create a chain: the types and calls shared by the wizard and the order page (server/chain-orders.mjs). */

export type Delivery = 'team' | 'automatic'

/** One item of the standard bundle or an add-on (server/chains-plans.mjs BUNDLE). */
export interface Addon {
  id: string
  name: string
  icon: string
  body: string
  delivery: Delivery
  status: 'available' | 'planned'
  testnetOnly: boolean
  fee: string | null
  billing: string | null
}

/** How a line is delivered, in the words the page uses. */
export const deliveryLabel = (d: Delivery | undefined) => (d === 'automatic' ? 'Automatic' : 'Set up by our team')

export interface Offer {
  flags: { testnetOrders: boolean; mainnetOrders: boolean }
  checkout: { enabled: boolean; mode: 'test' | 'live' }
  freeDays: number
  setupDays: number
  included: Addon[]
  addons: Addon[]
  parents: Record<Tier, { id: number; name: string }[]>
  gasTokens: { id: string; name: string }[]
  billing: { model: string; note: string }
  licenceNote: string
}

export type Tier = 'testnet' | 'mainnet'

export interface QuoteLine {
  id: string
  name: string
  usd: number | null
  fee: string | null
  billing?: string | null
  delivery?: Delivery
}

export interface Quote {
  tier: Tier
  included?: QuoteLine[]
  addons: QuoteLine[]
  dueCents: number
  testCharge: boolean
  freeDays: number
  setupDays?: number
  priceConfirmed?: boolean
  monthlyUsd: number | null
  sequencerProfitPct: number | null
  daAtCost: boolean
  priceWithUs: boolean
  headline: string
  after: string
}

export type OrderStatus = 'awaiting_payment' | 'paid' | 'setting_up' | 'live' | 'cancelled'

export interface Order {
  id: string
  status: OrderStatus
  statusLabel: string
  tier: Tier
  name: string
  chainId: number
  gasToken: string
  gasSymbol: string
  parent: { id: number; name: string }
  quote: Quote
  logo: string | null
  email: string | null
  createdAt: string
  paidAt: string | null
  history: { at: string; status: OrderStatus; note: string | null }[]
  payment: { mode: 'test' | 'live'; testCharge: boolean; dueCents: number; lastError: string | null; sessionOpen: boolean; onHold: boolean }
  /** The Chain Kit pipeline's log of its current run; null until it first reports. */
  provisioning?: Provisioning | null
  /** Testnet: renewal billing through Gully Pay (30 days free, then monthly). null on mainnet. */
  renewal?: Renewal | null
  /** The chain's export from the Chain Kit pipeline, once it has uploaded one. */
  export?: { ready: true; bytes: number; updatedAt: string } | null
}

export type Renewal =
  | { state: 'not-set-up' }
  | { state: 'ready'; status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'unknown'; payUrl: string | null; trialEndsAt: string | null; currentPeriodEnd: string | null; dueSince: string | null; graceEndsAt: string | null; cancelledAt: string | null }

export type StepState = 'pending' | 'running' | 'done' | 'failed' | 'waiting' | 'skipped'

export interface ProvisioningStep {
  id: string
  title: string
  state: StepState
  startedAt: string | null
  endedAt: string | null
  note: string | null
  links: { label: string; url: string }[]
}

export type EndpointKey = 'rpc' | 'explorer' | 'bridge' | 'faucet' | 'multisig' | 'bundler'

export interface Provisioning {
  runId: string
  seq: number
  steps: ProvisioningStep[]
  endpoints: Partial<Record<EndpointKey, string>> | null
  updatedAt: string
}

export const TALK_TO_US = 'https://gullylabs.xyz/services#contact'

export const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const getOffer = () => api<Offer>('/api/chain-orders/offer')
export const getQuote = (tier: Tier, addons: string[]) => api<{ quote: Quote }>(`/api/chain-orders/quote?tier=${tier}&addons=${encodeURIComponent(addons.join(','))}`)
/** Mainnet: records an email to tell when it opens. */
export const notifyMainnet = (email: string) => api<{ ok: boolean; already?: boolean }>('/api/chain-orders/notify', { method: 'POST', body: { email } })
export const checkChainId = (id: string) => api<{ free: boolean; reason?: string }>(`/api/chain-orders/check?chainId=${encodeURIComponent(id)}`)
export const getOrder = (id: string) => api<{ order: Order }>(`/api/chain-orders/${encodeURIComponent(id)}`)
export const startCheckout = (id: string) => api<{ payUrl: string }>(`/api/chain-orders/${encodeURIComponent(id)}/checkout`, { method: 'POST' })
/** The export download (a plain link: the session cookie is the auth). */
export const exportUrl = (id: string) => `/api/chain-orders/${encodeURIComponent(id)}/export`
export const cancelOrder = (id: string) => api<{ order: Order }>(`/api/chain-orders/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
/** True when this browser holds a Sign in with Gully ID session (a wallet session is not enough here). */
export const hasGullySession = async () => {
  const r = await api<{ gullyId: boolean }>('/api/chain-orders/session')
  return r.ok && r.data.gullyId
}
/** Trades a Gully ID access token for the session cookie. */
export const gullyExchange = (accessToken: string) => api('/api/developer/gully', { method: 'POST', body: { accessToken } })
