// Design audit 3 (read-only; extends design audit 2 with detail checks and a 320 px width): boots the e2e harness server, visits every site route, docs page, app page, admin,
// the Mini App, pay/checkout states and the embed at 1440 and 390 px, saves a full-page screenshot of each and
// measures charts (animated? live?), compactness, developer noise, logos, tap targets, overlaps and the pixel audit.
//
//   TEST_PORT=9351 AUDIT_OUT=<dir> node scripts/design-audit-3.mjs      (needs dist/: npm run build)
//
// AUDIT_FAST=1 skips screenshots, the motion check and the interaction checks (writes results-fast.json); AUDIT_WIDTHS=320,390 limits widths.
// Output: <AUDIT_OUT>/shots/<page>-<width>.png and <AUDIT_OUT>/results.json. It changes no product code.

import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { bootServer, E2E_ANY_TOKEN, E2E_LAUNCH_TOKEN, historyFixture, holdersExtraFixtures, holdersFixture, ROOT, seedTrackerHistory, signedInitData, statsFixture, telegramSdkStub, trackerFixture } from './e2e-harness.mjs'
import { guardTestRun, makeClient } from './test-helpers.mjs'
import { auditPage, tokenColors } from './e2e-audit.mjs'

const PORT = Number(process.env.TEST_PORT) || 9351
const OUT = process.env.AUDIT_OUT || path.resolve(ROOT, '..', 'gully-session-tools', 'design-audit-3')
const SHOTS = path.join(OUT, 'shots')
const FAST = !!process.env.AUDIT_FAST // skip screenshots, the motion check and the interaction checks
const ONLY = process.env.AUDIT_ONLY ? new RegExp(process.env.AUDIT_ONLY) : null
fs.mkdirSync(SHOTS, { recursive: true })
await guardTestRun(PORT, { watchdogMs: 110 * 60_000 })
process.env.GULLY_ALLOW_LOOPBACK_WEBHOOKS = '1'
const { admin, base: BASE } = await bootServer({ port: PORT })
const TRACKER = trackerFixture()
await seedTrackerHistory(TRACKER)
const STATS = statsFixture()
const WIDGET_JS = fs.readFileSync(path.join(ROOT, 'dist', 'widget.js'))
const TOKENS = tokenColors()
const browser = await chromium.launch({ headless: true })
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
const QUOTE = { chain: 'robinhood', ticker: 'NVDA', pay: { symbol: 'ETH', amount: '0.1' }, out: { symbol: 'NVDA', amount: '1.84', minimum: '1.82' }, priceImpactPct: 0.21, slippagePct: 0.5, fee: { pct: 0.3, amount: '0.0003', symbol: 'ETH', exempt: false }, onDeepcorePool: true, route: { venues: ['DeepCore'], hops: [{ venue: 'DeepCore', from: 'ETH', to: 'NVDA' }] }, alternatives: [], quotedAt: new Date().toISOString(), links: { swap: 'https://deepcore.fun/swap', token: 'https://deepcore.fun/token' } }
const LAUNCHES = (() => {
  const chains = [[4663, 'Robinhood Chain', 'robinhood'], [56, 'BNB Chain', 'bsc'], [8453, 'Base', 'base']]
  const launches = Array.from({ length: 12 }, (_, i) => {
    const [chainId, chainName, chainKey] = chains[i % 3]
    const token = i === 0 ? E2E_LAUNCH_TOKEN : '0x' + (i + 1).toString(16).padStart(40, 'a')
    return { key: `${chainId}:${token}`, chainId, chainKey, chainName, token, symbol: i === 0 ? 'DTC' : `E2E${i}`, locked: i % 2 === 0, createdAt: new Date(Date.now() - i * 5 * 3600_000).toISOString(), txHash: null, creator: null, startsAt: null, totalSupply: null, legs: [{ poolId: null, kind: 'CL', quote: 'WETH', locked: i % 2 === 0, lockId: null, feePct: 1, quoteAddress: null }], links: { token: `https://deepcore.fun/tokens/${token}`, launch: `https://deepcore.fun/app/launch/v2/${token}`, swap: 'https://deepcore.fun/app/swap' } }
  })
  return { state: 'ok', launches, asOf: new Date().toISOString(), chains: chains.map(([chainId, name]) => ({ chainId, name, status: 'ok', total: 4 })), error: null, pollSeconds: 90 }
})()

async function newContext({ width = 1440, height = 900, cookie = null, adminToken = false, geo = { country: 'GB', allowed: true, reason: 'ok' } } = {}) {
  const mobile = width < 600
  const ctx = await browser.newContext({ viewport: { width, height }, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}), permissions: ['clipboard-read', 'clipboard-write'], serviceWorkers: 'block' })
  if (cookie) await ctx.addCookies([{ name: 'gl_dev', value: cookie, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }])
  if (adminToken) await ctx.addInitScript((tok) => sessionStorage.setItem('gully-admin-token', tok), admin)
  await ctx.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (route) => {
    const u = new URL(route.request().url())
    if (u.hostname === 'gullylabs.xyz' && u.pathname === '/widget.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: WIDGET_JS })
    if (u.hostname === 'gullylabs.xyz' && /^\/brand\/[\w.-]+\.png$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(path.join(ROOT, 'dist', u.pathname.slice(1))) })
    if (u.hostname === 'gullylabs.xyz' && u.pathname === '/api/tracker') return json(route, TRACKER)
    if (u.hostname === 'gullylabs.xyz' && u.pathname === '/api/tracker/history') return json(route, historyFixture(u.searchParams.get('chain'), u.searchParams.get('ticker')))
    if (u.hostname === 'analytics.gullylabs.xyz') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '/* stub */' })
    return route.abort('blockedbyclient')
  })
  await ctx.route(`${BASE}/api/tracker`, (route) => json(route, TRACKER))
  await ctx.route(`${BASE}/api/stats`, (route) => json(route, STATS))
  await ctx.route(`${BASE}/api/geo`, (route) => json(route, geo))
  await ctx.route(new RegExp(`^${BASE}/api/deepcore/quote`), (route) => json(route, { quote: QUOTE, cached: false }))
  await ctx.route(new RegExp(`^${BASE}/api/deepcore/launches`), (route) => json(route, LAUNCHES))
  await ctx.route(new RegExp(`^${BASE}/api/pay/price`), (route) => json(route, { asset: 'base-eth', price: (2500 + Math.random()).toFixed(2), updatedAt: new Date().toISOString() }))
  await ctx.route(new RegExp(`^${BASE}/api/holders/[^/]+/[^/.]+$`), (route) => json(route, holdersFixture(/\/0x[0-9a-f]{40}$/i.test(new URL(route.request().url()).pathname) ? 'deepcore-launch' : 'stock')))
  await ctx.route(`${BASE}/api/holders/base/${E2E_ANY_TOKEN}`, (route) => json(route, holdersFixture('token')))
  const HX = holdersExtraFixtures()
  await ctx.route(new RegExp(`^${BASE}/api/holders/resolve`), (route) => json(route, HX.resolve(new URL(route.request().url()).searchParams.get('q') ?? '')))
  await ctx.route(`${BASE}/api/holders/launches`, (route) => json(route, HX.launches))
  await ctx.route(new RegExp(`^${BASE}/api/holders/top`), (route) => json(route, HX.top))
  await ctx.route(new RegExp(`^${BASE}/api/holders/[^/]+/[^/]+/live`), (route) => json(route, HX.live))
  await ctx.route(new RegExp(`^${BASE}/api/holders/[^/]+/[^/]+/wallet/`), (route) => json(route, HX.wallet))
  return ctx
}

