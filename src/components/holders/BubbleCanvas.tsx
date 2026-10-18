import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { glyphPaths, sideColour, type FlowEvent, type Glyph } from './motion'
import { K } from './theme'
import { esc } from '../charts/chart-utils'

/* The Holder Map's bubbles, drawn on one canvas with requestAnimationFrame (this module is its own lazy
   chunk). It owns everything that moves, so React renders only when the data changes:
   - entrance: bubbles grow out of the centre, where the token sits, and settle into the layout;
   - idle life: every bubble breathes and drifts a few pixels, pools and locks pulse, links carry particles;
   - flows: a transfer is a stream of particles from sender to receiver (gold buys, red sells), and the
     receiving bubble grows or shrinks when the stream lands;
   - hover lights a wallet's cluster and its links and dims the rest; a tooltip follows the pointer;
   - the camera fits the map, flies to a wallet, zooms (ctrl/⌘ + wheel, pinch, buttons) and pans (drag).
   Under reduced motion nothing moves or loops: the map fades in where it lands, sizes change in place and
   a flow is a line that fades in and out, so the same information still shows.
   The loop stops while the map is off-screen or the tab is hidden, and particles are capped. */

export interface BNode {
  id: string
  /** Layout position and radius (abstract units; the camera fits them to the box). */
  x: number
  y: number
  r: number
  /** The radius the camera fits to (the layout's, so the view holds still while sizes change). */
  fitR?: number
  fill: string
  stroke: string
  strokeWidth: number
  dashed: boolean
  /** Share text drawn inside big enough bubbles. */
  text: string | null
  textColour: string
  glyph: Glyph | null
  caption: string | null
  /** Pools, locks and the token pulse softly. */
  pulse: boolean
  /** Bubbles with the same group light together on hover (a cluster). */
  group: string | null
}
export interface BLink {
  a: string
  b: string
  colour: string
  dashed: boolean
  width: number
  /** Carries an idle particle (direction a -> b). */
  particles: boolean
}
export interface BTip {
  title: string
  rows: [string, string][]
  note?: string
}
export interface BubbleHandle {
  /** Animates one transfer; `delay` in ms. */
  flow: (e: FlowEvent, delay?: number) => void
  flyTo: (id: string) => void
  fit: () => void
  zoomBy: (f: number) => void
}
export interface BubbleCanvasProps {
  nodes: BNode[]
  links: BLink[]
  /** Only these are lit (a score part's wallets); null: hover and selection decide. */
  highlight: Set<string> | null
  /** These get a turning ring (a score part's wallets). */
  ringed: Set<string> | null
  selected: string | null
  reduced: boolean
  label: string
  height: number | string
  tip: (id: string) => BTip | null
  onSelect: (id: string | null) => void
  /** The camera left (true) or came back to (false) the fitted view. */
  onZoomed?: (zoomed: boolean) => void
  /** Any direct interaction (drag, click, zoom): the caller can stop its intro. */
  onInteract?: () => void
  className?: string
}

interface NodeState {
  x: number
  y: number
  r: number
  alpha: number
  born: number
  pop: number
  popColour: string
  hold: number
  dying: number | null
  phase: number
  period: number
  node: BNode
}
interface Flow {
  e: FlowEvent
  start: number
  n: number
  dur: number
  colour: string
  arrived: boolean
  bend: number
}

const MAX_PARTICLES = 240
const MAX_LINK_PARTICLES = 60
const ENTER_MS = 900
const FLOW_MS = 1250
const STAGGER_MS = 75
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
const easeOutBack = (t: number) => {
  const c1 = 1.5
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}
const easeInOut = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
const hash = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}
const withAlpha = (hex: string, a: number) => `${hex.slice(0, 7)}${Math.round(clamp01(a) * 255).toString(16).padStart(2, '0')}`

