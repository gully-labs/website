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
    const names = l.data?.groups?.flatMap((g) => g.fields.map((f) => f.name)) ?? []
    check('list: the OVH card and the Gully Pay webhook key, every field unset', l.status === 200 && l.data.groups.map((g) => g.title).join() === 'OVH,Gully Pay' && names.join() === 'OVH_APPLICATION_KEY,OVH_APPLICATION_SECRET,OVH_CONSUMER_KEY,OVH_PROJECT_ID,OVH_ENDPOINT,OVH_REGION,GULLYPAY_CHAINKIT_WEBHOOK_SECRET' && l.data.groups.every((g) => g.fields.every((f) => f.set === false)))
    const ovh = l.data.groups[0].fields
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
    check('list: every field set, with who and when', l.data.groups.every((g) => g.fields.every((f) => f.set && f.updatedBy === OWNER && f.updatedAt)))
    const values = [KEY, 'Zz99Yy88Xx77Ww66', SECRET, '0123456789abcdef0123456789abcdef', hex] // (the region and endpoint are in the hints)
    check('list: write-only, no value comes back', !values.some((v) => l.text.includes(v)))
    const d = await del(owner, 'OVH_REGION')
    check('clear: the file is gone and the field shows unset (the runner uses GRA11)', d.status === 200 && d.data.field.set === false && !fs.existsSync(fileOf('OVH_REGION')))
    check('clear: POST is 405', (await api('/api/admin/integrations/OVH_REGION', { ...owner, method: 'POST', body: {} })).status === 405)
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
