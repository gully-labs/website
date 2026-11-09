// Holder Map intelligence on top of holders.mjs's map: the Launch Health score, the deployer's history,
// clusters seen in other launches, one wallet's trading on a launch, live updates, the "new launches,
// checked" feed, "most scanned today", the search resolver and the facts Gully AI is given.
//
// Every figure comes from the chain's Transfer logs, the Gully Launchpad indexer or the map itself, with the
// time it was read (the former partner launchpad's API was retired on 2026-11-08). Where a part cannot be read it is left out and said so: the
// score is computed over the parts that are known (`counted` says how many points of weight that is).
//
// Launch Health (0-100, launches only; never gated):
//   liquidity  20  launch liquidity in the launchpad's lock (the lock record for each pool)
//   bundle     20  share held now by wallets that bought together in the first block of trading
//   deployer   20  share held by the deployer and the wallets it funded
//   top10      15  share held by the 10 biggest wallets (pools, locks, burn and exchanges not counted)
//   snipers    10  wallets whose first buy came in the first blocks of trading
//   record     15  the deployer's earlier launches: liquidity pulled or tokens sold by the deployer (not read since 2026-11-08)

import { dayLA } from './time-la.mjs'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './http.mjs'
import { decodeTransfer, evmRpc, findStock, flowSide, HOLDER_CHAINS, readHolderMap, short, TRANSFER_TOPIC } from './holders.mjs'
import { allLaunches as gullyLaunches, GULLY_CHAIN } from './gully-chain.mjs'
import { isSolanaAddress } from './solana.mjs'
import { detectChains } from './holders-any.mjs'
import { holderPageUrl } from './hosts.mjs'

const lower = (a) => String(a ?? '').toLowerCase()
const isAddr = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)
const round1 = (n) => Math.round(n * 10) / 10
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const pagePath = (chainKey, token) => `/holders/${chainKey}/${token}`
// holders.mjs and this module import each other: chain tables are read lazily, never at load.
const keyById = (id) => Object.entries(HOLDER_CHAINS).find(([, c]) => c.id === Number(id))?.[0] ?? String(id)
const fmt = (n) => (n === null || n === undefined ? '?' : n >= 10 ? `${Math.round(n)}%` : n >= 1 ? `${n.toFixed(1)}%` : n > 0 ? `${n < 0.1 ? '<0.1' : n.toFixed(1)}%` : '0%')

/* ---------------------------------------------------------- Launch Health --- */

export const HEALTH_WEIGHTS = { liquidity: 20, bundle: 20, deployer: 20, top10: 15, snipers: 10, record: 15 }
const clamp01 = (x) => Math.max(0, Math.min(1, x))

