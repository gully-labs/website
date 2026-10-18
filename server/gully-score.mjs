// The Gully Score: a transparent 0 to 100 reading of how a contract is controlled and how it has behaved, built
// only from public evidence. Every component is shown with its weight, its source, a plain reason and a link to
// the evidence.
//
// THE RULES (the methodology page states them too):
//   - Nothing paid goes in. This module reads no plan, payment, account or workspace: computeScore() takes a chain
//     and an address and nothing else, and it imports nothing from plans.mjs, billing.mjs or store.mjs
//     (scripts/test-gully-score.mjs checks the imports). Nobody can pay to change a score.
//   - A Gully Security review counts only when its report is PUBLISHED (and is linked, with its severity counts).
//     A draft, a private or a paid-for-but-unpublished report counts for nothing. There is no badge to buy.
//   - Missing data is "not available": the component is shown, says why, and is left out of the weighting. It is
//     never scored as 0. With less than MIN_COVERAGE of the weight available there is no score at all.
//   - Informational only: not an endorsement, not investment advice.
//
// Components (weights in COMPONENTS; the score is the weighted mean of the available ones, rounded):
//   verified        source code verified (Sourcify; Etherscan too when ETHERSCAN_API_KEY is set)
//   control         who can change it: nobody, a Safe needing 2+ signatures, a timelock, another contract, or one wallet
//   timelock        whether changes wait behind a delay (OpenZeppelin TimelockController getMinDelay, Compound delay)
//   upgradeability  whether its code can be swapped (ERC-1967 / beacon / ZeppelinOS slots, Sourcify's proxy check)
//   changes         privileged changes seen by Gully Security monitoring in the last 30 days (only when watched)
//   liquidity       launch liquidity locked (DeepCore launches only, from DeepCore's indexer)
//   holders         Launch Health or top-10 holder share from the Holder Map (GET /api/holders/:chain/:token, when
//                   that service runs on this server; otherwise not available and said so)
//   review          a published Gully Security report (server/security/reports.mjs publishedReportFor, when present)
//   age             how long the contract has existed (its deployment block, from Sourcify or Etherscan)
//
// Endpoints (server.mjs):
//   GET /api/score                          the listed scores (index page, sitemap)
//   GET /api/score/methodology              the components, weights and sources
//   GET /api/score/:chain/:address          one score (computed when missing or older than TTL_MS; rate limited)
//   GET /score/:chain/:address/badge.svg    the embeddable badge (kit mark, score, date)
//
// Listed (index, sitemap, indexable page): a contract a workspace watches with monitoring and lets be listed, or
// one with a published Gully Security report. Any other contract can be scored on request; its page is noindex.
//
// Stored in DATA_DIR/gully-score.json: per contract the latest result, its history (one point per change or day)
// and a change log of component moves. External reads are cached (Sourcify 24 h).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { clientIp, DATA_DIR, json } from './http.mjs'
import { CHAINS, rpc as payRpc } from './payments.mjs'
import { chainOf, decodeString, listedContracts, monitorChains, monitorFacts, onMonitorEvents, readControl, SEL, short } from './sec-monitor.mjs'
import { readLaunches } from './deepcore.mjs'

const FILE = () => path.join(DATA_DIR, 'gully-score.json')
export const METHOD_VERSION = 1
export const TTL_MS = 6 * 3_600_000
const SOURCIFY_TTL_MS = 24 * 3_600_000
const FAIL_TTL_MS = 10 * 60_000
export const MIN_COVERAGE = 40
const KEEP_HISTORY = 400
const KEEP_CHANGES = 200
const CHANGE_WINDOW_DAYS = 30
const MAX_INFLIGHT = 4
const PER_IP_PER_MIN = 6
const ADDR_RE = /^0x[0-9a-f]{40}$/
const ZERO = '0x0000000000000000000000000000000000000000'
const SITE = 'https://gullylabs.xyz'
const UA = 'gullylabs-score/1 (+https://gullylabs.xyz/score)'

/** The components, in display order. Weights add up to 100. */
export const COMPONENTS = [
  { id: 'verified', label: 'Code verified', weight: 15, source: 'Sourcify (sourcify.dev); Etherscan when configured', what: 'Is the source code published and matched to what is on chain, so anyone can read what it does?' },
  { id: 'control', label: 'Who controls it', weight: 20, source: 'owner(), the proxy admin and Safe getThreshold()/getOwners(), read from the chain', what: 'Can one wallet change it, or does a change need several signatures, a delay, or is nobody in control?' },
  { id: 'timelock', label: 'Delay on changes', weight: 10, source: 'TimelockController getMinDelay() / Timelock delay() on the controller, read from the chain', what: 'Do changes wait behind a public delay, so users can see them coming?' },
  { id: 'upgradeability', label: 'Can the code change', weight: 10, source: 'ERC-1967, beacon and ZeppelinOS proxy slots, and Sourcify’s proxy check', what: 'Can the code this address runs be swapped for different code?' },
  { id: 'changes', label: 'Recent privileged changes', weight: 10, source: 'Gully Security monitoring (owner, admin, roles, upgrades, pauses, Safe signers)', what: 'Have owners, roles, code or signers changed in the last 30 days?' },
  { id: 'liquidity', label: 'Liquidity locked', weight: 10, source: 'DeepCore’s indexer (api.deepcore.fun), for DeepCore launches', what: 'Is the launch liquidity locked, so it cannot be pulled?' },
  { id: 'holders', label: 'Holder spread', weight: 10, source: 'Gully Holder Map (Launch Health, top-10 share)', what: 'Is the supply spread out, or held by a few connected wallets?' },
  { id: 'review', label: 'Gully Security review', weight: 10, source: 'Published Gully Security reports only', what: 'Has Gully Security published a report on it, and what did it find?' },
  { id: 'age', label: 'Age', weight: 5, source: 'Deployment block (Sourcify or Etherscan) and its block time', what: 'How long has it been on chain?' },
]
const COMPONENT = Object.fromEntries(COMPONENTS.map((c) => [c.id, c]))

