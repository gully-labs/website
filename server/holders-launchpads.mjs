// Holder Map: is this token a launch from a registered launchpad (Peddles and PeddleSwap are the first two)?
//
//   knownLaunch(chainKey, token) -> null | { venue: <launchpad id>, chainId, token, creationBlock, deployer, pool? }
//   listLaunchpads()             -> public metadata of the registry: [{ id, name, url, chains: [{ key, id, name }] }]
//
// chainKey is a key of HOLDER_CHAINS (holders.mjs). Anything unknown, unreachable or not a launch is null,
// so the Holder Map degrades to a generic token map. This file only reads; it never writes anywhere.
//
// ADDING A LAUNCHPAD = adding one entry to LAUNCHPADS below (ops/LAUNCHPAD-INTEGRATION.md is the partner guide):
//
//   { id: 'examplepad',                       // a-z 0-9 -, 2-32 chars; becomes `venue` in the answer
//     name: 'ExamplePad', url: 'https://examplepad.test',
//     lookup: 'api' | 'factory-event',
//     chains: { base: { chainId: 8453, ... } },   // keys of HOLDER_CHAINS (no solana); chainId must match
//
//     // lookup 'api': one token endpoint answers "is this a launch of ours?".
//     api: { base: 'https://api.examplepad.test',  // chain.api overrides it per chain; baseEnv: an env var that overrides both
//            path: '/v1/tokens/{chainId}/{token}',  // {chainId} and {token} (lowercase address) are filled in; 404 = not ours
//            okField: 'success',                    // optional: a truthy field the answer must have, else the API counts as down
//            root: 'data',                          // optional: where the launch object sits in the answer
//            require: { field: 'kind', equals: 'LAUNCH' },  // optional: anything else is not a launch
//            fields: { chainId: 'chainId', address: 'address', creator: 'creatorAddress', block: 'blockNumber' },
//            //   block is optional; without it the creation block is found on an archive RPC of ours
//            pool: { path: '/v1/token-directory/{token}', field: 'token.market.pool' } },  // optional dynamic pool
//
//     // lookup 'factory-event' (also the fallback of 'api' when the API is down): the factory contract emits an
//     // event when a token is launched; it is read in the token's creation block (found on an archive RPC).
//     event: { signature: 'TokenCreated(address,address)', topic0: '0x<keccak256 of the signature>',
//              token: { topic: 1 },                 // where the token address is: an indexed topic (1 to 3)
//              creator: { word: 0 } },              // the creator: { topic: n } or { word: n } (data word n)
//     // per chain: chains.base = { chainId, factory: '0x<address that emits the event>', pool: '0x<optional static pool>' }
//   }
//
// Real entries come from the launchpad itself (contract addresses are never guessed).
//
// Where each built-in fact comes from (checked against the venue repos and on chain, 2026-10-18):
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
const HTTP_MS = 6_000
const LOOKUP_MS = 25_000
const BLOCK_MS = 18_000
const MAX_INFLIGHT = 4
const MAX_PER_MIN = 120
const CACHE_MAX = 2_000
const TTL = { pos: 24 * 3_600_000, posNoBlock: 300_000, neg: 600_000, fail: 30_000 }

/** PeddlesFeeHook.PoolRegistered(bytes32,address,address,address,uint16,uint16,address). Seen live on Robinhood Chain. */
export const POOL_REGISTERED_TOPIC = '0xebfb244f562bae7d4ca6f8de1634c1681f434c280488827a5e5e402cba3dbe26'

/**
 * The registry, in lookup order (the first launchpad that claims a token wins). See the format at the top of the file.
 * Peddles: fee hook (emits PoolRegistered; the API-down fallback) and the Uniswap v4 PoolManager that holds the pools.
 * PeddleSwap: each chain has its own API host.
 */
