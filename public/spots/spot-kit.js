/* Gully spot kit v2. Rules: design/swoop-spots-2026-11-23/SPOT-RULES.md, README in gully-spots.mjs. No cookies, no storage. */
(function (root) {
  'use strict';
  var DENY = [/checkout|payment|\/pay(\/|$)/i, /\/(buy|sell|swap|trade|launch|lock|claim|stake|mint|confirm|deposit|withdraw|send)(\/|$)/i,
    /connect|sign-?in|sign-?up|login|consent|recover|wallet|approve|signing|\/queue|settings|onboard|welcome/i, /^\/admin/i,
    /\/(tx|address|token|block)\//i, /\/(legal|terms|privacy|404|error)(\/|\.html|$)|404\.html$/i, /security|scan|\/check/i];
  var TAG = { src: 'https://swoopads.xyz/t/1.0.0.js', integrity: 'sha384-1c+WdhA/CC8Hl5vVsFiPu8fKsStd5F8jLQmHKh1O96tV25X44pKM9bfEpb0300eX' };
  var HEIGHTS = { banner: 90, text: 96, native: 120 }, BAR = 24, PHONE = 768;
  var REPORT = 'mailto:team@gullylabs.xyz?subject=Report%20a%20spot';

  function allowed(path, cfg) {
    var deny = DENY.concat(cfg.deny || []);
    for (var i = 0; i < deny.length; i++) if (deny[i].test(path)) return false;
    var a = cfg.allow || [];
    for (var j = 0; j < a.length; j++) if (path === a[j] || (a[j].slice(-1) === '*' && path.indexOf(a[j].slice(0, -1)) === 0)) return true;
    return false;
  }
  function sizes(s) {
    return String(s || '').split(',').map(function (x) { var m = /^(\d+)x(\d+)$/.exec(x.trim()); return m && { w: +m[1], h: +m[2], s: m[0] }; }).filter(Boolean);
  }
  function fitSize(list, width) { for (var i = 0; i < list.length; i++) if (list[i].w <= width) return list[i]; return null; }
  function fits(slot, u) { return !!(slot && u && +u.width === slot.w && +u.height === slot.h); }
  function pickPromo(cfg, host) {
    var list = (cfg.promos || []).filter(function (p) {
      if (p.testnetOnly && !cfg.testnet) return false;
      try { return new URL(cfg.testnet && p.hrefTestnet ? p.hrefTestnet : p.href).hostname !== host; } catch (e) { return false; }
    });
    if (!list.length) return null;
    return list[Math.floor((cfg.seed == null ? Math.random() : cfg.seed) * list.length)];
  }
  function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
  function collapse(el) { el.textContent = ''; el.style.height = '0'; el.style.minHeight = '0'; el.style.margin = '0'; el.style.border = '0'; el.style.overflow = 'hidden'; el.setAttribute('data-state', 'empty'); }
  function chrome(el, label, cfg, onHide, onReport) {
    var bar = mk('div', 'gspot-bar'); bar.appendChild(mk('span', 'gspot-label', label));
    var hide = mk('button', 'gspot-btn', 'Hide'); hide.type = 'button'; hide.onclick = function () { if (onHide) onHide(); collapse(el); };
    var rep;
    if (onReport) { rep = mk('button', 'gspot-btn', 'Report'); rep.type = 'button'; rep.setAttribute('data-report', ''); rep.onclick = function () { onReport(); collapse(el); }; }
    else { rep = mk('a', 'gspot-btn', 'Report'); rep.href = cfg.reportUrl || REPORT; rep.target = '_blank'; rep.rel = 'noopener'; rep.setAttribute('data-report', ''); }
    bar.appendChild(hide); bar.appendChild(rep); return bar;
  }
  function label(cfg) { return cfg.testnet ? 'From Gully Labs · Demo' : 'From Gully Labs'; }
  function renderHouse(el, cfg) {
    var p = pickPromo(cfg, root.location.hostname); if (!p) return collapse(el);
    el.textContent = ''; el.setAttribute('data-state', 'house');
    var a = mk('a', 'gspot-card'); a.href = cfg.testnet && p.hrefTestnet ? p.hrefTestnet : p.href; a.rel = 'noopener'; a.target = '_blank';
    if (cfg.assetBase && p.logo) { var im = mk('img', 'gspot-logo'); im.src = cfg.assetBase + p.logo + '.svg'; im.alt = ''; im.width = 28; im.height = 28; im.onerror = function () { im.remove(); }; a.appendChild(im); }
    var t = mk('span', 'gspot-text'); t.appendChild(mk('strong', '', p.title)); t.appendChild(mk('span', '', ' ' + p.line)); a.appendChild(t);
    el.appendChild(chrome(el, label(cfg), cfg));
    el.appendChild(a);
  }
  var kit = { collapse: collapse, chrome: chrome, fits: fits, label: label, mk: mk };
  function renderBanner(el, cfg) {
    var h = cfg.house;
    if (!h || !h.api || !h.property || !root.fetch) return collapse(el);
    var go = function () { if (root.GullyHouse) root.GullyHouse.mount(el, cfg, el._slot, kit); else collapse(el); };
    if (root.GullyHouse) return go();
    var s = document.createElement('script'); s.src = h.script || '/assets/spot-house.js'; s.async = true; s.onload = go; s.onerror = function () { collapse(el); };
    document.head.appendChild(s);
  }
  function fallback(el, cfg) { if (cfg.house === false) collapse(el); else renderHouse(el, cfg); }
  function renderSwoop(el, cfg) {
    el.setAttribute('data-state', 'swoop');
    var s = document.createElement('script'), t = cfg.tag || TAG;
    s.src = t.src; s.integrity = t.integrity; s.crossOrigin = 'anonymous'; s.async = true;
    s.setAttribute('data-spot', cfg.spot); s.setAttribute('data-unit', el.getAttribute('data-unit') || 'native');
    s.setAttribute('data-theme', 'auto'); s.setAttribute('data-page', cfg.page || 'home');
    s.onerror = function () { fallback(el, cfg); };
    el.appendChild(s);
    setTimeout(function () { var u = el.querySelector('iframe'); if (!u || !u.offsetHeight) fallback(el, cfg); }, 4000);
  }
  function size(el) { return Number(el.getAttribute('data-h')) || HEIGHTS[el.getAttribute('data-unit')] || 96; }
  function mount(el, cfg) { if (el._slot) renderBanner(el, cfg); else if (cfg.spot && !cfg.testnet) renderSwoop(el, cfg); else renderHouse(el, cfg); }
  function reserve(el) {
    var list = sizes(el.getAttribute('data-sizes'));
    if (!list.length) { el.style.minHeight = size(el) + 'px'; return true; }
    var p = el.parentNode, w = p && p.clientWidth ? p.clientWidth : root.innerWidth;
    var slot = fitSize(list, w);
    if (!slot) return false;
    el._slot = slot; el.style.width = slot.w + 'px'; el.style.maxWidth = '100%'; el.style.height = el.style.minHeight = (slot.h + BAR) + 'px';
    return true;
  }
  function init(cfg) {
    cfg = cfg || root.GULLY_SPOTS;
    if (!cfg || cfg.enabled !== true || cfg.kill) return 0;
    var els = [].slice.call(document.querySelectorAll('[data-gully-spot]:not([data-ready])'));
    if (!els.length) return 0;
    if (!allowed(root.location.pathname, cfg)) { for (var i = 0; i < els.length; i++) els[i].remove(); return 0; }
    if (root.innerWidth < PHONE) { while (els.length > 1) els.pop().remove(); }
    var still = (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) || (root.navigator && root.navigator.connection && root.navigator.connection.saveData);
    if (still) cfg = Object.assign({}, cfg, { spot: null });
    els = els.filter(function (e) { e.setAttribute('data-ready', ''); if (reserve(e)) return true; collapse(e); return false; });
    if (!('IntersectionObserver' in root)) { for (var m = 0; m < els.length; m++) mount(els[m], cfg); return els.length; }
    var io = new IntersectionObserver(function (es) { es.forEach(function (x) { if (x.isIntersecting) { io.unobserve(x.target); mount(x.target, cfg); } }); }, { rootMargin: '200px' });
    for (var n = 0; n < els.length; n++) io.observe(els[n]);
    return els.length;
  }
  var api = { init: init, allowed: allowed, pickPromo: pickPromo, sizes: sizes, fitSize: fitSize, fits: fits, DENY: DENY, TAG: TAG, BAR: BAR };
  root.GullySpots = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document && root.GULLY_SPOTS) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); }); else init(); }
})(typeof window !== 'undefined' ? window : globalThis);