/* ---------------------------------------------------------------- seed data --- */

const empty = makeClient(BASE)
const rich = makeClient(BASE)
const ownerEmpty = privateKeyToAccount(generatePrivateKey())
const ownerRich = privateKeyToAccount(generatePrivateKey())
await empty.signIn(ownerEmpty)
await rich.signIn(ownerRich)
const cookieOf = (c) => c.cookie.split('=').slice(1).join('=')
const adminCall = async (p, body) => {
  const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, data: await r.json().catch(() => null) }
}
const note = []
const safe = async (label, fn) => { try { return await fn() } catch (e) { note.push(`${label}: ${String(e?.message ?? e).slice(0, 160)}`); return null } }
const SC_ADDR = '0x' + 'ab'.repeat(20)

const inv = await safe('invoice', () => adminCall('/api/admin/invoices', { title: 'Audit: first month', usd: '25', assets: ['base-usdc', 'base-eth'] }))
const invAll = await safe('invoice-all', () => adminCall('/api/admin/invoices', { title: 'Audit: every chain', usd: '12' }))
const plink = await safe('paylink', () => adminCall('/api/admin/paylinks', { title: 'Audit pay link', amount: { type: 'fixed', usd: '49' }, assets: ['base-usdc'] }))
await safe('wallet', () => rich.post('/api/developer/merchant/wallets', { acceptTerms: true, address: ownerRich.address, type: 'eoa', chains: [8453] }))
const mlink = await safe('mlink', () => rich.post('/api/developer/merchant/links', { title: 'Bag of beans', description: '1 kg, whole bean. Roasted this week.', amount: { type: 'fixed', usd: '10' }, assets: ['base-usdc', 'base-eth'] }))
const mclosed = await safe('mclosed', () => rich.post('/api/developer/merchant/links', { title: 'Arbitrum only', amount: { type: 'fixed', usd: '5' }, assets: ['arb-usdc'] }))
const minv = await safe('minv', () => rich.post('/api/developer/merchant/invoices', { items: [{ description: 'Espresso machine service', quantity: 1, unitUsd: '180' }, { description: 'Descaler, 500 ml', quantity: 2, unitUsd: '12.50' }], dueDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), customer: { name: 'Jane Doe' } }))
await safe('alert', () => rich.post('/api/developer/alerts', { chain: 'robinhood', ticker: 'NVDA', thresholdPct: 2, channel: 'email', target: 'a@example.com' }))
await safe('key', () => rich.post('/api/developer/keys', { name: 'audit key' }))
await safe('score', async () => {
  const gs = await import('../server/gully-score.mjs')
  const now = Date.now()
  const at = (d) => new Date(now - d * 86_400_000).toISOString()
  const comp = (id, o) => ({ ...gs.COMPONENTS.find((c) => c.id === id), evidence: [], ...o })
  gs.putScoreForTest({ chainId: 8453, chainKey: 'base', chainName: 'Base', address: SC_ADDR, name: 'Audit Vault', symbol: null, score: 74, grade: 'Fair', coverage: { weight: 75, components: 6, of: 9 }, computedAt: new Date(now).toISOString(), methodVersion: 1,
    components: [
      comp('verified', { available: true, score: 100, value: 'Full match (Sourcify)', reason: 'Verified on Sourcify.', provider: 'sourcify', match: 'full' }),
      comp('control', { available: true, score: 100, value: 'Safe, 2 of 3', reason: 'Changes need 2 of the 3 signers.' }),
      comp('timelock', { available: true, score: 0, value: 'No delay', reason: 'Changes take effect at once.' }),
      comp('upgradeability', { available: true, score: 30, value: 'Upgradeable', reason: 'Its code can be swapped.' }),
      comp('changes', { available: true, score: 75, value: '1 in 30 days', reason: 'One change.' }),
      comp('liquidity', { available: false, score: null, value: 'Not available', reason: 'Locks are read for DeepCore launches only.' }),
      comp('holders', { available: false, score: null, value: 'Not available', reason: 'No Holder Map.' }),
      comp('review', { available: true, score: 70, value: 'Published', reason: 'A report exists.' }),
      comp('age', { available: false, score: null, value: 'Not available', reason: 'Unknown.' }),
    ],
    history: [{ at: at(9), score: 81 }, { at: at(5), score: 79 }, { at: at(2), score: 74 }, { at: new Date(now).toISOString(), score: 74 }],
    changes: [{ at: at(9), id: null, label: 'First scored', from: null, to: 81, note: 'Scored 81.' }] })
})

/* ---------------------------------------------------------------- page list --- */

const docsSlugs = (fs.readFileSync(path.join(ROOT, 'src/docs/routes.tsx'), 'utf8').match(/path: '([\w-]+)'/g) ?? []).map((m) => m.slice(7, -1)).filter((s) => s !== '*')
const APP_IDS = ['overview', 'products', 'tracker', 'pay', 'merchant', 'security', 'chain-kit', 'ai', 'deepcore', 'holders', 'widgets', 'telegram', 'keys', 'alerts', 'analytics', 'billing', 'team', 'activity', 'settings']
const PAID = await safe('paid', async () => {
  if (!inv?.data?.invoice) return null
  const real = await (await fetch(`${BASE}/api/pay/${inv.data.invoice.id}`)).json()
  const usdc = real.invoice.assets.find((a) => a.id === 'base-usdc')
  return { ...real.invoice, status: 'paid', paidAt: new Date().toISOString(), payment: { id: 'pm_a', kind: 'invoice', txHash: '0x' + 'ab'.repeat(32), chainId: usdc.chainId, chain: usdc.chain, asset: usdc.id, symbol: usdc.symbol, amount: '25.000042', usd: '25.00', from: '0x' + '12'.repeat(20), to: real.invoice.checkout.treasury, blockNumber: 4999990, at: new Date().toISOString(), txUrl: `${usdc.explorer}/tx/0x${'ab'.repeat(32)}`, price: null, plan: null, periodStart: null, expiresAt: null, invoiceId: null } }
})

