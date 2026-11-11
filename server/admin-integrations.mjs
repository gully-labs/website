// admin.gullylabs.xyz Integrations: write-only settings the Chain Kit runner reads (owner, 2026-11-11). admin.mjs routes
// /api/admin/integrations* here after its own admin check.
//
//   GET    /api/admin/integrations          { groups: [{ id, title, body, fields: [{ name, label, hint, optional,
//                                            dflt, set, updatedAt, updatedBy }] }], stepUp: { via, until } }
//                                            Never a value: only set or unset, and who changed it when.
//   PUT    /api/admin/integrations/:NAME    { value }  write it (passkey step-up within 5 minutes)
//   DELETE /api/admin/integrations/:NAME              remove it (passkey step-up within 5 minutes)
//
// A write needs a Gully ID admin session (the break-glass ADMIN_TOKEN is refused: it has no passkey) whose passkey
// step-up (admin-auth.mjs GET /auth/gully/stepup) is at most 5 minutes old, the session's CSRF bearer (admin.mjs), and
// stays under 20 writes per 10 minutes. Only the names below are accepted. Wallet private keys, signer keys and seed
// phrases are refused on every field (integrations-guard.mjs, the copy shared with the other Gully admin consoles), with
// one exception: the Gully Pay webhook signing key is a 32-byte hex HMAC key by construction, so a 64-hex value is
// accepted for that one name only (and nothing else in it may look like a phrase or a PEM key).
//
// STORAGE. Each value is a file <CHAINKIT_INTEGRATIONS_DIR>/<NAME> (default /srv/chainkit/integrations), the bare value
// with no newline, mode 0400, written to a temp file and renamed over the old one. Running as root it is chowned to uid
// and gid 1001 (CHAINKIT_INTEGRATIONS_UID / _GID override). Not root (gully-web runs as `node`, uid 1000): with
// CHAINKIT_INTEGRATIONS_GID set (a group this process is in, e.g. by `docker run --group-add`), the file gets that group
// and mode 0440, so a runner in that group can read it; without it the file is this process's uid only, mode 0400. The
// gully-web container needs that directory bind-mounted read-write (ops/deploy.sh does it when the host folder exists);
// the Chain Kit runner reads the files at the start of each run, so a change needs no restart. Unset defaults (OVH_ENDPOINT ovh-eu, OVH_REGION GRA11) are the runner's, not a file.
//
// AUDIT. Every write, removal and refusal: one JSON line in the log ({ evt: 'admin_integrations', action, name, result,
// sub: 12-hex tag }) and a row in DATA_DIR/admin-integrations-audit.json (the last 500: at, sub, name, action, result,
// why). The value, its length and its hash are never logged or stored outside its file.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { adminSessionOf, stepUpUntil } from './admin-auth.mjs'
import { subTag } from './admin-gully-id.mjs'
import { DATA_DIR, json, readJson } from './http.mjs'
import { looksLikeWalletSecret, RateLimit, WALLET_REFUSED } from './integrations-guard.mjs'

const OVH_ENDPOINTS = ['ovh-eu', 'ovh-ca', 'ovh-us', 'soyoustart-eu', 'soyoustart-ca', 'kimsufi-eu', 'kimsufi-ca']

