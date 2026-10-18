// Public status (GET /api/status, the /status page and the docs' Status page).
//
// Every 60 s the server checks each part of the stack it can see from inside, keeps 24 h of samples in a ring
// buffer (persisted to DATA_DIR/status.json every few minutes, so a restart or deploy keeps the history) and opens or
// closes incidents on state changes. Every check is real and read-only:
//   - the API itself (this process answering, and the tracker's cached read time);
//   - tracker freshness per chain (when its pools were last read; fresh within 15 min);
//   - the DeepCore launch poller (last good poll vs its interval);
//   - the Telegram bot webhook (Telegram's getWebhookInfo: pending updates and the last delivery error);
//   - Gully Pay RPC per payment chain (eth_blockNumber / Solana getSlot, timed);
//   - Gully AI (configured, index size, retrieval mode);
//   - the Gully Security scan engine (AI configured, static-tools worker, queue);
//   - contract monitors (live count, per-chain read errors in the last 10 min);
//   - Holder Map sources per chain (whether the chain has a data source configured);
//   - the bot's News channel gate (Telegram's getChatMember for the bot itself: it must be a channel admin,
//     or the gate fails open and lets everyone through);
//   - the Gully Pay fee-proxy monitor (the treasury is not a fee proxy; no stray funds on the proxies).
// Nothing here prints a secret: no URL, token, key or env var name reaches the response; RPC and Telegram errors
// are reduced to plain words. `off` = not configured on this server; `off` and `unknown` are left out of uptime.
//
// Env: STATUS_LOOP=off stops the background checks (GET /api/status then checks on demand, cached 30 s).

import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './http.mjs'
import { trackerHealth } from './tracker.mjs'
import { deepcoreHealth, pollMs as deepcorePollMs } from './deepcore.mjs'
import { requiredChannel, telegramToken } from './telegram.mjs'
import { feeProxyView } from './fee-proxy-monitor.mjs'
import { CHAIN_LIST, publicChains, rpc } from './payments.mjs'
import { solanaRpc } from './solana.mjs'
import { SOLANA_CHAIN_ID } from './solana-pay.mjs'
import { askStatus } from './ask.mjs'
import { status as securityStatus } from './security-engine.mjs'
import { monitorStats } from './sec-monitor.mjs'
import * as holders from './holders.mjs'

export const INTERVAL_MS = 60_000
export const KEEP_MS = 24 * 3600_000
export const BUCKET_MS = 30 * 60_000
const FRESH_MS = 15 * 60_000
const STALE_MS = 60 * 60_000
const CHECK_TIMEOUT_MS = 8_000
const MAX_INCIDENTS = 50
const FILE = () => path.join(DATA_DIR, 'status.json')
const STARTED = Date.now()

/** state codes in the persisted samples (compact): u up, d degraded, x down, o off, ? unknown */
const CODE = { up: 'u', degraded: 'd', down: 'x', off: 'o', unknown: '?' }

let store = { samples: {}, meta: {}, incidents: [], since: null }
let loaded = false
let dirty = false
let lastSaved = 0
let lastRun = null // { at, results }
let running = null
let timer = null

function load() {
  if (loaded) return
  loaded = true
  try {
    const j = JSON.parse(fs.readFileSync(FILE(), 'utf8'))
    if (j && typeof j === 'object') store = { samples: j.samples ?? {}, meta: j.meta ?? {}, incidents: Array.isArray(j.incidents) ? j.incidents : [], since: j.since ?? null }
  } catch {
    /* first run, or unreadable: start empty */
  }
}

