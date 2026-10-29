// Data watchdog for the home page's live ledger (server/stats.mjs). Every 15 minutes it reads the same cached
// document the page reads and looks for the three ways a venue's numbers silently go wrong:
//
//   error  the venue's feed could not be read (state 'error');
//   empty  the feed answered but a series the page draws is missing (fewer than two points);
//   flat   the daily volume series has been zero for its last days while the venue's own 24 h figure or its
//          all-time totals moved, i.e. the series is stale and the page would draw a flat line over a live venue.
//
// One Telegram admin alert per venue per UTC day (intake-notify.mjs notifyAdminAlert), at most MAX_PER_DAY in all,
// and a failed send is not retried for an hour. A problem is alerted when it is new or changes; the same problem
// still there is repeated at most once every REPEAT_MS (a venue with no TVL source would otherwise ping daily). The latest verdict is kept for the admin Health card
// (statsWatchdogHealth). State (previous totals, who was alerted today) lives in DATA_DIR/stats-watchdog.json so a
// restart neither repeats an alert nor forgets the totals it compares against.

import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './http.mjs'
import { notifyAdminAlert } from './intake-notify.mjs'
import { readStats } from './stats.mjs'

export const WATCHDOG_EVERY_MS = 15 * 60_000
export const MAX_PER_DAY = 6
const RETRY_MS = 3_600_000
export const REPEAT_MS = 7 * 86_400_000
const FLAT_DAYS = 3
// Series a venue is expected to draw. PeddleQuest is quests, not trading: no volume.
const EXPECT = { peddleswap: ['volume', 'tvl'], peddles: ['volume', 'tvl'], peddlequest: ['tvl', 'fees'] }
const NAMES = { peddleswap: 'PeddleSwap', peddles: 'Peddles', peddlequest: 'PeddleQuest' }

const FILE = () => path.join(DATA_DIR, 'stats-watchdog.json')
const readState = () => {
  try {
    return JSON.parse(fs.readFileSync(FILE(), 'utf8')) ?? {}
  } catch {
    return {}
  }
}
const writeState = (s) => {
  try {
    fs.mkdirSync(path.dirname(FILE()), { recursive: true })
    fs.writeFileSync(FILE() + '.tmp', JSON.stringify(s))
    fs.renameSync(FILE() + '.tmp', FILE())
  } catch (e) {
    console.error('stats watchdog state:', e?.message ?? e)
  }
}

const moved = (cur, prev) => typeof cur === 'number' && typeof prev === 'number' && Math.abs(cur - prev) > Math.max(0.005, Math.abs(prev) * 1e-9)

/** Pure: the problems in one stats document. `prev` is { venueKey: { volumeAllUsd, feesAllUsd } } from the last check. */
export function findIssues(doc, prev = {}) {
  const issues = []
  for (const v of doc.venues ?? []) {
    if (v.state !== 'ok') {
      issues.push({ venue: v.key, kind: 'error', detail: `feed unreadable: ${String(v.error ?? 'no reason given').slice(0, 160)}` })
      continue
    }
    const missing = (EXPECT[v.key] ?? []).filter((m) => (v.series?.[m]?.length ?? 0) < 2)
    if (missing.length) issues.push({ venue: v.key, kind: 'empty', detail: `no ${missing.join(' / ')} series (fewer than two points)` })
    const vol = v.series?.volume ?? []
    if (vol.length >= FLAT_DAYS && vol.slice(-FLAT_DAYS).every((p) => p.v === 0)) {
      const p = prev[v.key] ?? {}
      const why = []
      if ((v.volume24hUsd ?? 0) > 0) why.push(`24 h volume is $${Math.round(v.volume24hUsd)}`)
      if (moved(v.volumeAllUsd, p.volumeAllUsd)) why.push(`all-time volume moved ($${Math.round(p.volumeAllUsd)} to $${Math.round(v.volumeAllUsd)})`)
      if (moved(v.feesAllUsd, p.feesAllUsd)) why.push(`all-time fees moved ($${Math.round(p.feesAllUsd)} to $${Math.round(v.feesAllUsd)})`)
      if (why.length) issues.push({ venue: v.key, kind: 'flat', detail: `daily volume is flat at zero for ${FLAT_DAYS}+ days while ${why.join(' and ')}` })
    }
  }
  return issues
}