export const grade = (s) => (s === null ? null : s >= 80 ? 'Strong' : s >= 60 ? 'Fair' : s >= 40 ? 'Weak' : 'Poor')

/* --------------------------------------------------------------- store --- */

let db = load()
function load() {
  try {
    const d = JSON.parse(fs.readFileSync(FILE(), 'utf8'))
    return { scores: d?.scores ?? {}, cache: d?.cache ?? {} }
  } catch {
    return { scores: {}, cache: {} }
  }
}
function save() {
  try {
    fs.mkdirSync(path.dirname(FILE()), { recursive: true })
    fs.writeFileSync(FILE() + '.tmp', JSON.stringify(db))
    fs.renameSync(FILE() + '.tmp', FILE())
  } catch (e) {
    console.error('gully-score save:', e?.message ?? e)
  }
}
const keyOf = (chainId, address) => `${chainId}:${address}`

/* ----------------------------------------------------------- injectables --- */

let rpc = payRpc
let fetchFn = (...a) => globalThis.fetch(...a)
let launchesFn = (chainId) => readLaunches({ chainId, limit: 50 })
let holdersBase = () => String(process.env.GULLY_HOLDERS_API ?? `http://127.0.0.1:${process.env.PORT ?? 8080}`).replace(/\/+$/, '')
let reportFn = defaultReportFor

export const setScoreRpcForTest = (fn) => (rpc = fn ?? payRpc)
export const setScoreFetchForTest = (fn) => (fetchFn = fn ?? ((...a) => globalThis.fetch(...a)))
export const setLaunchesForTest = (fn) => (launchesFn = fn)
export const setHoldersBaseForTest = (base) => (holdersBase = () => base)
/** The published-report source: (chainId, address) -> report | null. Tests replace it; see defaultReportFor. */
export const setReportSource = (fn) => (reportFn = fn ?? defaultReportFor)
export function resetScoresForTest() {
  db = { scores: {}, cache: {} }
  save()
}
export const reloadScoresForTest = () => (db = load())
/** e2e and tests: store a result as if computed (the page reads it like any other). */
export function putScoreForTest(result) {
  db.scores[keyOf(result.chainId, result.address)] = result
  save()
}

/**
 * Published Gully Security reports come from the scan engine (part 1, server/security/). When it is present it
 * exports publishedReportFor(chainId, address) -> { url, title, publishedAt, status: 'published', severities:
 * { critical, high, medium, low, info }, unresolved?: { … same keys } } | null. Until then there are none.
 */
async function defaultReportFor(chainId, address) {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'security', 'reports.mjs')
  if (!fs.existsSync(file)) return null
  try {
    const mod = await import('./security/reports.mjs')
    return typeof mod.publishedReportFor === 'function' ? await mod.publishedReportFor(chainId, address) : null
  } catch (e) {
    console.error('gully-score: report source:', e?.message ?? e)
    return null
  }
}

/* ---------------------------------------------------------------- reads --- */

const okHex = (x) => typeof x === 'string' && /^0x[0-9a-fA-F]*$/.test(x)
const word0 = (h) => (okHex(h) && h.length >= 66 ? BigInt(h.slice(0, 66)) : null)

async function tryCall(chainId, to, data) {
  try {
    const out = await rpc(chainId, 'eth_call', [{ to, data }, 'latest'])
    return okHex(out) && out.length > 2 ? out : null
  } catch {
    // payments.rpc tries every node and reports the LAST error, so a revert can surface as a node fault when one
    // node is down. Calls that may revert are therefore never trusted to throw; storage and code reads (which
    // cannot revert) are what notice an unreachable chain.
    return null
  }
}

async function getJson(url, { timeout = 10_000, headers = {} } = {}) {
  const r = await fetchFn(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeout) })
  const body = await r.json().catch(() => null)
  return { status: r.status, ok: r.ok, body }
}

/** Sourcify's record: { verified: true|false, match, name, deployment, proxy } or { error } when it could not be read. */
async function sourcify(chainId, address, now) {
  const k = `sourcify:${chainId}:${address}`
  const hit = db.cache[k]
  if (hit && now - hit.at < (hit.v.error ? FAIL_TTL_MS : SOURCIFY_TTL_MS)) return hit.v
  let v
  try {
    const r = await getJson(`https://sourcify.dev/server/v2/contract/${chainId}/${address}?fields=deployment,proxyResolution,compilation.name`)
    if (r.status === 404 || (r.ok && r.body && r.body.match === null)) v = { verified: false, match: null }
    else if (r.ok && r.body?.match) v = { verified: true, match: r.body.match, name: typeof r.body.compilation?.name === 'string' ? r.body.compilation.name.slice(0, 60) : null, deployment: r.body.deployment ?? null, proxy: r.body.proxyResolution ? { isProxy: !!r.body.proxyResolution.isProxy, type: r.body.proxyResolution.proxyType ?? null } : null }
    else v = { error: `Sourcify answered ${r.status}` }
  } catch (e) {
    v = { error: `Sourcify could not be reached (${String(e?.name === 'TimeoutError' ? 'timed out' : (e?.message ?? e)).slice(0, 80)})` }
  }
  db.cache[k] = { at: now, v }
  return v
}

