import { useEffect, useRef, useState } from 'react'
import type { EChartsCoreOption, EChartsType } from 'echarts/core'
import { loadECharts, useReducedMotion, type ChartEvent } from './chart-utils'

/* The one wrapper every chart on the site goes through. ECharts loads on demand (its own chunk),
   so the page paints first and the chart's box holds its size with a skeleton meanwhile. The
   chart follows its box (ResizeObserver), takes the brand theme, is disposed on unmount, and
   draws without animation under prefers-reduced-motion. Data refreshes merge into the live
   instance, so bars, lines and arcs animate to their new values instead of redrawing. */

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
  /** Arrow keys step the tooltip through this many points of series `seriesIndex`. */
  steps?: { count: number; seriesIndex?: number }
  /** Receives the live instance (null once disposed), for charts driven from outside. */
  onChart?: (c: EChartsType | null) => void
  className?: string
  children?: React.ReactNode
}

export function EChart({ option, height, label, renderer = 'svg', replaceMerge = ['series'], onEvents, steps, onChart, className = '', children }: EChartProps) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<EChartsType | null>(null)
  const [lib, setLib] = useState<Awaited<ReturnType<typeof loadECharts>> | null>(null)
  const [failed, setFailed] = useState(false)
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
  }, [])

  // One instance per mount (and per renderer), resized with its box, disposed on the way out.
  useEffect(() => {
    const node = el.current
    if (!lib || !node) return
    const c = lib.echarts.init(node, 'gully', { renderer })
    chart.current = c
    const names = ['click', 'mouseover', 'mouseout', 'globalout', 'highlight', 'downplay', 'updateAxisPointer']
    for (const n of names) c.on(n, (p: ChartEvent) => events.current?.[n]?.(p))
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(node)
    notify.current?.(c)
    return () => {
      ro.disconnect()
      notify.current?.(null)
      c.dispose()
      chart.current = null
    }
  }, [lib, renderer])

  // Every new option merges into the live chart: an update animates from the old values.
  useEffect(() => {
    const c = chart.current
    if (!c) return
    c.setOption({ ...(option as EChartsCoreOption), animation: reduced ? false : ((option as { animation?: boolean }).animation ?? true) }, { replaceMerge, lazyUpdate: false })
    // replaceMerge is a stable literal per call site
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [option, reduced, lib, renderer])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const c = chart.current
    if (!c || !steps || !steps.count) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const cur = step.current
      step.current = e.key === 'ArrowRight' ? (cur < 0 ? 0 : Math.min(steps.count - 1, cur + 1)) : cur < 0 ? steps.count - 1 : Math.max(0, cur - 1)
      c.dispatchAction({ type: 'showTip', seriesIndex: steps.seriesIndex ?? 0, dataIndex: step.current })
    } else if (e.key === 'Escape') {
      step.current = -1
      c.dispatchAction({ type: 'hideTip' })
    }
  }

  return (
    <div className={`relative w-full ${className}`} style={{ height }}>
      <div
        ref={el}
        className="absolute inset-0 outline-offset-4 transition-opacity duration-300"
        role="img"
        aria-label={label}
        tabIndex={steps ? 0 : undefined}
        onKeyDown={steps ? onKeyDown : undefined}
        onBlur={() => {
          step.current = -1
          chart.current?.dispatchAction({ type: 'hideTip' })
        }}
      />
      {!lib && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex items-end gap-[6%] overflow-hidden rounded-[6px] px-[4%] pb-3">
          {failed ? (
            <span className="m-auto font-mono text-[12px] text-faint">The chart could not load.</span>
          ) : (
            [42, 64, 38, 80, 56, 70, 48].map((h, i) => <span key={i} className="flex-1 rounded-t-[3px] bg-line opacity-60" style={{ height: `${h}%`, animation: `gl-blink 1.6s ${i * 0.1}s ease-in-out infinite` }} />)
          )}
        </div>
      )}
      {children}
    </div>
  )
}