/** The score from a launch map (and its deployer history when read). Pure. */
export function launchHealth(map) {
  const f = map.forensics
  if (!f) return null
  const W = HEALTH_WEIGHTS
  const flagged = (fl) => map.nodes.filter((n) => n.flags.includes(fl)).map((n) => n.id)
  const parts = []
  const lock = f.liquidity?.locked
  parts.push({ id: 'liquidity', label: 'Liquidity locked', weight: W.liquidity, points: lock === true ? W.liquidity : lock === false ? 0 : null, value: lock === true ? 'Locked' : lock === false ? 'Not locked' : 'Not stated', reason: lock === true ? 'The launch liquidity sits in DeepCore’s launch lock, so it cannot simply be pulled.' : lock === false ? 'DeepCore shows no lock on the launch liquidity: it could be withdrawn.' : 'DeepCore does not say whether the liquidity is locked, so this part is left out.', wallets: f.liquidity?.locker ? [lower(f.liquidity.locker)] : [] })
  const b = f.bundled?.pct ?? 0
  parts.push({ id: 'bundle', label: 'First-block bundle', weight: W.bundle, points: Math.round(W.bundle * clamp01(1 - b / 30)), value: f.bundled.wallets ? `${plural(f.bundled.wallets, 'wallet')}, ${fmt(b)}` : 'None', reason: f.bundled.wallets ? `${plural(f.bundled.wallets, 'wallet')} bought together in the first block of trading and hold ${fmt(b)} now. 30% or more scores zero.` : 'No group of wallets bought together in the first block of trading.', wallets: flagged('bundled') })
  const d = (f.deployerPct ?? 0) + (f.funded?.pct ?? 0)
  parts.push({ id: 'deployer', label: 'Deployer and funded wallets', weight: W.deployer, points: Math.round(W.deployer * clamp01(1 - d / 20)), value: fmt(d), reason: `${f.funded?.wallets ? `The deployer and the ${plural(f.funded.wallets, 'wallet')} it sent tokens${f.funded.coinChecked ? ' or coins' : ''} to hold ${fmt(d)}` : `The deployer holds ${fmt(d)} and sent tokens to no other wallet we can see`}. 20% or more scores zero.${f.funded?.coinChecked ? '' : ' Coin funding was not checked on this chain.'}`, wallets: [...(f.deployer ? [f.deployer] : []), ...flagged('funded-by-deployer')] })
  const t = map.summary?.top10Pct ?? null
  parts.push({ id: 'top10', label: 'Top-10 concentration', weight: W.top10, points: t === null ? null : Math.round(W.top10 * clamp01(1 - Math.max(0, t - 20) / 60)), value: fmt(t), reason: t === null ? 'Unknown.' : `The 10 biggest wallets hold ${fmt(t)}. Up to 20% scores full points; 80% or more scores zero.`, wallets: map.nodes.filter((n) => !n.label || n.label.kind === 'deployer').slice(0, 10).map((n) => n.id) })
  const sn = f.snipers?.wallets ?? 0
  parts.push({ id: 'snipers', label: 'Snipers', weight: W.snipers, points: Math.round(W.snipers * clamp01(1 - sn / 10)), value: String(sn), reason: sn ? `${plural(sn, 'wallet')} bought in the first ${f.snipers.blocks} blocks of trading and hold ${fmt(f.snipers.pct)}. Ten or more scores zero.` : `Nobody bought in the first ${f.snipers?.blocks ?? 5} blocks of trading.`, wallets: flagged('sniper') })
  const h = map.deployerHistory
  let rec = { points: null, value: 'Not checked', reason: h?.reason ?? 'The deployer’s earlier launches could not be read.' }
  if (h?.checked) {
    const bad = h.launches.filter((l) => l.outcome === 'liquidity-pulled' || l.outcome === 'deployer-sold').length
    if (!h.total) rec = { points: null, value: 'First launch', reason: 'This is the first launch we have seen from this deployer: no record either way, so this part is left out.' }
    else rec = { points: Math.round(W.record * clamp01(1 - bad / Math.max(1, Math.min(h.total, 3))) * (h.serial ? 0.6 : 1)), value: `${h.total} earlier${bad ? `, ${bad} bad` : ''}`, reason: `${h.total} earlier DeepCore ${h.total === 1 ? 'launch' : 'launches'} from this deployer${bad ? `; in ${bad} the liquidity was pulled or the deployer sold` : ', none with liquidity pulled or a deployer sell-off'}.${h.serial ? ' Serial launcher: three or more launches.' : ''}` }
  }
  parts.push({ id: 'record', label: 'Deployer track record', weight: W.record, ...rec, wallets: f.deployer ? [f.deployer] : [] })
  const known = parts.filter((p) => p.points !== null)
  const counted = known.reduce((s, p) => s + p.weight, 0)
  const score = counted >= 50 ? Math.round((100 * known.reduce((s, p) => s + p.points, 0)) / counted) : null
  const level = score === null ? null : score >= 75 ? 'good' : score >= 50 ? 'mixed' : 'poor'
  const verdict = score === null ? 'Not enough is known to score this launch yet.' : level === 'good' ? 'Few warning signs on the checks we can run.' : level === 'mixed' ? 'Some warning signs: read the parts below.' : 'Strong warning signs: read the parts below.'
  return { score, level, verdict, counted, parts }
}

/* -------------------------------------------------------- deployer history --- */

const RETIRED_RECORD = 'The deployer’s earlier launches are not read any more: the former partner launchpad’s record was retired on 2026-11-08.'

