/* The kit's chart colours and the ECharts theme built from them. Pure data with no imports, so the
   theme can be checked in Node (scripts/test-chart-kit.mjs) as well as registered in the browser
   (echarts-setup.ts). Every colour here is a token in src/index.css (`--color-*`, including the
   `--color-chart-*` series colours), at full strength or as an alpha of one.

   Why so many keys: ECharts 6 ships its own palette (visual/tokens.js: #b7b9be, #6578ba, #e0e4f2,
   #6d6e73 and friends) as the default for every component. Anything the theme leaves unset falls back
   to it, so the axis pointer, the tooltip's crosshair, legends, data zoom, visual maps, brushes, the
   toolbox and the series' own label and border colours are all set here, even the ones the site does
   not draw today. A chart built by hand (a plain `option` object passed to EChart) inherits all of it. */

/** Brand colours (src/index.css) for chart code, which cannot read CSS variables in canvas mode. */
const GULLY = {
  bg: '#06050d',
  gold: '#00d2ff',
  goldHover: '#66e4ff',
  ink: '#ffffff',
  ink2: '#d6d8e6',
  muted: '#a3a8c3',
  dim: '#8f94b0',
  faint: '#9398b5',
  axis: '#6b7090',
  grid: '#121024',
  line: '#181630',
  lineStrong: '#242140',
  lineHover: '#34305a',
  surface: '#0b0a16',
  surfaceDeep: '#0a0914',
  error: '#ff8a7a',
  green: '#3ddc97',
  /* Series colours (--color-chart-*): up is teal, down is orange across the tracker. */
  blue: '#248bff',
  teal: '#20a0c4',
  violet: '#9578e8',
  orange: '#ff6b81',
  lime: '#c02cff',
}

/* holdermaps.xyz draws in the HolderMaps kit colours (the same values as src/holdermaps/hm.css). The series hues after
   gold stay: they are data colours, not brand. */
const HOLDERMAPS: Partial<typeof GULLY> = {
  bg: '#0a0a0a',
  gold: '#ffd52e',
  goldHover: '#ffe03a',
  muted: '#b3b3b3',
  dim: '#9a9a9a',
  faint: '#a0a0a0',
  grid: '#1c1c1c',
  line: '#262626',
  lineStrong: '#333333',
  lineHover: '#4a4a4a',
  surface: '#161616',
  surfaceDeep: '#111111',
}
const onHolderMaps = typeof location !== 'undefined' && /^(www\.)?holdermaps\.xyz$/.test(location.hostname)

export const C: Readonly<typeof GULLY> = { ...GULLY, ...(onHolderMaps ? HOLDERMAPS : {}) }

/** Categorical series colours, in order (the theme's palette). */
export const PALETTE = [C.gold, C.blue, C.teal, C.violet, C.orange, C.lime, C.goldHover, C.faint] as const

/** `#rrggbb` plus an alpha 0–1, as `#rrggbbaa`. */
export const alpha = (hex: string, a: number) => `${hex.slice(0, 7)}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')}`

export const MONO = "'IBM Plex Mono', monospace"

