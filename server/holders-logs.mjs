/* Our own Transfer-log index for tokens no one else indexes for us (stock tokens on EVM chains): holder
   balances, links and clusters are rebuilt from every Transfer since the token was deployed, read through
   our own RPC failover (GULLY_RPC_<chainId> first, e.g. dRPC, then the public defaults).

   - The start: the token's deploy block, found once by a binary search on eth_getCode over block height
     (needs an archive node) and kept forever.
   - The backfill: eth_getLogs in adaptive windows (5,000 blocks to start; a quarter on "limit exceeded" or
     "too many results", double while answers are small), on archive-capable URLs only, with a cursor
     persisted per token, so a restart resumes where it stopped. A session is bounded (calls and time) and
     continues in the background; until it reaches the head the map says so instead of drawing partial
     balances as if complete.
   - After that: incremental reads from the cursor on any URL (recent windows work on public nodes).
   - Archive capability is probed per configured URL (GULLY_RPC_<chainId>; an old, narrow log range and an
     old balance read) and cached. The public defaults are never probed or asked for history.
   - A token with more than CAP transfers stops there with a clear note.
   Store: DATA_DIR/holder-logs/<chain>-<token>.json. Pure IO helpers here; the map is built in holders.mjs. */

import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './http.mjs'
import { decodeTransfer, HOLDER_CHAINS, rpcAt, rpcEnvUrls, rpcUrlList, TRANSFER_TOPIC } from './holders.mjs'

export const LOGS = {
  /** Transfers above this are not rebuilt (memory and time); the map says so. */
  cap: 200_000,
  startWindow: 5_000,
  minWindow: 10,
  maxWindow: 1_000_000,
  /** A window answering fewer logs than this grows (x2). */
  growBelow: 1_500,
  /** RPC calls and wall time per foreground session (the rest continues in the background). */
  sessionCalls: 40,
  sessionMs: 15_000,
  /** The archive probe: blocks this far from the chain's start. */
  probeFrom: 1,
  probeTo: 2,
  archiveTtlMs: 3_600_000,
  failTtlMs: 600_000,
  dir: null,
}
const hex = (n) => '0x' + Math.max(0, Math.floor(n)).toString(16)
const num = (h) => (typeof h === 'string' && /^0x[0-9a-f]+$/i.test(h) ? Number(BigInt(h)) : typeof h === 'number' ? h : null)
const storeDir = () => LOGS.dir ?? path.join(process.env.DATA_DIR ?? DATA_DIR, 'holder-logs')
const fileOf = (chainKey, token) => path.join(storeDir(), `${chainKey}-${token.toLowerCase()}.json`)

/* "Too many results" / range limits: shrink and retry. "Archive" / "personal token" / "pruned": not archive. */
const RANGE_RE = /limit exceeded|too many|range|exceed|more than|results|10000|query timeout|response size/i
const ARCHIVE_RE = /archive|personal token|pruned|missing trie|header not found|state.*not available|historical/i

/* ------------------------------------------------------------ archive probe --- */

const archive = new Map() // url -> { ok, at }
const probing = new Map()
/** Probes one URL: an old, narrow log range and an old balance read must both answer. */
export async function probeArchive(chainKey, url) {
  const hit = archive.get(url)
  if (hit && Date.now() - hit.at < (hit.ok ? LOGS.archiveTtlMs : LOGS.failTtlMs)) return hit.ok
  if (probing.has(url)) return probing.get(url)
  const p = (async () => {
    let ok = false
    try {
      const logs = await rpcAt(url, 'eth_getLogs', [{ address: '0x000000000000000000000000000000000000dEaD', fromBlock: hex(LOGS.probeFrom), toBlock: hex(LOGS.probeTo) }])
      const bal = await rpcAt(url, 'eth_getBalance', ['0x000000000000000000000000000000000000dEaD', hex(LOGS.probeFrom)])
      ok = Array.isArray(logs) && typeof bal === 'string'
    } catch {
      ok = false
    }
    archive.set(url, { ok, at: Date.now() })
    return ok
  })().finally(() => probing.delete(url))
  probing.set(url, p)
  return p
}
/** The chain's archive-capable URLs (probed now when the cache is stale). Only the owner's configured RPCs
    (GULLY_RPC_<chainId>, e.g. dRPC) are probed: the public defaults are never asked for history. */