function save(force = false) {
  // Only the container running the loop writes the shared file (a standby answers on demand from memory).
  if (!timer || !dirty || (!force && Date.now() - lastSaved < 5 * 60_000)) return
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    const tmp = `${FILE()}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(store))
    fs.renameSync(tmp, FILE())
    dirty = false
    lastSaved = Date.now()
  } catch (e) {
    console.error('status: save failed:', e?.message ?? e)
  }
}

const withTimeout = (p, ms = CHECK_TIMEOUT_MS) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), ms).unref?.())])
const agoWords = (ms) => (ms < 90_000 ? `${Math.max(1, Math.round(ms / 1000))} s ago` : ms < 5_400_000 ? `${Math.round(ms / 60_000)} min ago` : `${Math.round(ms / 3_600_000)} h ago`)
const r = (id, group, name, state, detail, latencyMs = null) => ({ id, group, name, state, detail, latencyMs })

/* ------------------------------------------------------------- checks --- */

async function timed(fn) {
  const t0 = performance.now()
  const out = await withTimeout(fn())
  return { out, ms: Math.round(performance.now() - t0) }
}

function checkApi() {
  const up = Math.round((Date.now() - STARTED) / 1000)
  return [r('api', 'platform', 'Public API', 'up', `Answering; this server has been up ${up < 5400 ? `${Math.round(up / 60)} min` : `${Math.round(up / 3600)} h`}.`)]
}

function checkTracker() {
  const h = trackerHealth()
  const now = Date.now()
  return h.chains.map((c) => {
    const id = `tracker-${c.key}`
    const name = `Tracker: ${c.name}`
    if (!c.lastPoolRead) return r(id, 'tracker', name, c.backoffUntil ? 'down' : 'unknown', c.backoffUntil ? 'The pools could not be read; retrying after a back-off.' : 'No pool read yet since this server started.')
    const age = now - Date.parse(c.lastPoolRead)
    const state = c.backoffUntil ? 'degraded' : age <= FRESH_MS ? 'up' : age <= STALE_MS ? 'degraded' : 'down'
    return r(id, 'tracker', name, state, `Pools last read ${agoWords(age)}${c.backoffUntil ? '; the last read failed and is being retried' : ''}. ${c.stocks} stock tokens.`)
  })
}

function checkDeepcore() {
  const h = deepcoreHealth()
  const every = deepcorePollMs()
  if (!h.lastOkAt) return [r('deepcore', 'deepcore', 'DeepCore launch poller', h.lastError ? 'down' : 'unknown', h.lastError ? 'DeepCore could not be read yet.' : 'No poll yet since this server started.')]
  const age = Date.now() - Date.parse(h.lastOkAt)
  const state = age <= every * 3 ? 'up' : age <= every * 10 ? 'degraded' : 'down'
  return [r('deepcore', 'deepcore', 'DeepCore launch poller', state, `Last good poll ${agoWords(age)} (every ${Math.round(every / 1000)} s); ${h.cached} launches cached.`)]
}

function telegramBase() {
  const raw = String(process.env.TELEGRAM_API ?? '').trim()
  try {
    if (raw) {
      const u = new URL(raw)
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin + u.pathname.replace(/\/+$/, '')
    }
  } catch {
    /* default */
  }
  return 'https://api.telegram.org'
}

async function checkTelegram() {
  const name = 'Telegram bot webhook'
  const token = telegramToken()
  if (!token) return [r('telegram', 'telegram', name, 'off', 'The bot is not configured on this server.')]
  try {
    const { out: j, ms } = await timed(async () => {
      const res = await fetch(`${telegramBase()}/bot${token}/getWebhookInfo`, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
      return res.json().catch(() => null)
    })
    if (!j?.ok) return [r('telegram', 'telegram', name, 'down', 'Telegram did not answer the webhook check.', ms)]
    const info = j.result ?? {}
    const pending = Number(info.pending_update_count) || 0
    const lastErr = Number(info.last_error_date) ? Number(info.last_error_date) * 1000 : null
    if (!info.url) return [r('telegram', 'telegram', name, 'down', 'No webhook is registered with Telegram.', ms)]
    const recentErr = lastErr && Date.now() - lastErr < 10 * 60_000
    const state = recentErr || pending > 100 ? 'degraded' : 'up'
    const errWords = lastErr ? ` Last delivery error ${agoWords(Date.now() - lastErr)}.` : ' No delivery errors reported.'
    return [r('telegram', 'telegram', name, state, `${pending} update${pending === 1 ? '' : 's'} waiting.${errWords}`, ms)]
  } catch {
    return [r('telegram', 'telegram', name, 'down', 'Telegram could not be reached.')]
  }
}

/* The News channel gate (CLAUDE.md, Telegram): Telegram answers getChatMember for the channel only while the bot
   is an administrator there; otherwise the gate fails open. The bot's own id is the part of its token before ':'. */
async function checkNewsGate() {
  const name = 'Telegram bot: News channel gate'
  const token = telegramToken()
  const ch = requiredChannel()
  if (!token) return [r('telegram-gate', 'telegram', name, 'off', 'The bot is not configured on this server.')]
  if (!ch) return [r('telegram-gate', 'telegram', name, 'off', 'The channel requirement is switched off.')]
  const botId = Number(String(token).split(':')[0])
  if (!botId) return [r('telegram-gate', 'telegram', name, 'unknown', 'The bot id could not be read.')]
  try {
    const { out: j, ms } = await timed(async () => {
      const res = await fetch(`${telegramBase()}/bot${token}/getChatMember`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: ch, user_id: botId }), redirect: 'manual', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
      return res.json().catch(() => null)
    })
    const st = j?.result?.status
    if (j?.ok && (st === 'administrator' || st === 'creator')) return [r('telegram-gate', 'telegram', name, 'up', 'The bot is an admin of the News channel, so membership is checked.', ms)]
    return [r('telegram-gate', 'telegram', name, 'degraded', 'The bot is not an admin of the News channel, so the gate lets everyone through.', ms)]
  } catch {
    return [r('telegram-gate', 'telegram', name, 'unknown', 'Telegram could not be reached for the gate check.')]
  }
}

/* The fee-proxy monitor (server/fee-proxy-monitor.mjs): a treasury set to a fee proxy refuses every checkout, and
   funds sent straight to a proxy are stuck until recovered. */
function checkFeeProxy() {
  const name = 'Gully Pay fee proxies'
  const v = feeProxyView()
  if (v.config.length) return [r('pay-feeproxy', 'payments', name, 'down', 'The treasury is set to a fee proxy contract, so checkout is refused until it is changed.')]
  if (!v.running && !v.checkedAt) return [r('pay-feeproxy', 'payments', name, 'off', 'The fee-proxy monitor is not running on this server.')]
  if (v.alerts.length) return [r('pay-feeproxy', 'payments', name, 'degraded', `${v.alerts.length} payment${v.alerts.length === 1 ? '' : 's'} sent straight to a fee proxy and waiting for recovery.`)]
  const failed = v.chains.filter((c) => c.error).length
  if (failed) return [r('pay-feeproxy', 'payments', name, 'degraded', `${failed} chain${failed === 1 ? '' : 's'} could not be read on the last check.`)]
  return [r('pay-feeproxy', 'payments', name, v.checkedAt ? 'up' : 'unknown', v.checkedAt ? `No stray funds on ${v.chains.length} chain${v.chains.length === 1 ? '' : 's'}; checked ${agoWords(Date.now() - Date.parse(v.checkedAt))}.` : 'No check yet since this server started.')]
}

async function checkPayments() {
  // The chains Gully Pay offers now; with checkout closed, the four main payment chains still show their RPC health.
  let chains = publicChains().filter((c) => c.id !== SOLANA_CHAIN_ID && !c.testnet)
  if (!chains.length) chains = CHAIN_LIST.filter((c) => !c.testnet && [8453, 1, 56, 42161].includes(c.id))
  const evm = chains.map(async (c) => {
    const id = `pay-${c.key ?? c.id}`
    const name = `Gully Pay RPC: ${c.name}`
    try {
      const { out, ms } = await timed(() => rpc(c.id, 'eth_blockNumber', []))
      const block = typeof out === 'string' ? Number(BigInt(out)) : null
      if (!block) return r(id, 'payments', name, 'down', 'The chain answered without a block number.', ms)
      return r(id, 'payments', name, ms > 4_000 ? 'degraded' : 'up', `Block ${block.toLocaleString('en-US')} read in ${ms} ms.`, ms)
    } catch {
      return r(id, 'payments', name, 'down', 'No RPC node answered.')
    }
  })
  const sol = (async () => {
    const name = 'Gully Pay RPC: Solana'
    try {
      const { out, ms } = await timed(() => solanaRpc('getSlot', []))
      const slot = Number(out)
      if (!Number.isFinite(slot) || slot <= 0) return r('pay-solana', 'payments', name, 'down', 'Solana answered without a slot.', ms)
      return r('pay-solana', 'payments', name, ms > 4_000 ? 'degraded' : 'up', `Slot ${slot.toLocaleString('en-US')} read in ${ms} ms.`, ms)
    } catch {
      return r('pay-solana', 'payments', name, 'down', 'No Solana RPC node answered.')
    }
  })()
  return Promise.all([...evm, sol])
}

export function checkAi() {
  try {
    const s = askStatus()
    if (!s.configured) return [r('ai', 'ai', 'Gully AI', 'off', 'Gully AI is not configured on this server.')]
    if (!s.indexSize) return [r('ai', 'ai', 'Gully AI', 'degraded', 'Configured, but its search index is empty.')]
    // The model provider's account is failing (billing or key): every question fails until the owner fixes it.
    if (s.provider === 'unavailable') return [r('ai', 'ai', 'Gully AI', 'degraded', `Answers are unavailable right now${s.since ? ` (since ${s.since.slice(0, 16).replace('T', ' ')} UTC)` : ''}; we're on it. The docs still work.`)]
    return [r('ai', 'ai', 'Gully AI', 'up', `${s.indexSize} indexed passages; ${s.retrieval === 'hybrid' ? 'hybrid (keyword + semantic)' : 'keyword'} search.`)]
  } catch {
    return [r('ai', 'ai', 'Gully AI', 'unknown', 'Its status could not be read.')]
  }
}

