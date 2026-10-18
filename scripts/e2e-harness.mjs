// Harness for scripts/e2e.mjs: boots the real server in this process against the built dist/ with a temp
// DATA_DIR, with every outbound call the SERVER makes stubbed (globalThis.fetch is replaced before the
// server loads), and gives the browser side fixtures and page checks.
//
// Server-side stubs (no network): Anthropic (Gully AI), Telegram Bot API, JSON-RPC for every payment chain
// (Chainlink feeds, blocks), DeepCore, the venue stats APIs and DexScreener/GeckoTerminal (refused, so the
// tracker's own build fails fast; the browser gets fixtures for /api/tracker*). Anything else outbound is
// refused and recorded in `blockedOutbound`, and the suite fails if any were made.

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DIST = path.join(ROOT, 'dist')

const word = (n) => BigInt.asUintN(256, BigInt(n)).toString(16).padStart(64, '0')
const hex = (n) => '0x' + BigInt(n).toString(16)
const nowSec = () => Math.floor(Date.now() / 1000)

/* ------------------------------------------------------------- tracker fixture --- */

const readTable = (key) => JSON.parse(fs.readFileSync(path.join(ROOT, 'server/data', `${key}-stocks.json`), 'utf8')).stocks
const CHAINS = [
  { key: 'robinhood', id: 4663, name: 'Robinhood Chain', session: '24/5' },
  { key: 'bsc', id: 56, name: 'BNB Chain', session: 'NYSE hours' },
]

/** A deterministic /api/tracker body in the server's own shape (server/tracker.mjs build()). */
export function trackerFixture(at = Date.now()) {
  const iso = new Date(at).toISOString()
  const rows = []
  for (const c of CHAINS) {
    readTable(c.key).forEach((s, i) => {
      const fair = 50 + ((i * 37) % 400) + 0.25
      const gapPct = [0.12, -0.4, 2.6, -3.1, 0.8, -1.6, 4.2, 0][i % 8]
      const status = Math.abs(gapPct) <= 1 ? 'in-line' : gapPct > 0 ? 'premium' : 'discount'
      const onchain = +(fair * (1 + gapPct / 100)).toFixed(4)
      rows.push({
        chain: c.key,
        ticker: s.ticker,
        name: s.name,
        token: s.token,
        feed: s.feed,
        fair,
        feedPrices: s.prices,
        multiplier: c.key === 'bsc' ? 1 : null,
        feedUpdatedAt: iso,
        feedError: null,
        onchain,
        gapPct,
        status,
        rawGapPct: gapPct,
        trusted: true,
        untrustedReason: null,
        onchainSource: 'chain',
        onchainAt: iso,
        pool: { dex: 'uniswap', labels: ['v3'], against: 'USDC', url: `https://dexscreener.com/${c.key}/0x${'1'.repeat(40)}`, pair: '0x' + '1'.repeat(40), liquidityUsd: 2_500_000 + i * 1000, volume24hUsd: 180_000 + i * 500, pools: 1, totalLiquidityUsd: 2_500_000 + i * 1000, totalVolume24hUsd: 180_000 + i * 500, readableOnChain: true },
        poolError: null,
        logo: null,
        chainLogo: null,
        poolStale: false,
      })
    })
  }
  return {
    generatedAt: iso,
    chains: CHAINS.map((c) => ({ key: c.key, id: c.id, name: c.name, sessionOpen: true, sessionName: c.session, poolsAsOf: iso, poolsStale: false, poolSource: 'on chain', fairMethod: 'Chainlink feed' })),
    rules: { minLiquidityUsd: 10_000, inLinePct: 1, flagPct: 2, implausiblePct: 15, trustLiquidityUsd: 1_000_000, unitsRatio: 5 },
    sources: { fair: 'Chainlink (e2e fixture)', onchain: 'pools (e2e fixture)', tables: [] },
    rows,
  }
}

