// Workspaces (teams) for the app dashboard v2: members with roles, invites by wallet or by link.
//
// Every wallet account is a workspace owned by that wallet. Its id is the owner's lower-case address,
// so everything already keyed by the owner (keys, alerts, analytics, billing, Telegram) belongs to the
// workspace unchanged. The owner is implicit (role 'owner', never stored in members).
//
// DATA_DIR/workspaces.json (atomic writes), created lazily on the first change of a workspace:
//   { [owner]: { name, createdAt, company?, members: { [address]: { role, joinedAt, invitedBy } },
//                invites: [{ id, tokenHash?, address?, role, createdBy, createdAt, expiresAt,
//                            acceptedAt?, acceptedBy?, revokedAt?, revokedBy? }] } }
// A link invite's token is shown once to the inviter; only its SHA-256 is stored and it is compared in
// constant time.
//
// Roles and what they may change (reads are open to every member) are in WRITES; developer.mjs's gate
// enforces canWrite() on every POST under /api/developer/.

import fs from 'node:fs'
import path from 'node:path'
import { recordEvent } from './activity.mjs'
import { APP_URL } from './hosts.mjs'
import { clientIp, DATA_DIR, json, readJson } from './http.mjs'
import { getAccount, lastSeenOf, randomToken, resetSessionsWorkspace, safeEqual, setSessionWorkspace, sha256 } from './store.mjs'

const FILE = path.join(DATA_DIR, 'workspaces.json')
export const ROLES = ['owner', 'admin', 'developer', 'billing', 'viewer']
export const MEMBER_ROLES = ['admin', 'developer', 'billing', 'viewer']
export const INVITE_TTL_MS = 7 * 86_400_000
export const MAX_OPEN_INVITES = 20
export const MAX_MEMBERS = 25
export const INVITE_LINK = `${APP_URL}/#invite=`
const ADDR_RE = /^0x[0-9a-f]{40}$/
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/
const WS_NAME_RE = /^[\p{L}\p{N} ._'’&()\-]{1,40}$/u
const KEEP_CLOSED_MS = 30 * 86_400_000

let db
try {
  db = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  if (!db || typeof db !== 'object' || Array.isArray(db)) db = {}
} catch {
  db = {}
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(db))
  fs.renameSync(FILE + '.tmp', FILE)
}

export const shortAddr = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`
export const isAddress = (a) => ADDR_RE.test(String(a))

function ensure(id) {
  let w = db[id]
  if (!w) {
    w = db[id] = { name: null, createdAt: getAccount(id)?.createdAt ?? new Date().toISOString(), members: {}, invites: [] }
  }
  w.members ??= {}
  w.invites ??= []
  return w
}

/** The workspace's display name: its own, or "<0x1234…abcd>'s workspace" until renamed. */
export const workspaceName = (id) => db[id]?.name || `${shortAddr(id)}'s workspace`

/** True when the workspace can be used: its owner has an account that is not blocked. */
const usable = (id) => {
  const a = getAccount(id)
  return !!a && !a.blocked
}

/** The role of `user` in workspace `id`, or null when not a member (or the workspace is unusable). */
export function roleIn(user, id) {
  if (!isAddress(id) || !isAddress(user)) return null
  if (user === id) return 'owner'
  if (!usable(id)) return null
  return db[id]?.members?.[user]?.role ?? null
}

export const workspaceRef = (id, user) => ({ id, name: workspaceName(id), role: roleIn(user, id), owner: id })

/** Every workspace `user` belongs to: their own first, then the others by name. */
export function workspacesOf(user) {
  const out = [workspaceRef(user, user)]
  const others = []
  for (const [id, w] of Object.entries(db)) if (id !== user && w.members?.[user] && usable(id)) others.push(workspaceRef(id, user))
  others.sort((a, b) => a.name.localeCompare(b.name))
  return out.concat(others)
}

/* ---------------------------------------------------------- permissions --- */

/**
 * What a POST under /api/developer/ changes, by path. 'self' routes act on the signed-in wallet only
 * (profile, sessions, switching, leaving, accepting) and are open to every role.
 */
