// Host routing for the Gully Labs App (app.gullylabs.xyz) and its old host (developers.gullylabs.xyz).
//
//   npm run test:app-host        (no build needed)
//
// The real server runs IN THIS PROCESS on port 8798 (TEST_PORT overrides) with a fresh temporary
// DATA_DIR and a stub dist/index.html; every request names its host in the Host header, as Cloudflare does.
// Checks: developers.* answers 301 to the app for pages (path and query kept) but never for /api/*;
// the app serves the dashboard with the strict headers and its own head tags; robots and sitemaps per host;
// the main site's /developers and /app move to the app; SIWE and the __Host- cookie per host.

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { guardTestRun, hostRequest, hostSignIn, makeChecker } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8798
const BASE = `http://localhost:${PORT}`
await guardTestRun(PORT)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-app-host-'))
const dist = path.join(tmp, 'dist')
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
fs.writeFileSync(
  path.join(dist, 'index.html'),
  '<!doctype html><html><head><title>Gully Labs</title><meta name="description" content="x" /><link rel="canonical" href="https://gullylabs.xyz/" /></head><body><div id="root"></div></body></html>',
)
fs.writeFileSync(path.join(dist, 'assets', 'index-abcdef12.js'), 'console.log(1)')

Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: dist,
  ADMIN_TOKEN: crypto.randomBytes(24).toString('hex'),
  TRACKER_LOOP: 'off',
  TRACKER_SKIP_APIS: '1',
  DEEPCORE_LOOP: 'off',
  GULLY_RPC_1: 'http://127.0.0.1:9',
  GULLY_RPC_56: 'http://127.0.0.1:9',
  GULLY_RPC_8453: 'http://127.0.0.1:9',
  GULLY_RPC_42161: 'http://127.0.0.1:9',
  ASK_REMOTE: 'off',
})
delete process.env.TELEGRAM_BOT_TOKEN
delete process.env.GULLY_TREASURY_ADDRESS
delete process.env.ANTHROPIC_API_KEY

await import('../server/server.mjs')
const { INVITE_LINK } = await import('../server/workspaces.mjs')
await new Promise((r) => setTimeout(r, 300))

const t = makeChecker()
const { check } = t
const APP = 'app.gullylabs.xyz'
const OLD = 'developers.gullylabs.xyz'
const MAIN = 'gullylabs.xyz'
const get = (host, p, opts) => hostRequest(BASE, host, p, opts)

