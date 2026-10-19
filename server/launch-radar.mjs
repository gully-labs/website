// The daily "Launch radar" post for the Gully Labs News channel: the cleanest and the most concentrated new
// launches, from the maps the Holder Map has already built. Measured facts only ("62% held by 3 linked wallets"),
// never an accusation, always the one-line "signals, not verdicts" note.
//
// Draft-only by default. Once a day (UTC, from TELEGRAM_RADAR_TIME, default 15:00) the channel scheduler calls
// radarTick(), which writes ONE draft per day (autoKey radar:YYYY-MM-DD) through the channel composer's own
// validation and storage (telegram-channel.mjs channelHooks), with the brand-kit banner. The draft only goes out
// when the admin posts it (POST /api/admin/channel/radar { action: 'post' }), or when TELEGRAM_RADAR_AUTOPOST=1
// (default off), and then only outside quiet hours and the minimum gap like any auto post.
//
// Env
//   TELEGRAM_RADAR_AUTOPOST  1 = post the daily draft by itself (default off: the owner approves)
//   TELEGRAM_RADAR_TIME      HH:MM UTC when the daily draft is made (default 15:00)
//   TELEGRAM_RADAR_DRAFTS    0 = no scheduled drafts at all (the admin routes still work)
//
// Routes (forwarded by telegram-channel.mjs handleChannelAdmin, admin token already checked):
//   GET  /api/admin/channel/radar                 { autopost, time, draftsEnabled, today: post | null }
//   POST /api/admin/channel/radar { action }      draft: make or refresh today's draft; post: publish today's draft
//                                                 (or build and publish when there is none) -> { post } | 409 { skip }

import { channelHooks, validatePost } from './telegram-channel.mjs'
import { peekHolderMap } from './holders.mjs'
import { readLaunchFeed } from './holders-intel.mjs'
import { esc, SITE } from './telegram-ui.mjs'

export const RADAR_MIN_ITEMS = 2
const PER_LIST = 3
const NOTE = 'Signals, not verdicts: these are measured facts about who holds a token, not a judgement of anyone’s intent. Not advice.'
/** Words the radar never uses, in any text it builds (token names included). */
export const BANNED = /\b(scams?|scammers?|scammy|rugs?|rug-?pulls?|rugged|fraud\w*|honeypots?|ponzi|steal\w*|stole\w*|fake|malicious|criminals?|crooks?|cheat\w*|swindl\w*|dump(?:er|ers|ed|ing)?|exit-?scam)\b/i
export const findBanned = (text) => String(text ?? '').replace(/<[^>]*>/g, ' ').match(BANNED)?.[0] ?? null

const autopostOn = () => String(process.env.TELEGRAM_RADAR_AUTOPOST ?? '') === '1'
const draftsOn = () => String(process.env.TELEGRAM_RADAR_DRAFTS ?? '') !== '0'
const radarTime = () => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(process.env.TELEGRAM_RADAR_TIME ?? '').trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : 15 * 60
}
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const dayOf = (t) => new Date(t).toISOString().slice(0, 10)
const keyOf = (t) => `radar:${dayOf(t)}`

/* ------------------------------------------------------------------ data --- */

let readFeed = (o) => readLaunchFeed(o)
let peek = (chain, token) => peekHolderMap(chain, token)
/** Tests: synthetic launch feed and cached maps (nothing upstream is read). */
export function setRadarSourcesForTest({ feed, peekMap } = {}) {
  readFeed = feed ?? ((o) => readLaunchFeed(o))
  peek = peekMap ?? ((c, t) => peekHolderMap(c, t))
}

