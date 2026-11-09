/*
 * <gl-chart kind="area|line|bars" title="Volume, 24 h" unit="usd" height="180"></gl-chart>
 * el.data = { series:[[t,v],...], sampled:[[t,v],...], activity:[[t,v],...], loading:bool, activityLabel:'…' }
 * el.push([t,v])  appends a live tick (animated, keeps the last `max` points, default 240).
 * Never renders an empty frame (fallback ladder, gl-core pickRung): series → sampled quotes (labelled) → chain activity
 * (labelled) → shimmer only while loading → one honest line. Canvas, 60 fps, one axis, 2 px line, 10 % area wash,
 * bars ≤ 24 px with 4 px rounded data-ends and a 2 px surface gap, hairline grid, crosshair + tooltip, table view for
 * screen readers. Colours come from --gl-accent / --gl-line / --gl-muted / --gl-surface (tokens.css).
 */
import { define, fmtValue, pickRung, reducedMotion, token, esc, niceStep } from './gl-core.js';

const CSS = `:host{display:block;position:relative;font:var(--gl-font);color:var(--gl-ink);min-width:0}
.hd{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin:0 0 8px}
.t{font-weight:600}.n{color:var(--gl-muted);font-size:.82em}
.wrap{position:relative}canvas{display:block;width:100%}
.tip{position:absolute;pointer-events:none;transform:translate(-50%,-110%);background:var(--gl-ink);color:var(--gl-surface);border-radius:8px;padding:5px 8px;font-size:.8em;white-space:nowrap;opacity:0;transition:opacity .12s}
.tip.on{opacity:1}
.sk{border-radius:10px;background:linear-gradient(90deg,var(--gl-surface-2),var(--gl-line),var(--gl-surface-2));background-size:200% 100%;animation:s 1.4s linear infinite}
@keyframes s{from{background-position:200% 0}to{background-position:-200% 0}}
.empty{display:flex;align-items:center;justify-content:center;color:var(--gl-muted);border:1px dashed var(--gl-line);border-radius:10px;font-size:.9em;padding:0 16px;text-align:center}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media (prefers-reduced-motion:reduce){.sk{animation:none}}`;

const LABEL = { sampled: 'Sampled quotes, no pool candles yet', activity: 'No pool yet, showing chain activity' };

