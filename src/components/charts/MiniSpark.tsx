import { useId } from 'react'
import { tooFewPoints } from './chartData'
import { C } from './chartTheme'
import { GhostSpark } from './GhostChart'
import { useCursor, useInView, useSeen, useTween } from './useMiniChart'

/* The kit's small trend line (design audit G32), for places a full ECharts chart is too heavy: table
   rows, cards, tickers. Hand-written SVG in kit colours. It draws in left to right when it scrolls into
   view, the area fades up under it, a dot (with a soft live pulse) marks the newest point, and a
   refresh glides the line to the new values. Pointer and keyboard (arrows, Home, End, Escape) show the
   value under the cursor in a tooltip. Unknown values (null) leave a gap in the line, never a dip to
   zero; with fewer than 2 real points it is the ghosted spark instead. Reduced motion: the draw-in is a
   fade, the pulse holds still (index.css policy). Replaces Sparkline.tsx, the TopMovers Spark and the
   AskCards Spark. */

export interface MiniSparkProps {
  /** One value per point, oldest first; null is an unknown reading (a gap). */
  data: readonly (number | null)[]
  /** Accessible name: what the line is ("DeepCore daily volume, 30 days"). */
  label: string
  /** x positions (e.g. timestamps) when the points are not evenly spaced. */
  xs?: readonly number[]
  /** Tooltip title per point (a date, a time). */
  labels?: readonly string[]
  /** Formats a value for the tooltip and the accessible summary. */
  fmt?: (v: number) => string
  color?: string
  /** Box height in px (or any CSS length); the width follows the parent. */
  height?: number | string
  /** Fill under the line (default on). */
  area?: boolean
  /** Keep 0 inside the range and draw it as a dashed rule (for signed series such as a gap). */
  zero?: boolean
  /** The newest point's dot and live pulse (default on). */
  dot?: boolean
  /** Live mode (default on): the area fill breathes and the newest point pulses (a slow, small pulse under
      reduced motion). Pauses off-screen. false for a still strip. */
  live?: boolean
  /** Ticker style: draw on, hold, fade and draw again (once under reduced motion). */
  loop?: boolean
  /** Seconds before the draw-in starts. */
  delay?: number
  /** Tooltip and keyboard stepping (default on); off for a purely decorative strip. */
  interactive?: boolean
  className?: string
}

const PAD = 8 // percent of the height kept clear above and below the line