const label = { color: C.ink2, fontFamily: MONO, fontSize: 11, textBorderColor: C.bg, textBorderWidth: 0 }
const axis = {
  axisLine: { lineStyle: { color: C.lineStrong } },
  axisTick: { show: false, lineStyle: { color: C.lineStrong } },
  minorTick: { lineStyle: { color: C.line } },
  axisLabel: { color: C.axis, fontFamily: MONO, fontSize: 11 },
  splitLine: { lineStyle: { color: C.grid, width: 1 } },
  minorSplitLine: { lineStyle: { color: C.grid } },
  splitArea: { areaStyle: { color: [alpha(C.surface, 0.4), alpha(C.surface, 0)] } },
  breakArea: { itemStyle: { color: C.surfaceDeep, borderColor: C.lineStrong } },
  nameTextStyle: { color: C.faint, fontFamily: MONO, fontSize: 11 },
}
const pointerLabel = { backgroundColor: C.line, borderColor: C.lineStrong, borderWidth: 1, color: C.ink, fontFamily: MONO, fontSize: 11, padding: [3, 6], borderRadius: 3, shadowBlur: 0, shadowColor: alpha(C.bg, 0) }
const pointer = {
  lineStyle: { color: C.lineHover, width: 1, type: 'dashed' },
  crossStyle: { color: C.lineHover, width: 1, type: 'dashed' },
  shadowStyle: { color: alpha(C.muted, 0.06) },
  label: pointerLabel,
  handle: { color: C.gold, shadowColor: alpha(C.bg, 0.6) },
}
/* Border and emphasis colours for the series types the site registers (echarts-setup.ts). */
const seriesBase = {
  itemStyle: { borderColor: C.surface },
  label,
  emphasis: { itemStyle: { borderColor: C.gold }, label: { color: C.ink } },
  select: { itemStyle: { borderColor: C.gold } },
  markLine: { lineStyle: { color: C.lineHover }, label: { ...label, color: C.faint } },
  markArea: { itemStyle: { color: alpha(C.gold, 0.06) }, label: { ...label, color: C.faint } },
  markPoint: { label: { ...label, color: C.bg } },
}

