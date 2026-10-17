import { esc } from './chart-utils'

/* Shared looks for every ECharts chart on the site, so a chart added anywhere (tracker, landing,
   product pages) animates, highlights and explains itself the same way. Each preset returns plain
   option fragments to spread into a series (or, for sparklinePreset, a whole option); anything a
   chart sets after the spread wins. Entry animations per type:
     bars     grow from the baseline with a small stagger (capped, so long series still land fast)
     lines    draw left to right
     areas    draw left to right with their line; the fill fades down from the line
     rings    sweep round from 12 o'clock
     heatmap  tiles grow in from their place; on refresh they resize and recolour in place
   Updates glide (animationDurationUpdate, cubicOut). Hovering a mark blurs the others. Under
   reduced motion EChart.tsx replaces every timing here with GENTLE_MOTION (chart-utils). */

/** Brand colours (src/index.css) for chart code, which cannot read CSS variables in canvas mode. */
export const C = {
  gold: '#e8c060',
  goldHover: '#f4d98c',
  ink: '#eef0f2',
  ink2: '#cfd5dc',
  muted: '#a6b0bd',
  dim: '#8a96a6',
  faint: '#7f8b9c',
  axis: '#5c6878',
  grid: '#1a2029',
  line: '#1d232c',
  lineStrong: '#2c3540',
  lineHover: '#3a4452',
  surface: '#10141a',
  surfaceDeep: '#0d1116',
  error: '#ff8a7a',
} as const

/** Categorical series colours, in order (the theme's palette). */
export const PALETTE = ['#e8c060', '#5aa9e6', '#1f9e89', '#c98bdb', '#e4572e', '#9bc53d', '#f4d98c', '#7f8b9c'] as const

/** `#rrggbb` plus an alpha 0–1, as `#rrggbbaa`. */
export const alpha = (hex: string, a: number) => `${hex.slice(0, 7)}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')}`

/* ---------- tooltips ---------- */

export interface TipRow {
  name: string
  value: string
  /** Series colour: drawn as a dot before the name. */
  color?: string
  /** Colour for the value itself (e.g. up/down). */
  valueColor?: string
}

/**
 * The one tooltip layout: a faint title, then rows of `● name   value` with mono, tabular numbers,
 * then an optional faint note. Every string is escaped here, so API text is safe to pass.
 */
export function tipHtml({ title, rows = [], note }: { title?: string; rows?: TipRow[]; note?: string }): string {
  const head = title ? `<div style="color:${C.faint};font-size:11px;margin-bottom:4px">${esc(title)}</div>` : ''
  const body = rows.length
    ? `<div style="display:grid;grid-template-columns:auto auto;column-gap:14px;row-gap:2px;align-items:baseline">${rows
        .map(
          (r) =>
            `<span style="color:${C.muted};white-space:nowrap">${r.color ? `<i style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:${r.color}"></i>` : ''}${esc(r.name)}</span><b style="font-weight:500;text-align:right;white-space:nowrap;color:${r.valueColor ?? C.ink}">${esc(r.value)}</b>`,
        )
        .join('')}</div>`
    : ''
  const foot = note ? `<div style="color:${C.faint};font-size:11px;margin-top:4px;max-width:240px;white-space:normal">${esc(note)}</div>` : ''
  return head + body + foot
}

// ECharts' formatter params are loosely typed; each chart reads only what it set.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fmt = (p: any) => string

/** Axis tooltip with a crosshair: `cross` adds value labels on both axes, `line` a vertical rule, `shadow` a band. */
export function axisTooltip(formatter?: Fmt, pointer: 'cross' | 'line' | 'shadow' = 'line') {
  return {
    trigger: 'axis',
    confine: true,
    axisPointer: { type: pointer, snap: true, label: { show: pointer === 'cross' } },
    ...(formatter && { formatter }),
  }
}

/** Item tooltip (one mark at a time). */
export function itemTooltip(formatter?: Fmt) {
  return { trigger: 'item', confine: true, ...(formatter && { formatter }) }
}

/* ---------- series presets ---------- */

const update = { animationDurationUpdate: 600, animationEasingUpdate: 'cubicOut', animationDelayUpdate: 0 }

export interface BarsOpts {
  /** ms between neighbouring bars on entry (default 30; the whole stagger is capped at 480 ms). */
  stagger?: number
  /** Corner radius; the default rounds the end the bar grows towards. */
  radius?: number | number[]
  horizontal?: boolean
  /** What a hover blurs: the other bars ('self', default) or the other series ('series'). */
  focus?: 'self' | 'series'
}
/** Bars: grow from the baseline with a small stagger; the hovered bar stays bright, the rest blur. */
export function barsPreset({ stagger = 30, radius, horizontal = false, focus = 'self' }: BarsOpts = {}) {
  return {
    type: 'bar' as const,
    animationDuration: 700,
    animationEasing: 'cubicOut',
    animationDelay: (i: number) => Math.min(i * stagger, 480),
    ...update,
    itemStyle: { borderRadius: radius ?? (horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]) },
    emphasis: { focus, itemStyle: { shadowBlur: 10, shadowColor: 'rgba(232,192,96,.30)' } },
    blur: { itemStyle: { opacity: 0.35 }, label: { opacity: 0.45 } },
  }
}

