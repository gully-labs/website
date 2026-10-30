// Sign in with Gully ID on the Gully Labs App (app.gullylabs.xyz).
//
//   npm run test:gully-id     (no build needed) starts its own server IN THIS PROCESS on port 8806 (TEST_PORT overrides)
//                              with a fresh DATA_DIR and a mock Gully ID (/v1/profile) on a random local port.
//
// Checks: the official button renders (kit SVG, label "Sign in with Gully ID") and is on the signed-out app page; the
// SVG is byte-identical to the Gully ID brand kit v1; the app host's CSP allows https://gullyid.xyz scripts (the main
// site's does not); POST /api/developer/gully signs in as the Gully ID's wallet and refuses bad tokens, tokens made
// for another app, Gully IDs without a wallet, cross-site posts and GULLY_ID_SIGNIN=off.

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerHooks } from 'node:module'
import { guardTestRun, hostRequest, makeChecker, makeClient } from './test-helpers.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const t = makeChecker()
const check = t.check

/* ------------------------------------------------- the button, offline --- */

// The app imports its own modules without an extension; Vite adds it, Node needs help (as in test-chart-kit.mjs).
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !path.extname(spec)) return next(`${spec}.ts`, ctx)
      throw e
    }
  },
})
const { renderToStaticMarkup } = await import('react-dom/server')
const { GullyIdButton, GULLY_ID_BUTTON_SRC, GULLY_ID_URL, GULLY_ID_CLIENT_ID, isGullyIdReturn } = await import('../src/pages/developers/gullyId.ts')

const html = renderToStaticMarkup(GullyIdButton({ onClick: () => {} }))
// React 19 may hoist a <link rel="preload"> for the image ahead of the button.
check('the Gully ID option renders as a button', /<button[^>]*type="button"[^>]*>\s*<img /.test(html), html.slice(0, 120))
check('the button is labelled "Sign in with Gully ID"', html.includes('aria-label="Sign in with Gully ID"') && html.includes('alt="Sign in with Gully ID"'))
check('the button shows the kit SVG', html.includes(`src="${GULLY_ID_BUTTON_SRC}"`) && GULLY_ID_BUTTON_SRC === '/brand/gullyid/sign-in-with-gullyid-dark-m.svg')
const busy = renderToStaticMarkup(GullyIdButton({ onClick: () => {}, busy: true }))
check('busy: disabled + aria-busy', busy.includes('disabled=""') && busy.includes('aria-busy="true"'))
check('issuer is gullyid.xyz, client gully-labs', GULLY_ID_URL === 'https://gullyid.xyz' && GULLY_ID_CLIENT_ID === 'gully-labs')
check('redirect return detected only with code + state', isGullyIdReturn('?code=a&state=b') && !isGullyIdReturn('?code=a') && !isGullyIdReturn(''))

const page = fs.readFileSync(path.join(root, 'src/pages/developers/DevelopersPage.tsx'), 'utf8')
check('the signed-out app page renders the Gully ID option next to Connect wallet', /<GullyIdButton onClick=\{gully\}/.test(page) && page.indexOf('<GullyIdButton') > page.indexOf("'Connect wallet'"))

// Brand kit v1 (gully-id docs/brand-kit.md): never redraw or re-export, copy byte-identically.
const KIT_SHA = 'cba6285cfcc08f3b782f4199fec8a02665a179b85ee5b6f1d02a299047540046'
const svg = fs.readFileSync(path.join(root, 'public', GULLY_ID_BUTTON_SRC))
check('the button SVG is byte-identical to the Gully ID brand kit', crypto.createHash('sha256').update(svg).digest('hex') === KIT_SHA)

/* ------------------------------------------------- the server --- */

const WALLET = '0x' + crypto.randomBytes(20).toString('hex')
const PROFILES = {
  good: { sub: 'u-1', client: 'gully-labs', gullyName: 'tester.gully', wallet: { chainId: 485590, address: WALLET.toUpperCase().replace('0X', '0x'), kind: 'kernel-v3.3' } },
  other: { sub: 'u-2', client: 'gully-app', wallet: { chainId: 485590, address: WALLET, kind: 'kernel-v3.3' } },
  nowallet: { sub: 'u-3', client: 'gully-labs', wallet: null },
}
const mock = http.createServer((req, res) => {
  const tok = String(req.headers.authorization ?? '').replace(/^Bearer /, '')
  if (req.url !== '/v1/profile' || !PROFILES[tok]) return res.writeHead(401, { 'content-type': 'application/json' }).end('{"code":"unauthorized"}')
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(PROFILES[tok]))
})
await new Promise((r) => mock.listen(0, '127.0.0.1', r))
const MOCK = `http://127.0.0.1:${mock.address().port}`

