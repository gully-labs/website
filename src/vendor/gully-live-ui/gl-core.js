/*
 * Gully Live UI: shared helpers (gl-core.js). Canonical source: gully-labs/gully-ops sites/_shared/gully-live-ui/.
 * Copy files byte-identical; theme with CSS custom properties (tokens.css), never by editing a component.
 */
export const GULLY_LIVE_UI_VERSION = '1.0.4';

/** true when the visitor asked for less motion (and in environments without matchMedia). */
export const reducedMotion = () => typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Define a custom element once (two copies of the kit on one page must not throw). */
export function define(name, cls) {
  if (typeof customElements === 'undefined' || customElements.get(name)) return;
  customElements.define(name, cls);
}

/** Read a CSS custom property from an element, with a fallback. */
export function token(el, name, fallback = '') {
  if (typeof getComputedStyle !== 'function') return fallback;
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

/** Compact number for tiles and axes: 950, 9,500, 12.4K, 3.1M, 2.0B. digits = max fraction digits under 1,000. */
export function fmtNum(n, { digits = 2, compact = true } = {}) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '–';
  const x = Number(n), a = Math.abs(x);
  if (compact && a >= 1e4) {
    const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (const [v, u] of units) if (a >= v) return `${(x / v).toFixed(a / v >= 100 ? 0 : 1)}${u}`;
  }
  if (a >= 1000) return Math.round(x).toLocaleString('en-US');
  // Under 1: significant digits, so a token priced 0.00000123 reads 0.00000123, not 0.0000 (1.0.1).
  if (a > 0 && a < 1) return x.toLocaleString('en-US', { maximumSignificantDigits: Math.max(digits + 1, 4), maximumFractionDigits: 20 });
  return x.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** Format with a unit: usd → $1.2M, pct → +3.4% (a signed change), percent → 0.3% (a plain share or fee, no sign, 1.0.4),
 * plain → fmtNum. `percent` keeps up to opts.digits (default 2) fraction digits and drops trailing zeros: 0.3%, 12.5%, 100%. */
export function fmtValue(n, unit = '', opts = {}) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '–';
  if (unit === 'usd') return (Number(n) < 0 ? '-$' : '$') + fmtNum(Math.abs(Number(n)), opts);
  if (unit === 'pct') return `${Number(n) >= 0 ? '+' : ''}${Number(n).toFixed(1)}%`;
  if (unit === 'percent') return `${Number(n).toLocaleString('en-US', { maximumFractionDigits: opts.digits ?? 2 })}%`;
  return fmtNum(n, opts) + (unit && unit !== 'plain' ? ` ${unit}` : '');
}

