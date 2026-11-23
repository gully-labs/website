// Admin Integrations (server/admin-integrations.mjs): write-only Chain Kit settings behind a passkey step-up.
//
//   npm run test:admin-integrations        (no build needed)
//
// The real server runs IN THIS PROCESS on TEST_PORT (default 8799) with a temporary DATA_DIR and integrations folder;
// gullyid.xyz is a mock here (authorize is simulated; each code carries the amr and auth_time the id_token will hold).
// Covers: the step-up (passkey, fresh, same account), the break-glass token cannot write, the allow-list, write-only
// answers, the files (content, mode 0400, removal), refusals of wallet keys and seed phrases, the one hex-key exception,
// rate limit, the audit log, and that no OVH text reaches the public app source.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { guardTestRun, hostRequest, makeChecker } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8799
const BASE = `http://localhost:${PORT}`
await guardTestRun(PORT)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-admin-int-'))
const dist = path.join(tmp, 'dist')
const DIR = path.join(tmp, 'integrations')
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true })
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><title>Gully Labs</title></head><body><div id="root"></div></body></html>')

// ---- mock gullyid.xyz
const codes = new Map()
const tokens = new Map()
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
let clock = Date.now()
const mock = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const u = new URL(req.url, 'http://x')
    const send = (status, o) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(o))
    }
    if (u.pathname === '/oauth2/token' && req.method === 'POST') {
      const f = new URLSearchParams(body)
      const c = codes.get(f.get('code'))
      codes.delete(f.get('code'))
      const ok = c && f.get('client_id') === 'gully-labs' && f.get('redirect_uri') === c.redirectUri && crypto.createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url') === c.challenge
      if (!ok) return send(400, { error: 'invalid_grant' })
      const at = crypto.randomBytes(16).toString('hex')
      tokens.set(at, c)
      return send(200, { access_token: at, token_type: 'bearer', id_token: `${b64u({ alg: 'RS256' })}.${b64u({ iss: `${ISSUER}/`, aud: ['gully-labs'], sub: c.sub, nonce: c.nonce, exp: Math.floor(clock / 1000) + 3600, amr: c.amr, auth_time: c.authTime })}.sig` })
    }
    if (u.pathname === '/v1/profile') {
      const t = tokens.get(String(req.headers.authorization ?? '').replace(/^Bearer /, ''))
      return t ? send(200, { sub: t.sub, name: 'Owner', client: 'gully-labs' }) : send(401, { error: 'unauthorized' })
    }
    send(404, { error: 'not found' })
  })
})
await new Promise((r) => mock.listen(0, '127.0.0.1', r))
const ISSUER = `http://127.0.0.1:${mock.address().port}`
const OWNER = 'owner-sub-0001'
const OTHER = 'other-admin-2'
const ADMIN = crypto.randomBytes(24).toString('hex')

Object.assign(process.env, {
  PORT: String(PORT), DATA_DIR: tmp, TRACKER_DATA: path.join(tmp, 'tracker-history.json'), DIST_DIR: dist,
  ADMIN_TOKEN: ADMIN, TRACKER_LOOP: 'off', TRACKER_SKIP_APIS: '1', DEEPCORE_LOOP: 'off', ASK_REMOTE: 'off',
  IPFS_API: 'http://127.0.0.1:9', IPFS_GATEWAY: 'http://127.0.0.1:9', GULLYPAY_STATUS_URL: 'http://127.0.0.1:9', GULLYRPC_STATUS_URL: 'http://127.0.0.1:9',
  GULLY_ID_ISSUER: ISSUER, ADMIN_GULLY_SUBS: `${OWNER}, ${OTHER}`, ADMIN_PASSWORD_LOGIN: 'on', CHAINKIT_INTEGRATIONS_DIR: DIR,
})
for (const k of ['TELEGRAM_BOT_TOKEN', 'GULLY_TREASURY_ADDRESS', 'ANTHROPIC_API_KEY', 'ADMIN_GULLY_ID', 'ADMIN_GULLY_ID_CLIENT_ID', 'CHAINKIT_INTEGRATIONS_GID', 'CHAINKIT_INTEGRATIONS_UID']) delete process.env[k]

