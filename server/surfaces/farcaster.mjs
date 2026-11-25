// Gully AI on Farcaster: answers a cast that mentions @gullyai with a reply cast, and serves the Mini App manifest.
//
//   POST /api/farcaster/webhook        cast.created mention events (HMAC-signed by the access provider)
//   GET  /.well-known/farcaster.json   Mini App manifest (only when FARCASTER_ACCOUNT_ASSOCIATION is set)
//
// ACCESS METHOD (checked 2026-11-23). Reading mentions needs a source that filters the whole network for us: a raw hub
// (Snapchain) would mean following every cast. The managed route is Neynar's cast.created webhook with a mentioned-fid
// filter + a managed signer to publish (https://docs.neynar.com; the pages could not be re-fetched in this session, so the
// exact header and endpoint names below are from the provider's public docs as last read and MUST be re-checked before
// the owner switches this on; no price is quoted anywhere). The Mini App manifest/embed rules were read at
// https://miniapps.farcaster.xyz/docs/specification: manifest at /.well-known/farcaster.json with accountAssociation +
// miniapp {version "1", name <= 32 chars, homeUrl, iconUrl 1024x1024 PNG no alpha}; share embed = meta tag fc:miniapp.
//
// Posting is DRY RUN unless FARCASTER_POSTING=live. In dry run the reply is recorded in memory (admin can read it) and
// nothing is sent. Hard rules: only ever replies to a cast that mentions us (never unprompted), one reply thread per
// mention, never in reply to our own casts, a per-author and a global hourly cap, no links except the sources Gully AI
// already cites, no wallet data (place is always public).

import crypto from 'node:crypto'
import { botSetting } from '../bot-settings.mjs'
import { answerForSurface, surfaceEnabled } from './surface.mjs'

const env = (k) => botSetting(k) // a key saved on admin Integrations first, then the environment (bot-settings.mjs)
const NEYNAR = () => (env('NEYNAR_API') || 'https://api.neynar.com').replace(/\/$/, '')

/** HMAC-SHA512 hex of the raw body with the webhook secret (the provider signs this way; compared in constant time). */
export function verifyFarcasterWebhook({ secret, signatureHex, rawBody }) {
  try {
    if (!secret || !/^[0-9a-f]{128}$/i.test(signatureHex ?? '')) return false
    const mac = crypto.createHmac('sha512', secret).update(rawBody).digest()
    return crypto.timingSafeEqual(mac, Buffer.from(signatureHex, 'hex'))
  } catch {
    return false
  }
}

const seen = new Map() // cast hash -> at (dedupe: providers retry)
const hourly = { at: 0, n: 0 }
const byAuthor = new Map() // fid -> [timestamps]
export const farcasterDryLog = []
export const resetFarcasterForTest = () => (seen.clear(), byAuthor.clear(), (hourly.n = 0), (farcasterDryLog.length = 0))

function allow(fid, now) {
  if (now - hourly.at > 3_600_000) Object.assign(hourly, { at: now, n: 0 })
  const cap = Number(env('FARCASTER_HOURLY_CAP')) || 60
  if (hourly.n >= cap) return false
  const mine = (byAuthor.get(fid) ?? []).filter((t) => now - t < 3_600_000)
  if (mine.length >= (Number(env('FARCASTER_AUTHOR_HOURLY')) || 5)) return false
  mine.push(now)
  byAuthor.set(fid, mine)
  hourly.n++
  return true
}

/** The text of a mention event, if it is one we should answer: { hash, fid, text, locale } or null. */
export function mentionFrom(evt) {
  const c = evt?.data
  if (evt?.type !== 'cast.created' || !c?.hash || !c.author?.fid) return null
  const botFid = Number(env('FARCASTER_BOT_FID'))
  if (botFid && Number(c.author.fid) === botFid) return null // never answer ourselves
  if (botFid && !(c.mentioned_profiles ?? []).some((p) => Number(p.fid) === botFid)) return null
  return { hash: String(c.hash), fid: String(c.author.fid), text: String(c.text ?? ''), locale: '' }
}

