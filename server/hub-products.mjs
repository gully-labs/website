// Per-product chart data for the product pages (/products/<slug>) and the landing, read server-side because the
// browser cannot read most of it (Gully Chain hosts and the indexer do not open CORS to gullylabs.xyz, and the
// HolderMaps and Gully Security counters live in this server's own storage). Landing v3, 2026-10-26.
//
//   GET /api/hub/products   public, cached 60 s:
//     chain     Gully Chain testnet, last 24 h by hour from the chain RPC: blocks, user transactions, gas used; plus the
//               newest blocks (number, txs, gas, time).
//     activity  the indexer's /feed (newest 200 events): launches, curve trades and router swaps per hour, last 24 h.
//     bridge    Gully Bridge: the Fast lane (Hyperlane gETH: mints = in, burns = out, from the gETH Transfer logs) and
//               the Canonical lane (Arbitrum deposits: tx types 0x64/0x69; withdrawals: ArbSys withdrawEth) per hour,
//               last 24 h; gETH supply on Gully Chain against the ETH its router holds on Arbitrum Sepolia (backing).
//     holders   HolderMaps: maps opened per day (this server's scan counter, kept 30 days), today's most scanned and
//               maps by chain today.
//     security  Gully Security: scans requested per day, last 14 days, and their states (security-store jobs).
//
// Nothing is invented: a source that cannot be read is null, never zero. Testnet ETH has no USD value and is
// labelled as test ETH; nothing here is added to a dollar total.

import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './http.mjs'
// holders-intel.mjs and security-store.mjs are imported when first read (holders-intel and holders.mjs import each
// other, so loading it first from here would trip the cycle; server.mjs has loaded both by then).

const TTL = 60_000
const TIMEOUT = 5_000
const UA = 'GullyLabs-Hub/1 (+https://gullylabs.xyz/products)'
const HOUR = 3600
const env = (k, d) => String(process.env[k] ?? d).replace(/\/+$/, '')
const CHAIN_RPC = () => env('GULLY_RPC_485590', 'https://testnet-rpc.gullychain.xyz').split(',')[0]
const PARENT_RPC = () => env('GULLY_RPC_421614', 'https://sepolia-rollup.arbitrum.io/rpc').split(',')[0]
const INDEXER = () => env('GULLY_INDEXER', 'https://indexer.gullychain.xyz')

/** gETH "Gully Bridged ETH" (Hyperlane synthetic, Gully Chain) and its HypNative router on Arbitrum Sepolia
    (gully-ops/l3/hyperlane, route GETH/arbitrumsepolia-gullychaintestnet, deployed 2026-10-26). */
export const GETH = '0x7Dd1Aa3d8598A3edB43EB43ddcb5BCE4AbfBb702'
export const GETH_ROUTER_PARENT = '0x3Aa770313a4c8aa6F9B1055fDBfd9dbC4051bad0'
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f15c4a11628f55a4df523b3ef'
const ZERO_TOPIC = '0x' + '0'.repeat(64)
const ARBSYS = '0x0000000000000000000000000000000000000064'
const WITHDRAW_ETH = '0x25e16063'
/** How many of the newest blocks are read (the testnet only makes a block when there is a transaction). */
const MAX_BLOCKS = 400

let fetchFn = (...a) => globalThis.fetch(...a)
let cache = null
let inflight = null
const blockCache = new Map()
const HISTORY_FILE = () => path.join(DATA_DIR, 'hub-products.json')

async function call(url, init = {}) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), TIMEOUT)
  try {
    return await fetchFn(url, { ...init, signal: ctl.signal, headers: { 'user-agent': UA, ...(init.headers ?? {}) } })
  } finally {
    clearTimeout(t)
  }
}

async function rpcBatch(url, calls) {
  const r = await call(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, method: c[0], params: c[1] ?? [] }))) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j = await r.json()
  if (!Array.isArray(j)) throw new Error('bad answer')
  return [...j].sort((a, b) => a.id - b.id).map((x) => (x.error ? null : x.result))
}
const rpc1 = async (url, method, params) => {
  const [r] = await rpcBatch(url, [[method, params]])
  if (r == null) throw new Error(`${method} failed`)
  return r
}
const hex = (h) => (typeof h === 'string' ? parseInt(h, 16) : Number(h))
const big = (h) => {
  try {
    return BigInt(h)
  } catch {
    return null
  }
}
const eth = (wei) => (wei == null ? null : Number(wei) / 1e18)

/** 24 hourly buckets ending with the current hour: [{ t (unix s, bucket start), ...zeros }]. */
export function hourAxis(nowSec, fields) {
  const top = Math.floor(nowSec / HOUR) * HOUR
  return Array.from({ length: 24 }, (_, i) => ({ t: top - (23 - i) * HOUR, ...Object.fromEntries(fields.map((f) => [f, 0])) }))
}
const bucketOf = (axis, ts) => {
  const i = axis.findIndex((b) => ts >= b.t && ts < b.t + HOUR)
  return i < 0 ? null : axis[i]
}

