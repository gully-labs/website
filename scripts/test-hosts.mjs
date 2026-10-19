// Host routing for the service hosts (pay., api., embed.; status. is a separate service and not routed here).
//
//   npm run test:hosts        (no build needed)
//
// The real server runs IN THIS PROCESS on TEST_PORT (default 8799) with a temporary DATA_DIR and a stub
// dist/; every request names its host in the Host header, as Cloudflare does. Checks the routing table in
// server/hosts.mjs: pay. serves only pay pages and their APIs (strict CSP, no analytics, noindex, canonical
// on pay.), everything else on pay./embed. is a 301 to the main site; the old /pay links 301 to pay.;
// /api stays served on the main host with a canonical Link header and also answers on api.; embed. sets no
// cookies and opens CORS; links the server writes use pay.

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { guardTestRun, hostRequest, makeChecker } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8799
const BASE = `http://localhost:${PORT}`
await guardTestRun(PORT)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-hosts-'))
const dist = path.join(tmp, 'dist')
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
fs.writeFileSync(
  path.join(dist, 'index.html'),
  '<!doctype html><html><head><title>Gully Labs</title><meta name="description" content="x" />\n    <script defer src="https://analytics.gullylabs.xyz/script.js" data-website-id="x"></script>\n<link rel="canonical" href="https://gullylabs.xyz/" /></head><body><div id="root"></div></body></html>',
)
fs.writeFileSync(path.join(dist, 'assets', 'index-abcdef12.js'), 'console.log(1)')
fs.writeFileSync(path.join(dist, 'widget.js'), '/* widget */')

Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: dist,
  ADMIN_TOKEN: crypto.randomBytes(24).toString('hex'),
  TRACKER_LOOP: 'off',
  TRACKER_SKIP_APIS: '1',
  DEEPCORE_LOOP: 'off',
  ASK_REMOTE: 'off',
})
delete process.env.TELEGRAM_BOT_TOKEN
delete process.env.GULLY_TREASURY_ADDRESS
delete process.env.ANTHROPIC_API_KEY
delete process.env.GULLY_PAY_URL

await import('../server/server.mjs')
const { hostPolicy, payUrl, PAY_URL, API_URL, EMBED_URL, STATUS_URL, isPayHost } = await import('../server/hosts.mjs')
await new Promise((r) => setTimeout(r, 300))

const t = makeChecker()
const { check } = t
const MAIN = 'gullylabs.xyz'
const PAY = 'pay.gullylabs.xyz'
const API = 'api.gullylabs.xyz'
const EMBED = 'embed.gullylabs.xyz'
const get = (host, p, opts) => hostRequest(BASE, host, p, opts)
const INV = `/pay/inv_${'a'.repeat(22)}`
const LINK = `/pay/l/pl_${'b'.repeat(16)}`
const MINV = `/pay/m/mi_${'c'.repeat(22)}`

