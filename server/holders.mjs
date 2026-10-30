// Holder Map: who holds a token, how the biggest wallets are connected, and what that means in plain words.
//
//   GET /api/holders/:chain/:token          the map (JSON), :token = an address or a tracked stock's ticker
//   GET /api/holders/:chain/:token/card.png the same map as a share card (1200 x 630, holders-card.mjs)
//   GET /api/holders/:chain/:token/card.jpg the same card as a JPEG (Telegram inline photo results must be JPEG)
//
// Any ERC-20 on Robinhood Chain, BNB Chain, Base, HyperEVM and Gully Chain Testnet and any SPL token on Solana can be mapped
// (kind 'token'), next to DeepCore launches ('deepcore-launch'), other launchpads' tokens (knownLaunch in
// holders-launchpads.mjs: 'launch') and the tracker's stock tokens ('stock'). So the endpoint cannot be used to
// hammer upstreams (holders-any.mjs): an address is first confirmed to be a token (ERC-20 decimals() and
// totalSupply(), or a Solana mint); tokens nobody listed have a tighter per-IP budget, a global per-minute
// budget and a concurrency limit; the transfer-log index stops at a transfer count and a read count; cached
// answers are free. Launch forensics and the health score stay for launches only.
//
// Source ladder for any EVM token, cheapest reliable first: our own Transfer-log index on an archive RPC
// (exact balances, every transfer); past its caps, or without an archive RPC, the top holders from Blockscout
// PRO, then Moralis, labelled "top holders only" (map.coverage); with none of them, an honest "unavailable".
// Solana: every token account (getProgramAccounts) where the RPC allows it, else getTokenLargestAccounts.
//
// Where the data comes from, per chain (cheapest reliable source first; nothing is ever invented):
//   DeepCore launches, every chain DeepCore runs on (Robinhood Chain, BNB Chain, Base, HyperEVM):
//     DeepCore's own log index (GET /v1/chains/:id/logs, Transfer events of the launch token since its
//     creation block; launch tokens are covered from creation). Balances are rebuilt exactly from every
//     transfer, so the holder list, the links, the launch forensics and the replay all come from one
//     complete history. A token with more than DC_MAX_LOGS transfers is not rebuilt (it falls back to a
//     holder API below when one is configured).
//   Stock tokens on Robinhood Chain (and Base / HyperEVM tokens): Blockscout's PRO API
//     (BLOCKSCOUT_API_KEY, free key from dev.blockscout.com) for the top holders; links from the latest
//     Transfer logs read over our own RPCs (bounded: RECENT_MAX_LOGS logs, RECENT_MAX_CALLS calls).
//   Stock tokens on BNB Chain: Moralis (MORALIS_API_KEY) for the top holders and the latest transfers;
//     BNB Chain's public RPCs refuse log queries.
//   Stock tokens on Solana: the Solana RPC (getTokenLargestAccounts: the 20 largest token accounts,
//     merged by owner). Public Solana RPCs often refuse that method; GULLY_RPC_SOLANA (a private RPC) fixes
//     it. No transfer links on Solana yet.
//   Without the key a chain needs, the answer is state "unavailable" with the reason and the env var
//   to set ("holder data not available on this chain yet"), never an empty or made-up map.
//
// Labels: burn addresses, the token's own contract, DeepCore's pool vault, pool managers, routers,
// launch kit and lockers (GET /v1/venue/:chainId and the launch's own lock), our Gully Pay fee proxies,
// the tracker's pool, and public name tags (exchanges among them) from Blockscout's free metadata service.
// Labelled addresses never join a cluster and are not counted as "wallets" in the concentration figures.
//
// Clusters: union-find over direct transfers between unlabelled holders (and, for DeepCore launches,
// deployer -> wallet funding). Cached per (chain, token) for CACHE_MS (at least 5 minutes); failures for
// a minute. Builds are deduplicated, at most MAX_BUILDS run at once, and each IP may cause at most
// PER_IP_PER_MIN builds a minute (cached answers are free).

import { clientIp, json } from './http.mjs'
import { holderMapFeatures } from './plans.mjs'
import { enrichLaunch, readLaunchFeed, readLive, readWalletDetail, recordScan, resolveHolders, setMapPeek, topScans } from './holders-intel.mjs'
import { DEEPCORE_CHAINS } from './deepcore.mjs'
import { FEE_PROXY_REGISTRY } from './fee-proxy-guard.mjs'
import { readHistory, readTracker } from './tracker.mjs'
import { isOnCurve, b58decode, isSolanaAddress, solanaRpc } from './solana.mjs'
import { archiveKnown, readOwnHistory } from './holders-logs.mjs'
import { probeToken, reserveAnySlot, resetAnyForTest, takeAnyBuild } from './holders-any.mjs'
import { knownLaunch } from './holders-launchpads.mjs'
import { GULLY_CHAIN, gullyNames, indexerGet as gullyIndexerGet, LAUNCHPADS as GULLY_LAUNCHPADS, setGullyFetchForTest } from './gully-chain.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const ZERO = '0x0000000000000000000000000000000000000000'
const DEAD = '0x000000000000000000000000000000000000dead'
const UA = 'gullylabs-holders/1 (+https://gullylabs.xyz)'
/** Wallets listed per tier (plans.mjs HOLDER_MAP) and how many the graph draws. */
export const TIERS = { free: { list: 50, graph: 50 }, pro: { list: 500, graph: 120 } }
const LINKS_MAX = 240
const SNIPER_BLOCKS = 5
const HIDDEN_MAX = 12
const HIDDEN_MAX_PEERS = 20
const DC_MAX_LOGS = 15_000
const DC_PAGE = 1_000
export const RECENT_MAX_LOGS = 5_000
const RECENT_MAX_CALLS = 8
export const FRAMES = 24
export const RECENT_FLOWS = 24
const MAX_BUILDS = 3
const PER_IP_PER_MIN = 12
const CACHE_MAX = 200
const FAIL_TTL_MS = 60_000
const DC_PER_MIN = 90
const TIMEOUT_MS = 12_000
export const cacheMs = () => Math.max(300_000, Number(process.env.HOLDERS_CACHE_MS) || 300_000)
const DC_API = () => String(process.env.DEEPCORE_API ?? 'https://api.deepcore.fun').replace(/\/+$/, '')
const BLOCKSCOUT_API = () => String(process.env.BLOCKSCOUT_API ?? 'https://api.blockscout.com').replace(/\/+$/, '')
const BLOCKSCOUT_META = () => String(process.env.BLOCKSCOUT_METADATA_API ?? 'https://metadata.services.blockscout.com').replace(/\/+$/, '')
const MORALIS_API = () => String(process.env.MORALIS_API ?? 'https://deep-index.moralis.io/api/v2.2').replace(/\/+$/, '')
const blockscoutKey = () => String(process.env.BLOCKSCOUT_API_KEY ?? '').trim()
const moralisKey = () => String(process.env.MORALIS_API_KEY ?? '').trim()

/** The chains the map knows. `holders` is the holder API for tokens DeepCore's index does not rebuild. */
export const HOLDER_CHAINS = {
  robinhood: { id: 4663, name: 'Robinhood Chain', explorer: 'https://robinhoodchain.blockscout.com', holders: 'blockscout', rpcs: ['https://rpc.mainnet.chain.robinhood.com', 'https://rpc.ordofi.network', 'https://robinhood.drpc.org'], span: 2_000_000 },
  bsc: { id: 56, name: 'BNB Chain', explorer: 'https://bscscan.com', holders: 'moralis', moralis: 'bsc', rpcs: ['https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.bnbchain.org'], span: 5_000 },
  base: { id: 8453, name: 'Base', explorer: 'https://basescan.org', holders: 'blockscout', moralis: 'base', rpcs: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'], span: 10_000 },
  hyperevm: { id: 999, name: 'HyperEVM', explorer: 'https://hyperevmscan.io', holders: 'blockscout', rpcs: ['https://rpc.hyperliquid.xyz/evm'], span: 1_000 },
  solana: { id: 'solana', name: 'Solana', explorer: 'https://solscan.io', holders: 'solana-rpc', rpcs: [], span: 0 },
  // Gully Chain Testnet (our own L3). No holder API indexes it, so maps come only from our own Transfer-log index
  // (holders-logs.mjs). Its public RPC is our own archive node, so it counts as an owner RPC (`ownArchive`):
  // GULLY_RPC_485590 still overrides it. The explorer is our own (address and token pages; no verification API).
  gully: { id: 485590, name: 'Gully Chain Testnet', explorer: 'https://testnet-explorer.gullychain.xyz', holders: 'own-rpc', testnet: true, ownArchive: true, rpcs: ['https://testnet-rpc.gullychain.xyz'], span: 10_000 },
}
const CHAIN_BY_ID = Object.fromEntries(Object.entries(HOLDER_CHAINS).map(([k, c]) => [c.id, k]))
export const chainKeyOf = (x) => {
  const s = String(x ?? '').toLowerCase()
  if (HOLDER_CHAINS[s]) return s
  return CHAIN_BY_ID[Number(s)] ?? null
}
export const addressUrl = (chainKey, a) => (chainKey === 'solana' ? `https://solscan.io/account/${a}` : `${HOLDER_CHAINS[chainKey].explorer}/address/${a}`)

/** The env var each holder source needs, for operators only (admin health). Never sent to the public. */
const SOURCE_ENV = { blockscout: 'BLOCKSCOUT_API_KEY', moralis: 'MORALIS_API_KEY', 'solana-rpc': 'GULLY_RPC_SOLANA' }
const solanaRpcSet = () => String(process.env.GULLY_RPC_SOLANA ?? '').trim() !== ''

/** The words users see when a chain's holder source is not set up yet: no env names, no jargon. */
export const comingSoonReason = (chainKey) => `Holder history is not available yet on ${HOLDER_CHAINS[chainKey]?.name ?? chainKey}. DeepCore launches already have live maps.`

/**
 * Whether the Holder Map can draw tokens of `kind` on a chain right now.
 *   kind 'stock' (default): an archive-capable RPC of ours is answering (our own Transfer-log index,
 *     holders-logs.mjs), or a fallback is configured (Blockscout key, Moralis key, a private Solana RPC).
 *     Without any, every stock token on that chain is "coming soon".
 *   kind 'deepcore-launch': DeepCore runs on the chain (its own log index; no key needed).
 * Used to keep "coming soon" pages out of the sitemap (seo.mjs) and to hide the bot's "👥 Holders" button.
 */
export function holdersAvailable(chain, kind = 'stock') {
  const ck = chainKeyOf(chain)
  if (!ck) return false
  const c = HOLDER_CHAINS[ck]
  if (kind === 'token') kind = 'stock' // any token follows the same sources as a stock token
  if (kind === 'deepcore-launch') return ck !== 'solana' && !!DEEPCORE_CHAINS[c.id]
  if (c.holders === 'solana-rpc') return solanaRpcSet()
  return archiveKnown(ck) || blockscoutFor(ck) || moralisFor(ck)
}

/**
 * For the Telegram bot: show the "👥 Holders" button for (chain, token)? A tracked stock ticker or token
 * follows its chain's stock source; anything else is a DeepCore launch.
 */
export function holdersButtonVisible(chain, token) {
  const ck = chainKeyOf(chain)
  if (!ck) return false
  return findStock(ck, token) ? holdersAvailable(ck, 'stock') : holdersAvailable(ck, 'deepcore-launch')
}

const blockscoutFor = (ck) => HOLDER_CHAINS[ck]?.holders === 'blockscout' && blockscoutKey() !== ''
const moralisFor = (ck) => !!HOLDER_CHAINS[ck]?.moralis && moralisKey() !== ''

/**
 * Per-chain source health for operators (admin): the source stock maps use now, in order of preference
 * (our own RPC log index on an archive node, then Blockscout, then Moralis), and the fallback's env var.
 */
export function holdersSourceHealth() {
  return Object.entries(HOLDER_CHAINS).map(([key, c]) => {
    const own = key !== 'solana' && archiveKnown(key)
    const active = key === 'solana' ? (solanaRpcSet() ? 'solana-rpc' : 'none') : own ? 'own-rpc' : blockscoutFor(key) ? 'blockscout' : moralisFor(key) ? 'moralis' : 'none'
    const label = { 'own-rpc': 'own RPC (archive)', blockscout: 'Blockscout (fallback)', moralis: 'Moralis (fallback)', 'solana-rpc': 'own Solana RPC', none: key === 'solana' ? 'no Solana RPC set' : 'no archive RPC answering' }[active]
    return { chain: key, name: c.name, source: c.holders, active, label, archive: own, env: key === 'solana' ? SOURCE_ENV['solana-rpc'] : `GULLY_RPC_${c.id}`, fallbackEnv: SOURCE_ENV[c.holders] ?? null, stocks: holdersAvailable(key, 'stock'), launches: holdersAvailable(key, 'deepcore-launch'), tokens: holdersAvailable(key, 'token'), any: key === 'solana' ? (solanaRpcSet() ? 'top' : 'none') : own ? 'full' : blockscoutFor(key) || moralisFor(key) ? 'top' : 'none' }
  })
}

/* ------------------------------------------------------------------ helpers --- */

const lower = (a) => String(a ?? '').toLowerCase()
const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)
export const short = (a) => (a.startsWith('0x') ? `${a.slice(0, 6)}…${a.slice(-4)}` : `${a.slice(0, 4)}…${a.slice(-4)}`)
const topicAddr = (t) => (typeof t === 'string' && t.length === 66 ? '0x' + t.slice(26).toLowerCase() : null)
const hexNum = (h) => (typeof h === 'string' && /^0x[0-9a-f]+$/i.test(h) ? Number(BigInt(h)) : typeof h === 'number' ? h : typeof h === 'string' && /^\d+$/.test(h) ? Number(h) : null)
/** raw / 10^decimals as a Number (display only; ratios use BigInt). */
export function units(raw, decimals) {
  const d = 10n ** BigInt(decimals)
  return Number(raw / d) + Number(raw % d) / Number(d)
}
/** a / b as a percentage with 4 decimals of precision, from BigInts. */
export const pctOf = (a, b) => (b > 0n ? Number((a * 1_000_000n) / b) / 10_000 : null)
const round2 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null)
const fmtPct = (n) => (n === null ? '?' : n >= 10 ? `${Math.round(n)}%` : n >= 1 ? `${n.toFixed(1)}%` : n > 0 ? `${n < 0.1 ? '<0.1' : n.toFixed(1)}%` : '0%')
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** One Transfer log (DeepCore's index or eth_getLogs) to { from, to, value, block, tx, index, ts } or null. */
export function decodeTransfer(log) {
  if (!log || lower(log.topics?.[0]) !== TRANSFER_TOPIC || (log.topics?.length ?? 0) < 3) return null
  const from = topicAddr(log.topics[1])
  const to = topicAddr(log.topics[2])
  const data = String(log.data ?? '')
  if (!from || !to || !/^0x[0-9a-fA-F]{1,64}$/.test(data)) return null
  const ts = hexNum(log.blockTimestamp)
  return { from, to, value: BigInt(data), block: hexNum(log.blockNumber) ?? 0, tx: lower(log.transactionHash), index: hexNum(log.logIndex) ?? 0, ts: ts && ts > 0 ? ts : null }
}

/**
 * Balances from a complete Transfer history, oldest first. Mints (from the zero address) do not debit
 * it; tokens sent to the zero address count as burned (its "balance"). Returns Map address -> BigInt.
 */
export function reconstructBalances(transfers) {
  const bal = new Map()
  for (const t of transfers) {
    if (t.from !== ZERO) bal.set(t.from, (bal.get(t.from) ?? 0n) - t.value)
    bal.set(t.to, (bal.get(t.to) ?? 0n) + t.value)
  }
  return bal
}

/** Union-find clusters over undirected edges [a, b]. Returns arrays of members (size >= 2), largest first. */
export function clusterize(ids, edges) {
  const parent = new Map(ids.map((i) => [i, i]))
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)))
      x = parent.get(x)
    }
    return x
  }
  for (const [a, b] of edges) {
    if (!parent.has(a) || !parent.has(b)) continue
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  const groups = new Map()
  for (const i of ids) {
    const r = find(i)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r).push(i)
  }
  return [...groups.values()].filter((g) => g.length >= 2)
}