/** The ECharts theme every chart is drawn with (registered once as 'gully' in echarts-setup.ts). */
export const GULLY_THEME = {
  backgroundColor: 'transparent',
  color: [...PALETTE],
  // The fallback ramp for a visual map with no colours of its own (low to high).
  gradientColor: [C.lineStrong, C.gold],
  textStyle: { fontFamily: MONO, color: C.muted },
  animationDuration: 900,
  animationEasing: 'cubicOut',
  animationDurationUpdate: 600,
  animationEasingUpdate: 'cubicOut',
  title: { textStyle: { color: C.ink, fontFamily: MONO }, subtextStyle: { color: C.faint, fontFamily: MONO }, borderColor: C.line },
  grid: { borderColor: C.line },
  categoryAxis: { ...axis, splitLine: { show: false, lineStyle: axis.splitLine.lineStyle } },
  valueAxis: { ...axis, axisLine: { show: false, lineStyle: axis.axisLine.lineStyle } },
  logAxis: { ...axis, axisLine: { show: false, lineStyle: axis.axisLine.lineStyle } },
  timeAxis: { ...axis, splitLine: { show: false, lineStyle: axis.splitLine.lineStyle } },
  legend: {
    textStyle: { color: C.muted, fontFamily: MONO, fontSize: 11 },
    itemWidth: 12,
    itemHeight: 8,
    icon: 'roundRect',
    borderColor: C.line,
    // A switched-off series: dim, still legible on the page.
    inactiveColor: C.axis,
    inactiveBorderColor: C.axis,
    lineStyle: { inactiveColor: C.axis },
    pageIconColor: C.gold,
    pageIconInactiveColor: C.lineStrong,
    pageTextStyle: { color: C.faint, fontFamily: MONO },
    selectorLabel: { color: C.muted, borderColor: C.lineStrong, backgroundColor: C.surface },
    emphasis: { selectorLabel: { color: C.ink, borderColor: C.gold, backgroundColor: C.surface } },
  },
  axisPointer: pointer,
  tooltip: {
    backgroundColor: alpha(C.surfaceDeep, 0.96),
    borderColor: C.lineStrong,
    defaultBorderColor: C.lineStrong,
    borderWidth: 1,
    padding: [8, 10],
    shadowColor: alpha(C.bg, 0.6),
    textStyle: { color: C.ink, fontFamily: MONO, fontSize: 12 },
    transitionDuration: 0.2,
    extraCssText: `border-radius:8px;box-shadow:0 8px 24px ${alpha(C.bg, 0.6)};font-variant-numeric:tabular-nums;`,
    axisPointer: { lineStyle: pointer.lineStyle, crossStyle: pointer.crossStyle, shadowStyle: pointer.shadowStyle, label: pointerLabel },
  },
  dataZoom: {
    backgroundColor: 'transparent',
    borderColor: C.line,
    fillerColor: alpha(C.gold, 0.1),
    handleStyle: { color: C.gold, borderColor: C.gold },
    moveHandleStyle: { color: C.lineStrong, opacity: 0.8 },
    dataBackground: { lineStyle: { color: C.lineHover }, areaStyle: { color: alpha(C.muted, 0.08) } },
    selectedDataBackground: { lineStyle: { color: C.gold }, areaStyle: { color: alpha(C.gold, 0.12) } },
    textStyle: { color: C.faint, fontFamily: MONO, fontSize: 11 },
    brushSelect: false,
    brushStyle: { color: alpha(C.gold, 0.12) },
    emphasis: { handleStyle: { borderColor: C.goldHover }, moveHandleStyle: { color: C.lineHover } },
  },
  visualMap: {
    // Low to high: recessive slate to gold (continuous and piecewise heat ranges).
    color: [C.gold, C.lineStrong],
    inRange: { color: [C.lineStrong, C.gold] },
    outOfRange: { color: [C.line] },
    contentColor: C.gold,
    inactiveColor: C.lineStrong,
    backgroundColor: 'transparent',
    borderColor: C.line,
    textStyle: { color: C.muted, fontFamily: MONO, fontSize: 11 },
    handleStyle: { borderColor: C.bg },
    indicatorStyle: { borderColor: C.bg, shadowColor: alpha(C.bg, 0.6) },
  },
  brush: {
    brushStyle: { color: alpha(C.gold, 0.1), borderColor: alpha(C.gold, 0.5) },
    defaultOutOfBrushColor: C.lineStrong,
  },
  toolbox: {
    borderColor: C.line,
    iconStyle: { borderColor: C.muted },
    emphasis: { iconStyle: { borderColor: C.gold, textFill: C.gold } },
    feature: { dataZoom: { brushStyle: { color: alpha(C.gold, 0.12) } }, dataView: { textareaColor: C.surfaceDeep, textareaBorderColor: C.lineStrong, textColor: C.ink, backgroundColor: C.surface, buttonColor: C.gold, buttonTextColor: C.bg } },
  },
  timeline: {
    lineStyle: { color: C.lineStrong },
    itemStyle: { color: C.lineHover, borderColor: C.lineHover },
    checkpointStyle: { color: C.gold, borderColor: C.goldHover },
    controlStyle: { color: C.gold, borderColor: C.gold },
    progress: { lineStyle: { color: C.gold }, itemStyle: { color: C.gold } },
    label: { color: C.faint },
    emphasis: { itemStyle: { color: C.goldHover }, controlStyle: { color: C.goldHover, borderColor: C.goldHover }, label: { color: C.ink } },
  },
  // A filled dot by default: ECharts' 'emptyCircle' is filled white, which is not a kit colour.
  line: { ...seriesBase, symbol: 'circle' },
  bar: { ...seriesBase, itemStyle: { borderColor: C.surface, borderWidth: 0 }, backgroundStyle: { color: alpha(C.muted, 0.06) } },
  scatter: seriesBase,
  effectScatter: seriesBase,
  pie: { ...seriesBase, itemStyle: { borderColor: C.surface }, labelLine: { lineStyle: { color: C.lineHover } } },
  lines: { ...seriesBase, lineStyle: { color: C.gold } },
  treemap: {
    ...seriesBase,
    itemStyle: { borderColor: C.surface, color: C.lineStrong },
    label: { ...label, color: C.ink },
    upperLabel: { ...label, color: C.ink },
    breadcrumb: { itemStyle: { color: C.surface, borderColor: C.lineStrong, textStyle: { color: C.muted } }, emphasis: { itemStyle: { color: C.surfaceDeep } } },
  },
} as const
