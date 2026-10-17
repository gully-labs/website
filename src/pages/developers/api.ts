/* The developer dashboard's client for /api/developer/*. The session is an HttpOnly cookie the browser
   sends by itself; every POST carries X-Requested-With, which the server requires (CSRF guard). */

export type Result<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string }

export async function api<T = unknown>(path: string, opts: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<Result<T>> {
  const method = opts.method ?? 'GET'
  try {
    const r = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: method === 'POST' ? { 'content-type': 'application/json', 'x-requested-with': 'gully' } : {},
      body: method === 'POST' ? JSON.stringify(opts.body ?? {}) : undefined,
    })
    const data = await r.json().catch(() => null)
    if (!r.ok) return { ok: false, status: r.status, error: (data as { error?: string } | null)?.error ?? `The server answered ${r.status}.` }
    return { ok: true, status: r.status, data: data as T }
  } catch {
    return { ok: false, status: 0, error: 'The server could not be reached. Check your connection and try again.' }
  }
}

export interface ApiKey {
  id: string
  name: string
  prefix: string
  limit: number
  createdAt: string
  rotatedAt: string | null
  revokedAt: string | null
  lastUsed: string | null
}

export type PlanId = 'free' | 'pro' | 'business'

export interface Account {
  address: string
  createdAt: string | null
  blocked: boolean
  plan: { id: PlanId; name: string; expiresAt: string | null; source: 'payment' | 'admin' | null; alerts: number; historyDays: number }
  limits: { anonymousPerMin: number; keyPerMin: number; freeKeyPerMin: number; maxKeys: number }
  keys: ApiKey[]
}

/* ------------------------------------------------------------ plans & billing --- */

export interface Plan {
  id: PlanId
  name: string
  priceUsdc: number
  perMin: number
  alerts: number
  historyDays: number
  maxKeys: number
}

/** One accepted payment asset (server/payments.mjs). */
export interface PayAsset {
  id: string
  chainId: number
  chain: string
  chainKey: string
  symbol: string
  name: string
  kind: 'token' | 'native'
  address: string | null
  decimals: number
  confirmations: number
  explorer: string
  feed: { address: string; description: string } | null
}

/** GET /api/plans: the tiers, the accepted assets and whether they can be bought. Prices live only on the server. */
export interface Offer {
  currency: 'USD'
  chains: { id: number; name: string; key: string; explorer: string; confirmations: number }[]
  assets: PayAsset[]
  periodDays: number
  anonymous: { perMin: number; historyDays: number }
  plans: Plan[]
  checkout: { enabled: true; treasury: string } | { enabled: false; treasury: null; reason: string }
}

/** A 20-minute quote: the exact amount to send in one asset, for a plan or an invoice. */
export interface Quote {
  id: string
  kind: 'plan' | 'invoice'
  plan: PlanId | null
  invoiceId: string | null
  asset: { id: string; chainId: number; chain: string; symbol: string; kind: 'token' | 'native'; address: string | null; decimals: number }
  usd: string
  amount: string
  amountRaw: string
  minAmount: string
  treasury: string
  chainId: number
  token: string | null
  confirmations: number
  priceUsdc: number | null
  price: { feed: string; description: string; roundId: string; answer: string; updatedAt: string } | null
  createdAt: string
  expiresAt: string
}
export type Intent = Quote

export interface Payment {
  id: string | null
  kind: 'plan' | 'invoice'
  txHash: string
  chainId: number
  chain: string
  asset: string
  symbol: string
  amount: string
  usd: string | null
  from: string
  to: string | null
  blockNumber: number
  at: string
  txUrl: string | null
  price: { description: string; answer: string; updatedAt: string; roundId: string; feed: string } | null
  plan: PlanId | null
  periodStart: string | null
  expiresAt: string | null
  invoiceId: string | null
}

export interface BillingView {
  plan: Plan & { expiresAt: string | null; source: 'payment' | 'admin' | null; since: string | null }
  payments: Payment[]
  intents: Intent[]
  offer: Offer
}

/* -------------------------------------------------------------------- alerts --- */

export type AlertCondition = { type: 'gap'; pct: number } | { type: 'status'; status: 'premium' | 'discount' | 'either' }

export interface Delivery {
  id: string
  at: string
  test: boolean
  channel: 'webhook' | 'telegram'
  status: number | null
  ok: boolean
  error: string | null
  ms: number
  events: string[]
}

export interface GapAlert {
  id: string
  name: string | null
  chain: string | null
  ticker: string | null
  condition: AlertCondition
  webhook: { url: string } | null
  /** Telegram delivery to the account's linked chat; linked is false while no chat is linked. */
  telegram: { chatTitle: string | null; linked: boolean } | null
  enabled: boolean
  /** Set while muted from Telegram's "Mute 24h" button. */
  mutedUntil: string | null
  coveredByPlan: boolean
  armed: boolean
  waitingToReArm: string[]
  createdAt: string
  lastFiredAt: string | null
  deliveries: Delivery[]
}

export interface TelegramInfo {
  enabled: boolean
  bot: string | null
  linked: { chatType: 'private' | 'group' | 'supergroup'; chatTitle: string; linkedAt: string } | null
}

export interface TelegramLink {
  link: string
  groupLink: string
  expiresAt: string
}

/** GET /api/alerts/channels: which delivery channels the server offers. */
export interface AlertChannels {
  webhook: { enabled: boolean }
  telegram: { enabled: boolean; bot: string | null; reason?: string }
}

export interface AlertsView {
  alerts: GapAlert[]
  limits: { plan: PlanId; planName: string; max: number; used: number; cooldownMinutes: number; flagPct: number }
  telegram: TelegramInfo
  stocks: { chain: string; ticker: string; name: string }[]
}

export const conditionText = (c: AlertCondition) => (c.type === 'gap' ? `Gap ≥ ${c.pct}% either way` : c.status === 'either' ? 'Status premium or discount' : `Status ${c.status}`)

export const fmtUsd0 = (n: number) => n.toLocaleString('en-US')

export interface Totals {
  total: number
  ok: number
  client: number
  limited: number
  server: number
}

export interface UsagePoint {
  t: string
  total: number
  errors: number
  keys: Record<string, number>
}

export type Range = '24h' | '7d' | '30d'

export interface Usage {
  range: Range
  bucket: 'hour' | 'day'
  points: UsagePoint[]
  today: Totals
  last7d: Totals
  rangeTotals: Totals
  countingSince: string | null
  keys: { id: string; name: string; prefix: string; revoked: boolean }[]
}

export interface RecentRequest {
  keyId: string
  at: string
  method: string
  path: string
  status: number
  ms: number
  key: { name: string; prefix: string } | null
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—')

export function ago(iso: string | null): string {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86_400)}d ago`
}
