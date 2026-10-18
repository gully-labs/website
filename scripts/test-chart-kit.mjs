// The shared chart kit (src/components/charts): when a chart shows the ghosted empty state, and that no
// ECharts default colour leaks past the kit's theme and presets. No browser, no server: the kit's .ts
// modules run under Node's type stripping, and ECharts renders server-side (SSR, SVG) for the leak check.
// Run: npm run test:chart-kit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { registerHooks } from 'node:module'

// The app imports its own modules without an extension ('./chartTheme'); Vite adds it, Node needs help.
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (!/^\.\.?\//.test(spec) || /\.[cm]?[jt]sx?$/.test(spec)) throw e
      return next(`${spec}.ts`, ctx)
    }
  },
})

const kit = '../src/components/charts/'
const { optionIsEmpty, tooFewPoints, isReal, ghostVariantOf } = await import(`${kit}chartData.ts`)
const { GULLY_THEME, C, PALETTE } = await import(`${kit}chartTheme.ts`)
const presets = await import(`${kit}chartPresets.ts`)
const { echarts, THEME_NAME } = await import(`${kit}echarts-setup.ts`)
const { default: tokens } = await import('echarts/lib/visual/tokens.js')

/* ---------- colours ---------- */

const css = fs.readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
/** Every kit colour: the --color-* tokens in index.css (as #rrggbb). */
const KIT = new Set([...css.matchAll(/--color-[\w-]+:\s*(#[0-9a-f]{3,8})\b/gi)].map((m) => norm(m[1])))

function norm(c) {
  c = c.trim().toLowerCase()
  if (c.startsWith('#')) {
    let h = c.slice(1)
    if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((x) => x + x).join('')
    return `#${h.slice(0, 6)}`
  }
  const m = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (m) return `#${m.slice(1, 4).map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`
  return c
}
/** Every colour literal in a string (hex and rgb/rgba), normalised to #rrggbb. */
const coloursIn = (s) => [...s.matchAll(/#[0-9a-f]{8}\b|#[0-9a-f]{6}\b|#[0-9a-f]{3,4}\b|rgba?\([^)]*\)/gi)].map((m) => [m[0], norm(m[0])])
const offKit = (s) => [...new Set(coloursIn(s).filter(([, n]) => !KIT.has(n)).map(([raw]) => raw))]

/** ECharts' own palette (visual/tokens.js), light and dark: none of it may appear in a drawn chart. */
const ECHARTS_DEFAULTS = new Set(
  [...Object.values(tokens.color), ...Object.values(tokens.darkColor)]
    .flat()
    .filter((c) => typeof c === 'string' && /^#|^rgb/.test(c))
    .map(norm)
    .filter((c) => !KIT.has(c) && c !== '#000000'),
)

/* ---------- empty state ---------- */

test('a value is real when it is a finite number; zero counts, unknowns do not', () => {
  for (const v of [0, 1, -2.5, '3', [1, 4], { value: 0 }, { coords: [[0, 0]] }]) assert.equal(isReal(v), true, JSON.stringify(v))
  for (const v of [null, undefined, NaN, Infinity, '-', '', 'abc', [1, null], { value: null }, []]) assert.equal(isReal(v), false, JSON.stringify(v))
})

test('tooFewPoints: fewer than 2 real points, or all unknown', () => {
  assert.equal(tooFewPoints([]), true)
  assert.equal(tooFewPoints([5]), true)
  assert.equal(tooFewPoints([null, null, null]), true)
  assert.equal(tooFewPoints([null, 4, null]), true)
  assert.equal(tooFewPoints(undefined), true)
  assert.equal(tooFewPoints([0, 0]), false, 'two known zeros are a series')
  assert.equal(tooFewPoints([null, 1, 2]), false)
})

const line = (data) => ({ type: 'line', data })
const live = presets.livePoint([0, 1])
test('GhostChart triggers for a line with fewer than 2 real points', () => {
  assert.equal(optionIsEmpty({ series: [line([])] }), true)
  assert.equal(optionIsEmpty({ series: [line([7]), live] }), true, 'the live pulse is decoration, not data')
  assert.equal(optionIsEmpty({ series: [{ ...presets.areaPreset(), data: [[0, 3]] }] }), true)
  assert.equal(optionIsEmpty({ series: [line([3, 4])] }), false)
})

test('GhostChart triggers when every value is null or unknown', () => {
  assert.equal(optionIsEmpty({ series: [line([null, null, null])] }), true)
  assert.equal(optionIsEmpty({ series: [line(['-', '', null]), line([{ value: null }, { value: undefined }])] }), true)
  assert.equal(optionIsEmpty({ series: [{ type: 'pie', data: [{ name: 'a', value: null }, { name: 'b', value: null }] }] }), true)
  assert.equal(optionIsEmpty({ series: [{ type: 'bar', data: [null, null] }], yAxis: { type: 'category' } }), true)
  assert.equal(optionIsEmpty(null), true)
})

test('real data, including known zeros and single rankings, is drawn', () => {
  assert.equal(optionIsEmpty({ series: [line([0, 0, 0])] }), false, 'known zeros are data')
  assert.equal(optionIsEmpty({ series: [line([null, null]), line([1, 2])] }), false, 'one drawable series is enough')
  assert.equal(optionIsEmpty({ series: [{ type: 'bar', data: [5] }], yAxis: { type: 'category', data: ['a'] } }), false, 'a horizontal ranking of one row')
  assert.equal(optionIsEmpty({ series: [{ type: 'bar', data: [5] }], xAxis: { type: 'category' }, yAxis: { type: 'value' } }), true, 'one column is not a series')
  assert.equal(optionIsEmpty({ series: [{ type: 'pie', data: [{ value: 3 }] }] }), false)
  assert.equal(optionIsEmpty({ dataset: { source: [] }, series: [{ type: 'line' }] }), false, 'dataset charts are not judged')
  assert.equal(optionIsEmpty({ series: [{ type: 'line', encode: {} }] }), false, 'no data array: not judged')
  assert.equal(optionIsEmpty(presets.sparklinePreset({ data: [1, 2, 3] })), false)
  assert.equal(optionIsEmpty(presets.sparklinePreset({ data: [1] })), true)
})

test('the ghost takes the shape of the chart it stands in for', () => {
  assert.equal(ghostVariantOf({ series: [live, line([])] }), 'line')
  assert.equal(ghostVariantOf({ series: [{ type: 'pie', data: [] }] }), 'ring')
  assert.equal(ghostVariantOf({ series: [{ type: 'bar', data: [] }] }), 'bars')
})

/* ---------- colours ---------- */

test('index.css holds the kit and chart colours the theme names', () => {
  for (const c of [...Object.values(C), ...PALETTE]) assert.ok(KIT.has(norm(c)), `${c} is not a --color-* token in index.css`)
})

test('the theme uses kit colours only', () => {
  assert.deepEqual(offKit(JSON.stringify(GULLY_THEME)), [])
})

test('every preset uses kit colours only', () => {
  const fns = { ...presets.barsPreset(), z: [presets.linePreset(), presets.areaPreset(), presets.areaPreset({ color: C.blue }), presets.ringPreset(), presets.heatmapPreset(), presets.livePoint([0, 1]), presets.sparklinePreset({ data: [1, 2, 3] }), presets.axisTooltip(), presets.itemTooltip()] }
  const html = presets.tipHtml({ title: 'Day', rows: [{ name: 'a', value: '1', color: C.gold, valueColor: C.green }], note: 'n' })
  assert.deepEqual(offKit(JSON.stringify(fns) + html), [])
})

test('the theme sets the components ECharts would otherwise paint with its defaults', () => {
  const t = GULLY_THEME
  assert.ok(t.axisPointer.lineStyle.color && t.axisPointer.shadowStyle.color && t.axisPointer.label.backgroundColor)
  assert.ok(t.tooltip.axisPointer.crossStyle.color && t.tooltip.axisPointer.lineStyle.color && t.tooltip.axisPointer.label.color)
  assert.ok(t.legend.inactiveColor && t.legend.inactiveBorderColor && t.legend.pageIconColor && t.legend.pageIconInactiveColor)
  assert.ok(t.dataZoom.fillerColor && t.dataZoom.handleStyle.color && t.dataZoom.brushStyle.color && t.dataZoom.dataBackground.lineStyle.color)
  assert.ok(t.visualMap.inRange.color.length && t.visualMap.contentColor && t.visualMap.inactiveColor)
  assert.ok(t.brush.brushStyle.color && t.toolbox.iconStyle.borderColor && t.toolbox.emphasis.iconStyle.borderColor)
})

/* A chart drawn with every component the theme covers (more than the site registers, so a future
   chart that adds one is covered too), rendered server-side: the merged option (theme + ECharts
   defaults + this option) and the SVG must hold no ECharts default colour. */
test('a drawn chart holds no ECharts default colour (SSR)', async () => {
  const comps = await import('echarts/components')
  echarts.use([comps.LegendScrollComponent, comps.VisualMapContinuousComponent, comps.BrushComponent, comps.ToolboxComponent, comps.TitleComponent, comps.TimelineComponent, comps.MarkPointComponent])
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const chart = echarts.init(null, THEME_NAME, { renderer: 'svg', ssr: true, width: 640, height: 400 })
  chart.setOption({
    animation: false,
    title: { text: 'Kit', subtext: 'check' },
    legend: { type: 'scroll', data: ['a', 'b', 'c'], selected: { c: false } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    axisPointer: { show: true, value: 'Wed', status: 'show', label: { show: true } },
    toolbox: { feature: { dataZoom: {}, restore: {} } },
    brush: { toolbox: ['rect'], xAxisIndex: 0 },
    grid: [{ left: 40, right: 20, top: 60, bottom: 90, show: true }],
    xAxis: [{ type: 'category', data: days, splitArea: { show: true }, minorTick: { show: true } }],
    yAxis: [{ type: 'value', splitArea: { show: true }, minorSplitLine: { show: true } }],
    dataZoom: [{ type: 'slider', start: 10, end: 90, brushSelect: true }, { type: 'inside' }],
    visualMap: [
      { type: 'continuous', min: 0, max: 10, seriesIndex: 3, calculable: true, right: 0, top: 0 },
      { type: 'piecewise', pieces: [{ lt: 3 }, { gte: 3, lt: 6 }, { gte: 6 }], seriesIndex: 4, left: 0, top: 0 },
    ],
    series: [
      { name: 'a', ...presets.areaPreset(), showSymbol: true, symbol: 'emptyCircle', data: [1, 3, 2, 5, 4], markLine: { data: [{ type: 'average' }] }, markArea: { data: [[{ xAxis: 'Tue' }, { xAxis: 'Wed' }]] }, markPoint: { data: [{ type: 'max' }] } },
      { name: 'b', ...presets.barsPreset(), data: [2, 1, 4, 3, 5], label: { show: true }, showBackground: true },
      { name: 'c', ...presets.linePreset({ dashed: true }), data: [3, null, 2, 1, 2] },
      { type: 'scatter', data: [[0, 2], [1, 5], [2, 8]], symbolSize: 8 },
      { type: 'scatter', data: [[3, 1], [4, 7]], symbolSize: 8 },
      presets.livePoint(['Fri', 4]),
      { ...presets.ringPreset(), center: ['85%', '20%'], radius: ['8%', '12%'], data: [{ name: 'x', value: 2 }, { name: 'y', value: 3 }] },
    ],
  })
  chart.setOption({ series: [{ ...presets.heatmapPreset(), id: 'tiles', left: '70%', top: '50%', width: '25%', height: '25%', data: [{ name: 'A', value: 4, children: [{ name: 'A1', value: 4 }] }, { name: 'B', value: 2 }] }] })
  const option = JSON.stringify(chart.getOption())
  const svg = chart.renderToSVGString()
  chart.dispose()
  const leaked = (s) => [...new Set(coloursIn(s).filter(([, n]) => ECHARTS_DEFAULTS.has(n)).map(([raw]) => raw))]
  assert.deepEqual(leaked(option), [], 'ECharts default colours in the merged option')
  assert.deepEqual(leaked(svg), [], 'ECharts default colours in the drawn SVG')
  for (const c of ['#b7b9be', '#6578ba', '#e0e4f2', '#6d6e73']) assert.ok(!svg.includes(c) && !option.includes(c), `${c} leaked`)
  // Every colour the chart was configured with is a kit token. (The SVG itself also holds the visual
  // map's interpolated in-between colours and black clip paths, so it is checked for defaults only.)
  assert.deepEqual(offKit(option).filter((c) => norm(c) !== '#000000'), [], 'every colour in the merged option is a kit token')
})
