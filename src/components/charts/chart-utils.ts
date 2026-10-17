import { useSyncExternalStore } from 'react'

type Lib = typeof import('./echarts-setup')
let loader: Promise<Lib> | null = null
/** Start loading ECharts (and wait for the brand fonts so canvas text is right the first time). */
export function loadECharts(): Promise<Lib> {
  loader ??= Promise.all([import('./echarts-setup'), document.fonts?.ready.catch(() => undefined)]).then(([m]) => m)
  loader.catch(() => (loader = null))
  return loader
}

const motionQuery = '(prefers-reduced-motion: reduce)'
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(motionQuery)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}
/** True under prefers-reduced-motion: reduce, and follows the setting live. This means "gentle", not
    "none" (see the policy in src/index.css): keep short fades and value changes, drop movement. */
export function useReducedMotion() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(motionQuery).matches,
    () => false,
  )
}

/** Escape text read from an API before it goes into a tooltip's HTML. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

// ECharts' event params are loosely typed; the charts read only what they set.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChartEvent = any

/** Animation keys ECharts reads, at the top level and on every series. */
const ANIM_KEYS = ['animationDuration', 'animationDelay', 'animationEasing', 'animationDurationUpdate', 'animationDelayUpdate', 'animationEasingUpdate', 'animationThreshold'] as const

/** The site's reduced-motion animation for ECharts: short (150 ms), linear, never staggered, so a
    new value still reads as a change without anything sweeping or growing across the box. */
export const GENTLE_MOTION = {
  animation: true,
  animationDuration: 150,
  animationEasing: 'linear',
  animationDelay: 0,
  animationDurationUpdate: 150,
  animationEasingUpdate: 'linear',
  animationDelayUpdate: 0,
} as const

type Loose = Record<string, unknown>
const strip = (o: Loose) => {
  const out: Loose = { ...o }
  for (const k of ANIM_KEYS) delete out[k]
  return out
}

/**
 * The option as it should be drawn under the visitor's motion setting. Normal: unchanged. Reduced:
 * every per-series (and per-component) duration, delay and easing is replaced by GENTLE_MOTION, and
 * loops such as the effectScatter ripple become a still dot. `animation: false` set by a chart is kept.
 */
export function motionFor<T extends object>(option: T, reduced: boolean): T {
  if (!reduced) return option
  const o = option as Loose
  if (o.animation === false) return option
  const series = Array.isArray(o.series) ? o.series : o.series ? [o.series] : undefined
  return {
    ...strip(o),
    ...GENTLE_MOTION,
    ...(series && {
      series: (series as Loose[]).map((s) => {
        const t = { ...strip(s) }
        if (s.type === 'effectScatter') t.type = 'scatter' // a still dot, no ripple loop
        for (const m of ['markLine', 'markArea', 'markPoint'] as const) if (s[m]) t[m] = strip(s[m] as Loose)
        return t
      }),
    }),
  } as T
}
