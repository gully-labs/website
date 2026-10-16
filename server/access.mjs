// Public API access control: who may call /api/tracker*, and how often.
// OWNED BY THE DEVELOPER-DASHBOARD WORK. This stub allows everything so the rest of the site runs.
//
// Contract (server.mjs relies on it):
//   apiAccess(req) -> { ok: true, keyId: string | null, limit: number, remaining: number }
//                   | { ok: false, status: number, error: string, retryAfter?: number }
//   It is called on every /api/tracker* request that reaches the origin and must be fast (in memory).

export function apiAccess() {
  return { ok: true, keyId: null, limit: 0, remaining: 0 }
}

/** For the admin dashboard: a snapshot of API traffic. */
export function accessStats() {
  return { since: null, anonymous: { requests: 0, limited: 0 }, keys: [] }
}
