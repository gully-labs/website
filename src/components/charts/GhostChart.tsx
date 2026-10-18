import { useId, type ReactNode } from 'react'
import { C } from './chartTheme'

/* The kit's one empty state for a chart (design audit X5): a ghosted series that draws in and then
   breathes, with a scan line passing over it and a label in the middle ("Your payments will draw
   here"). It holds the chart's box at the chart's own height, so a page does not jump when data
   arrives. The curves are a fixed shape, never sample numbers: no values, axes or tooltips, and a
   badge says so. Under prefers-reduced-motion it follows the site's gentle policy (index.css): the
   draw-in becomes a plain fade, and the scan and breathing loops hold still.
   Promoted from the app's GhostCurves (src/pages/developers/charts.tsx). */

/* Two curves on a 440 x 96 box: the main series and a quieter second one. */
export const GHOST_A = 'M0 70 C 40 62, 70 40, 110 46 S 180 22, 220 30 S 300 12, 340 20 S 400 8, 440 14'
export const GHOST_B = 'M0 84 C 50 80, 90 66, 130 70 S 200 54, 250 58 S 330 44, 370 48 S 420 40, 440 42'
/* Column heights (percent of the box) for the bar variant: a gentle rise, like a curve. */
const GHOST_BARS = [28, 36, 31, 44, 40, 52, 47, 58, 54, 66, 61, 72]
const EASE = 'cubic-bezier(.2,.8,.2,1)'

export type GhostVariant = 'line' | 'bars' | 'ring'

export interface GhostChartProps {
  /** What will appear here, in the visitor's words: "Your payments will draw here". */
  label: string
  /** Box height, the same as the real chart's. Omit to fill a positioned parent (absolute inset-0). */
  height?: number | string
  /** The shape of the chart it stands in for. */
  variant?: GhostVariant
  /** Series colours (main, second); kit colours only. */
  colors?: readonly [string, string]
  /** The small badge above the label; `false` hides it. */
  badge?: string | false
  /** A dashed frame round the box (default on); off when the parent already draws a card. */
  framed?: boolean
  /** Test hook; the app's e2e checks look for "ghost-chart". */
  testId?: string
  className?: string
  /** Extra content under the label (a call to action, a hint). */
  children?: ReactNode
}

export function GhostChart({ label, height, variant = 'line', colors = [C.gold, C.blue], badge = 'SHAPE ONLY · NOT DATA', framed = true, testId = 'ghost-chart', className = '', children }: GhostChartProps) {
  const id = useId().replace(/:/g, '')
  const fill = height === undefined
  return (
    <div
      className={`${fill ? 'absolute inset-0' : 'relative w-full'} overflow-hidden rounded-card ${framed ? 'border border-dashed border-line-strong' : ''} ${className}`}
      style={fill ? undefined : { height }}
      data-testid={testId}
      data-ghost=""
    >
      {variant === 'line' && (
        <svg viewBox="0 0 440 96" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-[70%] w-full" aria-hidden style={{ animation: 'gl-breathe 4s 1.8s ease-in-out infinite' }}>
          <defs>
            <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={colors[0]} stopOpacity={0.16} />
              <stop offset="1" stopColor={colors[0]} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={`${GHOST_A} L 440 96 L 0 96 Z`} fill={`url(#g${id})`} style={{ animation: 'gl-fade 1.2s .3s ease both' }} />
          <path d={GHOST_A} pathLength={1} fill="none" stroke={colors[0]} strokeOpacity={0.5} strokeWidth={2} vectorEffect="non-scaling-stroke" style={{ strokeDasharray: 1, animation: `gl-draw 1.6s ${EASE} both` }} />
          <path d={GHOST_B} pathLength={1} fill="none" stroke={colors[1]} strokeOpacity={0.4} strokeWidth={1.5} vectorEffect="non-scaling-stroke" style={{ strokeDasharray: 1, animation: `gl-draw 1.6s .25s ${EASE} both` }} />
        </svg>
      )}
      {variant === 'bars' && (
        <div aria-hidden className="absolute inset-x-[4%] bottom-0 flex h-[70%] items-end gap-[3%]">
          {GHOST_BARS.map((h, i) => (
            <span
              key={i}
              className="flex-1 origin-bottom rounded-t-bar border border-b-0 border-dashed"
              style={{ height: `${h}%`, borderColor: colors[0], background: `${colors[0]}1a`, opacity: 0.55, animation: `gl-grow .7s ${(i * 0.04).toFixed(2)}s ${EASE} both` }}
            />
          ))}
        </div>
      )}
      {variant === 'ring' && (
        <div aria-hidden className="absolute inset-0 grid place-items-center">
          <svg viewBox="0 0 100 100" className="aspect-square h-[84%]" style={{ animation: 'gl-breathe 4s 1.8s ease-in-out infinite' }}>
            <circle cx="50" cy="50" r="40" fill="none" stroke={colors[0]} strokeOpacity={0.45} strokeWidth={10} strokeDasharray="4 3" pathLength={100} style={{ animation: 'gl-fade 1s ease both' }} />
          </svg>
        </div>
      )}
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(217,181,99,.07),transparent)]" style={{ animation: 'gl-scan 4.5s linear infinite' }} />
      <div className="relative flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        {badge && <span className="rounded-full border border-line-strong bg-surface px-2 py-[2px] font-mono text-[11px] tracking-[1px] text-faint">{badge}</span>}
        <b className="text-[15px] font-semibold text-ink">{label}</b>
        {children}
      </div>
    </div>
  )
}

/**
 * The same ghost, sized to fill a chart's box: what EChart (and LiveChart) show when a series has
 * fewer than 2 real points or every value is unknown. Use it in your own chart boxes for the same
 * pattern: `{tooFewPoints(values) ? <ChartEmpty label="Your traffic will draw here" /> : <Chart />}`
 * inside a positioned box, or pass `height` to give it its own.
 */
export function ChartEmpty({ label = 'Not enough data for a chart yet', ...rest }: Partial<GhostChartProps>) {
  return <GhostChart testId="chart-empty" label={label} {...rest} />
}

/** A ghosted mini trend, for a KPI or table row with nothing to draw yet (no label, no frame). */
export function GhostSpark({ color = C.gold, w = 80, h = 28 }: { color?: string; w?: number | string; h?: number | string }) {
  return (
    <svg viewBox="0 0 440 96" width={w} height={h} preserveAspectRatio="none" className="block shrink-0 overflow-visible" aria-hidden data-ghost="">
      <path d={GHOST_A} fill="none" stroke={color} strokeOpacity={0.45} strokeWidth={2} strokeDasharray="6 6" vectorEffect="non-scaling-stroke" style={{ animation: 'gl-skeleton 2.6s ease-in-out infinite' }} />
    </svg>
  )
}
