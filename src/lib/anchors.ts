/* Scrolling to a landing anchor (/#projects, /#pricing, …) so the section's top sits ANCHOR_OFFSET px
   from the top of the window, i.e. just under the sticky header, every time.

   A plain scrollTo is not enough: lazy chunks, charts and images above the target keep changing height
   while a smooth scroll is under way, so the section used to land ~30 px off (under the header). Here
   the position is re-checked when the scroll ends and whenever the page resizes, for a short while,
   and corrected without animation. Any wheel, touch, key or pointer input from the visitor stops it. */

/** Distance from the window top to an anchored section's top: the 65 px header plus a few px of air. */
export const ANCHOR_OFFSET = 72
const SETTLE_MS = 2_000

let cancelPrevious: (() => void) | null = null

const targetTop = (el: Element) => el.getBoundingClientRect().top + window.scrollY - ANCHOR_OFFSET

/** Scrolls to the element with this id and keeps it pinned while the layout settles. False if not found. */
export function scrollToAnchor(id: string, behavior: ScrollBehavior = 'instant'): boolean {
  const el = document.getElementById(id)
  if (!el) return false
  cancelPrevious?.()
  window.scrollTo({ top: targetTop(el), behavior })

  let done = false
  let moving = behavior === 'smooth'
  const fix = () => {
    if (done || moving) return
    const off = el.getBoundingClientRect().top - ANCHOR_OFFSET
    if (Math.abs(off) > 2) window.scrollTo({ top: targetTop(el), behavior: 'instant' })
  }
  // A smooth scroll is done when scrolling stops (scrollend where supported, else no scroll for 150 ms).
  let idle = 0
  const onScroll = () => {
    if (!moving) return
    clearTimeout(idle)
    idle = window.setTimeout(onEnd, 150)
  }
  const onEnd = () => {
    if (!moving) return
    moving = false
    fix()
  }
  const ro = new ResizeObserver(() => requestAnimationFrame(fix))
  ro.observe(document.body)
  const stop = () => {
    if (done) return
    done = true
    clearTimeout(idle)
    clearTimeout(timer)
    ro.disconnect()
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('scrollend', onEnd)
    for (const t of USER) window.removeEventListener(t, stop, true)
    if (cancelPrevious === stop) cancelPrevious = null
  }
  const USER = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
  for (const t of USER) window.addEventListener(t, stop, { capture: true, passive: true })
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('scrollend', onEnd)
  idle = window.setTimeout(onEnd, 1_200) // a smooth scroll that never reports its end
  const timer = window.setTimeout(() => {
    moving = false
    fix()
    stop()
  }, SETTLE_MS)
  cancelPrevious = stop
  return true
}
