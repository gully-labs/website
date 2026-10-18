/* Custom events for Gully Analytics (our Umami fork, loaded by index.html from analytics.gullylabs.xyz).

   track('event-name', { key: 'value' }) is a thin, safe wrapper over window.umami.track:
   - It never throws and never waits: when the script is blocked (ad blockers, CSP, offline), not loaded
     yet, or broken, the call does nothing.
   - It respects Do Not Track and Global Privacy Control: when either is on, nothing is sent.
   - It sends no personal data. Values are short strings, numbers or booleans; anything that looks like a
     wallet address, a transaction hash, an email or a long token is replaced with "[redacted]" (the tracker
     itself already records wallet connects under data-web3; events add nothing to that).
   Event names are kebab-case, `area-action` (see the list in docs: cta-click, launch-app, plan-click,
   docs-search, widget-snippet-copy, link-click, status-view, ...). */

export type TrackValue = string | number | boolean | null | undefined
export type TrackData = Record<string, TrackValue>

interface Umami {
  track: (event: string, data?: Record<string, string | number | boolean>) => unknown
}

const MAX_KEYS = 8
const MAX_STR = 80
// Wallet addresses (EVM, Solana base58), transaction hashes, emails, and long opaque tokens.
const SECRETISH = [/0x[0-9a-fA-F]{20,}/g, /\b[1-9A-HJ-NP-Za-km-z]{32,88}\b/g, /[^\s@]+@[^\s@]+\.[^\s@]+/g, /\b[A-Za-z0-9_-]{40,}\b/g]

/** Whether the visitor asked not to be tracked (Do Not Track or Global Privacy Control). */
export function doNotTrack(): boolean {
  if (typeof navigator === 'undefined') return true
  const n = navigator as Navigator & { msDoNotTrack?: string; globalPrivacyControl?: boolean }
  const w = typeof window !== 'undefined' ? (window as Window & { doNotTrack?: string }) : undefined
  const dnt = n.doNotTrack ?? w?.doNotTrack ?? n.msDoNotTrack
  return dnt === '1' || dnt === 'yes' || n.globalPrivacyControl === true
}

/** Strips anything personal-looking out of one value and caps its length. */
export function clean(v: TrackValue): string | number | boolean | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v
  let s = String(v)
  for (const re of SECRETISH) s = s.replace(re, '[redacted]')
  s = s.trim().slice(0, MAX_STR)
  return s || null
}

function umami(): Umami | null {
  if (typeof window === 'undefined') return null
  const u = (window as Window & { umami?: Partial<Umami> }).umami
  return u && typeof u.track === 'function' ? (u as Umami) : null
}

/**
 * Sends one custom event to Gully Analytics. Safe to call anywhere, any time: a no-op when the script is
 * blocked or not loaded, when Do Not Track is on, or outside a browser. Returns whether it was handed over.
 */
export function track(event: string, data?: TrackData): boolean {
  try {
    if (doNotTrack()) return false
    const u = umami()
    if (!u) return false
    const name = String(event).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 50)
    if (!name) return false
    const out: Record<string, string | number | boolean> = {}
    for (const [k, v] of Object.entries(data ?? {}).slice(0, MAX_KEYS)) {
      const c = clean(v)
      if (c !== null) out[k.slice(0, 30)] = c
    }
    u.track(name, Object.keys(out).length ? out : undefined)
    return true
  } catch {
    return false
  }
}

/** The host of a link ("app.gullylabs.xyz", "t.me"), or "internal" for one on this site; never the full URL. */
export function linkTarget(href: string | null | undefined): string {
  if (!href) return 'none'
  try {
    const u = new URL(href, typeof location !== 'undefined' ? location.href : 'https://gullylabs.xyz')
    if (typeof location !== 'undefined' && u.host === location.host) return `internal:${u.pathname.split('/').slice(0, 2).join('/') || '/'}`
    return u.host
  } catch {
    return 'unknown'
  }
}

let delegated = false
/**
 * One document-level click listener for pages whose files this helper does not own: every link click on
 * /links is sent as `link-click` with the link's label (its visible text, cut short) and target host.
 * Idempotent; returns a function that removes it.
 */
export function installDelegatedTracking(): () => void {
  if (delegated || typeof document === 'undefined') return () => undefined
  delegated = true
  const onClick = (e: MouseEvent) => {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
    if (!a) return
    const path = location.pathname.replace(/\/+$/, '') || '/'
    if (path === '/links') track('link-click', { label: (a.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40), target: linkTarget(a.getAttribute('href')) })
  }
  document.addEventListener('click', onClick, { capture: true })
  return () => {
    document.removeEventListener('click', onClick, { capture: true })
    delegated = false
  }
}
