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
import { GULLY_THEME } from './chartTheme'

/** The registered theme's name (EChart.tsx passes it to echarts.init). */
export const THEME_NAME = 'gully'

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

/* The kit as an ECharts theme (chartTheme.ts): recessive grid, mono labels, a dark tooltip with a
   hairline border, a quiet crosshair, kit colours for every component ECharts would otherwise paint
   with its own defaults, and the site's motion defaults (entries ease out over ~0.9 s, updates glide
   over 0.6 s with cubicOut). Registered once, when this module first loads; EChart.tsx inits every
   chart with it, so hand-built options inherit the kit too. chartPresets.ts holds the per-type entry
   animations. Under reduced motion EChart.tsx swaps all timings for GENTLE_MOTION. */
echarts.registerTheme(THEME_NAME, GULLY_THEME)

export { echarts }

