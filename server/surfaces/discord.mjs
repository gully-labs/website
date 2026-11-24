// Gully AI on Discord: ONE Discord application for Gully (not one per product), signed HTTP interactions only (no gateway,
// no message-content intent, so the bot reads nothing but the commands people send it).
//
//   POST /api/discord/interactions   Discord's Interactions Endpoint URL.
//
// Official docs checked 2026-11-23 (https://docs.discord.com/developers/interactions/overview and .../receiving-and-responding):
//   - every request carries X-Signature-Ed25519 and X-Signature-Timestamp; the signed message is timestamp + raw body, the key
//     is the application's public key; a bad signature gets 401 (Discord sends bad ones on purpose and removes the endpoint
//     if they are accepted);
//   - type 1 PING must be answered with type 1 PONG; the first response is due within 3 seconds, so slow work answers
//     type 5 (deferred) first and edits @original through the webhook within the 15-minute token window; flag 64 = ephemeral.
//
// Flag AI_SURFACE_DISCORD=1 + DISCORD_APP_ID + DISCORD_APP_PUBLIC_KEY + DISCORD_BOT_TOKEN (the token is only used to register
// commands and is never needed for replies: they go through the interaction webhook).
//
// Commands: /ask question [share], /explain target (tx hash or address), /token address. Replies are ephemeral by default;
// "share:true" posts publicly with a follow-up button (a modal; follow-ups continue in the thread the reply opens when the
// bot may create threads). Nothing here ever carries wallet data: a Discord user is not linked to a Gully ID here, so every
// call has ctx = null, in a server and in a DM alike. (Linking is a later step; see SPEC.md.)

import crypto from 'node:crypto'
import { answerForSurface, surfaceEnabled } from './surface.mjs'

const env = (k) => String(process.env[k] ?? '').trim()
const API = () => (env('DISCORD_API') || 'https://discord.com/api/v10').replace(/\/$/, '')
const SKEW_S = 300
const EPHEMERAL = 64
const T = { PING: 1, COMMAND: 2, COMPONENT: 3, MODAL: 5, PONG: 1, MESSAGE: 4, DEFERRED: 5, SHOW_MODAL: 9 }

/* ------------------------------------------------------------ signature --- */

const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex')

/** True when `signatureHex` signs timestamp + rawBody under `publicKeyHex` (and the timestamp is fresh). */
export function verifyDiscordSignature({ publicKeyHex, signatureHex, timestamp, rawBody, now = Date.now() }) {
  try {
    if (!/^[0-9a-f]{64}$/i.test(publicKeyHex ?? '') || !/^[0-9a-f]{128}$/i.test(signatureHex ?? '')) return false
    const ts = Number(timestamp)
    if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > SKEW_S) return false
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' })
    return crypto.verify(null, Buffer.concat([Buffer.from(String(timestamp)), Buffer.from(rawBody)]), key, Buffer.from(signatureHex, 'hex'))
  } catch {
    return false
  }
}

/* ------------------------------------------------------------ commands --- */

export const COMMANDS = [
  { name: 'ask', description: 'Ask Gully AI about Gully Labs, Gully Chain, Gully Core or a project', type: 1, dm_permission: true, options: [{ type: 3, name: 'question', description: 'Your question', required: true, max_length: 500 }, { type: 5, name: 'share', description: 'Post the answer for everyone here (default: only you see it)', required: false }] },
  { name: 'explain', description: 'Explain a transaction or a contract in plain words', type: 1, dm_permission: true, options: [{ type: 3, name: 'target', description: 'A transaction hash (0x + 64 hex) or an address (0x + 40 hex)', required: true, max_length: 66 }, { type: 5, name: 'share', description: 'Post the answer for everyone here', required: false }] },
  { name: 'token', description: 'What Gully knows about a token (holders, Gully Score, checks)', type: 1, dm_permission: true, options: [{ type: 3, name: 'address', description: 'Token contract address (0x + 40 hex)', required: true, max_length: 42 }, { type: 5, name: 'share', description: 'Post the answer for everyone here', required: false }] },
]