/** One launch's measured facts from its cached map, or null when the map is not built. */
function factsOf(l) {
  const m = l.state === 'checked' ? peek(l.chainKey, l.token) : null
  if (!m || m.state !== 'ok') return null
  const s = m.summary ?? {}
  const sym = String(l.symbol ?? m.token?.symbol ?? '').trim()
  return {
    chainKey: l.chainKey,
    chainName: l.chainName ?? m.chain?.name ?? l.chainKey,
    token: l.token,
    // A token whose own name trips the word list is shown by address instead: the radar never prints those words.
    symbol: sym && !BANNED.test(sym) && /^[\w$.\-]{1,16}$/.test(sym) ? sym : null,
    score: typeof m.health?.score === 'number' ? m.health.score : null,
    top10: typeof s.top10Pct === 'number' ? s.top10Pct : null,
    cluster: s.largestCluster && typeof s.largestCluster.pct === 'number' ? { pct: s.largestCluster.pct, wallets: s.largestCluster.wallets } : null,
  }
}

/** { clean[], concentrated[] } from the feed: best health first; biggest linked group (else top-10 share) first. Pure given facts. */
export function pickRadar(facts) {
  const clean = facts.filter((f) => f.score !== null).sort((a, b) => b.score - a.score || (a.top10 ?? 100) - (b.top10 ?? 100)).slice(0, PER_LIST)
  const used = new Set(clean.map((f) => `${f.chainKey}:${f.token}`))
  const conc = (f) => f.cluster?.pct ?? f.top10 ?? -1
  const concentrated = facts.filter((f) => !used.has(`${f.chainKey}:${f.token}`) && conc(f) >= 20).sort((a, b) => conc(b) - conc(a)).slice(0, PER_LIST)
  return { clean, concentrated }
}