export async function archiveUrls(chainKey) {
  const urls = rpcEnvUrls(chainKey)
  const ok = await Promise.all(urls.map((u) => probeArchive(chainKey, u)))
  return urls.filter((_, i) => ok[i])
}
/** Synchronous: is an archive-capable URL known to be answering? Starts a probe when nothing is known. */
export function archiveKnown(chainKey) {
  if (!HOLDER_CHAINS[chainKey] || chainKey === 'solana') return false
  const urls = rpcEnvUrls(chainKey)
  if (!urls.length) return false
  const now = Date.now()
  let fresh = false
  for (const u of urls) {
    const h = archive.get(u)
    if (h && now - h.at < (h.ok ? LOGS.archiveTtlMs : LOGS.failTtlMs)) {
      fresh = true
      if (h.ok) return true
    }
  }
  if (!fresh) archiveUrls(chainKey).catch(() => null)
  return false
}

/* ------------------------------------------------------------------- store --- */

const mem = new Map() // file -> store (the backfill's working copy)
function load(chainKey, token) {
  const f = fileOf(chainKey, token)
  if (mem.has(f)) return mem.get(f)
  let s = null
  try {
    s = JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    s = null
  }
  s ??= { v: 1, chain: chainKey, token: token.toLowerCase(), startBlock: null, cursor: null, window: LOGS.startWindow, complete: false, capped: false, head: null, transfers: [] }
  mem.set(f, s)
  return s
}
function save(s) {
  try {
    fs.mkdirSync(storeDir(), { recursive: true })
    const f = fileOf(s.chain, s.token)
    fs.writeFileSync(f + '.tmp', JSON.stringify(s))
    fs.renameSync(f + '.tmp', f)
  } catch (e) {
    console.warn('holder-logs: could not save', String(e?.message ?? e).slice(0, 120))
  }
}
/** Stored transfer -> the shape holders.mjs builds from. */
const toTransfer = ([from, to, value, block, tx, index, ts]) => ({ from, to, value: BigInt(value), block, tx, index, ts: ts ?? null })

/* --------------------------------------------------------------- backfill --- */

async function headOf(chainKey) {
  for (const u of rpcUrlList(chainKey)) {
    try {
      const h = num(await rpcAt(u, 'eth_blockNumber', []))
      if (h) return h
    } catch {
      /* next */
    }
  }
  return null
}

/** The first block with code at the token address (binary search on an archive URL), or 0 when unreadable. */
export async function findStartBlock(chainKey, token, url, head) {
  const has = async (b) => {
    const c = await rpcAt(url, 'eth_getCode', [token, hex(b)])
    return typeof c === 'string' && c !== '0x' && c !== '0x0'
  }
  try {
    if (!(await has(head))) return 0
    let lo = 0
    let hi = head
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2)
      if (await has(mid)) hi = mid
      else lo = mid + 1
    }
    return lo
  } catch {
    return 0
  }
}

/**
 * One bounded session: reads logs from the cursor towards the head. Archive URLs only until the history is
 * complete; any URL after. Returns the store's state ('ok' | 'backfilling' | 'no-archive' | 'capped' | 'error').
 */
