import { api } from '../developers/api'

/* Create a chain: the types and calls shared by the wizard and the order page (server/chain-orders.mjs). */

export interface Addon {
  id: string
  name: string
  icon: string
  body: string
  standard: boolean
  testnetOnly: boolean
  fee: string | null
}

export interface Offer {
  flags: { testnetOrders: boolean; mainnetOrders: boolean }
  checkout: { enabled: boolean; mode: 'test' | 'live' }
  freeDays: number
  addons: Addon[]
  parents: Record<Tier, { id: number; name: string }[]>
  gasTokens: { id: string; name: string }[]
  billing: { model: string; note: string }
  licenceNote: string
}

export type Tier = 'testnet' | 'mainnet'

export interface Quote {
  tier: Tier
  addons: { id: string; name: string; usd: number | null; fee: string | null }[]
  dueCents: number
  testCharge: boolean
  freeDays: number
  monthlyUsd: number
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
  history: { at: string; status: OrderStatus; by: string; note: string | null }[]
  payment: { mode: 'test' | 'live'; testCharge: boolean; dueCents: number; lastError: string | null; sessionOpen: boolean; onHold: boolean }
}

export const TALK_TO_US = 'https://gullylabs.xyz/services#contact'

export const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const getOffer = () => api<Offer>('/api/chain-orders/offer')
export const getQuote = (tier: Tier, addons: string[]) => api<{ quote: Quote }>(`/api/chain-orders/quote?tier=${tier}&addons=${encodeURIComponent(addons.join(','))}`)
export const checkChainId = (id: string) => api<{ free: boolean; reason?: string }>(`/api/chain-orders/check?chainId=${encodeURIComponent(id)}`)
export const getOrder = (id: string) => api<{ order: Order }>(`/api/chain-orders/${encodeURIComponent(id)}`)
export const startCheckout = (id: string) => api<{ payUrl: string }>(`/api/chain-orders/${encodeURIComponent(id)}/checkout`, { method: 'POST' })
export const cancelOrder = (id: string) => api<{ order: Order }>(`/api/chain-orders/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
/** True when this browser holds a Sign in with Gully ID session (a wallet session is not enough here). */
export const hasGullySession = async () => {
  const r = await api<{ gullyId: boolean }>('/api/chain-orders/session')
  return r.ok && r.data.gullyId
}
/** Trades a Gully ID access token for the session cookie. */
export const gullyExchange = (accessToken: string) => api('/api/developer/gully', { method: 'POST', body: { accessToken } })
