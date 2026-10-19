// Telegram inline mode for @GullyLabsBot: typing "@GullyLabsBot <token address or ticker>" in any chat answers
// with the Holder Map share card, a short caption of measured facts and buttons (Open Holder Map, Open in Mini
// App, Join @GullyLabsNews). Called from telegram.mjs's update router; the Bot API call is injected (no cycle).
//
// Inline queries are high volume, so:
//   * Debounce: nothing is done unless the query is a valid address (0x… or a Solana mint) or a ticker the Holder
//     Map tracks. Anything else is answered with no results and no work.
//   * Answers come from cached maps (peekHolderMap) or a bounded fast path: a cache miss starts ONE build under
//     the Holder Map's own per-IP budget, keyed on the Telegram user ("tg:<id>"), waits INLINE_WAIT_MS for it, and
//     otherwise answers with an "Open Holder Map" article (the next try is a cache hit).
//   * Per Telegram user at most INLINE_WORK_PER_MIN lookups that do work (chain detection or a build) a minute,
//     the same number as the Holder Map's per-IP budget; over it, only cached answers and the article.
//   * Every answer carries cache_time (hit 300 s like the map cache, miss 20 s, junk 60 s) so Telegram absorbs repeats.
// The News gate does not apply: inline results are the growth path, so they carry a "Join @GullyLabsNews" button.
// Facts only, never a verdict. BotFather: /setinline on the bot, with a placeholder (see the admin Health notes).

import { chainKeyOf, findStock, HOLDER_CHAINS, peekHolderMap, readHolderMap } from './holders.mjs'
import { resolveHolders } from './holders-intel.mjs'
import { isSolanaAddress } from './solana.mjs'
import { esc, SITE } from './telegram-ui.mjs'
import fs from 'node:fs'
import path from 'node:path'

export const INLINE_WORK_PER_MIN = 12 // the Holder Map's PER_IP_PER_MIN
export const INLINE_MAX_RESULTS = 5
export const CACHE_HIT_S = 300
export const CACHE_MISS_S = 20
export const CACHE_JUNK_S = 60
const NEWS_URL = 'https://t.me/GullyLabsNews'
const CARD = { w: 1200, h: 630 }

let waitMs = Number(process.env.TELEGRAM_INLINE_WAIT_MS) || 2_500
let resolveFn = resolveHolders
let buildFn = readHolderMap
/** Tests: replace the chain detection, the map builder and the wait for a fast-path build. */
export function setInlineForTest({ resolve, build, wait } = {}) {
  resolveFn = resolve ?? resolveHolders
  buildFn = build ?? readHolderMap
  waitMs = wait ?? (Number(process.env.TELEGRAM_INLINE_WAIT_MS) || 2_500)
}

/* Cache-busting for the card URLs: the build time of the site (dist/index.html), else the process start. */
let buildStamp = null
export function buildTime() {
  if (buildStamp) return buildStamp
  let t = Date.now()
  try {
    t = fs.statSync(path.join(path.resolve(process.env.DIST_DIR ?? 'dist'), 'index.html')).mtimeMs
  } catch {
    /* no build here: the start time */
  }
  buildStamp = Math.floor(t / 1000).toString(36)
  return buildStamp
}
export const cardUrl = (chain, token) => `${SITE}/api/holders/${chain}/${encodeURIComponent(token)}/card.png?v=${buildTime()}`
const mapUrl = (chain, token) => `${SITE}/holders/${chain}/${encodeURIComponent(token)}`

/* ------------------------------------------------------------ the query --- */

const lower = (s) => String(s).toLowerCase()
/** What a query is: { kind: 'evm' | 'solana' | 'ticker', q } or null (junk). Pure, no I/O except the in-memory stock tables. */
export function classifyQuery(raw) {
  const q = String(raw ?? '').trim().replace(/^\$/, '')
  if (!q || q.length > 64) return null
  if (/^0x[0-9a-fA-F]{40}$/.test(q)) return { kind: 'evm', q }
  if (isSolanaAddress(q)) return { kind: 'solana', q }
  if (/^[A-Za-z.]{1,10}$/.test(q) && stockMatches(q).length) return { kind: 'ticker', q }
  return null
}

