// What is live across Gully Labs, for the hub (gullylabs.xyz, /products and the Gully Labs App), read server-side
// because most of these hosts do not open CORS to gullylabs.xyz (2026-10-26).
//
//   GET /api/hub   public, cached 60 s:
//     services   every public Gully surface probed once a minute: up, response time and the last hour's times.
//                Gully Chain: site, Gully Street app, explorer, faucet, bridge, docs, developer portal, public RPC,
//                indexer. Gully Labs: Gully Pay, Gully RPC (site, app, gateway), HolderMaps, Gully Security,
//                Gully Studio, Gully IPFS and the status page.
//     chain      Gully Chain testnet head from its indexer (the browser reads the RPC itself; this is the fallback).
//     quests     Gully Quests (on chain, QuestRegistry 0xE3E5…13Bb): the indexer's /quests/stats and /quests, else
//                questCount() over RPC.
//     x402       Gully Pay's facilitator networks and assets (gullypay.xyz/x402/status).
//     gateway    Gully RPC's gateway networks and their state (rpc.gullyrpc.xyz).
//     statusPage status.gullylabs.xyz: the overall banner and each service's pill, parsed from its HTML.
//
// Nothing is invented: a source that cannot be read is null (or `up: false` for a probe), never zero.

import { keccak_256 } from './vendor/noble.mjs'

const TTL = 60_000
const TIMEOUT = 4_000
const HISTORY = 60
const UA = 'GullyLabs-Hub/1 (+https://gullylabs.xyz/products)'

export const GULLY_CHAIN_ID = 485590
export const QUEST_REGISTRY = '0xE3E57e15A9973281A8de2B3bedd512BE8C3813Bb'
const env = (k, d) => String(process.env[k] ?? d).replace(/\/+$/, '')
const INDEXER = () => env('GULLY_INDEXER', 'https://indexer.gullychain.xyz')
const CHAIN_RPC = () => env('GULLY_RPC_485590', 'https://testnet-rpc.gullychain.xyz').split(',')[0]
const X402 = () => env('GULLYPAY_X402_URL', 'https://gullypay.xyz/x402/status')
const GATEWAY = () => env('GULLYRPC_GATEWAY_URL', 'https://rpc.gullyrpc.xyz')
const STATUS_PAGE = () => env('GULLY_STATUS_PAGE_URL', 'https://status.gullylabs.xyz')

/** Every surface the hub shows, in display order. `probe` is the URL checked; `url` is where a person goes. */
export const SURFACES = [
  { key: 'chain-site', group: 'chain', name: 'Gully Chain', url: 'https://gullychain.xyz' },
  { key: 'street', group: 'chain', name: 'Gully Street app', url: 'https://app.gullychain.xyz' },
  { key: 'explorer', group: 'chain', name: 'Explorer', url: 'https://testnet-explorer.gullychain.xyz' },
  { key: 'faucet', group: 'chain', name: 'Faucet', url: 'https://faucet.gullychain.xyz' },
  { key: 'bridge', group: 'chain', name: 'Bridge', url: 'https://testnet-bridge.gullychain.xyz' },
  { key: 'docs', group: 'chain', name: 'Docs', url: 'https://docs.gullychain.xyz' },
  { key: 'devportal', group: 'chain', name: 'Developer portal', url: 'https://dev.gullychain.xyz' },
  { key: 'rpc-public', group: 'chain', name: 'Public RPC', url: 'https://testnet-rpc.gullychain.xyz', rpc: true },
  { key: 'indexer', group: 'chain', name: 'Indexer', url: 'https://indexer.gullychain.xyz', probe: 'https://indexer.gullychain.xyz/head' },
  { key: 'pay', group: 'labs', name: 'Gully Pay', url: 'https://gullypay.xyz', probe: 'https://gullypay.xyz/api/status' },
  { key: 'x402', group: 'labs', name: 'Gully Pay x402', url: 'https://gullypay.xyz/x402/status' },
  { key: 'rpc-site', group: 'labs', name: 'Gully RPC', url: 'https://gullyrpc.xyz', probe: 'https://gullyrpc.xyz/status.json' },
  { key: 'rpc-app', group: 'labs', name: 'Gully RPC app', url: 'https://app.gullyrpc.xyz' },
  { key: 'rpc-gateway', group: 'labs', name: 'Gully RPC gateway', url: 'https://rpc.gullyrpc.xyz' },
  { key: 'holders', group: 'labs', name: 'HolderMaps', url: 'https://holdermaps.xyz' },
  { key: 'security', group: 'labs', name: 'Gully Security', url: 'https://gullysecurity.xyz' },
  { key: 'studio', group: 'labs', name: 'Gully Studio', url: 'https://gullystudio.xyz' },
  // The gateway serves only pinned content: the inline empty-directory CID answers without the network.
  { key: 'ipfs', group: 'labs', name: 'Gully IPFS', url: 'https://ipfs.gullylabs.xyz', probe: 'https://ipfs.gullylabs.xyz/ipfs/bafyaabakaieac' },
  { key: 'status', group: 'labs', name: 'Status page', url: 'https://status.gullylabs.xyz' },
]