const pages = []
const add = (name, url, o = {}) => pages.push({ name, url, ...o })
for (const [n, u] of [['home', '/'], ['tracker', '/tracker'], ['stock-nvda', '/tracker/robinhood/NVDA'], ['stock-solana-tsla', '/tracker/solana/TSLA'], ['holders-landing', '/holders'], ['score-index', '/score'], ['score-page', `/score/base/${SC_ADDR}`], ['score-unscored', `/score/base/0x${'cd'.repeat(20)}`], ['security', '/security'], ['security-reports', '/security/reports'], ['ecosystem', '/ecosystem'], ['partners', '/partners'], ['chain-kit', '/chain-kit'], ['pricing', '/pricing'], ['services', '/services'], ['about', '/about'], ['project-deepcore', '/projects/deepcore'], ['project-peddleswap', '/projects/peddleswap'], ['project-peddles', '/projects/peddles'], ['project-peddlequest', '/projects/peddlequest'], ['project-cartel', '/projects/cartel-family'], ['analytics', '/analytics'], ['widget', '/widget'], ['links', '/links'], ['status', '/status'], ['ask', '/ask'], ['legal-merchant-terms', '/legal/merchant-terms'], ['legal-privacy', '/legal/privacy'], ['not-found', '/this-page-does-not-exist']]) add('site-' + n, u, { group: 'site' })
add('docs-index', '/docs', { group: 'docs' })
for (const s of docsSlugs) add('docs-' + s, `/docs/${s}`, { group: 'docs' })
for (const id of APP_IDS) add('app-rich-' + id, `/app#${id}`, { group: 'app', who: 'rich', ready: `main[data-page="${id}"]` })
for (const id of ['overview', 'tracker', 'pay', 'merchant', 'security', 'alerts', 'holders', 'keys', 'analytics', 'billing']) add('app-empty-' + id, `/app#${id}`, { group: 'app-empty', who: 'empty', ready: `main[data-page="${id}"]` })
add('app-merchant-wallets', '/developers#merchant/wallets', { group: 'app', who: 'rich' })
add('app-security-new', '/developers#security-new', { group: 'app', who: 'rich' })
add('admin', '/admin', { group: 'admin', admin: true })
add('miniapp', '/tg', { group: 'tg', tg: true })
add('embed-holders', `/embed/holders/robinhood/${E2E_LAUNCH_TOKEN}`, { group: 'embed' })
add('embed-holders-stock', '/embed/holders/robinhood/NVDA', { group: 'embed' })
if (inv?.data?.invoice) add('pay-invoice-open', `/pay/${inv.data.invoice.id}`, { group: 'pay' })
if (invAll?.data?.invoice) add('pay-invoice-all-chains', `/pay/${invAll.data.invoice.id}`, { group: 'pay' })
if (PAID) add('pay-invoice-paid', `/pay/${inv.data.invoice.id}`, { group: 'pay', paid: true })
if (plink?.data?.link) add('pay-link', `/pay/l/${plink.data.link.id}`, { group: 'pay' })
if (mlink?.data?.link) add('pay-merchant-link', `/pay/m/l/${mlink.data.link.id}`, { group: 'pay' })
if (mclosed?.data?.link) add('pay-merchant-link-closed', `/pay/m/l/${mclosed.data.link.id}`, { group: 'pay' })
if (minv?.data?.invoice) add('pay-merchant-invoice', `/pay/m/${minv.data.invoice.id}`, { group: 'pay' })
add('pay-missing', '/pay/inv_doesnotexist', { group: 'pay' })

/* ---------------------------------------------------------------- measurement (runs in the page) --- */

