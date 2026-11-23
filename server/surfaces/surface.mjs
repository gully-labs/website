// Gully AI everywhere: the thin surface adapter shared by the Discord, Farcaster, Telegram Mini App and embed surfaces
// (design: design/gully-ai-everywhere-2026-11-23/SPEC.md in gully-protocol). Everything here is pure or injectable so
// it is testable with fake platform fixtures and no network. Every surface is OFF until its flag is "1".
//
// The adapter does NOT own the answer: ask.mjs does (retrieval, tools, citations, daily cap, log). The adapter owns what is
// different per platform: who is asking, where (a private place or a public one), the size limits, the per-surface
// rate limits, the credits hook, the safety footer and the privacy rule "no wallet data in a public place".

import { ask as realAsk, MAX_QUESTION } from '../ask.mjs'

const env = (k) => String(process.env[k] ?? '').trim()
const envInt = (k, d) => {
  const n = Number(process.env[k])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : d
}

/** Static facts per surface. `maxChars` is the platform's message limit (see SPEC.md for the official source of each). */
export const SURFACES = {
  discord: { id: 'discord', flag: 'AI_SURFACE_DISCORD', askChannel: 'discord', maxChars: 2000, markdown: true, perMin: 4, perDay: 40 },
  farcaster: { id: 'farcaster', flag: 'AI_SURFACE_FARCASTER', askChannel: 'farcaster', maxChars: 320, markdown: false, perMin: 2, perDay: 20 },
  tgapp: { id: 'tgapp', flag: 'AI_SURFACE_TGAPP', askChannel: 'tgapp', maxChars: 4096, markdown: false, perMin: 5, perDay: 60 },
  embed: { id: 'embed', flag: 'AI_SURFACE_EMBED', askChannel: 'embed', maxChars: 4000, markdown: false, perMin: 4, perDay: 40 },
}

export const surfaceEnabled = (id) => !!SURFACES[id] && env(SURFACES[id].flag) === '1'

/** "dm" and "private" places may carry a linked user's own data. "public" places (channels, casts, threads others can read) never do. */
export const PLACES = ['dm', 'private', 'public']

const RISK_LINE = 'Information only, not financial advice. Check on-chain facts yourself.'
const AI_LINE = 'AI answer from Gully AI.'

/** The safety footer: short on tight surfaces, always present. */
export function footerFor(surfaceId, { topic = 'general' } = {}) {
  const risky = topic === 'token' || topic === 'market'
  if (surfaceId === 'farcaster') return risky ? 'AI, not advice.' : 'AI answer.'
  return risky ? `${AI_LINE} ${RISK_LINE}` : AI_LINE
}

/** Strips mention residue and collapses whitespace. */
export function cleanQuestion(raw, { mentionNames = ['gullyai', 'gully'] } = {}) {
  let s = String(raw ?? '')
  s = s.replace(/<@!?\d+>/g, ' ').replace(/<@&\d+>/g, ' ')
  for (const n of mentionNames) s = s.replace(new RegExp(`(^|\\s)@${n}(?![\\w])`, 'ig'), ' ')
  return s.replace(/\s+/g, ' ').trim()
}

