// Holder Map: is this token a launch from one of the owner's own venues (Peddles, PeddleSwap)?
//
//   knownLaunch(chainKey, token) -> null | { venue: 'peddles' | 'peddleswap', chainId, token, creationBlock, deployer, pool? }
//
// chainKey is a key of HOLDER_CHAINS (holders.mjs). Anything unknown, unreachable or not a launch is null,
// so the Holder Map degrades to a generic token map. This file only reads; it never writes anywhere.
//
// Where each fact comes from (checked against the venue repos and on chain, 2026-10-18):
//
//   Peddles (Uniswap v4; every launch is one locked position, PeddlesFeeHook on the pool)
//     Chains in HOLDER_CHAINS: Robinhood Chain 4663, Base 8453, BNB Chain 56. (Also on Arc 5042, not a holder chain.)
//     Token -> launch:   GET https://api.peddles.xyz/api/v1/tokens/:chainId/:token. kind "LAUNCH" is a launch
//                        (kind "STOCK" is a tracked stock token, not a launch); 404 is not a Peddles token.
//                        creatorAddress is the deployer (a Snowball coin names its human creator there).
//     Fallback, API down: PeddlesFeeHook.PoolRegistered(bytes32 indexed poolId, address indexed token,
//                        address indexed quote, address creator, uint16 creatorTaxBps, uint16 excessToCreatorBps,
//                        address rewards), read in the token's creation block. Hook addresses: Peddles repo
//                        contracts/deployments/<chainId>.json (PeddlesFeeHook) and defillama/helpers/peddles.ts.
//     Creation block:    the API does not publish it. First block with code at the token (binary search over
//                        an archive RPC of ours, holders-logs.findStartBlock), the launch transaction's block
//                        because the token is created in the launch transaction. null without an archive RPC.
//     Pool:              the chain's Uniswap v4 PoolManager (it holds the pool's token balance), same json files.
//
//   PeddleSwap (Uniswap v2/v3 fork with a token factory; one API process per chain)
//     Chains in HOLDER_CHAINS: Robinhood Chain 4663 (api.peddleswap.xyz), Base 8453 (api-base.peddleswap.xyz).
//     (Arc 5042, api-arc.peddleswap.xyz, is not a holder chain.) Each host's /v1/stats/overview names its chainId.
//     Token -> launch:   GET <api>/v1/launches/:token -> { launch: { chainId, address, creator, blockNumber,
//                        txHash, timestamp, ... } }; 404 is not a launch. creationBlock = blockNumber, deployer = creator.
//     Pool:              GET <api>/v1/token-directory/:token -> token.market.pool (the main pool), when it exists.
//
// Cache: a launch is immutable, so positives live a day, except a positive whose creation block
// could not be read (5 minutes, so it is retried). "Not a launch" lives 10 minutes. Upstream trouble 30 seconds.
// Bounds: 6 s per HTTP call, 25 s per lookup, 4 lookups at a time, 120 uncached lookups a minute; over a bound
// the answer is null and is not cached for long.

import { HOLDER_CHAINS, rpcAt } from './holders.mjs'
import { archiveUrls, findStartBlock } from './holders-logs.mjs'

const UA = 'gullylabs-holders/1 (+https://gullylabs.xyz)'
const PEDDLES_API = () => String(process.env.PEDDLES_API ?? 'https://api.peddles.xyz/api/v1').replace(/\/+$/, '')
const HTTP_MS = 6_000
const LOOKUP_MS = 25_000
const BLOCK_MS = 18_000
const MAX_INFLIGHT = 4
const MAX_PER_MIN = 120
const CACHE_MAX = 2_000
const TTL = { pos: 24 * 3_600_000, posNoBlock: 300_000, neg: 600_000, fail: 30_000 }

/** PeddlesFeeHook.PoolRegistered(bytes32,address,address,address,uint16,uint16,address). Seen live on Robinhood Chain. */
export const POOL_REGISTERED_TOPIC = '0xebfb244f562bae7d4ca6f8de1634c1681f434c280488827a5e5e402cba3dbe26'

/** Peddles per holder chain: fee hook (emits PoolRegistered) and the Uniswap v4 PoolManager that holds the pools. */
export const PEDDLES = {
  robinhood: { chainId: 4663, hook: '0xfe055282e3cd471a8b2cd922d31e75ecd3bbc0cc', poolManager: '0x8366a39cc670b4001a1121b8f6a443a643e40951' },
  base: { chainId: 8453, hook: '0xab8e39207718f519865d6f0d52efb31b231d40cc', poolManager: '0x498581ff718922c3f8e6a244956af099b2652b2b' },
  bsc: { chainId: 56, hook: '0x39d760601731025e0f02a3e5d232445797fac0cc', poolManager: '0x28e2ea090877bf75740558f6bfb36a5ffee9e9df' },
}
/** PeddleSwap per holder chain: the chain's own API host. */
export const PEDDLESWAP = {
  robinhood: { chainId: 4663, api: 'https://api.peddleswap.xyz' },
  base: { chainId: 8453, api: 'https://api-base.peddleswap.xyz' },
}

let fetchImpl = (...a) => globalThis.fetch(...a)
const cache = new Map() // `${ck}:${token}` -> { v, exp }
const inflight = new Map()
let running = 0
let minute = { at: 0, n: 0 }

const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)
const lc = (a) => (isAddr(a) ? a.toLowerCase() : null)

async function getJson(url) {
  const r = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': UA }, redirect: 'error', signal: AbortSignal.timeout(HTTP_MS) })
  const body = await r.json().catch(() => null)
  return { status: r.status, ok: r.ok, body }
}