export function categoryOf(pathname) {
  const p = String(pathname).replace(/^\/api\/developer/, '')
  if (p === '/keys' || p.startsWith('/keys/')) return 'keys'
  if (p === '/alerts' || p.startsWith('/alerts/')) return 'alerts'
  if (p === '/monitors' || p.startsWith('/monitors/')) return 'alerts' // Gully Security monitoring: same writers as alerts
  if (p === '/telegram' || p.startsWith('/telegram/')) return 'telegram'
  if (p === '/checkout' || p === '/checkout/verify') return 'billing'
  if (p === '/analytics/checkout' || p === '/analytics/checkout/verify') return 'billing'
  if (p === '/analytics' || p.startsWith('/analytics/')) return 'analytics'
  if (p === '/company') return 'company'
  // Gully Security scans (security-routes.mjs; publishing a report is further limited to owner and admin there).
  if (p === '/security' || p.startsWith('/security/')) return 'security'
  // Gully Pay for merchants: links and webhooks are 'merchant-dev'; wallets, profile, invoices are 'merchant'.
  if (p === '/merchant/links' || p.startsWith('/merchant/links/') || p === '/merchant/webhook' || p.startsWith('/merchant/webhook/')) return 'merchant-dev'
  if (p === '/merchant' || p.startsWith('/merchant/')) return 'merchant'
  if (p === '/team/leave') return 'self'
  if (p === '/team' || p.startsWith('/team/') || p === '/workspace/name') return 'team'
  if (p === '/profile' || p === '/workspace/switch' || p === '/invite/accept' || p === '/sessions' || p.startsWith('/sessions/')) return 'self'
  if (p === '/workspace/delete' || p === '/workspace/transfer') return 'owner'
  return 'admin' // anything not listed needs an admin
}

/** The write categories each role holds. */
export const WRITES = {
  viewer: [],
  developer: ['keys', 'alerts', 'telegram', 'analytics', 'merchant-dev', 'security'],
  billing: ['billing', 'company', 'merchant', 'merchant-dev'],
  admin: ['keys', 'alerts', 'telegram', 'analytics', 'billing', 'company', 'team', 'admin', 'merchant', 'merchant-dev', 'security'],
  owner: ['keys', 'alerts', 'telegram', 'analytics', 'billing', 'company', 'team', 'admin', 'owner', 'merchant', 'merchant-dev', 'security'],
}

/** Whether `role` may make this POST. */
export function canWrite(role, pathname) {
  const c = categoryOf(pathname)
  return c === 'self' || !!WRITES[role]?.includes(c)
}

export const forbidden = (res, role) => (json(res, 403, { error: `Your role (${role}) can't do this.`, code: 'forbidden-role' }), true)

/* -------------------------------------------------------------- company --- */

/** The workspace's company details (all null until set). */
export function companyOf(id) {
  const c = db[id]?.company
  return { name: c?.name ?? null, address: c?.address ?? null, taxId: c?.taxId ?? null }
}

export function setCompany(id, patch) {
  const w = ensure(id)
  w.company = { ...companyOf(id), ...patch, updatedAt: new Date().toISOString() }
  save()
  return companyOf(id)
}

/* -------------------------------------------------------------- invites --- */

const inviteState = (inv, now = Date.now()) => (inv.acceptedAt ? 'accepted' : inv.revokedAt ? 'revoked' : Date.parse(inv.expiresAt) <= now ? 'expired' : 'open')
const openInvites = (w) => (w?.invites ?? []).filter((i) => inviteState(i) === 'open')

export const inviteView = (inv) => ({ id: inv.id, kind: inv.address ? 'address' : 'link', ...(inv.address ? { address: inv.address } : {}), role: inv.role, createdBy: inv.createdBy, createdAt: inv.createdAt, expiresAt: inv.expiresAt })

/** Open invites addressed to a wallet, for GET /me. */
export function pendingInvitesFor(user) {
  const out = []
  for (const [id, w] of Object.entries(db)) {
    if (id === user || !usable(id) || w.members?.[user]) continue
    for (const inv of openInvites(w)) if (inv.address === user) out.push({ id: inv.id, workspace: { id, name: workspaceName(id) }, role: inv.role, invitedBy: inv.createdBy, expiresAt: inv.expiresAt })
  }
  return out
}

function pruneInvites(w) {
  const now = Date.now()
  w.invites = w.invites.filter((i) => inviteState(i, now) === 'open' || now - Date.parse(i.acceptedAt ?? i.revokedAt ?? i.expiresAt) < KEEP_CLOSED_MS)
}

function findByToken(token) {
  if (!TOKEN_RE.test(String(token ?? ''))) return null
  const h = sha256(String(token))
  let found = null
  // Every stored hash is compared (constant time each) so timing does not tell where a match sits.
  for (const [id, w] of Object.entries(db)) for (const inv of w.invites ?? []) if (inv.tokenHash && safeEqual(inv.tokenHash, h) && !found) found = { id, inv }
  return found
}