/* -------------------------------------------------------------- upstream IO --- */

let fetchImpl = (...a) => globalThis.fetch(...a)
/** Test hook: replace fetch for every upstream call this module makes. */
export const setHoldersFetchForTest = (fn) => {
  fetchImpl = fn ?? ((...a) => globalThis.fetch(...a))
  setGullyFetchForTest(fn)
}

async function getJson(url, headers = {}) {
  try {
    const r = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': UA, ...headers }, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) })
    const body = await r.json().catch(() => null)
    return { ok: r.ok && !!body, status: r.status, body }
  } catch (e) {
    return { ok: false, status: null, body: null, error: String(e?.message ?? e).slice(0, 160) }
  }
}

/* DeepCore: its own per-minute budget, separate from deepcore.mjs's poller and quotes. */
let dcWindow = []
function dcTake() {
  const now = Date.now()
  dcWindow = dcWindow.filter((t) => now - t < 60_000)
  if (dcWindow.length >= DC_PER_MIN) return false
  dcWindow.push(now)
  return true
}
export async function dcGet(p) {
  if (!dcTake()) return { ok: false, status: 429, body: null, error: 'local DeepCore budget spent' }
  return getJson(DC_API() + p)
}

const venueCache = new Map()
/** DeepCore's contracts on a chain (GET /v1/venue/:chainId), cached for an hour; null when unreadable. */
async function readVenue(chainId) {
  const hit = venueCache.get(chainId)
  if (hit && Date.now() - hit.at < 3_600_000) return hit.v
  const r = await dcGet(`/v1/venue/${chainId}`)
  const v = r.ok ? r.body?.data ?? null : null
  if (v) venueCache.set(chainId, { at: Date.now(), v })
  return v ?? hit?.v ?? null
}

/** The DeepCore launch for a token, or null (not a launch) / undefined (DeepCore unreadable). */
export async function readLaunch(chainId, token) {
  const r = await dcGet(`/v1/chains/${chainId}/kit-v2/launches/token/${token}`)
  if (r.status === 404) return null
  if (!r.ok || !r.body?.data) return undefined
  return r.body.data
}

/** Every Transfer of a launch token from DeepCore's index, oldest first. { transfers, complete, toBlock }. */
async function readDeepcoreTransfers(chainId, token, fromBlock) {
  const out = []
  let cursor = null
  let toBlock = null
  for (let page = 0; page < DC_MAX_LOGS / DC_PAGE; page++) {
    const q = `address=${token}&topic0=${TRANSFER_TOPIC}&fromBlock=${fromBlock}&toBlock=latest&limit=${DC_PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const r = await dcGet(`/v1/chains/${chainId}/logs?${q}`)
    if (!r.ok || !Array.isArray(r.body?.data?.logs)) return { transfers: null, complete: false, error: r.status === 422 ? 'DeepCore does not index this token' : 'DeepCore log index unreadable' }
    toBlock ??= hexNum(r.body.data.toBlock)
    for (const l of r.body.data.logs) {
      const t = decodeTransfer(l)
      if (t) out.push(t)
    }
    if (!r.body.page?.hasMore) return { transfers: out, complete: true, toBlock, toBlockAt: r.body.provenance?.toBlockTimestamp ?? null }
    cursor = r.body.page.nextCursor
    if (!cursor) break
  }
  return { transfers: null, complete: false, error: `more than ${DC_MAX_LOGS.toLocaleString('en-US')} transfers` }
}

/* EVM RPC with failover: GULLY_RPC_<chainId> first, then the defaults; a failing URL cools off. */
const cooling = new Map()
function rpcUrls(chainKey) {
  const c = HOLDER_CHAINS[chainKey]
  const env = String(process.env[`GULLY_RPC_${c.id}`] ?? '').split(',').map((u) => u.trim()).filter(Boolean)
  const all = [...new Set([...env, ...c.rpcs])]
  const now = Date.now()
  return [...all.filter((u) => (cooling.get(u) ?? 0) <= now), ...all.filter((u) => (cooling.get(u) ?? 0) > now)]
}
async function rpcPost(url, body) {
  const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j = await r.json().catch(() => null)
  if (!j) throw new Error('not JSON')
  return j
}
/** The chain's RPC URLs in failover order (GULLY_RPC_<chainId> first; cooling ones last). */
export const rpcUrlList = (chainKey) => rpcUrls(chainKey)
/** The URLs the owner configured (GULLY_RPC_<chainId>, comma-separated): the only ones probed for archive use.
    A chain we run ourselves (`ownArchive`, Gully Chain) counts its default RPCs as configured when the env is unset. */
export const rpcEnvUrls = (chainKey) => {
  const c = HOLDER_CHAINS[chainKey]
  if (!c) return []
  const env = String(process.env[`GULLY_RPC_${c.id}`] ?? '').split(',').map((u) => u.trim()).filter(Boolean)
  return env.length || !c.ownArchive ? env : [...c.rpcs]
}
/** One call on one URL; a JSON-RPC error is thrown with the node's own message. */
export async function rpcAt(url, method, params) {
  const j = await rpcPost(url, { jsonrpc: '2.0', id: 1, method, params })
  if (j.error) throw Object.assign(new Error(String(j.error.message ?? 'RPC error').slice(0, 200)), { rpc: true })
  if (!('result' in j)) throw new Error('no result')
  return j.result
}
/** One call. A JSON-RPC error (a range or result-size limit, say) is thrown as is without cooling the node. */
export async function evmRpc(chainKey, method, params) {
  let last
  for (const url of rpcUrls(chainKey)) {
    try {
      const j = await rpcPost(url, { jsonrpc: '2.0', id: 1, method, params })
      if (j.error) {
        last = Object.assign(new Error(String(j.error.message ?? 'RPC error').slice(0, 160)), { rpc: true })
        continue
      }
      if (!('result' in j)) throw new Error('no result')
      return j.result
    } catch (e) {
      last = e
      if (!e.rpc) cooling.set(url, Date.now() + 60_000)
    }
  }
  throw last ?? new Error('no RPC')
}
/** Several calls in one batch; results in order (null where a call failed). */
export async function evmBatch(chainKey, calls) {
  if (!calls.length) return []
  for (const url of rpcUrls(chainKey)) {
    try {
      const j = await rpcPost(url, calls.map(([method, params], id) => ({ jsonrpc: '2.0', id, method, params })))
      if (!Array.isArray(j)) throw new Error('not a batch')
      const by = new Map(j.map((r) => [r.id, r]))
      return calls.map((_, i) => (by.get(i)?.error ? null : (by.get(i)?.result ?? null)))
    } catch {
      cooling.set(url, Date.now() + 60_000)
    }
  }
  return calls.map(() => null)
}

/**
 * The latest Transfer logs of a token over our RPCs, newest blocks first, bounded by RECENT_MAX_LOGS and
 * RECENT_MAX_CALLS. The span shrinks when a node refuses a range and grows while answers are small.
 * Returns { transfers (oldest first), fromBlock, toBlock, complete } or null when nothing could be read.
 */
export async function readRecentTransfers(chainKey, token) {
  const c = HOLDER_CHAINS[chainKey]
  let head
  try {
    head = hexNum(await evmRpc(chainKey, 'eth_blockNumber', []))
  } catch {
    return null
  }
  if (!head) return null
  let span = c.span
  let to = head
  const got = []
  let lowest = head + 1
  for (let calls = 0; calls < RECENT_MAX_CALLS && got.length < RECENT_MAX_LOGS && to >= 0; calls++) {
    const from = Math.max(0, to - span + 1)
    try {
      const logs = await evmRpc(chainKey, 'eth_getLogs', [{ address: token, topics: [TRANSFER_TOPIC], fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }])
      if (!Array.isArray(logs)) throw new Error('not a list')
      for (const l of logs) {
        const t = decodeTransfer(l)
        if (t) got.push(t)
      }
      lowest = from
      to = from - 1
      if (logs.length < RECENT_MAX_LOGS / 4) span *= 2
    } catch {
      span = Math.floor(span / 4)
      if (span < 50) break
    }
  }
  if (lowest > head) return null
  got.sort((a, b) => a.block - b.block || a.index - b.index)
  return { transfers: got, fromBlock: lowest, toBlock: head, complete: lowest === 0 }
}

/** Block timestamps (unix seconds) for a few blocks, in one batch. Map block -> seconds. */
async function blockTimes(chainKey, blocks) {
  const list = [...new Set(blocks)].slice(0, 30)
  const res = await evmBatch(chainKey, list.map((b) => ['eth_getBlockByNumber', ['0x' + b.toString(16), false]]))
  const out = new Map()
  list.forEach((b, i) => {
    const ts = hexNum(res[i]?.timestamp)
    if (ts) out.set(b, ts)
  })
  return out
}

/** Which addresses have contract code (true), are plain wallets (false) or are unknown (missing). */
export async function readCode(chainKey, addrs) {
  const res = await evmBatch(chainKey, addrs.map((a) => ['eth_getCode', [a, 'latest']]))
  const out = new Map()
  addrs.forEach((a, i) => {
    if (typeof res[i] === 'string') out.set(a, res[i] !== '0x' && res[i] !== '0x0')
  })
  return out
}

/** totalSupply() over RPC, or null. */
async function readSupply(chainKey, token) {
  try {
    const r = await evmRpc(chainKey, 'eth_call', [{ to: token, data: '0x18160ddd' }, 'latest'])
    return typeof r === 'string' && /^0x[0-9a-f]{1,64}$/i.test(r) ? BigInt(r) : null
  } catch {
    return null
  }
}

/** Top holders from Blockscout's PRO API (two pages of 50). { holders: [{address, raw}], count } or an error. */
async function readBlockscoutHolders(chainKey, token, want = 50) {
  const key = blockscoutKey()
  if (!key) return { error: 'no-key' }
  const base = `${BLOCKSCOUT_API()}/${HOLDER_CHAINS[chainKey].id}/api/v2/tokens/${token}`
  const info = await getJson(`${base}?apikey=${encodeURIComponent(key)}`)
  const holders = []
  let next = ''
  for (let page = 0; page < Math.ceil(want / 50); page++) {
    const r = await getJson(`${base}/holders?apikey=${encodeURIComponent(key)}${next}`)
    if (!r.ok || !Array.isArray(r.body?.items)) return holders.length ? { holders, count: null } : { error: `Blockscout answered ${r.status ?? 'nothing'}` }
    for (const it of r.body.items) if (isAddr(it?.address?.hash) && /^\d+$/.test(String(it.value))) holders.push({ address: lower(it.address.hash), raw: BigInt(it.value), contract: typeof it.address.is_contract === 'boolean' ? it.address.is_contract : undefined, name: it.address.name ?? null })
    const p = r.body.next_page_params
    if (!p) break
    next = '&' + new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)])).toString()
  }
  const count = Number(info.body?.holders_count ?? info.body?.holders)
  const supply = /^\d+$/.test(String(info.body?.total_supply ?? '')) ? BigInt(info.body.total_supply) : null
  return { holders, count: Number.isFinite(count) ? count : null, supply }
}

/** Top holders from Moralis (pages of 100). Moralis also names known entities (exchanges among them). */
async function readMoralisHolders(chainKey, token, want = 100) {
  const key = moralisKey()
  if (!key) return { error: 'no-key' }
  const items = []
  let cursor = null
  for (let page = 0; page < Math.ceil(want / 100); page++) {
    const r = await getJson(`${MORALIS_API()}/erc20/${token}/owners?chain=${HOLDER_CHAINS[chainKey].moralis}&order=DESC&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { 'X-API-Key': key })
    if (!r.ok || !Array.isArray(r.body?.result)) {
      if (items.length) break
      return { error: `Moralis answered ${r.status ?? 'nothing'}` }
    }
    items.push(...r.body.result)
    cursor = r.body.cursor
    if (!cursor) break
  }
  const holders = items.filter((it) => isAddr(it?.owner_address) && /^\d+$/.test(String(it.balance))).map((it) => ({ address: lower(it.owner_address), raw: BigInt(it.balance), contract: typeof it.is_contract === 'boolean' ? it.is_contract : undefined, name: it.owner_address_label ?? it.entity ?? null, entity: it.entity ?? null }))
  return { holders, count: null }
}