/** Ease a number from a to b over ms, calling step(v) each frame; instant under reduced motion. Returns a cancel fn. */
export function tween(a, b, ms, step) {
  if (reducedMotion() || typeof requestAnimationFrame !== 'function' || a === b || !Number.isFinite(a)) { step(b); return () => {}; }
  let raf = 0; const t0 = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    step(a + (b - a) * e);
    if (k < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/**
 * The never-empty fallback ladder (design-gap gate): given what a chart has, pick what it shows.
 *   loading                    → 'shimmer' (only while the first request is in flight)
 *   a series with ≥ 2 points   → 'series'
 *   else sampled quotes ≥ 2    → 'sampled' (labelled)
 *   else chain activity ≥ 2    → 'activity' (labelled: "No pool yet, showing … activity")
 *   else                       → 'empty' (an honest one-line state, never an empty frame)
 */
export function pickRung({ loading = false, series = [], sampled = [], activity = [] } = {}) {
  if (loading) return 'shimmer';
  if (series?.length >= 2) return 'series';
  if (sampled?.length >= 2) return 'sampled';
  if (activity?.length >= 2) return 'activity';
  return 'empty';
}

/** Parse one Server-Sent Events block ("event: x\ndata: {...}") into { event, data } or null. */
export function parseSse(block) {
  let event = 'message'; const data = [];
  for (const line of String(block).split(/\r?\n/)) {
    if (line.startsWith(':') || !line) continue;
    const i = line.indexOf(':'); const k = i < 0 ? line : line.slice(0, i); const v = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
    if (k === 'event') event = v; else if (k === 'data') data.push(v);
  }
  if (!data.length) return null;
  const raw = data.join('\n');
  try { return { event, data: JSON.parse(raw) }; } catch { return { event, data: raw }; }
}

/** The live event schema every feed speaks: { ts, chainId, kind, title, amount, href }. Drops anything malformed. */
export function normalizeEvent(e) {
  if (!e || typeof e !== 'object' || typeof e.title !== 'string' || !e.title) return null;
  const ts = Number(e.ts ?? Date.now());
  return { ts: Number.isFinite(ts) ? ts : Date.now(), chainId: e.chainId == null ? null : Number(e.chainId), kind: String(e.kind || 'event'), title: e.title.slice(0, 140), amount: e.amount ?? null, href: typeof e.href === 'string' && /^(https?:)?\/\//.test(e.href) || String(e.href || '').startsWith('/') ? e.href : null };
}

/** "12 s ago", "4 min ago", "3 h ago", "2 d ago". */
export function ago(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s} s ago`; if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`; return `${Math.round(s / 86400)} d ago`;
}

/** Deterministic identicon colours from an address, on the host palette (never a letter blob). */
export function identicon(address, palette = ['#FD7716', '#0F0E0B', '#FEF4E3', '#C25A0F', '#6B655A']) {
  const h = String(address || '').toLowerCase().replace(/^0x/, '').padEnd(40, '0');
  const cells = []; for (let i = 0; i < 15; i++) cells.push(parseInt(h[i], 16) % 2 === 0);
  const fg = palette[parseInt(h.slice(15, 17), 16) % 2 === 0 ? 0 : 3] || palette[0];
  return { bg: palette[2] || '#eee', fg, cells };
}

/** 1, 2, 2.5 or 5 × 10^n: clean axis steps (0 / 10K / 20K, never 12.67). */
export function niceStep(raw) {
  if (!(raw > 0)) return 1; const e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}

/** The chart's value axis: range, step and the labelled ticks (1.0.2). Lines and areas keep a span of at least 1 % of
 * the value, so a near-flat series is not stretched into a cliff; ticks whose labels would read the same (a flat $101K
 * printing "$101K" four times) collapse to one label at the middle of the data. */
export function axisScale(vs, kind, fmt) {
  const lo = Math.min(...vs), hi = Math.max(...vs);
  let mn = lo, mx = hi;
  if (kind === 'bars' || mn > 0 && (mx - mn) / mx > .5) mn = Math.min(0, mn);
  if (kind !== 'bars') { const minSpan = Math.max(Math.abs(mn), Math.abs(mx)) * 0.01; if (mx - mn < minSpan) { const c = (mn + mx) / 2; mn = c - minSpan / 2; mx = c + minSpan / 2; } }
  if (mx === mn) { mx += 1; mn -= kind === 'bars' ? 0 : 1; }
  const step = niceStep((mx - mn) / 3); mn = Math.floor(mn / step + 1e-9) * step; mx = Math.ceil(mx / step - 1e-9) * step; if (mx === mn) mx = mn + step;
  const n = Math.round((mx - mn) / step), all = [];
  for (let i = 0; i <= n; i++) { const v = mn + i * step; all.push({ v, label: fmt(v) }); }
  let ticks = all.filter((t, i) => i === 0 || t.label !== all[i - 1].label);
  if (ticks.length < all.length) { const mid = (lo + hi) / 2; ticks = new Set(all.map((t) => t.label)).size === 1 ? [{ v: mid, label: fmt(mid) }] : ticks; }
  return { mn, mx, step, ticks };
}

/** Escape text for innerHTML. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