let fetchFn = (...a) => globalThis.fetch(...a)
let cache = null
let inflight = null
const history = new Map()

async function call(url, init = {}) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    return await fetchFn(url, { redirect: 'manual', ...init, signal: ctl.signal, headers: { 'user-agent': UA, ...(init.headers ?? {}) } })
  } finally {
    clearTimeout(t)
  }
}

async function getJson(url) {
  try {
    const r = await call(url, { headers: { accept: 'application/json' } })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

async function chainRpc(method, params = []) {
  const r = await call(CHAIN_RPC(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j = await r.json()
  if (j?.error || typeof j?.result !== 'string') throw new Error('bad answer')
  return j.result
}

/** One probe: up when the host answers below 500 (a redirect counts), with the time it took; down on TLS or network errors. */
export async function probe(s) {
  const t0 = Date.now()
  try {
    if (s.rpc) {
      await chainRpc('eth_blockNumber')
      return { up: true, ms: Date.now() - t0, code: 200 }
    }
    const r = await call(s.probe ?? s.url, { method: 'GET' })
    // Drain nothing: the body is not needed (and may be a page); cancel it so the socket is freed.
    try {
      await r.body?.cancel()
    } catch {
      /* already consumed */
    }
    return { up: r.status < 500, ms: Date.now() - t0, code: r.status }
  } catch {
    return { up: false, ms: null, code: null }
  }
}

function remember(key, at, ms) {
  const h = history.get(key) ?? []
  const last = h[h.length - 1]
  if (!last || Date.parse(at) - Date.parse(last.t) >= 60_000) {
    h.push({ t: at, ms })
    if (h.length > HISTORY) h.shift()
  }
  history.set(key, h)
  return [...h]
}

const big = (v) => {
  try {
    return v == null ? null : BigInt(v)
  } catch {
    return null
  }
}
const eth = (wei) => (wei == null ? null : Number(wei) / 1e18)

/** Gully Quests from the indexer's /quests/stats and /quests (shape checked on the live indexer, 2026-10-26). */
export function readQuests(stats, list) {
  if (!stats || typeof stats.quests !== 'number') return null
  const ethPool = (stats.pools ?? []).find((p) => /^0x0{40}$/i.test(String(p.asset)))
  const hourly = Array.isArray(stats.hourly) ? stats.hourly.slice(-48).map((h) => Number(h.completions) || 0) : []
  const quests = Array.isArray(list?.quests)
    ? list.quests.map((q) => ({
        id: String(q.id),
        title: String(q.title ?? '').slice(0, 80),
        state: String(q.state ?? q.status ?? ''),
        kind: q.verifierKind ? String(q.verifierKind) : null,
        completions: Number(q.completions) || 0,
        max: Number(q.maxCompletions) || 0,
        spotsLeft: q.spotsLeft == null ? null : Number(q.spotsLeft),
        rewardEth: /^0x0{40}$/i.test(String(q.rewardAsset)) ? eth(big(q.rewardAmount)) : null,
        endsAt: q.end ? new Date(Number(q.end) * 1000).toISOString() : null,
      }))
    : []
  const recent = Array.isArray(stats.recent)
    ? stats.recent.slice(0, 5).map((c) => ({ questId: String(c.questId), title: c.title ? String(c.title).slice(0, 80) : null, who: c.name ? String(c.name) : `${String(c.account).slice(0, 6)}…${String(c.account).slice(-4)}`, at: c.timestamp ? new Date(Number(c.timestamp) * 1000).toISOString() : null, rewardEth: eth(big(c.reward)) }))
    : []
  return {
    source: 'indexer',
    registry: QUEST_REGISTRY,
    total: stats.quests,
    active: Number(stats.active) || 0,
    upcoming: Number(stats.upcoming) || 0,
    ended: Number(stats.ended) || 0,
    completions: Number(stats.completions) || 0,
    completions24h: Number(stats.completions24h) || 0,
    poolEth: ethPool ? eth(big(ethPool.available)) : null,
    paidEth: ethPool ? eth(big(ethPool.paid)) : null,
    hourly,
    quests,
    recent,
  }
}

async function quests() {
  const [stats, list] = await Promise.all([getJson(`${INDEXER()}/quests/stats`), getJson(`${INDEXER()}/quests?limit=12`)])
  const q = readQuests(stats, list)
  if (q) return q
  // Fallback: the registry itself (questCount()), when the indexer cannot be read.
  try {
    const res = await chainRpc('eth_call', [{ to: QUEST_REGISTRY, data: QUEST_COUNT }, 'latest'])
    const n = Number(BigInt(res))
    return { source: 'chain', registry: QUEST_REGISTRY, total: n, active: null, upcoming: null, ended: null, completions: null, completions24h: null, poolEth: null, paidEth: null, hourly: [], quests: [], recent: [] }
  } catch {
    return null
  }
}

/** Gully Pay's facilitator (x402/status): its networks, assets and whether Gully Chain is one of them. */
export function readX402(j) {
  if (!j || !Array.isArray(j.supportedNetworks)) return null
  const named = { base: 'Base', 'base-sepolia': 'Base Sepolia', ethereum: 'Ethereum', bsc: 'BNB Chain', solana: 'Solana', 'gully-chain-testnet': 'Gully Chain Testnet', 'gully-chain': 'Gully Chain' }
  return {
    networks: j.supportedNetworks.map((n) => ({ id: String(n), name: j.networks?.[n]?.name ?? named[n] ?? String(n), chainId: j.networks?.[n]?.chainId ?? null, testnet: /sepolia|testnet/.test(String(n)) })),
    assets: Array.isArray(j.supportedAssets) ? j.supportedAssets.map(String) : [],
    schemes: Array.isArray(j.supportedSchemes) ? j.supportedSchemes.map(String) : [],
    gullyChain: j.supportedNetworks.some((n) => /^gully-chain/.test(String(n))),
  }
}

/** Gully RPC's gateway root: the public networks and their state. */
export function readGateway(j) {
  if (!j || !Array.isArray(j.public)) return null
  const networks = j.public.map((n) => ({ alias: String(n.alias ?? ''), chainId: Number(String(n.id ?? '').split(':')[1]) || null, state: String(n.state ?? ''), blockTimeMs: Number.isFinite(Number(n.blockTimeMs)) ? Number(n.blockTimeMs) : null }))
  return { networks, ok: networks.filter((n) => n.state === 'OK').length, total: networks.length, gullyChain: networks.some((n) => n.chainId === GULLY_CHAIN_ID) }
}

/** status.gullylabs.xyz is a static page: the banner class and each `nm` + `pill` pair. */
export function readStatusPage(html) {
  if (typeof html !== 'string' || !html.includes('class="banner')) return null
  const overall = (html.match(/class="banner\s+(ok|warn|bad)"/) ?? [])[1] ?? null
  const services = [...html.matchAll(/<span class="nm">([^<]{1,60})<\/span>\s*<span class="pill\s+(up|down|degraded)">/g)].map((m) => ({ name: m[1].trim(), state: m[2] }))
  return { overall, services, up: services.filter((s) => s.state === 'up').length, total: services.length }
}

async function statusPage() {
  try {
    const r = await call(STATUS_PAGE(), { headers: { accept: 'text/html' } })
    return r.ok ? readStatusPage(await r.text()) : null
  } catch {
    return null
  }
}

async function read() {
  const at = new Date().toISOString()
  const [probes, head, q, x, g, sp] = await Promise.all([Promise.all(SURFACES.map((s) => probe(s))), getJson(`${INDEXER()}/head`), quests(), getJson(X402()), getJson(`${GATEWAY()}/`), statusPage()])
  const services = SURFACES.map((s, i) => ({ key: s.key, group: s.group, name: s.name, url: s.url, up: probes[i].up, ms: probes[i].ms, history: remember(s.key, at, probes[i].ms) }))
  const block = Number(head?.block)
  return {
    generatedAt: at,
    services,
    chain: Number.isFinite(block) && block > 0 ? { chainId: GULLY_CHAIN_ID, head: block, at: head.timestamp ? new Date(Number(head.timestamp) * 1000).toISOString() : null, source: 'indexer' } : null,
    quests: q,
    x402: readX402(x),
    gateway: readGateway(g),
    statusPage: sp,
  }
}

// questCount() selector, from keccak256("questCount()") (vendored noble, the same helper gully-chain.mjs uses).
const QUEST_COUNT = '0x' + Array.from(keccak_256(new TextEncoder().encode('questCount()')).slice(0, 4), (b) => b.toString(16).padStart(2, '0')).join('')

export async function hub() {
  if (cache && Date.now() - cache.at < TTL) return cache.body
  inflight ??= read().finally(() => (inflight = null))
  const body = await inflight
  cache = { at: Date.now(), body }
  return body
}

/** GET /api/hub. Returns true when it answered. */
export async function handleHub(req, res, url, send) {
  if (url.pathname !== '/api/hub') return false
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, '', { Allow: 'GET, HEAD' })
    return true
  }
  const body = await hub()
  send(res, 200, req.method === 'HEAD' ? '' : JSON.stringify(body), { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' })
  return true
}

/** Tests: swap fetch, forget the cache and history. */
export function _resetHub(fn) {
  fetchFn = fn ?? ((...a) => globalThis.fetch(...a))
  cache = null
  inflight = null
  history.clear()
}