/** Etherscan v2 (one key for every chain), only when ETHERSCAN_API_KEY is set: verification and creation time. */
async function etherscan(chainId, address, now) {
  const key = String(process.env.ETHERSCAN_API_KEY ?? '').trim()
  if (!key) return null
  const k = `etherscan:${chainId}:${address}`
  const hit = db.cache[k]
  if (hit && now - hit.at < (hit.v.error ? FAIL_TTL_MS : SOURCIFY_TTL_MS)) return hit.v
  let v
  try {
    const base = `https://api.etherscan.io/v2/api?chainid=${chainId}&address=${address}&apikey=${encodeURIComponent(key)}`
    const src = await getJson(`${base}&module=contract&action=getsourcecode`)
    const row = Array.isArray(src.body?.result) ? src.body.result[0] : null
    const made = await getJson(`${base.replace(`&address=${address}`, `&contractaddresses=${address}`)}&module=contract&action=getcontractcreation`)
    const c = Array.isArray(made.body?.result) ? made.body.result[0] : null
    v = row ? { verified: !!(row.SourceCode && String(row.SourceCode).length > 0), name: row.ContractName || null, createdAt: c?.timestamp ? new Date(Number(c.timestamp) * 1000).toISOString() : null, creationTx: c?.txHash ?? null } : { error: 'Etherscan gave no answer' }
  } catch {
    v = { error: 'Etherscan could not be reached' }
  }
  db.cache[k] = { at: now, v }
  return v
}

async function blockTime(chainId, n) {
  const b = await rpc(chainId, 'eth_getBlockByNumber', ['0x' + Number(n).toString(16), false])
  const t = b?.timestamp ? Number(BigInt(b.timestamp)) : null
  return t ? new Date(t * 1000).toISOString() : null
}

/** The controller's delay in seconds, or null when it has none we can read. */
async function delayOf(chainId, addr) {
  if (!addr) return null
  const a = await tryCall(chainId, addr, '0xf27a0c92') // getMinDelay()
  if (a) return { seconds: Number(word0(a)), kind: 'TimelockController' }
  const b = await tryCall(chainId, addr, '0x6a42b8f8') // delay()
  if (b) return { seconds: Number(word0(b)), kind: 'Timelock' }
  return null
}

async function holderMap(chainId, address) {
  const key = { 8453: 'base', 56: 'bsc' }[chainId]
  if (!key) return { error: `The Holder Map does not cover ${CHAINS[chainId]?.name ?? 'this chain'} yet.` }
  try {
    const r = await getJson(`${holdersBase()}/api/holders/${key}/${address}`, { timeout: 15_000 })
    if (!r.body || typeof r.body !== 'object' || r.status === 404) return { error: 'The Holder Map is not running on this server yet, so holder data is not available.' }
    if (r.body.state !== 'ok') return { error: r.body.reason || r.body.error || 'The Holder Map has no holder data for this token.' }
    return { health: r.body.health ?? null, top10Pct: r.body.summary?.top10Pct ?? null, line: r.body.summary?.line ?? null, page: `${SITE}/holders/${key}/${address}` }
  } catch {
    return { error: 'The Holder Map could not be reached from this server, so holder data is not available.' }
  }
}

/* -------------------------------------------------------------- scoring --- */

const days = (ms) => ms / 86_400_000
const fmtDelay = (s) => (s >= 86_400 ? `${Math.round((s / 86_400) * 10) / 10} days` : s >= 3_600 ? `${Math.round((s / 3_600) * 10) / 10} hours` : `${s} seconds`)
const na = (id, reason, extra = {}) => ({ id, available: false, score: null, value: 'Not available', reason, evidence: [], ...extra })
const ok = (id, score, value, reason, evidence = [], extra = {}) => ({ id, available: true, score: Math.max(0, Math.min(100, Math.round(score))), value, reason, evidence, ...extra })

/** The weighted mean of the available components, or null below MIN_COVERAGE. Pure: tests call it directly. */
export function combine(parts) {
  let w = 0
  let sum = 0
  for (const p of parts) {
    if (!p.available || p.score === null || p.score === undefined) continue
    const weight = COMPONENT[p.id]?.weight ?? 0
    w += weight
    sum += weight * p.score
  }
  return { score: w >= MIN_COVERAGE ? Math.round(sum / w) : null, coverage: w, available: parts.filter((p) => p.available).length }
}

/** Points for a published report: 100 less 40 per critical, 20 per high, 5 per medium, 1 per low (unresolved when stated). */
export function reviewPoints(r) {
  const s = r.unresolved ?? r.severities ?? {}
  const n = (k) => Math.max(0, Number(s[k]) || 0)
  return Math.max(0, 100 - 40 * n('critical') - 20 * n('high') - 5 * n('medium') - n('low'))
}

