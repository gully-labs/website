import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, X } from 'lucide-react'

/* A slim bar above the header announcing the Holder Map. Dismissing it is remembered in localStorage (every
   access in try/catch: private windows and blocked storage just show it again). It expires by itself after
   ANNOUNCE_UNTIL (UTC, inclusive), so it never needs a deploy to go away. It is in the page flow, not fixed:
   it scrolls off and never covers the sticky header. */

export const ANNOUNCE_UNTIL = '2026-11-02'
export const ANNOUNCE_KEY = 'gl-announce-holder-map'

const expired = (now = Date.now()) => now >= Date.parse(`${ANNOUNCE_UNTIL}T00:00:00Z`) + 86_400_000

function dismissedBefore() {
  try {
    return localStorage.getItem(ANNOUNCE_KEY) === '1'
  } catch {
    return false
  }
}

export function AnnouncementBar() {
  const [hidden, setHidden] = useState(() => expired() || dismissedBefore())
  if (hidden) return null
  const dismiss = () => {
    setHidden(true)
    try {
      localStorage.setItem(ANNOUNCE_KEY, '1')
    } catch {
      /* storage unavailable: hidden for this visit only */
    }
  }
  return (
    <div role="region" aria-label="Announcement" data-announcement className="flex min-h-11 items-center justify-center gap-1 border-b border-gold-line bg-[rgba(217,181,99,.08)] pr-1 pl-4 text-[13px] max-[599px]:text-[12px]">
      <Link to="/holders" className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 text-ink">
        <span className="flex-none rounded-full bg-gold px-[7px] py-[1px] font-mono text-[11px] font-semibold tracking-[.5px] text-bg uppercase">New</span>
        <span className="truncate">
          Holder Map for any token<span className="max-[419px]:hidden"> on 5 chains</span>
        </span>
        <ArrowRight aria-hidden size={14} className="flex-none text-gold" />
      </Link>
      <button type="button" onClick={dismiss} aria-label="Dismiss the announcement" className="grid size-11 flex-none place-items-center rounded-btn text-muted hover:text-ink">
        <X aria-hidden size={14} />
      </button>
    </div>
  )
}
