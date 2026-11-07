import { useState } from 'react'
import { X } from 'lucide-react'
import { SocialIcon } from './SocialIcon'

/* The slim "Follow @Gully_Labs on X" bar at the top of the site, the app and the docs (owner, 2026-11-06). It uses the
   page's own colour tokens, so each host wears its own scheme. A plain link, no third-party script. Dismissed once, it
   stays away: read before the first paint, so the page never shifts. Not on admin, checkouts or sign-in approval
   (those layouts do not draw it). */
const KEY = 'gl-follow-x-dismissed'
const dismissed = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function FollowBar() {
  const [gone, setGone] = useState(dismissed)
  if (gone) return null
  return (
    <div data-testid="follow-bar" className="relative flex h-11 items-center justify-center border-b border-line bg-surface text-[13px] text-ink print:hidden">
      <a href="https://x.com/Gully_Labs" target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 px-11 font-medium hover:text-gold">
        <SocialIcon name="X" size={14} />
        <span>Follow @Gully_Labs on X</span>
      </a>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          setGone(true)
          try {
            localStorage.setItem(KEY, '1')
          } catch {
            /* private mode: gone for this page */
          }
        }}
        className="absolute top-0 right-0 inline-flex size-11 items-center justify-center text-muted hover:text-ink"
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  )
}
