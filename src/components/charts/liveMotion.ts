/* Live mode for the kit's line, area and bar charts: the pure parts (no React, no DOM), so
   scripts/test-chart-kit.mjs runs them in Node. EChart.tsx, MiniSpark and MiniBars use them.
   Usage for pages: gully-session-tools/CHART-KIT-LIVE.md. */

import { isReal, realCount } from './chartData'

type Loose = Record<string, unknown>

/** Length of the glide to new data (ms); 150 ms linear under reduced motion (chart-utils GENTLE_MOTION). */
export const LIVE_TWEEN_MS = 700

/** `a` to `b` at progress `k` (0..1). Only values known on both sides glide; an unknown (null) appears or
    disappears at once, never passing through zero. Lengths that differ jump to `b`. */
export function lerpSeries(a: readonly (number | null)[], b: readonly (number | null)[], k: number): readonly (number | null)[] {
  if (a.length !== b.length || k >= 1) return b
  return b.map((x, i) => (x === null || a[i] === null || a[i] === undefined ? x : a[i]! + (x - a[i]!) * k))
}
/** Cubic ease-out normally; linear under reduced motion. */
export const tweenEase = (k: number, reduced: boolean) => (reduced ? k : 1 - (1 - k) ** 3)
export const tweenMs = (reduced: boolean, ms = LIVE_TWEEN_MS) => (reduced ? 150 : ms)

const asList = (s: unknown): Loose[] => (Array.isArray(s) ? (s as Loose[]) : s ? [s as Loose] : [])

/**
 * Fills in the live defaults a chart did not set itself: lines and areas glide to new data
 * (animationDurationUpdate), bars grow in with a gentle stagger (capped at 480 ms) and glide on update.
 * Anything the chart set is kept.
 */
export function liveDefaults<T extends object>(option: T): T {
  const o = option as Loose
  const series = asList(o.series)
  if (!series.length) return option
  const out = series.map((s) => {
    if (!s || (s.type !== 'line' && s.type !== 'bar')) return s
    const t: Loose = { ...s }
    if (t.animationDurationUpdate === undefined) t.animationDurationUpdate = LIVE_TWEEN_MS
    if (t.animationEasingUpdate === undefined) t.animationEasingUpdate = 'cubicOut'
    if (s.type === 'bar') {
      if (t.animationDelay === undefined) t.animationDelay = (i: number) => Math.min(i * 25, 480)
      if (t.animationDelayUpdate === undefined) t.animationDelayUpdate = 0
    }
    return t
  })
  return { ...o, series: Array.isArray(o.series) ? out : out[0] } as T
}

/** Does the option draw a line with an area under it (the fill that breathes)? */
export function hasLiveArea(option: object | null | undefined): boolean {
  return asList((option as Loose | null)?.series).some((s) => s?.type === 'line' && !!s.areaStyle && s.live !== false)
}

export interface LiveMarkerSpec {
  /** Index into option.series. */
  seriesIndex: number
  /** The newest real point, in the series' own coordinates (a category index, a time, a number). */
  point: [number | string, number]
  /** Explicit colour if the series set one; EChart.tsx otherwise asks the drawn chart. */
  color?: string
}

const valueOf = (d: unknown): number => {
  const v = d && typeof d === 'object' && !Array.isArray(d) ? (d as Loose).value : d
  return Number(Array.isArray(v) ? v[v.length - 1] : v)
}

/**
 * Where the "now" marker goes: the newest real point of each plain cartesian line (not stacked, not
 * horizontal; `live: false` on a series opts out), at most `max`. Nothing for charts it cannot place.
 */
export function liveMarkers(option: object | null | undefined, max = 3): LiveMarkerSpec[] {
  const o = (option ?? {}) as Loose
  const x = (Array.isArray(o.xAxis) ? o.xAxis[0] : o.xAxis) as Loose | undefined
  const y = (Array.isArray(o.yAxis) ? o.yAxis[0] : o.yAxis) as Loose | undefined
  if (!x || !y || y.type === 'category' || o.polar || o.radar) return []
  const out: LiveMarkerSpec[] = []
  asList(o.series).forEach((s, seriesIndex) => {
    if (out.length >= max || !s || s.type !== 'line' || s.live === false || s.stack || !Array.isArray(s.data)) return
    if (realCount(s.data) < 2) return
    for (let i = s.data.length - 1; i >= 0; i--) {
      const d = s.data[i] as unknown
      if (!isReal(d)) continue
      const inner = d && typeof d === 'object' && !Array.isArray(d) ? (d as Loose).value : d
      const px = Array.isArray(inner) && inner.length > 1 ? (inner[0] as number | string) : i
      const lineStyle = s.lineStyle as Loose | undefined
      const color = typeof s.color === 'string' ? s.color : typeof lineStyle?.color === 'string' ? lineStyle.color : undefined
      out.push({ seriesIndex, point: [px, valueOf(d)], color })
      break
    }
  })
  return out
}
