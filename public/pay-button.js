/* Gully Pay "Pay with crypto" button (optional). Paste next to a link like
     <a href="https://gullylabs.xyz/pay/l/…" target="_blank" rel="noopener" data-gully-pay="popup">Pay with crypto</a>
   and the click opens the checkout in a popup window; data-gully-pay="tab" (or no script at all) opens a
   new tab. The checkout cannot be put in an iframe. No cookies, no tracking, nothing else on the page. */
;(function () {
  if (window.__gullyPayButton) return
  window.__gullyPayButton = true
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[data-gully-pay]') : null
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    var url
    try {
      url = new URL(a.href)
    } catch (err) {
      return
    }
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') return
    if (!/^\/pay\/(m\/)?(l\/)?[\w-]+$/.test(url.pathname)) return
    if (a.getAttribute('data-gully-pay') !== 'popup') return
    var w = Math.min(520, screen.availWidth || 520)
    var h = Math.min(860, screen.availHeight || 860)
    var left = Math.max(0, ((screen.availWidth || w) - w) / 2)
    var top = Math.max(0, ((screen.availHeight || h) - h) / 2)
    var win = window.open(url.href, 'gully-pay', 'popup=yes,width=' + w + ',height=' + h + ',left=' + left + ',top=' + top)
    if (win) {
      try {
        win.opener = null
      } catch (err) {
        /* already severed */
      }
      e.preventDefault()
    }
    // Popup blocked: the link's own target="_blank" opens a tab.
  })
})()
