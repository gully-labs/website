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
    check('holdermaps /: 200, the app shell, titled HolderMaps, canonical holdermaps.xyz/', home.status === 200 && home.text.includes('<div id="root">') && /<title>[^<]*HolderMaps[^<]*<\/title>/.test(home.text) && home.text.includes('<link rel="canonical" href="https://holdermaps.xyz/" />') && home.text.includes('<meta property="og:title" content="Holder Map: who really holds a token · HolderMaps" />'), home.text.slice(0, 400))
    check('holdermaps /: indexable (no noindex) and keeps the analytics beacon and the site CSP', !/noindex/.test(home.text) && !/noindex/.test(home.headers['x-robots-tag'] ?? '') && home.text.includes('analytics.gullylabs.xyz') && /analytics\.gullylabs\.xyz/.test(home.headers['content-security-policy'] ?? '') && /connect-src 'self' https: wss:/.test(home.headers['content-security-policy'] ?? ''))
    check('holdermaps /: no cookie, HSTS, framed only by itself', !home.headers['set-cookie'] && /max-age=31536000/.test(home.headers['strict-transport-security'] ?? '') && /frame-ancestors 'self'/.test(home.headers['content-security-policy'] ?? ''))
    check('holdermaps /: no holdermaps-primary tag while HOLDERMAPS_PRIMARY is unset', !home.text.includes('holdermaps-primary'))
    const map = await get(HM, `/base/${TOKEN}`)
    check('holdermaps /<chain>/<token>: 200, HolderMaps title, holdermaps.xyz canonical, the map card as share image', map.status === 200 && /<title>Who holds [^<]+ on Base · HolderMaps<\/title>/.test(map.text) && map.text.includes(`<link rel="canonical" href="https://holdermaps.xyz/base/${TOKEN}" />`) && map.text.includes(`/api/holders/base/${TOKEN}/card.png`), map.text.match(/<title>[^<]*<\/title>/)?.[0])
    const deep = await get(HM, `/deep/${DEEP}`)
    check('holdermaps /deep/<id>: 200, noindex, no canonical (private by link)', deep.status === 200 && /<meta name="robots" content="noindex"/.test(deep.text) && !/rel="canonical"/.test(deep.text) && /HolderMaps/.test(deep.text.match(/<title>[^<]*<\/title>/)?.[0] ?? ''))
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
    check('holdermaps manifest: installs as HolderMaps', man.status === 200 && man.data?.name === 'HolderMaps', man.text.slice(0, 120))
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