function measure() {
  const vh = window.innerHeight
  const vw = window.innerWidth
  const doc = document.documentElement
  const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.05 }
  const sel = (el) => { const parts = []; for (let e = el, i = 0; e && e.nodeType === 1 && i < 3; e = e.parentElement, i++) parts.unshift(e.tagName.toLowerCase() + (e.id ? '#' + e.id : e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : '')); return parts.join(' > ') }
  const text = document.body.innerText || ''
  const out = { height: doc.scrollHeight, viewports: +(doc.scrollHeight / vh).toFixed(2), scrollW: doc.scrollWidth, innerW: vw, words: text.split(/\s+/).filter(Boolean).length }
  out.contentH = Math.max(...[...document.querySelectorAll('main, [class*="overflow-y"], [class*="overflow-auto"]')].map((e) => e.scrollHeight), 0)
  const echarts = [...document.querySelectorAll('[data-chart]')].filter(visible)
  const svgCharts = [...document.querySelectorAll('svg')].filter((s) => visible(s) && !s.closest('button, a, [data-ghost], [data-chart]') && s.getBoundingClientRect().width >= 120 && s.getBoundingClientRect().height >= 50 && s.querySelectorAll('path, rect, circle, polyline, line').length >= 4)
  const canvases = [...document.querySelectorAll('canvas')].filter(visible)
  const ghosts = [...document.querySelectorAll('[data-ghost]')].filter(visible)
  out.charts = { echarts: echarts.length, svg: svgCharts.length, canvas: canvases.length, ghost: ghosts.length }
  const noise = []
  for (const re of [/\[object Object\]/, /\bundefined\b/, /\bNaN\b/, /\bnull\b/, /\b(?:src|server|scripts|node_modules)\/[\w./-]+\.(?:tsx?|mjs|js|json|md)\b/, /[A-Za-z]:\\[\w\\]+/, /\{"[a-z]+":/, /\bTODO\b|\bFIXME\b|lorem ipsum/i]) {
    const m = text.match(re)
    if (m) noise.push(m[0].slice(0, 60))
  }
  out.noise = noise
  out.brokenImgs = [...document.images].filter((i) => visible(i) && i.complete && i.naturalWidth === 0).map((i) => (i.getAttribute('src') || '').slice(0, 80))
  out.imgs = [...document.images].filter(visible).length
  const walls = []
  for (const el of document.body.querySelectorAll('div, ul, ol, section')) {
    const kids = [...el.children].filter(visible)
    if (kids.length < 6) continue
    const rs = kids.map((k) => k.getBoundingClientRect())
    const w0 = rs[0].width, h0 = rs[0].height
    if (w0 < 120 || h0 < 60) continue
    if (!rs.every((r) => Math.abs(r.width - w0) < 8 && Math.abs(r.height - h0) < h0 * 0.35)) continue
    const rich = kids.filter((k) => k.querySelector('svg, canvas, img, [data-chart], progress')).length
    const textLen = kids.reduce((a, k) => a + (k.innerText || '').length, 0)
    if (rich / kids.length < 0.3 && textLen / kids.length > 60) walls.push({ sel: sel(el), cards: kids.length, w: Math.round(w0), h: Math.round(h0), chars: Math.round(textLen / kids.length) })
  }
  out.walls = walls.slice(0, 6)
  const sparse = []
  for (const el of document.body.querySelectorAll('section, main > div, article')) {
    const r = el.getBoundingClientRect()
    if (!visible(el) || r.height < 300 || r.width < 600) continue
    let minL = Infinity, maxR = -Infinity
    const leaves = [...el.querySelectorAll('*')].filter((c) => visible(c) && c.children.length === 0 && ((c.textContent || '').trim() || c.tagName === 'IMG' || c.tagName === 'svg' || c.tagName === 'path'))
    for (const c of leaves) { const cr = c.getBoundingClientRect(); if (cr.width > 0) { minL = Math.min(minL, cr.left); maxR = Math.max(maxR, cr.right) } }
    if (leaves.length && (maxR - minL) / r.width < 0.4) sparse.push({ sel: sel(el), w: Math.round(r.width), h: Math.round(r.height), usedPct: Math.round(((maxR - minL) / r.width) * 100) })
  }
  out.sparse = sparse.slice(0, 5)
  const main = document.querySelector('main') || document.body
  const blocks = [...main.querySelectorAll(':scope > *, :scope > * > *')].filter((b) => visible(b) && b.getBoundingClientRect().height > 8).map((b) => b.getBoundingClientRect()).sort((a, b) => a.top - b.top)
  let maxGap = 0, reach = -Infinity
  for (const b of blocks) { if (reach > -Infinity && b.top - reach > maxGap) maxGap = b.top - reach; reach = Math.max(reach, b.bottom) }
  out.maxVGap = Math.round(maxGap)
  const NAMES = ['Base', 'Ethereum', 'BNB Chain', 'Arbitrum', 'Robinhood Chain', 'Solana', 'OP Mainnet', 'Polygon', 'Avalanche', 'DeepCore', 'PeddleSwap', 'Peddles', 'PeddleQuest', 'Cartel Family', 'Chainlink', 'Uniswap', 'USDC', 'USDT', 'ETH', 'SOL', 'BNB', 'Telegram', 'Safe', 'Sourcify', 'Hyperlane', 'Blockscout', 'DefiLlama', 'DexScreener', 'GeckoTerminal', 'LI.FI', 'Binance', 'Coinbase', 'Pyth', 'Stripe']
  const missing = new Map()
  for (const el of document.body.querySelectorAll('a, span, td, th, li, p, h2, h3, h4, strong, b, div, button, label')) {
    if (!visible(el) || el.children.length > 3) continue
    const t = (el.innerText || '').trim()
    if (!t || t.length > 40) continue
    const name = NAMES.find((n) => t === n || t.startsWith(n + ' ') || t.endsWith(' ' + n) || t.startsWith(n + ' ·'))
    if (!name) continue
    const er = el.getBoundingClientRect()
    let host = el, found = false
    for (let i = 0; i < 3 && host && !found; i++, host = host.parentElement) {
      if (host === document.body) break
      for (const m of host.querySelectorAll('img, svg, [data-brand], [data-logo]')) {
        if (!visible(m) || m.closest('[data-chart]')) continue
        const mr = m.getBoundingClientRect()
        if (mr.width > 80) continue
        if (Math.abs(mr.top + mr.height / 2 - (er.top + er.height / 2)) < 40 && mr.right > er.left - 70 && mr.left < er.right + 70) { found = true; break }
      }
    }
    if (!found) { const cur = missing.get(name) ?? { name, count: 0, sample: sel(el) }; cur.count++; missing.set(name, cur) }
  }
  out.noLogo = [...missing.values()].sort((a, b) => b.count - a.count).slice(0, 8)
  if (vw < 600) {
    const small = []
    for (const el of document.body.querySelectorAll('a[href], button, [role="button"], [role="tab"], [role="radio"], input:not([type=hidden]), select, textarea, summary')) {
      if (!visible(el) || el.closest('[data-chart]')) continue
      if (el.tagName === 'A' && el.closest('p, li, td') && !el.matches('[class*="rounded"]') && el.getBoundingClientRect().height < 30) continue
      const r = el.getBoundingClientRect()
      if (r.height < 44 || r.width < 44) small.push({ sel: sel(el), w: Math.round(r.width), h: Math.round(r.height), t: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 24) })
    }
    out.tapSmall = small.length
    out.tapSmallSample = small.slice(0, 5)
    const fab = document.querySelector('[data-testid="ask-fab"]')
    const overlap = []
    if (fab && visible(fab)) {
      const f = fab.getBoundingClientRect()
      for (const el of document.body.querySelectorAll('a[href], button, input, select, textarea, h1, h2, h3, p, td, li, img')) {
        if (el === fab || fab.contains(el) || el.contains(fab) || !visible(el)) continue
        if (el.closest('[data-testid="ask-fab"], [aria-label="Back to top"]')) continue
        if (getComputedStyle(el).position === 'fixed') continue
        const r = el.getBoundingClientRect()
        if (r.bottom > f.top && r.top < f.bottom && r.right > f.left && r.left < f.right && r.top >= 0 && r.bottom <= vh) overlap.push(sel(el) + ' "' + (el.innerText || '').trim().slice(0, 20) + '"')
      }
    }
    out.fabOverlap = overlap.slice(0, 4)
  }
  const cards = {}
  for (const el of document.body.querySelectorAll('[class*="rounded"]')) {
    if (!visible(el)) continue
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    if (parseFloat(cs.borderTopWidth) < 1 || r.width < 160 || r.height < 60) continue
    const k = `r${cs.borderTopLeftRadius}|b${cs.borderTopColor}|bg${cs.backgroundColor}`
    cards[k] = (cards[k] ?? 0) + 1
  }
  out.cardRecipes = cards
  const heads = {}
  for (const el of document.body.querySelectorAll('h1, h2, h3')) {
    if (!visible(el)) continue
    const cs = getComputedStyle(el)
    const k = `${el.tagName}|${cs.fontSize}|${cs.fontWeight}|${cs.fontFamily.split(',')[0]}`
    heads[k] = (heads[k] ?? 0) + 1
  }
  out.headings = heads
  out.h1 = [...document.querySelectorAll('h1')].filter(visible).length
  out.emptyStates = [...document.querySelectorAll('p, div, span')].filter((e) => visible(e) && e.children.length === 0 && /^(no |nothing |none yet|not available|not yet)/i.test((e.innerText || '').trim()) && (e.innerText || '').length < 90).slice(0, 5).map((e) => (e.innerText || '').trim() + (e.closest('[data-ghost]') || e.parentElement?.querySelector('[data-ghost]') || e.parentElement?.parentElement?.querySelector('[data-ghost]') ? ' [ghost]' : ' [NO GHOST]'))
  return out
}

/** A signature of every chart's drawn markup/pixels, compared 3 s apart. */
function chartSignature() {
  const h = (s) => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return x }
  const els = [...document.querySelectorAll('svg, canvas')].filter((s) => { const r = s.getBoundingClientRect(); return r.width >= 100 && r.height >= 40 && (s.tagName === 'CANVAS' || s.querySelectorAll('path, rect, circle, polyline, line').length >= 3) })
  const sigs = els.map((s) => { if (s.tagName === 'CANVAS') { try { return h(s.toDataURL().slice(-4000)) } catch { return 0 } } return h(s.outerHTML) })
  return { sigs, anims: document.getAnimations().filter((a) => a.playState === 'running').length, smil: document.querySelectorAll('animate, animateTransform, animateMotion').length, text: h(document.body.innerText) }
}

/* ---------------------------------------------------------------- detail checks (run in the page) --- */

