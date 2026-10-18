import { useEffect, useRef, useState } from 'react'
import type { EChartsCoreOption, EChartsType } from 'echarts/core'
import { loadECharts, motionFor, useReducedMotion, type ChartEvent } from './chart-utils'
import { ChartError, ChartSkeleton, type SkeletonVariant } from './ChartSkeleton'

/* The one wrapper every chart on the site goes through. ECharts loads on demand (its own chunk),
   so the page paints first and the chart's box holds its size with a skeleton meanwhile. The
   chart follows its box (ResizeObserver), takes the brand theme (echarts-setup.ts), and is disposed
   on unmount. Data refreshes merge into the live instance, so bars, lines and arcs animate to their
   new values instead of redrawing. The first draw waits until the box scrolls into view, so the
   entry animation (bars growing, lines drawing, rings sweeping) plays where it can be seen rather
   than off-screen while the page loads. Under prefers-reduced-motion the animation is not switched off
   but made gentle (motionFor: ~150 ms, linear, no stagger), so a change still reads as a change.
   If ECharts itself cannot load, or the caller says its data failed (`error`), the box shows
   "Couldn't load" with a retry button in place of the chart. */

export interface EChartProps {
  /** A plain ECharts option (loosely typed here: the charts build them as object literals). */
  option: object
  /** Box height; the skeleton takes the same size so nothing shifts when the chart arrives. */
  height: number | string
  /** Accessible summary of what the chart shows; the page's tables are the full alternative. */
  label: string
  /** SVG is crisper for small charts; canvas for many points. */
  renderer?: 'svg' | 'canvas'
  /** Components replaced (not merged) on update; series are matched by id so they animate. */
  replaceMerge?: string[]
  onEvents?: Record<string, (p: ChartEvent) => void>
  /** Arrow keys (and Home/End) step the tooltip through this many points of series `seriesIndex`. */
  steps?: { count: number; seriesIndex?: number }
  /** Receives the live instance (null once disposed), for charts driven from outside. */
  onChart?: (c: EChartsType | null) => void
  /** Shape of the loading placeholder. */
  skeleton?: SkeletonVariant
  /** The chart's data could not be read: shows the message (or a default) with `onRetry`. */
  error?: boolean | string
  onRetry?: () => void
  className?: string
  children?: React.ReactNode
}

export function EChart({ option, height, label, renderer = 'svg', replaceMerge = ['series'], onEvents, steps, onChart, skeleton = 'bars', error, onRetry, className = '', children }: EChartProps) {
  const el = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  const chart = useRef<EChartsType | null>(null)
  const [lib, setLib] = useState<Awaited<ReturnType<typeof loadECharts>> | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const reduced = useReducedMotion()
  const events = useRef(onEvents)
  const notify = useRef(onChart)
  const step = useRef(-1)
  useEffect(() => {
    events.current = onEvents
    notify.current = onChart
  })

  useEffect(() => {
    let alive = true
    loadECharts().then(
      (m) => alive && setLib(m),
      () => alive && setFailed(true),
    )
    return () => {
      alive = false
    }
  }, [attempt])

  // Draw once the box is (mostly) on screen; after that it stays drawn and live.
  useEffect(() => {
    const node = box.current
    if (seen || !node) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { threshold: 0.2 })
    io.observe(node)
    return () => io.disconnect()
  }, [seen])

  // One instance per mount (and per renderer), resized with its box, disposed on the way out.
  useEffect(() => {
    const node = el.current
    if (!lib || !node) return
    const c = lib.echarts.init(node, 'gully', { renderer })
    chart.current = c
    const names = ['click', 'mouseover', 'mouseout', 'globalout', 'highlight', 'downplay', 'updateAxisPointer']
    for (const n of names) c.on(n, (p: ChartEvent) => events.current?.[n]?.(p))
    // ResizeObserver fires once as soon as it observes; resizing then would finish the entry animation
    // instantly. Resize only when the box really changed size.
    let size = `${node.clientWidth}x${node.clientHeight}`
    const ro = new ResizeObserver(() => {
      const next = `${node.clientWidth}x${node.clientHeight}`
      if (next === size) return
      size = next
      // A box collapsed to 0 (a hidden tab, a closing panel) has nothing to draw: resizing ECharts to 0
      // leaves zero-size canvases that throw on the next paint.
      if (!node.clientWidth || !node.clientHeight) return
      try {
        c.resize()
      } catch {
        /* the chart is being torn down */
      }
    })
    ro.observe(node)
    notify.current?.(c)
    return () => {
      ro.disconnect()
      notify.current?.(null)
      // ECharts can throw while disposing a chart whose canvas has collapsed to 0×0 (drawImage on a
      // zero-size layer, e.g. the Holder Map's live-trail layer). The instance is gone either way; a throw
      // here must never reach React's error boundary and take the whole page down.
      try {
        c.dispose()
      } catch {
        /* already torn down */
      }
      chart.current = null
    }
  }, [lib, renderer])

  // Every new option merges into the live chart: an update animates from the old values.
  useEffect(() => {
    const c = chart.current
    if (!c || !seen) return
    c.setOption(motionFor(option as EChartsCoreOption, reduced), { replaceMerge, lazyUpdate: false })
    // replaceMerge is a stable literal per call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [option, reduced, lib, renderer, seen])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const c = chart.current
    if (!c || !steps || !steps.count) return
    const seriesIndex = steps.seriesIndex ?? 0
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      const cur = step.current
      const last = steps.count - 1
      step.current = e.key === 'Home' ? 0 : e.key === 'End' ? last : e.key === 'ArrowRight' ? (cur < 0 ? 0 : Math.min(last, cur + 1)) : cur < 0 ? last : Math.max(0, cur - 1)
      c.dispatchAction({ type: 'downplay', seriesIndex })
      c.dispatchAction({ type: 'highlight', seriesIndex, dataIndex: step.current })
      c.dispatchAction({ type: 'showTip', seriesIndex, dataIndex: step.current })
    } else if (e.key === 'Escape') {
      step.current = -1
      c.dispatchAction({ type: 'downplay', seriesIndex })
      c.dispatchAction({ type: 'hideTip' })
    }
  }

  const broken = failed || !!error
  return (
    <div ref={box} className={`relative w-full ${className}`} style={{ height }}>
      <div
        ref={el}
        className={`absolute inset-0 rounded-input outline-offset-4 transition-opacity duration-300 ${lib && seen && !error ? 'opacity-100' : 'opacity-0'}`}
        role="img"
        data-chart=""
        aria-label={label}
        aria-hidden={error ? true : undefined}
        tabIndex={steps && !error ? 0 : undefined}
        onKeyDown={steps ? onKeyDown : undefined}
        onBlur={() => {
          step.current = -1
          const c = chart.current
          if (!c) return
          c.dispatchAction({ type: 'hideTip' })
          if (steps) c.dispatchAction({ type: 'downplay', seriesIndex: steps.seriesIndex ?? 0 })
        }}
      />
      {(!lib || !seen) && !broken && <ChartSkeleton variant={skeleton} />}
      {broken && (
        <ChartError
          message={typeof error === 'string' ? error : failed ? "Couldn't load the chart." : undefined}
          onRetry={
            failed
              ? () => {
                  setFailed(false)
                  setAttempt((a) => a + 1)
                }
              : onRetry
          }
        />
      )}
      {!broken && children}
    </div>
  )
}