/** Points for a top-10 share: 20% or less 100, 90% or more 0, a straight line between. */
export const spreadPoints = (pct) => Math.max(0, Math.min(100, Math.round(((90 - pct) / 70) * 100)))

/** Points for age in days. */
export const agePoints = (d) => (d >= 365 ? 100 : d >= 180 ? 85 : d >= 90 ? 70 : d >= 30 ? 50 : d >= 7 ? 30 : 10)

/** Points for privileged changes in the window. */
export const changePoints = (n) => Math.max(0, 100 - 25 * n)

const inflight = new Map()

/**
 * Computes the score of one contract from public evidence. Takes the chain and the address only (no account,
 * plan or payment exists here). Resolves { result } or { error, status }.
 */
export function computeScore(chainId, address, { now = Date.now() } = {}) {
  const k = keyOf(chainId, address)
  if (inflight.has(k)) return inflight.get(k)
  const p = doCompute(chainId, address, now).finally(() => inflight.delete(k))
  inflight.set(k, p)
  return p
}

async function doCompute(chainId, address, now) {
  const chain = CHAINS[chainId]
  let code
  try {
    code = await rpc(chainId, 'eth_getCode', [address, 'latest'])
  } catch {
    return { error: `${chain.name} could not be read just now. Try again in a minute.`, status: 502 }
  }
  if (!okHex(code) || code.length <= 2) return { error: `There is no contract at this address on ${chain.name}.`, status: 404 }

  const explorer = (a) => `${chain.explorer}/address/${a}`
  const [ctl, src, esc] = await Promise.all([readControl(chainId, address).catch(() => null), sourcify(chainId, address, now), etherscan(chainId, address, now)])
  const nameOut = await tryCall(chainId, address, SEL.name).catch(() => null)
  const symOut = await tryCall(chainId, address, SEL.symbol).catch(() => null)
  const facts = monitorFacts(chainId, address)
  const parts = []

  // verified
  if (src.verified || esc?.verified) parts.push(ok('verified', src.match === 'exact_match' || esc?.verified ? 100 : 85, src.verified ? (src.match === 'exact_match' ? 'Exact match' : 'Partial match') : 'Verified', src.verified ? `The source code is published on Sourcify and ${src.match === 'exact_match' ? 'matches the deployed code exactly' : 'matches the deployed code (metadata differs)'}.` : 'The source code is published on Etherscan.', [src.verified ? { label: 'Sourcify', url: `https://repo.sourcify.dev/${chainId}/${address}` } : { label: chain.explorerName ?? 'Explorer', url: `${explorer(address)}#code` }]))
  else if (src.verified === false && (!esc || esc.verified === false)) parts.push(ok('verified', 0, 'Not verified', 'No published source code matches this contract, so nobody can check what it does from its code.', [{ label: 'Sourcify lookup', url: `https://sourcify.dev/#/lookup/${address}` }]))
  else parts.push(na('verified', `${src.error ?? 'The verification service could not be read'}; checked again later.`))

  // control, timelock, upgradeability
  const minimal = /^0x363d3d373d3d3d363d73[0-9a-f]{40}5af43d82803e903d91602b57fd5bf3/i.test(code)
  if (!ctl) {
    parts.push(na('control', 'The contract’s owner and admin could not be read just now.'))
    parts.push(na('timelock', 'The controller could not be read just now.'))
    parts.push(na('upgradeability', 'The contract’s upgrade settings could not be read just now.'))
  } else {
    const owner = ctl.owner && ctl.owner !== ZERO ? ctl.owner : null
    const controller = owner ?? ctl.admin
    const upgradeable = !minimal && !!(ctl.implementation || ctl.beacon || src.proxy?.isProxy)
    let delay = null
    if (controller) {
      const ctlCode = await rpc(chainId, 'eth_getCode', [controller, 'latest']).catch(() => null)
      const isContract = okHex(ctlCode) && ctlCode.length > 2
      delay = isContract ? await delayOf(chainId, controller) : null
      // A proxy admin owned by a timelock: follow one step.
      if (isContract && !delay && !ctl.safe) {
        const next = await tryCall(chainId, controller, SEL.owner).catch(() => null)
        const nextAddr = next ? '0x' + next.slice(26, 66).toLowerCase() : null
        if (nextAddr && nextAddr !== ZERO) delay = await delayOf(chainId, nextAddr)
      }
      const safe = ctl.safe
      if (safe && safe.threshold >= 2) parts.push(ok('control', 100, `Safe, ${safe.threshold} of ${safe.owners.length}`, `Changes need ${safe.threshold} of the ${safe.owners.length} signers of the Safe ${short(safe.address)}; no single key can act alone.`, [{ label: 'The Safe', url: explorer(safe.address) }]))
      else if (safe) parts.push(ok('control', 40, `Safe, 1 of ${safe.owners.length}`, `It is controlled by the Safe ${short(safe.address)}, but any one of its ${safe.owners.length} signers can act alone.`, [{ label: 'The Safe', url: explorer(safe.address) }]))
      else if (delay) parts.push(ok('control', 80, 'Timelock', `It is controlled by a timelock contract (${short(controller)}): changes are queued in public before they apply.`, [{ label: 'The controller', url: explorer(controller) }]))
      else if (isContract) parts.push(ok('control', 50, 'Another contract', `It is controlled by another contract (${short(controller)}) that is not a Safe or a timelock we recognise; read that contract to see who is behind it.`, [{ label: 'The controller', url: explorer(controller) }]))
      else parts.push(ok('control', 15, 'One wallet', `A single wallet (${short(controller)}) can change it on its own: whoever holds that one key is in control.`, [{ label: 'The wallet', url: explorer(controller) }]))
      if (delay) {
        const s = delay.seconds
        parts.push(ok('timelock', s >= 172_800 ? 100 : s >= 86_400 ? 90 : s >= 21_600 ? 60 : s > 0 ? 40 : 0, fmtDelay(s), s > 0 ? `Changes wait ${fmtDelay(s)} in public before they take effect.` : 'A timelock is in place but its delay is zero, so changes can apply at once.', [{ label: 'The timelock', url: explorer(controller) }]))
      } else parts.push(ok('timelock', 0, 'No delay', 'Changes take effect as soon as they are made; there is no waiting period users could react in.', [{ label: 'The controller', url: explorer(controller) }]))
    } else if (ctl.owner === ZERO) {
      parts.push(ok('control', 100, 'Nobody', 'Ownership was given up: no wallet or contract can change its settings.', [{ label: 'Contract', url: explorer(address) }]))
      parts.push(na('timelock', 'Nobody can make changes, so there is nothing to delay.'))
    } else {
      parts.push(na('control', 'It has no owner() and no proxy admin, so who (if anyone) can change it could not be read from the chain.'))
      parts.push(na('timelock', 'No owner or admin was found, so there is no change process to check for a delay.'))
    }
    if (minimal) parts.push(ok('upgradeability', 100, 'Fixed (clone)', 'It is a minimal clone of fixed code: what it runs cannot be swapped.', [{ label: 'Contract', url: explorer(address) }]))
    else if (upgradeable) parts.push(ok('upgradeability', 30, 'Upgradeable', `Its code can be swapped${ctl.implementation ? ` (it currently runs the code at ${short(ctl.implementation)})` : ''}; whoever controls upgrades can change what it does.`, [{ label: 'Current code', url: explorer(ctl.implementation ?? ctl.beacon ?? address) }]))
    else parts.push(ok('upgradeability', 100, 'Not upgradeable', 'No upgrade mechanism was found: the code at this address cannot be swapped.', [{ label: 'Contract', url: explorer(address) }]))
  }

  // changes (monitoring)
  if (!facts) parts.push(na('changes', 'Gully Security monitoring does not watch this contract, so recent changes are not known here.'))
  else {
    const since = now - CHANGE_WINDOW_DAYS * 86_400_000
    const recent = facts.events.filter((e) => e.privileged && Date.parse(e.at) >= since)
    const watchedDays = Math.floor(days(now - Date.parse(facts.since)))
    parts.push(
      ok('changes', changePoints(recent.length), recent.length ? `${recent.length} in ${CHANGE_WINDOW_DAYS} days` : 'None', recent.length ? `${recent.length} privileged change${recent.length === 1 ? ' was' : 's were'} seen in the last ${CHANGE_WINDOW_DAYS} days. The latest: ${recent[recent.length - 1].text.replace(/ · .*$/, '').replace(/^\S+ /, '')}.` : `No owner, admin, role, code, pause or signer change was seen ${watchedDays >= CHANGE_WINDOW_DAYS ? `in the last ${CHANGE_WINDOW_DAYS} days` : `since monitoring started ${watchedDays} day${watchedDays === 1 ? '' : 's'} ago`}.`, recent.slice(-3).map((e) => ({ label: new Date(e.at).toISOString().slice(0, 10), url: e.link }))),
    )
  }

  // liquidity (DeepCore launches)
  if (chainId === 8453 || chainId === 56) {
    let launch = null
    let err = null
    try {
      const r = await launchesFn(chainId)
      launch = (r?.launches ?? []).find((l) => String(l.token).toLowerCase() === address) ?? null
      if (!launch && r?.state === 'unreadable') err = 'DeepCore’s launch list could not be read just now.'
    } catch {
      err = 'DeepCore’s launch list could not be read just now.'
    }
    if (launch) {
      const legs = launch.legs ?? []
      const known = legs.filter((g) => g.locked !== null)
      const locked = known.filter((g) => g.locked === true).length
      if (!known.length) parts.push(na('liquidity', 'DeepCore states no lock record for this launch’s pools yet.'))
      else parts.push(ok('liquidity', (locked / legs.length) * 100, locked === legs.length ? 'Locked' : locked ? `${locked} of ${legs.length} pools locked` : 'Not locked', locked === legs.length ? 'DeepCore’s indexer has a lock record for every launch pool: the launch liquidity cannot be pulled.' : locked ? `Only ${locked} of the ${legs.length} launch pools have a lock record.` : 'DeepCore’s indexer has no lock record for the launch pools: the liquidity could be removed.', [{ label: 'On DeepCore', url: launch.links?.token ?? 'https://deepcore.fun' }]))
    } else parts.push(na('liquidity', err ?? 'Liquidity locks are read for DeepCore launches only, and this is not one of DeepCore’s recent launches.'))
  } else parts.push(na('liquidity', 'Liquidity locks are read for DeepCore launches only (Base and BNB Chain here).'))

  // holders (Holder Map)
  const hm = await holderMap(chainId, address)
  if (hm.error) parts.push(na('holders', hm.error))
  else if (typeof hm.health?.score === 'number') parts.push(ok('holders', hm.health.score, `Launch Health ${hm.health.score}`, `The Holder Map rates this launch ${hm.health.score} out of 100${hm.health.verdict ? `: ${hm.health.verdict}` : ''}.`, [{ label: 'Holder Map', url: hm.page }]))
  else if (typeof hm.top10Pct === 'number') parts.push(ok('holders', spreadPoints(hm.top10Pct), `Top 10 hold ${Math.round(hm.top10Pct * 10) / 10}%`, hm.line ?? `The 10 biggest wallets hold ${hm.top10Pct}% of the supply.`, [{ label: 'Holder Map', url: hm.page }]))
  else parts.push(na('holders', 'The Holder Map gave no holder figures for this token.'))

  // review (published reports only)
  let report = null
  try {
    report = await reportFn(chainId, address)
  } catch {
    report = null
  }
  if (report && report.status === 'published' && report.publishedAt && /^https:\/\//.test(String(report.url ?? ''))) {
    const s = report.severities ?? {}
    const counts = ['critical', 'high', 'medium', 'low', 'info'].map((k) => `${Number(s[k]) || 0} ${k}`).join(', ')
    parts.push(ok('review', reviewPoints(report), `Published ${String(report.publishedAt).slice(0, 10)}`, `Gully Security published a report on ${String(report.publishedAt).slice(0, 10)}: ${counts}${report.unresolved ? ' (points count the unresolved ones)' : ''}.`, [{ label: report.title ? String(report.title).slice(0, 60) : 'Read the report', url: report.url }], { severities: s, unresolved: report.unresolved ?? null }))
  } else parts.push(na('review', 'There is no published Gully Security report on this contract. Only published reports count; nobody can buy this.'))

  // age
  let createdAt = esc?.createdAt ?? null
  let createdTx = esc?.creationTx ?? null
  if (!createdAt && src.deployment?.blockNumber) {
    createdAt = await blockTime(chainId, src.deployment.blockNumber).catch(() => null)
    createdTx = src.deployment.transactionHash ?? null
  }
  if (createdAt) {
    const d = Math.floor(days(now - Date.parse(createdAt)))
    const last = facts?.events?.length ? facts.events[facts.events.length - 1].at : null
    parts.push(ok('age', agePoints(d), d >= 365 ? `${Math.floor(d / 365)} yr ${Math.floor((d % 365) / 30)} mo` : `${d} day${d === 1 ? '' : 's'}`, `Deployed on ${createdAt.slice(0, 10)}, ${d} day${d === 1 ? '' : 's'} ago.${last ? ` Monitoring last saw activity on ${last.slice(0, 10)}.` : ''}`, createdTx ? [{ label: 'Deployment', url: `${chain.explorer}/tx/${createdTx}` }] : []))
  } else parts.push(na('age', 'The deployment date is only read for verified contracts (Sourcify) or with an explorer key; it is not known here.'))

  const ordered = COMPONENTS.map((c) => ({ ...c, ...(parts.find((p) => p.id === c.id) ?? na(c.id, 'Not read.')) }))
  const { score, coverage, available } = combine(ordered)
  const name = decodeString(nameOut) ?? src.name ?? esc?.name ?? null
  const symbol = decodeString(symOut)
  const k = keyOf(chainId, address)
  const prev = db.scores[k]
  const at = new Date(now).toISOString()
  const changes = [...(prev?.changes ?? [])]
  if (!prev) changes.push({ at, id: null, label: 'First scored', from: null, to: score, note: score === null ? 'Not enough public data for a score yet.' : `Scored ${score} from ${available} of ${COMPONENTS.length} components.` })
  else {
    for (const c of ordered) {
      const was = prev.components?.find((x) => x.id === c.id)
      if (!was) continue
      if (was.available !== c.available || was.score !== c.score) changes.push({ at, id: c.id, label: c.label, from: was.available ? was.score : null, to: c.available ? c.score : null, note: c.available ? `${c.value}: ${c.reason}` : `Now not available: ${c.reason}` })
    }
  }
  const history = [...(prev?.history ?? [])]
  const lastPoint = history[history.length - 1]
  if (!lastPoint || lastPoint.score !== score || now - Date.parse(lastPoint.at) > 20 * 3_600_000) history.push({ at, score })
  const result = {
    chainId,
    chainKey: chain.key,
    chainName: chain.name,
    address,
    name,
    symbol,
    score,
    grade: grade(score),
    coverage: { weight: coverage, components: available, of: COMPONENTS.length },
    computedAt: at,
    methodVersion: METHOD_VERSION,
    components: ordered,
    history: history.slice(-KEEP_HISTORY),
    changes: changes.slice(-KEEP_CHANGES),
  }
  db.scores[k] = result
  save()
  return { result }
}