/** /api/tracker/history: [unixSeconds, gapPct, onchain, fair][] over `days`, hourly. */
export function historyFixture(chain, ticker, days = 7) {
  const end = nowSec()
  const points = []
  for (let t = end - days * 86400; t <= end; t += 3600) {
    const k = (t / 3600) % 48
    const gap = +(Math.sin(k / 7) * 1.8).toFixed(3)
    const fair = 180 + Math.sin(k / 11) * 4
    points.push([t, gap, +(fair * (1 + gap / 100)).toFixed(3), +fair.toFixed(3)])
  }
  return { chain, ticker, days, points }
}

/** /api/stats in the server's shape (server/stats.mjs, src/lib/stats.ts): four venues read, one unreadable. */
export function statsFixture(at = Date.now()) {
  const day0 = Math.floor(at / 86_400_000) * 86400
  const daily = (base) => Array.from({ length: 30 }, (_, i) => ({ t: day0 - (29 - i) * 86400, v: base + ((i * 53) % 400) }))
  const iso = new Date(at).toISOString()
  const venue = (key, base, extra = {}) => ({ key, state: 'ok', volumeAllUsd: base * 90, volumeAllSince: '2026-01-01', volume30dUsd: base * 30, volume24hUsd: base, tvlUsd: base * 4, fees24hUsd: base / 100, feesAllUsd: base, daily: daily(base), counts: {}, notes: [], source: { url: `https://${key}.example/api`, readAt: iso }, ...extra })
  const venues = [venue('cartel-family', 1200), venue('deepcore', 900), venue('peddleswap', 400), venue('peddles', 650), { key: 'peddlequest', state: 'error', error: 'e2e: unreadable on purpose' }]
  const ok = venues.filter((v) => v.state === 'ok')
  const sum = (k) => ok.reduce((a, v) => a + v[k], 0)
  const keys = ok.map((v) => v.key)
  const byDay = new Map()
  for (const v of ok) for (const p of v.daily) byDay.set(p.t, (byDay.get(p.t) ?? 0) + p.v)
  return {
    generatedAt: iso,
    totals: { volumeAllUsd: sum('volumeAllUsd'), volume24hUsd: sum('volume24hUsd'), tvlUsd: sum('tvlUsd'), fees24hUsd: sum('fees24hUsd'), feesAllUsd: sum('feesAllUsd'), covers: { volumeAllUsd: keys, volume24hUsd: keys, tvlUsd: keys, fees24hUsd: keys, feesAllUsd: keys }, unread: ['peddlequest'] },
    daily: [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v })),
    venues,
  }
}

/** Seeds the tracker's history (and so /api/tracker/history and /movers) with 26 hours of snapshots. */
export async function seedTrackerHistory(body) {
  const tracker = await import(pathToFileURL(path.join(ROOT, 'server/tracker.mjs')).href)
  const end = Date.now()
  for (let i = 26 * 6; i >= 0; i--) {
    const at = end - i * 10 * 60_000
    const wobble = Math.sin(i / 9)
    tracker.recordSnapshotForTest(body.rows.map((r, k) => ({ ...r, gapPct: +(r.gapPct + wobble * (k % 3) * 0.2).toFixed(3), onchain: +(r.onchain * (1 + wobble * 0.002 * (k % 4))).toFixed(4), sessionOpen: true })), at)
  }
}

/* ------------------------------------------------------------- server-side stubs --- */

export const blockedOutbound = []
export const anthropicCalls = []
export const telegramCalls = []

const FEEDS = { 8453: 2_400_00000000n, 1: 2_500_00000000n, 56: 700_00000000n, 42161: 2_450_00000000n }