async function checkSecurity() {
  const name = 'Security scan engine'
  try {
    const { out: s } = await timed(() => securityStatus())
    if (!s?.ai) return [r('security', 'security', name, 'off', 'The AI Security Scan is not configured on this server.')]
    const q = s.queue ?? {}
    const worker = s.worker?.reachable ? 'static-analysis tools available' : 'AI pass only (static-analysis tools not running)'
    return [r('security', 'security', name, 'up', `Running: ${worker}; ${q.running ? 'a scan in progress' : 'idle'}, ${q.queued ?? 0} queued.`)]
  } catch {
    return [r('security', 'security', name, 'unknown', 'Its status could not be read.')]
  }
}

function checkMonitors() {
  const name = 'Contract monitors'
  try {
    const s = monitorStats()
    const now = Date.now()
    const failing = Object.values(s.chains ?? {}).filter((c) => c?.lastErrorAt && now - Date.parse(c.lastErrorAt) < 10 * 60_000).length
    if (!s.live) return [r('monitors', 'security', name, 'up', 'No contract is being watched right now; the loop is idle.')]
    return [r('monitors', 'security', name, failing ? 'degraded' : 'up', `${s.live} contract${s.live === 1 ? '' : 's'} watched every ${s.load?.loopSeconds ?? 60} s${failing ? `; reads failing on ${failing} chain${failing === 1 ? '' : 's'}` : ''}.`)]
  } catch {
    return [r('monitors', 'security', name, 'unknown', 'Its status could not be read.')]
  }
}