/** Summarise blocks (with full transactions) into the chain and canonical-bridge series. Pure: tested. */
export function summariseBlocks(blocks, nowSec) {
  const axis = hourAxis(nowSec, ['blocks', 'txs', 'gas'])
  const canon = hourAxis(nowSec, ['in', 'out'])
  for (const b of blocks) {
    const h = bucketOf(axis, b.time)
    if (h) {
      h.blocks++
      h.txs += b.txs
      h.gas += b.gas
    }
    const c = bucketOf(canon, b.time)
    if (c) {
      c.in += b.deposits
      c.out += b.withdrawals
    }
  }
  return { hourly: axis, canonical: canon }
}

/** One block as kept: user transactions only (ArbOS's internal 0x6a start-block transaction is not counted). */
export function readBlock(blk) {
  if (!blk || !Array.isArray(blk.transactions)) return null
  const txs = blk.transactions.filter((t) => typeof t === 'object' && t && t.type !== '0x6a')
  return {
    number: hex(blk.number),
    time: hex(blk.timestamp),
    gas: hex(blk.gasUsed),
    txs: txs.length,
    deposits: txs.filter((t) => t.type === '0x64' || t.type === '0x69').length,
    withdrawals: txs.filter((t) => String(t.to ?? '').toLowerCase() === ARBSYS && String(t.input ?? '').startsWith(WITHDRAW_ETH)).length,
  }
}

async function chainBlocks() {
  const head = hex(await rpc1(CHAIN_RPC(), 'eth_blockNumber', []))
  const from = Math.max(0, head - MAX_BLOCKS + 1)
  const want = []
  for (let n = from; n <= head; n++) if (!blockCache.has(n)) want.push(n)
  for (let i = 0; i < want.length; i += 50) {
    const part = want.slice(i, i + 50)
    const res = await rpcBatch(CHAIN_RPC(), part.map((n) => ['eth_getBlockByNumber', ['0x' + n.toString(16), true]]))
    res.forEach((blk) => {
      const b = readBlock(blk)
      if (b) blockCache.set(b.number, b)
    })
  }
  for (const k of [...blockCache.keys()]) if (k < from) blockCache.delete(k)
  return { head, blocks: [...blockCache.values()].sort((a, b) => a.number - b.number) }
}

/** gETH Transfer logs into hourly Fast-lane counts: a mint (from 0x0) is a transfer in, a burn (to 0x0) one out. */
export function fastLane(logs, nowSec, timeOf) {
  const axis = hourAxis(nowSec, ['in', 'out'])
  let allIn = 0
  let allOut = 0
  for (const l of logs) {
    const from = l.topics?.[1]
    const to = l.topics?.[2]
    const isIn = from === ZERO_TOPIC
    const isOut = to === ZERO_TOPIC
    if (!isIn && !isOut) continue
    if (isIn) allIn++
    else allOut++
    const ts = timeOf(hex(l.blockNumber))
    const b = ts == null ? null : bucketOf(axis, ts)
    if (b) b[isIn ? 'in' : 'out']++
  }
  return { hourly: axis, allIn, allOut }
}

async function readChainAndBridge(nowSec) {
  let chain = null
  let canonical = null
  let blocksById = new Map()
  try {
    const { head, blocks } = await chainBlocks()
    blocksById = new Map(blocks.map((b) => [b.number, b.time]))
    const s = summariseBlocks(blocks, nowSec)
    chain = { head, read: blocks.length, hourly: s.hourly, recent: blocks.slice(-40).map((b) => ({ number: b.number, txs: b.txs, gas: b.gas, time: b.time })) }
    canonical = s.canonical
  } catch {
    /* unreadable: null */
  }
  let fast = null
  let supply = null
  try {
    const [logs, ts] = await rpcBatch(CHAIN_RPC(), [
      ['eth_getLogs', [{ address: GETH, topics: [TRANSFER], fromBlock: '0x0', toBlock: 'latest' }]],
      ['eth_call', [{ to: GETH, data: '0x18160ddd' }, 'latest']],
    ])
    if (Array.isArray(logs)) fast = fastLane(logs, nowSec, (n) => blocksById.get(n) ?? null)
    if (typeof ts === 'string') supply = eth(big(ts))
  } catch {
    /* unreadable */
  }
  let backing = null
  try {
    backing = eth(big(await rpc1(PARENT_RPC(), 'eth_getBalance', [GETH_ROUTER_PARENT, 'latest'])))
  } catch {
    /* unreadable */
  }
  const bridge =
    fast || canonical || supply != null || backing != null
      ? { fast: fast ? fast.hourly : null, fastAllIn: fast?.allIn ?? null, fastAllOut: fast?.allOut ?? null, canonical, gethSupply: supply, gethBacking: backing, token: GETH, router: GETH_ROUTER_PARENT, unit: 'test ETH' }
      : null
  return { chain, bridge }
}

