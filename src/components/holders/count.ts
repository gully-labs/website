import { useEffect, useRef, useState } from 'react'

/** A number that counts from 0 (or from its last value) to `value` with requestAnimationFrame; under
    reduced motion it changes in place. */
export function useCountUp(value: number | null, ms = 1000) {
  const [shown, setShown] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    if (value === null) return
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = performance.now()
    const a = from.current
    let id = 0
    const step = (now: number) => {
      const t = reduced ? 1 : Math.min(1, (now - start) / ms)
      const v = a + (value - a) * (1 - Math.pow(1 - t, 3))
      setShown(v)
      from.current = v
      if (t < 1) id = requestAnimationFrame(step)
    }
    id = requestAnimationFrame(step)
    return () => cancelAnimationFrame(id)
  }, [value, ms])
  return value === null ? null : shown
}
