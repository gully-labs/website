// Live figures the Gully Labs hub shows for products that run on their own domains (2026-10-26), read server-side
// because those hosts do not open CORS to gullylabs.xyz. Each figure is the product's OWN public status:
//
//   Gully Pay   https://gullypay.xyz/api/status     services operational / services listed, and the overall status
//   Gully RPC   https://gullyrpc.xyz/status.json    networks served (live or beta) / networks listed
//
//   GET /api/products/status   public, cached 60 s, with a short history per product (one point a minute, the last hour).
// A product that cannot be read is null, never zero.

const TTL = 60_000
const TIMEOUT = 3_000
const HISTORY = 60
const SOURCES = {
  pay: process.env.GULLYPAY_STATUS_URL ?? 'https://gullypay.xyz/api/status',
  rpc: process.env.GULLYRPC_STATUS_URL ?? 'https://gullyrpc.xyz/status.json',
}

let cache = null
let inflight = null
const history = { pay: [], rpc: [] }

async function getJson(url) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'GullyLabs-Hub/1 (+https://gullylabs.xyz/products)' } })
    return r.ok ? await r.json() : null
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

export function readPay(j) {
  const svc = j && typeof j.services === 'object' && j.services ? Object.values(j.services) : null
  if (!svc || !svc.length) return null
  return { up: svc.filter((s) => s === 'operational').length, total: svc.length, status: String(j.status ?? '') || null }
}

export function readRpc(j) {
  const chains = Array.isArray(j?.chains) ? j.chains : null
  if (!chains) return null
  return { served: chains.filter((c) => c?.status === 'live' || c?.status === 'beta').length, total: chains.length, gullyChain: chains.some((c) => c?.chainId === 485590 && (c.status === 'live' || c.status === 'beta')) }
}

function remember(key, at, value) {
  const h = history[key]
  const last = h[h.length - 1]
  if (!last || Date.parse(at) - Date.parse(last.t) >= 60_000) {
    h.push({ t: at, v: value })
    if (h.length > HISTORY) h.shift()
  }
}

async function read() {
  const [p, r] = await Promise.all([getJson(SOURCES.pay), getJson(SOURCES.rpc)])
  const at = new Date().toISOString()
  const pay = readPay(p)
  const rpc = readRpc(r)
  remember('pay', at, pay ? pay.up : null)
  remember('rpc', at, rpc ? rpc.served : null)
  return { generatedAt: at, pay: pay && { ...pay, source: SOURCES.pay, history: [...history.pay] }, rpc: rpc && { ...rpc, source: SOURCES.rpc, history: [...history.rpc] } }
}

export async function productStatus() {
  if (cache && Date.now() - cache.at < TTL) return cache.body
  inflight ??= read().finally(() => (inflight = null))
  const body = await inflight
  cache = { at: Date.now(), body }
  return body
}

/** GET /api/products/status. Returns true when it answered. */
export async function handleProductStatus(req, res, url, send) {
  if (url.pathname !== '/api/products/status') return false
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, '', { Allow: 'GET, HEAD' })
    return true
  }
  const body = await productStatus()
  send(res, 200, req.method === 'HEAD' ? '' : JSON.stringify(body), { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' })
  return true
}