export function MiniSpark({ data: target, label, xs, labels, fmt = (v) => v.toLocaleString('en-US'), color = C.gold, height = 40, area = true, zero = false, dot = true, live = true, loop = false, delay = 0, interactive = true, className = '' }: MiniSparkProps) {
  const data = useTween(target)
  const [ref, seen] = useSeen<HTMLDivElement>()
  const [, inView] = useInView(ref)
  const cursor = useCursor(data.length)
  const gid = useId().replace(/:/g, '')

  if (tooFewPoints(target)) {
    return (
      <div className={`relative w-full ${className}`} style={{ height }} role="img" aria-label={`${label}: not enough data for a line yet`}>
        <GhostSpark color={color} w="100%" h="100%" />
      </div>
    )
  }

  const real = data.filter((v): v is number => v !== null && Number.isFinite(v))
  let lo = Math.min(...real, ...(zero ? [0] : []))
  let hi = Math.max(...real, ...(zero ? [0] : []))
  if (hi === lo) {
    hi += 1
    lo -= 1
  }
  const n = data.length
  const x0 = xs?.[0] ?? 0
  const x1 = xs?.[n - 1] ?? n - 1
  const X = (i: number) => (((xs?.[i] ?? i) - x0) / (x1 - x0 || 1)) * 100
  const Y = (v: number) => 100 - PAD - ((v - lo) / (hi - lo)) * (100 - 2 * PAD)

  // Unknown values split the line into runs; each run draws on its own.
  const runs: number[][] = []
  data.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) return
    const run = runs[runs.length - 1]
    if (run && run[run.length - 1] === i - 1) run.push(i)
    else runs.push([i])
  })
  const path = (r: number[]) => r.map((i, k) => `${k ? 'L' : 'M'}${X(i).toFixed(2)},${Y(data[i]!).toFixed(2)}`).join(' ')
  const lastIdx = runs[runs.length - 1][runs[runs.length - 1].length - 1]
  const play = seen ? 'running' : 'paused'
  // The line is revealed left to right by a growing clip rect, not by a pathLength dash: Chrome lays a pathLength
  // dash out against the unscaled path when the stroke is non-scaling, which left lines half drawn (D4-7).
  const revealAnim = loop ? `gl-reveal-loop 7s ${delay}s ease-in-out infinite` : `gl-grow-x 1.2s ${delay}s cubic-bezier(.2,.8,.2,1) both`
  const fadeAnim = loop ? `gl-fade-loop 7s ${delay}s ease-in-out infinite` : `gl-fade .9s ${delay + 0.35}s ease both`
  const at = cursor.at
  const atV = at === null ? null : data[at]
  const fmtOr = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? 'not read' : fmt(v))
  const summary = `${label}: ${real.length} of ${n} points read, from ${fmtOr(target.find((v) => v !== null))} to ${fmtOr(target[lastIdx])}, low ${fmt(Math.min(...real))}, high ${fmt(Math.max(...real))}.${interactive ? ' Arrow keys read each point.' : ''}`

  return (
    <div
      ref={ref}
      className={`relative w-full rounded-input outline-none focus-visible:ring-2 focus-visible:ring-gold ${interactive ? 'cursor-crosshair' : ''} ${className}`}
      style={{ height }}
      // A group when interactive, so the tooltip's live region is announced as the cursor moves.
      role={interactive ? 'group' : 'img'}
      aria-label={summary}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? cursor.onKeyDown : undefined}
      onBlur={cursor.clear}
      onPointerMove={
        interactive
          ? (e) => {
              const r = e.currentTarget.getBoundingClientRect()
              const px = ((e.clientX - r.left) / r.width) * 100
              let best = 0
              for (let i = 1; i < n; i++) if (Math.abs(X(i) - px) < Math.abs(X(best) - px)) best = i
              cursor.setAt(best)
            }
          : undefined
      }
      onPointerLeave={cursor.clear}
      data-mini-chart="spark"
      data-live={live && !loop ? (inView ? 'on' : 'paused') : undefined}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id={`s${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity={0.22} />
            <stop offset="1" stopColor={color} stopOpacity={0} />
          </linearGradient>
          <clipPath id={`c${gid}`}>
            <rect x={-4} y={-20} width={108} height={140} style={{ transformBox: 'view-box', transformOrigin: '0 0', animation: revealAnim, animationPlayState: play }} />
          </clipPath>
        </defs>
        {zero && lo < 0 && hi > 0 && <line x1={0} x2={100} y1={Y(0)} y2={Y(0)} stroke={C.lineStrong} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />}
        {area && (
          <g className={live && !loop ? 'gl-live-breathe' : undefined}>
            {runs
              .filter((r) => r.length > 1)
              .map((r) => (
                <path key={`a${r[0]}`} d={`${path(r)} L${X(r[r.length - 1]).toFixed(2)},100 L${X(r[0]).toFixed(2)},100 Z`} fill={`url(#s${gid})`} style={{ animation: fadeAnim, animationPlayState: play }} />
              ))}
          </g>
        )}
        <g clipPath={`url(#c${gid})`} data-spark-line style={loop ? { animation: fadeAnim, animationPlayState: play } : undefined}>
          {runs.map((r) =>
            r.length > 1 ? <path key={`l${r[0]}`} d={path(r)} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /> : null,
          )}
        </g>
        {at !== null && <line x1={X(at)} x2={X(at)} y1={0} y2={100} stroke={C.lineHover} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
      </svg>
      {/* Lone points (a reading between two unknowns) and the dots are HTML, so they stay round however the box stretches. */}
      {runs
        .filter((r) => r.length === 1)
        .map((r) => (
          <i key={`p${r[0]}`} aria-hidden className="pointer-events-none absolute -m-[2px] block size-[4px] rounded-full" style={{ left: `${X(r[0])}%`, top: `${Y(data[r[0]]!)}%`, background: color, animation: fadeAnim, animationPlayState: play }} />
        ))}
      {dot && (
        <span aria-hidden className="pointer-events-none absolute" style={{ left: `${X(lastIdx)}%`, top: `${Y(data[lastIdx]!)}%` }}>
          <i className="absolute -m-[3px] block size-[6px] rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}`, animation: loop ? fadeAnim : `gl-fade .3s ${delay + 1.1}s ease both`, animationPlayState: play }} />
          {live && !loop && <i className="gl-live-ring absolute -m-[3px] block size-[6px] rounded-full border" style={{ borderColor: color, animationDelay: `${delay + 1.4}s`, animationPlayState: play }} />}
        </span>
      )}
      {at !== null && (
        <>
          {atV !== null && <i aria-hidden className="pointer-events-none absolute -m-[3.5px] block size-[7px] rounded-full border-[1.5px] border-bg" style={{ left: `${X(at)}%`, top: `${Y(atV)}%`, background: color }} />}
          <span
            aria-live="polite"
            className="pointer-events-none absolute bottom-full z-10 mb-1 rounded-input border border-line-strong bg-surface-deep px-2 py-1 font-mono text-[11px] whitespace-nowrap text-ink shadow-[0_8px_24px_rgba(6,5,13,.6)]"
            style={{ left: `${X(at)}%`, transform: `translateX(${X(at) > 70 ? '-100%' : X(at) < 30 ? '0' : '-50%'})` }}
          >
            {labels?.[at] && <span className="mr-2 text-faint">{labels[at]}</span>}
            <b className={`font-medium tabular-nums ${atV === null ? 'text-faint' : ''}`}>{fmtOr(atV)}</b>
          </span>
        </>
      )}
    </div>
  )
}
