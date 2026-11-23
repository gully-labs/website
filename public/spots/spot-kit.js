/* Gully spot kit v1 (rules: design/swoop-spots-2026-11-23/SPOT-RULES.md). Classic script, no deps.
   Markup: <div data-gully-spot data-unit="banner|text|native" data-h="90"></div>
   Config: window.GULLY_SPOTS = { enabled, kill, allow:[path|prefix*], spot:'pk_..', promos:[..], assetBase, testnet, tag, deny:[regex],
     banners:{ manifest, player, base, product, flags:[], channel, theme } }  (house banners: player.js loads lazily, only when a house spot is shown)
   Off unless enabled === true. No cookies, no storage, no tracking. */
(function (root) {
  'use strict';
  var DENY = [/checkout|payment|\/pay(\/|$)/i, /\/(buy|sell|swap|launch|lock|claim|stake|confirm|deposit|withdraw)(\/|$)/i,
    /connect|sign-?in|login|consent|recover|wallet|approve|signing|\/queue|settings/i, /^\/admin/i,
    /\/(tx|address|token|block)\//i, /\/(legal|terms|privacy|404|error)(\/|$)/i, /security|scan|\/check/i];
  var TAG = { src: 'https://swoopads.xyz/t/1.0.0.js', integrity: 'sha384-1c+WdhA/CC8Hl5vVsFiPu8fKsStd5F8jLQmHKh1O96tV25X44pKM9bfEpb0300eX' };
  var HEIGHTS = { banner: 90, text: 96, native: 120 };

  function allowed(path, cfg) {
    var deny = DENY.concat(cfg.deny || []);
    for (var i = 0; i < deny.length; i++) if (deny[i].test(path)) return false;
    var a = cfg.allow || [];
    for (var j = 0; j < a.length; j++) if (path === a[j] || (a[j].slice(-1) === '*' && path.indexOf(a[j].slice(0, -1)) === 0)) return true;
    return false;
  }
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
  function chrome(el, label, cfg) {
    var bar = mk('div', 'gspot-bar'); bar.appendChild(mk('span', 'gspot-label', label));
    var hide = mk('button', 'gspot-btn', 'Hide'); hide.type = 'button'; hide.onclick = function () { collapse(el); };
    var rep = mk('a', 'gspot-btn', 'Report'); rep.href = cfg.reportUrl || 'https://swoopads.xyz/report'; rep.target = '_blank'; rep.rel = 'noopener';
    bar.appendChild(hide); bar.appendChild(rep); return bar;
  }
  function renderHouse(el, cfg) {
    var p = pickPromo(cfg, root.location.hostname); if (!p) return collapse(el);
    el.textContent = ''; el.setAttribute('data-state', 'house');
    var a = mk('a', 'gspot-card'); a.href = cfg.testnet && p.hrefTestnet ? p.hrefTestnet : p.href; a.rel = 'noopener'; a.target = '_blank';
    if (cfg.assetBase && p.logo) { var im = mk('img', 'gspot-logo'); im.src = cfg.assetBase + p.logo + '.svg'; im.alt = ''; im.width = 28; im.height = 28; im.onerror = function () { im.remove(); }; a.appendChild(im); }
    var t = mk('span', 'gspot-text'); t.appendChild(mk('strong', '', p.title)); t.appendChild(mk('span', '', ' ' + p.line)); a.appendChild(t);
    el.appendChild(chrome(el, 'From Gully Labs', cfg)); el.appendChild(a);
    if (cfg.banners) banner(el, cfg, a);
  }
  function bannerSize(unit, w) { return unit === 'banner' ? (w >= 728 ? '728x90' : '320x100') : 'native'; }
  function bannerHref(b, product) { return b.ctaUrl.replace('{product}', product); }
  function banner(el, cfg, a) {
    var c = cfg.banners, u = el.getAttribute('data-unit') || 'banner';
    if (!c.manifest || !c.player || !root.fetch) return;
    var s = document.createElement('script'); s.src = c.player; s.async = true;
    s.onload = function () {
      root.fetch(c.manifest).then(function (r) { return r.json(); }).then(function (m) {
        var dark = c.theme ? c.theme === 'dark' : root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches;
        var b = root.SwoopHouseBanners.pick(m, { product: c.product, unit: u, theme: dark ? 'dark' : 'light', flags: c.flags || [], channel: c.channel, size: bannerSize(u, el.offsetWidth), seed: cfg.seed });
        if (!b) return;
        var im = mk('img', 'gspot-banner'); im.width = b.width; im.height = b.height; im.style.maxWidth = '100%'; im.style.height = 'auto';
        a.textContent = ''; a.href = bannerHref(b, c.product || 'gully'); a.appendChild(im);
        root.SwoopHouseBanners.attach(im, b, { base: c.base || '' });
      }).catch(function () {});
    };
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
  function mount(el, cfg) { if (cfg.spot && !cfg.testnet) renderSwoop(el, cfg); else renderHouse(el, cfg); }
  function init(cfg) {
    cfg = cfg || root.GULLY_SPOTS;
    if (!cfg || cfg.enabled !== true || cfg.kill) return 0;
    var els = document.querySelectorAll('[data-gully-spot]:not([data-ready])');
    if (!els.length) return 0;
    if (!allowed(root.location.pathname, cfg)) { for (var i = 0; i < els.length; i++) els[i].remove(); return 0; }
    var still = (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) || (root.navigator && root.navigator.connection && root.navigator.connection.saveData);
    if (still) cfg = Object.assign({}, cfg, { spot: null });
    for (var k = 0; k < els.length; k++) { els[k].style.minHeight = size(els[k]) + 'px'; els[k].setAttribute('data-ready', ''); }
    if (!('IntersectionObserver' in root)) { for (var m = 0; m < els.length; m++) mount(els[m], cfg); return els.length; }
    var io = new IntersectionObserver(function (es) { es.forEach(function (x) { if (x.isIntersecting) { io.unobserve(x.target); mount(x.target, cfg); } }); }, { rootMargin: '200px' });
    for (var n = 0; n < els.length; n++) io.observe(els[n]);
    return els.length;
  }
  var api = { init: init, allowed: allowed, pickPromo: pickPromo, bannerSize: bannerSize, bannerHref: bannerHref, DENY: DENY, TAG: TAG };
  root.GullySpots = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document && root.GULLY_SPOTS) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); }); else init(); }
})(typeof window !== 'undefined' ? window : globalThis);