function findById(inviteId) {
  if (!/^[\w-]{1,40}$/.test(String(inviteId ?? ''))) return null
  for (const [id, w] of Object.entries(db)) for (const inv of w.invites ?? []) if (inv.id === inviteId) return { id, inv }
  return null
}

/* ------------------------------------------------------------ rate limits --- */

const hits = new Map()
function allow(bucket, who, max, ms) {
  const k = `${bucket}:${who}`
  const now = Date.now()
  const list = (hits.get(k) ?? []).filter((t) => now - t < ms)
  if (list.length >= max) {
    hits.set(k, list)
    return false
  }
  list.push(now)
  hits.set(k, list)
  return true
}
setInterval(() => {
  const now = Date.now()
  for (const [k, list] of hits) if (!list.some((t) => now - t < 86_400_000)) hits.delete(k)
}, 600_000).unref?.()
const tooMany = (res, what) => (json(res, 429, { error: `Too many ${what}. Try again later.` }), true)

/* ----------------------------------------------------------------- views --- */

export function teamView(id, user) {
  const w = db[id]
  const owner = { address: id, role: 'owner', joinedAt: w?.createdAt ?? getAccount(id)?.createdAt ?? null, invitedBy: null, lastSeenAt: lastSeenOf(id), you: id === user }
  const members = Object.entries(w?.members ?? {})
    .map(([address, m]) => ({ address, role: m.role, joinedAt: m.joinedAt, invitedBy: m.invitedBy ?? null, lastSeenAt: lastSeenOf(address), you: address === user }))
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
  return {
    workspace: workspaceRef(id, user),
    members: [owner, ...members],
    invites: openInvites(w).map(inviteView).reverse(),
    limits: { maxMembers: MAX_MEMBERS, maxOpenInvites: MAX_OPEN_INVITES, inviteDays: INVITE_TTL_MS / 86_400_000 },
  }
}

/* --------------------------------------------------------------- routes --- */

/**
 * GET /api/developer/invite/:token — public, rate-limited preview of a link invite:
 *   { workspace: { name }, role, invitedBy (short address), expiresAt, valid, state }
 */
export function handleInvitePreview(req, res, url) {
  if (req.method !== 'GET') return json(res, 405, { error: 'GET only' }), true
  const ip = clientIp(req)
  if (!allow('inv-preview', ip, 60, 600_000)) return tooMany(res, 'invite look-ups')
  const fails = (hits.get(`inv-miss:${ip}`) ?? []).filter((t) => Date.now() - t < 900_000)
  if (fails.length >= 20) return tooMany(res, 'unknown invite links')
  const token = decodeURIComponent(url.pathname.slice('/api/developer/invite/'.length))
  const f = findByToken(token)
  if (!f) {
    hits.set(`inv-miss:${ip}`, [...fails, Date.now()])
    return json(res, 404, { error: 'This invite link is not valid.', valid: false }), true
  }
  const state = inviteState(f.inv)
  return json(res, 200, { workspace: { name: workspaceName(f.id) }, role: f.inv.role, invitedBy: shortAddr(f.inv.createdBy), expiresAt: f.inv.expiresAt, valid: state === 'open' && usable(f.id), state }), true
}

/**
 * The signed-in workspace and team routes. developer.mjs has checked the session, CSRF and the role's
 * write permission (canWrite), and passes ctx = { user, workspace, role, sessionId, ip }.
 */