/** The latest transfers from Moralis (BNB Chain has no public log RPC). Oldest first. */
async function readMoralisTransfers(chainKey, token) {
  const key = moralisKey()
  if (!key) return null
  const r = await getJson(`${MORALIS_API()}/erc20/${token}/transfers?chain=${HOLDER_CHAINS[chainKey].moralis}&order=DESC&limit=100`, { 'X-API-Key': key })
  if (!r.ok || !Array.isArray(r.body?.result)) return null
  const transfers = r.body.result
    .filter((t) => isAddr(t?.from_address) && isAddr(t?.to_address) && /^\d+$/.test(String(t.value)))
    .map((t) => ({ from: lower(t.from_address), to: lower(t.to_address), value: BigInt(t.value), block: Number(t.block_number) || 0, tx: lower(t.transaction_hash), index: Number(t.log_index) || 0, ts: Date.parse(t.block_timestamp) / 1000 || null }))
    .reverse()
  if (!transfers.length) return null
  return { transfers, fromBlock: transfers[0].block, toBlock: transfers[transfers.length - 1].block, complete: false }
}

/** Solana: the 20 largest token accounts, merged by owner; off-curve owners are program accounts. */
async function readSolanaHolders(mint) {
  let supply, largest
  try {
    ;[supply, largest] = await Promise.all([solanaRpc('getTokenSupply', [mint]), solanaRpc('getTokenLargestAccounts', [mint])])
  } catch (e) {
    return { error: 'solana-rpc', detail: String(e?.message ?? e).slice(0, 80) }
  }
  const list = Array.isArray(largest?.value) ? largest.value.filter((a) => isSolanaAddress(a?.address) && /^\d+$/.test(String(a.amount))) : []
  if (!list.length) return { error: 'Solana RPC returned no holders' }
  let owners
  try {
    const r = await solanaRpc('getMultipleAccounts', [list.map((a) => a.address), { encoding: 'jsonParsed' }])
    owners = (r?.value ?? []).map((a) => a?.data?.parsed?.info?.owner ?? null)
  } catch {
    owners = list.map(() => null)
  }
  const by = new Map()
  list.forEach((a, i) => {
    const owner = isSolanaAddress(owners[i]) ? owners[i] : a.address
    const prev = by.get(owner)
    by.set(owner, { address: owner, raw: (prev?.raw ?? 0n) + BigInt(a.amount), contract: (() => { try { return !isOnCurve(b58decode(owner)) } catch { return undefined } })() })
  })
  const supplyRaw = /^\d+$/.test(String(supply?.value?.amount ?? '')) ? BigInt(supply.value.amount) : null
  const full = await readSolanaAllHolders(mint)
  if (full) return { holders: full, count: full.length, supply: supplyRaw, decimals: supply?.value?.decimals ?? null, partial: null }
  return { holders: [...by.values()], count: null, supply: supplyRaw, decimals: supply?.value?.decimals ?? null, partial: 'top 20 token accounts' }
}

/**
 * Every token account of a mint (getProgramAccounts filtered by the mint, under its own token program:
 * SPL Token or Token-2022), merged by owner, biggest first. Null when the RPC does not allow the call
 * (many public ones refuse it), so the caller keeps the top-20 view.
 */
export async function readSolanaAllHolders(mint) {
  try {
    const info = await solanaRpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }])
    const program = info?.value?.owner
    if (!isSolanaAddress(program)) return null
    const filters = [{ memcmp: { offset: 0, bytes: mint } }, ...(program === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' ? [{ dataSize: 165 }] : [])]
    const accts = await solanaRpc('getProgramAccounts', [program, { encoding: 'jsonParsed', filters }])
    if (!Array.isArray(accts)) return null
    const by = new Map()
    for (const a of accts) {
      const t = a?.account?.data?.parsed?.info
      const owner = t?.owner
      const amount = t?.tokenAmount?.amount
      if (!isSolanaAddress(owner) || !/^\d+$/.test(String(amount ?? '')) || amount === '0') continue
      const prev = by.get(owner)
      by.set(owner, { address: owner, raw: (prev?.raw ?? 0n) + BigInt(amount), contract: (() => { try { return !isOnCurve(b58decode(owner)) } catch { return undefined } })() })
    }
    if (!by.size) return null
    return [...by.values()].sort((a, b) => (b.raw > a.raw ? 1 : b.raw < a.raw ? -1 : 0))
  } catch {
    return null
  }
}

/** Public name tags from Blockscout's free metadata service: Map address -> { name, exchange }. */
async function readNameTags(chainId, addrs) {
  if (!addrs.length || typeof chainId !== 'number') return new Map()
  const r = await getJson(`${BLOCKSCOUT_META()}/api/v1/metadata?addresses=${addrs.join(',')}&chainId=${chainId}`)
  const out = new Map()
  for (const [a, v] of Object.entries(r.body?.addresses ?? {})) {
    const tags = Array.isArray(v?.tags) ? v.tags : []
    const name = tags.find((t) => t?.tagType === 'name')?.name
    if (!name) continue
    out.set(lower(a), { name: String(name).slice(0, 48), exchange: tags.some((t) => /exchange|cex/i.test(String(t?.slug ?? ''))) || EXCHANGE_RE.test(String(name)) })
  }
  return out
}
const EXCHANGE_RE = /\b(binance|coinbase|okx|bybit|kraken|kucoin|gate\.io|bitget|mexc|htx|huobi|crypto\.com|bitfinex|upbit|bitstamp)\b/i

/* ------------------------------------------------------------------ labels --- */

/** Label kinds, in legend order: what each means in plain words. */
export const LABEL_KINDS = {
  deployer: 'Deployer (created the launch)',
  pool: 'Trading pool',
  lock: 'Liquidity or token lock',
  burn: 'Burned (no one can spend it)',
  token: 'The token’s own contract',
  deepcore: 'DeepCore contract',
  router: 'Swap router',
  gully: 'Gully Labs contract',
  exchange: 'Exchange',
  known: 'Known address or .gully name',
}
/** Kinds that are infrastructure, not people: never clustered, never counted as wallets. */
const INFRA = new Set(['pool', 'lock', 'burn', 'token', 'deepcore', 'router', 'gully', 'exchange'])

/** Uniswap v4 PoolManagers hold the tokens of v4 pools (Peddles and others): pools, not wallets. */
const UNIV4_POOL_MANAGERS = { 4663: '0x8366a39CC670B4001A1121B8F6A443A643e40951', 8453: '0x498581fF718922c3f8e6A244956aF099B2652b2b', 56: '0x28e2Ea090877bF75740558f6BFB36A5ffeE9e9dF' }

/** Gully Chain Testnet's own infrastructure (gully-ops/l3; the same addresses as Gully Street's config): the
    launchpad's bonding curve holds a launch's unsold supply, the LP locker holds graduated liquidity. */
export const GULLY_CHAIN_LABELS = {
  485590: [
    // Every launchpad deployment and locker (server/gully-chain.mjs LAUNCHPADS, from gully-ops/l3/generated/launchpad.json).
    ...GULLY_LAUNCHPADS.map((l) => [l.address, 'pool', `Gully launchpad v${l.version} (bonding curve)`]),
    ...GULLY_LAUNCHPADS.filter((l) => l.locker).map((l) => [l.locker, 'lock', `Gully LP locker v${l.lockerVersion}`]),
    [GULLY_CHAIN.swapRouter, 'router', 'Gully Swap router'],
    [GULLY_CHAIN.v3Router, 'router', 'Gully Swap (v3 router)'],
    [GULLY_CHAIN.positionManager, 'pool', 'Gully Swap positions'],
    [GULLY_CHAIN.weth, 'token', 'Wrapped ETH'],
    [GULLY_CHAIN.glusdPsm, 'gully', 'glUSD PSM'],
  ],
}
/** The v3 factory whose pools are labelled as pools on Gully Chain (factory() of a holder contract). */
const GULLY_V3_FACTORY = { 485590: '0x1787a3ba8c8d7a2439cfa2efafc683ecac623950' }

