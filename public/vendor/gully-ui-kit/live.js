// uPlot wrapper for live time series: a rolling window that ticks with push(). Themed from --gu-* tokens.
//   const h = await mountLive(el, { series: [{ label: 'Txs/s' }], data: [[t...], [v...]], window: 300, unit: 'usd', height: 220 })
//   h.push(tSeconds, [v1, v2]) ; h.set(data) ; h.destroy()
import { lazy, css, tokens, onThemeChange, onResize, frame, fmtUsd, fmtNum, withAlpha } from './core.js';

/** keep only the last `window` seconds (pure, tested) */
export function trim(data, windowS) {
  if (!windowS || !data[0].length) return data;
  const from = data[0][data[0].length - 1] - windowS;
  let i = 0; while (i < data[0].length && data[0][i] < from) i++;
  return i ? data.map((col) => col.slice(i)) : data;
}

export async function mountLive(host, spec) {
  css('./vendor/uplot.css');
  let data = spec.data || [[], ...spec.series.map(() => [])];
  let u = null;
  const plot = frame(host, 'loading');
  const { default: uPlot } = await lazy('uplot');
  const fmt = spec.unit === 'usd' ? fmtUsd : fmtNum;
  function build() {
    const t = tokens(host);
    u?.destroy();
    plot.replaceChildren();
    if (!data[0].length) { frame(host, 'empty', spec.empty); u = null; return; }
    frame(host, 'ready');
    const w = Math.max(200, plot.clientWidth || host.clientWidth || 300);
    const h = spec.height || Math.max(160, (host.clientHeight || 240) - 32);
    const axis = { stroke: t.muted, grid: { stroke: t.grid, width: 1 }, ticks: { show: false }, font: `12px ${t.familyNum}` };
    u = new uPlot({
      width: w, height: h,
      legend: { show: spec.series.length > 1 || spec.legend === true },
      cursor: { points: { size: 8 } },
      scales: { x: { time: spec.time !== false } },
      axes: [{ ...axis }, { ...axis, size: 56, values: (_, ticks) => ticks.map((v) => fmt(v)) }],
      series: [{}, ...spec.series.map((s, i) => ({ label: s.label, stroke: t.series[i % t.series.length], width: 2, fill: spec.series.length === 1 && spec.fill !== false ? withAlpha(t.series[0], 0.14) : undefined, value: (_, v) => fmt(v), points: { show: false } }))],
    }, data, plot);
  }
  build();
  const offTheme = onThemeChange(build);
  const offSize = onResize(host, (r) => u?.setSize({ width: Math.max(200, r.width), height: spec.height || u.height }));
  return {
    get plot() { return u; },
    push(x, values) {
      data = trim([[...data[0], x], ...data.slice(1).map((col, i) => [...col, values[i]])], spec.window);
      if (!u) build(); else u.setData(data);
    },
    set(next) { data = next; build(); },
    destroy() { offTheme(); offSize(); u?.destroy(); u = null; },
  };
}