const PERM = { CREATE_PUBLIC_THREADS: 1n << 35n, SEND_MESSAGES_IN_THREADS: 1n << 38n }
/** The install link: slash commands + the two thread permissions, nothing else (no admin, no read-history, no manage). */
export function installUrl(appId = env('DISCORD_APP_ID')) {
  const perms = (PERM.CREATE_PUBLIC_THREADS | PERM.SEND_MESSAGES_IN_THREADS).toString()
  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(appId)}&scope=${encodeURIComponent('applications.commands bot')}&permissions=${perms}`
}

const ADDR = /^0x[0-9a-fA-F]{40}$/
const TX = /^0x[0-9a-fA-F]{64}$/

/** Turns a command into the question for Gully AI, or an error line. Only validated hex ever reaches the prompt. */
export function questionFor(name, opts) {
  if (name === 'ask') return { q: String(opts.question ?? '') }
  if (name === 'explain') {
    const t = String(opts.target ?? '').trim()
    if (TX.test(t)) return { q: `Explain in plain words what the transaction ${t} did. Use the Gully tools to read it; if you cannot read it, say so and do not guess.` }
    if (ADDR.test(t)) return { q: `Explain in plain words what the contract or wallet ${t} is. Use the Gully tools (Gully Security score, source) to read it; if you cannot read it, say so and do not guess.` }
    return { err: 'Send a transaction hash (0x and 64 hex characters) or an address (0x and 40).' }
  }
  if (name === 'token') {
    const a = String(opts.address ?? '').trim()
    if (!ADDR.test(a)) return { err: 'Send a token contract address (0x and 40 hex characters).' }
    return { q: `What does Gully know about the token ${a}? Use get_holders and the Gully Score tools; say which chain you checked or that you need it.` }
  }
  return { err: 'Unknown command.' }
}

const optsOf = (data) => Object.fromEntries((data?.options ?? []).map((o) => [o.name, o.value]))

/* ------------------------------------------------------------ follow-ups --- */

const MEMO_MAX = 500
const memo = new Map() // answerId -> { q, a, at }
function remember(id, q, a) {
  memo.set(id, { q: q.slice(0, 500), a: a.slice(0, 1500), at: Date.now() })
  while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value)
}
export const resetDiscordMemoForTest = () => memo.clear()

/* ------------------------------------------------------------ roles --- */

/** DISCORD_AI_GUILD_ROLES = {"<guildId>":["<roleId>",...]}: when a guild is listed, only those roles (and members who can manage the server) may share publicly. */
export function mayShare(interaction) {
  if (!interaction.guild_id) return true
  let map = {}
  try {
    map = JSON.parse(env('DISCORD_AI_GUILD_ROLES') || '{}')
  } catch {
    map = {}
  }
  const allowed = map[interaction.guild_id]
  if (!Array.isArray(allowed)) return true
  const perms = BigInt(interaction.member?.permissions ?? '0')
  if (perms & 0x20n || perms & 0x8n) return true // MANAGE_GUILD or ADMINISTRATOR
  return (interaction.member?.roles ?? []).some((r) => allowed.includes(r))
}

/* ------------------------------------------------------------ the handler --- */

/**
 * Handles one verified interaction. Returns { status, body, after? }: `body` is the immediate reply, `after` is a promise
 * for the deferred edit (the HTTP handler does not await it). `deps` is injectable: { fetch, askFn }.
 */
export function handleInteraction(it, deps = {}) {
  const doFetch = deps.fetch ?? fetch
  if (it.type === T.PING) return { status: 200, body: { type: T.PONG } }
  if (!surfaceEnabled('discord')) return { status: 200, body: { type: T.MESSAGE, data: { content: 'Gully AI is not switched on here yet.', flags: EPHEMERAL } } }
  const user = it.member?.user ?? it.user ?? {}
  const inGuild = !!it.guild_id
  const place = inGuild ? 'public' : 'dm'
  const locale = it.locale || it.guild_locale || ''

  const run = async (question, { share, thread, historyPair }) => {
    const r = await answerForSurface({ surface: 'discord', userKey: String(user.id ?? 'unknown'), question, place, locale, ctx: null, history: historyPair ?? [], askFn: deps.askFn })
    const base = `${API()}/webhooks/${encodeURIComponent(env('DISCORD_APP_ID'))}/${encodeURIComponent(it.token)}`
    const send = (url, method, payload) => doFetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    const noMentions = { parse: [] }
    if (!r.ok) {
      await send(`${base}/messages/@original`, 'PATCH', { content: r.message.slice(0, 2000), allowed_mentions: noMentions })
      return
    }
    const comps = share ? [{ type: 1, components: [{ type: 2, style: 2, label: 'Ask a follow-up', custom_id: `fu:${r.id}` }] }] : []
    const first = await send(`${base}/messages/@original`, 'PATCH', { content: r.chunks[0], allowed_mentions: noMentions, components: comps })
    remember(r.id, question, r.chunks.join('\n'))
    for (const extra of r.chunks.slice(1)) await send(base, 'POST', { content: extra, allowed_mentions: noMentions, ...(share ? {} : { flags: EPHEMERAL }) })
    // A shared answer in a server opens a thread for its follow-ups when the bot may (best effort: it needs CREATE_PUBLIC_THREADS).
    if (share && inGuild && thread && first?.ok && deps.botFetch !== false) {
      try {
        const msg = await first.json()
        if (msg?.id && env('DISCORD_BOT_TOKEN')) {
          await doFetch(`${API()}/channels/${encodeURIComponent(it.channel_id)}/messages/${encodeURIComponent(msg.id)}/threads`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bot ${env('DISCORD_BOT_TOKEN')}` }, body: JSON.stringify({ name: 'Gully AI follow-ups', auto_archive_duration: 1440 }) })
        }
      } catch {
        /* no permission: the follow-up button still works in the channel */
      }
    }
  }

  if (it.type === T.COMMAND) {
    const opts = optsOf(it.data)
    const { q, err } = questionFor(it.data?.name, opts)
    if (err) return { status: 200, body: { type: T.MESSAGE, data: { content: err, flags: EPHEMERAL } } }
    const share = opts.share === true && mayShare(it)
    const denied = opts.share === true && !share
    const body = { type: T.DEFERRED, data: { flags: share ? 0 : EPHEMERAL } }
    return { status: 200, body, after: run(denied ? q : q, { share, thread: share }) }
  }

  if (it.type === T.COMPONENT && String(it.data?.custom_id ?? '').startsWith('fu:')) {
    const id = it.data.custom_id.slice(3).replace(/[^\w-]/g, '').slice(0, 40)
    return { status: 200, body: { type: T.SHOW_MODAL, data: { custom_id: `fum:${id}`, title: 'Ask a follow-up', components: [{ type: 1, components: [{ type: 4, custom_id: 'q', label: 'Your follow-up', style: 2, min_length: 2, max_length: 500, required: true }] }] } } }
  }

  if (it.type === T.MODAL && String(it.data?.custom_id ?? '').startsWith('fum:')) {
    const id = it.data.custom_id.slice(4)
    const question = it.data.components?.[0]?.components?.[0]?.value ?? ''
    const prev = memo.get(id)
    const historyPair = prev ? [{ role: 'user', content: prev.q }, { role: 'assistant', content: prev.a }] : []
    // The follow-up is public like the thread it continues; wallet data is never in it either way.
    return { status: 200, body: { type: T.DEFERRED, data: { flags: 0 } }, after: run(question, { share: true, thread: false, historyPair }) }
  }

  return { status: 200, body: { type: T.MESSAGE, data: { content: 'That action is not supported.', flags: EPHEMERAL } } }
}

/** POST /api/discord/interactions. Returns true when handled. 404 unless the surface is configured (no existence leak). */
export async function handleDiscord(req, res, url, deps = {}) {
  if (url.pathname !== '/api/discord/interactions') return false
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(body))
    return true
  }
  const pub = env('DISCORD_APP_PUBLIC_KEY')
  if (!pub) return send(404, { error: 'not found' })
  if (req.method !== 'POST') return send(405, { error: 'POST only' })
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > 65_536) return send(413, { error: 'too large' })
    chunks.push(c)
  }
  const raw = Buffer.concat(chunks)
  const ok = verifyDiscordSignature({ publicKeyHex: pub, signatureHex: String(req.headers['x-signature-ed25519'] ?? ''), timestamp: String(req.headers['x-signature-timestamp'] ?? ''), rawBody: raw, now: deps.now })
  if (!ok) return send(401, { error: 'invalid request signature' })
  let it
  try {
    it = JSON.parse(raw.toString('utf8'))
  } catch {
    return send(400, { error: 'bad json' })
  }
  const r = handleInteraction(it, deps)
  r.after?.catch((e) => console.error('discord deferred:', String(e?.message ?? e).slice(0, 120)))
  deps.onAfter?.(r.after)
  return send(r.status, r.body)
}
