import http from 'node:http'
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
import { fileURLToPath } from 'node:url'
import { guardTestRun, hostRequest, makeChecker } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8799
const BASE = `http://localhost:${PORT}`
await guardTestRun(PORT)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-hosts-'))
const dist = path.join(tmp, 'dist')
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
fs.writeFileSync(
  path.join(dist, 'index.html'),
  '<!doctype html><html><head><meta name="theme-color" content="#06050D" />\n<!-- Icons: the Gully Labs brand kit (public/brand/icon), unchanged. -->\n<link rel="icon" type="image/png" sizes="16x16" href="/brand/icon/favicon-16.png" />\n<link rel="icon" type="image/png" sizes="32x32" href="/brand/icon/favicon-32.png" />\n<link rel="apple-touch-icon" sizes="180x180" href="/brand/icon/app-icon-180.png" />\n<title>Gully Labs</title><meta name="description" content="x" />\n<meta property="og:site_name" content="Gully Labs" />\n<meta property="og:image" content="https://gullylabs.xyz/brand/social/og-image-1200x630.png" />\n<meta property="og:image:alt" content="Gully Labs logo with mascot" />\n    <script defer src="https://analytics.gullylabs.xyz/script.js" data-website-id="x"></script>\n<link rel="canonical" href="https://gullylabs.xyz/" /></head><body><div id="root"></div></body></html>',
)
fs.writeFileSync(path.join(dist, 'assets', 'index-abcdef12.js'), 'console.log(1)')
fs.writeFileSync(path.join(dist, 'widget.js'), '/* widget */')
// Root icons: the site's, and HolderMaps' own (holdermaps.xyz answers /favicon.ico with its own file).
fs.writeFileSync(path.join(dist, 'favicon.ico'), 'GULLY-ICO')
fs.mkdirSync(path.join(dist, 'brand', 'holdermaps'), { recursive: true })
fs.writeFileSync(path.join(dist, 'brand', 'holdermaps', 'favicon.ico'), 'HOLDERMAPS-ICO')
fs.writeFileSync(path.join(dist, 'brand', 'holdermaps', 'icon-180.png'), 'HOLDERMAPS-180')
// Two published scan reports for gullysecurity.xyz: one its owner let search engines index, one private (noindex).
const SEC_PUB = 'sec_' + 'p'.repeat(16)
const SEC_PRIV = 'sec_' + 'q'.repeat(16)
const SEC_ADDR = '0x' + '5'.repeat(40)
const secJob = (id, indexable, publishedAt) => ({ id, workspace: 'ws_test', createdAt: publishedAt, input: { kind: 'address', chain: 'base', address: SEC_ADDR }, upload: null, free: true, priceCents: '0', invoiceId: null, state: 'started', status: 'done', completedAt: publishedAt, counts: { critical: 0, high: 1, medium: 0, low: 0, info: 2 }, published: true, publishedAt, indexable, snapshot: { mode: 'ai', label: 'AI review only', summary: { counts: { critical: 0, high: 1, medium: 0, low: 0, info: 2 } } } })
fs.writeFileSync(path.join(tmp, 'security.json'), JSON.stringify({ jobs: [secJob(SEC_PUB, true, '2026-10-20T00:00:00.000Z'), secJob(SEC_PRIV, false, '2026-10-19T00:00:00.000Z')], reviews: [], credits: {} }))

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
  IPFS_API: 'http://127.0.0.1:9',
  IPFS_GATEWAY: 'http://127.0.0.1:9',
  GULLYPAY_STATUS_URL: 'http://127.0.0.1:9',
  GULLYRPC_STATUS_URL: 'http://127.0.0.1:9',
})
delete process.env.TELEGRAM_BOT_TOKEN
delete process.env.GULLY_TREASURY_ADDRESS
delete process.env.ANTHROPIC_API_KEY
delete process.env.GULLY_PAY_URL
delete process.env.HOLDERMAPS_PRIMARY
delete process.env.SECURITY_PRIMARY

