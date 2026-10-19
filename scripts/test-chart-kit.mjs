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

/* ---------- live mode (CHART-KIT-LIVE.md) ---------- */

const live2 = await import(`${kit}liveMotion.ts`)
const { createPoller } = await import(`${kit}livePoller.ts`)
const { motionFor } = await import(`${kit}chart-utils.ts`)
const read = (p) => fs.readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')

test('live is on by default in every live-capable component', () => {
  assert.match(read('components/charts/EChart.tsx'), /live = true/)
  assert.match(read('components/charts/MiniSpark.tsx'), /live = true/)
  assert.match(read('components/charts/MiniBars.tsx'), /live = true/)
})

test('liveDefaults: lines glide on update, bars stagger in, anything the chart set is kept', () => {
  const o = live2.liveDefaults({ series: [{ type: 'line', data: [1, 2] }, { type: 'bar', data: [1, 2] }, { type: 'pie', data: [] }, { type: 'line', data: [1, 2], animationDurationUpdate: 123 }] })
  assert.equal(o.series[0].animationDurationUpdate, live2.LIVE_TWEEN_MS)
  assert.equal(o.series[0].animationEasingUpdate, 'cubicOut')
  assert.equal(typeof o.series[1].animationDelay, 'function')
  assert.equal(o.series[1].animationDelay(0), 0)
  assert.equal(o.series[1].animationDelay(1000), 480, 'the stagger is capped')
  assert.equal(o.series[1].animationDelayUpdate, 0)
  assert.equal(o.series[2].animationDurationUpdate, undefined, 'rings are not touched')
  assert.equal(o.series[3].animationDurationUpdate, 123)
  const same = { series: [{ type: 'pie' }] }
  assert.deepEqual(live2.liveDefaults(same), same)
})

test('the now marker goes on the newest real point of plain lines only', () => {
  const axes = { xAxis: { type: 'category' }, yAxis: { type: 'value' } }
  assert.deepEqual(live2.liveMarkers({ ...axes, series: [{ type: 'line', data: [1, 2, null] }] }).map((m) => m.point), [[1, 2]], 'trailing unknown skipped')
  assert.deepEqual(live2.liveMarkers({ ...axes, series: [{ type: 'line', data: [[10, 5], [20, 7]] }] }).map((m) => m.point), [[20, 7]])
  assert.deepEqual(live2.liveMarkers({ ...axes, series: [{ type: 'line', data: [{ value: [1, 4] }, { value: [2, 9] }] }] }).map((m) => m.point), [[2, 9]])
  assert.equal(live2.liveMarkers({ ...axes, series: [{ type: 'line', stack: 's', data: [1, 2] }] }).length, 0, 'stacked: position would be wrong')
  assert.equal(live2.liveMarkers({ ...axes, series: [{ type: 'line', live: false, data: [1, 2] }] }).length, 0, 'opt out')
  assert.equal(live2.liveMarkers({ ...axes, series: [{ type: 'line', data: [1] }] }).length, 0, 'one point is the ghost')
  assert.equal(live2.liveMarkers({ ...axes, yAxis: { type: 'category' }, series: [{ type: 'line', data: [1, 2] }] }).length, 0)
  assert.equal(live2.liveMarkers({ series: [{ type: 'line', data: [1, 2] }] }).length, 0, 'no cartesian axes')
  assert.equal(live2.liveMarkers({ ...axes, series: [{ type: 'bar', data: [1, 2] }] }).length, 0)
  const many = live2.liveMarkers({ ...axes, series: [1, 2, 3, 4, 5].map(() => ({ type: 'line', data: [1, 2] })) })
  assert.equal(many.length, 3)
  assert.equal(live2.liveMarkers(presets.sparklinePreset({ data: [1, 2, 3] })).length, 1)
  assert.equal(live2.hasLiveArea({ series: [{ ...presets.areaPreset(), data: [1, 2] }] }), true)
  assert.equal(live2.hasLiveArea({ series: [{ ...presets.linePreset(), data: [1, 2] }] }), false)
})

test('the tween glides known values, snaps unknowns, and lands exactly on the target', () => {
  const a = [0, 10, null, 4]
  const b = [10, 20, 5, null]
  assert.deepEqual(live2.lerpSeries(a, b, 0.5), [5, 15, 5, null], 'null on either side snaps, never passes through zero')
  assert.deepEqual(live2.lerpSeries(a, b, 1), b)
  assert.deepEqual(live2.lerpSeries([1], [1, 2], 0.3), [1, 2], 'a different length jumps')
  assert.equal(live2.tweenEase(0.5, true), 0.5, 'reduced: linear')
  assert.ok(live2.tweenEase(0.5, false) > 0.5, 'normal: eases out')
  assert.equal(live2.tweenMs(true), 150)
  assert.equal(live2.tweenMs(false), 700)
})

test('reduced motion keeps charts moving: a short linear glide, never animation off', () => {
  const o = motionFor(live2.liveDefaults({ series: [{ type: 'bar', data: [1, 2], animationDelay: () => 99 }, { type: 'line', data: [1, 2] }] }), true)
  assert.equal(o.animation, true)
  assert.equal(o.animationDurationUpdate, 150)
  assert.equal(o.animationEasingUpdate, 'linear')
  for (const s of o.series) {
    assert.equal(s.animationDurationUpdate, undefined, 'per-series timings are stripped in favour of the gentle ones')
    assert.equal(s.animationDelay, undefined, 'no stagger')
  }
})

