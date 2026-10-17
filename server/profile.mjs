// The signed-in wallet's own things in the developer portal v2: GET /me, profile, company details of the
// active workspace, and the wallet's sessions.
//
// DATA_DIR/profiles.json (atomic writes): { [address]: { displayName, email, notify: { telegramUsage,
//   telegramBilling }, updatedAt, ens: { name, avatar, source, at, ok } } }
// The ENS / Basename name is a best-effort reverse lookup (Ethereum, then Base) through payments.mjs's
// RPC list (env GULLY_RPC_<chainId> overrides). It runs in the background, is forward-verified (the name
// must resolve back to the address), is cached 24 hours (1 hour after a failed read), and never holds
// up a request.

import fs from 'node:fs'
import path from 'node:path'
import { recordEvent } from './activity.mjs'
import { DATA_DIR, json, readJson } from './http.mjs'
import { rpc } from './payments.mjs'
import { deleteSessionByKey, sessionKey, sessionsOf, sha256 } from './store.mjs'
import { keccak_256 } from './vendor/noble.mjs'
import { companyOf, pendingInvitesFor, setCompany, workspaceRef, workspacesOf } from './workspaces.mjs'

const FILE = path.join(DATA_DIR, 'profiles.json')
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,24}$/
const CONTROL_RE = /[\u0000-\u001f\u007f]/g

let db
try {
  db = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  if (!db || typeof db !== 'object' || Array.isArray(db)) db = {}
} catch {
  db = {}
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(db))
    fs.renameSync(FILE + '.tmp', FILE)
  } catch (e) {
    console.error('profiles save:', e?.message ?? e)
  }
}

/** A wallet's profile (defaults when it has none). Starts a background ENS lookup when the cache is stale. */
export function profileOf(address) {
  const r = db[address] ?? {}
  return {
    displayName: r.displayName ?? null,
    email: r.email ?? null,
    ens: r.ens?.name ?? null,
    avatar: r.ens?.avatar ?? null,
    notify: { telegramUsage: !!r.notify?.telegramUsage, telegramBilling: !!r.notify?.telegramBilling },
  }
}

/* ---------------------------------------------------------------- ENS --- */

const ENS_REGISTRY = { 1: '0x00000000000c2e074ec69a0dfb2997ba6c7d2e1e', 8453: '0xb94704422c2a1e396835a571837aa5ae53285a95' }
const REVERSE_SUFFIX = { 1: 'addr.reverse', 8453: '80002105.reverse' }
const SEL = { resolver: '0178b8bf', name: '691f3431', addr: '3b3b57de', text: '59d1d43c' }
const ENS_TTL_MS = 24 * 3_600_000
const ENS_RETRY_MS = 3_600_000
const inflight = new Map()

const hex = (u8) => Buffer.from(u8).toString('hex')
function namehash(name) {
  let node = new Uint8Array(32)
  if (name) {
    for (const label of name.split('.').reverse()) {
      const lh = keccak_256(new TextEncoder().encode(label))
      const buf = new Uint8Array(64)
      buf.set(node, 0)
      buf.set(lh, 32)
      node = keccak_256(buf)
    }
  }
  return hex(node)
}
const word = (h) => h.padStart(64, '0')
const call = (chainId, to, data) => rpc(chainId, 'eth_call', [{ to, data: '0x' + data }, 'latest'])
const asAddress = (r) => (typeof r === 'string' && r.length >= 66 ? '0x' + r.slice(-40).toLowerCase() : null)
function asString(r) {
  if (typeof r !== 'string' || r.length < 130) return null
  const b = Buffer.from(r.slice(2), 'hex')
  const off = Number(BigInt('0x' + b.subarray(0, 32).toString('hex')))
  if (off + 32 > b.length) return null
  const len = Number(BigInt('0x' + b.subarray(off, off + 32).toString('hex')))
  if (len > 1000 || off + 32 + len > b.length) return null
  return b.subarray(off + 32, off + 32 + len).toString('utf8')
}
const ZERO = '0x0000000000000000000000000000000000000000'