await import('../server/server.mjs')
const { hostPolicy, payUrl, PAY_URL, API_URL, EMBED_URL, STATUS_URL, isPayHost, holderMapsRoute, holderShortPath, holderInternalPath, holderPageUrl, holderHomeUrl, isHolderMapsHost, HOLDERMAPS_URL, securityRoute, securityShortPath, securityInternalPath, securityUrl, securityReportUrl, currentPageUrl, isSecurityHost, SECURITY_URL } = await import('../server/hosts.mjs')
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
    check('pay. page: Cache-Control no-transform, so Cloudflare injects no beacon the CSP would refuse (D4-11)', /no-transform/.test(page.headers['cache-control'] ?? ''), page.headers['cache-control'])
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
    check('embed. iframe page: Cache-Control no-transform (no Cloudflare beacon injected)', /no-transform/.test(e.headers['cache-control'] ?? ''), e.headers['cache-control'])
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

  /* ------------------------------------------------------- holdermaps.xyz --- */
  {
    const HM = 'holdermaps.xyz'
    const TOKEN = '0x' + '1'.repeat(40)
    const DEEP = 'hd_' + 'd'.repeat(16)
    const r = (p, h = HM) => holderMapsRoute(h, p.split('?')[0], p.includes('?') ? p.slice(p.indexOf('?')) : '')
    // The routing table.
    check('holdermaps: the hosts it answers', isHolderMapsHost(HM) && isHolderMapsHost('www.holdermaps.xyz') && isHolderMapsHost('holdermaps.xyz:443') && !isHolderMapsHost(MAIN) && !isHolderMapsHost('holdermaps.xyz.evil.test') && HOLDERMAPS_URL === 'https://holdermaps.xyz')
    check('holdermaps: short paths <-> the main site paths', holderShortPath('/holders') === '/' && holderShortPath('/holders/') === '/' && holderShortPath(`/holders/base/${TOKEN}`) === `/base/${TOKEN}` && holderShortPath(`/holders/deep/${DEEP}`) === `/deep/${DEEP}` && holderShortPath('/holders/nope/x') === null && holderShortPath('/pricing') === null && holderInternalPath('/') === '/holders' && holderInternalPath(`/solana/${'7'.repeat(43)}`) === `/holders/solana/${'7'.repeat(43)}` && holderInternalPath(`/deep/${DEEP}`) === `/holders/deep/${DEEP}` && holderInternalPath('/legal/terms') === null && holderInternalPath('/pricing') === null)
    check('holdermaps policy: its pages, its API and static files are served', ['/', `/base/${TOKEN}`, '/robinhood/TSLA', `/deep/${DEEP}`, '/api/holders/base/x', '/api/holders/deep', '/api/plans', '/api/logo/base/0x1.png', '/api/pay/inv_x', '/assets/index-abcdef12.js', '/brand/gully-mark-512.png', '/robots.txt', '/sitemap.xml', '/manifest.webmanifest', '/healthz'].every((p) => r(p).kind === 'allow'))
    check('holdermaps policy: the session-only dashboard, admin and Telegram APIs are refused', ['/api/admin/x', '/api/developer/account', '/api/tg/me', '/api/telegram/x'].every((p) => r(p).kind === 'deny'))
    const rl = r(`/holders/base/${TOKEN}?x=1`)
    check('holdermaps policy: /holders/... is a 301 to the short path, query kept', rl.kind === 'redirect' && rl.location === `/base/${TOKEN}?x=1` && r('/holders').location === '/' && r(`/holders/deep/${DEEP}`).location === `/deep/${DEEP}`, JSON.stringify(rl))
    check('holdermaps policy: any other page (and an unknown chain) goes to the same path on gullylabs.xyz', r('/pricing?a=1').location === `https://${MAIN}/pricing?a=1` && r('/legal/terms').location === `https://${MAIN}/legal/terms` && r('/tracker/robinhood/TSLA').location === `https://${MAIN}/tracker/robinhood/TSLA` && r('/embed/holders/base/x').location === `https://${MAIN}/embed/holders/base/x`)
    check('holdermaps policy: www. is a 301 to the apex, path and query kept', r(`/base/${TOKEN}?q=1`, 'www.holdermaps.xyz').location === `https://holdermaps.xyz/base/${TOKEN}?q=1`)
    check('holdermaps: the main host policy is unchanged (holdermaps. is not a service host)', hostPolicy(HM, '/') === 'allow' && hostPolicy(MAIN, '/holders') === 'allow')

    // Over HTTP, as Cloudflare sends it.
    const home = await get(HM, '/')
    check('holdermaps /: 200, the app shell, titled HolderMaps, canonical holdermaps.xyz/', home.status === 200 && home.text.includes('<div id="root">') && /<title>[^<]*HolderMaps[^<]*<\/title>/.test(home.text) && home.text.includes('<link rel="canonical" href="https://holdermaps.xyz/" />') && home.text.includes('<meta property="og:title" content="Who really holds a token? Holder bubble maps · HolderMaps" />'), home.text.slice(0, 400))
    // Branding (its brand kit, server/product-brand.mjs): HolderMaps' own colour, icons, site name, share image and JSON-LD.
    check('holdermaps /: theme-color is the HolderMaps kit ink, not lab-night', home.text.includes('<meta name="theme-color" content="#0A0A0A" />') && !home.text.includes('#06050D'))
    check('holdermaps /: favicons and apple-touch icon are HolderMaps\' own', home.text.includes('href="/brand/holdermaps/icon-16.png"') && home.text.includes('href="/brand/holdermaps/icon-32.png"') && home.text.includes('href="/brand/holdermaps/icon-180.png"') && !home.text.includes('/brand/icon/'))
    check('holdermaps /: og:site_name HolderMaps, its own OG image (absolute, holdermaps.xyz) and alt text', home.text.includes('<meta property="og:site_name" content="HolderMaps" />') && home.text.includes('<meta property="og:image" content="https://holdermaps.xyz/brand/holdermaps/og-image-1200x630.png" />') && home.text.includes('<meta name="twitter:image" content="https://holdermaps.xyz/brand/holdermaps/twitter-card-1200x600.png" />') && /og:image:alt" content="HolderMaps/.test(home.text) && !home.text.includes('gullylabs.xyz/brand/social'))
    const ld = home.text.match(/<script type="application\/ld\+json">([^<]*)<\/script>/)
    check('holdermaps /: JSON-LD names HolderMaps as a WebApplication on holdermaps.xyz', !!ld && JSON.parse(ld[1])['@type'] === 'WebApplication' && JSON.parse(ld[1]).name === 'HolderMaps' && JSON.parse(ld[1]).url === 'https://holdermaps.xyz/')
    const desc = home.text.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ''
    check('holdermaps /: description is 140-160 characters and names Gully Chain', desc.length >= 140 && desc.length <= 160 && desc.includes('Gully Chain'), `${desc.length}: ${desc}`)
    const title = home.text.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''
    check('holdermaps /: title at most 60 characters', title.length <= 60, `${title.length}: ${title}`)
    check('holdermaps /favicon.ico: HolderMaps\' own icon; gullylabs.xyz keeps its own', (await get(HM, '/favicon.ico')).text === 'HOLDERMAPS-ICO' && (await get(MAIN, '/favicon.ico')).text === 'GULLY-ICO' && (await get(HM, '/apple-touch-icon.png')).text === 'HOLDERMAPS-180')
    check('holdermaps /: indexable (no noindex) and keeps the analytics beacon and the site CSP', !/noindex/.test(home.text) && !/noindex/.test(home.headers['x-robots-tag'] ?? '') && home.text.includes('analytics.gullylabs.xyz') && /analytics\.gullylabs\.xyz/.test(home.headers['content-security-policy'] ?? '') && /connect-src 'self' https: wss:/.test(home.headers['content-security-policy'] ?? ''))
    check('holdermaps /: no cookie, HSTS, framed only by itself', !home.headers['set-cookie'] && /max-age=31536000/.test(home.headers['strict-transport-security'] ?? '') && /frame-ancestors 'self'/.test(home.headers['content-security-policy'] ?? ''))
    check('holdermaps /: no holdermaps-primary tag while HOLDERMAPS_PRIMARY is unset', !home.text.includes('holdermaps-primary'))
    const map = await get(HM, `/base/${TOKEN}`)
    check('holdermaps /<chain>/<token>: 200, HolderMaps title, holdermaps.xyz canonical, the kit share image', map.status === 200 && /<title>Who holds [^<]+ on Base · HolderMaps<\/title>/.test(map.text) && map.text.includes(`<link rel="canonical" href="https://holdermaps.xyz/base/${TOKEN}" />`) && map.text.includes('<meta property="og:image" content="https://holdermaps.xyz/brand/holdermaps/og-image-1200x630.png" />') && !map.text.includes('gullylabs.xyz/brand/social') && !map.text.includes('card.png') && map.text.includes('<meta name="theme-color" content="#0A0A0A" />') && map.text.includes('on HolderMaps.'), map.text.match(/<title>[^<]*<\/title>/)?.[0])
    const mapLd = [...map.text.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map((x) => JSON.parse(x[1]))
    check('holdermaps /<chain>/<token>: JSON-LD WebPage and a HolderMaps > chain > token breadcrumb', mapLd.some((l) => l['@type'] === 'WebPage' && l.url === `https://holdermaps.xyz/base/${TOKEN}`) && mapLd.some((l) => l['@type'] === 'BreadcrumbList' && l.itemListElement.length === 3 && l.itemListElement[1].name === 'Base'))
    // Redesign 2026-10-26: a path that is no page on either site is HolderMaps' own 404 (mascot page), not a hop away.
    for (const p of ['/nope', '/ethereum/0x123', `/deep/x`]) {
      const nf = await get(HM, p)
      check(`holdermaps ${p}: its own 404, noindex, titled Not found · HolderMaps`, nf.status === 404 && !nf.headers.location && nf.text.includes('<div id="root">') && nf.text.includes('<title>Not found · HolderMaps</title>') && /<meta name="robots" content="noindex"/.test(nf.text) && nf.headers['x-robots-tag'] === 'noindex', `${nf.status} ${nf.headers.location ?? ''}`)
    }
    for (const p of ['/legal/terms', '/tracker', '/admin', '/chains']) check(`holdermaps ${p}: still a 301 to gullylabs.xyz`, (await get(HM, p)).status === 301)
    const deep = await get(HM, `/deep/${DEEP}`)
    check('holdermaps /deep/<id>: 200, noindex, no canonical (private by link)', deep.status === 200 && /<meta name="robots" content="noindex"/.test(deep.text) && deep.headers['x-robots-tag'] === 'noindex' && !/rel="canonical"/.test(deep.text) && /HolderMaps/.test(deep.text.match(/<title>[^<]*<\/title>/)?.[0] ?? ''))
    const long = await get(HM, `/holders/base/${TOKEN}?ref=x`)
    check('holdermaps /holders/<chain>/<token>: 301 to the short path', long.status === 301 && long.headers.location === `/base/${TOKEN}?ref=x`, `${long.status} ${long.headers.location}`)
    const www = await get('www.holdermaps.xyz', `/base/${TOKEN}`)
    check('www.holdermaps.xyz: 301 to holdermaps.xyz', www.status === 301 && www.headers.location === `https://holdermaps.xyz/base/${TOKEN}`, www.headers.location)
    const away = await get(HM, '/pricing?plan=pro')
    check('holdermaps /pricing: 301 to gullylabs.xyz/pricing', away.status === 301 && away.headers.location === `https://${MAIN}/pricing?plan=pro`, away.headers.location)
    check('holdermaps POST to a non-page: JSON 404, never a redirect', (await get(HM, '/pricing', { method: 'POST', body: {} })).status === 404)
    const plans = await get(HM, '/api/plans')
    check('holdermaps /api/plans: served on the same origin (200 JSON)', plans.status === 200 && /json/.test(plans.headers['content-type'] ?? ''), String(plans.status))
    const hapi = await get(HM, '/api/holders/sources')
    check('holdermaps /api/holders/*: served on the same origin (no redirect)', hapi.status !== 301 && hapi.status !== 404, String(hapi.status))
    check('holdermaps /api/admin and /api/developer: 404', (await get(HM, '/api/admin/x')).status === 404 && (await get(HM, '/api/developer/account')).status === 404)
    check('holdermaps serves the hashed assets', (await get(HM, '/assets/index-abcdef12.js')).status === 200)
    const robots = await get(HM, '/robots.txt')
    check('holdermaps robots.txt: allows crawling and names its own sitemap', robots.status === 200 && /Allow: \//.test(robots.text) && robots.text.includes('Sitemap: https://holdermaps.xyz/sitemap.xml'), robots.text)
    const sm = await get(HM, '/sitemap.xml')
    check('holdermaps sitemap.xml: its own pages under short paths, nothing on gullylabs.xyz', sm.status === 200 && sm.text.includes('<loc>https://holdermaps.xyz/</loc>') && !sm.text.includes('gullylabs.xyz') && !sm.text.includes('/holders'), sm.text.slice(0, 300))
    const man = await get(HM, '/manifest.webmanifest')
    check('holdermaps manifest: installs as HolderMaps, with its own icons and colours', man.status === 200 && man.data?.name === 'HolderMaps' && man.data.theme_color === '#0A0A0A' && man.data.background_color === '#0A0A0A' && man.data.icons.length === 2 && man.data.icons.every((i) => i.src.startsWith('/brand/holdermaps/')), man.text.slice(0, 120))
    // The main site's head keeps the Gully Labs brand.
    const mainHome = await get(MAIN, '/')
    check('main /: still Gully Labs theme-color, icons and site name', mainHome.text.includes('<meta name="theme-color" content="#06050D" />') && mainHome.text.includes('href="/brand/icon/favicon-16.png"') && mainHome.text.includes('<meta property="og:site_name" content="Gully Labs" />'))
    // Gully AI: its own share image and theme colour on /ask; the site's tab icon and site name are kept.
    const ask = await get(MAIN, '/ask')
    check('main /ask: Gully AI share image and theme colour, Gully Labs icons and site name', ask.text.includes('<meta property="og:image" content="https://gullylabs.xyz/brand/gullyai/og-1200x630.png" />') && ask.text.includes('<meta name="theme-color" content="#000406" />') && ask.text.includes('href="/brand/icon/favicon-16.png"') && ask.text.includes('<meta property="og:site_name" content="Gully Labs" />') && /og:image:alt" content="Gully AI/.test(ask.text))
    const docsAi = await get('docs.gullylabs.xyz', '/gully-ai')
    check('docs /gully-ai: Gully AI share image', docsAi.text.includes('<meta property="og:image" content="https://gullylabs.xyz/brand/gullyai/og-1200x630.png" />'))
    // The main site keeps its Holder Map while holdermaps.xyz is not primary.
    const mainMap = await get(MAIN, `/holders/base/${TOKEN}`)
    check('main /holders/<chain>/<token>: still served (200), canonical on gullylabs.xyz while not primary', mainMap.status === 200 && mainMap.text.includes(`<link rel="canonical" href="https://${MAIN}/holders/base/${TOKEN}" />`))
    check('main sitemap: still lists /holders while not primary', (await get(MAIN, '/sitemap.xml')).text.includes(`<loc>https://${MAIN}/holders</loc>`))
    check('links the server writes: gullylabs.xyz/holders while not primary', holderPageUrl('base', TOKEN) === `https://${MAIN}/holders/base/${TOKEN}` && holderHomeUrl() === `https://${MAIN}/holders`)

    // HOLDERMAPS_PRIMARY=1: holdermaps.xyz is the Holder Map's home.
    process.env.HOLDERMAPS_PRIMARY = '1'
    try {
      for (const [p, to] of [[`/holders/base/${TOKEN}?a=1`, `/base/${TOKEN}?a=1`], ['/holders', '/'], ['/holders/', '/'], [`/holders/deep/${DEEP}`, `/deep/${DEEP}`], ['/holders/robinhood/TSLA', '/robinhood/TSLA']]) {
        const x = await get(MAIN, p)
        check(`primary: main GET ${p.slice(0, 30)} is a 301 to holdermaps.xyz${to.slice(0, 20)}`, x.status === 301 && x.headers.location === `https://holdermaps.xyz${to}`, `${x.status} ${x.headers.location}`)
      }
      check('primary: HEAD is redirected too, POST is not', (await get(MAIN, '/holders', { method: 'HEAD' })).status === 301 && (await get(MAIN, '/holders', { method: 'POST', body: {} })).status !== 301)
      check('primary: the API, the embed, widget.js and badges stay on the main host (SDK and snippets)', (await get(MAIN, '/api/holders/sources')).status !== 301 && (await get(MAIN, `/embed/holders/base/${TOKEN}`)).status === 200 && (await get(MAIN, '/widget.js')).status === 200 && (await get(EMBED, `/embed/holders/base/${TOKEN}`)).status === 200 && (await get(MAIN, `/api/holders/base/${TOKEN}/badge.svg`)).status !== 301)
      check('primary: an unknown chain under /holders is not redirected', (await get(MAIN, '/holders/nope/x')).status !== 301)
      check('primary: localhost keeps /holders by path (development)', (await get(`localhost:${PORT}`, '/holders')).status === 200)
      const hp = await get(HM, `/base/${TOKEN}`)
      check('primary: a token page names its own holdermaps.xyz address as canonical (never "holdermaps.xyznull")', hp.text.includes(`<link rel="canonical" href="https://holdermaps.xyz/base/${TOKEN}" />`) && !hp.text.includes('xyznull'), hp.text.match(/<link rel="canonical"[^>]*>/)?.[0])
      const hsm = (await get(HM, '/sitemap.xml')).text
      check('primary: the holdermaps.xyz sitemap lists the home page and has no broken <loc>', hsm.includes('<loc>https://holdermaps.xyz/</loc>') && !hsm.includes('null'))
      check('primary: pages carry the holdermaps-primary tag (the browser follows it)', hp.text.includes('<meta name="holdermaps-primary" content="1" />') && (await get(MAIN, '/')).text.includes('holdermaps-primary'))
      const msm = (await get(MAIN, '/sitemap.xml')).text
      check('primary: the main sitemap no longer lists Holder Map pages', !msm.includes(`${MAIN}/holders`) && msm.includes(`<loc>https://${MAIN}/tracker</loc>`))
      check('primary: links the server writes name holdermaps.xyz', holderPageUrl('base', TOKEN) === `https://holdermaps.xyz/base/${TOKEN}` && holderHomeUrl() === 'https://holdermaps.xyz/')
      const { holdersPageUrl } = await import('../server/telegram-ui.mjs')
      check('primary: Telegram map buttons name holdermaps.xyz', holdersPageUrl('robinhood', 'TSLA') === 'https://holdermaps.xyz/robinhood/TSLA')
    } finally {
      delete process.env.HOLDERMAPS_PRIMARY
    }
  }

  /* ---------------------------------------------------- gullysecurity.xyz --- */
  {
    const SEC = 'gullysecurity.xyz'
    const r = (p, h = SEC) => securityRoute(h, p.split('?')[0], p.includes('?') ? p.slice(p.indexOf('?')) : '')
    // The routing table.
    check('security: the hosts it answers', isSecurityHost(SEC) && isSecurityHost('www.gullysecurity.xyz') && isSecurityHost('gullysecurity.xyz:443') && !isSecurityHost(MAIN) && !isSecurityHost('gullysecurity.xyz.evil.test') && !isSecurityHost('holdermaps.xyz') && SECURITY_URL === 'https://gullysecurity.xyz')
    check(
      'security: short paths <-> the main site paths',
      securityShortPath('/security') === '/' && securityShortPath('/security/') === '/' && securityShortPath('/security/reports') === '/reports' && securityShortPath(`/security/reports/${SEC_PUB}`) === `/reports/${SEC_PUB}` && securityShortPath('/security/sample') === '/sample' && securityShortPath('/security/terms') === '/terms' && securityShortPath('/security/nope') === null && securityShortPath('/legal/scan-terms') === null && securityShortPath('/score') === null &&
        securityInternalPath('/') === '/security' && securityInternalPath('/reports') === '/security/reports' && securityInternalPath(`/reports/${SEC_PUB}`) === `/security/reports/${SEC_PUB}` && securityInternalPath('/sample') === '/security/sample' && securityInternalPath('/terms') === '/legal/scan-terms' && securityInternalPath('/reports/x') === null && securityInternalPath('/pricing') === null && securityInternalPath('/legal/terms') === null,
    )
    check('security policy: its pages, its API and static files are served', ['/', '/reports', `/reports/${SEC_PUB}`, '/sample', '/terms', '/api/security/reports', '/api/security/stats', '/api/security/engine', '/api/security/sample', '/api/security/review-requests', `/api/security/reports/${SEC_PUB}/badge.svg`, '/api/plans', '/api/score/base/0x1', '/assets/index-abcdef12.js', '/brand/gully-mark-512.png', '/robots.txt', '/sitemap.xml', '/manifest.webmanifest', '/healthz'].every((p) => r(p).kind === 'allow'))
    check('security policy: the session-only dashboard (incl. its scan checkout), admin and Telegram APIs are refused', ['/api/admin/security', '/api/developer/security/scans', '/api/developer/account', '/api/tg/me', '/api/telegram/x'].every((p) => r(p).kind === 'deny'))
    const rl = r(`/security/reports/${SEC_PUB}?x=1`)
    check('security policy: /security/... is a 301 to the short path, query kept', rl.kind === 'redirect' && rl.location === `/reports/${SEC_PUB}?x=1` && r('/security').location === '/' && r('/security/sample').location === '/sample' && r('/security/terms').location === '/terms' && r('/security/reports/').location === '/reports', JSON.stringify(rl))
    check('security policy: any other page goes to the same path on gullylabs.xyz', r('/pricing?a=1').location === `https://${MAIN}/pricing?a=1` && r('/legal/scan-terms').location === `https://${MAIN}/legal/scan-terms` && r('/score/base/0x1').location === `https://${MAIN}/score/base/0x1` && r(`/pay/inv_${'a'.repeat(22)}`).location === `https://${MAIN}/pay/inv_${'a'.repeat(22)}` && r('/holders').location === `https://${MAIN}/holders`)
    check('security policy: www. is a 301 to the apex, path and query kept', r('/reports?q=1', 'www.gullysecurity.xyz').location === 'https://gullysecurity.xyz/reports?q=1')
    check('security: the main host policy is unchanged (gullysecurity. is not a service host)', hostPolicy(SEC, '/') === 'allow' && hostPolicy(MAIN, '/security') === 'allow')

    // Over HTTP, as Cloudflare sends it.
    const home = await get(SEC, '/')
    check('security /: 200, the app shell, titled Gully Security, canonical gullysecurity.xyz/', home.status === 200 && home.text.includes('<div id="root">') && home.text.includes('<title>AI Security Scan and Security Review · Gully Security</title>') && home.text.includes('<link rel="canonical" href="https://gullysecurity.xyz/" />') && home.text.includes('og-security.png'), home.text.slice(0, 400))
    check('security /: indexable (no noindex), keeps the analytics beacon and the site CSP', !/noindex/.test(home.text) && !/noindex/.test(home.headers['x-robots-tag'] ?? '') && home.text.includes('analytics.gullylabs.xyz') && /analytics\.gullylabs\.xyz/.test(home.headers['content-security-policy'] ?? '') && /connect-src 'self' https: wss:/.test(home.headers['content-security-policy'] ?? ''))
    check('security /: no cookie, HSTS, framed only by itself, no security-primary tag while unset', !home.headers['set-cookie'] && /max-age=31536000/.test(home.headers['strict-transport-security'] ?? '') && /frame-ancestors 'self'/.test(home.headers['content-security-policy'] ?? '') && !home.text.includes('security-primary'))
    for (const [p, title] of [['/reports', 'Published security scan reports · Gully Security'], ['/sample', 'Sample AI Security Scan report · Gully Security']]) {
      const x = await get(SEC, p)
      check(`security ${p}: 200, "${title}", canonical gullysecurity.xyz${p}`, x.status === 200 && x.text.includes(`<title>${title}</title>`) && x.text.includes(`<link rel="canonical" href="https://gullysecurity.xyz${p}" />`) && !/noindex/.test(x.text), x.text.match(/<title>[^<]*<\/title>/)?.[0])
    }
    const pub = await get(SEC, `/reports/${SEC_PUB}`)
    check('security /reports/<id> (indexable): 200, Gully Security title, gullysecurity.xyz canonical, indexed', pub.status === 200 && /<title>Security scan report: [^<]+ · Gully Security<\/title>/.test(pub.text) && pub.text.includes(`<link rel="canonical" href="https://gullysecurity.xyz/reports/${SEC_PUB}" />`) && !/noindex/.test(pub.text), pub.text.match(/<title>[^<]*<\/title>/)?.[0])
    const priv = await get(SEC, `/reports/${SEC_PRIV}`)
    check('security /reports/<id> (private): 200 but noindex', priv.status === 200 && /<meta name="robots" content="noindex"/.test(priv.text))
    const gone = await get(SEC, `/reports/sec_${'z'.repeat(16)}`)
    check('security /reports/<unknown>: 404, noindex, "Report not found · Gully Security"', gone.status === 404 && /noindex/.test(gone.text) && gone.text.includes('Report not found · Gully Security'))
    const terms = await get(SEC, '/terms')
    check('security /terms: 200, the scan terms (not the site terms), canonical on gullylabs.xyz/legal/scan-terms', terms.status === 200 && terms.text.includes('<title>AI Security Scan terms · Gully Security</title>') && terms.text.includes(`<link rel="canonical" href="https://${MAIN}/legal/scan-terms" />`), `${terms.status} ${terms.headers.location ?? ''} ${terms.text.match(/<title>[^<]*<\/title>/)?.[0]}`)
    const long = await get(SEC, `/security/reports/${SEC_PUB}?ref=x`)
    check('security /security/reports/<id>: 301 to the short path', long.status === 301 && long.headers.location === `/reports/${SEC_PUB}?ref=x`, `${long.status} ${long.headers.location}`)
    const longTerms = await get(SEC, '/security/terms')
    check('security /security/terms: 301 to /terms (this host)', longTerms.status === 301 && longTerms.headers.location === '/terms', longTerms.headers.location)
    const www = await get('www.gullysecurity.xyz', '/reports')
    check('www.gullysecurity.xyz: 301 to gullysecurity.xyz', www.status === 301 && www.headers.location === 'https://gullysecurity.xyz/reports', www.headers.location)
    const away = await get(SEC, '/pricing?plan=pro')
    check('security /pricing: 301 to gullylabs.xyz/pricing', away.status === 301 && away.headers.location === `https://${MAIN}/pricing?plan=pro`, away.headers.location)
    check('security POST to a non-page: JSON 404, never a redirect', (await get(SEC, '/pricing', { method: 'POST', body: {} })).status === 404 && (await get(SEC, '/security', { method: 'POST', body: {} })).status === 404)
    const list = await get(SEC, '/api/security/reports')
    check('security /api/security/reports: served on the same origin (200 JSON), both published reports listed', list.status === 200 && list.data?.reports?.length === 2, String(list.status))
    check('security /api/security/sample and /api/plans: served on the same origin', (await get(SEC, '/api/security/sample')).status === 200 && (await get(SEC, '/api/plans')).status === 200)
    const form = await get(SEC, '/api/security/review-requests', { method: 'POST', body: {}, headers: { 'x-requested-with': 'gully' } })
    check('security POST /api/security/review-requests: reaches the form handler (validation 400, not a redirect or 404)', form.status === 400, `${form.status} ${form.text.slice(0, 120)}`)
    check('security /api/admin, /api/developer (scan checkout) and /api/tg: 404', (await get(SEC, '/api/admin/security')).status === 404 && (await get(SEC, '/api/developer/security/scans')).status === 404 && (await get(SEC, '/api/tg/me')).status === 404)
    check('security serves the hashed assets', (await get(SEC, '/assets/index-abcdef12.js')).status === 200)
    const robots = await get(SEC, '/robots.txt')
    check('security robots.txt: allows crawling and names its own sitemap', robots.status === 200 && /Allow: \//.test(robots.text) && robots.text.includes('Sitemap: https://gullysecurity.xyz/sitemap.xml'), robots.text)
    const sm = await get(SEC, '/sitemap.xml')
    check('security sitemap.xml: its pages and the indexable report under short paths, nothing private, nothing on gullylabs.xyz', sm.status === 200 && ['/', '/reports', '/sample', `/reports/${SEC_PUB}`].every((p) => sm.text.includes(`<loc>https://gullysecurity.xyz${p}</loc>`)) && !sm.text.includes(SEC_PRIV) && !sm.text.includes('gullylabs.xyz') && !sm.text.includes('/security'), sm.text.slice(0, 400))
    const man = await get(SEC, '/manifest.webmanifest')
    check('security manifest: installs as Gully Security', man.status === 200 && man.data?.name === 'Gully Security', man.text.slice(0, 120))
    // The main site keeps its Security pages while gullysecurity.xyz is not primary.
    const mainSec = await get(MAIN, '/security')
    check('main /security: still served (200), canonical on gullylabs.xyz while not primary', mainSec.status === 200 && mainSec.text.includes(`<link rel="canonical" href="https://${MAIN}/security" />`))
    check('main /security/reports/<id>: canonical on gullylabs.xyz while not primary', (await get(MAIN, `/security/reports/${SEC_PUB}`)).text.includes(`<link rel="canonical" href="https://${MAIN}/security/reports/${SEC_PUB}" />`))
    const mainSm = (await get(MAIN, '/sitemap.xml')).text
    check('main sitemap: still lists /security and the indexable report while not primary', mainSm.includes(`<loc>https://${MAIN}/security</loc>`) && mainSm.includes(`<loc>https://${MAIN}/security/reports/${SEC_PUB}</loc>`) && !mainSm.includes(SEC_PRIV))
    check('links the server writes: gullylabs.xyz/security while not primary', securityUrl('/security') === `https://${MAIN}/security` && securityUrl('/security#request') === `https://${MAIN}/security#request` && securityReportUrl(SEC_PUB) === `https://${MAIN}/security/reports/${SEC_PUB}` && currentPageUrl(`https://${MAIN}/security/reports`) === `https://${MAIN}/security/reports`)
    const badge = await get(MAIN, `/api/security/reports/${SEC_PUB}/badge.svg`)
    check('report badge: links gullylabs.xyz/security/reports/<id> while not primary', badge.status === 200 && badge.text.includes(`https://${MAIN}/security/reports/${SEC_PUB}`))

    // SECURITY_PRIMARY=1: gullysecurity.xyz is Gully Security's home.
    process.env.SECURITY_PRIMARY = '1'
    try {
      // Gully Security is its own app now: the old paths move there as they are (it answers /security/* itself).
      for (const p of ['/security?a=1', '/security/', '/security/reports', `/security/reports/${SEC_PUB}`, '/security/sample', '/security/terms', '/security/nope']) {
        const x = await get(MAIN, p)
        check(`primary: main GET ${p.slice(0, 32)} is a 301 to gullysecurity.xyz, path kept`, x.status === 301 && x.headers.location === `https://gullysecurity.xyz${p}`, `${x.status} ${x.headers.location}`)
      }
      check('primary: HEAD is redirected too, POST is not', (await get(MAIN, '/security', { method: 'HEAD' })).status === 301 && (await get(MAIN, '/security', { method: 'POST', body: {} })).status !== 301)
      check('primary: the main legal page and /securityx are not redirected', (await get(MAIN, '/securityx')).status !== 301 && (await get(MAIN, '/legal/scan-terms')).status === 200)
      check(
        'primary: the API, the scan checkout, the review form, badges and Gully Pay stay where they are',
        (await get(MAIN, '/api/security/reports')).status === 200 && (await get(MAIN, '/api/security/engine')).status !== 301 && (await get(MAIN, `/api/security/reports/${SEC_PUB}/badge.svg`)).status === 200 && (await get(MAIN, '/api/developer/security/scans')).status !== 301 && (await get(MAIN, '/api/security/review-requests', { method: 'POST', body: {}, headers: { 'x-requested-with': 'gully' } })).status === 400 && (await get(PAY, INV)).status !== 301 && (await get(API, '/api/security/reports')).status === 200,
      )
      check('primary: localhost, docs. and app. keep their /security behaviour (development, other hosts)', (await get(`localhost:${PORT}`, '/security')).status === 200 && (await get('docs.gullylabs.xyz', '/security')).headers.location !== 'https://gullysecurity.xyz/')
      const sp = await get(SEC, '/reports')
      check('primary: gully-web no longer serves gullysecurity.xyz (421, the standalone app does)', sp.status === 421 && (await get(`www.${SEC}`, '/')).status === 421 && (await get(SEC, '/api/security/reports')).status === 421, `${sp.status}`)
      check('primary: main pages carry the security-primary tag (the browser follows it)', (await get(MAIN, '/')).text.includes('<meta name="security-primary" content="1" />'))
      // /api/score* is answered by the Security app until clients migrate: GET proxied, POST a 308.
      const stub = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify({ proxied: q.url })) })
      await new Promise((ok) => stub.listen(0, '127.0.0.1', ok))
      process.env.SECURITY_API_ORIGIN = `http://127.0.0.1:${stub.address().port}`
      try {
        const sc = await get(MAIN, '/api/score/base/0xabc?x=1')
        check('primary: GET /api/score/... is proxied to the Security app, path and query kept', sc.status === 200 && sc.text.includes('/api/score/base/0xabc?x=1') && sc.headers['access-control-allow-origin'] === '*', `${sc.status} ${sc.text.slice(0, 80)}`)
        const sp2 = await get(MAIN, '/api/score', { method: 'POST', body: {} })
        check('primary: a non-GET /api/score is a 308 to the Security app', sp2.status === 308 && sp2.headers.location === `${process.env.SECURITY_API_ORIGIN}/api/score`, `${sp2.status} ${sp2.headers.location}`)
      } finally {
        delete process.env.SECURITY_API_ORIGIN
        stub.close()
      }
      const msm = (await get(MAIN, '/sitemap.xml')).text
      check('primary: the main sitemap no longer lists Security pages (but keeps the legal scan terms)', !msm.includes(`${MAIN}/security`) && msm.includes(`<loc>https://${MAIN}/legal/scan-terms</loc>`) && msm.includes(`<loc>https://${MAIN}/tracker</loc>`))
      check(
        'primary: links the server writes name gullysecurity.xyz',
        securityUrl('/security') === 'https://gullysecurity.xyz/' && securityUrl('/security#request') === 'https://gullysecurity.xyz/#request' && securityUrl('/security/reports') === 'https://gullysecurity.xyz/reports' && securityReportUrl(SEC_PUB) === `https://gullysecurity.xyz/reports/${SEC_PUB}` &&
          currentPageUrl(`https://${MAIN}/security/reports`) === 'https://gullysecurity.xyz/reports' && currentPageUrl(`https://${MAIN}/#security`) === `https://${MAIN}/#security` && currentPageUrl(`https://${MAIN}/legal/scan-terms`) === `https://${MAIN}/legal/scan-terms` && currentPageUrl('https://docs.gullylabs.xyz/gully-security') === 'https://docs.gullylabs.xyz/gully-security',
      )
      const { securityView } = await import('../server/telegram-ui.mjs')
      check('primary: the Telegram Security menu button names gullysecurity.xyz', JSON.stringify(securityView(false).keyboard).includes('"url":"https://gullysecurity.xyz/"'))
      const { publishedReportFor } = await import('../server/security/reports.mjs')
      check('primary: the Gully Score review link (published report) names gullysecurity.xyz', publishedReportFor(8453, SEC_ADDR)?.url === `https://gullysecurity.xyz/reports/${SEC_PUB}`, publishedReportFor(8453, SEC_ADDR)?.url)
      const pb = await get(MAIN, `/api/security/reports/${SEC_PUB}/badge.svg`)
      check('primary: the report badge (served where it was) links gullysecurity.xyz', pb.status === 200 && pb.text.includes(`https://gullysecurity.xyz/reports/${SEC_PUB}`))
      check('primary: holdermaps.xyz is untouched by SECURITY_PRIMARY', (await get('holdermaps.xyz', '/security')).headers.location === `https://${MAIN}/security`)
    } finally {
      delete process.env.SECURITY_PRIMARY
    }
  }

  /* ------------------------------------ products on their own domains (2026-10-26) --- */
  {
    const { movedPageUrl, movedDocsUrl } = await import('../server/hosts.mjs')
    const moves = [
      ['/chains', 'https://gullychain.xyz/'],
      ['/chains/', 'https://gullychain.xyz/'],
      ['/chains/launch', 'https://kre8.fun/'],
      ['/chain-kit', 'https://gullychain.xyz/'],
      ['/gully-pay', 'https://gullypay.xyz/'],
      ['/gully-pay/docs', 'https://gullypay.xyz/docs'],
      ['/gully-pay/x402', 'https://gullypay.xyz/x402'],
      ['/gully-pay/nope', 'https://gullypay.xyz/'],
      ['/x402', 'https://gullypay.xyz/x402'],
      ['/glusd', 'https://gullypay.xyz/glusd'],
      ['/rpc', 'https://gullyrpc.xyz/'],
      ['/rpc/docs', 'https://gullyrpc.xyz/docs/'],
      ['/rpc/status', 'https://gullyrpc.xyz/status/'],
      ['/studio', 'https://gullystudio.xyz/'],
      ['/games', 'https://gullystudio.xyz/'],
    ]
    check('moved: every old product path maps to its own domain', moves.every(([p, u]) => movedPageUrl(p) === u), JSON.stringify(moves.filter(([p, u]) => movedPageUrl(p) !== u).map(([p]) => [p, movedPageUrl(p)])))
    const stay = ['/', '/products', '/products/chain', '/products/ipfs', '/pricing', '/tracker', '/score', '/ask', '/status', '/holders', '/security', '/pay/inv_x', '/gully-pay/merchant-terms', '/legal/merchant-terms', '/api/holders/base/0x1', '/api/security/reports/sec_x/badge.svg', '/embed/holders/base/0x1', '/widget.js', '/rpcfoo', '/chainsaw']
    check('moved: what stays with Gully Labs is not redirected (APIs, embeds, badges, checkout, legal, hub pages)', stay.every((p) => movedPageUrl(p) === null), JSON.stringify(stay.filter((p) => movedPageUrl(p) !== null)))
    check('moved docs: Gully Pay, Chain Kit and the L3 roadmap go to the products\' docs; the rest stays', movedDocsUrl('/gully-pay') === 'https://gullypay.xyz/docs' && movedDocsUrl('/gully-pay-merchants') === 'https://gullypay.xyz/docs' && movedDocsUrl('/chain-kit') === 'https://docs.gullychain.xyz/' && movedDocsUrl('/roadmap-l3') === 'https://docs.gullychain.xyz/network/' && movedDocsUrl('/gully-security') === null && movedDocsUrl('/holder-map') === null && movedDocsUrl('/badges') === null && movedDocsUrl('/ipfs') === null)
    for (const [p, u] of [['/chains?ref=x', 'https://gullychain.xyz/'], ['/gully-pay/x402', 'https://gullypay.xyz/x402'], ['/rpc', 'https://gullyrpc.xyz/']]) {
      const r = await get(MAIN, p)
      check(`main ${p}: 301 to ${u}`, r.status === 301 && r.headers.location === u, `${r.status} ${r.headers.location}`)
    }
    const app = await get('app.gullylabs.xyz', '/chain-kit')
    check('app. /chain-kit: 301 straight to gullychain.xyz', app.status === 301 && app.headers.location === 'https://gullychain.xyz/', `${app.status} ${app.headers.location}`)
    const post = await get(MAIN, '/chains', { method: 'POST' })
    check('main POST /chains: not redirected', post.status !== 301, String(post.status))
    const docs = await get('docs.gullylabs.xyz', '/gully-pay-merchants')
    check('docs /gully-pay-merchants: 301 to gullypay.xyz/docs', docs.status === 301 && docs.headers.location === 'https://gullypay.xyz/docs', `${docs.status} ${docs.headers.location}`)
    const docsStay = await get('docs.gullylabs.xyz', '/holder-map')
    check('docs /holder-map: still served', docsStay.status === 200, String(docsStay.status))
    const badge = await get(MAIN, `/api/security/reports/${SEC_PUB}/badge.svg`)
    check('the report badge still answers on gullylabs.xyz (never moves)', badge.status === 200 && /svg/.test(badge.headers['content-type'] ?? ''), `${badge.status} ${badge.headers['content-type']}`)
    const holdersApi = await get(MAIN, '/api/holders/base/0x1')
    check('/api/holders/* is not redirected', holdersApi.status !== 301, String(holdersApi.status))
    const map = await get(MAIN, '/sitemap.xml')
    check('main sitemap: no moved product page, the hub and Gully IPFS listed', !/gullylabs\.xyz\/(chains|chain-kit)</.test(map.text) && map.text.includes('<loc>https://gullylabs.xyz/products/ipfs</loc>'))
    const dmap = await get('docs.gullylabs.xyz', '/sitemap.xml')
    check('docs sitemap: no moved docs page', !/docs\.gullylabs\.xyz\/(gully-pay|gully-pay-merchants|chain-kit|roadmap-l3)</.test(dmap.text))
    const ipfs = await get(MAIN, '/api/ipfs/stats')
    const ij = JSON.parse(ipfs.text || '{}')
    check('/api/ipfs/stats: 200 JSON with nulls when the node cannot be reached, open CORS', ipfs.status === 200 && 'pinned' in ij && 'gatewayUp' in ij && ipfs.headers['access-control-allow-origin'] === '*', ipfs.text.slice(0, 200))
    const rpcApi = await get(MAIN, '/api/v0/repo/stat')
    check('the Kubo RPC is never reachable through this server', rpcApi.status !== 200 || !/RepoSize/.test(rpcApi.text))
  }

  /* ------------------------------------------- QA sweep, 2026-10-26 (P0/P1) --- */
  {
    const { appTabUrl, APP_TABS, HOLDER_CHAIN_KEYS, movedPageUrl } = await import('../server/hosts.mjs')
    const { HOLDER_CHAINS } = await import('../server/holders.mjs')
    const { validSitemapUrl } = await import('../server/seo.mjs')
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
    const HM = 'holdermaps.xyz'
    const APP = 'app.gullylabs.xyz'
    const GULLY_TOKEN = '0xe6ab829a02aaf474e7b6d4434b82a68ebc618fe4'

    // 1. Every chain the Holder Map covers (Gully Chain 485590 included) is a holdermaps.xyz page, on the server and in the
    //    browser bundle alike (the browser list lacked "gully": holdermaps.xyz/gully/<token> left for a gullylabs.xyz 404,
    //    and a search for a Gully Chain address fell back to the home page).
    const clientKeys = (/HOLDER_CHAIN_KEYS = \[([^\]]+)\]/.exec(read('src/site-host.ts'))?.[1].match(/'([a-z]+)'/g) ?? []).map((x) => x.slice(1, -1))
    const sorted = (a) => JSON.stringify([...a].sort())
    check('holder chains: server routing, browser routing and the Holder Map agree, Gully Chain included', sorted(HOLDER_CHAIN_KEYS) === sorted(Object.keys(HOLDER_CHAINS)) && sorted(clientKeys) === sorted(HOLDER_CHAIN_KEYS) && HOLDER_CHAINS.gully?.id === 485590, JSON.stringify({ server: HOLDER_CHAIN_KEYS, client: clientKeys, map: Object.keys(HOLDER_CHAINS) }))
    for (const chain of HOLDER_CHAIN_KEYS) {
      const token = chain === 'solana' ? '7'.repeat(43) : GULLY_TOKEN
      const r = await get(HM, `/${chain}/${token}`)
      check(`holdermaps /${chain}/<token>: served there (200), not sent to gullylabs.xyz`, r.status === 200 && !r.headers.location && r.text.includes(`<link rel="canonical" href="https://holdermaps.xyz/${chain}/${token}" />`), `${r.status} ${r.headers.location ?? ''}`)
    }
    check('holdermaps search: a Gully Chain match (/holders/gully/<token>) maps to its short path', holderShortPath(`/holders/gully/${GULLY_TOKEN}`) === `/gully/${GULLY_TOKEN}`)
    check('holder search: a match opens through holderHref (the short path on holdermaps.xyz)', /holderHref\(path\)/.test(read('src/lib/holderResolve.ts')) && /holderHref\(m\.path\)/.test(read('src/components/landing/HolderSearchHero.tsx')))

    // 2. /pay resolves once; app.gullylabs.xyz serves its own pages.
    const follow = async (host, p, hops = 6) => {
      const seen = []
      let at = { host, p }
      for (let i = 0; i < hops; i++) {
        const r = await get(at.host, at.p)
        seen.push(`${r.status} ${at.host}${at.p}`)
        if (r.status !== 301 && r.status !== 302) return { end: `${at.host}${at.p}`, status: r.status, seen }
        const u = new URL(r.headers.location, `https://${at.host}`)
        if (!/(^|\.)(gullylabs|holdermaps|gullysecurity)\.xyz$/.test(u.hostname)) return { end: u.href, status: r.status, seen, left: true }
        at = { host: u.hostname, p: u.pathname + u.search }
      }
      return { loop: true, seen }
    }
    for (const host of [MAIN, PAY, EMBED, API, HM, APP]) {
      const f = await follow(host, '/pay')
      check(`${host}/pay: one hop to gullypay.xyz, no loop`, !f.loop && !!f.left && f.end === 'https://gullypay.xyz/' && f.seen.length === 1, JSON.stringify(f))
    }
    check('/pay/ (trailing slash) and HEAD /pay: gullypay.xyz too', (await get(MAIN, '/pay/')).headers.location === 'https://gullypay.xyz/' && (await get(MAIN, '/pay', { method: 'HEAD' })).headers.location === 'https://gullypay.xyz/')
    check('checkout links keep working: /pay/<id> still goes to pay. and is served there', (await get(MAIN, INV)).headers.location === `${PAY_URL}${INV}` && (await get(PAY, INV)).status === 200)
    check('movedPageUrl: /pay is Gully Pay\'s product page on gullypay.xyz; checkouts never move', movedPageUrl('/pay') === 'https://gullypay.xyz/' && movedPageUrl('/pay/') === 'https://gullypay.xyz/' && movedPageUrl(INV) === null && movedPageUrl('/pay/l/x') === null)
    for (const [p, to] of [['/keys', '/#keys'], ['/alerts', '/#alerts'], ['/billing', '/#billing'], ['/settings', '/#settings'], ['/settings/profile', '/#settings/profile'], ['/billing/plans/', '/#billing/plans'], ['/dashboard', '/'], ['/overview', '/'], ['/team', '/#team'], ['/activity', '/#activity'], ['/tracker/alerts', '/#tracker/alerts']]) {
      const r = await get(APP, p)
      check(`app ${p}: 301 to the app's own ${to}, not a gullylabs.xyz 404`, r.status === 301 && r.headers.location === `https://${APP}${to}`, `${r.status} ${r.headers.location}`)
    }
    const appHome = await get(APP, '/')
    check('app /: still the dashboard (200)', appHome.status === 200 && !appHome.headers.location)
    check('app /pricing, /tracker, /score (site pages): still the same path on gullylabs.xyz', ['/pricing', '/tracker', '/score', '/analytics'].every((p) => appTabUrl(p) === null) && (await get(APP, '/pricing')).headers.location === `https://${MAIN}/pricing` && (await get(APP, '/tracker')).headers.location === `https://${MAIN}/tracker`)
    check('app /pay: Gully Pay moved, one hop to gullypay.xyz (like /chain-kit to gullychain.xyz)', (await get(APP, '/pay')).headers.location === 'https://gullypay.xyz/')
    check('app checkout links (/pay/<id>): still pay.', (await get(APP, INV)).headers.location === `${PAY_URL}${INV}`)
    const tabIds = (f) => [...read(f).matchAll(/\{ id: '([a-z-]+)', label:/g)].map((m) => m[1])
    const clientTabs = [...new Set([...tabIds('src/pages/developers/Dashboard.tsx'), ...tabIds('src/pages/developers/services/nav.ts')])]
    check('app tabs: the server\'s list is the dashboard\'s pages (Dashboard.tsx TABS + services/nav.ts)', sorted(clientTabs) === sorted(APP_TABS), JSON.stringify({ client: clientTabs, server: APP_TABS }))
    check('appTabUrl: unknown and deep paths are not app pages', appTabUrl('/pricing') === null && appTabUrl('/keys/a/b') === null && appTabUrl('/') === null)

    // 9. www.gullylabs.xyz (once its DNS record exists) answers 301 to the apex.
    const www = await get('www.gullylabs.xyz', '/tracker?x=1')
    check('www.gullylabs.xyz: 301 to gullylabs.xyz, path and query kept', www.status === 301 && www.headers.location === 'https://gullylabs.xyz/tracker?x=1', `${www.status} ${www.headers.location}`)
    check('www. of another Gully Labs host: 301 to the bare host too', (await get('www.docs.gullylabs.xyz', '/api')).headers.location === 'https://docs.gullylabs.xyz/api')

    // 3. No sitemap lists an address built from a missing path ("https://holdermaps.xyznull").
    check('validSitemapUrl: refuses null/undefined addresses, keeps real ones', !validSitemapUrl('https://holdermaps.xyznull') && !validSitemapUrl('https://gullylabs.xyzundefined') && !validSitemapUrl(null) && !validSitemapUrl('https://holdermaps.xyz/null') && validSitemapUrl('https://holdermaps.xyz/') && validSitemapUrl('https://holdermaps.xyz/solana/NVDA'))
    check('a ticker the short form cannot carry (BRK.B) has no holdermaps.xyz path (so it is left out, not "null")', holderShortPath('/holders/solana/BRK.B') === null)
    for (const host of [HM, MAIN, 'docs.gullylabs.xyz', APP, 'gullysecurity.xyz']) {
      const sm = await get(host, '/sitemap.xml')
      const locs = [...sm.text.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1])
      check(`${host} sitemap: every <loc> is a real address (no "null")`, sm.status === 200 && locs.length > 0 && locs.every(validSitemapUrl) && !/null|undefined/.test(sm.text), locs.filter((u) => !validSitemapUrl(u)).join(' '))
    }

    // 8. holdermaps.xyz shares HolderMaps' own kit image on every page; the token page has an h1 in every state.
    for (const p of ['/', `/gully/${GULLY_TOKEN}`, '/robinhood/TSLA', `/deep/hd_${'d'.repeat(16)}`]) {
      const r = await get(HM, p)
      check(`holdermaps ${p}: og:image is HolderMaps' own kit image`, r.status === 200 && r.text.includes('<meta property="og:image" content="https://holdermaps.xyz/brand/holdermaps/og-image-1200x630.png" />'), r.text.match(/<meta property="og:image"[^>]*>/)?.[0])
    }
    check('holdermaps token page: an h1 while the map loads or cannot be drawn (HoldersPage.tsx)', /m\?\.state !== 'ok' && \(\s*<h1/.test(read('src/pages/HoldersPage.tsx')))

    // 4. No waitlist copy on the docs; /chains (the old waitlist page) is a 301 to gullychain.xyz.
    const docsDir = path.join(ROOT, 'src', 'docs', 'pages')
    const docsSrc = fs.readdirSync(docsDir).map((f) => fs.readFileSync(path.join(docsDir, f), 'utf8')).join('\n') + read('src/docs/nav.ts')
    check('docs: no waitlist copy anywhere', !/waitlist|wait list/i.test(docsSrc), (docsSrc.match(/.{0,60}waitlist.{0,40}/i) ?? [''])[0])
    check('/chains (the old waitlist): 301 to gullychain.xyz', (await get(MAIN, '/chains')).headers.location === 'https://gullychain.xyz/')

    // 6. The "Powered by Gully Labs" badge: kit PNGs at ~30 px in the app's and the docs' footers and the blog's bottom
    //    row; not on gullylabs.xyz's own pages (it IS Gully Labs).
    const badge = read('src/components/PoweredByBadge.tsx')
    check('badge component: kit PNG 1x/2x/3x, 30 px (26 px on phones), new tab to gullylabs.xyz, alt text, no SVG', badge.includes('powered-by-gully-labs-dark-2x.png 2x') && badge.includes('powered-by-gully-labs-dark-3x.png 3x') && /height=\{30\}/.test(badge) && badge.includes('h-[30px]') && badge.includes('max-[600px]:h-[26px]') && badge.includes('href="https://gullylabs.xyz/"') && badge.includes('alt="Powered by Gully Labs"') && !badge.includes('.svg'))
    for (const [f, tag] of [['src/docs/DocsLayout.tsx', '<PoweredByBadge />'], ['src/pages/developers/AppShell.tsx', '<BadgeFooterRow />'], ['src/pages/developers/DevelopersPage.tsx', '<BadgeFooterRow />']]) check(`badge in the footer: ${f}`, read(f).includes(tag))
    check('main site: no 48 px Powered-by badge in the trust band', !read('src/console/ui.tsx').includes('powered-by-gully-labs-dark.png'))
    const kit = 'C:/Users/Admin/Desktop/GULLY LABS GRAPHICS/Gully Labs/brand-kit/badges'
    if (fs.existsSync(kit)) check('badge PNGs are byte-exact kit copies (site and blog theme)', ['', '-2x', '-3x'].every((s) => { const k = fs.readFileSync(path.join(kit, `powered-by-gully-labs-dark${s}.png`)); return k.equals(fs.readFileSync(path.join(ROOT, 'public', 'brand', 'badges', `powered-by-gully-labs-dark${s}.png`))) && k.equals(fs.readFileSync(path.join(ROOT, 'ghost', 'theme', 'gully', 'assets', 'brand', 'badges', `powered-by-gully-labs-dark${s}.png`))) }))
    const blogCss = read('ghost/theme/gully/assets/css/screen.css')
    const blogFoot = read('ghost/theme/gully/partials/footer.hbs')
    check('blog: the badge is 30 px (26 px on phones), right of the copyright', blogCss.includes('.gl-powered img { width: auto; height: 30px; }') && blogCss.includes('.gl-powered img { height: 26px; }') && blogFoot.indexOf('gl-footer-copy') < blogFoot.indexOf('brand/badge'))

    // 7. The blog never links the retired developers.gullylabs.xyz (no DNS): the theme points it at the docs.
    check('blog theme: developers.gullylabs.xyz links are rewritten to docs.gullylabs.xyz', read('ghost/theme/gully/assets/js/gully.js').includes("'developers.gullylabs.xyz': 'https://docs.gullylabs.xyz/'"))
    const themeFiles = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? themeFiles(path.join(d, e.name)) : /\.(hbs|css)$/.test(e.name) ? [path.join(d, e.name)] : []))
    check('blog theme templates: no developers.gullylabs.xyz link', themeFiles(path.join(ROOT, 'ghost', 'theme', 'gully')).every((f) => !fs.readFileSync(f, 'utf8').includes('developers.gullylabs.xyz')))
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