try {
  /* ------------------------------------------------------ the policy table --- */
  {
    const p = (h, x) => hostPolicy(h, x)
    check('policy: pay. allows /pay pages', p(PAY, INV) === 'allow' && p(PAY, LINK) === 'allow' && p(PAY, MINV + '/receipt') === 'allow')
    check('policy: pay. allows the APIs the pay pages call', ['/api/pay/inv_x', '/api/pay/m/i/x/quote', '/api/pay/gas', '/api/solana/rpc', '/api/solana/pay/find', '/api/logo/base/0x1.png', '/api/geo'].every((x) => p(PAY, x) === 'allow'))
    check('policy: pay. allows assets and static files', p(PAY, '/assets/index-abcdef12.js') === 'allow' && p(PAY, '/pay-button.js') === 'allow' && p(PAY, '/tokens/usdc.png') === 'allow')
    check('policy: pay. sends other pages to the main site', ['/', '/tracker', '/pricing', '/legal/privacy', '/holders/base/0x1', '/embed/holders/base/0x1'].every((x) => p(PAY, x) === 'redirect'))
    check('policy: pay. refuses other APIs', ['/api/tracker', '/api/holders/base/0x1', '/api/developer/account', '/api/admin/x', '/api/stats'].every((x) => p(PAY, x) === 'deny'))
    check('policy: api. allows /api/* and /healthz, refuses the rest', p(API, '/api/tracker') === 'allow' && p(API, '/api/pay/gas') === 'allow' && p(API, '/healthz') === 'allow' && p(API, '/') === 'deny' && p(API, '/tracker') === 'deny' && p(API, INV) === 'deny')
    check('policy: api. keeps the session-only dashboard, admin and Telegram routes off', ['/api/developer/account', '/api/admin/x', '/api/tg/me', '/api/telegram/x'].every((x) => p(API, x) === 'deny'))
    check('policy: embed. allows embed pages, widget.js, badges and the APIs they read', ['/embed/holders/base/0x1', '/widget.js', '/badges/example/score.svg', '/score/base/0x1/badge.svg', '/api/holders/base/0x1/badge.svg', '/api/tracker', '/api/logo/base/0x1.png', '/api/score/base/0x1'].every((x) => p(EMBED, x) === 'allow'))
    check('policy: embed. sends other pages to the main site and refuses other APIs', p(EMBED, '/pricing') === 'redirect' && p(EMBED, INV) === 'redirect' && p(EMBED, '/api/pay/inv_x') === 'deny' && p(EMBED, '/api/developer/account') === 'deny')
    check('policy: the main host and localhost allow everything', p(MAIN, INV) === 'allow' && p(MAIN, '/api/tracker') === 'allow' && p('localhost', INV) === 'allow')
    check('constants: hosts and URLs', PAY_URL === `https://${PAY}` && API_URL === `https://${API}` && EMBED_URL === `https://${EMBED}` && STATUS_URL === 'https://status.gullylabs.xyz' && isPayHost(PAY) && !isPayHost(MAIN))
  }

  /* ------------------------------------------------------------- pay. --- */
  {
    const page = await get(PAY, INV)
    check('pay. invoice page: 200 with the app shell', page.status === 200 && page.text.includes('<div id="root">'), String(page.status))
    check('pay. page: canonical is the pay host, noindex stays', page.text.includes(`<link rel="canonical" href="${PAY_URL}${INV}" />`) && /<meta name="robots" content="noindex"/.test(page.text), page.text.slice(0, 200))
    check('pay. page: no analytics beacon in the HTML', !page.text.includes('analytics.gullylabs.xyz'))
    const csp = page.headers['content-security-policy'] ?? ''
    check("pay. CSP: script-src 'self' only (no analytics, no Cloudflare insights)", /script-src 'self'(;|$)/.test(csp) && !/cloudflareinsights|analytics\.gullylabs/.test(csp), csp)
    check("pay. CSP: frame-ancestors 'none', object-src 'none', X-Frame-Options DENY", /frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp) && page.headers['x-frame-options'] === 'DENY')
    check('pay. CSP: still reaches RPCs and relays (connect-src https: wss:) and frames only WalletConnect', /connect-src 'self' https: wss:/.test(csp) && /frame-src https:\/\/verify\.walletconnect\.org/.test(csp) && !/frame-src https:;/.test(csp))
    check('pay. page: no-referrer, X-Robots-Tag noindex, HSTS, no cookie set', page.headers['referrer-policy'] === 'no-referrer' && /noindex/.test(page.headers['x-robots-tag'] ?? '') && /max-age=31536000/.test(page.headers['strict-transport-security'] ?? '') && !page.headers['set-cookie'])
    for (const [name, p] of [['pay link', LINK], ['merchant invoice', MINV], ['receipt', INV + '/receipt']]) {
      const r = await get(PAY, p)
      check(`pay. ${name}: 200, canonical on pay.`, r.status === 200 && r.text.includes(`href="${PAY_URL}${p}"`), String(r.status))
    }
    const asset = await get(PAY, '/assets/index-abcdef12.js')
    check('pay. serves the hashed assets', asset.status === 200 && /javascript/.test(asset.headers['content-type'] ?? ''))
    const unknown = await get(PAY, '/api/pay/inv_' + 'z'.repeat(22))
    check('pay. API for the pay pages is served (JSON 404 for an unknown invoice, not a redirect)', unknown.status === 404 && /json/.test(unknown.headers['content-type'] ?? ''), `${unknown.status}`)
    for (const p of ['/', '/tracker?x=1', '/pricing', '/legal/privacy', '/holders/base/0x1']) {
      const r = await get(PAY, p)
      check(`pay. ${p}: 301 to the main site, path and query kept`, r.status === 301 && r.headers.location === `https://${MAIN}${p}`, `${r.status} ${r.headers.location}`)
    }
    const tr = await get(PAY, '/api/tracker')
    check('pay. /api/tracker: not served here (404 JSON)', tr.status === 404)
    const robots = await get(PAY, '/robots.txt')
    check('pay. robots.txt disallows everything, no sitemap', robots.status === 200 && /Disallow: \/\n/.test(robots.text) && !/Sitemap/.test(robots.text) && (await get(PAY, '/sitemap.xml')).status === 404)
  }

  /* ------------------------------------------- the old addresses, main host --- */
  {
    for (const p of [INV, LINK, MINV, INV + '/receipt', INV + '?asset=base-usdc']) {
      const r = await get(MAIN, p)
      check(`main GET ${p.slice(0, 40)}: 301 to pay.`, r.status === 301 && r.headers.location === `${PAY_URL}${p}`, `${r.status} ${r.headers.location}`)
    }
    const head = await get(MAIN, INV, { method: 'HEAD' })
    check('main HEAD /pay/..: 301 as well', head.status === 301)
    const post = await get(MAIN, INV, { method: 'POST', body: {} })
    check('main POST /pay/..: not redirected', post.status !== 301, String(post.status))
    check('app. /pay links also reach pay.', (await get('app.gullylabs.xyz', INV)).headers.location === `${PAY_URL}${INV}`)
    const local = await get(`localhost:${PORT}`, INV)
    check('localhost keeps /pay by path (development)', local.status === 200 && !local.headers.location, String(local.status))
    const main = await get(MAIN, '/')
    check('main /: still the site, with the analytics beacon and its own CSP', main.status === 200 && main.text.includes('analytics.gullylabs.xyz') && /static\.cloudflareinsights\.com/.test(main.headers['content-security-policy'] ?? ''))
  }

  /* ----------------------------------------------------------------- api. --- */
  {
    const plans = await get(API, '/api/plans')
    check('api. /api/plans: 200 JSON, open CORS, no Link header', plans.status === 200 && plans.headers['access-control-allow-origin'] === '*' && !plans.headers.link, String(plans.status))
    const mainPlans = await get(MAIN, '/api/plans')
    check('main /api/plans: still served (200, no redirect), with a canonical Link to api.', mainPlans.status === 200 && !mainPlans.headers.location && mainPlans.headers.link === `<${API_URL}/api/plans>; rel="canonical"`, mainPlans.headers.link)
    const mainPost = await get(MAIN, '/api/contact', { method: 'POST', body: { nope: 1 } })
    check('main POST /api/contact: answered here, never redirected', mainPost.status === 400 && !mainPost.headers.location, String(mainPost.status))
    const apiPost = await get(API, '/api/contact', { method: 'POST', body: { nope: 1 } })
    check('api. POST /api/contact: same answer', apiPost.status === 400, String(apiPost.status))
    check('api. OPTIONS /api/tracker: the current CORS preflight', (await get(API, '/api/tracker', { method: 'OPTIONS' })).headers['access-control-allow-methods'] === 'GET, OPTIONS')
    check('api. /healthz answers', (await get(API, '/healthz')).text === 'ok')
    for (const p of ['/', '/tracker', INV, '/widget.js']) check(`api. ${p.slice(0, 30)}: JSON 404, no redirect`, (await get(API, p)).status === 404)
    check('api. refuses the session-only dashboard API', (await get(API, '/api/developer/account')).status === 404 && (await get(API, '/api/admin/x')).status === 404)
    check('api. unknown /api path: JSON 404', (await get(API, '/api/nope')).status === 404)
    check('api. robots.txt disallows everything', /Disallow: \/\n/.test((await get(API, '/robots.txt')).text))
  }

  /* --------------------------------------------------------------- embed. --- */
  {
    const w = await get(EMBED, '/widget.js')
    check('embed. widget.js: 200 JS, no Set-Cookie, open CORS', w.status === 200 && /javascript/.test(w.headers['content-type'] ?? '') && !w.headers['set-cookie'] && w.headers['access-control-allow-origin'] === '*', String(w.status))
    check('main widget.js still works (old snippets)', (await get(MAIN, '/widget.js')).status === 200)
    const e = await get(EMBED, '/embed/holders/base/0x' + '1'.repeat(40))
    const csp = e.headers['content-security-policy'] ?? ''
    check('embed. iframe page: 200, frame-ancestors *, no X-Frame-Options, no Set-Cookie', e.status === 200 && /frame-ancestors \*/.test(csp) && !e.headers['x-frame-options'] && !e.headers['set-cookie'], `${e.status} ${csp}`)
    check("embed. iframe page: script-src 'self' only, no analytics beacon, noindex", /script-src 'self'(;|$)/.test(csp) && !e.text.includes('analytics.gullylabs.xyz') && /noindex/.test(e.text))
    const old = await get(MAIN, '/embed/holders/base/0x' + '1'.repeat(40))
    check('main embed page still frames from anywhere', old.status === 200 && /frame-ancestors \*/.test(old.headers['content-security-policy'] ?? ''))
    const pre = await get(EMBED, '/widget.js', { method: 'OPTIONS' })
    check('embed. OPTIONS: 204 with CORS for GET', pre.status === 204 && pre.headers['access-control-allow-origin'] === '*' && /GET/.test(pre.headers['access-control-allow-methods'] ?? ''))
    const tr = await get(EMBED, '/api/tracker')
    check('embed. serves the tracker read the widget makes, with no cookie', tr.status !== 301 && !tr.headers['set-cookie'] && tr.headers['access-control-allow-origin'] === '*', String(tr.status))
    check('embed. /pricing: 301 to the main site', (await get(EMBED, '/pricing')).headers.location === `https://${MAIN}/pricing`)
    check('embed. /pay/..: 301 to the main site (which sends it on to pay.)', (await get(EMBED, INV)).headers.location === `https://${MAIN}${INV}`)
    check('embed. /api/pay: not served', (await get(EMBED, '/api/pay/gas')).status === 404)
  }

  /* ------------------------------------------------------ generated links --- */
  {
    check('payUrl(): pay. host by default', payUrl(INV) === `${PAY_URL}${INV}`)
    process.env.GULLY_PAY_URL = 'https://pay.example.test/'
    check('payUrl(): GULLY_PAY_URL overrides (trailing slash dropped)', payUrl(INV) === `https://pay.example.test${INV}`)
    delete process.env.GULLY_PAY_URL
  }
} finally {
  console.log(`\n${t.passed} passed, ${t.failed} failed`)
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(t.failed ? 1 : 0)
}
