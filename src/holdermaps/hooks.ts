/* HolderMaps' small hooks: when a chart is on screen, an eased number, a box's width, a clock and a JSON poll. */
import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from '../components/charts/chart-utils'
import { useLiveSeries } from '../components/charts/useLiveSeries'

/** True once the element has been on screen (charts start drawing then, not before). */
export function useInView<T extends Element>() {
  const ref = useRef<T>(null)
  // Without IntersectionObserver (old browsers, some test runners) everything counts as seen.
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: '0px 0px -8% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  return [ref, seen] as const
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3)

/** A number that eases from its last value to `target` once `run` is true (150 ms, linear, under reduced motion). */
export function useTween(target: number, run: boolean, ms = 1100) {
  const reduced = useReducedMotion()
  const [v, setV] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    if (!run) return
    const start = performance.now()
    const a = from.current
    const dur = reduced ? 150 : ms
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur)
      const x = a + (target - a) * (reduced ? t : ease(t))
      from.current = x
      setV(x)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, run, ms, reduced])
  return v
}

/** The element's width in CSS px (ResizeObserver), for charts drawn at their real size. */
export function useBoxWidth<T extends HTMLElement>(fallback = 320) {
  const ref = useRef<T>(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(160, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}


/** The time now, re-read every `ms` (for "2 min ago" labels). */
export function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

export type Poll<T> = { k: 'loading' } | { k: 'error' } | { k: 'ok'; data: T }
/** A JSON read refreshed every `ms` (0 = once an hour); a failed refresh keeps the last good answer. */
export function usePoll<T>(path: string, ms: number): Poll<T> {
  const { data, error } = useLiveSeries<T>(
    (signal) =>
      fetch(path, { headers: { accept: 'application/json' }, signal }).then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json() as Promise<T>
      }),
    ms || 3_600_000,
  )
  return data !== undefined ? { k: 'ok', data } : error ? { k: 'error' } : { k: 'loading' }
}