export const INTEGRATION_GROUPS = [
  {
    id: 'ovh',
    title: 'OVH',
    body: 'The OVHcloud API keys the Chain Kit runner uses to order and set up a customer chain\'s own server. Create them at the OVH API token page with the rights the runner needs.',
    fields: [
      { name: 'OVH_APPLICATION_KEY', label: 'Application key', hint: '16 letters and numbers', format: /^[A-Za-z0-9]{8,64}$/ },
      { name: 'OVH_APPLICATION_SECRET', label: 'Application secret', hint: '32 letters and numbers', format: /^[A-Za-z0-9]{16,128}$/ },
      { name: 'OVH_CONSUMER_KEY', label: 'Consumer key', hint: '32 letters and numbers', format: /^[A-Za-z0-9]{16,128}$/ },
      { name: 'OVH_PROJECT_ID', label: 'Public Cloud project id', hint: '32 hex characters', format: /^[0-9a-f]{32}$/ },
      { name: 'OVH_ENDPOINT', label: 'API endpoint', hint: OVH_ENDPOINTS.join(', '), optional: true, dflt: 'ovh-eu', format: new RegExp(`^(?:${OVH_ENDPOINTS.join('|')})$`) },
      { name: 'OVH_REGION', label: 'Region', hint: 'e.g. GRA11, SBG5, BHS5', optional: true, dflt: 'GRA11', format: /^[A-Z]{2,8}[0-9]{0,3}$/ },
    ],
  },
  {
    id: 'gullypay',
    title: 'Gully Pay',
    body: 'The signing key of the Gully Pay webhook that tells the Chain Kit runner a testnet chain was paid or cancelled. Gully Pay shows it once, when the webhook is created.',
    fields: [{ name: 'GULLYPAY_CHAINKIT_WEBHOOK_SECRET', label: 'Webhook signing key', hint: 'shown once by Gully Pay', format: /^[A-Za-z0-9_-]{16,128}$/, hexKeyOk: true }],
  },
]
const FIELDS = new Map(INTEGRATION_GROUPS.flatMap((g) => g.fields.map((f) => [f.name, f])))

export const integrationsDir = () => process.env.CHAINKIT_INTEGRATIONS_DIR || '/srv/chainkit/integrations'
const auditFile = () => path.join(process.env.DATA_DIR ?? DATA_DIR, 'admin-integrations-audit.json')
const writes = new RateLimit(20, 10 * 60_000)
const idOf = (n) => (Number.isInteger(n) && n >= 0 ? n : null)

function readAudit() {
  try {
    const a = JSON.parse(fs.readFileSync(auditFile(), 'utf8'))
    return Array.isArray(a) ? a : []
  } catch {
    return []
  }
}

function audit(sub, name, action, result, why = null) {
  const row = { at: new Date().toISOString(), sub: sub ?? null, name, action, result, why }
  try {
    console.log(JSON.stringify({ ts: row.at, evt: 'admin_integrations', action, name, result, why: why ?? undefined, sub: sub ? subTag(sub) : undefined }))
  } catch {
    /* logging never breaks a write */
  }
  try {
    const rows = [...readAudit(), row].slice(-500)
    fs.mkdirSync(path.dirname(auditFile()), { recursive: true })
    fs.writeFileSync(auditFile() + '.tmp', JSON.stringify(rows), { mode: 0o600 })
    fs.renameSync(auditFile() + '.tmp', auditFile())
  } catch (e) {
    console.error('admin-integrations: could not write the audit log:', e?.message ?? e)
  }
}

/** Who the file belongs to and its mode: root chowns to the runner, others share a group when one is given. */
export function fileOwner(env = process.env, uidNow = typeof process.getuid === 'function' ? process.getuid() : null) {
  const num = (v) => (v === undefined || v === '' ? null : idOf(Number.parseInt(String(v), 10)))
  if (uidNow === 0) {
    const uid = num(env.CHAINKIT_INTEGRATIONS_UID) ?? 1001
    const gid = num(env.CHAINKIT_INTEGRATIONS_GID) ?? uid
    return { uid, gid, mode: 0o400 }
  }
  const gid = uidNow === null ? null : num(env.CHAINKIT_INTEGRATIONS_GID)
  return gid === null ? { uid: -1, gid: -1, mode: 0o400 } : { uid: -1, gid, mode: 0o440 }
}

/** Removes a file we wrote read-only (Windows will not unlink a read-only file). */
function removeFile(p) {
  try {
    fs.chmodSync(p, 0o600)
  } catch {
    /* not there */
  }
  fs.rmSync(p, { force: true })
}

function writeValue(name, value) {
  const dir = integrationsDir()
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = path.join(dir, `.${name}.${crypto.randomBytes(6).toString('hex')}.tmp`)
  const o = fileOwner()
  try {
    fs.writeFileSync(tmp, value, { mode: 0o600, flag: 'wx' })
    if (o.uid !== -1 || o.gid !== -1) fs.chownSync(tmp, o.uid, o.gid)
    fs.chmodSync(tmp, o.mode)
    if (process.platform === 'win32') removeFile(path.join(dir, name))
    fs.renameSync(tmp, path.join(dir, name))
  } catch (e) {
    removeFile(tmp)
    throw e
  }
}