try {
  /* ------------------------------------------------ developers.* -> app --- */
  {
    const root = await get(OLD, '/')
    check('developers /: 301 to https://app.gullylabs.xyz/', root.status === 301 && root.headers.location === `https://${APP}/`, `${root.status} ${root.headers.location}`)
    const q = await get(OLD, '/?ref=docs&x=1')
    check('developers /?query: the query is kept', q.status === 301 && q.headers.location === `https://${APP}/?ref=docs&x=1`, q.headers.location)
    const deep = await get(OLD, '/some/page?a=b')
    check('developers /some/page: same path and query on the app', deep.status === 301 && deep.headers.location === `https://${APP}/some/page?a=b`, deep.headers.location)
    const head = await get(OLD, '/', { method: 'HEAD' })
    check('developers HEAD /: 301 too', head.status === 301 && head.headers.location === `https://${APP}/`)
    check('the redirect is cacheable for an hour', /max-age=3600/.test(root.headers['cache-control'] ?? ''))
    check('the redirect carries the strict frame headers', /frame-ancestors 'none'/.test(root.headers['content-security-policy'] ?? '') && root.headers['x-frame-options'] === 'DENY')

    // The API stays on the old host during the transition: a 301 on a POST breaks clients.
    const nonce = await get(OLD, '/api/developer/nonce')
    check('developers GET /api/developer/nonce: answered, not redirected', nonce.status === 200 && /^[a-f0-9]{32}$/.test(nonce.data?.nonce ?? ''), String(nonce.status))
    const acct = await get(OLD, '/api/developer/account')
    check('developers GET /api/developer/account: 401, not redirected', acct.status === 401 && !acct.headers.location)
    const post = await get(OLD, '/api/developer/logout', { method: 'POST', body: {}, headers: { 'x-requested-with': 'gully', origin: `https://${OLD}` } })
    check('developers POST /api/developer/logout: answered, not redirected', post.status === 200 && !post.headers.location, String(post.status))
    const siwe = await get(OLD, '/api/developer/siwe', { method: 'POST', body: {} })
    check('developers POST /api/developer/siwe: answered (403 without the header), not redirected', siwe.status === 403 && !siwe.headers.location)
    const plans = await get(OLD, '/api/plans')
    check('developers GET /api/plans: answered, not redirected', plans.status === 200)
    const asset = await get(OLD, '/assets/index-abcdef12.js')
    check('developers: build files are still served (tabs left open)', asset.status === 200)

    const robots = await get(OLD, '/robots.txt')
    check('developers robots.txt points to the app sitemap', robots.status === 200 && robots.text.includes(`Sitemap: https://${APP}/sitemap.xml`) && !robots.text.includes(OLD), robots.text)
    const map = await get(OLD, '/sitemap.xml')
    check('developers sitemap.xml is gone (404)', map.status === 404)
  }

  /* ---------------------------------------------------------------- app.* --- */
  {
    const home = await get(APP, '/')
    check('app /: 200 with the dashboard shell', home.status === 200 && home.text.includes('<div id="root">'), String(home.status))
    check('app /: title "Gully Labs App · keys, alerts, analytics, payments"', home.text.includes('<title>Gully Labs App · keys, alerts, analytics, payments</title>'))
    check('app /: canonical is the app', home.text.includes(`<link rel="canonical" href="https://${APP}/" />`))
    check("app /: CSP frame-ancestors 'none' and X-Frame-Options DENY", /frame-ancestors 'none'/.test(home.headers['content-security-policy'] ?? '') && home.headers['x-frame-options'] === 'DENY')
    check('app /: HSTS on', /max-age=31536000/.test(home.headers['strict-transport-security'] ?? ''))
    const page = await get(APP, '/tracker?x=1')
    check('app /tracker: 301 to the main site, path and query kept', page.status === 301 && page.headers.location === `https://${MAIN}/tracker?x=1`, page.headers.location)
    const robots = await get(APP, '/robots.txt')
    check('app robots.txt names its sitemap', robots.status === 200 && robots.text.includes(`Sitemap: https://${APP}/sitemap.xml`) && /Disallow: \/api\//.test(robots.text))
    const map = await get(APP, '/sitemap.xml')
    check('app sitemap.xml lists the app home only', map.status === 200 && map.text.includes(`<loc>https://${APP}/</loc>`) && (map.text.match(/<loc>/g) ?? []).length === 1)
    check('app GET /api/developer/account: 401 (served here)', (await get(APP, '/api/developer/account')).status === 401)
  }

  /* --------------------------------------------------------- main site --- */
  {
    for (const p of ['/developers', '/developers/', '/developers/keys', '/app', '/app/']) {
      const r = await get(MAIN, p)
      check(`main ${p}: 301 to the app`, r.status === 301 && r.headers.location === `https://${APP}/`, `${r.status} ${r.headers.location}`)
    }
    const robots = await get(MAIN, '/robots.txt')
    check('main robots.txt names the main sitemap', robots.text.includes(`Sitemap: https://${MAIN}/sitemap.xml`))
    const map = await get(MAIN, '/sitemap.xml')
    check('main sitemap.xml does not list the app or developers hosts', map.status === 200 && !map.text.includes(APP) && !map.text.includes(OLD))
    const home = await get(MAIN, '/')
    check("main /: frame-ancestors 'self' (not the app's strict rule)", /frame-ancestors 'self'/.test(home.headers['content-security-policy'] ?? ''))
    check('main /approach is not swallowed by the /app redirect', (await get(MAIN, '/approach')).status === 404)
  }

  /* ------------------------------------------------------ localhost --- */
  {
    for (const p of ['/developers', '/app']) {
      const r = await get(`localhost:${PORT}`, p)
      check(`localhost ${p}: served (no redirect)`, r.status === 200, String(r.status))
    }
  }

  /* --------------------------------------------- SIWE and cookies per host --- */
  {
    const cookies = {}
    for (const host of [APP, OLD]) {
      const w = privateKeyToAccount(generatePrivateKey())
      const r = await hostSignIn(BASE, host, w)
      const c = String(r.headers['set-cookie'] ?? '')
      cookies[host] = c.split(';')[0]
      check(`${host}: SIWE for its own domain signs in`, r.status === 200, r.data?.error)
      check(`${host}: __Host-gl_dev cookie, Secure, Path=/, no Domain`, /^__Host-gl_dev=/.test(c) && /; Secure/.test(c) && /Path=\//.test(c) && !/Domain=/i.test(c) && /HttpOnly/.test(c))
      const other = host === APP ? OLD : APP
      const cross = await hostSignIn(BASE, host, w, { domain: other })
      check(`${host}: a message for ${other} is refused`, cross.status === 401, cross.data?.error)
    }
    check('app session reads the account on the app', (await get(APP, '/api/developer/account', { headers: { cookie: cookies[APP] } })).status === 200)
    check('developers session reads the account on the old host', (await get(OLD, '/api/developer/account', { headers: { cookie: cookies[OLD] } })).status === 200)
    const main = await hostSignIn(BASE, MAIN, privateKeyToAccount(generatePrivateKey()))
    check('main site: sign-in refused with "Sign in at https://app.gullylabs.xyz."', main.status === 400 && main.data?.error === `Sign in at https://${APP}.`, main.data?.error)
  }

  /* ---------------------------------------------------------------- links --- */
  check('invite links point at the app', INVITE_LINK === `https://${APP}/#invite=`, INVITE_LINK)
} finally {
  console.log(`\n${t.passed} passed, ${t.failed} failed`)
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(t.failed ? 1 : 0)
}
