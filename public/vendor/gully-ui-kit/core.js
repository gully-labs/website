// Gully UI Kit core: tokens, user preferences, lazy vendor chunks, frames and number formats. No colours live in this
// file or any wrapper: every colour is read from the --gu-* tokens (tokens.css) of the element a component mounts in.
export const VERSION = '1.0.0';

const LOADERS = {
  echarts: () => import('./vendor/echarts.js'),
  uplot: () => import('./vendor/uplot.js'),
  lwc: () => import('./vendor/lwc.js'),
  tabulator: () => import('./vendor/tabulator.js'),
  floating: () => import('./vendor/floating.js'),
  motion: () => import('./vendor/motion.js'),
  lottie: () => import('./vendor/lottie.js'),
  three: () => import('./vendor/three.js'),
  purify: () => import('./vendor/purify.js'),
};
const loaded = new Map();
/** load one vendor chunk once (a lazy ES module next to this file) */
export function lazy(name) {
  if (!LOADERS[name]) throw new Error(`gully-ui-kit: no chunk ${name}`);
  if (!loaded.has(name)) loaded.set(name, LOADERS[name]());
  return loaded.get(name);
}
const cssDone = new Set();
/** add a kit stylesheet once (<link>, so style-src 'self' is enough) */
export function css(file) {
  const href = new URL(file, import.meta.url).href;
  if (cssDone.has(href) || typeof document === 'undefined') return;
  cssDone.add(href);
  if ([...document.styleSheets].some((s) => s.href === href)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href; l.dataset.guKit = '';
  document.head.appendChild(l);
}

export const TOKEN_NAMES = ['ink', 'ink-2', 'muted', 'surface', 'surface-2', 'line', 'grid', 'accent', 'on-accent', 'up', 'down', 'warn', 'focus', 'font', 'font-num', 'radius'];
/** the --gu-* tokens as seen by el (so a wrapper or a theme class scopes them) */
export function tokens(el) {
  const cs = getComputedStyle(el || document.documentElement);
  const t = {};
  for (const n of TOKEN_NAMES) t[n.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = cs.getPropertyValue('--gu-' + n).trim();
  t.series = [1, 2, 3, 4, 5].map((i) => cs.getPropertyValue('--gu-series-' + i).trim()).filter(Boolean);
  if (!t.ink) t.ink = cs.color;
  if (!t.muted) t.muted = t.ink;
  if (!t.line) t.line = t.muted;
  if (!t.grid) t.grid = t.line;
  if (!t.series.length) t.series = [t.accent || t.ink];
  t.family = cs.getPropertyValue('--gu-family').trim() || cs.fontFamily;
  t.familyNum = cs.getPropertyValue('--gu-family-num').trim() || t.family;
  return t;
}

const mq = (q) => typeof matchMedia === 'function' && matchMedia(q).matches;
export const prefs = {
  reducedMotion: () => mq('(prefers-reduced-motion: reduce)'),
  saveData: () => { const c = typeof navigator !== 'undefined' && navigator.connection; return !!(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))); },
  /** motion is allowed: no reduced motion, no Save-Data, and the page did not switch it off (<html data-gu-motion="off">) */
  motion: () => !prefs.reducedMotion() && !prefs.saveData() && document.documentElement.dataset.guMotion !== 'off',
  /** a desktop-class device that may run WebGL scenes */
  capable3d: () => {
    if (!prefs.motion() || !mq('(min-width: 900px)')) return false;
    const n = typeof navigator !== 'undefined' ? navigator : {};
    if (n.deviceMemory && n.deviceMemory < 4) return false;
    if (n.hardwareConcurrency && n.hardwareConcurrency < 4) return false;
    try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
  },
};

/** call cb when the theme may have changed: <html> class/data-theme/style, the OS colour scheme, reduced motion */
export function onThemeChange(cb) {
  let t = 0;
  const fire = () => { clearTimeout(t); t = setTimeout(cb, 16); };
  const mo = new MutationObserver(fire);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style', 'data-gu-motion'] });
  if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
  const qs = ['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)'].map((q) => typeof matchMedia === 'function' ? matchMedia(q) : null).filter(Boolean);
  qs.forEach((q) => q.addEventListener('change', fire));
  return () => { mo.disconnect(); qs.forEach((q) => q.removeEventListener('change', fire)); clearTimeout(t); };
}