test('index.css: live loops keep running (slow and small) under reduced motion, pause off-screen, and the card token exists', () => {
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(reduced, /\.gl-live-ring[\s\S]*?animation-iteration-count:\s*infinite\s*!important/, 'the pulse is not switched off')
  assert.match(reduced, /gl-live-breathe[\s\S]*?animation-duration:\s*4\.8s\s*!important/, 'breathing is slowed, not stopped')
  assert.match(reduced, /@keyframes gl-live-ring \{[\s\S]*?opacity: 0\.4/, 'a visible (not zero-opacity) gentle pulse')
  assert.match(css, /\[data-live='paused'\] \*[\s\S]*?animation-play-state:\s*paused\s*!important/)
  assert.match(css, /--card-radius:\s*var\(--radius-lg\)/)
  assert.match(css, /--card-bg:\s*var\(--color-surface\)/)
  assert.match(css, /--card-pad:\s*20px/)
  assert.match(css, /--radius-lg:\s*12px/)
  assert.match(css, /--color-surface:\s*#151d28/)
})

test('GhostChart: the caption sits in a masked band, not on the curves', () => {
  const g = read('components/charts/GhostChart.tsx')
  assert.match(g, /data-ghost-band/)
  assert.match(g, /radial-gradient[^']*var\(--ghost-band, var\(--card-bg\)\)/)
  const bandAt = g.indexOf('data-ghost-band')
  assert.ok(g.indexOf('{children}') > bandAt && g.indexOf('{label}') > bandAt, 'label, badge and buttons are all inside the band')
})

/** A fake clock + visibility for the poller. */
function rig() {
  let t = 0
  let hidden = false
  const timers = new Map()
  let id = 0
  const calls = []
  const env = {
    setTimeout: (fn, ms) => (timers.set(++id, { fn, at: t + ms }), id),
    clearTimeout: (i) => timers.delete(i),
    now: () => t,
    hidden: () => hidden,
  }
  const got = []
  const p = createPoller({ fetcher: async () => (calls.push(t), t), intervalMs: 1000, onData: (d) => got.push(d), env })
  const flush = () => new Promise((r) => setImmediate(r))
  const advance = async (ms) => {
    const end = t + ms
    for (;;) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (!next || next[1].at > end) break
      t = next[1].at
      timers.delete(next[0])
      next[1].fn()
      await flush()
    }
    t = end
  }
  return { p, calls, got, advance, flush, setHidden: (h) => (hidden = h), timers }
}

test('useLiveSeries core: fetches at once, then on its stated cadence', async () => {
  const r = rig()
  r.p.start()
  await r.flush()
  assert.deepEqual(r.calls, [0])
  await r.advance(3500)
  assert.deepEqual(r.calls, [0, 1000, 2000, 3000])
  assert.deepEqual(r.got, [0, 1000, 2000, 3000])
  r.p.stop()
  await r.advance(5000)
  assert.equal(r.calls.length, 4, 'nothing after stop')
})

test('useLiveSeries core: pauses while the tab is hidden, refreshes on return when stale', async () => {
  const r = rig()
  r.p.start()
  await r.flush()
  await r.advance(500)
  r.setHidden(true)
  r.p.visibility()
  assert.equal(r.timers.size, 0, 'the timer is cleared while hidden')
  await r.advance(10000)
  assert.deepEqual(r.calls, [0], 'no requests while hidden')
  r.setHidden(false)
  r.p.visibility()
  await r.flush()
  assert.equal(r.calls.length, 2, 'stale data is refreshed the moment the tab returns')
  assert.equal(r.calls[1], 10500)
  assert.equal(r.timers.size, 1, 'and the cadence resumes')
})

test('useLiveSeries core: returning to a tab with fresh data does not refetch early', async () => {
  const r = rig()
  r.p.start()
  await r.flush()
  await r.advance(300)
  r.setHidden(true)
  r.p.visibility()
  r.setHidden(false)
  r.p.visibility()
  await r.flush()
  assert.equal(r.calls.length, 1)
  await r.advance(800)
  assert.equal(r.calls.length, 2)
})

test('useLiveSeries core: starting while hidden waits; a reply after stop is dropped', async () => {
  const r = rig()
  r.setHidden(true)
  r.p.start()
  await r.flush()
  assert.equal(r.calls.length, 0)
  let release
  const got = []
  const slow = createPoller({ fetcher: () => new Promise((res) => (release = res)), intervalMs: 10, onData: (d) => got.push(d), env: { setTimeout: (f, m) => setTimeout(f, m), clearTimeout, now: Date.now, hidden: () => false } })
  slow.start()
  slow.refresh()
  slow.stop()
  release('late')
  await new Promise((res) => setTimeout(res, 30))
  assert.deepEqual(got, [], 'a reply that lands after stop is ignored')
})

test('server-rendered line areas carry the url() fill the breathing CSS targets', () => {
  const chart = echarts.init(null, THEME_NAME, { renderer: 'svg', ssr: true, width: 300, height: 120 })
  chart.setOption({ animation: false, xAxis: { type: 'category', data: ['a', 'b', 'c'] }, yAxis: { type: 'value' }, series: [{ ...presets.areaPreset(), data: [1, 3, 2] }] })
  const svg = chart.renderToSVGString()
  chart.dispose()
  assert.match(svg, /<path[^>]*fill="url\(#/, 'the area path fills with a gradient url')
  assert.match(css, /path\[fill\^='url\('\]/)
})