function fieldView(f, rows) {
  let set = false
  let mtime = null
  try {
    const st = fs.statSync(path.join(integrationsDir(), f.name))
    set = st.isFile() && st.size > 0
    mtime = set ? st.mtime.toISOString() : null
  } catch {
    /* unset */
  }
  const last = [...rows].reverse().find((r) => r.name === f.name && r.result === 'ok')
  return { name: f.name, label: f.label, hint: f.hint, optional: !!f.optional, dflt: f.dflt ?? null, set, updatedAt: last?.at ?? mtime, updatedBy: last ? (last.sub ?? 'unknown') : null }
}

/** Refusal reason for a value, or null. */
export function refuseValue(f, value) {
  if (typeof value !== 'string') return { status: 400, code: 'invalid_request', message: 'Send {"value": "..."}.' }
  const v = value.trim()
  if (!v || v.length > 4096) return { status: 400, code: 'invalid_value', message: 'The value is empty or too long.' }
  const wallet = looksLikeWalletSecret(v)
  if (wallet && !(wallet === 'hex32' && f.hexKeyOk && /^[0-9a-fA-F]{64}$/.test(v))) return { status: 422, ...WALLET_REFUSED, why: wallet }
  if (!f.format.test(v)) return { status: 400, code: 'invalid_value', message: `That does not look like ${f.label.toLowerCase()} (${f.hint}).` }
  return null
}

/** /api/admin/integrations*. The caller has checked the admin. */
export async function handleIntegrationsAdmin(req, res, url) {
  const p = url.pathname
  const s = adminSessionOf(req)
  if (p === '/api/admin/integrations') {
    if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
    const rows = readAudit()
    return json(res, 200, { groups: INTEGRATION_GROUPS.map((g) => ({ id: g.id, title: g.title, body: g.body, fields: g.fields.map((f) => fieldView(f, rows)) })), stepUp: { via: s ? 'gully_id' : 'token', until: stepUpUntil(s) } }), true
  }
  const name = /^\/api\/admin\/integrations\/([A-Z][A-Z0-9_]{2,63})$/.exec(p)?.[1]
  if (!name) return json(res, 404, { error: 'not found' }), true
  if (req.method !== 'PUT' && req.method !== 'DELETE') return json(res, 405, { error: 'PUT or DELETE' }, { Allow: 'PUT, DELETE' }), true
  const action = req.method === 'PUT' ? 'set' : 'clear'
  const f = FIELDS.get(name)
  if (!f) {
    audit(s?.sub, name.slice(0, 64), action, 'refused', 'not_allowed')
    return json(res, 404, { code: 'unknown_name', error: 'That setting is not one of the integrations.' }), true
  }
  if (!s) return json(res, 403, { code: 'gully_id_required', error: 'Sign in with Gully ID to change integrations. The admin token cannot.' }), true
  if (!stepUpUntil(s)) return json(res, 401, { code: 'step_up_required', error: 'Confirm with your passkey first (valid 5 minutes).', stepup: '/auth/gully/stepup' }), true
  if (!writes.take(s.sub)) return json(res, 429, { code: 'rate_limited', error: 'Too many changes. Wait a few minutes.' }), true
  try {
    if (action === 'clear') {
      removeFile(path.join(integrationsDir(), name))
    } else {
      const body = await readJson(req, 16 * 1024)
      const bad = refuseValue(f, body?.value)
      if (bad) {
        audit(s.sub, name, action, 'refused', bad.why ?? bad.code)
        return json(res, bad.status, { code: bad.code, error: bad.message }), true
      }
      writeValue(name, body.value.trim())
    }
  } catch (e) {
    audit(s.sub, name, action, 'error', String(e?.code ?? 'error').slice(0, 40))
    console.error(`admin-integrations: ${action} ${name} failed:`, e?.code ?? e?.message ?? e)
    return json(res, 500, { code: 'write_failed', error: 'The setting could not be saved on the server. Check that the integrations folder is mounted and writable.' }), true
  }
  audit(s.sub, name, action, 'ok')
  return json(res, 200, { field: fieldView(f, readAudit()) }), true
}
