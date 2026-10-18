import { useMemo, type ReactNode } from 'react'
import { C, alpha, ringPreset, sparklinePreset } from '../../components/charts/chartPresets'
import { EChart } from '../../components/charts/EChart'

/* The Overview's small charts on the shared ECharts kit (src/components/charts; ECharts loads lazily in its
   own chunk, the box keeps its size with a skeleton meanwhile, and reduced motion is handled by the kit):
   a sparkline with a pulsing live dot, two concentric progress rings, a thin meter, and the ghosted
   placeholders for a chart whose data does not exist yet. They draw only the numbers they are given: no
   smoothing, no sample data. The ghosts carry no values, axes or tooltips and are labelled as shape only. */

export interface BarSeries {
  id: string
  name: string
  color: string
}

export interface BarColumn {
  /** Short label for the axis, long one for the tooltip. */
  label: string
  long: string
  /** Requests per series id. */
  values: Record<string, number>
  total: number
  /** 429 answers in the bucket (already inside `total`); undefined when the server does not say. */
  limited?: number
}

const fmt = (n: number) => n.toLocaleString('en-US')

/** A small trend line with a live dot on the newest point. Fewer than two values draws nothing. */
export function Spark({ values, color, w = 80, h = 28, label }: { values: number[]; color: string; w?: number; h?: number; label?: string }) {
  const option = useMemo(() => sparklinePreset({ data: values, color, area: true, pulse: true, fmt }), [values, color])
  if (values.length < 2) return <span aria-hidden className="inline-block" style={{ width: w, height: h }} />
  return (
    <span className="block shrink-0" style={{ width: w }}>
      <EChart option={option} height={h} skeleton="line" label={label ?? `Trend: ${values.map(fmt).join(', ')}`} />
    </span>
  )
}

/** Two concentric progress rings (0–100 each); they sweep in from zero and glide on refresh. A null ring is
    drawn as its empty track only (unknown, never 0). */
export function DoubleRing({ outer, inner, size = 132, children, label }: { outer: number | null; inner: number | null; size?: number; children: ReactNode; label: string }) {
  const option = useMemo(() => {
    const ring = (id: string, v: number | null, color: string, radius: [string, string]) => {
      const pct = v === null ? 0 : Math.max(0, Math.min(100, v))
      return {
        id,
        ...ringPreset({ radius, padAngle: 0 }),
        emphasis: { disabled: true },
        silent: true,
        itemStyle: { borderRadius: 6 },
        data: [
          { name: 'used', value: pct, itemStyle: { color: v === null ? C.grid : color } },
          { name: 'left', value: 100 - pct, itemStyle: { color: C.grid } },
        ],
      }
    }
    return { tooltip: { show: false }, series: [ring('outer', outer, C.gold, ['74%', '94%']), ring('inner', inner, '#5aa9e6', ['50%', '66%'])] }
  }, [outer, inner])
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <EChart option={option} height={size} skeleton="ring" label={label}>
        <span className="pointer-events-none absolute inset-0 grid place-items-center text-center">{children}</span>
      </EChart>
    </div>
  )
}

/** A thin horizontal meter that fills from zero and glides to new values. */
export function Meter({ value, max, label, tone }: { value: number; max: number; label: string; tone?: string }) {
  const pct = Math.min(100, (value / Math.max(1, max)) * 100)
  const color = tone ?? (pct >= 100 ? C.error : C.gold)
  const option = useMemo(
    () => ({
      grid: { left: 0, right: 0, top: 0, bottom: 0 },
      xAxis: { type: 'value', show: false, max: 100 },
      yAxis: { type: 'category', show: false, data: [''] },
      tooltip: { show: false },
      series: [{ id: 'm', type: 'bar', data: [pct], barWidth: '100%', showBackground: true, backgroundStyle: { color: C.grid, borderRadius: 4 }, itemStyle: { color, borderRadius: 4 }, animationDuration: 600, animationEasing: 'cubicOut', animationDurationUpdate: 600, silent: true }],
    }),
    [pct, color],
  )
  return (
    <span className="block h-2 overflow-hidden rounded-[4px]" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <EChart option={option} height={8} skeleton="line" label={label} />
    </span>
  )
}

/* ------------------------------------------------------------- ghosts --- */

/* Placeholders for a chart whose data does not exist yet (a new workspace): ghosted curves that draw in
   and breathe, clearly labelled, never read as data. Their shape is fixed (not sample numbers). */

const GHOST_A = [70, 64, 48, 46, 34, 30, 22, 20, 12, 14]
const GHOST_B = [84, 80, 68, 70, 58, 58, 48, 48, 42, 42]
const ghostLine = (id: string, data: number[], color: string, { dashed = false, fill = 0 } = {}) => ({
  id,
  type: 'line',
  data: data.map((v) => 100 - v),
  smooth: 0.45,
  symbol: 'none',
  silent: true,
  lineStyle: { color: alpha(color, 0.5), width: dashed ? 1.5 : 2, type: dashed ? [6, 6] : 'solid' },
  areaStyle: fill ? { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: alpha(color, fill) }, { offset: 1, color: alpha(color, 0) }] } } : undefined,
  animationDuration: 1600,
  animationEasing: 'cubicOut',
})
const ghostAxes = (top: number) => ({
  grid: { left: 0, right: 0, top, bottom: 0 },
  xAxis: { type: 'category', show: false, boundaryGap: false, data: GHOST_A.map((_, i) => i) },
  yAxis: { type: 'value', show: false, min: 0, max: 100 },
  tooltip: { show: false },
})

/** A ghosted mini trend for a KPI with nothing to draw yet. */
export function GhostSpark({ color, w = 80, h = 28 }: { color: string; w?: number; h?: number }) {
  const option = useMemo(() => ({ ...ghostAxes(2), series: [ghostLine('g', GHOST_A, color, { dashed: true })] }), [color])
  return (
    <span className="block shrink-0" style={{ width: w, animation: 'gl-skeleton 2.6s ease-in-out infinite' }} data-ghost>
      <EChart option={option} height={h} skeleton="line" label="No data yet: shape only" onChart={(c) => c?.getDom().querySelector('svg')?.setAttribute('data-ghost', '')} />
    </span>
  )
}

/** A ghosted chart area: two curves drawing in, a scan line, and the label in the middle. */
export function GhostCurves({ height, title, children, colors = ['#d9b563', '#5aa9e6'] }: { height: number; title: string; children?: ReactNode; colors?: [string, string] }) {
  const [c0, c1] = colors
  const option = useMemo(() => ({ ...ghostAxes(Math.round(height * 0.3)), series: [ghostLine('a', GHOST_A, c0, { fill: 0.16 }), ghostLine('b', GHOST_B, c1)] }), [height, c0, c1])
  return (
    <div className="relative overflow-hidden rounded-[12px] border border-dashed border-line-strong" style={{ height }} data-testid="ghost-chart">
      <div className="absolute inset-0" aria-hidden>
        <EChart option={option} height={height} skeleton="line" label="Shape only, not your data" />
      </div>
      <span aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(217,181,99,.07),transparent)]" style={{ animation: 'gl-scan 4.5s linear infinite' }} />
      <div className="relative flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <span className="rounded-full border border-line-strong bg-surface px-2 py-[2px] font-mono text-[11px] tracking-[1px] text-faint">SHAPE ONLY · NOT YOUR DATA</span>
        <b className="text-[15px] font-semibold text-ink">{title}</b>
        {children}
      </div>
    </div>
  )
}
