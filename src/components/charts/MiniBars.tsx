import { realCount } from './chartData'
import { C } from './chartTheme'
import { ChartEmpty } from './GhostChart'
import { useCursor, useInView, useSeen, useTween } from './useMiniChart'

/* The kit's small bar chart (design audit G32), for cards and rows where a full ECharts chart is too
   heavy. Two shapes:
     columns  vertical bars on a baseline (a few days of counts); signed values hang below a zero rule
     rows     a labelled list with a bar per row and the value at the end (rankings, AskCards bars)
   Bars grow in with a small stagger when the chart scrolls into view and glide to new values on a
   refresh. Pointer and keyboard (arrows, Home, End, Escape) highlight a bar and show its value. An
   unknown value (null) is a dashed empty stub marked "not read", never a zero bar; with nothing real to
   draw (columns: under 2 real values; rows: none) it is the ghosted ChartEmpty. Reduced motion: the
   grow is a fade (index.css policy). Replaces the AskCards MiniBars and the TopMovers MoveBar. */

export interface MiniBar {
  label: string
  /** null: unknown (not read), drawn as a dashed stub, never as zero. */
  value: number | null
  /** Bar colour; defaults to the chart's colour (or `negColor` for a negative value). */
  color?: string
}

export interface MiniBarsProps {
  bars: readonly MiniBar[]
  /** Accessible name and (for rows) the caption. */
  label: string
  orientation?: 'columns' | 'rows'
  fmt?: (v: number) => string
  color?: string
  /** Colour for negative values (default dim). */
  negColor?: string
  /** Column chart height (rows size to their content). */
  height?: number | string
  /** Shown with the ghost when there is nothing to draw. */
  emptyLabel?: string
  /** Live mode (default on): columns grow in with a gentle stagger, glide to new values, and the newest
      column breathes (slowly and subtly under reduced motion). Pauses off-screen. */
  live?: boolean
  /** Show the label as a caption above rows (default on for rows). */
  caption?: boolean
  className?: string
}