/** The deployer's other launches. Not read since 2026-11-08 (the partner launchpad's account activity was the only source). */
export async function readDeployerHistory() {
  return { checked: false, reason: RETIRED_RECORD, total: 0, serial: false, launches: [], more: 0 }
}

/* ------------------------------------------------------------- one wallet --- */

/** One wallet's trading on a launch. The only source (the partner launchpad's account activity) was retired on 2026-11-08. */
export async function readWalletDetail(chainKey, token, address) {
  if (chainKey === 'solana' || !isAddr(address)) return { state: 'unsupported', reason: 'Wallet details are not available for this token.' }
  return { state: 'unsupported', reason: 'Wallet trading details were read from the former partner launchpad’s index, which was retired on 2026-11-08.' }
}

/* ------------------------------------------------------------------ live --- */

const liveCache = new Map()
/**
 * Transfers since `since` (a block) for an open map, from our RPCs (EVM tokens). Shared per token for 10 s. Returns { state, cursor, transfers: [{ from, to, pct, block, at }], pcts }.
 */
export async function readLive(chainKey, tokenIn, sinceIn) {
  const map = await readHolderMap(chainKey, tokenIn, { tier: 'free' })
  if (map.state !== 'ok' || !map.live?.supported) return { state: 'unsupported', reason: 'Live updates are not available for this token.' }
  const since = Number.isInteger(sinceIn) && sinceIn > 0 ? sinceIn : map.live.cursor
  const key = `${chainKey}:${map.token.address}:${since}`
  const hit = liveCache.get(key)
  if (hit && Date.now() - hit.at < 10_000) return hit.body
  const c = HOLDER_CHAINS[chainKey]
  let logs = null
  let cursor = since
  try {
    const head = Number(BigInt(await evmRpc(chainKey, 'eth_blockNumber', [])))
    const from = Math.max(since + 1, head - 5_000)
    // No new block since the last poll (quiet chains such as Gully Chain testnet only make blocks on demand, and a
    // lagging RPC can report a head below the cursor): nothing new, not an RPC error. fromBlock > toBlock is
    // rejected by the RPC and surfaced as a 502 on every idle poll.
    if (from > head) {
      logs = []
      cursor = head
    } else logs = await evmRpc(chainKey, 'eth_getLogs', [{ address: map.token.address, topics: [TRANSFER_TOPIC], fromBlock: '0x' + from.toString(16), toBlock: '0x' + head.toString(16) }])
    if (from <= head) cursor = head
  } catch {
    logs = null
  }
  if (!Array.isArray(logs)) return { state: 'error', reason: 'New transfers could not be read just now.', cursor: since }
  const supply = map.token.supply
  const dec = map.token.decimals
  const byId = new Map(map.nodes.map((n) => [n.id, n]))
  const labelOf = (a) => byId.get(a)?.label ?? null
  const delta = new Map()
  const transfers = []
  for (const l of logs.slice(-200)) {
    const t = decodeTransfer(l)
    if (!t) continue
    const u = Number(t.value) / 10 ** dec
    const pct = supply ? Math.round((u / supply) * 1_000_000) / 10_000 : null
    transfers.push({ from: t.from, to: t.to, side: flowSide(t.from, t.to, labelOf), pct, units: Math.round(u * 1e6) / 1e6, block: t.block, at: t.ts ? new Date(t.ts * 1000).toISOString() : null, tx: t.tx ?? null })
    if (pct !== null) {
      if (byId.has(t.from)) delta.set(t.from, (delta.get(t.from) ?? 0) - pct)
      if (byId.has(t.to)) delta.set(t.to, (delta.get(t.to) ?? 0) + pct)
    }
  }
  const pcts = Object.fromEntries([...delta].map(([a, d]) => [a, Math.max(0, Math.round(((byId.get(a).pct ?? 0) + d) * 100) / 100)]))
  // The top 10 people (not pools, locks, burn or exchanges) with the moved shares: the side panel's live figure.
  const people = map.nodes.filter((n) => !LIVE_INFRA.has(n.label?.kind)).map((n) => (n.id in pcts ? pcts[n.id] : n.pct ?? 0))
  const top10Pct = supply ? Math.round(people.sort((a, b) => b - a).slice(0, 10).reduce((s, v) => s + v, 0) * 100) / 100 : null
  const body = { state: 'ok', since, cursor, transfers, pcts, top10Pct, asOf: new Date().toISOString(), note: 'Shares move from the map’s last full read; the full map is rebuilt every five minutes.' }
  liveCache.set(key, { at: Date.now(), body })
  if (liveCache.size > 300) liveCache.delete(liveCache.keys().next().value)
  return body
}