export async function handleWorkspaceRoutes(req, res, url, ctx) {
  const p = url.pathname
  const post = req.method === 'POST'
  const { user, workspace: ws, role } = ctx
  const ev = (wsId, action, target = null, detail = null) => recordEvent(wsId, { actor: user, action, target, detail })

  if (p === '/api/developer/team') {
    if (post) return json(res, 405, { error: 'GET only' }), true
    return json(res, 200, teamView(ws, user)), true
  }
  if (!post) return json(res, 405, { error: 'POST only' }), true

  if (p === '/api/developer/workspace/switch') {
    const body = await readJson(req, 1_000)
    const id = String(body?.id ?? '').toLowerCase()
    const r = roleIn(user, id)
    if (!r) return json(res, 404, { error: 'You are not a member of that workspace.' }), true
    setSessionWorkspace(ctx.sessionId, id)
    return json(res, 200, { active: workspaceRef(id, user) }), true
  }

  if (p === '/api/developer/workspace/name') {
    const body = await readJson(req, 1_000)
    const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : ''
    if (!WS_NAME_RE.test(name)) return json(res, 400, { error: 'Name the workspace: 1 to 40 letters, digits, spaces or simple punctuation.' }), true
    const w = ensure(ws)
    const from = workspaceName(ws)
    w.name = name
    save()
    ev(ws, 'workspace.renamed', name, { from })
    return json(res, 200, { workspace: workspaceRef(ws, user) }), true
  }

  if (p === '/api/developer/team/invite') {
    const body = await readJson(req, 1_000)
    const newRole = String(body?.role ?? '')
    if (!MEMBER_ROLES.includes(newRole)) return json(res, 400, { error: `Choose a role: ${MEMBER_ROLES.join(', ')}.` }), true
    if (newRole === 'admin' && role !== 'owner') return json(res, 403, { error: 'Only the owner can invite admins.', code: 'forbidden-role' }), true
    let address = null
    if (body?.address !== undefined && body?.address !== null && body?.address !== '') {
      address = String(body.address).trim().toLowerCase()
      if (!ADDR_RE.test(address)) return json(res, 400, { error: 'That is not a wallet address (0x followed by 40 hex characters).' }), true
      if (address === ws) return json(res, 409, { error: "The owner can't be invited to their own workspace." }), true
    }
    const w = ensure(ws)
    pruneInvites(w)
    if (address && w.members[address]) return json(res, 409, { error: 'That wallet is already a member. Change its role instead.' }), true
    if (address && openInvites(w).some((i) => i.address === address)) return json(res, 409, { error: 'That wallet already has an open invite. Revoke it first to send another.' }), true
    if (openInvites(w).length >= MAX_OPEN_INVITES) return json(res, 409, { error: `A workspace can have ${MAX_OPEN_INVITES} open invites. Revoke one first.` }), true
    if (Object.keys(w.members).length + 1 >= MAX_MEMBERS) return json(res, 409, { error: `A workspace can have ${MAX_MEMBERS} members.` }), true
    if (!allow('inv-create-ip', ctx.ip, 60, 3_600_000) || !allow('inv-create-ws', ws, 30, 3_600_000)) return tooMany(res, 'invites in the last hour')
    const now = Date.now()
    const inv = { id: randomToken(9), role: newRole, createdBy: user, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + INVITE_TTL_MS).toISOString() }
    let token = null
    if (address) inv.address = address
    else {
      token = randomToken(24)
      inv.tokenHash = sha256(token)
    }
    w.invites.push(inv)
    save()
    ev(ws, 'team.invited', address ?? 'link', { inviteId: inv.id, role: newRole, kind: address ? 'address' : 'link' })
    return json(res, 201, { invite: inviteView(inv), ...(token ? { link: INVITE_LINK + token } : {}) }), true
  }

  let m = p.match(/^\/api\/developer\/team\/invites\/([\w-]{1,40})\/revoke$/)
  if (m) {
    const w = db[ws]
    const inv = w?.invites?.find((i) => i.id === m[1])
    if (!inv) return json(res, 404, { error: 'No such invite in this workspace.' }), true
    if (inviteState(inv) !== 'open') return json(res, 409, { error: `That invite is ${inviteState(inv)} already.` }), true
    if (inv.role === 'admin' && role !== 'owner') return json(res, 403, { error: 'Only the owner can revoke an admin invite.', code: 'forbidden-role' }), true
    inv.revokedAt = new Date().toISOString()
    inv.revokedBy = user
    save()
    ev(ws, 'team.invite_revoked', inv.address ?? 'link', { inviteId: inv.id, role: inv.role })
    return json(res, 200, { ok: true }), true
  }

  m = p.match(/^\/api\/developer\/team\/members\/(0x[0-9a-fA-F]{40})\/(role|remove)$/)
  if (m) {
    const target = m[1].toLowerCase()
    if (target === ws) return json(res, 403, { error: "The owner's role can't be changed and the owner can't be removed.", code: 'forbidden-role' }), true
    const w = db[ws]
    const member = w?.members?.[target]
    if (!member) return json(res, 404, { error: 'That wallet is not a member of this workspace.' }), true
    if (role !== 'owner' && member.role === 'admin') return json(res, 403, { error: 'Only the owner can change or remove an admin.', code: 'forbidden-role' }), true
    if (m[2] === 'role') {
      const body = await readJson(req, 1_000)
      const newRole = String(body?.role ?? '')
      if (!MEMBER_ROLES.includes(newRole)) return json(res, 400, { error: `Choose a role: ${MEMBER_ROLES.join(', ')}.` }), true
      if (newRole === 'admin' && role !== 'owner') return json(res, 403, { error: 'Only the owner can make someone an admin.', code: 'forbidden-role' }), true
      const from = member.role
      if (from !== newRole) {
        member.role = newRole
        save()
        ev(ws, 'team.role_changed', target, { from, to: newRole })
      }
      return json(res, 200, { member: { address: target, role: newRole, joinedAt: member.joinedAt } }), true
    }
    delete w.members[target]
    save()
    resetSessionsWorkspace(target, ws)
    ev(ws, 'team.removed', target, { role: member.role })
    return json(res, 200, { ok: true }), true
  }

  if (p === '/api/developer/team/leave') {
    const body = await readJson(req, 1_000)
    const id = body?.id ? String(body.id).toLowerCase() : ws
    if (id === user) return json(res, 400, { error: "You own this workspace, so you can't leave it." }), true
    const w = db[id]
    const member = w?.members?.[user]
    if (!member) return json(res, 404, { error: 'You are not a member of that workspace.' }), true
    delete w.members[user]
    save()
    resetSessionsWorkspace(user, id)
    recordEvent(id, { actor: user, action: 'team.left', target: user, detail: { role: member.role } })
    return json(res, 200, { ok: true, active: workspaceRef(user, user) }), true
  }

  if (p === '/api/developer/invite/accept') {
    if (!allow('inv-accept-ip', ctx.ip, 30, 600_000)) return tooMany(res, 'invite attempts')
    const body = await readJson(req, 1_000)
    let f = null
    if (body?.token) {
      const fails = (hits.get(`inv-miss:${ctx.ip}`) ?? []).filter((t) => Date.now() - t < 900_000)
      if (fails.length >= 20) return tooMany(res, 'unknown invite links')
      f = findByToken(String(body.token))
      if (!f) {
        hits.set(`inv-miss:${ctx.ip}`, [...fails, Date.now()])
        return json(res, 404, { error: 'This invite link is not valid.' }), true
      }
    } else if (body?.inviteId) {
      f = findById(String(body.inviteId))
      if (!f || !f.inv.address) return json(res, 404, { error: 'No such invite.' }), true
    } else return json(res, 400, { error: 'Give the invite token or the invite id.' }), true
    const { id, inv } = f
    if (inv.address && inv.address !== user) return json(res, 403, { error: 'This invite is for another wallet. Sign in with the invited wallet to accept it.', code: 'wrong-wallet' }), true
    const state = inviteState(inv)
    if (state !== 'open') return json(res, 410, { error: state === 'accepted' ? 'This invite was used already.' : state === 'revoked' ? 'This invite was revoked.' : 'This invite has expired. Ask for a new one.', state }), true
    if (!usable(id)) return json(res, 410, { error: 'This workspace is no longer available.' }), true
    if (id === user) return json(res, 409, { error: 'You own this workspace already.' }), true
    const w = ensure(id)
    if (w.members[user]) return json(res, 409, { error: `You are already a member of this workspace (${w.members[user].role}).` }), true
    if (Object.keys(w.members).length + 1 >= MAX_MEMBERS) return json(res, 409, { error: `This workspace is full (${MAX_MEMBERS} members).` }), true
    if (!allow('inv-accept-ws', id, 60, 3_600_000)) return tooMany(res, 'invites accepted in this workspace')
    const now = new Date().toISOString()
    w.members[user] = { role: inv.role, joinedAt: now, invitedBy: inv.createdBy }
    inv.acceptedAt = now
    inv.acceptedBy = user
    save()
    setSessionWorkspace(ctx.sessionId, id)
    recordEvent(id, { actor: user, action: 'team.joined', target: user, detail: { role: inv.role, inviteId: inv.id, kind: inv.address ? 'address' : 'link' } })
    return json(res, 200, { workspace: workspaceRef(id, user), active: workspaceRef(id, user) }), true
  }

  return json(res, 404, { error: 'not found' }), true
}

/** Test hook: an invite's expiry moves to the past. */
export function expireInviteForTest(inviteId) {
  const f = findById(inviteId)
  if (f) f.inv.expiresAt = new Date(Date.now() - 1000).toISOString()
}