export const LAUNCHPADS = [
  {
    id: 'peddles',
    name: 'Peddles',
    url: 'https://peddles.xyz',
    lookup: 'api',
    api: {
      base: 'https://api.peddles.xyz/api/v1',
      baseEnv: 'PEDDLES_API',
      path: '/tokens/{chainId}/{token}',
      okField: 'success',
      root: 'data',
      require: { field: 'kind', equals: 'LAUNCH' },
      fields: { chainId: 'chainId', address: 'address', creator: 'creatorAddress' },
    },
    event: { signature: 'PoolRegistered(bytes32,address,address,address,uint16,uint16,address)', topic0: POOL_REGISTERED_TOPIC, token: { topic: 2 }, creator: { word: 0 } },
    chains: {
      robinhood: { chainId: 4663, factory: '0xfe055282e3cd471a8b2cd922d31e75ecd3bbc0cc', pool: '0x8366a39cc670b4001a1121b8f6a443a643e40951' },
      base: { chainId: 8453, factory: '0xab8e39207718f519865d6f0d52efb31b231d40cc', pool: '0x498581ff718922c3f8e6a244956af099b2652b2b' },
      bsc: { chainId: 56, factory: '0x39d760601731025e0f02a3e5d232445797fac0cc', pool: '0x28e2ea090877bf75740558f6bfb36a5ffee9e9df' },
    },
  },
  {
    id: 'peddleswap',
    name: 'PeddleSwap',
    url: 'https://peddleswap.xyz',
    lookup: 'api',
    api: {
      path: '/v1/launches/{token}',
      root: 'launch',
      fields: { chainId: 'chainId', address: 'address', creator: 'creator', block: 'blockNumber' },
      pool: { path: '/v1/token-directory/{token}', field: 'token.market.pool' },
    },
    chains: {
      robinhood: { chainId: 4663, api: 'https://api.peddleswap.xyz' },
      base: { chainId: 8453, api: 'https://api-base.peddleswap.xyz' },
    },
  },
  // Gully Launchpad (gully-ops/l3/launchpad) on Gully Chain Testnet, through our own indexer (gully-ops/l3/indexer):
  // GET /tokens/:token -> { token: { address, source: 'launchpad', creator, createdBlock, pool, ... } }; a token the
  // indexer does not know is a 404, and a token it indexed from a Uniswap v3 pool alone has source 'pool' (not a
  // launch). The indexer serves one chain, so the answer carries no chainId (fields.chainId is omitted). When the
  // indexer is down, server/gully-chain.mjs reads the launchpads themselves for the score; the map says "not a launch".
  {
    id: 'gully-launchpad',
    name: 'Gully Launchpad',
    url: 'https://gullychain.xyz',
    lookup: 'api',
    api: {
      base: 'https://indexer.gullychain.xyz',
      baseEnv: 'GULLY_INDEXER',
      path: '/tokens/{token}',
      root: 'token',
      require: { field: 'source', equals: 'launchpad' },
      fields: { address: 'address', creator: 'creator', block: 'createdBlock' },
      pool: { path: '/tokens/{token}', field: 'token.pool' },
    },
    chains: {
      gully: { chainId: 485590 },
    },
  },
]

const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)
const lc = (a) => (isAddr(a) ? a.toLowerCase() : null)
const dig = (o, path) => String(path).split('.').reduce((v, k) => (v === null || v === undefined ? undefined : v[k]), o)
const isHttps = (u) => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u)