/* ------------------------------------------------------- most scanned today --- */

const SCANS_FILE = () => path.join(process.env.DATA_DIR ?? DATA_DIR, 'holder-scans.json')
let scans = null
let scansDirty = false
function loadScans() {
  if (scans) return scans
  try {
    scans = JSON.parse(fs.readFileSync(SCANS_FILE(), 'utf8'))
  } catch {
    scans = {}
  }
  scans.day ??= dayLA()
  scans.items ??= {}
  return scans
}
/* Visitors are counted by a keyed hash of the IP, never the IP itself. The key is random, held in memory
   only and replaced every Los Angeles day, so a tag cannot be turned back into an address or matched across days. */
let tagKey = { day: '', key: null }
function visitorTag(ip, day) {
  if (tagKey.day !== day) tagKey = { day, key: crypto.randomBytes(32) }
  return crypto.createHmac('sha256', tagKey.key).update(String(ip ?? '')).digest('hex').slice(0, 16)
}
/** Starts a new day: yesterday's counts and visitor tags are dropped (and the file is rewritten). */
function rollDay(s) {
  const day = dayLA()
  if (s.day !== day) {
    s.day = day
    s.items = {}
    scansDirty = true
  }
  return day
}
/** Counts one view of a map (at most once per visitor per token per day). */
export function recordScan(chainKey, token, symbol, kind, ip) {
  const s = loadScans()
  const day = rollDay(s)
  const k = `${chainKey}|${token}`
  const e = (s.items[k] ??= { chain: chainKey, token, symbol, kind, scans: 0, ips: [] })
  const tag = visitorTag(ip, day)
  if (e.ips.includes(tag)) return
  e.ips.push(tag)
  if (e.ips.length > 2000) e.ips.splice(0, e.ips.length - 2000)
  e.scans++
  e.symbol = symbol ?? e.symbol
  if (Object.keys(s.items).length > 2000) delete s.items[Object.keys(s.items)[0]]
  scansDirty = true
}
export function topScans(limit = 10) {
  const s = loadScans()
  rollDay(s)
  return { day: s.day, items: Object.values(s.items).sort((a, b) => b.scans - a.scans).slice(0, limit).map((e) => ({ chain: e.chain, token: e.token, symbol: e.symbol, kind: e.kind, scans: e.scans, path: pagePath(e.chain, e.token) })) }
}
export function flushScans() {
  if (!scansDirty || !scans) return
  scansDirty = false
  try {
    fs.mkdirSync(path.dirname(SCANS_FILE()), { recursive: true })
    fs.writeFileSync(SCANS_FILE() + '.tmp', JSON.stringify({ day: scans.day, items: scans.items }))
    fs.renameSync(SCANS_FILE() + '.tmp', SCANS_FILE())
  } catch (e) {
    console.error('holder scans save:', e?.message ?? e)
  }
}
setInterval(flushScans, 60_000).unref?.()
export const resetScansForTest = () => {
  scans = { day: dayLA(), items: {} }
}

/* ------------------------------------------------- new launches, checked --- */

/**
 * The newest Gully Launchpad launches (Gully Chain, from the indexer) as the Holder Map checks them; maps not built yet
 * are started (a few per call). The former partner launchpad's feed was retired on 2026-11-08. { state: 'ok' |
 * 'unreadable', asOf, launches }.
 */
