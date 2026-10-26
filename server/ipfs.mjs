// Gully IPFS (gully-ops gully/ipfs): a Kubo node on the gully box with a read-only gateway at
// https://ipfs.gullylabs.xyz/ipfs/<CID> that serves ONLY content the node holds (Gateway.NoFetch).
//
//   GET /api/ipfs/stats   public, cached 60 s: repo size, pinned CIDs, whether the gateway answers, and a short history.
//
// How it reads: gully-web and gully-ipfs share the docker `edge` network, so the server calls the Kubo RPC
// (IPFS_API, default http://gully-ipfs:5001) READ-ONLY (repo/stat, pin/ls) with a short timeout. The RPC is never
// proxied or exposed: only these numbers leave the server. When the RPC cannot be reached the gateway itself is
// probed (IPFS_GATEWAY, default http://gully-ipfs:8080, then the public https://ipfs.gullylabs.xyz) with the
// inline empty-directory CID, and `source` says which one answered. Nothing is invented: an unread figure is null.

export const IPFS_PUBLIC_GATEWAY = 'https://ipfs.gullylabs.xyz'
// The identity CID of an empty UnixFS directory: inline, so a NoFetch gateway can answer it without the network.
const PROBE_CID = 'bafyaabakaieac'
const TTL = 60_000
const TIMEOUT = 2_500
const HISTORY = 60

const api = () => String(process.env.IPFS_API ?? 'http://gully-ipfs:5001').replace(/\/+$/, '')
const gateways = () => [String(process.env.IPFS_GATEWAY ?? 'http://gully-ipfs:8080').replace(/\/+$/, ''), IPFS_PUBLIC_GATEWAY]

let cache = null
let inflight = null
const history = []

async function call(url, init = {}) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    return await fetch(url, { ...init, signal: ctl.signal })
  } finally {
    clearTimeout(t)
  }
}

/** Kubo's RPC answers POST only. Read-only calls; null when the node cannot be reached. */
async function kubo(path) {
  try {
    const r = await call(`${api()}/api/v0/${path}`, { method: 'POST' })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

async function probeGateway() {
  for (const g of gateways()) {
    try {
      const t0 = Date.now()
      const r = await call(`${g}/ipfs/${PROBE_CID}`, { method: 'HEAD' })
      if (r.status < 500) return { up: true, ms: Date.now() - t0, via: g === IPFS_PUBLIC_GATEWAY ? 'public' : 'internal' }
    } catch {
      /* next gateway */
    }
  }
  return { up: false, ms: null, via: null }
}

async function read() {
  const [repo, pins, gw] = await Promise.all([kubo('repo/stat?size-only=true'), kubo('pin/ls?type=recursive&quiet=true'), probeGateway()])
  const pinned = pins && pins.Keys && typeof pins.Keys === 'object' ? Object.keys(pins.Keys).length : null
  const repoBytes = Number.isFinite(Number(repo?.RepoSize)) ? Number(repo.RepoSize) : null
  const storageMaxBytes = Number.isFinite(Number(repo?.StorageMax)) ? Number(repo.StorageMax) : null
  const at = new Date().toISOString()
  const last = history[history.length - 1]
  // One history point a minute at most: the last hour.
  if (!last || Date.parse(at) - Date.parse(last.t) >= 60_000) {
    history.push({ t: at, pinned, repoBytes, up: gw.up, ms: gw.ms })
    if (history.length > HISTORY) history.shift()
  }
  return {
    generatedAt: at,
    source: repo || pins ? 'kubo' : gw.via ? `gateway-${gw.via}` : 'none',
    gateway: IPFS_PUBLIC_GATEWAY,
    gatewayUp: gw.via ? gw.up : null,
    gatewayMs: gw.ms,
    pinned,
    repoBytes,
    storageMaxBytes,
    history: [...history],
  }
}

/** The cached stats (one read at a time; a failed read keeps the last good answer's shape with nulls). */
export async function ipfsStats() {
  if (cache && Date.now() - cache.at < TTL) return cache.body
  inflight ??= read().finally(() => (inflight = null))
  const body = await inflight
  cache = { at: Date.now(), body }
  return body
}

/** GET /api/ipfs/stats. Returns true when it answered. */
export async function handleIpfs(req, res, url, send) {
  if (url.pathname !== '/api/ipfs/stats') return false
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, '', { Allow: 'GET, HEAD' })
    return true
  }
  const body = await ipfsStats()
  send(res, 200, req.method === 'HEAD' ? '' : JSON.stringify(body), { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' })
  return true
}

/** Tests: forget the cache and history. */
export function _resetIpfs() {
  cache = null
  history.length = 0
}