export const BubbleCanvas = forwardRef<BubbleHandle, BubbleCanvasProps>(function BubbleCanvas(props, ref) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const P = useRef(props)
  P.current = props

  // Everything the loop reads lives in this one mutable record (no React state: the loop runs at 60 fps).
  const S = useRef({
    w: 0,
    h: 0,
    dpr: 1,
    clock: 0,
    last: 0,
    raf: 0,
    visible: true,
    hidden: false,
    started: false,
    states: new Map<string, NodeState>(),
    flows: [] as Flow[],
    cam: { x: 0, y: 0, s: 1 },
    camT: { x: 0, y: 0, s: 1 },
    fitCam: { x: 0, y: 0, s: 1 },
    userCam: false,
    zoomed: false,
    hover: null as string | null,
    pointers: new Map<number, { x: number; y: number }>(),
    drag: null as null | { x: number; y: number; moved: boolean; pinch: number | null },
    dirty: true,
    cost: 0,
    gap: 16,
    frames: 0,
    /** A slow device: idle extras (link particles, small bubbles' breathing) are dropped. */
    lite: false,
    liteAt: 0,
    half: false,
    flip: false,
    carry: 0,
    layer: null as HTMLCanvasElement | null,
    layerKey: '',
  })

  const fitOf = (w: number, h: number) => {
    const ns = P.current.nodes
    if (!ns.length || !w || !h) return { x: 0, y: 0, s: 1 }
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (const n of ns) {
      const r = Math.max(n.r, n.fitR ?? 0)
      x0 = Math.min(x0, n.x - r)
      x1 = Math.max(x1, n.x + r)
      y0 = Math.min(y0, n.y - r)
      y1 = Math.max(y1, n.y + r)
    }
    // Room for captions under the bubbles and for the overlays at the top and bottom of the box.
    const wideBox = w >= 640
    const padX = wideBox ? 36 : 18
    const padTop = wideBox ? 70 : 20
    const padBottom = wideBox ? 132 : 52
    const s = Math.max(0.05, Math.min((w - padX * 2) / Math.max(1, x1 - x0), (h - padTop - padBottom) / Math.max(1, y1 - y0)))
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 - (padTop - padBottom) / 2 / s, s }
  }
  const setZoomed = (z: boolean) => {
    const s = S.current
    if (s.zoomed === z) return
    s.zoomed = z
    P.current.onZoomed?.(z)
  }

  // Sync the node states with the props: new bubbles enter, gone ones shrink away, moved ones glide.
  useEffect(() => {
    const s = S.current
    const first = s.states.size === 0
    const seen = new Set<string>()
    props.nodes.forEach((n, i) => {
      seen.add(n.id)
      const st = s.states.get(n.id)
      if (st) {
        st.node = n
        st.dying = null
        return
      }
      const h = hash(n.id)
      s.states.set(n.id, {
        x: 0,
        y: 0,
        r: 0,
        alpha: 0,
        born: s.clock + (first ? 120 + Math.min(i * 32, 700) : 0),
        pop: 0,
        popColour: K.gold,
        hold: 0,
        dying: null,
        phase: (h % 628) / 100,
        period: 3600 + (h % 7) * 300,
        node: n,
      })
    })
    for (const [id, st] of s.states) if (!seen.has(id) && st.dying === null) st.dying = s.clock
    s.fitCam = fitOf(s.w, s.h)
    if (!s.userCam) s.camT = { ...s.fitCam }
    if (first) s.cam = { ...s.fitCam }
    s.dirty = true
    // fitOf reads the latest props through P
  }, [props.nodes])
  useEffect(() => {
    S.current.dirty = true
  }, [props.links, props.highlight, props.ringed, props.selected, props.reduced])

  useImperativeHandle(ref, () => ({
    flow: (e, delay = 0) => {
      const s = S.current
      const active = s.flows.reduce((n, f) => n + f.n, 0)
      const n = e.side === 'buy' || e.side === 'sell' ? 8 : 6
      // Over the cap: the oldest streams give way.
      while (s.flows.length && active + n > MAX_PARTICLES) s.flows.shift()
      const st = s.states.get(e.to)
      if (st) st.hold = s.clock + delay + FLOW_MS
      s.flows.push({ e, start: s.clock + delay, n, dur: FLOW_MS, colour: sideColour(e.side), arrived: false, bend: hash(e.key) % 2 ? 1 : -1 })
      s.dirty = true
    },
    flyTo: (id) => {
      const s = S.current
      const n = P.current.nodes.find((x) => x.id === id)
      if (!n) return
      s.userCam = true
      const target = { x: n.x, y: n.y, s: Math.max(s.fitCam.s * 2.2, Math.min(s.fitCam.s * 8, 60 / Math.max(1, n.r))) }
      s.camT = target
      if (P.current.reduced) s.cam = { ...target }
      setZoomed(true)
      s.dirty = true
    },
    fit: () => {
      const s = S.current
      s.userCam = false
      s.camT = { ...s.fitCam }
      if (P.current.reduced) s.cam = { ...s.fitCam }
      setZoomed(false)
      s.dirty = true
    },
    zoomBy: (f) => zoomAt(f, S.current.w / 2, S.current.h / 2),
  }))

  const zoomAt = (f: number, px: number, py: number) => {
    const s = S.current
    const c = s.camT
    const wx = c.x + (px - s.w / 2) / c.s
    const wy = c.y + (py - s.h / 2) / c.s
    const ns = Math.max(s.fitCam.s * 0.6, Math.min(s.fitCam.s * 14, c.s * f))
    s.camT = { s: ns, x: wx - (px - s.w / 2) / ns, y: wy - (py - s.h / 2) / ns }
    if (P.current.reduced) s.cam = { ...s.camT }
    s.userCam = true
    setZoomed(Math.abs(ns / s.fitCam.s - 1) > 0.04 || Math.hypot(s.camT.x - s.fitCam.x, s.camT.y - s.fitCam.y) * ns > 6)
    s.dirty = true
    P.current.onInteract?.()
  }

  // The loop, the box size and the pause rules.
  useEffect(() => {
    const boxEl = boxRef.current
    const canvasEl = canvasRef.current
    if (!boxEl || !canvasEl) return
    const box: HTMLDivElement = boxEl
    const canvas: HTMLCanvasElement = canvasEl
    const s = S.current
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return
    const ctx: CanvasRenderingContext2D = ctx2d
    // Kit colours, read once (theme.ts caches them too).
    const C = { pale: K.pale, bone: K.bone, gold: K.gold, night: K.night, muted: K.muted }
    const size = () => {
      const w = box.clientWidth
      const h = box.clientHeight
      const dpr = s.lite ? 1 : Math.min(2, window.devicePixelRatio || 1)
      if (w === s.w && h === s.h && dpr === s.dpr) return
      s.w = w
      s.h = h
      s.dpr = dpr
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      s.fitCam = fitOf(w, h)
      if (!s.userCam) {
        s.camT = { ...s.fitCam }
        s.cam = { ...s.fitCam }
      }
      s.dirty = true
    }
    size()
    const ro = new ResizeObserver(() => {
      size()
      draw(0)
    })
    ro.observe(box)

    const run = () => {
      const want = s.visible && !s.hidden
      if (want && !s.raf) {
        s.last = performance.now()
        s.raf = requestAnimationFrame(frame)
      } else if (!want && s.raf) {
        cancelAnimationFrame(s.raf)
        s.raf = 0
      }
    }
    const io = new IntersectionObserver((es) => {
      s.visible = es.some((e) => e.isIntersecting)
      run()
    })
    io.observe(box)
    const onVis = () => {
      s.hidden = document.hidden
      run()
    }
    document.addEventListener('visibilitychange', onVis)
    s.hidden = document.hidden

    function frame(now: number) {
      s.raf = 0
      const dt = Math.min(50, Math.max(0, now - s.last))
      s.last = now
      // Still slow after going lite: draw every other frame (30 fps for the map, the page keeps its 60).
      s.flip = !s.flip
      if (s.half && s.flip) {
        s.carry += dt
        if (s.visible && !s.hidden) s.raf = requestAnimationFrame(frame)
        return
      }
      const t0 = performance.now()
      draw(dt + s.carry)
      s.carry = 0
      // Draw cost (an average), shown on the box for checks and used to drop extras on slow devices.
      s.cost = s.cost * 0.92 + (performance.now() - t0) * 0.08
      s.gap = s.gap * 0.95 + dt * 0.05
      if (++s.frames % 60 === 0) {
        box.dataset.frameMs = s.cost.toFixed(1)
        // Sticky once on (after the first three seconds, past the entrance): no flapping between looks.
        const was = s.lite
        s.lite = s.lite || (s.frames >= 180 && s.gap > 24)
        if (was !== s.lite) {
          size()
          s.liteAt = s.frames
        } else if (s.lite && !s.half && s.frames - s.liteAt >= 180 && s.gap > 24) s.half = true
        box.dataset.lite = s.half ? 'half' : s.lite ? '1' : ''
      }
      if (s.visible && !s.hidden) s.raf = requestAnimationFrame(frame)
    }

    function draw(dt: number) {
      const p = P.current
      const reduced = p.reduced
      s.clock += dt
      const t = s.clock
      // Reduced motion: nothing loops, so a frame is drawn only when something changes or is fading.
      if (reduced && !s.dirty && !s.flows.length && dt > 0) {
        let busy = false
        for (const st of s.states.values()) if (t - st.born < 500 || st.dying !== null || st.pop > 0.01) busy = true
        if (!busy) return
      }
      s.dirty = false
      const { w, h, dpr } = s
      // Camera glide.
      const kc = reduced ? 1 : 1 - Math.exp(-dt / 160)
      s.cam.x += (s.camT.x - s.cam.x) * kc
      s.cam.y += (s.camT.y - s.cam.y) * kc
      s.cam.s += (s.camT.s - s.cam.s) * kc
      const cam = s.cam
      const sx = (x: number) => (x - cam.x) * cam.s + w / 2
      const sy = (y: number) => (y - cam.y) * cam.s + h / 2

      // Who is lit: a score part's wallets, else the hovered (or selected) wallet's cluster and neighbours.
      let lit: Set<string> | null = p.highlight
      const focus = s.hover ?? p.selected
      if (!lit && focus) {
        const f = s.states.get(focus)?.node
        lit = new Set([focus])
        if (f?.group) for (const st of s.states.values()) if (st.node.group === f.group) lit.add(st.node.id)
        for (const l of p.links) {
          if (l.a === focus) lit.add(l.b)
          if (l.b === focus) lit.add(l.a)
        }
      }

      // Node motion.
      const kp = reduced ? 1 : 1 - Math.exp(-dt / 180)
      const kr = reduced ? 1 : 1 - Math.exp(-dt / 260)
      const ka = 1 - Math.exp(-dt / 130)
      const pos = new Map<string, { x: number; y: number; r: number; a: number; st: NodeState }>()
      for (const [id, st] of s.states) {
        const n = st.node
        const age = t - st.born
        if (st.dying !== null) {
          const d = clamp01((t - st.dying) / 420)
          if (d >= 1) {
            s.states.delete(id)
            continue
          }
          if (!reduced) st.r *= 1 - kr
          st.alpha *= 1 - ka
        } else if (age < 0) {
          continue
        } else if (age < ENTER_MS && !reduced) {
          const e = age / ENTER_MS
          st.x = n.x * easeOutCubic(e)
          st.y = n.y * easeOutCubic(e)
          st.r = n.r * Math.max(0, easeOutBack(e))
        } else {
          st.x += (n.x - st.x) * kp
          st.y += (n.y - st.y) * kp
          if (t >= st.hold) st.r += (n.r - st.r) * kr
        }
        const targetA = st.dying !== null ? 0 : lit && !lit.has(id) ? 0.16 : 1
        const enterA = reduced ? clamp01(age / 450) : 1
        st.alpha += (targetA * enterA - st.alpha) * (reduced && age < 450 ? 1 : ka)
        st.pop = Math.max(0, st.pop - dt / 750)
        // Idle life: breathe and drift (screen pixels, so it reads the same at any zoom).
        let bx = 0
        let by = 0
        let br = 1
        if (!reduced && st.dying === null && !(s.lite && st.r * cam.s < 14)) {
          const w1 = (t / st.period) * Math.PI * 2 + st.phase
          br = 1 + 0.03 * Math.sin(w1)
          const amp = 2.6 / cam.s
          bx = Math.sin(t / (st.period * 0.83) + st.phase) * amp
          by = Math.cos(t / (st.period * 1.07) + st.phase * 1.3) * amp
        }
        pos.set(id, { x: st.x + bx, y: st.y + by, r: Math.max(0, st.r * br), a: st.alpha, st })
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      // Links, then their idle particles.
      ctx.lineCap = 'round'
      let li = 0
      for (const l of p.links) {
        const a = pos.get(l.a)
        const b = pos.get(l.b)
        if (!a || !b) continue
        const on = !lit || (lit.has(l.a) && lit.has(l.b))
        const al = Math.min(a.a, b.a, 1) * (on ? 0.55 : 0.07) + (on && lit ? 0.25 : 0)
        ctx.strokeStyle = withAlpha(l.colour, al)
        ctx.lineWidth = l.width
        ctx.setLineDash(l.dashed ? [4, 4] : [])
        ctx.beginPath()
        ctx.moveTo(sx(a.x), sy(a.y))
        ctx.lineTo(sx(b.x), sy(b.y))
        ctx.stroke()
        if (!reduced && !s.lite && l.particles && li < MAX_LINK_PARTICLES && on) {
          const u = (t / 2600 + li * 0.37) % 1
          ctx.fillStyle = withAlpha(C.pale, 0.85 * Math.min(a.a, b.a))
          ctx.beginPath()
          ctx.arc(sx(a.x + (b.x - a.x) * u), sy(a.y + (b.y - a.y) * u), 1.8, 0, Math.PI * 2)
          ctx.fill()
          li++
        }
      }
      ctx.setLineDash([])

      // Flow endpoints: the bubble, else the token at the centre (buys out of / sells into a hidden pool), else the edge.
      const point = (id: string, role: 'from' | 'to', side: FlowEvent['side']) => {
        const q = pos.get(id)
        if (q && q.st.dying === null) return { x: sx(q.x), y: sy(q.y), r: q.r * cam.s }
        if ((role === 'from' && (side === 'buy' || side === 'mint')) || (role === 'to' && side === 'sell')) return { x: sx(0), y: sy(0), r: 0 }
        const ang = ((hash(id) % 360) * Math.PI) / 180
        const R = Math.hypot(w, h) * 0.55
        return { x: w / 2 + Math.cos(ang) * R, y: h / 2 + Math.sin(ang) * R, r: 0 }
      }

      // Flows.
      const keep: Flow[] = []
      for (const f of s.flows) {
        const a = point(f.e.from, 'from', f.e.side)
        const b = point(f.e.to, 'to', f.e.side)
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
        const mx = (a.x + b.x) / 2 - ((b.y - a.y) / len) * len * 0.18 * f.bend
        const my = (a.y + b.y) / 2 + ((b.x - a.x) / len) * len * 0.18 * f.bend
        const on = !lit || lit.has(f.e.from) || lit.has(f.e.to)
        const dim = on ? 1 : 0.25
        if (reduced) {
          // A line that fades in and out: the same "who sent what to whom", without movement.
          const age = t - f.start
          if (age < 0) {
            keep.push(f)
            continue
          }
          const al = age < 250 ? age / 250 : age < 1300 ? 1 : 1 - (age - 1300) / 500
          if (al <= 0) {
            if (!f.arrived) arrive(f)
            continue
          }
          if (!f.arrived && age > 250) arrive(f)
          ctx.strokeStyle = withAlpha(f.colour, 0.85 * al * dim)
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
          keep.push(f)
          continue
        }
        const end = f.start + (f.n - 1) * STAGGER_MS + f.dur
        if (t > end + 60) continue
        keep.push(f)
        if (t < f.start) continue
        // The faint path, then the particles with short trails.
        const pathA = clamp01((t - f.start) / 200) * clamp01((end - t) / 300) * 0.28 * dim
        if (pathA > 0) {
          ctx.strokeStyle = withAlpha(f.colour, pathA)
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.quadraticCurveTo(mx, my, b.x, b.y)
          ctx.stroke()
        }
        for (let j = 0; j < f.n; j++) {
          const u0 = (t - f.start - j * STAGGER_MS) / f.dur
          if (u0 <= 0 || u0 >= 1.02) continue
          for (let k = 2; k >= 0; k--) {
            const u = easeInOut(clamp01(u0 - k * 0.035))
            const x = (1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * mx + u * u * b.x
            const y = (1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * my + u * u * b.y
            ctx.fillStyle = withAlpha(f.colour, (k === 0 ? 0.95 : k === 1 ? 0.45 : 0.2) * dim)
            ctx.beginPath()
            ctx.arc(x, y, k === 0 ? 2.8 : 2.2, 0, Math.PI * 2)
            ctx.fill()
          }
        }
        if (!f.arrived && t >= f.start + f.dur) arrive(f)
      }
      s.flows = keep
      function arrive(f: Flow) {
        f.arrived = true
        const st = s.states.get(f.e.to)
        if (st) {
          st.pop = 1
          st.popColour = f.colour
          st.hold = 0
        }
        const src = s.states.get(f.e.from)
        if (src && f.e.side !== 'buy') src.hold = 0
      }

      // Bubbles: visible ones in screen units, then one batched path per look (fill, stroke, alpha), so 200
      // bubbles cost a handful of draw calls; decorations go on top, one by one, for the few that have them.
      const vis: { id: string; n: BNode; st: NodeState; X: number; Y: number; R: number; a: number }[] = []
      for (const [id, q] of pos) {
        const R = q.r * cam.s
        if (R < 0.3 || q.a < 0.01) continue
        const X = sx(q.x)
        const Y = sy(q.y)
        if (X + R < -40 || X - R > w + 40 || Y + R < -40 || Y - R > h + 40) continue
        vis.push({ id, n: q.st.node, st: q.st, X, Y, R, a: q.a })
      }
      // Soft pulse rings on pools, locks and the token (under the bubbles).
      if (!reduced)
        for (const v of vis) {
          if (!v.n.pulse || v.st.dying !== null) continue
          const ph = ((t + v.st.phase * 400) % 2600) / 2600
          ctx.globalAlpha = v.a
          ctx.strokeStyle = withAlpha(C.pale, 0.4 * (1 - ph))
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(v.X, v.Y, v.R + 2 + ph * Math.min(28, 10 + v.R * 0.25), 0, Math.PI * 2)
          ctx.stroke()
        }
      type Vis = (typeof vis)[number]
      const drawGroups = (g2: CanvasRenderingContext2D, items: Vis[]) => {
        const groups = new Map<string, { n: BNode; a: number; R: number; items: Vis[] }>()
        for (const v of items) {
          const a = Math.round(v.a * 20) / 20
          const k = `${v.n.fill}|${v.n.stroke}|${v.n.strokeWidth}|${v.n.dashed ? 1 : 0}|${a}`
          const g = groups.get(k)
          if (g) {
            g.items.push(v)
            g.R = Math.max(g.R, v.R)
          } else groups.set(k, { n: v.n, a, R: v.R, items: [v] })
        }
        for (const g of [...groups.values()].sort((x, y) => y.R - x.R)) {
          g2.globalAlpha = g.a
          g2.beginPath()
          for (const v of g.items) {
            g2.moveTo(v.X + v.R, v.Y)
            g2.arc(v.X, v.Y, v.R, 0, Math.PI * 2)
          }
          g2.fillStyle = g.n.fill
          g2.fill()
          g2.strokeStyle = g.n.stroke
          g2.lineWidth = g.n.strokeWidth
          if (g.n.dashed) g2.setLineDash([5, 4])
          g2.stroke()
          if (g.n.dashed) g2.setLineDash([])
        }
        g2.globalAlpha = 1
      }
      // A slow device: small bubbles that have settled are drawn once into a layer, re-drawn only when the
      // camera, the lighting or the data changes; each frame then blits it and draws the rest.
      if (s.lite) {
        const settled = (v: Vis) => {
          const n = v.n
          return v.R < 14 && v.st.pop <= 0.01 && v.st.dying === null && p.selected !== v.id && !p.ringed?.has(v.id) && t - v.st.born > ENTER_MS && Math.abs(v.st.x - n.x) < 0.01 && Math.abs(v.st.y - n.y) < 0.01 && Math.abs(v.st.r - n.r) < 0.01 && Math.abs(v.a - Math.round(v.a * 20) / 20) < 0.01
        }
        const still = vis.filter(settled)
        const key = `${cam.x.toFixed(3)},${cam.y.toFixed(3)},${cam.s.toFixed(5)}|${w}x${h}|${still.length}|${still.map((v) => v.id.slice(-4) + Math.round(v.a * 20)).join('')}`
        if (!s.layer || s.layerKey !== key) {
          s.layer ??= document.createElement('canvas')
          s.layer.width = canvas.width
          s.layer.height = canvas.height
          const l2 = s.layer.getContext('2d')
          if (l2) {
            l2.setTransform(dpr, 0, 0, dpr, 0, 0)
            l2.clearRect(0, 0, w, h)
            drawGroups(l2, still)
          }
          s.layerKey = key
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.drawImage(s.layer, 0, 0)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        const stillSet = new Set(still)
        drawGroups(ctx, vis.filter((v) => !stillSet.has(v)))
      } else drawGroups(ctx, vis)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      let font = ''
      const setFont = (f: string) => {
        if (f !== font) ctx.font = font = f
      }
      for (const { id, n, st, X, Y, R, a } of vis) {
        ctx.globalAlpha = a
        if (p.selected === id) {
          ctx.strokeStyle = C.bone
          ctx.lineWidth = 3
          ctx.beginPath()
          ctx.arc(X, Y, R, 0, Math.PI * 2)
          ctx.stroke()
        }
        // A flow just landed: a ring in its colour (expanding; under reduced motion it only fades).
        if (st.pop > 0.01) {
          const e = 1 - st.pop
          ctx.strokeStyle = withAlpha(st.popColour, st.pop)
          ctx.lineWidth = 2.5
          ctx.beginPath()
          ctx.arc(X, Y, R + (reduced ? 4 : 3 + e * 16), 0, Math.PI * 2)
          ctx.stroke()
        }
        // A score part's wallets: a turning dashed ring.
        if (p.ringed?.has(id)) {
          ctx.strokeStyle = C.gold
          ctx.lineWidth = 2
          ctx.setLineDash([6, 5])
          ctx.lineDashOffset = reduced ? 0 : -t / 40
          ctx.beginPath()
          ctx.arc(X, Y, R + 6, 0, Math.PI * 2)
          ctx.stroke()
          ctx.setLineDash([])
          ctx.lineDashOffset = 0
        }
        // Glyph, share and caption.
        const showText = !!n.text && R >= 20
        const inCaption = !!n.caption && R >= 38
        if (n.glyph && R >= 9) {
          const gs = Math.min(26, Math.max(10, R * (showText ? 0.42 : 0.9)))
          const gy = showText ? Y - Math.min(R * 0.42, gs * 1.05) : Y
          ctx.save()
          ctx.translate(X - gs / 2, gy - gs / 2)
          ctx.scale(gs / 24, gs / 24)
          ctx.strokeStyle = n.textColour
          ctx.lineWidth = 2
          ctx.lineJoin = 'round'
          for (const g of glyphPaths(n.glyph)) ctx.stroke(g)
          ctx.restore()
        }
        if (showText) {
          const fs = Math.round(Math.min(16, Math.max(11, R * 0.3)))
          setFont(`500 ${fs}px 'IBM Plex Mono', monospace`)
          ctx.fillStyle = n.textColour
          ctx.fillText(n.text as string, X, n.glyph ? Y + fs * 0.35 : Y)
        }
        if (n.caption) {
          setFont(`500 11px 'IBM Plex Mono', monospace`)
          if (inCaption) {
            ctx.fillStyle = n.textColour
            ctx.fillText(n.caption, X, Y + Math.min(R * 0.55, 34))
          } else {
            // Under the bubble, on a dark tab so it reads over neighbours.
            const tw = ctx.measureText(n.caption).width + 8
            ctx.fillStyle = withAlpha(C.night, 0.82)
            ctx.fillRect(X - tw / 2, Y + R + 3, tw, 15)
            ctx.fillStyle = C.muted
            ctx.fillText(n.caption, X, Y + R + 11)
          }
        }
      }
      ctx.globalAlpha = 1
    }

    // Pointer: hover (tooltip), drag to pan, pinch, click to select.
    const at = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const hit = (x: number, y: number) => {
      const cam = s.cam
      let best: string | null = null
      let bestR = Infinity
      for (const [id, st] of s.states) {
        if (st.dying !== null || st.r <= 0) continue
        const X = (st.x - cam.x) * cam.s + s.w / 2
        const Y = (st.y - cam.y) * cam.s + s.h / 2
        const R = Math.max(st.r * cam.s, 7)
        if ((x - X) ** 2 + (y - Y) ** 2 <= R * R && R < bestR) {
          best = id
          bestR = R
        }
      }
      return best
    }
    const showTip = (id: string | null, x: number, y: number) => {
      const el = tipRef.current
      if (!el) return
      const t = id ? P.current.tip(id) : null
      if (!t) {
        el.style.opacity = '0'
        return
      }
      el.innerHTML = `<div class="font-semibold text-ink">${esc(t.title)}</div>${t.rows.map(([k, v]) => `<div class="flex justify-between gap-4"><span class="text-muted">${esc(k)}</span><span class="text-ink">${esc(v)}</span></div>`).join('')}${t.note ? `<div class="mt-1 text-gold-hover">${esc(t.note)}</div>` : ''}`
      const bw = el.offsetWidth
      const bh = el.offsetHeight
      el.style.left = `${Math.min(Math.max(4, x + 14), s.w - bw - 4)}px`
      el.style.top = `${y + 14 + bh > s.h ? Math.max(4, y - bh - 10) : y + 14}px`
      el.style.opacity = '1'
    }
    const setHover = (id: string | null) => {
      if (s.hover === id) return
      s.hover = id
      box.dataset.hover = id ?? ''
      canvas.style.cursor = id ? 'pointer' : s.drag ? 'grabbing' : 'grab'
      s.dirty = true
    }
    const onDown = (e: PointerEvent) => {
      const p = at(e)
      s.pointers.set(e.pointerId, p)
      canvas.setPointerCapture?.(e.pointerId)
      if (s.pointers.size === 2) {
        const [a, b] = [...s.pointers.values()]
        s.drag = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, moved: true, pinch: Math.hypot(a.x - b.x, a.y - b.y) }
      } else s.drag = { x: p.x, y: p.y, moved: false, pinch: null }
    }
    const onMove = (e: PointerEvent) => {
      const p = at(e)
      if (!s.pointers.has(e.pointerId)) {
        if (e.pointerType === 'mouse') {
          const id = hit(p.x, p.y)
          setHover(id)
          showTip(id, p.x, p.y)
        }
        return
      }
      s.pointers.set(e.pointerId, p)
      const d = s.drag
      if (!d) return
      if (s.pointers.size >= 2 && d.pinch) {
        const [a, b] = [...s.pointers.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        zoomAt(dist / d.pinch, (a.x + b.x) / 2, (a.y + b.y) / 2)
        s.cam = { ...s.camT }
        d.pinch = dist
        return
      }
      const dx = p.x - d.x
      const dy = p.y - d.y
      if (!d.moved && Math.hypot(dx, dy) < 5) return
      d.moved = true
      d.x = p.x
      d.y = p.y
      s.camT = { ...s.camT, x: s.camT.x - dx / s.camT.s, y: s.camT.y - dy / s.camT.s }
      s.cam = { ...s.cam, x: s.cam.x - dx / s.cam.s, y: s.cam.y - dy / s.cam.s }
      s.userCam = true
      setZoomed(true)
      canvas.style.cursor = 'grabbing'
      showTip(null, 0, 0)
      s.dirty = true
      P.current.onInteract?.()
    }
    const onUp = (e: PointerEvent) => {
      const p = at(e)
      const d = s.drag
      s.pointers.delete(e.pointerId)
      if (s.pointers.size) return
      s.drag = null
      canvas.style.cursor = s.hover ? 'pointer' : 'grab'
      if (d && !d.moved) {
        const id = hit(p.x, p.y)
        P.current.onSelect(id)
        P.current.onInteract?.()
        if (e.pointerType !== 'mouse') showTip(null, 0, 0)
      }
    }
    const onCancel = (e: PointerEvent) => {
      s.pointers.delete(e.pointerId)
      if (!s.pointers.size) s.drag = null
    }
    const onLeave = () => {
      setHover(null)
      showTip(null, 0, 0)
    }
    const onWheel = (e: WheelEvent) => {
      // Ctrl/⌘ + wheel (and trackpad pinch, which sends ctrl) zooms; a plain wheel scrolls the page.
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const p = at(e)
      zoomAt(Math.exp(-e.deltaY * 0.0022), p.x, p.y)
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onCancel)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.style.cursor = 'grab'
    run()
    return () => {
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onCancel)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('wheel', onWheel)
      if (s.raf) cancelAnimationFrame(s.raf)
      s.raf = 0
    }
    // One loop per mount; it reads the latest props through P and S.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const s = S.current
    const step = 40 / s.camT.s
    const pan = (dx: number, dy: number) => {
      s.camT = { ...s.camT, x: s.camT.x + dx, y: s.camT.y + dy }
      if (P.current.reduced) s.cam = { ...s.camT }
      s.userCam = true
      setZoomed(true)
      s.dirty = true
    }
    if (e.key === '+' || e.key === '=') zoomAt(1.3, s.w / 2, s.h / 2)
    else if (e.key === '-' || e.key === '_') zoomAt(1 / 1.3, s.w / 2, s.h / 2)
    else if (e.key === '0') {
      s.userCam = false
      s.camT = { ...s.fitCam }
      setZoomed(false)
    } else if (e.key === 'ArrowLeft') pan(-step, 0)
    else if (e.key === 'ArrowRight') pan(step, 0)
    else if (e.key === 'ArrowUp') pan(0, -step)
    else if (e.key === 'ArrowDown') pan(0, step)
    else return
    e.preventDefault()
  }

  return (
    <div
      ref={boxRef}
      className={`relative w-full overflow-hidden ${props.className ?? ''}`}
      style={{ height: props.height }}
      role="img"
      aria-label={props.label}
      data-chart=""
      data-bubble-canvas=""
      data-hover=""
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {/* Its own compositing layer, so a frame repaints the canvas only, never the page around it. */}
      <canvas ref={canvasRef} className="absolute inset-0 block size-full" style={{ touchAction: 'pan-y', willChange: 'transform', contain: 'strict' }} aria-hidden />
      <div
        ref={tipRef}
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 z-10 flex min-w-[160px] flex-col gap-0.5 rounded-[8px] border border-line-strong px-2.5 py-2 font-mono text-[12px] opacity-0 transition-opacity duration-150"
        style={{ background: K.midnight }}
      />
    </div>
  )
})

export default BubbleCanvas