const logs = []
const realLog = console.log
console.log = (...a) => (logs.push(a.join(' ')), realLog(...a))

await import('../server/server.mjs')
const auth = await import('../server/admin-auth.mjs')
const ints = await import('../server/admin-integrations.mjs')
auth.configureAdminAuth({ now: () => clock })
await new Promise((r) => setTimeout(r, 300))

const t = makeChecker()
const { check } = t
const A = 'admin.gullylabs.xyz'
const get = (p, opts) => hostRequest(BASE, A, p, opts)
const cookies = (r) => [r.headers['set-cookie'] ?? []].flat()
const sessionCookie = (r) => cookies(r).find((c) => c.startsWith('__Host-gl_admin=') && !/Max-Age=0/.test(c))

/** Start (or step up) -> simulated authorize at the mock -> callback. */
async function round(startPath, { sub = OWNER, amr = ['passkey'], authTime = Math.floor(clock / 1000), cookie } = {}) {
  const s = await get(startPath, { headers: cookie ? { cookie } : {} })
  if (s.status !== 302) return { start: s }
  const loc = new URL(s.headers.location)
  const q = loc.searchParams
  const tx = cookies(s).find((c) => c.startsWith('gid_admin_tx=')).split(';')[0]
  const code = crypto.randomBytes(8).toString('hex')
  codes.set(code, { sub, nonce: q.get('nonce'), challenge: q.get('code_challenge'), redirectUri: q.get('redirect_uri'), amr, authTime })
  const r = await get(`/auth/gully/callback?code=${code}&state=${encodeURIComponent(q.get('state'))}`, { headers: { cookie: [tx, cookie].filter(Boolean).join('; ') } })
  return { start: s, q, r }
}
async function signIn(sub = OWNER) {
  const { r } = await round('/auth/gully/start', { sub, amr: ['pwd'] })
  const cookie = sessionCookie(r).split(';')[0]
  const csrf = (await get('/api/admin/auth/session', { headers: { cookie } })).data.csrf
  return { cookie, bearer: csrf }
}
const api = (p, { cookie, bearer, method = 'GET', body } = {}) => get(p, { method, body, headers: { ...(cookie ? { cookie } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } })
const put = (who, name, value) => api(`/api/admin/integrations/${name}`, { ...who, method: 'PUT', body: { value } })
const del = (who, name) => api(`/api/admin/integrations/${name}`, { ...who, method: 'DELETE' })
const fileOf = (name) => path.join(DIR, name)
const posix = process.platform !== 'win32'

const KEY = 'Ab12Cd34Ef56Gh78'
const SECRET = 'q'.repeat(10) + 'Z9'.repeat(11)
try {
  {
    const l = await api('/api/admin/integrations', { bearer: ADMIN })
    const chainkit = l.data?.groups?.filter((g) => !g.section) ?? []
    const names = chainkit.flatMap((g) => g.fields.map((f) => f.name))
    check('list: the OVH card and the Gully Pay webhook key, every field unset', l.status === 200 && chainkit.map((g) => g.title).join() === 'OVH,Gully Pay' && names.join() === 'OVH_APPLICATION_KEY,OVH_APPLICATION_SECRET,OVH_CONSUMER_KEY,OVH_PROJECT_ID,OVH_ENDPOINT,OVH_REGION,GULLYPAY_CHAINKIT_WEBHOOK_SECRET' && chainkit.every((g) => g.fields.every((f) => f.set === false)))
    const ovh = l.data.groups.find((g) => g.id === 'ovh').fields
    check('list: endpoint and region are optional with their defaults (ovh-eu, GRA11)', ovh.find((f) => f.name === 'OVH_ENDPOINT').optional && ovh.find((f) => f.name === 'OVH_ENDPOINT').dflt === 'ovh-eu' && ovh.find((f) => f.name === 'OVH_REGION').dflt === 'GRA11' && !ovh.find((f) => f.name === 'OVH_PROJECT_ID').optional)
    check('list: the break-glass token is shown as such, with no step-up', l.data.stepUp.via === 'token' && l.data.stepUp.until === null)
    check('list: signed out is 401', (await api('/api/admin/integrations')).status === 401)
    check('list: not on the public host', (await hostRequest(BASE, 'gullylabs.xyz', '/api/admin/integrations', { headers: { authorization: `Bearer ${ADMIN}` } })).status === 404)
    const w = await put({ bearer: ADMIN }, 'OVH_APPLICATION_KEY', KEY)
    check('the break-glass token cannot write (403 gully_id_required), nothing written', w.status === 403 && w.data.code === 'gully_id_required' && !fs.existsSync(fileOf('OVH_APPLICATION_KEY')))
  }

  const owner = await signIn()
  {
    const w = await put(owner, 'OVH_APPLICATION_KEY', KEY)
    check('a Gully ID session without a step-up is 401 step_up_required', w.status === 401 && w.data.code === 'step_up_required' && w.data.stepup === '/auth/gully/stepup' && !fs.existsSync(fileOf('OVH_APPLICATION_KEY')))
    check('the cookie alone (no CSRF bearer) is refused', (await api('/api/admin/integrations/OVH_APPLICATION_KEY', { cookie: owner.cookie, method: 'PUT', body: { value: KEY } })).status === 403)
    const tokenStep = await get('/auth/gully/stepup', { headers: {} })
    check('step-up needs a Gully ID session (401 page, no redirect)', tokenStep.status === 401 && !tokenStep.headers.location)

    const pwd = await round('/auth/gully/stepup', { cookie: owner.cookie, amr: ['pwd'] })
    check('step-up: starts with prompt=login and max_age=300 on the same callback', pwd.start.status === 302 && pwd.q.get('prompt') === 'login' && pwd.q.get('max_age') === '300' && pwd.q.get('redirect_uri') === 'https://admin.gullylabs.xyz/auth/gully/callback')
    check('step-up: a password sign-in is not a passkey (not_passkey), still locked', pwd.r.status === 302 && /stepup=not_passkey/.test(pwd.r.headers.location) && (await put(owner, 'OVH_APPLICATION_KEY', KEY)).status === 401)
    const stale = await round('/auth/gully/stepup', { cookie: owner.cookie, authTime: Math.floor(clock / 1000) - 600 })
    check('step-up: a passkey sign-in 10 minutes old is stale', /stepup=stale/.test(stale.r.headers.location) && (await put(owner, 'OVH_APPLICATION_KEY', KEY)).status === 401)
    const other = await round('/auth/gully/stepup', { cookie: owner.cookie, sub: OTHER })
    check('step-up: another admin account cannot confirm for this session', /stepup=other_account/.test(other.r.headers.location) && (await put(owner, 'OVH_APPLICATION_KEY', KEY)).status === 401)
    const ok = await round('/auth/gully/stepup', { cookie: owner.cookie })
    check('step-up: a fresh passkey sign-in as the same admin opens writes, back on the Integrations section', ok.r.status === 302 && ok.r.headers.location === '/?stepup=ok#integrations')
    const l = await api('/api/admin/integrations', owner)
    check('list: shows until when the step-up holds (5 minutes)', l.data.stepUp.via === 'gully_id' && Math.abs(l.data.stepUp.until - (clock + 300_000)) < 2000)
  }

  {
    check('allow-list: an unknown name is 404 and writes nothing', (await put(owner, 'DATABASE_URL', 'postgres://x')).status === 404 && !fs.existsSync(fileOf('DATABASE_URL')))
    check('allow-list: a path is not a name', (await put(owner, '..%2Fetc', 'x')).status === 404)
    check('format: a value that is not an application key is 400', (await put(owner, 'OVH_APPLICATION_KEY', 'not a key!')).status === 400)
    check('format: an endpoint outside the list is 400', (await put(owner, 'OVH_ENDPOINT', 'ovh-mars')).status === 400)
    check('format: an empty value is 400', (await put(owner, 'OVH_REGION', '   ')).status === 400)
    const pk = await put(owner, 'OVH_APPLICATION_SECRET', '0x' + 'ab'.repeat(32))
    check('refused: a wallet private key (0x + 64 hex) is 422 wallet_secret_refused', pk.status === 422 && pk.data.code === 'wallet_secret_refused' && !fs.existsSync(fileOf('OVH_APPLICATION_SECRET')))
    check('refused: a bare 32-byte hex key on an OVH field', (await put(owner, 'OVH_PROJECT_ID', 'cd'.repeat(32))).status === 422)
    check('refused: a 12-word seed phrase', (await put(owner, 'OVH_CONSUMER_KEY', 'abandon ability able about above absent absorb abstract absurd abuse access accident')).status === 422)
    check('refused: a PEM signer key', (await put(owner, 'GULLYPAY_CHAINKIT_WEBHOOK_SECRET', '-----BEGIN EC PRIVATE KEY-----\nMHc\n-----END EC PRIVATE KEY-----')).status === 422)
    check('refused: a key hidden inside other text, even on the webhook field', (await put(owner, 'GULLYPAY_CHAINKIT_WEBHOOK_SECRET', `key=${'ef'.repeat(32)} more`)).status !== 200 && !fs.existsSync(fileOf('GULLYPAY_CHAINKIT_WEBHOOK_SECRET')))

    const w1 = await put(owner, 'OVH_APPLICATION_KEY', `  ${KEY}  `)
    check('write: 200, the answer has set + who/when and no value', w1.status === 200 && w1.data.field.set === true && w1.data.field.updatedBy === OWNER && !!w1.data.field.updatedAt && !w1.text.includes(KEY))
    check('write: the file holds the bare value (trimmed, no newline)', fs.readFileSync(fileOf('OVH_APPLICATION_KEY'), 'utf8') === KEY)
    if (posix) check('write: the file is mode 0400', (fs.statSync(fileOf('OVH_APPLICATION_KEY')).mode & 0o777) === 0o400)
    else check('write: the file is read-only (Windows has no POSIX modes)', (fs.statSync(fileOf('OVH_APPLICATION_KEY')).mode & 0o222) === 0)
    for (const [n, v] of [['OVH_APPLICATION_SECRET', SECRET], ['OVH_CONSUMER_KEY', SECRET.split('').reverse().join('')], ['OVH_PROJECT_ID', '0123456789abcdef0123456789abcdef'], ['OVH_ENDPOINT', 'ovh-ca'], ['OVH_REGION', 'SBG5']]) await put(owner, n, v)
    const hex = 'a1'.repeat(32)
    const wh = await put(owner, 'GULLYPAY_CHAINKIT_WEBHOOK_SECRET', hex)
    check('the Gully Pay webhook signing key (sha256 hex by construction) is the one 64-hex value accepted', wh.status === 200 && fs.readFileSync(fileOf('GULLYPAY_CHAINKIT_WEBHOOK_SECRET'), 'utf8') === hex)
    const w2 = await put(owner, 'OVH_APPLICATION_KEY', 'Zz99Yy88Xx77Ww66')
    check('write: a second write replaces the file', w2.status === 200 && fs.readFileSync(fileOf('OVH_APPLICATION_KEY'), 'utf8') === 'Zz99Yy88Xx77Ww66')
    check('write: no temp files are left behind', fs.readdirSync(DIR).every((f) => !f.startsWith('.')))
    const l = await api('/api/admin/integrations', owner)
    check('list: every field set, with who and when', l.data.groups.filter((g) => !g.section).every((g) => g.fields.every((f) => f.set && f.updatedBy === OWNER && f.updatedAt)))
    const values = [KEY, 'Zz99Yy88Xx77Ww66', SECRET, '0123456789abcdef0123456789abcdef', hex] // (the region and endpoint are in the hints)
    check('list: write-only, no value comes back', !values.some((v) => l.text.includes(v)))
    const d = await del(owner, 'OVH_REGION')
    check('clear: the file is gone and the field shows unset (the runner uses GRA11)', d.status === 200 && d.data.field.set === false && !fs.existsSync(fileOf('OVH_REGION')))
    check('clear: POST is 405', (await api('/api/admin/integrations/OVH_REGION', { ...owner, method: 'POST', body: {} })).status === 405)
  }

  // ---------------------------------------------------------------- Developer tools group
  {
    const DEV = ints.INTEGRATION_GROUPS.filter((g) => g.section === 'devtools')
    const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
    const pem8 = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey
    const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'secp256k1', privateKeyEncoding: { type: 'sec1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey
    const PAT = 'v'.repeat(30) + 'Q7'.repeat(12)
    const OVSX = '11111111-2222-4333-8444-555555555555'
    const HOOK = 'w3bh00kS3cretValue_ABCDEFG123456'
    const l0 = await api('/api/admin/integrations', owner)
    const dg = l0.data.groups.filter((g) => g.section === 'devtools')
    check('devtools: the groups come after the Chain Kit ones, each with a guide and a where-used line', dg.length === 7 && dg.filter((g) => !g.guideOnly).every((g) => g.guide?.steps?.length && g.guide.links.length && g.usedIn) && l0.data.groups.slice(0, 2).every((g) => !g.section))
    check('devtools: the guide links are https and name the sign-up pages', dg.flatMap((g) => g.guide?.links ?? []).every((x) => x.url.startsWith('https://')) && JSON.stringify(dg).includes('marketplace.visualstudio.com/manage') && JSON.stringify(dg).includes('open-vsx.org/user-settings/tokens') && JSON.stringify(dg).includes('github.com/organizations/gully-labs/settings/apps/new') && JSON.stringify(dg).includes('addons.mozilla.org/developers/addon/api/key'))
    check('devtools: guide-only rows (npm, Apple, Tauri key, Windows signing) have notes and no fields', dg.find((g) => g.guideOnly).fields.length === 0 && dg.find((g) => g.guideOnly).notes.map((n) => n.id).join() === 'npm,apple,tauri,winsign')
    check('devtools: the three optional extension stores are marked optional', ['dt_chrome', 'dt_edge', 'dt_firefox'].every((id) => dg.find((g) => g.id === id).optionalGroup))
    const prog0 = l0.data.progress
    check('devtools: setup progress lists what blocks each tool', prog0.find((r) => r.tool.includes('VS Marketplace')).missing.join() === 'Publisher id,VS Marketplace token (PAT)' && prog0.find((r) => r.tool.includes('GitHub App')).missing.length === 3 && prog0.find((r) => r.tool === 'npm packages').heldByOwner && prog0.filter((r) => r.ready === true).length === 0)

    ints.resetLimits()
    const wv = (n, v) => put(owner, n, v)
    check('devtools: publisher id is a plain value, written and shown back', (await wv('VSCE_PUBLISHER_ID', 'gully-labs')).data.field.value === 'gully-labs' && fs.readFileSync(fileOf('VSCE_PUBLISHER_ID'), 'utf8') === 'gully-labs')
    check('devtools: a bad publisher id is 400', (await wv('VSCE_PUBLISHER_ID', 'Gully Labs!')).status === 400)
    const wp = await wv('VSCE_PAT', PAT)
    check('devtools: the token is write-only (no value, no hint of it in the answer)', wp.status === 200 && wp.data.field.set === true && wp.data.field.value === undefined && !wp.text.includes(PAT))
    check('devtools: the token file holds the bare value, read-only', fs.readFileSync(fileOf('VSCE_PAT'), 'utf8') === PAT && (posix ? (fs.statSync(fileOf('VSCE_PAT')).mode & 0o777) === 0o400 : (fs.statSync(fileOf('VSCE_PAT')).mode & 0o222) === 0))
    check('devtools: Open VSX token and namespace save', (await wv('OVSX_PAT', OVSX)).status === 200 && (await wv('OVSX_NAMESPACE', 'gully-labs')).status === 200)
    check('devtools: a wallet key is refused on a token field', (await wv('OVSX_PAT', '0x' + 'ab'.repeat(32))).status === 422 && (await wv('VSCE_PAT', 'abandon ability able about above absent absorb abstract absurd abuse access accident')).status === 422)

    ints.resetLimits()
    const wk = await wv('GITHUB_APP_PRIVATE_KEY', rsa.privateKey.replace(/\n/g, '\r\n'))
    check('devtools: a GitHub App private key (RSA PEM, CRLF pasted) is accepted, never echoed', wk.status === 200 && wk.data.field.set === true && wk.data.field.value === undefined && !wk.text.includes('PRIVATE KEY') && !wk.text.includes(rsa.privateKey.split('\n')[1]))
    const stored = fs.readFileSync(fileOf('GITHUB_APP_PRIVATE_KEY'), 'utf8')
    check('devtools: the PEM is stored with LF ends and one trailing newline, mode 0400, and signs', stored === rsa.privateKey.trim() + '\n' && (posix ? (fs.statSync(fileOf('GITHUB_APP_PRIVATE_KEY')).mode & 0o777) === 0o400 : true) && crypto.createSign('RSA-SHA256').update('x').sign(stored).length > 0)
    check('devtools: a PKCS#8 RSA key is accepted too', (await wv('GITHUB_APP_PRIVATE_KEY', pem8)).status === 200)
    check('devtools: an EC wallet-style PEM key is refused', (await wv('GITHUB_APP_PRIVATE_KEY', ec)).status === 400)
    check('devtools: a private key with text around it is refused', (await wv('GITHUB_APP_PRIVATE_KEY', `here: ${rsa.privateKey}`)).status === 400)
    check('devtools: a PEM with a short body is refused', (await wv('GITHUB_APP_PRIVATE_KEY', '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n-----END RSA PRIVATE KEY-----')).status === 400)
    check('devtools: a PEM is not accepted on an ordinary field', (await wv('GITHUB_APP_WEBHOOK_SECRET', rsa.privateKey)).status !== 200 && (await wv('VSCE_PAT', rsa.privateKey)).status !== 200)
    check('devtools: the App ID is a number', (await wv('GITHUB_APP_ID', 'abc')).status === 400 && (await wv('GITHUB_APP_ID', '123456')).status === 200)
    check('devtools: the webhook secret saves, and a 64-hex one (openssl rand -hex 32) is accepted for it only', (await wv('GITHUB_APP_WEBHOOK_SECRET', HOOK)).status === 200 && (await wv('GITHUB_APP_WEBHOOK_SECRET', 'ab'.repeat(32))).status === 200 && (await wv('VSCE_PAT', 'ab'.repeat(32))).status === 422)
    await wv('GITHUB_APP_WEBHOOK_SECRET', HOOK)
    check('devtools: optional store rows save (Chrome, Edge, Firefox)', (await wv('CHROME_WEBSTORE_CLIENT_ID', 'client-id-1234567890.apps.googleusercontent.com')).status === 200 && (await wv('EDGE_ADDONS_CLIENT_ID', 'edgeClient1234567890')).status === 200 && (await wv('EDGE_ADDONS_API_KEY', 'edgeKey1234567890abcd')).status === 200 && (await wv('AMO_JWT_ISSUER', 'user:12345:67')).status === 200 && (await wv('AMO_JWT_SECRET', 'cd'.repeat(32))).status === 200)

    const l1 = await api('/api/admin/integrations', owner)
    const secrets = [PAT, OVSX, HOOK, rsa.privateKey.split('\n')[1], 'edgeKey1234567890abcd', 'cd'.repeat(32)]
    check('devtools: the list has no secret value, only the plain ids', !secrets.some((v) => l1.text.includes(v)) && l1.data.groups.flatMap((g) => g.fields).find((f) => f.name === 'OVSX_NAMESPACE').value === 'gully-labs' && l1.data.groups.flatMap((g) => g.fields).find((f) => f.name === 'GITHUB_APP_ID').value === '123456')
    const pr = l1.data.progress
    check('devtools: progress turns ready as items arrive', pr.find((r) => r.tool.includes('VS Marketplace')).ready === true && pr.find((r) => r.tool.includes('Open VSX')).ready && pr.find((r) => r.tool.includes('GitHub App')).ready && pr.find((r) => r.tool.includes('Edge')).ready && !pr.find((r) => r.tool.includes('Chrome')).ready && pr.find((r) => r.tool.includes('Chrome')).missing.join() === 'OAuth client secret,Refresh token')

    ints.resetLimits()
    // the Check button: safe reads only, the network is a stub here
    const calls = []
    ints.setCheckFetch(async (url, init) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', auth: init?.headers?.authorization })
      const jsonRes = (status, o) => ({ status, json: async () => o })
      if (String(url) === 'https://api.github.com/app') return jsonRes(200, { name: 'Gully Review' })
      if (String(url).startsWith('https://open-vsx.org/api/')) return jsonRes(404, {})
      return jsonRes(500, {})
    })
    const c1 = await api('/api/admin/integrations/check/dt_githubapp', { ...owner, method: 'POST', body: {} })
    const jwt = calls[0]?.auth?.replace('Bearer ', '') ?? ''
    const claims = JSON.parse(Buffer.from(jwt.split('.')[1] ?? 'e30', 'base64url').toString())
    check('check: GitHub App = one GET /app signed with the stored key (iss = App ID, under 10 minutes)', c1.status === 200 && c1.data.ok === true && calls.length === 1 && calls[0].method === 'GET' && claims.iss === '123456' && claims.exp - claims.iat <= 600 && crypto.createVerify('RSA-SHA256').update(jwt.split('.').slice(0, 2).join('.')).verify(crypto.createPublicKey(pem8), Buffer.from(jwt.split('.')[2], 'base64url')))
    check('check: the answer carries no key, no token', !c1.text.includes(jwt) && !c1.text.includes('PRIVATE'))
    const c2 = await api('/api/admin/integrations/check/dt_openvsx', { ...owner, method: 'POST', body: {} })
    check('check: Open VSX = one public GET of the namespace with no token', c2.data.ok === true && calls.length === 2 && calls[1].url === 'https://open-vsx.org/api/gully-labs' && !calls[1].auth && /not created yet/.test(c2.data.detail))
    const c3 = await api('/api/admin/integrations/check/dt_vsmarketplace', { ...owner, method: 'POST', body: {} })
    check('check: VS Marketplace has no safe read, so no network call, only "saved"', c3.data.result === 'saved' && calls.length === 2)
    const c4 = await api('/api/admin/integrations/check/dt_chrome', { ...owner, method: 'POST', body: {} })
    check('check: an incomplete row says what is missing, no call', c4.data.result === 'saved' || c4.data.result === 'incomplete')
    check('check: the guide-only row and unknown ids are 404, GET is 405', (await api('/api/admin/integrations/check/dt_ownerheld', { ...owner, method: 'POST', body: {} })).status === 404 && (await api('/api/admin/integrations/check/dt_nope', { ...owner, method: 'POST', body: {} })).status === 404 && (await api('/api/admin/integrations/check/dt_openvsx', owner)).status === 405)
    check('check: signed out is 401', (await api('/api/admin/integrations/check/dt_openvsx', { method: 'POST', body: {} })).status === 401)
    ints.setCheckFetch(async () => { throw new Error('offline') })
    check('check: an unreachable service is a calm answer, not a 500', (await api('/api/admin/integrations/check/dt_openvsx', { ...owner, method: 'POST', body: {} })).data.result === 'unreachable')
    ints.setCheckFetch(null)

    ints.resetLimits()
    const dd = await del(owner, 'VSCE_PAT')
    check('devtools: removing a token deletes its file and progress goes back to waiting', dd.status === 200 && !fs.existsSync(fileOf('VSCE_PAT')) && (await api('/api/admin/integrations', owner)).data.progress.find((r) => r.tool.includes('VS Marketplace')).ready === false)
    await wv('VSCE_PAT', PAT)

    ints.resetLimits()
    const rows = JSON.parse(fs.readFileSync(path.join(tmp, 'admin-integrations-audit.json'), 'utf8'))
    const flat = JSON.stringify(rows) + logs.join('\n')
    check('devtools audit: names only, no token, key or secret in the audit file or the log', !secrets.some((v) => flat.includes(v)) && !flat.includes('BEGIN RSA PRIVATE KEY') && rows.some((r) => r.name === 'GITHUB_APP_PRIVATE_KEY' && r.result === 'refused') && rows.some((r) => r.name === 'dt_githubapp' && r.action === 'check'))
    check('devtools: no store or publish call exists (the module has no vsce/ovsx/npm publish code)', !/execFile|spawn|child_process|vsce publish|ovsx publish/.test(fs.readFileSync(fileURLToPath(new URL('../server/admin-integrations-devtools.mjs', import.meta.url)), 'utf8').replace(/\/\/.*$/gm, '').replace(/usedIn: '[^']*'/g, '')))
    const noList = DEV.flatMap((g) => g.fields.map((f) => f.name))
    check('devtools: every field name is on the allow-list and only those', noList.length === 16 && (await put(owner, 'GITHUB_TOKEN', 'ghp_' + 'a'.repeat(36))).status === 404)
  }

  {
    const rows = JSON.parse(fs.readFileSync(path.join(tmp, 'admin-integrations-audit.json'), 'utf8'))
    const values = [KEY, SECRET, 'a1'.repeat(32), 'ab'.repeat(32), 'abandon ability']
    check('audit: who, when, which name, set/clear/refused', rows.some((r) => r.name === 'OVH_APPLICATION_KEY' && r.action === 'set' && r.result === 'ok' && r.sub === OWNER) && rows.some((r) => r.name === 'OVH_REGION' && r.action === 'clear') && rows.some((r) => r.result === 'refused' && r.why === 'hex32') && rows.some((r) => r.name === 'DATABASE_URL' && r.why === 'not_allowed'))
    check('audit: no value in the audit file or the log', !values.some((v) => JSON.stringify(rows).includes(v) || logs.some((x) => x.includes(v))))
    check('audit: log lines carry a sub tag, never the sub', logs.some((x) => x.includes('"evt":"admin_integrations"')) && !logs.filter((x) => x.includes('admin_integrations')).some((x) => x.includes(OWNER)))
  }

  {
    clock += 6 * 60_000
    check('step-up expires after 5 minutes', (await put(owner, 'OVH_REGION', 'GRA11')).status === 401)
    const second = await signIn(OTHER)
    check('another admin session has its own step-up (none yet)', (await put(second, 'OVH_REGION', 'GRA11')).status === 401)
    await round('/auth/gully/stepup', { cookie: owner.cookie })
    let last = 0
    for (let i = 0; i < 25 && last !== 429; i++) last = (await put(owner, 'OVH_REGION', 'GRA11')).status
    check('rate limit: 20 writes per 10 minutes, then 429', last === 429)
  }

  {
    const o = ints.fileOwner
    check('files: as root they go to uid/gid 1001, mode 0400', JSON.stringify(o({}, 0)) === JSON.stringify({ uid: 1001, gid: 1001, mode: 0o400 }))
    check('files: not root, with a shared group, mode 0440 for that group', JSON.stringify(o({ CHAINKIT_INTEGRATIONS_GID: '1001' }, 1000)) === JSON.stringify({ uid: -1, gid: 1001, mode: 0o440 }))
    check('files: not root and no group, this process only (0400)', JSON.stringify(o({}, 1000)) === JSON.stringify({ uid: -1, gid: -1, mode: 0o400 }))
  }

  {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
    const src = walk(fileURLToPath(new URL('../src', import.meta.url)))
    const hits = src.filter((f) => /\.(tsx?|css|html|json)$/.test(f) && /\bOVH\b|ovh-eu|GRA11/i.test(fs.readFileSync(f, 'utf8')))
    check('public: no OVH text anywhere in the app source (the admin page reads the names from the admin API)', hits.length === 0, hits.join(', '))
    const home = await hostRequest(BASE, 'gullylabs.xyz', '/')
    check('public: the site HTML does not mention it', home.status === 200 && !/ovh/i.test(home.text))
  }
} finally {
  console.log = realLog
  mock.close()
  try {
    for (const f of fs.existsSync(DIR) ? fs.readdirSync(DIR) : []) fs.chmodSync(path.join(DIR, f), 0o600)
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* a leftover temp folder is harmless */
  }
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
process.exit(t.failed ? 1 : 0)
