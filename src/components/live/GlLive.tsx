/* Gully Live UI in React (gully-ops sites/_shared/gully-live-ui 1.0.4, vendored byte-identical in src/vendor/gully-live-ui).
   LiveStat = <gl-stat> (count-up value, sparkline that draws in, skeleton or "No data yet", never a fake 0);
   LiveChart = <gl-chart> (area / line / bars on canvas, crosshair tooltip, a table for screen readers, never an empty
   frame: series, then the honest `empty` line).
   The elements load lazily in the browser (the modules define classes that extend HTMLElement, so nothing imports them
   at module load: node tests and the prerender stay clean). Everything is set as ATTRIBUTES before the element is
   defined, and `data` only after customElements.whenDefined, so an early property never shadows the element's own
   accessor. Tokens: .gl-live in ./gl-labs.css (the Gully Labs navy kit row). */
import { useEffect, useLayoutEffect, useRef, type CSSProperties, type Ref } from 'react'
import './gl-labs.css'

type GlElementProps = { ref?: Ref<HTMLElement>; className?: string; style?: CSSProperties; 'data-live-stat'?: string; 'data-live-chart'?: string }
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'gl-stat': GlElementProps
      'gl-chart': GlElementProps
    }
  }
}

let loading: Promise<unknown> | null = null
function loadLiveUi() {
  if (typeof window === 'undefined' || typeof customElements === 'undefined') return
  if (!loading) loading = Promise.all([import('../../vendor/gully-live-ui/gl-stat.js'), import('../../vendor/gully-live-ui/gl-chart.js')]).catch(() => (loading = null))
}

const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect

function setAttrs(el: HTMLElement, attrs: Record<string, string | boolean | null | undefined>) {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) el.removeAttribute(k)
    else el.setAttribute(k, v === true ? '' : v)
  }
}

/** `pct` is a signed change (+3.4%); `percent` a plain share or rate (0.3%, 92.3%), Live UI 1.0.4. */
export type LiveUnit = 'usd' | 'pct' | 'percent' | 'plain' | 'GB' | 'ms' | ''

/** A stat. `bare` puts it inside one of our tiles (no border, no label: the tile has them). `value` null = loading
    (skeleton) when `loading`, else "No data yet". */
export function LiveStat({ value, label = '', unit = '', spark, live = false, loading: isLoading = false, full = false, bare = false, small = false, className = '' }: { value: number | null; label?: string; unit?: LiveUnit; spark?: number[]; live?: boolean; loading?: boolean; full?: boolean; bare?: boolean; small?: boolean; className?: string }) {
  const ref = useRef<HTMLElement>(null)
  const sparkKey = spark && spark.length >= 2 ? spark.map((v) => (Number.isFinite(v) ? v : 0)).join(',') : ''
  useEffect(loadLiveUi, [])
  useIso(() => {
    const el = ref.current
    if (!el) return
    setAttrs(el, { label, unit: unit || null, live, loading: isLoading, full, spark: sparkKey || null, value: value === null || !Number.isFinite(value) ? '' : String(value) })
  }, [label, unit, live, isLoading, full, sparkKey, value])
  return <gl-stat ref={ref} className={`gl-live${bare ? ' gl-bare' : ''}${small ? ' gl-sm' : ''}${className ? ` ${className}` : ''}`} data-live-stat="" />
}

export type LivePoint = [number, number]

/** A chart over time: points are [ms, value]. With fewer than two points it prints `empty` (one honest line), and while
    `loading` a shimmer. */
export function LiveChart({ series, kind = 'area', title = '', unit = '', height = 170, empty, loading: isLoading = false, label, className = '' }: { series: LivePoint[]; kind?: 'area' | 'line' | 'bars'; title?: string; unit?: LiveUnit; height?: number; empty: string; loading?: boolean; label?: string; className?: string }) {
  const ref = useRef<HTMLElement>(null)
  const key = series.map(([t, v]) => `${t}:${v}`).join(',')
  useEffect(loadLiveUi, [])
  useIso(() => {
    const el = ref.current
    if (el) setAttrs(el, { kind, title, unit: unit || null, height: String(height), empty, 'aria-label': label ?? null })
  }, [kind, title, unit, height, empty, label])
  useEffect(() => {
    const el = ref.current
    if (!el || typeof customElements === 'undefined') return
    let on = true
    const pts = series.filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
    void customElements.whenDefined('gl-chart').then(() => {
      if (on) (el as HTMLElement & { data: unknown }).data = { series: pts, loading: isLoading && pts.length < 2 }
    })
    return () => {
      on = false
    }
    // `key` stands for `series`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, isLoading])
  return <gl-chart ref={ref} className={`gl-live${className ? ` ${className}` : ''}`} data-live-chart="" style={{ minHeight: Math.min(height, 96) }} />
}