function rpcAnswer(chainId, q) {
  if (q.method === 'eth_chainId') return hex(chainId)
  if (q.method === 'eth_blockNumber') return hex(5_000_000)
  if (q.method === 'eth_getBlockByNumber') return { number: q.params[0], timestamp: hex(nowSec()) }
  if (q.method === 'eth_getTransactionReceipt' || q.method === 'eth_getTransactionByHash') return null
  if (q.method === 'eth_getBalance') return '0x0' // the fee-proxy monitor's coin reads (fee-proxy-monitor.mjs): nothing stuck
  if (q.method === 'eth_call') {
    const data = String(q.params?.[0]?.data ?? '')
    if (data === '0xfeaf968c') return '0x' + word(777) + word(FEEDS[chainId] ?? 2_400_00000000n) + word(nowSec() - 60) + word(nowSec() - 60) + word(777)
    if (data === '0x313ce567') return '0x' + word(8)
    return '0x'
  }
  return null
}

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Replaces globalThis.fetch for the server: local calls pass, known upstreams are stubbed, the rest refused. */
export function stubServerFetch() {
  const real = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url ?? input)
    let u
    try {
      u = new URL(url)
    } catch {
      return real(input, init)
    }
    if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return real(input, init)
    const m = u.hostname.match(/^rpc-(\d+)\.e2e\.invalid$/)
    if (m) {
      const body = JSON.parse(String(init.body ?? 'null'))
      const one = (q) => ({ jsonrpc: '2.0', id: q.id, result: rpcAnswer(Number(m[1]), q) })
      return jsonResponse(Array.isArray(body) ? body.map(one) : one(body))
    }
    if (u.hostname === 'api.anthropic.com') {
      anthropicCalls.push(JSON.parse(String(init.body ?? '{}')))
      return jsonResponse({ id: 'msg_e2e', type: 'message', role: 'assistant', model: 'stub', content: [{ type: 'text', text: 'Gap alerts fire when a stock’s gap crosses the threshold you set [1]. You can get them by webhook or Telegram [2].' }], stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 40 } })
    }
    if (u.hostname === 'api.telegram.org') {
      const method = u.pathname.split('/').pop()
      telegramCalls.push(method)
      if (method === 'getMe') return jsonResponse({ ok: true, result: { id: 7000000001, is_bot: true, username: 'GullyE2EBot' } })
      if (method === 'getChatMember') return jsonResponse({ ok: true, result: { status: 'member', user: { id: Number(JSON.parse(String(init.body ?? '{}')).user_id) } } })
      if (method === 'sendMessage') return jsonResponse({ ok: true, result: { message_id: telegramCalls.length, chat: { id: 1 } } })
      return jsonResponse({ ok: true, result: true })
    }
    blockedOutbound.push(url.slice(0, 120))
    throw new TypeError(`fetch failed (e2e: outbound ${u.hostname} is stubbed)`)
  }
}

/* ------------------------------------------------------------- Telegram Mini App --- */

export const E2E_BOT_TOKEN = '7000000001:' + 'E'.repeat(35)

/** initData signed as Telegram signs it (HMAC-SHA256 with the bot token; see server/telegram-miniapp.mjs). */
export function signedInitData(user, token = E2E_BOT_TOKEN, authDate = nowSec()) {
  const fields = { query_id: 'AAE2E', auth_date: String(authDate), user: JSON.stringify(user) }
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest()
  return new URLSearchParams({ ...fields, hash: crypto.createHmac('sha256', secret).update(check).digest('hex') }).toString()
}

/**
 * A stand-in for https://telegram.org/js/telegram-web-app.js: Telegram.WebApp with the given initData and
 * theme. It records BackButton/MainButton/haptics calls on window.__tg, and draws the MainButton as a bar
 * at the bottom (Telegram draws it natively, outside the page) so tests can press it and screenshots show it.
 */
