import { isLocalHost, PAY_URL } from '../../site-host'
import type { PayAsset, Payment, Quote as BaseQuote, Result } from '../developers/api'

/* Types and a small fetch helper for the public Gully Pay pages (/pay/<invoice>, /pay/l/<link>).
   Everything shown is read from the server; nothing is priced in the browser. */

export type { PayAsset, Payment, Result }

/** A quote as /api/pay/:id/quote answers it, with its EIP-681 wallet link for the exact amount. */
export type Quote = BaseQuote & { uri: string }

export type Checkout = { enabled: true; treasury: string } | { enabled: false; treasury: null; reason: string }

export type LinkState = 'active' | 'inactive' | 'expired' | 'used-up'

/** GET /api/pay/l/:id (server/paylinks.mjs). */
export interface PayLink {
  id: string
  title: string
  description: string | null
  amount: { type: 'fixed'; usd: string; usdCents: string } | { type: 'open'; min: string; max: string; minCents: string; maxCents: string }
  assets: PayAsset[]
  state: LinkState
  stateText: string | null
  expiresAt: string | null
  checkout: Checkout
}

/** Public POSTs carry X-Requested-With, which the server requires. */
export async function payApi<T = unknown>(path: string, opts: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<Result<T>> {
  const method = opts.method ?? 'GET'
  try {
    const r = await fetch(path, {
      method,
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

/** The origin payers open links on: pay.gullylabs.xyz in production (the admin host links to it), this origin in development. */
export const siteOrigin = () => (isLocalHost() ? window.location.origin : PAY_URL)