function details() {
  const vw = window.innerWidth
  const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.05 }
  const sel = (el) => { const parts = []; for (let e = el, i = 0; e && e.nodeType === 1 && i < 3; e = e.parentElement, i++) parts.unshift(e.tagName.toLowerCase() + (e.id ? '#' + e.id : e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : '')); return parts.join(' > ') }
  const own = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').replace(/\s+/g, ' ').trim()
  const isAddr = (t) => /0x[0-9a-f]{4,}|…|\.\.\.|[1-9A-HJ-NP-Za-km-z]{30,}/i.test(t)
  const inChart = (el) => !!el.closest('[data-chart], svg, canvas, code, pre')
  const out = {}

  // 1. clipped or truncated labels and controls
  const clipped = []
  for (const el of document.body.querySelectorAll('a, button, label, th, h1, h2, h3, h4, h5, [role=tab], summary, span, p, div, li, td, strong')) {
    if (clipped.length >= 12) break
    if (!visible(el) || inChart(el)) continue
    const t = own(el)
    if (!t || t.length < 2 || isAddr(t)) continue
    const cs = getComputedStyle(el)
    const clips = cs.overflowX !== 'visible'
    const ell = cs.textOverflow === 'ellipsis'
    if ((clips || ell) && el.scrollWidth > el.clientWidth + 1) clipped.push({ sel: sel(el), t: t.slice(0, 40), sw: el.scrollWidth, cw: el.clientWidth, ell })
    else if (cs.overflowY !== 'visible' && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll' && el.clientHeight > 0 && el.clientHeight < 200 && el.scrollHeight > el.clientHeight + 2) clipped.push({ sel: sel(el), t: t.slice(0, 40), sh: el.scrollHeight, ch: el.clientHeight, v: true })
  }
  out.clipped = clipped
  // content that runs past the viewport edge
  const spill = []
  for (const el of document.body.querySelectorAll('a, button, h1, h2, h3, h4, p, label, th, td, li, span')) {
    if (spill.length >= 8) break
    if (!visible(el) || inChart(el) || own(el).length < 2) continue
    let scroller = false
    for (let sc = el.parentElement; sc && sc !== document.body; sc = sc.parentElement) { const o = getComputedStyle(sc).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') { scroller = true; break } }
    if (scroller) continue
    const r = el.getBoundingClientRect()
    if (r.right > vw + 2 || r.left < -2) spill.push({ sel: sel(el), t: own(el).slice(0, 30), l: Math.round(r.left), r: Math.round(r.right) })
  }
  out.spill = spill
  // text or controls pushed past the viewport, or past the edge of a clipping ancestor (overflow hidden/clip hides the spill)
  const spill2 = []
  for (const el of document.body.querySelectorAll('a, button, h1, h2, h3, h4, p, label, th, td, li, span, input, select')) {
    if (spill2.length >= 10) break
    if (!visible(el) || el.closest('[data-chart], svg, .sr-only, [class*="sr-only"]')) continue
    const t = own(el)
    const ctl = /^(A|BUTTON|INPUT|SELECT)$/.test(el.tagName)
    if (!t && !ctl) continue
    let ok = true, clipEl = null
    for (let sc = el.parentElement; sc && sc !== document.documentElement; sc = sc.parentElement) {
      const o = getComputedStyle(sc).overflowX
      if (o === 'auto' || o === 'scroll') { ok = false; break }
      if ((o === 'hidden' || o === 'clip') && !clipEl && sc !== document.body) clipEl = sc
    }
    if (!ok) continue
    let r
    if (ctl) r = el.getBoundingClientRect()
    else { const tn = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()); const rg = document.createRange(); rg.selectNodeContents(tn); const rs = [...rg.getClientRects()].filter((q) => q.width > 1); if (!rs.length) continue; r = { left: Math.min(...rs.map((q) => q.left)), right: Math.max(...rs.map((q) => q.right)) } }
    const limit = clipEl ? Math.min(clipEl.getBoundingClientRect().right, vw) : vw
    if (r.right > limit + 1.5 || r.left < -1.5) spill2.push({ sel: sel(el), t: (t || el.getAttribute('aria-label') || '').slice(0, 30), right: Math.round(r.right), limit: Math.round(limit) })
  }
  out.spill2 = spill2

  // 2. overlapping text or controls (text-node boxes)
  const items = []
  const sy = window.scrollY
  for (const el of document.body.querySelectorAll('a, button, input, select, textarea, h1, h2, h3, h4, h5, p, label, th, td, li, span, strong, b, small, div, [role=tab]')) {
    if (!visible(el) || inChart(el)) continue
    const t = own(el)
    const control = /^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.getAttribute('role') === 'tab'
    if (!t && !control) continue
    if (!control && t.length < 2) continue
    let fixed = false
    for (let e = el; e && e !== document.body; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === 'fixed' || p === 'sticky') { fixed = true; break } }
    if (fixed) continue
    let r
    if (control) r = el.getBoundingClientRect()
    else {
      const tn = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim())
      const rg = document.createRange(); rg.selectNodeContents(tn)
      const rs = [...rg.getClientRects()].filter((q) => q.width > 1 && q.height > 1)
      if (!rs.length) continue
      r = { left: Math.min(...rs.map((q) => q.left)), right: Math.max(...rs.map((q) => q.right)), top: Math.min(...rs.map((q) => q.top)), bottom: Math.max(...rs.map((q) => q.bottom)) }
    }
    items.push({ el, l: r.left, r: r.right, t: r.top + sy, b: r.bottom + sy, label: (t || el.getAttribute('aria-label') || el.tagName).slice(0, 24) })
  }
  const clipOf = (el) => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { const o = getComputedStyle(e); if (o.overflowX === 'hidden' || o.overflowX === 'clip') return e } return null }
  const overlaps = []
  const lim = Math.min(items.length, 1600)
  for (let i = 0; i < lim && overlaps.length < 10; i++) {
    for (let j = i + 1; j < lim; j++) {
      const a = items[i], b = items[j]
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue
      const w = Math.min(a.r, b.r) - Math.max(a.l, b.l)
      const h = Math.min(a.b, b.b) - Math.max(a.t, b.t)
      if (w > 3 && h > 3 && w * h > 30) {
        const ca = clipOf(a.el), cb = clipOf(b.el)
        if (ca !== cb && ((ca && !ca.contains(b.el)) || (cb && !cb.contains(a.el)))) continue
        if (getComputedStyle(a.el).position === 'absolute' && getComputedStyle(b.el).position === 'absolute') continue
        overlaps.push({ a: sel(a.el) + ' "' + a.label + '"', b: sel(b.el) + ' "' + b.label + '"', w: Math.round(w), h: Math.round(h) })
        break
      }
    }
  }
  out.overlaps = overlaps

  // 3. misalignment: card rows with uneven heights, uneven paddings, stat baselines
  const rowsUneven = [], padDrift = [], baseDrift = []
  const cardish = (k) => { const cs = getComputedStyle(k); const r = k.getBoundingClientRect(); return visible(k) && (parseFloat(cs.borderTopWidth) >= 1 || cs.backgroundColor !== 'rgba(0, 0, 0, 0)') && r.width >= 100 && r.height >= 50 && /rounded|card/.test(k.className?.toString() ?? '') }
  for (const parent of document.body.querySelectorAll('div, ul, ol, section')) {
    if (rowsUneven.length >= 8 && padDrift.length >= 6 && baseDrift.length >= 6) break
    const kids = [...parent.children].filter(cardish)
    if (kids.length < 2) continue
    const rs = kids.map((k) => k.getBoundingClientRect())
    const rows = new Map()
    rs.forEach((r, i) => { const key = Math.round(r.top / 6); if (!rows.has(key)) rows.set(key, []); rows.get(key).push(i) })
    for (const idx of rows.values()) {
      if (idx.length < 2) continue
      const hs = idx.map((i) => rs[i].height)
      const mx = Math.max(...hs), mn = Math.min(...hs)
      if (mx - mn > 14 && rowsUneven.length < 8) rowsUneven.push({ sel: sel(parent), n: idx.length, min: Math.round(mn), max: Math.round(mx), titles: idx.map((i) => (kids[i].innerText || '').trim().split('\n')[0].slice(0, 18)) })
      const pads = idx.map((i) => { const cs = getComputedStyle(kids[i]); return `${cs.paddingTop}/${cs.paddingRight}/${cs.paddingBottom}/${cs.paddingLeft}` })
      if (new Set(pads).size > 1 && padDrift.length < 6) padDrift.push({ sel: sel(parent), pads: [...new Set(pads)] })
      const tops = idx.map((i) => { const leaves = [...kids[i].querySelectorAll('*')].filter((c) => visible(c) && c.children.length === 0 && (c.textContent || '').trim()); if (leaves.length < 2) return null; const a = leaves[0].getBoundingClientRect(); return { a: a.bottom - rs[i].top, n: leaves.length } })
      if (tops.every(Boolean) && new Set(tops.map((x) => x.n)).size === 1) {
        const da = Math.max(...tops.map((x) => x.a)) - Math.min(...tops.map((x) => x.a))
        if (da > 3 && baseDrift.length < 6) baseDrift.push({ sel: sel(parent), n: idx.length, drift: Math.round(da) })
      }
    }
  }
  out.rowsUneven = rowsUneven; out.padDrift = padDrift; out.baseDrift = baseDrift

  // 4. orphans: last line of a heading holds one word
  const orphans = []
  for (const h of document.body.querySelectorAll('h1, h2, h3, h4')) {
    if (!visible(h)) continue
    if (orphans.length >= 8) break
    const words = []
    const walker = document.createTreeWalker(h, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const re = /\S+/g; let m
      while ((m = re.exec(n.textContent))) { const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length); const q = rg.getClientRects()[0]; if (q) words.push({ w: m[0], top: Math.round(q.top) }) }
    }
    if (words.length < 3) continue
    const lastTop = words[words.length - 1].top
    const lastLine = words.filter((x) => Math.abs(x.top - lastTop) < 6)
    if (Math.abs(lastTop - words[0].top) > 6 && lastLine.length === 1) orphans.push({ sel: sel(h), t: h.innerText.replace(/\s+/g, ' ').trim().slice(0, 60), last: lastLine[0].w })
  }
  out.orphans = orphans

  // 5. empty or placeholder text
  const ph = []
  const re = /^(TBA|TBD|—|–|-|n\/a|N\/A|null|undefined|0|0\.0+|\$0(\.00)?|0%|0 \w+)$/i
  let zero = 0
  for (const el of document.body.querySelectorAll('td, th, span, p, div, dd, dt, strong, b, li, a')) {
    if (!visible(el) || el.children.length > 0 || inChart(el)) continue
    const t = (el.textContent || '').trim()
    if (!t) continue
    if (/coming soon|lorem|placeholder|to be announced|under construction/i.test(t) && t.length < 140) ph.push({ sel: sel(el), t: t.slice(0, 50), kind: 'wall' })
    else if (re.test(t)) { const z = /^(0|0%|\$0(\.00)?|0 \w+)$/.test(t); if (z) zero++; if (ph.length < 14) ph.push({ sel: sel(el), t, kind: z ? 'zero' : 'empty' }) }
  }
  out.placeholders = ph.slice(0, 14); out.zeroCells = zero

  // 6. images
  const imgs = []
  for (const i of document.images) {
    if (!visible(i) || !i.complete || i.naturalWidth === 0) continue
    const r = i.getBoundingClientRect()
    const src = i.currentSrc || i.src || ''
    const svg = /\.svg(\?|$)|^data:image\/svg/.test(src)
    const lowres = !svg && i.naturalWidth < 2 * r.width - 1 && r.width >= 14
    const noAlt = i.getAttribute('alt') === null && i.getAttribute('role') !== 'presentation' && i.getAttribute('aria-hidden') !== 'true'
    if ((lowres || noAlt) && imgs.length < 10) imgs.push({ src: src.slice(-50), rw: Math.round(r.width), nw: i.naturalWidth, lowres, noAlt, alt: i.getAttribute('alt') })
  }
  out.imgIssues = imgs

  // 7. naming and spelling
  const NAMES = ['DeepCore', 'PeddleSwap', 'PeddleQuest', 'Peddles', 'Cartel Family', 'Gully Labs', 'Gully Pay', 'Gully AI', 'Gully Score', 'Holder Map', 'Chain Kit', 'Robinhood Chain', 'BNB Chain', 'Mini App', 'GitHub', 'USDC', 'Sourcify', 'DefiLlama', 'DexScreener', 'GeckoTerminal', 'Blockscout', 'Chainlink', 'Uniswap']
  const nameVars = {}, us = {}
  const USRE = /\b(colou?r(?:s|ed|ing)?|favou?rite\w*|behaviou?r\w*|(?:organi|authori|analy|optimi|customi|summari|recogni|prioriti|minimi|maximi|synchroni|normali|utili|finali|initiali|visuali|monetis|categori|personali|standardi|realis|capitali|specialis)[sz]\w*|cancell?ed|cancell?ing|centers?|centered|defen[cs]e|gr[ae]y|catalog(?:ue)?s?|licen[cs]e|dialog(?:ue)?s?|fulfil{1,2}\w*|enrol{1,2}ment|travell?er|labell?ed|modell?ing|neighbou?r\w*|honou?r\w*|programme)\b/gi
  const US_FLAG = /^(color\w*|favorite\w*|behavior\w*|\w*(?:organiz|authoriz|analyz|optimiz|customiz|summariz|recogniz|prioritiz|minimiz|maximiz|synchroniz|normaliz|utiliz|finaliz|initializ|visualiz|monetiz|categoriz|personaliz|standardiz|realiz|capitaliz|specializ)\w*|canceled|canceling|centers?|centered|defense|gray|catalog\w*|dialog\w*|fulfill\w*|enrollment|traveler|labeled|modeling|neighbor\w*|honor\w*)$/i
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const p = n.parentElement
    if (!p || p.closest('code, pre, script, style, kbd, [data-chart], svg, textarea, input')) continue
    const cs = getComputedStyle(p)
    if (cs.display === 'none' || cs.visibility === 'hidden') continue
    const txt = n.textContent
    if (!txt.trim()) continue
    if (cs.textTransform === 'none') {
      for (const nm of NAMES) {
        const rx = new RegExp('(?<![\\w/@.-])' + nm.replace(/ /g, '\\s*') + '(?![\\w-]|\\.(?:fun|xyz|com|io)|/)', 'gi')
        let m
        while ((m = rx.exec(txt))) { const f = m[0].replace(/\s+/g, ' '); if (f !== nm) nameVars[nm + ' -> ' + f] = (nameVars[nm + ' -> ' + f] ?? 0) + 1 }
      }
    }
    let m; USRE.lastIndex = 0
    while ((m = USRE.exec(txt))) { const w = m[0].toLowerCase(); if (US_FLAG.test(w)) us[w] = (us[w] ?? 0) + 1 }
  }
  out.nameVars = nameVars; out.usSpelling = us

  // 8. contrast of text against its actual background
  const cv = document.createElement('canvas'); cv.width = cv.height = 1
  const cx = cv.getContext('2d', { willReadFrequently: true })
  const cache = new Map()
  const rgba = (c) => { if (cache.has(c)) return cache.get(c); cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; const v = [d[0], d[1], d[2], d[3] / 255]; cache.set(c, v); return v }
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1] }
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  const bgOf = (el) => {
    const stack = []
    let opacity = 1
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e)
      opacity *= parseFloat(cs.opacity)
      if (/url\(/.test(cs.backgroundImage)) return null
      const b = rgba(cs.backgroundColor)
      if (b[3] > 0) stack.push(b)
      if (b[3] >= 1) break
    }
    let base = [255, 255, 255, 1]
    const bodyBg = rgba(getComputedStyle(document.documentElement).backgroundColor)
    if (bodyBg[3] > 0) base = over(bodyBg, [255, 255, 255, 1])
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base)
    return { bg: base, opacity }
  }
  const lowC = new Map()
  let checked = 0
  for (const el of document.body.querySelectorAll('*')) {
    if (checked > 2500) break
    if (el.closest('svg, canvas, [data-chart], script, style')) continue
    const t = own(el)
    if (!t || t.length < 2 || !/[A-Za-z0-9]/.test(t) || !visible(el)) continue
    checked++
    const cs = getComputedStyle(el)
    const b = bgOf(el)
    if (!b) continue
    let fg = rgba(cs.color)
    fg = over([fg[0], fg[1], fg[2], fg[3] * b.opacity], b.bg)
    const l1 = lum(fg), l2 = lum(b.bg)
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700
    const large = px >= 24 || (px >= 18.66 && bold)
    const need = large ? 3 : 4.5
    if (ratio < need) {
      const k = `${cs.color}|${[b.bg[0], b.bg[1], b.bg[2]].map(Math.round)}|${large ? 'L' : 'n'}`
      const cur = lowC.get(k) ?? { ratio: +ratio.toFixed(2), need, n: 0, fg: cs.color, bg: `rgb(${b.bg.slice(0, 3).map(Math.round)})`, sample: sel(el) + ' "' + t.slice(0, 28) + '"', px }
      cur.n++; lowC.set(k, cur)
    }
  }
  out.contrast = [...lowC.values()].sort((a, b) => b.n - a.n).slice(0, 8)
  out.contrastTotal = [...lowC.values()].reduce((a, c) => a + c.n, 0)

  // 9. charts drawn with a single point and not shown as a ghost
  const thin = []
  for (const c of document.querySelectorAll('[data-chart]')) {
    if (!visible(c)) continue
    const paths = [...c.querySelectorAll('svg path')].filter((p) => p.getAttribute('fill') === 'none' && parseFloat(p.getAttribute('stroke-width') || '0') >= 1.5 && (p.getAttribute('d') || '').length > 5)
    const bars = c.querySelectorAll('svg path[fill]:not([fill="none"]), svg rect').length
    const verts = paths.map((p) => ((p.getAttribute('d') || '').match(/[ML]/g) || []).length)
    if (paths.length && verts.every((v) => v < 2) && bars < 3) thin.push({ sel: sel(c), verts })
  }
  out.thinCharts = thin
  return out
}