/** Problems with one registry entry (an empty list means it is usable). */
export function validateLaunchpad(e) {
  const bad = []
  if (!e || typeof e !== 'object') return ['not an object']
  if (!/^[a-z0-9-]{2,32}$/.test(String(e.id ?? ''))) bad.push('id must be 2-32 chars of a-z 0-9 -')
  if (typeof e.name !== 'string' || !e.name.trim()) bad.push('name missing')
  if (!isHttps(e.url)) bad.push('url must be https')
  if (e.lookup !== 'api' && e.lookup !== 'factory-event') bad.push("lookup must be 'api' or 'factory-event'")
  const ev = e.event
  if (e.lookup === 'factory-event' && !ev) bad.push('factory-event needs an event')
  if (ev) {
    if (!/^0x[0-9a-f]{64}$/.test(String(ev.topic0 ?? ''))) bad.push('event.topic0 must be a 32-byte lowercase hex topic')
    if (typeof ev.signature !== 'string' || !ev.signature.includes('(')) bad.push('event.signature missing')
    if (![1, 2, 3].includes(ev.token?.topic)) bad.push('event.token.topic must be 1, 2 or 3')
    const c = ev.creator
    const byTopic = [1, 2, 3].includes(c?.topic) && c.word === undefined
    const byWord = Number.isInteger(c?.word) && c.word >= 0 && c.word < 16 && c.topic === undefined
    if (!byTopic && !byWord) bad.push('event.creator must be { topic: 1-3 } or { word: n }')
  }
  const a = e.api
  if (e.lookup === 'api') {
    if (!a || typeof a.path !== 'string' || !a.path.startsWith('/') || !a.path.includes('{token}')) bad.push('api.path must start with / and contain {token}')
    if (!a?.fields?.address) bad.push('api.fields.address is required')
    if (a?.fields?.chainId === undefined && Object.keys(e.chains ?? {}).length !== 1) bad.push('api.fields.chainId may only be omitted for a single-chain API')
    if (a?.base !== undefined && !isHttps(a.base)) bad.push('api.base must be https')
  }
  if (!e.chains || typeof e.chains !== 'object' || !Object.keys(e.chains).length) bad.push('chains missing')
  for (const [k, c] of Object.entries(e.chains ?? {})) {
    const hc = HOLDER_CHAINS[k]
    if (!hc || k === 'solana') bad.push(`chain ${k}: not an EVM Holder Map chain`)
    else if (c?.chainId !== hc.id) bad.push(`chain ${k}: chainId must be ${hc.id}`)
    if (e.lookup === 'api' && !isHttps(c?.api ?? a?.base) && !(a?.baseEnv && process.env[a.baseEnv])) bad.push(`chain ${k}: no https API base`)
    if (c?.api !== undefined && !isHttps(c.api)) bad.push(`chain ${k}: api must be https`)
    if ((e.lookup === 'factory-event' || (ev && c?.factory !== undefined)) && !isAddr(c?.factory)) bad.push(`chain ${k}: factory must be an address`)
    if (c?.pool !== undefined && !isAddr(c.pool)) bad.push(`chain ${k}: pool must be an address`)
  }
  return bad
}

const validateAll = (list) => {
  const seen = new Set()
  for (const e of list) {
    const bad = validateLaunchpad(e)
    if (seen.has(e?.id)) bad.push('duplicate id')
    seen.add(e?.id)
    if (bad.length) throw new Error(`launchpad ${e?.id ?? '?'}: ${bad.join('; ')}`)
  }
}
// holders.mjs imports this module and this module reads holders.mjs's HOLDER_CHAINS, so the check waits until both
// have loaded (a microtask runs after the whole import graph). A bad entry still stops the server at start.
queueMicrotask(() => validateAll(LAUNCHPADS))

let registry = LAUNCHPADS

/** Public metadata of every registered launchpad: { id, name, url, chains: [{ key, id, name }] }. Nothing else leaves this module. */
export function listLaunchpads() {
  return registry.map((e) => ({ id: e.id, name: e.name, url: e.url, chains: Object.keys(e.chains).map((k) => ({ key: k, id: HOLDER_CHAINS[k].id, name: HOLDER_CHAINS[k].name })) }))
}

let fetchImpl = (...a) => globalThis.fetch(...a)
const cache = new Map() // `${ck}:${token}` -> { v, exp }
const inflight = new Map()
let running = 0
let minute = { at: 0, n: 0 }

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

/** The launch event of `token` in exactly `block`: { creator } or null (none there); undefined when no node could say. */
async function eventCreator(lp, ck, token, block) {
  const ev = lp.event
  const hex = '0x' + block.toString(16)
  const topics = [ev.topic0, null, null, null].slice(0, ev.token.topic + 1)
  topics[ev.token.topic] = '0x' + '0'.repeat(24) + token.slice(2)
  for (const url of (await archiveUrls(ck)).slice(0, 2)) {
    try {
      const logs = await rpcAt(url, 'eth_getLogs', [{ address: lp.chains[ck].factory, topics, fromBlock: hex, toBlock: hex }])
      const log = logs?.[0]
      if (log) {
        if (ev.creator.topic) {
          const t = String(log.topics?.[ev.creator.topic] ?? '')
          if (/^0x[0-9a-fA-F]{64}$/.test(t)) return { creator: lc('0x' + t.slice(26)) }
        } else {
          const d = String(log.data ?? '')
          const end = 2 + 64 * (ev.creator.word + 1)
          if (d.length >= end && /^0x[0-9a-fA-F]+$/.test(d)) return { creator: lc('0x' + d.slice(end - 40, end)) }
        }
      }
      if (Array.isArray(logs)) return null
    } catch {
      /* next url */
    }
  }
  return undefined
}