const PORT = Number(process.env.TEST_PORT) || 8806
await guardTestRun(PORT)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-gid-'))
Object.assign(process.env, { PORT: String(PORT), DATA_DIR: tmp, TRACKER_DATA: path.join(tmp, 'tracker-history.json'), DIST_DIR: path.join(tmp, 'no-dist'), ADMIN_TOKEN: crypto.randomBytes(24).toString('hex'), TRACKER_LOOP: 'off', DEEPCORE_LOOP: 'off', TRACKER_SKIP_APIS: '1', ASK_REMOTE: 'off', GULLY_ID_URL: MOCK })
for (const k of ['TELEGRAM_BOT_TOKEN', 'ANTHROPIC_API_KEY', 'GULLY_TREASURY_ADDRESS', 'GULLY_ID_SIGNIN', 'GULLY_ID_CLIENT_ID']) delete process.env[k]
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))
await import('../server/server.mjs')
await new Promise((r) => setTimeout(r, 300))
const BASE = `http://localhost:${PORT}`

// CSP: the SDK may load on the app host only.
const app = await hostRequest(BASE, 'app.gullylabs.xyz', '/')
const appCsp = String(app.headers['content-security-policy'] ?? '')
const scriptSrc = (csp) => (csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '')
// GULLY_ID_URL points at the mock here, so the app host names the mock's origin; production names https://gullyid.xyz.
check('app host CSP: script-src allows the Gully ID origin', scriptSrc(appCsp).includes(MOCK), scriptSrc(appCsp))
check('app host keeps COOP same-origin-allow-popups (the popup can answer)', app.headers['cross-origin-opener-policy'] === 'same-origin-allow-popups')
const main = await hostRequest(BASE, 'gullylabs.xyz', '/')
check('main site CSP does not load Gully ID scripts', !scriptSrc(String(main.headers['content-security-policy'] ?? '')).includes(MOCK))
const { gullyIdConfig } = await import('../server/gully-id.mjs')
check('default issuer https://gullyid.xyz, client gully-labs, on', JSON.stringify(gullyIdConfig({})) === JSON.stringify({ enabled: true, url: 'https://gullyid.xyz', clientId: 'gully-labs' }))
check('a non-https issuer falls back to https://gullyid.xyz', gullyIdConfig({ GULLY_ID_URL: 'http://evil.example' }).url === 'https://gullyid.xyz')

const c = makeClient(BASE)
const signIn = async (accessToken, extra) => {
  const r = await c.post('/api/developer/gully', { accessToken }, { useCookie: false, ...extra })
  return r
}
const bad = await signIn('nope')
check('a bad token is refused (401)', bad.status === 401 && bad.data?.code === 'gully-token-invalid', `${bad.status}`)
const other = await signIn('other')
check('a token made for another Gully app is refused (401)', other.status === 401 && other.data?.code === 'gully-wrong-client', `${other.status}`)
const none = await signIn('nowallet')
check('a Gully ID without a wallet gets a clear 409', none.status === 409 && /wallet/.test(none.data?.error ?? ''), `${none.status}`)
const xsite = await c.call('/api/developer/gully', { method: 'POST', body: { accessToken: 'good' } })
check('without X-Requested-With (cross-site) it is refused (403)', xsite.status === 403, `${xsite.status}`)
const foreign = await signIn('good', { headers: { origin: 'https://evil.example' } })
check('a foreign Origin is refused (403)', foreign.status === 403, `${foreign.status}`)

const ok = await signIn('good')
const cookie = (ok.headers.get('set-cookie') ?? '').split(';')[0]
check('a good token signs in (200, session cookie, HttpOnly)', ok.status === 200 && !!cookie && /HttpOnly/i.test(ok.headers.get('set-cookie') ?? ''), `${ok.status}`)
check('the account is the Gully ID wallet, lower-cased', ok.data?.address === WALLET && ok.data?.via === 'gully-id')
c.cookie = cookie
const s = await c.call('/api/developer/session')
check('the session is signed in', s.data?.signedIn === true)
const acct = await c.call('/api/developer/account')
check('/account answers for the Gully ID wallet', acct.status === 200 && String(acct.data?.address ?? '').toLowerCase() === WALLET, `${acct.status}`)

process.env.GULLY_ID_SIGNIN = 'off'
const off = await signIn('good')
check('GULLY_ID_SIGNIN=off turns the route off (404)', off.status === 404, `${off.status}`)
delete process.env.GULLY_ID_SIGNIN

mock.close()
console.log(`\n${t.passed} passed, ${t.failed} failed`)
process.exit(t.failed ? 1 : 0)
