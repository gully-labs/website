import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from './charts/chart-utils'

interface SparklineProps {
  /** At least two points; the caller shows an honest empty state otherwise. */
  data: number[]
  color: string
  /** Delay before the line draws in, in seconds. */
  delay?: number
  /** Large variant used for the project Activity chart. */
  large?: boolean
  /** Keep redrawing: the line draws on, holds, fades and draws again (off under reduced motion). */
  loop?: boolean
  label?: string
}

/** Values at `n` evenly spaced positions along `v`, so a series can morph into one of another length. */
const resample = (v: number[], n: number) =>
  v.length === n || !v.length
    ? v
    : Array.from({ length: n }, (_, i) => {
        const x = n === 1 ? 0 : (i / (n - 1)) * (v.length - 1)
        const a = Math.floor(x)
        const b = Math.min(v.length - 1, a + 1)
        return v[a] + (v[b] - v[a]) * (x - a)
      })

/* When the series changes (a refresh), the drawn line glides from its old shape to the new one
   instead of jumping; immediate under prefers-reduced-motion. The values only pass through
   in-between shapes for the length of the glide; at rest the line is exactly the data. */
function useTween(target: number[], ms = 700) {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(target)
  const from = useRef(target)
  const sig = target.join(',')
  useEffect(() => {
    const a = resample(from.current, target.length)
    const t0 = performance.now()
    let raf = 0
    const step = (now: number) => {
      const k = reduced ? 1 : Math.min(1, (now - t0) / ms)
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
      const v = k === 1 ? target : target.map((x, i) => (a[i] ?? x) + (x - (a[i] ?? x)) * e)
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

export function Sparkline({ data: target, color, delay = 0, large = false, loop = false, label }: SparklineProps) {
  const data = useTween(target)
  const hi = Math.max(...data)
  const lo = Math.min(...data)
  // A flat series still draws a line, not a division by zero.
  const max = hi === lo ? hi + 1 : hi * 1.1
  const min = hi === lo ? lo - 1 : lo * 0.9
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * 100},${40 - ((v - min) / (max - min)) * 40}`)
    .join(' L')
  const last = pts.split(' L').pop()!.split(',')

  return (
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      className="block size-full overflow-visible"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={`M0,40 L${pts} L100,40 Z`} fill={`${color}24`} style={{ animation: loop ? `gl-fade-loop 7s ${delay}s ease-in-out infinite` : 'gl-fade 1s .4s ease both' }} />
      <path
        d={`M${pts}`}
        fill="none"
        stroke={color}
        strokeWidth={large ? 2.5 : 2}
        vectorEffect="non-scaling-stroke"
        pathLength={1}
        strokeDasharray={1}
        style={{ animation: loop ? `gl-draw-loop 7s ${delay}s ease-in-out infinite` : `gl-draw 1.4s ${delay}s ease-out both` }}
      />
      {loop && (
        <circle cx={last[0]} cy={last[1]} r={2.2} fill={color} vectorEffect="non-scaling-stroke" style={{ animation: `gl-fade-loop 7s ${delay}s ease-in-out infinite`, filter: `drop-shadow(0 0 3px ${color})` }} />
      )}
    </svg>
  )
}
