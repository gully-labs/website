// The landing's cross-origin sources, read server-side (landing "Constellation", owner pick 2026-10-27).
// The browser cannot read these from gullylabs.xyz: Gully Pay and Gully RPC send no CORS header for this origin, and
// one cached read here serves every visitor instead of each browser polling five hosts.
//
//   GET /api/hub/live   public, cached 45 s:
//     id     Gully ID aggregate sign-in stats (gullyid.xyz/v1/stats/public: counts only, no personal data)
//     pay    Gully Pay service states (gullypay.xyz/api/status)
//     rpc    Gully RPC live / beta / coming-soon per feature and chain (gullyrpc.xyz/status.json)
//     head   Gully Chain latest block (indexer /head)
//     feed   Gully Chain newest on-chain events (indexer /feed, 12 items)
//
// Nothing is invented: a source that cannot be read is null (and named in `unread`), never a zero.

const TTL = 45_000
const TIMEOUT = 6_000
const UA = 'GullyLabs-Hub/1 (+https://gullylabs.xyz/)'
const env = (k, d) => String(process.env[k] ?? d).replace(/\/+$/, '')
const SOURCES = {
  id: () => `${env('GULLY_ID_URL', 'https://gullyid.xyz')}/v1/stats/public`,
  pay: () => `${env('GULLYPAY_URL', 'https://gullypay.xyz')}/api/status`,
  rpc: () => `${env('GULLYRPC_SITE_URL', 'https://gullyrpc.xyz')}/status.json`,
  head: () => `${env('GULLY_INDEXER', 'https://indexer.gullychain.xyz')}/head`,
  feed: () => `${env('GULLY_INDEXER', 'https://indexer.gullychain.xyz')}/feed?limit=12`,
}

let fetchFn = (...a) => globalThis.fetch(...a)
let cache = null
let inflight = null

async function getJson(url) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    const r = await fetchFn(url, { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': UA } })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

/** Keeps only what the landing shows from each source (and drops anything malformed to null). */
export function shape(key, j) {
  if (!j || typeof j !== 'object') return null
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  if (key === 'id') {
    if (!j.totals) return null
    return {
      generatedAt: j.generatedAt ?? null,
      totals: { users: n(j.totals.users), passkeys: n(j.totals.passkeys), wallets: n(j.totals.wallets), apps: n(j.totals.apps) },
      signins24h: n(j.signins24h),
      appsActive30d: n(j.appsActive30d),
      hourly: Array.isArray(j.hourly) ? j.hourly.map((h) => ({ hour: String(h.hour), n: n(h.n) ?? 0 })) : [],
      dailySignins: Array.isArray(j.dailySignins) ? j.dailySignins.map((h) => ({ day: String(h.day), n: n(h.n) ?? 0 })) : [],
      methods30d: j.methods30d && typeof j.methods30d === 'object' ? Object.fromEntries(Object.entries(j.methods30d).map(([k, v]) => [k, n(v) ?? 0])) : null,
      recent: Array.isArray(j.recent) ? j.recent.slice(0, 10).map((r) => ({ at: String(r.at), method: String(r.method) })) : [],
    }
  }
  if (key === 'pay') {
    if (!j.services || typeof j.services !== 'object') return null
    return { status: String(j.status ?? ''), services: Object.fromEntries(Object.entries(j.services).map(([k, v]) => [k, String(v)])), incidents: Array.isArray(j.incidents) ? j.incidents.length : 0 }
  }
  if (key === 'rpc') {
    if (!Array.isArray(j.features)) return null
    return {
      updated: j.updated ?? null,
      features: j.features.map((f) => ({ key: String(f.key), name: String(f.name), status: String(f.status) })),
      chains: Array.isArray(j.chains) ? j.chains.map((c) => ({ name: String(c.name), chainId: n(c.chainId), status: String(c.status) })) : [],
    }
  }
  if (key === 'head') return n(j.block) == null ? null : { block: n(j.block), timestamp: n(j.timestamp) }
  if (key === 'feed') {
    if (!Array.isArray(j.items)) return null
    return { items: j.items.slice(0, 12).map((f) => ({ id: String(f.id), kind: String(f.kind), block: String(f.block), timestamp: String(f.timestamp), txHash: /^0x[0-9a-fA-F]{64}$/.test(f.txHash) ? f.txHash : null })) }
  }
  return null
}

async function read() {
  const keys = Object.keys(SOURCES)
  const got = await Promise.all(keys.map((k) => getJson(SOURCES[k]()).then((j) => shape(k, j))))
  const body = { generatedAt: new Date().toISOString(), unread: [] }
  keys.forEach((k, i) => {
    body[k] = got[i]
    if (got[i] == null) body.unread.push(k)
  })
  return body
}

export async function hubLive() {
  if (cache && Date.now() - cache.at < TTL) return cache.body
  inflight ??= read()
    .then((body) => {
      // a source that failed this round keeps its last good reading (it is still named in `unread`)
      if (cache) for (const k of body.unread) if (cache.body[k] != null) body[k] = cache.body[k]
      cache = { at: Date.now(), body }
      return body
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

export async function handleHubLive(req, res, url, send) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, JSON.stringify({ error: 'GET only' }), { 'Content-Type': 'application/json', Allow: 'GET' })
  const body = await hubLive()
  send(res, 200, JSON.stringify(body), { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30', 'Access-Control-Allow-Origin': '*' })
}

/** Tests: swap fetch and drop the cache. */
export function _resetHubLive(fn) {
  fetchFn = fn ?? ((...a) => globalThis.fetch(...a))
  cache = null
  inflight = null
}