/* ---------------------------------------------------------------- views --- */

/** Whether a contract's page is listed (index, sitemap, indexable). Not a factor in the score. */
export function isListed(chainId, address) {
  const f = monitorFacts(chainId, address)
  if (f?.listed) return true
  return !!db.scores[keyOf(chainId, address)]?.components?.find((c) => c.id === 'review' && c.available)
}

export function publicView(r) {
  if (!r) return null
  return {
    ...r,
    chain: { id: r.chainId, key: r.chainKey, name: r.chainName, explorer: CHAINS[r.chainId]?.explorer ?? null },
    listed: isListed(r.chainId, r.address),
    links: { page: `${SITE}/score/${r.chainKey}/${r.address}`, badge: `${SITE}/score/${r.chainKey}/${r.address}/badge.svg`, explorer: `${CHAINS[r.chainId]?.explorer}/address/${r.address}` },
    methodology: methodology(),
  }
}

export function methodology() {
  return {
    version: METHOD_VERSION,
    minCoverage: MIN_COVERAGE,
    ttlHours: TTL_MS / 3_600_000,
    components: COMPONENTS.map(({ id, label, weight, source, what }) => ({ id, label, weight, source, what })),
    rules: [
      'The score is the weighted average of the components that could be read. A component that could not be read is shown as not available and left out; it is never counted as zero.',
      `With less than ${MIN_COVERAGE} of the 100 weight points available, no score is given.`,
      'Nothing paid goes in. No plan, payment or account can change a score, and a Gully Security review counts only once its report is published.',
      'Scores are informational. They are not an endorsement and not investment advice.',
    ],
  }
}

