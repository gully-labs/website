/* Lab console charts (Direction A, owner pick 2026-10-25): hand-written SVG drawn into a host element.
   Dataviz rules: thin marks, legend + table for two or more series, crosshair tooltip, text in text tokens.
   Live motion: lines draw in, a glow sweeps along them, the newest point pulses, areas breathe, new data
   tweens (600-700 ms) instead of swapping, bars slide left as blocks arrive and the newest one flashes,
   sparklines carry a travelling glow dot. Reduced motion keeps fades and number changes only. */

import { yTicks } from '../components/charts/chartData'
export const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
export const C = { cyan: '#00D2FF', blue: '#248BFF', violet: '#7B3BFF', magenta: '#C02CFF', muted: '#A3A8C3', surface: '#0B0A16', bg: '#06050D', s: ['#20A0C4', '#1A5FE6', '#9578E8', '#9121B5'], up: '#3DDC97', down: '#FF6B81' }
const NS = 'http://www.w3.org/2000/svg'

export const fmtUsd = (v: number | null | undefined) =>
  v == null || !isFinite(v) ? '—' : v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `$${(v / 1e3).toFixed(1)}k` : `$${v.toLocaleString('en-US', { maximumFractionDigits: v >= 100 ? 0 : 2 })}`
export const fmtInt = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('en-US'))
export const fmtPct = (v: number) => `${v.toFixed(1)}%`
export const fmtTime = (iso: string | number | Date) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
/** The same clock in UTC, labelled, so every live stamp on a page agrees (the hub board reads UTC). */
export const fmtTimeUtc = (iso: string | number | Date) => `${new Date(iso).toISOString().slice(11, 19)} UTC`
export const fmtDay = (t: number) => new Date(t * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
const ease = (t: number) => 1 - Math.pow(1 - t, 3)
const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
const uid = () => Math.random().toString(36).slice(2, 8)

export function tween(ms: number, step: (k: number) => void, done?: () => void) {
  if (REDUCED) ms = Math.min(ms, 150)
  const t0 = performance.now()
  const f = (now: number) => {
    const k = Math.min(1, (now - t0) / ms)
    step(ease(k))
    if (k < 1) requestAnimationFrame(f)
    else done?.()
  }
  requestAnimationFrame(f)
}

/* ---------- count-up numbers ---------- */
const counters = new WeakMap<Element, number | null>()
export function countUp(el: HTMLElement | null, value: number | null | undefined, fmt: (v: number) => string = fmtInt, ms = 1100) {
  if (!el) return
  if (value == null || !isFinite(value)) {
    el.textContent = '—'
    counters.set(el, null)
    return
  }
  const from = counters.get(el) ?? 0
  if (from === value && el.textContent !== '—') return
  counters.set(el, value)
  tween(ms, (k) => (el.textContent = fmt(from + (value - from) * k)))
  const tile = el.closest('.tile, .prod')
  if (tile && from !== 0) {
    tile.classList.remove('flash')
    void (tile as HTMLElement).offsetWidth
    tile.classList.add('flash')
  }
}

/* ---------- svg helpers ---------- */
const mk = (tag: string, attrs: Record<string, string | number> = {}) => {
  const e = document.createElementNS(NS, tag)
  for (const k in attrs) e.setAttribute(k, String(attrs[k]))
  return e
}
type Pt = [number, number]
/** Monotone-ish cubic path through points. */
export function pathD(pts: Pt[]) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : ''
  let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${c2[0].toFixed(2)},${c2[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`
  }
  return d
}

let tip: HTMLDivElement | null = null
function tipEl() {
  if (tip && tip.isConnected) return tip
  tip = document.createElement('div')
  tip.className = 'gl-tip'
  tip.setAttribute('role', 'tooltip')
  ;(document.querySelector('.lc') ?? document.body).appendChild(tip)
  return tip
}
function showTip(x: number, y: number, html: string) {
  const t = tipEl()
  t.innerHTML = html
  t.classList.add('on')
  const w = t.offsetWidth, h = t.offsetHeight
  t.style.left = `${Math.min(innerWidth - w - 8, Math.max(8, x + 14))}px`
  t.style.top = `${Math.max(8, y - h - 14)}px`
}
const hideTip = () => tip?.classList.remove('on')

export interface Series {
  key?: string
  name: string
  color: string
  values: (number | null)[]
}

export interface LineChart {
  /** `legendTotal` (optional): show each series' total over the window with this note instead of its last point. */
  update(series: Series[], labels: string[], title?: string, legendTotal?: string | null): void
  destroy(): void
}

/** Multi-series (optionally stacked) area chart with legend + data table rendered into sibling hosts. */
export function lineChart(
  el: HTMLElement,
  opts: { series: Series[]; labels: string[]; fmt?: (v: number | null) => string; title?: string; height?: number; width?: number; stacked?: boolean; integer?: boolean; unit?: string; legendEl?: HTMLElement | null; tableEl?: HTMLElement | null; legendTotal?: string | null },
): LineChart {
  const { fmt = fmtUsd, height = 220, width = 600, stacked = false, integer = false, unit = '', legendEl, tableEl } = opts
  let title = opts.title ?? ''
  // legend value: the newest point by default; with legendTotal, the sum over the window (a partial current hour
  // reads 0 early in the hour, which made "Transactions 0" sit under a busy chart)
  let legendTotal = opts.legendTotal ?? null
  const W = width, H = height, L = 44, R = 16, T = 12, B = 22
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title })
  el.innerHTML = ''
  el.appendChild(svg)
  const defs = mk('defs'), gGrid = mk('g'), gArea = mk('g'), gLine = mk('g'), gAx = mk('g'), gDots = mk('g')
  const xh = mk('line', { class: 'xh', y1: T, y2: H - B }), hit = mk('rect', { class: 'hit', x: L, y: 0, width: W - L - R, height: H })
  svg.append(defs, gGrid, gArea, gLine, gAx, gDots, xh, hit)
  type Geo = { n: number; X: (i: number) => number; Y: (v: number) => number; hi: number; ticks: number[]; stacks: number[][] }
  let cur: { ser: Series[]; labs: string[]; geo: Geo } | null = null
  let drawn = false
  let anim = 0
  const build = (ser: Series[], labs: string[]): Geo => {
    const n = labs.length
    const X = (i: number) => L + ((W - L - R) * i) / Math.max(1, n - 1)
    const stacks: number[][] = ser.map(() => [])
    let hi = 0
    for (let i = 0; i < n; i++) {
      let acc = 0
      ser.forEach((s, k) => {
        const v = s.values[i] ?? 0
        acc = stacked ? acc + v : v
        stacks[k][i] = stacked ? acc : v
        hi = Math.max(hi, acc)
      })
    }
    const ax = yTicks(hi, { integer })
    const Y = (v: number) => T + (H - T - B) * (1 - v / ax.top)
    return { n, X, Y, hi: ax.top, ticks: ax.ticks, stacks }
  }
  const render = (ser: Series[], labs: string[], geo: Geo, final: boolean) => {
    gGrid.innerHTML = ''; gAx.innerHTML = ''; gArea.innerHTML = ''; gLine.innerHTML = ''; gDots.innerHTML = ''; defs.innerHTML = ''
    const { n, X, Y, ticks, stacks } = geo
    const seen = new Set<string>()
    for (const v of ticks) {
      const y = Y(v)
      gGrid.appendChild(mk('line', { class: 'glx', x1: L, x2: W - R, y1: y, y2: y }))
      const label = fmt(v)
      if (seen.has(label)) continue
      seen.add(label)
      const t = mk('text', { class: 'at', x: L - 6, y: y + 4, 'text-anchor': 'end' })
      t.textContent = label
      gAx.appendChild(t)
    }
    const xTicks = [0, Math.floor((n - 1) / 2), n - 1]
    xTicks.forEach((i) => {
      if (!labs[i]) return
      const t = mk('text', { class: 'at', x: X(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' })
      t.textContent = labs[i]
      gAx.appendChild(t)
    })
    ser.forEach((s, si) => {
      const pts: Pt[] = []
      for (let i = 0; i < n; i++) if (s.values[i] != null) pts.push([X(i), Y(stacks[si][i])])
      if (pts.length < 2) return
      const id = `f${si}${uid()}`
      const lg = mk('linearGradient', { id, x1: 0, x2: 0, y1: 0, y2: 1 })
      lg.append(mk('stop', { offset: '0%', 'stop-color': s.color, 'stop-opacity': stacked ? 0.55 : 0.32 }), mk('stop', { offset: '100%', 'stop-color': s.color, 'stop-opacity': 0.02 }))
      defs.appendChild(lg)
      const base = stacked && si > 0 ? [...Array(n).keys()].filter((i) => s.values[i] != null).map((i): Pt => [X(i), Y(stacks[si - 1][i])]).reverse() : null
      const d = pathD(pts)
      const areaD = base ? `${d} L${base[0][0]},${base[0][1]} ${pathD(base).slice(1)} Z` : `${d} L${pts[pts.length - 1][0]},${Y(0)} L${pts[0][0]},${Y(0)} Z`
      gArea.appendChild(mk('path', { class: 'area', d: areaD, fill: `url(#${id})` }))
      const line = mk('path', { class: 'ln', d, stroke: s.color }) as SVGPathElement
      gLine.appendChild(line)
      if (!drawn && !REDUCED) {
        const len = line.getTotalLength()
        line.style.strokeDasharray = `${len}`
        line.style.strokeDashoffset = `${len}`
        line.style.transition = `stroke-dashoffset 1.2s ${0.15 * si}s cubic-bezier(.2,.8,.2,1)`
        requestAnimationFrame(() => (line.style.strokeDashoffset = '0'))
      }
      if (final && (si === ser.length - 1 || !stacked)) {
        gLine.appendChild(mk('path', { class: 'ln-sweep', d }))
        gLine.appendChild(mk('path', { class: 'ln-glow', d, stroke: C.cyan, style: `animation-delay:${1.2 + si * 0.4}s` }))
      }
      const last = pts[pts.length - 1]
      gDots.append(mk('circle', { class: 'pulse', cx: last[0], cy: last[1], r: 5, stroke: s.color }), mk('circle', { class: 'end', cx: last[0], cy: last[1], r: 4, fill: s.color }))
    })
    cur = { ser, labs, geo }
    drawn = true
  }
  const legend = (ser: Series[]) => {
    if (!legendEl) return
    const real = (s: Series) => s.values.filter((v): v is number => v != null && isFinite(v))
    const val = (s: Series) => (legendTotal ? (real(s).length ? real(s).reduce((a, v) => a + v, 0) : null) : (real(s).slice(-1)[0] ?? null))
    legendEl.innerHTML = ser.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}<b>${esc(fmt(val(s)))}</b>${legendTotal ? `<small>${esc(legendTotal)}</small>` : ''}</span>`).join('')
  }
  const table = (ser: Series[], labs: string[]) => {
    if (!tableEl) return
    const rows = labs.map((l, i) => `<tr><td>${esc(l)}</td>${ser.map((s) => `<td>${esc(fmt(s.values[i]))}</td>`).join('')}</tr>`).reverse().join('')
    tableEl.innerHTML = `<table class="dt"><caption>${esc(title)}${unit ? ` (${esc(unit)})` : ''}</caption><thead><tr><th>Day</th>${ser.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`
  }
  render(opts.series, opts.labels, build(opts.series, opts.labels), true)
  legend(opts.series)
  table(opts.series, opts.labels)
  hit.addEventListener('pointermove', (e) => {
    if (!cur) return
    const ev = e as PointerEvent
    const r = svg.getBoundingClientRect()
    const px = ((ev.clientX - r.left) / r.width) * W
    const { n, X } = cur.geo
    let best = 0
    for (let i = 1; i < n; i++) if (Math.abs(X(i) - px) < Math.abs(X(best) - px)) best = i
    xh.setAttribute('x1', String(X(best)))
    xh.setAttribute('x2', String(X(best)))
    ;(xh as SVGElement).style.opacity = '1'
    showTip(ev.clientX, ev.clientY, `<div>${esc(cur.labs[best] ?? '')}</div>${cur.ser.map((s) => `<b><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${s.color};margin-right:6px"></i>${esc(s.name)} ${esc(fmt(s.values[best]))}</b>`).join('')}`)
  })
  hit.addEventListener('pointerleave', () => {
    ;(xh as SVGElement).style.opacity = '0'
    hideTip()
  })
  const same = (a: Series[], b: Series[]) => a.length === b.length && a.every((s, i) => s.values.length === b[i].values.length && s.values.every((v, j) => v === b[i].values[j]))
  return {
    update(ser, labs, nextTitle, nextTotal) {
      if (nextTitle) {
        title = nextTitle
        svg.setAttribute('aria-label', title)
      }
      if (nextTotal !== undefined && nextTotal !== legendTotal) {
        legendTotal = nextTotal
        if (cur) legend(cur.ser)
      }
      if (!cur) return
      if (same(cur.ser, ser) && cur.labs.join() === labs.join()) return
      const from = cur.ser.map((s) => s.values)
      const fromN = cur.labs.length
      // Different lengths: resample the old line onto the new axis so the morph still reads as one line.
      const at = (si: number, i: number) => {
        const f = from[si]
        if (!f) return null
        const j = fromN === labs.length ? i : Math.round((i * (fromN - 1)) / Math.max(1, labs.length - 1))
        return f[j] ?? null
      }
      const id = ++anim
      tween(600, (k) => {
        if (id !== anim) return
        const mid = ser.map((s, si) => ({ ...s, values: s.values.map((v, i) => { const a = at(si, i); return v == null || a == null ? v : a + (v - a) * k }) }))
        render(mid, labs, build(mid, labs), k >= 1)
      }, () => {
        if (id !== anim) return
        legend(ser)
        table(ser, labs)
      })
    },
    destroy() {
      anim++
      el.innerHTML = ''
      hideTip()
    },
  }
}

/** Sparkline strip: line + area + pulsing end dot + a glow dot travelling along it; tweens between polls. */
const sparkPrev = new WeakMap<Element, (number | null)[]>()
export function spark(el: HTMLElement | null, values: (number | null)[], { color = C.cyan, h = 40 }: { color?: string; h?: number } = {}) {
  if (!el) return
  const W = 200, H = h, pad = 4, padX = 13
  const real = values.filter((v): v is number => v != null && isFinite(v))
  let svg = el.querySelector('svg')
  if (!svg) {
    svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, class: 'spk', 'aria-hidden': 'true', preserveAspectRatio: 'none' }) as SVGSVGElement
    el.innerHTML = ''
    el.appendChild(svg)
  }
  const s = svg
  if (real.length < 2) {
    s.innerHTML = `<line class="axl" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke-dasharray="3 4"/><text class="at" x="${W / 2}" y="${H / 2 - 6}" text-anchor="middle">not enough points yet</text>`
    sparkPrev.delete(el)
    return
  }
  const prev = sparkPrev.get(el)
  const id = `s${uid()}`
  const draw = (vals: (number | null)[], final: boolean, first: boolean) => {
    const r = vals.filter((v): v is number => v != null && isFinite(v))
    const lo0 = Math.min(...r), hi0 = Math.max(...r)
    const lo = hi0 === lo0 ? lo0 - 1 : lo0, hi = hi0 === lo0 ? lo0 + 1 : hi0
    const pts: Pt[] = []
    vals.forEach((v, i) => {
      // padX keeps the end marker's pulse ring (r 4, scaled to 3x) inside the chart, so the card never clips it.
      if (v != null) pts.push([padX + ((W - 2 * padX) * i) / Math.max(1, vals.length - 1), pad + (H - 2 * pad) * (1 - (v - lo) / (hi - lo))])
    })
    const d = pathD(pts), last = pts[pts.length - 1]
    s.innerHTML = `<defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".3"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path class="area" d="${d} L${last[0]},${H} L${pts[0][0]},${H} Z" fill="url(#${id})"/><path class="ln" d="${d}" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke"/><circle class="pulse" cx="${last[0]}" cy="${last[1]}" r="4" stroke="${color}"/><circle class="end" cx="${last[0]}" cy="${last[1]}" r="3" fill="${color}"/>${final && !REDUCED ? `<circle class="gdot" r="2.4" fill="#fff" style="color:${color}" opacity=".85"><animateMotion dur="4.5s" repeatCount="indefinite" path="${d}"/></circle>` : ''}`
    if (first && !REDUCED) {
      const g = s.querySelector('path.ln') as SVGPathElement
      const len = g.getTotalLength()
      g.style.strokeDasharray = `${len}`
      g.style.strokeDashoffset = `${len}`
      g.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1)'
      requestAnimationFrame(() => (g.style.strokeDashoffset = '0'))
      // The dash is in user units but the stroke does not scale: drop it once drawn so the whole line shows.
      setTimeout(() => {
        g.style.strokeDasharray = ''
        g.style.strokeDashoffset = ''
      }, 1200)
    }
  }
  sparkPrev.set(el, values)
  if (!prev) return draw(values, true, true)
  if (prev.length === values.length && prev.every((v, i) => v === values[i])) return
  const at = (i: number) => prev[prev.length === values.length ? i : Math.round((i * (prev.length - 1)) / Math.max(1, values.length - 1))] ?? null
  tween(700, (k) => draw(values.map((v, i) => { const a = at(i); return v == null || a == null ? v : a + (v - a) * k }), k >= 1, false))
}

