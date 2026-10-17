// A small server-side client for the Gully Analytics (Umami 3.4 fork) REST API, signed in as its admin.
// The admin password (ANALYTICS_ADMIN_PASSWORD) never leaves this process: no page or API answer
// carries it or the admin token. Unset, self-serve analytics is off and says so.
//
// Endpoints used, as the fork defines them (gully-labs/umami, src/app/api/...):
//   POST   /api/auth/login              { username, password } -> { token, user }
//   POST   /api/users                   { username, password, role: 'user' } -> user   (admin only)
//   POST   /api/users/:id               { password } -> user                          (admin may update anyone)
//   DELETE /api/users/:id               soft-deletes the user and its websites, deletes their events
//   POST   /api/websites                { name, domain } -> website, owned by the CALLER (userId = token's user)
//   POST   /api/websites/:id/transfer   { userId } -> website                         (admin may transfer any)
//   DELETE /api/websites/:id
//   GET    /api/websites/:id/stats?startAt&endAt         -> { pageviews, visitors, visits, bounces, totaltime, comparison }
//   GET    /api/websites/:id/events/stats?startAt&endAt  -> { events, visitors, visits, uniqueEvents, comparison }
// Every call carries `Authorization: Bearer <token>`.

const TIMEOUT_MS = 10_000

export const upstream = () => String(process.env.ANALYTICS_UPSTREAM ?? 'http://gully-analytics:3000').replace(/\/+$/, '')
const adminUser = () => String(process.env.ANALYTICS_ADMIN_USERNAME ?? 'admin')
const adminPassword = () => String(process.env.ANALYTICS_ADMIN_PASSWORD ?? '')

/** Whether the server can create analytics accounts at all. */
export const umamiConfigured = () => adminPassword().length > 0

let token = null

async function raw(method, path, body, auth) {
  try {
    const r = await fetch(upstream() + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = await r.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = null
    }
    return { ok: r.ok, status: r.status, data }
  } catch (e) {
    return { ok: false, status: 0, data: null, error: String(e?.message ?? e) }
  }
}

async function login() {
  const r = await raw('POST', '/api/auth/login', { username: adminUser(), password: adminPassword() })
  if (r.ok && typeof r.data?.token === 'string') {
    token = r.data.token
    return true
  }
  token = null
  return false
}

const unreachable = { ok: false, status: 502, error: 'Gully Analytics could not be reached. Try again in a minute.' }
const notConfigured = { ok: false, status: 503, error: 'Self-serve Gully Analytics is not switched on yet on this server.' }

/** One admin call. Signs in when needed and once more when the token was refused. */
async function call(method, path, body) {
  if (!umamiConfigured()) return notConfigured
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!token && !(await login())) return { ...unreachable, error: 'Gully Analytics refused the server’s admin sign-in. Write to hello@gullylabs.xyz.' }
    const r = await raw(method, path, body, token)
    if (r.status === 401 && attempt === 0) {
      token = null
      continue
    }
    if (r.status === 0) return unreachable
    if (!r.ok) return { ok: false, status: r.status >= 500 ? 502 : r.status, error: r.data?.error?.message ?? `Gully Analytics answered ${r.status}.` }
    return { ok: true, status: r.status, data: r.data }
  }
  return unreachable
}

/** Creates a user with role 'user'. A taken username answers { ok: false, taken: true }. */
export async function createUser(username, password) {
  const r = await call('POST', '/api/users', { username, password, role: 'user' })
  if (!r.ok && r.status === 400 && /exists/i.test(r.error)) return { ...r, taken: true }
  return r.ok ? { ok: true, user: r.data } : r
}

export const setPassword = (userId, password) => call('POST', `/api/users/${encodeURIComponent(userId)}`, { password })
export const deleteUser = (userId) => call('DELETE', `/api/users/${encodeURIComponent(userId)}`)
export const deleteWebsite = (id) => call('DELETE', `/api/websites/${encodeURIComponent(id)}`)

/**
 * A website owned by `userId`. Umami gives a new website to whoever creates it, so the admin creates it
 * and transfers it to the user; if the transfer fails the half-made website is removed again.
 */
export async function createWebsiteFor(userId, name, domain) {
  const c = await call('POST', '/api/websites', { name, domain })
  if (!c.ok) return c
  const id = c.data?.id
  if (typeof id !== 'string') return { ok: false, status: 502, error: 'Gully Analytics did not return the new website.' }
  const t = await call('POST', `/api/websites/${encodeURIComponent(id)}/transfer`, { userId })
  if (!t.ok) {
    await deleteWebsite(id)
    return t
  }
  return { ok: true, website: { id, name: c.data.name ?? name, domain: c.data.domain ?? domain } }
}

/** Umami's own figures for a website between two instants: page views, visitors, visits and custom events. */
export async function websiteStats(id, startAt, endAt) {
  const q = `startAt=${startAt}&endAt=${endAt}`
  const [s, e] = await Promise.all([call('GET', `/api/websites/${encodeURIComponent(id)}/stats?${q}`), call('GET', `/api/websites/${encodeURIComponent(id)}/events/stats?${q}`)])
  if (!s.ok) return s
  const n = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))
  return { ok: true, stats: { pageviews: n(s.data?.pageviews), visitors: n(s.data?.visitors), visits: n(s.data?.visits), customEvents: e.ok ? n(e.data?.events) : null } }
}

/** Tests only: forget the cached admin token. */
export const resetUmamiForTest = () => {
  token = null
}
