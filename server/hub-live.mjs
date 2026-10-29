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
//     sentryNet     Gully Sentry network (sentry.gullychain.xyz/api/v1/network/stats): active keys, operators and
//                   keys heard per 10-minute slot over 24 h, filled to 144 slots (a slot with no heartbeat is a real 0;
//                   the sum is the heartbeats in 24 h)
//     sentrySale    Gully Sentry testnet keys (…/api/v1/sale/stats): minted, max supply, available
//     sentryChain   Gully Sentry's own verdict on Gully Chain's assertions (…/api/v1/chain/health)
//   Gully Sentry sends no CORS header for gullylabs.xyz, so it is read here too.
//     offers Gully Offerwall public stats (offers.kre8.fun/v1/stats: completions, stablecoin (USDC) paid and points per hour,
//            last 24 h; totals and live offers), for /products/offerwall
//     copy   Gully Chain copy-trading engine health (copy.kre8.fun/health: leaders indexed, active copies,
//            engine head block), for /products/copy-trading and the Gully Chain card
//     social Gully Social newest posts (social.kre8.fun/v1/posts, first page of 30: count and post times)
//     people Gully Social newest accounts (social.kre8.fun/v1/people?sort=new, up to 50: count and join times)
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
  sentryNet: () => `${env('GULLY_SENTRY_URL', 'https://sentry.gullychain.xyz')}/api/v1/network/stats`,
  sentrySale: () => `${env('GULLY_SENTRY_URL', 'https://sentry.gullychain.xyz')}/api/v1/sale/stats`,
  sentryChain: () => `${env('GULLY_SENTRY_URL', 'https://sentry.gullychain.xyz')}/api/v1/chain/health`,
  offers: () => `${env('GULLY_OFFERWALL_URL', 'https://offers.kre8.fun')}/v1/stats`,
  copy: () => `${env('GULLY_COPY_ENGINE_URL', 'https://copy.kre8.fun')}/health`,
  social: () => `${env('GULLY_SOCIAL_URL', 'https://social.kre8.fun')}/v1/posts`,
  people: () => `${env('GULLY_SOCIAL_URL', 'https://social.kre8.fun')}/v1/people?sort=new&limit=50`,
}
/** Gully Sentry's heartbeat slot (10 minutes) and the window it reports (24 h). */
const SLOT = 600
const SLOTS = 144

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
  if (key === 'sentryNet') {
    const at = n(j.at)
    if (at == null || !Array.isArray(j.series)) return null
    // The API lists only the slots that heard a heartbeat; every other slot of the 24 h window heard none.
    const heard = new Map()
    for (const x of j.series) if (n(x?.t) != null && n(x?.keys) != null) heard.set(Math.floor(x.t / SLOT) * SLOT, x.keys)
    const last = Math.floor(at / SLOT) * SLOT
    const series = Array.from({ length: SLOTS }, (_, i) => {
      const t = last - (SLOTS - 1 - i) * SLOT
      return { t, keys: heard.get(t) ?? 0 }
    })
    return { at, epoch: n(j.epoch), activeKeys: n(j.activeKeys), operators: n(j.operators), heartbeats24h: series.reduce((s2, x) => s2 + x.keys, 0), series }
  }
  if (key === 'sentrySale') {
    if (j.deployed !== true) return null
    return { saleMode: String(j.saleMode ?? ''), totalMinted: n(j.totalMinted), totalBurned: n(j.totalBurned), maxSupply: n(j.maxSupply), available: n(j.available) }
  }
  if (key === 'sentryChain') {
    if (typeof j.verdict !== 'string') return null
    return { verdict: j.verdict, summary: String(j.summary ?? ''), l3Head: n(Number(j.l3Head)), newestAssertionAgeSec: n(j.newestAssertionAgeSec), checkedAt: n(j.checkedAt) }
  }
  if (key === 'offers') {
    if (!Array.isArray(j.series) || !j.totals || typeof j.totals !== 'object') return null
    // stablecoin (USDC) amounts arrive as decimal strings ("0.00"); anything unparseable is null, never zero
    const usd = (v) => {
      const x = typeof v === 'number' ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : NaN
      return Number.isFinite(x) ? x : null
    }
    return {
      hours: n(j.hours),
      series: j.series.slice(-48).map((h) => ({ t: String(h.t), completions: n(h.completions) ?? 0, paid: usd(h.paid) ?? 0, points: n(h.points) ?? 0 })),
      totals: { completions: n(j.totals.completions), paid: usd(j.totals.paid), players: n(j.totals.players) },
      liveOffers: n(j.liveOffers),
    }
  }
  if (key === 'copy') {
    if (j.ok !== true || n(j.leaders) == null) return null
    return { leaders: n(j.leaders), activeCopies: n(j.activeCopies), block: n(j.head?.block), dryRun: j.dryRun === true }
  }
  // Gully Social pages: only counts and unix times leave this server (no bodies, no addresses).
  if (key === 'social') {
    if (!Array.isArray(j.items)) return null
    const times = j.items.map((x) => n(x?.createdAt)).filter((t) => t != null)
    return { count: j.items.length, more: j.next != null, times }
  }
  if (key === 'people') {
    if (!Array.isArray(j.items)) return null
    const times = j.items.map((x) => n(x?.joinedAt)).filter((t) => t != null)
    return { count: j.items.length, more: j.items.length >= 50, times }
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