/**
 * Gully Swap pools among a Gully Chain token's holder contracts: a contract whose factory() is Gully Swap's v3
 * factory is a pool, not a wallet. Bounded (at most 20 contracts, one batch). Mutates `labels`.
 */
export async function labelGullyPools(chainKey, contractAddrs, labels) {
  const factory = GULLY_V3_FACTORY[HOLDER_CHAINS[chainKey]?.id]
  const cands = factory ? contractAddrs.filter((a) => !labels.has(a)).slice(0, 20) : []
  if (!cands.length) return
  const res = await evmBatch(chainKey, cands.map((a) => ['eth_call', [{ to: a, data: '0xc45a0155' }, 'latest']]))
  cands.forEach((a, i) => {
    if (typeof res[i] === 'string' && res[i].length === 66 && `0x${res[i].slice(26)}`.toLowerCase() === factory) labels.set(a, { kind: 'pool', name: 'Gully Swap pool' })
  })
}

/** Fixed labels for a chain and token: Map address -> { kind, name }. */
export function staticLabels({ chainKey, token, venue, launch, trackerPool }) {
  const m = new Map()
  const put = (a, kind, name) => isAddr(a) && !m.has(lower(a)) && m.set(lower(a), { kind, name })
  put(ZERO, 'burn', 'Burn (zero address)')
  put(DEAD, 'burn', 'Burn (dead address)')
  put(token, 'token', 'Token contract')
  if (venue) {
    put(venue.vault, 'pool', 'DeepCore pools (vault)')
    for (const a of Object.values(venue.poolManagers ?? {})) put(a, 'pool', 'DeepCore pool manager')
    for (const a of Object.values(venue.routers ?? {})) put(a, 'router', 'DeepCore router')
    for (const a of venue.launchpadKitsV2 ?? []) put(a, 'deepcore', 'DeepCore launch kit')
    put(venue.launchpadKitV2, 'deepcore', 'DeepCore launch kit')
    for (const a of Object.values(venue.registries ?? {})) put(a, 'deepcore', 'DeepCore registry')
  }
  for (const g of launch?.legs ?? []) {
    put(g?.lock?.locker, 'lock', 'DeepCore launch lock')
    put(g?.launchFee?.guard, 'deepcore', 'DeepCore launch guard')
  }
  put(UNIV4_POOL_MANAGERS[HOLDER_CHAINS[chainKey]?.id], 'pool', 'Uniswap v4 PoolManager (pools)')
  for (const [a, kind, name] of GULLY_CHAIN_LABELS[HOLDER_CHAINS[chainKey]?.id] ?? []) put(a, kind, name)
  const reg = FEE_PROXY_REGISTRY[HOLDER_CHAINS[chainKey]?.id]
  for (const a of [...(reg?.erc20 ?? []), ...(reg?.native ?? [])]) put(a, 'gully', 'Gully Pay fee proxy')
  if (isAddr(trackerPool?.pair)) put(trackerPool.pair, 'pool', `Trading pool${trackerPool.dex ? ` (${trackerPool.dex})` : ''}`)
  if (chainKey === 'solana' && process.env.JUPITER_FEE_ACCOUNT) m.set(process.env.JUPITER_FEE_ACCOUNT, { kind: 'gully', name: 'Gully swap fee account' })
  return m
}

/* --------------------------------------------------------------- the map --- */

/**
 * What a transfer was, from the labels: 'buy' (a pool or router paid a wallet), 'sell' (a wallet paid a pool or router),
 * 'mint' (from the zero address), 'burn' (to a burn address), else 'transfer'. Pure.
 */
export function flowSide(from, to, labelOf) {
  const k = (a) => labelOf(a)?.kind ?? null
  const venue = (a) => k(a) === 'pool' || k(a) === 'router'
  const infra = (a) => INFRA.has(k(a))
  if (from === ZERO) return 'mint'
  if (k(to) === 'burn' || to === DEAD) return 'burn'
  // Seeding a pool from the launch kit, or a pool paying a router, is plumbing: a transfer, not a trade.
  if (venue(from) && !infra(to)) return 'buy'
  if (venue(to) && !infra(from)) return 'sell'
  return 'transfer'
}

/**
 * The latest transfers as flows for the map to replay on load: [{ from, to, side, pct, units, block, at, tx }],
 * oldest first, at most RECENT_FLOWS. Straight from the transfers that were read (never invented); `at` is
 * null when the log carried no time.
 */
export function recentFlowsOf({ transfers, labels, total, decimals, times = new Map(), max = RECENT_FLOWS }) {
  if (!Array.isArray(transfers) || !transfers.length) return []
  return transfers.slice(-max).map((t) => {
    const ts = t.ts ?? times.get(t.block) ?? null
    return {
      from: t.from,
      to: t.to,
      side: flowSide(t.from, t.to, (a) => labels.get(a)),
      pct: total > 0n ? pctOf(t.value, total) : null,
      units: units(t.value, decimals),
      block: t.block,
      at: ts ? new Date(ts * 1000).toISOString() : null,
      tx: t.tx ?? null,
    }
  })
}

/**
 * Builds the map from what was read. Pure (no IO), so the tests drive it directly.
 *   holders   [{ address, raw, contract? }] or null (when `history` is complete, balances come from it)
 *   history   { transfers (oldest first), complete, fromBlock, toBlock } or null
 *   labels    Map address -> { kind, name }
 *   supply    BigInt total supply (null: shares are of the listed holders' total, and say so)
 *   launch    DeepCore launch (raw API item) or null; enables the forensics
 *   funding   { checked, recipients: [address], reason } native-coin funding by the deployer, or null
 *   fair      tracker row for a stock (fair, onchain, gapPct, status) or null; history: [t, gap, onchain, fair][]
 */