async function reverseOn(chainId, address) {
  const registry = ENS_REGISTRY[chainId]
  const rnode = namehash(`${address.slice(2)}.${REVERSE_SUFFIX[chainId]}`)
  const resolver = asAddress(await call(chainId, registry, SEL.resolver + rnode))
  if (!resolver || resolver === ZERO) return null
  const name = asString(await call(chainId, resolver, SEL.name + rnode))
  if (!name || name.length > 255 || !/^[\p{L}\p{N}\p{M}_.-]+\.[\p{L}\p{N}-]+$/u.test(name)) return null
  // Forward check: the name must point back at the address.
  const fnode = namehash(name.toLowerCase())
  const fres = asAddress(await call(chainId, registry, SEL.resolver + fnode))
  if (!fres || fres === ZERO) return null
  if (asAddress(await call(chainId, fres, SEL.addr + fnode)) !== address) return null
  let avatar = null
  try {
    const key = Buffer.from('avatar').toString('hex')
    const t = asString(await call(chainId, fres, SEL.text + fnode + word('40') + word((6).toString(16)) + key.padEnd(64, '0')))
    if (t && /^https:\/\/[^\s"'<>]{1,500}$/.test(t)) avatar = t
  } catch {
    /* no avatar */
  }
  return { name, avatar, source: chainId === 1 ? 'ens' : 'basename' }
}

/** Looks the name up in the background when the cache is stale; never awaited by a request. */
export function refreshEns(address) {
  const c = db[address]?.ens
  const age = c ? Date.now() - Date.parse(c.at) : Infinity
  if (age < (c?.ok === false ? ENS_RETRY_MS : ENS_TTL_MS) || inflight.has(address)) return
  if (process.env.GULLY_ENS_LOOKUP === 'off') return
  const job = (async () => {
    let found = null
    let ok = true
    for (const chainId of [1, 8453]) {
      try {
        found = await reverseOn(chainId, address)
        if (found) break
      } catch {
        ok = false
      }
    }
    const r = (db[address] ??= {})
    r.ens = { name: found?.name ?? null, avatar: found?.avatar ?? null, source: found?.source ?? null, at: new Date().toISOString(), ok: found ? true : ok }
    save()
  })()
    .catch(() => undefined)
    .finally(() => inflight.delete(address))
  inflight.set(address, job)
}

/** Test hook: sets the cached name of a wallet. */
export function setEnsForTest(address, name, avatar = null) {
  const r = (db[address] ??= {})
  r.ens = { name, avatar, source: 'ens', at: new Date().toISOString(), ok: true }
}

/* ----------------------------------------------------------- sessions --- */

const publicSessionId = (key) => sha256(`gl-session:${key}`).slice(0, 24)

/** "Chrome on Windows" from a user-agent string, or "Unknown device". */
export function deviceLabel(ua) {
  const s = String(ua ?? '')
  if (!s) return 'Unknown device'
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\/|CriOS\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : /node|undici|curl/i.test(s) ? 'Script' : null
  const os = /iPhone|iPad|iPod/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /CrOS/.test(s) ? 'ChromeOS' : /Linux/.test(s) ? 'Linux' : null
  if (browser && os) return `${browser} on ${os}`
  return browser ?? os ?? 'Unknown device'
}

function sessionsView(address, currentId) {
  const current = sessionKey(currentId)
  return sessionsOf(address).map(([key, s]) => ({ id: publicSessionId(key), device: deviceLabel(s.userAgent), createdAt: s.createdAt, lastSeenAt: s.lastSeenAt ?? s.createdAt, expiresAt: s.expiresAt, current: key === current }))
}

/* -------------------------------------------------------------- routes --- */

const strOrNull = (v, max, { multiline = false } = {}) => {
  if (v === null || v === undefined) return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false }
  let s = multiline ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '') : v.replace(CONTROL_RE, '')
  s = s.trim()
  if (s.length > max) return { ok: false }
  return { ok: true, value: s || null }
}

/** The GET /me body. */
export function meView(ctx) {
  refreshEns(ctx.user)
  return {
    address: ctx.user,
    profile: profileOf(ctx.user),
    company: companyOf(ctx.workspace),
    workspaces: workspacesOf(ctx.user),
    active: workspaceRef(ctx.workspace, ctx.user),
    pendingInvites: pendingInvitesFor(ctx.user),
  }
}

/**
 * GET /me, POST /profile, POST /company, GET /sessions, POST /sessions/revoke. developer.mjs has
 * checked the session, CSRF and the role (company: owner, admin or billing). Returns
 * { handled, signedOut } so the gate can clear the cookie when the current session was revoked.
 */