/** Handles one event. `deps`: { fetch, askFn, now }. Returns { status, replied?, dry? }. */
export async function handleFarcasterEvent(evt, deps = {}) {
  if (!surfaceEnabled('farcaster')) return { status: 503 }
  const m = mentionFrom(evt)
  if (!m) return { status: 200, ignored: true }
  const now = deps.now ?? Date.now()
  if (seen.has(m.hash)) return { status: 200, duplicate: true }
  seen.set(m.hash, now)
  if (seen.size > 2000) seen.delete(seen.keys().next().value)
  if (!allow(m.fid, now)) return { status: 200, limited: true }
  const r = await answerForSurface({ surface: 'farcaster', userKey: m.fid, question: m.text, place: 'public', ctx: null, askFn: deps.askFn })
  const text = r.ok ? r.chunks.join(' ') : r.message
  const casts = r.ok ? r.chunks : [r.message.slice(0, 320)]
  void text
  if (env('FARCASTER_POSTING') !== 'live') {
    farcasterDryLog.push({ at: now, to: m.hash, casts })
    if (farcasterDryLog.length > 50) farcasterDryLog.shift()
    return { status: 200, replied: true, dry: true, casts }
  }
  const doFetch = deps.fetch ?? fetch
  let parent = m.hash
  for (const c of casts) {
    const resp = await doFetch(`${NEYNAR()}/v2/farcaster/cast`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env('NEYNAR_API_KEY') }, body: JSON.stringify({ signer_uuid: env('FARCASTER_SIGNER_UUID'), text: c, parent, idem: `${m.hash}-${casts.indexOf(c)}`.slice(0, 16) }) })
    if (!resp.ok) return { status: 200, replied: false, error: `post ${resp.status}` }
    try {
      parent = (await resp.json())?.cast?.hash ?? parent
    } catch {
      /* keep the previous parent */
    }
  }
  return { status: 200, replied: true, dry: false, casts }
}

/** The Mini App manifest, or null while the owner has not signed the account association. */
export function miniappManifest() {
  let assoc
  try {
    assoc = JSON.parse(env('FARCASTER_ACCOUNT_ASSOCIATION') || 'null')
  } catch {
    assoc = null
  }
  if (!assoc?.header || !assoc?.payload || !assoc?.signature) return null
  return {
    accountAssociation: assoc,
    miniapp: { version: '1', name: 'Gully AI', homeUrl: 'https://gullylabs.xyz/ask?surface=farcaster', iconUrl: 'https://gullylabs.xyz/brand/icon/app-icon-1024.png', subtitle: 'Ask about Gully and your chain', description: 'Gully AI answers questions about Gully Chain, Gully Core and the projects built on them. Information only.', primaryCategory: 'utility' },
  }
}

/** The share-embed meta tag value (fc:miniapp) for the /ask page. */
export const miniappEmbed = () => JSON.stringify({ version: '1', imageUrl: 'https://gullylabs.xyz/brand/kit/og-default-1200x630.png', button: { title: 'Ask Gully AI', action: { type: 'launch_frame', name: 'Gully AI', url: 'https://gullylabs.xyz/ask?surface=farcaster' } } })

export async function handleFarcaster(req, res, url, deps = {}) {
  const send = (status, body, h = {}) => (res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...h }), res.end(JSON.stringify(body)), true)
  if (url.pathname === '/.well-known/farcaster.json') {
    const m = miniappManifest()
    return m ? send(200, m, { 'Cache-Control': 'public, max-age=300' }) : send(404, { error: 'not found' })
  }
  if (url.pathname !== '/api/farcaster/webhook') return false
  const secret = env('FARCASTER_WEBHOOK_SECRET')
  if (!secret) return send(404, { error: 'not found' })
  if (req.method !== 'POST') return send(405, { error: 'POST only' })
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > 131_072) return send(413, { error: 'too large' })
    chunks.push(c)
  }
  const raw = Buffer.concat(chunks)
  if (!verifyFarcasterWebhook({ secret, signatureHex: String(req.headers['x-neynar-signature'] ?? ''), rawBody: raw })) return send(401, { error: 'bad signature' })
  let evt
  try {
    evt = JSON.parse(raw.toString('utf8'))
  } catch {
    return send(400, { error: 'bad json' })
  }
  const r = await handleFarcasterEvent(evt, deps)
  return send(r.status, { ok: r.status === 200 })
}
