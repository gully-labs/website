/* The one place ECharts is imported. Only the charts and components the site draws are
   registered, and this module is loaded on demand by EChart.tsx, so it never sits in the entry
   chunk. Apache ECharts, Apache-2.0. */
import * as echarts from 'echarts/core'
import { BarChart, EffectScatterChart, LineChart, LinesChart, PieChart, ScatterChart, TreemapChart } from 'echarts/charts'
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
  LinesChart,
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
  axisLine: { lineStyle: { color: '#2a3542' } },
  axisTick: { show: false },
  axisLabel: { color: '#5f6a78', fontFamily: MONO, fontSize: 11 },
  splitLine: { lineStyle: { color: '#1c2531', width: 1 } },
  nameTextStyle: { color: '#8a94a1', fontFamily: MONO, fontSize: 11 },
}

/* Brand tokens (src/index.css) as an ECharts theme: recessive grid, mono labels, a dark tooltip with
   a hairline border, a quiet crosshair, and the site's motion defaults (entries ease out over ~0.9 s,
   updates glide over 0.6 s with cubicOut). Data colours are set per chart; chartPresets.ts holds the
   per-type entry animations. Under reduced motion EChart.tsx swaps all timings for GENTLE_MOTION. */
echarts.registerTheme('gully', {
  backgroundColor: 'transparent',
  color: ['#d9b563', '#5aa9e6', '#26ab94', '#c98bdb', '#f2704a', '#9bc53d'],
  textStyle: { fontFamily: MONO, color: '#aeb5be' },
  animationDuration: 900,
  animationEasing: 'cubicOut',
  animationDurationUpdate: 600,
  animationEasingUpdate: 'cubicOut',
  categoryAxis: { ...axis, splitLine: { show: false } },
  valueAxis: { ...axis, axisLine: { show: false } },
  logAxis: { ...axis, axisLine: { show: false } },
  timeAxis: { ...axis, splitLine: { show: false } },
  legend: { textStyle: { color: '#aeb5be', fontFamily: MONO, fontSize: 11 }, itemWidth: 12, itemHeight: 8, icon: 'roundRect' },
  axisPointer: {
    lineStyle: { color: '#3a4656', width: 1, type: 'dashed' },
    crossStyle: { color: '#3a4656', width: 1, type: 'dashed' },
    shadowStyle: { color: 'rgba(174,181,190,.06)' },
    label: { backgroundColor: '#1f2935', borderColor: '#2a3542', borderWidth: 1, color: '#f4f2ec', fontFamily: MONO, fontSize: 11, padding: [3, 6], borderRadius: 3 },
  },
  tooltip: {
    backgroundColor: 'rgba(17,25,35,.96)',
    borderColor: '#2a3542',
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: '#f4f2ec', fontFamily: MONO, fontSize: 12 },
    transitionDuration: 0.2,
    extraCssText: 'border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.45);font-variant-numeric:tabular-nums;',
  },
  dataZoom: {
    backgroundColor: 'transparent',
    borderColor: '#1f2935',
    fillerColor: 'rgba(217,181,99,.10)',
    handleStyle: { color: '#d9b563', borderColor: '#d9b563' },
    moveHandleStyle: { color: '#2a3542' },
    dataBackground: { lineStyle: { color: '#3a4656' }, areaStyle: { color: 'rgba(174,181,190,.08)' } },
    selectedDataBackground: { lineStyle: { color: '#d9b563' }, areaStyle: { color: 'rgba(217,181,99,.12)' } },
    textStyle: { color: '#8a94a1', fontFamily: MONO, fontSize: 11 },
    brushSelect: false,
  },
})

export { echarts }

