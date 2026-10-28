/*!
 * Gully Terminal chart kit  window.GullyCharts  (gully-labs/gully-ops design/terminal/chart-kit.js, spec: README.md)
 * Dependency-free SVG charts for every Gully surface. One kit, unified from:
 *   - sites/_shared/term.js (GT.LiveChart, sparkLine, sparkBars, countTo, tooltip) and landing-live.js (stacked bars)
 *     of the gullychain.xyz landing: those now call this file;
 *   - the website's React/ECharts kit (src/components/charts): the same empty-state rules (isReal, tooFewPoints)
 *     and the same "gentle" reduced-motion policy (short fades and value changes, no movement).
 * Charts: LiveChart (line/area or bars, live), sparkLine, sparkBars, Stacked (stacked bars), Donut, Gauge, Uptime
 * strip, Ticker (marquee). Helpers: fmt.usd ("$50K"), fmt.short, fmt.num, fmt.pct, fmt.eth, fmt.ago, countTo,
 * reveal-on-scroll, json() with timeout, poll() that slows down in hidden tabs, setStatus() for live/offline pills,
 * ethUsd (mainnet ETH/USD: RedStone, GullyPriceFeed on Gully Chain, Coinbase, CoinGecko; never invented).
 * Honest data: a chart with no real data shows its empty or offline text, never a made-up number or a zero.
 * Colours come from tokens.css (var(--t-accent) ...), so one file serves every product.
 * Works as a classic <script> (window.GullyCharts) and as an ES/CommonJS import (module.exports).
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GullyCharts = api;
})(typeof window !== 'undefined' ? window : null, function (win) {
  'use strict';
  var VERSION = '1.0.0';
  var doc = win && win.document;
  var NS = 'http://www.w3.org/2000/svg';
  var mq = win && win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var api = { VERSION: VERSION, reduced: !!(mq && mq.matches) };
  if (mq && mq.addEventListener) mq.addEventListener('change', function () { api.reduced = mq.matches; });
  if (doc && doc.documentElement) doc.documentElement.classList.add('t-js');

  // ------------------------------------------------------------------ data rules (same as the website kit)
  /** A value is real when it is a finite number; zero counts, unknowns (null, NaN, '', '-') do not. */
  function isReal(v) {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) v = v.value;
    if (Array.isArray(v)) return v.length > 0 && v.every(isReal);
    if (typeof v === 'string') { if (!v.trim() || v === '-') return false; v = Number(v); }
    return typeof v === 'number' && isFinite(v);
  }
  /** Fewer than 2 real points: draw the empty state, not a line. */
  function tooFewPoints(vals) { return !vals || vals.filter(isReal).length < 2; }

  // ------------------------------------------------------------------ formatting
  var trimZ = function (s) { return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s; };
  var SUB = '₀₁₂₃₄₅₆₇₈₉';
  /** 3 significant digits for |v| < 1, four or more leading zeros as a subscript: 0.0₄12 */
  function tiny(a, sig) {
    sig = sig || 3; if (a === 0) return '0';
    var s = a.toPrecision(sig); if (s.indexOf('e') >= 0) s = a.toFixed(Math.min(20, sig - 1 - Math.floor(Math.log10(a))));
    var m = /^0\.(0+)(\d+)$/.exec(s); if (m && m[1].length >= 4) return '0.0' + String(m[1].length).split('').map(function (d) { return SUB[+d]; }).join('') + (m[2].replace(/0+$/, '') || '0');
    return trimZ(s);
  }
  var fmt = {
    num: function (n, dec) { if (!isReal(n)) return '–'; return Number(n).toLocaleString('en-US', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }); },
    /** 1.2k, 3.4M */
    short: function (v) { if (!isReal(v)) return '–'; v = +v; var a = Math.abs(v), s = v < 0 ? '-' : ''; if (a >= 1e12) return s + trimZ((a / 1e12).toFixed(1)) + 'T'; if (a >= 1e9) return s + trimZ((a / 1e9).toFixed(1)) + 'B'; if (a >= 1e6) return s + trimZ((a / 1e6).toFixed(1)) + 'M'; if (a >= 1e3) return s + trimZ((a / 1e3).toFixed(1)) + 'k'; if (a >= 1 || a === 0) return s + trimZ(a.toFixed(a % 1 ? 2 : 0)); return s + tiny(a); },
    /** USD, compact: $50K, $1.2M, $3.4B, $1,234, $12.50, $0.078, $0.0₄12 */
    usd: function (n, sig) {
      if (!isReal(n)) return '–'; n = +n; var sign = n < 0 ? '-' : '', a = Math.abs(n);
      if (a === 0) return '$0';
      var u = function (v, x) { return sign + '$' + trimZ(v.toFixed(v < 100 ? 1 : 0)) + x; };
      if (a >= 1e12) return u(a / 1e12, 'T'); if (a >= 1e9) return u(a / 1e9, 'B'); if (a >= 1e6) return u(a / 1e6, 'M'); if (a >= 1e4) return u(a / 1e3, 'K');
      if (a >= 1000) return sign + '$' + a.toLocaleString('en-US', { maximumFractionDigits: 0 });
      if (a >= 1) return sign + '$' + a.toFixed(2);
      var t = tiny(a, sig); return sign + '$' + (/^0\.\d$/.test(t) ? t + '0' : t);
    },
    pct: function (v, dec) { if (!isReal(v)) return '–'; v = +v; return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dec == null ? 2 : dec) + '%'; },
    eth: function (v) { if (!isReal(v)) return '–'; v = +v; var a = Math.abs(v); return (a >= 1 ? trimZ(v.toFixed(3)) : a >= 0.001 ? trimZ(v.toFixed(4)) : tiny(a)) + ' ETH'; },
    /** seconds -> 12s, 4 min, 2.1 h, 3.0 d */
    ago: function (sec) { sec = Math.max(0, +sec || 0); if (sec < 60) return Math.round(sec) + 's'; if (sec < 3600) return Math.round(sec / 60) + ' min'; if (sec < 86400) return (sec / 3600).toFixed(1) + ' h'; return (sec / 86400).toFixed(1) + ' d'; },
    ms: function (v) { return isReal(v) ? Math.round(v) + ' ms' : '–'; },
    tiny: tiny,
  };
  api.fmt = fmt; api.isReal = isReal; api.tooFewPoints = tooFewPoints;

  // ------------------------------------------------------------------ DOM helpers
  var uid = 0;
  function $(id) { return typeof id === 'string' ? doc.getElementById(id) : id; }
  function el(tag, attrs, parent) { var e = doc.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function h(tag, cls, txt) { var e = doc.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function niceMax(v) { if (!(v > 0)) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }
  var ease = function (k) { return 1 - Math.pow(1 - k, 3); };
  /** true when href is on another product's domain (opens in a new tab): registrable domains differ */
  function isExternal(href) { try { var u = new URL(href, win.location.href), a = u.hostname.split('.').slice(-2).join('.'), b = win.location.hostname.split('.').slice(-2).join('.'); return /^https?:$/.test(u.protocol) && a !== b; } catch (e) { return false; } }
  /** make an <a> follow the link rule */
  function linkRule(a) { if (isExternal(a.href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; } return a; }
  api.isExternal = isExternal; api.linkRule = linkRule;
  api.el = el; api.h = h; api.niceMax = niceMax; api.ease = ease;

  // ------------------------------------------------------------------ motion
  /** Run fn once when node scrolls within `margin` of the viewport (and after `maxWait` ms in any case). */
  function onVisible(node, fn, opts) {
    node = $(node); opts = opts || {}; if (!node) return; var done = false; var go = function () { if (!done) { done = true; fn(node); } };
    if (!('IntersectionObserver' in win)) { go(); return; }
    var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); go(); } }, { rootMargin: opts.margin || '200px 0px' });
    io.observe(node); if (opts.maxWait !== 0) setTimeout(go, opts.maxWait || 8000);
  }
  /** [data-t-reveal] elements fade up once they enter the viewport. Call again after adding nodes. */
  function reveal(scope) {
    var nodes = (scope || doc).querySelectorAll('[data-t-reveal]:not(.is-in)');
    if (!('IntersectionObserver' in win)) { Array.prototype.forEach.call(nodes, function (n) { n.classList.add('is-in'); }); return; }
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
    Array.prototype.forEach.call(nodes, function (n) { io.observe(n); });
    // a full-page screenshot or a print never scrolls: show everything after a while anyway
    setTimeout(function () { Array.prototype.forEach.call(nodes, function (n) { n.classList.add('is-in'); }); }, 4000);
  }
  /** Count a number up (or down) to `to`. fmtFn(v) formats; default: thousands with `dec` decimals. */
  function countTo(node, to, dec, fmtFn) {
    node = $(node); if (!node) return;
    if (!isReal(to)) { node.removeAttribute('data-v'); setFirstText(node, '–'); return; }
    var from = parseFloat(node.getAttribute('data-v')); node.setAttribute('data-v', to);
    var out = fmtFn || function (v) { return dec ? v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : Math.round(v).toLocaleString('en-US'); };
    if (api.reduced || !isFinite(from) || from === to) { setFirstText(node, out(to)); return; }
    var t0 = performance.now(), d = 800;
    (function step(t) { var k = Math.min(1, (t - t0) / d); setFirstText(node, out(from + (to - from) * ease(k))); if (k < 1) requestAnimationFrame(step); })(t0);
  }
  function setFirstText(node, txt) { var tn = node.firstChild && node.firstChild.nodeType === 3 ? node.firstChild : null; if (!tn) { tn = doc.createTextNode(''); node.insertBefore(tn, node.firstChild); } tn.nodeValue = txt; }
  /** Ease an svg from its previous values to `vals`, calling draw(v) each frame. */
  function tween(svg, vals, draw) {
    var prev = svg._v; svg._v = vals.slice();
    if (api.reduced || !prev || prev.length !== vals.length) { draw(vals); return; }
    if (svg._raf) cancelAnimationFrame(svg._raf); var t0 = performance.now();
    (function st(t) { var k = ease(Math.min(1, (t - t0) / 600)); draw(prev.map(function (p, i) { return p + (vals[i] - p) * k; })); if (k < 1) svg._raf = requestAnimationFrame(st); else svg._raf = null; })(t0);
  }
  function flash(node) { node = $(node); if (!node) return; node.classList.remove('is-flash', 'flash'); void node.offsetWidth; node.classList.add('is-flash', 'flash'); }
  // reveal [data-t-reveal] once the page is parsed (call reveal() again for nodes added later)
  if (doc) { if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', function () { reveal(); }); else setTimeout(function () { reveal(); }, 0); }
  api.onVisible = onVisible; api.reveal = reveal; api.countTo = countTo; api.tween = tween; api.flash = flash;

  // ------------------------------------------------------------------ tooltip (one per page)
  var tip = null;
  function showTip(x, y, rows) {
    if (!tip) { tip = h('div', 't-tip gc-tip'); tip.setAttribute('role', 'tooltip'); doc.body.appendChild(tip); }
    tip.textContent = ''; rows.forEach(function (r) { tip.appendChild(h('b', null, r.v)); if (r.label) tip.appendChild(h('span', null, r.label)); });
    tip.classList.add('on'); var px = x + 14, py = y - 10;
    if (px + tip.offsetWidth > win.innerWidth - 8) px = x - tip.offsetWidth - 14; if (py + tip.offsetHeight > win.innerHeight - 8) py = win.innerHeight - tip.offsetHeight - 8;
    tip.style.left = Math.max(8, px) + 'px'; tip.style.top = Math.max(8, py) + 'px';
  }
  function hideTip() { if (tip) tip.classList.remove('on'); }
  api.showTip = showTip; api.hideTip = hideTip;

  // ------------------------------------------------------------------ data fetching
  /** fetch JSON with a timeout; rejects on HTTP errors and on non-JSON answers. */
  function json(url, opts) {
    opts = opts || {}; var ctl = 'AbortController' in win ? new AbortController() : null; var t = ctl ? setTimeout(function () { ctl.abort(); }, opts.timeout || 10000) : null;
    return fetch(url, { method: opts.method || 'GET', headers: Object.assign({ accept: 'application/json' }, opts.body ? { 'content-type': 'application/json' } : {}, opts.headers || {}), body: opts.body ? JSON.stringify(opts.body) : undefined, signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); var ct = r.headers.get('content-type') || ''; if (ct.indexOf('json') < 0) throw new Error('not JSON'); return r.json(); })
      .finally(function () { if (t) clearTimeout(t); });
  }
  /** Call fn() (returns a promise) now and then every `ms` (4x slower while the tab is hidden). Returns stop(). */
  function poll(fn, ms) {
    var stopped = false, timer = null;
    (function run() { if (stopped) return; Promise.resolve().then(fn).catch(function () {}).then(function () { if (!stopped) timer = setTimeout(run, doc.hidden ? ms * 4 : ms); }); })();
    return function () { stopped = true; clearTimeout(timer); };
  }
  /** Status pill: <span class="t-pill" id=x><span class="t-dot"></span><span>Live</span></span>. state: live|down|warn|wait */
  function setStatus(node, state, text) {
    node = $(node); if (!node) return; node.classList.remove('is-live', 'is-down', 'is-warn', 'live', 'down');
    if (state === 'live' || state === 'down' || state === 'warn') node.classList.add('is-' + state);
    var t = node.querySelector('[data-t-status]') || node.lastElementChild; if (t && text != null) t.textContent = text;
    var panel = node.closest && node.closest('.t-panel'); if (panel) panel.classList.toggle('is-off', state === 'down');
  }
  api.json = json; api.poll = poll; api.setStatus = setStatus;

  // ------------------------------------------------------------------ ETH/USD (mainnet price; testnet ETH has no value)
  // Same sources and rules as gully-explorer src/lib/usd.ts (RedStone API, GullyPriceFeed on Gully Chain, CoinGecko) plus
  // Coinbase spot (open CORS) before CoinGecko, whose free API rate-limits browsers without CORS headers.
  // Stale (> 15 min) or odd prices are dropped; with no price the caller shows ETH only.
  var PRICE = { usd: null, at: 0, source: null }, priceAt = 0, inflight = null, listeners = [];
  var sane = function (v) { return typeof v === 'number' && isFinite(v) && v > 0 && v < 1e7; };
  var fresh = function (at) { var now = Date.now(); return now - at <= 15 * 60000 && at - now <= 5 * 60000; };
  var ethUsd = {
    NOTE: 'USD at the mainnet ETH price; testnet ETH has no real value',
    RPC: 'https://testnet-rpc.gullychain.xyz',
    FEED: '0x4c64c79ee59a83842a22c14712D66bfef48eb301',
    get: function () { return PRICE.usd && fresh(PRICE.at) ? PRICE : null; },
    load: function (force) {
      if (!force && priceAt && Date.now() - priceAt < 60000) return Promise.resolve(ethUsd.get());
      if (inflight) return inflight;
      var srcs = [
        function () { return json('https://api.redstone.finance/prices?symbols=ETH&provider=redstone-primary-prod', { timeout: 8000 }).then(function (j) { var e = j && j.ETH; return e && sane(e.value) && fresh(e.timestamp) ? { usd: e.value, at: e.timestamp, source: 'RedStone' } : null; }); },
        function () { // latestPrice(bytes32 "ETH") on GullyPriceFeed, 8 decimals
          return json(ethUsd.RPC, { method: 'POST', timeout: 8000, body: { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: ethUsd.FEED, data: '0x4eec7c2b4554480000000000000000000000000000000000000000000000000000000000' }, 'latest'] } }).then(function (j) {
            var r = j && j.result; if (!r || r.length < 130) return null; var v = parseInt(r.slice(2, 66), 16) / 1e8, at = parseInt(r.slice(66, 130), 16) * 1000; return sane(v) && fresh(at) ? { usd: v, at: at, source: 'GullyPriceFeed' } : null; });
        },
        function () { return json('https://api.coinbase.com/v2/prices/ETH-USD/spot', { timeout: 8000 }).then(function (j) { var v = j && j.data && +j.data.amount; return sane(v) ? { usd: v, at: Date.now(), source: 'Coinbase' } : null; }); },
        function () { return json('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_last_updated_at=true', { timeout: 8000 }).then(function (j) { var e = j && j.ethereum; var at = e && e.last_updated_at ? e.last_updated_at * 1000 : Date.now(); return e && sane(e.usd) && fresh(at) ? { usd: e.usd, at: at, source: 'CoinGecko' } : null; }); },
      ];
      inflight = srcs.reduce(function (p, s) { return p.then(function (got) { return got || s().catch(function () { return null; }); }); }, Promise.resolve(null)).then(function (p) {
        if (p) PRICE = p; priceAt = Date.now(); inflight = null; var cur = ethUsd.get(); listeners.forEach(function (fn) { try { fn(cur); } catch (e) { /* keep going */ } }); return cur;
      });
      return inflight;
    },
    /** fn(price|null) now and on every refresh (60 s) */
    subscribe: function (fn) { listeners.push(fn); if (listeners.length === 1) poll(function () { return ethUsd.load(true); }, 60000); else ethUsd.load().then(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },
    /** USD for an ETH amount, or null */
    toUsd: function (eth) { var p = ethUsd.get(); return p && isReal(eth) ? eth * p.usd : null; },
    /** "$1.2K" with "0.52 ETH" as the fallback when there is no price */
    label: function (eth) { var u = ethUsd.toUsd(eth); return u == null ? fmt.eth(eth) : fmt.usd(u); },
  };
  api.ethUsd = ethUsd;

  // ------------------------------------------------------------------ sparklines (KPI tiles; viewBox 200x40, stretched)
  function sparkLine(svg, vals, title) { svg = $(svg); if (!svg) return; svg.classList.add('t-spark'); vals = (vals || []).filter(isReal).map(Number); tween(svg, vals, function (v) { sparkLineDraw(svg, v, title); }); }
  function sparkLineDraw(svg, vals, title) {
    svg.textContent = ''; var W = 200, H = 40, n = vals.length; if (!svg.getAttribute('viewBox')) { svg.setAttribute('viewBox', '0 0 200 40'); svg.setAttribute('preserveAspectRatio', 'none'); }
    if (!n) return; var max = Math.max.apply(null, vals), min = Math.min(0, Math.min.apply(null, vals)); if (max === min) max = min + 1;
    var xs = function (i) { return n === 1 ? W / 2 : 3 + (W - 6) * i / (n - 1); }, ys = function (v) { return H - 3 - (H - 8) * (v - min) / (max - min); };
    var d = ''; vals.forEach(function (v, i) { d += (i ? 'L' : 'M') + xs(i).toFixed(1) + ' ' + ys(v).toFixed(1); });
    el('path', { class: 'a', d: d + ' L' + xs(n - 1).toFixed(1) + ' ' + (H - 3) + ' L' + xs(0).toFixed(1) + ' ' + (H - 3) + ' Z' }, svg);
    el('path', { class: 'l', d: d, 'vector-effect': 'non-scaling-stroke' }, svg); el('circle', { class: 'd', cx: xs(n - 1).toFixed(1), cy: ys(vals[n - 1]).toFixed(1), r: 2.5 }, svg);
    el('title', {}, svg).textContent = title || ('last ' + n + ' values, latest ' + fmt.short(vals[n - 1]));
  }
  function sparkBars(svg, vals, title) { svg = $(svg); if (!svg) return; svg.classList.add('t-spark'); vals = (vals || []).map(function (v) { return isReal(v) ? +v : 0; }); tween(svg, vals, function (v) { sparkBarsDraw(svg, v, title); }); }
  function sparkBarsDraw(svg, vals, title) {
    svg.textContent = ''; if (!svg.getAttribute('viewBox')) { svg.setAttribute('viewBox', '0 0 200 40'); svg.setAttribute('preserveAspectRatio', 'none'); }
    var W = 200, H = 40, n = vals.length; if (!n) return; var max = Math.max.apply(null, vals) || 1; var slot = W / n, bw = Math.max(2, slot - 2);
    vals.forEach(function (v, i) { var hh = Math.max(v ? 2 : 0, (H - 4) * v / max); el('rect', { class: i === n - 1 ? 'last' : '', x: (slot * i + 1).toFixed(1), y: (H - hh).toFixed(1), width: bw.toFixed(1), height: hh.toFixed(1) }, svg); });
    el('title', {}, svg).textContent = title || ('last ' + n + ' values');
  }
  api.sparkLine = sparkLine; api.sparkBars = sparkBars;

  // ------------------------------------------------------------------ LiveChart: line/area or bars, fed live
  // LiveChart(plotEl, {kind:'line'|'bars', name, valueLabel(v), tick(v), tableHead:[...], tableRow(row), tableBtn, minH, emptyText})
  //   -> { update(rows, fresh, opts), redraw(), offline(text) }
  // rows: [{ k: unique key, v: number, x: axis label, tip: text under the value }]. update(..., true) slides the series
  // one slot left (a new point arrived); opts.morph eases the bars/line from the old values.
  function LiveChart(plot, o) {
    plot = $(plot); o = o || {}; var id = 'gck' + (++uid);
    var W = 760, H = o.H || 250, M = { l: o.left || 44, r: 10, t: 14, b: 26 }, rows = [], max = 1, cur = null, drawn = false, sweepOn = false, tableOn = false;
    var svg = el('svg', { class: 't-svg main', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.name || 'Live chart' });
    plot.insertBefore(svg, plot.firstChild);
    var defs = el('defs', {}, svg), lg = el('linearGradient', { id: id + 'f', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: 0, style: 'stop-color:var(--t-accent,#00B2FA);stop-opacity:.24' }, lg); el('stop', { offset: 1, style: 'stop-color:var(--t-accent,#00B2FA);stop-opacity:0' }, lg);
    var ax = el('g', {}, svg), mk = el('g', { class: 'slide' }, svg);
    var area = el('path', { class: 'ar', style: 'fill:url(#' + id + 'f)' }, mk), line = el('path', { class: 'ln' }, mk), line2 = el('path', { class: 'ln2' }, mk), bars = el('g', {}, mk);
    var xh = el('line', { class: 'xh', y1: M.t, y2: H - M.b }, svg), dot = el('circle', { class: 'dot', r: 4.5 }, svg), pulse = el('circle', { class: 'pulse', r: 6 }, svg), ring = el('circle', { class: 'ring', r: 5 }, svg), end = el('circle', { class: 'end', r: 3.5, opacity: 0 }, svg);
    var hit = el('rect', { class: 'hit', role: 'img', x: M.l, y: M.t, width: W - M.l - M.r, height: H - M.t - M.b, tabindex: 0, 'aria-label': (o.name || 'Chart') + ' readout. Use the arrow keys to step through the points.' }, svg);
    var empty = el('text', { class: 'empty-t', x: W / 2, y: H / 2, 'text-anchor': 'middle' }, svg); empty.textContent = o.waitText || 'Waiting for data…';
    var dt = plot.querySelector('.dtwrap'), isBars = o.kind === 'bars';
    function xAt(i) { var n = rows.length; if (isBars) { var slot = (W - M.l - M.r) / Math.max(1, n); return M.l + slot * (i + .5); } return M.l + (W - M.l - M.r) * (n === 1 ? .5 : i / (n - 1)); }
    function yAt(v) { return M.t + (H - M.t - M.b) * (1 - v / max); }
    function fit() {
      var pad = o.inset === false ? 0 : 1, bw = plot.clientWidth - (pad ? 24 : 0), bh = plot.clientHeight - (pad ? 16 : 0); if (bw < 50 || bh < 50) return;
      var nw = Math.max(240, Math.round(bw)), nh = Math.max(o.minH || 90, Math.round(bh)); if (Math.abs(nh - H) < 2 && Math.abs(nw - W) < 2) return;
      W = nw; H = nh; svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); hit.setAttribute('width', W - M.l - M.r); hit.setAttribute('height', H - M.t - M.b); xh.setAttribute('y2', H - M.b); empty.setAttribute('x', W / 2); empty.setAttribute('y', H / 2);
      if (rows.length) draw(rows.map(function (r) { return r.v; }), false);
    }
    if (win.ResizeObserver) new ResizeObserver(fit).observe(plot);
    function armSweep() { if (isBars || o.sweep === false) return; line2.setAttribute('d', line.getAttribute('d')); var L = Math.ceil(line.getTotalLength()) + 2, d = Math.max(40, Math.round(L * .12)); line2.style.strokeDasharray = d + ' ' + L; line2.style.setProperty('--L2', (L + d) + 'px'); if (!sweepOn) { sweepOn = true; line2.classList.add('on'); area.classList.add('live'); ring.classList.add('on'); } }
    function draw(vals, fresh) {
      var n = vals.length; if (!n) return; empty.textContent = '';
      var top = Math.max.apply(null, vals.concat([o.minMax || 0])); max = top <= 4 && !o.decimals ? Math.max(1, Math.ceil(top)) : niceMax(top * 1.08); var ticks = max <= 4 && !o.decimals ? max : 4;
      ax.textContent = '';
      for (var i = 0; i <= ticks; i++) { var v = max * i / ticks, y = yAt(v); el('line', { class: i ? 'gl' : 'ax', x1: M.l, x2: W - M.r, y1: y, y2: y }, ax); el('text', { class: 'at', x: M.l - 6, y: y + 3.5, 'text-anchor': 'end' }, ax).textContent = o.tick ? o.tick(v) : fmt.short(v); }
      (isBars && n <= 12 ? rows.map(function (r, i) { return i; }) : [0, Math.floor((n - 1) / 2), n - 1]).filter(function (v, i, a) { return a.indexOf(v) === i; }).forEach(function (i) { el('text', { class: 'at', x: xAt(i), y: H - 8, 'text-anchor': isBars ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, ax).textContent = rows[i] ? rows[i].x : ''; });
      if (isBars) {
        bars.textContent = ''; var slot = (W - M.l - M.r) / n, bw = Math.max(2, Math.min(28, slot - 2));
        vals.forEach(function (v, i) { var y = yAt(v), hh = Math.max(v ? 2 : 0, H - M.b - y); el('rect', { class: 'bar-r' + (i === n - 1 ? ' last' : '') + (i === cur ? ' on' : ''), x: (xAt(i) - bw / 2).toFixed(1), y: (H - M.b - hh).toFixed(1), width: bw.toFixed(1), height: hh.toFixed(1), rx: Math.min(2, bw / 2) }, bars); });
      } else {
        var d = ''; vals.forEach(function (v, i) { d += (i ? 'L' : 'M') + xAt(i).toFixed(1) + ' ' + yAt(v).toFixed(1); });
        line.setAttribute('d', d); area.setAttribute('d', d + ' L' + xAt(n - 1).toFixed(1) + ' ' + (H - M.b) + ' L' + xAt(0).toFixed(1) + ' ' + (H - M.b) + ' Z');
      }
      var ex = xAt(n - 1), ey = yAt(vals[n - 1]); end.setAttribute('cx', ex); end.setAttribute('cy', ey); end.setAttribute('opacity', isBars ? 0 : 1); ring.setAttribute('cx', ex); ring.setAttribute('cy', ey);
      if (!isBars && !drawn && !api.reduced && n > 1) {
        drawn = true; requestAnimationFrame(function () { var L = Math.ceil(line.getTotalLength()) + 2; line.style.transition = 'none'; line.style.strokeDasharray = L; line.style.strokeDashoffset = L; area.style.opacity = 0; void line.getBoundingClientRect(); line.style.transition = 'stroke-dashoffset 1.4s ease'; area.style.transition = 'opacity .8s ease 1s'; line.style.strokeDashoffset = 0; area.style.opacity = 1; setTimeout(function () { line.style.strokeDasharray = ''; line.style.strokeDashoffset = ''; line.style.transition = ''; armSweep(); }, 1500); });
      } else if (fresh && !api.reduced) {
        var dx = isBars ? (W - M.l - M.r) / n : (W - M.l - M.r) / Math.max(1, n - 1); mk.style.transition = 'none'; mk.style.transform = 'translateX(' + dx.toFixed(1) + 'px)'; void mk.getBoundingClientRect(); mk.style.transition = ''; mk.style.transform = 'translateX(0)';
        pulse.setAttribute('cx', ex); pulse.setAttribute('cy', ey); pulse.classList.remove('go'); void pulse.getBoundingClientRect(); pulse.classList.add('go');
      }
      if (!isBars && drawn && (sweepOn || api.reduced)) armSweep(); if (isBars && !drawn) { drawn = true; ring.classList.add('on'); }
    }
    function table() {
      if (!dt || !o.tableHead) return; dt.textContent = ''; var t = h('table', 'dt t-table'), cap = doc.createElement('caption'); cap.textContent = (o.name || 'Chart') + ', ' + rows.length + ' points'; t.appendChild(cap);
      var tr = h('tr'); o.tableHead.forEach(function (x) { var th = h('th', null, x); th.scope = 'col'; tr.appendChild(th); }); t.appendChild(tr);
      rows.slice().reverse().forEach(function (r) { var tr2 = h('tr'); (o.tableRow ? o.tableRow(r) : [r.x, fmt.short(r.v)]).forEach(function (c) { tr2.appendChild(h('td', null, c)); }); t.appendChild(tr2); }); dt.appendChild(t);
    }
    function tipAt(i, evt) {
      var r = rows[i]; if (!r) return; cur = i; var x = xAt(i), y = yAt(r.v);
      xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.style.opacity = 1; dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.style.opacity = isBars ? 0 : 1;
      if (isBars) Array.prototype.forEach.call(bars.children, function (b, j) { b.classList.toggle('on', j === i); });
      var bb = svg.getBoundingClientRect(), sx = evt && evt.clientX != null ? evt.clientX : bb.left + x * bb.width / W, sy = evt && evt.clientY != null ? evt.clientY : bb.top + y * bb.height / H;
      showTip(sx, sy, [{ v: o.valueLabel ? o.valueLabel(r.v) : fmt.short(r.v), label: r.tip || r.x }]);
    }
    function clearTip() { xh.style.opacity = 0; dot.style.opacity = 0; if (isBars) Array.prototype.forEach.call(bars.children, function (b) { b.classList.remove('on'); }); hideTip(); cur = null; }
    hit.addEventListener('pointermove', function (e) { if (!rows.length) return; var bb = svg.getBoundingClientRect(), x = (e.clientX - bb.left) * W / bb.width, n = rows.length, i; if (isBars) i = Math.floor((x - M.l) / ((W - M.l - M.r) / n)); else i = Math.round((x - M.l) / ((W - M.l - M.r) / Math.max(1, n - 1))); tipAt(Math.max(0, Math.min(n - 1, i)), e); });
    hit.addEventListener('pointerleave', clearTip); hit.addEventListener('blur', clearTip); hit.addEventListener('focus', function () { if (rows.length) tipAt(rows.length - 1); });
    hit.addEventListener('keydown', function (e) { if (!rows.length) return; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); var i = cur == null ? rows.length - 1 : cur + (e.key === 'ArrowLeft' ? -1 : 1); tipAt(Math.max(0, Math.min(rows.length - 1, i))); } });
    if (o.tableBtn) { var tb = $(o.tableBtn); if (tb) tb.addEventListener('click', function () { tableOn = !tableOn; dt.hidden = !tableOn; svg.style.visibility = tableOn ? 'hidden' : ''; tb.setAttribute('aria-pressed', String(tableOn)); }); }
    return {
      update: function (next, fresh, opts) {
        opts = opts || {}; if (opts.name) { o.name = opts.name; svg.setAttribute('aria-label', opts.name); } if (opts.valueLabel) o.valueLabel = opts.valueLabel; if (opts.tick) o.tick = opts.tick; if ('decimals' in opts) o.decimals = opts.decimals; if (opts.tableRow) o.tableRow = opts.tableRow;
        var prev = rows.map(function (r) { return r.v; }); rows = (next || []).filter(function (r) { return isReal(r.v); }); fit();
        if (!rows.length) { ax.textContent = ''; bars.textContent = ''; line.removeAttribute('d'); area.removeAttribute('d'); end.setAttribute('opacity', 0); empty.textContent = opts.emptyText || o.emptyText || 'No data yet'; return; }
        var vals = rows.map(function (r) { return +r.v; });
        if (opts.morph && !api.reduced && prev.length === vals.length) { var t0 = performance.now(); (function st(t) { var k = ease(Math.min(1, (t - t0) / 600)); draw(prev.map(function (p, i) { return p + (vals[i] - p) * k; }), false); if (k < 1) requestAnimationFrame(st); })(t0); }
        else draw(vals, fresh);
        table();
      },
      offline: function (text) { if (!rows.length) empty.textContent = text || 'Source offline'; },
      redraw: function () { if (rows.length) draw(rows.map(function (r) { return r.v; }), false); },
      svg: svg,
    };
  }
  api.LiveChart = LiveChart;

  // ------------------------------------------------------------------ Stacked bars (series in a fixed order)
  // Stacked(plotEl, keys, labels, {name}) -> { update(rows), offline(text) }; rows: [{x, long, <key>: number, ...}]
  function Stacked(plot, keys, labels, o) {
    plot = $(plot); o = o || {}; var W = 400, H = 160, M = { l: 30, r: 6, t: 8, b: 22 }, data = [], shown = [], max = 1, raf = null;
    var svg = el('svg', { class: 't-svg main', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.name || 'Stacked bar chart' }); plot.appendChild(svg);
    var ax = el('g', {}, svg), g = el('g', {}, svg), hit = el('g', {}, svg);
    var empty = el('text', { class: 'empty-t', x: W / 2, y: H / 2, 'text-anchor': 'middle' }, svg); empty.textContent = o.waitText || 'Waiting for data…';
    var tw = h('div', 't-sr sr'), tbl = h('table'); tw.appendChild(tbl); plot.appendChild(tw);
    function fit() { var w = Math.max(240, Math.round(plot.clientWidth)), hh = Math.max(120, Math.round(plot.clientHeight)); if (w === W && hh === H) return; W = w; H = hh; svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); empty.setAttribute('x', W / 2); empty.setAttribute('y', H / 2); draw(shown); }
    if (win.ResizeObserver) new ResizeObserver(fit).observe(plot);
    function draw(vals) {
      ax.textContent = ''; g.textContent = ''; hit.textContent = ''; var n = data.length; if (!n) return;
      var top = Math.max.apply(null, data.map(function (d) { return keys.reduce(function (a, k) { return a + (+d[k] || 0); }, 0); }));
      max = top <= 4 ? Math.max(1, top) : Math.ceil(top / 4) * 4; var ticks = max <= 4 ? max : 4;
      var yAt = function (v) { return M.t + (H - M.t - M.b) * (1 - v / max); };
      for (var i = 0; i <= ticks; i++) { var v = max * i / ticks, y = yAt(v); el('line', { class: i ? 'gl' : 'ax', x1: M.l, x2: W - M.r, y1: y, y2: y }, ax); el('text', { class: 'at', x: M.l - 6, y: y + 3.5, 'text-anchor': 'end' }, ax).textContent = fmt.short(v); }
      var slot = (W - M.l - M.r) / n, bw = Math.max(4, Math.min(34, slot - 8));
      data.forEach(function (d, i) {
        var cx = M.l + slot * (i + .5);
        el('text', { class: 'at', x: cx, y: H - 6, 'text-anchor': 'middle' }, ax).textContent = d.x;
        var acc = 0; keys.forEach(function (k, j) {
          var v = vals[i] ? vals[i][j] : 0; if (v <= 0) return; var y0 = yAt(acc), y1 = yAt(acc + v); acc += v;
          var hh = Math.max(1, y0 - y1 - 2); el('rect', { class: 'sg s-' + j + ' s-' + k, x: (cx - bw / 2).toFixed(1), y: y1.toFixed(1), width: bw.toFixed(1), height: hh.toFixed(1), rx: Math.min(2, hh / 2) }, g);
        });
        var r = el('rect', { class: 'hitb', x: (M.l + slot * i).toFixed(1), y: M.t, width: slot.toFixed(1), height: H - M.t - M.b, tabindex: 0, role: 'img', 'aria-label': (d.long || d.x) + ': ' + keys.map(function (k, j) { return (d[k] || 0) + ' ' + labels[j].toLowerCase(); }).join(', ') }, hit);
        var tipRows = function () { return [{ v: fmt.num(keys.reduce(function (a, k) { return a + (+d[k] || 0); }, 0)) + (o.unit ? ' ' + o.unit : ''), label: d.long || d.x }].concat(keys.map(function (k, j) { return { v: fmt.num(d[k] || 0), label: labels[j] }; })); };
        r.addEventListener('pointermove', function (e) { showTip(e.clientX, e.clientY, tipRows()); });
        r.addEventListener('focus', function () { var b = r.getBoundingClientRect(); showTip(b.left + b.width / 2, b.top + 20, tipRows()); });
        r.addEventListener('pointerleave', hideTip); r.addEventListener('blur', hideTip);
      });
    }
    return {
      offline: function (msg) { if (!data.length) empty.textContent = msg || 'Source offline'; },
      update: function (rows) {
        data = rows || []; fit(); if (!data.length) { empty.textContent = o.emptyText || 'No data'; draw([]); return; } empty.textContent = '';
        var next = data.map(function (d) { return keys.map(function (k) { return +d[k] || 0; }); });
        var from = shown.length === next.length ? shown : next.map(function (r) { return r.map(function () { return 0; }); });
        if (raf) cancelAnimationFrame(raf);
        if (api.reduced) { shown = next; draw(shown); }
        else { var t0 = performance.now(); (function st(t) { var k = Math.min(1, (t - t0) / 900), e = ease(k); shown = next.map(function (r, i) { return r.map(function (v, j) { return from[i][j] + (v - from[i][j]) * e; }); }); draw(shown); if (k < 1) raf = requestAnimationFrame(st); else { shown = next; raf = null; } })(t0); }
        tbl.innerHTML = ''; var cap = doc.createElement('caption'); cap.textContent = o.name || 'Stacked bar chart'; tbl.appendChild(cap);
        var tr = h('tr'); ['Bucket'].concat(labels).forEach(function (x) { tr.appendChild(h('th', null, x)); }); tbl.appendChild(tr);
        data.forEach(function (d) { var r = h('tr'); r.appendChild(h('td', null, d.long || d.x)); keys.forEach(function (k) { r.appendChild(h('td', null, String(d[k] || 0))); }); tbl.appendChild(r); });
      },
    };
  }
  api.Stacked = Stacked;

  // ------------------------------------------------------------------ Donut (shares) and Gauge (one value of a max)
  function arcPath(cx, cy, r, a0, a1) { var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1); return 'M' + x0.toFixed(2) + ' ' + y0.toFixed(2) + ' A' + r + ' ' + r + ' 0 ' + (a1 - a0 > Math.PI ? 1 : 0) + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2); }
  // Donut(el, {name, center:'label under the total', format(v)}) -> { update([{label, v}]), offline(text) }
  function Donut(node, o) {
    node = $(node); o = o || {}; var S = 160, R = 62, SW = 16, shown = [];
    var svg = el('svg', { class: 't-svg', viewBox: '0 0 ' + S + ' ' + S, role: 'img', 'aria-label': o.name || 'Donut chart' }); node.appendChild(svg);
    el('circle', { class: 'trk', cx: S / 2, cy: S / 2, r: R, 'stroke-width': SW }, svg); var g = el('g', {}, svg);
    var tv = el('text', { class: 'cv', x: S / 2, y: S / 2 + 4, 'text-anchor': 'middle' }, svg), tl = el('text', { class: 'cl', x: S / 2, y: S / 2 + 22, 'text-anchor': 'middle' }, svg);
    tv.textContent = '–'; tl.textContent = o.waitText || 'waiting';
    var legend = h('div', 't-legend'); legend.style.marginTop = '10px'; node.appendChild(legend);
    function draw(vals, items) {
      g.textContent = ''; var tot = vals.reduce(function (a, b) { return a + b; }, 0); if (!tot) return; var a = -Math.PI / 2, gap = vals.filter(function (v) { return v > 0; }).length > 1 ? .025 : 0;
      vals.forEach(function (v, i) { if (v <= 0) return; var sw = v / tot * Math.PI * 2; var p = el('path', { class: 'arc s-' + Math.min(i, 4), d: arcPath(S / 2, S / 2, R, a + gap / 2, a + Math.max(gap, sw - gap / 2) + (sw >= Math.PI * 2 - .001 ? -.0001 : 0)), 'stroke-width': SW }, g); var it = items[i]; p.addEventListener('pointermove', function (e) { showTip(e.clientX, e.clientY, [{ v: (o.format || fmt.num)(it.v), label: it.label + ' · ' + (it.v / tot * 100).toFixed(1) + '%' }]); }); p.addEventListener('pointerleave', hideTip); a += sw; });
    }
    return {
      update: function (items) {
        items = (items || []).filter(function (x) { return isReal(x.v) && x.v >= 0; }); var vals = items.map(function (x) { return +x.v; }), tot = vals.reduce(function (a, b) { return a + b; }, 0);
        legend.textContent = ''; items.forEach(function (x, i) { var s = h('span'); var dot = h('i'); dot.style.setProperty('--c', 'var(--t-s' + (Math.min(i, 4) + 1) + ')'); s.appendChild(dot); s.appendChild(doc.createTextNode(x.label + ' ' + (o.format || fmt.num)(x.v))); legend.appendChild(s); });
        if (!tot) { g.textContent = ''; tv.textContent = '–'; tl.textContent = o.emptyText || 'no data'; return; }
        tl.textContent = o.center || 'total'; countToSvg(tv, tot, o.format);
        var from = shown.length === vals.length ? shown : vals.map(function () { return 0; }); shown = vals;
        if (api.reduced) { draw(vals, items); return; } var t0 = performance.now(); (function st(t) { var k = ease(Math.min(1, (t - t0) / 900)); draw(from.map(function (f, i) { return f + (vals[i] - f) * k; }), items); if (k < 1) requestAnimationFrame(st); })(t0);
        svg.setAttribute('aria-label', (o.name || 'Donut chart') + ': ' + items.map(function (x) { return x.label + ' ' + x.v; }).join(', '));
      },
      offline: function (text) { if (!shown.length) { tv.textContent = '–'; tl.textContent = text || 'offline'; } },
    };
  }
  function countToSvg(t, to, f) { var from = parseFloat(t.getAttribute('data-v')); t.setAttribute('data-v', to); var out = f || function (v) { return fmt.short(v); }; if (api.reduced || !isFinite(from)) { t.textContent = out(to); return; } var t0 = performance.now(); (function st(n) { var k = Math.min(1, (n - t0) / 800); t.textContent = out(from + (to - from) * ease(k)); if (k < 1) requestAnimationFrame(st); })(t0); }
  // Gauge(el, {name, max, label, format(v)}) -> { update(value, label?), offline(text) }  (a 240-degree arc)
  function Gauge(node, o) {
    node = $(node); o = o || {}; var S = 160, R = 64, SW = 10, A0 = Math.PI * 5 / 6, SPAN = Math.PI * 4 / 3, cur = 0;
    var svg = el('svg', { class: 't-svg', viewBox: '0 0 ' + S + ' ' + (S - 20), role: 'img', 'aria-label': o.name || 'Gauge' }); node.appendChild(svg);
    el('path', { class: 'trk', d: arcPath(S / 2, S / 2, R, A0, A0 + SPAN), 'stroke-width': SW, 'stroke-linecap': 'round' }, svg);
    var arc = el('path', { class: 'arc', 'stroke-width': SW, 'stroke-linecap': 'round' }, svg);
    var tv = el('text', { class: 'cv', x: S / 2, y: S / 2 + 6, 'text-anchor': 'middle' }, svg), tl = el('text', { class: 'cl', x: S / 2, y: S / 2 + 24, 'text-anchor': 'middle' }, svg); tv.textContent = '–'; tl.textContent = o.label || '';
    function draw(f) { f = Math.max(0, Math.min(1, f)); if (f <= 0.001) arc.removeAttribute('d'); else arc.setAttribute('d', arcPath(S / 2, S / 2, R, A0, A0 + SPAN * f)); }
    return {
      update: function (v, label) {
        if (!isReal(v)) { this.offline(o.emptyText || 'no data'); return; } var mx = o.max || 100, to = Math.max(0, Math.min(1, v / mx)); if (label != null) tl.textContent = label;
        countToSvg(tv, +v, o.format); svg.setAttribute('aria-label', (o.name || 'Gauge') + ': ' + (o.format ? o.format(v) : v) + ' of ' + mx);
        if (api.reduced) { cur = to; draw(to); return; } var from = cur, t0 = performance.now(); cur = to; (function st(t) { var k = ease(Math.min(1, (t - t0) / 900)); draw(from + (to - from) * k); if (k < 1) requestAnimationFrame(st); })(t0);
      },
      offline: function (text) { tv.textContent = '–'; tl.textContent = text || 'offline'; draw(0); cur = 0; },
    };
  }
  api.Donut = Donut; api.Gauge = Gauge;

  // ------------------------------------------------------------------ Uptime strip (one row per service, one cell per check)
  // Uptime(el, {cells: 24, onRow(a, svc)}) -> { update([{key, name, url, up, ms, history:[{t, ms|null, up?}]}]), offline(text) }
  function Uptime(node, o) {
    node = $(node); o = o || {}; var N = o.cells || 24; node.classList.add('t-uptime');
    return {
      update: function (svcs) {
        if (!svcs || !svcs.length) { this.offline(o.emptyText || 'No services reported'); return; }
        var seen = {};
        svcs.forEach(function (s) {
          var id = 'tu-' + String(s.key || s.name).replace(/[^\w-]/g, ''); seen[id] = 1; var row = node.querySelector('[data-k="' + id + '"]');
          if (!row) {
            row = h(s.url ? 'a' : 'div', 't-uptime-row'); row.setAttribute('data-k', id); if (s.url) { row.href = s.url; linkRule(row); }
            var n = h('span', 'n'); n.appendChild(h('span', 't-dot')); n.appendChild(h('span', null, s.name)); row.appendChild(n);
            var cells = h('span', 't-uptime-cells'); cells.setAttribute('aria-hidden', 'true'); for (var i = 0; i < N; i++) cells.appendChild(h('i', 'n')); row.appendChild(cells);
            row.appendChild(h('span', 'ms')); node.appendChild(row); if (o.onRow) o.onRow(row, s);
          }
          var hist = (s.history || []).slice(-N), cs = row.querySelector('.t-uptime-cells').children, off = N - hist.length;
          for (var j = 0; j < N; j++) { var x = hist[j - off]; cs[j].className = !x ? 'n' : (x.up === false || x.ms == null) ? 'd' : ''; cs[j].title = x ? new Date(x.t).toLocaleTimeString() + (x.ms != null ? ' · ' + x.ms + ' ms' : ' · down') : 'no check'; }
          row.querySelector('.t-dot').className = 't-dot ' + (s.up ? 'is-live' : 'is-down');
          var ok = hist.filter(function (x) { return x.up !== false && x.ms != null; }).length;
          row.querySelector('.ms').textContent = s.up ? (isReal(s.ms) ? Math.round(s.ms) + ' ms' : 'up') : 'down';
          row.setAttribute('aria-label', s.name + ': ' + (s.up ? 'up' : 'down') + (isReal(s.ms) ? ', ' + Math.round(s.ms) + ' ms' : '') + ', ' + ok + ' of ' + hist.length + ' recent checks answered');
        });
        Array.prototype.forEach.call(node.querySelectorAll('.t-uptime-row'), function (r) { if (!seen[r.getAttribute('data-k')]) r.remove(); });
        var e = node.querySelector('.t-empty'); if (e) e.remove();
      },
      offline: function (text) { if (!node.querySelector('.t-uptime-row')) { node.textContent = ''; node.appendChild(h('div', 't-empty', text || 'Status source offline')); } },
    };
  }
  api.Uptime = Uptime;

  // ------------------------------------------------------------------ Ticker (marquee of live items)
  // Ticker(el) -> { update([{text, strong, href, title}]) }; el = .t-ticker-v. The track is doubled for a seamless loop.
  function Ticker(node, o) {
    node = $(node); o = o || {}; var trk = node.querySelector('.t-ticker-trk'); if (!trk) { trk = h('div', 't-ticker-trk'); node.appendChild(trk); }
    return {
      update: function (items) {
        if (!items || !items.length) { trk.textContent = ''; trk.appendChild(h('span', 't-ticker-it', o.emptyText || 'Nothing to show yet')); trk.style.animation = 'none'; return; }
        trk.style.animation = ''; trk.textContent = '';
        for (var pass = 0; pass < 2; pass++) items.forEach(function (it) {
          var a = h(it.href ? 'a' : 'span', 't-ticker-it'); if (it.href) { a.href = it.href; linkRule(a); }
          if (pass) { a.setAttribute('aria-hidden', 'true'); a.tabIndex = -1; }
          if (it.strong) a.appendChild(h('b', null, it.strong)); a.appendChild(doc.createTextNode(it.text || '')); if (it.title) a.title = it.title; trk.appendChild(a);
        });
        trk.style.setProperty('--t-tape-dur', Math.max(30, items.length * 6) + 's');
      },
    };
  }
  api.Ticker = Ticker;

  // ------------------------------------------------------------------ Gully hub (gullylabs.xyz/api/hub, open CORS)
  api.HUB = 'https://gullylabs.xyz/api/hub';
  /** the hub's services, filtered: hubServices({keys:[...]} | {group:'chain'}) */
  api.hub = function (filter) { return json(api.HUB).then(function (d) { var s = d.services || []; if (filter && filter.keys) s = s.filter(function (x) { return filter.keys.indexOf(x.key) >= 0; }); if (filter && filter.group) s = s.filter(function (x) { return x.group === filter.group; }); d.picked = s; return d; }); };

  return api;
});