function stockMatches(q) {
  const out = []
  for (const ck of Object.keys(HOLDER_CHAINS)) {
    const s = findStock(ck, q)
    if (s) out.push({ chain: ck, token: s.ticker, symbol: s.ticker, kind: 'stock' })
  }
  return out
}

/** Matches without any network call: tracked stocks, and launches whose map is already cached. */
function cheapMatches(c) {
  if (c.kind === 'ticker') return stockMatches(c.q)
  const out = []
  for (const ck of Object.keys(HOLDER_CHAINS)) {
    const s = findStock(ck, c.q)
    if (s) out.push({ chain: ck, token: s.ticker, symbol: s.ticker, kind: 'stock' })
    const addr = ck === 'solana' ? c.q : lower(c.q)
    if (!s && (ck === 'solana') === (c.kind === 'solana')) {
      const m = peekHolderMap(ck, addr)
      if (m?.state === 'ok') out.push({ chain: ck, token: addr, symbol: m.token?.symbol ?? null, kind: m.kind })
    }
  }
  return out
}

/* ------------------------------------------------------- per-user budget --- */

const work = new Map() // user id -> times of lookups that did work, last minute
function takeWork(userId) {
  const now = Date.now()
  const list = (work.get(userId) ?? []).filter((t) => now - t < 60_000)
  if (list.length >= INLINE_WORK_PER_MIN) {
    work.set(userId, list)
    return false
  }
  list.push(now)
  work.set(userId, list)
  if (work.size > 5_000) work.delete(work.keys().next().value)
  return true
}
export const resetInlineForTest = () => work.clear()

/* ----------------------------------------------------------- the results --- */

const pct = (n) => (typeof n === 'number' ? `${n.toFixed(n >= 10 ? 1 : 2).replace(/\.?0+$/, '')}%` : null)

/** The caption: measured facts only, HTML-escaped. */
export function captionFor(map) {
  const sym = map.token?.symbol ? `$${map.token.symbol}` : `${String(map.token?.address ?? '').slice(0, 6)}…${String(map.token?.address ?? '').slice(-4)}`
  const lines = [`<b>${esc(sym)}</b> · ${esc(map.chain?.name ?? '')} Holder Map`]
  const s = map.summary
  if (pct(s?.top10Pct)) lines.push(`Top 10 wallets hold ${pct(s.top10Pct)}`)
  if (s?.largestCluster) lines.push(`Largest linked group: ${s.largestCluster.wallets} wallets hold ${pct(s.largestCluster.pct)}`)
  else if (map.clusters?.length === 0) lines.push('No linked wallets found among the biggest')
  if (typeof map.health?.score === 'number') lines.push(`Health score ${map.health.score}/100`)
  if (typeof map.holders?.count === 'number') lines.push(`${map.holders.count.toLocaleString('en-US')} holders`)
  lines.push('<i>Measured facts, signals not verdicts.</i>')
  return lines.join('\n').slice(0, 1000)
}

const startParam = (chain, token) => {
  const p = `h_${chain}_${token}`
  return /^h_[a-z]{2,12}_[A-Za-z0-9]{1,64}$/.test(p) && p.length <= 64 ? p : null
}

function keyboard(chain, token, bot) {
  const row = [{ text: 'Open Holder Map', url: mapUrl(chain, token) }]
  const sp = startParam(chain, token)
  if (sp) row.push({ text: 'Open in Mini App', url: `https://t.me/${bot}?startapp=${sp}` })
  return { inline_keyboard: [row, [{ text: 'Join @GullyLabsNews', url: NEWS_URL }]] }
}

