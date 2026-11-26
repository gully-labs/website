/* <gully-ask>: Ask this project. One script, no dependencies, no cookies, nothing stored.
 *   <script src="https://gullylabs.xyz/gully-ask.js" async></script>
 *   <gully-ask project="your-project" site-key="pk_..." theme="auto"></gully-ask>
 * Attributes: project (required), site-key, theme (auto|light|dark), mode (bubble|page), api (override origin, tests).
 * Draws a small button that opens a panel; styles live in a constructable stylesheet inside the shadow root, so a host
 * page's CSP needs no style allowance. Answers are plain text; links are shown as text, never auto-opened. */
(function () {
  if (typeof customElements === 'undefined' || customElements.get('gully-ask')) return
  var BASE = (function () {
    try { return new URL(document.currentScript && document.currentScript.src).origin } catch (e) { return 'https://gullylabs.xyz' }
  })()
  var CSS = ':host{all:initial;font:14px/1.45 system-ui,sans-serif;--bg:#fff;--fg:#0E1C38;--mut:#5a6785;--line:#d6dbe8;--acc:#3754A0}' +
    ':host([data-theme=dark]){--bg:#0E1C38;--fg:#F1F3F8;--mut:#a9b4d0;--line:#2a3a60;--acc:#6F8DDF}' +
    '.fab{position:fixed;right:16px;bottom:16px;min-height:44px;min-width:44px;border:0;border-radius:22px;padding:0 16px;background:var(--acc);color:#fff;font:inherit;cursor:pointer}' +
    '.panel{position:fixed;right:16px;bottom:72px;width:min(380px,calc(100vw - 32px));max-height:min(560px,70vh);display:flex;flex-direction:column;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:12px;overflow:hidden}' +
    ':host([mode=page]) .panel{position:static;width:auto;max-height:none;height:100vh;border:0;border-radius:0}' +
    ':host([mode=page]) .fab{display:none}' +
    '.log{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px}' +
    '.m{white-space:pre-wrap;word-break:break-word;padding:8px 10px;border-radius:8px;border:1px solid var(--line)}' +
    '.u{align-self:flex-end;background:var(--acc);color:#fff;border-color:transparent}' +
    'form{display:flex;gap:8px;padding:8px;border-top:1px solid var(--line)}' +
    'input{flex:1;min-height:44px;border:1px solid var(--line);border-radius:8px;padding:0 10px;background:var(--bg);color:var(--fg);font:inherit}' +
    'button.s{min-height:44px;min-width:44px;border:0;border-radius:8px;background:var(--acc);color:#fff;font:inherit;cursor:pointer}' +
    '.n{color:var(--mut);font-size:12px;padding:0 12px 8px}'
  function sheet() {
    try { var s = new CSSStyleSheet(); s.replaceSync(CSS); return s } catch (e) { return null }
  }
  class GullyAsk extends HTMLElement {
    connectedCallback() {
      if (this._on) return
      this._on = true
      var root = this.attachShadow({ mode: 'open' })
      var sh = sheet()
      if (sh) root.adoptedStyleSheets = [sh]
      else { var st = document.createElement('style'); st.textContent = CSS; root.appendChild(st) }
      var theme = this.getAttribute('theme') || 'auto'
      this.setAttribute('data-theme', theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme)
      this.history = []
      root.innerHTML += '<button class="fab" type="button" aria-expanded="false">Ask</button><section class="panel" role="dialog" aria-label="Ask Zayden about this project" hidden><div class="log" aria-live="polite"></div><div class="n">AI answers can be wrong. Information only.</div><form><input name="q" maxlength="500" placeholder="Ask a question" aria-label="Your question" autocomplete="off"><button class="s" type="submit">Send</button></form></section>'
      var fab = root.querySelector('.fab'), panel = root.querySelector('.panel'), log = root.querySelector('.log'), form = root.querySelector('form'), input = root.querySelector('input')
      var page = this.getAttribute('mode') === 'page'
      var toggle = function (open) { panel.hidden = !open; fab.setAttribute('aria-expanded', String(open)); if (open) input.focus() }
      if (page) toggle(true)
      fab.addEventListener('click', function () { toggle(panel.hidden) })
      panel.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !page) { toggle(false); fab.focus() } })
      var self = this
      function add(text, cls) { var d = document.createElement('div'); d.className = 'm ' + (cls || ''); d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; return d }
      form.addEventListener('submit', function (e) {
        e.preventDefault()
        var q = input.value.trim()
        if (!q) return
        input.value = ''
        add(q, 'u')
        var wait = add('...')
        var api = self.getAttribute('api') || BASE
        var headers = { 'content-type': 'application/json' }
        var key = self.getAttribute('site-key')
        if (key) headers['x-gully-site-key'] = key
        fetch(api + '/api/ask/embed?project=' + encodeURIComponent(self.getAttribute('project') || ''), { method: 'POST', headers: headers, body: JSON.stringify({ project: self.getAttribute('project'), question: q, history: self.history.filter(function (m) { return m.role === 'user' }).slice(-4) }) })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j } }) })
          .then(function (x) {
            wait.remove()
            if (!x.ok) return add(x.j && x.j.error ? x.j.error : 'Gully AI could not answer just now.')
            var t = (x.j.chunks || []).join('\n\n')
            self.history.push({ role: 'user', content: q }, { role: 'assistant', content: t })
            add(t)
          })
          .catch(function () { wait.remove(); add('Could not reach Gully AI. Try again.') })
      })
    }
  }
  customElements.define('gully-ask', GullyAsk)
})()