/** run cb once el is near the viewport (200 px margin); returns a stop function */
export function inView(el, cb, { margin = '200px', once = true } = {}) {
  if (typeof IntersectionObserver !== 'function') { cb(true); return () => {}; }
  const io = new IntersectionObserver((es) => { for (const e of es) { cb(e.isIntersecting); if (once && e.isIntersecting) io.disconnect(); } }, { rootMargin: margin });
  io.observe(el);
  return () => io.disconnect();
}

/** the frame every component draws in: reserved height (no layout shift), states loading | ready | empty | error.
 *  An empty or error frame always prints one plain line, never an empty box. */
export function frame(el, state, message) {
  css('./ui-kit.css');
  el.classList.add('gu-frame');
  el.dataset.guState = state;
  el.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
  let note = el.querySelector(':scope > .gu-note');
  if (state === 'empty' || state === 'error') {
    if (!note) { note = document.createElement('p'); note.className = 'gu-note'; el.appendChild(note); }
    note.textContent = message || (state === 'empty' ? 'No data yet' : 'This could not load just now');
  } else if (note) note.remove();
  let plot = el.querySelector(':scope > .gu-plot');
  if (!plot) { plot = document.createElement('div'); plot.className = 'gu-plot'; el.prepend(plot); }
  return plot;
}

/** keep a component sized to its frame */
export function onResize(el, cb) {
  if (typeof ResizeObserver !== 'function') return () => {};
  let w = 0, h = 0;
  const ro = new ResizeObserver(([e]) => { const r = e.contentRect; if (Math.abs(r.width - w) > 1 || Math.abs(r.height - h) > 1) { w = r.width; h = r.height; cb(r); } });
  ro.observe(el);
  return () => ro.disconnect();
}

/* numbers: USD first, compact, no trailing zeros */
export function fmtUsd(v, { compact = true } = {}) {
  if (v == null || !isFinite(v)) return 'unpriced';
  const a = Math.abs(v);
  if (compact && a >= 1000) return (v < 0 ? '-$' : '$') + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: a >= 1e6 ? 2 : 1 }).format(a);
  if (a > 0 && a < 1) return (v < 0 ? '-$' : '$') + a.toPrecision(4).replace(/\.?0+$/, '');
  return (v < 0 ? '-$' : '$') + a.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
export function fmtNum(v) {
  if (v == null || !isFinite(v)) return '-';
  const a = Math.abs(v);
  if (a >= 10000) return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  if (a > 0 && a < 1) return Number(v.toPrecision(4)).toString();
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
export function fmtPct(v) { return v == null || !isFinite(v) ? '-' : (v > 0 ? '+' : '') + v.toFixed(Math.abs(v) < 10 ? 2 : 1).replace(/\.?0+$/, '') + '%'; }
/** liquidity under this many USD gets the Thin chip (money figures are always USD, with a Thin chip when liquidity is low) */
export const THIN_USD = 500;
export function thinChip(liquidityUsd) {
  const c = document.createElement('span');
  c.className = 'gu-chip gu-thin';
  c.textContent = 'Thin';
  c.title = `Liquidity ${fmtUsd(liquidityUsd)}: under ${fmtUsd(THIN_USD, { compact: false })}, prices move a lot`;
  return c;
}
/** text node helper (never innerHTML) */
export function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
/** a token colour with alpha, for canvas libraries (normalised by the browser's own colour parser) */
let probe;
export function withAlpha(color, a) {
  probe ||= document.createElement('canvas').getContext('2d');
  probe.fillStyle = 'transparent'; probe.fillStyle = color;
  const v = probe.fillStyle;
  if (v[0] === '#') { const n = parseInt(v.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
  const m = v.match(/[\d.]+/g); return m ? `rgba(${m[0]},${m[1]},${m[2]},${a})` : color;
}