export function buildMap({ chainKey, token, symbol, name, decimals, kind, holders, history, labels, supply, holderCount = null, launch = null, funding = null, fair = null, fairHistory = [], times = new Map(), sources, partial = null, coverage = null, tier = 'pro', balancesFrom = null, codeOf = new Map(), now = Date.now() }) {
  const { list: listMax, graph: graphMax } = TIERS[tier] ?? TIERS.free
  const lbl = new Map(labels)
  // 1. Balances: exact from a complete history, else the holder API's list.
  let balances
  const fromHistory = balancesFrom ? balancesFrom === 'history' : !!history?.complete && !holders?.length
  if (fromHistory) balances = reconstructBalances(history.transfers)
  else balances = new Map((holders ?? []).map((h) => [h.address, h.raw]))
  const positive = [...balances].filter(([a, v]) => v > 0n && a !== ZERO)
  const burnedZero = balances.get(ZERO) > 0n ? balances.get(ZERO) : 0n
  if (burnedZero > 0n) positive.push([ZERO, burnedZero])
  positive.sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
  const total = supply && supply > 0n ? supply : positive.reduce((s, [, v]) => s + v, 0n)
  const totalKnown = !!(supply && supply > 0n)
  const deployer = launch?.creator ? lower(launch.creator) : null
  if (deployer && !lbl.has(deployer)) lbl.set(deployer, { kind: 'deployer', name: 'Deployer' })

  const top = positive.slice(0, listMax)
  const ids = top.map(([a]) => a)
  const idSet = new Set(ids)
  const contractOf = new Map((holders ?? []).filter((h) => typeof h.contract === 'boolean').map((h) => [h.address, h.contract]))
  const isInfra = (a) => INFRA.has(lbl.get(a)?.kind)

  // 2. Links: direct transfers between mapped, unlabelled holders.
  const linkMap = new Map()
  for (const t of history?.transfers ?? []) {
    if (t.from === t.to || !idSet.has(t.from) || !idSet.has(t.to) || isInfra(t.from) || isInfra(t.to)) continue
    const k = t.from < t.to ? `${t.from}|${t.to}` : `${t.to}|${t.from}`
    const l = linkMap.get(k) ?? { source: t.from < t.to ? t.from : t.to, target: t.from < t.to ? t.to : t.from, transfers: 0, raw: 0n, kind: 'transfer' }
    l.transfers++
    l.raw += t.value
    linkMap.set(k, l)
  }

  // 3. DeepCore launch forensics (complete history only).
  let forensics = null
  const flags = new Map(ids.map((a) => [a, []]))
  const flag = (a, f) => flags.has(a) && !flags.get(a).includes(f) && flags.get(a).push(f)
  if (launch && fromHistory) {
    const poolSet = new Set([...lbl].filter(([, v]) => v.kind === 'pool').map(([a]) => a))
    // Another launchpad's token may have no creation block: the first Transfer is the launch then.
    const launchBlock = hexNum(launch.createdAt?.blockNumber) ?? (launch.venue ? (history?.transfers?.[0]?.block ?? null) : null)
    const byTx = new Map()
    for (const t of history?.transfers ?? []) {
      if (!byTx.has(t.tx)) byTx.set(t.tx, [])
      byTx.get(t.tx).push(t)
    }
    // A buy: the pool paid tokens out in that transaction; the unlabelled wallets that received tokens in it bought.
    const firstBuy = new Map()
    let firstTradeBlock = null
    for (const list of byTx.values()) {
      if (!list.some((t) => poolSet.has(t.from))) continue
      const blk = list[0].block
      // The seeding transaction (the kit filling the pool at creation) is not a trade.
      if (blk === launchBlock && list.some((t) => poolSet.has(t.to) && lbl.get(t.from)?.kind === 'deepcore')) continue
      for (const t of list) {
        if (isInfra(t.to) || t.to === ZERO || poolSet.has(t.to)) continue
        if (!firstBuy.has(t.to) || firstBuy.get(t.to) > blk) firstBuy.set(t.to, blk)
        if (firstTradeBlock === null || blk < firstTradeBlock) firstTradeBlock = blk
      }
    }
    // Bundled: two or more wallets buying in the very first block of trading (or in the launch block itself),
    // the pattern of one team splitting a launch buy across wallets. A lone first buyer is just the first buyer.
    const firstBlockBuyers = [...firstBuy].filter(([, b]) => b === firstTradeBlock || b === launchBlock).map(([a]) => a)
    const bundledSet = firstBlockBuyers.length >= 2 ? firstBlockBuyers : []
    // Snipers: wallets whose first buy came in the first SNIPER_BLOCKS blocks of trading.
    const sniperSet = firstTradeBlock === null ? [] : [...firstBuy].filter(([, b]) => b <= firstTradeBlock + SNIPER_BLOCKS - 1).map(([a]) => a)
    for (const a of sniperSet) flag(a, 'sniper')
    const sniperRaw = sniperSet.reduce((s, a) => s + (balances.get(a) > 0n ? balances.get(a) : 0n), 0n)
    const bundledRaw = bundledSet.reduce((s, a) => s + (balances.get(a) > 0n ? balances.get(a) : 0n), 0n)
    for (const a of bundledSet) flag(a, 'bundled')
    // Funding: tokens sent by the deployer to wallets, and (when checked) the deployer's coin transfers.
    const tokenFunded = new Set()
    if (deployer) for (const t of history?.transfers ?? []) if (t.from === deployer && !isInfra(t.to) && t.to !== ZERO && t.to !== deployer) tokenFunded.add(t.to)
    const coinFunded = new Set((funding?.recipients ?? []).map(lower).filter((a) => a !== deployer && !isInfra(a)))
    const funded = new Set([...tokenFunded, ...coinFunded])
    for (const a of funded) {
      flag(a, 'funded-by-deployer')
      if (deployer && idSet.has(a) && idSet.has(deployer)) {
        const k = deployer < a ? `${deployer}|${a}` : `${a}|${deployer}`
        const l = linkMap.get(k) ?? { source: deployer, target: a, transfers: 0, raw: 0n, kind: 'funding' }
        l.kind = 'funding'
        linkMap.set(k, l)
      }
    }
    if (deployer) flag(deployer, 'deployer')
    const fundedRaw = [...funded].reduce((s, a) => s + (balances.get(a) > 0n ? balances.get(a) : 0n), 0n)
    const deployerRaw = deployer && balances.get(deployer) > 0n ? balances.get(deployer) : 0n
    const legs = Array.isArray(launch.legs) ? launch.legs : []
    const locked = legs.some((g) => g?.lock?.status === 'indexed') ? true : legs.length && legs.every((g) => g?.lock === null) ? false : null
    const bundledPct = pctOf(bundledRaw, total)
    forensics = {
      deployer,
      launchBlock,
      firstTradeBlock,
      bundled: { wallets: bundledSet.length, pct: round2(bundledPct), firstBlockBuyers: firstBlockBuyers.length },
      funded: { wallets: funded.size, pct: round2(pctOf(fundedRaw, total)), coinChecked: !!funding?.checked, coinNote: funding?.reason ?? null },
      deployerPct: deployer ? round2(pctOf(deployerRaw, total)) : null,
      liquidity: { locked, locker: legs.find((g) => g?.lock?.locker)?.lock?.locker ?? null, since: legs.find((g) => g?.lock?.lockedAt)?.lock?.lockedAt?.blockTimestamp ?? null },
      buyers: firstBuy.size,
      snipers: { wallets: sniperSet.length, pct: round2(pctOf(sniperRaw, total)), blocks: SNIPER_BLOCKS },
    }
    forensics.riskLine =
      firstTradeBlock === null
        ? 'No trades yet: nobody has bought from the pool.'
        : bundledSet.length
          ? `${plural(bundledSet.length, 'wallet')} bought in the first block of trading and ${bundledSet.length === 1 ? 'holds' : 'hold'} ${fmtPct(bundledPct)} now.`
          : `No bundled buying: ${firstBlockBuyers.length === 1 ? 'one wallet' : 'no wallet'} bought in the first block of trading.`
  }

  // 4. Clusters over unlabelled holders.
  const people = ids.filter((a) => !isInfra(a))
  const groups = clusterize(people, [...linkMap.values()].map((l) => [l.source, l.target]))
  const sumRaw = (list) => list.reduce((s, a) => s + (balances.get(a) > 0n ? balances.get(a) : 0n), 0n)
  const clusters = groups
    .map((g) => ({ wallets: g, raw: sumRaw(g) }))
    .sort((a, b) => (b.raw > a.raw ? 1 : b.raw < a.raw ? -1 : 0))
    .map((c, i) => ({ id: `c${i + 1}`, wallets: c.wallets, count: c.wallets.length, pct: round2(pctOf(c.raw, total)), hasDeployer: !!deployer && c.wallets.includes(deployer) }))
  const clusterOf = new Map(clusters.flatMap((c) => c.wallets.map((a) => [a, c.id])))

  // Hidden links: a plain wallet (code checked: no contract) outside the map that received from or sent to
  // mapped wallets of two different groups. Drawn only when it really joins two groups; hubs with more than
  // HIDDEN_MAX_PEERS counterparties (likely a service) are left out.
  const hidden = []
  const viaLinks = []
  const groupOf = (a) => clusterOf.get(a) ?? a
  for (const [x, peers] of hiddenPeers(history?.transfers ?? [], new Set(people), lbl)) {
    if (codeOf.get(x) !== false) continue
    const mapped = [...peers.mapped]
    const groups = [...new Set(mapped.map(groupOf))]
    if (groups.length < 2) continue
    const a = mapped.find((m) => groupOf(m) === groups[0])
    const b = mapped.find((m) => groupOf(m) === groups[1])
    hidden.push({ via: x, short: short(x), url: addressUrl(chainKey, x), connects: [a, b], transfers: peers.transfers })
    for (const m of mapped) viaLinks.push(peers.sentTo.has(m) ? { source: x, target: m, transfers: 1, pct: null, kind: 'via' } : { source: m, target: x, transfers: 1, pct: null, kind: 'via' })
    if (hidden.length >= HIDDEN_MAX) break
  }

  // 5. Fair-price overlay (stocks): what the holdings are worth at the real share price and at the pool's.
  const trustedGap = fair && typeof fair.gapPct === 'number' && ['premium', 'discount', 'drifting', 'in-line'].includes(fair.status)
  const costs = buyCosts({ transfers: history?.transfers ?? [], labels: lbl, ids: idSet, fairHistory, times })
  const nodes = top.map(([a, raw], i) => {
    const u = units(raw, decimals)
    const n = {
      id: a,
      short: short(a),
      rank: i + 1,
      balance: u,
      pct: round2(pctOf(raw, total)),
      label: lbl.get(a) ?? null,
      contract: contractOf.get(a) ?? null,
      cluster: clusterOf.get(a) ?? null,
      flags: flags.get(a) ?? [],
      url: addressUrl(chainKey, a),
    }
    if (fair && typeof fair.fair === 'number') {
      n.valueAtFairUsd = Math.round(u * fair.fair)
      n.premiumUsd = trustedGap && typeof fair.onchain === 'number' ? Math.round(u * (fair.onchain - fair.fair)) : null
      n.boughtGapPct = costs.get(a)?.gapPct ?? null
    }
    return n
  })

  // 6. Concentration in words.
  const wallets = nodes.filter((n) => !INFRA.has(n.label?.kind))
  const top10Raw = sumRaw(wallets.slice(0, 10).map((n) => n.id))
  const top10Pct = round2(pctOf(top10Raw, total))
  const biggest = clusters[0] ?? null
  const line = `Top 10 wallets hold ${fmtPct(top10Pct)}${biggest ? `; the largest connected cluster holds ${fmtPct(biggest.pct)} across ${biggest.count} wallets` : '; no connected wallets found among them'}.`
  const plain = []
  plain.push(`The 10 biggest wallets (not counting pools, locks, burn and exchanges) own ${fmtPct(top10Pct)} of ${totalKnown ? 'all' : 'the listed'} ${symbol ?? 'tokens'}.`)
  if (biggest) plain.push(`${biggest.count} of the biggest wallets have sent ${symbol ?? 'tokens'} to each other${biggest.hasDeployer ? ', including the deployer' : ''}: together they hold ${fmtPct(biggest.pct)}. Wallets that trade with each other are often one person or team.`)
  else if (history?.transfers?.length) plain.push('None of the biggest wallets sent tokens to each other in the transfers we read.')
  if (forensics) {
    plain.push(forensics.riskLine)
    if (forensics.deployerPct !== null) plain.push(forensics.deployerPct > 0 ? `The deployer still holds ${fmtPct(forensics.deployerPct)}.` : 'The deployer holds none now.')
    if (forensics.funded.wallets) plain.push(`${plural(forensics.funded.wallets, 'wallet')} got ${forensics.funded.coinChecked ? 'coins or tokens' : 'tokens'} from the deployer and hold ${fmtPct(forensics.funded.pct)}.`)
    const vn = launch.venueName ?? 'DeepCore'
    plain.push(forensics.liquidity.locked === true ? 'The launch liquidity sits in DeepCore’s launch lock.' : forensics.liquidity.locked === false ? 'DeepCore shows no lock on the launch liquidity.' : `${vn} does not say whether the liquidity is locked.`)
  }
  if (launch && !fromHistory && launch.venue) plain.push('The full transfer history of this launch is not available, so bundled buying and deployer funding were not checked.')
  else if (launch && !fromHistory) {
    plain.push('This launch has too many transfers to replay here, so bundled buying and deployer funding were not checked.')
    const legs = Array.isArray(launch.legs) ? launch.legs : []
    plain.push(legs.some((g) => g?.lock?.status === 'indexed') ? 'The launch liquidity sits in DeepCore’s launch lock.' : 'DeepCore does not say whether the liquidity is locked.')
  }
  const burnPct = round2(pctOf(nodes.filter((n) => n.label?.kind === 'burn').reduce((s, n) => s + (balances.get(n.id) ?? 0n), 0n), total))
  if (burnPct) plain.push(`${fmtPct(burnPct)} has been burned.`)
  let fairSummary = null
  if (fair && typeof fair.fair === 'number') {
    const top10 = wallets.slice(0, 10)
    const atFair = top10.reduce((s, n) => s + (n.valueAtFairUsd ?? 0), 0)
    const prem = trustedGap ? top10.reduce((s, n) => s + (n.premiumUsd ?? 0), 0) : null
    const paid = [...costs.values()]
    const paidGap = paid.length ? round2(paid.reduce((s, c) => s + c.gapPct * c.units, 0) / paid.reduce((s, c) => s + c.units, 0)) : null
    fairSummary = { fair: fair.fair, onchain: fair.onchain ?? null, gapPct: trustedGap ? fair.gapPct : null, status: fair.status, top10ValueAtFairUsd: atFair, top10PremiumUsd: prem, buyersAvgGapPct: paidGap, buyers: paid.length }
    if (trustedGap) plain.push(`At the real share price the top 10 wallets hold about $${Math.round(atFair).toLocaleString('en-US')}; the token trades ${Math.abs(fair.gapPct).toFixed(2)}% ${fair.gapPct >= 0 ? 'above' : 'below'} it, so they sit on ${fair.gapPct >= 0 ? 'a premium' : 'a discount'} of about $${Math.abs(Math.round(prem)).toLocaleString('en-US')}.`)
    if (paidGap !== null) plain.push(`Big wallets that bought in the window paid on average ${Math.abs(paidGap).toFixed(2)}% ${paidGap >= 0 ? 'above' : 'below'} the real share price.`)
  }

  // 7. Replay frames (the time scrubber).
  const timeline = tier === 'pro' ? buildTimeline({ history, balances, ids: ids.slice(0, graphMax), wallets: wallets.map((n) => n.id), total, times }) : null

  const links0 = [...linkMap.values()]
    .sort((a, b) => b.transfers - a.transfers)
    .slice(0, LINKS_MAX)
    .map((l) => ({ source: l.source, target: l.target, transfers: l.transfers, pct: round2(pctOf(l.raw, total)), kind: l.kind }))
  const links = [...links0, ...viaLinks.slice(0, 60)]
  const kindsPresent = [...new Set(nodes.map((n) => n.label?.kind).filter(Boolean))]
  return {
    state: 'ok',
    kind,
    chain: { key: chainKey, id: HOLDER_CHAINS[chainKey].id, name: HOLDER_CHAINS[chainKey].name },
    token: { address: token, symbol: symbol ?? null, name: name ?? null, decimals, supply: totalKnown ? units(supply, decimals) : null, url: addressUrl(chainKey, token) },
    asOf: new Date(now).toISOString(),
    sources,
    coverage: coverage ?? { level: fromHistory ? 'full' : 'top', reason: null, shown: null },
    venue: launch?.venueName ?? (launch ? 'DeepCore' : null),
    // Another launchpad's launch: its id (holders-launchpads.mjs, e.g. 'gully-launchpad'), so clients can gate on the
    // launchpad itself and not on its display name. null for DeepCore launches, stocks and plain tokens.
    venueId: kind === 'launch' && launch?.venue ? lower(launch.venue) : null,
    holders: { count: holderCount ?? (fromHistory ? positive.filter(([a]) => !INFRA.has(lbl.get(a)?.kind)).length : null), shown: nodes.length, graph: Math.min(graphMax, nodes.length), sharesOf: totalKnown ? 'total supply' : 'listed holders', partial },
    tier,
    locked: tier === 'pro' ? [] : ['replay', 'csv', 'more-holders', 'alerts'],
    nodes,
    links,
    clusters: clusters.slice(0, 30),
    legend: Object.entries(LABEL_KINDS).filter(([k]) => kindsPresent.includes(k)).map(([k, v]) => ({ kind: k, text: v })),
    summary: { top10Pct, largestCluster: biggest ? { pct: biggest.pct, wallets: biggest.count } : null, line, plain },
    forensics,
    fair: fairSummary,
    timeline,
    recentFlows: recentFlowsOf({ transfers: history?.transfers ?? [], labels: lbl, total, decimals, times }),
    hidden,
    health: null,
    deployerHistory: null,
    crossToken: null,
    live: { supported: chainKey !== 'solana' && !!(history?.toBlock ?? null), cursor: history?.toBlock ?? null },
  }
}