export class GlChart extends HTMLElement {
  static observedAttributes = ['kind', 'title', 'unit', 'height', 'empty'];
  constructor() {
    super(); this._r = this.attachShadow({ mode: 'open' }); this._d = { loading: true }; this._pts = []; this._from = null; this._k = 1;
    this._ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.draw()) : null;
  }
  connectedCallback() { this.render(); this._ro?.observe(this); }
  disconnectedCallback() { this._ro?.disconnect(); cancelAnimationFrame(this._raf); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }
  set data(d) { this._d = d || {}; this.render(); }
  get data() { return this._d; }
  push(p, max = 240) {
    const s = (this._d.series ||= []); s.push(p); if (s.length > max) s.splice(0, s.length - max);
    this._d.loading = false; if (this._rung !== 'series') return this.render();
    this._from = this._pts.slice(); this._pts = s.slice(); this.animate();
  }
  render() {
    const h = Number(this.getAttribute('height') || 180), title = this.getAttribute('title') || '';
    const rung = pickRung(this._d); this._rung = rung;
    const pts = rung === 'series' ? this._d.series : rung === 'sampled' ? this._d.sampled : rung === 'activity' ? this._d.activity : [];
    const note = rung === 'activity' ? (this._d.activityLabel || LABEL.activity) : LABEL[rung] || '';
    let body;
    if (rung === 'shimmer') body = `<div class="sk" style="height:${h}px" part="skeleton" aria-busy="true"></div>`;
    else if (rung === 'empty') body = `<div class="empty" style="height:${Math.min(h, 96)}px" part="empty">${esc(this.getAttribute('empty') || 'No activity yet. It shows here the moment the first trade lands.')}</div>`;
    else body = `<div class="wrap"><canvas part="canvas" style="height:${h}px" role="img" aria-label="${esc(title || 'chart')}"></canvas><div class="tip"></div></div>${this.table(pts)}`;
    this._r.innerHTML = `<style>${CSS}</style>${title || note ? `<div class="hd"><span class="t">${esc(title)}</span><span class="n">${esc(note)}</span></div>` : ''}${body}`;
    if (!pts.length) return;
    this._from = this._pts.length ? this._pts.slice() : null; this._pts = pts.slice();
    const cv = this._r.querySelector('canvas');
    cv.onpointermove = (e) => this.hover(e); cv.onpointerleave = () => { this._hx = null; this.draw(); this._r.querySelector('.tip').classList.remove('on'); };
    this.animate();
  }
  table(pts) {
    const u = this.getAttribute('unit') || '', rows = pts.slice(-24).map(([t, v]) => `<tr><td>${esc(new Date(Number(t)).toISOString())}</td><td>${esc(fmtValue(v, u))}</td></tr>`).join('');
    return `<table class="sr"><caption>${esc(this.getAttribute('title') || 'data')}, latest ${Math.min(24, pts.length)} points</caption><tbody>${rows}</tbody></table>`;
  }
  animate() {
    cancelAnimationFrame(this._raf);
    if (reducedMotion()) { this._k = 1; return this.draw(); }
    const t0 = performance.now();
    const step = (t) => { this._k = Math.min(1, (t - t0) / 650); this.draw(); if (this._k < 1) this._raf = requestAnimationFrame(step); };
    this._raf = requestAnimationFrame(step);
  }
  geom() {
    const cv = this._r.querySelector('canvas'); if (!cv) return null;
    const w = cv.clientWidth, h = cv.clientHeight, pad = { l: 4, r: 52, t: 8, b: 20 };
    const p = this._pts, vs = p.map((x) => Number(x[1]));
    const kind = this.getAttribute('kind') || 'area';
    let mn = Math.min(...vs), mx = Math.max(...vs); if (kind === 'bars' || mn > 0 && (mx - mn) / mx > .5) mn = Math.min(0, mn);
    if (mx === mn) { mx += 1; mn -= kind === 'bars' ? 0 : 1; }
    const step = niceStep((mx - mn) / 3); mn = Math.floor(mn / step + 1e-9) * step; mx = Math.ceil(mx / step - 1e-9) * step; if (mx === mn) mx = mn + step;
    const span = mx - mn, x = (i) => pad.l + (p.length < 2 ? 0.5 : i / (p.length - 1)) * (w - pad.l - pad.r), y = (v) => pad.t + (1 - (v - mn) / span) * (h - pad.t - pad.b);
    return { cv, w, h, pad, p, vs, mn, mx, x, y, kind, step };
  }
  draw() {
    const g = this.geom(); if (!g) return; const { cv, w, h, pad, p, mn, mx, x, y, kind, step } = g;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1); cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const c = cv.getContext('2d'); if (!c) return; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const acc = token(this, '--gl-series-1', '#D45F00'), line = token(this, '--gl-line', '#E3D9C7'), muted = token(this, '--gl-muted', '#6B655A'), surf = token(this, '--gl-surface', '#fff');
    const u = this.getAttribute('unit') || '';
    // hairline grid + right-hand ticks (one axis, clean values)
    c.strokeStyle = line; c.lineWidth = 1; c.fillStyle = muted; c.font = '11px system-ui, sans-serif'; c.textBaseline = 'middle';
    for (let v = mn; v <= mx + step / 2; v += step) { const yy = Math.round(y(v)) + .5; c.beginPath(); c.moveTo(pad.l, yy); c.lineTo(w - pad.r, yy); c.stroke(); c.fillText(fmtValue(v, u, { digits: 2 }), w - pad.r + 6, yy); }
    const k = this._k, from = this._from;
    const val = (i) => { const v = Number(p[i][1]); if (!from || !from[i] || k >= 1) return k >= 1 || from ? v : mn + (v - mn) * k; return Number(from[i][1]) + (v - Number(from[i][1])) * k; };
    if (kind === 'bars') {
      const slot = (w - pad.l - pad.r) / p.length, bw = Math.max(1, Math.min(24, slot - 2)), base = y(Math.max(0, mn));
      c.fillStyle = acc;
      p.forEach((_, i) => { const cx = pad.l + slot * (i + .5), top = y(val(i)), hh = Math.max(1, base - top), r = Math.min(4, bw / 2, hh); const lx = cx - bw / 2;
        c.beginPath(); c.moveTo(lx, base); c.lineTo(lx, top + r); c.quadraticCurveTo(lx, top, lx + r, top); c.lineTo(lx + bw - r, top); c.quadraticCurveTo(lx + bw, top, lx + bw, top + r); c.lineTo(lx + bw, base); c.closePath();
        c.globalAlpha = this._hx == null || this._hx === i ? 1 : .45; c.fill(); });
      c.globalAlpha = 1;
    } else {
      const n = p.length, upto = from ? n : Math.max(2, Math.ceil(n * k));
      c.beginPath(); for (let i = 0; i < upto; i++) { const X = x(i), Y = y(val(i)); i ? c.lineTo(X, Y) : c.moveTo(X, Y); }
      if (kind === 'area') { c.save(); c.lineTo(x(upto - 1), h - pad.b); c.lineTo(x(0), h - pad.b); c.closePath(); c.globalAlpha = .1; c.fillStyle = acc; c.fill(); c.restore();
        c.beginPath(); for (let i = 0; i < upto; i++) { const X = x(i), Y = y(val(i)); i ? c.lineTo(X, Y) : c.moveTo(X, Y); } }
      c.strokeStyle = acc; c.lineWidth = 2; c.lineJoin = c.lineCap = 'round'; c.stroke();
      const li = (this._hx ?? upto - 1); const X = x(li), Y = y(val(li));
      if (this._hx != null) { c.strokeStyle = muted; c.lineWidth = 1; c.beginPath(); c.moveTo(Math.round(X) + .5, pad.t); c.lineTo(Math.round(X) + .5, h - pad.b); c.stroke(); }
      c.beginPath(); c.arc(X, Y, 4, 0, Math.PI * 2); c.fillStyle = acc; c.fill(); c.lineWidth = 2; c.strokeStyle = surf; c.stroke();
    }
  }
  hover(e) {
    const g = this.geom(); if (!g) return; const r = g.cv.getBoundingClientRect(), mx = e.clientX - r.left;
    const n = g.p.length; let i = g.kind === 'bars' ? Math.floor(((mx - g.pad.l) / (g.w - g.pad.l - g.pad.r)) * n) : Math.round(((mx - g.pad.l) / (g.w - g.pad.l - g.pad.r)) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i)); this._hx = i; this._k = 1; this.draw();
    const tip = this._r.querySelector('.tip'), [t, v] = g.p[i], X = g.kind === 'bars' ? g.pad.l + ((g.w - g.pad.l - g.pad.r) / n) * (i + .5) : g.x(i);
    tip.textContent = `${fmtValue(v, this.getAttribute('unit') || '')} · ${new Date(Number(t)).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    tip.style.left = `${Math.max(60, Math.min(g.w - 60, X))}px`; tip.style.top = `${g.y(Number(v))}px`; tip.classList.add('on');
  }
}
define('gl-chart', GlChart);