/** Interaction checks, run from Node: focus rings and hover states on a sample of controls. */
async function interactionChecks(page) {
  const focus = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none' }
    const all = [...document.querySelectorAll('a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select, textarea, summary, [role=tab], [tabindex="0"]')].filter((e) => vis(e) && !e.closest('[aria-hidden=true]'))
    const step = Math.max(1, Math.floor(all.length / 24))
    const sample = all.filter((_, i) => i % step === 0).slice(0, 24)
    const snap = (e) => { const cs = getComputedStyle(e); return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderTopColor, cs.backgroundColor, cs.color, cs.textDecorationLine].join('|') }
    const missing = []
    for (const e of sample) {
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur()
      const before = snap(e)
      try { e.focus({ focusVisible: true, preventScroll: true }) } catch { e.focus({ preventScroll: true }) }
      if (document.activeElement !== e) continue
      const after = snap(e)
      const cs = getComputedStyle(e)
      const ring = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
      if (before === after && !ring) missing.push(e.tagName.toLowerCase() + (e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : '') + ' "' + (e.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').trim().slice(0, 20) + '"')
      e.blur()
    }
    return { tested: sample.length, total: all.length, missing: missing.slice(0, 6), missingN: missing.length }
  }).catch(() => null)
  const tagged = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 20 && r.height > 14 && cs.visibility !== 'hidden' && cs.display !== 'none' }
    const cand = [...document.querySelectorAll('a[href], button:not([disabled]), [role=tab], summary')].filter((e) => vis(e) && !e.closest('[data-chart], [aria-hidden=true]') && !e.closest('[data-testid="ask-fab"]'))
    const seen = new Set(), picks = []
    for (const e of cand) { const k = e.tagName + '|' + e.className; if (seen.has(k)) continue; seen.add(k); picks.push(e); if (picks.length >= 5) break }
    picks.forEach((e, i) => e.setAttribute('data-aud-hover', String(i)))
    return picks.length
  }).catch(() => 0)
  const hoverMissing = []
  for (let i = 0; i < tagged; i++) {
    const loc = page.locator(`[data-aud-hover="${i}"]`).first()
    const read = () => loc.evaluate((e) => { const f = (x) => { const cs = getComputedStyle(x); return [cs.color, cs.backgroundColor, cs.borderTopColor, cs.boxShadow, cs.opacity, cs.transform, cs.textDecorationLine, cs.filter].join('|') }; return { style: [f(e), ...[...e.querySelectorAll('*')].slice(0, 6).map(f)].join('#'), cursor: getComputedStyle(e).cursor, label: (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 20), tag: e.tagName.toLowerCase() + '.' + [...e.classList].slice(0, 2).join('.') } }).catch(() => null)
    try {
      await loc.scrollIntoViewIfNeeded({ timeout: 1000 })
      await page.mouse.move(0, 0)
      await page.waitForTimeout(60)
      const a = await read()
      await loc.hover({ timeout: 1200 })
      await page.waitForTimeout(260)
      const b = await read()
      if (a && b) {
        if (a.style === b.style) hoverMissing.push(`${b.tag} "${b.label}" no hover change (cursor ${b.cursor})`)
        else if (!/pointer/.test(b.cursor) && !/^summary/.test(b.tag)) hoverMissing.push(`${b.tag} "${b.label}" cursor ${b.cursor}`)
      }
    } catch { /* element moved or covered */ }
  }
  await page.mouse.move(0, 0).catch(() => {})
  return { focus, hoverMissing }
}

