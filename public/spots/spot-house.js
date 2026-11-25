/* Swoop house banners for the Gully spot kit (loaded lazily by spot-kit.js, only for a banner slot near the viewport).
   Asks the Swoop API for ONE banner of the slot's exact size (GET <api>/v1/house/pick), draws it as a plain link + image,
   counts a view after 1 s at least half on screen, and sends Hide / Report. Motion: the animated SVG plays while visible and
   stops after 3 cycles (8 s each); reduced motion, Save-Data and 2G get the static twin only. Empty, refused, wrong size or
   slower than 4 s = the slot collapses to nothing. No cookies, no storage, credentials never sent. */
(function (root) {
  'use strict';
  var CYCLE_MS = 8000, CYCLES = 3, WAIT_MS = 4000, VIEW_MS = 1000;
  function still() {
    try {
      var mq = root.matchMedia;
      if (mq && (mq('(prefers-reduced-motion: reduce)').matches || mq('(prefers-reduced-data: reduce)').matches)) return true;
      var c = root.navigator && root.navigator.connection;
      if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))) return true;
    } catch (e) { /* ignore */ }
    return false;
  }
  function theme(cfg) {
    var t = document.documentElement.getAttribute('data-theme') || (cfg.house && cfg.house.theme);
    if (t === 'dark' || t === 'light') return t;
    return root.matchMedia && root.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  function beacon(url, body) {
    var s = JSON.stringify(body);
    try { if (root.navigator.sendBeacon && root.navigator.sendBeacon(url, new Blob([s], { type: 'text/plain' }))) return; } catch (e) { /* fall through */ }
    try { root.fetch(url, { method: 'POST', body: s, keepalive: true, credentials: 'omit', headers: { 'content-type': 'text/plain' } }).catch(function () {}); } catch (e) { /* nothing */ }
  }
  function motion(img, b) {
    var timer = 0, on = false, runs = 0;
    function show(a) { var u = a ? b.animated : b.static; if (img.getAttribute('src') !== u) img.setAttribute('src', u); img.setAttribute('data-motion', a ? 'on' : 'off'); }
    show(false);
    if (still() || !('IntersectionObserver' in root)) return;
    function run() { if (!on || runs >= 1) return show(false); runs++; show(true); clearTimeout(timer); timer = setTimeout(function () { show(false); }, CYCLES * CYCLE_MS); }
    new root.IntersectionObserver(function (es) { on = es[0].isIntersecting; if (on) run(); else { clearTimeout(timer); show(false); } }, { threshold: 0.4 }).observe(img);
  }
  function seen(el, b) {
    if (!('IntersectionObserver' in root)) return;
    var t = 0, done = false;
    var io = new root.IntersectionObserver(function (es) {
      var x = es[es.length - 1], vis = x.isIntersecting && x.intersectionRatio >= 0.5 && !document.hidden;
      if (vis && !t && !done) t = setTimeout(function () { done = true; io.disconnect(); beacon(b.beacons.seen, { serve: b.serve, visibleMs: VIEW_MS }); }, VIEW_MS);
      else if (!vis && t) { clearTimeout(t); t = 0; }
    }, { threshold: [0, 0.5, 1] });
    io.observe(el);
  }
  function draw(el, cfg, b, k) {
    el.textContent = ''; el.setAttribute('data-state', 'house-banner'); el.setAttribute('data-message', b.message);
    el.appendChild(k.chrome(el, b.label || k.label(cfg), cfg,
      function () { beacon(b.beacons.hide, { serve: b.serve }); },
      function () { beacon(b.beacons.report, { serve: b.serve, reason: 'other' }); }));
    var a = k.mk('a', 'gspot-card gspot-bn'); a.href = b.href; a.target = '_blank'; a.rel = 'noopener sponsored'; a.referrerPolicy = 'no-referrer';
    var img = k.mk('img', 'gspot-banner'); img.width = b.width; img.height = b.height; img.alt = b.alt || ''; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
    img.onerror = function () { k.collapse(el); };
    a.appendChild(img); el.appendChild(a);
    motion(img, b); seen(el, b);
  }
  function mount(el, cfg, slot, k) {
    var h = cfg.house, done = false;
    var stop = setTimeout(function () { if (!done) { done = true; k.collapse(el); } }, WAIT_MS);
    var u = h.api.replace(/\/$/, '') + '/v1/house/pick?property=' + encodeURIComponent(h.property) + '&size=' + slot.s + '&theme=' + theme(cfg) + '&path=' + encodeURIComponent(root.location.pathname);
    root.fetch(u, { credentials: 'omit' }).then(function (r) { return r.json(); }).then(function (j) {
      if (done) return; done = true; clearTimeout(stop);
      var b = j && j.banner;
      if (!b || !k.fits(slot, b) || !/^https:\/\//.test(b.href) || !/^https:\/\//.test(b.static)) return k.collapse(el); // exact size, or nothing
      draw(el, cfg, b, k);
    }).catch(function () { if (!done) { done = true; clearTimeout(stop); k.collapse(el); } });
  }
  root.GullyHouse = { mount: mount, still: still, theme: theme, CYCLES: CYCLES, CYCLE_MS: CYCLE_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.GullyHouse;
})(typeof window !== 'undefined' ? window : globalThis);