/** Plain text for platforms without Markdown: drops emphasis and headings, turns [text](url) into "text url". */
export function toPlain(md) {
  return String(md ?? '')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1 $2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`{1,3}/g, '')
    .trim()
}

/**
 * Splits text into chunks of at most `max` characters, at paragraph, sentence then word boundaries.
 * Never returns an empty chunk; a single token longer than `max` is hard-cut.
 */
export function chunkText(text, max) {
  const out = []
  let rest = String(text ?? '').trim()
  while (rest.length > max) {
    const win = rest.slice(0, max)
    let cut = Math.max(win.lastIndexOf('\n\n'), win.lastIndexOf('\n'))
    if (cut < max * 0.5) cut = Math.max(win.lastIndexOf('. '), win.lastIndexOf('? '), win.lastIndexOf('! ')) + 1
    if (cut < max * 0.5) cut = win.lastIndexOf(' ')
    if (cut <= 0) cut = max
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out.filter(Boolean)
}

/** Sources as short lines, at most `n`, https only. */
export function sourceLines(citations, n = 3) {
  return (citations ?? [])
    .filter((c) => c && /^https:\/\//.test(String(c.url ?? '')))
    .slice(0, n)
    .map((c) => `${String(c.title ?? c.label ?? 'Source').slice(0, 60)}: ${c.url}`)
}

const FREE = async () => ({ ok: true, balance: null, charged: 0 })
let creditsHook = FREE
/** The credits service replaces the free-tier default by calling this. Hook: ({surface,userKey,estimate,place}) => {ok, message?, balance?}. */
export const setCreditsHook = (fn) => (creditsHook = typeof fn === 'function' ? fn : FREE)

/**
 * One question from one surface.
 * @param {object} p
 * @param {'discord'|'farcaster'|'tgapp'|'embed'} p.surface
 * @param {string} p.userKey   stable platform user id (Discord snowflake, Farcaster fid, Telegram id, embed visitor hash)
 * @param {string} p.question
 * @param {'dm'|'private'|'public'} p.place
 * @param {string} [p.locale]  BCP-47 hint from the platform
 * @param {object|null} [p.ctx] a signed-in Gully session context. Dropped unless the place is dm/private.
 * @param {string} [p.project] embed only: the project whose knowledge to use (stub)
 * @param {Function} [p.askFn] tests inject a fake ask()
 */
export async function answerForSurface({ surface, userKey, question, place = 'public', locale = '', ctx = null, project = null, history = [], askFn = realAsk }) {
  const s = SURFACES[surface]
  if (!s) return { ok: false, status: 400, message: 'Unknown surface.' }
  if (!surfaceEnabled(surface)) return { ok: false, status: 503, message: 'Gully AI is not switched on here yet.' }
  if (!PLACES.includes(place)) place = 'public'
  const q = cleanQuestion(question)
  if (!q) return { ok: false, status: 400, message: 'Ask a question after the command.' }
  if (q.length > MAX_QUESTION) return { ok: false, status: 400, message: `Questions can be at most ${MAX_QUESTION} characters.` }
  // Privacy rule: a public place never carries a session, whatever the caller passed.
  const safeCtx = place === 'public' ? null : ctx
  const cr = await creditsHook({ surface, userKey, estimate: 1, place })
  if (!cr.ok) {
    note(s.id, 'refused')
    return { ok: false, status: 402, message: cr.message || 'You are out of free Gully AI answers. Add credits at gullylabs.xyz/ask.' }
  }
  const lang = String(locale || '').slice(0, 12).replace(/[^A-Za-z-]/g, '')
  const asked = lang && !/^en/i.test(lang) ? `${q}\n(Answer in the language with code "${lang}".)` : q
  const r = await askFn({
    question: asked,
    history,
    ctx: safeCtx,
    who: { channel: s.askChannel, key: `${project ? `${project}:` : ''}${userKey}`, perMin: envInt(`${s.flag}_PER_MIN`, s.perMin), perDay: envInt(`${s.flag}_PER_DAY`, s.perDay) },
  })
  if (!r.ok) {
    note(s.id, r.status === 429 ? 'refused' : 'failed')
    return { ok: false, status: r.status ?? 502, message: r.error || 'Gully AI could not answer just now.', retryAfter: r.retryAfter }
  }
  note(s.id, 'ok')
  const topic = (r.usedTools ?? []).some((t) => /holder|token|score|market|gap/.test(t)) ? 'token' : 'general'
  let body = s.markdown ? String(r.answer ?? '') : toPlain(r.answer)
  const src = sourceLines(r.citations, s.id === 'farcaster' ? 0 : 3)
  if (src.length) body += `\n\n${src.join('\n')}`
  const foot = footerFor(s.id, { topic })
  const sep = s.id === 'farcaster' ? ' ' : '\n\n'
  const chunks = chunkText(body, s.maxChars - foot.length - sep.length)
  if (!chunks.length) chunks.push(r.answered === false ? 'I could not find that in what Gully knows.' : '...')
  chunks[chunks.length - 1] += `${sep}${foot}`
  return { ok: true, chunks, id: r.id, answered: r.answered !== false }
}

function configuredFor(id) {
  if (id === 'discord') return !!(env('DISCORD_APP_PUBLIC_KEY') && env('DISCORD_BOT_TOKEN') && env('DISCORD_APP_ID'))
  if (id === 'farcaster') return !!(env('FARCASTER_WEBHOOK_SECRET') && env('FARCASTER_SIGNER_UUID') && env('NEYNAR_API_KEY'))
  if (id === 'tgapp') return !!env('TELEGRAM_BOT_TOKEN')
  return id === 'embed'
}

/* Counts only (never content): what the status row reads. */
const stats = {}
const stat = (id) => (stats[id] ??= { ok: 0, refused: 0, failed: 0, streak: 0, lastAt: 0, day: '' })
function note(id, kind) {
  const x = stat(id)
  const day = new Date().toISOString().slice(0, 10)
  if (x.day !== day) Object.assign(x, { day, ok: 0, refused: 0, failed: 0 })
  x[kind]++
  x.streak = kind === 'failed' ? x.streak + 1 : kind === 'ok' ? 0 : x.streak
  x.lastAt = Date.now()
}
export const surfaceCounts = (id) => ({ ...stat(id) })
export const resetSurfaceCountsForTest = () => Object.keys(stats).forEach((k) => delete stats[k])

/** What the status service reads per surface (counts only, no content): see SPEC.md section 9. */
export function surfaceStatus(now = Date.now()) {
  return Object.values(SURFACES).map((s) => ({ surface: s.id, flag: s.flag, enabled: surfaceEnabled(s.id), configured: configuredFor(s.id), checkedAt: now }))
}