export async function backfillStep(chainKey, tokenIn, { calls = LOGS.sessionCalls, ms = LOGS.sessionMs } = {}) {
  const token = tokenIn.toLowerCase()
  const s = load(chainKey, token)
  if (s.capped) return 'capped'
  // No archive URL configured and answering: say so before any call (the public defaults are not asked).
  const urls = s.complete ? rpcUrlList(chainKey) : await archiveUrls(chainKey)
  if (!urls.length) return s.complete ? 'error' : 'no-archive'
  const head = await headOf(chainKey)
  if (!head) return 'error'
  if (s.startBlock === null) {
    s.startBlock = await findStartBlock(chainKey, token, urls[0], head)
    s.cursor = s.startBlock - 1
  }
  const t0 = Date.now()
  let used = 0
  let u = 0
  let dirty = false
  while (s.cursor < head && used < calls && Date.now() - t0 < ms) {
    const from = s.cursor + 1
    const to = Math.min(head, from + s.window - 1)
    used++
    let logs
    try {
      logs = await rpcAt(urls[u], 'eth_getLogs', [{ address: token, topics: [TRANSFER_TOPIC], fromBlock: hex(from), toBlock: hex(to) }])
      if (!Array.isArray(logs)) throw new Error('not a list')
    } catch (e) {
      const msg = String(e?.message ?? e)
      if (ARCHIVE_RE.test(msg) && !s.complete) {
        // This URL cannot serve history after all: mark it and use the next one.
        archive.set(urls[u], { ok: false, at: Date.now() })
        u++
        if (u >= urls.length) break
        continue
      }
      if (RANGE_RE.test(msg) && s.window > LOGS.minWindow) {
        s.window = Math.max(LOGS.minWindow, Math.floor(s.window / 4))
        dirty = true
        continue
      }
      u++
      if (u >= urls.length) break
      continue
    }
    for (const l of logs) {
      const t = decodeTransfer(l)
      if (t) s.transfers.push([t.from, t.to, t.value.toString(), t.block, t.tx, t.index, t.ts])
    }
    s.cursor = to
    if (logs.length < LOGS.growBelow) s.window = Math.min(LOGS.maxWindow, s.window * 2)
    dirty = true
    if (s.transfers.length > LOGS.cap) {
      s.capped = true
      s.transfers = []
      break
    }
    if (used % 20 === 0) save(s)
  }
  if (s.cursor >= head) s.complete = true
  s.head = head
  if (dirty || s.complete) save(s)
  if (s.capped) return 'capped'
  if (!s.complete) return u >= urls.length ? 'no-archive' : 'backfilling'
  return 'ok'
}

const running = new Map()
/** Keeps a backfill going in the background until it is complete (one per token). */
function continueInBackground(chainKey, token) {
  const k = `${chainKey}:${token}`
  if (running.has(k) || LOGS.noBackground) return
  const p = (async () => {
    for (let i = 0; i < 10_000; i++) {
      const st = await backfillStep(chainKey, token).catch(() => 'error')
      if (st !== 'backfilling') break
    }
  })().finally(() => running.delete(k))
  running.set(k, p)
}

/**
 * The token's full history from our own index:
 *   { state: 'ok', transfers, fromBlock, toBlock, complete: true, count }
 *   { state: 'backfilling', progress (0..1) } · { state: 'no-archive' } · { state: 'capped', cap } · { state: 'error' }
 */
export async function readOwnHistory(chainKey, token) {
  if (!HOLDER_CHAINS[chainKey] || chainKey === 'solana') return { state: 'error' }
  const st = await backfillStep(chainKey, token)
  const s = load(chainKey, token.toLowerCase())
  if (st === 'backfilling') {
    continueInBackground(chainKey, token.toLowerCase())
    const span = Math.max(1, (s.head ?? 0) - (s.startBlock ?? 0))
    return { state: 'backfilling', progress: Math.max(0, Math.min(0.99, ((s.cursor ?? 0) - (s.startBlock ?? 0)) / span)) }
  }
  if (st === 'capped') return { state: 'capped', cap: LOGS.cap }
  if (st !== 'ok' && !s.complete) return { state: st }
  // Complete, possibly a little behind the head when the incremental read failed: still exact up to the cursor.
  return { state: 'ok', transfers: s.transfers.map(toTransfer), fromBlock: s.startBlock ?? 0, toBlock: s.cursor, complete: true, count: s.transfers.length }
}

/** Operators: per chain, whether an archive URL is known to answer. */
export const archiveStatus = (chainKey) => archiveKnown(chainKey)

/** Test hooks. */
export function resetLogsForTest(over = {}) {
  archive.clear()
  probing.clear()
  mem.clear()
  running.clear()
  Object.assign(LOGS, over)
}
export const storeForTest = (chainKey, token) => load(chainKey, token)
export const dropMemoryForTest = () => mem.clear()