/** The listed scores, best first (the /score index and the sitemap). */
export function scoreIndex() {
  const listed = new Set(listedContracts().map((c) => keyOf(c.chainId, c.address)))
  const rows = Object.values(db.scores)
    .filter((r) => listed.has(keyOf(r.chainId, r.address)) || isListed(r.chainId, r.address))
    .map((r) => ({ chainId: r.chainId, chainKey: r.chainKey, chainName: r.chainName, address: r.address, name: r.name, symbol: r.symbol, score: r.score, grade: r.grade, coverage: r.coverage, computedAt: r.computedAt, change: r.history.length > 1 && r.score !== null && r.history[r.history.length - 2].score !== null ? r.score - r.history[r.history.length - 2].score : null }))
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.address.localeCompare(b.address))
  return rows
}

/** For seo.mjs: head tags of a score page. null when the path is not a score page. */
export function scorePageMeta(p) {
  const m = p.match(/^\/score\/([a-z]+)\/(0x[0-9a-fA-F]{40})$/)
  if (!m) return null
  const chain = chainOf(m[1])
  if (!chain || chain.key !== m[1]) return { found: false }
  const address = m[2].toLowerCase()
  const r = db.scores[keyOf(chain.id, address)]
  const label = r?.name ? `${r.name}${r.symbol ? ` (${r.symbol})` : ''}` : short(address)
  return {
    found: true,
    noindex: !isListed(chain.id, address) || m[2] !== address,
    canonical: `${SITE}/score/${chain.key}/${address}`,
    title: `${label} Gully Score on ${chain.name} · Gully Labs`,
    description: r?.score !== null && r?.score !== undefined ? `${label} on ${chain.name} scores ${r.score} out of 100 (${r.grade}) on the Gully Score: code verification, who controls it, upgrades, delays, recent changes and more, each with its evidence.` : `The Gully Score of ${label} on ${chain.name}: how it is controlled and how it has behaved, from public evidence only.`,
  }
}