export function MiniBars({ bars, label, orientation = 'columns', fmt = (v) => v.toLocaleString('en-US'), color = C.gold, negColor = C.dim, height = 56, emptyLabel = 'Not enough data for a chart yet', caption = orientation === 'rows', live = true, className = '' }: MiniBarsProps) {
  const values = useTween(bars.map((b) => b.value))
  const [ref, seen] = useSeen<HTMLDivElement>()
  const [, inView] = useInView(ref)
  const cursor = useCursor(bars.length)
  const liveAttr = live ? (inView ? 'on' : 'paused') : undefined
  const fmtOr = (v: number | null) => (v === null || !Number.isFinite(v) ? 'not read' : fmt(v))
  const real = realCount(bars.map((b) => b.value))
  const play = seen ? 'running' : 'paused'
  const at = cursor.at
  const tint = (b: MiniBar, v: number | null) => b.color ?? (v !== null && v < 0 ? negColor : color)

  if (real < (orientation === 'columns' ? 2 : 1)) {
    return (
      <div className={`relative w-full ${className}`} style={{ height: orientation === 'columns' ? height : 96 }}>
        <ChartEmpty label={emptyLabel} variant="bars" badge={false} />
      </div>
    )
  }

  const keys = {
    tabIndex: 0,
    onKeyDown: cursor.onKeyDown,
    onBlur: cursor.clear,
    onPointerLeave: cursor.clear,
  }

  if (orientation === 'rows') {
    const max = Math.max(...values.map((v) => Math.abs(v ?? 0)), 1e-9)
    return (
      <figure ref={ref} className={`m-0 flex flex-col gap-1 ${className}`} data-mini-chart="rows" data-live={liveAttr}>
        {caption && <figcaption className="font-mono text-[11px] text-faint">{label}</figcaption>}
        <ul className="m-0 flex list-none flex-col gap-[6px] rounded-input p-0 outline-none focus-visible:ring-2 focus-visible:ring-gold" aria-label={`${label}. Arrow keys read each row.`} {...keys}>
          {bars.map((b, i) => {
            const v = values[i]
            const w = v === null ? 0 : Math.max(2, (Math.abs(v) / max) * 100)
            return (
              <li
                key={`${b.label}-${i}`}
                onPointerEnter={() => cursor.setAt(i)}
                className={`grid grid-cols-[minmax(56px,30%)_1fr_auto] items-center gap-2 rounded-btn text-[12px] ${at === i ? 'bg-surface-hover' : ''}`}
                aria-current={at === i || undefined}
              >
                <span className="truncate text-ink-2">{b.label}</span>
                <span className="h-[8px] overflow-hidden rounded-full bg-surface-deep" aria-hidden>
                  {v === null ? (
                    <span className="block h-full w-full rounded-full border border-dashed border-line-strong" />
                  ) : (
                    <span className="block h-full origin-left rounded-full" style={{ width: `${w}%`, background: tint(b, v), transition: 'width .7s cubic-bezier(.2,.8,.2,1)', animation: `gl-grow-x .7s cubic-bezier(.2,.7,.2,1) ${Math.min(i * 60, 480)}ms both`, animationPlayState: play }} />
                  )}
                </span>
                <span className={`font-mono tabular-nums ${v === null ? 'text-faint' : at === i ? 'text-gold' : 'text-ink'}`} aria-live={at === i ? 'polite' : undefined}>
                  {fmtOr(bars[i].value)}
                </span>
              </li>
            )
          })}
        </ul>
      </figure>
    )
  }

  const known = values.filter((v): v is number => v !== null)
  const lo = Math.min(0, ...known)
  const hi = Math.max(0, ...known)
  const span = hi - lo || 1
  const base = (hi / span) * 100 // the zero line, as a percent from the top
  return (
    <div ref={ref} className={`relative w-full ${className}`} style={{ height }} data-mini-chart="columns" data-live={liveAttr}>
      <ul className="absolute inset-0 m-0 flex list-none items-stretch gap-[3px] rounded-input p-0 outline-none focus-visible:ring-2 focus-visible:ring-gold" aria-label={`${label}. Arrow keys read each bar.`} {...keys}>
        {bars.map((b, i) => {
          const v = values[i]
          const h = v === null ? 0 : Math.max(1.5, (Math.abs(v) / span) * 100)
          return (
            <li key={`${b.label}-${i}`} className={`relative flex-1 ${live && i === bars.length - 1 && v !== null ? 'gl-live-breathe' : ''}`} onPointerEnter={() => cursor.setAt(i)} aria-current={at === i || undefined}>
              <span className="sr-only">
                {b.label}: {fmtOr(bars[i].value)}
              </span>
              {v === null ? (
                <span aria-hidden className="absolute inset-x-[10%] rounded-t-bar border border-b-0 border-dashed border-line-strong" style={{ bottom: `${100 - base}%`, height: '22%' }} />
              ) : (
                <span
                  aria-hidden
                  className={`absolute inset-x-[10%] ${v < 0 ? 'origin-top rounded-b-bar' : 'origin-bottom rounded-t-bar'}`}
                  style={{
                    ...(v < 0 ? { top: `${base}%` } : { bottom: `${100 - base}%` }),
                    height: `${h}%`,
                    background: tint(b, v),
                    opacity: at === null || at === i ? 1 : 0.45,
                    transition: 'height .7s cubic-bezier(.2,.8,.2,1), opacity .2s',
                    animation: `gl-grow .7s ${Math.min(i * 30, 480)}ms cubic-bezier(.2,.8,.2,1) both`,
                    animationPlayState: play,
                  }}
                />
              )}
            </li>
          )
        })}
      </ul>
      {lo < 0 && <span aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line-strong" style={{ top: `${base}%` }} />}
      {at !== null && (
        <span
          aria-live="polite"
          className="pointer-events-none absolute bottom-full z-10 mb-1 rounded-input border border-line-strong bg-surface-deep px-2 py-1 font-mono text-[11px] whitespace-nowrap text-ink shadow-[0_8px_24px_rgba(13,20,28,.6)]"
          style={{ left: `${((at + 0.5) / bars.length) * 100}%`, transform: `translateX(${at / bars.length > 0.7 ? '-100%' : at / bars.length < 0.3 ? '0' : '-50%'})` }}
        >
          <span className="mr-2 text-faint">{bars[at].label}</span>
          <b className={`font-medium tabular-nums ${bars[at].value === null ? 'text-faint' : ''}`}>{fmtOr(bars[at].value)}</b>
        </span>
      )}
    </div>
  )
}
