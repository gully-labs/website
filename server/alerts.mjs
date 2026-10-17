// Gap alerts: a signed-in developer asks to be told when a tokenised stock's gap to its fair price
// crosses a line, by webhook and/or Telegram.
//
//   target     one stock (chain + ticker) or any stock
//   condition  { type: 'gap', pct }                 |gap| >= pct percent
//              { type: 'status', status }           status is 'premium', 'discount' or 'either'
//              { type: 'deepcore-launch', chainId }  a new token launches on DeepCore (deepcore.mjs),
//                                                  on one chain or (chainId null) any; no stock target.
//                                                  Fires once per new launch; launches that arrive
//                                                  within LAUNCH_COOLDOWN_MS of the last delivery wait
//                                                  and go out together. Counts against the plan's
//                                                  alerts like any other alert.
//   delivery   webhook: POST JSON to an https URL, signed with a per-alert secret (shown once):
//                X-Gully-Timestamp: <unix seconds>
//                X-Gully-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>
//              telegram: only when TELEGRAM_BOT_TOKEN is set; to the chat linked to the account with
//                the dashboard's Connect Telegram (telegram.mjs). Messages carry "Open <TICKER>" and
//                "Mute 24h" buttons; Mute pauses the alert (every channel) for 24 hours.
//
// Evaluated on every tracker snapshot (tracker.mjs onSnapshot, every five minutes). Per alert and per
// stock: it fires when the condition BECOMES true and re-arms once it is false again. An alert sends
// at most one delivery per COOLDOWN_MS; stocks that trigger during the cooldown stay armed and go out
// with the next delivery if their condition still holds. Only rows the tracker would itself flag are
// considered: readable feed and pool, a pool deep enough to flag, a fresh (not stale) pool read and an
// open feed session. Anything else neither fires nor re-arms.
//
// Webhook safety (SSRF): https only, no credentials in the URL, the host is resolved and refused when
// any address is private, loopback, link-local, multicast or otherwise not public, and the request is
// pinned to the address that was checked. 5 s timeout, redirects are not followed.
// GULLY_ALLOW_LOOPBACK_WEBHOOKS=1 (tests only) also allows http:// and https:// to a loopback address.
//
// Stored in DATA_DIR/alerts.json. The last 50 deliveries per alert are kept with their status.

import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import path from 'node:path'
import { DATA_DIR, json, readJson } from './http.mjs'
import { planOf } from './plans.mjs'
import { getAccount, randomToken } from './store.mjs'
import { FLAG_PCT, trackedStocks } from './tracker.mjs'
import { linkedChat, sendAlertTelegram, telegramEnabled, telegramInfo } from './telegram.mjs'
import { DEEPCORE_CHAINS, deepcoreAlertChains } from './deepcore.mjs'

const FILE = path.join(DATA_DIR, 'alerts.json')
export const COOLDOWN_MS = 30 * 60_000
export const LAUNCH_COOLDOWN_MS = 5 * 60_000
const MAX_PENDING_LAUNCHES = 20
const isLaunchAlert = (a) => a?.condition?.type === 'deepcore-launch'
const KEEP_DELIVERIES = 50
const TIMEOUT_MS = 5_000
const EVALUABLE = new Set(['in-line', 'drifting', 'premium', 'discount'])
const STATUSES = ['premium', 'discount', 'either']
const NAME_RE = /^[\p{L}\p{N} ._\-]{0,60}$/u
const CHAIN_NAMES = { robinhood: 'Robinhood Chain', bsc: 'BNB Chain' }

let db
try {
  db = JSON.parse(fs.readFileSync(FILE, 'utf8'))
} catch {
  db = {}
}
db.alerts ??= []

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(db))
    fs.renameSync(FILE + '.tmp', FILE)
  } catch (e) {
    console.error('alerts save:', e?.message ?? e)
  }
}

const loopbackAllowed = () => process.env.GULLY_ALLOW_LOOPBACK_WEBHOOKS === '1'

/* ------------------------------------------------------------ SSRF guard --- */

function v4ToInt(ip) {
  return ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0
}
const V4_BLOCKS = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([b, bits]) => [v4ToInt(b), bits])

