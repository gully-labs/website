/* Admin calls for the Gully Pay sections (PayLinks.tsx, the invoices' webhooks in AdminPage.tsx). */

export type AdminResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** One admin call with the bearer token: GET without a body, POST with one. */
export async function adminCall<T = Record<string, unknown>>(token: string, path: string, body?: unknown, method?: 'GET' | 'POST'): Promise<AdminResult<T>> {
  const m = method ?? (body === undefined ? 'GET' : 'POST')
  const r = await fetch(path, { method: m, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: m === 'POST' ? JSON.stringify(body ?? {}) : undefined }).catch(() => null)
  const d = r ? await r.json().catch(() => null) : null
  return r?.ok ? { ok: true, data: d as T } : { ok: false, error: d?.error ?? 'The server could not be reached.' }
}