export async function handleProfileRoutes(req, res, url, ctx) {
  const p = url.pathname
  const post = req.method === 'POST'
  const { user, workspace: ws } = ctx

  if (p === '/api/developer/me') {
    if (post) return json(res, 405, { error: 'GET only' }), true
    return json(res, 200, meView(ctx)), true
  }

  if (p === '/api/developer/sessions') {
    if (post) return json(res, 405, { error: 'GET only' }), true
    return json(res, 200, { sessions: sessionsView(user, ctx.sessionId) }), true
  }

  if (!post) return json(res, 405, { error: 'POST only' }), true

  if (p === '/api/developer/profile') {
    const body = await readJson(req, 2_000)
    if (!body || typeof body !== 'object') return json(res, 400, { error: 'Send a JSON object.' }), true
    const r = (db[user] ??= {})
    const changed = []
    if ('displayName' in body) {
      const v = strOrNull(body.displayName, 40)
      if (!v.ok) return json(res, 400, { error: 'The display name may hold up to 40 characters.', field: 'displayName' }), true
      r.displayName = v.value
      changed.push('displayName')
    }
    if ('email' in body) {
      const v = strOrNull(body.email, 254)
      if (!v.ok || (v.value && !EMAIL_RE.test(v.value))) return json(res, 400, { error: 'That email address does not look right.', field: 'email' }), true
      r.email = v.value ? v.value.toLowerCase() : null
      changed.push('email')
    }
    if ('notify' in body) {
      const n = body.notify
      if (!n || typeof n !== 'object' || Object.values(n).some((x) => typeof x !== 'boolean') || Object.keys(n).some((k) => !['telegramUsage', 'telegramBilling'].includes(k))) return json(res, 400, { error: 'notify takes { telegramUsage?: boolean, telegramBilling?: boolean }.', field: 'notify' }), true
      r.notify = { telegramUsage: !!r.notify?.telegramUsage, telegramBilling: !!r.notify?.telegramBilling, ...n }
      changed.push('notify')
    }
    r.updatedAt = new Date().toISOString()
    save()
    if (changed.length) recordEvent(user, { actor: user, action: 'profile.updated', target: user, detail: { fields: changed } })
    return json(res, 200, { profile: profileOf(user) }), true
  }

  if (p === '/api/developer/company') {
    const body = await readJson(req, 4_000)
    if (!body || typeof body !== 'object') return json(res, 400, { error: 'Send a JSON object.' }), true
    const patch = {}
    const limits = { name: 80, address: 300, taxId: 40 }
    for (const [k, max] of Object.entries(limits)) {
      if (!(k in body)) continue
      const v = strOrNull(body[k], max, { multiline: k === 'address' })
      if (!v.ok) return json(res, 400, { error: `${k === 'taxId' ? 'The tax ID' : k === 'name' ? 'The company name' : 'The address'} may hold up to ${max} characters.`, field: k }), true
      patch[k] = v.value
    }
    const company = setCompany(ws, patch)
    if (Object.keys(patch).length) recordEvent(ws, { actor: user, action: 'company.updated', target: company.name, detail: { fields: Object.keys(patch) } })
    return json(res, 200, { company }), true
  }

  if (p === '/api/developer/sessions/revoke') {
    const body = await readJson(req, 1_000)
    const id = String(body?.id ?? '')
    const current = sessionKey(ctx.sessionId)
    const mine = sessionsOf(user)
    let n = 0
    let signedOut = false
    if (id === 'others') {
      for (const [key] of mine) if (key !== current && deleteSessionByKey(key)) n++
    } else {
      const hit = mine.find(([key]) => publicSessionId(key) === id)
      if (!hit) return json(res, 404, { error: 'No such session.' }), true
      deleteSessionByKey(hit[0])
      n = 1
      signedOut = hit[0] === current
    }
    if (n) recordEvent(user, { actor: user, action: 'sessions.revoked', target: id === 'others' ? 'others' : 'one', detail: { count: n, current: signedOut } })
    return json(res, 200, { ok: true, revoked: n, signedOut }, signedOut ? { 'Set-Cookie': ctx.clearCookie } : {}), true
  }

  return json(res, 404, { error: 'not found' }), true
}