export interface LineOpts {
  color?: string
  width?: number
  /** 0 for straight segments. */
  smooth?: number
  dashed?: boolean
}
/** Line: draws left to right; on hover the other lines fade back. */
export function linePreset({ color, width = 2, smooth = 0.2, dashed = false }: LineOpts = {}) {
  return {
    type: 'line' as const,
    ...(color && { color }),
    smooth,
    smoothMonotone: 'x',
    showSymbol: false,
    symbol: 'circle',
    symbolSize: 8,
    lineStyle: { width, ...(dashed && { type: [5, 4] }) },
    animationDuration: 1100,
    animationEasing: 'cubicOut',
    ...update,
    emphasis: { focus: 'series', lineStyle: { width: width + 0.5 } },
    blur: { lineStyle: { opacity: 0.25 }, areaStyle: { opacity: 0.04 } },
  }
}

/** Area: a line that draws left to right, with a fill fading down from it (`fill` is the top alpha). */
export function areaPreset({ fill = 0.32, ...o }: LineOpts & { fill?: number } = {}) {
  const color = o.color ?? C.gold
  return {
    ...linePreset({ ...o, color }),
    areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: alpha(color, fill) }, { offset: 1, color: alpha(color, 0) }] } },
  }
}

/** Ring (donut): sweeps round from 12 o'clock; slices re-share in place on refresh; hover lifts one. */
export function ringPreset({ radius = ['64%', '92%'], padAngle = 0.6 }: { radius?: [string, string]; padAngle?: number } = {}) {
  return {
    type: 'pie' as const,
    radius,
    center: ['50%', '50%'],
    startAngle: 90,
    animationType: 'expansion',
    animationTypeUpdate: 'transition',
    animationDuration: 1000,
    animationEasing: 'cubicOut',
    ...update,
    avoidLabelOverlap: false,
    label: { show: false },
    labelLine: { show: false },
    padAngle,
    itemStyle: { borderRadius: 2 },
    emphasis: { scale: true, scaleSize: 4, focus: 'self' },
    blur: { itemStyle: { opacity: 0.35 } },
  }
}

/** Heatmap tiles (a treemap of tiles): grow in, then resize and recolour in place on refresh. */
export function heatmapPreset() {
  return {
    type: 'treemap' as const,
    roam: false,
    nodeClick: false,
    breadcrumb: { show: false },
    animationDuration: 900,
    animationEasing: 'cubicOut',
    animationDurationUpdate: 700,
    animationEasingUpdate: 'cubicInOut',
    itemStyle: { borderColor: C.surface, borderWidth: 2, gapWidth: 2, borderRadius: 4 },
    emphasis: { itemStyle: { borderColor: C.gold, borderWidth: 2 }, label: { show: true } },
  }
}

/** A pulsing dot on the newest point of a live series (a still dot under reduced motion). */
export function livePoint(point: [number | string, number] | null, color: string = C.gold, id = 'live') {
  return {
    id,
    type: 'effectScatter' as const,
    data: point ? [point] : [],
    symbolSize: 7,
    rippleEffect: { brushType: 'stroke', scale: 3.2, period: 2.6, number: 2 },
    itemStyle: { color, shadowBlur: 6, shadowColor: color },
    silent: true,
    tooltip: { show: false },
    z: 5,
    animationDuration: 300,
    animationDelay: 900,
  }
}

/**
 * A whole option for a sparkline: no axes or grid, the line draws in, a live dot pulses on the last
 * point, and hovering shows the value (`fmt`) under a thin crosshair.
 */
export function sparklinePreset({ data, color = C.gold, area = true, pulse = true, fmt = (v: number) => String(v), labels }: { data: number[]; color?: string; area?: boolean; pulse?: boolean; fmt?: (v: number) => string; labels?: string[] }) {
  const last = data.length - 1
  const cats = data.map((_, i) => labels?.[i] ?? String(i))
  return {
    grid: { left: 2, right: 6, top: 6, bottom: 2 },
    xAxis: { type: 'category', show: false, boundaryGap: false, data: cats },
    yAxis: { type: 'value', show: false, scale: true },
    tooltip: axisTooltip((ps: { dataIndex: number }[]) => {
      const i = ps[0]?.dataIndex ?? -1
      return i >= 0 ? tipHtml({ title: labels?.[i], rows: [{ name: 'value', value: fmt(data[i]), color }] }) : ''
    }),
    series: [
      { id: 'spark', ...(area ? areaPreset({ color, width: 1.75, fill: 0.22 }) : linePreset({ color, width: 1.75 })), data },
      ...(pulse && last >= 0 ? [livePoint([cats[last], data[last]], color)] : []),
    ],
  }
}