/** The indexer's feed into hourly launches, trades and swaps. Pure: tested. */
export function readActivity(feed, nowSec) {
  const items = Array.isArray(feed?.items) ? feed.items : Array.isArray(feed) ? feed : null
  if (!items) return null
  const axis = hourAxis(nowSec, ['launches', 'trades', 'swaps'])
  const key = { launch: 'launches', trade: 'trades', swap: 'swaps' }
  for (const it of items) {
    const k = key[it?.kind]
    const b = k ? bucketOf(axis, Number(it.timestamp)) : null
    if (b) b[k]++
  }
  const oldest = items.length ? Math.min(...items.map((i) => Number(i.timestamp)).filter(Number.isFinite)) : null
  return { hourly: axis, events: items.length, since: Number.isFinite(oldest) ? oldest : null }
}

async function activity(nowSec) {
  try {
    const r = await call(`${INDEXER()}/feed?limit=200`, { headers: { accept: 'application/json' } })
    return r.ok ? readActivity(await r.json(), nowSec) : null
  } catch {
    return null
  }
}

/* ---------- this server's own counters, kept 30 days ---------- */
function loadHistory() {
  try {
    const j = JSON.parse(fs.readFileSync(HISTORY_FILE(), 'utf8'))
    return j && typeof j === 'object' ? j : {}
  } catch {
    return {}
  }
}
function saveHistory(h) {
  try {
    fs.mkdirSync(path.dirname(HISTORY_FILE()), { recursive: true })
    fs.writeFileSync(HISTORY_FILE() + '.tmp', JSON.stringify(h))
    fs.renameSync(HISTORY_FILE() + '.tmp', HISTORY_FILE())
  } catch {
    /* read-only disk: the history restarts with the process */
  }
}

/** HolderMaps: today's scans (holders-intel) recorded into a 30-day daily series. */
export function readHolders(top, hist) {
  if (!top || !Array.isArray(top.items)) return null
  const today = top.day
  const total = top.items.reduce((a, i) => a + (Number(i.scans) || 0), 0)
  const daily = { ...(hist.holdersDaily ?? {}) }
  daily[today] = Math.max(daily[today] ?? 0, total)
  const days = Object.keys(daily).sort().slice(-30)
  const byChain = {}
  for (const i of top.items) byChain[i.chain] = (byChain[i.chain] ?? 0) + (Number(i.scans) || 0)
  return {
    daily: days.map((d) => ({ day: d, maps: daily[d] })),
    today: total,
    tokens: top.items.length,
    top: top.items.slice(0, 6).map((i) => ({ chain: i.chain, symbol: i.symbol ?? null, token: i.token, scans: i.scans, path: i.path })),
    byChain: Object.entries(byChain).sort((a, b) => b[1] - a[1]).map(([chain, maps]) => ({ chain, maps })),
    keep: Object.fromEntries(days.map((d) => [d, daily[d]])),
  }
}

/** Gully Security: scans requested per day over 14 days, and their states. Pure: tested. */
export function readSecurity(list, nowMs) {
  if (!Array.isArray(list)) return null
  const days = Array.from({ length: 14 }, (_, i) => new Date(nowMs - (13 - i) * 86_400_000).toISOString().slice(0, 10))
  const per = Object.fromEntries(days.map((d) => [d, 0]))
  const states = { done: 0, running: 0, failed: 0, other: 0 }
  for (const j of list) {
    const d = String(j?.createdAt ?? '').slice(0, 10)
    if (d in per) per[d]++
    const s = j?.status === 'done' ? 'done' : j?.status === 'failed' || j?.state === 'cancelled' ? 'failed' : j?.state === 'started' || j?.state === 'starting' ? 'running' : 'other'
    states[s]++
  }
  return { daily: days.map((d) => ({ day: d, scans: per[d] })), total: list.length, states, published: list.filter((j) => j?.published).length }
}

async function read() {
  const nowMs = Date.now()
  const nowSec = Math.floor(nowMs / 1000)
  const [cb, act] = await Promise.all([readChainAndBridge(nowSec), activity(nowSec)])
  const hist = loadHistory()
  let holders = null
  try {
    const { topScans } = await import('./holders-intel.mjs')
    holders = readHolders(topScans(200), hist)
  } catch {
    holders = null
  }
  if (holders) {
    saveHistory({ ...hist, holdersDaily: holders.keep })
    delete holders.keep
  }
  let security = null
  try {
    const { jobs } = await import('./security-store.mjs')
    security = readSecurity(jobs(), nowMs)
  } catch {
    security = null
  }
  return { generatedAt: new Date(nowMs).toISOString(), chain: cb.chain, activity: act, bridge: cb.bridge, holders, security }
}

export async function hubProducts() {
  if (cache && Date.now() - cache.at < TTL) return cache.body
  inflight ??= read().finally(() => (inflight = null))
  const body = await inflight
  cache = { at: Date.now(), body }
  return body
}

/** GET /api/hub/products. Returns true when it answered. */
export async function handleHubProducts(req, res, url, send) {
  if (url.pathname !== '/api/hub/products') return false
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, '', { Allow: 'GET, HEAD' })
    return true
  }
  const body = await hubProducts()
  send(res, 200, req.method === 'HEAD' ? '' : JSON.stringify(body), { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' })
  return true
}

/** Tests: swap fetch, forget the caches. */
export function _resetHubProducts(fn) {
  fetchFn = fn ?? ((...a) => globalThis.fetch(...a))
  cache = null
  inflight = null
  blockCache.clear()
}