const hitResult = (map, chain, token, bot) => {
  const sym = map.token?.symbol ? `$${map.token.symbol}` : 'Token'
  const s = map.summary
  const bits = [pct(s?.top10Pct) ? `Top 10 hold ${pct(s.top10Pct)}` : null, typeof map.health?.score === 'number' ? `health ${map.health.score}/100` : null].filter(Boolean)
  return {
    type: 'photo',
    id: `h:${chain}:${token}`.slice(0, 64),
    photo_url: cardUrl(chain, token),
    thumbnail_url: cardUrl(chain, token),
    photo_width: CARD.w,
    photo_height: CARD.h,
    title: `${sym} · ${map.chain?.name ?? chain}`,
    description: bits.join(' · ') || 'Holder Map',
    caption: captionFor(map),
    parse_mode: 'HTML',
    reply_markup: keyboard(chain, token, bot),
  }
}

function missResult(label, url, chain, token, bot) {
  return {
    type: 'article',
    id: `m:${chain ?? 'x'}:${String(token ?? label).slice(0, 40)}`.slice(0, 64),
    title: 'Open Holder Map',
    description: `Build the map for ${label} on the site`,
    input_message_content: { message_text: `<b>Holder Map</b> · ${esc(label)}\nWho holds it, and which wallets belong together. The map is built on the site.`, parse_mode: 'HTML', disable_web_page_preview: true },
    reply_markup: chain && token ? keyboard(chain, token, bot) : { inline_keyboard: [[{ text: 'Open Holder Map', url }], [{ text: 'Join @GullyLabsNews', url: NEWS_URL }]] },
  }
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))])

/**
 * Answers one inline_query. `deps`: { tg(method, body), botName(): Promise<string | null> }.
 * Never throws; a failed answer is just logged by the caller. Returns what was answered, for tests.
 */
export async function onInlineQuery(iq, deps) {
  const id = String(iq?.id ?? '')
  const uid = String(iq?.from?.id ?? '')
  if (!id || !uid || iq?.from?.is_bot) return { skipped: true }
  const answer = (results, cache_time, extra = {}) => deps.tg('answerInlineQuery', { inline_query_id: id, results: results.slice(0, 50), cache_time, is_personal: false, ...extra })
  const c = classifyQuery(iq.query)
  if (!c) {
    await answer([], CACHE_JUNK_S)
    return { kind: 'junk', work: false }
  }
  const bot = (await deps.botName()) || 'GullyLabsBot'
  let matches = cheapMatches(c)
  let worked = false
  if (!matches.length && c.kind !== 'ticker') {
    if (takeWork(uid)) {
      worked = true
      matches = ((await withTimeout(resolveFn(c.q).catch(() => null), waitMs))?.matches ?? []).filter((m) => HOLDER_CHAINS[chainKeyOf(m.chain)])
    }
  }
  const label = c.kind === 'ticker' ? `$${c.q.toUpperCase()}` : `${c.q.slice(0, 6)}…${c.q.slice(-4)}`
  if (!matches.length) {
    await answer([missResult(label, `${SITE}/holders?q=${encodeURIComponent(c.q)}`, null, null, bot)], CACHE_MISS_S)
    return { kind: 'miss', work: worked }
  }
  const results = []
  let pending = false
  let builds = 0 // at most one new build per query: a ticker on three chains must not spend three builds at once
  for (const m of matches.slice(0, INLINE_MAX_RESULTS)) {
    const chain = chainKeyOf(m.chain)
    const token = m.token
    let map = peekHolderMap(chain, token)
    if (map?.state !== 'ok') {
      map = null
      if (builds < 1 && takeWork(uid)) {
        builds++
        worked = true
        const body = await withTimeout(buildFn(chain, token, { ip: `tg:${uid}`, tier: 'free' }).catch(() => null), waitMs)
        if (body?.state === 'ok') map = body
      }
    }
    if (map) results.push(hitResult(map, chain, token, bot))
    else {
      pending = true
      results.push(missResult(m.symbol ? `$${m.symbol}` : label, null, chain, token, bot))
    }
  }
  await answer(results, pending ? CACHE_MISS_S : CACHE_HIT_S)
  return { kind: pending ? 'miss' : 'hit', work: worked, results: results.length }
}