/** Bar strip (Gully Chain txs per block): bars grow in, the newest flashes, and on new blocks the strip slides left. */
const barState = new WeakMap<Element, { keys: number[] }>()
export function bars(el: HTMLElement | null, values: number[], { keys = [], color = C.s[1], last = C.cyan, h = 64, labels = [], fmt = fmtInt, title = '' }: { keys?: number[]; color?: string; last?: string; h?: number; labels?: string[]; fmt?: (v: number) => string; title?: string } = {}) {
  if (!el) return
  const W = 600, H = h, n = values.length, gap = 2, bw = Math.max(1, (W - gap * (n - 1)) / n)
  const hi = Math.max(1, ...values)
  let svg = el.querySelector('svg')
  const first = !svg
  if (!svg) {
    svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title, preserveAspectRatio: 'none' }) as SVGSVGElement
    el.innerHTML = ''
    el.appendChild(svg)
  }
  const st = barState.get(el)
  const shift = st && keys.length && st.keys.length ? Math.max(0, Math.min(n, keys[keys.length - 1] - st.keys[st.keys.length - 1])) : 0
  barState.set(el, { keys })
  svg.innerHTML =
    `<line class="axl" x1="0" x2="${W}" y1="${H - 0.5}" y2="${H - 0.5}"/><g class="bars-g">` +
    values
      .map((v, i) => {
        const bh = Math.max(2, ((H - 4) * v) / hi)
        const isNew = i >= n - shift
        const anim = first && !REDUCED ? `animation:grow .7s ${(i * 12) % 500}ms cubic-bezier(.2,.8,.2,1) both` : isNew && !REDUCED ? 'animation:grow .5s cubic-bezier(.2,.8,.2,1) both' : ''
        return `<rect class="${isNew ? 'barnew' : ''}" x="${(i * (bw + gap)).toFixed(2)}" y="${(H - bh).toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" rx="1.5" fill="${i === n - 1 ? last : color}" style="transform-box:fill-box;transform-origin:50% 100%;${anim}"><title>${esc(labels[i] ?? i)}: ${esc(fmt(v))}</title></rect>`
      })
      .join('') +
    '</g>'
  if (shift && !REDUCED) {
    const g = svg.querySelector('.bars-g') as SVGGElement
    g.style.transition = 'none'
    g.style.transform = `translateX(${(shift * (bw + gap)).toFixed(2)}px)`
    void g.getBoundingClientRect()
    requestAnimationFrame(() => {
      g.style.transition = ''
      g.style.transform = 'translateX(0)'
    })
  }
}