const withDeadline = (p, ms, fallback) => {
  let t
  return Promise.race([p, new Promise((res) => (t = setTimeout(() => res(fallback), ms)))]).finally(() => clearTimeout(t))
}

/** The block the token got its code in (its launch block), or null when no archive RPC of ours can say. */
async function creationBlockOf(ck, token) {
  try {
    const urls = (await archiveUrls(ck)).slice(0, 2)
    for (const url of urls) {
      const head = Number(BigInt(await rpcAt(url, 'eth_blockNumber', [])))
      const b = await findStartBlock(ck, token, url, head)
      if (b > 0) return b
    }
  } catch {
    /* unknown */
  }
  return null
}

/** PoolRegistered for `token` in exactly `block`: { creator } or null. */
async function hookCreator(ck, token, block) {
  const hex = '0x' + block.toString(16)
  const topicToken = '0x' + '0'.repeat(24) + token.slice(2)
  for (const url of (await archiveUrls(ck)).slice(0, 2)) {
    try {
      const logs = await rpcAt(url, 'eth_getLogs', [{ address: PEDDLES[ck].hook, topics: [POOL_REGISTERED_TOPIC, null, topicToken], fromBlock: hex, toBlock: hex }])
      const d = String(logs?.[0]?.data ?? '')
      if (/^0x[0-9a-fA-F]{64,}/.test(d)) return { creator: lc('0x' + d.slice(26, 66)) }
      if (Array.isArray(logs)) return null
    } catch {
      /* next url */
    }
  }
  return undefined
}

/** One venue: an object (a launch), null (definitely not), or undefined (could not tell). */
async function peddlesLookup(ck, token) {
  const cfg = PEDDLES[ck]
  if (!cfg) return null
  let creator
  let apiDown = false
  try {
    const r = await getJson(`${PEDDLES_API()}/tokens/${cfg.chainId}/${token}`)
    if (r.status === 404) return null
    if (r.ok && r.body?.success && r.body.data) {
      const d = r.body.data
      if (Number(d.chainId) !== cfg.chainId || lc(d.address) !== token) return null
      if (d.kind !== 'LAUNCH') return null
      creator = lc(d.creatorAddress)
    } else apiDown = true
  } catch {
    apiDown = true
  }
  const creationBlock = await withDeadline(creationBlockOf(ck, token), BLOCK_MS, null)
  if (apiDown) {
    if (creationBlock === null) return undefined
    const hit = await hookCreator(ck, token, creationBlock)
    if (hit === undefined) return undefined
    if (hit === null) return null
    creator = hit.creator
  }
  return { venue: 'peddles', chainId: cfg.chainId, token, creationBlock, deployer: creator, pool: cfg.poolManager }
}

async function peddleswapLookup(ck, token) {
  const cfg = PEDDLESWAP[ck]
  if (!cfg) return null
  try {
    const r = await getJson(`${cfg.api}/v1/launches/${token}`)
    if (r.status === 404) return null
    const l = r.body?.launch
    if (!r.ok || !l) return undefined
    if (Number(l.chainId) !== cfg.chainId || lc(l.address) !== token) return null
    const block = Number(l.blockNumber)
    const out = { venue: 'peddleswap', chainId: cfg.chainId, token, creationBlock: Number.isSafeInteger(block) && block > 0 ? block : null, deployer: lc(l.creator) }
    try {
      const d = await getJson(`${cfg.api}/v1/token-directory/${token}`)
      const pool = lc(d.body?.token?.market?.pool)
      if (d.ok && pool) out.pool = pool
    } catch {
      /* the pool is optional */
    }
    return out
  } catch {
    return undefined
  }
}

async function lookup(ck, token) {
  const [a, b] = await Promise.allSettled([peddlesLookup(ck, token), peddleswapLookup(ck, token)])
  const vals = [a, b].map((x) => (x.status === 'fulfilled' ? x.value : undefined))
  const hit = vals.find((v) => v && typeof v === 'object')
  if (hit) return hit
  return vals.some((v) => v === undefined) ? undefined : null
}

function put(key, v) {
  const ttl = v === undefined ? TTL.fail : v === null ? TTL.neg : v.creationBlock === null ? TTL.posNoBlock : TTL.pos
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
  cache.set(key, { v: v ?? null, exp: Date.now() + ttl })
}

/** Is (chainKey, token) a launch from Peddles or PeddleSwap? null when not, unknown, or on any failure. */
export async function knownLaunch(chainKey, token) {
  try {
    if (!HOLDER_CHAINS[chainKey] || chainKey === 'solana') return null
    if (!PEDDLES[chainKey] && !PEDDLESWAP[chainKey]) return null
    if (!isAddr(token)) return null
    const t = token.toLowerCase()
    const key = `${chainKey}:${t}`
    const hit = cache.get(key)
    if (hit && hit.exp > Date.now()) return hit.v
    if (inflight.has(key)) return await inflight.get(key)
    const now = Date.now()
    if (now - minute.at > 60_000) minute = { at: now, n: 0 }
    if (running >= MAX_INFLIGHT || ++minute.n > MAX_PER_MIN) return null
    running++
    const p = withDeadline(lookup(chainKey, t), LOOKUP_MS, undefined)
      .catch(() => undefined)
      .then((v) => {
        put(key, v)
        return v ?? null
      })
      .finally(() => {
        running--
        inflight.delete(key)
      })
    inflight.set(key, p)
    return await p
  } catch {
    return null
  }
}

/** Test hooks. */
export function setLaunchpadsFetchForTest(fn) {
  fetchImpl = fn ?? ((...a) => globalThis.fetch(...a))
}
export function resetLaunchpadsForTest() {
  cache.clear()
  inflight.clear()
  running = 0
  minute = { at: 0, n: 0 }
}
