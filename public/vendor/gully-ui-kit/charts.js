// Apache ECharts wrapper: line, bar, sankey, funnel, heatmap, map, treemap, with drill-down. Themed from --gu-* tokens,
// re-themed when the page theme changes; tooltips draw in the canvas (renderMode richText: no innerHTML);
// no animation under reduced motion or Save-Data.
//   const h = await mountChart(el, { option, drill, geo, empty })
//   option = a normal ECharts option without colours; drill = { '<item name>': childOption } (click to open, crumbs to go
//   back); geo = { name, url } (GeoJSON fetched once and registered); empty = 'No trades yet' (shown when no series data).
const maps = new Set();
import { lazy, tokens, prefs, onThemeChange, onResize, frame, el as mk } from './core.js';

const hasData = (opt) => (opt.series || []).some((s) => {
  const d = s.data || (s.links ? s.links : null) || [];
  return Array.isArray(d) ? d.length > 0 : !!d;
});

/** the ECharts theme part of an option, from the tokens (pure, tested) */
export function themed(option, t, motion) {
  const axis = { axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false }, axisLabel: { color: t.muted, fontFamily: t.familyNum }, splitLine: { lineStyle: { color: t.grid } }, nameTextStyle: { color: t.muted } };
  const fixAxis = (a) => (a == null ? a : Array.isArray(a) ? a.map((x) => ({ ...axis, ...x })) : { ...axis, ...a });
  const series = (option.series || []).map((s) => {
    const base = { ...s };
    if (s.type === 'line') Object.assign(base, { lineStyle: { width: 2, ...(s.lineStyle || {}) }, symbolSize: s.symbolSize ?? 8, showSymbol: s.showSymbol ?? false });
    if (s.type === 'bar') base.itemStyle = { borderRadius: [4, 4, 0, 0], ...(s.itemStyle || {}) };
    if (s.type === 'sankey') base.lineStyle = { color: 'gradient', opacity: 0.35, ...(s.lineStyle || {}) };
    if (s.type === 'treemap') Object.assign(base, { name: s.name ?? 'All', breadcrumb: { itemStyle: { color: t.surface2, borderColor: t.line, textStyle: { color: t.ink } }, ...(s.breadcrumb || {}) }, itemStyle: { borderColor: t.surface, gapWidth: 2, ...(s.itemStyle || {}) } });
    if (s.type === 'funnel') base.itemStyle = { borderColor: t.surface, borderWidth: 2, ...(s.itemStyle || {}) };
    if (s.type === 'heatmap' || s.type === 'map') base.itemStyle = { borderColor: t.surface, borderWidth: 1, ...(s.itemStyle || {}) };
    base.label = { color: t.ink, fontFamily: t.family, ...(s.label || {}) };
    return base;
  });
  return {
    ...option,
    color: t.series,
    backgroundColor: 'transparent',
    animation: motion && option.animation !== false,
    animationDuration: 500,
    aria: { enabled: true, ...(option.aria || {}) },
    textStyle: { color: t.ink, fontFamily: t.family, ...(option.textStyle || {}) },
    legend: option.legend && { textStyle: { color: t.ink2 || t.ink }, icon: 'roundRect', itemWidth: 10, itemHeight: 10, ...option.legend },
    tooltip: option.tooltip && { renderMode: 'richText', backgroundColor: t.surface, borderColor: t.line, textStyle: { color: t.ink, fontFamily: t.family }, ...option.tooltip },
    xAxis: fixAxis(option.xAxis),
    yAxis: fixAxis(option.yAxis),
    visualMap: option.visualMap && { textStyle: { color: t.muted }, inRange: { color: [t.surface2, t.series[0]] }, ...option.visualMap },
    geo: option.geo && { itemStyle: { areaColor: t.surface2, borderColor: t.line }, ...option.geo },
    series,
  };
}

export async function mountChart(host, spec) {
  let current = spec, stack = [], chart = null, offTheme, offSize, crumbs;
  const plot = frame(host, 'loading');
  const ec = await lazy('echarts');
  if (spec.geo && !maps.has(spec.geo.name)) {
    try { const r = await fetch(spec.geo.url); if (!r.ok) throw new Error(String(r.status)); ec.registerMap(spec.geo.name, await r.json()); maps.add(spec.geo.name); }
    catch { frame(host, 'error', spec.errorText || 'The map could not load just now'); return handle(); }
  }
  function opt() { return stack.length ? stack[stack.length - 1].option : current.option; }
  function draw(replace) {
    const o = opt();
    if (!hasData(o)) { chart?.clear(); frame(host, 'empty', current.empty); return; }
    frame(host, 'ready');
    if (!chart) {
      chart = ec.init(plot, null, { renderer: 'canvas' });
      chart.on('click', (p) => {
        const child = current.drill && current.drill[p.name];
        if (!child) return;
        stack.push({ name: p.name, option: child });
        renderCrumbs(); draw(true);
      });
    }
    chart.setOption(themed(o, tokens(host), prefs.motion()), replace);
  }
  function renderCrumbs() {
    if (!crumbs) { crumbs = mk('nav', 'gu-crumbs'); crumbs.setAttribute('aria-label', 'Chart levels'); host.prepend(crumbs); }
    crumbs.replaceChildren();
    crumbs.hidden = !stack.length;
    const levels = [{ name: current.rootName || 'All' }, ...stack];
    levels.forEach((lv, i) => {
      if (i) crumbs.appendChild(mk('span', 'gu-crumb-sep', '›'));
      if (i === levels.length - 1) { const c = mk('span', 'gu-crumb gu-crumb-on', lv.name); c.setAttribute('aria-current', 'true'); crumbs.appendChild(c); return; }
      const b = mk('button', 'gu-crumb', lv.name); b.type = 'button';
      b.addEventListener('click', () => { stack = stack.slice(0, i); renderCrumbs(); draw(true); });
      crumbs.appendChild(b);
    });
  }
  draw(true);
  offTheme = onThemeChange(() => draw(false));
  offSize = onResize(host, () => chart?.resize());
  function handle() {
    return {
      get chart() { return chart; },
      update(next) { current = { ...current, ...next }; stack = []; renderCrumbs(); draw(true); },
      back() { stack.pop(); renderCrumbs(); draw(true); },
      destroy() { offTheme?.(); offSize?.(); chart?.dispose(); chart = null; },
    };
  }
  return handle();
}