/** IPv6 text to eight 16-bit groups (handles :: and an embedded IPv4 tail). */
function v6Groups(ip) {
  let s = ip.toLowerCase().replace(/%.*$/, '')
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (v4) {
    const n = v4ToInt(v4[1])
    s = s.slice(0, -v4[1].length) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16)
  }
  const [head, tail] = s.split('::')
  const h = head ? head.split(':') : []
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : []
  const fill = s.includes('::') ? Array(8 - h.length - t.length).fill('0') : []
  return [...h, ...fill, ...t].map((g) => parseInt(g || '0', 16))
}

/** True for any address that is not a public unicast address (private, loopback, link-local, …). */
export function isPrivateIp(ip) {
  const kind = net.isIP(ip)
  if (kind === 4) {
    const n = v4ToInt(ip)
    return V4_BLOCKS.some(([b, bits]) => (n >>> (32 - bits)) === (b >>> (32 - bits)))
  }
  if (kind === 6) {
    const g = v6Groups(ip)
    if (g.length !== 8) return true
    if (g.every((x) => x === 0)) return true // ::
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true // ::1
    if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isPrivateIp(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`) // v4-mapped / compatible
    if ((g[0] & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
    if ((g[0] & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
    if ((g[0] & 0xffc0) === 0xfec0) return true // fec0::/10 site-local (deprecated)
    if ((g[0] & 0xff00) === 0xff00) return true // multicast
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true // documentation
    if (g[0] === 0x0064 && g[1] === 0xff9b) return true // NAT64: embeds an IPv4 address
    if (g[0] === 0x2002) return true // 6to4: embeds an IPv4 address
    if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true // discard
    return false
  }
  return true
}
const isLoopback = (ip) => (net.isIP(ip) === 4 ? ip.startsWith('127.') : net.isIP(ip) === 6 ? v6Groups(ip).slice(0, 7).every((x) => x === 0) && v6Groups(ip)[7] === 1 : false)

/** Checks a webhook URL's form (no DNS). Returns { ok, url } or { ok: false, error }. */
export function checkWebhookForm(raw) {
  let u
  try {
    u = new URL(String(raw ?? '').trim())
  } catch {
    return { ok: false, error: 'The webhook must be a full URL starting with https://.' }
  }
  if (String(raw).length > 500) return { ok: false, error: 'The webhook URL is too long (500 characters at most).' }
  if (u.username || u.password) return { ok: false, error: 'The webhook URL must not contain a user name or password.' }
  const host = u.hostname.replace(/^\[|\]$/g, '')
  const loop = loopbackAllowed() && (host === 'localhost' || (net.isIP(host) && isLoopback(host)))
  if (u.protocol !== 'https:' && !(loop && u.protocol === 'http:')) return { ok: false, error: 'The webhook must use https://.' }
  if (!loop && (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal'))) return { ok: false, error: 'The webhook must be a public address.' }
  return { ok: true, url: u }
}

/** Resolves a webhook host and returns the one address to connect to, or an error when it is not public. */
export async function resolvePublic(u) {
  const host = u.hostname.replace(/^\[|\]$/g, '')
  let addrs
  if (net.isIP(host)) addrs = [{ address: host, family: net.isIP(host) }]
  else {
    try {
      addrs = await dns.lookup(host, { all: true, verbatim: true })
    } catch {
      return { ok: false, error: `The webhook host ${host} does not resolve.` }
    }
  }
  if (!addrs.length) return { ok: false, error: `The webhook host ${host} does not resolve.` }
  const allowLoop = loopbackAllowed()
  for (const a of addrs) {
    if (allowLoop && isLoopback(a.address)) continue
    if (isPrivateIp(a.address)) return { ok: false, error: 'The webhook resolves to a private or reserved address, which is not allowed.' }
  }
  return { ok: true, address: addrs[0].address, family: addrs[0].family }
}

/**
 * POSTs a signed body to a webhook: pinned to the checked address, 5 s, no redirects. Also used by Gully
 * Pay's merchant webhooks (pay-webhooks.mjs), with their own user agent.
 */
export async function postWebhook(urlStr, secret, body, { userAgent = 'GullyLabs-Alerts/1 (+https://docs.gullylabs.xyz/plans-alerts)' } = {}) {
  const form = checkWebhookForm(urlStr)
  if (!form.ok) return { status: null, ok: false, error: form.error }
  const u = form.url
  const target = await resolvePublic(u)
  if (!target.ok) return { status: null, ok: false, error: target.error }
  const ts = Math.floor(Date.now() / 1000)
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')
  const lib = u.protocol === 'https:' ? https : http
  return new Promise((resolve) => {
    let done = false
    const finish = (r) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(r)
    }
    const req = lib.request(
      u,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'user-agent': userAgent, 'x-gully-timestamp': String(ts), 'x-gully-signature': `sha256=${sig}` },
        lookup: (_h, opts, cb) => (opts?.all ? cb(null, [{ address: target.address, family: target.family }]) : cb(null, target.address, target.family)),
      },
      (res) => {
        res.resume() // the body is not read beyond draining
        const status = res.statusCode ?? null
        const ok = status !== null && status >= 200 && status < 300
        finish({ status, ok, error: ok ? null : status >= 300 && status < 400 ? `answered ${status}; redirects are not followed` : `answered ${status}` })
        res.destroy()
      },
    )
    const timer = setTimeout(() => {
      req.destroy()
      finish({ status: null, ok: false, error: 'timed out after 5 s' })
    }, TIMEOUT_MS)
    req.on('error', (e) => finish({ status: null, ok: false, error: String(e?.message ?? e).slice(0, 200) }))
    req.end(body)
  })
}

/* ------------------------------------------------------------ evaluation --- */

const seriesKey = (r) => `${r.chain}:${r.ticker}`

function holds(c, r) {
  if (c.type === 'gap') return Math.abs(r.gapPct) >= c.pct
  if (c.status === 'either') return r.status === 'premium' || r.status === 'discount'
  return r.status === c.status
}

const evaluable = (r) => typeof r?.gapPct === 'number' && Number.isFinite(r.gapPct) && EVALUABLE.has(r.status) && !r.poolStale && r.sessionOpen !== false

/** The alerts of a wallet that its plan covers: the oldest `plan.alerts` ones. */
function coveredIds(owner) {
  const n = planOf(owner).alerts
  return new Set(db.alerts.filter((a) => a.owner === owner).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, n).map((a) => a.id))
}

const eventOf = (r, at) => ({
  kind: 'gap',
  chain: r.chain,
  chainName: CHAIN_NAMES[r.chain] ?? r.chain,
  ticker: r.ticker,
  name: r.name ?? null,
  status: r.status,
  gapPct: Math.round(r.gapPct * 100) / 100,
  fair: r.fair ?? null,
  onchain: r.onchain ?? null,
  poolLiquidityUsd: r.pool?.liquidityUsd ?? null,
  feedUpdatedAt: r.feedUpdatedAt ?? null,
  snapshotAt: new Date(at).toISOString(),
})

const conditionText = (c) => (c.type === 'deepcore-launch' ? `new DeepCore launch on ${c.chainId ? (DEEPCORE_CHAINS[c.chainId]?.name ?? `chain ${c.chainId}`) : 'any chain'}` : c.type === 'gap' ? `gap of ${c.pct}% or more either way` : c.status === 'either' ? 'status premium or discount' : `status ${c.status}`)

function payloadOf(alert, events, test, at) {
  return {
    id: `dlv_${randomToken(12)}`,
    type: test ? 'alert.test' : 'alert.triggered',
    createdAt: new Date(at).toISOString(),
    alert: { id: alert.id, name: alert.name || null, kind: isLaunchAlert(alert) ? 'deepcore-launch' : 'gap', target: isLaunchAlert(alert) ? { deepcoreChainId: alert.condition.chainId ?? null } : alert.chain ? { chain: alert.chain, ticker: alert.ticker } : 'any', condition: alert.condition },
    events,
  }
}

/** Sends one delivery on every channel of an alert and logs each outcome. */
async function deliver(alert, events, test, at = Date.now()) {
  const payload = payloadOf(alert, events, test, at)
  const body = JSON.stringify(payload)
  const results = []
  if (alert.webhook) {
    const t0 = Date.now()
    const r = await postWebhook(alert.webhook.url, alert.webhook.secret, body)
    results.push({ channel: 'webhook', ...r, ms: Date.now() - t0 })
  }
  if (alert.telegram) {
    const t0 = Date.now()
    const r = await sendAlertTelegram({ owner: alert.owner, alertId: alert.id, name: alert.name || null, conditionText: conditionText(alert.condition), chatId: alert.telegram.chatId ?? null, events, test })
    results.push({ channel: 'telegram', ...r, ms: Date.now() - t0 })
  }
  const live = db.alerts.find((a) => a.id === alert.id)
  if (live) {
    for (const r of results) live.deliveries.push({ id: payload.id, at: payload.createdAt, test, channel: r.channel, status: r.status, ok: r.ok, error: r.error, ms: r.ms, events: events.map((e) => (e.kind === 'deepcore.launch' ? `deepcore:${e.chainKey}:${e.symbol ?? e.token}` : `${e.chain}:${e.ticker}`)) })
    if (live.deliveries.length > KEEP_DELIVERIES) live.deliveries.splice(0, live.deliveries.length - KEEP_DELIVERIES)
  }
  return { payload, results }
}

/**
 * Evaluates every alert against one snapshot's rows. Exported as the test hook: the tracker calls it
 * through onSnapshot, and scripts/test-paid.mjs calls it with synthetic rows.
 */
export async function evaluateAlerts(rows, at = Date.now()) {
  const owners = new Set(db.alerts.map((a) => a.owner))
  const covered = new Set()
  for (const o of owners) {
    if (getAccount(o)?.blocked) continue
    for (const id of coveredIds(o)) covered.add(id)
  }
  const sends = []
  for (const alert of db.alerts) {
    if (isLaunchAlert(alert)) continue // evaluated on DeepCore polls (evaluateLaunchAlerts)
    if (!alert.enabled || !covered.has(alert.id)) continue
    if (alert.mutedUntil && Date.parse(alert.mutedUntil) > at) continue // muted from Telegram: neither fires nor re-arms
    const triggered = []
    for (const r of rows) {
      if (alert.chain && (r.chain !== alert.chain || r.ticker !== alert.ticker)) continue
      if (!evaluable(r)) continue
      const k = seriesKey(r)
      if (!holds(alert.condition, r)) {
        delete alert.disarmed[k]
        continue
      }
      if (!alert.disarmed[k]) triggered.push(r)
    }
    if (!triggered.length) continue
    if (alert.lastFiredAt && at - Date.parse(alert.lastFiredAt) < COOLDOWN_MS) continue // stays armed
    for (const r of triggered) alert.disarmed[seriesKey(r)] = new Date(at).toISOString()
    alert.lastFiredAt = new Date(at).toISOString()
    sends.push(deliver(alert, triggered.map((r) => eventOf(r, at)), false, at))
  }
  save()
  const out = await Promise.all(sends)
  if (out.length) save()
  return out
}

/** The event a DeepCore launch alert delivers (webhook JSON and Telegram). */
const launchEventOf = (l, at) => ({
  kind: 'deepcore.launch',
  chainId: l.chainId,
  chainKey: l.chainKey,
  chainName: l.chainName,
  token: l.token,
  symbol: l.symbol,
  createdAt: l.createdAt,
  txHash: l.txHash,
  pools: l.legs.map((g) => ({ poolId: g.poolId, kind: g.kind, quote: g.quote, locked: g.locked, lockId: g.lockId })),
  links: l.links,
  snapshotAt: new Date(at).toISOString(),
})

/**
 * Delivers DeepCore launch alerts. Called after every DeepCore poll (deepcore.mjs onLaunches) with the
 * launches first seen in it (possibly none: launches held back by the cooldown are flushed then).
 * Paused, muted or uncovered alerts neither queue nor send: a launch they missed is not sent later.
 */
export async function evaluateLaunchAlerts(fresh, at = Date.now()) {
  const owners = new Set(db.alerts.filter(isLaunchAlert).map((a) => a.owner))
  const covered = new Set()
  for (const o of owners) {
    if (getAccount(o)?.blocked) continue
    for (const id of coveredIds(o)) covered.add(id)
  }
  const sends = []
  let changed = false
  for (const alert of db.alerts) {
    if (!isLaunchAlert(alert)) continue
    const live = alert.enabled && covered.has(alert.id) && !(alert.mutedUntil && Date.parse(alert.mutedUntil) > at)
    if (!live) {
      if (alert.pendingLaunches?.length) {
        alert.pendingLaunches = []
        changed = true
      }
      continue
    }
    // Only launches made after the alert was created (an hour of slack for indexer lag).
    const mine = fresh.filter((l) => (!alert.condition.chainId || l.chainId === alert.condition.chainId) && Date.parse(l.createdAt) >= Date.parse(alert.createdAt) - 3_600_000)
    const queue = [...(alert.pendingLaunches ?? []), ...mine.map((l) => launchEventOf(l, at))].slice(-MAX_PENDING_LAUNCHES)
    if (mine.length) changed = true
    if (!queue.length) continue
    if (alert.lastFiredAt && at - Date.parse(alert.lastFiredAt) < LAUNCH_COOLDOWN_MS) {
      alert.pendingLaunches = queue
      continue
    }
    alert.pendingLaunches = []
    alert.lastFiredAt = new Date(at).toISOString()
    changed = true
    sends.push(deliver(alert, queue, false, at))
  }
  if (changed) save()
  const out = await Promise.all(sends)
  if (out.length) save()
  return out
}

/* ----------------------------------------------------------------- views --- */

function view(a, covered) {
  return {
    id: a.id,
    name: a.name || null,
    chain: a.chain,
    ticker: a.ticker,
    condition: a.condition,
    kind: isLaunchAlert(a) ? 'deepcore-launch' : 'gap',
    pendingLaunches: isLaunchAlert(a) ? (a.pendingLaunches?.length ?? 0) : undefined,
    webhook: a.webhook ? { url: a.webhook.url } : null,
    telegram: a.telegram ? { chatTitle: (a.telegram.chatId ? null : linkedChat(a.owner)?.chatTitle) ?? null, linked: !!(a.telegram.chatId || linkedChat(a.owner)) } : null,
    enabled: a.enabled,
    mutedUntil: a.mutedUntil && Date.parse(a.mutedUntil) > Date.now() ? a.mutedUntil : null,
    coveredByPlan: covered.has(a.id),
    armed: Object.keys(a.disarmed).length === 0,
    waitingToReArm: Object.keys(a.disarmed),
    createdAt: a.createdAt,
    lastFiredAt: a.lastFiredAt,
    deliveries: [...a.deliveries].reverse(),
  }
}

/** Alerts and limits for a wallet's dashboard. */
export async function alertsOf(address) {
  const plan = planOf(address)
  const covered = coveredIds(address)
  const mine = db.alerts.filter((a) => a.owner === address)
  return {
    alerts: mine.map((a) => view(a, covered)).reverse(),
    limits: { plan: plan.id, planName: plan.name, max: plan.alerts, used: mine.length, cooldownMinutes: COOLDOWN_MS / 60_000, flagPct: FLAG_PCT },
    telegram: await telegramInfo(address),
    stocks: trackedStocks(),
    // The alert kinds this server offers, for the create dialog.
    kinds: [
      { id: 'gap', label: 'Gap alert', target: 'stock' },
      { id: 'deepcore-launch', label: 'DeepCore new launch', target: 'deepcore-chain', chains: deepcoreAlertChains(), cooldownMinutes: LAUNCH_COOLDOWN_MS / 60_000 },
    ],
  }
}

/* --------------------------------------------------------------- handler --- */

const hits = new Map()
function allow(k, max, ms) {
  const now = Date.now()
  const list = (hits.get(k) ?? []).filter((t) => now - t < ms)
  if (list.length >= max) return false
  list.push(now)
  hits.set(k, list)
  return true
}

const newSecret = () => `whsec_${randomToken(24)}`

/**
 * /api/developer/alerts* for a signed-in wallet (developer.mjs has already checked the session and CSRF).
 *   GET  /api/developer/alerts
 *   POST /api/developer/alerts                    { name?, chain?, ticker?, condition, webhookUrl?, telegram?: true } -> { alert, secret? }
 *   POST /api/developer/alerts/:id/pause|resume|delete|test|rotate     (resume also ends a Telegram mute)
 *   POST /api/developer/alerts/:id/telegram       { on: boolean }   Telegram delivery on or off
 */
export async function handleAlerts(req, res, url, address) {
  const p = url.pathname
  const post = req.method === 'POST'
  if (p === '/api/developer/alerts' && !post) return json(res, 200, await alertsOf(address)), true
  if (!post) return json(res, 405, { error: 'POST only' }), true

  if (p === '/api/developer/alerts') {
    if (!allow(`create:${address}`, 30, 3_600_000)) return json(res, 429, { error: 'Too many alerts created in the last hour. Try again later.' }), true
    const plan = planOf(address)
    const mine = db.alerts.filter((a) => a.owner === address)
    if (mine.length >= plan.alerts) return json(res, 403, { error: plan.alerts ? `The ${plan.name} plan includes ${plan.alerts} alert${plan.alerts === 1 ? '' : 's'}; you have ${mine.length}. Delete one or upgrade.` : `The ${plan.name} plan includes no alerts.` }), true
    const body = await readJson(req, 4_000)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!NAME_RE.test(name)) return json(res, 400, { error: 'The name may hold up to 60 letters, digits, spaces, dots, dashes or underscores.' }), true

    let chain = null
    let ticker = null
    const launchKind = body?.condition?.type === 'deepcore-launch'
    if (launchKind && (body?.chain || body?.ticker)) return json(res, 400, { error: 'A DeepCore launch alert has no stock; limit it to a chain with condition.chainId, or leave that empty for every chain.' }), true
    if (!launchKind && (body?.chain || body?.ticker)) {
      chain = String(body.chain ?? '').toLowerCase()
      ticker = String(body.ticker ?? '').toUpperCase()
      if (!trackedStocks().some((s) => s.chain === chain && s.ticker === ticker)) return json(res, 400, { error: 'Pick a stock the tracker follows (chain and ticker), or leave both empty for any stock.' }), true
    }

    const c = body?.condition
    let condition
    if (c?.type === 'gap') {
      const pct = Number(c.pct)
      if (!Number.isFinite(pct) || pct < 0.1 || pct > 100) return json(res, 400, { error: 'The gap must be a percentage from 0.1 to 100.' }), true
      condition = { type: 'gap', pct: Math.round(pct * 100) / 100 }
    } else if (c?.type === 'status' && STATUSES.includes(c.status)) condition = { type: 'status', status: c.status }
    else if (launchKind) {
      const id = c.chainId === undefined || c.chainId === null || c.chainId === '' ? null : Number(c.chainId)
      if (id !== null && !DEEPCORE_CHAINS[id]) return json(res, 400, { error: `DeepCore runs on ${deepcoreAlertChains().map((x) => `${x.name} (${x.chainId})`).join(', ')}; pick one of those, or none for every chain.` }), true
      condition = { type: 'deepcore-launch', chainId: id }
    } else return json(res, 400, { error: 'Choose a condition: a gap of at least X%, a status (premium, discount or either), or a new DeepCore launch.' }), true

    let webhook = null
    let secret = null
    if (body?.webhookUrl) {
      const form = checkWebhookForm(body.webhookUrl)
      if (!form.ok) return json(res, 400, { error: form.error }), true
      const target = await resolvePublic(form.url)
      if (!target.ok) return json(res, 400, { error: target.error }), true
      secret = newSecret()
      webhook = { url: form.url.toString(), secret }
    }
    let telegram = null
    const wantsTelegram = body?.telegram === true || (body?.telegramChatId !== undefined && body?.telegramChatId !== null && body?.telegramChatId !== '')
    if (wantsTelegram) {
      if (!telegramEnabled()) return json(res, 400, { error: 'Telegram delivery is not available on this server.' }), true
      if (body?.telegram !== true) return json(res, 400, { error: 'Chat ids are no longer pasted: press Connect Telegram in the Alerts tab, then tick Telegram.' }), true
      if (!linkedChat(address)) return json(res, 400, { error: 'Connect Telegram first (Alerts tab), then tick Telegram.' }), true
      telegram = { linked: true }
    }
    if (!webhook && !telegram) return json(res, 400, { error: 'Give a webhook URL, or tick Telegram, to deliver to.' }), true

    const alert = { id: randomToken(9), owner: address, name, chain, ticker, condition, webhook, telegram, enabled: true, createdAt: new Date().toISOString(), lastFiredAt: null, disarmed: {}, deliveries: [] }
    db.alerts.push(alert)
    save()
    return json(res, 201, { alert: view(alert, coveredIds(address)), secret }), true
  }

  const m = p.match(/^\/api\/developer\/alerts\/([\w-]{1,40})\/(pause|resume|delete|test|rotate|telegram)$/)
  if (!m) return json(res, 404, { error: 'not found' }), true
  const alert = db.alerts.find((a) => a.id === m[1] && a.owner === address)
  if (!alert) return json(res, 404, { error: 'No such alert on this account.' }), true

  if (m[2] === 'delete') {
    db.alerts = db.alerts.filter((a) => a !== alert)
    save()
    return json(res, 200, { ok: true }), true
  }
  if (m[2] === 'pause' || m[2] === 'resume') {
    alert.enabled = m[2] === 'resume'
    if (alert.enabled) delete alert.mutedUntil
    save()
    return json(res, 200, { alert: view(alert, coveredIds(address)) }), true
  }
  if (m[2] === 'telegram') {
    const body = await readJson(req, 500)
    if (body?.on === true) {
      if (!telegramEnabled()) return json(res, 400, { error: 'Telegram delivery is not available on this server.' }), true
      if (!linkedChat(address)) return json(res, 400, { error: 'Connect Telegram first, above.' }), true
      alert.telegram = { linked: true }
    } else if (body?.on === false) {
      if (!alert.webhook) return json(res, 409, { error: 'This alert has no webhook; Telegram is its only channel. Delete the alert instead.' }), true
      alert.telegram = null
    } else return json(res, 400, { error: 'Send { "on": true } or { "on": false }.' }), true
    save()
    return json(res, 200, { alert: view(alert, coveredIds(address)) }), true
  }
  if (m[2] === 'rotate') {
    if (!alert.webhook) return json(res, 409, { error: 'This alert has no webhook.' }), true
    alert.webhook.secret = newSecret()
    save()
    return json(res, 200, { alert: view(alert, coveredIds(address)), secret: alert.webhook.secret }), true
  }
  // test
  if (!allow(`test:${alert.id}`, 10, 3_600_000)) return json(res, 429, { error: 'Ten test deliveries an hour per alert. Try again later.' }), true
  const { results } = await deliver(alert, [], true)
  save()
  return json(res, 200, { results: results.map((r) => ({ channel: r.channel, ok: r.ok, status: r.status, error: r.error, ms: r.ms })), alert: view(alert, coveredIds(address)) }), true
}

/** Admin: counts for the overview. */
export const alertStats = () => ({ total: db.alerts.length, enabled: db.alerts.filter((a) => a.enabled).length, owners: new Set(db.alerts.map((a) => a.owner)).size })

/* --------------------------------------------------------- for the bot --- */

/** Mutes one alert of `owner` for `ms` (Telegram's Mute 24h button). */
export function muteAlert(id, owner, ms) {
  const alert = db.alerts.find((a) => a.id === id)
  if (!alert || alert.owner !== owner) return { ok: false, error: 'This alert does not belong to the account linked to this chat.' }
  alert.mutedUntil = new Date(Date.now() + ms).toISOString()
  save()
  return { ok: true, mutedUntil: alert.mutedUntil }
}

/** One account's alerts, in words, for the bot's /alerts. */
export function alertsForChat(owner) {
  const covered = coveredIds(owner)
  const now = Date.now()
  return db.alerts
    .filter((a) => a.owner === owner)
    .map((a) => ({
      label: a.name || (isLaunchAlert(a) ? 'DeepCore launches' : a.ticker ? `${a.ticker} on ${CHAIN_NAMES[a.chain] ?? a.chain}` : 'Any stock'),
      condition: conditionText(a.condition),
      state: !covered.has(a.id) ? 'not in your plan' : !a.enabled ? 'paused' : a.mutedUntil && Date.parse(a.mutedUntil) > now ? `muted until ${new Date(a.mutedUntil).toISOString().replace('T', ' ').slice(0, 16)} UTC` : !isLaunchAlert(a) && Object.keys(a.disarmed).length ? 'fired, waits to re-arm' : 'watching',
      telegram: !!a.telegram,
    }))
}