/**
 * Wallets outside the mapped set that exchanged tokens with mapped (unlabelled) wallets: Map address ->
 * { mapped: Set, sentTo: Set, transfers }. Only addresses with at most HIDDEN_MAX_PEERS counterparties.
 */
export function hiddenPeers(transfers, peopleSet, labels) {
  const peers = new Map()
  const all = new Map()
  const note = (x, other) => {
    if (!all.has(x)) all.set(x, new Set())
    all.get(x).add(other)
  }
  for (const t of transfers) {
    note(t.from, t.to)
    note(t.to, t.from)
    for (const [x, m, dir] of [[t.to, t.from, 'in'], [t.from, t.to, 'out']]) {
      if (peopleSet.has(x) || !peopleSet.has(m) || labels.has(x) || x === ZERO) continue
      const p = peers.get(x) ?? { mapped: new Set(), sentTo: new Set(), transfers: 0 }
      p.mapped.add(m)
      if (dir === 'out') p.sentTo.add(m)
      p.transfers++
      peers.set(x, p)
    }
  }
  return [...peers].filter(([x, p]) => p.mapped.size >= 2 && (all.get(x)?.size ?? 0) <= HIDDEN_MAX_PEERS)
}

/** Average price paid against the real share price for wallets that bought from a labelled pool in the window. */
function buyCosts({ transfers, labels, ids, fairHistory, times }) {
  const out = new Map()
  if (!fairHistory?.length) return out
  for (const t of transfers) {
    if (labels.get(t.from)?.kind !== 'pool' || !ids.has(t.to)) continue
    const ts = t.ts ?? times.get(t.block) ?? null
    if (!ts) continue
    // The nearest snapshot within 15 minutes; otherwise this buy is not priced.
    let best = null
    for (const p of fairHistory) if (Math.abs(p[0] - ts) <= 900 && (!best || Math.abs(p[0] - ts) < Math.abs(best[0] - ts))) best = p
    if (!best || typeof best[1] !== 'number') continue
    const u = Number(t.value) // relative weights only
    const c = out.get(t.to) ?? { w: 0, g: 0 }
    c.w += u
    c.g += best[1] * u
    out.set(t.to, c)
  }
  return new Map([...out].filter(([, c]) => c.w > 0).map(([a, c]) => [a, { gapPct: round2(c.g / c.w), units: c.w }]))
}

/**
 * Replay frames: each mapped wallet's share at FRAMES moments. From a complete history the balances are
 * replayed forward from zero; from a window of recent transfers they are rolled back from today's
 * balances (exact for the mapped wallets over that window). Frames where a rolled-back balance would go
 * negative mean a transfer is missing, and the replay is withheld rather than shown wrong.
 */
export function buildTimeline({ history, balances, ids, wallets, total, times = new Map() }) {
  const tr = history?.transfers ?? []
  if (tr.length < 2 || !(total > 0n)) return null
  const n = Math.min(FRAMES, tr.length)
  const cut = Array.from({ length: n }, (_, i) => Math.floor(((i + 1) * tr.length) / n) - 1)
  const idSet = new Set(ids)
  const frames = []
  if (history.complete) {
    const bal = new Map()
    let k = 0
    for (let i = 0; i < tr.length; i++) {
      const t = tr[i]
      if (t.from !== ZERO) bal.set(t.from, (bal.get(t.from) ?? 0n) - t.value)
      bal.set(t.to, (bal.get(t.to) ?? 0n) + t.value)
      if (i === cut[k]) {
        frames.push(frameOf(t, bal, ids, wallets, total, times, [...bal.values()].filter((v) => v > 0n).length))
        k++
      }
    }
  } else {
    const bal = new Map(ids.map((a) => [a, balances.get(a) ?? 0n]))
    const cutSet = new Set(cut)
    for (let i = tr.length - 1; i >= 0; i--) {
      if (cutSet.has(i)) frames.unshift(frameOf(tr[i], bal, ids, wallets, total, times, null))
      const t = tr[i]
      if (idSet.has(t.to)) bal.set(t.to, bal.get(t.to) - t.value)
      if (idSet.has(t.from) && t.from !== ZERO) bal.set(t.from, bal.get(t.from) + t.value)
      if ([...bal.values()].some((v) => v < 0n)) return null
    }
  }
  return { basis: history.complete ? 'every transfer since launch' : 'rolled back from today over the latest transfers', frames }
}
function frameOf(t, bal, ids, wallets, total, times, holders) {
  const pcts = ids.map((a) => round2(pctOf(bal.get(a) > 0n ? bal.get(a) : 0n, total)) ?? 0)
  const top10 = wallets.map((a) => (bal.get(a) > 0n ? bal.get(a) : 0n)).sort((a, b) => (b > a ? 1 : b < a ? -1 : 0)).slice(0, 10).reduce((s, v) => s + v, 0n)
  const ts = t.ts ?? times.get(t.block) ?? null
  return { block: t.block, at: ts ? new Date(ts * 1000).toISOString() : null, pcts, top10Pct: round2(pctOf(top10, total)), holders }
}

/* ------------------------------------------------------------ the reader --- */

const HERE = path.dirname(fileURLToPath(import.meta.url))
let stockTables = null
/** The tracker's stock tables per chain key: [{ ticker, symbol, name, token, decimals }]. */
function STOCKS() {
  if (stockTables) return stockTables
  const load = (f) => JSON.parse(fs.readFileSync(path.join(HERE, 'data', f), 'utf8')).stocks
  stockTables = { robinhood: load('robinhood-stocks.json'), bsc: load('bsc-stocks.json'), solana: load('solana-stocks.json') }
  return stockTables
}
/** A tracked stock on a chain by ticker or token address, or null. */
export function findStock(chainKey, tokenOrTicker) {
  const t = STOCKS()[chainKey]
  if (!t) return null
  const q = String(tokenOrTicker)
  return t.find((s) => s.ticker.toUpperCase() === q.toUpperCase() || String(s.symbol ?? '').toUpperCase() === q.toUpperCase() || (chainKey === 'solana' ? s.token === q : lower(s.token) === lower(q))) ?? null
}

/** A response for a token the map cannot draw, in plain words. `comingSoon` = the chain's source is not set up yet. */
const unavailable = (chainKey, token, kind, reason, extra = {}) => ({ state: 'unavailable', kind, chain: { key: chainKey, id: HOLDER_CHAINS[chainKey].id, name: HOLDER_CHAINS[chainKey].name }, token: { address: token, ...(extra.token ?? {}) }, reason, comingSoon: !!extra.comingSoon, ...(extra.extra ?? {}), asOf: new Date().toISOString() })

let trackerRowFn = async (chainKey, ticker) => (await readTracker())?.rows?.find((r) => r.chain === chainKey && r.ticker === ticker) ?? null
let fairHistoryFn = (chainKey, ticker) => readHistory(chainKey, ticker)
/** Test hook: the tracker row and history the fair-price overlay reads. */
export function setTrackerForTest(rowFn, histFn) {
  trackerRowFn = rowFn
  fairHistoryFn = histFn ?? (() => [])
}

/** A token's holders from the first holder API that answers (Blockscout, then Moralis), or { error }. */
/** Top holders of a Gully Chain token from our own indexer (balances with a tag: launchpad, pool, lp locker, burn). */
async function readGullyIndexerHolders(token, want = 50) {
  try {
    const r = await gullyIndexerGet(`/tokens/${token}/holders?limit=${Math.min(500, Math.max(10, want))}`)
    if (r.status === 404 || !Array.isArray(r.body?.holders)) return { error: 'The Gully Chain indexer does not list this token.' }
    const holders = r.body.holders.filter((h) => isAddr(h?.address) && /^\d+$/.test(String(h.balance))).map((h) => ({ address: lower(h.address), raw: BigInt(h.balance) }))
    const count = Number(r.body.holderCount)
    const supply = /^\d+$/.test(String(r.body.totalSupply ?? '')) ? BigInt(r.body.totalSupply) : null
    return { holders, count: Number.isFinite(count) ? count : null, supply }
  } catch (e) {
    return { error: String(e?.message ?? e) }
  }
}

async function readTopHolders(chainKey, token, want) {
  const order = [chainKey === 'gully' && 'indexer', blockscoutFor(chainKey) && 'blockscout', moralisFor(chainKey) && 'moralis'].filter(Boolean)
  if (!order.length) return { error: 'no-key' }
  let last = { error: 'no-key' }
  for (const source of order) {
    const h = source === 'indexer' ? await readGullyIndexerHolders(token, want) : source === 'blockscout' ? await readBlockscoutHolders(chainKey, token, want) : await readMoralisHolders(chainKey, token, want)
    if (!h.error) return { ...h, source }
    last = h
  }
  return last
}

const notFound = (chainKey, token, reason) => ({ state: 'not-found', reason, chain: { key: chainKey, id: HOLDER_CHAINS[chainKey].id, name: HOLDER_CHAINS[chainKey].name }, token: { address: token }, asOf: new Date().toISOString() })
const busyBody = (reason, status) => ({ state: 'busy', reason, status })

let knownLaunchFn = knownLaunch
/** Test hook: replaces holders-launchpads.mjs's knownLaunch. */
export const setKnownLaunchForTest = (fn) => (knownLaunchFn = fn ?? knownLaunch)
const VENUE_NAMES = { peddles: 'Peddles', peddleswap: 'PeddleSwap', 'gully-launchpad': 'Gully Launchpad' }

/** knownLaunch() from the launchpad modules, bounded and never throwing: a normalised launch or null. */
async function otherLaunch(chainKey, token) {
  try {
    const k = await Promise.race([knownLaunchFn(chainKey, token), new Promise((r) => setTimeout(() => r(null), 5_000))])
    if (!k || typeof k !== 'object' || !k.venue) return null
    const block = Number(k.creationBlock)
    return {
      venue: String(k.venue).slice(0, 40),
      venueName: VENUE_NAMES[lower(k.venue)] ?? String(k.venue).slice(0, 40),
      creator: isAddr(k.deployer) ? lower(k.deployer) : null,
      createdAt: Number.isInteger(block) && block >= 0 ? { blockNumber: String(block) } : null,
      launchToken: {},
      legs: [],
      pools: [].concat(k.pool ?? []).map((p) => (typeof p === 'string' ? p : p?.address ?? p?.pair)).filter(isAddr),
    }
  } catch {
    return null
  }
}

/**
 * What a token is, and whether it may be built now. { stock, token, launch, other, probe, release } or { done: body }.
 *   stock    a tracked stock token (a ticker is accepted)
 *   launch   a DeepCore launch (EVM chains DeepCore runs on)
 *   other    a launch of another launchpad (server/holders-launchpads.mjs), normalised like a launch
 *   probe    anything else: confirmed to be a token first (ERC-20 decimals and totalSupply, or a Solana mint), after
 *            the per-IP and global budgets for non-listed tokens
 */
