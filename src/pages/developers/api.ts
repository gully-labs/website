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

/** GET /api/plans: the tiers and whether they can be bought. Prices live only on the server. */
export interface Offer {
  currency: 'USDC'
  chain: { id: number; name: string }
  token: { address: string; symbol: string; decimals: number }
  periodDays: number
  anonymous: { perMin: number; historyDays: number }
  plans: Plan[]
  checkout: { enabled: true; treasury: string; minConfirmations: number } | { enabled: false; treasury: null; reason: string }
}

export interface Intent {
  id: string
  plan: PlanId
  amount: string
  amountRaw: string
  priceUsdc: number
  treasury: string
  token: string
  chainId: number
  createdAt: string
  expiresAt: string
}

export interface Payment {
  txHash: string
  plan: PlanId
  amount: string
  from: string
  blockNumber: number
  at: string
  periodStart: string
  expiresAt: string
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
  telegram: { chatId: string } | null
  enabled: boolean
  coveredByPlan: boolean
  armed: boolean
  waitingToReArm: string[]
  createdAt: string
  lastFiredAt: string | null
  deliveries: Delivery[]
}

export interface AlertsView {
  alerts: GapAlert[]
  limits: { plan: PlanId; planName: string; max: number; used: number; cooldownMinutes: number; flagPct: number }
  telegram: { enabled: boolean; bot: string | null }
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