/** Whether the Holder Map has a data source for a stock chain. Branch-safe: uses holders.holdersAvailable when it exists. */
export function holderChainAvailable(chainKey) {
  try {
    if (typeof holders.holdersAvailable === 'function') return !!holders.holdersAvailable(chainKey, 'stock')
    if (chainKey === 'solana') return !!String(process.env.GULLY_RPC_SOLANA ?? '').trim()
    return typeof holders.missingKeyReason === 'function' && holders.HOLDER_CHAINS?.[chainKey] ? holders.missingKeyReason(chainKey) === null : false
  } catch {
    return false
  }
}

function checkHolders() {
  const out = [r('holders-deepcore', 'holders', 'Holder Map: DeepCore launches', 'up', 'Read from DeepCore’s own log index.')]
  for (const [key, label] of [['robinhood', 'Robinhood Chain'], ['bsc', 'BNB Chain'], ['solana', 'Solana']]) {
    out.push(holderChainAvailable(key) ? r(`holders-${key}`, 'holders', `Holder Map: ${label} stock tokens`, 'up', 'Holder data source configured.') : r(`holders-${key}`, 'holders', `Holder Map: ${label} stock tokens`, 'off', `Holder data is not available on ${label} yet.`))
  }
  return out
}

/* ---------------------------------------------------------- the round --- */

async function settle(name, fn) {
  try {
    return await fn()
  } catch {
    return [r(name, 'platform', name, 'unknown', 'The check itself failed.')]
  }
}

/** Runs every check once and records the samples. */
export async function runChecks({ now = Date.now(), record = true } = {}) {
  if (running) return running
  running = (async () => {
    const groups = await Promise.all([settle('api', checkApi), settle('tracker', checkTracker), settle('deepcore', checkDeepcore), settle('telegram', checkTelegram), settle('telegram-gate', checkNewsGate), settle('payments', checkPayments), settle('pay-feeproxy', checkFeeProxy), settle('ai', checkAi), settle('security', checkSecurity), settle('monitors', checkMonitors), settle('holders', checkHolders)])
    const results = groups.flat()
    if (record) recordResults(results, now)
    lastRun = { at: now, results }
    return lastRun
  })()
  try {
    return await running
  } finally {
    running = null
  }
}