let last = null // { at, issues, alerted }

/** One pass. `now` and `doc` are injectable for tests. Resolves { issues, alerted: [venueKeys sent now] }. */
export async function watchdogTick({ now = Date.now(), doc } = {}) {
  let d = doc
  if (!d) {
    try {
      d = await readStats()
    } catch (e) {
      d = { venues: [{ key: 'stats', state: 'error', error: String(e?.message ?? e) }] }
    }
  }
  const st = readState()
  const day = new Date(now).toISOString().slice(0, 10)
  const issues = findIssues(d, st.totals ?? {})
  // Totals are remembered only when the venue read fine, so an outage does not look like a jump afterwards.
  const totals = { ...(st.totals ?? {}) }
  for (const v of d.venues ?? []) if (v.state === 'ok') totals[v.key] = { volumeAllUsd: v.volumeAllUsd ?? null, feesAllUsd: v.feesAllUsd ?? null }
  const alertedToday = st.alertDay === day ? { ...(st.alerted ?? {}) } : {}
  const tried = { ...(st.tried ?? {}) }
  // What was last alerted per venue ({ sig, at }); a venue that is fine again is forgotten, so a relapse alerts.
  const known = {}
  for (const [k, x] of Object.entries(st.known ?? {})) if (issues.some((i) => i.venue === k)) known[k] = x
  const alerted = []
  for (const venue of [...new Set(issues.map((i) => i.venue))]) {
    if (alertedToday[venue]) continue
    const sig = issues.filter((x) => x.venue === venue).map((x) => `${x.kind}: ${x.detail}`).join(' | ')
    if (known[venue]?.sig === sig && now - known[venue].at < REPEAT_MS) continue
    if (Object.keys(alertedToday).length >= MAX_PER_DAY) break
    if (now - (tried[venue] ?? 0) < RETRY_MS) continue
    tried[venue] = now
    const mine = issues.filter((x) => x.venue === venue)
    const r = await notifyAdminAlert({
      emoji: '📉',
      title: `Live ledger data: ${NAMES[venue] ?? venue}`,
      fields: [
        ['Problem', mine.map((x) => `${x.kind}: ${x.detail}`).join(' | ')],
        ['Effect', 'the home page chart shows an empty or stale series for this venue'],
        ['Next alert', 'when this changes, or in 7 days if it is still the same'],
      ],
      adminUrl: 'https://admin.gullylabs.xyz/#health',
    })
    if (r.sent) {
      alertedToday[venue] = now
      known[venue] = { sig, at: now }
      alerted.push(venue)
    }
  }
  writeState({ totals, alertDay: day, alerted: alertedToday, tried, known })
  last = { at: new Date(now).toISOString(), issues, alerted: Object.keys(alertedToday) }
  return { issues, alerted }
}

/** For the admin Health card: the latest verdict, or { at: null } before the first pass. */
export function statsWatchdogHealth() {
  return last ? { ...last, everyMs: WATCHDOG_EVERY_MS } : { at: null, issues: [], alerted: [], everyMs: WATCHDOG_EVERY_MS }
}

export function resetWatchdogForTest() {
  last = null
}

let timer = null
export function startStatsWatchdog() {
  if (timer) return
  // First pass after the stats cache has had time to warm; both timers are unref'd so they never hold the process.
  setTimeout(() => watchdogTick().catch(() => undefined), 60_000).unref?.()
  timer = setInterval(() => watchdogTick().catch(() => undefined), WATCHDOG_EVERY_MS)
  timer.unref?.()
}
