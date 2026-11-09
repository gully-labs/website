/*
 * <gl-stat label="Trades today" value="1234" unit="usd|pct|plain" delta="3.2" spark="1,3,2,5,4" live full>
 * `full` prints the whole number (block heights), never compact (12.4K).
 * Live stat tile: the value counts up when it changes, the delta chip flashes up/down, an optional sparkline draws in.
 * No value yet → skeleton (while `loading`) or "No data yet" (never a fake 0). Set .value / .spark from script for live data.
 */
import { define, fmtValue, tween, reducedMotion, esc } from './gl-core.js';

const CSS = `:host{display:block;font:var(--gl-font);color:var(--gl-ink);background:var(--gl-surface);border:1px solid var(--gl-line);border-radius:var(--gl-radius);padding:14px 16px;min-width:0}
.l{display:flex;align-items:center;gap:6px;color:var(--gl-muted);font-size:.82em;letter-spacing:.02em}
.live{width:7px;height:7px;border-radius:50%;background:var(--gl-up);box-shadow:0 0 0 0 var(--gl-up);animation:p 2s infinite}
@keyframes p{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--gl-up) 60%,transparent)}70%{box-shadow:0 0 0 6px transparent}100%{box-shadow:0 0 0 0 transparent}}
.row{display:flex;align-items:baseline;gap:10px;margin-top:6px;flex-wrap:wrap}
.v{font:var(--gl-font-num);font-variant-numeric:tabular-nums;color:var(--gl-ink);white-space:nowrap}
.d{font-size:.8em;font-weight:600;padding:2px 7px;border-radius:var(--gl-pill);border:1px solid var(--gl-line);color:var(--gl-ink-2);white-space:nowrap}
.d.up{color:var(--gl-up);border-color:currentColor}.d.down{color:var(--gl-down);border-color:currentColor}
.d.flash{animation:f .9s ease-out}@keyframes f{from{background:color-mix(in srgb,currentColor 22%,transparent)}to{background:transparent}}
.none{color:var(--gl-muted);font-size:.9em;margin-top:8px}
.sk{height:28px;width:60%;margin-top:8px;border-radius:8px;background:linear-gradient(90deg,var(--gl-surface-2),var(--gl-line),var(--gl-surface-2));background-size:200% 100%;animation:gl-sh 1.4s linear infinite}
@keyframes gl-sh{from{background-position:200% 0}to{background-position:-200% 0}}
svg{display:block;width:100%;height:32px;overflow:visible}
path.ln{fill:none;stroke:var(--gl-series-1,var(--gl-accent));stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
path.ar{fill:var(--gl-series-1,var(--gl-accent));opacity:.1}
.sp{position:relative;margin-top:8px}.end{position:absolute;width:8px;height:8px;border-radius:50%;background:var(--gl-series-1,var(--gl-accent));box-shadow:0 0 0 2px var(--gl-surface)}
@media (prefers-reduced-motion:reduce){.live,.d.flash,.sk{animation:none}}`;

export class GlStat extends HTMLElement {
  static observedAttributes = ['label', 'value', 'unit', 'delta', 'spark', 'live', 'loading', 'full'];
  constructor() { super(); this._r = this.attachShadow({ mode: 'open' }); this._shown = null; this._stop = () => {}; }
  connectedCallback() { this.render(); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }
  set value(v) { this.setAttribute('value', v == null ? '' : String(v)); }
  get value() { const v = this.getAttribute('value'); return v === null || v === '' ? null : Number(v); }
  set spark(a) { this.setAttribute('spark', (a || []).join(',')); }
  get spark() { return (this.getAttribute('spark') || '').split(',').map(Number).filter(Number.isFinite); }
  render() {
    const label = this.getAttribute('label') || '', unit = this.getAttribute('unit') || '', v = this.value;
    const dAttr = this.getAttribute('delta'); const d = dAttr === null || dAttr === '' ? null : Number(dAttr);
    const loading = this.hasAttribute('loading') && v === null;
    const sp = this.spark;
    let body;
    if (loading) body = `<div class="sk" part="skeleton"></div>`;
    else if (v === null) body = `<div class="none">No data yet</div>`;
    else body = `<div class="row"><span class="v" part="value" aria-live="polite"></span>${d === null || !Number.isFinite(d) ? '' : `<span class="d ${d > 0 ? 'up' : d < 0 ? 'down' : ''}" part="delta">${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${esc(fmtValue(d, 'pct'))}</span>`}</div>${sp.length >= 2 ? `<div class="sp">${this.sparkSvg(sp)}</div>` : ''}`;
    const prevDelta = this._lastDelta; this._lastDelta = d;
    this._r.innerHTML = `<style>${CSS}</style><div class="l" part="label">${this.hasAttribute('live') ? '<i class="live" aria-hidden="true"></i>' : ''}<span>${esc(label)}</span></div>${body}`;
    const el = this._r.querySelector('.v');
    if (el) {
      this._stop();
      const from = this._shown ?? v; this._shown = v;
      const opts = this.hasAttribute('full') ? { compact: false, digits: 0 } : {};
      this._stop = tween(from, v, 700, (x) => { el.textContent = fmtValue(this.hasAttribute('full') ? Math.round(x) : x, unit, opts); });
      const dc = this._r.querySelector('.d');
      if (dc && prevDelta !== undefined && prevDelta !== d) dc.classList.add('flash');
      const ln = this._r.querySelector('path.ln');
      if (ln && !reducedMotion() && typeof ln.getTotalLength === 'function') {
        const L = ln.getTotalLength(); ln.style.strokeDasharray = `${L}`; ln.style.strokeDashoffset = `${L}`;
        requestAnimationFrame(() => { ln.style.transition = 'stroke-dashoffset .9s ease-out'; ln.style.strokeDashoffset = '0'; });
      }
    }
  }
  sparkSvg(a) {
    const W = 100, H = 32, mn = Math.min(...a), mx = Math.max(...a), r = mx - mn || 1;
    const pts = a.map((y, i) => [(i / (a.length - 1)) * W, H - 3 - ((y - mn) / r) * (H - 6)]);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    const last = pts[pts.length - 1];
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="trend, ${a.length} points"><path class="ar" d="${d}L${W},${H}L0,${H}Z"/><path class="ln" d="${d}" vector-effect="non-scaling-stroke"/></svg><i class="end" style="left:calc(${(last[0] / W) * 100}% - 4px);top:${last[1] - 4}px"></i>`;
  }
}
define('gl-stat', GlStat);
