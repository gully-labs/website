// The product pages' only script (served at /landing/product.js). The page is complete without it: this keeps the
// figures and charts current from the same-origin APIs. No framework.
import { productView, feeCurve, ptTime } from '/landing/graphs.mjs'

const boot = JSON.parse(document.getElementById('boot')?.textContent ?? '{}')
const { page, ...data } = boot
const SOURCES = { hub: ['/api/hub', 60_000], products: ['/api/hub/products', 120_000], live: ['/api/hub/live', 60_000], stats: ['/api/stats', 60_000] }
const seen = new Map()
function put(k, html, asHtml = false) {
  const el = document.querySelector(`[data-v="${k}"]`)
  if (!el) return
  if (!seen.has(k)) {
    seen.set(k, html) // the server drew it: keep it, so nothing restarts on load
    return
  }
  if (seen.get(k) === html) return
  seen.set(k, html)
  if (asHtml) el.innerHTML = html
  else el.textContent = html
}
function draw() {
  const v = productView(data, page)
  document.querySelectorAll('[data-state-of]').forEach((el) => (el.dataset.state = v.state))
  put('word', v.word)
  put('value', v.value || v.up)
  put('unit', v.value ? v.unit : 'surfaces answering')
  for (const k of ['up', 'ms', 'answered', 'meanMs']) document.querySelectorAll(`b[data-v="${k}"]`).forEach((el) => (el.textContent = v[k]))
  for (const k of ['latency', 'activity', 'cells']) put(k, v[k], true)
}
async function poll(name, url) {
  if (document.hidden) return
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } })
    if (!r.ok) return
    data[name] = await r.json()
    draw()
    const at = document.querySelector('[data-v="at"]')
    if (at) at.textContent = ptTime()
  } catch {
    /* offline or a failed poll: the last figures stay */
  }
}
draw()
for (const [name, [url, every]] of Object.entries(SOURCES)) {
  if (!data[name]) poll(name, url)
  setInterval(() => poll(name, url), every)
}

document.querySelector('#fx button')?.addEventListener('click', () => {
  document.getElementById('fx').remove()
  try {
    localStorage.setItem('gl-follow-x-dismissed', '1')
  } catch {
    /* private mode */
  }
})

/* ---- Token launch: the preset picker redraws the fee over its window ---- */
const presets = [...document.querySelectorAll('[data-preset]')]
presets.forEach((btn) => btn.addEventListener('click', () => {
  for (const b of presets) b.setAttribute('aria-pressed', String(b === btn))
  document.querySelectorAll('[data-pdetail]').forEach((d) => (d.hidden = d.dataset.pdetail !== btn.dataset.preset))
  const c = document.querySelector('[data-curve]')
  if (c) c.innerHTML = btn.dataset.from ? feeCurve({ from: Number(btn.dataset.from), to: Number(btn.dataset.to) }) : ''
}))

const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle('in', e.isIntersecting)), { rootMargin: '80px' }) : null
document.querySelectorAll('[data-anim]').forEach((el) => (io ? io.observe(el) : el.classList.add('in')))