/* -------------------------------------------------------------- the badge --- */

let markDataUri = null
function mark() {
  if (markDataUri) return markDataUri
  try {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'brand', 'kit', 'mark-64.png')
    markDataUri = `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`
  } catch {
    markDataUri = ''
  }
  return markDataUri
}
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The embeddable badge: the kit's mark (mark-64.png drawn at 32 px, 2x), "GULLY SCORE", the score and its date. */
export function badgeSvg(r, chain, address) {
  const score = r?.score ?? null
  const date = r?.computedAt ? new Date(r.computedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null
  const big = score === null ? (r ? 'N/A' : '—') : String(score)
  const sub = score === null ? (r ? 'not enough data' : 'not scored yet') : `${grade(score).toUpperCase()} · ${date}`
  const href = `${SITE}/score/${chain.key}/${address}`
  const title = score === null ? `Gully Score: ${sub}` : `Gully Score ${score} out of 100 (${grade(score)}), ${date}`
  const m = mark()
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="232" height="48" viewBox="0 0 232 48" role="img" aria-label="${xmlEsc(title)}">
<title>${xmlEsc(title)}</title>
<defs><linearGradient id="gb" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2A3542"/><stop offset=".4" stop-color="#6F7560"/><stop offset=".85" stop-color="#D9B563"/><stop offset="1" stop-color="#F2D58A"/></linearGradient></defs>
<a xlink:href="${xmlEsc(href)}" href="${xmlEsc(href)}" target="_blank">
<rect x=".5" y=".5" width="231" height="47" rx="8" fill="#0D141C" stroke="#2A3542"/>
${m ? `<image x="8" y="8" width="32" height="32" href="${m}" xlink:href="${m}"/>` : ''}
<text x="48" y="21" fill="#F4F2EC" font-family="'Barlow Condensed','Arial Narrow',Arial,sans-serif" font-weight="700" font-size="14" letter-spacing=".6">GULLY SCORE</text>
<text x="48" y="36" fill="#7D8794" font-family="'JetBrains Mono','IBM Plex Mono',Menlo,monospace" font-size="9.5">${xmlEsc(sub)}</text>
<rect x="160" y="8" width="64" height="32" rx="6" fill="#151D28" stroke="#2A3542"/>
<text x="192" y="31" text-anchor="middle" fill="${score === null ? '#AEB5BE' : '#D9B563'}" font-family="'Barlow Condensed','Arial Narrow',Arial,sans-serif" font-weight="700" font-size="${score === null ? 16 : 22}">${xmlEsc(big)}</text>
<rect x="8" y="44" width="216" height="1.5" fill="url(#gb)"/>
</a>
</svg>`
}

/* -------------------------------------------------------------- handler --- */

const hits = new Map()
function allow(ip) {
  const now = Date.now()
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 60_000)
  if (list.length >= PER_IP_PER_MIN) return false
  list.push(now)
  hits.set(ip, list)
  if (hits.size > 5_000) hits.clear()
  return true
}
const CORS = { 'Access-Control-Allow-Origin': '*' }

/** The score for a chain/address pair: cached, or computed when stale (rate limited). */
async function scoreFor(req, chain, address) {
  const k = keyOf(chain.id, address)
  const have = db.scores[k]
  if (have && Date.now() - Date.parse(have.computedAt) < TTL_MS) return { result: have }
  const busy = inflight.size >= MAX_INFLIGHT && !inflight.has(k)
  if (busy || !allow(clientIp(req))) {
    if (have) return { result: have, stale: true }
    return { error: 'Too many scores are being worked out right now. Try again in a minute.', status: 429 }
  }
  const r = await computeScore(chain.id, address)
  if (r.error && have) return { result: have, stale: true }
  return r
}

/** /api/score*, and /score/:chain/:address/badge.svg. Returns true when answered. */
export async function handleScore(req, res, url) {
  const p = url.pathname
  if (req.method === 'OPTIONS') return res.writeHead(204, { ...CORS, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' }), res.end(), true
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'GET only' }, CORS), true
  if (p === '/api/score') return json(res, 200, { scores: scoreIndex(), chains: monitorChains().map(({ id, key, name }) => ({ id, key, name })), methodology: methodology() }, { ...CORS, 'Cache-Control': 'public, max-age=60' }), true
  if (p === '/api/score/methodology') return json(res, 200, methodology(), { ...CORS, 'Cache-Control': 'public, max-age=300' }), true
  const badge = p.match(/^\/score\/([a-z]+)\/(0x[0-9a-fA-F]{40})\/badge\.svg$/)
  const api = p.match(/^\/api\/score\/([a-z0-9]+)\/(0x[0-9a-fA-F]{40})$/)
  const m = badge ?? api
  if (!m) return false
  const chain = chainOf(m[1])
  if (!chain) return json(res, 404, { error: `Unknown chain. Scores cover ${monitorChains().map((c) => c.key).join(', ')}.` }, CORS), true
  const address = m[2].toLowerCase()
  if (!ADDR_RE.test(address) || address === ZERO) return json(res, 400, { error: 'Not a contract address.' }, CORS), true
  if (badge) {
    // The badge never computes: it shows what is stored (a page view computes it first).
    const r = db.scores[keyOf(chain.id, address)] ?? null
    res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600', ...CORS, 'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'" })
    return res.end(req.method === 'HEAD' ? undefined : badgeSvg(r, chain, address)), true
  }
  const r = await scoreFor(req, chain, address)
  if (r.error) return json(res, r.status ?? 502, { error: r.error }, CORS), true
  return json(res, 200, { ...publicView(r.result), stale: !!r.stale }, { ...CORS, 'Cache-Control': 'public, max-age=60' }), true
}

/* ------------------------------------------------------------- refresh --- */

const pending = new Set()
// A monitored change refreshes that contract's score soon after (the "recent changes" component moves).
onMonitorEvents((m, recs) => {
  if (recs.some((r) => r.privileged)) pending.add(keyOf(m.chainId, m.address))
})

let timer = null
/** Every 10 minutes: recompute up to 3 listed scores older than TTL_MS, and any a monitored change touched. */
export async function refreshScoresNow({ now = Date.now(), max = 3 } = {}) {
  const due = []
  for (const k of pending) due.push(k)
  pending.clear()
  for (const c of listedContracts()) {
    const k = keyOf(c.chainId, c.address)
    const r = db.scores[k]
    if (!due.includes(k) && (!r || now - Date.parse(r.computedAt) >= TTL_MS)) due.push(k)
  }
  const done = []
  for (const k of due.slice(0, max)) {
    const [id, address] = k.split(':')
    const r = await computeScore(Number(id), address, { now }).catch((e) => ({ error: String(e?.message ?? e) }))
    done.push({ key: k, score: r.result?.score ?? null, error: r.error ?? null })
  }
  for (const k of due.slice(max)) pending.add(k)
  return done
}

/** Started from server.mjs startLoops() (never in standby). Off in tests (TRACKER_LOOP=off) unless SCORE_LOOP=on. */
export function startScoreRefresh() {
  if (timer || process.env.SCORE_LOOP === 'off' || (process.env.TRACKER_LOOP === 'off' && process.env.SCORE_LOOP !== 'on')) return
  timer = setInterval(() => refreshScoresNow().catch((e) => console.error('gully-score refresh:', e?.message ?? e)), 10 * 60_000)
  timer.unref?.()
}

/** Score-page paths for the main site's sitemap (listed contracts only). */
export const scoreSitemapPaths = () => scoreIndex().map((r) => `/score/${r.chainKey}/${r.address}`)