export function telegramSdkStub(initData, theme = {}) {
  return `(() => {
  const log = (window.__tg = { haptics: [], back: false, main: null })
  const clicks = { back: new Set(), main: new Set() }
  let bar = null
  const draw = (p) => {
    if (!document.body) return
    bar ??= Object.assign(document.createElement('button'), { id: 'tg-main-button' })
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:56px;border:0;font:600 15px system-ui;z-index:99;background:' + ${JSON.stringify(theme.button_color ?? '#2481cc')} + ';color:' + ${JSON.stringify(theme.button_text_color ?? '#ffffff')}
    bar.onclick = () => clicks.main.forEach((f) => f())
    bar.textContent = p.text
    bar.style.display = p.is_visible ? 'block' : 'none'
    bar.style.opacity = p.is_active === false ? '0.6' : '1'
    if (!bar.isConnected) document.body.appendChild(bar)
    // Telegram's own button sits below the webview; keep the page clear of the stand-in.
    document.body.style.paddingBottom = p.is_visible ? '56px' : ''
  }
  const main = { text: '', is_visible: false, is_active: true }
  window.Telegram = { WebApp: {
    initData: ${JSON.stringify(initData)},
    initDataUnsafe: {},
    version: '8.0', platform: 'tdesktop', colorScheme: 'dark',
    themeParams: ${JSON.stringify(theme)},
    ready() {}, expand() {}, close() {},
    isVersionAtLeast: () => true,
    setHeaderColor() {}, setBackgroundColor() {},
    openLink(u) { log.opened = u }, openTelegramLink(u) { log.opened = u },
    showConfirm(_m, cb) { cb(true) },
    onEvent() {}, offEvent() {},
    BackButton: { isVisible: false, show() { log.back = true }, hide() { log.back = false }, onClick(f) { clicks.back.add(f) }, offClick(f) { clicks.back.delete(f) } },
    MainButton: {
      setParams(p) { Object.assign(main, p); log.main = { ...main }; draw(main) },
      show() { main.is_visible = true; draw(main) }, hide() { main.is_visible = false; log.main = { ...main }; draw(main) },
      enable() {}, disable() {}, showProgress() {}, hideProgress() {},
      onClick(f) { clicks.main.add(f) }, offClick(f) { clicks.main.delete(f) },
    },
    HapticFeedback: { impactOccurred(s) { log.haptics.push('impact:' + s) }, notificationOccurred(s) { log.haptics.push('notify:' + s) }, selectionChanged() { log.haptics.push('select') } },
  } }
  window.__tgBack = () => clicks.back.forEach((f) => f())
})()`
}

/* ------------------------------------------------------------- boot --- */

export async function bootServer({ port }) {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('dist/ is missing: run `npm run build` first (test:e2e serves the built site).')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-e2e-'))
  const admin = crypto.randomBytes(24).toString('hex')
  const treasury = '0x' + crypto.randomBytes(20).toString('hex')
  Object.assign(process.env, {
    PORT: String(port),
    DATA_DIR: tmp,
    TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
    DIST_DIR: DIST,
    ADMIN_TOKEN: admin,
    TRACKER_LOOP: 'off',
    DEEPCORE_LOOP: 'off',
    TRACKER_SKIP_APIS: '1',
    ASK_REMOTE: 'off',
    GULLY_TREASURY_ADDRESS: treasury,
    ANTHROPIC_API_KEY: 'sk-ant-e2e-' + 'x'.repeat(30),
    TELEGRAM_BOT_TOKEN: E2E_BOT_TOKEN,
    DEEPCORE_API: 'https://deepcore-api.e2e.invalid',
    ...Object.fromEntries(Object.keys(FEEDS).map((id) => [`GULLY_RPC_${id}`, `https://rpc-${id}.e2e.invalid`])),
  })
  for (const k of ['GULLY_BASE_RPC', 'GULLY_MIN_CONFIRMATIONS', 'ANALYTICS_ADMIN_PASSWORD', 'ANTHROPIC_API_URL', 'TELEGRAM_API']) delete process.env[k]
  stubServerFetch()
  await import(pathToFileURL(path.join(ROOT, 'server/server.mjs')).href)
  await new Promise((r) => setTimeout(r, 300))
  return { tmp, admin, treasury, base: `http://localhost:${port}` }
}
