import { TZ, dayPT, timePT } from '../../lib/time'
/* Small helpers shared by Gully AI's panel and cards (kept out of the component files for fast refresh). */

const isOwnHost = (u: string) => /^https:\/\/([\w-]+\.)?gullylabs\.xyz(\/|$)/.test(u)
/** Same host: open in place. Another host (the app from the site, or any other site): a new tab. */
export function hrefProps(u: string) {
  try {
    if (typeof window !== 'undefined' && new URL(u, window.location.href).host === window.location.host) return {}
  } catch {
    /* fall through */
  }
  return { target: '_blank', rel: isOwnHost(u) ? 'noopener' : 'noopener noreferrer' }
}

/** "as of 10:01 UTC" style, in Los Angeles time. */
export function asOfLabel(iso: string | null | undefined) {
  const t = Date.parse(iso ?? '')
  if (!Number.isFinite(t)) return null
  const d = new Date(t)
  const sameDay = dayPT(d) === dayPT(Date.now())
  const time = timePT(d)
  return sameDay ? time : `${d.toLocaleDateString([], { timeZone: TZ, day: 'numeric', month: 'short' })} ${time}`
}
