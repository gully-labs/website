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

export interface Account {
  address: string
  createdAt: string | null
  blocked: boolean
  limits: { anonymousPerMin: number; keyPerMin: number; maxKeys: number }
  keys: ApiKey[]
}

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
