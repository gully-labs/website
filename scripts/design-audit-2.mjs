// Design audit 2 (read-only): boots the e2e harness server, visits every site route, docs page, app page, admin,
// the Mini App, pay/checkout states and the embed at 1440 and 390 px, saves a full-page screenshot of each and
// measures charts (animated? live?), compactness, developer noise, logos, tap targets, overlaps and the pixel audit.
//
//   TEST_PORT=9211 AUDIT_OUT=<dir> node scripts/design-audit-2.mjs      (needs dist/: npm run build)
//
// Output: <AUDIT_OUT>/shots/<page>-<width>.png and <AUDIT_OUT>/results.json. It changes no product code.

import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { bootServer, E2E_ANY_TOKEN, E2E_LAUNCH_TOKEN, historyFixture, holdersExtraFixtures, holdersFixture, ROOT, seedTrackerHistory, signedInitData, statsFixture, telegramSdkStub, trackerFixture } from './e2e-harness.mjs'
import { guardTestRun, makeClient } from './test-helpers.mjs'
import { auditPage, tokenColors } from './e2e-audit.mjs'

const PORT = Number(process.env.TEST_PORT) || 9211
const OUT = process.env.AUDIT_OUT || path.resolve(ROOT, '..', 'gully-session-tools', 'design-audit-2')
const SHOTS = path.join(OUT, 'shots')
const ONLY = process.env.AUDIT_ONLY ? new RegExp(process.env.AUDIT_ONLY) : null
fs.mkdirSync(SHOTS, { recursive: true })
await guardTestRun(PORT, { watchdogMs: 40 * 60_000 })
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
for (const [n, u] of [['home', '/'], ['tracker', '/tracker'], ['stock-nvda', '/tracker/robinhood/NVDA'], ['stock-solana-tsla', '/tracker/solana/TSLA'], ['holders-landing', '/holders'], ['holders-launch', `/holders/robinhood/${E2E_LAUNCH_TOKEN}`], ['holders-stock', '/holders/robinhood/NVDA'], ['score-index', '/score'], ['score-page', `/score/base/${SC_ADDR}`], ['score-unscored', `/score/base/0x${'cd'.repeat(20)}`], ['security', '/security'], ['security-reports', '/security/reports'], ['ecosystem', '/ecosystem'], ['partners', '/partners'], ['chains', '/chains'], ['chain-kit', '/chain-kit'], ['pricing', '/pricing'], ['services', '/services'], ['about', '/about'], ['project-deepcore', '/projects/deepcore'], ['project-peddleswap', '/projects/peddleswap'], ['project-peddles', '/projects/peddles'], ['project-peddlequest', '/projects/peddlequest'], ['project-cartel', '/projects/cartel-family'], ['analytics', '/analytics'], ['widget', '/widget'], ['links', '/links'], ['status', '/status'], ['ask', '/ask'], ['legal-merchant-terms', '/legal/merchant-terms'], ['legal-privacy', '/legal/privacy'], ['not-found', '/this-page-does-not-exist']]) add('site-' + n, u, { group: 'site' })
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
  for (const width of [1440, 390]) {
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
      for (let y = 0; y < Math.min(total, 14000); y += 700) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(120) }
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(900)
      Object.assign(r, await page.evaluate(measure))
      r.audit = await page.evaluate(auditPage, { allowed: TOKENS, root: null }).then((a) => ({ small: a.small.length, smallSample: a.small.slice(0, 2).map((s) => `${s.size}px ${s.sel} "${s.text}"`), offTokenN: a.offToken.length, offToken: a.offToken.slice(0, 4).map((o) => `${o.color} ${o.kind} x${o.count} ${o.sample}`), ext: a.ext.length, extSample: a.ext.slice(0, 2).map((e) => e.href) }))
      await page.evaluate(() => { const c = document.querySelector('[data-chart]') || document.querySelector('svg'); c?.scrollIntoView({ block: 'center' }) })
      await page.waitForTimeout(400)
      const s1 = await page.evaluate(chartSignature)
      await page.waitForTimeout(3000)
      const s2 = await page.evaluate(chartSignature)
      r.live = { charts: s1.sigs.length, changed: s1.sigs.filter((v, i) => s2.sigs[i] !== v).length, anims: s2.anims, smil: s2.smil, textChanged: s1.text !== s2.text }
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(300)
      await page.screenshot({ path: path.join(SHOTS, `${p.name}-${width}.png`), fullPage: true, timeout: 30_000 }).catch((e) => (r.shotError = String(e.message).slice(0, 80)))
    } catch (e) {
      r.error = String(e?.message ?? e).slice(0, 200)
    }
    r.consoleErrors = errs.slice(0, 3)
    results.push(r)
    console.log(`${p.name} @${width}: ${r.error ? 'ERROR ' + r.error : `h=${r.viewports}vp charts=${JSON.stringify(r.charts)} live=${r.live?.changed}/${r.live?.charts} anim=${r.live?.anims} noise=${r.noise?.length} tap=${r.tapSmall ?? '-'}`}`)
    await page.close()
  }
}
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), note, results }, null, 1))
await browser.close()
console.log(`done: ${results.length} page-views; notes: ${note.join(' | ') || 'none'}`)
process.exit(0)
