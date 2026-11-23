// Account links between a platform identity (Telegram user, Discord user, Farcaster fid) and a Gully account, the shared
// piece of the identity kit (design: IDENTITY-KIT.md). A link is made ONLY while the person is signed in to Gully on the
// website (session cookie) AND proves the platform identity AND confirms once. Flag AI_LINKING=1.
//
//   Telegram: POST /api/surfaces/link/telegram   Authorization: tma <initData> + session cookie, body { confirm: true }
//             (without confirm: a preview { platform, platformName, gully } so the page can ask "Link these?")
//   Discord:  GET  /api/surfaces/link/discord/start       -> 302 to Discord OAuth2 (scope identify, state = signed, 10 min)
//             GET  /api/surfaces/link/discord/callback    -> exchanges the code, links, 302 to /ask?linked=discord
//   Unlink:   POST /api/surfaces/link/<platform>/unlink   (session cookie)
//
// A link stores { platform, platformId, user, workspace, at } in DATA_DIR/surface-links.json: no tokens, no names. It is used
// ONLY for a private place (Telegram DM or Mini App, Discord DM), never in a group, channel, thread or cast.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, json, readJson } from '../http.mjs'

const env = (k) => String(process.env[k] ?? '').trim()
export const linkingEnabled = () => env('AI_LINKING') === '1'
const FILE = () => path.join(process.env.DATA_DIR ?? DATA_DIR, 'surface-links.json')
const PLATFORMS = ['telegram', 'discord', 'farcaster']

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE(), 'utf8'))
  } catch {
    return { links: [] }
  }
}
function save(db) {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true })
  fs.writeFileSync(FILE(), JSON.stringify(db))
}

export function linkOf(platform, platformId) {
  return load().links.find((l) => l.platform === platform && l.platformId === String(platformId)) ?? null
}
/** The Gully session context of a linked platform user (for a private place), or null. */
export function ctxOfLink(platform, platformId) {
  const l = linkOf(platform, platformId)
  return l ? { user: l.user, workspace: l.workspace, role: 'linked account' } : null
}
export function addLink({ platform, platformId, user, workspace, now = Date.now() }) {
  if (!PLATFORMS.includes(platform) || !platformId || !user) return null
  const db = load()
  db.links = db.links.filter((l) => !(l.platform === platform && (l.platformId === String(platformId) || (l.user === user && l.workspace === workspace))))
  const l = { platform, platformId: String(platformId), user, workspace, at: now }
  db.links.push(l)
  save(db)
  return l
}
export function removeLink(platform, user) {
  const db = load()
  const n = db.links.length
  db.links = db.links.filter((l) => !(l.platform === platform && l.user === user))
  save(db)
  return n - db.links.length
}

/* ---------------------------------------------------------- Discord OAuth state --- */

const secret = () => env('AI_LINK_STATE_SECRET') || env('DISCORD_BOT_TOKEN') || 'unset'
export function signState(user, now = Date.now(), nonce = crypto.randomBytes(8).toString('hex')) {
  const body = `${Buffer.from(user).toString('base64url')}.${now}.${nonce}`
  return `${body}.${crypto.createHmac('sha256', secret()).update(body).digest('base64url')}`
}
/** The user bound into a state, or null (bad MAC, older than 10 minutes). */
export function readState(state, now = Date.now()) {
  const parts = String(state ?? '').split('.')
  if (parts.length !== 4) return null
  const body = parts.slice(0, 3).join('.')
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url')
  const a = Buffer.from(mac)
  const b = Buffer.from(parts[3])
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  if (now - Number(parts[1]) > 600_000 || now < Number(parts[1]) - 5000) return null
  return Buffer.from(parts[0], 'base64url').toString()
}

export function discordAuthorizeUrl(user, redirectUri) {
  const q = new URLSearchParams({ client_id: env('DISCORD_APP_ID'), response_type: 'code', scope: 'identify', redirect_uri: redirectUri, state: signState(user), prompt: 'none' })
  return `https://discord.com/oauth2/authorize?${q}`
}

/** deps: { sessionContext, validateInitData, token, fetch } injected by index.mjs (and by the tests). */
export async function handleLinks(req, res, url, deps) {
  const p = url.pathname
  if (!p.startsWith('/api/surfaces/link/')) return false
  if (!linkingEnabled()) return json(res, 404, { error: 'not found' }), true
  const ctx = deps.sessionContext(req)
  if (!ctx) return json(res, 401, { error: 'Sign in to Gully first.' }), true
  const redirect = `${deps.origin ?? 'https://gullylabs.xyz'}/api/surfaces/link/discord/callback`
  if (p === '/api/surfaces/link/discord/start') {
    if (!env('DISCORD_APP_ID')) return json(res, 404, { error: 'not found' }), true
    res.writeHead(302, { Location: discordAuthorizeUrl(ctx.user, redirect), 'Cache-Control': 'no-store' })
    return res.end(), true
  }
  if (p === '/api/surfaces/link/discord/callback') {
    const user = readState(url.searchParams.get('state'), deps.now)
    if (!user || user !== ctx.user) return json(res, 400, { error: 'This link expired. Start again from Gully AI settings.' }), true
    const code = url.searchParams.get('code') ?? ''
    const f = deps.fetch ?? fetch
    const tok = await f('https://discord.com/api/v10/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env('DISCORD_APP_ID'), client_secret: env('DISCORD_CLIENT_SECRET'), grant_type: 'authorization_code', code, redirect_uri: redirect }) })
    if (!tok.ok) return json(res, 502, { error: 'Discord did not confirm the sign-in. Try again.' }), true
    const { access_token } = await tok.json()
    const me = await f('https://discord.com/api/v10/users/@me', { headers: { authorization: `Bearer ${access_token}` } })
    const who = me.ok ? await me.json() : null
    if (!who?.id) return json(res, 502, { error: 'Discord did not confirm the sign-in. Try again.' }), true
    addLink({ platform: 'discord', platformId: who.id, user: ctx.user, workspace: ctx.workspace })
    res.writeHead(302, { Location: '/ask?linked=discord', 'Cache-Control': 'no-store' })
    return res.end(), true
  }
  const m = p.match(/^\/api\/surfaces\/link\/(telegram|discord|farcaster)\/unlink$/)
  if (m) {
    if (req.method !== 'POST' || req.headers['x-requested-with'] !== 'gully') return json(res, 403, { error: 'Cross-site request refused.' }), true
    return json(res, 200, { removed: removeLink(m[1], ctx.user) }), true
  }
  if (p === '/api/surfaces/link/telegram') {
    if (req.method !== 'POST' || req.headers['x-requested-with'] !== 'gully') return json(res, 403, { error: 'Cross-site request refused.' }), true
    const h = String(req.headers.authorization ?? '')
    const auth = deps.validateInitData(h.startsWith('tma ') ? h.slice(4).trim() : '', deps.token, { maxAgeS: 3600 })
    if (!auth.ok) return json(res, 401, { error: auth.error }), true
    const body = (await readJson(req, 2_048)) ?? {}
    if (body.confirm !== true) return json(res, 200, { platform: 'telegram', platformName: auth.user.username ? `@${auth.user.username}` : auth.user.firstName, gully: ctx.user.slice(0, 6) + '…' + ctx.user.slice(-4), confirm: 'Send { confirm: true } to link these two accounts.' }), true
    addLink({ platform: 'telegram', platformId: auth.user.id, user: ctx.user, workspace: ctx.workspace })
    return json(res, 200, { linked: true }), true
  }
  return json(res, 404, { error: 'not found' }), true
}
