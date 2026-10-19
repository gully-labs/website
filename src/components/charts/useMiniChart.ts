import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { useReducedMotion } from './chart-utils'
import { lerpSeries, tweenEase, tweenMs } from './liveMotion'

/* Shared plumbing for the kit's small SVG charts (MiniSpark, MiniBars): start the entry animation
   when the chart scrolls into view, glide between values on refresh, and step a tooltip through the
   points with the pointer or the keyboard. */

/** True once the element has been (mostly) on screen; stays true. */
export function useSeen<T extends Element>() {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const node = ref.current
    if (seen || !node) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { threshold: 0.2 })
    io.observe(node)
    return () => io.disconnect()
  }, [seen])
  return [ref, seen] as const
}

/** True while the element is on screen (follows scrolling both ways). Live loops pause when false: put
    it on the box as data-live={inView ? 'on' : 'paused'} (index.css freezes every loop inside it). */
export function useInView<T extends Element>(shared?: RefObject<T | null>) {
  const own = useRef<T>(null)
  const ref = shared ?? own
  const [inView, setInView] = useState(true)
  useEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => setInView(es.some((e) => e.isIntersecting)))
    io.observe(node)
    return () => io.disconnect()
  }, [ref])
  return [ref, inView] as const
}

/**
 * The values as drawn: on a change they glide from the old ones (700 ms ease, or 150 ms linear under
 * reduced motion). Only values known before and after glide; an unknown (null) appears or disappears
 * at once, never passing through zero. At rest the drawn values are exactly `target`.
 */
export function useTween(target: readonly (number | null)[], ms = 700): readonly (number | null)[] {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(target)
  const from = useRef(target)
  const sig = target.join(',')
  useEffect(() => {
    const a = from.current
    if (a.length !== target.length) {
      from.current = target
      setShown(target)
      return
    }
    const t0 = performance.now()
    let raf = 0
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / tweenMs(reduced, ms))
      const v = lerpSeries(a, target, tweenEase(k, reduced))
      from.current = v
      setShown(v)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // `sig` is the series by value; a new array with the same numbers is not a change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, reduced, ms])
  return shown.length === target.length ? shown : target
}

/** A tooltip cursor over `count` points: arrow keys, Home and End step it; Escape clears it. */
export function useCursor(count: number) {
  const [at, setAt] = useState<number | null>(null)
  const onKeyDown = (e: KeyboardEvent) => {
    const last = count - 1
    if (last < 0) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setAt((a) => (a === null ? 0 : Math.min(last, a + 1)))
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setAt((a) => (a === null ? last : Math.max(0, a - 1)))
    else if (e.key === 'Home') setAt(0)
    else if (e.key === 'End') setAt(last)
    else if (e.key === 'Escape') setAt(null)
    else return
    e.preventDefault()
  }
  return { at, setAt, onKeyDown, clear: () => setAt(null) }
}
