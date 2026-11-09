// The landing's only script (served at /landing/live.js). The page is complete without it: this keeps the figures,
// graphics and board current from the same-origin APIs, and shows toasts for real events only. No framework.
import { board, cards, coreBars, mapNodes, METRIC, metricNote } from '/landing/graphs.mjs'

const data = JSON.parse(document.getElementById('boot')?.textContent ?? '{}')
const SOURCES = { hub: ['/api/hub', 60_000], products: ['/api/hub/products', 120_000], live: ['/api/hub/live', 60_000], stats: ['/api/stats', 60_000] }

/** Redraws only when the data changed, so a poll with nothing new does not restart an animation. */
const drawn = new WeakMap()
function set(el, html) {
  if (drawn.get(el) === html) return
  if (drawn.has(el)) el.innerHTML = html
  drawn.set(el, html)
}

let metric = document.querySelector('[data-tab][aria-selected="true"]')?.dataset.metric ?? 'launches'

function draw() {
  const c = cards(data)
  for (const [key, v] of Object.entries(c)) {
    const el = document.querySelector(`[data-p="${key}"]`)
    if (!el) continue
    el.dataset.state = v.state
    const u = el.querySelector('[data-u]')
    u.textContent = v.value ? `${v.value} ${v.unit}` : u.dataset.fb
  }
  const m = mapNodes(data)
  document.querySelectorAll('[data-mk]').forEach((g) => {
    const v = m[g.dataset.mk]
    if (!v) return
    const st = g.querySelector('.st')
    if (st.textContent !== v.tag) st.textContent = v.tag
    st.setAttribute('class', `st ${v.cls}`)
    const mt = g.querySelector('.mt')
    if (mt.textContent !== v.metric) mt.textContent = v.metric
    g.classList.toggle('is-up', v.up)
  })
  const b = board(data)
  for (const k of ['up', 'vol', 'tvl']) {
    const el = document.querySelector(`[data-b="${k}"]`)
    if (el && el.textContent !== b[k]) el.textContent = b[k]
  }
  const cells = document.querySelector('[data-b="cells"]')
  if (cells && b.cells) set(cells, b.cells)
  set(document.querySelector('[data-b="core"]'), coreBars(data.products, metric))
}

/* ---- toasts: real events, at most one every 20 s, three on screen, dismissible, read out politely ---- */
const stack = document.getElementById('toasts')
let lastToast = 0
function toast(title, text, href, asked = false) {
  if (!stack || document.hidden || (!asked && Date.now() - lastToast < 20_000)) return
  lastToast = Date.now()
  while (stack.children.length >= 3) stack.firstChild.remove()
  const t = document.createElement('div')
  t.className = 'toast'
  const b = document.createElement('b')
  b.textContent = title
  const p = document.createElement(href ? 'a' : 'span')
  p.textContent = text
  if (href) p.href = href
  const x = document.createElement('button')
  x.type = 'button'
  x.setAttribute('aria-label', 'Dismiss')
  x.textContent = '×'
  x.onclick = () => t.remove()
  t.append(b, p, x)
  stack.append(t)
  setTimeout(() => t.remove(), 7000)
}
const FEED = { launch: 'New launch', token: 'New token', trade: 'New trade' }
function events(name, prev, next) {
  if (name === 'hub' && prev) {
    const was = new Map(prev.services.map((s) => [s.key, s.state]))
    for (const s of next.services ?? []) {
      const w = was.get(s.key)
      if (w && w !== s.state && s.state !== 'coming') toast(s.state === 'up' ? 'Back up' : 'Service down', s.name, '/status')
    }
  }
  if (name === 'live' && prev?.feed) {
    const seen = new Set(prev.feed.items.map((i) => i.id))
    const fresh = (next.feed?.items ?? []).find((i) => !seen.has(i.id) && FEED[i.kind])
    if (fresh) toast(FEED[fresh.kind], `On Gully Chain, block ${fresh.block}`, '/products/gully-core')
  }
}

async function poll(name, url) {
  if (document.hidden) return
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } })
    if (!r.ok) return
    const j = await r.json()
    events(name, data[name], j)
    data[name] = j
    draw()
  } catch {
    /* offline or a failed poll: the last figures stay */
  }
}
draw() // remembers what the server drew
for (const [name, [url, every]] of Object.entries(SOURCES)) {
  // The first HTML carries what the server held; a source it did not have is read straight away.
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

/* ---- Build tabs: arrow keys move between them ---- */
const tabs = [...document.querySelectorAll('[data-tab]')]
function pickTab(btn) {
  for (const t of tabs) {
    const on = t === btn
    t.setAttribute('aria-selected', String(on))
    t.tabIndex = on ? 0 : -1
    document.getElementById(`p-${t.dataset.tab}`).hidden = !on
  }
  metric = btn.dataset.metric
  document.querySelector('[data-b="mname"]').textContent = METRIC[metric]
  document.querySelector('[data-b="mnote"]').textContent = metricNote(metric)
  draw()
}
tabs.forEach((t, i) => {
  t.tabIndex = i ? -1 : 0
  t.addEventListener('click', () => pickTab(t))
  t.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    const n = tabs[(i + d + tabs.length) % tabs.length]
    n.focus()
    pickTab(n)
  })
})

/* ---- Chain picker: the orbit highlights the chain, the list beside it changes ---- */
document.querySelectorAll('[data-chain]').forEach((btn) => btn.addEventListener('click', () => {
  const key = btn.dataset.chain
  document.querySelectorAll('[data-chain]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)))
  document.querySelectorAll('[data-node]').forEach((n) => n.classList.toggle('on', n.dataset.node === key))
  document.querySelectorAll('[data-detail]').forEach((d) => (d.hidden = d.dataset.detail !== key))
  const [name, state] = [...btn.children].map((x) => x.textContent)
  if (state === 'Coming') toast(name, 'Gully Core is not on this chain yet.', null, true)
}))

/* ---- motion stops off-screen ---- */
const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle('in', e.isIntersecting)), { rootMargin: '80px' }) : null
document.querySelectorAll('[data-anim]').forEach((el) => (io ? io.observe(el) : el.classList.add('in')))
