// End-to-end test of the app dashboard v2 server: workspaces, roles, invites, profile, company,
// sessions, activity log, CSV exports, usage extensions and usage-threshold notices.
//
//   npm run test:workspaces        (no build needed)
//
// The real server runs IN THIS PROCESS on port 8794 (TEST_PORT overrides) with a fresh temporary
// DATA_DIR, the tracker loop off and every chain's RPC pointed at a closed port, so nothing upstream is
// read. Several throwaway wallets sign in with SIWE the way test-siwe.mjs does. The Telegram sender for
// usage notices is a stub (activity.mjs's test hook).

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { makeChecker, makeClient, guardTestRun } from './test-helpers.mjs'

const PORT = Number(process.env.TEST_PORT) || 8794
await guardTestRun(PORT)
const BASE = `http://localhost:${PORT}`
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gully-workspaces-'))

Object.assign(process.env, {
  PORT: String(PORT),
  DATA_DIR: tmp,
  TRACKER_DATA: path.join(tmp, 'tracker-history.json'),
  DIST_DIR: path.join(tmp, 'no-dist'),
  ADMIN_TOKEN: crypto.randomBytes(24).toString('hex'),
  TRACKER_LOOP: 'off',
  TRACKER_SKIP_APIS: '1',
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
const ws = await import('../server/workspaces.mjs')
const access = await import('../server/access.mjs')
const activity = await import('../server/activity.mjs')
const profile = await import('../server/profile.mjs')
const exportsMod = await import('../server/exports.mjs')
const billing = await import('../server/billing.mjs')
const store = await import('../server/store.mjs')
await new Promise((r) => setTimeout(r, 300))

const t = makeChecker()
const { check } = t

const wallet = () => privateKeyToAccount(generatePrivateKey())
const W = { owner: wallet(), admin: wallet(), dev: wallet(), bill: wallet(), viewer: wallet(), stranger: wallet(), other: wallet() }
const A = Object.fromEntries(Object.entries(W).map(([k, w]) => [k, w.address.toLowerCase()]))
const C = Object.fromEntries(Object.keys(W).map((k) => [k, makeClient(BASE)]))
for (const k of Object.keys(W)) {
  const r = await C[k].signIn(W[k])
  if (r.status !== 200) throw new Error(`sign-in failed for ${k}: ${r.status} ${JSON.stringify(r.data)}`)
}
const { owner: O, admin: AD, dev: D, bill: B, viewer: V, stranger: S, other: X } = C
const forbiddenRole = (r) => r.status === 403 && r.data?.code === 'forbidden-role'
const passedGate = (r) => !forbiddenRole(r) && r.status !== 401
const tokenOf = (link) => String(link ?? '').split('#invite=')[1] ?? ''

try {
  /* ------------------------------------------------------------------ /me --- */
  {
    const me = await O.call('/api/developer/me')
    check('/me answers the v2 shape', me.status === 200 && me.data.address === A.owner && me.data.profile && me.data.company && Array.isArray(me.data.workspaces) && me.data.active && Array.isArray(me.data.pendingInvites), JSON.stringify(me.data).slice(0, 200))
    check('/me: the own workspace is the active one, role owner, id = owner address', me.data.active?.id === A.owner && me.data.active.role === 'owner' && me.data.active.owner === A.owner && me.data.workspaces.length === 1)
    check("/me: default name is \"<short>'s workspace\"", /^0x[0-9a-f]{4}…[0-9a-f]{4}'s workspace$/.test(me.data.active?.name ?? ''), me.data.active?.name)
    check('/me: profile defaults', me.data.profile.displayName === null && me.data.profile.email === null && me.data.profile.notify.telegramUsage === false && me.data.profile.notify.telegramBilling === false)
    check('/me without a session is 401', (await O.call('/api/developer/me', { useCookie: false })).status === 401)
    check('/account keeps working', (await O.call('/api/developer/account')).data?.address === A.owner)
  }

  /* ------------------------------------------------------- profile/company --- */
  {
    check('profile: a 41-character display name is refused', (await O.post('/api/developer/profile', { displayName: 'x'.repeat(41) })).status === 400)
    check('profile: a bad email is refused', (await O.post('/api/developer/profile', { email: 'not-an-email' })).status === 400)
    check('profile: notify must be booleans', (await O.post('/api/developer/profile', { notify: { telegramUsage: 'yes' } })).status === 400)
    check('profile: unknown notify keys are refused', (await O.post('/api/developer/profile', { notify: { sms: true } })).status === 400)
    const ok = await O.post('/api/developer/profile', { displayName: '  Ada Owner ', email: 'Ada@Example.com', notify: { telegramUsage: true } })
    check('profile: saved and normalised', ok.status === 200 && ok.data.profile.displayName === 'Ada Owner' && ok.data.profile.email === 'ada@example.com' && ok.data.profile.notify.telegramUsage === true && ok.data.profile.notify.telegramBilling === false, JSON.stringify(ok.data))
    const cleared = await O.post('/api/developer/profile', { email: null })
    check('profile: email null clears it, other fields stay', cleared.data?.profile?.email === null && cleared.data.profile.displayName === 'Ada Owner')
    check('profile: cross-site POST refused', (await O.call('/api/developer/profile', { method: 'POST', body: { displayName: 'x' } })).status === 403)
    profile.setEnsForTest(A.owner, 'ada.eth', 'https://example.com/a.png')
    const me = await O.call('/api/developer/me')
    check('profile: cached ENS name and avatar appear on /me', me.data.profile.ens === 'ada.eth' && me.data.profile.avatar === 'https://example.com/a.png')

    check('company: a 41-character tax ID is refused', (await O.post('/api/developer/company', { taxId: 'x'.repeat(41) })).status === 400)
    check('company: a non-string name is refused', (await O.post('/api/developer/company', { name: 42 })).status === 400)
    const co = await O.post('/api/developer/company', { name: 'Ada Labs', address: '1 Main St\r\nLisbon', taxId: 'PT123' })
    check('company: saved (line breaks normalised)', co.status === 200 && co.data.company.name === 'Ada Labs' && co.data.company.address === '1 Main St\nLisbon' && co.data.company.taxId === 'PT123', JSON.stringify(co.data))
    check('company: shows on /me for the active workspace', (await O.call('/api/developer/me')).data.company.name === 'Ada Labs')
  }

  /* --------------------------------------------------------------- invites --- */
  let devLink
  {
    const inv = await O.post('/api/developer/team/invite', { role: 'developer' })
    devLink = inv.data?.link
    check('link invite: created with a one-time link', inv.status === 201 && /^https:\/\/app\.gullylabs\.xyz\/#invite=[A-Za-z0-9_-]{32}$/.test(devLink ?? '') && inv.data.invite.kind === 'link' && inv.data.invite.role === 'developer', JSON.stringify(inv.data))
    const team = await O.call('/api/developer/team')
    check('link invite: listed without its token', team.data.invites.length === 1 && !JSON.stringify(team.data).includes(tokenOf(devLink)))
    check('link invite: only its hash is stored', !fs.readFileSync(path.join(tmp, 'workspaces.json'), 'utf8').includes(tokenOf(devLink)))
    const prev = await fetch(`${BASE}/api/developer/invite/${tokenOf(devLink)}`).then(async (r) => ({ status: r.status, data: await r.json() }))
    check('invite preview: public, shows name, role, short inviter, valid', prev.status === 200 && prev.data.valid === true && prev.data.role === 'developer' && /^0x[0-9a-f]{4}…[0-9a-f]{4}$/.test(prev.data.invitedBy) && prev.data.workspace.name.endsWith("'s workspace") && !('id' in prev.data.workspace), JSON.stringify(prev.data))
    check('invite preview: unknown token is 404', (await fetch(`${BASE}/api/developer/invite/${'A'.repeat(32)}`)).status === 404)
    check('accept: needs a session', (await D.post('/api/developer/invite/accept', { token: tokenOf(devLink) }, { useCookie: false })).status === 401)
    check('accept: needs X-Requested-With', (await D.call('/api/developer/invite/accept', { method: 'POST', body: { token: tokenOf(devLink) } })).status === 403)
    const acc = await D.post('/api/developer/invite/accept', { token: tokenOf(devLink) })
    check('accept: any wallet can take a link invite; the session switches to it', acc.status === 200 && acc.data.active.id === A.owner && acc.data.active.role === 'developer', JSON.stringify(acc.data))
    const dme = await D.call('/api/developer/me')
    check('accept: /me lists both workspaces, active is the joined one', dme.data.workspaces.length === 2 && dme.data.active.id === A.owner && dme.data.workspaces[0].id === A.dev && dme.data.workspaces[0].role === 'owner')
    check('accept: reusing the link is refused (410)', (await S.post('/api/developer/invite/accept', { token: tokenOf(devLink) })).status === 410)
    const prev2 = await fetch(`${BASE}/api/developer/invite/${tokenOf(devLink)}`).then((r) => r.json())
    check('invite preview: a used link is not valid', prev2.valid === false && prev2.state === 'accepted')

    const ai = await O.post('/api/developer/team/invite', { role: 'admin', address: W.admin.address })
    check('address invite: created, no link', ai.status === 201 && ai.data.invite.kind === 'address' && ai.data.invite.address === A.admin && !ai.data.link)
    check('address invite: a second open invite to the same wallet is refused', (await O.post('/api/developer/team/invite', { role: 'viewer', address: A.admin })).status === 409)
    const ame = await AD.call('/api/developer/me')
    check('address invite: visible under me.pendingInvites of that wallet', ame.data.pendingInvites.length === 1 && ame.data.pendingInvites[0].id === ai.data.invite.id && ame.data.pendingInvites[0].workspace.id === A.owner && ame.data.pendingInvites[0].role === 'admin' && ame.data.pendingInvites[0].invitedBy === A.owner)
    check('address invite: not visible to other wallets', (await S.call('/api/developer/me')).data.pendingInvites.length === 0)
    const wrong = await S.post('/api/developer/invite/accept', { inviteId: ai.data.invite.id })
    check('address invite: the wrong wallet is refused', wrong.status === 403 && wrong.data.code === 'wrong-wallet')
    const aok = await AD.post('/api/developer/invite/accept', { inviteId: ai.data.invite.id })
    check('address invite: the named wallet accepts', aok.status === 200 && aok.data.active.role === 'admin')
    check('address invite: reuse is refused', (await AD.post('/api/developer/invite/accept', { inviteId: ai.data.invite.id })).status === 410)

    check('invite: the owner cannot be invited', (await O.post('/api/developer/team/invite', { role: 'viewer', address: A.owner })).status === 409)
    check('invite: a member cannot be invited again (one role per workspace)', (await O.post('/api/developer/team/invite', { role: 'viewer', address: A.dev })).status === 409)
    check('invite: role owner is refused', (await O.post('/api/developer/team/invite', { role: 'owner' })).status === 400)
    check('invite: a bad address is refused', (await O.post('/api/developer/team/invite', { role: 'viewer', address: '0x123' })).status === 400)

    const bi = await O.post('/api/developer/team/invite', { role: 'billing', address: A.bill })
    check('billing invite accepted', (await B.post('/api/developer/invite/accept', { inviteId: bi.data.invite.id })).status === 200)
    const vi = await O.post('/api/developer/team/invite', { role: 'viewer' })
    check('viewer link invite accepted', (await V.post('/api/developer/invite/accept', { token: tokenOf(vi.data.link) })).status === 200)
    // A link taken by someone already in the workspace is refused, and stays open.
    const extra = await O.post('/api/developer/team/invite', { role: 'viewer' })
    check('accept: a member cannot take a second role', (await D.post('/api/developer/invite/accept', { token: tokenOf(extra.data.link) })).status === 409)
    check('accept: the owner cannot accept into their own workspace', (await O.post('/api/developer/invite/accept', { token: tokenOf(extra.data.link) })).status === 409)

    const ex = await O.post('/api/developer/team/invite', { role: 'viewer' })
    ws.expireInviteForTest(ex.data.invite.id)
    const exr = await S.post('/api/developer/invite/accept', { token: tokenOf(ex.data.link) })
    check('accept: an expired invite is refused (410)', exr.status === 410 && exr.data.state === 'expired')
    const rv = await O.post('/api/developer/team/invite', { role: 'viewer' })
    check('revoke: an open invite is revoked', (await O.post(`/api/developer/team/invites/${rv.data.invite.id}/revoke`)).status === 200)
    const rvr = await S.post('/api/developer/invite/accept', { token: tokenOf(rv.data.link) })
    check('accept: a revoked invite is refused (410)', rvr.status === 410 && rvr.data.state === 'revoked')
    check('revoke: twice is 409', (await O.post(`/api/developer/team/invites/${rv.data.invite.id}/revoke`)).status === 409)
    check('accept: unknown token is 404', (await S.post('/api/developer/invite/accept', { token: 'B'.repeat(32) })).status === 404)
    await O.post(`/api/developer/team/invites/${extra.data.invite.id}/revoke`)

    const team2 = await O.call('/api/developer/team')
    const roles = Object.fromEntries(team2.data.members.map((m) => [m.address, m.role]))
    check('team: owner first, then members with roles', team2.data.members[0].address === A.owner && team2.data.members[0].role === 'owner' && team2.data.members[0].you === true && roles[A.admin] === 'admin' && roles[A.dev] === 'developer' && roles[A.bill] === 'billing' && roles[A.viewer] === 'viewer' && team2.data.members.length === 5, JSON.stringify(roles))
    check('team: lastSeenAt is reported', team2.data.members.every((m) => typeof m.lastSeenAt === 'string'))
    check('team: closed invites are not listed', team2.data.invites.length === 0, JSON.stringify(team2.data.invites))
  }

  /* ----------------------------------------------------------- role matrix --- */
  let ownerKeyId
  {
    const dk = await D.post('/api/developer/keys', { name: 'Dev key' })
    check('developer: creates keys', dk.status === 201)
    ownerKeyId = dk.data?.key?.id
    check("developer: the key lands in the owner's workspace", (await O.call('/api/developer/account')).data.keys.some((k) => k.id === ownerKeyId))
    check('admin: creates keys', (await AD.post('/api/developer/keys', { name: 'Admin key' })).status === 201)
    check('billing: cannot create keys', forbiddenRole(await B.post('/api/developer/keys', { name: 'Nope' })))
    const vr = await V.post('/api/developer/keys', { name: 'Nope' })
    check('viewer: cannot create keys (403 forbidden-role, message names the role)', forbiddenRole(vr) && vr.data.error === "Your role (viewer) can't do this.", JSON.stringify(vr.data))
    const tmpKey = (await D.post('/api/developer/keys', { name: 'Temp' })).data.key.id
    check('viewer: cannot revoke keys', forbiddenRole(await V.post(`/api/developer/keys/${tmpKey}/revoke`)))
    check('billing: cannot revoke keys', forbiddenRole(await B.post(`/api/developer/keys/${tmpKey}/revoke`)))
    check('developer: revokes keys', (await D.post(`/api/developer/keys/${tmpKey}/revoke`)).status === 200)
    check('viewer: reads keys', (await V.call('/api/developer/account')).data.keys.length === 3)

    const badAlert = { name: 'x', condition: { type: 'nope' } }
    check('viewer: cannot create alerts', forbiddenRole(await V.post('/api/developer/alerts', badAlert)))
    check('billing: cannot create alerts', forbiddenRole(await B.post('/api/developer/alerts', badAlert)))
    check('developer: passes the gate for alerts', passedGate(await D.post('/api/developer/alerts', badAlert)))
    const dirAlert = { name: 'x', chain: 'robinhood', ticker: 'NVDA', condition: { type: 'gap', pct: 2, direction: 'sideways' } }
    check('viewer: cannot create a one-sided alert either', forbiddenRole(await V.post('/api/developer/alerts', { ...dirAlert, condition: { type: 'gap', pct: 2, direction: 'above' } })))
    const dirRes = await D.post('/api/developer/alerts', dirAlert)
    check("developer: the workspace's alerts check the direction (400 for an unknown one)", dirRes.status === 400 && /direction/.test(dirRes.data?.error ?? ''), JSON.stringify(dirRes.data))

    check('developer: cannot start a checkout', forbiddenRole(await D.post('/api/developer/checkout', { plan: 'pro' })))
    check('viewer: cannot start a checkout', forbiddenRole(await V.post('/api/developer/checkout', { plan: 'pro' })))
    check('billing: passes the gate for checkout', passedGate(await B.post('/api/developer/checkout', { plan: 'pro' })))
    check('billing: passes the gate for checkout verify', passedGate(await B.post('/api/developer/checkout/verify', { plan: 'pro', txHash: '0x1' })))
    check('developer: cannot buy an analytics plan', forbiddenRole(await D.post('/api/developer/analytics/checkout', { plan: 'starter' })))
    check('billing: passes the gate for analytics plan purchase', passedGate(await B.post('/api/developer/analytics/checkout', { plan: 'starter' })))
    check('billing: cannot start the analytics trial', forbiddenRole(await B.post('/api/developer/analytics/start')))
    check('viewer: cannot start the analytics trial', forbiddenRole(await V.post('/api/developer/analytics/start')))
    check('developer: passes the gate for the analytics trial', passedGate(await D.post('/api/developer/analytics/start')))
    check('viewer: reads billing', (await V.call('/api/developer/billing')).status === 200)

    check('developer: cannot invite', forbiddenRole(await D.post('/api/developer/team/invite', { role: 'viewer' })))
    check('billing: cannot invite', forbiddenRole(await B.post('/api/developer/team/invite', { role: 'viewer' })))
    check('viewer: cannot invite', forbiddenRole(await V.post('/api/developer/team/invite', { role: 'viewer' })))
    const adInv = await AD.post('/api/developer/team/invite', { role: 'viewer' })
    check('admin: invites', adInv.status === 201)
    await AD.post(`/api/developer/team/invites/${adInv.data.invite.id}/revoke`)
    check('admin: cannot invite an admin', (await AD.post('/api/developer/team/invite', { role: 'admin' })).status === 403)

    check('developer: cannot edit company', forbiddenRole(await D.post('/api/developer/company', { name: 'x' })))
    check('billing: edits company', (await B.post('/api/developer/company', { taxId: 'PT999' })).status === 200)
    check('admin: edits company', (await AD.post('/api/developer/company', { name: 'Ada Labs Lda' })).status === 200)
    check('developer: cannot rename the workspace', forbiddenRole(await D.post('/api/developer/workspace/name', { name: 'Hacked' })))
    check('workspace rename: bad name refused', (await AD.post('/api/developer/workspace/name', { name: '<b>' })).status === 400)
    check('admin: renames the workspace', (await AD.post('/api/developer/workspace/name', { name: "Ada's Team" })).status === 200)
    check('the new name shows for members', (await V.call('/api/developer/me')).data.active.name === "Ada's Team")
    check('viewer: edits own profile', (await V.post('/api/developer/profile', { displayName: 'Vee' })).status === 200)
    check('viewer: reads team, activity and exports', (await V.call('/api/developer/team')).status === 200 && (await V.call('/api/developer/activity')).status === 200 && (await V.call('/api/developer/export/usage.csv')).status === 200)
  }

  /* -------------------------------------------------------- data isolation --- */
  {
    const xk = await X.post('/api/developer/keys', { name: 'Other secret' })
    check('other workspace: key created', xk.status === 201)
    const dAcc = await D.call('/api/developer/account')
    check("isolation: a member of A does not see workspace B's keys", dAcc.data.address === A.owner && !dAcc.data.keys.some((k) => k.id === xk.data.key.id))
    check('isolation: switching to a workspace you are not in is 404', (await D.post('/api/developer/workspace/switch', { id: A.other })).status === 404)
    check("isolation: B's activity is not in A's log", !JSON.stringify((await D.call('/api/developer/activity')).data).includes(xk.data.key.id))
    check("isolation: A's team is not visible from B", !JSON.stringify((await X.call('/api/developer/team')).data).includes(A.dev))
    const sw = await D.post('/api/developer/workspace/switch', { id: A.dev })
    check('switch: back to the own workspace', sw.status === 200 && sw.data.active.id === A.dev && sw.data.active.role === 'owner')
    check('switch: own workspace shows only own keys', (await D.call('/api/developer/account')).data.keys.length === 0)
    check('switch: GET is refused', (await D.call('/api/developer/workspace/switch')).status === 405)
    const sw2 = await D.post('/api/developer/workspace/switch', { id: A.owner.toUpperCase().replace('0X', '0x') })
    check('switch: to a workspace you belong to (address case ignored)', sw2.status === 200 && sw2.data.active.role === 'developer')
  }

  /* ------------------------------------------------ role change and remove --- */
  {
    check("admin: cannot change the owner's role", (await AD.post(`/api/developer/team/members/${A.owner}/role`, { role: 'viewer' })).status === 403)
    check('admin: cannot remove the owner', (await AD.post(`/api/developer/team/members/${A.owner}/remove`)).status === 403)
    check('admin: cannot make someone an admin', (await AD.post(`/api/developer/team/members/${A.dev}/role`, { role: 'admin' })).status === 403)
    check('admin: cannot change an admin (itself)', (await AD.post(`/api/developer/team/members/${A.admin}/role`, { role: 'viewer' })).status === 403)
    check('admin: cannot remove an admin', (await AD.post(`/api/developer/team/members/${A.admin}/remove`)).status === 403)
    check('developer: cannot change roles', forbiddenRole(await D.post(`/api/developer/team/members/${A.viewer}/role`, { role: 'developer' })))
    check('role change: bad role refused', (await AD.post(`/api/developer/team/members/${A.dev}/role`, { role: 'owner' })).status === 400)
    check('role change: unknown member is 404', (await AD.post(`/api/developer/team/members/${A.stranger}/role`, { role: 'viewer' })).status === 404)
    const ch = await AD.post(`/api/developer/team/members/${A.dev}/role`, { role: 'viewer' })
    check('admin: changes a developer to viewer', ch.status === 200 && ch.data.member.role === 'viewer')
    check('role change takes effect at once (viewer cannot create keys)', forbiddenRole(await D.post('/api/developer/keys', { name: 'Nope' })))
    await AD.post(`/api/developer/team/members/${A.dev}/role`, { role: 'developer' })
    check('owner: demotes an admin', (await O.post(`/api/developer/team/members/${A.admin}/role`, { role: 'developer' })).status === 200)
    check('the demoted admin loses team rights at once', forbiddenRole(await AD.post('/api/developer/team/invite', { role: 'viewer' })))
    check('owner: makes them admin again', (await O.post(`/api/developer/team/members/${A.admin}/role`, { role: 'admin' })).status === 200)

    const rm = await AD.post(`/api/developer/team/members/${A.viewer}/remove`)
    check('admin: removes a viewer', rm.status === 200)
    const vme = await V.call('/api/developer/me')
    check('removed member falls back to their own workspace', vme.status === 200 && vme.data.active.id === A.viewer && vme.data.workspaces.length === 1)
    check("removed member no longer reads the workspace's keys", (await V.call('/api/developer/account')).data.address === A.viewer)
    const vsess = Object.values(JSON.parse(fs.readFileSync(path.join(tmp, 'sessions.json'), 'utf8'))).filter((s) => s.address === A.viewer)
    check("removed member's sessions no longer point at the workspace", vsess.every((s) => !s.activeWorkspace))

    check('owner cannot leave their own workspace', (await O.post('/api/developer/team/leave')).status === 400)
    const lv = await B.post('/api/developer/team/leave')
    check('a member leaves', lv.status === 200 && lv.data.active.id === A.bill)
    check('after leaving: one workspace left', (await B.call('/api/developer/me')).data.workspaces.length === 1)
    check('leave: not a member is 404', (await S.post('/api/developer/team/leave', { id: A.owner })).status === 404)
  }

  /* -------------------------------------------------------------- sessions --- */
  {
    const O2 = makeClient(BASE)
    await O2.signIn(W.owner)
    const list = await O.call('/api/developer/sessions', { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36' } })
    const sessions = list.data?.sessions ?? []
    check('sessions: lists both sessions, one current', list.status === 200 && sessions.length === 2 && sessions.filter((s) => s.current).length === 1, JSON.stringify(list.data).slice(0, 300))
    check('sessions: device, created and last-seen times', sessions.every((s) => typeof s.device === 'string' && s.createdAt && s.lastSeenAt))
    const cookieId = O.cookie.split('=')[1]
    const stored = Object.keys(JSON.parse(fs.readFileSync(path.join(tmp, 'sessions.json'), 'utf8')))
    check('sessions: ids are neither the cookie nor the stored hash', sessions.every((s) => /^[0-9a-f]{24}$/.test(s.id) && s.id !== cookieId && !stored.includes(s.id) && !stored.some((h) => h.startsWith(s.id))))
    check('sessions: revoke needs X-Requested-With', (await O.call('/api/developer/sessions/revoke', { method: 'POST', body: { id: 'others' } })).status === 403)
    check('sessions: unknown id is 404', (await O.post('/api/developer/sessions/revoke', { id: 'f'.repeat(24) })).status === 404)
    const r = await O.post('/api/developer/sessions/revoke', { id: 'others' })
    check('sessions: revoke others', r.status === 200 && r.data.revoked === 1 && r.data.signedOut === false)
    check('sessions: the other session is signed out', (await O2.call('/api/developer/me')).status === 401)
    check('sessions: this one still works', (await O.call('/api/developer/me')).status === 200)
    const O3 = makeClient(BASE)
    await O3.signIn(W.owner)
    const other = (await O.call('/api/developer/sessions')).data.sessions.find((s) => !s.current)
    check('sessions: revoke one by id', (await O.post('/api/developer/sessions/revoke', { id: other.id })).data?.revoked === 1 && (await O3.call('/api/developer/me')).status === 401)
    const cur = (await O.call('/api/developer/sessions')).data.sessions.find((s) => s.current)
    const self = await O.post('/api/developer/sessions/revoke', { id: cur.id })
    check('sessions: revoking the current one signs out and clears the cookie', self.data?.signedOut === true && /Max-Age=0/.test(self.headers.get('set-cookie') ?? '') && (await O.call('/api/developer/me')).status === 401)
    await O.signIn(W.owner)
  }

  /* -------------------------------------------------------------- activity --- */
  {
    // Enough key renames to need a second page.
    for (let i = 0; i < 55; i++) await O.post(`/api/developer/keys/${ownerKeyId}/rename`, { name: `Dev key ${i}` })
    const p1 = await O.call('/api/developer/activity')
    check('activity: a page of 50, newest first, with a cursor', p1.status === 200 && p1.data.events.length === 50 && p1.data.nextCursor && p1.data.events[0].at >= p1.data.events[49].at)
    const all = [...p1.data.events]
    let cursor = p1.data.nextCursor
    while (cursor) {
      const p = await O.call(`/api/developer/activity?cursor=${encodeURIComponent(cursor)}`)
      all.push(...p.data.events)
      cursor = p.data.nextCursor
    }
    check('activity: pages do not overlap', new Set(all.map((e) => e.id)).size === all.length)
    check('activity: a bad cursor is 400', (await O.call('/api/developer/activity?cursor=nope')).status === 400)
    const has = (action, f = () => true) => all.some((e) => e.action === action && f(e))
    check('activity: event shape { at, actor, action, target, detail }', all.every((e) => e.at && e.actor && e.action && 'target' in e && 'detail' in e))
    check('activity: key.created by the developer', has('key.created', (e) => e.actor === A.dev && e.target === 'Dev key'))
    check('activity: key.revoked', has('key.revoked', (e) => e.actor === A.dev))
    check('activity: key.renamed with from/to', has('key.renamed', (e) => e.detail?.from === 'Dev key' && e.detail?.to === 'Dev key 0'))
    check('activity: team.invited / team.joined', has('team.invited') && has('team.joined', (e) => e.actor === A.dev))
    check('activity: team.invite_revoked', has('team.invite_revoked'))
    check('activity: team.role_changed', has('team.role_changed', (e) => e.target === A.dev && e.detail?.from === 'developer' && e.detail?.to === 'viewer'))
    check('activity: team.removed and team.left', has('team.removed', (e) => e.target === A.viewer && e.actor === A.admin) && has('team.left', (e) => e.actor === A.bill))
    check('activity: workspace.renamed', has('workspace.renamed', (e) => e.target === "Ada's Team"))
    check('activity: company.updated', has('company.updated', (e) => e.actor === A.bill))
    check('activity: profile.updated', has('profile.updated', (e) => e.actor === A.owner))
    check('activity: sessions.revoked', has('sessions.revoked'))
    check('activity: refused or failed writes are not logged', !has('billing.quote') && !has('alert.created'))
    check('activity: secrets never appear', !/gl_live_[A-Za-z0-9_-]{20,}/.test(JSON.stringify(all)) && !JSON.stringify(all).includes(tokenOf(devLink)))
    // Observed mapping of the other routes (unit level; their success needs upstream services).
    const ev = activity.eventFor('POST', '/checkout/verify', 200, { payment: { plan: 'pro', usd: '$49.00', txHash: '0xabc', chain: 'Base' } })
    check('activity map: billing.paid', ev?.action === 'billing.paid' && ev.detail.plan === 'pro' && ev.detail.txHash === '0xabc')
    check('activity map: billing.quote', activity.eventFor('POST', '/checkout', 200, { intent: { plan: 'pro', usd: '$49.00', asset: { id: 'base-usdc' } } })?.action === 'billing.quote')
    check('activity map: alert created / updated / deleted / tested', activity.eventFor('POST', '/alerts', 201, { alert: { id: 'a1', name: 'N' } })?.action === 'alert.created' && activity.eventFor('POST', '/alerts/a1/pause', 200, { alert: { name: 'N' } })?.detail.change === 'paused' && activity.eventFor('POST', '/alerts/a1/delete', 200, {})?.action === 'alert.deleted' && activity.eventFor('POST', '/alerts/a1/test', 200, {})?.action === 'alert.tested')
    check('activity map: analytics trial / site / plan', activity.eventFor('POST', '/analytics/start', 201, {})?.action === 'analytics.trial' && activity.eventFor('POST', '/analytics/sites', 201, { site: { domain: 'a.com' } })?.target === 'a.com' && activity.eventFor('POST', '/analytics/checkout/verify', 200, { payment: { plan: 'starter' } })?.action === 'analytics.plan')
    check('activity map: failures are not events', activity.eventFor('POST', '/keys', 409, {}) === null && activity.eventFor('GET', '/keys', 200, {}) === null)
  }

  /* ------------------------------------------------------- usage extensions --- */
  {
    const now = Date.now()
    access.addUsageForTest(ownerKeyId, now - 2 * 3_600_000, [10, 7, 1, 1, 1], { '/api/tracker': 6, '/api/tracker/history': 4 })
    access.addUsageForTest(ownerKeyId, now - 30 * 3_600_000, [5, 5, 0, 0, 0])
    access.addUsageForTest(ownerKeyId, now - 50 * 3_600_000, [1, 1, 0, 0, 0])
    const u = await O.call('/api/developer/usage?range=24h')
    check('usage: old fields still there', u.status === 200 && Array.isArray(u.data.points) && u.data.points.length === 24 && u.data.today && u.data.rangeTotals && Array.isArray(u.data.keys))
    check('usage: byStatus over the range', u.data.byStatus?.ok === 7 && u.data.byStatus.client === 1 && u.data.byStatus.limited === 1 && u.data.byStatus.server === 1, JSON.stringify(u.data.byStatus))
    check('usage: previous period totals', u.data.previous?.total === 5 && u.data.previous.ok === 5 && u.data.previous.from && u.data.previous.to, JSON.stringify(u.data.previous))
    check('usage: byEndpoint busiest first', u.data.byEndpoint?.[0]?.endpoint === '/api/tracker' && u.data.byEndpoint[0].count === 6 && u.data.byEndpoint[1].endpoint === '/api/tracker/history', JSON.stringify(u.data.byEndpoint))
    const xu = await X.call('/api/developer/usage?range=24h')
    check('usage: unknown data is null, not 0', xu.data.previous === null && xu.data.byStatus === null && xu.data.byEndpoint === null && xu.data.endpointsSince === null, JSON.stringify({ p: xu.data.previous, s: xu.data.byStatus, e: xu.data.byEndpoint }))
    // A real keyed request is counted under its route template.
    const k = await O.post('/api/developer/keys', { name: 'Live key' })
    await O.call('/api/tracker/movers?x=1', { auth: k.data.secret, useCookie: false })
    await O.call('/api/tracker/nope', { auth: k.data.secret, useCookie: false })
    await new Promise((r) => setTimeout(r, 100))
    const u2 = await O.call('/api/developer/usage?range=7d')
    const eps = Object.fromEntries((u2.data.byEndpoint ?? []).map((e) => [e.endpoint, e.count]))
    check('usage: live requests counted per template (other for unknown paths)', eps['/api/tracker/movers'] >= 1 && eps.other >= 1, JSON.stringify(eps))
    check('usage: 7d has no previous (counting began within it)', u2.data.previous === null)
    check('endpointOf normalises paths', access.endpointOf('/api/tracker/') === '/api/tracker' && access.endpointOf('/api/tracker/history') === '/api/tracker/history' && access.endpointOf('/api/plans') === '/api/plans' && access.endpointOf('/api/tracker/xyz') === 'other' && access.endpointOf('other') === 'other')
  }

  /* ------------------------------------------------------------------ CSV --- */
  {
    const c = exportsMod.csvCell
    check('csv: formula prefixes are neutralised', c('=1+2') === "'=1+2" && c('+1') === "'+1" && c('-1') === "'-1" && c('@SUM(A1)') === "'@SUM(A1)")
    check('csv: commas, quotes and line breaks are quoted', c('a,b') === '"a,b"' && c('say "hi"') === '"say ""hi"""' && c('a\nb') === '"a\nb"')
    check('csv: numbers stay numbers, null is empty', c(-5) === '-5' && c(12) === '12' && c(null) === '' && c(undefined) === '')
    check('csv: formula and quoting combine', c('=HYPERLINK("x")') === `"'=HYPERLINK(""x"")"`)

    const r = await fetch(`${BASE}/api/developer/export/usage.csv?range=24h`, { headers: { cookie: O.cookie } })
    const body = await r.text()
    check('usage.csv: text/csv with an attachment filename', r.status === 200 && /^text\/csv/.test(r.headers.get('content-type') ?? '') && /^attachment; filename="gully-usage-24h-\d{4}-\d{2}-\d{2}\.csv"/.test(r.headers.get('content-disposition') ?? ''), r.headers.get('content-disposition'))
    const lines = body.trim().split('\r\n')
    check('usage.csv: header and rows', lines[0] === 'time,key,total,ok,client_err,limited,server_err' && lines.some((l) => /,Dev key \d+,10,7,1,1,1$/.test(l)), lines.slice(0, 3).join(' | '))
    check('usage.csv: needs a session', (await fetch(`${BASE}/api/developer/export/usage.csv`)).status === 401)

    billing.ledger().payments.push({ id: 'pay1', kind: 'plan', txHash: '0x' + 'ab'.repeat(32), chainId: 8453, assetId: 'base-usdc', symbol: 'USDC', decimals: 6, amountRaw: '49000000', usdCents: '4900', from: '=HYPERLINK("http://evil")', address: A.owner, plan: 'pro', blockNumber: 1, at: new Date().toISOString(), periodStart: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() })
    const pr = await fetch(`${BASE}/api/developer/export/payments.csv`, { headers: { cookie: O.cookie } })
    const pbody = await pr.text()
    check('payments.csv: attachment, header, the payment, escaped', pr.status === 200 && /filename="gully-payments-/.test(pr.headers.get('content-disposition') ?? '') && pbody.startsWith('date,kind,plan,usd,amount,asset,chain,tx_hash,from,') && pbody.includes(`"'=HYPERLINK(""http://evil"")"`) && pbody.includes(',plan,pro,49,49,USDC,Base,'), pbody.slice(0, 300))
    const xp = await (await fetch(`${BASE}/api/developer/export/payments.csv`, { headers: { cookie: X.cookie } })).text()
    check("payments.csv: another workspace does not get the owner's payments", xp.trim().split('\r\n').length === 1)
    const dp = await (await fetch(`${BASE}/api/developer/export/payments.csv`, { headers: { cookie: D.cookie } })).text()
    check('payments.csv: a member of the workspace gets them', dp.includes('0x' + 'ab'.repeat(32)))
  }

  /* --------------------------------------------------- threshold notices --- */
  {
    const sent = []
    activity.setUsageNotifierForTest(async (address, text) => {
      sent.push({ address, text })
      return { ok: true }
    })
    access.bumpMinuteForTest(ownerKeyId, 500) // Free: 600 a minute, so 83%
    const f1 = await activity.checkUsageThresholds()
    const o1 = f1.find((f) => f.workspace === A.owner)
    check('threshold: 80% fires and is sent to the owner (notify on)', o1?.threshold === 80 && o1.sent === true && sent.length === 1 && sent[0].address === A.owner && /80|83%/.test(sent[0].text), JSON.stringify(f1))
    check('threshold: not again within 24 hours', !(await activity.checkUsageThresholds()).some((f) => f.workspace === A.owner))
    access.bumpMinuteForTest(ownerKeyId, 150)
    const f2 = await activity.checkUsageThresholds()
    check('threshold: 100% fires separately', f2.find((f) => f.workspace === A.owner)?.threshold === 100 && sent.length === 2)
    const xKey = (await X.call('/api/developer/account')).data.keys[0].id
    access.bumpMinuteForTest(xKey, 600)
    const f3 = await activity.checkUsageThresholds()
    const x3 = f3.find((f) => f.workspace === A.other)
    check('threshold: notify off records the event but sends nothing', x3?.threshold === 100 && x3.sent === false && sent.length === 2)
    check('threshold: passing 100% also marks 80% for the day', !!activity.usageNoticesOf(A.other)[80])
    const log = (await O.call('/api/developer/activity')).data.events
    check('threshold: an activity event by system', log.some((e) => e.action === 'usage.threshold' && e.actor === 'system' && e.detail?.threshold === 80) && log.some((e) => e.action === 'usage.threshold' && e.detail?.threshold === 100))
    activity.setUsageNotifierForTest(null)
  }

  /* ----------------------------------------------------- misc gate checks --- */
  {
    check('legacy /me with a Bearer key still answers the key view', (await O.call('/api/developer/me', { auth: 'gl_live_unknown', useCookie: false })).status === 401 && (await O.call('/api/developer/me', { auth: 'gl_live_unknown', useCookie: false })).data?.error === 'Sign in with a valid API key.')
    check('POST to /team without the CSRF header is refused', (await O.call('/api/developer/team/invite', { method: 'POST', body: { role: 'viewer' } })).status === 403)
    check('foreign Origin is refused', (await O.post('/api/developer/team/invite', { role: 'viewer' }, { headers: { origin: 'https://evil.example' } })).status === 403)
    check('unknown team route is 404', (await O.post('/api/developer/team/nope')).status === 404)
    check('store keeps sessions hashed', !fs.readFileSync(path.join(tmp, 'sessions.json'), 'utf8').includes(O.cookie.split('=')[1]))
    check('workspaces.json written atomically (no .tmp left)', fs.existsSync(path.join(tmp, 'workspaces.json')) && !fs.existsSync(path.join(tmp, 'workspaces.json.tmp')))
    check('categoryOf: unknown writes need admin', ws.canWrite('developer', '/api/developer/somethingnew') === false && ws.canWrite('admin', '/api/developer/somethingnew') === true)
    check('store: lastSeenOf works', typeof store.lastSeenOf(A.owner) === 'string')
  }
} catch (e) {
  t.failed++
  console.error('FAIL  test crashed:', e)
}

console.log(`\n${t.passed} passed, ${t.failed} failed`)
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(t.failed ? 1 : 0)