/** Content the fixed Gully AI button covers at the current scroll position (mobile). */
function fabScan() {
  const fab = document.querySelector('[data-testid="ask-fab"]')
  if (!fab) return []
  const f = fab.getBoundingClientRect()
  if (f.width < 1) return []
  const hits = []
  for (const el of document.body.querySelectorAll('a[href], button, input, select, textarea, h1, h2, h3, h4, p, td, th, li, label, span')) {
    if (el === fab || fab.contains(el) || el.contains(fab)) continue
    if (el.closest('[data-testid="ask-fab"], [aria-label="Back to top"]')) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    let fixed = false
    for (let e = el; e && e !== document.body; e = e.parentElement) if (getComputedStyle(e).position === 'fixed') { fixed = true; break }
    if (fixed) continue
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
    if (!own && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) continue
    const r = el.getBoundingClientRect()
    const w = Math.min(r.right, f.right) - Math.max(r.left, f.left), h = Math.min(r.bottom, f.bottom) - Math.max(r.top, f.top)
    if (w > 4 && h > 4 && r.top >= 0 && r.bottom <= window.innerHeight) hits.push(el.tagName.toLowerCase() + ' "' + (own || el.getAttribute('aria-label') || '').slice(0, 22) + '"')
  }
  return hits.slice(0, 3)
}

