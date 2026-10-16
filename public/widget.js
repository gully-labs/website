/*! Gully Labs tracker widget · https://docs.gullylabs.xyz/widget
 * <div data-gully-widget="ticker|badge|table" data-chain="all|robinhood|bsc" data-ticker="NVDA"
 *      data-theme="dark|light" data-limit="5"></div>
 * <script src="https://gullylabs.xyz/widget.js" async></script>
 * Every figure is read from the live tracker API; nothing is typed in. One request per API base per
 * minute, however many widgets are on the page. Errors stay inside the widget. */
(function () {
  'use strict'
  if (window.GullyWidget) return
  var DEFAULT_API = 'https://gullylabs.xyz'
  var TRACKER = 'https://gullylabs.xyz/tracker'
  var REFRESH = 60000
  var UP = '#1f9e89'
  var DOWN = '#e4572e'
  var CHAIN = { robinhood: 'Robinhood', bsc: 'BNB' }
  var feeds = {} // api base -> { data, error, subs, timer }

  var CSS =
    ':host{all:initial;display:block;--bg:#0b0e13;--sf:#10141a;--ln:#1d232c;--ink:#eef0f2;--mut:#a6b0bd;--fnt:#6c7888;--acc:#e8c060}' +
    ':host([data-theme=light]){--bg:#eef0f2;--ln:#cfd5dc;--ink:#0b0e13;--mut:#3a4452;--fnt:#5c6878;--acc:#5a4a22}' +
    '.w{box-sizing:border-box;background:var(--bg);color:var(--ink);border:1px solid var(--ln);border-radius:10px;font:13px/1.4 "IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;min-width:0;container-type:inline-size;animation:in .4s ease both}' +
    '@keyframes in{from{opacity:0}}' +
    '.f{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 10px;border-top:1px solid var(--ln);font-size:10px;color:var(--fnt)}' +
    '.f a{color:var(--acc);text-decoration:none;white-space:nowrap}.f a:hover{text-decoration:underline}a:focus-visible,.vp:focus-visible{outline:2px solid var(--acc);outline-offset:2px}' +
    '.m{padding:12px;color:var(--mut)}.e,.w .dn{color:' + DOWN + '}.w .up{color:' + UP + '}.w .nu{color:var(--mut)}' +
    '.vp{overflow:hidden;padding:9px 0;-webkit-mask:linear-gradient(90deg,transparent,#000 24px,#000 calc(100% - 24px),transparent);mask:linear-gradient(90deg,transparent,#000 24px,#000 calc(100% - 24px),transparent)}' +
    '.tr{display:flex;width:max-content;animation:mq var(--d,40s) linear infinite}.vp:hover .tr,.vp:focus-within .tr{animation-play-state:paused}.tr>div{display:flex}' +
    '.it{display:inline-flex;gap:7px;padding:0 14px;white-space:nowrap;border-right:1px solid var(--ln)}.it b{font-weight:600}.it span{color:var(--mut)}' +
    '@keyframes mq{to{transform:translateX(-50%)}}' +
    '.b{padding:12px 14px;display:grid;gap:4px}.b .t{display:flex;align-items:baseline;justify-content:space-between;gap:12px}' +
    '.b .k{font:800 26px/1 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:.5px}.b .n{color:var(--mut);font:12px "Hanken Grotesk",system-ui,sans-serif;text-align:right}' +
    '.b .p{font-size:18px}.b .g{font-size:14px;font-weight:600}.b .c{font-size:11px;color:var(--fnt)}' +
    'table{width:100%;border-collapse:collapse}th{font-weight:400;font-size:10px;letter-spacing:1px;color:var(--fnt);text-align:right;padding:8px 10px 4px}th:first-child,td:first-child{text-align:left}' +
    'td{padding:6px 10px;border-top:1px solid var(--ln);text-align:right;white-space:nowrap}td small{color:var(--fnt);margin-left:6px}tbody tr:hover{background:var(--sf)}' +
    ':host([data-theme=light]) tbody tr:hover{background:#fff}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}' +
    '@container (max-width:360px){.fc,td small{display:none}td,th{padding-left:8px;padding-right:8px}}' +
    '@media (prefers-reduced-motion:reduce){.w{animation:none}.tr{animation:none}.vp{overflow-x:auto;-webkit-mask:none;mask:none}.tr>.dup{display:none}}'

  var ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ENT[c]
    })
  }
  function num(v) {
    return typeof v === 'number' && isFinite(v)
  }
  function price(v) {
    return num(v) ? '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 }) : '—'
  }
  function gap(v) {
    return num(v) ? (v > 0 ? '+' : '') + v.toFixed(2) + '%' : '—'
  }
  // Colour only a gap the tracker itself would call a move: in-line gaps and thin pools stay neutral.
  function tone(r) {
    if (!num(r.gapPct) || r.status === 'in-line' || r.status === 'thin') return 'nu'
    return r.gapPct >= 0 ? 'up' : 'dn'
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
    var when = t && !isNaN(t) ? (stale ? 'last read ' : 'live · ') + t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
    return '<div class="f"><span>' + esc(when) + '</span><a href="' + TRACKER + '" target="_blank" rel="noopener">Gully Labs tracker ↗</a></div>'
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
        return '<span class="it"><b>' + esc(r.ticker) + '</b><span>' + esc(price(r.onchain)) + '</span><span class="' + tone(r) + '">' + esc(gap(r.gapPct)) + '</span></span>'
      })
      .join('')
    return '<div class="vp" tabindex="0" role="region" aria-label="Stock token prices and gap to fair price"><div class="tr"><div>' + items + '</div><div class="dup" aria-hidden="true">' + items + '</div></div></div>'
  }

  function badge(w, d) {
    var tk = w.ticker.toUpperCase()
    if (!tk) return '<div class="m e">Set data-ticker, for example NVDA.</div>'
    var chain = w.chain === 'all' ? null : w.chain
    var r = d.rows.filter(function (x) {
      return x.ticker === tk && (!chain || x.chain === chain)
    })[0]
    if (!r) return '<div class="m">' + esc(tk) + ' is not tracked' + (chain ? ' on ' + esc(CHAIN[chain] || chain) : '') + '.</div>'
    var c = (d.chains || []).filter(function (x) {
      return x.key === r.chain
    })[0]
    var note = r.status === 'thin' ? ' · thin pool, not flagged' : c && !c.sessionOpen ? ' · market closed, last session' : ''
    var g = num(r.gapPct) ? gap(r.gapPct) + ' vs fair' : r.status === 'no-pool' ? 'no pool' : 'unreadable'
    return (
      '<div class="b"><div class="t"><span class="k">' + esc(r.ticker) + '</span><span class="n">' + esc(r.name) + ' · ' + esc(CHAIN[r.chain] || r.chain) + '</span></div>' +
      '<div class="t"><span class="p">' + esc(price(r.onchain)) + '</span><span class="g ' + tone(r) + '">' + esc(g) + '</span></div>' +
      '<span class="c">fair ' + esc(price(r.fair)) + ' from Chainlink' + esc(note) + '</span></div>'
    )
  }

  function table(w, d) {
    var minLiq = (d.rules && d.rules.minLiquidityUsd) || 0
    var rows = rowsFor(w, d)
      .filter(function (r) {
        return num(r.gapPct) && r.status !== 'thin'
      })
      .sort(function (a, b) {
        return Math.abs(b.gapPct) - Math.abs(a.gapPct)
      })
      .slice(0, w.limit || 5)
    if (!rows.length) return '<div class="m">No pool deep enough to compare right now.</div>'
    var body = rows
      .map(function (r) {
        return '<tr><td><b>' + esc(r.ticker) + '</b>' + (w.chain === 'all' ? '<small>' + esc(CHAIN[r.chain] || r.chain) + '</small>' : '') + '</td><td>' + esc(price(r.onchain)) + '</td><td class="fc">' + esc(price(r.fair)) + '</td><td class="' + tone(r) + '">' + esc(gap(r.gapPct)) + '</td></tr>'
      })
      .join('')
    return '<table><caption class="sr">Widest gaps to fair price, pools with $' + esc(minLiq.toLocaleString('en-US')) + ' or more liquidity</caption><thead><tr><th>STOCK</th><th>ONCHAIN</th><th class="fc">FAIR</th><th>GAP</th></tr></thead><tbody>' + body + '</tbody></table>'
  }

  function paint(w) {
    try {
      var f = feeds[w.base]
      var d = f && f.data
      var inner
      if (!d) inner = f && f.error ? '<div class="m e">The tracker could not be read. Retrying every minute.</div>' : '<div class="m">Reading the tracker…</div>'
      else inner = (w.type === 'badge' ? badge : w.type === 'table' ? table : ticker)(w, d)
      var html = inner + footer(d, f && f.error)
      if (html === w.last) return
      w.last = html
      w.box.innerHTML = html
      var tr = w.box.querySelector('.tr')
      // Constant speed (about 45 px/s) whatever the number of stocks.
      if (tr) tr.style.setProperty('--d', Math.max(12, tr.scrollWidth / 2 / 45) + 's')
    } catch (e) {
      /* never into the host page */
    }
  }

  function mount(el) {
    if (el.__gully || !el.attachShadow) return
    el.__gully = true
    var type = (el.getAttribute('data-gully-widget') || '').toLowerCase()
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
    if (w.type === 'badge') w.box.style.maxWidth = '340px'
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

  window.GullyWidget = { scan: scan, version: '1' }
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