async function admit(chainKey, tokenIn, ctx) {
  const c = HOLDER_CHAINS[chainKey]
  const evm = chainKey !== 'solana'
  const stock = findStock(chainKey, tokenIn)
  const token = stock ? (evm ? lower(stock.token) : stock.token) : evm ? lower(tokenIn) : String(tokenIn)
  if (stock) return { stock, token }
  let launch = null
  if (evm && DEEPCORE_CHAINS[c.id]) {
    launch = await readLaunch(c.id, token)
    if (launch === undefined) return { done: { state: 'error', reason: 'DeepCore could not be read just now; try again in a minute.', chain: { key: chainKey, id: c.id, name: c.name }, token: { address: token }, asOf: new Date().toISOString() } }
  }
  if (launch) return { token, launch }
  const other = await otherLaunch(chainKey, token)
  if (other) return { token, other, probe: await probeToken(chainKey, token) }
  // A token nobody listed: the tighter budgets first, then the token check.
  if (!takeAnyBuild(ctx.ip ?? null)) return { done: busyBody('Too many new token maps in the last minute; try again shortly. Maps already built stay free.', 429) }
  const release = reserveAnySlot()
  if (!release) return { done: busyBody('The Holder Map is busy with other tokens; try again in a few seconds.', 503) }
  try {
    const probe = await probeToken(chainKey, token)
    if (probe.status === 'not-token') {
      release()
      return { done: notFound(chainKey, token, `${probe.reason} The Holder Map maps ERC-20 tokens on ${Object.values(HOLDER_CHAINS).filter((x) => x.id !== 'solana').map((x) => x.name).join(', ')} and SPL tokens on Solana.`) }
    }
    if (probe.status === 'unreadable') {
      release()
      return { done: { state: 'error', reason: `${c.name} could not be reached just now to check this address; try again in a minute.`, chain: { key: chainKey, id: c.id, name: c.name }, token: { address: token }, asOf: new Date().toISOString() } }
    }
    return { token, probe, release }
  } catch (e) {
    release()
    throw e
  }
}

/** Reads and builds the map for one token. Never throws: failures are { state: 'error' | 'unavailable' | 'not-found' | 'busy' }. */
export async function computeHolderMap(chainKey, tokenIn, tier = 'pro', ctx = {}) {
  const adm = await admit(chainKey, tokenIn, ctx)
  if (adm.done) return adm.done
  try {
    return await buildOne(chainKey, tier, adm)
  } finally {
    adm.release?.()
  }
}

async function buildOne(chainKey, tier, { stock, token, launch: dcLaunch = null, other = null, probe = null }) {
  const want = (TIERS[tier] ?? TIERS.free).list
  const c = HOLDER_CHAINS[chainKey]
  const launch = dcLaunch ?? other
  const isDeepcore = !!dcLaunch
  const kind = isDeepcore ? 'deepcore-launch' : other ? 'launch' : stock ? 'stock' : 'token'
  const symbol = dcLaunch?.launchToken?.symbol ?? stock?.symbol ?? stock?.ticker ?? probe?.symbol ?? null
  const decimalsHint = dcLaunch?.launchToken?.decimals ?? stock?.decimals ?? probe?.decimals ?? 18
  const venue = c.id !== 'solana' && DEEPCORE_CHAINS[c.id] ? await readVenue(c.id) : null
  const trackerRow = stock ? await trackerRowFn(chainKey, stock.ticker).catch(() => null) : null
  const labels = staticLabels({ chainKey, token, venue, launch, trackerPool: trackerRow?.pool })
  if (other) for (const p of other.pools) if (!labels.has(lower(p))) labels.set(lower(p), { kind: 'pool', name: `${other.venueName} pool` })

  let holders = null
  let history = null
  let holderCount = null
  let supply = null
  let decimals = decimalsHint
  let partial = null
  let coverage = null
  const sources = {}

  if (isDeepcore) {
    const from = hexNum(dcLaunch.createdAt?.blockNumber) ?? 0
    const r = await readDeepcoreTransfers(c.id, token, from)
    if (r.transfers) {
      history = { transfers: r.transfers, complete: true, fromBlock: from, toBlock: r.toBlock }
      supply = /^\d+$/.test(String(dcLaunch.totalSupply?.raw ?? '')) ? BigInt(dcLaunch.totalSupply.raw) : null
      sources.holders = `DeepCore’s log index: all ${r.transfers.length.toLocaleString('en-US')} transfers since launch (exact balances)`
      sources.links = 'Direct transfers between the mapped wallets, since launch'
    } else sources.note = `Not rebuilt from DeepCore’s log index: ${r.error}.`
  }
  // EVM tokens: our own Transfer-log index first (exact balances from every transfer since the deploy block;
  // tokens nobody listed get tighter caps), then Blockscout, then Moralis, each only when its key is set.
  let own = null
  let ownHistory = false
  if (!history && chainKey !== 'solana') {
    own = await readOwnHistory(chainKey, token, { any: kind === 'token' }).catch(() => ({ state: 'error' }))
    if (own.state === 'ok') {
      history = { transfers: own.transfers, complete: true, fromBlock: own.fromBlock, toBlock: own.toBlock }
      ownHistory = true
      supply = probe?.supply ?? (await readSupply(chainKey, token))
      sources.holders = `Our own index of the chain’s Transfer logs: all ${own.count.toLocaleString('en-US')} transfers since the token was deployed (exact balances)`
      sources.links = 'Direct transfers between the mapped wallets, since the token was deployed'
    }
  }
  // Why the full history is not what the map is built from (for the "top holders only" label).
  const whyTop = () => {
    if (own?.state === 'backfilling') return `its full history is still being read (${Math.round(own.progress * 100)}% so far)`
    if (own?.state === 'capped') return own.by === 'calls' ? 'rebuilding its full history would take too many chain reads' : `it has more than ${own.cap.toLocaleString('en-US')} transfers, too many to rebuild its full history`
    if (own?.state === 'no-archive') return `full history needs an archive node, and none is available on ${c.name} right now`
    if (isDeepcore) return 'it has too many transfers for DeepCore’s log index to rebuild'
    return 'its full history could not be read just now'
  }
  if (!history) {
    let h
    if (chainKey === 'solana') h = await readSolanaHolders(token)
    else h = await readTopHolders(chainKey, token, want)
    if (h.error === 'no-key' && own?.state === 'backfilling') return unavailable(chainKey, token, kind, `This token’s full holder history is being read from ${c.name}: ${Math.round(own.progress * 100)}% so far. The map appears once every transfer is in, never with partial balances.`, { token: { symbol }, extra: { progress: own.progress } })
    if (h.error === 'no-key' && own?.state === 'capped') return unavailable(chainKey, token, kind, own.by === 'calls' ? `Rebuilding this token’s holders would take too many chain reads, and a top-holders list is not available on ${c.name} yet.` : `This token has more than ${own.cap.toLocaleString('en-US')} transfers, too many to rebuild its holders here yet.`, { token: { symbol } })
    if (h.error === 'no-key' || (h.error === 'solana-rpc' && !solanaRpcSet())) return unavailable(chainKey, token, kind, comingSoonReason(chainKey), { comingSoon: true, token: { symbol } })
    if (h.error) {
      console.warn(`holders: ${chainKey} ${token}: ${String(h.detail ?? h.error).slice(0, 120)}`)
      return unavailable(chainKey, token, kind, `Holder data could not be read on ${c.name} just now. It is tried again in a few minutes.`, { token: { symbol } })
    }
    holders = h.holders
    holderCount = h.count ?? null
    supply = h.supply ?? probe?.supply ?? null
    if (h.decimals != null) decimals = h.decimals
    partial = h.partial ?? null
    sources.holders = chainKey === 'solana' ? (partial ? 'Solana RPC (the 20 largest token accounts, merged by owner)' : `Solana RPC (every token account of the mint, ${holders.length.toLocaleString('en-US')} owners)`) : h.source === 'indexer' ? `The Gully Chain indexer (top ${holders.length} holders)` : h.source === 'blockscout' ? `Blockscout (top ${holders.length} holders)` : `Moralis (top ${holders.length} holders)`
    if (chainKey !== 'solana') {
      history = h.source === 'moralis' ? await readMoralisTransfers(chainKey, token) : await readRecentTransfers(chainKey, token)
      if (history) sources.links = `Direct transfers between the mapped wallets in the latest ${history.transfers.length.toLocaleString('en-US')} transfers (blocks ${history.fromBlock.toLocaleString('en-US')}–${history.toBlock.toLocaleString('en-US')})`
      else sources.links = 'Transfers could not be read, so no links are drawn'
      supply ??= await readSupply(chainKey, token)
      coverage = { level: 'top', reason: whyTop(), shown: holders.length }
    } else {
      sources.links = 'Not read on Solana yet, so no links are drawn'
      coverage = partial ? { level: 'top', reason: 'Solana’s RPC lists only the 20 largest token accounts for this mint', shown: holders.length } : { level: 'full', reason: null, shown: holders.length }
    }
  } else coverage = { level: 'full', reason: null, shown: null }

  // Contract flags and public name tags for the mapped addresses (EVM).
  const prelim = history?.complete ? [...reconstructBalances(history.transfers)].filter(([, v]) => v > 0n).sort((a, b) => (b[1] > a[1] ? 1 : -1)).slice(0, want).map(([a]) => a) : (holders ?? []).slice(0, want).map((h) => h.address)
  if (chainKey !== 'solana') {
    const [codes, tags] = await Promise.all([readCode(chainKey, prelim.filter((a) => a !== ZERO).slice(0, 120)), readNameTags(c.id, prelim.filter((a) => !labels.has(a)).slice(0, 60))])
    for (const [a, t] of tags) if (!labels.has(a)) labels.set(a, { kind: t.exchange ? 'exchange' : 'known', name: t.name })
    if (holders) for (const h of holders) if (h.contract === undefined && codes.has(h.address)) h.contract = codes.get(h.address)
    holders ??= prelim.map((a) => ({ address: a, raw: 0n, contract: codes.get(a) }))
    if (history?.complete) holders = holders.map((h) => ({ ...h, contract: codes.get(h.address) }))
    // Gully Chain: Gully Swap pools are pools, not wallets.
    await labelGullyPools(chainKey, [...codes].filter(([, isContract]) => isContract).map(([a]) => a), labels)
    // Moralis names entities itself.
    for (const h of holders) if (h.name && !labels.has(h.address)) labels.set(h.address, { kind: EXCHANGE_RE.test(h.name) || EXCHANGE_RE.test(h.entity ?? '') ? 'exchange' : 'known', name: String(h.name).slice(0, 48) })
    // Gully Chain: wallets with a primary .gully name (reverse record verified forward) are shown by that name.
    if (chainKey === 'gully') {
      const wallets = prelim.filter((a) => !labels.has(a) && a !== ZERO && !codes.get(a)).slice(0, 60)
      const names = await gullyNames(wallets).catch(() => new Map())
      for (const [a, name] of names) if (!labels.has(a)) labels.set(a, { kind: 'known', name })
    }
  }

  // Native-coin funding by the deployer (Blockscout, when a key is set and the chain is on it).
  let funding = null
  if (launch?.creator) {
    if (c.holders === 'blockscout' && blockscoutKey()) {
      const r = await getJson(`${BLOCKSCOUT_API()}/${c.id}/api/v2/addresses/${launch.creator}/transactions?filter=from&apikey=${encodeURIComponent(blockscoutKey())}`)
      const items = Array.isArray(r.body?.items) ? r.body.items : null
      funding = items ? { checked: true, recipients: items.filter((t) => isAddr(t?.to?.hash) && /^[1-9]\d*$/.test(String(t.value ?? ''))).map((t) => lower(t.to.hash)), reason: null } : { checked: false, recipients: [], reason: 'Coin transfers from the deployer could not be read just now.' }
    } else funding = { checked: false, recipients: [], reason: `Coin transfers from the deployer are not checked on ${c.name} yet.` }
  }

  // Block times for the replay frames and the buy prices, when the logs do not carry them.
  let times = new Map()
  if (history?.transfers?.length && chainKey !== 'solana' && history.transfers.some((t) => !t.ts)) {
    const tr = history.transfers
    const n = Math.min(FRAMES, tr.length)
    times = await blockTimes(chainKey, Array.from({ length: n }, (_, i) => tr[Math.floor(((i + 1) * tr.length) / n) - 1].block))
  }

  // Hidden-link candidates must be plain wallets: their code is checked before a link is drawn through them.
  let codeOf = new Map()
  if (history?.transfers?.length && chainKey !== 'solana') {
    const people = new Set(prelim.filter((a) => !INFRA.has(labels.get(a)?.kind)))
    const cands = hiddenPeers(history.transfers, people, labels).map(([x]) => x).slice(0, 40)
    if (cands.length) codeOf = await readCode(chainKey, cands)
  }

  const map = buildMap({
    codeOf,
    chainKey,
    token,
    symbol,
    name: stock?.name ?? probe?.name ?? null,
    decimals,
    kind,
    holders,
    history,
    labels,
    supply,
    holderCount,
    launch,
    funding,
    fair: trackerRow ? { fair: trackerRow.fair, onchain: trackerRow.onchain, gapPct: trackerRow.gapPct, status: trackerRow.status } : null,
    fairHistory: stock ? fairHistoryFn(chainKey, stock.ticker) : [],
    times,
    sources,
    partial,
    coverage,
    tier,
    balancesFrom: (launch || ownHistory) && history?.complete ? 'history' : 'holders',
  })
  // Never an empty map drawn as if it were real.
  if (map.state === 'ok' && !map.nodes.length) return unavailable(chainKey, token, kind, 'No holder balances were found for this token yet.', { token: { symbol } })
  if (map.state === 'ok' && map.forensics && isDeepcore) await enrichLaunch(map, { chainId: c.id, launch, tier })
  return map
}

