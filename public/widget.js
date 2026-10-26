/*! Gully Labs tracker widget v2 \u00b7 https://docs.gullylabs.xyz/widget
 * <div data-gully-widget="ticker|badge|table" data-chain="all|robinhood|bsc" data-ticker="NVDA"
 * Holder Map: <div data-gully-widget="holders" data-chain="robinhood|bsc|base|hyperevm|solana"
 *      data-token="0x… or a tracked ticker" data-height="640"></div> frames embed.gullylabs.xyz/embed/holders.
 *      Add data-badge="true" for the small linked badge instead; data-embed-key, data-theme, data-accent for white-label plans.
 *      data-theme="dark|light" data-limit="5"></div>
 * <script src="https://embed.gullylabs.xyz/widget.js" async></script>
 * Every figure is read from the live tracker API; nothing is typed in. One request per API base per
 * minute, however many widgets are on the page (badges add one history read each, every 5 minutes).
 * Errors stay inside the widget. Logos come from the API's `logo` / `chainLogo` fields; when a host
 * page blocks them, the ticker's letters stand in. */
(function () {
  'use strict'
  if (window.GullyWidget) return
  var DEFAULT_API = 'https://gullylabs.xyz'
  var TRACKER = 'https://gullylabs.xyz/tracker'
  // The kit's neutral token glyph (a slate disc with a coin ring), used when no logo loads. Never ticker letters.
  var GLYPH = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#1f2935"/><circle cx="32" cy="32" r="15" fill="none" stroke="#aeb5bd" stroke-width="4"/></svg>')
  var REFRESH = 60000
  var HISTORY_REFRESH = 300000
  var UP = '#26ab94'
  var DOWN = '#f2704a'
  var CHAIN = { robinhood: 'Robinhood', bsc: 'BNB Chain' }
  var feeds = {} // api base -> { data, error, subs, timer }
  var REDUCED = false
  try {
    REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch (e) {
    /* ignore */
  }

  var CSS =
    ':host{all:initial;display:block;--bg:#0d141c;--sf:#151d28;--sf2:#1a2330;--ln:#1f2935;--ink:#f4f2ec;--mut:#aeb5be;--fnt:#8a94a1;--acc:#d9b563;--up:' + UP + ';--dn:' + DOWN + '}' +
    ':host([data-theme=light]){--bg:#ffffff;--sf:#f4f6f8;--sf2:#eef1f4;--ln:#dde2e8;--ink:#0d141c;--mut:#2a3542;--fnt:#5f6a78;--acc:#8a6a1a}' +
    '*{box-sizing:border-box}' +
    '.w{background:var(--bg);color:var(--ink);border:1px solid var(--ln);border-radius:12px;font:13px/1.4 "IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;min-width:0;container-type:inline-size;animation:in .45s cubic-bezier(.2,.7,.2,1) both}' +
    '@keyframes in{from{opacity:0;transform:translateY(4px)}}' +
    '.f{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 12px;border-top:1px solid var(--ln);font-size:11px;color:var(--fnt)}' +
    '.f .lv{display:inline-flex;align-items:center;gap:6px}.f .dot{width:6px;height:6px;border-radius:50%;background:var(--up);box-shadow:0 0 0 0 rgba(38,171,148,.6);animation:pulse 2s infinite}.f .dot.st{background:var(--fnt);animation:none}' +
    '@keyframes pulse{70%{box-shadow:0 0 0 6px rgba(38,171,148,0)}100%{box-shadow:0 0 0 0 rgba(38,171,148,0)}}' +
    '.f a{color:var(--acc);text-decoration:none;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}.f a:hover{text-decoration:underline}' +
    '.f a img{width:16px;height:16px;border-radius:50%}' +
    'a:focus-visible,.vp:focus-visible,tr:focus-visible,th button:focus-visible{outline:2px solid var(--acc);outline-offset:2px}' +
    '.m{padding:14px;color:var(--mut)}.e{color:var(--dn)}' +
    /* logo */
    '.lg{position:relative;display:inline-flex;flex:none;width:var(--s,20px);height:var(--s,20px)}' +
    '.lg .c{width:100%;height:100%;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 0 0 1px var(--ln)}' +
    '.lg .c img{width:82%;height:82%;object-fit:contain}' +
    '.lg .c.t{background:var(--sf2)}.lg .c.t img{width:100%;height:100%}' +
    '.lg .ch{position:absolute;right:-2px;bottom:-2px;width:calc(var(--s,20px)*.44);height:calc(var(--s,20px)*.44);border-radius:50%;box-shadow:0 0 0 1.5px var(--bg);background:var(--bg)}' +
    /* gap pill */
    '.pl{display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:999px;font-weight:600;font-size:12px;background:var(--sf2);color:var(--mut);transition:background .4s,color .4s}' +
    '.pl.up{background:rgba(38,171,148,.14);color:var(--up)}.pl.dn{background:rgba(242,112,74,.14);color:var(--dn)}' +
    /* value flash on change */
    '.fu{animation:fu 1.2s ease}.fd{animation:fd 1.2s ease}@keyframes fu{0%{background:rgba(38,171,148,.35)}100%{background:transparent}}@keyframes fd{0%{background:rgba(242,112,74,.35)}100%{background:transparent}}' +
    '.v{border-radius:4px;padding:0 2px;transition:color .3s}' +
    /* ticker */
    '.vp{overflow:hidden;padding:10px 0;-webkit-mask:linear-gradient(90deg,transparent,#000 28px,#000 calc(100% - 28px),transparent);mask:linear-gradient(90deg,transparent,#000 28px,#000 calc(100% - 28px),transparent)}' +
    '.tr{display:flex;width:max-content;animation:mq var(--d,40s) linear infinite}.vp:hover .tr,.vp:focus-within .tr{animation-play-state:paused}.tr>div{display:flex}' +
    '.it{display:inline-flex;align-items:center;gap:8px;padding:0 16px;white-space:nowrap;border-right:1px solid var(--ln);color:inherit;text-decoration:none;transition:background .2s}.it:hover{background:var(--sf)}' +
    '.it b{font:800 15px/1 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:.4px}.it .v{color:var(--mut)}' +
    '@keyframes mq{to{transform:translateX(-50%)}}' +
    /* badge */
    '.b{padding:14px 16px 12px;display:grid;gap:10px}' +
    '.b .hd{display:flex;align-items:center;gap:12px}.b .hd .tx{display:flex;flex-direction:column;min-width:0}' +
    '.b .k{font:800 26px/1 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:.5px}.b .n{color:var(--mut);font:12px/1.3 "Hanken Grotesk",system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.b .row{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.b .p{font-size:22px;font-weight:500}' +
    '.b .bar{position:relative;height:6px;border-radius:3px;background:var(--sf2);overflow:hidden}.b .bar i{position:absolute;top:0;bottom:0;border-radius:3px;transition:left .8s cubic-bezier(.2,.7,.2,1),width .8s cubic-bezier(.2,.7,.2,1)}.b .bar u{position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:var(--fnt)}' +
    '.b .c{font-size:11px;color:var(--fnt);display:flex;justify-content:space-between;gap:8px;white-space:nowrap}.b .sp{margin-top:14px}' +
    '.b svg{display:block;width:100%;height:44px;overflow:visible}.b svg .ln{fill:none;stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1;animation:dr 1.1s .1s cubic-bezier(.2,.7,.2,1) forwards}' +
    '.b svg .ar{opacity:0;animation:fi .8s .5s ease forwards}.b svg .z{stroke:var(--ln);stroke-dasharray:2 3}@keyframes dr{to{stroke-dashoffset:0}}@keyframes fi{to{opacity:1}}' +
    '.b .sp{position:relative}.b .tip{position:absolute;top:0;transform:translate(-50%,-110%);background:var(--sf2);border:1px solid var(--ln);border-radius:6px;padding:3px 6px;font-size:11px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .15s}.b .sp:hover .tip{opacity:1}' +
    '.b .cur{position:absolute;top:0;bottom:0;width:1px;background:var(--acc);opacity:0;pointer-events:none}.b .sp:hover .cur{opacity:.6}' +
    /* table */
    'table{width:100%;border-collapse:collapse}' +
    'th{font-weight:400;font-size:11px;letter-spacing:1px;color:var(--fnt);text-align:right;padding:9px 12px 6px}th:first-child,td:first-child{text-align:left}' +
    'th button{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:3px}th button:hover{color:var(--ink)}th button[aria-sort] {color:var(--acc)}' +
    'td{padding:8px 12px;border-top:1px solid var(--ln);text-align:right;white-space:nowrap}' +
    'tbody tr{cursor:pointer;transition:background .2s;animation:ri .45s cubic-bezier(.2,.7,.2,1) both}tbody tr:hover{background:var(--sf)}@keyframes ri{from{opacity:0;transform:translateY(5px)}}' +
    'td .nm{display:inline-flex;align-items:center;gap:9px}td .nm b{font:800 15px/1 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:.4px}td .nm small{display:block;color:var(--fnt);font-size:11px;margin-top:2px}' +
    'td.gp{min-width:132px}.gw{display:inline-flex;align-items:center;gap:8px;justify-content:flex-end;width:100%}.gb{position:relative;width:54px;height:6px;border-radius:3px;background:var(--sf2);flex:none}.gb i{position:absolute;top:0;bottom:0;border-radius:3px;transform-origin:var(--o,left);animation:gx .8s cubic-bezier(.2,.7,.2,1) both}.gb u{position:absolute;left:50%;top:-2px;bottom:-2px;width:1px;background:var(--fnt)}@keyframes gx{from{transform:scaleX(0)}}' +
    '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}' +
    '@container (max-width:380px){.fc,td .nm small,.gb{display:none}td,th{padding-left:9px;padding-right:9px}td.gp{min-width:0}}' +
    '@media (prefers-reduced-motion:reduce){.w,tbody tr,.gb i,.b svg .ln,.b svg .ar,.f .dot{animation:none!important}.b svg .ln{stroke-dashoffset:0}.b svg .ar{opacity:1}.tr{animation:none}.vp{overflow-x:auto;-webkit-mask:none;mask:none}.tr>.dup{display:none}.fu,.fd{animation:none}}'

  var ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ENT[c]
    })
  }
  function num(v) {
    return typeof v === 'number' && isFinite(v)
  }
  function safeUrl(u) {
    return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null
  }
  function price(v) {
    return num(v) ? '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }) : '\u2014'
  }
  function gap(v) {
    return num(v) ? (v > 0 ? '+' : '') + v.toFixed(2) + '%' : '\u2014'
  }
  // Colour by direction, as the tracker does; a thin pool stays neutral because its price is not trusted.
  function tone(r) {
    if (!num(r.gapPct) || r.status === 'thin') return 'nu'
    return r.gapPct >= 0 ? 'up' : 'dn'
  }
  function arrow(r) {
    return num(r.gapPct) ? (r.gapPct >= 0 ? '\u25b2' : '\u25bc') : ''
  }
  function key(r) {
    return r.chain + ':' + r.ticker
  }
  function link(r) {
    return TRACKER + '/' + encodeURIComponent(r.chain) + '/' + encodeURIComponent(r.ticker)
  }
  function logo(r, size, withChain, base) {
    // No company logo in the answer: the Gully Labs logo service (xStocks, DexScreener, Jupiter ...) by chain and token.
    var src = safeUrl(r.logo) || (r.chain && r.token && (r.chain === 'solana' ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : /^0x[0-9a-fA-F]{40}$/).test(String(r.token)) ? (base || DEFAULT_API) + '/api/logo/' + encodeURIComponent(r.chain) + '/' + r.token + '.png?s=' + (size > 32 ? 128 : 64) : null)
    var ch = withChain && safeUrl(r.chainLogo)
    var inner = src
      ? '<span class="c"><img alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="' + esc(src) + '" ></span>'
      : '<span class="c t"><img alt="" src="' + GLYPH + '"></span>'
    return '<span class="lg" style="--s:' + size + 'px" aria-hidden="true">' + inner + (ch ? '<img class="ch" alt="" loading="lazy" referrerpolicy="no-referrer" src="' + esc(ch) + '">' : '') + '</span>'
  }
  function pill(r) {
    return '<span class="pl ' + tone(r) + '"><span aria-hidden="true">' + arrow(r) + '</span><span class="v" data-v="g">' + esc(gap(r.gapPct)) + '</span></span>'
  }
  function apiBase(el) {
    var a = el.getAttribute('data-api') || DEFAULT_API
    return /^https?:\/\/[^\s"'<>]+$/.test(a) ? a.replace(/\/+$/, '') : DEFAULT_API
  }

  function load(base) {
    var f = feeds[base]
    if (f) return f
    f = feeds[base] = { data: null, error: false, subs: [], timer: 0 }
    function tick() {
      fetch(base + '/api/tracker', { credentials: 'omit', headers: { accept: 'application/json' } })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status)
          return r.json()
        })
        .then(function (d) {
          if (!d || !Array.isArray(d.rows)) throw new Error('bad answer')
          f.data = d
          f.error = false
        })
        .catch(function () {
          f.error = true // the last good read stays on screen, labelled as such
        })
        .then(function () {
          f.subs = f.subs.filter(function (w) {
            return w.el.isConnected
          })
          if (!f.subs.length) {
            clearInterval(f.timer)
            delete feeds[base]
          }
          f.subs.forEach(paint)
        })
    }
    tick()
    f.timer = setInterval(tick, REFRESH)
    return f
  }

  function footer(d, stale) {
    var t = d ? new Date(d.generatedAt) : null
    var when = t && !isNaN(t) ? (stale ? 'last read ' : 'live \u00b7 ') + t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }) + ' UTC' : ''
    return (
      '<div class="f"><span class="lv"><span class="dot' + (stale || !d ? ' st' : '') + '"></span>' + esc(when) + '</span>' +
      /* The Gully Labs mark from the brand kit (public/brand, cut from the kit's icon master) beside the credit. */
      '<a href="' + TRACKER + '" target="_blank" rel="noopener noreferrer"><img src="https://gullylabs.xyz/brand/icon/favicon-32.png" alt="" width="16" height="16" loading="lazy" decoding="async">Gully Labs Stock tracker \u2197</a></div>'
    )
  }

  function rowsFor(w, d) {
    return d.rows.filter(function (r) {
      return w.chain === 'all' || r.chain === w.chain
    })
  }

  function ticker(w, d) {
    var rows = rowsFor(w, d).filter(function (r) {
      return num(r.gapPct)
    })
    if (w.limit) rows = rows.slice(0, w.limit)
    if (!rows.length) return '<div class="m">No stock with a readable gap right now.</div>'
    var items = rows
      .map(function (r) {
        return (
          '<a class="it" data-k="' + esc(key(r)) + '" href="' + esc(link(r)) + '" target="_blank" rel="noopener noreferrer" title="' + esc(r.name + ' \u00b7 ' + (CHAIN[r.chain] || r.chain)) + '">' +
          logo(r, 20, w.chain === 'all', w.base) + '<b>' + esc(r.ticker) + '</b><span class="v" data-v="p">' + esc(price(r.onchain)) + '</span>' + pill(r) + '</a>'
        )
      })
      .join('')
    return '<div class="vp" tabindex="0" role="region" aria-label="Stock token prices and gap to fair price"><div class="tr"><div>' + items + '</div><div class="dup" aria-hidden="true">' + items + '</div></div></div>'
  }

  // Gap to fair as a bar from the centre line: right for above fair, left for below, scaled to \u00b13%.
  function gapBar(r) {
    if (!num(r.gapPct)) return ''
    var span = Math.min(Math.abs(r.gapPct) / 3, 1) * 50
    var left = r.gapPct >= 0 ? 50 : 50 - span
    var col = tone(r) === 'up' ? UP : tone(r) === 'dn' ? DOWN : 'var(--fnt)'
    return '<div class="bar" aria-hidden="true"><i style="left:' + left + '%;width:' + Math.max(span, 1) + '%;background:' + col + '"></i><u></u></div>'
  }

  function spark(w) {
    var pts = w.hist
    if (!pts || pts.length < 3) return ''
    var W = 300
    var H = 44
    var vals = pts.map(function (p) {
      return p[1]
    })
    var lo = Math.min.apply(null, vals.concat([0]))
    var hi = Math.max.apply(null, vals.concat([0]))
    if (hi - lo < 0.2) {
      hi += 0.1
      lo -= 0.1
    }
    var t0 = pts[0][0]
    var t1 = pts[pts.length - 1][0] || t0 + 1
    var x = function (t) {
      return ((t - t0) / (t1 - t0 || 1)) * W
    }
    var y = function (v) {
      return H - 3 - ((v - lo) / (hi - lo)) * (H - 6)
    }
    var dpath = pts
      .map(function (p, i) {
        return (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1)
      })
      .join('')
    var last = vals[vals.length - 1]
    var col = last >= 0 ? UP : DOWN
    var z = y(0).toFixed(1)
    w.sparkPts = pts
    return (
      '<div class="sp" data-sp><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Gap to fair price over the last 24 hours">' +
      '<line class="z" x1="0" x2="' + W + '" y1="' + z + '" y2="' + z + '"></line>' +
      '<path class="ar" d="' + dpath + 'L' + W + ' ' + z + 'L0 ' + z + 'Z" fill="' + col + '" fill-opacity=".12"></path>' +
      '<path class="ln" pathLength="1" d="' + dpath + '" stroke="' + col + '"></path></svg><span class="cur"></span><span class="tip"></span></div>'
    )
  }

  function badge(w, d) {
    var tk = w.ticker.toUpperCase()
    if (!tk) return '<div class="m e">Set data-ticker, for example NVDA.</div>'
    var chain = w.chain === 'all' ? null : w.chain
    var r = d.rows.filter(function (x) {
      return x.ticker === tk && (!chain || x.chain === chain)
    })[0]
    if (!r) return '<div class="m">' + esc(tk) + ' is not tracked' + (chain ? ' on ' + esc(CHAIN[chain] || chain) : '') + '.</div>'
    if (w.histKey !== key(r)) loadHistory(w, r)
    var c = (d.chains || []).filter(function (x) {
      return x.key === r.chain
    })[0]
    var note = r.status === 'thin' ? 'thin pool' : c && !c.sessionOpen ? 'market closed' : 'gap, last 24h'
    var g = num(r.gapPct) ? pill(r) : '<span class="pl">' + (r.status === 'no-pool' ? 'no pool' : 'unreadable') + '</span>'
    return (
      '<a class="b" data-k="' + esc(key(r)) + '" href="' + esc(link(r)) + '" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none">' +
      '<div class="hd">' + logo(r, 40, true, w.base) + '<div class="tx"><span class="k">' + esc(r.ticker) + '</span><span class="n">' + esc(r.name) + ' \u00b7 ' + esc(CHAIN[r.chain] || r.chain) + '</span></div></div>' +
      '<div class="row"><span class="p v" data-v="p">' + esc(price(r.onchain)) + '</span>' + g + '</div>' +
      gapBar(r) +
      '<div class="c" title="Fair price from Chainlink"><span>fair <span class="v" data-v="f">' + esc(price(r.fair)) + '</span></span><span>' + esc(note) + '</span></div>' +
      spark(w) +
      '</a>'
    )
  }

  function loadHistory(w, r) {
    w.histKey = key(r)
    w.hist = null
    clearInterval(w.histTimer)
    function get() {
      fetch(w.base + '/api/tracker/history?chain=' + encodeURIComponent(r.chain) + '&ticker=' + encodeURIComponent(r.ticker), { credentials: 'omit' })
        .then(function (x) {
          return x.ok ? x.json() : null
        })
        .then(function (h) {
          if (!h || !Array.isArray(h.points)) return
          var since = Date.now() / 1000 - 86400
          w.hist = h.points.filter(function (p) {
            return p[0] >= since && num(p[1])
          })
          w.last = null
          paint(w)
        })
        .catch(function () {
          /* the badge simply has no line */
        })
    }
    get()
    w.histTimer = setInterval(function () {
      if (!w.el.isConnected) return clearInterval(w.histTimer)
      get()
    }, HISTORY_REFRESH)
  }

  function table(w, d) {
    var minLiq = (d.rules && d.rules.minLiquidityUsd) || 0
    var by = w.sort || 'gap'
    var rows = rowsFor(w, d)
      .filter(function (r) {
        return num(r.gapPct) && r.status !== 'thin'
      })
      .sort(function (a, b) {
        if (by === 'ticker') return a.ticker < b.ticker ? -1 : 1
        if (by === 'price') return (b.onchain || 0) - (a.onchain || 0)
        return Math.abs(b.gapPct) - Math.abs(a.gapPct)
      })
      .slice(0, w.limit || 5)
    if (!rows.length) return '<div class="m">No pool deep enough to compare right now.</div>'
    var max = Math.max.apply(
      null,
      rows.map(function (r) {
        return Math.abs(r.gapPct)
      }).concat([0.25])
    )
    var body = rows
      .map(function (r, i) {
        var span = (Math.abs(r.gapPct) / max) * 50
        var col = tone(r) === 'up' ? UP : tone(r) === 'dn' ? DOWN : 'var(--fnt)'
        var bar = '<span class="gb" aria-hidden="true"><i style="left:' + (r.gapPct >= 0 ? 50 : 50 - span) + '%;width:' + Math.max(span, 2) + '%;background:' + col + ';--o:' + (r.gapPct >= 0 ? 'left' : 'right') + '"></i><u></u></span>'
        return (
          '<tr tabindex="0" data-k="' + esc(key(r)) + '" data-href="' + esc(link(r)) + '" style="animation-delay:' + i * 50 + 'ms">' +
          '<td><span class="nm">' + logo(r, 26, w.chain === 'all', w.base) + '<span><b>' + esc(r.ticker) + '</b><small>' + esc(r.name) + '</small></span></span></td>' +
          '<td><span class="v" data-v="p">' + esc(price(r.onchain)) + '</span></td><td class="fc"><span class="v" data-v="f">' + esc(price(r.fair)) + '</span></td>' +
          '<td class="gp"><span class="gw">' + bar + pill(r) + '</span></td></tr>'
        )
      })
      .join('')
    var th = function (k, label, cls) {
      return '<th' + (cls ? ' class="' + cls + '"' : '') + '><button type="button" data-sort="' + k + '"' + (by === k ? ' aria-sort="descending"' : '') + '>' + label + (by === k ? ' \u2193' : '') + '</button></th>'
    }
    return (
      '<table><caption class="sr">Widest gaps to fair price, pools with $' + esc(minLiq.toLocaleString('en-US')) + ' or more liquidity</caption>' +
      '<thead><tr>' + th('ticker', 'STOCK') + th('price', 'ONCHAIN') + '<th class="fc">FAIR</th>' + th('gap', 'GAP') + '</tr></thead><tbody>' + body + '</tbody></table>'
    )
  }

  // Values that moved since the last read flash green or red once; everything else stays put.
  function flash(w) {
    var prev = w.prevVals || {}
    var next = {}
    var els = w.box.querySelectorAll('[data-k]')
    for (var i = 0; i < els.length; i++) {
      var k = els[i].getAttribute('data-k')
      var vs = els[i].querySelectorAll('[data-v]')
      for (var j = 0; j < vs.length; j++) {
        var id = k + '|' + vs[j].getAttribute('data-v')
        var txt = vs[j].textContent
        var n = parseFloat(txt.replace(/[^0-9.\-]/g, ''))
        if (id in prev && prev[id] !== n && num(n) && num(prev[id]) && !REDUCED) vs[j].classList.add(n > prev[id] ? 'fu' : 'fd')
        next[id] = n
      }
    }
    w.prevVals = next
  }

  function wire(w) {
    // Logos a host page blocks fall back to the neutral token glyph.
    var imgs = w.box.querySelectorAll('.lg .c img')
    for (var i = 0; i < imgs.length; i++)
      imgs[i].addEventListener('error', function (e) {
        var c = e.target.parentNode
        // A logo the host page blocks or that fails: the neutral token glyph, never letters.
        c.className = 'c t'
        e.target.removeAttribute('srcset')
        if (e.target.src !== GLYPH) e.target.src = GLYPH
      })
    var chs = w.box.querySelectorAll('.lg .ch')
    for (var j = 0; j < chs.length; j++)
      chs[j].addEventListener('error', function (e) {
        e.target.remove()
      })
    if (w.type === 'table') {
      var trs = w.box.querySelectorAll('tbody tr')
      for (var t = 0; t < trs.length; t++) {
        trs[t].addEventListener('click', function () {
          window.open(this.getAttribute('data-href'), '_blank', 'noopener,noreferrer')
        })
        trs[t].addEventListener('keydown', function (e) {
          if (e.key === 'Enter') window.open(this.getAttribute('data-href'), '_blank', 'noopener,noreferrer')
        })
      }
      var bs = w.box.querySelectorAll('th button')
      for (var b = 0; b < bs.length; b++)
        bs[b].addEventListener('click', function () {
          w.sort = this.getAttribute('data-sort')
          w.last = null
          paint(w)
        })
    }
    var sp = w.box.querySelector('[data-sp]')
    if (sp && w.sparkPts) {
      var pts = w.sparkPts
      sp.addEventListener('mousemove', function (e) {
        var rect = sp.getBoundingClientRect()
        var fx = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1)
        var t0 = pts[0][0]
        var t1 = pts[pts.length - 1][0]
        var tt = t0 + fx * (t1 - t0)
        var best = pts[0]
        for (var q = 1; q < pts.length; q++) if (Math.abs(pts[q][0] - tt) < Math.abs(best[0] - tt)) best = pts[q]
        var bx = ((best[0] - t0) / (t1 - t0 || 1)) * rect.width
        var tip = sp.querySelector('.tip')
        var cur = sp.querySelector('.cur')
        cur.style.left = bx + 'px'
        tip.style.left = Math.min(Math.max(bx, 40), rect.width - 40) + 'px'
        tip.textContent = new Date(best[0] * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }) + ' UTC' + ' \u00b7 ' + gap(best[1])
      })
    }
  }

  function paint(w) {
    try {
      var f = feeds[w.base]
      var d = f && f.data
      var inner
      if (!d) inner = f && f.error ? '<div class="m e">The tracker could not be read. Retrying every minute.</div>' : '<div class="m">Reading the tracker\u2026</div>'
      else inner = (w.type === 'badge' ? badge : w.type === 'table' ? table : ticker)(w, d)
      var html = inner + footer(d, f && f.error)
      if (html === w.last) return
      // The ticker keeps scrolling across refreshes: if the same stocks are shown, only their text changes.
      var tr = w.box.querySelector('.tr')
      if (w.type === 'ticker' && tr && w.lastKeys && d) {
        var tmp = document.createElement('div')
        tmp.innerHTML = html
        var keys = Array.prototype.map
          .call(tmp.querySelectorAll('.tr > div:first-child .it'), function (n) {
            return n.getAttribute('data-k')
          })
          .join(',')
        if (keys === w.lastKeys) {
          var olds = w.box.querySelectorAll('.it')
          var news = tmp.querySelectorAll('.it')
          for (var i = 0; i < olds.length && i < news.length; i++) {
            olds[i].querySelector('[data-v=p]').textContent = news[i].querySelector('[data-v=p]').textContent
            var op = olds[i].querySelector('.pl')
            var np = news[i].querySelector('.pl')
            op.className = np.className
            op.innerHTML = np.innerHTML
          }
          w.box.querySelector('.f').outerHTML = tmp.querySelector('.f').outerHTML
          w.last = html
          flash(w)
          return
        }
      }
      w.last = html
      w.box.innerHTML = html
      tr = w.box.querySelector('.tr')
      if (tr) {
        // Constant speed (about 40 px/s) whatever the number of stocks.
        tr.style.setProperty('--d', Math.max(14, tr.scrollWidth / 2 / 40) + 's')
        w.lastKeys = Array.prototype.map
          .call(w.box.querySelectorAll('.tr > div:first-child .it'), function (n) {
            return n.getAttribute('data-k')
          })
          .join(',')
      }
      wire(w)
      flash(w)
    } catch (e) {
      /* never into the host page */
    }
  }

  /* The Holder Map embed: a responsive iframe of gullylabs.xyz/embed/holders/<chain>/<token> (it reads its
     own data; nothing is fetched by this script). Chain and token are checked before they go in the URL. */
  function mountHolders(el) {
    var chain = (el.getAttribute('data-chain') || '').toLowerCase()
    var token = el.getAttribute('data-token') || el.getAttribute('data-ticker') || ''
    if (!/^(robinhood|bsc|base|hyperevm|solana)$/.test(chain) || !/^[A-Za-z0-9]{1,64}$/.test(token)) {
      el.textContent = 'Holder Map: set data-chain and data-token.'
      return
    }
    var base = apiBase(el)
    if ((el.getAttribute('data-badge') || '').toLowerCase() === 'true' || el.getAttribute('data-badge') === '') {
      /* Badge mode: the small SVG pill (cached data only), linked to the map. */
      var a = document.createElement('a')
      a.href = base + '/holders/' + chain + '/' + token
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.title = 'Holder Map by Gully Labs'
      var im = document.createElement('img')
      im.src = base + '/api/holders/' + chain + '/' + token + '/badge.svg'
      im.alt = 'Holder Map by Gully Labs'
      im.loading = 'lazy'
      im.style.cssText = 'display:inline-block;max-width:100%;height:auto;border:0'
      a.appendChild(im)
      el.appendChild(a)
      return
    }
    var h = parseInt(el.getAttribute('data-height') || '', 10)
    var f = document.createElement('iframe')
    var q = []
    var ek = el.getAttribute('data-embed-key') || ''
    if (/^gle_0x[0-9a-fA-F]{40}\.[0-9a-f]{24}$/.test(ek)) q.push('key=' + encodeURIComponent(ek))
    if (el.getAttribute('data-theme') === 'light') q.push('theme=light')
    var ac = el.getAttribute('data-accent') || ''
    if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(ac)) q.push('accent=' + encodeURIComponent(ac))
    /* The map frames from the embed host unless the page points data-api elsewhere; widget.js itself keeps working from gullylabs.xyz too. */
    f.src = (base === DEFAULT_API ? 'https://embed.gullylabs.xyz' : base) + '/embed/holders/' + chain + '/' + token + (q.length ? '?' + q.join('&') : '')
    f.title = 'Holder Map by Gully Labs'
    f.loading = 'lazy'
    f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
    f.style.cssText = 'display:block;width:100%;max-width:100%;border:0;border-radius:12px;background:#0d141c;height:' + (h >= 360 && h <= 2000 ? h : 760) + 'px'
    el.appendChild(f)
  }

  function mount(el) {
    if (el.__gully) return
    var type = (el.getAttribute('data-gully-widget') || '').toLowerCase()
    if (type === 'holders') {
      el.__gully = true
      return mountHolders(el)
    }
    if (!el.attachShadow) return
    el.__gully = true
    var limit = parseInt(el.getAttribute('data-limit') || '', 10)
    var root = el.shadowRoot || el.attachShadow({ mode: 'open' })
    var w = {
      el: el,
      type: type === 'badge' || type === 'table' ? type : 'ticker',
      chain: (el.getAttribute('data-chain') || 'all').toLowerCase(),
      ticker: el.getAttribute('data-ticker') || '',
      limit: limit > 0 ? Math.min(limit, 60) : 0,
      base: apiBase(el),
      box: document.createElement('div'),
    }
    el.setAttribute('data-theme', el.getAttribute('data-theme') === 'light' ? 'light' : 'dark')
    w.box.className = 'w'
    w.box.setAttribute('part', 'widget')
    if (w.type === 'badge') {
      w.box.style.maxWidth = '360px'
      w.box.style.minWidth = '280px'
    }
    // A constructed stylesheet needs no style-src 'unsafe-inline' on the host page; <style> is the fallback.
    try {
      var sheet = new CSSStyleSheet()
      sheet.replaceSync(CSS)
      root.adoptedStyleSheets = [sheet]
    } catch (e) {
      var style = document.createElement('style')
      style.textContent = CSS
      root.appendChild(style)
    }
    root.appendChild(w.box)
    load(w.base).subs.push(w)
    paint(w)
  }

  function scan() {
    try {
      var els = document.querySelectorAll('[data-gully-widget]')
      for (var i = 0; i < els.length; i++) mount(els[i])
    } catch (e) {
      /* ignore */
    }
  }

  window.GullyWidget = { scan: scan, version: '2' }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan)
  else scan()
  // Widgets added later (single-page apps) are picked up on the next frame.
  try {
    var queued = false
    new MutationObserver(function () {
      if (queued) return
      queued = true
      requestAnimationFrame(function () {
        queued = false
        scan()
      })
    }).observe(document.documentElement, { childList: true, subtree: true })
  } catch (e) {
    /* ignore */
  }
})()