const pct = (n) => `${n.toFixed(n >= 10 ? 0 : 1).replace(/\.0$/, '')}%`
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`
const name = (f) => `<a href="${SITE}/holders/${f.chainKey}/${encodeURIComponent(f.token)}">${f.symbol ? `$${esc(f.symbol)}` : short(f.token)}</a>`

function cleanLine(f, n) {
  const bits = [`health ${f.score}/100`]
  if (f.top10 !== null) bits.push(`top 10 hold ${pct(f.top10)}`)
  return `${n}. ${name(f)} · ${esc(f.chainName)} · ${bits.join(' · ')}`
}
function concLine(f, n) {
  const held = f.cluster ? `${pct(f.cluster.pct)} held by ${f.cluster.wallets} linked wallets` : `top 10 wallets hold ${pct(f.top10)}`
  return `${n}. ${name(f)} · ${esc(f.chainName)} · ${held}`
}

/** The post text, within a photo caption's 1024 characters. Facts only; the note is always last. */
export function radarText(picks, day) {
  const lines = [`<b>🛰 Launch radar · ${day}</b>`, 'New launches, read from the Holder Map.']
  if (picks.clean.length) lines.push('', '<b>Best health scores</b>', ...picks.clean.map((f, i) => cleanLine(f, i + 1)))
  if (picks.concentrated.length) lines.push('', '<b>Most concentrated holdings</b>', ...picks.concentrated.map((f, i) => concLine(f, i + 1)))
  lines.push('', `<i>${NOTE}</i>`)
  return lines.join('\n')
}

/**
 * Builds today's radar from the launch feed. Returns { ok: true, v, picks, day } (v: a validated post) or
 * { ok: false, skip } when there is not enough measured data, or the text would break a rule.
 */
export async function buildRadar(t = channelHooks.now()) {
  const day = dayOf(t)
  const feed = await readFeed({ limit: 40 }).catch(() => null)
  const facts = (feed?.launches ?? []).map(factsOf).filter(Boolean)
  const picks = pickRadar(facts)
  const n = picks.clean.length + picks.concentrated.length
  if (n < RADAR_MIN_ITEMS) return { ok: false, skip: `Only ${facts.length} launches have a built map right now; the radar needs at least ${RADAR_MIN_ITEMS} to rank.` }
  const buttons = [
    { text: 'Open Holder Map', url: `${SITE}/holders` },
    { text: 'Check any token in the bot', url: 'https://t.me/GullyLabsBot' },
  ]
  let text = radarText(picks, day)
  let v = validatePost({ text, media: { kind: 'animation', banner: true }, buttons })
  // Too long for a caption: drop the last entry of the longer list until it fits.
  while (v.errors.length && picks.clean.length + picks.concentrated.length > RADAR_MIN_ITEMS) {
    ;(picks.concentrated.length >= picks.clean.length ? picks.concentrated : picks.clean).pop()
    text = radarText(picks, day)
    v = validatePost({ text, media: { kind: 'animation', banner: true }, buttons })
  }
  if (v.errors.length) return { ok: false, skip: v.errors.join(' ') }
  const bad = findBanned(v.text)
  if (bad) return { ok: false, skip: `The radar text contained a word it never uses (${bad}); nothing was drafted.` }
  return { ok: true, v, picks, day }
}

/* --------------------------------------------------------- draft and post --- */

/** Makes today's draft, or refreshes it while it is still a draft. A sent or deleted-and-reposted radar is left alone. */
export async function makeDraft(t = channelHooks.now()) {
  const existing = channelHooks.find(keyOf(t))
  if (existing && existing.status !== 'draft' && existing.status !== 'failed') return { ok: true, post: existing, existing: true }
  const r = await buildRadar(t)
  if (!r.ok) return { ok: false, skip: r.skip, post: existing }
  const post = existing ? channelHooks.rewrite(existing, r.v) : channelHooks.create(r.v, keyOf(t))
  return { ok: true, post, existing: !!existing }
}

let nextTryAt = 0
let busy = false
/** Scheduler pass (every 30 s from the channel tick): the daily draft, and the post itself only with TELEGRAM_RADAR_AUTOPOST=1. */
export async function radarTick() {
  if (!draftsOn() || busy) return
  const t = channelHooks.now()
  const d = new Date(t)
  if (d.getUTCHours() * 60 + d.getUTCMinutes() < radarTime()) return
  let post = channelHooks.find(keyOf(t))
  if (!post) {
    if (t < nextTryAt) return
    busy = true
    try {
      const r = await makeDraft(t)
      if (!r.ok) nextTryAt = t + 30 * 60_000 // not enough measured data yet: try again in half an hour
      post = r.post ?? null
    } finally {
      busy = false
    }
  }
  if (post && autopostOn() && post.status === 'draft' && !channelHooks.blocked()) await channelHooks.publish(post, 'auto:radar')
}
export const resetRadarForTest = () => {
  nextTryAt = 0
  busy = false
}

/** Handler behind /api/admin/channel/radar: { status, body }. */
export async function handleRadarAdmin(method, body) {
  const t = channelHooks.now()
  const state = () => ({ autopost: autopostOn(), draftsEnabled: draftsOn(), time: hhmm(radarTime()), today: channelHooks.view(channelHooks.find(keyOf(t))) })
  if (method === 'GET') return { status: 200, body: state() }
  const action = body?.action
  if (action !== 'draft' && action !== 'post') return { status: 400, body: { error: 'action must be draft or post.', ...state() } }
  const existing = channelHooks.find(keyOf(t))
  if (action === 'draft') {
    if (existing && existing.status === 'sent') return { status: 409, body: { error: 'Today’s radar is already in the channel.', post: channelHooks.view(existing) } }
    const r = await makeDraft(t)
    if (!r.ok) return { status: 409, body: { error: r.skip, skip: r.skip, post: channelHooks.view(r.post) } }
    return { status: 201, body: { post: channelHooks.view(r.post), refreshed: r.existing } }
  }
  if (existing?.status === 'sent') return { status: 409, body: { error: 'Today’s radar is already in the channel.', post: channelHooks.view(existing) } }
  let post = existing
  if (!post) {
    const r = await makeDraft(t)
    if (!r.ok) return { status: 409, body: { error: r.skip, skip: r.skip } }
    post = r.post
  }
  const v = validatePost(post)
  if (v.errors.length) return { status: 400, body: { error: v.errors.join(' ') } }
  const bad = findBanned(post.text)
  if (bad) return { status: 400, body: { error: `The post contains a word the radar never uses (${bad}).` } }
  const r = await channelHooks.publish(post, 'admin')
  return r.ok ? { status: 200, body: { post: channelHooks.view(post) } } : { status: r.status ?? 502, body: { error: r.error, post: channelHooks.view(post) } }
}
