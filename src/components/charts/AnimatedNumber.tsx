import { useEffect, useRef, useState } from 'react'
import NumberFlow from '@number-flow/react'
import { NF, type NumberFormat } from './number-formats'
import { useReducedMotion } from './chart-utils'

/* A number that rolls to its new value, digit by digit (NumberFlow, MIT). Use it for any live
   figure: KPI tiles, ring centres, prices. Policy:
   - A value that could not be read (null) shows `fallback` ('—' by default) and says
     "not available" to screen readers. It is never drawn as 0.
   - `countUp` rolls up from zero on first show, as an entrance; the accessible label is always the
     real value, never the in-between ones.
   - Under reduced motion the digits change in place (no spin, no count-up), and the figure flashes
     gold for 200 ms so a change is still seen. */

export interface AnimatedNumberProps {
  value: number | null | undefined
  format?: NumberFormat
  prefix?: string
  suffix?: string
  /** Shown when the value could not be read. */
  fallback?: string
  /** Roll up from zero the first time a value is shown. */
  countUp?: boolean
  className?: string
  style?: React.CSSProperties
}

const LINEAR_150 = { duration: 150, easing: 'linear' }
const NONE = { duration: 0, easing: 'linear' }

export function AnimatedNumber({ value, format = NF.int, prefix, suffix, fallback = '—', countUp = false, className, style }: AnimatedNumberProps) {
  const reduced = useReducedMotion()
  const known = typeof value === 'number' && Number.isFinite(value)
  // The first frame of a count-up shows zero; the next frame sets the real value, which rolls.
  const [armed, setArmed] = useState(!countUp)
  useEffect(() => {
    if (armed || !known) return
    const id = requestAnimationFrame(() => setArmed(true))
    return () => cancelAnimationFrame(id)
  }, [armed, known])

  // Reduced motion: a short colour flash marks the change instead of the roll.
  const box = useRef<HTMLSpanElement>(null)
  const prev = useRef(value)
  useEffect(() => {
    const el = box.current
    if (prev.current !== value && reduced && el?.animate && known) el.animate([{ color: '#66e4ff' }, { color: getComputedStyle(el).color }], { duration: 200, easing: 'linear' })
    prev.current = value
  }, [value, reduced, known])

  if (!known)
    return (
      <span className={className} style={style} aria-label="not available">
        {fallback}
      </span>
    )
  const shown = armed || reduced ? (value as number) : 0
  const text = `${prefix ?? ''}${new Intl.NumberFormat('en-US', format).format(value as number)}${suffix ?? ''}`
  return (
    <span ref={box} className={className} style={style} role="img" aria-label={text}>
      <NumberFlow
        aria-hidden
        value={shown}
        locales="en-US"
        format={format}
        prefix={prefix}
        suffix={suffix}
        respectMotionPreference={false}
        willChange={false}
        {...(reduced ? { transformTiming: NONE, spinTiming: NONE, opacityTiming: LINEAR_150 } : { spinTiming: { duration: 900, easing: 'cubic-bezier(.2,.8,.2,1)' } })}
      />
    </span>
  )
}
