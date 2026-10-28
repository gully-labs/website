/* Direction A "Constellation": the eight products as a live map; click a product for its drawer. */
(function () {
  'use strict'
  var K = window.GullyCharts, G = window.GullyHub, icon = G.icon, esc = G.esc
  var NS = 'http://www.w3.org/2000/svg'
  var ALL = null, READ = {}

  // ---------------------------------------------------------------- map geometry (two layouts: wide and phone)
  var POS = {
    wide: { vb: [760, 560], r: 30, rc: 42, at: { id: [128, 118], pay: [380, 64], rpc: [632, 118], holdermaps: [672, 330], security: [530, 488], studio: [230, 488], ai: [88, 330], chain: [380, 282] } },
    tall: { vb: [360, 580], r: 24, rc: 32, at: { id: [70, 62], pay: [290, 62], rpc: [62, 236], chain: [180, 226], holdermaps: [298, 236], studio: [70, 402], security: [290, 402], ai: [180, 520] } },
  }
  // how the products connect (live = in production or on testnet today; plan = flagged off or not built yet)
  var EDGES = [
    ['id', 'chain', 'live', 'Faucet sign-in and passkey accounts on Gully Chain'],
    ['id', 'pay', 'plan', 'Sign in with Gully on Gully Pay (built, flagged off)'],
    ['id', 'rpc', 'plan', 'Sign in with Gully on the RPC portal (built, flagged off)'],
    ['id', 'studio', 'live', 'Gully ID sign-in inside Studio games'],
    ['pay', 'chain', 'live', 'x402 and checkout settle on chain 485590 (testnet)'],
    ['pay', 'rpc', 'plan', 'Gully RPC paid plans billed through Gully Pay'],
    ['pay', 'studio', 'live', 'Gully Pay purchases in Studio games'],
    ['rpc', 'chain', 'live', 'Serves Gully Chain on the RPC gateway'],
    ['chain', 'holdermaps', 'live', 'Holder maps of Gully Chain tokens'],
    ['chain', 'security', 'live', 'Security scans of Gully Chain contracts'],
    ['chain', 'studio', 'live', 'Game scores, quests and prizes on chain'],
    ['ai', 'studio', 'plan', 'LLM API for Gully products (coming online)'],
  ]
  var PATH = { id: ['id'], pay: ['id', 'pay'], chain: ['id', 'pay', 'chain'] }

  var svg = document.getElementById('mapsvg'), layout = null, nodes = {}, edges = []
  function el(tag, attrs, parent) { var n = document.createElementNS(NS, tag); for (var k in attrs) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n }
  function curve(a, b, cx, cy) {
    var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = mx - cx, dy = my - cy, d = Math.hypot(dx, dy) || 1, k = 18
    return 'M' + a[0] + ' ' + a[1] + ' Q' + (mx + dx / d * k).toFixed(1) + ' ' + (my + dy / d * k).toFixed(1) + ' ' + b[0] + ' ' + b[1]
  }
  function drawMap() {
    var L = svg.clientWidth && svg.clientWidth < 520 ? 'tall' : 'wide'
    if (L === layout) return updateMap()
    layout = L; var P = POS[L]; svg.textContent = ''; nodes = {}; edges = []
    svg.setAttribute('viewBox', '0 0 ' + P.vb[0] + ' ' + P.vb[1])
    var defs = el('defs', {}, svg), cx = P.at.chain[0], cy = P.at.chain[1]
    var eg = el('g', {}, svg)
    EDGES.forEach(function (e, i) {
      var d = curve(P.at[e[0]], P.at[e[1]], cx, cy)
      var p = el('path', { class: 'edge ' + e[2], d: d, id: 'e' + i }, eg)
      var t = el('title', {}, p); t.textContent = G.product(e[0]).name + ' → ' + G.product(e[1]).name + ': ' + e[3]
      edges.push({ a: e[0], b: e[1], el: p })
      if (e[2] === 'live' && !K.reduced) {
        var s = el('circle', { class: 'spark', r: 2.4 }, eg), m = el('animateMotion', { dur: (3 + (i % 4) * 0.7) + 's', repeatCount: 'indefinite', begin: (i * 0.37).toFixed(2) + 's' }, s)
        el('mpath', { href: '#e' + i }, m)
      }
    })
    G.PRODUCTS.forEach(function (p) {
      var at = P.at[p.key], r = p.key === 'chain' ? P.rc : P.r
      var g = el('g', { class: 'node is-' + (p.status === 'soon' ? 'soon' : 'up'), role: 'button', tabindex: 0, 'data-k': p.key, style: '--c:' + p.color, transform: 'translate(' + at[0] + ' ' + at[1] + ')' }, svg)
      el('circle', { class: 'ring', r: r + 2 }, g)
      el('circle', { class: 'halo', r: r }, g)
      var cp = el('clipPath', { id: 'cp-' + p.key }, defs); el('circle', { r: r - 5 }, cp)
      el('image', { href: p.logo, x: -(r - 5), y: -(r - 5), width: 2 * (r - 5), height: 2 * (r - 5), 'clip-path': 'url(#cp-' + p.key + ')', preserveAspectRatio: 'xMidYMid slice' }, g)
      var st = el('text', { class: 'st ' + p.status, y: -r - 8, 'text-anchor': 'middle' }, g); st.textContent = G.STATUS[p.status]
      var nm = el('text', { class: 'nm', y: r + 17, 'text-anchor': 'middle' }, g); nm.textContent = p.name
      var mt = el('text', { class: 'mt', y: r + 32, 'text-anchor': 'middle' }, g); mt.textContent = '…'
      g.addEventListener('click', function () { openDrawer(p.key, g) })
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(p.key, g) } })
      g.addEventListener('pointerenter', function () { hot([p.key], true) }); g.addEventListener('pointerleave', function () { hot(null) })
      g.addEventListener('focus', function () { hot([p.key], true) }); g.addEventListener('blur', function () { hot(null) })
      nodes[p.key] = { g: g, mt: mt }
    })
    updateMap()
  }
  /** highlight a set of products (and, with neighbours, every product they connect to) */
  function hot(keys, neighbours) {
    if (!keys) { Object.keys(nodes).forEach(function (k) { nodes[k].g.classList.remove('dim', 'hot') }); edges.forEach(function (e) { e.el.classList.remove('dim', 'hot') }); return }
    var on = keys.slice()
    edges.forEach(function (e) {
      var path = !neighbours && keys.indexOf(e.a) >= 0 && keys.indexOf(e.b) >= 0, nb = neighbours && (keys.indexOf(e.a) >= 0 || keys.indexOf(e.b) >= 0)
      e.el.classList.toggle('hot', !!(path || nb)); e.el.classList.toggle('dim', !(path || nb))
      if (nb) { if (on.indexOf(e.a) < 0) on.push(e.a); if (on.indexOf(e.b) < 0) on.push(e.b) }
    })
    Object.keys(nodes).forEach(function (k) { nodes[k].g.classList.toggle('dim', on.indexOf(k) < 0); nodes[k].g.classList.toggle('hot', keys.indexOf(k) >= 0) })
  }
  function metricText(p, r) {
    if (!r) return '…'
    if (r.kpi) return (r.kpi.of != null ? r.kpi.v + '/' + r.kpi.of : K.fmt.num(r.kpi.v)) + ' ' + short(p.key, r.kpi.label)
    return r.why ? (r.why.length > 26 ? r.why.split(':')[0].replace('Last Frog Hop quest win', 'Frog Hop win') : r.why) : 'no data yet'
  }
  function short(k, label) { return { id: 'sign-ins 24h', pay: 'services ok', chain: '', rpc: 'networks ok', holdermaps: 'maps today', security: 'scans 14 d', studio: 'Frog Hop runs', ai: '' }[k] || label }
  function updateMap() {
    G.PRODUCTS.forEach(function (p) {
      var n = nodes[p.key]; if (!n) return; var r = READ[p.key]
      n.mt.textContent = p.key === 'chain' && r && r.kpi ? 'block ' + K.fmt.num(r.kpi.v) : metricText(p, r)
      var label = p.name + ', ' + G.STATUS[p.status] + '. ' + (r && r.kpi ? K.fmt.num(r.kpi.v) + ' ' + r.kpi.label : (r && r.why) || '') + '. Open details.'
      n.g.setAttribute('aria-label', label)
      n.g.classList.toggle('is-up', !!(r && r.up) && p.status !== 'soon')
    })
  }
  if (window.ResizeObserver) new ResizeObserver(function () { drawMap() }).observe(svg)

  // hero flow chips light the journey on the map
  Array.prototype.forEach.call(document.querySelectorAll('.flow [data-path]'), function (b) {
    var k = b.dataset.path
    b.addEventListener('pointerenter', function () { hot(PATH[k]); b.classList.add('is-on') })
    b.addEventListener('pointerleave', function () { hot(null); b.classList.remove('is-on') })
    b.addEventListener('focus', function () { hot(PATH[k]) }); b.addEventListener('blur', function () { hot(null) })
    b.addEventListener('click', function () { openDrawer(k, b) })
  })
  document.getElementById('open-first').addEventListener('click', function (e) { openDrawer('id', e.currentTarget) })

  // ---------------------------------------------------------------- drawer
  var drawer = document.getElementById('drawer'), scrim = document.getElementById('scrim'), dBody = document.getElementById('d-body'), back = null, dChart = null, dKey = null
  function openDrawer(key, from) {
    back = from || document.activeElement; dKey = key
    renderDrawer()
    drawer.classList.add('on'); drawer.setAttribute('aria-hidden', 'false'); scrim.hidden = false
    setTimeout(function () { var x = drawer.querySelector('.x'); if (x) x.focus() }, 60)
  }
  function closeDrawer() { drawer.classList.remove('on'); drawer.setAttribute('aria-hidden', 'true'); scrim.hidden = true; dKey = null; if (back && back.focus) back.focus() }
  scrim.addEventListener('click', closeDrawer)
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dKey) closeDrawer() })
  drawer.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return; var f = drawer.querySelectorAll('a,button,[tabindex="0"]'); if (!f.length) return
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus() } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
  })
  function renderDrawer() {
    if (!dKey) return
    var p = G.product(dKey), r = READ[dKey] || {}, conns = EDGES.filter(function (e) { return e[0] === dKey || e[1] === dKey })
    var tag = p.status === 'live' ? 't-tag--live' : p.status === 'soon' ? 't-tag--soon' : 't-tag--new'
    dBody.innerHTML =
      '<div class="d-top"><img src="' + p.logo + '" alt="" width="44" height="44"><div><h2 id="d-name">' + esc(p.name) + '</h2><small>' + esc(p.domain) + (p.logoNote ? ' · ' + esc(p.logoNote) : '') + '</small></div><button class="t-btn t-btn--sm x" type="button" aria-label="Close">' + icon('x') + '</button></div>' +
      '<div><span class="t-tag ' + tag + '">' + G.STATUS[p.status] + '</span></div>' +
      '<p class="d-line">' + esc(p.line) + '</p><p class="d-about">' + esc(p.about) + '</p>' +
      (r.kpi ? '<div class="d-kpi"><b>' + (r.kpi.of != null ? r.kpi.v + '/' + r.kpi.of : K.fmt.num(r.kpi.v)) + '</b><span>' + esc(r.kpi.label) + '</span></div>' : '<p class="d-why">' + icon('info') + ' ' + esc(r.why || 'No live reading yet') + '</p>') +
      (r.series ? '<div><div class="cell-h"><span class="t-label">' + esc(r.series.name) + '</span></div><div class="t-chart" id="d-chart" style="--t-chart-h:150px"></div><p class="src">Source: ' + esc(r.source || '') + '</p></div>' : '') +
      (r.extra && r.extra.length ? '<dl class="d-extra">' + r.extra.map(function (x) { return '<dt>' + esc(x[0]) + '</dt><dd>' + (x[1] == null ? '–' : esc(typeof x[1] === 'number' ? K.fmt.num(x[1]) : x[1])) + '</dd>' }).join('') + '</dl>' : '') +
      '<div><p class="t-label">Live now</p><ul class="d-list ok">' + p.live.map(function (x) { return '<li>' + icon('circle-check') + esc(x) + '</li>' }).join('') + '</ul></div>' +
      (p.next.length ? '<div><p class="t-label">Building</p><ul class="d-list next">' + p.next.map(function (x) { return '<li>' + icon('hammer') + esc(x) + '</li>' }).join('') + '</ul></div>' : '') +
      '<div><p class="t-label">Connects to</p><div class="d-conn">' + conns.map(function (e) { var o = G.product(e[0] === dKey ? e[1] : e[0]); return '<span><b>' + esc(o.name) + '</b> · ' + esc(e[3]) + (e[2] === 'plan' ? ' <span class="t-tag t-tag--soon">planned</span>' : '') + '</span>' }).join('') + '</div></div>' +
      '<div class="d-links">' + G.ext(p.url, '', 't-btn t-btn--primary t-btn--sm', icon('arrow-up-right') + 'Open ' + esc(p.domain)) + p.links.map(function (l) { return G.ext(l[1], '', 't-btn t-btn--sm', icon('external-link') + esc(l[0])) }).join('') + '</div>'
    dBody.querySelector('.x').addEventListener('click', closeDrawer)
    if (r.series) {
      dChart = K.LiveChart('d-chart', { kind: r.series.kind, name: r.series.name, minH: 120, emptyText: 'No data yet', valueLabel: function (v) { return K.fmt.num(v) + ' ' + r.series.unit } })
      dChart.update(r.series.rows, false)
    }
  }

  // ---------------------------------------------------------------- board
  var TABS = G.tabs(document.querySelector('.tabs'))
  Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (a) { a.addEventListener('click', function () { TABS.show(a.dataset.tab); var m = document.getElementById('mnav'); if (m && !m.hidden) toggleMenu(false) }) })

  // mobile menu (same links, icon on every item)
  var mnav = document.getElementById('mnav'), mbtn = document.querySelector('.menu-btn')
  mnav.innerHTML = document.querySelector('.nav').innerHTML
  Array.prototype.forEach.call(mnav.querySelectorAll('[data-tab]'), function (a) { a.addEventListener('click', function () { TABS.show(a.dataset.tab); toggleMenu(false) }) })
  mnav.querySelector('a[href="#map"]').addEventListener('click', function () { toggleMenu(false) })
  function toggleMenu(on) { mnav.hidden = !on; mbtn.setAttribute('aria-expanded', String(on)) }
  mbtn.addEventListener('click', function () { toggleMenu(mnav.hidden) })

  // chart with a series switch + table view
  var chartKey = 'chain'
  var chart = K.LiveChart('chart', { kind: 'bars', tick: function (v) { return K.fmt.short(Math.round(v)) }, name: 'Gully Chain transactions per hour', minH: 160, emptyText: 'No data yet', tableHead: ['Hour (UTC)', 'Value'], tableRow: function (r) { return [r.x, K.fmt.num(r.v)] }, tableBtn: 'tbl', valueLabel: function (v) { return K.fmt.num(v) } })
  Array.prototype.forEach.call(document.querySelectorAll('[data-ch]'), function (b) {
    if (b.dataset.ch === 'table') return
    b.addEventListener('click', function () { chartKey = b.dataset.ch; Array.prototype.forEach.call(document.querySelectorAll('[data-ch]:not([data-ch=table])'), function (x) { x.setAttribute('aria-pressed', String(x === b)) }); renderChart() })
  })
  function renderChart() {
    var r = READ[chartKey]; if (!r) return
    document.getElementById('ch-name').textContent = r.series ? r.series.name : ''
    document.getElementById('ch-src').textContent = 'Source: ' + (chartKey === 'chain' ? 'gullylabs.xyz/api/hub/products (Gully Chain indexer)' : 'gullyid.xyz/v1/stats/public') + ', hourly, UTC'
    if (!r.series) return chart.offline(r.why || 'Source offline')
    chart.update(r.series.rows, false, { name: r.series.name, valueLabel: function (v) { return K.fmt.num(v) + ' ' + r.series.unit } })
  }

  var up = K.Uptime('uptime', { cells: 24, emptyText: 'Status source offline' })
  var UP_KEYS = ['chain-site', 'pay', 'rpc-gateway', 'holders', 'security', 'studio', 'gullyai']
  var UP_NAMES = { 'rpc-gateway': 'Gully RPC', security: 'Security' }
  function renderLive() {
    if (ALL.hub.state === 'ok') {
      var by = {}; ALL.hub.data.services.forEach(function (s) { by[s.key] = s })
      up.update(UP_KEYS.filter(function (k) { return by[k] }).map(function (k) { var s = by[k]; return { key: k, name: UP_NAMES[k] || s.name, url: s.url, up: s.up, ms: s.ms, history: (s.history || []).map(function (h) { return { t: h.t, ms: h.ms, up: h.ms != null } }) } }))
      var su = G.suite(ALL); document.getElementById('up-sum').textContent = su.servicesUp + '/' + su.servicesTotal + ' up'
    } else if (ALL.hub.state === 'down') up.offline('Status source offline')
    var ev = G.liveEvents(ALL), box = document.getElementById('events')
    box.innerHTML = ev.length ? ev.map(function (e) { var p = G.product(e.p); var t = esc(e.t); return '<li>' + icon(e.p === 'id' ? 'fingerprint-pattern' : /Quest/.test(e.t) ? 'trophy' : 'blocks') + '<div>' + (e.href ? G.ext(e.href, e.t) : t) + '<time datetime="' + e.at + '">' + esc(p.name) + ' · ' + G.ago(e.at) + '</time></div></li>' }).join('') : '<li class="t-empty">No events in the sources yet</li>'
    renderChart()
  }

  // what's new
  var newsF = 'all'
  function renderNews() {
    var keys = ['all'].concat(G.PRODUCTS.map(function (p) { return p.key }).filter(function (k) { return G.NEWS.some(function (n) { return n.p === k }) }))
    var f = document.getElementById('news-f')
    if (!f.children.length) {
      f.innerHTML = keys.map(function (k) { return '<button type="button" data-f="' + k + '" aria-pressed="' + (k === 'all') + '">' + (k === 'all' ? 'All' : esc(G.product(k).name.replace('Gully ', ''))) + '</button>' }).join('')
      f.addEventListener('click', function (e) { var b = e.target.closest('[data-f]'); if (!b) return; newsF = b.dataset.f; Array.prototype.forEach.call(f.children, function (x) { x.setAttribute('aria-pressed', String(x === b)) }); renderNews() })
    }
    document.getElementById('news').innerHTML = G.NEWS.filter(function (n) { return newsF === 'all' || n.p === newsF }).map(function (n) {
      var p = G.product(n.p), cls = n.s === 'live' ? 't-tag--live' : n.s === 'testnet' || n.s === 'beta' || n.s === 'new' ? 't-tag--new' : 't-tag--soon'
      return '<li><time datetime="' + n.d + '">' + G.fmtDate(n.d) + '</time><img src="' + p.logo + '" alt="" width="24" height="24"><div>' + G.ext(n.href, n.t) + '<span class="pn">' + esc(p.name) + '</span></div><span class="t-tag ' + cls + '">' + esc(n.s) + '</span></li>'
    }).join('')
  }

  // all products table
  function renderList() {
    var LN = {}; G.LAYERS.forEach(function (l) { LN[l.key] = l.name })
    var tb = document.getElementById('plist')
    tb.innerHTML = G.PRODUCTS.map(function (p) {
      var r = READ[p.key] || {}, tag = p.status === 'live' ? 't-tag--live' : p.status === 'soon' ? 't-tag--soon' : 't-tag--new'
      var rd = r.kpi ? '<b>' + (r.kpi.of != null ? r.kpi.v + '/' + r.kpi.of : K.fmt.num(r.kpi.v)) + '</b><span>' + esc(r.kpi.label) + '</span>' : '<span>' + esc(r.why || 'No data yet') + '</span>'
      return '<tr><td>' + G.ext(p.url, '', 'pn', '<img src="' + p.logo + '" alt="" width="26" height="26"><span>' + esc(p.name) + '<small>' + esc(p.domain) + '</small></span>') + '</td><td>' + esc(LN[p.layer]) + '</td><td><span class="t-tag ' + tag + '">' + G.STATUS[p.status] + '</span></td><td class="rd">' + rd + '</td><td class="hide-s"><svg class="t-spark" data-sp="' + p.key + '"></svg></td><td><button class="t-btn t-btn--xs" type="button" data-open="' + p.key + '">' + icon('chevron-right') + 'Details</button></td></tr>'
    }).join('')
    G.PRODUCTS.forEach(function (p) {
      var r = READ[p.key], s = tb.querySelector('[data-sp="' + p.key + '"]'); if (!s || !r || !r.series || r.series.rows.length < 2) { if (s) s.outerHTML = '<span class="faint small">–</span>'; return }
      var vals = r.series.rows.map(function (x) { return x.v }); if (r.series.kind === 'bars') K.sparkBars(s, vals, r.series.name); else K.sparkLine(s, vals, r.series.name)
      var u = document.createElement('span'); u.className = 'faint small'; u.style.display = 'block'; u.textContent = r.series.unit === 'ms' ? 'site response time' : r.series.unit + ' per ' + (r.series.name.indexOf('day') >= 0 ? 'day' : 'hour'); s.after(u)
    })
  }
  document.getElementById('plist').addEventListener('click', function (e) { var b = e.target.closest('[data-open]'); if (b) openDrawer(b.dataset.open, b) })

  // work with us
  document.getElementById('svc').innerHTML = G.SERVICES.map(function (s) { return '<li><span class="top">' + icon(s.icon) + esc(s.name) + '<small>' + esc(s.time) + '</small></span><p>' + esc(s.d) + '</p><button class="t-btn t-btn--xs" type="button" data-ask="' + esc(s.type) + '">' + icon('message-square') + 'Ask about this</button></li>' }).join('')
  document.getElementById('svc').addEventListener('click', function (e) { var b = e.target.closest('[data-ask]'); if (!b) return; G.prefill(document.getElementById('contact'), b.dataset.ask); TABS.show('p-contact') })
  var st = document.getElementById('steps')
  st.querySelector('.step-h').innerHTML = G.STEPS.map(function (s, i) { return '<li><button type="button" data-go>' + ('0' + (i + 1)) + ' ' + esc(s.name) + '</button></li>' }).join('')
  st.querySelector('.step-panes').innerHTML = G.STEPS.map(function (s) { return '<div data-step>' + icon(s.icon) + '<div><b>' + esc(s.name) + '</b><p>' + esc(s.d) + '</p></div></div>' }).join('')
  G.stepper(st)
  function renderTrack() {
    var su = G.suite(ALL), t = document.getElementById('track')
    t.innerHTML = su.tvl != null ? icon('chart-spline') + ' Venues we built hold <b>' + K.fmt.usd(su.tvl) + '</b> in TVL with <b>' + K.fmt.usd(su.volumeAll) + '</b> all-time volume and <b>' + K.fmt.usd(su.feesAll) + '</b> in fees (DeepCore, Peddles, PeddleSwap, PeddleQuest; source gullylabs.xyz/api/stats).' : ALL.stats.state === 'wait' ? 'Loading track record…' : 'Track record figures are offline right now.'
  }

  G.contactForm(document.getElementById('contact'))

  // footer product links
  document.getElementById('flinks').innerHTML = G.PRODUCTS.map(function (p) { return G.ext(p.url, '', '', '<img src="' + p.logo + '" alt="" width="16" height="16">' + esc(p.name)) }).join('')

  // ---------------------------------------------------------------- live loop
  var watch = G.eventWatcher(G.toast)
  function kpis() {
    var su = G.suite(ALL), set = function (k, v) { var b = document.querySelector('[data-k="' + k + '"]'); if (b) b.textContent = v }
    set('up', su.servicesTotal ? su.servicesUp + '/' + su.servicesTotal : '–')
    set('id', READ.id && READ.id.kpi ? K.fmt.num(READ.id.kpi.v) : '–')
    set('block', READ.chain && READ.chain.kpi ? K.fmt.num(READ.chain.kpi.v) : '–')
    var pill = document.getElementById('sys')
    if (su.servicesTotal) K.setStatus(pill, su.servicesUp === su.servicesTotal ? 'live' : 'warn', su.servicesUp === su.servicesTotal ? 'All ' + su.servicesTotal + ' services up' : su.servicesUp + '/' + su.servicesTotal + ' services up')
    else if (ALL.hub.state === 'down') K.setStatus(pill, 'down', 'Status offline')
    var ok = Object.keys(G.SOURCES).filter(function (k) { return ALL[k].state === 'ok' }).length
    document.getElementById('fresh').textContent = ok + '/' + Object.keys(G.SOURCES).length + ' live sources · ' + ALL.at.toISOString().slice(11, 19) + ' UTC'
  }
  var queued = false
  function render(all) {
    ALL = all; if (queued) return; queued = true
    requestAnimationFrame(function () {
      queued = false; G.PRODUCTS.forEach(function (p) { READ[p.key] = G.reading(ALL, p.key) })
      drawMap(); updateMap(); kpis(); renderLive(); renderNews(); renderList(); renderTrack(); if (dKey && !drawer.contains(document.activeElement)) renderDrawer()
    })
  }
  function tick() { return G.loadAll(render).then(function (all) { render(all); watch(all) }) }
  drawMap(); renderNews()
  K.poll(tick, 30000)
})()
