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
/** True under prefers-reduced-motion: reduce, and follows the setting live. */
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
