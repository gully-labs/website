// TradingView Lightweight Charts wrapper for prices: candles, line or area, optional volume bars, USD axis, the Thin chip
// under $500 of liquidity. Attribution: the library's own logo injects a <style> element (blocked by a strict style-src),
// so it is off and the frame carries a plain "Chart by TradingView" link instead, as the licence NOTICE asks.
//   const h = await mountPrice(el, { kind: 'candles', data: [{ time, open, high, low, close }], volume: [{ time, value, up }],
//                                    liquidityUsd: 320, title: 'MOSS / USD' })
//   h.push(bar) ; h.set(data) ; h.destroy()
import { lazy, tokens, onThemeChange, onResize, frame, fmtUsd, thinChip, THIN_USD, withAlpha, el as mk } from './core.js';

export async function mountPrice(host, spec) {
  let chart = null, main = null, vol = null, data = spec.data || [], volume = spec.volume || [];
  const plot = frame(host, 'loading');
  const L = await lazy('lwc');
  function chips() {
    host.querySelector(':scope > .gu-price-chips')?.remove();
    const row = mk('div', 'gu-price-chips');
    if (spec.title) row.appendChild(mk('span', 'gu-price-title', spec.title));
    if (spec.liquidityUsd != null && spec.liquidityUsd < THIN_USD) row.appendChild(thinChip(spec.liquidityUsd));
    const a = mk('a', 'gu-attr', 'Chart by TradingView'); a.href = 'https://www.tradingview.com/'; a.target = '_blank'; a.rel = 'noopener'; row.appendChild(a);
    host.prepend(row);
  }
  function build() {
    const t = tokens(host);
    chart?.remove(); chart = null;
    if (!data.length) { frame(host, 'empty', spec.empty || 'No trades yet'); return; }
    frame(host, 'ready');
    chips();
    chart = L.createChart(plot, {
      autoSize: true,
      layout: { background: { type: L.ColorType.Solid, color: t.surface }, textColor: t.muted, fontFamily: t.familyNum, attributionLogo: false },
      grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
      rightPriceScale: { borderColor: t.line },
      timeScale: { borderColor: t.line, timeVisible: true },
      crosshair: { mode: L.CrosshairMode.Normal },
      localization: { priceFormatter: (p) => fmtUsd(p, { compact: false }) },
    });
    if (spec.kind === 'candles') main = chart.addSeries(L.CandlestickSeries, { upColor: t.up, downColor: t.down, borderVisible: false, wickUpColor: t.up, wickDownColor: t.down });
    else if (spec.kind === 'area') main = chart.addSeries(L.AreaSeries, { lineColor: t.series[0], lineWidth: 2, topColor: withAlpha(t.series[0], 0.28), bottomColor: withAlpha(t.series[0], 0) });
    else main = chart.addSeries(L.LineSeries, { color: t.series[0], lineWidth: 2 });
    main.setData(data);
    if (volume.length) {
      vol = chart.addSeries(L.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' } });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      vol.setData(volume.map((v) => ({ time: v.time, value: v.value, color: withAlpha(v.up === false ? t.down : t.up, 0.45) })));
    }
    chart.timeScale().fitContent();
  }
  build();
  const offTheme = onThemeChange(build);
  const offSize = onResize(host, () => {});
  return {
    get chart() { return chart; },
    push(bar) { data = [...data.filter((d) => d.time !== bar.time), bar]; if (!main || !chart) build(); else main.update(bar); },
    set(next, nextVolume) { data = next || []; if (nextVolume) volume = nextVolume; build(); },
    setLiquidity(usd) { spec.liquidityUsd = usd; if (chart) chips(); },
    destroy() { offTheme(); offSize(); chart?.remove(); chart = null; },
  };
}