/* ----------------------------------------------------- cache and the route --- */

const cache = new Map() // key -> { at, ttl, body }
const inflight = new Map()
let building = 0
const ipHits = new Map()

/** The map for one token, from the cache when fresh. `force` skips the per-IP budget (alerts loop). */
export async function readHolderMap(chainKey, token, { ip = null, tier = 'pro' } = {}) {
  const key = `${chainKey}:${chainKey === 'solana' ? token : lower(token)}:${tier}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < hit.ttl) return { ...hit.body, cached: true }
  if (inflight.has(key)) return inflight.get(key)
  if (ip) {
    const now = Date.now()
    const list = (ipHits.get(ip) ?? []).filter((t) => now - t < 60_000)
    if (list.length >= PER_IP_PER_MIN) return { state: 'busy', reason: 'Too many new maps from this address in the last minute; try again shortly.', status: 429 }
    list.push(now)
    ipHits.set(ip, list)
  }
  if (building >= MAX_BUILDS) return hit ? { ...hit.body, cached: true, stale: true } : { state: 'busy', reason: 'The Holder Map is busy; try again in a few seconds.', status: 503 }
  building++
  const p = computeHolderMap(chainKey, token, tier, { ip })
    .catch((e) => {
      console.error('holders:', e?.stack ?? e)
      return { state: 'error', reason: 'The holder map could not be built just now.', asOf: new Date().toISOString() }
    })
    .then((body) => {
      const ok = body.state === 'ok' || body.state === 'not-found'
      // A budget refusal belongs to the asker, not to the token: never cached. A map still being read is re-asked soon.
      if (body.state === 'busy') return body
      if (!ok && hit?.body?.state === 'ok') return { ...hit.body, cached: true, stale: true }
      cache.set(key, { at: Date.now(), ttl: body.state === 'unavailable' && typeof body.progress === 'number' ? 15_000 : ok || body.state === 'unavailable' ? cacheMs() : FAIL_TTL_MS, body })
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
      return body
    })
    .finally(() => {
      building--
      inflight.delete(key)
    })
  inflight.set(key, p)
  return p
}
/** A cached map without building one (the launch feed), or null. */
export function peekHolderMap(chainKey, token) {
  for (const tier of ['free', 'pro']) {
    const hit = cache.get(`${chainKey}:${chainKey === 'solana' ? token : lower(token)}:${tier}`)
    if (hit && Date.now() - hit.at < hit.ttl) return hit.body
  }
  return null
}
setMapPeek(peekHolderMap)

/** Test hook: puts a map in the cache for both tiers, as if it had just been built. */
export function seedHolderMapForTest(chainKey, token, body) {
  for (const tier of ['free', 'pro']) cache.set(`${chainKey}:${chainKey === 'solana' ? token : lower(token)}:${tier}`, { at: Date.now(), ttl: cacheMs(), body })
}

/** Test hook. */
export function resetHoldersForTest() {
  cache.clear()
  inflight.clear()
  ipHits.clear()
  venueCache.clear()
  cooling.clear()
  dcWindow = []
  building = 0
  resetAnyForTest()
}

const STATUS = { ok: 200, 'not-found': 404, unavailable: 200, error: 502, busy: 503 }

/** The holder list as CSV (rank, address, label, balance, share, cluster, flags). */
export function holdersCsv(map) {
  const q = (v) => {
    const t = String(v ?? '')
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const rows = [['rank', 'address', 'label', 'balance', 'percent_of_' + (map.holders?.sharesOf === 'total supply' ? 'supply' : 'listed'), 'cluster', 'flags']]
  for (const n of map.nodes ?? []) rows.push([n.rank, n.id, n.label?.name ?? '', n.balance, n.pct ?? '', n.cluster ?? '', n.flags.join(' ')])
  return rows.map((r) => r.map(q).join(',')).join('\n') + '\n'
}

/**
 * GET /api/holders/:chain/:token, /api/holders/:chain/:token.csv and /api/holders/:chain/:token/card.png.
 * `access` is apiAccess(req) (rate limit and plan, already checked by the caller). Returns false when the
 * path is not ours.
 */
export async function handleHolders(req, res, url, access = null) {
  const p = url.pathname
  const features0 = holderMapFeatures(access?.plan ?? 'anonymous')
  if (p === '/api/holders/launches' || p === '/api/holders/top' || p === '/api/holders/resolve' || p === '/api/holders/sources') {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'GET only' }), true
    if (p === '/api/holders/launches') return json(res, 200, await readLaunchFeed({ limit: 12 }), { 'Cache-Control': 'public, max-age=15' }), true
    if (p === '/api/holders/top') return json(res, 200, topScans(Math.min(20, Math.max(1, Number(url.searchParams.get('limit')) || 10))), { 'Cache-Control': 'public, max-age=60' }), true
    // Which chains have maps today, in plain words (no env names): the landing page's "where maps work".
    if (p === '/api/holders/sources') return json(res, 200, { chains: holdersSourceHealth().map(({ chain, name, stocks, launches, tokens, any }) => ({ chain, name, stocks, launches, tokens, any })) }, { 'Cache-Control': 'public, max-age=60' }), true
    const q = String(url.searchParams.get('q') ?? '').slice(0, 64)
    const r = await resolveHolders(q, { ip: clientIp(req) })
    if (r.busy) return json(res, 429, { error: 'Too many address checks in the last minute; try again shortly.', matches: [], checked: [] }, { 'Cache-Control': 'no-store' }), true
    return json(res, 200, { matches: r.matches.map((m) => ({ ...m, available: holdersAvailable(m.chain, m.kind) })), checked: r.checked ?? [] }, { 'Cache-Control': r.matches.length ? 'public, max-age=60' : 'no-store' }), true
  }
  if (p === '/api/holders/embed-config') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    const { embedConfig } = await import('./holders-partners.mjs')
    const q = url.searchParams
    return json(res, 200, embedConfig({ key: q.get('key') ?? '', theme: q.get('theme') ?? '', accent: q.get('accent') ?? '' }), { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }), true
  }
  const sub = p.match(/^\/api\/holders\/([a-z0-9]{2,12})\/([A-Za-z0-9]{1,64})\/(live|wallet\/([A-Za-z0-9]{32,44}))$/)
  if (sub) {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    const ck = chainKeyOf(sub[1])
    if (!ck) return json(res, 404, { error: 'Unknown chain.' }), true
    if (sub[3] === 'live') {
      const since = Number(url.searchParams.get('since'))
      const out = await readLive(ck, sub[2], Number.isInteger(since) ? since : null)
      return json(res, out.state === 'error' ? 502 : 200, { ...out, liveMinutes: features0.liveMinutes ?? null }), true
    }
    const out = await readWalletDetail(ck, sub[2], sub[4])
    return json(res, out.state === 'error' ? 502 : 200, out, { 'Cache-Control': 'public, max-age=60' }), true
  }
  const m = url.pathname.match(/^\/api\/holders\/([a-z0-9]{2,12})\/([A-Za-z0-9]{1,64}?)(\.csv|\/card\.png|\/card\.jpg)?$/)
  if (!m) return false
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'GET only' }), true
  const chainKey = chainKeyOf(m[1])
  if (!chainKey) return json(res, 404, { error: `Unknown chain. The Holder Map runs on ${Object.keys(HOLDER_CHAINS).join(', ')}.` }), true
  const token = m[2]
  const valid = chainKey === 'solana' ? isSolanaAddress(token) || !!findStock(chainKey, token) : isAddr(token) || !!findStock(chainKey, token)
  if (!valid) return json(res, 400, { error: 'Give a token address or a tracked stock ticker.' }), true
  const features = holderMapFeatures(access?.plan ?? 'anonymous')
  const kind = m[3] === '.csv' ? 'csv' : m[3] ? 'card' : 'json'
  const jpeg = m[3] === '/card.jpg'
  if (kind === 'csv' && !features.csv) return json(res, 403, { error: 'The CSV export comes with the Pro plan (https://gullylabs.xyz/pricing).', locked: 'csv' }), true
  // The share card is free for everyone and always drawn from the free view (the same picture for all).
  const tier = kind === 'card' ? 'free' : features.tier
  const body = await readHolderMap(chainKey, token, { ip: clientIp(req), tier })
  if (kind === 'card') {
    // Always an image: the map's card, or a branded "coming soon / not ready" card. Never JSON.
    const card = await import('./holders-card.mjs')
    const ok = body.state === 'ok'
    let png = null
    try {
      if (jpeg) png = ok ? await card.renderHolderCardJpeg(body) : await card.renderHolderStatusCardJpeg(body)
      else png = ok ? await card.renderHolderCard(body) : await card.renderHolderStatusCard(body)
    } catch (e) {
      console.error('holders card:', e?.message ?? e)
      png = jpeg ? card.fallbackCardJpeg() : card.fallbackCardPng()
    }
    if (!png) return json(res, 503, { error: 'The share card could not be drawn just now.' }), true
    const status = body.state === 'not-found' ? 404 : 200
    res.writeHead(status, { 'Content-Type': jpeg ? 'image/jpeg' : 'image/png', 'Content-Length': String(png.length), 'Cache-Control': ok || body.comingSoon ? 'public, max-age=300' : 'public, max-age=60' })
    res.end(req.method === 'HEAD' ? undefined : png)
    return true
  }
  if (kind === 'csv') {
    if (body.state !== 'ok') return json(res, STATUS[body.state] ?? 502, { error: body.reason ?? 'No map' }), true
    const csv = holdersCsv(body)
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="holders-${chainKey}-${String(body.token?.symbol ?? token).replace(/[^\w.-]/g, '')}.csv"`, 'Cache-Control': 'private, no-store' })
    res.end(req.method === 'HEAD' ? undefined : csv)
    return true
  }
  const status = body.status ?? STATUS[body.state] ?? 200
  // ?peek=1: a page showing a map it did not open (holdermaps.xyz's "map of the moment") reads it without counting a
  // scan, so the most-scanned list only counts people who opened the map.
  if (body.state === 'ok' && body.kind !== 'token' && url.searchParams.get('peek') !== '1') recordScan(chainKey, body.token.address, body.token.symbol, body.kind, clientIp(req))
  const out = { ...body, features: { replay: features.replay, csv: features.csv, alerts: features.alerts, holders: features.holders, liveMinutes: features.liveMinutes ?? null, gated: features.gated } }
  delete out.status
  json(res, status, out, { 'Cache-Control': body.state === 'ok' ? (features.gated ? 'private, max-age=60' : 'public, max-age=60') : 'no-store', 'Access-Control-Allow-Origin': '*' })
  return true
}
