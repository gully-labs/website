/* Every date and time a person reads on gullylabs.xyz, the app, admin, HolderMaps, Gully Security and the docs is Los
   Angeles time, labelled PT (owner, 2026-11-07), through Intl so daylight saving is handled. Stored data, APIs, chain
   timestamps and logs stay UTC; a day key from an API (2026-11-06) is a label and is shown as that day, never shifted. */
export const TZ = 'America/Los_Angeles'
type When = string | number | Date

/** 14:05 PT, or 14:05:09 PT with seconds. */
export const timePT = (v: When, seconds = false) => `${new Date(v).toLocaleTimeString('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: false })} PT`
/** Nov 6, 14:05 PT */
export const dateTimePT = (v: When) => `${new Date(v).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' })}, ${timePT(v)}`
/** Nov 6, 2026 */
export const datePT = (v: When) => new Date(v).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' })
/** The Los Angeles calendar day of an instant, as 2026-11-06. */
export const dayPT = (v: When) => new Date(v).toLocaleDateString('en-CA', { timeZone: TZ })
/** The last `n` Los Angeles days, oldest first, as { key: '2026-11-06', label: 'Nov 6' }. */
export function lastDaysPT(n: number, now: When = Date.now()) {
  const out: { key: string; label: string }[] = []
  const seen = new Set<string>()
  // Whole hours back from now, so a 23 or 25 hour day (daylight saving) neither skips nor repeats a day.
  for (let t = new Date(now).getTime(); out.length < n; t -= 3600_000) {
    const key = dayPT(t)
    if (seen.has(key)) continue
    seen.add(key)
    out.unshift({ key, label: new Date(t).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }) })
  }
  return out
}