/** One launchpad by its API: an object (a launch), null (definitely not), or undefined (could not tell). */
async function apiLookup(lp, ck, token) {
  const cfg = lp.chains[ck]
  const a = lp.api
  const base = String((a.baseEnv && process.env[a.baseEnv]) || cfg.api || a.base).replace(/\/+$/, '')
  const fill = (path) => base + path.replace('{chainId}', String(cfg.chainId)).replace('{token}', token)
  let d = null
  let down = false
  try {
    const r = await getJson(fill(a.path))
    if (r.status === 404) return null
    const root = r.ok && r.body && (!a.okField || dig(r.body, a.okField)) ? (a.root ? dig(r.body, a.root) : r.body) : null
    if (root && typeof root === 'object') d = root
    else down = true
  } catch {
    down = true
  }
  let creator = null
  let creationBlock = null
  if (d) {
    const f = a.fields
    if ((f.chainId !== undefined && Number(dig(d, f.chainId)) !== cfg.chainId) || lc(dig(d, f.address)) !== token) return null
    if (a.require && dig(d, a.require.field) !== a.require.equals) return null
    creator = lc(dig(d, f.creator))
    if (f.block) {
      const n = Number(dig(d, f.block))
      creationBlock = Number.isSafeInteger(n) && n > 0 ? n : null
    } else creationBlock = await withDeadline(creationBlockOf(ck, token), BLOCK_MS, null)
  } else if (down) {
    // API down: the factory event in the creation block decides, when this launchpad declares one.
    if (!lp.event || !cfg.factory) return undefined
    creationBlock = await withDeadline(creationBlockOf(ck, token), BLOCK_MS, null)
    if (creationBlock === null) return undefined
    const hit = await eventCreator(lp, ck, token, creationBlock)
    if (hit === undefined) return undefined
    if (hit === null) return null
    creator = hit.creator
  }
  const out = { venue: lp.id, chainId: cfg.chainId, token, creationBlock, deployer: creator }
  if (cfg.pool) out.pool = lc(cfg.pool)
  else if (d && a.pool) {
    try {
      const p = await getJson(fill(a.pool.path))
      const pool = lc(dig(p.body, a.pool.field))
      if (p.ok && pool) out.pool = pool
    } catch {
      /* the pool is optional */
    }
  }
  return out
}

/** One launchpad by its factory event alone (no API). */
async function eventLookup(lp, ck, token) {
  const cfg = lp.chains[ck]
  const creationBlock = await withDeadline(creationBlockOf(ck, token), BLOCK_MS, null)
  if (creationBlock === null) return undefined
  const hit = await eventCreator(lp, ck, token, creationBlock)
  if (!hit) return hit
  const out = { venue: lp.id, chainId: cfg.chainId, token, creationBlock, deployer: hit.creator }
  if (cfg.pool) out.pool = lc(cfg.pool)
  return out
}

async function lookup(ck, token) {
  const lps = registry.filter((lp) => lp.chains[ck])
  const settled = await Promise.allSettled(lps.map((lp) => (lp.lookup === 'api' ? apiLookup(lp, ck, token) : eventLookup(lp, ck, token))))
  const vals = settled.map((x) => (x.status === 'fulfilled' ? x.value : undefined))
  const hit = vals.find((v) => v && typeof v === 'object')
  if (hit) return hit
  return vals.some((v) => v === undefined) ? undefined : null
}

function put(key, v) {
  const ttl = v === undefined ? TTL.fail : v === null ? TTL.neg : v.creationBlock === null ? TTL.posNoBlock : TTL.pos
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
  cache.set(key, { v: v ?? null, exp: Date.now() + ttl })
}

/** Is (chainKey, token) a launch from a registered launchpad? null when not, unknown, or on any failure. */
export async function knownLaunch(chainKey, token) {
  try {
    if (!HOLDER_CHAINS[chainKey] || chainKey === 'solana') return null
    if (!registry.some((lp) => lp.chains[chainKey])) return null
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
/** Registry = the built-in entries plus `extra` (validated); no argument restores the built-ins. */
export function setLaunchpadsForTest(extra = []) {
  const list = [...LAUNCHPADS, ...extra]
  validateAll(list)
  registry = list
}
export function resetLaunchpadsForTest() {
  cache.clear()
  inflight.clear()
  running = 0
  minute = { at: 0, n: 0 }
}