export async function readLaunchFeed({ limit = 12 } = {}) {
  const r = await gullyLaunchFeed(limit)
  let started = 0
  const launches = []
  for (const l of r.launches) {
    const ck = l.chainKey
    if (!HOLDER_CHAINS[ck]) continue
    const token = lower(l.token)
    const base = { chainKey: ck, chainName: l.chainName, token, symbol: l.symbol, createdAt: l.createdAt, path: pagePath(ck, token) }
    const peek = peekMap(ck, token)
    if (peek) {
      launches.push({ ...base, state: peek.state === 'ok' ? 'checked' : 'unavailable', health: peek.health ? { score: peek.health.score, level: peek.health.level, verdict: peek.health.verdict } : null, riskLine: peek.forensics?.riskLine ?? null, preview: peek.state === 'ok' ? mapPreview(peek) : null })
      continue
    }
    if (started < 2) {
      started++
      readHolderMap(ck, token, { tier: 'free' }).catch(() => null)
    }
    launches.push({ ...base, state: 'checking', health: null, riskLine: null })
  }
  return { state: r.state, asOf: r.asOf, launches }
}
/** Gully Launchpad tokens from the indexer, newest first, in the feed's launch shape. */
async function gullyLaunchFeed(limit) {
  const all = await gullyLaunches()
  if (!Array.isArray(all)) return { state: 'unreadable', asOf: null, launches: [] }
  const ck = Object.entries(HOLDER_CHAINS).find(([, c]) => c.id === GULLY_CHAIN.id)?.[0] ?? 'gully'
  const launches = all
    .filter((x) => x && x.source === 'launchpad' && isAddr(x.address))
    .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))
    .slice(0, limit)
    .map((x) => ({ chainKey: ck, chainName: HOLDER_CHAINS[ck]?.name ?? 'Gully Chain', token: lower(x.address), symbol: x.symbol ?? null, createdAt: Number(x.createdAt) > 0 ? new Date(Number(x.createdAt) * 1000).toISOString() : null }))
  return { state: 'ok', asOf: new Date().toISOString(), launches }
}
const LIVE_INFRA = new Set(['pool', 'lock', 'burn', 'token', 'deepcore', 'router', 'gully', 'exchange'])
/**
 * A tiny picture of a built map for the launch feed's mini maps: the biggest PREVIEW_NODES bubbles
 * ({ p: share, k: what it is }) and the latest flows between them ({ f, t: index or -1 when off the
 * preview, s: side }). Read from the cached map; nothing is built for it.
 */
export const PREVIEW_NODES = 14
export function mapPreview(map) {
  const nodes = (map.nodes ?? []).slice(0, PREVIEW_NODES)
  const idx = new Map(nodes.map((n, i) => [n.id, i]))
  const kindOf = (n) => (n.label?.kind === 'deployer' ? 'deployer' : n.label && LIVE_INFRA.has(n.label.kind) ? (['pool', 'lock', 'burn'].includes(n.label.kind) ? n.label.kind : 'infra') : n.cluster ? 'cluster' : 'wallet')
  return {
    nodes: nodes.map((n) => ({ p: n.pct ?? 0, k: kindOf(n) })),
    flows: (map.recentFlows ?? []).slice(-8).map((f) => ({ f: idx.get(f.from) ?? -1, t: idx.get(f.to) ?? -1, s: f.side })),
  }
}

let peekMap = () => null
/** holders.mjs hands over its cache reader (no build, no upstream call). */
export const setMapPeek = (fn) => (peekMap = fn)

/* ---------------------------------------------------------------- search --- */

