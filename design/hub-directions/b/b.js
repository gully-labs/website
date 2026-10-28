/* Direction B "The Gully stack": editorial hero, a live journey stepper, a live bento board, product rows. */
(function () {
  'use strict'
  var K = window.GullyCharts, G = window.GullyHub, icon = G.icon, esc = G.esc
  var ALL = null, READ = {}, layerF = 'all'
  var LAYER_COLOR = { identity: '#0090C0', payments: '#3479FD', chain: '#0078B0', data: '#A86A00', play: '#6A2EF0' }
  var LAYER_PRODUCTS = {}; G.PRODUCTS.forEach(function (p) { (LAYER_PRODUCTS[p.layer] = LAYER_PRODUCTS[p.layer] || []).push(p) })

  var TABS = G.tabs(document.querySelector('.tabs'))
  function goTab(id) { TABS.show(id); document.getElementById('board').scrollIntoView({ behavior: K.reduced ? 'auto' : 'smooth', block: 'start' }) }
  Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (a) { a.addEventListener('click', function (e) { e.preventDefault(); goTab(a.dataset.tab); toggleMenu(false) }) })

  var mnav = document.getElementById('mnav'), mbtn = document.querySelector('.menu-btn')
  mnav.innerHTML = document.querySelector('.nav').innerHTML
  Array.prototype.forEach.call(mnav.querySelectorAll('a'), function (a) { a.addEventListener('click', function (e) { if (a.dataset.tab) { e.preventDefault(); goTab(a.dataset.tab) } toggleMenu(false) }) })
  function toggleMenu(on) { mnav.hidden = !on; mbtn.setAttribute('aria-expanded', String(on)) }
  mbtn.addEventListener('click', function () { toggleMenu(mnav.hidden) })

  // ---------------------------------------------------------------- journey stepper (one live number per layer)
  var J = document.getElementById('journey')
  J.innerHTML = G.LAYERS.map(function (l) {
    return '<li><button type="button" aria-pressed="false" data-layer="' + l.key + '" style="--c:' + LAYER_COLOR[l.key] + '"><span class="n">' + icon(l.icon, 'ic') + '</span><span class="v"><small>' + l.n + '</small>' + esc(l.verb) + '</span><span class="m" data-jm="' + l.key + '">…</span><span class="p">' + LAYER_PRODUCTS[l.key].map(function (p) { return esc(p.name) }).join(' + ') + '</span></button></li>'
  }).join('')
  J.addEventListener('click', function (e) { var b = e.target.closest('[data-layer]'); if (!b) return; setLayer(b.dataset.layer); goTab('p-products') })
  function jm(layer) {
    var r
    if (layer === 'identity') { r = READ.id; return r && r.kpi ? '<b>' + K.fmt.num(r.kpi.v) + '</b> sign-ins · 24 h' : esc(r && r.why || '–') }
    if (layer === 'payments') { r = READ.pay; return r && r.kpi ? '<b>' + r.kpi.v + '/' + r.kpi.of + '</b> services up' : esc(r && r.why || '–') }
    if (layer === 'chain') { r = READ.chain; return r && r.kpi ? 'block <b>' + K.fmt.num(r.kpi.v) + '</b> · testnet' : esc(r && r.why || '–') }
    if (layer === 'data') { r = READ.holdermaps; return r && r.kpi ? '<b>' + K.fmt.num(r.kpi.v) + '</b> maps today' : esc(r && r.why || '–') }
    r = READ.studio; return esc(r && r.kpi ? K.fmt.num(r.kpi.v) + ' Frog Hop runs' : (r && r.why) || '–').replace('Last Frog Hop quest win', 'Frog Hop win')
  }

  // ---------------------------------------------------------------- bento
  var chart = K.LiveChart('chart', { kind: 'bars', name: 'Gully Chain transactions per hour', minH: 150, emptyText: 'No data yet', tick: function (v) { return K.fmt.short(Math.round(v)) }, tableHead: ['Hour (UTC)', 'Transactions'], tableRow: function (r) { return [r.x, K.fmt.num(r.v)] }, tableBtn: 'tbl', valueLabel: function (v) { return K.fmt.num(v) + ' txs' } })
  function set(id, html) { var n = document.getElementById(id); if (n) n.innerHTML = html }
  function kv(list) { return list.map(function (x) { return '<li><span>' + esc(x[0]) + '</span><span>' + (x[1] == null ? '–' : esc(x[1])) + '</span></li>' }).join('') }
  function renderBento() {
    var c = READ.chain
    set('chain-head', c && c.kpi ? 'block ' + K.fmt.num(c.kpi.v) : esc(c && c.why || 'block –'))
    if (c && c.series) chart.update(c.series.rows, false); else if (ALL.products.state === 'down') chart.offline('Indexer offline')
    var act = c && c.extra.filter(function (x) { return /Launches/.test(x[0]) })[0], q = c && c.extra.filter(function (x) { return /Quest completions/.test(x[0]) })[0]
    set('chain-act', (act ? 'Launches · trades · swaps, 24 h: <b>' + esc(act[1]) + '</b>' : '–') + (q ? ' · quest wins 24 h: <b>' + esc(q[1]) + '</b>' : ''))
    var i = READ.id
    set('id-n', i && i.kpi ? K.fmt.num(i.kpi.v) : '–')
    if (i && i.series && i.series.rows.length > 1) K.sparkBars(document.getElementById('id-spark'), i.series.rows.map(function (r) { return r.v }), 'Gully ID sign-ins per hour, last 25 h')
    if (i && i.mix) {
      var tot = Object.keys(i.mix).reduce(function (s, k) { return s + i.mix[k] }, 0), L = { passkey: 'Passkey', wallet: 'Wallet', email: 'Email code', social: 'Google / X' }
      set('id-mix', tot ? Object.keys(L).map(function (k) { var v = i.mix[k] || 0; return '<div class="row"><span>' + L[k] + '</span><span class="bar"><i style="width:' + (100 * v / tot).toFixed(1) + '%"></i></span><span>' + v + '</span></div>' }).join('') + '<div class="src-s">methods, last 30 days · gullyid.xyz</div>' : '<div class="src-s">No sign-ins in 30 days yet</div>')
    } else if (i && i.why) set('id-mix', '<div class="src-s">' + esc(i.why) + '</div>')
    var su = G.suite(ALL)
    if (ALL.hub.state === 'ok') {
      var svcs = ALL.hub.data.services || []
      set('up-n', su.servicesUp + '/' + su.servicesTotal); set('svc-n', svcs.length + ' monitored')
      document.getElementById('svc-n').className = 'chip-s ' + (su.servicesUp === su.servicesTotal ? 'ok' : 'warn')
      set('dots', svcs.map(function (s) { var st = s.state === 'coming' ? 'c' : s.up ? '' : 'd'; return '<i role="listitem" class="' + st + '" title="' + esc(s.name) + ': ' + (s.state === 'coming' ? 'coming online' : s.up ? 'up, ' + s.ms + ' ms' : 'down') + '" aria-label="' + esc(s.name) + ': ' + (s.state === 'coming' ? 'coming online' : s.up ? 'up' : 'down') + '"></i>' }).join(''))
    } else if (ALL.hub.state === 'down') set('up-n', '–')
    var p = READ.pay
    set('pay-n', p && p.kpi ? p.kpi.v + '/' + p.kpi.of : '–')
    set('pay-kv', p && p.payServices ? kv(Object.keys(p.payServices).map(function (k) { return [k, p.payServices[k]] })) : '')
    var r = READ.rpc
    set('rpc-n', r && r.kpi ? r.kpi.v + '/' + r.kpi.of : '–')
    set('rpc-kv', r && r.networks ? kv(r.networks.map(function (n) { return [n.alias, n.state === 'OK' ? (n.blockTimeMs >= 1000 ? (n.blockTimeMs / 1000).toFixed(n.blockTimeMs < 10000 ? 1 : 0) + ' s' : n.blockTimeMs + ' ms') + ' blocks' : n.state] })) : '')
    var h = READ.holdermaps
    set('hm-n', h && h.kpi ? K.fmt.num(h.kpi.v) : '–')
    set('hm-kv', h && h.top ? kv(h.top.slice(0, 4).map(function (t) { return [t.symbol + ' · ' + t.chain, t.scans + ' scan' + (t.scans > 1 ? 's' : '')] })) : '')
    var ok = Object.keys(G.SOURCES).filter(function (k) { return ALL[k].state === 'ok' }).length
    set('fresh', ok + '/' + Object.keys(G.SOURCES).length + ' live sources · ' + ALL.at.toISOString().slice(11, 19) + ' UTC')
    var pill = document.getElementById('sys')
    if (su.servicesTotal) K.setStatus(pill, su.servicesUp === su.servicesTotal ? 'live' : 'warn', su.servicesUp === su.servicesTotal ? 'All ' + su.servicesTotal + ' services up' : su.servicesUp + '/' + su.servicesTotal + ' up')
    else if (ALL.hub.state === 'down') K.setStatus(pill, 'down', 'Status offline')
    G.LAYERS.forEach(function (l) { var m = J.querySelector('[data-jm="' + l.key + '"]'); if (m) m.innerHTML = jm(l.key) })
  }

  // ---------------------------------------------------------------- products
  var LF = document.getElementById('layer-f')
  LF.innerHTML = '<button type="button" data-l="all" aria-pressed="true">' + icon('layers', 'ic') + 'All eight</button>' + G.LAYERS.map(function (l) { return '<button type="button" data-l="' + l.key + '" aria-pressed="false">' + icon(l.icon, 'ic') + esc(l.name) + '</button>' }).join('')
  LF.addEventListener('click', function (e) { var b = e.target.closest('[data-l]'); if (b) setLayer(b.dataset.l) })
  function setLayer(l) {
    layerF = l
    Array.prototype.forEach.call(LF.children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.l === l)) })
    Array.prototype.forEach.call(J.querySelectorAll('[data-layer]'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.layer === l)) })
    renderRows()
  }
  function renderRows() {
    var box = document.getElementById('rows'), open = {}
    Array.prototype.forEach.call(box.querySelectorAll('details[open]'), function (d) { open[d.dataset.k] = 1 })
    box.innerHTML = G.PRODUCTS.filter(function (p) { return layerF === 'all' || p.layer === layerF }).map(function (p) {
      var r = READ[p.key] || {}
      var lv = r.kpi ? '<b>' + (r.kpi.of != null ? r.kpi.v + '/' + r.kpi.of : K.fmt.num(r.kpi.v)) + '</b><span>' + esc(r.kpi.label) + '</span>' : '<span>' + esc(r.why || 'No data yet') + '</span>'
      return '<article class="prow"><img src="' + p.logo + '" alt="" width="52" height="52">' +
        '<div class="nm">' + G.ext(p.url, p.name) + '<span class="stt ' + p.status + '">' + G.STATUS[p.status] + '</span></div>' +
        '<div class="lv">' + lv + '<svg class="t-spark" data-sp="' + p.key + '" aria-hidden="true"></svg></div>' +
        '<div class="ln">' + esc(p.line) + '</div>' +
        '<details data-k="' + p.key + '"' + (open[p.key] ? ' open' : '') + '><summary>' + icon('chevron-right', 'ic') + 'What is live, what is next</summary><ul>' + p.live.map(function (x) { return '<li>' + esc(x) + '</li>' }).join('') + p.next.map(function (x) { return '<li class="bld">Building: ' + esc(x) + '</li>' }).join('') + '</ul></details></article>'
    }).join('')
    G.PRODUCTS.forEach(function (p) {
      var s = box.querySelector('[data-sp="' + p.key + '"]'), r = READ[p.key]; if (!s) return
      if (!r || !r.series || r.series.rows.length < 2) { s.remove(); return }
      var vals = r.series.rows.map(function (x) { return x.v }); if (r.series.kind === 'bars') K.sparkBars(s, vals, r.series.name); else K.sparkLine(s, vals, r.series.name)
      var u = document.createElement('span'); u.className = 'u'; u.textContent = r.series.unit === 'ms' ? 'site response time' : r.series.name.replace(/^Gully (ID|Chain) /, ''); s.after(u)
    })
  }

  // ---------------------------------------------------------------- news
  function renderNews() {
    var days = {}; G.NEWS.forEach(function (n) { (days[n.d] = days[n.d] || []).push(n) })
    set('news', Object.keys(days).sort().reverse().map(function (d) {
      return '<section class="day"><h3>' + new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + '</h3><ul>' + days[d].map(function (n) {
        var p = G.product(n.p), cls = n.s === 'live' ? 'live' : n.s === 'rolling out' ? 'soon' : 'testnet'
        return '<li><img src="' + p.logo + '" alt="" width="24" height="24"><div>' + G.ext(n.href, n.t) + '<small>' + esc(p.name) + '</small></div><span class="stt ' + cls + '">' + esc(n.s) + '</span></li>'
      }).join('') + '</ul></section>'
    }).join(''))
    if (!ALL) return
    var ev = G.liveEvents(ALL).slice(0, 5)
    set('now', ev.length ? ev.map(function (e) { return '<li>' + (e.href ? G.ext(e.href, e.t) : '<span>' + esc(e.t) + '</span>') + '<time datetime="' + e.at + '">' + G.ago(e.at) + '</time></li>' }).join('') : '<li>No events in the sources yet</li>')
  }

  // ---------------------------------------------------------------- work + contact
  set('svc', G.SERVICES.map(function (s) { return '<article><span class="top">' + icon(s.icon, 'ic') + esc(s.name) + '<small>' + esc(s.time) + '</small></span><p>' + esc(s.d) + '</p><button class="btn btn--sm" type="button" data-ask="' + esc(s.type) + '">' + icon('message-square', 'ic') + 'Ask about this</button></article>' }).join(''))
  document.getElementById('svc').addEventListener('click', function (e) { var b = e.target.closest('[data-ask]'); if (!b) return; G.prefill(document.getElementById('contact'), b.dataset.ask); goTab('p-contact') })
  var st = document.getElementById('steps')
  st.querySelector('.st-h').innerHTML = G.STEPS.map(function (s, i) { return '<li><button type="button" data-go>' + (i + 1) + ' · ' + esc(s.name) + '</button></li>' }).join('')
  st.querySelector('.st-p').innerHTML = G.STEPS.map(function (s) { return '<div data-step>' + icon(s.icon, 'ic') + '<div><b>' + esc(s.name) + '</b><p>' + esc(s.d) + '</p></div></div>' }).join('')
  G.stepper(st)
  function renderTrack() {
    var su = G.suite(ALL)
    set('track', su.tvl != null ? 'Venues we built hold <b>' + K.fmt.usd(su.tvl) + '</b> TVL, with <b>' + K.fmt.usd(su.volumeAll) + '</b> all-time volume and <b>' + K.fmt.usd(su.feesAll) + '</b> in fees (DeepCore, Peddles, PeddleSwap, PeddleQuest · gullylabs.xyz/api/stats).' : ALL.stats.state === 'wait' ? 'Loading track record…' : 'Track record figures are offline right now.')
  }
  G.contactForm(document.getElementById('contact'))
  set('flinks', G.PRODUCTS.map(function (p) { return G.ext(p.url, '', '', '<img src="' + p.logo + '" alt="" width="16" height="16">' + esc(p.name)) }).join(''))

  // ---------------------------------------------------------------- live loop
  var watch = G.eventWatcher(G.toast), queued = false
  function render(all) {
    ALL = all; if (queued) return; queued = true
    requestAnimationFrame(function () {
      queued = false; G.PRODUCTS.forEach(function (p) { READ[p.key] = G.reading(ALL, p.key) })
      renderBento(); renderRows(); renderNews(); renderTrack()
    })
  }
  renderNews(); renderRows()
  K.poll(function () { return G.loadAll(render).then(function (all) { render(all); watch(all) }) }, 30000)
})()
