// Los Angeles days on the server (owner, 2026-11-07). Instants are stored in UTC and the machine's clock is left alone:
// only the day a thing counts toward, and the time a person reads, are Los Angeles time. Intl handles daylight saving,
// so a day is 23, 24 or 25 hours long and no offset is written down anywhere. The browser's half is src/lib/time.ts.
//
// Cutover, 2026-11: counters already stored under a UTC day key keep that key and are read as that day; nothing is moved.
// No event is counted twice, because each one was written once. Days computed from stored instants are right everywhere.
export const TZ = 'America/Los_Angeles'
const HOUR = 3_600_000

/** The Los Angeles calendar day of an instant: 2026-11-06. */
export const dayLA = (t = Date.now()) => new Date(t).toLocaleDateString('en-CA', { timeZone: TZ })

/** The instant Los Angeles day `key` begins. */
function startOf(key) {
  const noonUtc = Date.parse(`${key}T00:00:00Z`)
  // Midnight there is 7 or 8 hours after midnight UTC; the first hour of the day is the one whose previous hour is another day.
  for (let h = 6; h <= 9; h++) {
    const t = noonUtc + h * HOUR
    if (dayLA(t) === key && dayLA(t - 1) !== key) return t
  }
  return noonUtc + 8 * HOUR
}
/** The instant the Los Angeles day of `t` began. */
export const dayStartLA = (t = Date.now()) => startOf(dayLA(t))
/** The instant the next Los Angeles day begins. */
export function nextDayStartLA(t = Date.now()) {
  const d = new Date(`${dayLA(t)}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return startOf(d.toISOString().slice(0, 10))
}
/** The last `n` Los Angeles days, oldest first. */
export function lastDaysLA(n, now = Date.now()) {
  const out = []
  let t = now
  for (let i = 0; i < n; i++) {
    out.unshift(dayLA(t))
    t = dayStartLA(t) - 1
  }
  return out
}
/** Minutes after midnight in Los Angeles. */
export function minuteOfDayLA(t = Date.now()) {
  const [h, m] = new Date(t).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).split(':').map(Number)
  return (h % 24) * 60 + m
}
/** 14:05 PT */
export const timeLA = (t = Date.now()) => `${new Date(t).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })} PT`