/*! Gully Score widget (additive; the tracker widget above is unchanged) · https://docs.gullylabs.xyz/gully-score#embed
 * <div data-gully-score data-chain="base" data-address="0x…" data-theme="dark|light"></div>
 * <script src="https://embed.gullylabs.xyz/widget.js" async></script>
 * Reads GET /api/score/:chain/:address (one request per contract per 5 minutes, however many widgets show it) and
 * draws the score ring, the date it was read and a link to the score page with every part and its evidence.
 * A score that could not be given says so; nothing is ever drawn as 0. Errors stay inside the widget. */
;(function () {
  'use strict'
  if (window.GullyScoreWidget) return
  var DEFAULT_API = 'https://gullylabs.xyz'
  var SITE = 'https://gullylabs.xyz'
  var REFRESH = 300000
  var feeds = {}
  var CSS =
    ':host{all:initial;display:block;--bg:#0d141c;--sf:#151d28;--ln:#2a3542;--ink:#f4f2ec;--mut:#aeb5be;--fnt:#7d8794;--acc:#d9b563}' +
    ':host([data-theme=light]){--bg:#ffffff;--sf:#f4f6f8;--ln:#dde2e8;--ink:#0d141c;--mut:#3a4452;--fnt:#6c7888;--acc:#8a6a1a}' +
    '*{box-sizing:border-box}' +
    '.w{display:flex;align-items:center;gap:14px;max-width:340px;min-width:240px;padding:12px 14px;background:var(--bg);color:var(--ink);border:1px solid var(--ln);border-radius:12px;font:12px/1.4 "IBM Plex Mono",ui-monospace,Menlo,monospace;text-decoration:none;animation:in .45s cubic-bezier(.2,.7,.2,1) both}' +
    'a.w:hover{border-color:var(--acc)}a.w:focus-visible{outline:2px solid var(--acc);outline-offset:2px}' +
    '@keyframes in{from{opacity:0;transform:translateY(4px)}}' +
    '.r{position:relative;width:64px;height:64px;flex:none}.r svg{width:64px;height:64px;transform:rotate(-90deg)}' +
    '.r .bg{fill:none;stroke:var(--ln);stroke-width:6}.r .fg{fill:none;stroke-width:6;stroke-linecap:round;stroke-dasharray:163.4;stroke-dashoffset:163.4;transition:stroke-dashoffset 1.1s cubic-bezier(.2,.7,.2,1),stroke .4s}' +
    '.r b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:800 24px/1 "Barlow Condensed","Arial Narrow",sans-serif}' +
    '.t{display:flex;flex-direction:column;gap:3px;min-width:0}.h{display:flex;align-items:center;gap:6px;font:700 14px/1 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:.6px}.h img{width:18px;height:18px;border-radius:4px}' +
    '.n{color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:13px/1.3 "Hanken Grotesk",system-ui,sans-serif}.d{color:var(--fnt);font-size:11px}' +
    '.pulse{animation:pl 1.6s ease-in-out infinite}@keyframes pl{50%{opacity:.45}}' +
    '@media (prefers-reduced-motion:reduce){.w{animation:none}.r .fg{transition:stroke-dashoffset .15s linear}.pulse{animation:none}}'
  var ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ENT[c]
    })
  }
  function color(s) {
    return s === null ? '#7d8794' : s >= 80 ? '#6fcf6a' : s >= 60 ? '#d9b563' : s >= 40 ? '#f49b5a' : '#ff8a7a'
  }
  function apiBase(el) {
    var a = el.getAttribute('data-api') || DEFAULT_API
    return /^https?:\/\/[^\s"'<>]+$/.test(a) ? a.replace(/\/+$/, '') : DEFAULT_API
  }
  function short(a) {
    return a.slice(0, 6) + '…' + a.slice(-4)
  }
  function load(url) {
    var f = feeds[url]
    if (f) return f
    f = feeds[url] = { data: null, error: null, subs: [] }
    function tick() {
      fetch(url)
        .then(function (r) {
          return r.json().then(function (j) {
            if (!r.ok) throw new Error((j && j.error) || 'unavailable')
            return j
          })
        })
        .then(function (d) {
          f.data = d
          f.error = null
        })
        .catch(function (e) {
          f.error = String((e && e.message) || 'unavailable')
        })
        .then(function () {
          f.subs.forEach(paint)
        })
    }
    tick()
    setInterval(tick, REFRESH)
    return f
  }
  function paint(w) {
    try {
      var f = feeds[w.url]
      var d = f && f.data
      var page = SITE + '/score/' + encodeURIComponent(w.chain) + '/' + encodeURIComponent(w.address)
      var s = d && typeof d.score === 'number' ? d.score : null
      var name = (d && d.name) || short(w.address)
      var line = !d ? (f && f.error ? 'Score unavailable just now' : 'Reading the score…') : s === null ? 'Not enough public data for a score' : d.grade + ' · ' + new Date(d.computedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
      var label = s === null ? 'Gully Score: ' + line : 'Gully Score ' + s + ' out of 100 for ' + name + ', ' + line
      if (!w.box.firstChild) {
        w.box.innerHTML =
          '<a class="w" target="_blank" rel="noopener noreferrer"><span class="r"><svg viewBox="0 0 64 64" aria-hidden="true"><circle class="bg" cx="32" cy="32" r="26"/><circle class="fg" cx="32" cy="32" r="26"/></svg><b></b></span>' +
          '<span class="t"><span class="h"><img alt="" src="' + esc(w.base) + '/brand/icon/favicon-48.png" width="18" height="18">GULLY SCORE</span><span class="n"></span><span class="d"></span></span></a>'
      }
      var a = w.box.querySelector('a')
      a.href = page
      a.setAttribute('aria-label', label + ' (opens in a new tab)')
      var b = w.box.querySelector('b')
      b.textContent = s === null ? (d ? 'N/A' : '…') : String(s)
      b.style.color = color(s)
      b.className = d ? '' : 'pulse'
      w.box.querySelector('.n').textContent = name
      w.box.querySelector('.d').textContent = line
      var fg = w.box.querySelector('.fg')
      fg.style.stroke = color(s)
      // Next frame, so the ring sweeps from empty to the score on first paint and glides on refresh.
      requestAnimationFrame(function () {
        fg.style.strokeDashoffset = String(163.4 * (1 - (s === null ? 0 : s / 100)))
      })
    } catch (e) {
      /* never into the host page */
    }
  }
  function mount(el) {
    if (el.__gullyScore || !el.attachShadow) return
    var chain = (el.getAttribute('data-chain') || '').toLowerCase()
    var address = (el.getAttribute('data-address') || '').toLowerCase()
    if (!/^[a-z]{2,12}$/.test(chain) || !/^0x[0-9a-f]{40}$/.test(address)) return
    el.__gullyScore = true
    el.setAttribute('data-theme', el.getAttribute('data-theme') === 'light' ? 'light' : 'dark')
    var root = el.shadowRoot || el.attachShadow({ mode: 'open' })
    try {
      var sheet = new CSSStyleSheet()
      sheet.replaceSync(CSS)
      root.adoptedStyleSheets = [sheet]
    } catch (e) {
      var style = document.createElement('style')
      style.textContent = CSS
      root.appendChild(style)
    }
    var base = apiBase(el)
    var w = { chain: chain, address: address, base: base, url: base + '/api/score/' + chain + '/' + address, box: document.createElement('div') }
    w.box.setAttribute('part', 'score')
    root.appendChild(w.box)
    load(w.url).subs.push(w)
    paint(w)
  }
  function scan() {
    try {
      var els = document.querySelectorAll('[data-gully-score]')
      for (var i = 0; i < els.length; i++) mount(els[i])
    } catch (e) {
      /* ignore */
    }
  }
  window.GullyScoreWidget = { scan: scan, version: '1' }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan)
  else scan()
  try {
    var queued = false
    new MutationObserver(function () {
      if (queued) return
      queued = true
      requestAnimationFrame(function () {
        queued = false
        scan()
      })
    }).observe(document.documentElement, { childList: true, subtree: true })
  } catch (e) {
    /* ignore */
  }
})()