/* ---------------------------------------------------------------- run --- */

const results = []
const ctxCache = new Map()
async function ctxFor(width, p) {
  const key = `${p.group === 'app' || p.group === 'app-empty' ? 'T' : ''}${width}|${p.who ?? ''}|${p.admin ? 'a' : ''}|${p.tg ? 't' : ''}|${p.paid ? 'p' : ''}`
  if (ctxCache.has(key)) return ctxCache.get(key)
  const cookie = p.who === 'rich' ? cookieOf(rich) : p.who === 'empty' ? cookieOf(empty) : null
  // The app and admin scroll inside their own frame: a tall viewport shows the whole page in the screenshot (heights are then page content, in px).
  const tall = p.group === 'app' || p.group === 'app-empty'
  const ctx = await newContext({ width, height: tall ? (width < 600 ? 3400 : 2200) : width < 600 ? 844 : 900, cookie, adminToken: !!p.admin })
  if (p.tg) {
    const sdk = telegramSdkStub(signedInitData({ id: 424242, first_name: 'Eve' }), { bg_color: '#17212b', text_color: '#f5f5f5', hint_color: '#708499', button_color: '#5288c1', button_text_color: '#ffffff', secondary_bg_color: '#232e3c', section_bg_color: '#17212b' })
    await ctx.route(/^https:\/\/telegram\.org\//, (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: sdk }))
  }
  if (p.paid && PAID) await ctx.route(`${BASE}/api/pay/${inv.data.invoice.id}`, (route) => json(route, { invoice: PAID }))
  ctxCache.set(key, ctx)
  return ctx
}

for (const p of pages) {
  if (ONLY && !ONLY.test(p.name)) continue
  for (const width of (process.env.AUDIT_WIDTHS ?? '1440,390,320').split(',').map(Number)) {
    const ctx = await ctxFor(width, p)
    const page = await ctx.newPage()
    const errs = []
    page.on('console', (m) => m.type() === 'error' && !/ERR_BLOCKED_BY_CLIENT|Failed to load resource/.test(m.text()) && errs.push(m.text().slice(0, 140)))
    page.on('pageerror', (e) => errs.push('pageerror: ' + String(e?.message ?? e).slice(0, 140)))
    const r = { name: p.name, url: p.url, width, group: p.group }
    try {
      const res = await page.goto(BASE + p.url, { timeout: 30_000 })
      r.status = res?.status()
      if (p.ready) await page.locator(p.ready).waitFor({ timeout: 15_000 }).catch(() => (r.notReady = true))
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {})
      await page.waitForTimeout(1500)
      const total = await page.evaluate(() => document.documentElement.scrollHeight)
      const fabHits = new Set()
      const stepY = width < 600 && p.group !== 'app' && p.group !== 'app-empty' ? 420 : 700
      for (let y = 0; y < Math.min(total, 14000); y += stepY) {
        await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(120)
        if (width < 600) for (const h of await page.evaluate(fabScan)) fabHits.add(h)
      }
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(FAST ? 300 : 900)
      Object.assign(r, await page.evaluate(measure))
      r.detail = await page.evaluate(details).catch((e) => ({ error: String(e.message).slice(0, 120) }))
      r.audit = await page.evaluate(auditPage, { allowed: TOKENS, root: null }).then((a) => ({ small: a.small.length, smallSample: a.small.slice(0, 2).map((s) => `${s.size}px ${s.sel} "${s.text}"`), offTokenN: a.offToken.length, offToken: a.offToken.slice(0, 4).map((o) => `${o.color} ${o.kind} x${o.count} ${o.sample}`), ext: a.ext.length, extSample: a.ext.slice(0, 2).map((e) => e.href) }))
      if (!FAST) {
        await page.evaluate(() => { const c = document.querySelector('[data-chart]') || document.querySelector('svg'); c?.scrollIntoView({ block: 'center' }) })
        await page.waitForTimeout(400)
        const s1 = await page.evaluate(chartSignature)
        await page.waitForTimeout(3000)
        const s2 = await page.evaluate(chartSignature)
        r.live = { charts: s1.sigs.length, changed: s1.sigs.filter((v, i) => s2.sigs[i] !== v).length, anims: s2.anims, smil: s2.smil, textChanged: s1.text !== s2.text }
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.waitForTimeout(300)
        await page.screenshot({ path: path.join(SHOTS, `${p.name}-${width}.png`), fullPage: true, timeout: 30_000 }).catch((e) => (r.shotError = String(e.message).slice(0, 80)))
      }
      r.fabHits = [...fabHits].slice(0, 6)
      if (width === 1440 && !FAST) Object.assign(r, await interactionChecks(page))
    } catch (e) {
      r.error = String(e?.message ?? e).slice(0, 200)
    }
    r.consoleErrors = errs.slice(0, 3)
    results.push(r)
    console.log(`${p.name} @${width}: ${r.error ? 'ERROR ' + r.error : `h=${r.viewports}vp charts=${JSON.stringify(r.charts)} live=${r.live?.changed}/${r.live?.charts} anim=${r.live?.anims} noise=${r.noise?.length} tap=${r.tapSmall ?? '-'}`}`)
    await page.close()
  }
}
fs.writeFileSync(path.join(OUT, FAST ? 'results-fast.json' : 'results.json'), JSON.stringify({ at: new Date().toISOString(), note, results }, null, 1))
await browser.close()
console.log(`done: ${results.length} page-views; notes: ${note.join(' | ') || 'none'}`)
process.exit(0)
