/* The one place ECharts is imported. Only the charts and components the site draws are
   registered, and this module is loaded on demand by EChart.tsx, so it never sits in the entry
   chunk. Apache ECharts, Apache-2.0. */
import * as echarts from 'echarts/core'
import { BarChart, EffectScatterChart, LineChart, PieChart, ScatterChart, TreemapChart } from 'echarts/charts'
import {
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapPiecewiseComponent,
} from 'echarts/components'
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers'

echarts.use([
  BarChart,
  EffectScatterChart,
  LineChart,
  PieChart,
  ScatterChart,
  TreemapChart,
  DataZoomInsideComponent,
  DataZoomSliderComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapPiecewiseComponent,
  CanvasRenderer,
  SVGRenderer,
])

const MONO = "'IBM Plex Mono', monospace"
const axis = {
  axisLine: { lineStyle: { color: '#2c3540' } },
  axisTick: { show: false },
  axisLabel: { color: '#5c6878', fontFamily: MONO, fontSize: 11 },
  splitLine: { lineStyle: { color: '#1a2029', width: 1 } },
  nameTextStyle: { color: '#6c7888', fontFamily: MONO, fontSize: 10 },
}

/* Brand tokens (src/index.css) as an ECharts theme: recessive grid, mono labels, a dark tooltip with
   a hairline border, a quiet crosshair, and the site's motion defaults (entries ease out over ~0.9 s,
   updates glide over 0.6 s with cubicOut). Data colours are set per chart; chartPresets.ts holds the
   per-type entry animations. Under reduced motion EChart.tsx swaps all timings for GENTLE_MOTION. */
echarts.registerTheme('gully', {
  backgroundColor: 'transparent',
  color: ['#e8c060', '#5aa9e6', '#1f9e89', '#c98bdb', '#e4572e', '#9bc53d'],
  textStyle: { fontFamily: MONO, color: '#a6b0bd' },
  animationDuration: 900,
  animationEasing: 'cubicOut',
  animationDurationUpdate: 600,
  animationEasingUpdate: 'cubicOut',
  categoryAxis: { ...axis, splitLine: { show: false } },
  valueAxis: { ...axis, axisLine: { show: false } },
  logAxis: { ...axis, axisLine: { show: false } },
  timeAxis: { ...axis, splitLine: { show: false } },
  legend: { textStyle: { color: '#a6b0bd', fontFamily: MONO, fontSize: 11 }, itemWidth: 12, itemHeight: 8, icon: 'roundRect' },
  axisPointer: {
    lineStyle: { color: '#3a4452', width: 1, type: 'dashed' },
    crossStyle: { color: '#3a4452', width: 1, type: 'dashed' },
    shadowStyle: { color: 'rgba(166,176,189,.06)' },
    label: { backgroundColor: '#1d232c', borderColor: '#2c3540', borderWidth: 1, color: '#eef0f2', fontFamily: MONO, fontSize: 10, padding: [3, 6], borderRadius: 3 },
  },
  tooltip: {
    backgroundColor: 'rgba(13,17,22,.96)',
    borderColor: '#2c3540',
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: '#eef0f2', fontFamily: MONO, fontSize: 12 },
    transitionDuration: 0.2,
    extraCssText: 'border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.45);font-variant-numeric:tabular-nums;',
  },
  dataZoom: {
    backgroundColor: 'transparent',
    borderColor: '#1d232c',
    fillerColor: 'rgba(232,192,96,.10)',
    handleStyle: { color: '#e8c060', borderColor: '#e8c060' },
    moveHandleStyle: { color: '#2c3540' },
    dataBackground: { lineStyle: { color: '#3a4452' }, areaStyle: { color: 'rgba(166,176,189,.08)' } },
    selectedDataBackground: { lineStyle: { color: '#e8c060' }, areaStyle: { color: 'rgba(232,192,96,.12)' } },
    textStyle: { color: '#6c7888', fontFamily: MONO, fontSize: 10 },
    brushSelect: false,
  },
})

export { echarts }

