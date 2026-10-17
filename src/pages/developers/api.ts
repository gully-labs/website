/* The developer dashboard's client for /api/developer/*. The session is an HttpOnly cookie the browser
   sends by itself; every POST carries X-Requested-With, which the server requires (CSRF guard). */

/** Fired on window when a signed-in request answers 401. */
export const SESSION_ENDED = 'gully:session-ended'

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
    // A 401 on a signed-in route means the session cookie is gone (signed out in another tab, expired):
    // tell the page, which shows the sign-in screen instead of a wall of "Not signed in" errors.
    if (r.status === 401 && path.startsWith('/api/developer/') && typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_ENDED))
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
  analytics: { plans: AnalyticsPlan[]; trialDays: number; graceDays: number; periodDays: number }
  checkout: { enabled: true; treasury: string } | { enabled: false; treasury: null; reason: string }
}

/* ------------------------------------------------------------ Gully Analytics --- */

export type AnalyticsPlanId = 'trial' | 'starter' | 'growth'

/** A Gully Analytics plan (server/plans.mjs, ANALYTICS_PLANS). */
export interface AnalyticsPlan {
  id: AnalyticsPlanId
  name: string
  priceUsdc: number
  sites: number
  eventsPerMonth: number
}

export type AnalyticsBlock = 'gully-plan-lapsed' | 'gully-site-limit' | 'gully-quota-exceeded'

export interface AnalyticsSite {
  id: string
  name: string
  domain: string
  createdAt: string
  eventsThisMonth: number
  dashboardUrl: string
  blocked: AnalyticsBlock | null
}

export interface AnalyticsAccount {
  username: string
  createdAt: string
  state: 'trial' | 'active' | 'lapsed'
  plan: AnalyticsPlan | null
  expiresAt: string | null
  source: 'trial' | 'payment' | 'admin' | null
  lapsedAt: string | null
  readableUntil: string | null
  trialEndsAt: string
  lastPlan: { id: AnalyticsPlanId; name: string; expiresAt: string } | null
  month: string
  monthStart: string
  eventsThisMonth: number
  loginUrl: string
  sites: AnalyticsSite[]
}

/** GET /api/developer/analytics */
export interface AnalyticsView {
  configured: boolean
  trialAvailable: boolean
  account: AnalyticsAccount | null
  offer: Offer
  dashboardOrigin: string
  payments: Payment[]
  intents: Quote[]
}

/** GET /api/developer/analytics/usage: Umami's own figures for this month, per site. */
export interface AnalyticsUsage {
  from: string
  to: string
  sites: ({ id: string; ok: true; stats: { pageviews: number | null; visitors: number | null; visits: number | null; customEvents: number | null } } | { id: string; ok: false; error: string })[]
}

/** A 20-minute quote: the exact amount to send in one asset, for a plan or an invoice. */
export interface Quote {
  id: string
  kind: 'plan' | 'invoice' | 'analytics'
  plan: PlanId | AnalyticsPlanId | null
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
  kind: 'plan' | 'invoice' | 'analytics'
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
  plan: PlanId | AnalyticsPlanId | null
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
  /** Rate-limited (429) answers in the bucket; absent on servers older than the console portal. */
  limited?: number
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

/** Whole days from now until `iso` (0 when it is today or past), or null without a date. */
export function daysLeft(iso: string | null): number | null {
  if (!iso) return null
  return Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000))
}

