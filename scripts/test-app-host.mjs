// Host routing for the Gully Labs App (app.gullylabs.xyz); its old host (developers.*) is retired.
//
//   npm run test:app-host        (no build needed)
//
// The real server runs IN THIS PROCESS on port 8798 (TEST_PORT overrides) with a fresh temporary
// DATA_DIR and a stub dist/index.html; every request names its host in the Host header, as Cloudflare does.
// Checks: the retired developers.* host is no longer routed (no redirect, no sign-in);
// the app serves the dashboard with the strict headers and its own head tags; robots and sitemaps per host;
// the main site's /developers and /app answer 301 to https://app.gullylabs.xyz/; SIWE and the __Host- cookie.

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
  GULLY_RPC_1: 'http://127.0.0.1:9',
  GULLY_RPC_56: 'http://127.0.0.1:9',
  GULLY_RPC_8453: 'http://127.0.0.1:9',
  GULLY_RPC_42161: 'http://127.0.0.1:9',
  GULLY_RPC_10: 'http://127.0.0.1:9',
  GULLY_RPC_137: 'http://127.0.0.1:9',
  GULLY_RPC_43114: 'http://127.0.0.1:9',
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
  /* ------------------------------------------ the retired developers.* host --- */
  {
    // Its DNS record is gone (owner, 2026-10-17); nothing routes it any more, so a stray request is just
    // the main site: no redirect to the app, no SIWE, never the app's head tags.
    const root = await get(OLD, '/')
    check('developers.*: no longer routed (no 301, not the app)', root.status === 200 && !root.headers.location && !root.text.includes('<title>Gully Labs App'), `${root.status} ${root.headers.location ?? ''}`)
    const siwe = await hostSignIn(BASE, OLD, privateKeyToAccount(generatePrivateKey()))
    check('developers.*: SIWE refused, naming the app', siwe.status === 400 && siwe.data?.error === `Sign in at https://${APP}.`, siwe.data?.error)
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
    for (const host of [APP]) {
      const w = privateKeyToAccount(generatePrivateKey())
      const r = await hostSignIn(BASE, host, w)
      const c = String(r.headers['set-cookie'] ?? '')
      cookies[host] = c.split(';')[0]
      check(`${host}: SIWE for its own domain signs in`, r.status === 200, r.data?.error)
      check(`${host}: __Host-gl_dev cookie, Secure, Path=/, no Domain`, /^__Host-gl_dev=/.test(c) && /; Secure/.test(c) && /Path=\//.test(c) && !/Domain=/i.test(c) && /HttpOnly/.test(c))
      const other = OLD
      const cross = await hostSignIn(BASE, host, w, { domain: other })
      check(`${host}: a message for ${other} is refused`, cross.status === 401, cross.data?.error)
    }
    check('app session reads the account on the app', (await get(APP, '/api/developer/account', { headers: { cookie: cookies[APP] } })).status === 200)
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