/** Records one round: samples, and incidents opened or closed on state changes. Exported for tests. */
export function recordResults(results, now = Date.now()) {
  load()
  store.since ??= new Date(now).toISOString()
  for (const c of results) {
    const list = (store.samples[c.id] ??= [])
    list.push([now, CODE[c.state] ?? '?', c.latencyMs ?? null])
    while (list.length && list[0][0] < now - KEEP_MS) list.shift()
    store.meta[c.id] = { group: c.group, name: c.name }
    const bad = c.state === 'down' || c.state === 'degraded'
    const open = store.incidents.find((i) => i.component === c.id && !i.endedAt)
    if (bad && !open) store.incidents.unshift({ id: `inc_${now.toString(36)}_${c.id}`, component: c.id, name: c.name, state: c.state, startedAt: new Date(now).toISOString(), endedAt: null, detail: c.detail })
    else if (bad && open) {
      if (c.state === 'down') open.state = 'down'
      open.detail = c.detail
    } else if (!bad && open && (c.state === 'up' || c.state === 'off')) open.endedAt = new Date(now).toISOString()
  }
  store.incidents = store.incidents.slice(0, MAX_INCIDENTS)
  dirty = true
  save()
}

function bucketsOf(list, now) {
  const n = Math.round(KEEP_MS / BUCKET_MS)
  const start = Math.floor((now - KEEP_MS) / BUCKET_MS) * BUCKET_MS + BUCKET_MS
  const out = Array.from({ length: n }, (_, i) => ({ t: new Date(start + i * BUCKET_MS).toISOString(), ups: 0, counted: 0, msSum: 0, msN: 0 }))
  for (const [t, code, ms] of list) {
    const i = Math.floor((t - start) / BUCKET_MS)
    if (i < 0 || i >= n) continue
    const b = out[i]
    if (code === 'u' || code === 'd' || code === 'x') {
      b.counted++
      if (code === 'u') b.ups++
      else if (code === 'd') b.ups += 0.5
    }
    if (typeof ms === 'number') (b.msSum += ms), b.msN++
  }
  return out.map((b) => ({ t: b.t, up: b.counted ? Math.round((b.ups / b.counted) * 1000) / 1000 : null, ms: b.msN ? Math.round(b.msSum / b.msN) : null }))
}

function uptimeOf(list) {
  let ups = 0
  let counted = 0
  for (const [, code] of list) {
    if (code === 'u') (ups++, counted++)
    else if (code === 'd') (ups += 0.5, counted++)
    else if (code === 'x') counted++
  }
  return counted ? Math.round((ups / counted) * 10000) / 10000 : null
}

/** The public body. */
export function statusBody(now = Date.now()) {
  load()
  const results = lastRun?.results ?? []
  const components = results.map((c) => {
    const list = store.samples[c.id] ?? []
    return { id: c.id, group: c.group, name: c.name, state: c.state, detail: c.detail, checkedAt: lastRun ? new Date(lastRun.at).toISOString() : null, latencyMs: c.latencyMs ?? null, uptime24h: uptimeOf(list), history: bucketsOf(list, now) }
  })
  const core = new Set(['api'])
  const overall = components.some((c) => core.has(c.id) && c.state === 'down') || components.filter((c) => c.state === 'down').length >= 3 ? 'major' : components.some((c) => c.state === 'down' || c.state === 'degraded') ? 'degraded' : 'operational'
  return { generatedAt: new Date(now).toISOString(), overall, intervalSeconds: INTERVAL_MS / 1000, since: store.since, components, incidents: store.incidents.slice(0, 20) }
}

/** GET /api/status. */
export async function handleStatus(req, res) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  if (req.method === 'OPTIONS') return void res.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS' }).end()
  if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405, { Allow: 'GET', ...headers }).end(JSON.stringify({ error: 'GET only' }))
  // No loop here (standby, tests, or the first seconds after start): check now, at most every 30 s.
  if (!lastRun || (!timer && Date.now() - lastRun.at > 30_000)) await runChecks({ record: !lastRun || !timer })
  res.writeHead(200, { ...headers, 'Cache-Control': 'public, max-age=30, s-maxage=30' })
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify(statusBody()))
}

/** Starts the 60-second checks (main loop only: a standby container does not write the shared history). */
export function startStatusLoop() {
  if (timer || process.env.STATUS_LOOP === 'off') return
  load()
  const tick = () => runChecks().catch((e) => console.error('status: check round failed:', e?.message ?? e))
  tick()
  timer = setInterval(tick, INTERVAL_MS)
  timer.unref?.()
}

/** Writes the history now (server.mjs calls it on SIGTERM/SIGINT, before exiting). */
export const flushStatus = () => save(true)

/** Test hook: forget everything in memory (the file is left alone). */
export function resetStatusForTest() {
  store = { samples: {}, meta: {}, incidents: [], since: null }
  loaded = true
  lastRun = null
  dirty = false
}