export function ago(iso: string | null): string {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86_400)}d ago`
}

/* ------------------------------------------------------------ portal v2: workspaces --- */

export type Role = 'owner' | 'admin' | 'developer' | 'billing' | 'viewer'
export type MemberRole = Exclude<Role, 'owner'>

/** A workspace as the signed-in wallet sees it. The id is the owner's lower-case address. */
export interface WorkspaceRef {
  id: string
  name: string
  role: Role
  owner: string
}

export interface NotifySettings {
  telegramUsage: boolean
  telegramBilling: boolean
}

/** The signed-in wallet's own profile. ens and avatar come from a cached reverse lookup (ENS, then Basenames). */
export interface Profile {
  displayName: string | null
  email: string | null
  ens: string | null
  avatar: string | null
  notify: NotifySettings
}

/** Company details of the ACTIVE workspace (for invoices). */
export interface Company {
  name: string | null
  address: string | null
  taxId: string | null
}

export interface PendingInvite {
  id: string
  workspace: { id: string; name: string }
  role: MemberRole
  invitedBy: string
  expiresAt: string
}

/** GET /api/developer/me (with a session cookie). */
export interface Me {
  address: string
  profile: Profile
  company: Company
  workspaces: WorkspaceRef[]
  active: WorkspaceRef
  pendingInvites: PendingInvite[]
}

export interface TeamMember {
  address: string
  role: Role
  joinedAt: string | null
  invitedBy: string | null
  lastSeenAt: string | null
  you: boolean
}

export interface TeamInvite {
  id: string
  kind: 'link' | 'address'
  address?: string
  role: MemberRole
  createdBy: string
  createdAt: string
  expiresAt: string
}

/** GET /api/developer/team. members[0] is always the owner. */
export interface TeamView {
  workspace: WorkspaceRef
  members: TeamMember[]
  invites: TeamInvite[]
  limits: { maxMembers: number; maxOpenInvites: number; inviteDays: number }
}

/** POST /api/developer/team/invite. `link` is present only for a link invite and is shown once. */
export interface InviteCreated {
  invite: TeamInvite
  link?: string
}

/** GET /api/developer/invite/:token (public). */
export interface InvitePreview {
  workspace: { name: string }
  role: MemberRole
  invitedBy: string
  expiresAt: string
  valid: boolean
  state: 'open' | 'accepted' | 'revoked' | 'expired'
}

/** POST /api/developer/invite/accept. The session switches to the joined workspace. */
export interface InviteAccepted {
  workspace: WorkspaceRef
  active: WorkspaceRef
}

/** GET /api/developer/sessions. `id` is a hash safe to show; revoke with it, or with 'others'. */
export interface SessionInfo {
  id: string
  device: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  current: boolean
}

export type ActivityAction =
  | 'key.created' | 'key.renamed' | 'key.rotated' | 'key.revoked' | 'key.linked'
  | 'alert.created' | 'alert.updated' | 'alert.deleted' | 'alert.tested'
  | 'telegram.linked' | 'telegram.unlinked'
  | 'analytics.trial' | 'analytics.site_added' | 'analytics.site_removed' | 'analytics.password_reset' | 'analytics.quote' | 'analytics.plan'
  | 'billing.quote' | 'billing.paid'
  | 'team.invited' | 'team.invite_revoked' | 'team.joined' | 'team.role_changed' | 'team.removed' | 'team.left' | 'workspace.renamed'
  | 'company.updated' | 'profile.updated' | 'sessions.revoked'
  | 'usage.threshold'

export interface ActivityEvent {
  id: string
  at: string
  /** The wallet that acted, or 'system'. */
  actor: string
  action: ActivityAction
  target: string | null
  detail: Record<string, string | number | boolean | null | string[]> | null
}

/** GET /api/developer/activity?cursor=. Pass nextCursor back as cursor for the next (older) page. */
export interface ActivityPage {
  workspace: { id: string }
  events: ActivityEvent[]
  nextCursor: string | null
}

export type Endpoint = '/api/tracker' | '/api/tracker/history' | '/api/tracker/movers' | '/api/plans' | 'other'

/** GET /api/developer/usage on a portal v2 server: Usage plus these. Unknown figures are null, never 0. */
export interface UsageV2 extends Usage {
  previous: (Totals & { from: string; to: string }) | null
  byStatus: { ok: number; client: number; limited: number; server: number } | null
  byEndpoint: { endpoint: Endpoint; count: number }[] | null
  endpointsSince: string | null
}

/** A refused write: 403 with code 'forbidden-role'. */
export interface RoleError {
  error: string
  code: 'forbidden-role'
}