/** "$NVDA", "nvda", an address or a Solana mint: the maps that match. */
export async function resolveHolders(qIn, { ip = null } = {}) {
  const q = String(qIn ?? '').trim().replace(/^\$/, '')
  const out = []
  if (/^[A-Za-z.]{1,10}$/.test(q)) {
    for (const ck of ['robinhood', 'bsc', 'solana']) {
      const s = findStock(ck, q)
      if (s) out.push({ chain: ck, chainName: HOLDER_CHAINS[ck].name, token: s.ticker, symbol: s.ticker, name: s.name ?? null, kind: 'stock', path: pagePath(ck, s.ticker) })
    }
    return { matches: out }
  }
  if (isAddr(q)) {
    for (const ck of ['robinhood', 'bsc']) {
      const s = findStock(ck, q)
      if (s) out.push({ chain: ck, chainName: HOLDER_CHAINS[ck].name, token: s.ticker, symbol: s.ticker, kind: 'stock', path: pagePath(ck, s.ticker) })
    }
    if (out.length) return { matches: out, checked: [] }
    // No chain given: every supported chain is checked at once (the token itself).
    return fromChecks(out, await detectChains(q, { ip }), new Map(), q)
  }
  if (isSolanaAddress(q)) {
    const s = findStock('solana', q)
    if (s) return { matches: [{ chain: 'solana', chainName: 'Solana', token: s.ticker, symbol: s.symbol ?? s.ticker, kind: 'stock', path: pagePath('solana', s.ticker) }], checked: [] }
    return fromChecks(out, await detectChains(q, { ip }), new Map(), q)
  }
  return { matches: [], checked: [] }
}

/** The probe results as search matches (a token on several chains gives several, for the picker) and the plain list of what was checked. */
function fromChecks(out, det, launches, q) {
  if (det.busy) return { busy: true, matches: [], checked: [] }
  const address = q.startsWith('0x') ? lower(q) : q
  const checked = det.results.map((r) => ({ chain: r.chain, chainName: r.chainName, status: launches.has(r.chain) ? 'token' : r.status, reason: launches.has(r.chain) ? null : (r.reason ?? null) }))
  for (const r of det.results) {
    const l = launches.get(r.chain)
    if (l) out.push({ chain: r.chain, chainName: r.chainName, token: address, symbol: l.launchToken?.symbol ?? r.symbol ?? null, kind: 'deepcore-launch', path: pagePath(r.chain, address) })
    else if (r.status === 'token') out.push({ chain: r.chain, chainName: r.chainName, token: address, symbol: r.symbol ?? null, name: r.name ?? null, kind: 'token', path: pagePath(r.chain, address) })
  }
  return { matches: out, checked }
}

/* ------------------------------------------------------------- Gully AI --- */

/** The computed facts of a map for Gully AI (no raw holder lists). */
export function holdersFacts(map) {
  if (map.state !== 'ok') return { state: map.state, reason: map.reason ?? null }
  return {
    token: `${map.token.symbol ?? short(map.token.address)} on ${map.chain.name}`,
    kind: map.kind === 'deepcore-launch' ? 'launchpad launch' : map.kind === 'launch' ? `${map.venue ?? 'launchpad'} launch` : map.kind === 'token' ? 'token' : 'tokenised stock',
    coverage: map.coverage?.level === 'top' ? `top holders only: ${map.coverage.reason}` : 'every holder',
    asOf: map.asOf,
    summary: map.summary.line,
    plain: map.summary.plain,
    holdersCount: map.holders.count,
    sharesOf: map.holders.sharesOf,
    clusters: map.clusters.slice(0, 5).map((c) => ({ wallets: c.count, pct: c.pct, includesDeployer: c.hasDeployer })),
    hiddenLinks: map.hidden?.length ?? 0,
    health: map.health ? { score: map.health.score, verdict: map.health.verdict, parts: map.health.parts.map((p) => ({ part: p.label, weight: p.weight, points: p.points, value: p.value, reason: p.reason })) } : null,
    forensics: map.forensics ? { riskLine: map.forensics.riskLine, bundled: map.forensics.bundled, snipers: map.forensics.snipers, deployerPct: map.forensics.deployerPct, funded: { wallets: map.forensics.funded.wallets, pct: map.forensics.funded.pct }, liquidityLocked: map.forensics.liquidity.locked } : null,
    deployerHistory: map.deployerHistory ? { total: map.deployerHistory.total, serial: map.deployerHistory.serial, outcomes: map.deployerHistory.launches.map((l) => `${l.symbol ?? short(l.token)}: ${l.outcome}`) } : null,
    otherLaunchesOfCluster: map.crossToken?.line ?? null,
    fairPrice: map.fair,
    sources: map.sources,
    page: holderPageUrl(map.chain.key, map.token.address),
  }
}
